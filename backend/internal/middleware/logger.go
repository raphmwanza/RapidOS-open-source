package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"rapidos/internal/logger"

	"github.com/gin-gonic/gin"
)

// CorrelationIDKey is the context key for correlation ID
const CorrelationIDKey = "correlation_id"

// generateCorrelationID creates a unique correlation ID
func generateCorrelationID() string {
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// GetCorrelationID retrieves the correlation ID from context
func GetCorrelationID(c *gin.Context) string {
	if id, exists := c.Get(CorrelationIDKey); exists {
		return id.(string)
	}
	return ""
}

// RequestLogger logs all HTTP requests with correlation IDs
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		// Get or generate correlation ID
		correlationID := c.GetHeader("X-Correlation-ID")
		if correlationID == "" {
			correlationID = generateCorrelationID()
		}

		// Set correlation ID in context and response header
		c.Set(CorrelationIDKey, correlationID)
		c.Writer.Header().Set("X-Correlation-ID", correlationID)

		// Process request
		c.Next()

		// Log the request
		latency := time.Since(start)
		status := c.Writer.Status()
		method := c.Request.Method
		path := c.Request.URL.Path

		c.Writer.Header().Set("X-Response-Time", latency.String())

		logFields := map[string]interface{}{
			"correlation_id": correlationID,
			"method":         method,
			"path":           path,
			"status":         status,
			"latency_ms":     latency.Milliseconds(),
			"client_ip":      c.ClientIP(),
			"user_agent":     c.Request.UserAgent(),
		}

		if status >= 500 {
			logger.Error("Request completed with error", logFields)
		} else if status >= 400 {
			logger.Warn("Request completed with client error", logFields)
		} else {
			logger.Info("Request completed", logFields)
		}
	}
}
