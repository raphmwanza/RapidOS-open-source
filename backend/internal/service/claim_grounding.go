package service

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// Grounding: every value the LLM extracts for a claim must be supported by
// what the CUSTOMER wrote. Values that cannot be found in the customer's
// messages (hallucinated policy numbers, plates, dates, names…) are dropped
// before the claim is summarised or created.

type fieldKind int

const (
	kindText fieldKind = iota
	kindID
	kindPhone
	kindEmail
	kindDate
	kindTime
	kindNumber
	kindBool
)

func classifyField(f CoverageField) fieldKind {
	t := strings.ToLower(strings.TrimSpace(f.Type))
	name := strings.ToLower(f.Name)
	switch t {
	case "boolean", "bool", "checkbox", "yesno", "yes_no", "toggle":
		return kindBool
	case "date", "datetime":
		return kindDate
	case "time":
		return kindTime
	case "email":
		return kindEmail
	case "phone", "tel", "telephone":
		return kindPhone
	case "number", "integer", "int", "decimal", "currency", "amount", "money", "float":
		return kindNumber
	}
	switch {
	case strings.Contains(name, "email"):
		return kindEmail
	case strings.Contains(name, "phone"):
		return kindPhone
	case strings.HasSuffix(name, "date") || strings.Contains(name, "birthdate"):
		return kindDate
	case strings.HasSuffix(name, "time"):
		return kindTime
	case strings.Contains(name, "year") || strings.Contains(name, "cost") || strings.Contains(name, "amount"):
		return kindNumber
	case strings.Contains(name, "number") || strings.Contains(name, "registration") || strings.Contains(name, "plate") || strings.Contains(name, "vin") || strings.Contains(name, "licen") || strings.Contains(name, "reference"):
		return kindID
	}
	return kindText
}

// isOwnPhoneField reports whether the field is the insured's own phone, which
// always comes from the WhatsApp sender number.
func isOwnPhoneField(f CoverageField) bool {
	n := strings.ToLower(f.Name)
	if classifyField(f) != kindPhone {
		return false
	}
	for _, other := range []string{"other", "witness", "third", "driver", "emergency", "contact"} {
		if strings.Contains(n, other) {
			return false
		}
	}
	return true
}

func isNameField(f CoverageField) bool {
	n := strings.ToLower(f.Name)
	switch n {
	case "insuredfullname", "patientname", "ownername", "fullname", "name", "customername", "insuredname", "policyholdername":
		return true
	}
	return false
}

// groundingCorpus is the customer's side of the claim conversation.
type groundingCorpus struct {
	folded   string          // accent-folded lower-case text
	ids      string          // upper-case alphanumerics only
	numbers  map[string]bool // every number written by the customer
	tokens   map[string]bool // folded word tokens
	answered []string        // assistant questions that got a short, direct customer answer
	boolText string          // folded user text without "policy" phrases (FR "police" = policy)
	now      time.Time
}

var numberRun = regexp.MustCompile(`\d[\d,.' ]*\d|\d`)

func newGroundingCorpus(session []ChatMessage, now time.Time) *groundingCorpus {
	c := &groundingCorpus{numbers: map[string]bool{}, tokens: map[string]bool{}, now: now}
	var user []string
	for i, m := range session {
		if m.Role != "user" {
			continue
		}
		user = append(user, m.Content)
		if i > 0 && session[i-1].Role == "assistant" && len(wordTokens(foldText(m.Content))) <= 8 {
			c.answered = append(c.answered, stripPolicyPhrases(foldText(session[i-1].Content)))
		}
	}
	text := strings.Join(user, "\n")
	c.folded = foldText(text)
	c.boolText = stripPolicyPhrases(c.folded)
	c.ids = normalizeID(text)
	for _, run := range numberRun.FindAllString(text, -1) {
		// "5,000" / "5 000" / "5.000,50" -> "5000"; also keep each part.
		clean := strings.NewReplacer(",", "", " ", "", "'", "").Replace(run)
		if i := strings.Index(clean, "."); i >= 0 && len(clean)-i-1 <= 2 {
			clean = clean[:i]
		}
		clean = strings.ReplaceAll(clean, ".", "")
		c.numbers[strings.TrimLeft(clean, "0")] = true
		for _, part := range regexp.MustCompile(`\d+`).FindAllString(run, -1) {
			c.numbers[strings.TrimLeft(part, "0")] = true
		}
	}
	for _, tok := range wordTokens(c.folded) {
		c.tokens[tok] = true
	}
	return c
}

func wordTokens(folded string) []string {
	return strings.FieldsFunc(folded, func(r rune) bool { return !(unicode.IsLetter(r) || unicode.IsDigit(r)) })
}

var nonAlnum = regexp.MustCompile(`[^A-Z0-9]+`)

// normalizeID keeps upper-case letters and digits only ("kda 123-a" -> "KDA123A").
func normalizeID(s string) string {
	return nonAlnum.ReplaceAllString(strings.ToUpper(foldText(s)), "")
}

var placeholderValues = map[string]bool{
	"unknown": true, "n/a": true, "na": true, "none": true, "null": true, "nil": true, "-": true, "?": true, "tbd": true, "example": true,
	"not provided": true, "not specified": true, "not mentioned": true, "not given": true, "not available": true, "unspecified": true,
	"inconnu": true, "inconnue": true, "non precise": true, "non specifie": true, "non renseigne": true, "aucun": true, "aucune": true,
	"desconocido": true, "no especificado": true, "nao informado": true, "desconhecido": true, "haijulikani": true, "hakuna": true,
}

// weak words never count as evidence for free text.
var groundingStopwords = func() map[string]bool {
	m := map[string]bool{}
	for _, words := range languageStopwords {
		for _, w := range words {
			m[foldText(w)] = true
		}
	}
	for _, w := range []string{"customer", "vehicle", "car", "claim", "incident", "damage", "the", "and", "was", "were", "his", "her", "their", "has", "had", "one", "two"} {
		m[w] = true
	}
	return m
}()

var topicSynonyms = map[string][]string{
	"injur":   {"injur", "hurt", "wound", "bless", "herid", "lesion", "ferid", "jeruh", "umia", "majeruhi", "pain", "douleur", "dolor", "dor"},
	"police":  {"polic", "polis", "gendarm", "policia", "askari"},
	"receipt": {"receipt", "recu", "factur", "recibo", "stakabadhi", "risiti", "invoice", "bill", "nota"},
	"witness": {"witness", "temoin", "testigo", "testemunha", "shahidi"},
	"tow":     {"tow", "remorq", "grua", "reboque", "depanneu"},
	"medical": {"medic", "hospital", "hopital", "doctor", "docteur", "medecin", "clinic", "daktari", "hospitali", "matibabu", "soins", "traitement"},
}

// topicKeywords returns folded stems that show the customer talked about the
// subject of a yes/no field.
func topicKeywords(f CoverageField) []string {
	words := splitIdentifier(f.Name)
	words = append(words, wordTokens(foldText(f.Label))...)
	var out []string
	for _, w := range words {
		w = foldText(w)
		if len(w) < 4 || groundingStopwords[w] {
			continue
		}
		switch w {
		case "occurred", "required", "available", "contacted", "made", "reported", "involved", "done":
			continue
		}
		stem := w
		if len(stem) > 5 {
			stem = stem[:5]
		}
		out = append(out, stem)
		for key, syn := range topicSynonyms {
			if strings.HasPrefix(w, key) || strings.HasPrefix(key, stem) {
				out = append(out, syn...)
			}
		}
	}
	return out
}

func splitIdentifier(s string) []string {
	var words []string
	var cur []rune
	for i, r := range s {
		if (unicode.IsUpper(r) && i > 0) || r == '_' || r == '-' || r == ' ' {
			if len(cur) > 0 {
				words = append(words, strings.ToLower(string(cur)))
			}
			cur = nil
			if r == '_' || r == '-' || r == ' ' {
				continue
			}
		}
		cur = append(cur, r)
	}
	if len(cur) > 0 {
		words = append(words, strings.ToLower(string(cur)))
	}
	return words
}

// groundValue returns the normalised value and whether the customer's
// messages support it.
func (c *groundingCorpus) groundValue(f CoverageField, v interface{}) (interface{}, bool) {
	if v == nil {
		return nil, false
	}
	kind := classifyField(f)
	if kind == kindBool {
		b, ok := toBool(v)
		if !ok {
			return nil, false
		}
		for _, kw := range topicKeywords(f) {
			if strings.Contains(c.boolText, kw) {
				return b, true
			}
			for _, q := range c.answered {
				if strings.Contains(q, kw) {
					return b, true
				}
			}
		}
		return nil, false
	}

	s := strings.TrimSpace(fmt.Sprint(v))
	if f64, ok := v.(float64); ok {
		if f64 == math.Trunc(f64) {
			s = strconv.FormatInt(int64(f64), 10)
		}
	}
	if s == "" || placeholderValues[foldText(s)] {
		return nil, false
	}
	switch kind {
	case kindPhone:
		d := digitsOnly(s)
		if len(d) >= 6 && strings.Contains(digitsOnly(c.folded), d) {
			return d, true
		}
		return nil, false
	case kindEmail:
		e := strings.ToLower(s)
		if strings.Contains(e, "@") && strings.Contains(c.folded, foldText(e)) {
			return e, true
		}
		return nil, false
	case kindID:
		id := normalizeID(s)
		if len(id) >= 2 && strings.Contains(c.ids, id) {
			// "DEMO-2026-0144:" / "KN-4521-AB." -> no trailing punctuation.
			return strings.Trim(s, " \t.,;:!?-_/()\"'"), true
		}
		return nil, false
	case kindNumber:
		n := strings.TrimLeft(strings.ReplaceAll(strings.ReplaceAll(s, ",", ""), " ", ""), "0")
		if i := strings.Index(n, "."); i >= 0 {
			n = n[:i]
		}
		if n != "" && c.numbers[n] {
			if f64, err := strconv.ParseFloat(n, 64); err == nil {
				return f64, true
			}
		}
		return nil, false
	case kindDate:
		d, ok := parseClaimDate(s)
		if !ok {
			return nil, false
		}
		resolved, ok := c.resolveDate(d)
		if !ok {
			return nil, false
		}
		return resolved.Format("2006-01-02"), true
	case kindTime:
		h, m, ok := parseClockTime(s)
		if !ok {
			return nil, false
		}
		if c.numbers[strings.TrimLeft(strconv.Itoa(h), "0")] || (h > 12 && c.numbers[strconv.Itoa(h-12)]) || (h == 0 && c.numbers["12"]) {
			return fmt.Sprintf("%02d:%02d", h, m), true
		}
		return nil, false
	}
	// Free text: its meaningful words must come from the customer.
	if c.textSupported(s, isDescriptionField(f)) {
		return s, true
	}
	return nil, false
}

func isDescriptionField(f CoverageField) bool {
	n := strings.ToLower(f.Name)
	t := strings.ToLower(f.Type)
	return t == "textarea" || strings.Contains(n, "description") || strings.Contains(n, "details") || strings.Contains(n, "cause") || strings.Contains(n, "notes")
}

func (c *groundingCorpus) textSupported(value string, description bool) bool {
	folded := foldText(value)
	if strings.Contains(c.folded, folded) {
		return true
	}
	var content []string
	for _, tok := range wordTokens(folded) {
		if groundingStopwords[tok] || (len([]rune(tok)) < 3 && !isDigits(tok)) {
			continue
		}
		content = append(content, tok)
	}
	if len(content) == 0 {
		return false
	}
	hits := 0
	for _, tok := range content {
		if c.hasToken(tok) {
			hits++
		}
	}
	ratio := float64(hits) / float64(len(content))
	switch {
	case len(content) <= 4:
		return hits == len(content)
	case description:
		return ratio >= 0.5
	default:
		return ratio >= 0.6
	}
}

func (c *groundingCorpus) hasToken(tok string) bool {
	if c.tokens[tok] {
		return true
	}
	if isDigits(tok) {
		return c.numbers[strings.TrimLeft(tok, "0")]
	}
	r := []rune(tok)
	if len(r) < 4 {
		return false
	}
	prefix := string(r[:minInt(len(r), 5)])
	for t := range c.tokens {
		if strings.HasPrefix(t, prefix) || (len([]rune(t)) >= 4 && strings.HasPrefix(tok, t)) {
			return true
		}
		// customers make typos ("scrached" for "scratched")
		if len(r) >= 5 && len([]rune(t)) >= 4 && levenshtein1(tok, t) {
			return true
		}
	}
	return false
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func toBool(v interface{}) (bool, bool) {
	switch x := v.(type) {
	case bool:
		return x, true
	case string:
		switch foldText(strings.TrimSpace(x)) {
		case "true", "yes", "oui", "si", "sim", "ndiyo", "ndio", "1", "y":
			return true, true
		case "false", "no", "non", "nao", "hapana", "0", "n":
			return false, true
		}
	case float64:
		return x != 0, true
	}
	return false, false
}

var leadingYesNoPattern = regexp.MustCompile(`^\s*(yes|yeah|yep|yup|sure|of course|oui|ouais|bien sur|si|sim|claro|ndiyo|ndio|no|nope|non|nao|hapana|pas du tout)\b`)

// leadingYesNo reads a reply that starts with yes or no ("Yes, I have the
// receipt", "Non, pas encore").
func leadingYesNo(text string) (bool, bool) {
	m := leadingYesNoPattern.FindStringSubmatch(foldText(text))
	if m == nil {
		return false, false
	}
	switch m[1] {
	case "no", "nope", "non", "nao", "hapana", "pas du tout":
		return false, true
	}
	return true, true
}

// ── dates ────────────────────────────────────────────────────────────────

var dateLayouts = []string{"2006-01-02", "2006/01/02", "02/01/2006", "2/1/2006", "02-01-2006", "02.01.2006", "January 2, 2006", "2 January 2006", "Jan 2, 2006", "2006-01-02T15:04:05Z07:00", "2006-01-02 15:04"}

func parseClaimDate(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	for _, l := range dateLayouts {
		if t, err := time.Parse(l, s); err == nil {
			return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), true
		}
	}
	return time.Time{}, false
}

var clockPattern = regexp.MustCompile(`^(\d{1,2})(?:[:hH.](\d{2}))?\s*(am|pm|AM|PM)?$`)

func parseClockTime(s string) (int, int, bool) {
	m := clockPattern.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return 0, 0, false
	}
	h, _ := strconv.Atoi(m[1])
	min := 0
	if m[2] != "" {
		min, _ = strconv.Atoi(m[2])
	}
	if strings.EqualFold(m[3], "pm") && h < 12 {
		h += 12
	}
	if h > 23 || min > 59 {
		return 0, 0, false
	}
	return h, min, true
}

// relative day words -> offset in days from today.
var relativeDayWords = []struct {
	pattern *regexp.Regexp
	offset  int
}{
	{compileFolded(`\bday before yesterday\b`, `\bavant[- ]hier\b`, `\banteayer\b`, `\banteontem\b`, `\bjuzi\b`, `\bkemarin lusa\b`), -2},
	{compileFolded(`\byesterday\b`, `\bhier\b`, `\bayer\b`, `\bontem\b`, `\bjana\b`, `\blobi\b`, `\bkemarin\b`, `\bkahapon\b`, `\bjiya\b`), -1},
	{compileFolded(`\btoday\b`, `\bthis (morning|afternoon|evening)\b`, `\btonight\b`, `\baujourd'hui\b`, `\bce (matin|soir)\b`, `\bcet apres-midi\b`, `\bhoy\b`, `\besta (manana|tarde|noche)\b`, `\bhoje\b`, `\besta (manha|tarde|noite)\b`, `\bleo\b`, `\blelo\b`, `\bhari ini\b`, `\bngayon\b`, `\byau\b`, `\bloni\b`), 0},
}

var monthNames = map[time.Month][]string{
	time.January:   {"january", "jan", "janvier", "janv", "enero", "janeiro", "januari"},
	time.February:  {"february", "feb", "fevrier", "fevr", "febrero", "fevereiro", "februari"},
	time.March:     {"march", "mar", "mars", "marzo", "marco", "machi", "maret"},
	time.April:     {"april", "apr", "avril", "avr", "abril", "aprili"},
	time.May:       {"may", "mai", "mayo", "maio", "mei"},
	time.June:      {"june", "jun", "juin", "junio", "junho", "juni"},
	time.July:      {"july", "jul", "juillet", "juil", "julio", "julho", "julai", "juli"},
	time.August:    {"august", "aug", "aout", "agosto", "agosti", "agustus"},
	time.September: {"september", "sep", "sept", "septembre", "septiembre", "setembro", "septemba"},
	time.October:   {"october", "oct", "octobre", "octubre", "outubro", "oktoba", "oktober"},
	time.November:  {"november", "nov", "novembre", "noviembre", "novembro", "novemba"},
	time.December:  {"december", "dec", "decembre", "diciembre", "dezembro", "desemba", "desember"},
}

var weekdayNames = map[time.Weekday][]string{
	time.Monday:    {"monday", "lundi", "lunes", "segunda", "jumatatu", "senin"},
	time.Tuesday:   {"tuesday", "mardi", "martes", "terca", "jumanne", "selasa"},
	time.Wednesday: {"wednesday", "mercredi", "miercoles", "quarta", "jumatano", "rabu"},
	time.Thursday:  {"thursday", "jeudi", "jueves", "quinta", "alhamisi", "kamis"},
	time.Friday:    {"friday", "vendredi", "viernes", "sexta", "ijumaa", "jumat"},
	time.Saturday:  {"saturday", "samedi", "sabado", "jumamosi", "sabtu"},
	time.Sunday:    {"sunday", "dimanche", "domingo", "jumapili", "minggu"},
}

// resolveDate checks a date proposed by the model against what the customer
// wrote and returns the date they meant: relative words ("yesterday", "hier",
// "jana") give the exact day, weekdays and day+month must match. Future dates
// are rejected.
func (c *groundingCorpus) resolveDate(d time.Time) (time.Time, bool) {
	today := c.today()
	best, bestDiff := time.Time{}, math.MaxFloat64
	for _, rw := range relativeDayWords {
		if !rw.pattern.MatchString(c.folded) {
			continue
		}
		cand := today.AddDate(0, 0, rw.offset)
		diff := math.Abs(d.Sub(cand).Hours() / 24)
		if diff <= 1 && diff < bestDiff {
			best, bestDiff = cand, diff
		}
	}
	if !best.IsZero() {
		return best, true
	}
	if d.After(today) {
		return time.Time{}, false // an incident cannot be in the future
	}
	if c.dateSupported(d) {
		return d, true
	}
	return time.Time{}, false
}

func (c *groundingCorpus) today() time.Time {
	return time.Date(c.now.Year(), c.now.Month(), c.now.Day(), 0, 0, 0, 0, time.UTC)
}

// mentionedDate returns the incident date when the customer's messages name
// exactly one day (a relative word or a day+month), for a missing date field.
func (c *groundingCorpus) mentionedDate() (time.Time, bool) {
	today := c.today()
	found := map[string]time.Time{}
	for _, rw := range relativeDayWords {
		if rw.pattern.MatchString(c.folded) {
			d := today.AddDate(0, 0, rw.offset)
			found[d.Format("2006-01-02")] = d
		}
	}
	for _, m := range dayMonthPattern.FindAllStringSubmatch(c.folded, -1) {
		day, _ := strconv.Atoi(m[1])
		for month, names := range monthNames {
			for _, n := range names {
				if n == m[2] && day >= 1 && day <= 31 {
					y := today.Year()
					d := time.Date(y, month, day, 0, 0, 0, 0, time.UTC)
					if d.After(today) {
						d = d.AddDate(-1, 0, 0)
					}
					found[d.Format("2006-01-02")] = d
				}
			}
		}
	}
	if len(found) != 1 {
		return time.Time{}, false
	}
	for _, d := range found {
		return d, true
	}
	return time.Time{}, false
}

var dayMonthPattern = regexp.MustCompile(`\b(\d{1,2})(?:st|nd|rd|th|er)?\s+(?:de\s+)?([a-z]{3,10})\b`)

func (c *groundingCorpus) dateSupported(d time.Time) bool {
	today := c.today()
	if d.After(today) {
		return false
	}
	if today.Sub(d).Hours() <= 8*24 {
		for _, name := range weekdayNames[d.Weekday()] {
			if c.tokens[name] {
				return true
			}
		}
	}
	day := strconv.Itoa(d.Day())
	if !c.numbers[day] {
		// "1st", "2nd", "23rd", "le 1er"
		ordinal := regexp.MustCompile(`\b` + day + `(st|nd|rd|th|er|e|eme)\b`)
		if !ordinal.MatchString(c.folded) {
			return false
		}
	}
	if c.numbers[strconv.Itoa(int(d.Month()))] {
		return true
	}
	for _, name := range monthNames[d.Month()] {
		if c.tokens[name] {
			return true
		}
	}
	return false
}

// policyPhrases are removed before looking for yes/no topics: in French
// "police" also means an insurance policy ("numéro de police").
var policyPhrases = regexp.MustCompile(`(num(e|é)ro|n°|no|num)\.?\s+de\s+(la\s+)?police|police\s+d'assurance|police\s+(number|no)|ma\s+police|votre\s+police|policy|policies|polcy|polizza`)

func stripPolicyPhrases(folded string) string {
	return policyPhrases.ReplaceAllString(folded, " ")
}

// levenshtein1 reports whether a and b differ by at most one edit.
func levenshtein1(a, b string) bool {
	ra, rb := []rune(a), []rune(b)
	if len(ra) < len(rb) {
		ra, rb = rb, ra
	}
	if len(ra)-len(rb) > 1 {
		return false
	}
	i, j, edits := 0, 0, 0
	for i < len(ra) && j < len(rb) {
		if ra[i] == rb[j] {
			i++
			j++
			continue
		}
		edits++
		if edits > 1 {
			return false
		}
		if len(ra) == len(rb) {
			j++
		}
		i++
	}
	return edits+(len(ra)-i) <= 1
}
