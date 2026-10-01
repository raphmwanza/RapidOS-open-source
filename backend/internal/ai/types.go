package ai

import "context"

// Message roles align with common chat-completion APIs.
const (
	RoleSystem    = "system"
	RoleUser      = "user"
	RoleAssistant = "assistant"
)

// ChatMessage is a provider-neutral conversation turn.
type ChatMessage struct {
	Role    string
	Content string
}

// ImageInput is an image attachment for vision models.
type ImageInput struct {
	MIMEType string
	Data     []byte
}

// DocumentInput is a binary document attachment (PDF, etc.).
type DocumentInput struct {
	MIMEType string
	Data     []byte
	Name     string
}

// ToolDefinition describes a callable function for structured extraction.
type ToolDefinition struct {
	Name        string
	Description string
	Parameters  map[string]interface{} // JSON Schema object
}

// ToolCall is a normalized function call from any provider.
type ToolCall struct {
	Name      string
	Arguments map[string]interface{}
}

// CompletionRequest is the unified input for all LLM providers.
type CompletionRequest struct {
	SystemPrompt string
	Messages     []ChatMessage
	Prompt       string // single-turn shortcut (appended as user message)
	Tools        []ToolDefinition
	Temperature  float32
	MaxTokens    int
	Images       []ImageInput
	Documents    []DocumentInput
}

// CompletionResponse is the unified output from all LLM providers.
type CompletionResponse struct {
	Text      string
	ToolCalls []ToolCall
	// FinishReason is the provider's stop reason when known (e.g. "stop",
	// "max_tokens", "safety"). Diagnostic only.
	FinishReason string
}

// LLMProvider abstracts text, vision, and tool-calling across vendors.
type LLMProvider interface {
	Name() string
	Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error)
	Close() error
}
