package middleware

import (
	"strings"
	"github.com/gin-gonic/gin"
)

// Extracts company domain from email if present (for simple demo)
func TenantFromEmail() gin.HandlerFunc { return func(c *gin.Context){ email := c.GetHeader("X-Admin-Email"); if email != "" { parts := strings.Split(email, "@"); if len(parts)==2 { c.Set("tenant_domain", parts[1]) } }; c.Next() } }
