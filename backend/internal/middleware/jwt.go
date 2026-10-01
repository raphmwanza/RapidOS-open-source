package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// JWTClaims represents the claims in our JWT tokens
type JWTClaims struct {
	AdminID   string `json:"adminId"`
	Role      string `json:"role"`
	CompanyID string `json:"companyId"`
	// TokenVersion ("tv") and SessionID ("sid") are set by the dashboard login.
	TokenVersion int    `json:"tv"`
	SessionID    string `json:"sid"`
	jwt.RegisteredClaims
}

// JWTAuth creates middleware that validates JWT tokens from Authorization header
// It extracts admin info and adds it to the context for downstream handlers.
// With a SessionStore, the token must also belong to the account's current
// session (see session.go): a newer login, a password reset or a deactivation
// makes older tokens fail with 401.
func JWTAuth(accessSecret string, sessions ...SessionStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Authorization header required",
			})
			return
		}

		// Expect "Bearer <token>" format
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid authorization header format. Expected: Bearer <token>",
			})
			return
		}

		tokenString := parts[1]

		// Parse and validate token
		token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
			// Validate signing method
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(accessSecret), nil
		})

		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid or expired token",
			})
			return
		}

		claims, ok := token.Claims.(*JWTClaims)
		if !ok || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid token claims",
			})
			return
		}

		// Validate required claims
		if claims.AdminID == "" || claims.CompanyID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid token: missing required claims",
			})
			return
		}

		for _, store := range sessions {
			if store == nil {
				continue
			}
			state, err := store.AdminSession(c.Request.Context(), claims.AdminID)
			if err != nil {
				c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "Session check failed"})
				return
			}
			if code := CheckSession(claims, state); code != SessionOK {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": SessionMessage(code), "code": code})
				return
			}
		}

		// Add admin info to context for downstream handlers
		c.Set("adminId", claims.AdminID)
		c.Set("role", claims.Role)
		c.Set("companyId", claims.CompanyID)

		c.Next()
	}
}

// OptionalJWTAuth creates middleware that extracts JWT if present but doesn't require it
// Useful for routes that can work with or without authentication
func OptionalJWTAuth(accessSecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.Next()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			c.Next()
			return
		}

		tokenString := parts[1]

		token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(accessSecret), nil
		})

		if err != nil || !token.Valid {
			c.Next()
			return
		}

		claims, ok := token.Claims.(*JWTClaims)
		if ok && claims.AdminID != "" && claims.CompanyID != "" {
			c.Set("adminId", claims.AdminID)
			c.Set("role", claims.Role)
			c.Set("companyId", claims.CompanyID)
		}

		c.Next()
	}
}

// RequireRole creates middleware that checks if the user has a specific role
// Must be used after JWTAuth middleware
func RequireRole(requiredRoles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		role, exists := c.Get("role")
		if !exists {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "Access denied: no role found",
			})
			return
		}

		roleStr, ok := role.(string)
		if !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "Access denied: invalid role",
			})
			return
		}

		// Check if user's role is in the allowed roles
		for _, r := range requiredRoles {
			if roleStr == r {
				c.Next()
				return
			}
		}

		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"error": "Access denied: insufficient permissions",
		})
	}
}
