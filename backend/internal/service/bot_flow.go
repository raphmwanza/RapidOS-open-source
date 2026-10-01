package service

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"

	"rapidos/internal/logger"
)

// Conversation modes.
const (
	ModeGeneral         = "general"
	ModeClaimFiling     = "claim_filing"
	ModeClaimConfirming = "claim_confirming"
)

// Claim events stored in assistant message metadata.
const (
	claimEventDraft        = "draft"
	claimEventRecap        = "recap"
	claimEventSubmitted    = "submitted"
	claimEventSubmitFailed = "submit_failed"
	claimEventCancelled    = "cancelled"
)

// flowStore is the persistence used by BotFlow (DatabaseService in production).
type flowStore interface {
	GetOrCreateCustomer(phoneNumber, companyID string) (*CustomerInfo, error)
	GetOrCreateConversationByWhatsAppID(whatsappID, customerID, companyID string) (*ConversationInfo, error)
	ResetExpiredConversationMode(conversationID string, maxAge time.Duration) (bool, error)
	CheckIfBotPaused(conversationID string) (bool, error)
	CheckIfEscalated(conversationID string) (bool, error)
	MarkConversationAsEscalated(conversationID string) error
	SaveMessage(conversationID, content, role string) (*MessageInfo, error)
	SaveMessageWithMetadata(conversationID, content, role string, metadata map[string]interface{}) (*MessageInfo, error)
	GetRecentMessages(conversationID string, limit int) ([]MessageInfo, error)
	GetCustomerClaims(customerID string) ([]ClaimInfo, error)
	SetConversationMode(conversationID, mode string) error
	GetCompanySettings(companyID string) ([]CompanySettingInfo, error)
	GetBotLanguage(companyID string) string
	GetCompanyCoverage(companyID string) ([]CoverageInfo, error)
}

// flowBrain is the AI side of the flow (SemanticKernelService in production).
type flowBrain interface {
	Converse(ctx context.Context, t GeneralTurn) (*GeneralConversationResponse, error)
	PrepareClaimDraft(ctx context.Context, req ClaimDraftRequest) (*ClaimDraft, error)
	HandlePhotoMessage(ctx context.Context, m MediaUpload) *GeneralConversationResponse
	HandleDocumentMessage(ctx context.Context, m MediaUpload) *GeneralConversationResponse
	// DiscardPendingMedia deletes the photos/documents kept for a claim that
	// was never created (the customer cancelled). It returns how many.
	DiscardPendingMedia(ctx context.Context, companyID, customerID, phone string) (int, error)
}

// TextSender delivers WhatsApp text messages.
type TextSender interface {
	SendTextMessage(to, message string) error
}

// InboundMessage is one customer WhatsApp message, already downloaded.
type InboundMessage struct {
	ID        string
	From      string
	CompanyID string
	Type      string // text, image, document, video, audio
	Text      string
	Caption   string
	Filename  string
	MimeType  string
	Media     []byte
	MediaErr  error
}

// BotFlow runs one WhatsApp conversation turn: persistence, routing, claim
// collection with grounding, the confirmation step and claim creation.
type BotFlow struct {
	store  flowStore
	brain  flowBrain
	claims ClaimCreator
	sender TextSender
	log    *logger.Logger
	now    func() time.Time
}

// NewBotFlow wires a flow.
func NewBotFlow(store flowStore, brain flowBrain, claims ClaimCreator, sender TextSender, log *logger.Logger) *BotFlow {
	if log == nil {
		log = logger.New()
	}
	return &BotFlow{store: store, brain: brain, claims: claims, sender: sender, log: log, now: time.Now}
}

const historyLimit = 40

type turnState struct {
	in           InboundMessage
	phone        string
	customer     *CustomerInfo
	conv         *ConversationInfo
	mode         string
	history      []ChatMessage // includes the current message
	metas        []map[string]interface{}
	claims       []CustomerClaim
	settings     []CompanySettingInfo
	behavior     BotBehavior
	companyLang  string
	customerLang string
	replyLang    string
}

// Handle processes one inbound message end to end.
func (f *BotFlow) Handle(ctx context.Context, in InboundMessage) error {
	if in.CompanyID == "" {
		return fmt.Errorf("company id is required")
	}
	st := &turnState{in: in, phone: normalizePhoneNumber(in.From)}
	customer, err := f.store.GetOrCreateCustomer(st.phone, in.CompanyID)
	if err != nil || customer == nil {
		return fmt.Errorf("customer for %s: %v", st.phone, err)
	}
	st.customer = customer
	conv, err := f.store.GetOrCreateConversationByWhatsAppID(in.ID, customer.ID, in.CompanyID)
	if err != nil || conv == nil {
		return fmt.Errorf("conversation for %s: %v", st.phone, err)
	}
	st.conv = conv
	st.mode = conv.Mode
	if st.mode == "" {
		st.mode = ModeGeneral
	}
	if st.mode != ModeGeneral && conv.ModeSetAt != nil {
		if expired, _ := f.store.ResetExpiredConversationMode(conv.ID, 24*time.Hour); expired {
			st.mode = ModeGeneral
		}
	}

	userContent := inboundContent(in)
	if paused, _ := f.store.CheckIfBotPaused(conv.ID); paused {
		// Support took over: store what the customer sent, reply nothing.
		_, _ = f.store.SaveMessage(conv.ID, userContent, "user")
		if (in.Type == "image" || in.Type == "document") && len(in.Media) > 0 && in.MediaErr == nil {
			upload := MediaUpload{
				CustomerID: customer.ID, CompanyID: in.CompanyID, Phone: st.phone, Lang: NormalizeBotLanguage(f.store.GetBotLanguage(in.CompanyID)),
				Data: in.Media, Filename: in.Filename, MimeType: in.MimeType, Caption: in.Caption,
				Pending: st.mode == ModeClaimFiling || st.mode == ModeClaimConfirming,
			}
			if in.Type == "image" {
				_ = f.brain.HandlePhotoMessage(ctx, upload)
			} else {
				_ = f.brain.HandleDocumentMessage(ctx, upload)
			}
		}
		f.log.Infof("⏸️ [PAUSED] Bot paused for conversation %s: message stored, no reply", conv.ID)
		return nil
	}
	if _, err := f.store.SaveMessage(conv.ID, userContent, "user"); err != nil {
		f.log.Errorf("Failed to save incoming message: %v", err)
	}
	f.loadContext(st)

	switch {
	case in.Type == "audio":
		return f.reply(st, botText(st.replyLang, msgAudio), nil)
	case in.MediaErr != nil:
		f.log.Errorf("📷 [MEDIA] %v", in.MediaErr)
		return f.reply(st, botText(st.replyLang, msgMediaError), nil)
	case (in.Type == "image" || in.Type == "document") && len(in.Media) > 0:
		upload := MediaUpload{
			CustomerID: customer.ID, CompanyID: in.CompanyID, Phone: st.phone, Lang: st.replyLang,
			Data: in.Media, Filename: in.Filename, MimeType: in.MimeType, Caption: in.Caption,
			// While a claim is being filed the file belongs to that new claim.
			Pending: st.mode == ModeClaimFiling || st.mode == ModeClaimConfirming,
		}
		if in.Type == "image" {
			return f.reply(st, f.brain.HandlePhotoMessage(ctx, upload).Message, nil)
		}
		return f.reply(st, f.brain.HandleDocumentMessage(ctx, upload).Message, nil)
	case in.Type != "text":
		return f.reply(st, botText(st.replyLang, msgMediaError), nil)
	}
	return f.handleText(ctx, st)
}

func inboundContent(in InboundMessage) string {
	caption := strings.TrimSpace(in.Caption)
	suffix := ""
	if caption != "" {
		suffix = " " + caption
	}
	switch in.Type {
	case "text":
		return in.Text
	case "image":
		return "[📷 Photo]" + suffix
	case "document":
		name := in.Filename
		if name == "" {
			name = "document"
		}
		return "[📄 " + name + "]" + suffix
	case "video":
		return "[🎥 Video]" + suffix
	case "audio":
		return "[🎤 Voice message]"
	}
	return "[" + in.Type + "]" + suffix
}

func (f *BotFlow) loadContext(st *turnState) {
	if msgs, err := f.store.GetRecentMessages(st.conv.ID, historyLimit); err == nil {
		for _, m := range msgs {
			st.history = append(st.history, ChatMessage{Role: m.Role, Content: m.Content, Timestamp: m.CreatedAt.UTC().Format(time.RFC3339)})
			meta := map[string]interface{}{}
			if strings.TrimSpace(m.Metadata) != "" {
				_ = json.Unmarshal([]byte(m.Metadata), &meta)
			}
			st.metas = append(st.metas, meta)
		}
	}
	if claims, err := f.store.GetCustomerClaims(st.customer.ID); err == nil {
		for _, c := range claims {
			date := ""
			if !c.CreatedAt.IsZero() {
				date = c.CreatedAt.UTC().Format("2006-01-02")
			}
			incident := ""
			if !c.IncidentDate.IsZero() {
				incident = c.IncidentDate.UTC().Format("2006-01-02")
			}
			_ = incident
			st.claims = append(st.claims, CustomerClaim{ClaimNumber: c.ClaimNumber, Type: c.Type, Status: c.Status, Description: c.Description, Amount: fmt.Sprintf("$%.2f", c.EstimatedAmount), Date: firstNonEmptyString(date, incident)})
		}
	}
	if s, err := f.store.GetCompanySettings(st.in.CompanyID); err == nil {
		st.settings = s
	}
	st.behavior = BehaviorFromSettings(st.settings)
	st.companyLang = NormalizeBotLanguage(f.store.GetBotLanguage(st.in.CompanyID))
	current := inboundContent(st.in)
	st.customerLang = SupportedReplyLanguage(DetectConversationLanguage(current, st.history), st.companyLang)
	st.replyLang = ReplyLanguage(st.companyLang, st.customerLang, st.behavior)
}

func firstNonEmptyString(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// previousHistory is the conversation before the current message.
func (st *turnState) previousHistory() []ChatMessage {
	if n := len(st.history); n > 0 && st.history[n-1].Role == "user" {
		return st.history[:n-1]
	}
	return st.history
}

// claimSession returns the messages of the current claim: everything after
// the last submitted/cancelled claim.
func (st *turnState) claimSession() []ChatMessage {
	start := 0
	for i, meta := range st.metas {
		switch meta["claimEvent"] {
		case claimEventSubmitted, claimEventCancelled:
			start = i + 1
		}
	}
	if start > len(st.history) {
		return nil
	}
	return st.history[start:]
}

// latestDraft returns the most recent draft of the current claim session.
func (st *turnState) latestDraft(recapOnly bool) *ClaimDraft {
	for i := len(st.metas) - 1; i >= 0; i-- {
		ev, _ := st.metas[i]["claimEvent"].(string)
		if ev == claimEventSubmitted && !recapOnly {
			// A queued incident starts right after the previous claim.
			if raw, ok := st.metas[i]["nextDraft"]; ok {
				b, _ := json.Marshal(raw)
				var d ClaimDraft
				if json.Unmarshal(b, &d) == nil && d.TypeName != "" {
					if d.Fields == nil {
						d.Fields = map[string]interface{}{}
					}
					return &d
				}
			}
		}
		if ev == claimEventSubmitted || ev == claimEventCancelled {
			return nil
		}
		if recapOnly && ev != claimEventRecap {
			continue
		}
		raw, ok := st.metas[i]["claimDraft"]
		if !ok {
			continue
		}
		b, _ := json.Marshal(raw)
		var d ClaimDraft
		if json.Unmarshal(b, &d) == nil && d.Fields != nil {
			return &d
		}
	}
	return nil
}

func (st *turnState) customerName() string {
	name := strings.TrimSpace(st.customer.FirstName + " " + st.customer.LastName)
	if digitsOnly(name) != "" && digitsOnly(name) == digitsOnly(st.phone) {
		return ""
	}
	return name
}

func (st *turnState) allUserText() string {
	var parts []string
	for _, m := range st.history {
		if m.Role == "user" {
			parts = append(parts, m.Content)
		}
	}
	return strings.Join(parts, "\n")
}

func (f *BotFlow) setMode(st *turnState, mode string) {
	if st.mode == mode {
		return
	}
	if err := f.store.SetConversationMode(st.conv.ID, mode); err != nil {
		f.log.Errorf("Failed to set conversation mode: %v", err)
	}
	f.log.Infof("🔄 [MODE] Conversation %s: %s → %s", st.conv.ID, st.mode, mode)
	st.mode = mode
}

// reply saves the assistant message (with optional metadata) and sends it.
func (f *BotFlow) reply(st *turnState, text string, meta map[string]interface{}) error {
	// Support may have paused the bot while this turn was being processed.
	if paused, _ := f.store.CheckIfBotPaused(st.conv.ID); paused {
		f.log.Infof("⏸️ [PAUSED] Bot paused for conversation %s during the turn: reply not sent", st.conv.ID)
		return nil
	}
	text = strings.TrimSpace(text)
	if text == "" {
		text = generalFallbackMessage(st.replyLang, "general")
	}
	var err error
	if meta != nil {
		_, err = f.store.SaveMessageWithMetadata(st.conv.ID, text, "assistant", meta)
	} else {
		_, err = f.store.SaveMessage(st.conv.ID, text, "assistant")
	}
	if err != nil {
		f.log.Errorf("❌ [DATABASE] Failed to save assistant reply: %v", err)
	}
	if f.sender == nil {
		return nil
	}
	if sendErr := f.sender.SendTextMessage(st.in.From, text); sendErr != nil {
		f.log.Errorf("❌ [WHATSAPP] Failed to send reply to %s: %v", st.phone, sendErr)
		return sendErr
	}
	return nil
}

// cancelClaim stops the claim being filed. Photos and documents kept for it
// are deleted, so they can never be attached to a later claim.
func (f *BotFlow) cancelClaim(ctx context.Context, st *turnState) error {
	f.setMode(st, ModeGeneral)
	msg := botText(st.replyLang, "claim.cancelled")
	meta := map[string]interface{}{"claimEvent": claimEventCancelled}
	if n, err := f.brain.DiscardPendingMedia(ctx, st.in.CompanyID, st.customer.ID, st.phone); err != nil {
		f.log.Errorf("❌ [CANCEL] Could not discard pending media for %s: %v", st.phone, err)
	} else if n > 0 {
		f.log.Infof("🗑️ [CANCEL] Discarded %d pending file(s) for %s", n, st.phone)
		msg += "\n" + botText(st.replyLang, "claim.mediaDiscarded")
		meta["discardedMedia"] = n
	}
	return f.reply(st, msg, meta)
}

func (f *BotFlow) handleText(ctx context.Context, st *turnState) error {
	text := st.in.Text

	// ── confirmation step ────────────────────────────────────────────────
	if st.mode == ModeClaimConfirming {
		pending := st.latestDraft(true)
		switch {
		case pending == nil:
			f.setMode(st, ModeClaimFiling)
		case IsCancelMessage(text):
			return f.cancelClaim(ctx, st)
		default:
			switch ClassifyConfirmation(text) {
			case "yes":
				return f.submitClaim(ctx, st, pending)
			case "no":
				f.setMode(st, ModeClaimFiling)
				return f.reply(st, botText(st.replyLang, "claim.whatToChange"), map[string]interface{}{"claimEvent": claimEventDraft, "claimDraft": pending})
			}
			// Anything else is a correction or a question: back to collecting.
			f.setMode(st, ModeClaimFiling)
		}
	}
	if st.mode == ModeClaimFiling && IsCancelMessage(text) {
		return f.cancelClaim(ctx, st)
	}
	if IsStrongInjectionAttempt(text) {
		f.log.Warnf("🛡️ [INJECTION GUARD] Refused an instruction-override / prompt-leak message from %s", st.phone)
		return f.reply(st, botText(st.replyLang, "guard.injection"), map[string]interface{}{"guard": "injection"})
	}

	resp, err := f.brain.Converse(ctx, GeneralTurn{
		CustomerID: st.customer.ID, CompanyID: st.in.CompanyID, Message: text, WhatsAppPhone: st.phone,
		Mode: st.mode, History: st.previousHistory(), Settings: st.settings, Claims: st.claims,
		CustomerLanguage: st.customerLang,
	})
	if err != nil || resp == nil {
		f.log.Errorf("❌ [AI] %v", err)
		return f.reply(st, botText(st.replyLang, msgTechError), nil)
	}
	intent := resp.Intent

	// ── deterministic intent guard rails ─────────────────────────────────
	inClaim := st.mode == ModeClaimFiling
	switch {
	case st.behavior.HumanHandoff && IsHumanRequest(text):
		intent = "escalation"
		resp.NeedsEscalation = true
	case inClaim && st.behavior.StatusLookup && IsStatusQuestion(text, st.claims):
		intent = "status_inquiry"
	case intent == "cancel" && !inClaim:
		intent = "general"
	case !inClaim && intent != "claim" && intent != "escalation" && IsClaimStart(text):
		intent = "claim"
	}
	f.log.Infof("🧭 [ROUTE] model=%s final=%s mode=%s lang=%s", resp.Intent, intent, st.mode, st.replyLang)

	if intent == "cancel" && inClaim {
		return f.cancelClaim(ctx, st)
	}

	message := resp.Message
	userText := st.allUserText()

	switch {
	case intent == "status_inquiry" && st.behavior.StatusLookup:
		message = StatusListMessage(st.replyLang, st.claims)
		if inClaim {
			message += "\n\n" + botText(st.replyLang, "claim.resumeHint")
		}
	case intent == "escalation" || resp.NeedsEscalation:
		// handled below
	case intent == "question":
		// quotes / general questions: keep the model's answer
	default:
		if intent == "claim" && st.mode != ModeClaimFiling {
			f.setMode(st, ModeClaimFiling)
		}
		if st.mode == ModeClaimFiling {
			return f.continueClaim(ctx, st, resp, intent)
		}
	}

	var meta map[string]interface{}
	if intent != "status_inquiry" && FabricatedClaimReply(message, st.claims, userText) {
		f.log.Warnf("🛡️ [REPLY GUARD] Removed a reply that claimed a registration or quoted an unknown claim number")
		message = generalFallbackMessage(st.replyLang, "general")
	}
	if intent != "status_inquiry" && IsUpsetMessage(text) && !HasEmpathy(message) {
		message = botText(st.replyLang, "claim.ackUpset") + "\n\n" + strings.TrimSpace(message)
	}
	if resp.NeedsEscalation && st.behavior.HumanHandoff {
		// One support alert per escalation: while the conversation is still
		// flagged (support has not resolved it), no new alert is sent. The
		// bot keeps answering until support pauses it from the dashboard.
		already, _ := f.store.CheckIfEscalated(st.conv.ID)
		if already {
			f.log.Infof("🚨 [ESCALATION] Conversation %s is already escalated: no new alert", st.conv.ID)
			if strings.TrimSpace(message) == "" {
				message = botText(st.replyLang, "escalated.already")
			}
		} else {
			if err := f.store.MarkConversationAsEscalated(st.conv.ID); err != nil {
				f.log.Errorf("Failed to mark conversation as escalated: %v", err)
			}
			message = strings.TrimSpace(message) + "\n\n" + botText(st.replyLang, msgEscalated)
			meta = map[string]interface{}{"escalation": "alerted"}
		}
	}
	return f.reply(st, message, meta)
}

// continueClaim updates the claim draft and either asks for what is missing
// or shows the summary to confirm.
func (f *BotFlow) continueClaim(ctx context.Context, st *turnState, resp *GeneralConversationResponse, intent string) error {
	session := st.claimSession()
	previous := st.latestDraft(false)
	draft, err := f.brain.PrepareClaimDraft(ctx, ClaimDraftRequest{
		CompanyID: st.in.CompanyID, WhatsAppPhone: st.phone, CustomerName: st.customerName(),
		Session: session, AllUserText: st.allUserText(), Previous: previous,
		CurrentMessage: st.in.Text, CustomerPolicy: strings.TrimSpace(st.customer.PolicyNumber),
	})
	message := resp.Message
	userText := st.allUserText()
	upset := IsUpsetMessage(st.in.Text)
	ack := ""
	if upset {
		ack = botText(st.replyLang, "claim.ackUpset")
	}
	if err != nil || draft == nil {
		f.log.Warnf("⚠️ [CLAIM] Draft unavailable: %v", err)
		if FabricatedClaimReply(message, st.claims, userText) {
			message = botText(st.replyLang, "claim.describe")
		}
		if upset && !HasEmpathy(message) {
			message = ack + "\n\n" + message
		}
		return f.reply(st, message, nil)
	}
	meta := map[string]interface{}{"claimEvent": claimEventDraft, "claimDraft": draft}
	f.fillProfileNameFromDraft(st, draft)
	coverage, _ := f.store.GetCompanyCoverage(st.in.CompanyID)
	if len(coverage) == 0 {
		coverage = defaultCoverage()
	}
	var lead []string
	if upset {
		lead = append(lead, ack)
	}
	announce := len(draft.Queue) > 0 && !draft.QueueAnnounced
	if announce {
		draft.QueueAnnounced = true
		lead = append(lead, fillPlaceholders(botText(st.replyLang, "claim.multiIncident"), map[string]string{
			"first":  claimTypeLabel(st.replyLang, st.companyLang, draft.TypeName, draft.DisplayName),
			"second": claimTypeLabel(st.replyLang, st.companyLang, draft.Queue[0], displayNameFor(coverage, draft.Queue[0])),
		}))
	}
	compose := func(body string) string {
		return strings.TrimSpace(strings.Join(append(append([]string(nil), lead...), strings.TrimSpace(body)), "\n\n"))
	}
	if draft.Complete() {
		f.setMode(st, ModeClaimConfirming)
		meta["claimEvent"] = claimEventRecap
		return f.reply(st, compose(ClaimRecapMessageFor(st.replyLang, st.companyLang, draft, coverage)), meta)
	}
	// The date could not be pinned down twice: offer an approximate date or
	// an agent instead of asking again.
	if draft.dateMissing() && draft.DateAttempts >= 2 && !draft.DateOffered {
		draft.DateOffered = true
		draft.AskedFields = []string{draft.DateField}
		f.log.Infof("📅 [CLAIM] Date still unknown after %d attempts: offering an approximate date or an agent", draft.DateAttempts)
		return f.reply(st, compose(botText(st.replyLang, "claim.dateOffer")), meta)
	}
	ask := AskNextMessage(st.replyLang, st.companyLang, draft, coverage)
	fabricated := FabricatedClaimReply(message, st.claims, userText)
	if fabricated {
		f.log.Warnf("🛡️ [REPLY GUARD] Model pretended the claim was registered; asking for the missing information instead")
	}
	unneeded := ""
	if !IsDocumentsQuestion(userText) {
		// Listing a police report among the supporting documents is a fair
		// answer to "what documents do I need?"; asking for it as data is not.
		unneeded = asksForUnneededField(message, draft, coverage)
	}
	if unneeded != "" {
		f.log.Warnf("🛡️ [REPLY GUARD] Model asked for %s, which this claim type does not require", unneeded)
	}
	switch {
	case fabricated && draft.TypeName != "":
		message = ask
	case fabricated:
		message = botText(st.replyLang, "claim.describe")
	case draft.TypeName == "":
		// keep the model's question about the type of claim
	case announce, unneeded != "":
		message = ask
	case asksAboutMissing(message, draft):
		// keep the model's natural question; it already acknowledges the customer
		if upset && HasEmpathy(message) {
			lead = lead[1:]
		}
	case intent == "claim" && strings.ContainsAny(st.in.Text, "?؟") && statementSentences(message) != "":
		// The customer asked something ("why do you need my policy number?"):
		// keep the model's answer (not its own questions), then ask for what
		// is really missing.
		message = statementSentences(message) + "\n\n" + ask
	case intent == "claim":
		// The model asked about something already known (or nothing): ask
		// for what is really missing.
		message = ask
	default:
		// An off-topic question during the claim: keep the answer and
		// remind the customer what is still needed.
		message = strings.TrimSpace(message) + "\n\n" + ask
	}
	draft.AskedFields = askedFields(message, draft)
	return f.reply(st, compose(message), meta)
}

// profileNameWriter is implemented by the database store.
type profileNameWriter interface {
	UpdateCustomerName(customerID, fullName string, correction bool) error
}

// fillProfileNameFromDraft gives a still nameless customer the insured name
// the claim draft grounded ("Chantal Mwamba." without "my name is"), so the
// dashboard shows who they are even if the claim is cancelled. A name already
// on the profile is never replaced here.
func (f *BotFlow) fillProfileNameFromDraft(st *turnState, draft *ClaimDraft) {
	if st.customer == nil || strings.TrimSpace(st.customer.FirstName) != "" || draft == nil {
		return
	}
	w, ok := f.store.(profileNameWriter)
	if !ok {
		return
	}
	raw, _ := draft.Fields["insuredFullName"].(string)
	if containsFold(draft.FromProfile, "insuredFullName") {
		raw = ""
	}
	if strings.TrimSpace(raw) == "" && lastAssistantAskedName(st.history) {
		raw = bareNameAnswer(st.in.Text) // "Chantal Mwamba. 7 avenue Kasa-Vubu…"
	}
	name, valid := cleanPersonName(raw)
	if !valid || len(strings.Fields(name)) < 2 {
		return
	}
	if err := w.UpdateCustomerName(st.customer.ID, name, false); err == nil {
		parts := strings.Fields(name)
		st.customer.FirstName, st.customer.LastName = parts[0], strings.Join(parts[1:], " ")
	}
}

var askedNamePattern = compileFolded(`\bname\b`, `\bnom\b`, `\bjina\b`, `\bnombre\b`, `\bnome\b`, `\bnkombo\b`, `\bnama\b`, `\bpangalan\b`)

// lastAssistantAskedName: the bot's previous message asked for a name.
func lastAssistantAskedName(history []ChatMessage) bool {
	for i := len(history) - 1; i >= 0; i-- {
		if history[i].Role == "assistant" {
			return strings.ContainsAny(history[i].Content, "?؟") && askedNamePattern.MatchString(foldText(history[i].Content))
		}
	}
	return false
}

// bareNameAnswer returns the leading "Firstname Lastname" of a reply that
// starts with the name ("Chantal Mwamba. 7 avenue…"), or "".
func bareNameAnswer(text string) string {
	lead := strings.TrimSpace(text)
	if i := strings.IndexAny(lead, ".,;\n"); i >= 0 {
		lead = lead[:i]
	}
	words := strings.Fields(lead)
	if len(words) < 2 || len(words) > 4 {
		return ""
	}
	for _, w := range words {
		r := []rune(w)
		if len(r) < 2 || !unicode.IsUpper(r[0]) {
			return ""
		}
	}
	return lead
}

// claimTypeLabel is the name of a coverage type in the reply language.
func claimTypeLabel(lang, companyLang, typeName, display string) string {
	if lang != companyLang || display == "" {
		if v, ok := botLocales[lang]["claimType."+strings.ToUpper(typeName)]; ok && v != "" {
			return v
		}
	}
	if display != "" {
		return display
	}
	return typeName
}

func displayNameFor(coverage []CoverageInfo, typeName string) string {
	if ct := coverageFor(coverage, typeName); ct != nil {
		return ct.DisplayName
	}
	return ""
}

// unneededFieldWords are fields the model sometimes asks for out of habit.
var unneededFieldWords = map[string][]string{
	"vehicleVin":         {"vin", "chassis", "numero de serie", "vehicle identification"},
	"licenseNumber":      {"driving licen", "driver's licen", "permis de conduire", "licen"},
	"policeReportNumber": {"police report", "proces-verbal", "rapport de police", "constat"},
}

var askedContact = compileFolded(`\bphone number\b`, `\bcontact number\b`, `\bnumber (where|on which) (we|i) can reach\b`, `\bnumero de (telephone|contact)\b`, `\bvous joindre\b`, `\bnamba ya (simu|mawasiliano)\b`, `\bnumero de telefono\b`, `\bnumero de telefone\b`)

var documentsQuestion = compileFolded(`\bdocuments?\b`, `\bpapers?\b`, `\bpaperwork\b`, `\bwhat (do|should|must) i (need to )?(send|provide|bring|submit)\b`, `\bpieces?\b`, `\bjustificatifs?\b`, `\bquels? (documents|papiers)\b`, `\bnyaraka\b`, `\bdocumentos?\b`)

// IsDocumentsQuestion: the customer asks which documents or papers to provide.
func IsDocumentsQuestion(text string) bool {
	t := foldText(text)
	return strings.ContainsAny(text, "?؟") && documentsQuestion.MatchString(t) || regexp.MustCompile(`^\s*(and )?(what|which|quels?|quelles?) .*(documents?|papers?|pieces|papiers)`).MatchString(t)
}

// statementSentences drops the sentences of a reply that ask something.
func statementSentences(reply string) string {
	var out strings.Builder
	start := 0
	flush := func(end int, keep bool) {
		seg := reply[start:end]
		if keep {
			out.WriteString(seg)
		}
		start = end
	}
	for i, r := range reply {
		switch r {
		case '.', '!', '\n':
			flush(i+len(string(r)), true)
		case '?', '؟':
			flush(i+len(string(r)), false)
		}
	}
	flush(len(reply), !strings.ContainsAny(reply[start:], "?؟"))
	return strings.TrimSpace(out.String())
}

// questionSentences keeps the sentences of a reply that ask something.
func questionSentences(reply string) string {
	var out []string
	start := 0
	for i, r := range reply {
		if r == '?' || r == '؟' {
			seg := reply[start:i]
			if j := strings.LastIndexAny(seg, ".!\n"); j >= 0 {
				seg = seg[j+1:]
			}
			out = append(out, strings.TrimSpace(seg))
			start = i + len(string(r))
		} else if r == '.' || r == '!' || r == '\n' {
			start = i + 1
		}
	}
	return strings.Join(out, " ? ")
}

// asksForUnneededField returns the field the reply asks for although the
// claim type does not require it (e.g. a VIN for a simple car claim).
func asksForUnneededField(reply string, draft *ClaimDraft, coverage []CoverageInfo) string {
	if draft == nil || draft.TypeName == "" || !strings.ContainsAny(reply, "?؟") {
		return ""
	}
	folded := foldText(questionSentences(reply))
	if askedContact.MatchString(folded) && !containsFold(draft.MissingNames, "phoneNumber") {
		// The WhatsApp number is already the customer's contact number.
		return "phoneNumber"
	}
	ct := coverageFor(coverage, draft.TypeName)
	if ct == nil {
		return ""
	}
	for field, words := range unneededFieldWords {
		required := false
		for _, f := range ct.Fields {
			if f.Name == field && f.Required {
				required = true
			}
		}
		if required {
			continue
		}
		for _, w := range words {
			if regexp.MustCompile(`\b` + regexp.QuoteMeta(w)).MatchString(folded) {
				return field
			}
		}
	}
	return ""
}

// askedFields lists the missing fields a reply asks about.
func askedFields(reply string, draft *ClaimDraft) []string {
	if !strings.Contains(reply, "?") && !strings.Contains(reply, "؟") {
		return nil
	}
	var out []string
	for i, name := range draft.MissingNames {
		one := &ClaimDraft{MissingNames: []string{name}}
		if i < len(draft.Missing) {
			one.Missing = []string{draft.Missing[i]}
		}
		if asksAboutMissing(reply, one) {
			out = append(out, name)
		}
	}
	return out
}

// asksAboutMissing reports whether the assistant's reply asks a question
// about one of the missing fields (so we can keep the model's natural wording).
func asksAboutMissing(reply string, draft *ClaimDraft) bool {
	if !strings.Contains(reply, "?") && !strings.Contains(reply, "؟") {
		return false
	}
	folded := foldText(reply)
	for i, name := range draft.MissingNames {
		f := CoverageField{Name: name}
		if i < len(draft.Missing) {
			f.Label = draft.Missing[i]
		}
		for _, kw := range topicKeywords(f) {
			if len(kw) >= 4 && strings.Contains(folded, kw) {
				return true
			}
		}
		for _, kw := range missingFieldHints[name] {
			if strings.Contains(folded, kw) {
				return true
			}
		}
	}
	return false
}

// missingFieldHints lets a reply in another language count as asking for a field.
var missingFieldHints = map[string][]string{
	"insuredFullName":     {"name", "nom", "nombre", "nome", "jina", "nkombo"},
	"patientName":         {"name", "nom", "nombre", "nome", "jina", "patient", "mgonjwa"},
	"ownerName":           {"name", "nom", "nombre", "nome", "jina", "proprietaire", "owner", "mmiliki"},
	"incidentDate":        {"when", "date", "quand", "cuando", "quando", "lini", "tarehe", "siku"},
	"treatmentDate":       {"when", "date", "quand", "cuando", "quando", "lini", "tarehe"},
	"incidentLocation":    {"where", "place", "location", "ou ", "lieu", "donde", "onde", "wapi", "mahali"},
	"incidentDescription": {"what happened", "passe", "paso", "aconteceu", "nini kilitokea", "ilitokea", "kilitokea"},
	"damageDescription":   {"damage", "degat", "dano", "dommage", "uharibifu", "imeharibika"},
	"vehicleMakeModel":    {"make", "model", "marque", "modele", "marca", "modelo", "aina ya gari", "modeli"},
	"vehicleRegistration": {"plate", "registration", "plaque", "immatriculation", "matricula", "placa", "namba ya gari", "usajili"},
	"injuriesOccurred":    {"injur", "hurt", "bless", "herid", "ferid", "jeruh", "umia"},
	"policyNumber":        {"policy", "police", "poliza", "apolice", "polisi"},
	"propertyAddress":     {"address", "adresse", "direccion", "endereco", "anwani"},
	"incidentCause":       {"cause", "caused", "causa", "chanzo", "sababu"},
	"healthcareProvider":  {"hospital", "clinic", "doctor", "hopital", "clinique", "medecin", "hospitali", "daktari"},
	"totalCost":           {"cost", "amount", "cout", "montant", "costo", "custo", "gharama", "kiasi"},
}

// submitClaim creates the confirmed claim. The customer only ever sees a claim
// number the claims API returned; on failure they get an honest message.
func (f *BotFlow) submitClaim(ctx context.Context, st *turnState, draft *ClaimDraft) error {
	if f.claims == nil {
		f.log.Errorf("❌ [CLAIM] No claim creator configured")
		return f.reply(st, botText(st.replyLang, "claim.submitFailed"), map[string]interface{}{"claimEvent": claimEventSubmitFailed})
	}
	res, err := f.claims.CreateClaim(ctx, ClaimCreateRequest{
		CompanyID: st.in.CompanyID, CustomerID: st.customer.ID, WhatsAppPhone: st.phone,
		CustomerName: st.customerName(), Language: st.replyLang, Draft: draft,
		CorrectedFields: correctedProfileFields(st.claimSession()),
	})
	if err != nil || res == nil || strings.TrimSpace(res.ClaimNumber) == "" {
		f.log.Errorf("❌ [CLAIM] Claim creation failed for %s: %v", st.phone, err)
		return f.reply(st, botText(st.replyLang, "claim.submitFailed"), map[string]interface{}{"claimEvent": claimEventSubmitFailed})
	}
	f.log.Infof("✅ [CLAIM] Created claim %s for %s", res.ClaimNumber, st.phone)
	msg := fillPlaceholders(botText(st.replyLang, "claim.submitted"), map[string]string{"claimNumber": res.ClaimNumber})
	if st.behavior.RequirePhotos || st.behavior.RequireDocuments {
		msg += "\n" + botText(st.replyLang, "claim.photosHint")
	}
	meta := map[string]interface{}{"claimEvent": claimEventSubmitted, "claimNumber": res.ClaimNumber}
	if len(draft.Queue) > 0 {
		// The next incident the customer reported: a separate claim under
		// the same customer, with only what they said about that incident.
		coverage, _ := f.store.GetCompanyCoverage(st.in.CompanyID)
		if len(coverage) == 0 {
			coverage = defaultCoverage()
		}
		nextType := draft.Queue[0]
		done := append(append([]string(nil), draft.Others...), draft.TypeName)
		var userParts []string
		for _, m := range st.claimSession() {
			if m.Role == "user" {
				userParts = append(userParts, m.Content)
			}
		}
		if strings.TrimSpace(draft.Context) != "" {
			userParts = append([]string{draft.Context}, userParts...)
		}
		next := &ClaimDraft{
			TypeName: nextType, DisplayName: displayNameFor(coverage, nextType), Fields: map[string]interface{}{},
			Queue: append([]string(nil), draft.Queue[1:]...), Others: done, QueueAnnounced: true,
			Context: focusIncidentText(coverage, strings.Join(userParts, "\n"), nextType, append(done, draft.Queue[1:]...)),
		}
		for _, k := range []string{"insuredFullName", "patientName", "ownerName"} {
			if v, ok := draft.Fields[k]; ok {
				next.Fields[k] = v
			}
		}
		meta["nextDraft"] = next
		msg += "\n\n" + fillPlaceholders(botText(st.replyLang, "claim.nextIncident"), map[string]string{"claimType": claimTypeLabel(st.replyLang, st.companyLang, nextType, next.DisplayName)})
		f.setMode(st, ModeClaimFiling)
		f.log.Infof("🧩 [MULTI-INCIDENT] %s filed; next incident: %s", draft.TypeName, nextType)
	} else {
		f.setMode(st, ModeGeneral)
	}
	return f.reply(st, msg, meta)
}

// correctedProfileFields lists the profile fields the customer explicitly
// corrected during the claim ("my name is spelled…", "actually my policy is…").
func correctedProfileFields(session []ChatMessage) []string {
	var out []string
	for _, m := range session {
		if m.Role != "user" || !IsExplicitCorrection(m.Content) {
			continue
		}
		if extractCustomerName(m.Content) != "" && !containsFold(out, "insuredFullName") {
			out = append(out, "insuredFullName")
		}
		if extractPolicyNumber(m.Content) != "" && !containsFold(out, "policyNumber") {
			out = append(out, "policyNumber")
		}
		if extractExplicitAddress(m.Content) != "" && !containsFold(out, "address") {
			out = append(out, "address")
		}
	}
	return out
}

// StatusListMessage lists the customer's claims from live data, localized.
func StatusListMessage(lang string, claims []CustomerClaim) string {
	if len(claims) == 0 {
		return botText(lang, "status.none")
	}
	var sb strings.Builder
	sb.WriteString(botText(lang, "status.listHeader"))
	for _, c := range claims {
		label := botText(lang, "statusLabel."+strings.ToUpper(c.Status))
		if label == "statusLabel."+strings.ToUpper(c.Status) {
			label = c.Status
		}
		sb.WriteString("\n")
		sb.WriteString(fillPlaceholders(botText(lang, "status.listItem"), map[string]string{"claimNumber": c.ClaimNumber, "status": label, "date": c.Date}))
	}
	return sb.String()
}
