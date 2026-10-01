package service

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// PromptSanitizer neutralises common prompt-injection phrasings before user
// text is embedded in an LLM request. Customers write in many languages, so
// the patterns cover English plus French, Spanish, Portuguese and Swahili, and
// generic markers (fake system tags, role headers) that work in any language.
type PromptSanitizer struct {
	// MaxInputLength is the maximum allowed length for user input, in bytes.
	MaxInputLength int
}

// NewPromptSanitizer creates a new PromptSanitizer with default values.
func NewPromptSanitizer() *PromptSanitizer {
	return &PromptSanitizer{MaxInputLength: 5000}
}

type injectionPattern struct {
	re  *regexp.Regexp
	tag string
}

func ip(expr, tag string) injectionPattern {
	return injectionPattern{re: regexp.MustCompile(`(?i)` + expr), tag: tag}
}

// injectionPatterns are matched case-insensitively on the raw text.
var injectionPatterns = []injectionPattern{
	// --- Generic / language-independent markers ---
	ip(`<\s*/?\s*(system|assistant|developer)\s*>`, "system tag"),
	ip(`\[\s*/?\s*(system|assistant|developer|inst)\s*\]`, "system tag"),
	ip(`<\|?\s*(im_start|im_end|endoftext)\s*\|?>`, "system tag"),
	ip(`(^|\n)\s*(system|assistant|developer|syst[eè]me|sistema|mfumo)\s*:\s*`, "role header"),
	ip(`\\n\\n---\\n`, "separator"),
	ip(`\b(jailbreak|DAN\s+mode|do\s+anything\s+now)\b`, "jailbreak"),

	// --- English ---
	ip(`(ignore|disregard|forget|override)\s+(all\s+|any\s+)?(of\s+)?(the\s+|your\s+|my\s+)?(previous\s+|above\s+|prior\s+|earlier\s+|system\s+)?(instructions?|prompts?|rules?|guidelines)`, "instruction override"),
	ip(`you\s+are\s+now\s+(a|an|the|my|no\s+longer)?\s*[a-z]+`, "role change"),
	ip(`from\s+now\s+on\s+you\s+(are|will)`, "role change"),
	ip(`pretend\s+(you\s+are|to\s+be)`, "role change"),
	ip(`act\s+as\s+(if\s+you|a|an)\b`, "role change"),
	ip(`new\s+instructions?\s*:`, "injected rules"),
	ip(`(reveal|show|print|repeat|display)\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions)`, "prompt leak"),
	ip(`what\s+(is|are)\s+your\s+(system\s+)?(prompt|instructions)`, "prompt leak"),
	ip(`system\s+override|admin(istrator)?\s+override`, "role change"),
	ip(`(output|respond\s+with|reply\s+with)\s+only`, "output control"),
	ip(`(developer|unrestricted|god)\s+mode`, "jailbreak"),

	// --- French ---
	ip(`(ignor|oubli|n[ée]glig)(e|ez|er|es)\s+(toutes?\s+)?(les\s+|tes\s+|vos\s+|mes\s+)?(instructions?|consignes?|r[eè]gles?|directives?)`, "instruction override"),
	ip(`(tu\s+es|vous\s+[êe]tes)\s+(maintenant|d[ée]sormais)`, "role change"),
	ip(`([àa]\s+partir\s+de\s+maintenant|d[ée]sormais),?\s+(tu|vous)\s+(es|[êe]tes|seras|serez)`, "role change"),
	ip(`fai(s|tes)\s+semblant\s+d['’]?\s*[êe]tre`, "role change"),
	ip(`(agis|agissez|comporte-toi)\s+comme\s+(si|un|une)\b`, "role change"),
	ip(`nouvelles?\s+(instructions?|consignes?)\s*:`, "injected rules"),
	ip(`(montre|affiche|r[ée]v[èe]le|donne|r[ée]p[èe]te)(s|z)?(-moi|\s+moi)?\s+(ton|votre|le)\s+(prompt|instructions?\s+syst[èe]me)`, "prompt leak"),
	ip(`quel(le)?s?\s+(est|sont)\s+(ton|votre|tes|vos)\s+(prompt|instructions|consignes)`, "prompt leak"),
	ip(`mode\s+(d[ée]veloppeur|sans\s+restriction)`, "jailbreak"),

	// --- Spanish ---
	ip(`(ignor|olvid)(a|e|en|ad|ar)\s+(todas?\s+)?(las\s+|tus\s+|sus\s+|mis\s+)?(instrucciones|reglas|indicaciones)`, "instruction override"),
	ip(`(ahora|a\s+partir\s+de\s+ahora|desde\s+ahora)\s+(t[úu]\s+)?eres`, "role change"),
	ip(`finge\s+(ser|que)`, "role change"),
	ip(`act[úu]a\s+como\s+(si|un|una)\b`, "role change"),
	ip(`nuevas\s+instrucciones\s*:`, "injected rules"),
	ip(`(muestra|revela|dime|repite)(me)?\s+(tu|el|su)\s+(prompt|instrucciones\s+del\s+sistema)`, "prompt leak"),
	ip(`modo\s+(desarrollador|sin\s+restricciones)`, "jailbreak"),

	// --- Portuguese ---
	ip(`(ignor|esque[çc])(e|a|ar)\s+(todas\s+)?(as\s+)?(suas\s+|tuas\s+|minhas\s+)?(instru[çc][õo]es|regras|orienta[çc][õo]es)`, "instruction override"),
	ip(`(agora|a\s+partir\s+de\s+agora|de\s+agora\s+em\s+diante)\s+(voc[êe]\s+[ée]|tu\s+[ée]s)`, "role change"),
	ip(`finja\s+(ser|que)`, "role change"),
	ip(`(aja|atue)\s+como\s+(se|um|uma)\b`, "role change"),
	ip(`novas\s+instru[çc][õo]es\s*:`, "injected rules"),
	ip(`(mostre|revele|diga|repita)(-me)?\s+(seu|o|teu)\s+(prompt|instru[çc][õo]es\s+do\s+sistema)`, "prompt leak"),
	ip(`modo\s+(desenvolvedor|sem\s+restri[çc][õo]es)`, "jailbreak"),

	// --- Swahili ---
	ip(`(puuza|sahau|acha)\s+(maagizo|maelekezo|sheria|amri)`, "instruction override"),
	ip(`(sasa|kuanzia\s+sasa|tangu\s+sasa)\s*,?\s+wewe\s+ni`, "role change"),
	ip(`jifanye\s+(kuwa|ni|u)`, "role change"),
	ip(`maagizo\s+mapya\s*:`, "injected rules"),
	ip(`(onyesha|nionyeshe|rudia)\s+(maagizo|maelekezo|prompt)`, "prompt leak"),
}

// SanitizeUserInput trims, length-limits (rune-safe) and neutralises
// injection phrasings while preserving normal conversation text.
func (s *PromptSanitizer) SanitizeUserInput(input string) string {
	if input == "" {
		return input
	}
	input = strings.TrimSpace(strings.ReplaceAll(input, "\x00", ""))
	if s.MaxInputLength > 0 && len(input) > s.MaxInputLength {
		cut := s.MaxInputLength
		for cut > 0 && !utf8.RuneStart(input[cut]) {
			cut--
		}
		input = input[:cut]
	}
	return s.escapeInjectionPatterns(input)
}

func (s *PromptSanitizer) escapeInjectionPatterns(input string) string {
	for _, p := range injectionPatterns {
		input = p.re.ReplaceAllString(input, " [USER SAID: "+p.tag+"] ")
	}
	return input
}

// ContainsInjectionAttempt reports whether the input matches any injection
// pattern (in any supported language).
func (s *PromptSanitizer) ContainsInjectionAttempt(input string) bool {
	for _, p := range injectionPatterns {
		if p.re.MatchString(input) {
			return true
		}
	}
	return false
}

// strongInjectionTags are the patterns that are never part of a normal
// insurance conversation; the bot answers them with a fixed refusal.
var strongInjectionTags = map[string]bool{"instruction override": true, "prompt leak": true, "jailbreak": true, "system tag": true, "role change": true, "injected rules": true}

// IsStrongInjectionAttempt reports a clear attempt to override the bot's
// instructions, change its role or extract its prompt.
func IsStrongInjectionAttempt(input string) bool {
	for _, p := range injectionPatterns {
		if strongInjectionTags[p.tag] && p.re.MatchString(input) {
			return true
		}
	}
	return false
}

// WrapUserInput wraps user input with clear delimiters to help the model
// distinguish between system instructions and user-provided content.
func (s *PromptSanitizer) WrapUserInput(input string) string {
	return "<<<USER_INPUT>>>" + s.SanitizeUserInput(input) + "<<<END_USER_INPUT>>>"
}
