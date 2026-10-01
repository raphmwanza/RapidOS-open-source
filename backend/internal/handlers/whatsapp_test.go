package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"fmt"
	"testing"

	"rapidos/internal/service"
)

func TestVerifyWebhookSignature(t *testing.T) {
	body := []byte(`{"entry":[]}`)
	mac := hmac.New(sha256.New, []byte("tenant-secret"))
	_, _ = mac.Write(body)
	signature := "sha256=" + fmt.Sprintf("%x", mac.Sum(nil))
	if !verifyWebhookSignature(body, signature, "tenant-secret") {
		t.Fatal("expected valid signature")
	}
	if verifyWebhookSignature(body, signature, "another-secret") {
		t.Fatal("accepted signature for another tenant")
	}
	if verifyWebhookSignature(body, "sha256=bad", "tenant-secret") {
		t.Fatal("accepted malformed digest")
	}
}

func TestWebhookPhoneNumberID(t *testing.T) {
	webhook := service.WhatsAppWebhook{Entry: []service.WebhookEntry{{Changes: []service.WebhookChange{{Value: service.WhatsAppValue{Metadata: service.WhatsAppMetadata{PhoneNumberID: "phone-id-a"}}}}}}}
	if got := webhookPhoneNumberID(webhook); got != "phone-id-a" {
		t.Fatalf("tenant lookup id = %q", got)
	}
}
