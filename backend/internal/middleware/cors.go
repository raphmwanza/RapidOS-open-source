package middleware

import (
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

func CORSMiddleware(allowedOrigins []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		// Check if origin is in allowed list
		allowedOrigin := ""
		// Entries may be full origins (http://localhost:3000) or bare hosts
		// (app.example.com, matched on http and https).
		for _, allowed := range allowedOrigins {
			allowed = strings.TrimRight(allowed, "/")
			if allowed == "" || origin == "" {
				continue
			}
			if origin == allowed || origin == "http://"+allowed || origin == "https://"+allowed {
				allowedOrigin = origin
				break
			}
		}

		// Also allow FRONTEND_BASE_URL if set
		if allowedOrigin == "" {
			if frontendURL := os.Getenv("FRONTEND_BASE_URL"); frontendURL != "" {
				if origin == frontendURL {
					allowedOrigin = origin
				}
			}
		}

		// Allow any *.vercel.app origin for preview deployments
		if allowedOrigin == "" && strings.HasSuffix(origin, ".vercel.app") {
			allowedOrigin = origin
		}

		// Set CORS headers with proper origin validation
		if allowedOrigin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		} else {
			// For localhost development, allow localhost origins
			if origin == "http://localhost:3000" || origin == "https://localhost:3000" {
				c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			}
		}

		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Company-ID")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
		c.Writer.Header().Set("Access-Control-Max-Age", "86400")

		// Handle preflight requests
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}
