package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCORSAllowedOrigins(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CORSMiddleware([]string{"http://localhost:3000", "app.example.com"}))
	r.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

	cases := map[string]bool{
		"http://localhost:3000":   true,
		"https://app.example.com": true,
		"http://app.example.com":  true,
		"https://evil.example":    false,
	}
	for origin, want := range cases {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		req.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		got := w.Header().Get("Access-Control-Allow-Origin") == origin
		if got != want {
			t.Errorf("origin %s: allowed=%v want %v", origin, got, want)
		}
	}
}
