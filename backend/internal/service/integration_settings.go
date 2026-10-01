package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"gorm.io/gorm"
	"os"
	"rapidos/internal/ai"
	"rapidos/internal/config"
	"rapidos/internal/models"
	"strings"
)

// CompanyRuntimeConfig resolves database credentials per tenant. Environment
// configuration remains a deliberate fallback for a single-tenant deployment.
type CompanyRuntimeConfig struct {
	WhatsAppToken, VerifyToken, AppSecret, PhoneNumberID, LLMProvider, LLMAPIKey, LLMModel, LLMBaseURL string
	// CompanyLLM is true when the LLM fields come from the company's own
	// integration settings (never mixed with the global LLM configuration).
	CompanyLLM bool
}
type IntegrationSettingsStore struct {
	db       *gorm.DB
	fallback *config.Config
}

// CompanyForPhoneNumberID resolves the tenant before a webhook is trusted. The
// phone number id is supplied by Meta in webhook metadata and is unique per
// WhatsApp Business phone number.
func (s *IntegrationSettingsStore) CompanyForPhoneNumberID(phoneNumberID string) (string, CompanyRuntimeConfig, error) {
	var row models.IntegrationSettings
	err := s.db.Where("whatsapp_phone_number_id = ?", phoneNumberID).First(&row).Error
	if err == nil {
		cfg, cfgErr := s.ForCompany(row.CompanyID)
		return row.CompanyID, cfg, cfgErr
	}
	if err != gorm.ErrRecordNotFound {
		return "", CompanyRuntimeConfig{}, err
	}
	// Environment credentials are only safe as a fallback when this really is a
	// single-tenant installation.
	var companies []models.Company
	if countErr := s.db.Where("is_active = ?", true).Find(&companies).Error; countErr != nil {
		return "", CompanyRuntimeConfig{}, countErr
	}
	if len(companies) == 1 && s.fallback.WhatsAppPhoneNumberID == phoneNumberID {
		cfg, cfgErr := s.ForCompany(companies[0].ID)
		return companies[0].ID, cfg, cfgErr
	}
	return "", CompanyRuntimeConfig{}, gorm.ErrRecordNotFound
}

// CompanyForVerifyToken supports Meta's GET challenge, which does not include
// phone_number_id. Tokens are decrypted only long enough to compare them.
func (s *IntegrationSettingsStore) CompanyForVerifyToken(token string) (string, CompanyRuntimeConfig, error) {
	var rows []models.IntegrationSettings
	if err := s.db.Find(&rows).Error; err != nil {
		return "", CompanyRuntimeConfig{}, err
	}
	for _, row := range rows {
		// Only tenant-specific tokens are matched here; the environment token is
		// handled below and only for single-tenant installs. A row that cannot
		// be decrypted is skipped so one bad tenant cannot break verification
		// for every other tenant.
		if row.WebhookVerifyTokenCipher == nil || *row.WebhookVerifyTokenCipher == "" {
			continue
		}
		stored, err := decryptIntegrationSecret(*row.WebhookVerifyTokenCipher)
		if err != nil || stored == "" || subtle.ConstantTimeCompare([]byte(stored), []byte(token)) != 1 {
			continue
		}
		cfg, err := s.ForCompany(row.CompanyID)
		if err != nil {
			return "", CompanyRuntimeConfig{}, err
		}
		return row.CompanyID, cfg, nil
	}
	var companies []models.Company
	if err := s.db.Where("is_active = ?", true).Find(&companies).Error; err != nil {
		return "", CompanyRuntimeConfig{}, err
	}
	if len(companies) == 1 && s.fallback.WhatsAppVerifyToken != "" && subtle.ConstantTimeCompare([]byte(s.fallback.WhatsAppVerifyToken), []byte(token)) == 1 {
		cfg, err := s.ForCompany(companies[0].ID)
		return companies[0].ID, cfg, err
	}
	return "", CompanyRuntimeConfig{}, gorm.ErrRecordNotFound
}

func NewIntegrationSettingsStore(db *gorm.DB, fallback *config.Config) *IntegrationSettingsStore {
	return &IntegrationSettingsStore{db, fallback}
}
func (s *IntegrationSettingsStore) ForCompany(companyID string) (CompanyRuntimeConfig, error) {
	out := CompanyRuntimeConfig{WhatsAppToken: s.fallback.WhatsAppToken, VerifyToken: s.fallback.WhatsAppVerifyToken, AppSecret: s.fallback.WhatsAppAppSecret, PhoneNumberID: s.fallback.WhatsAppPhoneNumberID}
	llm := s.fallback.LLMSettings()
	out.LLMProvider, out.LLMAPIKey, out.LLMModel, out.LLMBaseURL = llm.Provider, llm.APIKey, llm.Model, llm.BaseURL
	var row models.IntegrationSettings
	if err := s.db.Where("company_id = ?", companyID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return out, nil
		}
		return out, err
	}
	decrypt := func(v *string) (string, error) {
		if v == nil || *v == "" {
			return "", nil
		}
		return decryptIntegrationSecret(*v)
	}
	var err error
	if out.WhatsAppToken, err = decrypt(row.WhatsAppAccessTokenCipher); err != nil {
		return out, err
	}
	if out.WhatsAppToken == "" {
		out.WhatsAppToken = s.fallback.WhatsAppToken
	}
	if out.VerifyToken, err = decrypt(row.WebhookVerifyTokenCipher); err != nil {
		return out, err
	}
	if out.VerifyToken == "" {
		out.VerifyToken = s.fallback.WhatsAppVerifyToken
	}
	if out.AppSecret, err = decrypt(row.MetaAppSecretCipher); err != nil {
		return out, err
	}
	if out.AppSecret == "" {
		out.AppSecret = s.fallback.WhatsAppAppSecret
	}
	if row.WhatsAppPhoneNumberID != nil {
		out.PhoneNumberID = *row.WhatsAppPhoneNumberID
	}
	// LLM: the company's own configuration wins as a whole. The global
	// (environment) LLM is only used when the company configured none, so a
	// tenant never runs on another provider's key or default model.
	companyKey, err := decrypt(row.LLMAPIKeyCipher)
	if err != nil {
		return out, err
	}
	if hasCompanyLLM(row.LLMProvider, row.LLMModel, row.LLMBaseURL, companyKey) {
		out.CompanyLLM = true
		out.LLMProvider, out.LLMModel, out.LLMBaseURL, out.LLMAPIKey = strPtrValue(row.LLMProvider), strPtrValue(row.LLMModel), strPtrValue(row.LLMBaseURL), companyKey
		if strings.TrimSpace(out.LLMProvider) == "" {
			if out.LLMBaseURL != "" {
				out.LLMProvider = "openai-compatible"
			} else {
				out.LLMProvider = llm.Provider
			}
		}
	}
	return out, nil
}

func hasCompanyLLM(provider, model, baseURL *string, key string) bool {
	return strings.TrimSpace(strPtrValue(provider)) != "" || strings.TrimSpace(strPtrValue(model)) != "" || strings.TrimSpace(strPtrValue(baseURL)) != "" || key != ""
}

func strPtrValue(v *string) string {
	if v == nil {
		return ""
	}
	return strings.TrimSpace(*v)
}

// LLMSettingsForCompany is the single DB-backed source of provider selection:
// the company's own LLM settings, or the global configuration when the company
// has none. It returns an error when neither is usable.
func (d *DatabaseService) LLMSettingsForCompany(companyID string) (config.LLMSettings, error) {
	if d == nil || d.db == nil {
		return config.LLMSettings{}, fmt.Errorf("database not available")
	}
	runtime, err := NewIntegrationSettingsStore(d.db, d.cfg).ForCompany(companyID)
	if err != nil {
		return config.LLMSettings{}, err
	}
	return resolveCompanyLLMSettings(runtime, d.cfg.LLMSettings())
}

// resolveCompanyLLMSettings turns a tenant runtime config into provider
// settings. A company-configured model is used as-is (an empty model means the
// provider default, never the global model).
func resolveCompanyLLMSettings(runtime CompanyRuntimeConfig, global config.LLMSettings) (config.LLMSettings, error) {
	if runtime.CompanyLLM {
		return config.LLMSettings{Provider: runtime.LLMProvider, APIKey: runtime.LLMAPIKey, Model: runtime.LLMModel, BaseURL: runtime.LLMBaseURL, Timeout: global.Timeout}, nil
	}
	if global.APIKey == "" && !ai.IsSelfHostedProvider(global.Provider) {
		return config.LLMSettings{}, ErrNoLLMConfigured
	}
	return global, nil
}
func decryptIntegrationSecret(value string) (string, error) {
	parts := strings.Split(value, ".")
	if len(parts) != 4 || parts[0] != "v1" {
		return "", fmt.Errorf("invalid encrypted integration setting")
	}
	raw, err := integrationKey()
	if err != nil {
		return "", err
	}
	iv, _ := base64.StdEncoding.DecodeString(parts[1])
	tag, _ := base64.StdEncoding.DecodeString(parts[2])
	payload, _ := base64.StdEncoding.DecodeString(parts[3])
	block, err := aes.NewCipher(raw)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	plaintext, err := gcm.Open(nil, iv, append(payload, tag...), nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

// integrationKey mirrors lib/encryption.ts: a base64 32-byte key, or a
// 64-character hexadecimal key.
func integrationKey() ([]byte, error) {
	value := os.Getenv("ENCRYPTION_KEY")
	if raw, err := base64.StdEncoding.DecodeString(value); err == nil && len(raw) == 32 {
		return raw, nil
	}
	if raw, err := hex.DecodeString(value); err == nil && len(raw) == 32 {
		return raw, nil
	}
	return nil, fmt.Errorf("ENCRYPTION_KEY must encode exactly 32 bytes (base64 or hex)")
}
