package ai

import (
	"fmt"
	"strings"

	"rapidos/internal/config"
	"rapidos/internal/logger"
)

// NewProvider creates an LLM provider from application configuration.
// Supports: gemini, openai, deepseek, qwen (openai-compatible).
func NewProvider(cfg *config.Config, log *logger.Logger) (LLMProvider, error) {
	return NewProviderForSettings(cfg.LLMConfig(), log)
}

// NewProviderForSettings creates a provider from a tenant's resolved settings.
// Keeping this separate from Config is important: WhatsApp is multi-tenant and
// must not silently use the process-level provider for another company.
func NewProviderForSettings(llm config.LLMSettings, log *logger.Logger) (LLMProvider, error) {
	provider := strings.ToLower(strings.TrimSpace(llm.Provider))
	if llm.APIKey == "" {
		if !IsSelfHostedProvider(provider) {
			return nil, fmt.Errorf("LLM API key not configured (set it in Settings → Integrations, or LLM_API_KEY / GOOGLE_API_KEY)")
		}
		// Local OpenAI-compatible servers (Ollama, vLLM, LM Studio…) usually
		// ignore the bearer token but some clients require a non-empty one.
		llm.APIKey = "not-needed"
	}
	log.Infof("🤖 Initializing LLM provider=%s model=%s", provider, llm.Model)

	switch provider {
	case "gemini", "":
		return NewGeminiProvider(GeminiConfig{
			APIKey:  llm.APIKey,
			Model:   llm.Model,
			Timeout: llm.Timeout,
			Logf:    log.Infof,
		})
	case "openai", "deepseek", "qwen", "openai-compatible", "openai_compatible", "compatible":
		baseURL := llm.BaseURL
		if (provider == "openai-compatible" || provider == "openai_compatible" || provider == "compatible") && strings.TrimSpace(baseURL) == "" {
			return nil, fmt.Errorf("LLM base URL is required for provider %q", provider)
		}
		if baseURL == "" {
			baseURL = defaultBaseURL(provider)
		}
		model := llm.Model
		if model == "" {
			model = defaultModel(provider)
		}
		return NewOpenAICompatProvider(OpenAICompatConfig{
			APIKey:  llm.APIKey,
			BaseURL: baseURL,
			Model:   model,
			Timeout: llm.Timeout,
		})
	default:
		return nil, fmt.Errorf("unsupported LLM provider %q (use gemini, openai, deepseek, qwen, or openai-compatible)", provider)
	}
}

// IsSelfHostedProvider reports whether the provider talks to a user-supplied
// OpenAI-compatible endpoint, where an API key is optional.
func IsSelfHostedProvider(provider string) bool {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "openai-compatible", "openai_compatible", "compatible":
		return true
	}
	return false
}

func defaultBaseURL(provider string) string {
	switch provider {
	case "deepseek":
		return "https://api.deepseek.com/v1"
	case "qwen":
		return "https://dashscope.aliyuncs.com/compatible-mode/v1"
	default:
		return "https://api.openai.com/v1"
	}
}

func defaultModel(provider string) string {
	switch provider {
	case "deepseek":
		return "deepseek-chat"
	case "qwen":
		return "qwen-plus"
	default:
		return "gpt-4o-mini"
	}
}
