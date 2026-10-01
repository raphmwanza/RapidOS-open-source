package handlers

import (
	"fmt"
	"net/http"
	"rapidos/internal/config"
	"rapidos/internal/logger"
	"rapidos/internal/service"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type NotificationHandler struct {
	whatsappService       *service.WhatsAppService
	databaseService       *service.DatabaseService
	semanticKernelService *service.SemanticKernelService
	integrationSettings   *service.IntegrationSettingsStore
	log                   *logger.Logger
}

func NewNotificationHandler(whatsappService *service.WhatsAppService, log *logger.Logger) *NotificationHandler {
	return &NotificationHandler{
		whatsappService: whatsappService,
		log:             log,
	}
}

// Enhanced constructor with database service and semantic kernel
func NewNotificationHandlerWithDB(cfg *config.Config, db *gorm.DB, log *logger.Logger, dbService *service.DatabaseService, whatsappService *service.WhatsAppService, semanticKernelService *service.SemanticKernelService) *NotificationHandler {
	return &NotificationHandler{
		whatsappService:       whatsappService,
		databaseService:       dbService,
		semanticKernelService: semanticKernelService,
		integrationSettings:   service.NewIntegrationSettingsStore(db, cfg),
		log:                   log,
	}
}

type SendNotificationRequest struct {
	To      string `json:"to"`
	Message string `json:"message"`
	Type    string `json:"type"`
}

// SendStatusUpdateRequest represents the request payload for sending status update notifications
type SendStatusUpdateRequest struct {
	CustomerID      string `json:"customerId"`
	CompanyID       string `json:"companyId"`
	ClaimNumber     string `json:"claimNumber"`
	Status          string `json:"status"`
	CustomerPhone   string `json:"customerPhone"`
	CustomerName    string `json:"customerName"`
	AutoGeneratePDF bool   `json:"autoGeneratePdf"`
	AutoSendPDF     bool   `json:"autoSendPdf"`
}

// SendNotification handles sending WhatsApp notifications
func (h *NotificationHandler) SendNotification(c *gin.Context) {
	var req SendNotificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.log.Errorf("Failed to decode notification request: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Validate required fields
	if req.To == "" || req.Message == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number and message are required"})
		return
	}

	h.log.Infof("📱 [NOTIFICATION] Sending %s notification to %s", req.Type, req.To)

	sender, err := h.senderForCompany(strings.TrimSpace(c.GetHeader("X-Company-ID")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := sender.SendTextMessage(req.To, req.Message); err != nil {
		h.log.Errorf("Failed to send WhatsApp notification to %s: %v", req.To, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send notification"})
		return
	}

	h.log.Infof("✅ [NOTIFICATION] Successfully sent %s notification to %s", req.Type, req.To)

	// Return success response
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Notification sent successfully",
		"type":    req.Type,
		"to":      req.To,
	})
}

// SendStatusUpdateNotification sends the customer a WhatsApp message about a
// claim status change. The text comes from the per-language templates in
// service/botlocales (the company's bot language, English for missing keys),
// so it is predictable and never promises anything the insurer did not decide.
func (h *NotificationHandler) SendStatusUpdateNotification(c *gin.Context) {
	var req SendStatusUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.log.Errorf("Failed to parse status update notification request: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}
	if req.CustomerPhone == "" || req.ClaimNumber == "" || req.Status == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "CustomerPhone, ClaimNumber, and Status are required"})
		return
	}

	companyID := strings.TrimSpace(req.CompanyID)
	if companyID == "" {
		companyID = strings.TrimSpace(c.GetHeader("X-Company-ID"))
	}
	if companyID == "" && h.databaseService != nil {
		companyID = h.databaseService.GetClaimCompanyID(req.ClaimNumber)
	}

	lang, companyName := "fr", ""
	if h.databaseService != nil && companyID != "" {
		if profile, err := h.databaseService.GetBotProfile(companyID); err == nil && profile != nil {
			lang, companyName = profile.Language, profile.CompanyName
		} else {
			lang = h.databaseService.GetBotLanguage(companyID)
		}
	}

	// Support paused the bot on this customer's conversation: they are talking to
	// the customer themselves, so no automated message is sent.
	if h.databaseService != nil && h.databaseService.IsBotPausedForCustomer(companyID, req.CustomerPhone) {
		h.log.Infof("⏸️ [STATUS] Bot paused on %s's conversation: status update for claim %s not sent", req.CustomerPhone, req.ClaimNumber)
		c.JSON(http.StatusOK, gin.H{
			"status":  "skipped",
			"reason":  "bot_paused",
			"message": "The bot is paused on this conversation; the status update was not sent",
			"data":    gin.H{"claimNumber": req.ClaimNumber, "language": lang},
		})
		return
	}

	sendPDF := (req.AutoSendPDF || req.AutoGeneratePDF) && h.semanticKernelService != nil
	status := service.CanonicalClaimStatus(req.Status)
	message := service.StatusUpdateMessage(lang, status, req.CustomerName, req.ClaimNumber, companyName, sendPDF)

	sender, err := h.senderForCompany(companyID)
	if err != nil {
		h.log.Errorf("❌ [STATUS] No WhatsApp configuration for claim %s: %v", req.ClaimNumber, err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "language": lang})
		return
	}
	h.log.Infof("📤 [STATUS] Claim %s -> %s, sending %s status message to %s (company %s)", req.ClaimNumber, status, lang, req.CustomerPhone, companyID)
	if err := sender.SendTextMessage(req.CustomerPhone, message); err != nil {
		h.log.Errorf("❌ [STATUS] Failed to send WhatsApp status update to %s: %v", req.CustomerPhone, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send WhatsApp message", "language": lang})
		return
	}
	if sendPDF {
		go h.semanticKernelService.TriggerStatusUpdatePDF(req.ClaimNumber, companyID)
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Status update notification sent successfully",
		"data": gin.H{
			"claimNumber":      req.ClaimNumber,
			"status":           status,
			"language":         lang,
			"customerPhone":    req.CustomerPhone,
			"pdfAutoTriggered": sendPDF,
		},
	})
}

// senderForCompany returns a WhatsApp client that sends with the company's own
// WhatsApp Business credentials (never the deployment-wide ones).
func (h *NotificationHandler) senderForCompany(companyID string) (*service.WhatsAppService, error) {
	if companyID == "" {
		return nil, fmt.Errorf("company id is required (companyId or X-Company-ID)")
	}
	if h.integrationSettings == nil || h.whatsappService == nil {
		return nil, fmt.Errorf("WhatsApp is not configured")
	}
	runtime, err := h.integrationSettings.ForCompany(companyID)
	if err != nil {
		return nil, fmt.Errorf("WhatsApp settings for company %s: %w", companyID, err)
	}
	if runtime.PhoneNumberID == "" || runtime.WhatsAppToken == "" {
		return nil, fmt.Errorf("WhatsApp is not configured for company %s", companyID)
	}
	return h.whatsappService.ForCompany(runtime), nil
}
