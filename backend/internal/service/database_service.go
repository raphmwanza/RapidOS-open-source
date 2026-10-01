package service

import (
	"encoding/json"
	"fmt"
	"rapidos/internal/config"
	"rapidos/internal/logger"
	"rapidos/internal/models"
	"strings"
	"time"

	"gorm.io/gorm"
)

// normalizePhoneNumberDB converts phone numbers to digits-only format (consistent with WhatsApp service)
func normalizePhoneNumberDB(phoneNumber string) string {
	// Customers are stored in E.164 ("+243812345678"); WhatsApp numbers are
	// international digits.
	return whatsappE164(phoneNumber)
}

type DatabaseService struct {
	db  *gorm.DB
	cfg *config.Config
	log *logger.Logger
}

type CustomerInfo struct {
	ID           string      `json:"id"`
	PhoneNumber  string      `json:"phoneNumber"`
	FirstName    string      `json:"firstName"`
	LastName     string      `json:"lastName"`
	Email        string      `json:"email"`
	PolicyNumber string      `json:"policyNumber"`
	Company      CompanyInfo `json:"company"`
	CompanyID    string      `json:"companyId"`
}

type CompanyInfo struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Slug   string `json:"slug"`
	Domain string `json:"domain"`
}

// GetCompany returns one active tenant; webhook processing must never infer a
// tenant from whichever company happens to be first in the database.
func (d *DatabaseService) GetCompany(companyID string) (*CompanyInfo, error) {
	var company CompanyInfo
	if err := d.db.Table("companies").Where("id = ? AND is_active = ?", companyID, true).First(&company).Error; err != nil {
		return nil, err
	}
	return &company, nil
}

type EnhancedCompanyInfo struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Slug           string  `json:"slug"`
	Domain         string  `json:"domain"`
	WelcomeMessage string  `json:"welcome_message"`
	SystemPrompt   string  `json:"system_prompt"`
	MaxTokens      int     `json:"max_tokens"`
	Temperature    float32 `json:"temperature"`
	Model          string  `json:"model"`
}

type ConversationInfo struct {
	ID         string     `json:"id"`
	WhatsAppID string     `json:"whatsappId"`
	Title      string     `json:"title"`
	IsActive   bool       `json:"isActive"`
	Mode       string     `json:"mode"`
	ModeSetAt  *time.Time `json:"modeSetAt"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	CustomerID string     `json:"customerId"`
	CompanyID  string     `json:"companyId"`
}

type MessageInfo struct {
	ID             string    `json:"id"`
	Content        string    `json:"content"`
	Role           string    `json:"role"`
	CreatedAt      time.Time `json:"createdAt"`
	ConversationID string    `json:"conversationId"`
	// Metadata is the raw JSON of messages.metadata ("" when empty).
	Metadata string `json:"metadata,omitempty"`
}

type ClaimInfo struct {
	ID              string    `json:"id"`
	ClaimNumber     string    `json:"claimNumber"`
	Type            string    `json:"type"`
	Status          string    `json:"status"`
	Description     string    `json:"description"`
	EstimatedAmount float64   `json:"estimatedAmount"`
	IncidentDate    time.Time `json:"incidentDate"`
	CreatedAt       time.Time `json:"createdAt"`
}

func NewDatabaseService(db *gorm.DB, cfg *config.Config, log *logger.Logger) *DatabaseService {
	return &DatabaseService{
		db:  db,
		cfg: cfg,
		log: log,
	}
}

// GetCustomerByPhone retrieves a customer by phone number (cross-company)
func (d *DatabaseService) GetCustomerByPhone(phoneNumber string) (*CustomerInfo, error) {
	normalizedPhone := normalizePhoneNumberDB(phoneNumber)

	query := `
		SELECT c.id, c.phone_number as phone_number, c.first_name as first_name, c.last_name as last_name, c.email, c.policy_number, c.company_id as company_id,
		       co.id as company_id_ref, co.name as company_name, co.slug as company_slug, co.domain as company_domain
		FROM customers c
		JOIN companies co ON c.company_id = co.id
		WHERE c.phone_number IN (?) AND c.is_active = true
		ORDER BY c.updated_at DESC
		LIMIT 1
	`

	type customerRow struct {
		ID            string  `json:"id"`
		PhoneNumber   string  `json:"phone_number"`
		FirstName     *string `json:"first_name"`
		LastName      *string `json:"last_name"`
		Email         *string `json:"email"`
		PolicyNumber  *string `json:"policy_number"`
		CompanyID     string  `json:"company_id"`
		CompanyIDRef  string  `json:"company_id_ref"`
		CompanyName   string  `json:"company_name"`
		CompanySlug   string  `json:"company_slug"`
		CompanyDomain string  `json:"company_domain"`
	}

	var row customerRow
	err := d.db.Raw(query, phoneLookupVariants(normalizedPhone)).Scan(&row).Error
	if err != nil {
		return nil, err
	}

	if row.ID == "" {
		return nil, nil // Not found
	}

	var customer CustomerInfo
	customer.ID = row.ID
	customer.PhoneNumber = row.PhoneNumber
	if row.FirstName != nil {
		customer.FirstName = *row.FirstName
	}
	if row.LastName != nil {
		customer.LastName = *row.LastName
	}
	if row.Email != nil {
		customer.Email = *row.Email
	}
	if row.PolicyNumber != nil {
		customer.PolicyNumber = *row.PolicyNumber
	}
	customer.CompanyID = row.CompanyID
	customer.Company = CompanyInfo{
		ID:     row.CompanyIDRef,
		Name:   row.CompanyName,
		Slug:   row.CompanySlug,
		Domain: row.CompanyDomain,
	}

	return &customer, nil
}

// GetOrCreateCustomer returns the company's single customer record for a
// phone number, creating it if needed. The number is stored in E.164 and the
// insert is an upsert on the (phone_number, company_id) unique key, so two
// messages processed at the same time can never create two customers.
func (d *DatabaseService) GetOrCreateCustomer(phoneNumber, companyID string) (*CustomerInfo, error) {
	e164 := normalizePhoneNumberDB(phoneNumber)
	if e164 == "" {
		return nil, fmt.Errorf("invalid phone number %q", phoneNumber)
	}
	d.log.Infof("📞 [DB] Looking up customer %s (original: %s)", e164, phoneNumber)

	type customerRow struct {
		ID            string  `json:"id"`
		PhoneNumber   string  `json:"phone_number"`
		FirstName     *string `json:"first_name"`
		LastName      *string `json:"last_name"`
		Email         *string `json:"email"`
		PolicyNumber  *string `json:"policy_number"`
		CompanyID     string  `json:"company_id"`
		CompanyIDRef  string  `json:"company_id_ref"`
		CompanyName   string  `json:"company_name"`
		CompanySlug   string  `json:"company_slug"`
		CompanyDomain string  `json:"company_domain"`
	}
	selectQuery := `
		SELECT c.id, c.phone_number as phone_number, c.first_name as first_name, c.last_name as last_name, c.email, c.policy_number, c.company_id as company_id,
		       co.id as company_id_ref, co.name as company_name, co.slug as company_slug, co.domain as company_domain
		FROM customers c
		JOIN companies co ON c.company_id = co.id
		WHERE c.phone_number IN (?) AND c.company_id = ?
		ORDER BY c.created_at ASC NULLS LAST
		LIMIT 1
	`
	var row customerRow
	if err := d.db.Raw(selectQuery, phoneLookupVariants(e164), companyID).Scan(&row).Error; err != nil && err != gorm.ErrRecordNotFound {
		return nil, err
	}
	if row.ID == "" {
		d.log.Infof("📞 [DB] Creating customer %s for company %s (upsert)", e164, companyID)
		upsert := `
			INSERT INTO customers (id, phone_number, company_id, is_active, created_at, updated_at)
			VALUES (gen_random_uuid(), ?, ?, true, NOW(), NOW())
			ON CONFLICT (phone_number, company_id) DO UPDATE SET updated_at = NOW()
			RETURNING id
		`
		var created struct{ ID string }
		if err := d.db.Raw(upsert, e164, companyID).Scan(&created).Error; err != nil {
			return nil, err
		}
		if err := d.db.Raw(selectQuery, phoneLookupVariants(e164), companyID).Scan(&row).Error; err != nil {
			return nil, err
		}
		if row.ID == "" {
			return nil, fmt.Errorf("company %s not found", companyID)
		}
	}

	customer := CustomerInfo{ID: row.ID, PhoneNumber: row.PhoneNumber, CompanyID: row.CompanyID}
	if row.FirstName != nil {
		customer.FirstName = *row.FirstName
	}
	if row.LastName != nil {
		customer.LastName = *row.LastName
	}
	if row.Email != nil {
		customer.Email = *row.Email
	}
	if row.PolicyNumber != nil {
		customer.PolicyNumber = *row.PolicyNumber
	}
	customer.Company = CompanyInfo{ID: row.CompanyIDRef, Name: row.CompanyName, Slug: row.CompanySlug, Domain: row.CompanyDomain}
	return &customer, nil
}

// GetCustomerByID retrieves customer information by ID
func (d *DatabaseService) GetCustomerByID(customerID string) (*models.Customer, error) {
	var customer models.Customer

	err := d.db.Where("id = ?", customerID).First(&customer).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get customer by ID: %v", err)
	}

	return &customer, nil
}

// GetOrCreateConversationByWhatsAppID gets or creates a conversation using WhatsApp message ID as reference
func (d *DatabaseService) GetOrCreateConversationByWhatsAppID(whatsappID, customerID, companyID string) (*ConversationInfo, error) {
	var conversation ConversationInfo

	// First try to find existing conversation by WhatsApp ID in the title or find most recent active conversation
	query := `
		SELECT id, title, is_active, COALESCE(mode, 'general') as mode, mode_set_at, created_at, updated_at, customer_id, company_id
		FROM conversations
		WHERE customer_id = ? AND company_id = ? AND is_active = true
		ORDER BY updated_at DESC
		LIMIT 1
	`

	err := d.db.Raw(query, customerID, companyID).Scan(&conversation).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		return nil, err
	}

	// If no conversation found, create a new one
	if conversation.ID == "" {
		d.log.Infof("Creating new conversation for WhatsApp ID %s, customer %s", whatsappID, customerID)

		createQuery := `
			INSERT INTO conversations (id, customer_id, company_id, title, is_active, mode, created_at, updated_at)
			VALUES (gen_random_uuid(), ?, ?, ?, true, 'general', NOW(), NOW())
			RETURNING id, title, is_active, mode, mode_set_at, created_at, updated_at, customer_id, company_id
		`

		// Use WhatsApp ID in the title for reference
		// Avoid slicing to prevent any out-of-range panics in edge cases
		title := "WhatsApp Chat"

		err := d.db.Raw(createQuery, customerID, companyID, title).Scan(&conversation).Error
		if err != nil {
			return nil, err
		}
	}

	// Store the WhatsApp ID for reference
	conversation.WhatsAppID = whatsappID

	return &conversation, nil
}

func (d *DatabaseService) SaveMessage(conversationID, content, role string) (*MessageInfo, error) {
	var message MessageInfo

	query := `
		INSERT INTO messages (id, conversation_id, content, role, created_at)
		VALUES (gen_random_uuid(), ?, ?, ?, NOW())
		RETURNING id, conversation_id, content, role, created_at
	`

	err := d.db.Raw(query, conversationID, content, role).Scan(&message).Error
	if err != nil {
		return nil, err
	}

	d.db.Exec("UPDATE conversations SET updated_at = NOW() WHERE id = ?", conversationID)

	return &message, nil
}

// SaveMessageWithMetadata stores a message with a JSON metadata object (used
// for the WhatsApp claim draft and claim events).
func (d *DatabaseService) SaveMessageWithMetadata(conversationID, content, role string, metadata map[string]interface{}) (*MessageInfo, error) {
	if metadata == nil {
		return d.SaveMessage(conversationID, content, role)
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return nil, err
	}
	var message MessageInfo
	query := `
		INSERT INTO messages (id, conversation_id, content, role, metadata, created_at)
		VALUES (gen_random_uuid(), ?, ?, ?, ?::jsonb, NOW())
		RETURNING id, conversation_id, content, role, created_at, COALESCE(metadata::text, '') AS metadata
	`
	if err := d.db.Raw(query, conversationID, content, role, string(raw)).Scan(&message).Error; err != nil {
		return nil, err
	}
	d.db.Exec("UPDATE conversations SET updated_at = NOW() WHERE id = ?", conversationID)
	return &message, nil
}

func (d *DatabaseService) GetRecentMessages(conversationID string, limit int) ([]MessageInfo, error) {
	var messages []MessageInfo

	query := `
		SELECT id, conversation_id, content, role, created_at, COALESCE(metadata::text, '') AS metadata
		FROM messages
		WHERE conversation_id = ?
		ORDER BY created_at DESC, id DESC
		LIMIT ?
	`

	err := d.db.Raw(query, conversationID, limit).Scan(&messages).Error
	if err != nil {
		return nil, err
	}

	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	return messages, nil
}

func (d *DatabaseService) GetCustomerClaims(customerID string) ([]ClaimInfo, error) {
	var claims []ClaimInfo

	query := `
		SELECT 
			"id" as id,
			"claimNumber" as claim_number,
			"type" as type,
			"status" as status,
			"description" as description,
			COALESCE("estimatedAmount", 0) as estimated_amount,
			"incidentDate" as incident_date,
			"createdAt" as created_at
		FROM claims
		WHERE "customerId" = ?
		ORDER BY "createdAt" DESC
		LIMIT 10
	`

	err := d.db.Raw(query, customerID).Scan(&claims).Error
	if err != nil {
		return nil, err
	}

	return claims, nil
}

func (d *DatabaseService) MarkConversationAsEscalated(conversationID string) error {
	query := `
		UPDATE conversations 
		SET is_escalated = true, updated_at = NOW()
		WHERE id = ?
	`

	return d.db.Exec(query, conversationID).Error
}

func (d *DatabaseService) CheckIfEscalated(conversationID string) (bool, error) {
	var count int64

	query := `
		SELECT COUNT(*)
		FROM conversations
		WHERE id = ? AND is_escalated = true
	`

	err := d.db.Raw(query, conversationID).Count(&count).Error
	return count > 0, err
}

// CheckIfBotPaused checks if the bot is paused for a conversation
func (d *DatabaseService) CheckIfBotPaused(conversationID string) (bool, error) {
	var count int64

	query := `
		SELECT COUNT(*)
		FROM conversations
		WHERE id = ? AND is_bot_paused = true
	`

	err := d.db.Raw(query, conversationID).Count(&count).Error
	return count > 0, err
}

// IsBotPausedForCustomer reports whether support paused the bot on a
// conversation of this customer (company + phone, any stored format): automated
// messages (status updates, their PDFs) are then not sent to that conversation.
func (d *DatabaseService) IsBotPausedForCustomer(companyID, phone string) bool {
	e164 := normalizePhoneNumberDB(phone)
	if companyID == "" || e164 == "" {
		return false
	}
	var count int64
	err := d.db.Raw(`
		SELECT COUNT(*)
		FROM conversations cv
		JOIN customers cu ON cu.id = cv.customer_id
		WHERE cu.company_id = ? AND cu.phone_number IN (?) AND cv.is_bot_paused = true AND cv.is_active = true
	`, companyID, phoneLookupVariants(e164)).Count(&count).Error
	return err == nil && count > 0
}

// MarkConversationBotPaused marks a conversation as bot paused or unpaused
func (d *DatabaseService) MarkConversationBotPaused(conversationID string, paused bool, pausedBy string) error {
	query := `
		UPDATE conversations 
		SET is_bot_paused = ?, paused_by = ?, paused_at = ?, updated_at = NOW()
		WHERE id = ?
	`

	var pausedAt interface{}
	var pausedByValue interface{}

	if paused {
		pausedAt = time.Now()
		pausedByValue = pausedBy
	} else {
		pausedAt = nil
		pausedByValue = nil
	}

	return d.db.Exec(query, paused, pausedByValue, pausedAt, conversationID).Error
}

// CompanySettingInfo represents a company setting for AI prompts
type CompanySettingInfo struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Description     string  `json:"description"`
	Type            string  `json:"type"`            // DOCUMENT, TEXT, BOOLEAN
	TextValue       *string `json:"textValue"`       // For text settings
	DocumentURL     *string `json:"documentUrl"`     // For document settings
	DocumentContent *string `json:"documentContent"` // Extracted text content from document
	BoolValue       *bool   `json:"boolValue"`       // For boolean settings
	IsActive        bool    `json:"isActive"`
}

// GetCompanySettings retrieves active settings for a company
func (d *DatabaseService) GetCompanySettings(companyID string) ([]CompanySettingInfo, error) {
	if d.db == nil {
		d.log.Errorf("Database not available for settings retrieval")
		return []CompanySettingInfo{}, fmt.Errorf("database not available")
	}

	var settings []CompanySettingInfo

	query := `
		SELECT 
			"id" as id,
			"name" as name,
			"description" as description,
			"type" as type,
			COALESCE("textValue", "text_value") as text_value,
			COALESCE("documentUrl", "document_url") as document_url,
			COALESCE("documentContent", "document_content") as document_content,
			COALESCE("boolValue", "bool_value") as bool_value,
			COALESCE("isActive", "is_active") as is_active
		FROM settings 
		WHERE "companyId" = ? AND COALESCE("isActive", "is_active") = true
		ORDER BY COALESCE("createdAt", "created_at") DESC
	`

	err := d.db.Raw(query, companyID).Scan(&settings).Error
	if err != nil {
		d.log.Errorf("Failed to fetch company settings for %s: %v", companyID, err)
		return []CompanySettingInfo{}, fmt.Errorf("failed to fetch settings: %v", err)
	}

	d.log.Infof("📋 [SETTINGS] Retrieved %d active settings for company %s", len(settings), companyID)
	return settings, nil
}

// CreateClaim creates a new claim in the database
func (d *DatabaseService) CreateClaim(customerID, claimNumber, claimType, description string, estimatedAmount float64, incidentDate time.Time) (*ClaimInfo, error) {
	var claim ClaimInfo

	query := `
		INSERT INTO claims ("id", "customerId", "claimNumber", "type", "status", "description", "estimatedAmount", "incidentDate", "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), ?, ?, ?, 'PENDING', ?, ?, ?, NOW(), NOW())
		RETURNING "id", "claimNumber", "type", "status", "description", "estimatedAmount", "incidentDate", "createdAt"
	`

	err := d.db.Raw(query, customerID, claimNumber, claimType, description, estimatedAmount, incidentDate).Scan(&claim).Error
	if err != nil {
		d.log.Errorf("Failed to create claim: %v", err)
		return nil, err
	}

	d.log.Infof("🏥 [CLAIMS] Created new claim %s for customer %s", claim.ClaimNumber, customerID)
	return &claim, nil
}

// UpdateClaimStatus updates the status of an existing claim
func (d *DatabaseService) UpdateClaimStatus(claimID, status string) error {
	query := `
		UPDATE claims 
		SET "status" = ?, "updatedAt" = NOW()
		WHERE "id" = ?
	`

	err := d.db.Exec(query, status, claimID).Error
	if err != nil {
		d.log.Errorf("Failed to update claim status: %v", err)
		return err
	}

	d.log.Infof("🔄 [CLAIMS] Updated claim %s status to %s", claimID, status)
	return nil
}

// GetClaimByNumber retrieves a claim by its claim number
func (d *DatabaseService) GetClaimByNumber(claimNumber string) (*ClaimInfo, error) {
	var claim ClaimInfo

	query := `
		SELECT 
			"id" as id,
			"claimNumber" as claim_number,
			"type" as type,
			"status" as status,
			"description" as description,
			COALESCE("estimatedAmount", 0) as estimated_amount,
			"incidentDate" as incident_date,
			"createdAt" as created_at
		FROM claims
		WHERE "claimNumber" = ?
		LIMIT 1
	`

	err := d.db.Raw(query, claimNumber).Scan(&claim).Error
	if err != nil {
		return nil, err
	}

	return &claim, nil
}

// GetClaimCompanyID returns the company that owns a claim number ("" when unknown).
func (d *DatabaseService) GetClaimCompanyID(claimNumber string) string {
	if d == nil || d.db == nil || claimNumber == "" {
		return ""
	}
	var companyID string
	if err := d.db.Raw(`SELECT "companyId" FROM claims WHERE "claimNumber" = ? LIMIT 1`, claimNumber).Scan(&companyID).Error; err != nil {
		return ""
	}
	return companyID
}

// Message deduplication methods to prevent processing duplicate WhatsApp messages
func (d *DatabaseService) CheckMessageProcessed(whatsappMessageID string) (bool, error) {
	var count int64
	err := d.db.Raw("SELECT COUNT(*) FROM processed_messages WHERE whatsapp_message_id = ?", whatsappMessageID).Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// ClaimMessageForProcessing atomically records a WhatsApp message id and
// reports whether this call is the first to see it (Meta retries webhooks).
func (d *DatabaseService) ClaimMessageForProcessing(whatsappMessageID, phoneNumber string) (bool, error) {
	res := d.db.Exec(`
		INSERT INTO processed_messages (id, whatsapp_message_id, phone_number, processed_at)
		VALUES (gen_random_uuid(), ?, ?, NOW())
		ON CONFLICT (whatsapp_message_id) DO NOTHING
	`, whatsappMessageID, phoneNumber)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected == 1, nil
}

func (d *DatabaseService) MarkMessageProcessed(whatsappMessageID, phoneNumber string) error {
	query := `
		INSERT INTO processed_messages (id, whatsapp_message_id, phone_number, processed_at)
		VALUES (gen_random_uuid(), ?, ?, NOW())
		ON CONFLICT (whatsapp_message_id) DO NOTHING
	`
	return d.db.Exec(query, whatsappMessageID, phoneNumber).Error
}

// UpdateConversationCustomer updates an existing conversation to associate it with the correct customer
// This is used when customer information is extracted from claims and needs to be linked to existing messages
func (d *DatabaseService) UpdateConversationCustomer(conversationID, customerID string) error {
	query := `
		UPDATE conversations 
		SET customer_id = ?, updated_at = NOW()
		WHERE id = ?
	`
	result := d.db.Exec(query, customerID, conversationID)
	if result.Error != nil {
		return result.Error
	}

	if result.RowsAffected == 0 {
		return fmt.Errorf("conversation %s not found", conversationID)
	}

	d.log.Infof("🔄 [DB] Updated conversation %s to associate with customer %s", conversationID, customerID)
	return nil
}

// UpdateCustomerName stores the customer's name. An existing name is only
// replaced when the customer explicitly corrected it (correction=true);
// otherwise only empty first/last names are filled.
func (d *DatabaseService) UpdateCustomerName(customerID, fullName string, correction bool) error {
	parts := strings.Fields(strings.TrimSpace(fullName))
	if len(parts) == 0 {
		return nil
	}
	firstName, lastName := parts[0], strings.Join(parts[1:], " ")
	var result *gorm.DB
	if correction {
		// A corrected first name alone ("it's Patrick, with c-k") keeps the last name.
		result = d.db.Exec(`UPDATE customers SET first_name = ?, last_name = CASE WHEN ? = '' THEN last_name ELSE ? END, updated_at = NOW() WHERE id = ?`, firstName, lastName, lastName, customerID)
	} else {
		result = d.db.Exec(`
			UPDATE customers
			SET first_name = CASE WHEN COALESCE(first_name, '') = '' THEN ? ELSE first_name END,
			    last_name  = CASE WHEN COALESCE(last_name, '') = '' AND (COALESCE(first_name, '') = '' OR lower(first_name) = lower(?)) THEN NULLIF(?, '') ELSE last_name END,
			    updated_at = NOW()
			WHERE id = ? AND (COALESCE(first_name, '') = '' OR (COALESCE(last_name, '') = '' AND lower(first_name) = lower(?) AND ? <> ''))
		`, firstName, firstName, lastName, customerID, firstName, lastName)
	}
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected > 0 {
		d.log.Infof("👤 [DB] Customer %s name set to %s %s (correction=%t)", customerID, firstName, lastName, correction)
	} else {
		d.log.Infof("👤 [DB] Customer %s already has a name; not overwritten", customerID)
	}
	return nil
}

// UpdateCustomerEmail updates a customer's email address based on extracted information
func (d *DatabaseService) UpdateCustomerEmail(customerID, email string) error {
	if email == "" {
		return nil // No email to update
	}

	// Basic email validation
	if !strings.Contains(email, "@") || !strings.Contains(email, ".") {
		d.log.Warnf("👤 [EMAIL] Invalid email format: %s", email)
		return nil
	}

	query := `
		UPDATE customers 
		SET email = ?, updated_at = NOW()
		WHERE id = ? AND (email IS NULL OR email = '')
	`

	result := d.db.Exec(query, email, customerID)
	if result.Error != nil {
		return result.Error
	}

	if result.RowsAffected > 0 {
		d.log.Infof("📧 [DB] Updated customer %s email to: %s", customerID, email)
	} else {
		d.log.Infof("📧 [DB] Customer %s already has email information, skipping update", customerID)
	}

	return nil
}

// UpdateCustomerPolicyNumber stores the policy number when the profile has
// none, or replaces it when the customer explicitly corrected it.
func (d *DatabaseService) UpdateCustomerPolicyNumber(customerID, policyNumber string, correction bool) error {
	policyNumber = strings.TrimSpace(policyNumber)
	if policyNumber == "" {
		return nil
	}
	q := "UPDATE customers SET policy_number = ?, updated_at = NOW() WHERE id = ? AND COALESCE(policy_number, '') = ''"
	if correction {
		q = "UPDATE customers SET policy_number = ?, updated_at = NOW() WHERE id = ? AND COALESCE(policy_number, '') <> ?"
	}
	args := []interface{}{policyNumber, customerID}
	if correction {
		args = append(args, policyNumber)
	}
	result := d.db.Exec(q, args...)
	if result.Error != nil {
		d.log.Errorf("Failed to update customer policy number: %v", result.Error)
		return result.Error
	}
	d.log.Infof("🔢 [POLICY] Customer %s policy %s (correction=%t, rows=%d)", customerID, policyNumber, correction, result.RowsAffected)
	return nil
}

// UpdateCustomerAddress stores the address when the profile has none, or
// replaces it when the customer explicitly corrected it.
func (d *DatabaseService) UpdateCustomerAddress(customerID, address string, correction bool) error {
	address = strings.TrimSpace(address)
	if address == "" {
		return nil
	}
	q := "UPDATE customers SET address = ?, updated_at = NOW() WHERE id = ? AND COALESCE(address, '') = ''"
	if correction {
		q = "UPDATE customers SET address = ?, updated_at = NOW() WHERE id = ?"
	}
	result := d.db.Exec(q, address, customerID)
	if result.Error != nil {
		return result.Error
	}
	d.log.Infof("🏠 [ADDRESS] Customer %s address (correction=%t, rows=%d)", customerID, correction, result.RowsAffected)
	return nil
}

// GetClaimTypeWithFields gets a claim type and its associated fields from the database
func (d *DatabaseService) GetClaimTypeWithFields(claimTypeID string) (*ClaimTypeInfo, []DatabaseFieldInfo, error) {
	var claimType ClaimTypeInfo

	// Get claim type info
	query := `
		SELECT id, type_name, display_name, description
		FROM claim_types 
		WHERE id = $1 AND is_active = true
	`

	err := d.db.Raw(query, claimTypeID).Scan(&claimType).Error
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get claim type: %v", err)
	}

	// Get fields for this claim type
	var fields []DatabaseFieldInfo
	fieldsQuery := `
		SELECT field_name, field_type, is_required, validation_rules, default_value
		FROM claim_fields 
		WHERE claim_type_id = $1 
		ORDER BY field_name
	`

	err = d.db.Raw(fieldsQuery, claimTypeID).Scan(&fields).Error
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get claim fields: %v", err)
	}

	return &claimType, fields, nil
}

// DatabaseFieldInfo represents field information from database
type DatabaseFieldInfo struct {
	FieldName       string  `json:"fieldName"`
	FieldType       string  `json:"fieldType"`
	IsRequired      bool    `json:"isRequired"`
	ValidationRules *string `json:"validationRules"`
	DefaultValue    *string `json:"defaultValue"`
}

// GetConversationClaimContext retrieves the claim context for a conversation
func (d *DatabaseService) GetConversationClaimContext(conversationID string) (*ConversationClaimContext, error) {
	query := `
		SELECT processing_phase, current_detection_id, confirmed_claim_type_id, extracted_data
		FROM conversation_claim_contexts 
		WHERE conversation_id = $1
	`

	var phase string
	var detectionID, claimTypeID *string
	var extractedDataJSON *string

	err := d.db.Raw(query, conversationID).Row().Scan(&phase, &detectionID, &claimTypeID, &extractedDataJSON)
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			// No existing context, return nil to create new one
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get claim context: %v", err)
	}

	context := &ConversationClaimContext{
		ConversationID:  conversationID,
		ProcessingPhase: phase,
	}

	// TODO: Load detection result and claim type if needed
	// This would require additional queries to get the full objects

	return context, nil
}

// SaveConversationClaimContext saves or updates the claim context for a conversation
func (d *DatabaseService) SaveConversationClaimContext(context *ConversationClaimContext) error {
	query := `
		INSERT INTO conversation_claim_contexts (conversation_id, processing_phase, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (conversation_id) 
		DO UPDATE SET 
			processing_phase = EXCLUDED.processing_phase,
			updated_at = NOW()
	`

	return d.db.Exec(query, context.ConversationID, context.ProcessingPhase).Error
}

// SetConversationMode updates the mode of a conversation (e.g., "general", "claim_filing")
func (d *DatabaseService) SetConversationMode(conversationID, mode string) error {
	query := `
		UPDATE conversations 
		SET mode = ?, mode_set_at = NOW(), updated_at = NOW()
		WHERE id = ?
	`
	result := d.db.Exec(query, mode, conversationID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("conversation %s not found", conversationID)
	}
	d.log.Infof("🔄 [DB] Set conversation %s mode to '%s'", conversationID, mode)
	return nil
}

// ResetExpiredConversationMode resets mode to "general" if mode_set_at is older than the given duration
func (d *DatabaseService) ResetExpiredConversationMode(conversationID string, maxAge time.Duration) (bool, error) {
	query := `
		UPDATE conversations 
		SET mode = 'general', mode_set_at = NULL, updated_at = NOW()
		WHERE id = ? AND mode != 'general' AND mode_set_at IS NOT NULL AND mode_set_at < ?
	`
	cutoff := time.Now().Add(-maxAge)
	result := d.db.Exec(query, conversationID, cutoff)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected > 0 {
		d.log.Infof("⏰ [DB] Expired conversation %s mode (was set before %v)", conversationID, cutoff)
		return true, nil
	}
	return false, nil
}

// GetBotProfile returns the assistant identity of a company: its name, bot
// language and the system prompt configured in the dashboard (camelCase
// columns written by Prisma win over the legacy snake_case ones).
func (d *DatabaseService) GetBotProfile(companyID string) (*BotProfile, error) {
	if d.db == nil {
		return nil, fmt.Errorf("database not available")
	}
	var row struct {
		Name         string
		BotLanguage  string
		SystemPrompt string
	}
	query := `
		SELECT c.name AS name,
		       COALESCE(c.bot_language, 'fr') AS bot_language,
		       COALESCE(NULLIF(cb."systemPrompt", ''), cb.system_prompt, '') AS system_prompt
		FROM companies c
		LEFT JOIN chatbot_configs cb ON cb."companyId" = c.id AND COALESCE(cb."isActive", cb.is_active, true) = true
		WHERE c.id = ?
		LIMIT 1
	`
	if err := d.db.Raw(query, companyID).Scan(&row).Error; err != nil {
		return nil, fmt.Errorf("failed to load bot profile: %w", err)
	}
	if row.Name == "" {
		return nil, fmt.Errorf("company %s not found", companyID)
	}
	return &BotProfile{CompanyName: row.Name, Language: NormalizeBotLanguage(row.BotLanguage), SystemPrompt: row.SystemPrompt}, nil
}

// GetBotLanguage returns "en" or "fr" for a company (French when unknown).
func (d *DatabaseService) GetBotLanguage(companyID string) string {
	if d == nil || d.db == nil || companyID == "" {
		return "fr"
	}
	var lang string
	if err := d.db.Raw(`SELECT COALESCE(bot_language, 'fr') FROM companies WHERE id = ?`, companyID).Scan(&lang).Error; err != nil {
		return "fr"
	}
	return NormalizeBotLanguage(lang)
}

// GetCompanyBehavior returns the assistant on/off switches of a company.
func (d *DatabaseService) GetCompanyBehavior(companyID string) BotBehavior {
	if d == nil || d.db == nil || companyID == "" {
		return DefaultBotBehavior()
	}
	settings, err := d.GetCompanySettings(companyID)
	if err != nil {
		return DefaultBotBehavior()
	}
	return BehaviorFromSettings(settings)
}

// GetCompanyCoverage lists the active claim types of a company with their
// active fields (information, photos and documents) in display order.
func (d *DatabaseService) GetCompanyCoverage(companyID string) ([]CoverageInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("database not available")
	}
	var rows []struct {
		TypeName    string
		DisplayName string
		FieldName   *string
		FieldLabel  *string
		FieldType   *string
		IsRequired  *bool
	}
	query := `
		SELECT ct.type_name AS type_name, ct.display_name AS display_name,
		       cf.field_name AS field_name, cf.display_name AS field_label,
		       cf.field_type AS field_type, cf.is_required AS is_required
		FROM claim_types ct
		LEFT JOIN claim_fields cf ON cf.claim_type_id = ct.id AND cf.is_active = true
		WHERE ct.company_id = ? AND ct.is_active = true
		ORDER BY ct.sort_order, ct.type_name, cf.sort_order, cf.field_name
	`
	if err := d.db.Raw(query, companyID).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("failed to load coverage: %w", err)
	}
	var coverage []CoverageInfo
	for _, r := range rows {
		if len(coverage) == 0 || coverage[len(coverage)-1].TypeName != r.TypeName {
			coverage = append(coverage, CoverageInfo{TypeName: r.TypeName, DisplayName: r.DisplayName})
		}
		if r.FieldName == nil {
			continue
		}
		f := CoverageField{Name: *r.FieldName}
		if r.FieldLabel != nil {
			f.Label = *r.FieldLabel
		}
		if r.FieldType != nil {
			f.Type = *r.FieldType
		}
		if r.IsRequired != nil {
			f.Required = *r.IsRequired
		}
		coverage[len(coverage)-1].Fields = append(coverage[len(coverage)-1].Fields, f)
	}
	return coverage, nil
}
