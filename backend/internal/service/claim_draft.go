package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"rapidos/internal/ai"
)

// ClaimDraft is the claim being collected on WhatsApp. It only ever contains
// values grounded in the customer's own messages. It is stored in the metadata
// of the assistant messages so the next turn (and the confirmation step) can
// continue from it.
type ClaimDraft struct {
	TypeName       string                 `json:"typeName"`
	DisplayName    string                 `json:"displayName"`
	Fields         map[string]interface{} `json:"fields"`
	MissingNames   []string               `json:"missingNames,omitempty"`
	Missing        []string               `json:"missing,omitempty"` // labels
	Dropped        []string               `json:"dropped,omitempty"`
	ExtractionMode string                 `json:"extractionMode,omitempty"`

	// Several incidents in one chat: the other incident types still to
	// file (in order), the types already handled in this chat (their facts
	// are never used here) and the customer's earlier words about this
	// incident (for a queued claim).
	Queue          []string `json:"queue,omitempty"`
	Others         []string `json:"others,omitempty"`
	QueueAnnounced bool     `json:"queueAnnounced,omitempty"`
	Context        string   `json:"context,omitempty"`

	// The incident date field; an approximate date keeps the customer's own
	// words ("peut-être mardi ou mercredi passé") and the approximate flag.
	DateField       string `json:"dateField,omitempty"`
	DateApproximate bool   `json:"dateApproximate,omitempty"`
	DateText        string `json:"dateText,omitempty"`
	DateAttempts    int    `json:"dateAttempts,omitempty"`
	DateOffered     bool   `json:"dateOffered,omitempty"`

	// FromProfile lists fields taken from the customer's file (to confirm).
	FromProfile []string `json:"fromProfile,omitempty"`
	// AskedFields are the fields the last reply asked for.
	AskedFields []string `json:"askedFields,omitempty"`
}

// dateMissing reports whether the incident date is still unknown (neither an
// exact date nor an accepted approximate one).
func (d *ClaimDraft) dateMissing() bool {
	if d == nil || d.DateField == "" || d.DateApproximate {
		return false
	}
	for _, n := range d.MissingNames {
		if n == d.DateField {
			return true
		}
	}
	return false
}

func (d *ClaimDraft) asked(name string) bool {
	return d != nil && containsFold(d.AskedFields, name)
}

// Complete reports whether every required (non-media) field is filled.
func (d *ClaimDraft) Complete() bool {
	return d != nil && d.TypeName != "" && len(d.MissingNames) == 0
}

// ClaimDraftRequest is the input of PrepareClaimDraft.
type ClaimDraftRequest struct {
	CompanyID     string
	WhatsAppPhone string
	CustomerName  string
	// Session is the claim conversation (user and assistant turns, oldest first).
	Session []ChatMessage
	// AllUserText is every customer message we know (used to validate the
	// customer's profile name when it was given before this claim).
	AllUserText string
	Previous    *ClaimDraft
	// CurrentMessage is the customer's latest message.
	CurrentMessage string
	// CustomerPolicy is the policy number on the customer's file; it is
	// proposed for a new claim (and shown for confirmation in the summary).
	CustomerPolicy string
}

const claimExtractionToolName = "extract_claim_data"

// defaultCoverage is used when a company has not configured claim types.
func defaultCoverage() []CoverageInfo {
	return []CoverageInfo{{TypeName: "OTHER", DisplayName: "Claim", Fields: []CoverageField{
		{Name: "insuredFullName", Label: "Full name", Type: "text", Required: true},
		{Name: "phoneNumber", Label: "Phone number", Type: "phone", Required: true},
		{Name: "policyNumber", Label: "Policy number", Type: "text"},
		{Name: "incidentDate", Label: "Date of the incident", Type: "date", Required: true},
		{Name: "incidentLocation", Label: "Place of the incident", Type: "text", Required: true},
		{Name: "incidentDescription", Label: "What happened", Type: "textarea", Required: true},
	}}}
}

func infoFields(ct CoverageInfo) []CoverageField {
	var out []CoverageField
	for _, f := range ct.Fields {
		if f.IsPhoto() || f.IsDocument() {
			continue
		}
		out = append(out, f)
	}
	return out
}

// claimTypeKeywords are multilingual hints per standard claim category.
var claimTypeKeywords = map[string][]string{
	"AUTO":   {"car", "vehicle", "accident", "collision", "crash", "crashed", "hit", "truck", "motorbike", "motorcycle", "plate", "voiture", "vehicule", "auto", "moto", "camion", "percute", "carro", "coche", "choque", "batida", "gari", "ajali", "motuka", "mobil", "kotse", "mota", "bus", "matatu", "taxi", "driver", "conducteur", "road", "route"},
	"HEALTH": {"health", "hospital", "doctor", "clinic", "medical", "treatment", "sick", "illness", "surgery", "sante", "hopital", "medecin", "malade", "soins", "salud", "medico", "enfermo", "saude", "doente", "hospitali", "daktari", "matibabu", "afya", "mgonjwa", "ugonjwa", "consultation", "pharmacy", "pharmacie"},
	"HOME":   {"house", "home", "flood", "fire", "burglary", "burgled", "theft", "stolen", "roof", "leak", "water damage", "maison", "habitation", "incendie", "inondation", "cambriol", "vol", "toit", "fuite", "casa", "hogar", "incendio", "robo", "inundacion", "roubo", "nyumba", "mafuriko", "wizi", "moto ulishika", "ndako", "apartment", "appartement", "property"},
	"TRAVEL": {"travel", "trip", "flight", "luggage", "baggage", "voyage", "vol annule", "bagage", "viaje", "vuelo", "equipaje", "viagem", "bagagem", "safari", "mizigo", "ndege"},
	"LIFE":   {"death", "deceased", "died", "passed away", "deces", "decede", "muerte", "morte", "kifo", "alifariki"},
	"FIRE":   {"fire", "incendie", "incendio", "moto"},
}

// chooseClaimType picks the coverage type the customer talks about. The
// previous choice is kept unless another type is clearly more likely.
func chooseClaimType(coverage []CoverageInfo, userText string, previous, modelGuess string) *CoverageInfo {
	if len(coverage) == 0 {
		return nil
	}
	folded := " " + foldText(userText) + " "
	tokens := map[string]bool{}
	for _, t := range wordTokens(folded) {
		tokens[t] = true
	}
	score := func(ct CoverageInfo) int {
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
	bestIdx, bestScore, prevIdx := -1, 0, -1
	for i, ct := range coverage {
		if strings.EqualFold(ct.TypeName, previous) {
			prevIdx = i
		}
		if sc := score(ct); sc > bestScore {
			bestIdx, bestScore = i, sc
		}
	}
	if prevIdx >= 0 {
		if bestIdx < 0 || bestIdx == prevIdx || bestScore < score(coverage[prevIdx])+2 {
			return &coverage[prevIdx]
		}
	}
	if bestIdx >= 0 {
		return &coverage[bestIdx]
	}
	for i, ct := range coverage {
		if modelGuess != "" && strings.EqualFold(ct.TypeName, modelGuess) {
			return &coverage[i]
		}
	}
	if len(coverage) == 1 {
		return &coverage[0]
	}
	return nil
}

// claimExtractionTool builds the extraction tool from the company's coverage.
// Descriptions are neutral: no example values the model could copy.
func claimExtractionTool(coverage []CoverageInfo) ai.ToolDefinition {
	props := map[string]interface{}{}
	var typeNames []string
	for _, ct := range coverage {
		typeNames = append(typeNames, ct.TypeName)
		for _, f := range infoFields(ct) {
			if isOwnPhoneField(f) {
				continue // always the WhatsApp number
			}
			if _, ok := props[f.Name]; ok {
				continue
			}
			label := strings.TrimSpace(f.Label)
			if label == "" {
				label = strings.Join(splitIdentifier(f.Name), " ")
			}
			prop := map[string]interface{}{"type": "string"}
			switch classifyField(f) {
			case kindBool:
				prop["type"] = "boolean"
				prop["description"] = label + ". Only if the customer answered this."
			case kindNumber:
				prop["type"] = "number"
				prop["description"] = label + ". Digits only, as the customer wrote it."
			case kindDate:
				prop["description"] = label + ". Format YYYY-MM-DD."
			case kindTime:
				prop["description"] = label + ". Format HH:MM (24h)."
			case kindID, kindEmail, kindPhone:
				prop["description"] = label + ". Copy exactly as the customer wrote it."
			default:
				prop["description"] = label + ". In the customer's own words."
			}
			props[f.Name] = prop
		}
	}
	sort.Strings(typeNames)
	props["claimType"] = map[string]interface{}{"type": "string", "enum": typeNames, "description": "Coverage type the claim is about."}
	return ai.ToolDefinition{
		Name:        claimExtractionToolName,
		Description: "Record the claim information the customer has given so far. Leave out every field the customer did not state.",
		Parameters:  map[string]interface{}{"type": "object", "properties": props, "required": []string{"claimType"}},
	}
}

func claimExtractionSystemPrompt(now time.Time) string {
	return claimExtractionSystemPromptFor(now, nil, nil)
}

// claimExtractionSystemPromptFor adds the incident focus when the customer
// reported several incidents.
func claimExtractionSystemPromptFor(now time.Time, focus *CoverageInfo, others []string) string {
	p := claimExtractionBasePrompt(now)
	if focus != nil && len(others) > 0 {
		p += fmt.Sprintf("\nThe customer reported several separate incidents. This claim is ONLY about the %s incident (%s). Ignore every fact about the other incident(s) (%s): never copy their dates, places, damage or policy numbers into this claim.", focus.DisplayName, focus.TypeName, strings.Join(others, ", "))
	}
	return p
}

func claimExtractionBasePrompt(now time.Time) string {
	today := now.UTC()
	return fmt.Sprintf(`You extract insurance claim information from a WhatsApp conversation between a CUSTOMER (user) and an insurance assistant.
Rules:
- Use ONLY facts the customer stated in their own messages. The assistant's messages only show what was asked.
- If the customer did not give a value, leave the field out. Never guess. Never use placeholders, examples or default values. Never invent names, numbers, plates, dates or places.
- Copy names, policy numbers, plates and places exactly as the customer wrote them. Keep descriptions in the customer's words and language; do not translate.
- Dates must be YYYY-MM-DD. Today is %s (%s); yesterday was %s.
- A yes/no field is only filled when the customer clearly answered it.
- Names are people's names only: never a vehicle ("a taxi", "a truck"), a role ("the driver") or an ordinary word.
- A description field is a short summary (one or two sentences) of the facts, in the customer's language.
- When the customer corrects something, use the corrected value everywhere it applies (e.g. a different vehicle also changes its year and plate).
Call the %s tool with what you found.`, today.Format("2006-01-02"), today.Weekday(), today.AddDate(0, 0, -1).Format("2006-01-02"), claimExtractionToolName)
}

// PrepareClaimDraft extracts the claim fields from the conversation with the
// company's LLM, drops every value the customer did not actually give, merges
// the result with the previous draft and lists what is still missing.
func (s *SemanticKernelService) PrepareClaimDraft(ctx context.Context, req ClaimDraftRequest) (*ClaimDraft, error) {
	coverage := defaultCoverage()
	if s.dbSvc != nil && req.CompanyID != "" {
		if c, err := s.dbSvc.GetCompanyCoverage(req.CompanyID); err == nil && len(c) > 0 {
			coverage = c
		} else if err != nil {
			s.log.Warnf("⚠️ [CLAIM DRAFT] Coverage unavailable for company %s: %v", req.CompanyID, err)
		}
	}
	prev := req.Previous
	session := req.Session
	if prev != nil && strings.TrimSpace(prev.Context) != "" {
		// A queued incident: what the customer said about it before the
		// previous claim was filed.
		session = append([]ChatMessage{{Role: "user", Content: prev.Context}}, session...)
	}
	var rawUser []string
	for _, m := range session {
		if m.Role == "user" {
			rawUser = append(rawUser, m.Content)
		}
	}
	rawUserText := strings.Join(rawUser, "\n")

	// Several incidents: file one at a time, never mixing their facts.
	var focus *CoverageInfo
	var queue, others []string
	announced := false
	switch {
	case prev != nil && prev.TypeName != "" && (len(prev.Queue) > 0 || len(prev.Others) > 0):
		focus = coverageFor(coverage, prev.TypeName)
		queue, others, announced = append([]string(nil), prev.Queue...), append([]string(nil), prev.Others...), prev.QueueAnnounced
	case prev == nil || prev.TypeName == "":
		if types := detectIncidentTypes(coverage, rawUserText); len(types) >= 2 {
			focus = coverageFor(coverage, types[0])
			queue = types[1:]
			s.log.Infof("🧩 [MULTI-INCIDENT] %d incidents %v: filing %s first", len(types), types, types[0])
		}
	}
	notMine := append(append([]string(nil), queue...), others...)
	if focus != nil && len(notMine) > 0 {
		var filtered []ChatMessage
		for _, m := range session {
			if m.Role == "user" {
				if t := focusIncidentText(coverage, m.Content, focus.TypeName, notMine); strings.TrimSpace(t) != "" {
					filtered = append(filtered, ChatMessage{Role: m.Role, Content: t, Timestamp: m.Timestamp})
				}
				continue
			}
			filtered = append(filtered, m)
		}
		session = filtered
	}
	var userParts []string
	for _, m := range session {
		if m.Role == "user" {
			userParts = append(userParts, m.Content)
		}
	}
	userText := strings.Join(userParts, "\n")

	provider, err := s.providerForCompany(req.CompanyID)
	if err != nil {
		return nil, err
	}
	tool := claimExtractionTool(coverage)
	var msgs []ai.ChatMessage
	for _, m := range session {
		role := m.Role
		if role != "user" && role != "assistant" {
			continue
		}
		if strings.TrimSpace(m.Content) == "" {
			continue
		}
		msgs = append(msgs, ai.ChatMessage{Role: role, Content: m.Content})
	}
	ctx, cancel := s.llmTimeout(ctx)
	defer cancel()
	args, mode, extractErr := ai.ExtractToolArgumentsWithMode(ctx, provider, ai.CompletionRequest{
		SystemPrompt: claimExtractionSystemPromptFor(s.now(), focus, notMine),
		Messages:     msgs,
		Prompt:       "Extract the claim information the customer gave in the conversation above.",
		Tools:        []ai.ToolDefinition{tool},
		Temperature:  0.1,
		MaxTokens:    900,
	}, tool)
	if extractErr != nil {
		s.log.Warnf("⚠️ [CLAIM EXTRACTION] mode=%s failed: %v", mode, extractErr)
		args = map[string]interface{}{} // previous draft fields are still merged below
	} else {
		s.log.Infof("🧩 [CLAIM EXTRACTION] mode=%s fields=%d", mode, len(args))
	}

	modelType, _ := args["claimType"].(string)
	prevType := ""
	if prev != nil {
		prevType = prev.TypeName
	}
	ct := focus
	if ct == nil {
		ct = chooseClaimType(coverage, userText, prevType, modelType)
	}
	draft := &ClaimDraft{Fields: map[string]interface{}{}, ExtractionMode: mode, Queue: queue, Others: others, QueueAnnounced: announced}
	if prev != nil {
		draft.Context = prev.Context
	}
	if ct == nil {
		// Type not clear yet: the assistant asks which coverage it is about.
		return draft, nil
	}
	draft.TypeName, draft.DisplayName = ct.TypeName, ct.DisplayName
	corpus := newGroundingCorpus(session, s.now())
	fields := infoFields(*ct)
	sameType := prev != nil && strings.EqualFold(prev.TypeName, ct.TypeName)

	if sameType {
		for k, v := range prev.Fields {
			draft.Fields[k] = v
		}
		draft.DateApproximate, draft.DateText, draft.DateAttempts, draft.DateOffered = prev.DateApproximate, prev.DateText, prev.DateAttempts, prev.DateOffered
		draft.FromProfile = append([]string(nil), prev.FromProfile...)
	}
	for _, f := range fields {
		if isOwnPhoneField(f) {
			if e := whatsappE164(req.WhatsAppPhone); e != "" {
				draft.Fields[f.Name] = e
			}
			continue
		}
		raw, ok := args[f.Name]
		if !ok || raw == nil || strings.TrimSpace(fmt.Sprint(raw)) == "" {
			continue
		}
		v, grounded := corpus.groundValue(f, raw)
		if grounded && isPersonNameField(f) {
			if name, valid := cleanPersonName(fmt.Sprint(v)); valid {
				v = name
			} else {
				grounded = false
			}
		}
		if grounded {
			draft.Fields[f.Name] = v
			if f.Name == "policyNumber" {
				draft.FromProfile = removeString(draft.FromProfile, f.Name)
			}
		} else {
			draft.Dropped = append(draft.Dropped, f.Name)
			s.log.Warnf("🛡️ [GROUNDING] Dropped %s=%q: not found in the customer's messages or not valid", f.Name, fmt.Sprint(raw))
		}
	}
	// Previous values of person-name fields are re-validated too (older
	// drafts may hold "a taxi" or "Ezali …").
	for _, f := range fields {
		if !isPersonNameField(f) {
			continue
		}
		if v, ok := draft.Fields[f.Name]; ok {
			if name, valid := cleanPersonName(fmt.Sprint(v)); valid {
				draft.Fields[f.Name] = name
			} else {
				delete(draft.Fields, f.Name)
			}
		}
	}
	// Negation check: "nobody was hurt" / "pas de blessés" / "hakuna
	// aliyejeruhiwa" mentions the topic but means false.
	for _, f := range fields {
		if strings.EqualFold(f.Name, "injuriesOccurred") && draft.Fields[f.Name] == true && noInjuryPattern.MatchString(userText) {
			draft.Fields[f.Name] = false
			s.log.Warnf("🛡️ [GROUNDING] Corrected %s=true to false: the customer said nobody was injured", f.Name)
		}
	}
	// Deterministic fallbacks for what small models often miss; the values
	// come straight from the customer's text.
	for _, name := range backfillFromCustomerText(draft, fields, corpus, userText) {
		s.log.Infof("🧷 [BACKFILL] %s=%v taken from the customer's messages", name, draft.Fields[name])
	}
	for _, name := range answerAskedYesNo(draft, fields, req.Previous, req.CurrentMessage) {
		s.log.Infof("🧷 [BACKFILL] %s=%v taken from the customer's yes/no answer", name, draft.Fields[name])
	}
	// Several policy numbers in the chat ("…0610 for the car and …0611 for
	// the house"): use the one given for this incident, never a guess.
	if hasField(fields, "policyNumber") && len(extractAllPolicyNumbers(rawUserText+"\n"+req.AllUserText)) > 1 {
		if p := policyForIncident(coverage, rawUserText+"\n"+req.AllUserText, ct.TypeName); p != "" {
			draft.Fields["policyNumber"] = p
		} else if v, ok := draft.Fields["policyNumber"]; ok && !strings.Contains(strings.ToUpper(userText), strings.ToUpper(fmt.Sprint(v))) {
			delete(draft.Fields, "policyNumber")
		}
	}
	// The customer's known name, if they did write it themselves.
	for _, f := range fields {
		if !isNameField(f) {
			continue
		}
		if _, ok := draft.Fields[f.Name]; ok {
			continue
		}
		name, valid := cleanPersonName(req.CustomerName)
		if !valid || digitsOnly(name) == digitsOnly(req.WhatsAppPhone) || strings.ContainsAny(name, "0123456789") {
			continue
		}
		allCorpus := newGroundingCorpus([]ChatMessage{{Role: "user", Content: req.AllUserText + "\n" + userText}}, s.now())
		if allCorpus.textSupported(name, false) {
			draft.Fields[f.Name] = name
		}
	}
	// The policy number on the customer's file, for a new claim: shown in
	// the summary with a note so the customer confirms or corrects it.
	if hasField(fields, "policyNumber") {
		if _, ok := draft.Fields["policyNumber"]; !ok {
			if p := strings.TrimSpace(req.CustomerPolicy); p != "" && len(extractAllPolicyNumbers(rawUserText+"\n"+req.AllUserText)) <= 1 {
				draft.Fields["policyNumber"] = p
				if !containsFold(draft.FromProfile, "policyNumber") {
					draft.FromProfile = append(draft.FromProfile, "policyNumber")
				}
			}
		}
	}
	applyVehicleConsistency(draft, fields, prev, session)
	// "What happened" is a short summary, not the customer's whole message.
	for _, f := range fields {
		if f.Name != "incidentDescription" && f.Name != "description" {
			continue
		}
		if v, ok := draft.Fields[f.Name].(string); ok && (len(strings.Fields(v)) > 30 || (len(strings.Fields(v)) > 18 && isWholeUserMessage(v, session))) {
			if sum := conciseSummary(v); sum != "" {
				draft.Fields[f.Name] = sum
			}
		}
	}
	applyApproximateDate(draft, fields, session, req.CurrentMessage, prev)
	for _, f := range fields {
		if !f.Required {
			continue
		}
		if f.Name == draft.DateField && draft.DateApproximate {
			continue
		}
		if v, ok := draft.Fields[f.Name]; !ok || strings.TrimSpace(fmt.Sprint(v)) == "" {
			draft.MissingNames = append(draft.MissingNames, f.Name)
			draft.Missing = append(draft.Missing, fieldLabel(f))
		}
	}
	s.log.Infof("🧾 [CLAIM DRAFT] type=%s filled=%d missing=%v dropped=%v queue=%v approxDate=%t", draft.TypeName, len(draft.Fields), draft.MissingNames, draft.Dropped, draft.Queue, draft.DateApproximate)
	return draft, nil
}

func hasField(fields []CoverageField, name string) bool {
	for _, f := range fields {
		if f.Name == name {
			return true
		}
	}
	return false
}

func removeString(list []string, v string) []string {
	var out []string
	for _, x := range list {
		if x != v {
			out = append(out, x)
		}
	}
	return out
}

func isWholeUserMessage(v string, session []ChatMessage) bool {
	fv := strings.Join(strings.Fields(foldText(v)), " ")
	for _, m := range session {
		if m.Role == "user" && strings.Join(strings.Fields(foldText(m.Content)), " ") == fv {
			return true
		}
	}
	return false
}

var yearPattern = regexp.MustCompile(`\b((?:19|20)\d{2})\b`)

var ownVehicleCue = compileFolded(`\bmy (car|vehicle|wife'?s car|husband'?s car|own car)\b`, `\bthe car is\b`, `\bsame car\b`, `\bi was driving\b`, `\bma voiture\b`, `\bmon (vehicule|auto|vehicule)\b`, `\bje conduisais\b`, `\bgari (yangu|langu)\b`, `\bmotuka (na )?ngai\b`, `\bmi (coche|carro|auto)\b`, `\bmeu carro\b`)

// applyVehicleConsistency keeps the vehicle fields consistent after a
// correction: when the customer says their vehicle was another one ("actually
// I was driving my wife's car: a Honda Fit 2014"), the make/model, and the
// year written with it, replace the old ones; a year given for the first
// vehicle is not kept for the new one.
func applyVehicleConsistency(draft *ClaimDraft, fields []CoverageField, prev *ClaimDraft, session []ChatMessage) {
	if !hasField(fields, "vehicleMakeModel") {
		return
	}
	latest := ""
	for _, m := range session {
		if m.Role != "user" {
			continue
		}
		if mm := extractVehicleMakeModel(m.Content); mm != "" && (latest == "" || IsExplicitCorrection(m.Content) || ownVehicleCue.MatchString(foldText(m.Content))) {
			latest = mm
		}
	}
	mm, _ := draft.Fields["vehicleMakeModel"].(string)
	sameVehicle := func(a, b string) bool {
		fa, fb := strings.Fields(foldText(a)), strings.Fields(foldText(b))
		return len(fa) >= 2 && len(fb) >= 2 && fa[0] == fb[0] && fa[1] == fb[1]
	}
	if latest != "" && (mm == "" || !sameVehicle(mm, latest)) {
		draft.Fields["vehicleMakeModel"] = latest
		mm = latest
	}
	if mm == "" || !hasField(fields, "vehicleYear") {
		return
	}
	year := yearPattern.FindString(mm)
	if year != "" {
		draft.Fields["vehicleMakeModel"] = strings.TrimSpace(strings.Join(strings.Fields(strings.Replace(mm, year, "", 1)), " "))
	} else if latest != "" && sameVehicle(mm, latest) {
		year = yearPattern.FindString(latest)
	}
	if year != "" {
		if y, err := strconv.Atoi(year); err == nil {
			draft.Fields["vehicleYear"] = float64(y)
		}
		return
	}
	if prev != nil {
		prevMM, _ := prev.Fields["vehicleMakeModel"].(string)
		if prevMM != "" && !sameVehicle(prevMM, mm) && fmt.Sprint(prev.Fields["vehicleYear"]) == fmt.Sprint(draft.Fields["vehicleYear"]) {
			delete(draft.Fields, "vehicleYear") // the year of the other vehicle
		}
	}
}

// applyApproximateDate accepts an approximate incident date: the customer's
// own words are kept with the approximate flag. Failed attempts are counted
// so the flow can offer to continue with an approximate date instead of
// asking again and again.
func applyApproximateDate(draft *ClaimDraft, fields []CoverageField, session []ChatMessage, current string, prev *ClaimDraft) {
	for _, f := range fields {
		if f.Required && classifyField(f) == kindDate {
			draft.DateField = f.Name
			break
		}
	}
	if draft.DateField == "" {
		return
	}
	exact := false
	if v, ok := draft.Fields[draft.DateField]; ok && strings.TrimSpace(fmt.Sprint(v)) != "" {
		exact = true
	}
	wording := ""
	if current != "" {
		wording = ApproximateDateWording(current)
	}
	if wording == "" && !sameDraftType(prev, draft) {
		// first draft: the customer may have described the date earlier
		for i := len(session) - 1; i >= 0 && wording == ""; i-- {
			if session[i].Role == "user" {
				wording = ApproximateDateWording(session[i].Content)
			}
		}
	}
	isApprox := wording != "" && IsApproximateDateWording(wording)
	switch {
	case exact && prev != nil && sameDraftType(prev, draft) && prev.DateApproximate && dateAlternatives.MatchString(foldText(prev.DateText)) &&
		!(current != "" && explicitCalendarDate.MatchString(foldText(current))):
		// "mardi ou mercredi": the model re-guessed one of the days; keep the
		// customer's wording without an exact date until they give one.
		draft.DateApproximate, draft.DateText = true, prev.DateText
		delete(draft.Fields, draft.DateField)
	case exact:
		if isApprox && current != "" && strings.Contains(current, wording) {
			draft.DateApproximate, draft.DateText = true, wording
			if dateAlternatives.MatchString(foldText(wording)) {
				// "Tuesday or Wednesday": no single exact date to store.
				delete(draft.Fields, draft.DateField)
			}
		} else if current != "" && ApproximateDateWording(current) != "" && !isApprox {
			draft.DateApproximate, draft.DateText = false, ""
		}
	case wording != "" && (isApprox || prev.asked(draft.DateField)):
		draft.DateApproximate, draft.DateText = true, wording
	case draft.DateOffered && current != "" && (ClassifyConfirmation(current) == "yes" || IsApproximateDateWording(current)):
		draft.DateApproximate = true
	case !draft.DateApproximate && prev.asked(draft.DateField):
		draft.DateAttempts++
	}
}

var dateAlternatives = compileFolded(`\bor\b`, `\bou\b`, `\bbetween\b`, `\bentre\b`, `\bo\b`, `\bau\b`, `\bama\b`, `\bau\b`, `\d\s*(-|–|to)\s*\d`)

func sameDraftType(a, b *ClaimDraft) bool {
	return a != nil && b != nil && a.TypeName != "" && strings.EqualFold(a.TypeName, b.TypeName)
}

func fieldLabel(f CoverageField) string {
	if strings.TrimSpace(f.Label) != "" {
		return strings.TrimSpace(f.Label)
	}
	return strings.Join(splitIdentifier(f.Name), " ")
}

// coverageFor returns the coverage type of a draft (or nil).
func coverageFor(coverage []CoverageInfo, typeName string) *CoverageInfo {
	for i := range coverage {
		if strings.EqualFold(coverage[i].TypeName, typeName) {
			return &coverage[i]
		}
	}
	return nil
}

// ClaimRecapMessage renders the localized summary and the yes/no question.
func ClaimRecapMessage(lang string, draft *ClaimDraft, coverage []CoverageInfo) string {
	return ClaimRecapMessageFor(lang, lang, draft, coverage)
}

// ClaimRecapMessageFor builds the summary in the reply language. Field labels
// come from the company's configuration when the reply is in the company
// language, otherwise from the bot locale files (company label as fallback).
func ClaimRecapMessageFor(lang, companyLang string, draft *ClaimDraft, coverage []CoverageInfo) string {
	var sb strings.Builder
	display := draft.DisplayName
	if display == "" {
		display = draft.TypeName
	}
	if lang != companyLang {
		if v, ok := botLocales[lang]["claimType."+strings.ToUpper(draft.TypeName)]; ok && v != "" {
			display = v
		}
	}
	sb.WriteString(fillPlaceholders(botText(lang, "claim.recapHeader"), map[string]string{"claimType": display}))
	sb.WriteString("\n")
	var fields []CoverageField
	if ct := coverageFor(coverage, draft.TypeName); ct != nil {
		fields = infoFields(*ct)
	}
	seen := map[string]bool{}
	line := func(label string, v interface{}) {
		sb.WriteString("• " + label + ": " + formatDraftValue(lang, v) + "\n")
	}
	approx := func() string {
		if strings.TrimSpace(draft.DateText) != "" {
			return fillPlaceholders(botText(lang, "claim.dateApproxValue"), map[string]string{"text": draft.DateText})
		}
		return botText(lang, "claim.dateApproxUnknown")
	}
	for _, f := range fields {
		v, ok := draft.Fields[f.Name]
		if f.Name == draft.DateField && draft.DateApproximate {
			if ok && strings.TrimSpace(fmt.Sprint(v)) != "" {
				line(localizedLabel(lang, companyLang, f), formatDraftValue(lang, v)+" ("+approx()+")")
			} else {
				line(localizedLabel(lang, companyLang, f), approx())
			}
			seen[f.Name] = true
			continue
		}
		if ok {
			line(localizedLabel(lang, companyLang, f), v)
			seen[f.Name] = true
		}
	}
	var rest []string
	for k := range draft.Fields {
		if !seen[k] {
			rest = append(rest, k)
		}
	}
	sort.Strings(rest)
	for _, k := range rest {
		line(localizedLabel(lang, companyLang, CoverageField{Name: k, Label: strings.Join(splitIdentifier(k), " ")}), draft.Fields[k])
	}
	if len(draft.FromProfile) > 0 {
		var labels []string
		for _, name := range draft.FromProfile {
			f := CoverageField{Name: name, Label: strings.Join(splitIdentifier(name), " ")}
			for _, cf := range fields {
				if cf.Name == name {
					f = cf
				}
			}
			labels = append(labels, localizedLabel(lang, companyLang, f))
		}
		sb.WriteString("\n" + fillPlaceholders(botText(lang, "claim.fromProfile"), map[string]string{"fields": strings.Join(labels, ", ")}) + "\n")
	}
	sb.WriteString("\n")
	sb.WriteString(botText(lang, "claim.confirmPrompt"))
	return sb.String()
}

// localizedLabel returns a field label for the reply language.
func localizedLabel(lang, companyLang string, f CoverageField) string {
	if lang != "" && lang != companyLang {
		if v, ok := botLocales[lang]["field."+f.Name]; ok && v != "" {
			return v
		}
	}
	return fieldLabel(f)
}

// MissingLabels lists the missing fields of a draft in the reply language.
func MissingLabels(lang, companyLang string, draft *ClaimDraft, coverage []CoverageInfo) []string {
	var byName map[string]CoverageField
	if ct := coverageFor(coverage, draft.TypeName); ct != nil {
		byName = map[string]CoverageField{}
		for _, f := range ct.Fields {
			byName[f.Name] = f
		}
	}
	out := make([]string, 0, len(draft.MissingNames))
	for i, name := range draft.MissingNames {
		f, ok := byName[name]
		if !ok {
			f = CoverageField{Name: name}
			if i < len(draft.Missing) {
				f.Label = draft.Missing[i]
			}
		}
		out = append(out, localizedLabel(lang, companyLang, f))
	}
	if len(out) == 0 {
		return draft.Missing
	}
	return out
}

func formatDraftValue(lang string, v interface{}) string {
	switch x := v.(type) {
	case bool:
		if x {
			return botText(lang, "common.yes")
		}
		return botText(lang, "common.no")
	case float64:
		if x == float64(int64(x)) {
			return fmt.Sprintf("%d", int64(x))
		}
		return fmt.Sprintf("%.2f", x)
	}
	return strings.TrimSpace(fmt.Sprint(v))
}

// MissingInfoMessage asks for the next one or two missing fields, as a
// question (no bare list, no double punctuation).
func MissingInfoMessage(lang string, missing []string) string {
	return askForFields(lang, nil, missing)
}

// AskNextMessage asks for the next one or two missing fields of a draft.
func AskNextMessage(lang, companyLang string, draft *ClaimDraft, coverage []CoverageInfo) string {
	return askForFields(lang, draft.MissingNames, MissingLabels(lang, companyLang, draft, coverage))
}

func askForFields(lang string, names, labels []string) string {
	if len(labels) > 2 {
		labels = labels[:2]
	}
	var plain, questions []string
	for i, label := range labels {
		label = strings.TrimSpace(label)
		name := ""
		if i < len(names) {
			name = names[i]
		}
		switch {
		case name == "incidentDescription" || name == "description":
			questions = append(questions, botText(lang, "claim.askWhatHappened"))
		case name == "damageDescription":
			questions = append(questions, botText(lang, "claim.askDamage"))
		case strings.HasSuffix(label, "?") || strings.HasSuffix(label, "؟"):
			questions = append(questions, label)
		default:
			plain = append(plain, lowerFirst(strings.TrimRight(label, ".:;,!")))
		}
	}
	var parts []string
	if len(plain) > 0 {
		parts = append(parts, fillPlaceholders(botText(lang, "claim.askNext"), map[string]string{"fields": strings.Join(plain, " "+botText(lang, "common.and")+" ")}))
	}
	parts = append(parts, questions...)
	return strings.Join(parts, " ")
}

// lowerFirst lower-cases the first letter of a label ("Full name" -> "full
// name"), unless the first word is an acronym ("VIN").
func lowerFirst(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	if len(r) > 1 && unicode.IsUpper(r[1]) {
		return s
	}
	r[0] = unicode.ToLower(r[0])
	return string(r)
}

// ── claim creation ───────────────────────────────────────────────────────

// ClaimCreateRequest is a confirmed claim to register.
type ClaimCreateRequest struct {
	CompanyID     string
	CustomerID    string
	WhatsAppPhone string
	CustomerName  string
	// Language is the language of the conversation (ISO 639-1); the claim PDF uses it.
	Language string
	Draft    *ClaimDraft
	// CorrectedFields are customer-profile fields the customer explicitly
	// corrected in this claim (insuredFullName, policyNumber, address, email);
	// only those may replace a value already on the customer's file.
	CorrectedFields []string
}

// ClaimCreateResult is what the claims API returned.
type ClaimCreateResult struct {
	ClaimNumber string
	ClaimID     string
}

// ClaimCreator registers claims (the dashboard claims API in production).
type ClaimCreator interface {
	CreateClaim(ctx context.Context, req ClaimCreateRequest) (*ClaimCreateResult, error)
}

var claimCategories = map[string]bool{"AUTO": true, "TRAVEL": true, "FIRE": true, "TRANSPORT": true, "CONSTRUCTION": true, "HOME": true, "HEALTH": true, "LIFE": true, "BUSINESS": true, "OTHER": true}

func firstField(fields map[string]interface{}, names ...string) string {
	for _, n := range names {
		if v, ok := fields[n]; ok {
			if s := strings.TrimSpace(fmt.Sprint(v)); s != "" {
				return s
			}
		}
	}
	return ""
}

// BuildClaimPayload maps a confirmed draft to the claims API body. The
// customer's phone is always the WhatsApp sender number.
func BuildClaimPayload(req ClaimCreateRequest) map[string]interface{} {
	f := map[string]interface{}{}
	if req.Draft != nil {
		f = req.Draft.Fields
	}
	phone := whatsappE164(req.WhatsAppPhone)
	name := firstField(f, "insuredFullName", "patientName", "ownerName", "fullName", "name")
	if name == "" {
		name = strings.TrimSpace(req.CustomerName)
	}
	if name == "" || digitsOnly(name) == digitsOnly(phone) {
		name = "WhatsApp " + phone
	}
	category := "OTHER"
	typeName := ""
	if req.Draft != nil {
		typeName = strings.ToUpper(req.Draft.TypeName)
		if claimCategories[typeName] {
			category = typeName
		}
	}
	claimFields := map[string]interface{}{}
	for k, v := range f {
		claimFields[k] = v
	}
	for k := range claimFields {
		if strings.EqualFold(k, "phoneNumber") || strings.EqualFold(k, "phone") {
			claimFields[k] = phone
		}
	}
	payload := map[string]interface{}{
		"insuredFullName": name,
		"phoneNumber":     phone,
		"claimCategory":   category,
		"claimTypeName":   typeName,
		"claimFields":     claimFields,
		"source":          "whatsapp",
		"language":        strings.ToLower(strings.TrimSpace(req.Language)),
	}
	set := func(key string, names ...string) {
		if v := firstField(f, names...); v != "" {
			payload[key] = v
		}
	}
	set("policyNumber", "policyNumber")
	set("address", "address", "propertyAddress")
	set("email", "email")
	set("incidentDate", "incidentDate", "treatmentDate", "dateOfLoss", "lossDate")
	set("incidentTime", "incidentTime")
	set("incidentLocation", "incidentLocation", "propertyAddress", "healthcareProvider", "location")
	set("vehicleMakeModel", "vehicleMakeModel")
	set("vehicleRegistration", "vehicleRegistration")
	set("vehicleVin", "vehicleVin")
	set("licenseNumber", "licenseNumber")
	set("policeReportNumber", "policeReportNumber")
	set("injuryDescription", "injuryDescription")
	set("damageDescription", "damageDescription")
	set("incidentDescription", "incidentDescription", "treatmentDetails", "incidentCause", "description")
	if y := firstField(f, "vehicleYear"); y != "" {
		var year int
		if _, err := fmt.Sscanf(y, "%d", &year); err == nil && year >= 1900 {
			payload["vehicleYear"] = year
		}
	}
	if req.Draft != nil && req.Draft.DateApproximate {
		payload["incidentDateApproximate"] = true
		claimFields["incidentDateApproximate"] = true
		if t := strings.TrimSpace(req.Draft.DateText); t != "" {
			payload["incidentDateText"] = t
			claimFields["incidentDateText"] = t
		}
	}
	if req.Draft != nil && len(req.Draft.FromProfile) > 0 {
		payload["fieldsFromProfile"] = req.Draft.FromProfile
	}
	if len(req.CorrectedFields) > 0 {
		payload["correctedFields"] = req.CorrectedFields
	}
	for _, b := range []string{"injuriesOccurred", "policeContacted", "medicalTreatmentRequired"} {
		if v, ok := f[b].(bool); ok {
			payload[b] = v
		}
	}
	// A readable description combining what happened and the damage.
	var parts []string
	for _, n := range []string{"incidentDescription", "incidentCause", "treatmentType", "treatmentDetails", "damageDescription"} {
		if v := firstField(f, n); v != "" {
			parts = addDescriptionPart(parts, v)
		}
	}
	if len(parts) > 0 {
		payload["description"] = strings.Join(parts, "\n\n")
	}
	return payload
}

func containsFold(list []string, v string) bool {
	for _, x := range list {
		if strings.EqualFold(strings.TrimSpace(x), strings.TrimSpace(v)) {
			return true
		}
	}
	return false
}

// FrontendClaimCreator registers claims through the dashboard API
// (POST /api/claims) with the internal service key and the company id. The
// company header is only honoured together with a valid internal key, so it
// cannot be spoofed by a customer.
type FrontendClaimCreator struct {
	BaseURL        string
	InternalAPIKey string
	Client         *http.Client
}

// CreateClaim implements ClaimCreator.
func (c *FrontendClaimCreator) CreateClaim(ctx context.Context, req ClaimCreateRequest) (*ClaimCreateResult, error) {
	if strings.TrimSpace(c.InternalAPIKey) == "" {
		return nil, fmt.Errorf("INTERNAL_API_KEY is not configured: the assistant cannot create claims")
	}
	if req.CompanyID == "" {
		return nil, fmt.Errorf("company id is required to create a claim")
	}
	body, err := json.Marshal(BuildClaimPayload(req))
	if err != nil {
		return nil, fmt.Errorf("marshal claim: %w", err)
	}
	base := strings.TrimRight(c.BaseURL, "/")
	if base == "" {
		base = "http://host.docker.internal:3000"
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/claims", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	setInternalClaimHeaders(httpReq, c.InternalAPIKey, req.CompanyID, req.WhatsAppPhone)
	client := c.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("claims API: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("claims API responded %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var parsed struct {
		Success bool `json:"success"`
		Claim   struct {
			ID          string `json:"id"`
			ClaimNumber string `json:"claimNumber"`
		} `json:"claim"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("claims API response: %w", err)
	}
	if !parsed.Success || strings.TrimSpace(parsed.Claim.ClaimNumber) == "" {
		return nil, fmt.Errorf("claims API returned no claim number: %s", strings.TrimSpace(string(raw)))
	}
	return &ClaimCreateResult{ClaimNumber: parsed.Claim.ClaimNumber, ClaimID: parsed.Claim.ID}, nil
}

// setInternalClaimHeaders adds the service-to-service authentication and the
// tenant/customer context expected by the dashboard claims API.
func setInternalClaimHeaders(r *http.Request, internalKey, companyID, whatsappPhone string) {
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Internal-API-Key", internalKey)
	r.Header.Set("X-Company-ID", companyID)
	if d := digitsOnly(whatsappPhone); d != "" {
		r.Header.Set("X-WhatsApp-Phone", d)
	}
}

var platePattern = regexp.MustCompile(`(?i:\b(?:licen[cs]e\s+plate|number\s+plate|plate|registration|reg\.?|plaque|immatriculation|matr[ií]cula|placa|namba\s+ya\s+gari|nambari\s+ya\s+gari|usajili)(?:\s+(?:number|no\.?|n[°º]|num[eé]ro|is|est|ni|es|é|:))*\s*:?\s*)([A-Z0-9][A-Z0-9\- ]{1,12}[A-Z0-9])`)

// extractPlate finds a licence plate the customer wrote after a plate keyword.
// The last plate wins: a later one is a correction ("…not mine: plate KIN-5590-CD").
func extractPlate(text string) string {
	out := ""
	for _, m := range platePattern.FindAllStringSubmatch(text, -1) {
		cand := strings.TrimSpace(m[1])
		// stop at a following lower-case word ("KDB 456Y kutoka" is cut by the class already)
		if strings.ContainsAny(cand, "0123456789") && strings.IndexFunc(cand, func(r rune) bool { return r >= 'A' && r <= 'Z' }) >= 0 && len(normalizeID(cand)) >= 4 {
			out = cand
		}
	}
	return out
}

var noInjuryPattern = regexp.MustCompile(`(?i)\b(no\s*one|nobody|no-one|none of us)\s+(was\s+|got\s+|is\s+)?(injured|hurt|wounded)|\bno\s+(injur(y|ies)|one\s+hurt)|\bnot\s+(injured|hurt)|\bpas\s+de\s+bless|\baucun(e)?\s+bless|\bpersonne\s+n'?a\s+(été|ete)\s+bless|\bpersonne\s+n'?est\s+bless|\bsans\s+bless|\bnadie\s+(result[oó]\s+|sali[oó]\s+)?herid|\bno\s+hubo\s+herid|\bsin\s+herid|\bningu[eé]m\s+(se\s+)?(feriu|ficou\s+ferid|machucou)|\bsem\s+ferid|\bhakuna\s+(mtu\s+)?(aliyejeruhiwa|aliyeumia|majeruhi|aliyeumizwa)`)

// addDescriptionPart appends v unless an earlier part already says it ("a
// minibus hit my car. The rear bumper is broken." + "The rear bumper is
// broken."); a part that v contains is replaced by v.
func addDescriptionPart(parts []string, v string) []string {
	key := strings.Trim(foldText(v), " .,;:!")
	if key == "" {
		return parts
	}
	for i, p := range parts {
		pk := strings.Trim(foldText(p), " .,;:!")
		if strings.Contains(pk, key) {
			return parts
		}
		if strings.Contains(key, pk) {
			parts[i] = v
			return parts
		}
	}
	return append(parts, v)
}

// answerAskedYesNo fills the yes/no field the previous reply asked for (and
// only that one) from a reply that starts with yes or no, e.g. "Receipts
// available?" -> "Yes, I have the invoice". Small models often return nothing
// for such answers, and the assistant would ask the same question again.
func answerAskedYesNo(draft *ClaimDraft, fields []CoverageField, prev *ClaimDraft, current string) []string {
	if prev == nil || len(prev.AskedFields) != 1 {
		return nil
	}
	b, ok := leadingYesNo(current)
	if !ok {
		return nil
	}
	for _, f := range fields {
		if classifyField(f) != kindBool || !prev.asked(f.Name) {
			continue
		}
		if v, has := draft.Fields[f.Name]; has && strings.TrimSpace(fmt.Sprint(v)) != "" {
			return nil
		}
		draft.Fields[f.Name] = b
		return []string{f.Name}
	}
	return nil
}

// backfillFromCustomerText fills missing fields whose value can be read
// deterministically from the customer's own words. It returns the names filled.
func backfillFromCustomerText(draft *ClaimDraft, fields []CoverageField, corpus *groundingCorpus, userText string) []string {
	var filled []string
	has := func(name string) bool {
		v, ok := draft.Fields[name]
		return ok && strings.TrimSpace(fmt.Sprint(v)) != ""
	}
	for _, f := range fields {
		if has(f.Name) {
			continue
		}
		n := strings.ToLower(f.Name)
		var v interface{}
		switch {
		case strings.Contains(n, "policynumber"):
			if p := extractPolicyNumber(userText); p != "" {
				v = p
			}
		case n == "vehicleregistration" || strings.Contains(n, "plate"):
			if p := extractPlate(userText); p != "" {
				v = p
			}
		case n == "incidentdate" || n == "treatmentdate" || n == "dateofloss":
			if d, ok := corpus.mentionedDate(); ok {
				v = d.Format("2006-01-02")
			}
		case n == "injuriesoccurred":
			if noInjuryPattern.MatchString(userText) {
				v = false
			}
		case isNameField(f):
			for _, line := range strings.Split(userText, "\n") {
				if nm, ok := cleanPersonName(extractCustomerName(line)); ok {
					v = nm
				}
			}
		case n == "vehiclemakemodel" || n == "vehiclemake" || n == "makemodel":
			if mm := extractVehicleMakeModel(userText); mm != "" {
				v = mm
			}
		case n == "incidentlocation" || n == "location" || n == "lossaddress":
			if loc := extractStreetLocation(userText); loc != "" {
				v = loc
			}
		case n == "damagedescription":
			if d := extractDamageClause(userText); d != "" {
				v = d
			}
		case n == "incidentdescription" || n == "description":
			if d := conciseSummary(extractNarrative(userText)); d != "" {
				v = d
			}
		}
		if v != nil {
			draft.Fields[f.Name] = v
			filled = append(filled, f.Name)
		}
	}
	return filled
}

var vehicleMakePattern = regexp.MustCompile(`(?i)\b(toyota|nissan|honda|mazda|mitsubishi|subaru|suzuki|isuzu|hyundai|kia|ford|chevrolet|peugeot|renault|citro[eë]n|volkswagen|vw|mercedes(?:-benz)?|bmw|audi|lexus|land rover|range rover|jeep|opel|fiat|volvo|tata|mahindra|dacia|skoda|daihatsu)\s+([\p{L}0-9][\p{L}0-9-]*)(?:\s+((?:19|20)\d{2}))?`)

var notAModelWord = map[string]bool{"was": true, "is": true, "car": true, "which": true, "that": true, "and": true, "et": true, "a": true, "ni": true, "na": true, "de": true, "du": true, "est": true, "has": true, "had": true, "got": true, "yangu": true, "langu": true}

// extractVehicleMakeModel reads "Toyota Vitz 2015" / "Nissan X-Trail" as the
// customer wrote it (known makes only).
func extractVehicleMakeModel(text string) string {
	var out string
	for _, m := range vehicleMakePattern.FindAllStringSubmatch(text, -1) {
		if notAModelWord[strings.ToLower(m[2])] {
			continue
		}
		parts := []string{capitalizeWord(m[1]), m[2]}
		if m[3] != "" {
			parts = append(parts, m[3])
		}
		out = strings.Join(parts, " ")
	}
	return out
}

var streetPattern = regexp.MustCompile(`(?i)(?:\b([\p{L}'-]+)\s+)?\b((?:avenue|av\.|rue|boulevard|bd|route|road|street|highway|carrefour|rond-point|barabara|mtaa|calle|avenida|rua|estrada)\b[^.,;!?\n]{2,60})`)

var locationLeadStop = map[string]bool{"on": true, "at": true, "in": true, "the": true, "near": true, "sur": true, "à": true, "a": true, "la": true, "le": true, "l'": true, "du": true, "de": true, "dans": true, "kwenye": true, "katika": true, "ya": true, "en": true, "na": true, "em": true, "no": true, "na.": true, "une": true, "un": true, "an": true}

// extractStreetLocation takes the street the customer named ("avenue du
// Commerce à Gombe", "kenyatta avenue nairobi", "barabara ya Moi").
func extractStreetLocation(text string) string {
	var out string
	for _, m := range streetPattern.FindAllStringSubmatch(text, -1) {
		loc := strings.TrimSpace(m[2])
		if lead := m[1]; lead != "" && !locationLeadStop[strings.ToLower(lead)] {
			loc = lead + " " + loc
		}
		out = loc
	}
	return out
}

var damageWordPattern = regexp.MustCompile(`(?i)\b(dent\w*|scratch\w*|scrach\w*|damag\w*|broke\w*|smash\w*|crack\w*|bumper|tailgate|windscreen|windshield|cass[ée]\w*|ab[iî]m\w*|endommag\w*|ray[ée]\w*|pare-?cho[cq]\w*|parchoc|capot|phare|imevunjika|imeharibika|imeharibiwa|bampa|kioo|da[ñn]ad\w*|quebr\w*|amassad\w*|danificad\w*)`)

// extractDamageClause returns the customer's own clause describing the damage.
func extractDamageClause(text string) string {
	var out string
	for _, line := range strings.Split(text, "\n") {
		for _, clause := range regexp.MustCompile(`[.;!?]+\s*|,\s+`).Split(line, -1) {
			c := strings.TrimSpace(clause)
			if len(strings.Fields(c)) >= 2 && damageWordPattern.MatchString(c) {
				out = c
			}
		}
	}
	return out
}

var eventWordPattern = regexp.MustCompile(`(?i)\b(hit|crash\w*|crack\w*|shatter\w*|smash\w*|burst\w*|knock\w*|bump\w*|fissur\w*|bris[ée]\w*|collid\w*|struck|ran into|rear-ended|backed|reversed|scratch\w*|scrach\w*|dent\w*|stolen|theft|fire|flood\w*|broke\w*|heurt\w*|percut\w*|recul\w*|embout\w*|accroch\w*|vol[ée]\w*|incendie|inond\w*|cass[ée]\w*|iligonga|imegonga|aligonga|gonga|iliibiwa|moto|mafuriko|choc\w*|bat\w*|chocou|roubad\w*)`)

// extractNarrative returns the customer's own account of what happened: the
// longest message (at least 10 words) that describes an event.
func extractNarrative(text string) string {
	var best string
	for _, line := range strings.Split(text, "\n") {
		l := strings.TrimSpace(line)
		if len(strings.Fields(l)) < 10 || !eventWordPattern.MatchString(l) {
			continue
		}
		if len(l) > len(best) {
			best = l
		}
	}
	if len([]rune(best)) > 600 {
		best = string([]rune(best)[:600])
	}
	return best
}
