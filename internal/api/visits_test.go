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
	"github.com/webaccessibility/server/internal/visits"
	"go.uber.org/zap"
)

func setupTestVisitRouter(t *testing.T, storePath string) (*chiRouterWrapper, *visits.Store) {
	t.Setenv("FRONTEND_DIR", "../../frontend")
	logger := zap.NewNop()

	var store *visits.Store
	if storePath != "" {
		store = visits.NewStore(storePath)
	}

	h := &Handler{
		Logger:     logger,
		VisitStore: store,
	}

	r := NewRouter(h, logger)
	return &chiRouterWrapper{Handler: r}, store
}

func TestCaptureVisit_Disabled(t *testing.T) {
	config.SetVisitTrackingEnabled(false)
	router, _ := setupTestVisitRouter(t, "")

	body, _ := json.Marshal(CaptureVisitReq{
		Email: "test@example.com",
	})

	req := httptest.NewRequest("POST", "/api/v1/visit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 Not Found when disabled, got %d", w.Code)
	}
}

func TestCaptureVisit_Valid(t *testing.T) {
	config.SetVisitTrackingEnabled(true)
	defer config.SetVisitTrackingEnabled(false)

	tempDir := t.TempDir()
	storePath := filepath.Join(tempDir, "visits.jsonl")

	router, _ := setupTestVisitRouter(t, storePath)

	body, _ := json.Marshal(CaptureVisitReq{
		Email: "returning_user@example.com",
	})

	req := httptest.NewRequest("POST", "/api/v1/visit", bytes.NewReader(body))
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

	// Verify visit was written to disk
	content, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatalf("failed to read visit file: %v", err)
	}
	if !bytes.Contains(content, []byte("returning_user@example.com")) {
		t.Errorf("expected file to contain visit email, got: %s", string(content))
	}
}

func TestCaptureVisit_InvalidEmailSilently200(t *testing.T) {
	config.SetVisitTrackingEnabled(true)
	defer config.SetVisitTrackingEnabled(false)

	tempDir := t.TempDir()
	storePath := filepath.Join(tempDir, "visits.jsonl")

	router, _ := setupTestVisitRouter(t, storePath)

	// Malformed email: should silently return 200 to prevent frontend retry loop, but NOT write to disk
	body, _ := json.Marshal(CaptureVisitReq{
		Email: "not-an-email",
	})

	req := httptest.NewRequest("POST", "/api/v1/visit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 OK for malformed email, got %d", w.Code)
	}

	// Store file should not exist or be empty
	if _, err := os.Stat(storePath); !os.IsNotExist(err) {
		content, _ := os.ReadFile(storePath)
		if len(content) > 0 {
			t.Errorf("expected store to not contain invalid email, got: %s", string(content))
		}
	}
}

func TestCaptureVisit_MalformedJSONSilently200(t *testing.T) {
	config.SetVisitTrackingEnabled(true)
	defer config.SetVisitTrackingEnabled(false)

	router, _ := setupTestVisitRouter(t, "")

	req := httptest.NewRequest("POST", "/api/v1/visit", bytes.NewReader([]byte("{invalid-json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 OK for malformed JSON, got %d", w.Code)
	}
}
