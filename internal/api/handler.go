package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/webaccessibility/server/internal/models"
	"github.com/webaccessibility/server/internal/scanner"
	"github.com/webaccessibility/server/internal/scoring"
	"go.uber.org/zap"
)

// Handler holds shared dependencies for all route handlers.
type Handler struct {
	Scanner    scanner.Scanner
	Logger     *zap.Logger
	WCAGLevel  string
	ScanTimeout time.Duration
}

// Health handles GET /api/v1/health
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"time":    time.Now().UTC().Format(time.RFC3339),
		"version": "1.0.0",
	})
}

// Info handles GET /api/v1/
func (h *Handler) Info(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"name":        "Web Accessibility API",
		"version":     "1.0.0",
		"description": "WCAG accessibility scanning API powered by axe-core",
		"endpoints": []string{
			"POST /api/v1/scan",
			"POST /api/v1/score",
			"GET  /api/v1/health",
			"GET  /api/v1/",
		},
	})
}

// Scan handles POST /api/v1/scan
func (h *Handler) Scan(w http.ResponseWriter, r *http.Request) {
	var req models.ScanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", err.Error())
		return
	}

	// Validate URL
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required", "")
		return
	}
	if err := validateURL(req.URL); err != nil {
		writeError(w, http.StatusBadRequest, "invalid url", err.Error())
		return
	}

	// Resolve WCAG level
	wcagLevel := h.WCAGLevel
	if req.WCAGLevel != "" {
		req.WCAGLevel = strings.ToUpper(req.WCAGLevel)
		if req.WCAGLevel != "AA" && req.WCAGLevel != "AAA" {
			writeError(w, http.StatusBadRequest, "wcag_level must be 'AA' or 'AAA'", "")
			return
		}
		wcagLevel = req.WCAGLevel
	}

	// Set X-Scan-URL header for SSRF middleware (best-effort)
	r.Header.Set("X-Scan-URL", req.URL)

	// Block private addresses
	if isPrivateURL(req.URL) {
		writeError(w, http.StatusForbidden, "scanning private/internal addresses is not allowed", "")
		return
	}

	ctx := r.Context()

	h.Logger.Info("starting scan", zap.String("url", req.URL), zap.String("wcag", wcagLevel))

	result, err := h.Scanner.Scan(ctx, req.URL, wcagLevel, req.Depth)
	if err != nil {
		h.Logger.Error("scan failed", zap.String("url", req.URL), zap.Error(err))
		writeError(w, http.StatusInternalServerError, "scan failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// ScoreOnly handles POST /api/v1/score
// Runs a full scan and returns only the structured scoring report.
func (h *Handler) ScoreOnly(w http.ResponseWriter, r *http.Request) {
	var req models.ScanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", err.Error())
		return
	}

	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required", "")
		return
	}
	if err := validateURL(req.URL); err != nil {
		writeError(w, http.StatusBadRequest, "invalid url", err.Error())
		return
	}
	if isPrivateURL(req.URL) {
		writeError(w, http.StatusForbidden, "scanning private/internal addresses is not allowed", "")
		return
	}

	wcagLevel := h.WCAGLevel
	if req.WCAGLevel != "" {
		req.WCAGLevel = strings.ToUpper(req.WCAGLevel)
		if req.WCAGLevel != "AA" && req.WCAGLevel != "AAA" {
			writeError(w, http.StatusBadRequest, "wcag_level must be 'AA' or 'AAA'", "")
			return
		}
		wcagLevel = req.WCAGLevel
	}

	ctx := r.Context()
	h.Logger.Info("starting score-only scan", zap.String("url", req.URL), zap.String("wcag", wcagLevel))

	result, err := h.Scanner.Scan(ctx, req.URL, wcagLevel, req.Depth)
	if err != nil {
		h.Logger.Error("scan failed", zap.String("url", req.URL), zap.Error(err))
		writeError(w, http.StatusInternalServerError, "scan failed", err.Error())
		return
	}

	report := scoring.Report(result)
	writeJSON(w, http.StatusOK, report)
}

// validateURL ensures the URL is well-formed with http/https scheme.
func validateURL(raw string) error {
	u, err := url.ParseRequestURI(raw)
	if err != nil {
		return fmt.Errorf("malformed URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("only http and https URLs are allowed")
	}
	if u.Host == "" {
		return fmt.Errorf("URL must have a host")
	}
	return nil
}

// isPrivateURL blocks scanning of local/private addresses.
func isPrivateURL(raw string) bool {
	lower := strings.ToLower(raw)
	blocked := []string{
		"localhost", "127.", "10.", "192.168.", "172.16.", "0.0.0.0", "::1",
	}
	for _, b := range blocked {
		if strings.Contains(lower, b) {
			return true
		}
	}
	return false
}

// writeJSON writes a JSON response with the given status code.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError writes a standard JSON error response.
func writeError(w http.ResponseWriter, status int, msg, details string) {
	writeJSON(w, status, models.ErrorResponse{Error: msg, Details: details})
}
