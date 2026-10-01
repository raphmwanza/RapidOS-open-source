package auth

import (
	"time"
	"github.com/golang-jwt/jwt/v5"
)

type JWTManager struct {
	AccessSecret  []byte
	RefreshSecret []byte
	AccessTTL     time.Duration
	RefreshTTL    time.Duration
}

func NewJWTManager(accessSecret, refreshSecret, accessTTL, refreshTTL string) (*JWTManager, error) {
	at, err := time.ParseDuration(accessTTL); if err != nil { return nil, err }
	rt, err := time.ParseDuration(refreshTTL); if err != nil { return nil, err }
	return &JWTManager{[]byte(accessSecret), []byte(refreshSecret), at, rt}, nil
}

type Claims struct {
	AdminID string `json:"adminId"`
	Role    string `json:"role"`
	CompanyID string `json:"companyId"`
	jwt.RegisteredClaims
}

func (m *JWTManager) GenerateAccess(adminID, role, companyID string) (string, error) {
	claims := &Claims{AdminID: adminID, Role: role, CompanyID: companyID, RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(m.AccessTTL)), IssuedAt: jwt.NewNumericDate(time.Now())}}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.AccessSecret)
}
