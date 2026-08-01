package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/webaccessibility/server/internal/config"
	"github.com/webaccessibility/server/internal/leads"
	"go.uber.org/zap"
)

func setupTestRouter(t *testing.T, storePath string) (*chiRouterWrapper, *leads.Store) {
	t.Setenv("FRONTEND_DIR", "../../frontend")
	logger := zap.NewNop()

	var store *leads.Store
	if storePath != "" {
		store = leads.NewStore(storePath)
	}

	h := &Handler{
		Logger:    logger,
		LeadStore: store,
	}

	r := NewRouter(h, logger)
	return &chiRouterWrapper{Handler: r}, store
}

type chiRouterWrapper struct {
	http.Handler
}

func TestCaptureLead_Disabled(t *testing.T) {
	config.SetLeadCaptureEnabled(false)
	router, _ := setupTestRouter(t, "")

	body, _ := json.Marshal(CaptureLeadReq{
		Email:   "test@example.com",
		Source:  "scan_cta",
		Consent: true,
	})

	req := httptest.NewRequest("POST", "/api/v1/leads", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 Not Found when disabled, got %d", w.Code)
	}
}

func TestCaptureLead_Valid(t *testing.T) {
	config.SetLeadCaptureEnabled(true)
	defer config.SetLeadCaptureEnabled(false)

	tempDir := t.TempDir()
	storePath := filepath.Join(tempDir, "leads.jsonl")

	router, _ := setupTestRouter(t, storePath)

	body, _ := json.Marshal(CaptureLeadReq{
		Email:   "lead@example.com",
		Source:  "scan_cta",
		Consent: true,
	})

	req := httptest.NewRequest("POST", "/api/v1/leads", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 OK, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp map[string]bool
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || !resp["ok"] {
		t.Errorf("expected ok: true in response, got %s", w.Body.String())
	}

	// Verify lead was written to disk
	content, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatalf("failed to read lead file: %v", err)
	}
	if !bytes.Contains(content, []byte("lead@example.com")) {
		t.Errorf("expected file to contain lead email, got: %s", string(content))
	}
}

func TestCaptureLead_InvalidEmail(t *testing.T) {
	config.SetLeadCaptureEnabled(true)
	defer config.SetLeadCaptureEnabled(false)

	router, _ := setupTestRouter(t, "")

	body, _ := json.Marshal(CaptureLeadReq{
		Email:   "invalid-email-address",
		Source:  "scan_cta",
		Consent: true,
	})

	req := httptest.NewRequest("POST", "/api/v1/leads", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request for invalid email, got %d", w.Code)
	}
}

func TestCaptureLead_NoConsent(t *testing.T) {
	config.SetLeadCaptureEnabled(true)
	defer config.SetLeadCaptureEnabled(false)

	router, _ := setupTestRouter(t, "")

	body, _ := json.Marshal(CaptureLeadReq{
		Email:   "test@example.com",
		Source:  "scan_cta",
		Consent: false,
	})

	req := httptest.NewRequest("POST", "/api/v1/leads", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request when consent is false, got %d", w.Code)
	}
}

func TestCaptureLead_Honeypot(t *testing.T) {
	config.SetLeadCaptureEnabled(true)
	defer config.SetLeadCaptureEnabled(false)

	tempDir := t.TempDir()
	storePath := filepath.Join(tempDir, "leads.jsonl")

	router, _ := setupTestRouter(t, storePath)

	body, _ := json.Marshal(CaptureLeadReq{
		Email:   "spammer@example.com",
		Source:  "scan_cta",
		Consent: true,
		Website: "http://spam-link.com", // honeypot filled by bot
	})

	req := httptest.NewRequest("POST", "/api/v1/leads", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// Should return 200 OK to deceive bot
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 OK for honeypot, got %d", w.Code)
	}

	// But file should NOT exist or be empty
	if _, err := os.Stat(storePath); !os.IsNotExist(err) {
		content, _ := os.ReadFile(storePath)
		if len(content) > 0 {
			t.Errorf("expected lead file to NOT be written for honeypot, but got: %s", string(content))
		}
	}
}
