package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestBuildGeminiContentsUsesRolesAndSystemInstruction(t *testing.T) {
	history, final, system, err := buildGeminiContents(CompletionRequest{
		SystemPrompt: "You are an insurance assistant.",
		Messages: []ChatMessage{
			{Role: RoleAssistant, Content: "Welcome!"},
			{Role: RoleUser, Content: "I had an accident"},
			{Role: RoleUser, Content: "yesterday"},
			{Role: RoleSystem, Content: "Reply in French."},
			{Role: RoleAssistant, Content: "What is your name?"},
			{Role: RoleUser, Content: "Jean Dupont"},
		},
		Prompt: "Extract the claim.",
		Images: []ImageInput{{MIMEType: "image/png", Data: []byte{1, 2}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if system != "You are an insurance assistant.\n\nReply in French." {
		t.Fatalf("system = %q", system)
	}
	wantRoles := []string{"user", "model", "user", "model"}
	if len(history) != len(wantRoles) {
		t.Fatalf("history has %d turns, want %d", len(history), len(wantRoles))
	}
	for i, c := range history {
		if c.Role != wantRoles[i] {
			t.Fatalf("turn %d role = %s, want %s", i, c.Role, wantRoles[i])
		}
	}
	if got := len(history[2].Parts); got != 2 {
		t.Fatalf("consecutive user messages should merge into one turn, got %d parts", got)
	}
	if len(final) != 3 || final[0].Text != "Jean Dupont" || final[1].Text != "Extract the claim." || final[2].InlineData == nil || final[2].InlineData.MIMEType != "image/png" {
		t.Fatalf("final turn = %#v", final)
	}
}

func TestBuildGeminiContentsEmpty(t *testing.T) {
	if _, _, _, err := buildGeminiContents(CompletionRequest{SystemPrompt: "x"}); err == nil {
		t.Fatal("expected an error for a request with no content")
	}
}

func TestGeminiSchemaConversion(t *testing.T) {
	s := geminiSchema(map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"claimType": map[string]interface{}{"type": "string", "enum": []string{"AUTO", "HOME", ""}},
			"photos":    map[string]interface{}{"type": "array"},
			"injured":   map[string]interface{}{"type": "boolean", "minLength": 1},
			"amount":    map[string]interface{}{"type": "number", "enum": []string{"1"}},
		},
		"required": []string{"claimType", "missing"},
	}, true)
	raw, _ := json.Marshal(s)
	got := string(raw)
	for _, want := range []string{`"type":"OBJECT"`, `"required":["claimType"]`, `"enum":["AUTO","HOME"]`, `"format":"enum"`, `"items":{"type":"STRING"}`, `"type":"BOOLEAN"`} {
		if !strings.Contains(got, want) {
			t.Fatalf("schema %s lacks %s", got, want)
		}
	}
	if strings.Contains(got, "minLength") || strings.Contains(got, `"enum":["1"]`) {
		t.Fatalf("unsupported keywords must be dropped: %s", got)
	}
}

func TestParseGeminiResponse(t *testing.T) {
	var raw geminiResponse
	_ = json.Unmarshal([]byte(`{"candidates":[{"content":{"role":"model","parts":[{"text":"thinking...","thought":true},{"text":"Bonjour "},{"text":"Jean"},{"functionCall":{"name":"f","args":{"a":"b"}},"thoughtSignature":"xyz"}]},"finishReason":"STOP"}]}`), &raw)
	out, err := parseGeminiResponse(&raw)
	if err != nil {
		t.Fatal(err)
	}
	if out.Text != "Bonjour Jean" || len(out.ToolCalls) != 1 || out.ToolCalls[0].Arguments["a"] != "b" || out.FinishReason != "stop" {
		t.Fatalf("unexpected %#v", out)
	}
	var empty geminiResponse
	_ = json.Unmarshal([]byte(`{"candidates":[{"finishReason":"MAX_TOKENS"}]}`), &empty)
	if out, err := parseGeminiResponse(&empty); err != nil || out.FinishReason != "max_tokens" || out.Text != "" {
		t.Fatalf("missing content should not fail: %#v %v", out, err)
	}
	var blocked geminiResponse
	_ = json.Unmarshal([]byte(`{"candidates":[{"finishReason":"SAFETY"}]}`), &blocked)
	if _, err := parseGeminiResponse(&blocked); !errors.Is(err, ErrLLMBlocked) {
		t.Fatalf("safety block should be ErrLLMBlocked, got %v", err)
	}
	var promptBlocked geminiResponse
	_ = json.Unmarshal([]byte(`{"promptFeedback":{"blockReason":"PROHIBITED_CONTENT"}}`), &promptBlocked)
	if _, err := parseGeminiResponse(&promptBlocked); !errors.Is(err, ErrLLMBlocked) {
		t.Fatalf("prompt block should be ErrLLMBlocked, got %v", err)
	}
}

func TestGeminiRetryPolicy(t *testing.T) {
	quota := parseGeminiError(429, []byte(`{"error":{"code":429,"message":"You exceeded your current quota. For more information on this error, head to: https://ai.google.dev","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaValue":"20"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"41s"}]}}`))
	if _, ok := geminiRetryDelay(quota, 1); ok {
		t.Fatal("a long server cooldown should fail fast instead of blocking the reply")
	}
	daily := parseGeminiError(429, []byte(`{"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaValue":"20"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"2s"}]}}`))
	if _, ok := geminiRetryDelay(daily, 1); ok {
		t.Fatal("an exhausted daily quota must not be retried, even with a short retryDelay")
	}
	if msg := quota.Error(); !strings.Contains(msg, "PerDay") || !strings.Contains(msg, "limit=20") || strings.Contains(msg, "For more information") {
		t.Fatalf("quota details missing: %s", msg)
	}
	short := parseGeminiError(429, []byte(`{"error":{"code":429,"message":"slow down","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"1.5s"}]}}`))
	if d, ok := geminiRetryDelay(short, 1); !ok || d != 1500*time.Millisecond {
		t.Fatalf("server retryDelay not honoured: %v %v", d, ok)
	}
	if _, ok := geminiRetryDelay(parseGeminiError(503, []byte(`{"error":{"code":503,"message":"The model is overloaded."}}`)), 1); !ok {
		t.Fatal("503 should be retried")
	}
	bad := parseGeminiError(400, []byte(`{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}`))
	if _, ok := geminiRetryDelay(bad, 1); ok {
		t.Fatal("400 must not be retried")
	}
	if !strings.Contains(bad.Error(), "rejected the API key") {
		t.Fatalf("got %v", bad)
	}
	if got := parseGeminiError(400, []byte(`{"error":{"code":400,"message":"* GenerateContentRequest.tools[0]: bad schema","status":"INVALID_ARGUMENT"}}`)).Error(); !strings.Contains(got, "bad schema") {
		t.Fatalf("API error message must be kept: %s", got)
	}
}

func TestDefaultGeminiThinkingBudget(t *testing.T) {
	t.Setenv("GEMINI_THINKING_BUDGET", "")
	if b := DefaultGeminiThinkingBudget("gemini-2.5-flash"); b == nil || *b != 0 {
		t.Fatal("2.5 Flash should run without thinking by default")
	}
	if DefaultGeminiThinkingBudget("gemini-2.0-flash") != nil || DefaultGeminiThinkingBudget("gemini-2.5-pro") != nil {
		t.Fatal("other models keep their default (2.0 rejects the field, 2.5 Pro cannot disable it)")
	}
	t.Setenv("GEMINI_THINKING_BUDGET", "512")
	if b := DefaultGeminiThinkingBudget("gemini-2.5-flash"); b == nil || *b != 512 {
		t.Fatal("env override ignored")
	}
	t.Setenv("GEMINI_THINKING_BUDGET", "default")
	if DefaultGeminiThinkingBudget("gemini-2.5-flash") != nil {
		t.Fatal(`"default" should leave the field out`)
	}
}

// fakeGemini is a minimal stand-in for generativelanguage.googleapis.com.
type fakeGemini struct {
	mu      sync.Mutex
	bodies  []map[string]interface{}
	paths   []string
	keys    []string
	queries []string
	replies []func(w http.ResponseWriter)
}

func (f *fakeGemini) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	raw, _ := io.ReadAll(r.Body)
	var body map[string]interface{}
	_ = json.Unmarshal(raw, &body)
	f.bodies = append(f.bodies, body)
	f.paths = append(f.paths, r.URL.Path)
	f.keys = append(f.keys, r.Header.Get("x-goog-api-key"))
	f.queries = append(f.queries, r.URL.RawQuery)
	n := len(f.bodies) - 1
	if n >= len(f.replies) {
		n = len(f.replies) - 1
	}
	w.Header().Set("Content-Type", "application/json")
	f.replies[n](w)
}

func geminiJSON(status int, body string) func(w http.ResponseWriter) {
	return func(w http.ResponseWriter) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}
}

const geminiToolReply = `{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"extract_auto_claim_data","args":{"insuredFullName":"Jean Dupont","phoneNumber":"243123456789"}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15}}`

func newFakeGeminiProvider(t *testing.T, f *fakeGemini, model string) *GeminiProvider {
	t.Helper()
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	t.Setenv("GEMINI_THINKING_BUDGET", "")
	p, err := NewGeminiProvider(GeminiConfig{APIKey: "test-key", Model: model, Endpoint: srv.URL, Timeout: 5})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestGeminiProviderRequestShape(t *testing.T) {
	f := &fakeGemini{replies: []func(http.ResponseWriter){geminiJSON(200, geminiToolReply)}}
	p := newFakeGeminiProvider(t, f, "models/gemini-2.5-flash")
	tool := ExtractAutoClaimDataTool()
	args, mode, err := ExtractToolArgumentsWithMode(context.Background(), p, CompletionRequest{
		SystemPrompt: "Extract claims.",
		Messages:     []ChatMessage{{Role: RoleUser, Content: "Je suis Jean Dupont, 243123456789"}},
		Prompt:       "Extract the claim.",
		MaxTokens:    900,
	}, tool)
	if err != nil {
		t.Fatal(err)
	}
	if mode != ExtractionModeToolCall || args["insuredFullName"] != "Jean Dupont" {
		t.Fatalf("mode=%s args=%#v", mode, args)
	}
	if f.paths[0] != "/v1beta/models/gemini-2.5-flash:generateContent" {
		t.Fatalf("path = %s", f.paths[0])
	}
	if f.keys[0] != "test-key" || strings.Contains(f.queries[0], "key") {
		t.Fatal("the API key must travel in the x-goog-api-key header, never in the URL")
	}
	raw, _ := json.Marshal(f.bodies[0])
	body := string(raw)
	for _, want := range []string{
		`"systemInstruction":{"parts":[{"text":"Extract claims."}]}`,
		`"toolConfig":{"functionCallingConfig":{"allowedFunctionNames":["extract_auto_claim_data"],"mode":"ANY"}}`,
		`"thinkingConfig":{"thinkingBudget":0}`,
		`"maxOutputTokens":900`,
		`"type":"OBJECT"`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("request lacks %s:\n%s", want, body)
		}
	}
	if contents := f.bodies[0]["contents"].([]interface{}); len(contents) != 1 {
		t.Fatalf("want a single user turn, got %d", len(contents))
	}
}

func TestGeminiProviderOmitsThinkingForOtherModels(t *testing.T) {
	f := &fakeGemini{replies: []func(http.ResponseWriter){geminiJSON(200, `{"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}`)}}
	p := newFakeGeminiProvider(t, f, "gemini-2.0-flash")
	if _, err := p.Complete(context.Background(), CompletionRequest{Prompt: "hi", MaxTokens: 100}); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(f.bodies[0])
	if strings.Contains(string(raw), "thinkingConfig") || strings.Contains(string(raw), "maxOutputTokens") {
		t.Fatalf("unexpected generation config: %s", raw)
	}
}

func TestGeminiProviderRetriesRateLimit(t *testing.T) {
	f := &fakeGemini{replies: []func(http.ResponseWriter){
		geminiJSON(429, `{"error":{"code":429,"message":"Resource has been exhausted","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"0.2s"}]}}`),
		geminiJSON(200, `{"candidates":[{"content":{"role":"model","parts":[{"text":"Bonjour"}]},"finishReason":"STOP"}]}`),
	}}
	p := newFakeGeminiProvider(t, f, "gemini-2.5-flash")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	start := time.Now()
	resp, err := p.Complete(ctx, CompletionRequest{Prompt: "Salut"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Text != "Bonjour" || len(f.bodies) != 2 || time.Since(start) > 2*time.Second {
		t.Fatalf("text=%q calls=%d after %v", resp.Text, len(f.bodies), time.Since(start))
	}
}

func TestGeminiProviderReportsInvalidKey(t *testing.T) {
	f := &fakeGemini{replies: []func(http.ResponseWriter){geminiJSON(400, `{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}`)}}
	p := newFakeGeminiProvider(t, f, "gemini-2.5-flash")
	_, err := p.Complete(context.Background(), CompletionRequest{Prompt: "hi"})
	if err == nil || !strings.Contains(err.Error(), "rejected the API key") || strings.Contains(err.Error(), "test-key") {
		t.Fatalf("got %v", err)
	}
	if len(f.bodies) != 1 {
		t.Fatalf("invalid key must not be retried, calls=%d", len(f.bodies))
	}
}

func TestRepairRequestKeepsConversation(t *testing.T) {
	m := &mockProvider{resp: &CompletionResponse{Text: "Could you tell me today's date?"}}
	tool := ExtractAutoClaimDataTool()
	_, _, _ = ExtractToolArgumentsWithMode(context.Background(), m, CompletionRequest{
		SystemPrompt: "rules",
		Messages:     []ChatMessage{{Role: RoleUser, Content: "Je suis Jean Dupont"}},
		Prompt:       "Extract the claim.",
	}, tool)
	r := m.lastReq
	if r.SystemPrompt != "rules" || len(r.Messages) != 1 || !strings.Contains(r.Prompt, "Extract the claim.") || !strings.Contains(r.Prompt, "today's date") {
		t.Fatalf("repair lost the original context: %#v", r)
	}
	if len(r.Tools) != 0 {
		t.Fatal("repair asks for plain JSON, without tools")
	}
}
