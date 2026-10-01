package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"rapidos/internal/config"
	"rapidos/internal/logger"
	"rapidos/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type WhatsAppHandler struct {
	whatsappService       *service.WhatsAppService
	databaseService       *service.DatabaseService
	semanticKernelService *service.SemanticKernelService
	integrationSettings   *service.IntegrationSettingsStore
	dispatcher            *service.WebhookDispatcher
	log                   *logger.Logger
}

func NewWhatsAppHandler(cfg *config.Config, db *gorm.DB, log *logger.Logger, dbService *service.DatabaseService, skService *service.SemanticKernelService) *WhatsAppHandler {
	whatsappService := service.NewWhatsAppService(cfg, log)

	// Use the provided database service if available, otherwise create one
	databaseService := dbService
	if databaseService == nil {
		databaseService = service.NewDatabaseService(db, cfg, log)
	}

	// Connect database service to WhatsApp service
	whatsappService.SetDatabaseService(databaseService)

	// Connect semantic kernel service to WhatsApp service if available
	if skService != nil {
		whatsappService.SetSemanticKernelService(skService)
	}

	return &WhatsAppHandler{
		whatsappService:       whatsappService,
		databaseService:       databaseService,
		semanticKernelService: skService,
		integrationSettings:   service.NewIntegrationSettingsStore(db, cfg),
		dispatcher:            service.NewWebhookDispatcher(log),
		log:                   log,
	}
}

// WhatsAppWebhook handles incoming webhook requests from WhatsApp
func (h *WhatsAppHandler) WhatsAppWebhook(c *gin.Context) {
	// Handle webhook verification
	if c.Request.Method == "GET" {
		h.verifyWebhook(c)
		return
	}

	// Handle incoming messages
	if c.Request.Method == "POST" {
		h.handleIncomingMessage(c)
		return
	}

	c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "Method not allowed"})
}

func (h *WhatsAppHandler) verifyWebhook(c *gin.Context) {
	mode := c.Query("hub.mode")
	token := c.Query("hub.verify_token")
	challenge := c.Query("hub.challenge")

	// Never log the verify token itself: it is a shared secret with Meta.
	if mode != "subscribe" || token == "" {
		h.log.Warnf("Webhook verification rejected: mode=%q, token present=%t", mode, token != "")
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	// Settings are read from the database on every request, so a token saved
	// in the dashboard takes effect immediately (no restart or cache).
	companyID, _, err := h.integrationSettings.CompanyForVerifyToken(token)
	if err != nil {
		h.log.Warnf("Webhook verification failed: no company matches the supplied verify token")
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	h.log.Infof("Webhook verified for company %s", companyID)
	c.String(http.StatusOK, challenge)
}

func (h *WhatsAppHandler) handleIncomingMessage(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid payload"})
		return
	}
	var webhook service.WhatsAppWebhook
	if err := json.Unmarshal(body, &webhook); err != nil {
		h.log.Errorf("Failed to parse webhook payload: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid payload"})
		return
	}
	phoneNumberID := webhookPhoneNumberID(webhook)
	if phoneNumberID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing webhook phone_number_id"})
		return
	}
	companyID, runtime, err := h.integrationSettings.CompanyForPhoneNumberID(phoneNumberID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unknown WhatsApp phone number"})
		return
	}
	if !verifyWebhookSignature(body, c.GetHeader("X-Hub-Signature-256"), runtime.AppSecret) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid webhook signature"})
		return
	}

	// Acknowledge Meta right away and process in the background: LLM calls
	// can take longer than Meta's webhook timeout, which would trigger retries.
	svc := h.whatsappService.ForCompany(runtime)
	queued := 0
	for _, msg := range service.WebhookMessages(webhook) {
		if !h.dispatcher.MarkSeen(msg.ID) {
			h.log.Infof("🔄 [DUPLICATE] Webhook retry for message %s ignored", msg.ID)
			continue
		}
		m := msg
		h.dispatcher.Submit(companyID+"|"+m.From, func() {
			if err := svc.HandleMessageForCompany(m, companyID); err != nil {
				h.log.Errorf("Failed to process message %s: %v", m.ID, err)
			}
		})
		queued++
	}
	h.log.Infof("📥 [WEBHOOK] company=%s queued=%d", companyID, queued)
	c.JSON(http.StatusOK, gin.H{"status": "accepted", "queued": queued})
}

func webhookPhoneNumberID(webhook service.WhatsAppWebhook) string {
	for _, entry := range webhook.Entry {
		for _, change := range entry.Changes {
			if change.Value.Metadata.PhoneNumberID != "" {
				return change.Value.Metadata.PhoneNumberID
			}
		}
	}
	return ""
}

func verifyWebhookSignature(body []byte, header, secret string) bool {
	if secret == "" || len(header) < 7 || header[:7] != "sha256=" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return hmac.Equal([]byte(header[7:]), []byte(fmt.Sprintf("%x", mac.Sum(nil))))
}

// SendDocumentRequest represents the request payload for sending documents
type SendDocumentRequest struct {
	CustomerPhone string `json:"customerPhone"`
	DocumentURL   string `json:"documentUrl"`
	Filename      string `json:"filename"`
	Caption       string `json:"caption"`
}

// SendDocument handles sending documents to customers via WhatsApp
func (h *WhatsAppHandler) SendDocument(c *gin.Context) {
	var req SendDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.log.Errorf("Failed to parse send document request: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	h.log.Infof("📎 [DOCUMENT] Received document send request to customer %s", req.CustomerPhone)

	// Validate required fields
	if req.CustomerPhone == "" || req.DocumentURL == "" || req.Filename == "" {
		h.log.Errorf("❌ [DOCUMENT] Missing required fields: phone=%s, url=%s, filename=%s",
			req.CustomerPhone, req.DocumentURL, req.Filename)
		c.JSON(http.StatusBadRequest, gin.H{"error": "CustomerPhone, DocumentURL, and Filename are required"})
		return
	}

	// Send the WhatsApp document
	whatsAppService, err := h.serviceForRequestCompany(c)
	if err == nil {
		err = whatsAppService.SendDocument(req.CustomerPhone, req.DocumentURL, req.Caption, req.Filename)
	}
	if err != nil {
		h.log.Errorf("❌ [DOCUMENT] Failed to send WhatsApp document to %s: %v", req.CustomerPhone, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send WhatsApp document"})
		return
	}

	h.log.Infof("✅ [DOCUMENT] Successfully sent WhatsApp document to %s", req.CustomerPhone)

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Document sent successfully to WhatsApp",
		"data": gin.H{
			"customerPhone": req.CustomerPhone,
			"filename":      req.Filename,
			"documentUrl":   req.DocumentURL,
		},
	})
}

// SendMessageRequest represents the request payload for sending messages
type SendMessageRequest struct {
	ConversationID string `json:"conversationId"`
	CustomerID     string `json:"customerId"`
	CompanyID      string `json:"companyId"`
	CompanySlug    string `json:"companySlug"`
	Message        string `json:"message"`
	Role           string `json:"role"`
	Source         string `json:"source"`
	AdminID        string `json:"adminId"`
	CustomerPhone  string `json:"customerPhone"`
}

// SendMessage handles sending messages from agents to customers via WhatsApp
func (h *WhatsAppHandler) SendMessage(c *gin.Context) {
	var req SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.log.Errorf("Failed to parse send message request: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	h.log.Infof("📤 [AGENT] Received message send request from admin %s to customer %s", req.AdminID, req.CustomerPhone)

	// Validate required fields
	if req.CustomerPhone == "" || req.Message == "" {
		h.log.Errorf("❌ [AGENT] Missing required fields: phone=%s, message=%s", req.CustomerPhone, req.Message)
		c.JSON(http.StatusBadRequest, gin.H{"error": "CustomerPhone and Message are required"})
		return
	}

	// Send the WhatsApp message
	whatsAppService, err := h.serviceForRequestCompany(c)
	if err == nil {
		err = whatsAppService.SendTextMessage(req.CustomerPhone, req.Message)
	}
	if err != nil {
		h.log.Errorf("❌ [AGENT] Failed to send WhatsApp message to %s: %v", req.CustomerPhone, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send WhatsApp message"})
		return
	}

	h.log.Infof("✅ [AGENT] Successfully sent WhatsApp message to %s", req.CustomerPhone)

	// Note: Message is already saved by the Next.js frontend API before calling this endpoint
	// No need to save again here to avoid duplicates

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Message sent successfully to WhatsApp",
		"data": gin.H{
			"customerPhone":  req.CustomerPhone,
			"messageLength":  len(req.Message),
			"conversationId": req.ConversationID,
		},
	})
}

// serviceForRequestCompany keeps internal sends (PDFs and agent replies) in
// the same tenant boundary as authenticated API requests.
func (h *WhatsAppHandler) serviceForRequestCompany(c *gin.Context) (*service.WhatsAppService, error) {
	companyID := c.GetHeader("X-Company-ID")
	if companyID == "" {
		return nil, fmt.Errorf("X-Company-ID is required")
	}
	runtime, err := h.integrationSettings.ForCompany(companyID)
	if err != nil {
		return nil, err
	}
	return h.whatsappService.ForCompany(runtime), nil
}

// TestPolicyExtraction handles testing the policy extraction functionality
func (h *WhatsAppHandler) TestPolicyExtraction(c *gin.Context) {
	h.log.Infof("🧪 [API TEST] Policy extraction test endpoint called")

	// Run the test function
	h.whatsappService.TestPolicyExtraction()

	// Also test a custom message if provided
	type TestRequest struct {
		Message string `json:"message"`
	}

	var req TestRequest
	if err := c.ShouldBindJSON(&req); err == nil && req.Message != "" {
		h.log.Infof("🧪 [API TEST] Testing custom message: '%s'", req.Message)
		result := h.whatsappService.ExtractPolicyNumberFromMessage(req.Message)

		c.JSON(http.StatusOK, gin.H{
			"status":  "success",
			"message": "Policy extraction test completed",
			"data": gin.H{
				"testMessage":     req.Message,
				"extractedPolicy": result,
				"found":           result != "",
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Policy extraction test completed - check logs for results",
	})
}

// TestBot validates a tenant's saved provider configuration without sending a
// WhatsApp message or persisting a claim.
func (h *WhatsAppHandler) TestBot(c *gin.Context) {
	if h.semanticKernelService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI service is not available"})
		return
	}
	var req struct {
		CompanyID string `json:"companyId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.CompanyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "companyId is required"})
		return
	}
	extracted, err := h.semanticKernelService.TestClaimExtraction(c.Request.Context(), req.CompanyID)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Provider test failed: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "extracted": extracted})
}
