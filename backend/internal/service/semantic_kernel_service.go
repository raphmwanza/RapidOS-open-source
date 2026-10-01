package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"rapidos/internal/ai"
	"rapidos/internal/config"
	"rapidos/internal/logger"
	"regexp"
	"strings"
	"time"
	"unicode"
)

// skStore is the data the AI service reads (implemented by DatabaseService;
// replaced by fakes in tests).
type skStore interface {
	GetBotLanguage(companyID string) string
	GetBotProfile(companyID string) (*BotProfile, error)
	GetCompanyBehavior(companyID string) BotBehavior
	GetCompanyCoverage(companyID string) ([]CoverageInfo, error)
	// Profile fields are only filled when empty, unless correction is true
	// (the customer explicitly corrected the value).
	UpdateCustomerName(customerID, fullName string, correction bool) error
	UpdateCustomerPolicyNumber(customerID, policyNumber string, correction bool) error
	UpdateCustomerAddress(customerID, address string, correction bool) error
}

// SemanticKernelService is the WhatsApp assistant's AI layer. Every LLM call
// goes through the LLM client of the company the conversation belongs to
// (built from its integration settings, global configuration as fallback).
type SemanticKernelService struct {
	llmClients *CompanyLLMClients
	dbSvc      skStore
	cfg        *config.Config
	log        *logger.Logger
	sanitizer  *PromptSanitizer
	now        func() time.Time
}

type ChatMessage struct {
	Role      string `json:"role"`
	Content   string `json:"content"`
	Timestamp string `json:"timestamp"`
}

// NewSemanticKernelService always succeeds: no global LLM key is needed, each
// company brings its own LLM settings (Settings → Integrations).
func NewSemanticKernelService(dbSvc *DatabaseService, cfg *config.Config, log *logger.Logger) (*SemanticKernelService, error) {
	if cfg == nil {
		cfg = &config.Config{}
	}
	if log == nil {
		log = logger.New()
	}
	var store skStore
	source := func(companyID string) (config.LLMSettings, error) {
		return resolveCompanyLLMSettings(CompanyRuntimeConfig{}, cfg.LLMSettings())
	}
	if dbSvc != nil {
		store = dbSvc
		source = dbSvc.LLMSettingsForCompany
	}
	clients := NewCompanyLLMClients(source, func(st config.LLMSettings) (ai.LLMProvider, error) {
		return ai.NewProviderForSettings(st, log)
	}, log)
	g := cfg.LLMSettings()
	if g.APIKey != "" || ai.IsSelfHostedProvider(g.Provider) {
		log.Infof("🤖 AI service ready (global fallback LLM provider=%s model=%s; companies with their own LLM settings use them)", g.Provider, g.Model)
	} else {
		log.Infof("🤖 AI service ready (no global LLM key: each company uses the LLM from its integration settings)")
	}
	return newSemanticKernelService(store, cfg, log, clients), nil
}

func newSemanticKernelService(store skStore, cfg *config.Config, log *logger.Logger, clients *CompanyLLMClients) *SemanticKernelService {
	if cfg == nil {
		cfg = &config.Config{}
	}
	if log == nil {
		log = logger.New()
	}
	return &SemanticKernelService{llmClients: clients, dbSvc: store, cfg: cfg, log: log, sanitizer: NewPromptSanitizer(), now: time.Now}
}

// InvalidateCompanyLLM drops the cached LLM client of a company ("" = all).
// Clients are also rebuilt automatically when the settings change.
func (s *SemanticKernelService) InvalidateCompanyLLM(companyID string) {
	s.llmClients.Invalidate(companyID)
}

func (s *SemanticKernelService) Close() {
	s.llmClients.Invalidate("")
}

func (s *SemanticKernelService) llmTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	timeoutSecs := s.cfg.LLMSettings().Timeout
	if timeoutSecs <= 0 {
		timeoutSecs = 90
	}
	return context.WithTimeout(ctx, time.Duration(timeoutSecs)*time.Second)
}

func (s *SemanticKernelService) providerForCompany(companyID string) (ai.LLMProvider, error) {
	p, err := s.llmClients.Provider(companyID)
	if err != nil {
		return nil, fmt.Errorf("LLM for company %s: %w", companyID, err)
	}
	return p, nil
}

func (s *SemanticKernelService) completeForCompany(ctx context.Context, companyID string, req ai.CompletionRequest) (*ai.CompletionResponse, error) {
	provider, err := s.providerForCompany(companyID)
	if err != nil {
		return nil, err
	}
	if req.Temperature == 0 {
		req.Temperature = 0.2
	}
	timeoutCtx, cancel := s.llmTimeout(ctx)
	defer cancel()
	return provider.Complete(timeoutCtx, req)
}

func (s *SemanticKernelService) completePromptForCompany(ctx context.Context, companyID, prompt string) (*ai.CompletionResponse, error) {
	return s.completeForCompany(ctx, companyID, ai.CompletionRequest{Prompt: prompt})
}

// TestClaimExtraction exercises the same provider and extraction path as the
// WhatsApp bot without creating a customer, conversation, or claim.
func (s *SemanticKernelService) TestClaimExtraction(ctx context.Context, companyID string) (map[string]interface{}, error) {
	provider, err := s.providerForCompany(companyID)
	if err != nil {
		return nil, err
	}
	tool := ai.ExtractAutoClaimDataTool()
	ctx, cancel := s.llmTimeout(ctx)
	defer cancel()
	args, mode, err := ai.ExtractToolArgumentsWithMode(ctx, provider, ai.CompletionRequest{
		SystemPrompt: claimExtractionSystemPrompt(s.now()),
		Prompt:       "Extract a claim from this sample conversation: Bonjour, je suis Jean Dupont. Mon téléphone est +243 123 456 789. J'ai eu un accident aujourd'hui à Kinshasa; ma Toyota Corolla 2020 a la porte endommagée.",
		Tools:        []ai.ToolDefinition{tool}, Temperature: 0.1, MaxTokens: 800,
	}, tool)
	s.log.Infof("🧪 [TEST BOT] company=%s extraction mode=%s err=%v", companyID, mode, err)
	return args, err
}

func (s *SemanticKernelService) responseText(resp *ai.CompletionResponse) string {
	if resp == nil {
		return ""
	}
	return strings.TrimSpace(resp.Text)
}

// GeneralConversationResponse represents a response for general conversations
type GeneralConversationResponse struct {
	Message         string `json:"message"`
	NeedsEscalation bool   `json:"needsEscalation"`
	Intent          string `json:"intent"`
}

// formatKnowledgeBase builds the knowledge base prompt section from admin-uploaded
// settings (text settings, reference documents, boolean flags) in the bot language.
// Behaviour toggles (bot_*, notify_*) are configuration, not knowledge, and are skipped.
func formatKnowledgeBase(settings []CompanySettingInfo, lang string) string {
	en := !usesFrenchScaffold(lang)
	pick := func(enText, frText string) string {
		if en {
			return enText
		}
		return frText
	}
	var knowledge []CompanySettingInfo
	for _, setting := range settings {
		if !IsBehaviorSetting(setting.Name) {
			knowledge = append(knowledge, setting)
		}
	}
	if len(knowledge) == 0 {
		return pick("No settings or reference documents have been configured.", "Aucun paramètre ou document de référence n'a été configuré.")
	}

	var sb strings.Builder

	// --- Section 1: text settings ---
	sb.WriteString(pick("=== TEXT SETTINGS (official company information) ===\n", "=== PARAMÈTRES TEXTE (Informations officielles de l'entreprise) ===\n"))
	textCount := 0
	for _, setting := range knowledge {
		if strings.EqualFold(setting.Type, "TEXT") && setting.TextValue != nil {
			textCount++
			sb.WriteString(fmt.Sprintf("%d. [%s] %s\n   %s: %s\n", textCount, setting.Name, setting.Description, pick("Value", "Valeur"), *setting.TextValue))
		}
	}
	if textCount == 0 {
		sb.WriteString(pick("(no text settings)\n", "(aucun paramètre texte)\n"))
	}

	// --- Section 2: reference documents ---
	sb.WriteString(pick("\n=== REFERENCE DOCUMENTS (official documents uploaded by the administrator) ===\n", "\n=== DOCUMENTS DE RÉFÉRENCE (Documents officiels uploadés par l'administrateur) ===\n"))
	docCount := 0
	for _, setting := range knowledge {
		if strings.EqualFold(setting.Type, "DOCUMENT") {
			docCount++
			sb.WriteString(fmt.Sprintf("%d. [%s] %s\n", docCount, setting.Name, setting.Description))
			if setting.DocumentContent != nil && *setting.DocumentContent != "" {
				sb.WriteString(fmt.Sprintf(pick("   --- START OF CONTENT ---\n%s\n   --- END OF CONTENT ---\n\n", "   --- DÉBUT DU CONTENU ---\n%s\n   --- FIN DU CONTENU ---\n\n"), *setting.DocumentContent))
			} else if setting.DocumentURL != nil {
				sb.WriteString(fmt.Sprintf("   URL: %s\n\n", *setting.DocumentURL))
			} else {
				sb.WriteString(pick("   (document without extractable content)\n\n", "   (document sans contenu extractible)\n\n"))
			}
		}
	}
	if docCount == 0 {
		sb.WriteString(pick("(no reference documents)\n", "(aucun document de référence)\n"))
	}

	// --- Section 3: boolean settings ---
	for _, setting := range knowledge {
		if strings.EqualFold(setting.Type, "BOOLEAN") && setting.BoolValue != nil {
			val := pick("No", "Non")
			if *setting.BoolValue {
				val = pick("Yes", "Oui")
			}
			sb.WriteString(fmt.Sprintf("- [%s] %s : %s\n", setting.Name, setting.Description, val))
		}
	}

	sb.WriteString(fmt.Sprintf(pick("\n(Total: %d text settings, %d reference documents)\n", "\n(Total: %d paramètres texte, %d documents de référence)\n"), textCount, docCount))
	return sb.String()
}

// formatCustomerClaims renders the customer's existing claims for the prompt.
func formatCustomerClaims(customerClaims []CustomerClaim, lang string) string {
	en := !usesFrenchScaffold(lang)
	if len(customerClaims) == 0 {
		if en {
			return "\n[The customer has no existing claims]\n"
		}
		return "\n[Aucun sinistre existant pour ce client]\n"
	}
	var sb strings.Builder
	if en {
		sb.WriteString("\n=== CUSTOMER CLAIMS ===\nThis customer's existing claims:\n")
	} else {
		sb.WriteString("\n=== SINISTRES DU CLIENT ===\nVoici les sinistres existants de ce client:\n")
	}
	for _, c := range customerClaims {
		if en {
			sb.WriteString(fmt.Sprintf("- Claim %s | Type: %s | Status: %s | Date: %s | Amount: %s | Description: %s\n", c.ClaimNumber, c.Type, c.Status, c.Date, c.Amount, c.Description))
		} else {
			sb.WriteString(fmt.Sprintf("- Sinistre %s | Type: %s | Statut: %s | Date: %s | Montant: %s | Description: %s\n", c.ClaimNumber, c.Type, c.Status, c.Date, c.Amount, c.Description))
		}
	}
	if en {
		sb.WriteString("=== END OF CUSTOMER CLAIMS ===\n")
	} else {
		sb.WriteString("=== FIN DES SINISTRES ===\n")
	}
	return sb.String()
}

// fetchDocumentContent retrieves the content of a document from a URL
func (s *SemanticKernelService) fetchDocumentContent(urlStr string) ([]byte, string, error) {
	// Normalize URL for internal docker network
	targetURL := urlStr

	// If it's a relative path, prepend frontend base URL
	if strings.HasPrefix(targetURL, "/") {
		base := s.cfg.FrontendBaseURL
		if base == "" {
			base = "http://frontend:3000"
		}
		targetURL = strings.TrimRight(base, "/") + targetURL
	} else if strings.Contains(targetURL, "localhost:3000") {
		// If localhost is used, replace with frontend service name for docker networking
		targetURL = strings.Replace(targetURL, "localhost:3000", "frontend:3000", 1)
	}

	s.log.Infof("📥 Fetching document content from: %s", targetURL)

	// Create request with timeout
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	resp, err := client.Get(targetURL)
	if err != nil {
		return nil, "", fmt.Errorf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("bad status: %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", fmt.Errorf("read failed: %v", err)
	}

	contentType := resp.Header.Get("Content-Type")
	// If content type is missing or generic, detect from content or extension
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = http.DetectContentType(data)
		// Basic detection for PDF if http.DetectContentType fails (it usually detects application/pdf correctly)
		if strings.HasSuffix(strings.ToLower(urlStr), ".pdf") {
			contentType = "application/pdf"
		}
		if strings.HasSuffix(strings.ToLower(urlStr), ".json") {
			contentType = "application/json"
		}
		if strings.HasSuffix(strings.ToLower(urlStr), ".txt") {
			contentType = "text/plain"
		}
	}

	return data, contentType, nil
}

// GeneralTurn is one customer message to answer.
type GeneralTurn struct {
	CustomerID    string
	CompanyID     string
	Message       string
	WhatsAppPhone string
	Mode          string
	// History holds the previous turns (oldest first), NOT the current message.
	History  []ChatMessage
	Settings []CompanySettingInfo
	Claims   []CustomerClaim
	// CustomerLanguage is the detected language of the customer ("" = unknown).
	CustomerLanguage string
}

const maxHistoryTurns = 16

// HandleGeneralConversation keeps the historical signature: the history may
// end with the current message (it is removed before building the chat).
func (s *SemanticKernelService) HandleGeneralConversation(ctx context.Context, customerID, companyID, userMessage string, conversationHistory []ChatMessage, whatsappPhone string, settings []CompanySettingInfo, customerClaims []CustomerClaim, conversationMode ...string) (*GeneralConversationResponse, error) {
	mode := "general"
	if len(conversationMode) > 0 && conversationMode[0] != "" {
		mode = conversationMode[0]
	}
	history := conversationHistory
	if n := len(history); n > 0 && history[n-1].Role == "user" && strings.TrimSpace(history[n-1].Content) == strings.TrimSpace(userMessage) {
		history = history[:n-1]
	}
	return s.Converse(ctx, GeneralTurn{
		CustomerID: customerID, CompanyID: companyID, Message: userMessage, WhatsAppPhone: whatsappPhone,
		Mode: mode, History: history, Settings: settings, Claims: customerClaims,
		CustomerLanguage: DetectConversationLanguage(userMessage, history),
	})
}

// Converse answers one customer message with the company's LLM. The
// instructions, knowledge base and live claim data are the system message;
// the conversation is sent as real user/assistant turns.
func (s *SemanticKernelService) Converse(ctx context.Context, t GeneralTurn) (*GeneralConversationResponse, error) {
	currentMode := t.Mode
	if currentMode == "" {
		currentMode = "general"
	}
	sanitizedMessage := s.sanitizer.SanitizeUserInput(t.Message)
	if s.sanitizer.ContainsInjectionAttempt(t.Message) {
		s.log.Warnf("⚠️ Potential prompt injection attempt detected from customer %s: %s", t.CustomerID, t.Message[:min(len(t.Message), 100)])
	}

	// Reference documents from the knowledge base.
	var docInputs []ai.DocumentInput
	docContextMsg := ""
	for _, setting := range t.Settings {
		if !strings.EqualFold(setting.Type, "DOCUMENT") {
			continue
		}
		if setting.DocumentContent != nil && *setting.DocumentContent != "" {
			docContextMsg += fmt.Sprintf("- DOCUMENT: %s (%d chars)\n", setting.Name, len(*setting.DocumentContent))
			continue
		}
		if setting.DocumentURL != nil && strings.HasPrefix(*setting.DocumentURL, "/api/settings/file") {
			// Stored on the dashboard (needs a staff login); its text was
			// extracted at upload, so there is nothing more to fetch.
			s.log.Warnf("⚠️ Document %s has no extracted text; skipped", setting.Name)
			continue
		}
		if setting.DocumentURL != nil && *setting.DocumentURL != "" {
			content, mimeType, err := s.fetchDocumentContent(*setting.DocumentURL)
			if err != nil {
				s.log.Warnf("❌ Failed to load document %s from URL: %v", setting.Name, err)
				continue
			}
			docInputs = append(docInputs, ai.DocumentInput{MIMEType: mimeType, Data: content, Name: setting.Name})
			docContextMsg += fmt.Sprintf("- ATTACHED DOCUMENT: %s (Type: %s)\n", setting.Name, mimeType)
		}
	}

	profile := BotProfile{Language: "fr"}
	var coverage []CoverageInfo
	if s.dbSvc != nil && t.CompanyID != "" {
		if p, err := s.dbSvc.GetBotProfile(t.CompanyID); err == nil && p != nil {
			profile = *p
		} else if err != nil {
			s.log.Warnf("⚠️ [PROMPT] Bot profile unavailable for company %s: %v", t.CompanyID, err)
		}
		if c, err := s.dbSvc.GetCompanyCoverage(t.CompanyID); err == nil {
			coverage = c
		} else {
			s.log.Warnf("⚠️ [PROMPT] Coverage unavailable for company %s: %v", t.CompanyID, err)
		}
	}
	behavior := BehaviorFromSettings(t.Settings)
	lang := NormalizeBotLanguage(profile.Language)
	replyLang := ReplyLanguage(lang, t.CustomerLanguage, behavior)

	settingsContext := formatKnowledgeBase(t.Settings, lang)
	if docContextMsg != "" {
		settingsContext += "\n" + docContextMsg
	}
	system := BuildGeneralPrompt(GeneralPromptInput{
		Profile:          profile,
		Behavior:         behavior,
		Coverage:         coverage,
		KnowledgeBase:    settingsContext,
		ClaimsContext:    formatCustomerClaims(t.Claims, lang),
		Mode:             currentMode,
		CustomerLanguage: t.CustomerLanguage,
	})

	history := t.History
	if len(history) > maxHistoryTurns {
		history = history[len(history)-maxHistoryTurns:]
	}
	var msgs []ai.ChatMessage
	for _, m := range history {
		content := strings.TrimSpace(m.Content)
		if content == "" {
			continue
		}
		switch m.Role {
		case "user":
			msgs = append(msgs, ai.ChatMessage{Role: "user", Content: s.sanitizer.SanitizeUserInput(content)})
		case "assistant":
			msgs = append(msgs, ai.ChatMessage{Role: "assistant", Content: content})
		}
	}
	// A short reminder right next to the message: small models follow the
	// output format and language best when it is the last thing they read.
	reminder := fmt.Sprintf("\n\n(Reply in %s. Start with the intent tag, e.g. [INFO] :: …)", BotLanguageName(replyLang))

	resp, err := s.completeForCompany(ctx, t.CompanyID, ai.CompletionRequest{
		SystemPrompt: system,
		Messages:     msgs,
		Prompt:       sanitizedMessage + reminder,
		Documents:    docInputs,
		Temperature:  0.3,
	})
	if err != nil {
		s.log.Errorf("Failed to generate general conversation response: %v", err)
		return &GeneralConversationResponse{Message: generalFallbackMessage(replyLang, "error"), Intent: "error"}, err
	}
	fullText := s.responseText(resp)
	if fullText == "" {
		return &GeneralConversationResponse{Message: generalFallbackMessage(replyLang, "clarification"), Intent: "clarification"}, nil
	}
	detectedIntent, responseText := ParseIntentReply(fullText)
	if responseText == "" {
		return &GeneralConversationResponse{Message: generalFallbackMessage(replyLang, "general"), Intent: "general"}, nil
	}

	needsEscalation := detectedIntent == "escalation" || s.checkForEscalation(t.Message, fullText)
	if !behavior.HumanHandoff {
		needsEscalation = false
		if detectedIntent == "escalation" {
			detectedIntent = "general"
		}
	}

	s.autoUpdateCustomerProfile(t.CustomerID, t.Message)
	s.log.Infof("🧠 [INTENT] intent=%s mode=%s replyLang=%s message='%.50s'", detectedIntent, currentMode, replyLang, t.Message)
	return &GeneralConversationResponse{Message: responseText, NeedsEscalation: needsEscalation, Intent: detectedIntent}, nil
}

// autoUpdateCustomerProfile stores the name, policy number and address the
// customer explicitly gave (deterministic extraction, in the background). A
// value already on the profile is only replaced when the customer explicitly
// corrects it ("actually…", "my name is spelled…", "en fait…").
func (s *SemanticKernelService) autoUpdateCustomerProfile(customerID, userMessage string) {
	if s.dbSvc == nil || customerID == "" {
		return
	}
	correction := IsExplicitCorrection(userMessage)
	name, _ := cleanPersonName(s.extractCustomerNameFromMessage(userMessage))
	pn := ""
	if pols := extractAllPolicyNumbers(userMessage); len(pols) == 1 {
		pn = pols[0] // several policies in one message: do not guess which is theirs
	}
	addr := extractExplicitAddress(userMessage)
	if name == "" && pn == "" && addr == "" {
		return
	}
	go func() {
		if name != "" {
			if err := s.dbSvc.UpdateCustomerName(customerID, name, correction); err != nil {
				s.log.Errorf("❌ [AUTO-EXTRACT] Failed to update customer name: %v", err)
			}
		}
		if pn != "" {
			if err := s.dbSvc.UpdateCustomerPolicyNumber(customerID, pn, correction); err != nil {
				s.log.Errorf("❌ [AUTO-EXTRACT] Failed to update policy number: %v", err)
			}
		}
		if addr != "" {
			if err := s.dbSvc.UpdateCustomerAddress(customerID, addr, correction); err != nil {
				s.log.Errorf("❌ [AUTO-EXTRACT] Failed to update address: %v", err)
			}
		}
	}()
}

// AnalyzeClaimForAutoUpdate asks the company's LLM whether a claim should move
// to another status.
func (s *SemanticKernelService) AnalyzeClaimForAutoUpdate(ctx context.Context, companyID, claimNumber, currentStatus string, daysSinceLastUpdate int, hasRequiredDocs bool, claimType string, claimDescription string) (bool, string, string, error) {
	prompt := fmt.Sprintf(`You are an AI assistant for an insurance company that helps determine if claims should be automatically updated.

Claim Details:
- Claim Number: %s
- Current Status: %s
- Claim Type: %s
- Description: %s
- Days Since Last Update: %d
- Has Required Documents: %t

Business Rules:
1. NEW claims with all required documents after 2+ days → ONGOING
2. ONGOING claims with all documents after 7+ days → APPROVED (if low-risk)
3. Claims missing documents after 5+ days → Send reminder (no status change)
4. Claims in ONGOING status for 14+ days → Escalate for manual review

Respond with:
SHOULD_UPDATE: true/false
NEW_STATUS: [new status if update needed]
REASON: [explanation for the decision]

Be conservative - only recommend updates for clear-cut cases.`, claimNumber, currentStatus, claimType, claimDescription, daysSinceLastUpdate, hasRequiredDocs)

	resp, err := s.completePromptForCompany(ctx, companyID, prompt)
	if err != nil {
		s.log.Errorf("Failed to analyze claim for auto-update: %v", err)
		return false, "", "", err
	}
	responseText := s.responseText(resp)
	if responseText == "" {
		return false, "", "", fmt.Errorf("no response from AI")
	}
	shouldUpdate, newStatus, reason := false, currentStatus, ""
	for _, line := range strings.Split(responseText, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "SHOULD_UPDATE:"):
			shouldUpdate = strings.Contains(strings.ToLower(line), "true")
		case strings.HasPrefix(line, "NEW_STATUS:"):
			newStatus = strings.TrimSpace(strings.TrimPrefix(line, "NEW_STATUS:"))
		case strings.HasPrefix(line, "REASON:"):
			reason = strings.TrimSpace(strings.TrimPrefix(line, "REASON:"))
		}
	}
	return shouldUpdate, newStatus, reason, nil
}

// TriggerStatusUpdatePDF asks the dashboard to (re)generate the claim PDF and
// send it to the customer. The dashboard route is called with the internal API
// key and the claim's company, since there is no user session here.
func (s *SemanticKernelService) TriggerStatusUpdatePDF(claimNumber, companyID string) {
	s.log.Infof("📄 [SK] Triggering PDF retrieval/generation for status update - claim %s", claimNumber)

	// Call the frontend API to retrieve existing PDF or generate new one
	base := "http://host.docker.internal:3000" // Default for Docker
	if s.cfg != nil && s.cfg.FrontendBaseURL != "" {
		base = s.cfg.FrontendBaseURL
	}

	url := strings.TrimRight(base, "/") + "/api/customers/pdf/retrieve"

	payload := map[string]interface{}{
		"claimNumber": claimNumber,
		"reason":      "status_updated",
	}

	body, err := json.Marshal(payload)
	if err != nil {
		s.log.Errorf("❌ [SK][PDF] Failed to marshal PDF request for claim %s: %v", claimNumber, err)
		return
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(body))
	if err != nil {
		s.log.Errorf("❌ [SK][PDF] Failed to create PDF request for claim %s: %v", claimNumber, err)
		return
	}

	req.Header.Set("Content-Type", "application/json")
	if s.cfg != nil && s.cfg.InternalAPIKey != "" {
		req.Header.Set("X-Internal-API-Key", s.cfg.InternalAPIKey)
	}
	if companyID != "" {
		req.Header.Set("X-Company-ID", companyID)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		s.log.Errorf("❌ [SK][PDF] Failed to send PDF request for claim %s: %v", claimNumber, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		s.log.Infof("✅ [SK][PDF] PDF retrieval/generation triggered successfully for claim %s", claimNumber)
	} else {
		s.log.Errorf("❌ [SK][PDF] PDF request failed for claim %s with status %d", claimNumber, resp.StatusCode)
	}
}

// checkForEscalation flags explicit requests for a person and serious
// complaints (legal threats, fraud). Ordinary words such as "urgent" or
// "problem" are not enough.
func (s *SemanticKernelService) checkForEscalation(userMessage, botResponse string) bool {
	if strings.HasPrefix(strings.TrimSpace(botResponse), "ESCALATE:") {
		return true
	}
	if IsHumanRequest(userMessage) {
		return true
	}
	return seriousComplaintPattern.MatchString(foldText(userMessage))
}

var seriousComplaintPattern = compileFolded(`\blawyer\b`, `\battorney\b`, `\blegal action\b`, `\bsue you\b`, `\bavocat\b`, `\baction (en justice|legale)\b`, `\babogado\b`, `\bdemanda\b`, `\badvogado\b`, `\bprocesso judicial\b`, `\bwakili\b`, `\bmahakamani\b`, `\bfraud\b`, `\bfraude\b`, `\bmanager\b`, `\bsupervisor\b`, `\bsuperviseur\b`, `\bresponsable\b`, `\bplainte\b`, `\bcomplaint\b`, `\bqueja\b`, `\blalamiko\b`)

// ── deterministic profile extraction ─────────────────────────────────────

// Strong introductions: what follows is a name even in lower case.
var strongNameIntro = []string{"my name is", "my full name is", "name is", "je m'appelle", "mon nom est", "mon nom complet est", "je me nomme", "me llamo", "mi nombre es", "mi nombre completo es", "meu nome e", "meu nome completo e", "me chamo", "jina langu ni", "jina langu kamili ni", "naitwa", "nkombo na ngai", "nama saya", "ang pangalan ko ay", "sunana", "oruko mi ni"}

// Weak introductions ("I am…") only count when followed by a capitalised word.
var weakNameIntro = []string{"i am", "i'm", "this is", "call me", "je suis", "c'est", "soy", "sou o", "sou a", "mimi ni", "ngai"}

var nameStopWords = map[string]bool{
	"and": true, "et": true, "y": true, "e": true, "na": true, "with": true, "avec": true, "con": true, "com": true, "from": true, "de": true, "du": true, "des": true, "la": true, "le": true, "les": true, "el": true, "my": true, "mon": true, "ma": true, "mes": true, "mi": true, "meu": true, "minha": true, "i": true, "je": true, "j'ai": true, "and,": true, "the": true, "a": true, "an": true, "un": true, "une": true, "at": true, "in": true, "on": true, "to": true, "for": true, "of": true, "pour": true, "par": true, "sur": true, "dans": true, "here": true, "calling": true, "writing": true, "here,": true,
	"policy": true, "police": true, "polisi": true, "poliza": true, "apolice": true, "number": true, "numero": true, "namba": true, "nambari": true, "phone": true, "tel": true, "telephone": true, "telefono": true, "simu": true, "email": true, "address": true, "adresse": true, "direccion": true, "endereco": true, "anwani": true, "plate": true, "plaque": true, "car": true, "voiture": true, "gari": true, "yangu": true, "ya": true, "no": true, "n": true,
}

var notANameFirstWord = map[string]bool{"toyota": true, "honda": true, "ford": true, "mercedes": true, "bmw": true, "nissan": true, "peugeot": true, "renault": true, "hyundai": true, "kia": true, "mazda": true, "suzuki": true, "client": true, "customer": true, "assure": true, "insured": true, "victime": true, "victim": true, "desole": true, "sorry": true, "calling": true, "writing": true, "looking": true, "having": true, "interested": true, "interesse": true, "not": true, "pas": true, "fine": true, "good": true, "well": true, "ok": true, "okay": true, "very": true, "so": true, "really": true, "just": true, "still": true, "here": true, "going": true, "trying": true, "contacting": true, "in": true, "at": true, "on": true, "a": true, "an": true, "the": true, "un": true, "une": true, "en": true, "tres": true, "vraiment": true, "encore": true, "content": true, "contente": true, "mecontent": true, "presse": true, "inquiet": true, "worried": true, "angry": true, "happy": true, "sad": true, "sure": true}

func isNameWord(w string) bool {
	if w == "" || len([]rune(w)) > 25 {
		return false
	}
	for _, r := range w {
		if !(unicode.IsLetter(r) || r == '-' || r == '\'' || r == '’' || r == '.') {
			return false
		}
	}
	return true
}

// extractCustomerNameFromMessage returns the name after an introduction such
// as "my name is" / "je m'appelle" / "naitwa". It stops at punctuation, at
// connecting words and at words such as "policy" or "number", so "my name is
// Grace Wanjiru policy ACT-1" gives "Grace Wanjiru".
func (s *SemanticKernelService) extractCustomerNameFromMessage(message string) string {
	return extractCustomerName(message)
}

func extractCustomerName(message string) string {
	msg := strings.TrimSpace(strings.ReplaceAll(message, "’", "'"))
	folded := foldText(msg)
	try := func(intros []string, needCapital bool) string {
		for _, intro := range intros {
			idx := indexWord(folded, intro)
			if idx < 0 {
				continue
			}
			// foldText keeps byte offsets only for ASCII; map by rune count.
			rest := runeSliceFrom(msg, runeCount(folded[:idx])+runeCount(intro))
			words := strings.Fields(rest)
			// "Nkombo na ngai ezali Grâce", "my name is: Grace": skip the copula.
			for len(words) > 0 && nameCopulas[foldText(strings.Trim(words[0], ",.;:!?\"'"))] {
				words = words[1:]
			}
			var name []string
			for _, raw := range words {
				stop := strings.ContainsAny(raw, ",.;:!?()") && !strings.HasSuffix(raw, ".") || strings.HasSuffix(raw, ".") && len([]rune(raw)) > 3
				w := strings.Trim(raw, ",.;:!?()\"")
				fw := foldText(w)
				if w == "" || nameStopWords[fw] || strings.HasPrefix(fw, "pol") || strings.HasPrefix(fw, "num") || !isNameWord(w) {
					break
				}
				if len(name) == 0 && notANameFirstWord[fw] {
					break
				}
				first := []rune(w)[0]
				if needCapital && !unicode.IsUpper(first) {
					break
				}
				name = append(name, capitalizeWord(w))
				if stop || len(name) >= 4 {
					break
				}
			}
			if len(name) > 0 {
				return strings.Join(name, " ")
			}
		}
		return ""
	}
	if n := try(strongNameIntro, false); n != "" {
		return n
	}
	return try(weakNameIntro, true)
}

func indexWord(folded, phrase string) int {
	start := 0
	for {
		i := strings.Index(folded[start:], phrase)
		if i < 0 {
			return -1
		}
		i += start
		before := i == 0 || !unicode.IsLetter(rune(folded[i-1]))
		end := i + len(phrase)
		after := end >= len(folded) || !unicode.IsLetter(rune(folded[end]))
		if before && after {
			return i
		}
		start = i + 1
	}
}

func runeCount(s string) int { return len([]rune(s)) }

func runeSliceFrom(s string, n int) string {
	r := []rune(s)
	if n >= len(r) {
		return ""
	}
	return string(r[n:])
}

func capitalizeWord(w string) string {
	r := []rune(w)
	if len(r) == 0 {
		return w
	}
	if unicode.IsLower(r[0]) {
		r[0] = unicode.ToUpper(r[0])
	}
	return string(r)
}

var policyKeywordPattern = regexp.MustCompile(`(?i)(?:policy|polcy|police|p[oó]liza|ap[oó]lice|polisi|polis|sera)\s*(?:number|no\.?|n[°º]|num[eé]ro|n[uú]mero|namba|nambari|ya|de|d'assurance|est|is|ni|:|#|\s)*\s*([A-Za-z0-9][A-Za-z0-9\-_/]{3,39})`)
var standalonePolicyPattern = regexp.MustCompile(`\b[A-Z]{2,6}-POL(?:ICY)?-[A-Z0-9\-]{2,30}\b`)

// extractPolicyNumber finds a policy number the customer wrote, next to a
// "policy" keyword (any supported language) or in a POL/POLICY code.
func extractPolicyNumber(message string) string {
	for _, m := range policyKeywordPattern.FindAllStringSubmatch(message, -1) {
		cand := strings.Trim(m[1], "-_/.")
		if strings.ContainsAny(cand, "0123456789") && len(cand) >= 4 {
			return strings.ToUpper(cand)
		}
	}
	if m := standalonePolicyPattern.FindString(strings.ToUpper(message)); m != "" {
		return m
	}
	return ""
}

// extractAllPolicyNumbers returns the distinct policy numbers in a text, in order.
func extractAllPolicyNumbers(message string) []string {
	var out []string
	seen := map[string]bool{}
	add := func(p string) {
		if p != "" && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	for _, m := range policyKeywordPattern.FindAllStringSubmatch(message, -1) {
		cand := strings.Trim(m[1], "-_/.")
		if strings.ContainsAny(cand, "0123456789") && len(cand) >= 4 {
			add(strings.ToUpper(cand))
		}
	}
	for _, m := range standalonePolicyPattern.FindAllString(strings.ToUpper(message), -1) {
		add(m)
	}
	return out
}

// extractPolicyNumberFromMessage is kept for callers of the old helper.
func (s *SemanticKernelService) extractPolicyNumberFromMessage(message string) string {
	return extractPolicyNumber(message)
}

var addressIntroPattern = regexp.MustCompile(`(?i)(?:my address is|i live at|i live in|j'habite (?:au|à|a)|mon adresse est|mi direcci[oó]n es|vivo en|meu endere[cç]o [eé]|moro em|anwani yangu ni|ninaishi)\s*:?\s*([^\n.!?]{6,160})`)

// extractExplicitAddress returns an address only when the customer introduced
// it explicitly ("my address is…", "j'habite au…").
func extractExplicitAddress(message string) string {
	if m := addressIntroPattern.FindStringSubmatch(message); m != nil {
		return strings.TrimSpace(strings.Trim(m[1], " ,;"))
	}
	return ""
}

// ============================================================================
// MEDIA
// ============================================================================

// MediaProcessingResult represents the result of processing media
type MediaProcessingResult struct {
	Description        string            `json:"description"`
	DamageAssessment   string            `json:"damageAssessment"`
	ClaimRelevance     bool              `json:"claimRelevance"`
	SuggestedClaimType string            `json:"suggestedClaimType"`
	ExtractedData      map[string]string `json:"extractedData"`
	RecommendedActions []string          `json:"recommendedActions"`
	MediaURL           string            `json:"mediaUrl"`
	ProcessingStatus   string            `json:"processingStatus"`
}

// MediaUpload is a photo or document a customer sent on WhatsApp.
type MediaUpload struct {
	CustomerID string
	CompanyID  string
	Phone      string // the sender's WhatsApp number (checked against the customer)
	Lang       string // reply language
	Data       []byte
	Filename   string
	MimeType   string
	Caption    string
	// Pending: the customer is filing a claim, so the file is kept until the
	// claim is created instead of going to an older open claim.
	Pending bool
}

// mediaUploadResult is the dashboard's answer to POST /api/media/upload.
type mediaUploadResult struct {
	Success     bool   `json:"success"`
	Pending     bool   `json:"pending"`
	URL         string `json:"url"`
	DocumentID  string `json:"documentId"`
	ClaimNumber string `json:"claimNumber"`
	Error       string `json:"error"`
}

var mediaExtensions = map[string]string{
	"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
	"application/pdf": ".pdf", "application/msword": ".doc",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
}

// mediaFileName keeps the customer's file name (without paths or quotes) or
// builds one such as whatsapp-20260930-211500.jpg.
func mediaFileName(name, mimeType string, now time.Time) string {
	name = strings.TrimSpace(name)
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == '"' || r == 0x7f {
			return -1
		}
		return r
	}, name)
	if name != "" {
		return name
	}
	ext := mediaExtensions[mimeType]
	if ext == "" {
		ext = ".bin"
	}
	return "whatsapp-" + now.UTC().Format("20060102-150405") + ext
}

// mediaMimeType trusts the bytes over the declared type.
func mediaMimeType(data []byte, declared string) string {
	detected := strings.TrimSpace(strings.SplitN(http.DetectContentType(data), ";", 2)[0])
	declared = strings.ToLower(strings.TrimSpace(strings.SplitN(declared, ";", 2)[0]))
	if detected != "application/octet-stream" && detected != "application/zip" && detected != "text/plain" {
		return detected
	}
	if declared != "" {
		return declared
	}
	return detected
}

// uploadMediaToFrontend stores a customer's photo/document through the
// dashboard (POST /api/media/upload) with the internal service key and the
// company id. The dashboard links it to the customer's open claim, or keeps it
// until their claim is created.
func (s *SemanticKernelService) uploadMediaToFrontend(ctx context.Context, m MediaUpload, description string) (*mediaUploadResult, error) {
	if s.cfg == nil || strings.TrimSpace(s.cfg.InternalAPIKey) == "" {
		return nil, fmt.Errorf("INTERNAL_API_KEY is not configured: the assistant cannot save media")
	}
	if m.CompanyID == "" || m.CustomerID == "" {
		return nil, fmt.Errorf("company and customer are required to save media")
	}
	base := s.cfg.FrontendBaseURL
	if base == "" {
		base = "http://host.docker.internal:3000"
	}
	endpoint := strings.TrimRight(base, "/") + "/api/media/upload"

	mimeType := mediaMimeType(m.Data, m.MimeType)
	filename := mediaFileName(m.Filename, mimeType, time.Now())
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, filename))
	h.Set("Content-Type", mimeType)
	part, err := writer.CreatePart(h)
	if err != nil {
		return nil, fmt.Errorf("create multipart part: %w", err)
	}
	if _, err := part.Write(m.Data); err != nil {
		return nil, fmt.Errorf("write data: %w", err)
	}
	_ = writer.WriteField("customerId", m.CustomerID)
	_ = writer.WriteField("description", description)
	_ = writer.WriteField("pending", fmt.Sprintf("%t", m.Pending))
	if err := writer.Close(); err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	setInternalClaimHeaders(req, s.cfg.InternalAPIKey, m.CompanyID, m.Phone)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("upload failed with status %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var result mediaUploadResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}
	if !result.Success {
		return nil, fmt.Errorf("upload failed: %s", result.Error)
	}
	return &result, nil
}

// HandleDocumentMessage saves a WhatsApp document and acknowledges it in m.Lang.
func (s *SemanticKernelService) HandleDocumentMessage(ctx context.Context, m MediaUpload) *GeneralConversationResponse {
	s.log.Infof("📄 [DOC HANDLER] Saving document for customer %s (%s)", m.CustomerID, m.Filename)
	description := m.Caption
	if description == "" {
		description = "Uploaded via WhatsApp"
	}
	res, err := s.uploadMediaToFrontend(ctx, m, description)
	if err != nil {
		s.log.Errorf("❌ [DOC HANDLER] Upload failed: %v", err)
		return &GeneralConversationResponse{Message: botText(m.Lang, "document.saveError"), Intent: "document_error"}
	}
	s.log.Infof("✅ [DOC HANDLER] Document saved (claim %q, pending=%t, document %s)", res.ClaimNumber, res.Pending, res.DocumentID)
	if res.Pending || strings.TrimSpace(res.ClaimNumber) == "" {
		// No claim yet: never say it was added to a file.
		return &GeneralConversationResponse{Message: botText(m.Lang, "document.pending"), Intent: "document_pending"}
	}
	return &GeneralConversationResponse{Message: botText(m.Lang, "document.saved"), Intent: "document_saved"}
}

// HandlePhotoMessage saves a WhatsApp photo and acknowledges it in m.Lang.
func (s *SemanticKernelService) HandlePhotoMessage(ctx context.Context, m MediaUpload) *GeneralConversationResponse {
	s.log.Infof("📷 [PHOTO HANDLER] Saving photo for customer %s", m.CustomerID)
	description := m.Caption
	if description == "" {
		description = "Uploaded via WhatsApp"
	}
	res, err := s.uploadMediaToFrontend(ctx, m, description)
	if err != nil {
		s.log.Errorf("❌ [PHOTO HANDLER] Failed to upload image: %v", err)
		return &GeneralConversationResponse{Message: botText(m.Lang, "photo.saveError"), Intent: "photo_error"}
	}
	s.log.Infof("✅ [PHOTO HANDLER] Photo saved (claim %q, pending=%t, document %s)", res.ClaimNumber, res.Pending, res.DocumentID)
	if res.Pending || strings.TrimSpace(res.ClaimNumber) == "" {
		return &GeneralConversationResponse{Message: botText(m.Lang, "photo.pending"), Intent: "photo_pending"}
	}
	return &GeneralConversationResponse{Message: botText(m.Lang, "photo.saved"), Intent: "photo_saved"}
}

// DiscardPendingMedia deletes the files a customer sent for a claim that was
// never created (POST /api/media/discard-pending on the dashboard).
func (s *SemanticKernelService) DiscardPendingMedia(ctx context.Context, companyID, customerID, phone string) (int, error) {
	if s.cfg == nil || strings.TrimSpace(s.cfg.InternalAPIKey) == "" {
		return 0, fmt.Errorf("INTERNAL_API_KEY is not configured: pending media cannot be discarded")
	}
	if companyID == "" || customerID == "" {
		return 0, fmt.Errorf("company and customer are required")
	}
	base := s.cfg.FrontendBaseURL
	if base == "" {
		base = "http://host.docker.internal:3000"
	}
	body, _ := json.Marshal(map[string]string{"customerId": customerID})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/api/media/discard-pending", bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	setInternalClaimHeaders(req, s.cfg.InternalAPIKey, companyID, phone)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, fmt.Errorf("discard failed with status %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var out struct {
		Discarded int `json:"discarded"`
	}
	_ = json.Unmarshal(raw, &out)
	return out.Discarded, nil
}

// ProcessPhotoForClaim describes a claim photo with the company's (vision)
// LLM, in the company's bot language.
func (s *SemanticKernelService) ProcessPhotoForClaim(ctx context.Context, customerID, companyID string, imageData []byte, caption string) (*MediaProcessingResult, error) {
	lang := "en"
	if s.dbSvc != nil {
		lang = s.dbSvc.GetBotLanguage(companyID)
	}
	prompt := fmt.Sprintf(`You are an insurance claims analyst. Describe this image for a claim file: visible damage and its severity (minor, moderate, major, total loss), what the object is (vehicle, building…), visible text such as plates, and what additional photos would help. Only describe what is visible; do not guess. Caption from the customer: %q. Answer in %s.`, caption, BotLanguageName(lang))
	resp, err := s.completeForCompany(ctx, companyID, ai.CompletionRequest{
		Prompt: prompt,
		Images: []ai.ImageInput{{MIMEType: "image/jpeg", Data: imageData}},
	})
	if err != nil {
		s.log.Errorf("❌ [PHOTO AI] Failed to analyze image: %v", err)
		return &MediaProcessingResult{ClaimRelevance: true, ProcessingStatus: "error"}, err
	}
	text := s.responseText(resp)
	if text == "" {
		return &MediaProcessingResult{ClaimRelevance: true, ProcessingStatus: "partial"}, nil
	}
	return &MediaProcessingResult{Description: text, ClaimRelevance: true, ProcessingStatus: "success", ExtractedData: map[string]string{}}, nil
}
