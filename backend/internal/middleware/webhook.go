package middleware

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// WhatsAppSignature creates middleware that validates WhatsApp webhook signatures
// WhatsApp sends a X-Hub-Signature-256 header containing HMAC-SHA256 of the request body
func WhatsAppSignature(appSecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// GET requests (verification challenges) don't have signatures
		if c.Request.Method == http.MethodGet {
			c.Next()
			return
		}

		signature := c.GetHeader("X-Hub-Signature-256")
		if signature == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Missing WhatsApp signature header",
			})
			return
		}

		// Signature format: "sha256=<hex_digest>"
		if !strings.HasPrefix(signature, "sha256=") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid signature format",
			})
			return
		}

		expectedSig := strings.TrimPrefix(signature, "sha256=")

		// Read the request body
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to read request body",
			})
			return
		}

		// Restore the body for downstream handlers
		c.Request.Body = io.NopCloser(bytes.NewBuffer(body))

		// Calculate HMAC-SHA256
		mac := hmac.New(sha256.New, []byte(appSecret))
		mac.Write(body)
		calculatedSig := hex.EncodeToString(mac.Sum(nil))

		// Constant-time comparison to prevent timing attacks
		if !hmac.Equal([]byte(expectedSig), []byte(calculatedSig)) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid webhook signature",
			})
			return
		}

		c.Next()
	}
}

// InternalAPIKey creates middleware that validates internal API keys
// Used for internal service-to-service communication (e.g., Next.js -> Go backend)
func InternalAPIKey(validAPIKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		apiKey := c.GetHeader("X-Internal-API-Key")
		if apiKey == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Missing internal API key",
			})
			return
		}

		// Constant-time comparison to prevent timing attacks
		if !hmac.Equal([]byte(apiKey), []byte(validAPIKey)) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid internal API key",
			})
			return
		}

		c.Next()
	}
}
