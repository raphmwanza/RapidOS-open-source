package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"rapidos/internal/config"
	"rapidos/internal/logger"
	"regexp"
	"strings"
	"time"
)

// Helper function for minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ...existing code...

// normalizePhoneNumber converts phone numbers to digits-only format (removes + and - symbols)
func normalizePhoneNumber(phoneNumber string) string {
	// Remove all non-digit characters (including +, -, spaces, parentheses, etc.)
	cleaned := ""
	for _, char := range phoneNumber {
		if char >= '0' && char <= '9' {
			cleaned += string(char)
		}
	}

	fmt.Printf("📞 Phone normalization: '%s' -> '%s'\n", phoneNumber, cleaned)
	return cleaned
}

type WhatsAppService struct {
	cfg                   *config.Config
	log                   *logger.Logger
	http                  *http.Client
	databaseService       *DatabaseService
	semanticKernelService *SemanticKernelService
}

// AutoClaimPayload represents the data structure expected by the frontend API for auto insurance claims
// Note: Only insuredFullName and phoneNumber are strictly required by the frontend; all other fields are optional.
type AutoClaimPayload struct {
	// Claim Category
	ClaimCategory string `json:"claimCategory"`

	// Required fields
	PolicyNumber    string `json:"policyNumber"`
	InsuredFullName string `json:"insuredFullName"`
	PhoneNumber     string `json:"phoneNumber"`
	Address         string `json:"address"`

	// Vehicle-specific fields (required for Auto claims)
	LicenseNumber       string `json:"licenseNumber"`
	VehicleMakeModel    string `json:"vehicleMakeModel"`
	VehicleYear         int    `json:"vehicleYear"`
	VehicleRegistration string `json:"vehicleRegistration"`
	VehicleVin          string `json:"vehicleVin"`

	// Common required fields
	IncidentDate      string `json:"incidentDate"`
	IncidentLocation  string `json:"incidentLocation"`
	PoliceContacted   string `json:"policeContacted"`
	DamageDescription string `json:"damageDescription"`
	InjuriesOccurred  string `json:"injuriesOccurred"`

	// Optional fields
	BirthDate                *string `json:"birthDate,omitempty"`
	Email                    *string `json:"email,omitempty"`
	IncidentTime             *string `json:"incidentTime,omitempty"`
	RoadType                 *string `json:"roadType,omitempty"`
	OtherDriverName          *string `json:"otherDriverName,omitempty"`
	OtherDriverPhone         *string `json:"otherDriverPhone,omitempty"`
	OtherInsuranceCompany    *string `json:"otherInsuranceCompany,omitempty"`
	OtherPolicyNumber        *string `json:"otherPolicyNumber,omitempty"`
	OtherVehicleRegistration *string `json:"otherVehicleRegistration,omitempty"`
	WitnessName              *string `json:"witnessName,omitempty"`
	WitnessPhone             *string `json:"witnessPhone,omitempty"`
	PoliceReportNumber       *string `json:"policeReportNumber,omitempty"`
	EstimatedRepairCost      *string `json:"estimatedRepairCost,omitempty"`
	InjuryDescription        *string `json:"injuryDescription,omitempty"`
	MedicalTreatmentRequired *string `json:"medicalTreatmentRequired,omitempty"`
	AdditionalNotes          *string `json:"additionalNotes,omitempty"`
	TotalPhotosUploaded      int     `json:"totalPhotosUploaded"`

	// Progressive claim collection control fields (internal use)
	MediaUploadRequested *bool    `json:"-"` // Not sent to frontend
	MediaUploadSkipped   *bool    `json:"-"` // Not sent to frontend
	DamagePhotos         []string `json:"-"` // Not sent to frontend
	PoliceReportDocument *string  `json:"-"` // Not sent to frontend
}

func NewWhatsAppService(cfg *config.Config, log *logger.Logger) *WhatsAppService {
	// Debug log WhatsApp configuration (safely)
	if cfg.WhatsAppToken != "" {
		log.Infof("WhatsApp service initialized - Token length: %d, Phone ID: %s",
			len(cfg.WhatsAppToken), cfg.WhatsAppPhoneNumberID)
	} else {
		log.Errorf("WhatsApp service initialized but TOKEN IS EMPTY!")
	}

	return &WhatsAppService{
		cfg:  cfg,
		log:  log,
		http: &http.Client{},
		// databaseService will be set later when we have DB connection
	}
}

func (w *WhatsAppService) SetDatabaseService(dbService *DatabaseService) {
	w.databaseService = dbService
}

func (w *WhatsAppService) SetSemanticKernelService(skService *SemanticKernelService) {
	w.semanticKernelService = skService
	w.log.Infof("Semantic Kernel Service has been connected to WhatsApp Service")
}

// ForCompany returns an isolated service instance so credentials can never
// leak between concurrent tenant webhooks.
func (w *WhatsAppService) ForCompany(runtime CompanyRuntimeConfig) *WhatsAppService {
	cfg := *w.cfg
	cfg.WhatsAppToken, cfg.WhatsAppVerifyToken, cfg.WhatsAppAppSecret, cfg.WhatsAppPhoneNumberID = runtime.WhatsAppToken, runtime.VerifyToken, runtime.AppSecret, runtime.PhoneNumberID
	return &WhatsAppService{cfg: &cfg, log: w.log, http: w.http, databaseService: w.databaseService, semanticKernelService: w.semanticKernelService}
}

// WhatsApp API Message Structures
type WhatsAppMessage struct {
	MessagingProduct string           `json:"messaging_product"`
	To               string           `json:"to"`
	Type             string           `json:"type"`
	Text             *TextMessage     `json:"text,omitempty"`
	Template         *TemplateMessage `json:"template,omitempty"`
	Document         *DocumentMessage `json:"document,omitempty"`
}

type TextMessage struct {
	Body string `json:"body"`
}

type DocumentMessage struct {
	Link     string `json:"link,omitempty"`
	Caption  string `json:"caption,omitempty"`
	Filename string `json:"filename,omitempty"`
}

type TemplateMessage struct {
	Name       string              `json:"name"`
	Language   TemplateLanguage    `json:"language"`
	Components []TemplateComponent `json:"components,omitempty"`
}

type TemplateLanguage struct {
	Code string `json:"code"`
}

type TemplateComponent struct {
	Type       string              `json:"type"`
	Parameters []TemplateParameter `json:"parameters,omitempty"`
}

type TemplateParameter struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// WhatsApp Webhook Structures
// --- MISSING TYPE DECLARATIONS ---

// WhatsAppWebhook represents the structure of the incoming webhook from WhatsApp
type WhatsAppWebhook struct {
	Object string         `json:"object"`
	Entry  []WebhookEntry `json:"entry"`
}

type WebhookEntry struct {
	ID      string          `json:"id"`
	Changes []WebhookChange `json:"changes"`
}

type WebhookChange struct {
	Value WhatsAppValue `json:"value"`
	Field string        `json:"field"`
}

type WhatsAppValue struct {
	Messages []WhatsAppIncomingMessage `json:"messages"`
	Metadata WhatsAppMetadata          `json:"metadata"`
}

type WhatsAppMetadata struct {
	PhoneNumberID string `json:"phone_number_id"`
}

// WhatsAppIncomingMessage represents an incoming WhatsApp message
type WhatsAppIncomingMessage struct {
	From      string        `json:"from"`
	ID        string        `json:"id"`
	Timestamp string        `json:"timestamp"`
	Type      string        `json:"type"`
	Text      *TextMessage  `json:"text,omitempty"`
	Image     *MediaMessage `json:"image,omitempty"`
	Audio     *MediaMessage `json:"audio,omitempty"`
	Video     *MediaMessage `json:"video,omitempty"`
	Document  *MediaMessage `json:"document,omitempty"`
}

// MediaMessage represents a media message (image, audio, video, document)
type MediaMessage struct {
	ID       string `json:"id"`
	MimeType string `json:"mime_type"`
	Caption  string `json:"caption,omitempty"`
	Filename string `json:"filename,omitempty"`
	Sha256   string `json:"sha256,omitempty"`
}

type Company struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

// ConversationContext holds context for a WhatsApp conversation
type ConversationContext struct {
	CustomerID              string          `json:"customer_id,omitempty"`
	CustomerPhone           string          `json:"customer_phone"`
	CustomerName            string          `json:"customer_name"`
	CompanyName             string          `json:"company_name"`
	ConversationID          string          `json:"conversation_id"`
	Mode                    string          `json:"mode"` // "general", "claim_filing"
	ModeSetAt               *time.Time      `json:"mode_set_at"`
	MessageHistory          []ChatMessage   `json:"message_history"`
	CustomerClaims          []CustomerClaim `json:"customer_claims"`
	IsEscalated             bool            `json:"is_escalated"`
	HasRecentCompletedClaim bool            `json:"has_recent_completed_claim"`
	PendingClaimsCount      int             `json:"pending_claims_count"`
}

type CustomerClaim struct {
	ClaimNumber string `json:"claim_number"`
	Type        string `json:"type"`
	Status      string `json:"status"`
	Description string `json:"description"`
	Amount      string `json:"amount"`
	Date        string `json:"date"`
}

// Conversation represents a conversation in the database
type Conversation struct {
	ID        string `json:"id"`
	CompanyID string `json:"company_id"`
}

// WhatsApp Webhook Structures

// SendTextMessage sends a text message via WhatsApp
func (w *WhatsAppService) SendTextMessage(to, message string) error {
	// Normalize phone number to E.164 format
	normalizedTo := normalizePhoneNumber(to)

	w.log.Infof("📤 [SEND] Preparing to send message to %s -> %s (length: %d chars)", to, normalizedTo, len(message))

	if w.cfg.WhatsAppToken == "" || w.cfg.WhatsAppPhoneNumberID == "" {
		w.log.Errorf("❌ [SEND] WhatsApp credentials not configured - Token: %t, PhoneID: %t",
			w.cfg.WhatsAppToken != "", w.cfg.WhatsAppPhoneNumberID != "")
		return fmt.Errorf("WhatsApp credentials not configured")
	}

	w.log.Infof("✅ [SEND] WhatsApp credentials available - PhoneID: %s, Token length: %d",
		w.cfg.WhatsAppPhoneNumberID, len(w.cfg.WhatsAppToken))

	msg := WhatsAppMessage{
		MessagingProduct: "whatsapp",
		To:               normalizedTo, // Use normalized phone number
		Type:             "text",
		Text: &TextMessage{
			Body: message,
		},
	}

	return w.sendMessage(msg)
}

// SendTemplateMessage sends a template message via WhatsApp
func (w *WhatsAppService) SendTemplateMessage(to, templateName string, params []string) error {
	// Normalize phone number to E.164 format
	normalizedTo := normalizePhoneNumber(to)

	if w.cfg.WhatsAppToken == "" || w.cfg.WhatsAppPhoneNumberID == "" {
		return fmt.Errorf("WhatsApp credentials not configured")
	}

	components := []TemplateComponent{}
	if len(params) > 0 {
		templateParams := make([]TemplateParameter, len(params))
		for i, param := range params {
			templateParams[i] = TemplateParameter{
				Type: "text",
				Text: param,
			}
		}
		components = append(components, TemplateComponent{
			Type:       "body",
			Parameters: templateParams,
		})
	}

	msg := WhatsAppMessage{
		MessagingProduct: "whatsapp",
		To:               normalizedTo, // Use normalized phone number
		Type:             "template",
		Template: &TemplateMessage{
			Name:       templateName,
			Language:   TemplateLanguage{Code: "en"},
			Components: components,
		},
	}

	return w.sendMessage(msg)
}

// SendDocument sends a document via WhatsApp
func (w *WhatsAppService) SendDocument(to, documentUrl, caption, filename string) error {
	// Normalize phone number (same logic as SendTextMessage)
	normalizedTo := normalizePhoneNumber(to)

	w.log.Infof("📄 [DOCUMENT] Sending document to %s (normalized: %s)", to, normalizedTo)
	w.log.Infof("📄 [DOCUMENT] Document URL: %s, Filename: %s", documentUrl, filename)

	// Check if WhatsApp is configured
	if w.cfg.WhatsAppToken == "" || w.cfg.WhatsAppPhoneNumberID == "" {
		w.log.Errorf("❌ [DOCUMENT] WhatsApp credentials not configured - Token: %t, PhoneID: %t",
			len(w.cfg.WhatsAppToken) > 0, len(w.cfg.WhatsAppPhoneNumberID) > 0)
		return fmt.Errorf("WhatsApp credentials not configured")
	}

	msg := WhatsAppMessage{
		MessagingProduct: "whatsapp",
		To:               normalizedTo,
		Type:             "document",
		Document: &DocumentMessage{
			Link:     documentUrl,
			Caption:  caption,
			Filename: filename,
		},
	}

	return w.sendMessage(msg)
}

// maxMediaBytes caps a downloaded WhatsApp photo or document (the dashboard
// stores files up to 10 MB).
const maxMediaBytes = 10 << 20

// DownloadMedia downloads media from WhatsApp using the media ID
func (w *WhatsAppService) DownloadMedia(mediaID string) ([]byte, string, error) {
	// First, get the media URL
	mediaInfoURL := fmt.Sprintf("%s/%s", w.cfg.GraphAPIBase(), url.PathEscape(mediaID))
	req, err := http.NewRequest("GET", mediaInfoURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("failed to create media info request: %v", err)
	}

	req.Header.Set("Authorization", "Bearer "+w.cfg.WhatsAppToken)

	resp, err := w.http.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("failed to get media info: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, "", fmt.Errorf("media info request failed with status %d: %s", resp.StatusCode, string(body))
	}

	var mediaInfo struct {
		URL      string `json:"url"`
		MimeType string `json:"mime_type"`
		Sha256   string `json:"sha256"`
		FileSize int64  `json:"file_size"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&mediaInfo); err != nil {
		return nil, "", fmt.Errorf("failed to decode media info: %v", err)
	}

	// Download the actual media file
	mediaReq, err := http.NewRequest("GET", mediaInfo.URL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("failed to create media download request: %v", err)
	}

	mediaReq.Header.Set("Authorization", "Bearer "+w.cfg.WhatsAppToken)

	mediaResp, err := w.http.Do(mediaReq)
	if err != nil {
		return nil, "", fmt.Errorf("failed to download media: %v", err)
	}
	defer mediaResp.Body.Close()

	if mediaResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(mediaResp.Body)
		return nil, "", fmt.Errorf("media download failed with status %d: %s", mediaResp.StatusCode, string(body))
	}

	mediaData, err := io.ReadAll(io.LimitReader(mediaResp.Body, maxMediaBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("failed to read media data: %v", err)
	}
	if len(mediaData) > maxMediaBytes {
		return nil, "", fmt.Errorf("media %s is larger than %d MB", mediaID, maxMediaBytes>>20)
	}

	w.log.Infof("📷 [MEDIA] Successfully downloaded media %s: %d bytes, type: %s", mediaID, len(mediaData), mediaInfo.MimeType)
	return mediaData, mediaInfo.MimeType, nil
}

// ProcessMediaMessage processes an image or document message for claim creation
func (w *WhatsAppService) ProcessMediaMessage(msg WhatsAppIncomingMessage, conversationCtx ConversationContext) (string, []byte, string, error) {
	var mediaID, caption, filename string
	var messageType string

	switch msg.Type {
	case "image":
		if msg.Image == nil {
			return "", nil, "", fmt.Errorf("image message missing image data")
		}
		mediaID = msg.Image.ID
		caption = msg.Image.Caption
		messageType = "image"
		filename = fmt.Sprintf("image_%s.jpg", mediaID)
	case "document":
		if msg.Document == nil {
			return "", nil, "", fmt.Errorf("document message missing document data")
		}
		mediaID = msg.Document.ID
		caption = msg.Document.Caption
		filename = msg.Document.Filename
		messageType = "document"
	case "video":
		if msg.Video == nil {
			return "", nil, "", fmt.Errorf("video message missing video data")
		}
		mediaID = msg.Video.ID
		caption = msg.Video.Caption
		messageType = "video"
		filename = fmt.Sprintf("video_%s.mp4", mediaID)
	default:
		return "", nil, "", fmt.Errorf("unsupported media type: %s", msg.Type)
	}

	// Download the media
	mediaData, mimeType, err := w.DownloadMedia(mediaID)
	if err != nil {
		w.log.Errorf("📷 [MEDIA] Failed to download media %s: %v", mediaID, err)
		return "", nil, "", fmt.Errorf("failed to download media: %v", err)
	}

	// Create a meaningful message text based on the media type and caption
	messageText := inboundContent(InboundMessage{Type: messageType, Caption: caption, Filename: filename})

	w.log.Infof("📷 [MEDIA] Processed %s message: %s (%d bytes, %s)", messageType, filename, len(mediaData), mimeType)
	return messageText, mediaData, mimeType, nil
}

func (w *WhatsAppService) sendMessage(msg WhatsAppMessage) error {
	jsonData, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %v", err)
	}

	endpoint := fmt.Sprintf("%s/%s/messages", w.cfg.GraphAPIBase(), url.PathEscape(w.cfg.WhatsAppPhoneNumberID))
	req, err := http.NewRequest("POST", endpoint, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+w.cfg.WhatsAppToken)

	resp, err := w.http.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Read the response body for error details
		body, _ := io.ReadAll(resp.Body)
		w.log.Errorf("WhatsApp API error - Status: %d, Response: %s", resp.StatusCode, string(body))
		return fmt.Errorf("WhatsApp API returned status %d: %s", resp.StatusCode, string(body))
	}

	w.log.Infof("Message sent successfully to %s", msg.To)
	return nil
}

// ProcessIncomingMessage processes incoming WhatsApp messages
func (w *WhatsAppService) ProcessIncomingMessage(webhook WhatsAppWebhook) error {
	return w.ProcessIncomingMessageForCompany(webhook, "")
}

func (w *WhatsAppService) ProcessIncomingMessageForCompany(webhook WhatsAppWebhook, companyID string) error {
	for _, entry := range webhook.Entry {
		for _, change := range entry.Changes {
			if change.Field == "messages" {
				// Log what we received for debugging
				if change.Value.Messages == nil {
					w.log.Infof("🔍 [WEBHOOK] Received webhook with null messages - likely a status update")
					continue
				}

				if len(change.Value.Messages) == 0 {
					w.log.Infof("🔍 [WEBHOOK] Received webhook with empty messages array")
					continue
				}

				w.log.Infof("🔍 [WEBHOOK] Processing %d message(s)", len(change.Value.Messages))

				for _, message := range change.Value.Messages {
					// The webhook message is already in the correct format
					// Just pass it directly to the handler
					if err := w.handleIncomingMessageForCompany(message, companyID); err != nil {
						w.log.Errorf("Error handling message %s: %v", message.ID, err)
					}
				}
			}
		}
	}
	return nil
}

func (w *WhatsAppService) handleIncomingMessage(msg WhatsAppIncomingMessage) error {
	return fmt.Errorf("company id is required to process WhatsApp message %s", msg.ID)
}

// ToInbound downloads the media (if any) of a webhook message.
func (w *WhatsAppService) ToInbound(msg WhatsAppIncomingMessage, companyID string) InboundMessage {
	in := InboundMessage{ID: msg.ID, From: msg.From, CompanyID: companyID, Type: msg.Type}
	switch msg.Type {
	case "text":
		if msg.Text != nil {
			in.Text = msg.Text.Body
		}
	case "image":
		if msg.Image != nil {
			in.Caption = msg.Image.Caption
		}
	case "document":
		if msg.Document != nil {
			in.Caption, in.Filename, in.MimeType = msg.Document.Caption, msg.Document.Filename, msg.Document.MimeType
		}
	case "video":
		if msg.Video != nil {
			in.Caption = msg.Video.Caption
		}
	}
	if msg.Type == "image" || msg.Type == "document" || msg.Type == "video" {
		_, data, mimeType, err := w.ProcessMediaMessage(msg, ConversationContext{})
		if err != nil {
			in.MediaErr = err
		} else {
			in.Media = data
			if in.MimeType == "" {
				in.MimeType = mimeType
			}
		}
	}
	return in
}

// Flow returns the conversation engine bound to this (tenant) service.
func (w *WhatsAppService) Flow() *BotFlow {
	var brain flowBrain
	if w.semanticKernelService != nil {
		brain = w.semanticKernelService
	}
	creator := &FrontendClaimCreator{BaseURL: w.cfg.FrontendBaseURL, InternalAPIKey: w.cfg.InternalAPIKey, Client: &http.Client{Timeout: 30 * time.Second}}
	return NewBotFlow(w.databaseService, brain, creator, w, w.log)
}

func (w *WhatsAppService) handleIncomingMessageForCompany(msg WhatsAppIncomingMessage, companyID string) error {
	if companyID == "" {
		return fmt.Errorf("company id is required to process WhatsApp message %s", msg.ID)
	}
	w.log.Infof("🔄 [START] Processing message %s from %s (company %s, type %s)", msg.ID, msg.From, companyID, msg.Type)
	switch msg.Type {
	case "text", "image", "document", "video", "audio":
	default:
		w.log.Infof("❌ Unsupported message type (%s) from %s, skipping", msg.Type, msg.From)
		return nil
	}
	if msg.Type == "text" && (msg.Text == nil || strings.TrimSpace(msg.Text.Body) == "") {
		return nil
	}
	if w.databaseService != nil {
		first, err := w.databaseService.ClaimMessageForProcessing(msg.ID, normalizePhoneNumber(msg.From))
		if err != nil {
			w.log.Errorf("⚠️ Failed to record message %s for deduplication: %v", msg.ID, err)
		} else if !first {
			w.log.Infof("🔄 [DUPLICATE] Message %s already processed, skipping", msg.ID)
			return nil
		}
	}
	if w.databaseService == nil || w.semanticKernelService == nil {
		w.log.Warnf("⚠️ [FALLBACK] AI service not available for %s", msg.From)
		lang := "en"
		if w.databaseService != nil {
			lang = w.databaseService.GetBotLanguage(companyID)
		}
		return w.SendTextMessage(msg.From, botMessage(lang, msgAIUnavailable))
	}
	return w.Flow().Handle(context.Background(), w.ToInbound(msg, companyID))
}

// CreateClaimViaFrontend posts a claim to the tenant-scoped claims API with the
// internal service key and the company id. The customer is always the
// WhatsApp sender.
func (w *WhatsAppService) CreateClaimViaFrontend(ctx context.Context, companyID string, payload AutoClaimPayload, whatsappPhone string) (string, error) {
	if companyID == "" {
		return "", fmt.Errorf("company id is required to create a claim")
	}
	if w.cfg.InternalAPIKey == "" {
		return "", fmt.Errorf("INTERNAL_API_KEY is not configured")
	}
	base := w.cfg.FrontendBaseURL
	if base == "" {
		base = "http://host.docker.internal:3000"
	}
	if d := normalizePhoneNumber(whatsappPhone); d != "" {
		payload.PhoneNumber = d
	} else {
		payload.PhoneNumber = normalizePhoneNumber(payload.PhoneNumber)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal payload: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(base, "/")+"/api/claims", bytes.NewBuffer(body))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	setInternalClaimHeaders(req, w.cfg.InternalAPIKey, companyID, payload.PhoneNumber)
	resp, err := w.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("http do: %w", err)
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("frontend responded %d: %s", resp.StatusCode, string(respBytes))
	}
	var parsed struct {
		Success bool `json:"success"`
		Claim   struct {
			ClaimNumber string `json:"claimNumber"`
		} `json:"claim"`
	}
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return "", fmt.Errorf("parse response: %w", err)
	}
	if !parsed.Success || parsed.Claim.ClaimNumber == "" {
		return "", fmt.Errorf("unexpected response: %s", string(respBytes))
	}
	return parsed.Claim.ClaimNumber, nil
}

// ExtractPolicyNumberFromMessage attempts to extract policy numbers from WhatsApp messages
// This is a lightweight regex-based approach, complementing the AI-based extraction in semantic_kernel_service
func (w *WhatsAppService) ExtractPolicyNumberFromMessage(message string) string {
	message = strings.TrimSpace(message)
	upperMessage := strings.ToUpper(message)

	w.log.Infof("🔍 [POLICY EXTRACT] Searching for policy number in: '%s'", message)

	// Common policy number patterns for insurance companies
	policyPatterns := []struct {
		name    string
		pattern string
	}{
		{"Standard Format", `[A-Z]{2,6}-\d{4}-[A-Z0-9]{3,6}`},              // ACT-2025-1234, CLEAN-2024-ABC123
		{"Short Format", `[A-Z]{3,6}-\d{4,8}`},                             // ACT-20251234, AUTO-12345678
		{"Prefix Format", `ACT-[A-Z0-9]{4,12}`},                            // example policy prefix
		{"Clean Format", `CLEAN-\d{4}-[A-Z0-9]{3,8}`},                      // CLEAN-2024-ABC123
		{"Generic Dash", `[A-Z]{2,8}-[A-Z0-9]{4,12}`},                      // EST-2024-5678, POL-ABC123DEF
		{"Alphanumeric", `[A-Z]{2,4}\d{4,12}[A-Z]{0,4}`},                   // ACT20251234, EST2024ABC
		{"Policy Prefix", `(?:POLICY|POL|POLICE)[-\s]?([A-Z0-9\-]{5,20})`}, // POLICY-ACT123, POL ACT-2025-1234
	}

	// Look for policy numbers with common prefixes/indicators
	policyIndicators := []string{
		"police", "policy", "numéro de police", "numero de police", "police d'assurance",
		"policy number", "assurance", "contrat", "contract", "référence", "reference",
		"dossier", "file", "claim", "réclamation", "reclamation",
	}

	// Check if message contains policy indicators
	hasIndicator := false
	for _, indicator := range policyIndicators {
		if strings.Contains(strings.ToLower(message), indicator) {
			hasIndicator = true
			w.log.Infof("🎯 [POLICY EXTRACT] Found policy indicator: '%s'", indicator)
			break
		}
	}

	// Try each pattern
	for _, p := range policyPatterns {
		re := regexp.MustCompile(p.pattern)
		matches := re.FindAllString(upperMessage, -1)

		for _, match := range matches {
			// Clean the match
			cleanMatch := strings.TrimSpace(match)

			// Validate the match
			if w.isValidPolicyNumber(cleanMatch) {
				// If we have a policy indicator or the match looks very policy-like, return it
				if hasIndicator || w.isPolicyLike(cleanMatch) {
					w.log.Infof("✅ [POLICY EXTRACT] Found policy number: '%s' (pattern: %s)", cleanMatch, p.name)
					return cleanMatch
				}
			}
		}
	}

	// If no pattern matches but we have indicators, try to extract from context
	if hasIndicator {
		// Look for any alphanumeric sequence that could be a policy number
		words := strings.Fields(upperMessage)
		for i, word := range words {
			// Clean word of punctuation
			cleanWord := regexp.MustCompile(`[^A-Z0-9\-]`).ReplaceAllString(word, "")

			if len(cleanWord) >= 5 && len(cleanWord) <= 25 && w.isValidPolicyNumber(cleanWord) {
				// Check if previous or next word is a policy indicator
				context := ""
				if i > 0 {
					context += strings.ToLower(words[i-1]) + " "
				}
				if i < len(words)-1 {
					context += strings.ToLower(words[i+1])
				}

				for _, indicator := range policyIndicators {
					if strings.Contains(context, indicator) {
						w.log.Infof("✅ [POLICY EXTRACT] Found policy from context: '%s' (near: %s)", cleanWord, context)
						return cleanWord
					}
				}
			}
		}
	}

	w.log.Infof("❌ [POLICY EXTRACT] No policy number found in message")
	return ""
}

// isValidPolicyNumber validates if a string looks like a valid policy number
func (w *WhatsAppService) isValidPolicyNumber(policy string) bool {
	if len(policy) < 5 || len(policy) > 25 {
		return false
	}

	// Must contain at least one letter and one number
	hasLetter := regexp.MustCompile(`[A-Z]`).MatchString(policy)
	hasNumber := regexp.MustCompile(`\d`).MatchString(policy)

	if !hasLetter || !hasNumber {
		return false
	}

	// Should not be all numbers or all letters
	if regexp.MustCompile(`^\d+$`).MatchString(policy) || regexp.MustCompile(`^[A-Z]+$`).MatchString(policy) {
		return false
	}

	// Should not contain too many special characters
	specialCount := len(regexp.MustCompile(`[^A-Z0-9]`).FindAllString(policy, -1))
	if specialCount > 3 {
		return false
	}

	return true
}

// isPolicyLike checks if a string has characteristics of a policy number even without indicators
func (w *WhatsAppService) isPolicyLike(policy string) bool {
	// Common policy prefixes
	commonPrefixes := []string{"ACT", "EST", "POL", "INS", "CLEAN", "AUTO", "LIFE", "HOME", "TRAVEL"}

	for _, prefix := range commonPrefixes {
		if strings.HasPrefix(policy, prefix) {
			return true
		}
	}

	// Has a format that looks like policy (letters-numbers-letters pattern)
	if regexp.MustCompile(`^[A-Z]{2,6}-?\d{4,8}-?[A-Z0-9]{0,6}$`).MatchString(policy) {
		return true
	}

	return false
}

// VerifyWebhook verifies the webhook request from WhatsApp
func (w *WhatsAppService) VerifyWebhook(mode, token, challenge string) (string, error) {
	if mode == "subscribe" && token == w.cfg.WhatsAppVerifyToken {
		w.log.Infof("Webhook verified successfully")
		return challenge, nil
	}
	return "", fmt.Errorf("webhook verification failed")
}

// TestPolicyExtraction tests the policy extraction function with sample messages
func (w *WhatsAppService) TestPolicyExtraction() {
	w.log.Infof("🧪 [TESTING] Starting policy extraction tests...")

	testMessages := []struct {
		message  string
		expected string
	}{
		{"Mon numéro de police est ACT-2025-1234", "ACT-2025-1234"},
		{"Ma police d'assurance CLEAN-2024-ABC123 pour ma réclamation", "CLEAN-2024-ABC123"},
		{"Je voudrais déclarer un sinistre avec ma police EST-2024-5678", "EST-2024-5678"},
		{"Policy number: INS-AUTO-2025-9999", "INS-AUTO-2025-9999"},
		{"Mon contrat ACT20251234 a expiré", "ACT20251234"},
		{"Référence dossier POL-ABC123DEF456", "POL-ABC123DEF456"},
		{"Hello, my policy INS-2025-GOLD is active", "INS-2025-GOLD"},
		{"Bonjour, je n'ai pas de police", ""}, // Should return empty
		{"Hello there, how are you?", ""},      // Should return empty
	}

	for i, test := range testMessages {
		w.log.Infof("🧪 [TEST %d] Testing: '%s'", i+1, test.message)
		result := w.ExtractPolicyNumberFromMessage(test.message)

		if result == test.expected {
			w.log.Infof("✅ [TEST %d] PASSED - Expected: '%s', Got: '%s'", i+1, test.expected, result)
		} else {
			w.log.Errorf("❌ [TEST %d] FAILED - Expected: '%s', Got: '%s'", i+1, test.expected, result)
		}
	}

	w.log.Infof("🧪 [TESTING] Policy extraction tests completed")
}
