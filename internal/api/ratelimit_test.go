package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/webaccessibility/server/internal/access"
	"github.com/webaccessibility/server/internal/config"
	"github.com/webaccessibility/server/internal/models"
	"go.uber.org/zap"
)

// The extension posts to /scan/client; it must share the per-IP limit with the web app.
func TestExtensionScanClientIsRateLimited(t *testing.T) {
	secret := "test-jwt-secret-12345"
	config.SetSecret(secret)
	logger := zap.NewNop()
	router := NewRouter(&Handler{Logger: logger}, logger)
	token := helperGenerateToken(secret)

	post := func(ip string) *httptest.ResponseRecorder {
		body := []byte(`{"url":"http://localhost:3000","violations":[],"passes":[],"incomplete":[]}`)
		req := httptest.NewRequest("POST", "/api/v1/scan/client", bytes.NewBuffer(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-Forwarded-For", ip)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}

	for i := 0; i < 60; i++ {
		// Past the 5 free scans these are 403s, which still count toward the rate limit.
		if w := post("203.0.113.7"); w.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d: rate limited too early", i+1)
		}
	}
	w := post("203.0.113.7")
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("61st request: expected 429, got %d", w.Code)
	}
	if w.Header().Get("Retry-After") == "" {
		t.Error("expected Retry-After header on 429")
	}
	var e models.ErrorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &e); err != nil || e.Error == "" {
		t.Errorf("expected JSON error body, got %q", w.Body.String())
	}
	if w := post("198.51.100.9"); w.Code != http.StatusOK {
		t.Errorf("other IP: expected 200, got %d", w.Code)
	}
}

func TestExtensionFreeScanLimit(t *testing.T) {
	config.InitGlobal(&config.Config{JWTSecret: "test-jwt-secret-12345", AccessApprovalEnabled: true, MaxConcurrentScans: 2})
	defer config.InitGlobal(&config.Config{})
	logger := zap.NewNop()
	dir := t.TempDir()
	store, err := access.NewStore(filepath.Join(dir, "access.json"))
	if err != nil {
		t.Fatal(err)
	}
	quotaPath := filepath.Join(dir, "ext.json")
	router := NewRouter(&Handler{Logger: logger, Access: store, ExtQuota: NewExtQuota(quotaPath)}, logger)
	guest := helperGenerateToken("test-jwt-secret-12345")

	post := func(r http.Handler, ip, token string) *httptest.ResponseRecorder {
		body := []byte(`{"url":"http://localhost:3000","violations":[],"passes":[],"incomplete":[]}`)
		req := httptest.NewRequest("POST", "/api/v1/scan/client", bytes.NewBuffer(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-Forwarded-For", ip)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	remaining := func(w *httptest.ResponseRecorder) int {
		var res struct {
			ScansRemaining *int `json:"scans_remaining"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &res)
		if res.ScansRemaining == nil {
			return -1
		}
		return *res.ScansRemaining
	}

	for i := 1; i <= ExtensionFreeScans; i++ {
		w := post(router, "203.0.113.7", guest)
		if w.Code != http.StatusOK || remaining(w) != ExtensionFreeScans-i {
			t.Fatalf("free scan %d: got %d, %d left", i, w.Code, remaining(w))
		}
	}
	if w := post(router, "203.0.113.7", guest); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "free_scans_used") {
		t.Fatalf("scan 6: expected 403 free_scans_used, got %d %s", w.Code, w.Body)
	}
	if w := post(router, "198.51.100.9", guest); w.Code != http.StatusOK {
		t.Errorf("other IP: expected 200, got %d", w.Code)
	}

	// Lifetime cap survives a restart.
	restarted := NewRouter(&Handler{Logger: logger, Access: store, ExtQuota: NewExtQuota(quotaPath)}, logger)
	if w := post(restarted, "203.0.113.7", guest); w.Code != http.StatusForbidden {
		t.Errorf("after restart: expected 403, got %d", w.Code)
	}

	// An approved access code keeps working from the same IP and is counted on the code.
	code, _, err := store.CreateTrial("user@example.com", 2)
	if err != nil || code == "" {
		t.Fatalf("create code: %v", err)
	}
	w := postJSON(t, router, "/api/v1/access/session", map[string]string{"code": code}, "")
	var sess struct{ Token string }
	_ = json.Unmarshal(w.Body.Bytes(), &sess)
	for want := 1; want >= 0; want-- {
		w := post(router, "203.0.113.7", sess.Token)
		if w.Code != http.StatusOK || remaining(w) != want {
			t.Fatalf("code scan: got %d, %d left (want %d)", w.Code, remaining(w), want)
		}
	}
	if w := post(router, "203.0.113.7", sess.Token); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "access_exhausted") {
		t.Fatalf("used-up code: expected 403 access_exhausted, got %d %s", w.Code, w.Body)
	}

	// With access approval switched off, the extension is not capped.
	config.SetAccessApprovalEnabled(false)
	if w := post(router, "203.0.113.7", guest); w.Code != http.StatusOK || remaining(w) != -1 {
		t.Errorf("approval off: expected 200 unlimited, got %d %d", w.Code, remaining(w))
	}
}
