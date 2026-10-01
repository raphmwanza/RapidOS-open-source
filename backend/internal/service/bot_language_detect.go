package service

import (
	"strings"
	"unicode"
)

// Customer language detection: a light, deterministic heuristic (scripts and
// frequent words) used to tell the LLM which language the customer writes in
// and to localise canned replies. It only returns bot languages that have a
// locale file; "" means "not sure" (e.g. "ok", a number, an emoji).

var languageStopwords = map[string][]string{
	"en": {"the", "is", "my", "i", "i'm", "you", "your", "what", "how", "was", "and", "have", "has", "with", "hello", "hi", "please", "thanks", "thank", "want", "would", "like", "yesterday", "today", "about", "can", "need", "it", "of", "to", "in", "where", "when", "name", "number", "accident", "this", "that", "are", "me", "do", "does", "did", "not", "car", "hit", "file", "claim", "status", "there", "who", "an", "a", "at", "on", "for", "from", "no", "yes", "our", "we", "happened", "damage", "get", "morning", "afternoon", "evening", "just", "is"},
	"fr": {"le", "la", "les", "je", "j'ai", "mon", "ma", "mes", "est", "et", "bonjour", "bonsoir", "salut", "merci", "vous", "votre", "vos", "une", "un", "des", "du", "avec", "pour", "sur", "hier", "aujourd'hui", "voiture", "suis", "c'est", "pas", "qui", "quoi", "comment", "où", "déclarer", "sinistre", "s'il", "plaît", "oui", "non", "nom", "numéro", "m'appelle", "au", "aux", "ce", "cette", "il", "elle", "nous", "été", "eu", "ai", "avez", "quel", "quelle", "quand", "veux", "voudrais", "annuler", "accidenté", "dégâts", "d'un", "d'une", "l'accident", "à"},
	"es": {"el", "los", "las", "mi", "es", "y", "hola", "gracias", "usted", "su", "una", "con", "para", "ayer", "hoy", "coche", "carro", "soy", "está", "qué", "cómo", "dónde", "quiero", "siniestro", "reclamo", "reclamación", "por", "favor", "sí", "llamo", "nombre", "tengo", "tuve", "del", "al", "pero", "muy", "buenos", "días", "estado", "mío", "choque", "cancelar"},
	"pt": {"o", "os", "meu", "minha", "é", "olá", "ola", "obrigado", "obrigada", "você", "seu", "sua", "uma", "com", "ontem", "hoje", "carro", "sou", "está", "que", "como", "onde", "quero", "sinistro", "não", "sim", "nome", "chamo", "bom", "dia", "tive", "do", "da", "no", "na", "em", "um", "batida", "acidente", "estou", "cancelar", "número"},
	"sw": {"na", "habari", "jambo", "mimi", "yangu", "wangu", "ni", "kwa", "gari", "jana", "leo", "nataka", "asante", "tafadhali", "ndiyo", "hapana", "jina", "langu", "ajali", "nilipata", "yako", "wako", "hii", "hiyo", "sana", "niko", "naitwa", "bima", "madai", "dai", "hali", "nini", "gani", "wapi", "lini", "kuhusu", "kutoka", "katika", "za", "wa", "la", "nimepata", "ilitokea", "imeharibika", "mtu", "nataka", "kuongea", "namba", "barabara", "juzi", "sijui", "nina", "yetu", "wewe", "karibu", "mchana", "asubuhi", "shikamoo", "sasa", "hakuna", "aliumia", "nilikuwa", "kuwasilisha"},
	"ln": {"na", "mbote", "nazali", "ngai", "motuka", "lobi", "lelo", "nalingi", "matondo", "boni", "ozali", "nkombo", "kombo", "bongo", "iyo", "likambo", "yo", "biso", "bino", "ezali", "nini", "wapi", "mokolo", "nasalaki", "ebebi", "mosala", "malamu", "sango", "ndenge"},
	"id": {"saya", "anda", "dan", "yang", "ini", "itu", "mobil", "kemarin", "hari", "terima", "kasih", "tolong", "apa", "bagaimana", "di", "ke", "dari", "nama", "klaim", "asuransi", "ingin", "mau", "tidak", "sudah", "kecelakaan", "selamat", "pagi", "siang", "bisa"},
	"tl": {"ako", "ikaw", "ang", "ng", "sa", "mga", "ko", "po", "salamat", "kotse", "kahapon", "ngayon", "gusto", "pangalan", "ano", "paano", "saan", "hindi", "oo", "kumusta", "naaksidente", "ba", "lang", "naman"},
	"ha": {"ina", "sunana", "mota", "jiya", "yau", "don", "da", "ne", "ce", "ban", "gode", "sannu", "yaya", "wani", "kuma", "zan", "nake", "hatsari", "kai", "ku", "mun"},
	"yo": {"mo", "ti", "orúkọ", "oruko", "àná", "loni", "fẹ", "jọwọ", "jowo", "bawo", "kini", "ẹ", "ṣe", "ọkọ", "ijamba", "mi", "ni", "si", "wa", "pẹlu"},
}

var languageStopwordSets = func() map[string]map[string]bool {
	out := map[string]map[string]bool{}
	for lang, words := range languageStopwords {
		set := map[string]bool{}
		for _, w := range words {
			set[w] = true
		}
		out[lang] = set
	}
	return out
}()

// DetectMessageLanguage guesses the language of one customer message.
func DetectMessageLanguage(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	// Non-Latin scripts are decisive.
	counts := map[string]int{}
	letters := 0
	for _, r := range text {
		if !unicode.IsLetter(r) {
			continue
		}
		letters++
		switch {
		case unicode.Is(unicode.Arabic, r):
			counts["ar"]++
		case unicode.Is(unicode.Ethiopic, r):
			counts["am"]++
		case unicode.Is(unicode.Bengali, r):
			counts["bn"]++
		case unicode.Is(unicode.Devanagari, r):
			counts["hi"]++
		}
	}
	for lang, n := range counts {
		if letters > 0 && n*2 >= letters {
			return lang
		}
	}
	lower := strings.ToLower(text)
	// Distinctive Latin letters.
	if strings.ContainsAny(lower, "ɓɗƙƴ") {
		return "ha"
	}
	if strings.ContainsAny(lower, "ơưđ") || strings.ContainsAny(lower, "ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ") && !strings.ContainsAny(lower, "ẹọṣ") {
		return "vi"
	}
	if strings.ContainsAny(lower, "ṣ") || (strings.ContainsAny(lower, "ẹọ") && !strings.ContainsAny(lower, "ơưđ")) {
		return "yo"
	}

	tokens := strings.FieldsFunc(lower, func(r rune) bool {
		return !(unicode.IsLetter(r) || r == '\'' || r == '’')
	})
	if len(tokens) == 0 {
		return ""
	}
	scores := map[string]int{}
	for _, tok := range tokens {
		tok = strings.ReplaceAll(tok, "’", "'")
		for lang, set := range languageStopwordSets {
			if set[tok] {
				scores[lang]++
			}
		}
		// French elisions (l'accident, d'une, qu'il…).
		if len(tok) > 2 && tok[1] == '\'' && strings.ContainsRune("ldjmnstc", rune(tok[0])) {
			scores["fr"]++
		}
	}
	best, bestScore, second := "", 0, 0
	for lang, sc := range scores {
		if sc > bestScore || (sc == bestScore && lang < best) {
			if sc > bestScore {
				second = bestScore
			}
			best, bestScore = lang, sc
		} else if sc > second {
			second = sc
		}
	}
	if bestScore == 0 || bestScore == second {
		return ""
	}
	// One weak hit in a long message is not enough.
	if bestScore == 1 && len(tokens) > 4 {
		return ""
	}
	if !IsSupportedBotLanguage(best) {
		return ""
	}
	return best
}

// DetectConversationLanguage returns the language of the current message, or
// of the most recent earlier customer message whose language is clear.
func DetectConversationLanguage(current string, history []ChatMessage) string {
	lang := DetectMessageLanguage(current)
	// A one- or two-word message ("Annuler", "ok", "yes") is weak evidence:
	// keep the language the customer has been writing in.
	if lang != "" && len(strings.Fields(current)) >= 3 {
		return lang
	}
	for i := len(history) - 1; i >= 0; i-- {
		if history[i].Role != "user" || history[i].Content == current {
			continue
		}
		if len(strings.Fields(history[i].Content)) < 3 {
			continue
		}
		if prev := DetectMessageLanguage(history[i].Content); prev != "" {
			return prev
		}
	}
	if lang != "" {
		return lang
	}
	for i := len(history) - 1; i >= 0; i-- {
		if history[i].Role != "user" {
			continue
		}
		if lang := DetectMessageLanguage(history[i].Content); lang != "" {
			return lang
		}
	}
	return ""
}

// weakLanguageFallback maps languages the assistant's models do not write
// reliably to the language customers there also use: Lingala speakers get
// French rather than invented Lingala.
var weakLanguageFallback = map[string]string{"ln": "fr"}

// SupportedReplyLanguage returns the language the bot should treat the
// customer's language as: weak languages fall back (ln -> fr) unless the
// company's own bot language is that language.
func SupportedReplyLanguage(customerLang, companyLang string) string {
	if fb, ok := weakLanguageFallback[customerLang]; ok && NormalizeBotLanguage(companyLang) != customerLang {
		return fb
	}
	return customerLang
}

// ReplyLanguage picks the language of the bot's reply: the customer's language
// when the company allows it and it is known, otherwise the company language.
func ReplyLanguage(companyLang, customerLang string, behavior BotBehavior) string {
	companyLang = NormalizeBotLanguage(companyLang)
	if behavior.ReplyInCustomerLanguage && customerLang != "" && IsSupportedBotLanguage(customerLang) {
		return customerLang
	}
	return companyLang
}

var accentFolder = strings.NewReplacer(
	"à", "a", "á", "a", "â", "a", "ã", "a", "ä", "a", "å", "a", "ç", "c", "è", "e", "é", "e", "ê", "e", "ë", "e",
	"ì", "i", "í", "i", "î", "i", "ï", "i", "ñ", "n", "ò", "o", "ó", "o", "ô", "o", "õ", "o", "ö", "o",
	"ù", "u", "ú", "u", "û", "u", "ü", "u", "ý", "y", "ÿ", "y", "œ", "oe", "æ", "ae", "ẹ", "e", "ọ", "o", "ṣ", "s",
	"’", "'", "‘", "'",
)

// foldText lowercases and strips common Latin accents so keyword matching
// tolerates "numéro"/"numero" and similar spellings.
func foldText(s string) string {
	return accentFolder.Replace(strings.ToLower(s))
}
