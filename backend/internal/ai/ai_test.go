package ai

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

type mockProvider struct {
	lastReq CompletionRequest
	resp    *CompletionResponse
	err     error
}

func TestCompatibleProvidersNormalizeClaimExtraction(t *testing.T) {
	toolClaim := `{\"insuredFullName\":\"Jean Dupont\",\"phoneNumber\":\"243123456789\"}`
	cases := []struct {
		name, first, second string
		calls               int32
	}{
		{"openai native tool", `{"choices":[{"message":{"tool_calls":[{"function":{"name":"extract_auto_claim_data","arguments":"` + toolClaim + `"}}]}}]}`, "", 1},
		{"deepseek json text", `{"choices":[{"message":{"content":"` + toolClaim + `"}}]}`, "", 1},
		{"qwen malformed then repair", `{"choices":[{"message":{"content":"{bad json"}}]}`, `{"choices":[{"message":{"content":"` + toolClaim + `"}}]}`, 2},
		{"generic 429 then tool", `{"error":"rate limited"}`, `{"choices":[{"message":{"tool_calls":[{"function":{"name":"extract_auto_claim_data","arguments":"` + toolClaim + `"}}]}}]}`, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var calls int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				n := atomic.AddInt32(&calls, 1)
				if tc.name == "generic 429 then tool" && n == 1 {
					w.WriteHeader(http.StatusTooManyRequests)
					_, _ = w.Write([]byte(tc.first))
					return
				}
				body := tc.first
				if tc.second != "" && n > 1 {
					body = tc.second
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(body))
			}))
			defer srv.Close()
			p, err := NewOpenAICompatProvider(OpenAICompatConfig{APIKey: "test", BaseURL: srv.URL, Model: "test", Timeout: 2})
			if err != nil {
				t.Fatal(err)
			}
			args, err := ExtractToolArguments(context.Background(), p, CompletionRequest{Prompt: "claim", Tools: []ToolDefinition{ExtractAutoClaimDataTool()}}, ExtractAutoClaimDataTool())
			if err != nil {
				t.Fatal(err)
			}
			if args["insuredFullName"] != "Jean Dupont" || args["phoneNumber"] != "243123456789" {
				t.Fatalf("unexpected extraction: %#v", args)
			}
			if calls != tc.calls {
				t.Fatalf("calls = %d, want %d", calls, tc.calls)
			}
		})
	}
}

func (m *mockProvider) Name() string { return "mock" }
func (m *mockProvider) Close() error { return nil }
func (m *mockProvider) Complete(_ context.Context, req CompletionRequest) (*CompletionResponse, error) {
	m.lastReq = req
	if m.err != nil {
		return nil, m.err
	}
	return m.resp, nil
}

func TestParseToolCallArgs(t *testing.T) {
	args := map[string]interface{}{
		"insuredFullName": "Jean Dupont",
		"phoneNumber":     "243123456789",
	}
	var out struct {
		InsuredFullName string `json:"insuredFullName"`
		PhoneNumber     string `json:"phoneNumber"`
	}
	if err := ParseToolCallArgs(args, &out); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.InsuredFullName != "Jean Dupont" || out.PhoneNumber != "243123456789" {
		t.Fatalf("unexpected output: %+v", out)
	}
}

func TestExtractAutoClaimDataToolSchema(t *testing.T) {
	schema := AutoClaimToolSchema()
	if schema["type"] != "object" {
		t.Fatalf("expected object schema, got %v", schema["type"])
	}
	props, ok := schema["properties"].(map[string]interface{})
	if !ok || props["insuredFullName"] == nil {
		t.Fatal("expected insuredFullName property")
	}
	tool := ExtractAutoClaimDataTool()
	if tool.Name != "extract_auto_claim_data" {
		t.Fatalf("unexpected tool name: %s", tool.Name)
	}
}

func TestMockProviderComplete(t *testing.T) {
	mock := &mockProvider{
		resp: &CompletionResponse{Text: "[CLAIM] :: Bonjour"},
	}
	resp, err := mock.Complete(context.Background(), CompletionRequest{Prompt: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Text == "" {
		t.Fatal("expected text response")
	}
	if mock.lastReq.Prompt != "test" {
		t.Fatalf("prompt not forwarded: %q", mock.lastReq.Prompt)
	}
}

func TestDefaultBaseURL(t *testing.T) {
	cases := map[string]string{
		"deepseek": "https://api.deepseek.com/v1",
		"qwen":     "https://dashscope.aliyuncs.com/compatible-mode/v1",
		"openai":   "https://api.openai.com/v1",
	}
	for provider, want := range cases {
		if got := defaultBaseURL(provider); got != want {
			t.Fatalf("%s: got %s want %s", provider, got, want)
		}
	}
}

func TestBuildOpenAIUserContentTextOnly(t *testing.T) {
	content := buildOpenAIUserContent(CompletionRequest{Prompt: "hello"})
	if content != "hello" {
		t.Fatalf("expected string content, got %v", content)
	}
}

func TestBuildOpenAIUserContentWithImage(t *testing.T) {
	content := buildOpenAIUserContent(CompletionRequest{
		Prompt: "describe",
		Images: []ImageInput{{MIMEType: "image/jpeg", Data: []byte{1, 2, 3}}},
	})
	parts, ok := content.([]map[string]interface{})
	if !ok || len(parts) != 2 {
		t.Fatalf("expected multipart content, got %#v", content)
	}
	if parts[1]["type"] != "image_url" {
		t.Fatalf("expected image_url part, got %#v", parts[1])
	}
}

func TestParseOpenAIResponseToolCall(t *testing.T) {
	body := []byte(`{
		"choices":[{"message":{
			"content":"",
			"tool_calls":[{"id":"1","type":"function","function":{"name":"extract_auto_claim_data","arguments":"{\"phoneNumber\":\"123\"}"}}]
		}}]
	}`)
	resp, err := parseOpenAIResponse(body)
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(resp.ToolCalls))
	}
	if resp.ToolCalls[0].Name != "extract_auto_claim_data" {
		t.Fatalf("unexpected tool name: %s", resp.ToolCalls[0].Name)
	}
	if fmt.Sprintf("%v", resp.ToolCalls[0].Arguments["phoneNumber"]) != "123" {
		t.Fatalf("unexpected args: %v", resp.ToolCalls[0].Arguments)
	}
}
