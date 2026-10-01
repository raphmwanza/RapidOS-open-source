package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"rapidos/internal/ai"
	"rapidos/internal/config"
)

// Tests for the "tighten it" fixes: pause, one support alert per escalation,
// several incidents, approximate dates, empathy, cancel cleanup, field
// quality, Lingala and E.164 phones. The LLM is always the mock.

// dashboardStub is the dashboard media API (upload + discard-pending).
type dashboardStub struct {
	mu        sync.Mutex
	uploads   int
	pending   bool
	discards  []string
	discarded int
	srv       *httptest.Server
}

func newDashboardStub(t *testing.T) *dashboardStub {
	d := &dashboardStub{pending: true, discarded: 1}
	d.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		d.mu.Lock()
		defer d.mu.Unlock()
		switch r.URL.Path {
		case "/api/media/upload":
			d.uploads++
			if d.pending {
				_, _ = w.Write([]byte(`{"success":true,"pending":true,"claimNumber":null,"documentId":null}`))
				return
			}
			_, _ = w.Write([]byte(`{"success":true,"pending":false,"claimNumber":"ACT-1","documentId":"doc-1"}`))
		case "/api/media/discard-pending":
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			d.discards = append(d.discards, body["customerId"])
			_, _ = fmt.Fprintf(w, `{"success":true,"discarded":%d}`, d.discarded)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(d.srv.Close)
	return d
}

func (h *harness) withDashboard(t *testing.T) *dashboardStub {
	d := newDashboardStub(t)
	h.sk.cfg = &config.Config{FrontendBaseURL: d.srv.URL, InternalAPIKey: "internal-secret"}
	return d
}

func (h *harness) sendPhoto(t *testing.T) string {
	t.Helper()
	h.msgID++
	if err := h.flow.Handle(context.Background(), InboundMessage{ID: fmt.Sprintf("wamid.%d", h.msgID), From: testSender, CompanyID: testCompany, Type: "image", Media: jpegBytes, MimeType: "image/jpeg"}); err != nil {
		t.Fatalf("photo: %v", err)
	}
	return h.store.lastAssistant().Content
}

func (h *harness) sentCount() int {
	h.sender.mu.Lock()
	defer h.sender.mu.Unlock()
	return len(h.sender.sent)
}

// ── E.164 ───────────────────────────────────────────────────────────────

func TestNormalizePhoneE164(t *testing.T) {
	cases := []struct{ in, cc, want string }{
		{"+243 81 234 5678", "", "+243812345678"},
		{"00243-812-345-678", "", "+243812345678"},
		{"0812345678", "243", "+243812345678"},
		{"812345678", "243", "+243812345678"},
		{"243812345678", "", "+243812345678"}, // WhatsApp wa_id
		{"243812345678", "243", "+243812345678"},
		{"(254) 700 111 222", "", "+254700111222"},
		{"0812345678", "", ""}, // national number without a country: rejected, not guessed
		{"12345", "", ""},
		{"call me", "", ""},
		{"+243 81 234 5678 ext", "", ""},
	}
	for _, c := range cases {
		if got := NormalizePhoneE164(c.in, c.cc); got != c.want {
			t.Errorf("NormalizePhoneE164(%q, %q) = %q, want %q", c.in, c.cc, got, c.want)
		}
	}
	if CallingCodeForCountry("RDC") != "243" || CallingCodeForCountry("République démocratique du Congo") != "243" || CallingCodeForCountry("Kenya") != "254" {
		t.Errorf("calling codes by country")
	}
	if whatsappE164("254700111222") != "+254700111222" || normalizePhoneNumberDB("+254 700 111 222") != "+254700111222" {
		t.Errorf("WhatsApp numbers must be stored in E.164")
	}
}

func TestClaimPayload_PhoneIsE164(t *testing.T) {
	p := BuildClaimPayload(ClaimCreateRequest{WhatsAppPhone: "254700111222", Draft: &ClaimDraft{TypeName: "AUTO", Fields: map[string]interface{}{"phoneNumber": "0711"}}})
	if p["phoneNumber"] != "+254700111222" || p["claimFields"].(map[string]interface{})["phoneNumber"] != "+254700111222" {
		t.Fatalf("payload phones = %v / %v", p["phoneNumber"], p["claimFields"])
	}
}

// ── pause ───────────────────────────────────────────────────────────────

func TestPause_StoresMessageAndSendsNothing_ResumeWorks(t *testing.T) {
	h := newHarness(t, "en", http.StatusCreated)
	h.llm.chat = func(ai.CompletionRequest) string { return "[INFO] :: Hello, how can I help?" }
	h.store.paused = true
	h.say(t, "hello, is anyone there?")
	if h.sentCount() != 0 {
		t.Fatalf("paused bot sent %d message(s)", h.sentCount())
	}
	if len(h.llm.calls) != 0 {
		t.Fatalf("paused bot called the LLM %d time(s)", len(h.llm.calls))
	}
	if n := len(h.store.messages); n != 1 || h.store.messages[0].Role != "user" {
		t.Fatalf("paused bot must only store the customer message, got %+v", h.store.messages)
	}
	// Support resumes the bot: the next message is answered.
	h.store.paused = false
	if got := h.say(t, "hello again"); !strings.Contains(got, "how can I help") || h.sentCount() != 1 {
		t.Fatalf("resumed bot did not answer: %q (sent %d)", got, h.sentCount())
	}
}

func TestPause_MidTurnReplyIsNotSent(t *testing.T) {
	h := newHarness(t, "en", http.StatusCreated)
	h.llm.chat = func(ai.CompletionRequest) string { return "[INFO] :: Hello" }
	h.store.pauseAfterSaves = 1 // support presses pause while the model is answering
	h.say(t, "hello")
	if h.sentCount() != 0 {
		t.Fatalf("reply sent although the bot was paused during the turn")
	}
	for _, m := range h.store.messages {
		if m.Role == "assistant" {
			t.Fatalf("unsent reply stored as an assistant message: %q", m.Content)
		}
	}
}

func TestPause_MediaIsStoredWithoutReply(t *testing.T) {
	h := newHarness(t, "en", http.StatusCreated)
	dash := h.withDashboard(t)
	h.store.paused = true
	h.sendPhoto(t)
	if dash.uploads != 1 {
		t.Fatalf("paused bot must still store the photo, uploads=%d", dash.uploads)
	}
	if h.sentCount() != 0 {
		t.Fatalf("paused bot replied to a photo")
	}
}

// ── escalation ──────────────────────────────────────────────────────────

func TestEscalation_OneAlertPerEscalationAndBotKeepsRunning(t *testing.T) {
	h := newHarness(t, "en", http.StatusCreated)
	h.llm.chat = func(ai.CompletionRequest) string {
		return "[ESCALATE] :: I'm sorry for the wait, a member of our team will follow up with you."
	}
	alert := botText("en", msgEscalated)
	first := h.say(t, "I want to speak to a real person")
	second := h.say(t, "Hello?? I want a human agent now")
	third := h.say(t, "This is unacceptable, let me talk to a manager")
	if !strings.Contains(first, alert) {
		t.Fatalf("first escalation must alert support: %q", first)
	}
	for _, r := range []string{second, third} {
		if strings.Contains(r, alert) {
			t.Fatalf("repeat alert while the conversation is still escalated: %q", r)
		}
		if strings.TrimSpace(r) == "" {
			t.Fatalf("empty reply")
		}
	}
	if h.store.escalations != 1 || !h.store.escalated {
		t.Fatalf("conversation flagged %d times, want 1", h.store.escalations)
	}
	if h.store.paused {
		t.Fatalf("handoff must not pause the bot")
	}
	// Support resolves it (remove-urgent): a new escalation alerts again.
	h.store.escalated = false
	if r := h.say(t, "I need a human again please"); !strings.Contains(r, alert) {
		t.Fatalf("a new escalation after resolution must alert again: %q", r)
	}
}

// ── empathy and conversational asks ────────────────────────────────────

func TestEmpathy_AngryCustomerGetsAcknowledgementThenOneOrTwoFields(t *testing.T) {
	h := newHarness(t, "en", http.StatusCreated)
	h.llm.chat = func(ai.CompletionRequest) string { return "[CLAIM] :: Noted." }
	h.llm.extract = func(ai.CompletionRequest) map[string]interface{} {
		return map[string]interface{}{"claimType": "AUTO", "incidentDescription": "I had an accident 3 days ago"}
	}
	got := h.say(t, "This is ridiculous!!! I had an accident 3 days ago and NOBODY from Activa has called me back. I want to file a claim")
	ack := botText("en", "claim.ackUpset")
	if !strings.HasPrefix(got, ack) {
		t.Fatalf("an angry message must first be acknowledged:\n%s", got)
	}
	if strings.Contains(got, "I still need") || strings.Contains(got, "?.") {
		t.Fatalf("bare missing-field list or double punctuation:\n%s", got)
	}
	if strings.Contains(strings.ToLower(got), "registration plate") || strings.Contains(strings.ToLower(got), "incident date") {
		t.Fatalf("asks for more than two fields at once:\n%s", got)
	}
}

func TestAskNext_ConversationalNoDoublePunctuation(t *testing.T) {
	msg := MissingInfoMessage("en", []string{"Were there injuries?", "Full name", "Licence plate"})
	if strings.Contains(msg, "?.") || strings.Contains(msg, "I still need") {
		t.Fatalf("message = %q", msg)
	}
	if strings.Contains(msg, "icence plate") {
		t.Fatalf("more than two fields asked: %q", msg)
	}
	msg = AskNextMessage("fr", "fr", &ClaimDraft{TypeName: "AUTO", MissingNames: []string{"incidentDescription", "incidentDate"}, Missing: []string{"Ce qui s'est passé", "Date de l'incident"}}, nil)
	if !strings.Contains(msg, "Que s'est-il passé") || !strings.Contains(msg, "date de l'incident") {
		t.Fatalf("fr ask = %q", msg)
	}
}

// ── several incidents ───────────────────────────────────────────────────

func multiCoverage() []CoverageInfo {
	cov := activaCoverage()
	cov = append(cov, CoverageInfo{TypeName: "HOME", DisplayName: "Home", Fields: []CoverageField{
		{Name: "insuredFullName", Label: "Full name", Type: "text", Required: true},
		{Name: "policyNumber", Label: "Policy number", Type: "text", Required: true},
		{Name: "propertyAddress", Label: "Property address", Type: "text", Required: true},
		{Name: "incidentDate", Label: "Incident date", Type: "date", Required: true},
		{Name: "damageDescription", Label: "Damage", Type: "text", Required: true},
	}})
	return cov
}

func TestMultiIncident_FiledOneAtATimeAsSeparateClaims(t *testing.T) {
	h := newHarness(t, "en", http.StatusCreated)
	h.store.coverage = multiCoverage()
	h.llm.chat = func(ai.CompletionRequest) string { return "[CLAIM] :: I'm sorry to hear that." }
	var prompts []string
	h.llm.extract = func(r ai.CompletionRequest) map[string]interface{} {
		prompts = append(prompts, r.SystemPrompt)
		var user []string
		for _, m := range r.Messages {
			if m.Role == "user" {
				user = append(user, m.Content)
			}
		}
		all := strings.Join(user, "\n")
		if strings.Contains(r.SystemPrompt, "ONLY about the Home incident") {
			if strings.Contains(all, "Shoprite") || strings.Contains(all, "Suzuki") {
				t.Errorf("car facts leaked into the home claim extraction:\n%s", all)
			}
			out := map[string]interface{}{"claimType": "HOME", "insuredFullName": "Esther Kalala", "policyNumber": "ACT-POLICY-2026-0610"}
			if strings.Contains(all, "avenue Lumumba") {
				out["propertyAddress"] = "14 avenue Lumumba, Lubumbashi"
				out["incidentDate"] = "2026-09-27"
				out["damageDescription"] = "The kitchen floor and the cupboards are damaged by the water"
			}
			return out
		}
		if strings.Contains(all, "pipe burst") {
			t.Errorf("home facts sent to the car claim extraction:\n%s", all)
		}
		out := map[string]interface{}{"claimType": "AUTO"}
		if strings.Contains(all, "Esther") {
			out["insuredFullName"] = "Esther Kalala"
		}
		if strings.Contains(all, "Suzuki") {
			for k, v := range map[string]interface{}{"vehicleMakeModel": "Suzuki Swift", "vehicleRegistration": "LUB-1123-EF", "incidentDate": "2026-09-25", "incidentLocation": "Shoprite parking in Lubumbashi", "incidentDescription": "someone reversed into my car at the Shoprite parking", "damageDescription": "The rear bumper is cracked", "injuriesOccurred": false} {
				out[k] = v
			}
		}
		return out
	}
	first := h.say(t, "Hello, I have two problems. Last Friday (25 September) someone reversed into my car at the Shoprite parking in Lubumbashi, and then on Sunday a pipe burst in my house and flooded the kitchen.")
	if !strings.Contains(first, "two separate incidents") || !strings.Contains(first, "first Auto, then Home") {
		t.Fatalf("multi-incident announcement missing:\n%s", first)
	}
	h.say(t, "My name is Esther Kalala, policy ACT-POLICY-2026-0610 for the car and ACT-POLICY-2026-0611 for the house.")
	recap := h.say(t, "The car is a Suzuki Swift 2019, plate LUB-1123-EF. The rear bumper is cracked. Nobody was hurt.")
	if h.store.conv.Mode != ModeClaimConfirming {
		t.Fatalf("car claim not complete: mode=%s\n%s", h.store.conv.Mode, recap)
	}
	done := h.say(t, "yes")
	if len(h.api.requests) != 1 || h.api.requests[0].body["claimCategory"] != "AUTO" {
		t.Fatalf("first claim = %+v", h.api.requests)
	}
	if h.api.requests[0].body["policyNumber"] != "ACT-POLICY-2026-0610" {
		t.Errorf("car policy = %v", h.api.requests[0].body["policyNumber"])
	}
	if !strings.Contains(done, "ACT-2026-000123") || !strings.Contains(done, "other claim") || h.store.conv.Mode != ModeClaimFiling {
		t.Fatalf("second incident not started after the first claim (mode %s):\n%s", h.store.conv.Mode, done)
	}
	h.say(t, "On Sunday 27 September a water pipe burst under the kitchen sink at 14 avenue Lumumba, Lubumbashi. The kitchen floor and the cupboards are damaged by the water.")
	if h.store.conv.Mode != ModeClaimConfirming {
		t.Fatalf("home claim not complete: %s", h.store.lastAssistant().Content)
	}
	h.say(t, "yes")
	if len(h.api.requests) != 2 {
		t.Fatalf("want 2 separate claims, got %d", len(h.api.requests))
	}
	home := h.api.requests[1].body
	if home["claimCategory"] != "HOME" || home["policyNumber"] != "ACT-POLICY-2026-0611" {
		t.Fatalf("home claim = %v / policy %v (the model's 0610 must be replaced by the house policy)", home["claimCategory"], home["policyNumber"])
	}
	if strings.Contains(fmt.Sprint(home), "Suzuki") || strings.Contains(fmt.Sprint(home), "Shoprite") {
		t.Fatalf("car facts in the home claim: %v", home)
	}
	if h.store.conv.Mode != ModeGeneral {
		t.Fatalf("mode after the last claim = %s", h.store.conv.Mode)
	}
}

func TestDetectIncidentTypes(t *testing.T) {
	cov := multiCoverage()
	if got := detectIncidentTypes(cov, "I have two problems: my car was hit at the parking, and then a pipe burst in my house and flooded the kitchen"); strings.Join(got, ",") != "AUTO,HOME" {
		t.Errorf("two incidents = %v", got)
	}
	for _, single := range []string{
		"My car was hit by a truck on the road, the bumper is broken",
		"I need to report another accident. My car was hit at a petrol station this morning.",
		"my house roof was damaged by the storm last night",
	} {
		if got := detectIncidentTypes(cov, single); len(got) > 1 {
			t.Errorf("%q detected as several incidents: %v", single, got)
		}
	}
}

// ── approximate dates ───────────────────────────────────────────────────

func TestApproximateDate_AcceptedWithCustomerWording(t *testing.T) {
	h := newHarness(t, "fr", http.StatusCreated)
	h.llm.chat = func(ai.CompletionRequest) string { return "[CLAIM] :: Merci." }
	h.llm.extract = func(r ai.CompletionRequest) map[string]interface{} {
		a := faithfulExtraction(r)
		delete(a, "incidentDate")
		a["incidentDate"] = "2026-09-22" // a guess the customer never stated: dropped by grounding
		return a
	}
	h.say(t, "Bonjour, je m'appelle Grace Wanjiru. Ma Toyota Corolla KDA 123X a été heurtée par un matatu sur Mombasa Road à Nairobi. Le pare-choc arrière est cassé. Personne n'est blessé.")
	recap := h.say(t, "Je sais pas exactement la date, peut-être mardi ou mercredi passé")
	if h.store.conv.Mode != ModeClaimConfirming {
		t.Fatalf("an approximate date must be accepted (no loop):\n%s", recap)
	}
	if !strings.Contains(recap, "approximative") || !strings.Contains(recap, "mardi ou mercredi") {
		t.Fatalf("recap must show the approximate date in the customer's words:\n%s", recap)
	}
	h.say(t, "oui")
	body := h.api.requests[0].body
	if body["incidentDateApproximate"] != true || !strings.Contains(fmt.Sprint(body["incidentDateText"]), "mardi ou mercredi") {
		t.Fatalf("payload approximate date = %v / %v", body["incidentDateApproximate"], body["incidentDateText"])
	}
	if _, ok := body["incidentDate"]; ok {
		t.Fatalf("an unknown exact date must not be stored: %v", body["incidentDate"])
	}
}

func TestApproximateDate_OfferAfterTwoFailedAttempts(t *testing.T) {
	h := newHarness(t, "en", http.StatusCreated)
	h.llm.chat = func(ai.CompletionRequest) string { return "[CLAIM] :: Thanks." }
	h.llm.extract = func(r ai.CompletionRequest) map[string]interface{} {
		a := faithfulExtraction(r)
		delete(a, "incidentDate")
		return a
	}
	first := h.say(t, "Hi, my name is Grace Wanjiru. My Toyota Corolla KDA 123X was hit by a matatu on Mombasa Road in Nairobi. The rear bumper is broken. Nobody was injured.")
	if !strings.Contains(strings.ToLower(first), "date") {
		t.Fatalf("should ask for the date: %q", first)
	}
	h.say(t, "I really can't say")
	offer := h.say(t, "no idea honestly")
	if !strings.Contains(offer, "approximate date") || !strings.Contains(offer, "agent") {
		t.Fatalf("after two failed attempts the bot must offer an approximate date or an agent:\n%s", offer)
	}
	recap := h.say(t, "ok, continue with an approximate date")
	if h.store.conv.Mode != ModeClaimConfirming || !strings.Contains(recap, "approximate") {
		t.Fatalf("approximate date not accepted after the offer:\n%s", recap)
	}
}

// ── cancel and media wording ────────────────────────────────────────────

func TestCancel_DiscardsPendingMedia(t *testing.T) {
	h := newHarness(t, "en", http.StatusCreated)
	dash := h.withDashboard(t)
	h.llm.chat = func(ai.CompletionRequest) string { return "[CLAIM] :: Where did it happen?" }
	h.llm.extract = func(ai.CompletionRequest) map[string]interface{} { return map[string]interface{}{"claimType": "AUTO"} }
	h.say(t, "My car was damaged, I want to file a claim")
	photo := h.sendPhoto(t)
	if strings.Contains(photo, "added to your file") || photo != botText("en", "photo.pending") {
		t.Fatalf("photo before the claim exists: %q", photo)
	}
	got := h.say(t, "actually cancel, I'll go to the office instead")
	if len(dash.discards) != 1 || dash.discards[0] != "cust-1" {
		t.Fatalf("pending media not discarded on cancel: %v", dash.discards)
	}
	if !strings.Contains(got, botText("en", "claim.cancelled")) || !strings.Contains(got, botText("en", "claim.mediaDiscarded")) {
		t.Fatalf("cancel reply = %q", got)
	}
	if h.store.conv.Mode != ModeGeneral || len(h.api.requests) != 0 {
		t.Fatalf("cancel must not create a claim")
	}
}

func TestPhotoWithOpenClaimSaysAdded(t *testing.T) {
	d := newDashboardStub(t)
	d.pending = false
	sk := &SemanticKernelService{cfg: &config.Config{FrontendBaseURL: d.srv.URL, InternalAPIKey: "k"}, log: newHarness(t, "en", 201).sk.log}
	if r := sk.HandlePhotoMessage(context.Background(), MediaUpload{CustomerID: "c", CompanyID: "k", Lang: "en", Data: jpegBytes}); r.Message != botText("en", "photo.saved") {
		t.Fatalf("photo on an open claim = %q", r.Message)
	}
}

// ── field quality ───────────────────────────────────────────────────────

func TestCleanPersonName(t *testing.T) {
	if got, ok := cleanPersonName("Grace Wanjiru Polcy"); !ok || got != "Grace Wanjiru" {
		t.Fatalf("policy typo kept in the name: %q %v", got, ok)
	}
	if got, ok := cleanPersonName("Ana Pollack"); !ok || got != "Ana Pollack" {
		t.Fatalf("real surname dropped: %q", got)
	}
	for _, bad := range []string{"a taxi", "a truck", "the driver", "Taxi-bus", "Ezali", "un camion", "unknown", "someone", "KIN-3344", "ezali na"} {
		if v, ok := cleanPersonName(bad); ok {
			t.Errorf("cleanPersonName(%q) = %q, want rejected", bad, v)
		}
	}
	for in, want := range map[string]string{"Ezali Grâce Mukendi": "Grâce Mukendi", "Patrick Mbuyi": "Patrick Mbuyi", "Jean-Pierre Kabila": "Jean-Pierre Kabila", "is Samuel Tshibanda": "Samuel Tshibanda"} {
		if v, ok := cleanPersonName(in); !ok || v != want {
			t.Errorf("cleanPersonName(%q) = %q,%t want %q", in, v, ok, want)
		}
	}
	if n := extractCustomerName("Nkombo na ngai ezali Grâce Mukendi. Policy ACT-POLICY-2026-0450"); n != "Grâce Mukendi" {
		t.Errorf("Lingala name = %q", n)
	}
}

func TestOtherDriverNameNeverAVehicle(t *testing.T) {
	h := newHarness(t, "en", http.StatusCreated)
	cov := activaCoverage()
	cov[0].Fields = append(cov[0].Fields, CoverageField{Name: "otherDriverName", Label: "Other driver's name", Type: "text"})
	h.store.coverage = cov
	h.llm.extract = func(r ai.CompletionRequest) map[string]interface{} {
		a := faithfulExtraction(r)
		a["otherDriverName"] = "a matatu"
		return a
	}
	h.llm.chat = claimChat
	recap := h.say(t, fullAutoMessage)
	if strings.Contains(recap, "Other driver") {
		t.Fatalf("a vehicle saved as the other driver's name:\n%s", recap)
	}
}

func TestConciseSummary(t *testing.T) {
	raw := "Hi. So the other car came from the left at the roundabout and smashed into my passenger door. I need to make a claim. My name is Patrick Mbuyi, policy ACT-POLICY-2026-0333. It was really scary and I was shaking for an hour afterwards, my kids were crying in the back and we waited a long time."
	s := conciseSummary(raw)
	if len(strings.Fields(s)) > 31 || strings.Contains(s, "Patrick") || strings.Contains(s, "ACT-POLICY") || strings.Contains(s, "make a claim") {
		t.Fatalf("summary = %q", s)
	}
	if !strings.Contains(s, "smashed into my passenger door") {
		t.Fatalf("summary lost the event: %q", s)
	}
}

func TestVINNotAskedUnlessRequired(t *testing.T) {
	h := newHarness(t, "en", http.StatusCreated)
	h.llm.chat = func(ai.CompletionRequest) string {
		return "[CLAIM] :: Could you give me the VIN (chassis number) and the date?"
	}
	h.llm.extract = func(r ai.CompletionRequest) map[string]interface{} {
		a := faithfulExtraction(r)
		delete(a, "incidentDate")
		return a
	}
	got := h.say(t, "Hi, my name is Grace Wanjiru. My Toyota Corolla KDA 123X was hit by a matatu on Mombasa Road in Nairobi. The rear bumper is broken. Nobody was injured.")
	if strings.Contains(strings.ToLower(got), "vin") || strings.Contains(strings.ToLower(got), "chassis") {
		t.Fatalf("VIN asked although the claim type does not require it: %q", got)
	}
	if !strings.Contains(strings.ToLower(got), "date") {
		t.Fatalf("the missing date must still be asked: %q", got)
	}
}

func TestPolicyCarriedOverFromProfileWithConfirmation(t *testing.T) {
	h := newHarness(t, "en", http.StatusCreated)
	h.store.customer.PolicyNumber = "ACT-POLICY-2026-0222"
	h.llm.chat = claimChat
	h.llm.extract = faithfulExtraction
	recap := h.say(t, fullAutoMessage)
	if !strings.Contains(recap, "ACT-POLICY-2026-0222") || !strings.Contains(recap, "customer file") {
		t.Fatalf("policy from the profile must be shown for confirmation:\n%s", recap)
	}
	h.say(t, "yes")
	if h.api.requests[0].body["policyNumber"] != "ACT-POLICY-2026-0222" {
		t.Fatalf("policy not carried over: %v", h.api.requests[0].body["policyNumber"])
	}
}

func TestVehicleCorrectionUpdatesYearToo(t *testing.T) {
	h := newHarness(t, "en", http.StatusCreated)
	cov := activaCoverage()
	cov[0].Fields = append(cov[0].Fields, CoverageField{Name: "vehicleYear", Label: "Vehicle year", Type: "number"})
	h.store.coverage = cov
	h.llm.chat = func(ai.CompletionRequest) string { return "[CLAIM] :: Thanks, noted." }
	stale := func(r ai.CompletionRequest) map[string]interface{} {
		a := faithfulExtraction(r)
		a["vehicleMakeModel"] = "Toyota Corolla"
		a["vehicleYear"] = 2016
		delete(a, "damageDescription")
		return a
	}
	h.llm.extract = stale
	h.say(t, "Hi, my name is Grace Wanjiru. Yesterday my Toyota Corolla 2016, plate KDA 123X, was hit by a matatu on Mombasa Road in Nairobi. Nobody was injured.")
	// The model keeps the old vehicle and year: the correction must still win everywhere.
	recap := h.say(t, "Actually I was driving my wife's car that day, not mine: a Honda Fit 2014, plate KDA 123X. The rear bumper is broken.")
	if !strings.Contains(recap, "Honda Fit") || strings.Contains(recap, "Toyota Corolla") || !strings.Contains(recap, "2014") || strings.Contains(recap, "2016") {
		t.Fatalf("vehicle correction not applied to make/model and year:\n%s", recap)
	}
}

// ── Lingala and code-switching ──────────────────────────────────────────

func TestLingalaFallsBackToFrench(t *testing.T) {
	msg := "Mbote! Nazali na problème na motuka na ngai, j'ai eu un accident around last week"
	if l := DetectConversationLanguage(msg, nil); l != "ln" {
		t.Fatalf("detected %q, want ln", l)
	}
	if SupportedReplyLanguage("ln", "en") != "fr" || SupportedReplyLanguage("ln", "ln") != "ln" || SupportedReplyLanguage("sw", "en") != "sw" {
		t.Fatalf("Lingala must fall back to French unless the company language is Lingala")
	}
	h := newHarness(t, "en", http.StatusCreated)
	var prompt string
	h.llm.chat = func(r ai.CompletionRequest) string {
		if prompt == "" {
			prompt = r.SystemPrompt + r.Prompt
		}
		return "[INFO] :: Bonjour"
	}
	h.say(t, msg)
	if !strings.Contains(prompt, "French") || strings.Contains(prompt, "Lingala (") {
		t.Fatalf("the model must be told to answer in French:\n%s", prompt[len(prompt)-300:])
	}
	h.msgID++
	_ = h.flow.Handle(context.Background(), InboundMessage{ID: "wamid.audio", From: testSender, CompanyID: testCompany, Type: "audio"})
	if got := h.store.lastAssistant().Content; got != botText("fr", msgAudio) {
		t.Fatalf("templates must be French for a Lingala customer: %q", got)
	}
}

// ── customer profile ───────────────────────────────────────────────────

func TestProfileUpdates_OnlyEmptyOrExplicitCorrection(t *testing.T) {
	h := newHarness(t, "en", http.StatusCreated)
	h.sk.autoUpdateCustomerProfile("cust-1", "My name is Patrik Mbuyi, policy ACT-POLICY-2026-0333")
	h.sk.autoUpdateCustomerProfile("cust-1", "Also my name is spelled Patrick with c-k: actually my name is Patrick Mbuyi")
	h.sk.autoUpdateCustomerProfile("cust-1", "Policy ACT-POLICY-2026-0610 for the car and ACT-POLICY-2026-0611 for the house")
	h.sk.autoUpdateCustomerProfile("cust-1", "Nkombo na ngai ezali Grâce Mukendi")
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		h.store.mu.Lock()
		n := len(h.store.profileUpdates)
		h.store.mu.Unlock()
		if n >= 4 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	h.store.mu.Lock()
	got := strings.Join(h.store.profileUpdates, " | ")
	h.store.mu.Unlock()
	for _, want := range []string{"name=Patrik Mbuyi correction=false", "policy=ACT-POLICY-2026-0333 correction=false", "name=Patrick correction=true", "name=Grâce Mukendi correction=false"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing profile update %q in %s", want, got)
		}
	}
	if strings.Contains(got, "0610") || strings.Contains(got, "0611") || strings.Contains(got, "Ezali") {
		t.Errorf("ambiguous policy or invalid name stored: %s", got)
	}
	if fs := correctedProfileFields([]ChatMessage{{Role: "user", Content: "Also my name is spelled Patrick with c-k: my name is Patrick Mbuyi"}}); strings.Join(fs, ",") != "insuredFullName" {
		t.Errorf("corrected fields = %v", fs)
	}
}

func TestApproximateDateWording_TimeHedgeIsNotADateHedge(t *testing.T) {
	cases := map[string]bool{
		"It was at the Victoire roundabout in Kalamu, Kinshasa, on Monday 28 September around 6pm": false,
		"Sorry, I got the date wrong, it was Sunday 27 September, not Monday":                      false,
		"le 20 septembre vers 18h":                                          false,
		"j'ai eu un accident around last week":                              true,
		"Je sais pas exactement la date, peut-être mardi ou mercredi passé": true,
		"around the 20th of September":                                      true,
		"25 or 26 September":                                                true,
		"maybe last Tuesday":                                                true,
	}
	for text, want := range cases {
		if got := IsApproximateDateWording(text); got != want {
			t.Errorf("%q: approximate=%v, want %v", text, got, want)
		}
	}
	if ApproximateDateWording("Sorry, I got the date wrong, it was Sunday 27 September, not Monday") == "" {
		t.Fatal("an explicit corrected date must be recognised as date wording (it resets the approximate flag)")
	}
}

func TestUpset_ReferencesInCapitalsAreNotShouting(t *testing.T) {
	if IsUpsetMessage("My name is Esther Kalala, policy ACT-POLICY-2026-0610 for the car and ACT-POLICY-2026-0611, plate LUB-1123-EF.") {
		t.Fatal("policy numbers and plates were taken for shouting")
	}
	if !IsUpsetMessage("I pay you every month for NOTHING and NOBODY calls") {
		t.Fatal("real shouting not detected")
	}
}

func TestReplyGuard_DocumentsAnswerAndContactNumber(t *testing.T) {
	coverage := defaultCoverage()
	draft := &ClaimDraft{TypeName: "AUTO", MissingNames: []string{"vehicleMakeModel"}}
	if !IsDocumentsQuestion("And what documents do I need to send for this new claim?") {
		t.Fatal("documents question not recognised")
	}
	if got := asksForUnneededField("Merci Grâce. Pourriez-vous me donner le numéro de téléphone où nous pouvons vous joindre ?", draft, coverage); got != "phoneNumber" {
		t.Fatalf("asking for the phone number (already known from WhatsApp) not caught: %q", got)
	}
	if got := asksForUnneededField("Please send photos and the police report if you have one. What is the make and model of your car?", draft, coverage); got != "" {
		t.Fatalf("a statement about documents was treated as a question: %q", got)
	}
}

// Scenario D (live run): the damage was still missing after the vague date,
// and the model re-guessed "Wednesday" on the next turn. The exact date must
// stay empty; the approximate wording stays.
func TestApproximateDate_AlternativesStayApproximateOnLaterTurns(t *testing.T) {
	h := newHarness(t, "fr", http.StatusCreated)
	h.llm.chat = func(ai.CompletionRequest) string { return "[CLAIM] :: Merci." }
	h.llm.extract = func(r ai.CompletionRequest) map[string]interface{} {
		a := faithfulExtraction(r)
		a["incidentDate"] = "2026-09-23" // "mercredi passé", one of the two days
		if !strings.Contains(r.Prompt+r.SystemPrompt, "Bumper") && !strings.Contains(r.Prompt+r.SystemPrompt, "pare-choc") {
			delete(a, "damageDescription")
		}
		return a
	}
	h.say(t, "Bonjour, je m'appelle Grace Wanjiru. Ma Toyota Corolla KDA 123X a été heurtée par un matatu sur Mombasa Road à Nairobi. Personne n'est blessé.")
	h.say(t, "Je sais pas exactement la date, peut-être mardi ou mercredi passé")
	recap := h.say(t, "Le pare-choc arrière est cassé.")
	if h.store.conv.Mode != ModeClaimConfirming {
		t.Fatalf("expected the recap:\n%s", recap)
	}
	if strings.Contains(recap, "2026-09-23") || !strings.Contains(recap, "mardi ou mercredi") {
		t.Fatalf("a re-guessed day replaced the customer's approximate date:\n%s", recap)
	}
}

// Scenario F (live run): "Chantal Mwamba." without "my name is", then the
// claim is cancelled. The nameless customer still gets the name.
func TestDraftNameFillsEmptyProfile(t *testing.T) {
	h := newHarness(t, "en", http.StatusCreated)
	h.llm.chat = func(ai.CompletionRequest) string { return "[CLAIM] :: Thanks." }
	calls := 0
	h.llm.extract = func(r ai.CompletionRequest) map[string]interface{} {
		calls++
		a := faithfulExtraction(r)
		if calls == 1 {
			delete(a, "insuredFullName") // the name only comes in the second message
		}
		return a
	}
	h.say(t, "Hi, my Toyota Corolla KDA 123X was hit by a matatu on Mombasa Road in Nairobi.")
	h.say(t, "Grace Wanjiru.")
	found := false
	for _, u := range h.store.profileUpdates {
		if u == "name=Grace Wanjiru correction=false" {
			found = true
		}
	}
	if !found {
		t.Fatalf("draft name not stored on the empty profile: %v", h.store.profileUpdates)
	}
}

func TestBareNameAnswer(t *testing.T) {
	if got := bareNameAnswer("Chantal Mwamba. 7 avenue Kasa-Vubu, Bandalungwa, Kinshasa."); got != "Chantal Mwamba" {
		t.Fatalf("got %q", got)
	}
	for _, s := range []string{"I still don't want to give it.", "yes", "Part of the roof flew off.", "Kinshasa."} {
		if got := bareNameAnswer(s); got != "" {
			t.Fatalf("%q taken as a name: %q", s, got)
		}
	}
	if !lastAssistantAskedName([]ChatMessage{{Role: "assistant", Content: "Could you please give me your home policy number and your full name?"}, {Role: "user", Content: "Chantal Mwamba."}}) {
		t.Fatal("name question not recognised")
	}
}

func TestStatementSentences(t *testing.T) {
	got := statementSentences("I understand your concern. We only use it to find your file. Could you share it?")
	if got != "I understand your concern. We only use it to find your file." {
		t.Fatalf("got %q", got)
	}
	if statementSentences("Could you share it?") != "" {
		t.Fatal("a pure question must give nothing")
	}
}

func TestNarrativeBackfill_CrackedWindscreen(t *testing.T) {
	msg := "I need to report a new incident: on 30 September 2026 a stone cracked the windscreen of the same Toyota RAV4 2020 KIN-1201-QA on boulevard du 30 Juin, Gombe. Nobody was hurt. Same policy ACT-POLICY-2026-1201."
	got := conciseSummary(extractNarrative(msg))
	if !strings.Contains(got, "cracked the windscreen") {
		t.Fatalf("what happened = %q", got)
	}
	for _, m := range []string{"A pipe burst under the sink and flooded the kitchen floor", "Le pare-brise a été fissuré par un caillou sur la route"} {
		if !eventWordPattern.MatchString(m) {
			t.Fatalf("no event word in %q", m)
		}
	}
}

func TestConciseSummary_DropsPreamble(t *testing.T) {
	got := conciseSummary("Hello again, I need to report a new incident: yesterday, 30 September, a stone thrown by a truck cracked my windscreen on the Route de Matadi near Kintambo. Same car.")
	if strings.Contains(got, "Hello") || !strings.Contains(got, "cracked my windscreen") {
		t.Fatalf("what happened = %q", got)
	}
	if got := conciseSummary("At 10:30 a taxi hit my car at the roundabout"); !strings.Contains(got, "10:30") {
		t.Fatalf("times must stay: %q", got)
	}
}

func TestAnswerAskedYesNo_ReceiptsAvailable(t *testing.T) {
	fields := []CoverageField{{Name: "receiptsAvailable", Type: "boolean", Required: true}, {Name: "treatmentDate", Type: "date"}}
	prev := &ClaimDraft{AskedFields: []string{"receiptsAvailable"}}
	draft := &ClaimDraft{Fields: map[string]interface{}{}}
	if got := answerAskedYesNo(draft, fields, prev, "Yes, I have the invoice and the receipt from the clinic."); len(got) != 1 || draft.Fields["receiptsAvailable"] != true {
		t.Fatalf("yes answer: filled=%v fields=%v", got, draft.Fields)
	}
	draft = &ClaimDraft{Fields: map[string]interface{}{}}
	if answerAskedYesNo(draft, fields, prev, "Non, pas encore"); draft.Fields["receiptsAvailable"] != false {
		t.Fatalf("no answer: %v", draft.Fields)
	}
	// Not asked, two fields asked, or no yes/no word: nothing is filled.
	for _, c := range []struct {
		prev *ClaimDraft
		msg  string
	}{
		{&ClaimDraft{AskedFields: []string{"treatmentDate"}}, "yes"},
		{&ClaimDraft{AskedFields: []string{"receiptsAvailable", "treatmentDate"}}, "yes"},
		{prev, "I paid 420 USD"},
		{prev, "Nobody told me"},
	} {
		draft = &ClaimDraft{Fields: map[string]interface{}{}}
		if got := answerAskedYesNo(draft, fields, c.prev, c.msg); len(got) != 0 {
			t.Fatalf("%q with asked=%v filled %v", c.msg, c.prev.AskedFields, got)
		}
	}
}

func TestGroundID_TrimsPunctuation(t *testing.T) {
	c := newGroundingCorpus([]ChatMessage{{Role: "user", Content: "I am Mariam Ngoy, health policy DEMO-HEALTH-2026-0144. I was treated for malaria."}}, time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC))
	v, ok := c.groundValue(CoverageField{Name: "policyNumber", Type: "text"}, "DEMO-HEALTH-2026-0144:")
	if !ok || v != "DEMO-HEALTH-2026-0144" {
		t.Fatalf("policy = %v (%v)", v, ok)
	}
}

func TestBuildClaimPayload_NoRepeatedDamage(t *testing.T) {
	parts := addDescriptionPart(nil, "a minibus hit the back of my Toyota Corolla 2018. The rear bumper and the left tail light are broken.")
	parts = addDescriptionPart(parts, "The rear bumper and the left tail light are broken.")
	if len(parts) != 1 {
		t.Fatalf("damage repeated: %q", parts)
	}
	parts = addDescriptionPart([]string{"malaria treatment"}, "Treated for malaria treatment at the clinic")
	parts = addDescriptionPart(parts, "Treatment details: 3 days")
	if len(parts) != 2 || !strings.HasPrefix(parts[0], "Treated") {
		t.Fatalf("parts = %q", parts)
	}
}
