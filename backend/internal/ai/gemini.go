package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// GeminiProvider talks to the Gemini API (generativelanguage.googleapis.com)
// over REST. It does not use the github.com/google/generative-ai-go SDK: that
// SDK is deprecated, cannot turn off Gemini 2.5 "thinking" (several seconds
// per reply), only reports an empty message for API errors, and panics on
// response parts it does not know.
type GeminiProvider struct {
	apiKey         string
	baseURL        string
	modelName      string
	thinkingBudget *int
	httpClient     *http.Client
	logf           func(format string, args ...interface{})
}

type GeminiConfig struct {
	APIKey  string
	Model   string
	Timeout int // seconds; the caller's context deadline also applies
	// Logf, when set, receives one line per call (latency, finish reason,
	// token counts). Never the prompt, the reply or the key.
	Logf func(format string, args ...interface{})
	// Endpoint overrides the API base URL (tests, or a proxy).
	Endpoint string
	// ThinkingBudget sets generationConfig.thinkingConfig.thinkingBudget.
	// nil means DefaultGeminiThinkingBudget(model).
	ThinkingBudget *int
}

// DefaultGeminiModel is used when a company selects Gemini without a model.
const DefaultGeminiModel = "gemini-2.5-flash"

const defaultGeminiBaseURL = "https://generativelanguage.googleapis.com/v1beta"

// Retry budget for rate limits (429) and transient 5xx errors.
const (
	geminiMaxAttempts   = 3
	geminiMaxRetryDelay = 20 * time.Second
)

// DefaultGeminiThinkingBudget returns the thinking budget sent for a model:
// 0 (off) for the 2.5 Flash family, where thinking adds seconds of latency
// to every chat reply for no gain on short extraction and support turns, and
// nil (the model's own default) for everything else (2.5 Pro cannot turn it
// off, 2.0 models reject the field). GEMINI_THINKING_BUDGET overrides it;
// "default" leaves the field out.
func DefaultGeminiThinkingBudget(model string) *int {
	if v := strings.TrimSpace(os.Getenv("GEMINI_THINKING_BUDGET")); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return &n
		}
		return nil
	}
	m := strings.ToLower(model)
	if strings.Contains(m, "gemini-2.5-flash") {
		zero := 0
		return &zero
	}
	return nil
}

func NewGeminiProvider(cfg GeminiConfig) (*GeminiProvider, error) {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, fmt.Errorf("gemini API key is required")
	}
	modelName := strings.TrimPrefix(strings.TrimSpace(cfg.Model), "models/")
	if modelName == "" {
		modelName = DefaultGeminiModel
	}
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.Endpoint), "/")
	if baseURL == "" {
		baseURL = defaultGeminiBaseURL
	} else if !strings.Contains(baseURL, "/v1") {
		baseURL += "/v1beta"
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 90
	}
	budget := cfg.ThinkingBudget
	if budget == nil {
		budget = DefaultGeminiThinkingBudget(modelName)
	}
	logf := cfg.Logf
	if logf == nil {
		logf = func(string, ...interface{}) {}
	}
	return &GeminiProvider{
		apiKey: strings.TrimSpace(cfg.APIKey), baseURL: baseURL, modelName: modelName, thinkingBudget: budget,
		httpClient: &http.Client{Timeout: time.Duration(timeout) * time.Second}, logf: logf,
	}, nil
}

func (p *GeminiProvider) Name() string { return "gemini" }

func (p *GeminiProvider) Close() error { return nil }

// Wire types (subset of the v1beta REST API).
type geminiPart struct {
	Text         string              `json:"text,omitempty"`
	InlineData   *geminiBlob         `json:"inlineData,omitempty"`
	FunctionCall *geminiFunctionCall `json:"functionCall,omitempty"`
	Thought      bool                `json:"thought,omitempty"`
}

type geminiBlob struct {
	MIMEType string `json:"mimeType"`
	Data     string `json:"data"`
}

type geminiFunctionCall struct {
	Name string                 `json:"name"`
	Args map[string]interface{} `json:"args,omitempty"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiRequest struct {
	SystemInstruction *geminiContent           `json:"systemInstruction,omitempty"`
	Contents          []geminiContent          `json:"contents"`
	Tools             []map[string]interface{} `json:"tools,omitempty"`
	ToolConfig        map[string]interface{}   `json:"toolConfig,omitempty"`
	GenerationConfig  map[string]interface{}   `json:"generationConfig,omitempty"`
}

type geminiResponse struct {
	Candidates []struct {
		Content      *geminiContent `json:"content"`
		FinishReason string         `json:"finishReason"`
	} `json:"candidates"`
	PromptFeedback *struct {
		BlockReason string `json:"blockReason"`
	} `json:"promptFeedback"`
	UsageMetadata *struct {
		PromptTokenCount     int `json:"promptTokenCount"`
		CandidatesTokenCount int `json:"candidatesTokenCount"`
		ThoughtsTokenCount   int `json:"thoughtsTokenCount"`
		TotalTokenCount      int `json:"totalTokenCount"`
	} `json:"usageMetadata"`
}

// GeminiAPIError is a non-2xx answer from the Gemini API.
type GeminiAPIError struct {
	Code       int
	Status     string
	Message    string
	RetryDelay time.Duration
	// QuotaID names the exhausted quota on 429s, e.g.
	// GenerateRequestsPerDayPerProjectPerModel-FreeTier.
	QuotaID    string
	QuotaValue string
}

func (e *GeminiAPIError) Error() string {
	switch {
	case e.Code == http.StatusTooManyRequests:
		quota := ""
		if e.QuotaID != "" {
			quota = fmt.Sprintf(" [quota %s limit=%s retryIn=%s]", e.QuotaID, e.QuotaValue, e.RetryDelay)
		}
		return fmt.Sprintf("gemini rate limit or quota exceeded (429 %s)%s: %s", e.Status, quota, e.Message)
	case e.Code == http.StatusNotFound:
		return fmt.Sprintf("gemini model not found (404): %s", e.Message)
	case (e.Code == 400 || e.Code == 401 || e.Code == 403) && strings.Contains(strings.ToLower(e.Message), "api key"):
		return fmt.Sprintf("gemini rejected the API key (%d): %s", e.Code, e.Message)
	}
	return fmt.Sprintf("gemini API error %d %s: %s", e.Code, e.Status, e.Message)
}

// ErrLLMBlocked is returned when the provider blocks the prompt or the reply
// (safety, recitation or blocklist filters).
var ErrLLMBlocked = errors.New("LLM response blocked by the provider's safety filters")

// Complete sends one generateContent request. The system prompt goes in
// systemInstruction, the conversation as real user/model turns, and when
// tools are given the model must call one of them (mode ANY): in AUTO mode
// Gemini often answers in prose instead (e.g. asks a clarifying question),
// which breaks structured extraction.
func (p *GeminiProvider) Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error) {
	body, err := p.buildRequest(req)
	if err != nil {
		return nil, err
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("encode gemini request: %w", err)
	}
	url := fmt.Sprintf("%s/models/%s:generateContent", p.baseURL, p.modelName)

	var lastErr error
	for attempt := 1; attempt <= geminiMaxAttempts; attempt++ {
		start := time.Now()
		out, raw, err := p.send(ctx, url, payload)
		elapsed := time.Since(start)
		if err == nil {
			p.logf("🤖 [GEMINI] model=%s %dms finish=%s tools=%d calls=%d text=%d %s",
				p.modelName, elapsed.Milliseconds(), out.FinishReason, len(req.Tools), len(out.ToolCalls), len(out.Text), usageString(raw))
			return out, nil
		}
		lastErr = err
		p.logf("⚠️ [GEMINI] model=%s %dms attempt=%d error=%v", p.modelName, elapsed.Milliseconds(), attempt, err)
		delay, retry := geminiRetryDelay(err, attempt)
		if !retry || attempt == geminiMaxAttempts {
			break
		}
		if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) < delay+5*time.Second {
			break // not enough time left for another attempt
		}
		select {
		case <-ctx.Done():
			return nil, lastErr
		case <-time.After(delay):
		}
	}
	return nil, lastErr
}

func (p *GeminiProvider) send(ctx context.Context, url string, payload []byte) (*CompletionResponse, *geminiResponse, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-goog-api-key", p.apiKey) // header, never the URL
	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		if ctx.Err() != nil {
			return nil, nil, fmt.Errorf("gemini request timed out: %w", ctx.Err())
		}
		return nil, nil, fmt.Errorf("gemini request failed: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, nil, fmt.Errorf("read gemini response: %w", err)
	}
	if resp.StatusCode >= 300 {
		return nil, nil, parseGeminiError(resp.StatusCode, data)
	}
	var raw geminiResponse
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, nil, fmt.Errorf("parse gemini response: %w", err)
	}
	out, err := parseGeminiResponse(&raw)
	return out, &raw, err
}

func (p *GeminiProvider) buildRequest(req CompletionRequest) (*geminiRequest, error) {
	history, final, system, err := buildGeminiContents(req)
	if err != nil {
		return nil, err
	}
	body := &geminiRequest{Contents: append(history, geminiContent{Role: "user", Parts: final})}
	if system != "" {
		body.SystemInstruction = &geminiContent{Parts: []geminiPart{{Text: system}}}
	}
	temp := req.Temperature
	if temp <= 0 {
		temp = 0.1
	}
	gen := map[string]interface{}{"temperature": temp}
	if p.thinkingBudget != nil {
		gen["thinkingConfig"] = map[string]interface{}{"thinkingBudget": *p.thinkingBudget}
	}
	// With thinking on, thinking tokens count against maxOutputTokens and the
	// small budgets callers use (800-900) can end the reply empty.
	if req.MaxTokens > 0 && p.thinkingBudget != nil && *p.thinkingBudget == 0 {
		gen["maxOutputTokens"] = req.MaxTokens
	}
	body.GenerationConfig = gen
	if len(req.Tools) > 0 {
		decls := make([]map[string]interface{}, 0, len(req.Tools))
		names := make([]string, 0, len(req.Tools))
		for _, t := range req.Tools {
			decls = append(decls, map[string]interface{}{
				"name": t.Name, "description": t.Description, "parameters": geminiSchema(t.Parameters, true),
			})
			names = append(names, t.Name)
		}
		body.Tools = []map[string]interface{}{{"functionDeclarations": decls}}
		body.ToolConfig = map[string]interface{}{"functionCallingConfig": map[string]interface{}{"mode": "ANY", "allowedFunctionNames": names}}
	}
	return body, nil
}

// buildGeminiContents maps a provider-neutral request to Gemini turns:
// history (alternating user/model), the final user turn (prompt and media),
// and the system instruction (SystemPrompt plus any system-role messages).
func buildGeminiContents(req CompletionRequest) (history []geminiContent, final []geminiPart, system string, err error) {
	var systemParts []string
	if s := strings.TrimSpace(req.SystemPrompt); s != "" {
		systemParts = append(systemParts, s)
	}
	for _, msg := range req.Messages {
		text := strings.TrimSpace(msg.Content)
		if text == "" {
			continue
		}
		role := "user"
		switch strings.ToLower(msg.Role) {
		case RoleSystem:
			systemParts = append(systemParts, text)
			continue
		case RoleAssistant, "model":
			role = "model"
		}
		if n := len(history); n > 0 && history[n-1].Role == role {
			history[n-1].Parts = append(history[n-1].Parts, geminiPart{Text: text}) // roles must alternate
			continue
		}
		history = append(history, geminiContent{Role: role, Parts: []geminiPart{{Text: text}}})
	}

	if prompt := strings.TrimSpace(req.Prompt); prompt != "" {
		final = append(final, geminiPart{Text: prompt})
	}
	for _, doc := range req.Documents {
		mime := doc.MIMEType
		if mime == "" {
			mime = "application/pdf"
		}
		final = append(final, geminiPart{InlineData: &geminiBlob{MIMEType: mime, Data: base64.StdEncoding.EncodeToString(doc.Data)}})
	}
	for _, img := range req.Images {
		mime := img.MIMEType
		if mime == "" {
			mime = "image/jpeg"
		}
		final = append(final, geminiPart{InlineData: &geminiBlob{MIMEType: mime, Data: base64.StdEncoding.EncodeToString(img.Data)}})
	}

	// The conversation's last user turn and the prompt form one final turn.
	if n := len(history); n > 0 && history[n-1].Role == "user" {
		final = append(append([]geminiPart(nil), history[n-1].Parts...), final...)
		history = history[:n-1]
	}
	if len(final) == 0 {
		if len(history) == 0 {
			return nil, nil, "", fmt.Errorf("empty completion request")
		}
		final = []geminiPart{{Text: "Continue."}}
	}
	// A conversation must open with a user turn.
	if len(history) > 0 && history[0].Role == "model" {
		history = append([]geminiContent{{Role: "user", Parts: []geminiPart{{Text: "(conversation start)"}}}}, history...)
	}
	return history, final, strings.Join(systemParts, "\n\n"), nil
}

// geminiSchema converts the JSON Schema subset our tools use to Gemini's
// OpenAPI-style schema: upper-case types, enum (strings only, format
// "enum"), items (required for arrays), properties and required. Other
// keywords are dropped because Gemini rejects unknown ones.
func geminiSchema(schema map[string]interface{}, root bool) map[string]interface{} {
	out := map[string]interface{}{}
	t, _ := schema["type"].(string)
	if t == "" {
		t = "string"
		if root || schema["properties"] != nil {
			t = "object"
		}
	}
	t = strings.ToUpper(t)
	switch t {
	case "STRING", "NUMBER", "INTEGER", "BOOLEAN", "ARRAY", "OBJECT":
	default:
		t = "STRING"
	}
	out["type"] = t
	if d, ok := schema["description"].(string); ok && d != "" {
		out["description"] = d
	}
	if enum := stringList(schema["enum"]); len(enum) > 0 && t == "STRING" {
		out["enum"] = enum
		out["format"] = "enum"
	}
	if t == "OBJECT" {
		if props, ok := schema["properties"].(map[string]interface{}); ok && len(props) > 0 {
			conv := make(map[string]interface{}, len(props))
			for name, def := range props {
				if m, ok := def.(map[string]interface{}); ok {
					conv[name] = geminiSchema(m, false)
				}
			}
			out["properties"] = conv
			var req []string
			for _, r := range stringList(schema["required"]) {
				if _, ok := conv[r]; ok {
					req = append(req, r) // Gemini rejects required names that are not properties
				}
			}
			if len(req) > 0 {
				out["required"] = req
			}
		}
	}
	if t == "ARRAY" {
		items, _ := schema["items"].(map[string]interface{})
		if items == nil {
			items = map[string]interface{}{"type": "string"}
		}
		out["items"] = geminiSchema(items, false)
	}
	return out
}

func stringList(v interface{}) []string {
	switch xs := v.(type) {
	case []string:
		var out []string
		for _, s := range xs {
			if strings.TrimSpace(s) != "" {
				out = append(out, s)
			}
		}
		return out
	case []interface{}:
		var out []string
		for _, x := range xs {
			if s, ok := x.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

var geminiBlockedFinish = map[string]bool{
	"SAFETY": true, "RECITATION": true, "BLOCKLIST": true, "PROHIBITED_CONTENT": true, "SPII": true, "IMAGE_SAFETY": true,
}

func parseGeminiResponse(resp *geminiResponse) (*CompletionResponse, error) {
	out := &CompletionResponse{}
	if resp == nil {
		out.FinishReason = "no_candidates"
		return out, nil
	}
	if resp.PromptFeedback != nil && resp.PromptFeedback.BlockReason != "" && resp.PromptFeedback.BlockReason != "BLOCK_REASON_UNSPECIFIED" {
		return nil, fmt.Errorf("%w: prompt blocked (%s)", ErrLLMBlocked, resp.PromptFeedback.BlockReason)
	}
	if len(resp.Candidates) == 0 {
		out.FinishReason = "no_candidates"
		return out, nil
	}
	c := resp.Candidates[0]
	out.FinishReason = strings.ToLower(c.FinishReason)
	if geminiBlockedFinish[c.FinishReason] {
		return nil, fmt.Errorf("%w: reply blocked (%s)", ErrLLMBlocked, c.FinishReason)
	}
	if c.Content == nil {
		return out, nil // e.g. MAX_TOKENS or MALFORMED_FUNCTION_CALL: the caller's fallback applies
	}
	var texts []string
	for _, part := range c.Content.Parts {
		switch {
		case part.Thought:
			continue // thought summaries are never shown to customers
		case part.FunctionCall != nil:
			args := part.FunctionCall.Args
			if args == nil {
				args = map[string]interface{}{}
			}
			out.ToolCalls = append(out.ToolCalls, ToolCall{Name: part.FunctionCall.Name, Arguments: args})
		case part.Text != "":
			texts = append(texts, part.Text)
		}
	}
	out.Text = strings.TrimSpace(strings.Join(texts, ""))
	return out, nil
}

func parseGeminiError(status int, body []byte) error {
	var env struct {
		Error struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
			Status  string `json:"status"`
			Details []struct {
				Type       string `json:"@type"`
				RetryDelay string `json:"retryDelay"`
				Violations []struct {
					QuotaID    string `json:"quotaId"`
					QuotaValue string `json:"quotaValue"`
				} `json:"violations"`
			} `json:"details"`
		} `json:"error"`
	}
	e := &GeminiAPIError{Code: status}
	if json.Unmarshal(body, &env) == nil && env.Error.Message != "" {
		e.Message, e.Status = env.Error.Message, env.Error.Status
		for _, d := range env.Error.Details {
			if strings.HasSuffix(d.Type, "google.rpc.RetryInfo") {
				if dur, err := time.ParseDuration(d.RetryDelay); err == nil {
					e.RetryDelay = dur
				}
			}
			if strings.HasSuffix(d.Type, "google.rpc.QuotaFailure") && len(d.Violations) > 0 {
				e.QuotaID, e.QuotaValue = d.Violations[0].QuotaID, d.Violations[0].QuotaValue
			}
		}
	} else {
		e.Message = strings.TrimSpace(string(body))
	}
	if i := strings.Index(e.Message, " For more information"); i > 0 {
		e.Message = e.Message[:i] // drop the boilerplate links
	}
	if len(e.Message) > 400 {
		e.Message = e.Message[:400] + "…"
	}
	return e
}

// geminiRetryDelay reports whether err is worth retrying and how long to
// wait: 429 honours the server's RetryInfo (a long cooldown fails fast),
// 5xx backs off briefly.
func geminiRetryDelay(err error, attempt int) (time.Duration, bool) {
	var apiErr *GeminiAPIError
	if !errors.As(err, &apiErr) {
		return 0, false
	}
	switch {
	case apiErr.Code == http.StatusTooManyRequests:
		if strings.Contains(apiErr.QuotaID, "PerDay") {
			return 0, false // a daily quota does not come back within this reply
		}
		delay := time.Duration(attempt) * 3 * time.Second
		if apiErr.RetryDelay > 0 {
			delay = apiErr.RetryDelay
		}
		if delay > geminiMaxRetryDelay {
			return 0, false
		}
		return delay, true
	case apiErr.Code >= 500:
		return time.Duration(attempt) * time.Second, true
	}
	return 0, false
}

func usageString(resp *geminiResponse) string {
	if resp == nil || resp.UsageMetadata == nil {
		return ""
	}
	u := resp.UsageMetadata
	return fmt.Sprintf("tokens(prompt=%d out=%d thinking=%d)", u.PromptTokenCount, u.CandidatesTokenCount, u.ThoughtsTokenCount)
}

// ParseToolCallArgs marshals tool call arguments to a target struct.
func ParseToolCallArgs(args map[string]interface{}, target interface{}) error {
	raw, err := json.Marshal(args)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, target)
}
