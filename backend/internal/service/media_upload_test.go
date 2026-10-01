package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rapidos/internal/config"
	"rapidos/internal/logger"
)

var jpegBytes = []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9}

func TestUploadMediaToFrontendUsesInternalKeyAndCompany(t *testing.T) {
	var got struct {
		key, company, phone, customer, pending, filename, partType string
		size                                                       int
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/media/upload" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		got.key = r.Header.Get("X-Internal-API-Key")
		got.company = r.Header.Get("X-Company-ID")
		got.phone = r.Header.Get("X-WhatsApp-Phone")
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Errorf("multipart: %v", err)
		}
		got.customer = r.FormValue("customerId")
		got.pending = r.FormValue("pending")
		f, fh, err := r.FormFile("file")
		if err != nil {
			t.Fatalf("file part: %v", err)
		}
		data, _ := io.ReadAll(f)
		got.size = len(data)
		got.filename = fh.Filename
		got.partType = fh.Header.Get("Content-Type")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "pending": false, "claimNumber": "ACME-1", "documentId": "doc-1", "url": "/api/documents/c/doc-1"})
	}))
	defer srv.Close()

	sk := &SemanticKernelService{cfg: &config.Config{FrontendBaseURL: srv.URL, InternalAPIKey: "internal-secret"}, log: logger.New()}
	res, err := sk.uploadMediaToFrontend(context.Background(), MediaUpload{
		CustomerID: "11111111-1111-1111-1111-111111111111", CompanyID: "22222222-2222-2222-2222-222222222222",
		Phone: "+1 555 0100", Data: jpegBytes, MimeType: "application/octet-stream", Pending: true,
	}, "Uploaded via WhatsApp")
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	if res.ClaimNumber != "ACME-1" || res.DocumentID != "doc-1" {
		t.Fatalf("unexpected result %+v", res)
	}
	if got.key != "internal-secret" || got.company != "22222222-2222-2222-2222-222222222222" || got.phone != "15550100" {
		t.Fatalf("internal headers not sent: %+v", got)
	}
	if got.customer != "11111111-1111-1111-1111-111111111111" || got.pending != "true" {
		t.Fatalf("form fields: %+v", got)
	}
	if got.partType != "image/jpeg" || !strings.HasPrefix(got.filename, "whatsapp-") || !strings.HasSuffix(got.filename, ".jpg") || got.size != len(jpegBytes) {
		t.Fatalf("file part: %+v", got)
	}
}

func TestUploadMediaToFrontendNeedsInternalKey(t *testing.T) {
	sk := &SemanticKernelService{cfg: &config.Config{FrontendBaseURL: "http://127.0.0.1:1"}, log: logger.New()}
	if _, err := sk.uploadMediaToFrontend(context.Background(), MediaUpload{CustomerID: "c", CompanyID: "k", Data: jpegBytes}, ""); err == nil {
		t.Fatal("expected an error without INTERNAL_API_KEY")
	}
}

func TestUploadMediaReportsDashboardRejection(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"Customer not found in this company"}`, http.StatusForbidden)
	}))
	defer srv.Close()
	sk := &SemanticKernelService{cfg: &config.Config{FrontendBaseURL: srv.URL, InternalAPIKey: "k"}, log: logger.New()}
	resp := sk.HandlePhotoMessage(context.Background(), MediaUpload{CustomerID: "c", CompanyID: "k", Lang: "fr", Data: jpegBytes})
	if resp.Intent != "photo_error" {
		t.Fatalf("expected photo_error, got %q", resp.Intent)
	}
}

func TestMediaFileNameAndType(t *testing.T) {
	now := time.Date(2026, 9, 30, 21, 15, 0, 0, time.UTC)
	if got := mediaFileName("", "image/jpeg", now); got != "whatsapp-20260930-211500.jpg" {
		t.Fatalf("generated name %q", got)
	}
	if got := mediaFileName(`..\evil/"constat".pdf`, "application/pdf", now); got != "constat.pdf" {
		t.Fatalf("sanitized name %q", got)
	}
	if got := mediaMimeType(jpegBytes, "application/pdf"); got != "image/jpeg" {
		t.Fatalf("bytes should win over the declared type, got %q", got)
	}
	if got := mediaMimeType([]byte("PK\x03\x04rest"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); !strings.Contains(got, "wordprocessingml") {
		t.Fatalf("docx type %q", got)
	}
}

func TestDownloadMediaUsesConfiguredGraphBase(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer wa-token" {
			http.Error(w, "no auth", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/v99/MEDIA123":
			_ = json.NewEncoder(w).Encode(map[string]string{"url": srv.URL + "/files/MEDIA123", "mime_type": "image/jpeg"})
		case "/files/MEDIA123":
			_, _ = w.Write(jpegBytes)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	w := NewWhatsAppService(&config.Config{WhatsAppToken: "wa-token", WhatsAppGraphAPIBase: srv.URL + "/v99/"}, logger.New())
	data, mime, err := w.DownloadMedia("MEDIA123")
	if err != nil {
		t.Fatalf("download: %v", err)
	}
	if mime != "image/jpeg" || len(data) != len(jpegBytes) {
		t.Fatalf("got %s, %d bytes", mime, len(data))
	}
}

func TestGraphAPIBaseDefault(t *testing.T) {
	if got := (&config.Config{}).GraphAPIBase(); got != config.DefaultWhatsAppGraphAPIBase {
		t.Fatalf("default graph base %q", got)
	}
}

func TestClaimPayloadCarriesLanguage(t *testing.T) {
	p := BuildClaimPayload(ClaimCreateRequest{WhatsAppPhone: "15550100", Language: "FR", Draft: &ClaimDraft{Fields: map[string]interface{}{"insuredFullName": "Jean Dupont"}}})
	if p["language"] != "fr" {
		t.Fatalf("language = %v", p["language"])
	}
}
