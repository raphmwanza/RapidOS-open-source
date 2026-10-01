package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"testing"
)

// encryptLikeDashboard reproduces lib/encryption.ts (v1.iv.tag.ciphertext).
func encryptLikeDashboard(t *testing.T, key []byte, plaintext string) string {
	t.Helper()
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	iv := make([]byte, 12)
	if _, err := rand.Read(iv); err != nil {
		t.Fatal(err)
	}
	sealed := gcm.Seal(nil, iv, []byte(plaintext), nil)
	payload, tag := sealed[:len(sealed)-16], sealed[len(sealed)-16:]
	return strings.Join([]string{"v1", base64.StdEncoding.EncodeToString(iv), base64.StdEncoding.EncodeToString(tag), base64.StdEncoding.EncodeToString(payload)}, ".")
}

func TestDecryptIntegrationSecretAcceptsBase64AndHexKeys(t *testing.T) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	for name, env := range map[string]string{"base64": base64.StdEncoding.EncodeToString(key), "hex": hex.EncodeToString(key)} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("ENCRYPTION_KEY", env)
			value := encryptLikeDashboard(t, key, "verify-token-123")
			got, err := decryptIntegrationSecret(value)
			if err != nil || got != "verify-token-123" {
				t.Fatalf("decrypt = %q, %v", got, err)
			}
		})
	}
}

func TestDecryptIntegrationSecretRejectsBadInput(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "short")
	if _, err := decryptIntegrationSecret("v1.a.b.c"); err == nil {
		t.Fatal("expected an error for an invalid key")
	}
	if _, err := decryptIntegrationSecret("not-encrypted"); err == nil {
		t.Fatal("expected an error for a malformed value")
	}
}
