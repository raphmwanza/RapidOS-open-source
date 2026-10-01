package middleware

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestInputValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(InputValidation())
	router.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	tests := []struct {
		name           string
		queryParams    string
		expectedStatus int
	}{
		{
			name:           "Normal query",
			queryParams:    "?name=john&age=25",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "SQL injection attempt",
			queryParams:    "?id=1' OR '1'='1",
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "SQL UNION attempt",
			queryParams:    "?id=1 union select * from users",
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "XSS script tag",
			queryParams:    "?name=<script>alert('xss')</script>",
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "XSS event handler",
			queryParams:    "?name=<img onerror=alert('xss')>",
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "XSS javascript protocol",
			queryParams:    "?url=javascript:alert('xss')",
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Safe HTML entities",
			queryParams:    "?name=John%20Doe&comment=Hello%20World",
			expectedStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, _ := http.NewRequest("GET", "/test"+tt.queryParams, nil)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}
		})
	}
}

func TestInputSanitizer(t *testing.T) {
	sanitizer := NewInputSanitizer()

	t.Run("SanitizeString", func(t *testing.T) {
		tests := []struct {
			input    string
			maxLen   int
			expected string
		}{
			{"  hello world  ", 100, "hello world"},
			{"hello\x00world", 100, "helloworld"},
			{"verylongstring", 5, "veryl"},
		}

		for _, tt := range tests {
			result := sanitizer.SanitizeString(tt.input, tt.maxLen)
			if result != tt.expected {
				t.Errorf("SanitizeString(%q, %d) = %q, want %q", tt.input, tt.maxLen, result, tt.expected)
			}
		}
	})

	t.Run("ValidatePhoneNumber", func(t *testing.T) {
		tests := []struct {
			input     string
			shouldErr bool
		}{
			{"+243812345678", false},
			{"243812345678", false},
			{"12345", true},                // Too short
			{"12345678901234567890", true}, // Too long
		}

		for _, tt := range tests {
			_, err := sanitizer.ValidatePhoneNumber(tt.input)
			hasErr := err != nil
			if hasErr != tt.shouldErr {
				t.Errorf("ValidatePhoneNumber(%q) error = %v, shouldErr = %v", tt.input, err, tt.shouldErr)
			}
		}
	})

	t.Run("ValidateEmail", func(t *testing.T) {
		tests := []struct {
			input     string
			shouldErr bool
		}{
			{"test@example.com", false},
			{"user.name+tag@domain.co.uk", false},
			{"invalid", true},
			{"@nodomain.com", true},
			{"noemail@", true},
		}

		for _, tt := range tests {
			_, err := sanitizer.ValidateEmail(tt.input)
			hasErr := err != nil
			if hasErr != tt.shouldErr {
				t.Errorf("ValidateEmail(%q) error = %v, shouldErr = %v", tt.input, err, tt.shouldErr)
			}
		}
	})

	t.Run("DetectSQLInjection", func(t *testing.T) {
		tests := []struct {
			input    string
			expected bool
		}{
			{"normal text", false},
			{"' OR '1'='1", true},
			{"1; DROP TABLE users", true},
			{"UNION SELECT * FROM users", true},
			{"Hello World!", false},
		}

		for _, tt := range tests {
			result := sanitizer.DetectSQLInjection(tt.input)
			if result != tt.expected {
				t.Errorf("DetectSQLInjection(%q) = %v, want %v", tt.input, result, tt.expected)
			}
		}
	})

	t.Run("DetectXSS", func(t *testing.T) {
		tests := []struct {
			input    string
			expected bool
		}{
			{"normal text", false},
			{"<script>alert('xss')</script>", true},
			{"<img onerror=alert('xss')>", true},
			{"javascript:void(0)", true},
			{"Hello <b>World</b>", false},
		}

		for _, tt := range tests {
			result := sanitizer.DetectXSS(tt.input)
			if result != tt.expected {
				t.Errorf("DetectXSS(%q) = %v, want %v", tt.input, result, tt.expected)
			}
		}
	})
}

func TestJWTAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)

	secret := "test-secret-key-12345"

	router := gin.New()
	router.Use(JWTAuth(secret))
	router.GET("/protected", func(c *gin.Context) {
		adminId, _ := c.Get("adminId")
		c.JSON(http.StatusOK, gin.H{"adminId": adminId})
	})

	t.Run("Missing Authorization header", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/protected", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Errorf("Expected 401, got %d", w.Code)
		}
	})

	t.Run("Invalid Authorization format", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/protected", nil)
		req.Header.Set("Authorization", "InvalidFormat")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Errorf("Expected 401, got %d", w.Code)
		}
	})

	t.Run("Invalid token", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/protected", nil)
		req.Header.Set("Authorization", "Bearer invalid-token")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Errorf("Expected 401, got %d", w.Code)
		}
	})
}

func TestWhatsAppSignature(t *testing.T) {
	gin.SetMode(gin.TestMode)

	appSecret := "test-app-secret"

	router := gin.New()
	router.Use(WhatsAppSignature(appSecret))
	router.POST("/webhook", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	router.GET("/webhook", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "verified"})
	})

	t.Run("GET request passes without signature", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/webhook", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Expected 200 for GET, got %d", w.Code)
		}
	})

	t.Run("POST without signature fails", func(t *testing.T) {
		req, _ := http.NewRequest("POST", "/webhook", bytes.NewBufferString("{}"))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Errorf("Expected 401 for POST without signature, got %d", w.Code)
		}
	})

	t.Run("POST with invalid signature fails", func(t *testing.T) {
		req, _ := http.NewRequest("POST", "/webhook", bytes.NewBufferString("{}"))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Hub-Signature-256", "sha256=invalid")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Errorf("Expected 401 for invalid signature, got %d", w.Code)
		}
	})
}
