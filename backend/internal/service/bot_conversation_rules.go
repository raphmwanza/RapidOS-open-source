package service

import (
	"regexp"
	"strings"
	"unicode"
)

// Deterministic conversation rules around the LLM: explicit corrections,
// upset customers, approximate dates, several incidents in one chat and the
// quality of person-name fields.

// ── explicit corrections ────────────────────────────────────────────────

var correctionPattern = compileFolded(
	`\bactually\b`, `\bsorry,? (i|it|my|the)\b`, `\bi (got|made) (it|that|the \w+) wrong\b`, `\bi made a mistake\b`, `\bcorrection\b`, `\bto correct\b`, `\bspelled\b`, `\bspelt\b`, `\bnot \w+,? (but|it'?s|it is)\b`, `\bi meant\b`, `\bmy mistake\b`, `\bwrong (date|name|number|plate)\b`,
	`\ben fait\b`, `\bje me suis trompe`, `\bje corrige\b`, `\bcorrig`, `\brectif`, `\bpardon,? (c'est|le|la|mon|ma)\b`, `\bc'est plutot\b`, `\bs'ecrit\b`, `\bje voulais dire\b`, `\berreur\b`,
	`\ben realidad\b`, `\bme equivoque\b`, `\bquise decir\b`, `\bna verdade\b`, `\bme enganei\b`, `\bquis dizer\b`,
	`\bkumbe\b`, `\bnimekosea\b`, `\bnilikosea\b`, `\bsamahani,? (ni|jina|tarehe|namba)\b`, `\bnasahihisha\b`,
)

// IsExplicitCorrection reports whether the customer explicitly corrects
// something they said ("actually…", "my name is spelled…", "en fait…").
func IsExplicitCorrection(text string) bool { return correctionPattern.MatchString(foldText(text)) }

// ── upset customers ─────────────────────────────────────────────────────

var upsetPattern = compileFolded(
	`\bridiculous\b`, `\bunacceptable\b`, `\boutrageous\b`, `\bdisgusting\b`, `\bscandal`, `\bfurious\b`, `\bangry\b`, `\bfed up\b`, `\bsick (and tired )?of\b`, `\btired of\b`, `\bfrustrat`, `\bdisappoint`, `\buseless\b`, `\bincompetent\b`, `\bworst\b`, `\bterrible\b`, `\bawful\b`, `\bhorrible\b`, `\bjoke\b`, `\bwaste of (my )?time\b`, `\bfor nothing\b`, `\bnobody (has )?(called|answered|replied|helped|contacted)\b`, `\bno ?one (has )?(called|answered|replied|helped|contacted)\b`, `\bcancel+ing my (policy|contract|insurance)\b`, `\banother insurer\b`, `\bi'?m (so |really )?(upset|annoyed|mad)\b`,
	`\binadmissible\b`, `\binacceptable\b`, `\bhonte\b`, `\bridicule\b`, `\bscandaleu`, `\bfurieu`, `\ben colere\b`, `\bj'en ai marre\b`, `\bras le bol\b`, `\bmarre\b`, `\bdecu`, `\bnul(le|s)?\b`, `\bincompetent`, `\bpersonne ne (m'a|m'|me |repond)`, `\bpour rien\b`, `\benerve`, `\bresilier\b`, `\bperte de temps\b`,
	`\bindignant`, `\bvergonz`, `\bmolest`, `\binaceptable\b`, `\bharto\b`, `\bnadie me (llamo|ha llamado|responde)\b`, `\babsurdo\b`, `\bninguem me (ligou|respondeu)\b`, `\bcansad[oa] de\b`, `\bpessimo\b`,
	`\bnimechoka\b`, `\bhasira\b`, `\bupuuzi\b`, `\bsi haki\b`, `\bhakuna (mtu )?aliyenipigia\b`, `\bmnanidharau\b`,
)

// IsUpsetMessage reports whether the customer sounds angry or frustrated.
func IsUpsetMessage(text string) bool {
	if upsetPattern.MatchString(foldText(text)) {
		return true
	}
	if strings.Count(text, "!") >= 3 {
		return true
	}
	caps := 0
	for _, w := range strings.Fields(text) {
		// References are written in capitals: ACT-POLICY-2026-0610, KIN-8080-GH.
		if strings.ContainsAny(w, "0123456789-_/#") {
			continue
		}
		letters, upper := 0, 0
		for _, r := range w {
			if unicode.IsLetter(r) {
				letters++
				if unicode.IsUpper(r) {
					upper++
				}
			}
		}
		if letters >= 4 && upper == letters {
			caps++
		}
	}
	return caps >= 2
}

var empathyPattern = compileFolded(
	`\bsorry\b`, `\bapologi`, `\bunderstand\b`, `\bi hear you\b`, `\bfrustrat`, `\bregret\b`,
	`\bdesole`, `\bnavre`, `\bje comprends\b`, `\bnous comprenons\b`, `\bexcuse`, `\bregrett`,
	`\blo siento\b`, `\bentiendo\b`, `\blamento\b`, `\bdisculp`, `\bsinto muito\b`, `\bentendo\b`, `\bdesculp`,
	`\bpole\b`, `\bsamahani\b`, `\bnaelewa\b`, `\btunaelewa\b`, `\bmaaf\b`, `\bpasensya\b`,
)

// HasEmpathy reports whether a reply already acknowledges the customer's feelings.
func HasEmpathy(text string) bool { return empathyPattern.MatchString(foldText(text)) }

// ── approximate dates ───────────────────────────────────────────────────

var approxDateMarkers = compileFolded(
	`\baround\b`, `\babout\b`, `\bapprox`, `\broughly\b`, `\bmaybe\b`, `\bperhaps\b`, `\bi think\b`, `\bnot sure\b`, `\bdon'?t (remember|know (exactly|the (exact )?date))\b`, `\bcan'?t remember\b`, `\bsome ?time\b`, `\bthe other day\b`, `\ba few days ago\b`, `\b(few|couple of) (days|weeks) ago\b`, `\blast week\b`, `\bearlier this (week|month)\b`, `\b(early|mid|late)[- ](january|february|march|april|may|june|july|august|september|october|november|december)\b`, `\bbetween\b`, `\bor\b`,
	`\bvers le\b`, `\benviron\b`, `\bpeut-?etre\b`, `\bje (ne )?sais (pas|plus)\b`, `\bje (ne )?me souviens (pas|plus)\b`, `\bje crois\b`, `\bje pense\b`, `\bla semaine (derniere|passee)\b`, `\bil y a (quelques|deux|trois|\d+) (jours|semaines)\b`, `\b(debut|mi|fin)[- ](janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b`, `\bentre le\b`, `\bou\b`, `\bl'autre jour\b`,
	`\bmas o menos\b`, `\bmaso menos\b`, `\bmás o menos\b`, `\bmasomenos\b`, `\bla semana pasada\b`, `\bhace unos dias\b`, `\bno (me )?acuerdo\b`, `\bmais ou menos\b`, `\ba semana passada\b`, `\bha alguns dias\b`, `\bnao lembro\b`,
	`\btakriban\b`, `\bwiki (iliyopita|jana)\b`, `\bsiku (chache|kadhaa) zilizopita\b`, `\bsikumbuki\b`, `\bsijui (tarehe|siku)\b`, `\bpengine\b`, `\blabda\b`,
	`\bposo (eleki|oyo eleki)\b`, `\bpɔsɔ eleki\b`, `\bmokolo moko\b`, `\bnayebi (te|malamu te)\b`,
)

var dateishWords = func() *regexp.Regexp {
	var words []string
	for _, names := range weekdayNames {
		words = append(words, names...)
	}
	for _, names := range monthNames {
		for _, n := range names {
			if len(n) >= 4 {
				words = append(words, n)
			}
		}
	}
	words = append(words, "week", "weekend", "semaine", "week-end", "jours", "days", "semana", "dias", "wiki", "siku", "mwezi", "month", "mois", "mes", "yesterday", "hier", "jana", "lobi", "poso", "mokolo", "night", "nuit", "morning", "matin", "evening", "soir")
	return regexp.MustCompile(`(?i)\b(` + strings.Join(words, "|") + `)\b|\b\d{1,2}\s*(?:-|–|/|to|au|or|ou|a)\s*\d{1,2}\b`)
}()

var clauseSplit = regexp.MustCompile(`[.;!?\n]+`)

// timeOfDayApprox: "around 6pm", "vers 18h", "about 3 o'clock" describe the
// time, not the date, and do not make a date approximate.
var timeOfDayApprox = regexp.MustCompile(`\b(around|about|approximately|approx|roughly|at about|vers|environ|a peu pres|kama saa|karibu saa)\s+(\d{1,2}([:h.]\d{2})?\s*(am|pm|h\b|heures?|hrs?|o'?clock)|\d{1,2}[:h]\d{2}|midnight|noon|midi|minuit)`)

var monthAlternation = func() string {
	var words []string
	for _, names := range monthNames {
		for _, n := range names {
			if len(n) >= 3 {
				words = append(words, regexp.QuoteMeta(foldText(n)))
			}
		}
	}
	return strings.Join(words, "|")
}()

var weekdayAlternation = func() string {
	var words []string
	for _, names := range weekdayNames {
		for _, n := range names {
			words = append(words, regexp.QuoteMeta(foldText(n)))
		}
	}
	return strings.Join(words, "|")
}()

// explicitCalendarDate: "27 September", "September 27th", "2026-09-27", "27/09".
var explicitCalendarDate = regexp.MustCompile(`\b\d{1,2}(st|nd|rd|th|er|eme)?\s+(of\s+|de\s+)?(` + monthAlternation + `)\b|\b(` + monthAlternation + `)\s+\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}/\d{1,2}(/\d{2,4})?\b`)

// approxModifiesDate: the hedge is on the date itself ("around the 20th of
// September", "maybe Tuesday", "25 or 26 September", "between the 20th and 22nd").
var approxModifiesDate = regexp.MustCompile(`\b(around|about|approx\w*|roughly|maybe|perhaps|i think|vers le|environ|peut-?etre|je crois|je pense|mas o menos|mais ou menos|takriban|labda|pengine)\s+(on\s+|the\s+|le\s+|el\s+|o\s+|a\s+)?(\d{1,2}(st|nd|rd|th|er|eme)?\b|` + monthAlternation + `|` + weekdayAlternation + `)|\b\d{1,2}(st|nd|rd|th|er)?\s*(or|ou|o|-|–|to|au|a)\s*(the\s+|le\s+)?\d{1,2}\b|\b(between|entre)\b`)

// IsApproximateDateWording reports whether the customer's date wording is
// hedged ("around last week", "mardi ou mercredi"), ignoring a hedge on the
// time of day ("on 28 September around 6pm" is an exact date).
func IsApproximateDateWording(text string) bool {
	folded := timeOfDayApprox.ReplaceAllString(foldText(text), " ")
	if !approxDateMarkers.MatchString(folded) {
		return false
	}
	if explicitCalendarDate.MatchString(folded) && !approxModifiesDate.MatchString(folded) {
		return false
	}
	return true
}

// ApproximateDateWording returns the customer's own words for the incident
// date when a clause of the message describes one: hedged ("peut-être mardi
// ou mercredi passé", "around last week"), explicit ("Sunday 27 September")
// or short ("yesterday"). "" when the message does not describe a date. Use
// IsApproximateDateWording to tell a hedged one apart.
func ApproximateDateWording(text string) string {
	for _, clause := range clauseSplit.Split(text, -1) {
		c := strings.TrimSpace(clause)
		if c == "" {
			continue
		}
		folded := foldText(c)
		if !dateishWords.MatchString(folded) {
			continue
		}
		if IsApproximateDateWording(c) || explicitCalendarDate.MatchString(folded) || len(strings.Fields(c)) <= 8 {
			if len([]rune(c)) > 120 {
				c = string([]rune(c)[:120])
			}
			return c
		}
	}
	return ""
}

// ── several incidents in one chat ───────────────────────────────────────

var multiIncidentCue = compileFolded(
	`\b(two|2|three|3|several|multiple) (problems|issues|incidents|claims|accidents|things)\b`, `\banother (problem|issue|incident|claim)\b`, `\band then\b`, `\balso\b`, `\bas well\b`, `\bseparately\b`,
	`\b(deux|2|trois|3|plusieurs) (problemes|soucis|sinistres|incidents|declarations|accidents)\b`, `\bun autre (probleme|sinistre|incident)\b`, `\bet puis\b`, `\baussi\b`, `\begalement\b`,
	`\b(dos|tres|varios) (problemas|siniestros|incidentes)\b`, `\b(dois|tres|varios) (problemas|sinistros|incidentes)\b`, `\btambien\b`, `\btambem\b`,
	`\bmatatizo (mawili|matatu)\b`, `\bpia\b`, `\bkisha\b`, `\bmakambo (mibale|misato)\b`, `\blisusu\b`,
)

var incidentClauseSplit = regexp.MustCompile(`(?i)[.;!?\n]+|,?\s+\b(?:and then|and also|and on|et puis|et aussi|et le|puis|then|also|aussi|kisha|pia|y luego|e depois)\b`)

// detectIncidentTypes returns the coverage types of the separate incidents
// the customer described, in the order they were mentioned. It only reports
// several types when the message says so ("two problems", "and then…") or
// each incident is clearly described in its own clause.
func detectIncidentTypes(coverage []CoverageInfo, text string) []string {
	if len(coverage) < 2 {
		return nil
	}
	var order []string
	strong := map[string]int{}
	for _, clause := range incidentClauseSplit.Split(text, -1) {
		best, bestScore, tie := "", 0, false
		for _, ct := range coverage {
			sc := claimTypeScore(ct, clause)
			switch {
			case sc > bestScore:
				best, bestScore, tie = ct.TypeName, sc, false
			case sc == bestScore && sc > 0:
				tie = true
			}
		}
		if best == "" || tie {
			continue
		}
		if !containsFold(order, best) {
			order = append(order, best)
		}
		if bestScore > strong[best] {
			strong[best] = bestScore
		}
	}
	if len(order) < 2 {
		return nil
	}
	if multiIncidentCue.MatchString(foldText(text)) {
		return order
	}
	for _, t := range order {
		if strong[t] < 2 {
			return nil
		}
	}
	return order
}

// claimTypeScore is the keyword evidence for one coverage type in a text.
func claimTypeScore(ct CoverageInfo, text string) int {
	folded := " " + foldText(text) + " "
	tokens := map[string]bool{}
	for _, t := range wordTokens(folded) {
		tokens[t] = true
	}
	sc := 0
	kws := append([]string{}, claimTypeKeywords[strings.ToUpper(ct.TypeName)]...)
	kws = append(kws, wordTokens(foldText(ct.DisplayName))...)
	for _, kw := range kws {
		kw = foldText(kw)
		if len(kw) < 3 {
			continue
		}
		if strings.Contains(kw, " ") {
			if strings.Contains(folded, kw) {
				sc += 2
			}
		} else if tokens[kw] || (len(kw) >= 5 && strings.Contains(folded, " "+kw)) {
			sc++
		}
	}
	return sc
}

// focusIncidentText keeps the parts of the customer's text about one incident:
// clauses that point to another incident type (and not to this one) are
// removed, so facts are never mixed between two claims.
func focusIncidentText(coverage []CoverageInfo, text, focus string, others []string) string {
	if len(others) == 0 {
		return text
	}
	var focusCT *CoverageInfo
	var otherCT []CoverageInfo
	for i := range coverage {
		switch {
		case strings.EqualFold(coverage[i].TypeName, focus):
			focusCT = &coverage[i]
		case containsFold(others, coverage[i].TypeName):
			otherCT = append(otherCT, coverage[i])
		}
	}
	if focusCT == nil {
		return text
	}
	var lines []string
	for _, line := range strings.Split(text, "\n") {
		var kept []string
		parts := incidentClauseSplit.Split(line, -1)
		for _, clause := range parts {
			c := strings.TrimSpace(clause)
			if c == "" {
				continue
			}
			mine := claimTypeScore(*focusCT, c)
			theirs := 0
			for _, o := range otherCT {
				if sc := claimTypeScore(o, c); sc > theirs {
					theirs = sc
				}
			}
			if theirs > 0 && mine == 0 {
				continue
			}
			kept = append(kept, c)
		}
		if len(kept) > 0 {
			lines = append(lines, strings.Join(kept, ". "))
		}
	}
	return strings.Join(lines, "\n")
}

// policyForIncident picks the policy number the customer gave for this
// incident when they gave several ("…0610 for the car and …0611 for the
// house"). It returns "" when it cannot tell.
func policyForIncident(coverage []CoverageInfo, text, focus string) string {
	pols := extractAllPolicyNumbers(text)
	if len(pols) <= 1 {
		if len(pols) == 1 {
			return pols[0]
		}
		return ""
	}
	ct := coverageFor(coverage, focus)
	if ct == nil {
		return ""
	}
	upper := strings.ToUpper(text)
	for _, p := range pols {
		i := strings.Index(upper, p)
		if i < 0 {
			continue
		}
		after := text[i+len(p):]
		if len(after) > 40 {
			after = after[:40]
		}
		if j := strings.IndexAny(after, ",;."); j >= 0 {
			after = after[:j]
		}
		if claimTypeScore(*ct, after) > 0 {
			return p
		}
	}
	return ""
}

// ── person names ────────────────────────────────────────────────────────

var vehicleDescriptorWords = map[string]bool{
	"taxi": true, "taxis": true, "truck": true, "lorry": true, "bus": true, "minibus": true, "taxi-bus": true, "matatu": true, "car": true, "cars": true, "van": true, "jeep": true, "motorbike": true, "motorcycle": true, "moto": true, "boda": true, "bike": true, "vehicle": true, "pickup": true, "pick-up": true, "tanker": true, "trailer": true, "tractor": true,
	"camion": true, "voiture": true, "vehicule": true, "fourgon": true, "camionnette": true, "autobus": true, "car-rapide": true,
	"coche": true, "carro": true, "camioneta": true, "caminhao": true, "onibus": true, "gari": true, "lori": true, "basi": true, "motuka": true, "piki": true,
	"driver": true, "chauffeur": true, "conducteur": true, "conductor": true, "motorista": true, "dereva": true, "someone": true, "somebody": true, "unknown": true, "quelqu'un": true, "inconnu": true, "inconnue": true, "other": true, "autre": true, "guy": true, "man": true, "woman": true, "lady": true, "monsieur": true, "madame": true,
}

var nameArticles = map[string]bool{"a": true, "an": true, "the": true, "un": true, "une": true, "le": true, "la": true, "el": true, "o": true, "um": true, "uma": true, "this": true, "that": true, "ce": true, "cette": true, "some": true, "my": true, "his": true, "her": true}

// nameCopulas are introduction words that may precede a name ("Nkombo na
// ngai ezali Grâce", "my name is Grace").
var nameCopulas = map[string]bool{"ezali": true, "nde": true, "ni": true, "is": true, "est": true, "es": true, "e": true, "é": true, "c'est": true, "naitwa": true, "nkombo": true, "na": true, "ngai": true, "jina": true, "langu": true, "yangu": true, "my": true, "name": true, "nom": true, "mon": true, "me": true, "llamo": true, "chamo": true, "called": true, "m'appelle": true, "appelle": true, "spelled": true, "spelt": true, "written": true, "s'ecrit": true, "ecrit": true, "actually": true, "en": true, "fait": true, ":": true, "-": true}

// cleanPersonName validates a person's name taken from the conversation:
// introduction words are trimmed, and vehicle descriptors ("a taxi"), common
// words, numbers or sentences are rejected.
// policyWord: "policy" and its common typos / translations ("polcy", "police",
// "poliza", "polisi"), and number labels, which never end a person's name.
var policyWord = regexp.MustCompile(`^(pol[a-z]?c[a-z]{0,2}|polisi|polis|poliza|apolice|plcy|number|num|no|nr|numero)$`)

func cleanPersonName(v string) (string, bool) {
	words := strings.Fields(strings.Trim(strings.TrimSpace(v), ".,;:!?\"'"))
	for len(words) > 0 && nameCopulas[foldText(strings.Trim(words[0], ",.:;"))] {
		words = words[1:]
	}
	for len(words) > 0 {
		last := foldText(strings.Trim(words[len(words)-1], ",.:;"))
		if !nameCopulas[last] && !policyWord.MatchString(last) {
			break
		}
		words = words[:len(words)-1] // "Grace Wanjiru Polcy …": the policy label is not a name
	}
	if len(words) == 0 || len(words) > 5 {
		return "", false
	}
	if nameArticles[foldText(words[0])] {
		return "", false
	}
	common := 0
	for _, w := range words {
		w = strings.Trim(w, ",.;:")
		f := foldText(w)
		if strings.ContainsAny(w, "0123456789@/") || vehicleDescriptorWords[f] || !isNameWord(w) {
			return "", false
		}
		if groundingStopwords[f] || nameStopWords[f] || notANameFirstWord[f] {
			common++
		}
	}
	if common == len(words) {
		return "", false
	}
	if len(words) == 1 && notANameFirstWord[foldText(words[0])] {
		return "", false
	}
	return strings.Join(words, " "), true
}

// isPersonNameField reports whether a field holds a person's name (the
// insured, the other driver, a witness…).
func isPersonNameField(f CoverageField) bool {
	if isNameField(f) {
		return true
	}
	n := strings.ToLower(f.Name)
	return strings.HasSuffix(n, "name") && !strings.Contains(n, "company") && !strings.Contains(n, "insurer") && !strings.Contains(n, "provider") && !strings.Contains(n, "hospital") && !strings.Contains(n, "street")
}

// ── concise "what happened" ─────────────────────────────────────────────

var narrativeNoise = compileFolded(
	`\bmy name is\b`, `\bje m'appelle\b`, `\bnaitwa\b`, `\bjina langu\b`, `\bnkombo\b`, `\bpolicy\b`, `\bpolice (number|n)\b`, `\bnumero de police\b`,
	`\b(i )?(need|want|would like) to (make|file|submit|report|open|declare) (a |an )?(claim|accident)\b`, `\bje (veux|voudrais|souhaite) declarer\b`, `^\s*(hi|hello|hey|bonjour|bonsoir|mbote|habari|hola|ola)\b[ ,!.]*$`, `\bthis is ridiculous\b`,
)

// conciseSummary shortens the customer's account of what happened to the
// clauses that describe the event (at most ~30 words), in their own words.
// narrativePreamble is a lead-in before a colon ("Hello again, I need to
// report a new incident: …"), not part of what happened.
var narrativePreamble = regexp.MustCompile(`(?i)^[^:]{0,80}\b(incident|claim|accident|report|declare|sinistre|déclarer|signaler|nouveau|new)\b[^:]{0,40}:\s*`)

func conciseSummary(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	var event, other []string
	for _, line := range strings.Split(text, "\n") {
		for _, s := range regexp.MustCompile(`[.!?;]+\s*`).Split(line, -1) {
			s = strings.TrimSpace(narrativePreamble.ReplaceAllString(s, ""))
			if len(strings.Fields(s)) < 3 || narrativeNoise.MatchString(foldText(s)) {
				continue
			}
			if eventWordPattern.MatchString(s) {
				event = append(event, s)
			} else {
				other = append(other, s)
			}
		}
	}
	parts := event
	if len(parts) == 0 {
		parts = other
	}
	if len(parts) == 0 {
		parts = []string{text}
	}
	var words []string
	for _, p := range parts {
		if len(words) > 0 && len(words)+len(strings.Fields(p)) > 30 {
			break
		}
		if len(words) > 0 {
			words[len(words)-1] += "."
		}
		words = append(words, strings.Fields(p)...)
	}
	if len(words) > 30 {
		words = append(words[:30], "…")
	}
	out := strings.Join(words, " ")
	if r := []rune(out); len(r) > 0 && unicode.IsLower(r[0]) {
		r[0] = unicode.ToUpper(r[0])
		out = string(r)
	}
	return out
}
