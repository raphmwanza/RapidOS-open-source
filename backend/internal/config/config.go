package config

import (
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	APIPort          string
	DatabaseURL      string
	RedisURL         string
	JWTAccessSecret  string
	JWTRefreshSecret string
	JWTAccessTTL     string
	JWTRefreshTTL    string
	BcryptCost       int
	RateLimitReqs    int
	RateLimitWindow  int
	CORSOrigins      []string
	// WhatsApp Configuration
	WhatsAppToken         string
	WhatsAppVerifyToken   string
	WhatsAppPhoneNumberID string
	WhatsAppWebhookURL    string
	WhatsAppAppSecret     string // For webhook signature verification
	// Internal API Key for service-to-service communication
	InternalAPIKey string
	// Google API Configuration (legacy — prefer LLM_* vars)
	GoogleAPIKey  string
	GeminiModel   string
	GeminiTimeout int // seconds
	// Provider-agnostic LLM configuration
	LLMProvider string
	LLMAPIKey   string
	LLMBaseURL  string
	LLMModel    string
	LLMTimeout  int
	// Frontend base URL for calling Next.js APIs (e.g., http://host.docker.internal:3000)
	FrontendBaseURL string
	// WhatsAppGraphAPIBase is the Meta Graph API base (messages and media).
	// Overridable for tests and API version upgrades.
	WhatsAppGraphAPIBase string
}

// DefaultWhatsAppGraphAPIBase is the Graph API version the bot is written against.
const DefaultWhatsAppGraphAPIBase = "https://graph.facebook.com/v18.0"

// GraphAPIBase returns the configured Graph API base without a trailing slash.
func (c *Config) GraphAPIBase() string {
	if c == nil || strings.TrimSpace(c.WhatsAppGraphAPIBase) == "" {
		return DefaultWhatsAppGraphAPIBase
	}
	return strings.TrimRight(strings.TrimSpace(c.WhatsAppGraphAPIBase), "/")
}

// LLMSettings resolves LLM configuration with backward-compatible fallbacks.
func (c *Config) LLMSettings() LLMSettings {
	provider := strings.ToLower(strings.TrimSpace(c.LLMProvider))
	apiKey := c.LLMAPIKey
	model := c.LLMModel
	timeout := c.LLMTimeout

	if apiKey == "" {
		apiKey = c.GoogleAPIKey
	}
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_API_KEY")
	}
	if provider == "" {
		if c.GoogleAPIKey != "" || strings.HasPrefix(strings.ToLower(model), "gemini") {
			provider = "gemini"
		} else if apiKey != "" {
			provider = "openai"
		} else {
			provider = "gemini"
		}
	}
	if model == "" {
		model = c.GeminiModel
	}
	if model == "" {
		model = "gemini-2.5-flash"
	}
	if timeout <= 0 {
		// Local models (Ollama) can take a while to load and answer; 90s is a
		// safe default. Override with LLM_TIMEOUT (seconds).
		timeout = 90
	}

	return LLMSettings{
		Provider: provider,
		APIKey:   apiKey,
		BaseURL:  c.LLMBaseURL,
		Model:    model,
		Timeout:  timeout,
	}
}

type LLMSettings struct {
	Provider string
	APIKey   string
	BaseURL  string
	Model    string
	Timeout  int
}

// LLMConfig is an alias for LLMSettings (used by ai package).
func (c *Config) LLMConfig() LLMSettings { return c.LLMSettings() }

func Load() *Config {
	_ = godotenv.Load()
	cfg := &Config{
		APIPort:          getEnv("API_PORT", "8080"),
		DatabaseURL:      getEnv("DATABASE_URL", "postgres://localhost:5432/rapidos?sslmode=disable"),
		RedisURL:         getEnv("REDIS_URL", "redis://localhost:6379/0"),
		JWTAccessSecret:  mustEnv("JWT_ACCESS_SECRET"),
		JWTRefreshSecret: mustEnv("JWT_REFRESH_SECRET"),
		JWTAccessTTL:     getEnv("JWT_ACCESS_EXPIRES", "15m"),
		JWTRefreshTTL:    getEnv("JWT_REFRESH_EXPIRES", "168h"),
		BcryptCost:       getEnvInt("BCRYPT_COST", 12),
		RateLimitReqs:    getEnvInt("RATE_LIMIT_REQUESTS", 100),
		RateLimitWindow:  getEnvInt("RATE_LIMIT_WINDOW", 60),
		// CORS_ALLOWED_ORIGINS: comma-separated browser origins allowed to call the API
		// (replaces the old ALLOWED_DOMAINS, which also drove the removed self-registration).
		CORSOrigins: splitAndTrim(getEnv("CORS_ALLOWED_ORIGINS", "")),
		// WhatsApp Configuration
		WhatsAppToken:         getEnv("WHATSAPP_ACCESS_TOKEN", ""),
		WhatsAppVerifyToken:   getEnv("WHATSAPP_VERIFY_TOKEN", ""),
		WhatsAppPhoneNumberID: getEnv("WHATSAPP_PHONE_NUMBER_ID", ""),
		WhatsAppWebhookURL:    getEnv("WHATSAPP_WEBHOOK_URL", ""),
		WhatsAppAppSecret:     getEnv("WHATSAPP_APP_SECRET", ""), // For webhook signature verification
		// Internal API Key for service-to-service communication
		InternalAPIKey: getEnv("INTERNAL_API_KEY", ""),
		// Google API Configuration (legacy)
		GoogleAPIKey:  getEnv("GOOGLE_API_KEY", ""),
		GeminiModel:   getEnv("GEMINI_MODEL", "gemini-2.5-flash"),
		GeminiTimeout: getEnvInt("GEMINI_TIMEOUT", 30),
		// Provider-agnostic LLM
		LLMProvider:          getEnv("LLM_PROVIDER", ""),
		LLMAPIKey:            firstNonEmpty(getEnv("LLM_API_KEY", ""), getEnv("OPENAI_API_KEY", "")),
		LLMBaseURL:           getEnv("LLM_BASE_URL", ""),
		LLMModel:             getEnv("LLM_MODEL", ""),
		LLMTimeout:           getEnvInt("LLM_TIMEOUT", 0),
		FrontendBaseURL:      getEnv("FRONTEND_BASE_URL", "http://host.docker.internal:3000"),
		WhatsAppGraphAPIBase: getEnv("WHATSAPP_GRAPH_API_BASE", DefaultWhatsAppGraphAPIBase),
	}
	return cfg
}

func splitAndTrim(v string) []string {
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		t := strings.TrimSpace(p)
		if t != "" {
			out = append(out, t)
		}
	}
	return out
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("missing required env %s", key)
	}
	return v
}
func getEnvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		var i int
		_, err := fmt.Sscanf(v, "%d", &i)
		if err == nil {
			return i
		}
	}
	return def
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
