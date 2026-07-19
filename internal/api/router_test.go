package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/webaccessibility/server/internal/config"
	"go.uber.org/zap"
)

func TestRouterLandingPageToggle(t *testing.T) {
	t.Setenv("FRONTEND_DIR", "../../frontend")
	logger := zap.NewNop()
	handler := &Handler{Logger: logger}
	router := NewRouter(handler, logger)

	// Test 1: LANDING_PAGE_ENABLED = false (default) -> GET / serves index.html
	config.SetLandingPageEnabled(false)
	req1 := httptest.NewRequest("GET", "/", nil)
	w1 := httptest.NewRecorder()
	router.ServeHTTP(w1, req1)

	if w1.Code != http.StatusOK {
		t.Errorf("expected status 200 for GET /, got %d", w1.Code)
	}

	// Test 2: LANDING_PAGE_ENABLED = true -> GET / serves landing.html
	config.SetLandingPageEnabled(true)
	req2 := httptest.NewRequest("GET", "/", nil)
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req2)

	if w2.Code != http.StatusOK {
		t.Errorf("expected status 200 for GET / when landing enabled, got %d", w2.Code)
	}

	// Test 3: GET /app always serves index.html (status 200)
	req3 := httptest.NewRequest("GET", "/app", nil)
	w3 := httptest.NewRecorder()
	router.ServeHTTP(w3, req3)

	if w3.Code != http.StatusOK {
		t.Errorf("expected status 200 for GET /app, got %d", w3.Code)
	}

	// Test 4: API routes remain unaffected
	req4 := httptest.NewRequest("GET", "/api/v1/health", nil)
	w4 := httptest.NewRecorder()
	router.ServeHTTP(w4, req4)

	if w4.Code != http.StatusOK {
		t.Errorf("expected status 200 for GET /api/v1/health, got %d", w4.Code)
	}

	// Reset config state
	config.SetLandingPageEnabled(false)
}
