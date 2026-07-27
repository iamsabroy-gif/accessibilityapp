package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v4"
	"github.com/webaccessibility/server/internal/config"
	"github.com/webaccessibility/server/internal/models"
	"github.com/webaccessibility/server/internal/scanner"
	"go.uber.org/zap"
)

func helperGenerateToken(secret string) string {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.StandardClaims{
		ExpiresAt: time.Now().Add(20 * time.Minute).Unix(),
		Issuer:    "webaccessibility",
	})
	signed, _ := token.SignedString([]byte(secret))
	return signed
}

func TestScanClient(t *testing.T) {
	secret := "test-jwt-secret-12345"
	config.SetSecret(secret)

	logger := zap.NewNop()
	handler := &Handler{Logger: logger}
	router := NewRouter(handler, logger)

	token := helperGenerateToken(secret)

	// Test 1: Unauthenticated request should return 401
	{
		body := []byte(`{"url":"http://localhost:3000","violations":[],"passes":[],"incomplete":[]}`)
		req := httptest.NewRequest("POST", "/api/v1/scan/client", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Errorf("expected status 401 for unauthenticated request, got %d", w.Code)
		}
	}

	// Test 2: Valid payload with localhost URL (bypasses SSRF) -> returns 200 OK
	{
		payload := scanner.AxeRawResult{
			URL: "http://localhost:3000/dashboard",
			Violations: []scanner.AxeViolation{
				{
					ID:          "image-alt",
					Impact:      "critical",
					Description: "Images must have alt text",
					Help:        "Add alt attribute",
					HelpURL:     "https://example.com",
					Tags:        []string{"wcag2a", "wcag111"},
					Nodes: []scanner.AxeNode{
						{
							HTML:           "<img src='logo.png'>",
							Target:         []string{"img"},
							FailureSummary: "Fix alt attribute",
						},
					},
				},
			},
			Passes: []scanner.AxeRule{
				{ID: "html-has-lang", Description: "html element has lang", NodeCount: 1},
			},
			Incomplete: []scanner.AxeRule{},
		}
		data, _ := json.Marshal(payload)
		req := httptest.NewRequest("POST", "/api/v1/scan/client", bytes.NewBuffer(data))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected status 200 for valid localhost client scan, got %d (body: %s)", w.Code, w.Body.String())
		}

		var res models.ScanResult
		if err := json.NewDecoder(w.Body).Decode(&res); err != nil {
			t.Fatalf("failed to decode response JSON: %v", err)
		}

		if res.URL != "http://localhost:3000/dashboard" {
			t.Errorf("expected URL 'http://localhost:3000/dashboard', got '%s'", res.URL)
		}
		if res.Summary.ViolationCount != 1 {
			t.Errorf("expected 1 violation, got %d", res.Summary.ViolationCount)
		}
		if res.Summary.PassCount != 1 {
			t.Errorf("expected 1 pass, got %d", res.Summary.PassCount)
		}
	}

	// Test 3: Malformed JSON -> returns 400
	{
		req := httptest.NewRequest("POST", "/api/v1/scan/client", bytes.NewBufferString("{invalid-json"))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400 for malformed json, got %d", w.Code)
		}
	}

	// Test 4: Missing URL -> returns 400
	{
		req := httptest.NewRequest("POST", "/api/v1/scan/client", bytes.NewBufferString(`{"violations":[]}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400 for missing url, got %d", w.Code)
		}
	}
}
