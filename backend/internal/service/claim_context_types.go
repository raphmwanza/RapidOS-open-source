package service

// Types persisted in conversation claim contexts (dynamic claim types).

// DetectionResult represents the result of claim type detection
type DetectionResult struct {
	DetectedType         *ClaimTypeInfo `json:"detectedType"`
	ConfidenceScore      float64        `json:"confidenceScore"`
	DetectionFactors     []string       `json:"detectionFactors"`
	SuggestedFields      []FieldValue   `json:"suggestedFields"`
	RequiresConfirmation bool           `json:"requiresConfirmation"`
	FallbackQuestions    []string       `json:"fallbackQuestions"`
}

// ClaimTypeInfo represents a claim type configuration
type ClaimTypeInfo struct {
	ID                   string   `json:"id"`
	TypeName             string   `json:"typeName"`
	DisplayName          string   `json:"displayName"`
	Description          string   `json:"description"`
	DetectionKeywords    []string `json:"detectionKeywords"`
	ConfidenceThreshold  float64  `json:"confidenceThreshold"`
	RequiresConfirmation bool     `json:"requiresConfirmation"`
}

// FieldInfo represents a dynamic claim field configuration
type FieldInfo struct {
	ID                   string                 `json:"id"`
	FieldName            string                 `json:"fieldName"`
	DisplayName          string                 `json:"displayName"`
	FieldType            string                 `json:"fieldType"`
	IsRequired           bool                   `json:"isRequired"`
	IsSensitive          bool                   `json:"isSensitive"`
	ValidationRules      map[string]interface{} `json:"validationRules,omitempty"`
	DefaultValue         string                 `json:"defaultValue,omitempty"`
	HelpText             string                 `json:"helpText,omitempty"`
	PlaceholderText      string                 `json:"placeholderText,omitempty"`
	ExtractionPrompt     string                 `json:"extractionPrompt,omitempty"`
	ConfirmationRequired bool                   `json:"confirmationRequired"`
}

// FieldValue represents an extracted or confirmed field value
type FieldValue struct {
	FieldInfo   FieldInfo   `json:"fieldInfo"`
	Value       interface{} `json:"value"`
	Confidence  float64     `json:"confidence"`
	IsConfirmed bool        `json:"isConfirmed"`
	Source      string      `json:"source"` // "auto", "user", "default"
}

// ClaimExtractionResult represents the complete claim data extraction
type ClaimExtractionResult struct {
	ClaimTypeID          string       `json:"claimTypeId"`
	Fields               []FieldValue `json:"fields"`
	CompletionPercentage float64      `json:"completionPercentage"`
	ValidationErrors     []string     `json:"validationErrors"`
	RequiresReview       bool         `json:"requiresReview"`
	NextRequiredFields   []FieldInfo  `json:"nextRequiredFields"`
}

// ConversationClaimContext tracks claim processing state
type ConversationClaimContext struct {
	ConversationID       string                 `json:"conversationId"`
	CurrentDetection     *DetectionResult       `json:"currentDetection,omitempty"`
	ConfirmedClaimType   *ClaimTypeInfo         `json:"confirmedClaimType,omitempty"`
	ExtractedData        *ClaimExtractionResult `json:"extractedData,omitempty"`
	PendingConfirmations []string               `json:"pendingConfirmations,omitempty"`
	ProcessingPhase      string                 `json:"processingPhase"` // "detection", "confirmation", "extraction", "completion"
}
