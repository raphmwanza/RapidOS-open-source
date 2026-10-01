package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type fakeSessions map[string]AdminSession

func (f fakeSessions) AdminSession(_ context.Context, id string) (AdminSession, error) {
	return f[id], nil
}

func signTestToken(t *testing.T, secret, adminID string, tv int, sid string) string {
	t.Helper()
	claims := &JWTClaims{AdminID: adminID, Role: "SUPER_ADMIN", CompanyID: "company-1", TokenVersion: tv, SessionID: sid,
		RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute))}}
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestCheckSession(t *testing.T) {
	current := AdminSession{Found: true, Active: true, TokenVersion: 2, CurrentSessionID: "sid-new"}
	cases := []struct {
		name   string
		claims JWTClaims
		state  AdminSession
		want   string
	}{
		{"current session", JWTClaims{TokenVersion: 2, SessionID: "sid-new"}, current, SessionOK},
		{"older login of the same account", JWTClaims{TokenVersion: 2, SessionID: "sid-old"}, current, SessionReplaced},
		{"token without sid after a new login", JWTClaims{TokenVersion: 2}, current, SessionReplaced},
		{"no login since single sessions", JWTClaims{TokenVersion: 0}, AdminSession{Found: true, Active: true}, SessionOK},
		{"password reset bumped the version", JWTClaims{TokenVersion: 1, SessionID: "sid-new"}, current, SessionRevoked},
		{"deactivated account", JWTClaims{TokenVersion: 2, SessionID: "sid-new"}, AdminSession{Found: true, Active: false, TokenVersion: 2}, SessionInactive},
		{"deleted account", JWTClaims{}, AdminSession{}, SessionInactive},
	}
	for _, c := range cases {
		if got := CheckSession(&c.claims, c.state); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestJWTAuth_SecondLoginSignsOutTheFirst(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := "test-secret-key-12345"
	store := fakeSessions{"admin-1": {Found: true, Active: true, TokenVersion: 0, CurrentSessionID: "sid-first"}}
	router := gin.New()
	router.Use(JWTAuth(secret, store))
	router.GET("/protected", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	call := func(token string) (int, map[string]string) {
		req, _ := http.NewRequest("GET", "/protected", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		body := map[string]string{}
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		return w.Code, body
	}

	first := signTestToken(t, secret, "admin-1", 0, "sid-first")
	if code, _ := call(first); code != http.StatusOK {
		t.Fatalf("first session before the second login: got %d", code)
	}

	// Second login: the dashboard stores a new current session id.
	store["admin-1"] = AdminSession{Found: true, Active: true, TokenVersion: 0, CurrentSessionID: "sid-second"}
	second := signTestToken(t, secret, "admin-1", 0, "sid-second")

	code, body := call(first)
	if code != http.StatusUnauthorized || body["code"] != SessionReplaced {
		t.Fatalf("first session after the second login: got %d %v", code, body)
	}
	if code, _ := call(second); code != http.StatusOK {
		t.Fatalf("second session: got %d", code)
	}
}
