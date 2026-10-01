package service

import (
	"regexp"
	"strings"
)

// Deterministic, multilingual guard rails around the LLM's intent tag. Small
// local models often mislabel short control messages ("cancel", "status?",
// "I want a human") while a claim is being filed; these checks make the
// important routes reliable regardless of the model.

func compileFolded(patterns ...string) *regexp.Regexp {
	return regexp.MustCompile(`(?i)(` + strings.Join(patterns, `|`) + `)`)
}

var cancelPattern = compileFolded(
	// English
	`\bcancel\b`, `\bcancel (it|this|that|the claim|my claim)\b`, `\bnever ?mind\b`, `\bforget (it|about it)\b`, `\babort\b`, `\bstop (it|this|the claim)\b`, `^\s*stop\s*[.!]*\s*$`, `\bi don'?t want to (file|continue|go on)\b`,
	// French
	`\bannul`, `\blaisse tomber\b`, `\babandonn`, `^\s*arrete[sz]?\b`, `\bje ne veux plus\b`,
	// Spanish / Portuguese
	`\bcancel(ar|a|o|e|ado|ada)\b`, `\bolvid(alo|a|elo)\b`, `\bya no quiero\b`, `\besquece\b`, `\bdesist`, `\bnao quero mais\b`,
	// Swahili / Lingala
	`\bghairi\b`, `\bsitisha\b`, `\bachana na(o|lo|yo)?\b`, `\bsitaki tena\b`, `\bkotika\b`, `\btika yango\b`,
	// Indonesian, Tagalog, Hausa, Yoruba, Vietnamese, Hindi, Arabic, Amharic, Bengali
	`\bbatal(kan)?\b`, `\bkanselahin\b`, `\bhuwag na\b`, `\bsoke\b`, `\bfagile\b`, `hủy`, `रद्द`, `إلغاء|الغاء`, `ሰርዝ`, `বাতিল`,
)

var humanRequestPattern = compileFolded(
	`\b(speak|talk|chat)\s+(to|with)\s+(a\s+|an\s+|the\s+|your\s+|some\s*one|some\s*body|real\s+)*(human|person|agent|representative|advisor|adviser|manager|operator|someone|somebody)\b`,
	`\b(human|live|real)\s+(agent|person|being|operator)\b`, `\bcustomer (service|care) (agent|representative)\b`,
	`\b(parler|discuter)\s+(a|avec)\s+(un|une|le|la|quelqu'un|un vrai|une vraie)?\s*(humain|conseiller|conseillere|agent|personne|responsable|operateur)\b`, `\bagent humain\b`, `\bvraie personne\b`, `\bune personne reelle\b`,
	`\bhablar\s+con\s+(un|una|el|la|alguien)?\s*(humano|agente|persona|asesor|operador)\b`, `\bpersona real\b`,
	`\bfalar\s+com\s+(um|uma|o|a|alguem)?\s*(humano|atendente|agente|pessoa|operador)\b`, `\bpessoa real\b`,
	`\b(ongea|kuongea|zungumza|kuzungumza|niunganishe)\s+na\s+(mtu|wakala|binadamu|mhudumu|afisa|mfanyakazi)\b`, `\bmtu halisi\b`,
	`\bkosolola na moto\b`, `\bberbicara dengan (manusia|agen|orang)\b`, `\bmakausap ng (tao|ahente)\b`,
)

var statusQuestionPattern = compileFolded(
	`\bstatus\b`, `\bwhere is my claim\b`, `\b(update|news) on my claim\b`, `\btrack(ing)? my claim\b`, `\bmy claims\b`, `\bwhat('s| is) happening with my claim\b`,
	`\bstatut\b`, `\bou en est\b`, `\bsuivi de (mon|ma|mes)\b`, `\bmes sinistres\b`, `\betat de (mon|ma) (sinistre|dossier|declaration)\b`,
	`\bestado de (mi|mis)\b`, `\bcomo va mi\b`, `\bmis (reclamos|reclamaciones|siniestros)\b`,
	`\b(situacao|estado) do meu\b`, `\bcomo esta o meu (sinistro|pedido|processo)\b`, `\bmeus sinistros\b`,
	`\bhali ya (dai|madai|ombi)\b`, `\bdai langu limefikia wapi\b`, `\bmadai yangu\b`,
	`\blikambo na ngai ekomi wapi\b`, `\bstatus klaim\b`,
)

// IsCancelMessage reports whether the customer asks to stop the current claim.
func IsCancelMessage(text string) bool { return cancelPattern.MatchString(foldText(text)) }

// IsHumanRequest reports whether the customer explicitly asks for a person.
func IsHumanRequest(text string) bool { return humanRequestPattern.MatchString(foldText(text)) }

// IsStatusQuestion reports whether the customer asks about existing claims.
func IsStatusQuestion(text string, claims []CustomerClaim) bool {
	if statusQuestionPattern.MatchString(foldText(text)) {
		return true
	}
	upper := strings.ToUpper(text)
	for _, c := range claims {
		if c.ClaimNumber != "" && strings.Contains(upper, strings.ToUpper(c.ClaimNumber)) {
			return true
		}
	}
	return false
}

// ── yes / no confirmation ────────────────────────────────────────────────

type confirmationWords struct {
	yesWords, noWords     map[string]bool
	yesPhrases, noPhrases []string
}

var correctionMarkers = map[string]bool{"but": true, "mais": true, "pero": true, "mas": true, "lakini": true, "ila": true, "tapi": true, "pero,": true, "kaso": true, "except": true, "sauf": true, "excepto": true, "exceto": true}

var botConfirmationWords = func() confirmationWords {
	cw := confirmationWords{yesWords: map[string]bool{}, noWords: map[string]bool{}}
	add := func(list string, words map[string]bool, phrases *[]string) {
		for _, w := range strings.Split(list, ",") {
			w = normalizeConfirmation(w)
			if w == "" {
				continue
			}
			if strings.Contains(w, " ") {
				*phrases = append(*phrases, w)
			} else {
				words[w] = true
			}
		}
	}
	for _, m := range botLocales {
		add(m["confirm.yesWords"], cw.yesWords, &cw.yesPhrases)
		add(m["confirm.noWords"], cw.noWords, &cw.noPhrases)
	}
	// A word that means "no" in one language and "yes" in another is unusable.
	for w := range cw.yesWords {
		if cw.noWords[w] {
			delete(cw.yesWords, w)
			delete(cw.noWords, w)
		}
	}
	return cw
}()

var confirmationPunct = regexp.MustCompile(`[^\p{L}\p{N}\p{M}' ]+`)

func normalizeConfirmation(s string) string {
	s = foldText(strings.TrimSpace(s))
	s = confirmationPunct.ReplaceAllString(s, " ")
	return strings.Join(strings.Fields(s), " ")
}

// ClassifyConfirmation returns "yes", "no" or "" (anything else, e.g. a
// correction) for the customer's answer to the claim summary. Words come from
// every bot locale, so a customer can confirm in any supported language.
func ClassifyConfirmation(text string) string {
	raw := strings.TrimSpace(text)
	if raw == "" {
		return ""
	}
	norm := normalizeConfirmation(raw)
	if norm == "" {
		switch {
		case strings.ContainsAny(raw, "👍✅✔"):
			return "yes"
		case strings.ContainsAny(raw, "👎❌✖"):
			return "no"
		}
		return ""
	}
	tokens := strings.Fields(norm)
	if len(tokens) > 10 {
		return ""
	}
	for _, t := range tokens {
		if correctionMarkers[t] {
			return ""
		}
	}
	matchPhrase := func(phrases []string) bool {
		for _, p := range phrases {
			if norm == p || strings.HasPrefix(norm, p+" ") {
				return true
			}
		}
		return false
	}
	if matchPhrase(botConfirmationWords.noPhrases) {
		return "no"
	}
	if matchPhrase(botConfirmationWords.yesPhrases) {
		return "yes"
	}
	first := tokens[0]
	if botConfirmationWords.noWords[first] {
		return "no"
	}
	if botConfirmationWords.yesWords[first] {
		return "yes"
	}
	if len(tokens) >= 2 && botConfirmationWords.yesWords[tokens[0]+" "+tokens[1]] {
		return "yes"
	}
	return ""
}

// ── intent tag parsing ───────────────────────────────────────────────────

var intentTagPattern = regexp.MustCompile(`(?is)^\s*[*_"']*\s*(?:\[\s*(CLAIM|QUOTE|STATUS|INFO|ESCALATE|CANCEL|GENERAL)\s*\]\s*(?:::|:|-|–|—)?|(CLAIM|QUOTE|STATUS|INFO|ESCALATE|CANCEL|GENERAL)\s*::)\s*[*_]*\s*`)
var strayIntentTag = regexp.MustCompile(`(?i)\[\s*(CLAIM|QUOTE|STATUS|INFO|ESCALATE|CANCEL|GENERAL|INTENT_CODE)\s*\]\s*(::)?\s*`)

// ParseIntentReply splits "[TAG] :: text" (tolerating missing brackets,
// single colons and markdown) into an intent and the reply text.
func ParseIntentReply(full string) (intent, text string) {
	intent = "general"
	text = strings.TrimSpace(full)
	if m := intentTagPattern.FindStringSubmatch(text); m != nil {
		tag := strings.ToUpper(m[1] + m[2])
		text = strings.TrimSpace(text[len(m[0]):])
		switch tag {
		case "CLAIM":
			intent = "claim"
		case "QUOTE":
			intent = "question"
		case "STATUS":
			intent = "status_inquiry"
		case "ESCALATE":
			intent = "escalation"
		case "CANCEL":
			intent = "cancel"
		}
	}
	text = strings.TrimSpace(strayIntentTag.ReplaceAllString(text, ""))
	text = strings.TrimSpace(strings.TrimPrefix(text, "ESCALATE:"))
	return intent, text
}

// ── reply guard ──────────────────────────────────────────────────────────

var claimCodePattern = regexp.MustCompile(`\b[A-Z]{2,6}(?:-[A-Z0-9]{2,12}){1,4}\b`)
var claimWordsPattern = compileFolded(`claim`, `sinistre`, `declaration`, `reclam`, `sinistro`, `siniestro`, `\bdai\b`, `madai`, `klaim`, `likambo`, `numero`, `number`, `namba`, `nimero`, `nomor`)
var registrationClaimPattern = compileFolded(
	`(claim|declaration|sinistre|dossier|reclamacion|reclamo|siniestro|sinistro|pedido|\bdai\b|klaim)[^.!?\n]{0,60}\b(has been|have been|was|is now|is|a ete|a bien ete|est|ha sido|fue|foi|esta|imekuwa)\s+(successfully\s+|bien\s+|correctement\s+)?(registered|submitted|created|filed|recorded|opened|logged|enregistree?s?|creee?s?|soumise?s?|transmise?s?|ouverte?s?|registrad[oa]s?|cread[oa]s?|criad[oa]s?|enviad[oa]s?|abiert[oa]s?|abert[oa]s?)\b`,
	`\b(i have|i've|we have|we've|j'ai|nous avons|he|hemos|eu|nos)\s+(successfully\s+|bien\s+)?(registered|submitted|filed|created|opened|logged|enregistre|cree|soumis|transmis|ouvert|registrado|enviado|creado|criado|aberto|abierto)\s+(your|votre|su|seu|o seu|a sua|sua)\b`,
	`\b(dai|madai) (lako|yako) (limesajiliwa|yamesajiliwa|limewasilishwa|limeundwa|limepokelewa)\b`, `\bnimesajili dai\b`, `\bnimewasilisha dai\b`,
)

// FabricatedClaimReply reports whether an LLM reply pretends the claim was
// registered, or quotes a claim/policy-like code the customer never gave and
// that is not one of their real claims. Only the claim flow may announce a
// registration, with the number the claims API returned.
func FabricatedClaimReply(reply string, realClaims []CustomerClaim, customerText string) bool {
	if registrationClaimPattern.MatchString(foldText(reply)) {
		return true
	}
	if !claimWordsPattern.MatchString(foldText(reply)) {
		return false
	}
	known := normalizeID(customerText)
	for _, code := range claimCodePattern.FindAllString(reply, -1) {
		if !strings.ContainsAny(code, "0123456789") && strings.Count(code, "-") < 2 {
			continue
		}
		real := false
		for _, c := range realClaims {
			if strings.EqualFold(c.ClaimNumber, code) {
				real = true
				break
			}
		}
		if real || strings.Contains(known, normalizeID(code)) {
			continue
		}
		return true
	}
	return false
}

// claimStartPattern recognises a customer who clearly wants to file a claim,
// in the supported languages, so a small model's "general" tag cannot keep the
// conversation out of the claim flow.
var claimStartPattern = regexp.MustCompile(`(?i)` + strings.Join([]string{
	`\b(file|submit|make|open|report|lodge|start|declare|register)\s+(a\s+|an\s+|my\s+)?(new\s+)?(insurance\s+)?(claim|clam|accident)`,
	`\bi\s+(had|have\s+had|got\s+into|was\s+in|was\s+involved\s+in)\s+(an?\s+)?(car\s+|road\s+|small\s+)?(accident|acident|crash|collision)`,
	`\bmy\s+(car|vehicle|house|home)\s+(was|got|has\s+been)\s+(hit|stolen|damaged|burgled|flooded|broken\s+into)`,
	`d[ée]clarer\s+(un\s+|mon\s+)?(sinistre|accident|acident)`,
	`\bj'?\s?ai\s+eu\s+un\s+(accident|acident|sinistre|accrochage)`,
	`\bouvrir\s+un\s+dossier\s+de\s+sinistre`,
	`\b(presentar|reportar|declarar|abrir)\s+(un\s+)?(siniestro|reclamo|reclamaci[oó]n|accidente)`,
	`\btuve\s+un\s+(accidente|choque)`,
	`\b(abrir|registrar|declarar|comunicar)\s+(um\s+)?(sinistro|acidente)`,
	`\b(tive|sofri)\s+um\s+(acidente|sinistro)`,
	`\bnimepata\s+(ajali|hasara)`,
	`\b(kuwasilisha|kuripoti|kutoa|kufungua)\s+(dai|madai|ajali)`,
}, "|"))

// IsClaimStart reports whether the message clearly starts a claim.
func IsClaimStart(text string) bool {
	return claimStartPattern.MatchString(text)
}
