package service

import (
	"embed"
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
)

// Canned WhatsApp texts sent without the LLM, in the company's bot language.
// Each language is one JSON file in botlocales/ (flat key -> text). English is
// the reference: a key missing from another language falls back to English.
const (
	msgMediaError      = "media_error"
	msgAudio           = "audio"
	msgAIUnavailable   = "ai_unavailable"
	msgPhotoReceived   = "photo_received"
	msgPhotoEscalation = "photo_escalation"
	msgTechError       = "tech_error"
	msgEscalated       = "escalated"
)

// BotFallbackLanguage is used for any key a locale file does not define.
const BotFallbackLanguage = "en"

//go:embed botlocales/*.json
var botLocaleFiles embed.FS

var botLocales = mustLoadBotLocales()

func mustLoadBotLocales() map[string]map[string]string {
	entries, err := botLocaleFiles.ReadDir("botlocales")
	if err != nil {
		panic(fmt.Sprintf("bot locales: %v", err))
	}
	out := map[string]map[string]string{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		raw, err := botLocaleFiles.ReadFile(path.Join("botlocales", e.Name()))
		if err != nil {
			panic(fmt.Sprintf("bot locale %s: %v", e.Name(), err))
		}
		m := map[string]string{}
		if err := json.Unmarshal(raw, &m); err != nil {
			panic(fmt.Sprintf("bot locale %s: %v", e.Name(), err))
		}
		out[strings.TrimSuffix(e.Name(), ".json")] = m
	}
	if _, ok := out[BotFallbackLanguage]; !ok {
		panic("bot locales: en.json is required")
	}
	return out
}

// SupportedBotLanguages lists the language codes that have a bot locale file.
func SupportedBotLanguages() []string {
	codes := make([]string, 0, len(botLocales))
	for c := range botLocales {
		codes = append(codes, c)
	}
	sort.Strings(codes)
	return codes
}

// IsSupportedBotLanguage reports whether code has a bot locale file.
func IsSupportedBotLanguage(code string) bool {
	_, ok := botLocales[code]
	return ok
}

// botText returns key in lang, falling back to English, then to the key itself.
func botText(lang, key string) string {
	if m, ok := botLocales[lang]; ok {
		if v, ok := m[key]; ok && v != "" {
			return v
		}
	}
	if v, ok := botLocales[BotFallbackLanguage][key]; ok {
		return v
	}
	return key
}

var placeholderRe = regexp.MustCompile(`\{(\w+)\}`)

// fillPlaceholders replaces {name} tokens; unknown tokens are left as-is.
func fillPlaceholders(tpl string, vars map[string]string) string {
	return placeholderRe.ReplaceAllStringFunc(tpl, func(m string) string {
		if v, ok := vars[m[1:len(m)-1]]; ok {
			return v
		}
		return m
	})
}

// botMessage returns a canned reply in the company's bot language.
func botMessage(lang, key string) string {
	return botText(NormalizeBotLanguage(lang), key)
}

// BotLanguageName is the English name of a bot language ("Vietnamese"), used in LLM instructions.
func BotLanguageName(lang string) string {
	return botText(NormalizeBotLanguage(lang), "languageName")
}

var legacyStatusCodes = map[string]string{
	"nouveau":  "NEW",
	"en_cours": "ONGOING",
	"approuve": "APPROVED",
	"rejete":   "REJECTED",
	"termine":  "COMPLETED",
}

// CanonicalClaimStatus maps legacy French status codes (en_cours, approuve...)
// and any casing to NEW/ONGOING/APPROVED/REJECTED/COMPLETED.
func CanonicalClaimStatus(status string) string {
	s := strings.TrimSpace(status)
	if c, ok := legacyStatusCodes[strings.ToLower(s)]; ok {
		return c
	}
	return strings.ToUpper(s)
}

// StatusUpdateMessage builds the WhatsApp text sent to a customer when a claim
// status changes, in the company's bot language (English for missing keys).
func StatusUpdateMessage(lang, status, customerName, claimNumber, companyName string, pdfFollows bool) string {
	lang = NormalizeBotLanguage(lang)
	status = CanonicalClaimStatus(status)
	vars := map[string]string{
		"name":        strings.TrimSpace(customerName),
		"claimNumber": claimNumber,
		"company":     strings.TrimSpace(companyName),
		"status":      status,
	}
	var parts []string
	if vars["name"] != "" {
		parts = append(parts, fillPlaceholders(botText(lang, "status.greeting"), vars))
	} else {
		parts = append(parts, botText(lang, "status.greetingNoName"))
	}
	key := "status." + status
	switch status {
	case "NEW", "ONGOING", "APPROVED", "REJECTED", "COMPLETED":
	default:
		key = "status.OTHER"
	}
	parts = append(parts, fillPlaceholders(botText(lang, key), vars))
	if pdfFollows {
		parts = append(parts, botText(lang, "status.pdfNote"))
	}
	if vars["company"] != "" {
		parts = append(parts, fillPlaceholders(botText(lang, "status.signature"), vars))
	}
	return strings.Join(parts, "\n\n")
}
