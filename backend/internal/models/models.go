package models

import "time"

type Company struct {
	ID                  string    `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	Name                string    `gorm:"uniqueIndex"`
	Slug                string    `gorm:"uniqueIndex"`
	Domain              string    `gorm:"uniqueIndex"`
	Schema              string    `gorm:"uniqueIndex"`
	IsActive            bool      `gorm:"default:true"`
	CreatedAt           time.Time `gorm:"autoCreateTime"`
	UpdatedAt           time.Time `gorm:"autoUpdateTime"`
	Admins              []Admin
	Customers           []Customer
	Conversations       []Conversation
	ChatbotConfig       *ChatbotConfig
	Claims              []Claim
	Settings            []Setting
	IntegrationSettings *IntegrationSettings
}

// IntegrationSettings contains ciphertext only; decryption is intentionally
// performed at the service boundary and plaintext is never logged.
type IntegrationSettings struct {
	ID                        string    `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	CompanyID                 string    `gorm:"column:company_id;type:uuid;uniqueIndex"`
	WhatsAppDisplayNumber     *string   `gorm:"column:whatsapp_display_number"`
	WhatsAppPhoneNumberID     *string   `gorm:"column:whatsapp_phone_number_id"`
	WhatsAppAccessTokenCipher *string   `gorm:"column:whatsapp_access_token_cipher;type:text"`
	MetaAppSecretCipher       *string   `gorm:"column:meta_app_secret_cipher;type:text"`
	WebhookVerifyTokenCipher  *string   `gorm:"column:webhook_verify_token_cipher;type:text"`
	WhatsAppBusinessAccountID *string   `gorm:"column:whatsapp_business_account_id"`
	LLMProvider               *string   `gorm:"column:llm_provider"`
	LLMAPIKeyCipher           *string   `gorm:"column:llm_api_key_cipher;type:text"`
	LLMModel                  *string   `gorm:"column:llm_model"`
	LLMBaseURL                *string   `gorm:"column:llm_base_url"`
	CreatedAt                 time.Time `gorm:"column:created_at"`
	UpdatedAt                 time.Time `gorm:"column:updated_at"`
}

func (IntegrationSettings) TableName() string { return "integration_settings" }

type Admin struct {
	ID             string `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	Email          string `gorm:"uniqueIndex"`
	FirstName      string
	LastName       string
	PasswordHash   string
	Role           string `gorm:"type:varchar(20);default:ADMIN"`
	IsActive       bool   `gorm:"default:true"`
	LastLoginAt    *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
	CompanyID      string `gorm:"column:companyId;type:uuid;index"`
	Company        Company
	RefreshTokens  []RefreshToken
	AuditLogs      []AuditLog
	AssignedClaims []Claim `gorm:"foreignKey:AssignedAdminID"`
	CreatedAgents  []Admin `gorm:"foreignKey:CreatedByID"`
	CreatedByID    *string `gorm:"type:uuid"`
	CreatedBy      *Admin  `gorm:"foreignKey:CreatedByID"`
}

// AdminPermissions is DEPRECATED and unused: access is decided by Admin.Role
// (see lib/users/roles.ts in the dashboard). The table is kept only so existing
// databases need no destructive migration.
type AdminPermissions struct {
	ID                 string `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	AdminID            string `gorm:"type:uuid;uniqueIndex"`
	Admin              Admin
	CanViewClaims      bool `gorm:"default:true"`
	CanCreateClaims    bool `gorm:"default:true"`
	CanEditClaims      bool `gorm:"default:true"`
	CanApproveClaims   bool `gorm:"default:false"`
	CanRejectClaims    bool `gorm:"default:false"`
	CanDeleteClaims    bool `gorm:"default:false"`
	CanViewCustomers   bool `gorm:"default:true"`
	CanEditCustomers   bool `gorm:"default:true"`
	CanDeleteCustomers bool `gorm:"default:false"`
	CanCreateAdmins    bool `gorm:"default:false"`
	CanEditAdmins      bool `gorm:"default:false"`
	CanDeleteAdmins    bool `gorm:"default:false"`
	CanCreateBills     bool `gorm:"default:false"`
	CanProcessRefunds  bool `gorm:"default:false"`
	CanViewFinancials  bool `gorm:"default:false"`
	CanViewAnalytics   bool `gorm:"default:true"`
	CanExportData      bool `gorm:"default:false"`
	CanManageSettings  bool `gorm:"default:false"`
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type Customer struct {
	ID            string `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	PhoneNumber   string `gorm:"index"`
	FirstName     *string
	LastName      *string
	Email         *string
	PolicyNumber  *string   `gorm:"column:policy_number"`
	IsActive      bool      `gorm:"default:true"`
	CreatedAt     time.Time `gorm:"autoCreateTime"`
	UpdatedAt     time.Time `gorm:"autoUpdateTime"`
	CompanyID     string    `gorm:"column:companyId;type:uuid;index"`
	Company       Company
	Conversations []Conversation
	Claims        []Claim
}

type Conversation struct {
	ID         string `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	Title      *string
	IsActive   bool       `gorm:"default:true"`
	Mode       string     `gorm:"type:varchar(30);default:'general'"` // "general", "claim_filing"
	ModeSetAt  *time.Time `gorm:"type:timestamptz"`
	CreatedAt  time.Time
	UpdatedAt  time.Time
	CompanyID  string `gorm:"column:companyId;type:uuid;index"`
	Company    Company
	CustomerID string `gorm:"type:uuid;index"`
	Customer   Customer
	Messages   []Message
}

type Message struct {
	ID             string `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	Content        string
	Role           string    `gorm:"type:varchar(20)"`
	Metadata       []byte    `gorm:"type:jsonb"`
	CreatedAt      time.Time `gorm:"autoCreateTime"`
	ConversationID string    `gorm:"type:uuid;index"`
}

type ChatbotConfig struct {
	ID             string  `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	WelcomeMessage string  `gorm:"default:'Hello! How can I help you today?'"`
	MaxTokens      int     `gorm:"default:150"`
	Temperature    float32 `gorm:"default:0.7"`
	Model          string  `gorm:"default:'gpt-3.5-turbo'"`
	SystemPrompt   string  `gorm:"default:'You are a helpful insurance assistant.'"`
	IsActive       bool    `gorm:"default:true"`
	CreatedAt      time.Time
	UpdatedAt      time.Time
	CompanyID      string `gorm:"column:companyId;type:uuid;uniqueIndex"`
}

type RefreshToken struct {
	ID        string    `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	Token     string    `gorm:"uniqueIndex"`
	ExpiresAt time.Time `gorm:"index"`
	IsRevoked bool      `gorm:"default:false"`
	CreatedAt time.Time
	AdminID   string `gorm:"type:uuid;index"`
}

type AuditLog struct {
	ID         string `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	Action     string `gorm:"index"`
	Resource   string
	ResourceID *string
	OldValues  []byte `gorm:"type:jsonb"`
	NewValues  []byte `gorm:"type:jsonb"`
	IPAddress  *string
	UserAgent  *string
	CreatedAt  time.Time
	AdminID    string `gorm:"type:uuid;index"`
}

// Claims Management
type Claim struct {
	ID              string `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	ClaimNumber     string `gorm:"uniqueIndex"`
	Type            string `gorm:"type:varchar(20);default:AUTO"`
	Status          string `gorm:"type:varchar(20);default:NEW"`
	CustomerID      string `gorm:"type:uuid;index"`
	Customer        Customer
	IncidentDate    time.Time
	IncidentTime    *string
	Description     string   `gorm:"type:text"`
	Notes           *string  `gorm:"type:text"`
	BotNotes        *string  `gorm:"type:text"`
	EstimatedAmount *float64 `gorm:"type:decimal(10,2)"`
	ApprovedAmount  *float64 `gorm:"type:decimal(10,2)"`
	PDFPath         *string
	AssignedAdminID *string `gorm:"type:uuid"`
	AssignedAdmin   *Admin  `gorm:"foreignKey:AssignedAdminID"`
	CreatedAt       time.Time
	UpdatedAt       time.Time
	ApprovedAt      *time.Time
	RejectedAt      *time.Time
	CompletedAt     *time.Time
	CompanyID       string `gorm:"column:companyId;type:uuid;index"`
	Company         Company
	AutoClaimData   *AutoClaimData
	Documents       []ClaimDocument
	StatusHistory   []ClaimStatusHistory
}

// Auto insurance claim data.
type AutoClaimData struct {
	ID                       string `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	ClaimID                  string `gorm:"type:uuid;uniqueIndex"`
	Claim                    Claim
	PolicyNumber             string
	InsuredFullName          string
	PhoneNumber              string
	Address                  string `gorm:"type:text"`
	Email                    *string
	BirthDate                time.Time
	LicenseNumber            string
	VehicleMakeModel         string
	VehicleYear              int
	VehicleRegistration      string
	VehicleVin               string
	VehicleColor             string
	IncidentLocation         string `gorm:"type:text"`
	WeatherConditions        string
	RoadType                 *string
	OtherDriverName          *string
	OtherDriverPhone         *string
	OtherInsuranceCompany    *string
	OtherPolicyNumber        *string
	OtherVehicleRegistration *string
	WitnessName              *string
	WitnessPhone             *string
	PoliceContacted          string `gorm:"default:'false'"`
	PoliceReportNumber       *string
	DamageDescription        string `gorm:"type:text"`
	EstimatedRepairCost      *string
	InjuriesOccurred         string  `gorm:"default:'false'"`
	InjuryDescription        *string `gorm:"type:text"`
	MedicalTreatmentRequired string  `gorm:"default:'false'"`
	AdditionalNotes          *string `gorm:"type:text"`
	TotalPhotosUploaded      int     `gorm:"default:0"`

	// WhatsApp Media Fields
	DamagePhotos         []string `gorm:"type:text[]"`
	VehiclePhotos        []string `gorm:"type:text[]"`
	PoliceReportDocument []string `gorm:"type:text[]"`
	InsuranceCardPhoto   []string `gorm:"type:text[]"`
	DriverLicensePhoto   []string `gorm:"type:text[]"`
	AdditionalDocuments  []string `gorm:"type:text[]"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

type ClaimDocument struct {
	ID         string `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	ClaimID    string `gorm:"type:uuid;index"`
	Claim      Claim
	FileName   string
	FilePath   string
	FileType   string
	FileSize   int
	UploadedBy *string
	CreatedAt  time.Time
}

type ClaimStatusHistory struct {
	ID         string `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	ClaimID    string `gorm:"type:uuid;index"`
	Claim      Claim
	FromStatus *string
	ToStatus   string
	Reason     *string   `gorm:"type:text"`
	ChangedBy  string    `gorm:"type:uuid"`
	ChangedAt  time.Time `gorm:"autoCreateTime"`
}

// Setting represents chatbot configuration settings
type Setting struct {
	ID          string  `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	Name        string  `gorm:"not null"`
	Description string  `gorm:"type:text;not null"`
	Type        string  `gorm:"type:varchar(20);not null;default:'DOCUMENT'"` // DOCUMENT, TEXT, BOOLEAN
	TextValue   *string `gorm:"type:text"`
	DocumentURL *string `gorm:"type:text"`
	BoolValue   *bool
	IsActive    bool      `gorm:"default:true"`
	CompanyID   string    `gorm:"column:companyId;type:uuid;index;not null"`
	Company     Company   `gorm:"foreignKey:CompanyID"`
	CreatedAt   time.Time `gorm:"autoCreateTime"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime"`
	CreatedBy   *string   `gorm:"type:uuid"`
	UpdatedBy   *string   `gorm:"type:uuid"`
}
