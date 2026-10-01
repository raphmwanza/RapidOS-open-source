package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type OpenAICompatProvider struct {
	apiKey     string
	baseURL    string
	model      string
	httpClient *http.Client
}

type OpenAICompatConfig struct {
	APIKey  string
	BaseURL string
	Model   string
	Timeout int
}

func NewOpenAICompatProvider(cfg OpenAICompatConfig) (*OpenAICompatProvider, error) {
	if cfg.APIKey == "" {
		return nil, fmt.Errorf("LLM API key is required")
	}
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	model := cfg.Model
	if model == "" {
		model = "gpt-4o-mini"
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 30
	}

	return &OpenAICompatProvider{
		apiKey:  cfg.APIKey,
		baseURL: baseURL,
		model:   model,
		httpClient: &http.Client{
			Timeout: time.Duration(timeout) * time.Second,
		},
	}, nil
}

func (p *OpenAICompatProvider) Name() string { return "openai_compat" }

func (p *OpenAICompatProvider) Close() error { return nil }

func (p *OpenAICompatProvider) Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error) {
	body, err := p.buildRequestBody(req)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)

	// Providers commonly throttle or briefly return gateway errors. Retry only
	// these transient failures and keep streaming explicitly disabled.
	for attempt := 0; attempt < 3; attempt++ {
		resp, err := p.httpClient.Do(httpReq.Clone(ctx))
		if err != nil {
			if attempt == 2 {
				return nil, fmt.Errorf("LLM request failed: %w", err)
			}
		} else {
			respBody, readErr := io.ReadAll(resp.Body)
			resp.Body.Close()
			if readErr != nil {
				return nil, fmt.Errorf("read LLM response: %w", readErr)
			}
			if resp.StatusCode < 400 {
				return parseOpenAIResponse(respBody)
			}
			if resp.StatusCode != http.StatusTooManyRequests && resp.StatusCode < 500 {
				return nil, fmt.Errorf("LLM API error %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
			}
			if attempt == 2 {
				return nil, fmt.Errorf("LLM API unavailable after 3 attempts (status %d): %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
			}
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Duration(100*(1<<attempt)) * time.Millisecond):
		}
	}
	return nil, fmt.Errorf("LLM request failed")
}

func (p *OpenAICompatProvider) buildRequestBody(req CompletionRequest) ([]byte, error) {
	messages := make([]map[string]interface{}, 0)

	if req.SystemPrompt != "" {
		messages = append(messages, map[string]interface{}{
			"role":    RoleSystem,
			"content": req.SystemPrompt,
		})
	}

	for _, msg := range req.Messages {
		messages = append(messages, map[string]interface{}{
			"role":    msg.Role,
			"content": msg.Content,
		})
	}

	// Build user content with prompt, documents, and images
	userContent := buildOpenAIUserContent(req)
	if userContent != nil {
		messages = append(messages, map[string]interface{}{
			"role":    RoleUser,
			"content": userContent,
		})
	}

	payload := map[string]interface{}{
		"model":       p.model,
		"messages":    messages,
		"temperature": float64(req.Temperature),
	}
	payload["stream"] = false
	if req.Temperature == 0 {
		payload["temperature"] = 0.1
	}
	if req.MaxTokens > 0 {
		payload["max_tokens"] = req.MaxTokens
	}

	if len(req.Tools) > 0 {
		tools := make([]map[string]interface{}, 0, len(req.Tools))
		for _, t := range req.Tools {
			tools = append(tools, map[string]interface{}{
				"type": "function",
				"function": map[string]interface{}{
					"name":        t.Name,
					"description": t.Description,
					"parameters":  t.Parameters,
				},
			})
		}
		payload["tools"] = tools
		payload["tool_choice"] = "auto"
	}

	return json.Marshal(payload)
}

func buildOpenAIUserContent(req CompletionRequest) interface{} {
	hasMedia := len(req.Images) > 0 || len(req.Documents) > 0
	if req.Prompt == "" && !hasMedia {
		return nil
	}

	if !hasMedia {
		return req.Prompt
	}

	parts := make([]map[string]interface{}, 0)
	if req.Prompt != "" {
		parts = append(parts, map[string]interface{}{
			"type": "text",
			"text": req.Prompt,
		})
	}

	for _, doc := range req.Documents {
		mime := doc.MIMEType
		if mime == "" {
			mime = "application/pdf"
		}
		encoded := base64.StdEncoding.EncodeToString(doc.Data)
		parts = append(parts, map[string]interface{}{
			"type": "image_url",
			"image_url": map[string]string{
				"url": fmt.Sprintf("data:%s;base64,%s", mime, encoded),
			},
		})
	}

	for _, img := range req.Images {
		mime := img.MIMEType
		if mime == "" {
			mime = "image/jpeg"
		}
		encoded := base64.StdEncoding.EncodeToString(img.Data)
		parts = append(parts, map[string]interface{}{
			"type": "image_url",
			"image_url": map[string]string{
				"url": fmt.Sprintf("data:%s;base64,%s", mime, encoded),
			},
		})
	}

	return parts
}

func parseOpenAIResponse(body []byte) (*CompletionResponse, error) {
	var raw struct {
		Choices []struct {
			Message struct {
				Content   string `json:"content"`
				ToolCalls []struct {
					ID       string `json:"id"`
					Type     string `json:"type"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("parse LLM response: %w", err)
	}

	out := &CompletionResponse{}
	if len(raw.Choices) == 0 {
		return out, nil
	}

	msg := raw.Choices[0].Message
	out.Text = strings.TrimSpace(msg.Content)

	for _, tc := range msg.ToolCalls {
		var args map[string]interface{}
		if tc.Function.Arguments != "" && json.Unmarshal([]byte(tc.Function.Arguments), &args) != nil {
			// Preserve malformed arguments in Text so the provider-neutral repair
			// path can ask the model once for valid JSON.
			out.Text = strings.TrimSpace(out.Text + "\n" + tc.Function.Arguments)
		}
		if args == nil {
			args = map[string]interface{}{}
		}
		out.ToolCalls = append(out.ToolCalls, ToolCall{
			Name:      tc.Function.Name,
			Arguments: args,
		})
	}

	return out, nil
}
