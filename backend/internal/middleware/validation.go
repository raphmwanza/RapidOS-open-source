package middleware

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
)

// InputSanitizer provides methods to sanitize and validate user input
type InputSanitizer struct {
	// MaxStringLength is the maximum allowed length for string inputs
	MaxStringLength int
	// MaxArrayLength is the maximum allowed length for array inputs
	MaxArrayLength int
}

// NewInputSanitizer creates a new InputSanitizer with default values
func NewInputSanitizer() *InputSanitizer {
	return &InputSanitizer{
		MaxStringLength: 10000,
		MaxArrayLength:  100,
	}
}

// SanitizeString removes potentially dangerous characters and limits length
func (s *InputSanitizer) SanitizeString(input string, maxLen int) string {
	if maxLen <= 0 {
		maxLen = s.MaxStringLength
	}

	// Remove null bytes
	input = strings.ReplaceAll(input, "\x00", "")

	// Trim whitespace
	input = strings.TrimSpace(input)

	// Limit length
	if len(input) > maxLen {
		input = input[:maxLen]
	}

	return input
}

// ValidatePhoneNumber validates phone number format
func (s *InputSanitizer) ValidatePhoneNumber(phone string) (string, error) {
	// Remove all non-digit characters
	re := regexp.MustCompile(`[^\d+]`)
	cleaned := re.ReplaceAllString(phone, "")

	// Must have at least 8 digits
	digits := regexp.MustCompile(`\d+`)
	allDigits := digits.FindAllString(cleaned, -1)
	totalDigits := 0
	for _, d := range allDigits {
		totalDigits += len(d)
	}

	if totalDigits < 8 {
		return "", fmt.Errorf("phone number must have at least 8 digits")
	}

	if totalDigits > 15 {
		return "", fmt.Errorf("phone number must have at most 15 digits")
	}

	return cleaned, nil
}

// ValidateEmail validates email format (basic validation)
func (s *InputSanitizer) ValidateEmail(email string) (string, error) {
	email = strings.TrimSpace(email)
	email = strings.ToLower(email)

	// Basic email regex
	re := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	if !re.MatchString(email) {
		return "", fmt.Errorf("invalid email format")
	}

	if len(email) > 254 {
		return "", fmt.Errorf("email too long")
	}

	return email, nil
}

// ValidateClaimNumber validates claim number format
func (s *InputSanitizer) ValidateClaimNumber(claimNumber string) (string, error) {
	claimNumber = strings.TrimSpace(claimNumber)
	claimNumber = strings.ToUpper(claimNumber)

	// Allow alphanumeric and dashes
	re := regexp.MustCompile(`^[A-Z0-9\-]{5,50}$`)
	if !re.MatchString(claimNumber) {
		return "", fmt.Errorf("invalid claim number format")
	}

	return claimNumber, nil
}

// ValidateURL validates URL format and ensures it's not a dangerous protocol
func (s *InputSanitizer) ValidateURL(url string) (string, error) {
	url = strings.TrimSpace(url)

	// Check for dangerous protocols
	lowerURL := strings.ToLower(url)
	dangerousProtocols := []string{"javascript:", "data:", "vbscript:", "file:"}
	for _, proto := range dangerousProtocols {
		if strings.HasPrefix(lowerURL, proto) {
			return "", fmt.Errorf("dangerous URL protocol not allowed")
		}
	}

	// Basic URL validation
	if !strings.HasPrefix(lowerURL, "http://") && !strings.HasPrefix(lowerURL, "https://") {
		return "", fmt.Errorf("URL must start with http:// or https://")
	}

	if len(url) > 2048 {
		return "", fmt.Errorf("URL too long")
	}

	return url, nil
}

// DetectSQLInjection checks for common SQL injection patterns
func (s *InputSanitizer) DetectSQLInjection(input string) bool {
	lowerInput := strings.ToLower(input)

	// Common SQL injection patterns
	patterns := []string{
		"' or '1'='1",
		"' or 1=1",
		"'; drop",
		"'; delete",
		"'; insert",
		"'; update",
		"' union select",
		"' and '1'='1",
		"1' or '1'='1",
		"; drop table",
		"; delete from",
		"union select",
		"--",
		"/*",
		"*/",
		"xp_",
		"sp_",
		"exec ",
		"execute ",
	}

	for _, pattern := range patterns {
		if strings.Contains(lowerInput, pattern) {
			return true
		}
	}

	return false
}

// DetectXSS checks for common XSS patterns
func (s *InputSanitizer) DetectXSS(input string) bool {
	lowerInput := strings.ToLower(input)

	// Common XSS patterns
	patterns := []string{
		"<script",
		"</script>",
		"javascript:",
		"onerror=",
		"onload=",
		"onclick=",
		"onmouseover=",
		"onfocus=",
		"onblur=",
		"<iframe",
		"<object",
		"<embed",
		"<img src=\"javascript",
		"<img src='javascript",
		"expression(",
		"vbscript:",
	}

	for _, pattern := range patterns {
		if strings.Contains(lowerInput, pattern) {
			return true
		}
	}

	return false
}

// InputValidation creates middleware that validates and sanitizes common inputs
func InputValidation() gin.HandlerFunc {
	sanitizer := NewInputSanitizer()

	return func(c *gin.Context) {
		// Check query parameters for injection attempts
		for key, values := range c.Request.URL.Query() {
			for _, value := range values {
				if sanitizer.DetectSQLInjection(value) {
					c.AbortWithStatusJSON(400, gin.H{
						"error": fmt.Sprintf("Invalid input detected in query parameter: %s", key),
					})
					return
				}
				if sanitizer.DetectXSS(value) {
					c.AbortWithStatusJSON(400, gin.H{
						"error": fmt.Sprintf("Invalid input detected in query parameter: %s", key),
					})
					return
				}
			}
		}

		// Store sanitizer in context for handlers to use
		c.Set("sanitizer", sanitizer)

		c.Next()
	}
}
