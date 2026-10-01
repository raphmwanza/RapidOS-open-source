package service

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"

	"rapidos/internal/ai"
	"rapidos/internal/config"
	"rapidos/internal/logger"
)

// ErrNoLLMConfigured is returned when neither the company nor the global
// configuration defines a usable LLM.
var ErrNoLLMConfigured = errors.New("no LLM configured for this company (set it in Settings → Integrations)")

// LLMSettingsSource returns the LLM settings that apply to a company.
type LLMSettingsSource func(companyID string) (config.LLMSettings, error)

// LLMProviderFactory builds a provider from resolved settings.
type LLMProviderFactory func(settings config.LLMSettings) (ai.LLMProvider, error)

// CompanyLLMClients caches one LLM client per company. The company's settings
// are read on every request; the cached client is reused while its settings
// fingerprint (provider, model, base URL, key hash, timeout) is unchanged and
// rebuilt as soon as the settings change, so saving new settings in the
// dashboard takes effect on the next message without a restart.
type CompanyLLMClients struct {
	source  LLMSettingsSource
	factory LLMProviderFactory
	log     *logger.Logger

	mu    sync.Mutex
	cache map[string]cachedLLMClient
}

type cachedLLMClient struct {
	fingerprint string
	provider    ai.LLMProvider
}

// NewCompanyLLMClients creates the per-company client cache.
func NewCompanyLLMClients(source LLMSettingsSource, factory LLMProviderFactory, log *logger.Logger) *CompanyLLMClients {
	return &CompanyLLMClients{source: source, factory: factory, log: log, cache: map[string]cachedLLMClient{}}
}

func llmFingerprint(s config.LLMSettings) string {
	sum := sha256.Sum256([]byte(s.APIKey))
	return strings.Join([]string{strings.ToLower(strings.TrimSpace(s.Provider)), strings.TrimSpace(s.Model), strings.TrimSpace(s.BaseURL), hex.EncodeToString(sum[:8]), fmt.Sprint(s.Timeout)}, "|")
}

// Provider returns the LLM client of a company.
func (c *CompanyLLMClients) Provider(companyID string) (ai.LLMProvider, error) {
	if c == nil || c.source == nil || c.factory == nil {
		return nil, ErrNoLLMConfigured
	}
	if strings.TrimSpace(companyID) == "" {
		return nil, fmt.Errorf("company id is required to select the LLM")
	}
	settings, err := c.source(companyID)
	if err != nil {
		return nil, err
	}
	fp := llmFingerprint(settings)

	c.mu.Lock()
	defer c.mu.Unlock()
	if cached, ok := c.cache[companyID]; ok {
		if cached.fingerprint == fp {
			return cached.provider, nil
		}
		// Settings changed: drop the stale client. It is not closed because a
		// request started just before the change may still be using it.
		delete(c.cache, companyID)
	}
	p, err := c.factory(settings)
	if err != nil {
		return nil, err
	}
	if c.log != nil {
		c.log.Infof("🤖 [LLM] Company %s uses provider=%s model=%s", companyID, settings.Provider, settings.Model)
	}
	c.cache[companyID] = cachedLLMClient{fingerprint: fp, provider: p}
	return p, nil
}

// Invalidate drops the cached client of a company (or all when companyID is empty).
func (c *CompanyLLMClients) Invalidate(companyID string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for id := range c.cache {
		if companyID == "" || id == companyID {
			delete(c.cache, id)
		}
	}
}
