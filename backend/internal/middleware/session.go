package middleware

import (
	"context"
	"database/sql"
	"errors"

	"gorm.io/gorm"
)

// One active session per dashboard account (same rule as lib/sessionPolicy.ts in
// the dashboard): every login stores a new session id in admins.current_session_id
// and in the JWT ("sid"). A token of any other session is rejected, and so is a
// token whose "tv" no longer matches admins.token_version (password reset,
// deactivation, "sign out everywhere").

// AdminSession is the account state a token is checked against.
type AdminSession struct {
	Found            bool
	Active           bool
	TokenVersion     int
	CurrentSessionID string // "" = no login since single sessions were introduced
}

// SessionStore loads the session state of an account.
type SessionStore interface {
	AdminSession(ctx context.Context, adminID string) (AdminSession, error)
}

// Session check results (also the JSON "code" of the 401).
const (
	SessionOK       = ""
	SessionInactive = "account_inactive"
	SessionRevoked  = "session_revoked"
	SessionReplaced = "session_replaced"
)

// CheckSession tells whether a token with these claims may still be used.
func CheckSession(claims *JWTClaims, s AdminSession) string {
	if !s.Found || !s.Active {
		return SessionInactive
	}
	if claims.TokenVersion != s.TokenVersion {
		return SessionRevoked
	}
	if s.CurrentSessionID != "" && claims.SessionID != s.CurrentSessionID {
		return SessionReplaced
	}
	return SessionOK
}

// SessionMessage is the error text sent with each 401 code.
func SessionMessage(code string) string {
	switch code {
	case SessionReplaced:
		return "You were signed out because this account signed in on another device"
	case SessionRevoked:
		return "Session revoked - please sign in again"
	default:
		return "Admin not found or inactive"
	}
}

// GormSessionStore reads the admins table.
type GormSessionStore struct{ DB *gorm.DB }

func NewGormSessionStore(db *gorm.DB) *GormSessionStore { return &GormSessionStore{DB: db} }

func (g *GormSessionStore) AdminSession(ctx context.Context, adminID string) (AdminSession, error) {
	var active bool
	var version int
	var sid sql.NullString
	row := g.DB.WithContext(ctx).Raw(`SELECT is_active, token_version, current_session_id::text FROM admins WHERE id = ?`, adminID).Row()
	if err := row.Scan(&active, &version, &sid); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AdminSession{}, nil
		}
		return AdminSession{}, err
	}
	return AdminSession{Found: true, Active: active, TokenVersion: version, CurrentSessionID: sid.String}, nil
}
