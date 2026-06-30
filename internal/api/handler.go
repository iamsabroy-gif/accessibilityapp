package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v4"
	"github.com/webaccessibility/server/internal/config"
	"github.com/webaccessibility/server/internal/coverage"
	"github.com/webaccessibility/server/internal/models"
	"github.com/webaccessibility/server/internal/report"
	"github.com/webaccessibility/server/internal/scanner"
	"github.com/webaccessibility/server/internal/scoring"
	"go.uber.org/zap"
	"sync/atomic"
)

// Handler holds shared dependencies for all route handlers.
type Handler struct {
	Scanner     scanner.Scanner
	Logger      *zap.Logger
	WCAGLevel   string
	ScanTimeout time.Duration
	Coverage    *coverage.Store
	activeScans int32
}

// Health handles GET /api/v1/health
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "time": time.Now().UTC().Format(time.RFC3339), "version": "1.0.0"})
}

// Info handles GET /api/v1/
func (h *Handler) Info(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"name":                 "Web Accessibility API",
		"version":              "1.0.0",
		"description":          "WCAG accessibility scanning API powered by axe-core",
		"max_concurrent_scans": config.GetMaxConcurrentScans(),
		"endpoints":            []string{"POST /api/v1/scan", "POST /api/v1/score", "GET  /api/v1/health", "GET  /api/v1/", "POST /api/v1/token", "POST /api/v1/secret", "GET  /api/v1/secret"},
	})
}

// Scan handles POST /api/v1/scan
func (h *Handler) Scan(w http.ResponseWriter, r *http.Request) {
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
	const wcagLevel = "AAA"
	r.Header.Set("X-Scan-URL", req.URL)
	if isPrivateURL(req.URL) && !config.GetAllowPrivateScans() {
		writeError(w, http.StatusForbidden, "scanning private/internal addresses is not allowed", "")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.ScanTimeout)
	defer cancel()

	if err := h.acquireSlot(ctx); err != nil {
		writeError(w, http.StatusTooManyRequests, "scan aborted or timed out while waiting for slot", err.Error())
		return
	}
	defer h.releaseSlot()

	h.Logger.Info("starting scan", zap.String("url", req.URL), zap.String("wcag", wcagLevel), zap.Int("depth", req.Depth))
	result, err := h.Scanner.Scan(ctx, req.URL, wcagLevel, req.Depth)
	if err != nil {
		h.Logger.Error("scan failed", zap.String("url", req.URL), zap.Error(err))
		return
	}
	// Generate visual HTML report if requested
	if req.VisualReport {
		html, rerr := report.Generate(result)
		if rerr != nil {
			h.Logger.Warn("visual report generation failed", zap.Error(rerr))
		} else {
			result.VisualReportHTML = html
		}
	}
	writeJSON(w, http.StatusOK, result)
}

// GenerateToken handles POST /api/v1/token to issue a JWT.
func (h *Handler) GenerateToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Secret       string `json:"secret"`
		ClientSecret string `json:"client_secret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", err.Error())
		return
	}

	secretInput := req.Secret
	if secretInput == "" {
		secretInput = req.ClientSecret
	}

	if secretInput == "" {
		writeError(w, http.StatusBadRequest, "secret or client_secret is required", "")
		return
	}

	serverSecret := config.GetSecret()
	if serverSecret == "" {
		writeError(w, http.StatusInternalServerError, "JWT secret is not configured on the server", "")
		return
	}

	if secretInput != serverSecret {
		writeError(w, http.StatusUnauthorized, "invalid secret", "")
		return
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.StandardClaims{
		ExpiresAt: time.Now().Add(30 * time.Minute).Unix(),
		Issuer:    "webaccessibility",
	})
	signed, err := token.SignedString([]byte(serverSecret))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to sign token", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": signed})
}

// Session handles GET /api/v1/session – issues a short-lived JWT to any visitor.
// No client secret is required; the server signs with its own JWT_SECRET.
// This makes the frontend usable by anyone without exposing the JWT_SECRET.
func (h *Handler) Session(w http.ResponseWriter, r *http.Request) {
	serverSecret := config.GetSecret()
	if serverSecret == "" {
		writeError(w, http.StatusInternalServerError, "JWT secret is not configured on the server", "")
		return
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.StandardClaims{
		ExpiresAt: time.Now().Add(20 * time.Minute).Unix(),
		Issuer:    "webaccessibility",
		Subject:   "guest",
	})
	signed, err := token.SignedString([]byte(serverSecret))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to sign token", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token":      signed,
		"expires_in": 1200, // 20 minutes in seconds
	})
}

// VerifyAdminPassword handles POST /api/v1/admin/verify.
// Checks the submitted password against the ADMIN_PASSWORD env var.
// Returns 200 OK if it matches, 401 if not.
func (h *Handler) VerifyAdminPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", err.Error())
		return
	}

	adminPwd := config.GetAdminPassword()
	if adminPwd == "" {
		writeError(w, http.StatusServiceUnavailable, "admin mode is not configured on this server", "")
		return
	}

	if subtle.ConstantTimeCompare([]byte(req.Password), []byte(adminPwd)) != 1 {
		writeError(w, http.StatusUnauthorized, "incorrect admin password", "")
		return
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.StandardClaims{
		ExpiresAt: time.Now().Add(30 * time.Minute).Unix(),
		Issuer:    "webaccessibility",
		Subject:   "admin",
	})
	signed, err := token.SignedString([]byte(config.GetSecret()))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create admin session", "")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "ok", "admin_token": signed, "expires_in": 1800})
}

// CoverageReport returns the latest administrator-supplied WCAG coverage data.
func (h *Handler) CoverageReport(w http.ResponseWriter, r *http.Request) {
	if h.Coverage == nil {
		writeError(w, http.StatusNotFound, "coverage report is not available", "")
		return
	}
	report, ok := h.Coverage.Get()
	if !ok {
		writeError(w, http.StatusNotFound, "coverage report is not available", "")
		return
	}
	writeJSON(w, http.StatusOK, report)
}

// UploadCoverageReport validates and installs an XLSX coverage report.
func (h *Handler) UploadCoverageReport(w http.ResponseWriter, r *http.Request) {
	if h.Coverage == nil {
		writeError(w, http.StatusServiceUnavailable, "coverage report storage is unavailable", "")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid upload", "XLSX files must be 10 MB or smaller")
		return
	}
	file, header, err := r.FormFile("report")
	if err != nil {
		writeError(w, http.StatusBadRequest, "report file is required", "")
		return
	}
	defer file.Close()
	if strings.ToLower(filepath.Ext(header.Filename)) != ".xlsx" {
		writeError(w, http.StatusBadRequest, "only .xlsx files are accepted", "")
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, (10<<20)+1))
	if err != nil || len(data) > 10<<20 {
		writeError(w, http.StatusBadRequest, "could not read upload", "XLSX files must be 10 MB or smaller")
		return
	}
	report, err := h.Coverage.Replace(data, header.Filename)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid coverage report", err.Error())
		return
	}
	h.Logger.Info("WCAG coverage report uploaded", zap.String("filename", header.Filename), zap.Int("entries", len(report.Entries)))
	writeJSON(w, http.StatusOK, report)
}

// SetSecret handles POST /api/v1/secret to change the JWT secret at runtime.
func (h *Handler) SetSecret(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Secret string `json:"secret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", err.Error())
		return
	}
	if req.Secret == "" {
		writeError(w, http.StatusBadRequest, "secret cannot be empty", "")
		return
	}
	config.SetSecret(req.Secret)
	h.Logger.Info("JWT secret updated via API")
	writeJSON(w, http.StatusOK, map[string]string{"status": "secret updated"})
}

// GetSettings handles GET /api/v1/admin/settings
func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"max_concurrent_scans": config.GetMaxConcurrentScans(),
	})
}

// UpdateSettings handles POST /api/v1/admin/settings
func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MaxConcurrentScans int `json:"max_concurrent_scans"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", err.Error())
		return
	}
	if req.MaxConcurrentScans > 0 {
		config.SetMaxConcurrentScans(req.MaxConcurrentScans)
		h.Logger.Info("max_concurrent_scans updated via API", zap.Int("max_concurrent_scans", req.MaxConcurrentScans))
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"max_concurrent_scans": config.GetMaxConcurrentScans(),
	})
}

func (h *Handler) acquireSlot(ctx context.Context) error {
	for {
		max := int32(config.GetMaxConcurrentScans())
		current := atomic.LoadInt32(&h.activeScans)
		if current < max {
			if atomic.CompareAndSwapInt32(&h.activeScans, current, current+1) {
				return nil
			}
			continue
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func (h *Handler) releaseSlot() {
	atomic.AddInt32(&h.activeScans, -1)
}

// GetSecret returns the active JWT secret (development only).
func (h *Handler) GetSecret(w http.ResponseWriter, r *http.Request) {
	secret := config.GetSecret()
	writeJSON(w, http.StatusOK, map[string]string{"secret": secret})
}

// ScoreOnly handles POST /api/v1/score
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
	if isPrivateURL(req.URL) && !config.GetAllowPrivateScans() {
		writeError(w, http.StatusForbidden, "scanning private/internal addresses is not allowed", "")
		return
	}
	const wcagLevel = "AAA"
	ctx, cancel := context.WithTimeout(r.Context(), h.ScanTimeout)
	defer cancel()
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

func isPrivateURL(raw string) bool {
	lower := strings.ToLower(raw)
	blocked := []string{"localhost", "127.", "10.", "192.168.", "172.16.", "0.0.0.0", "::1"}
	for _, b := range blocked {
		if strings.Contains(lower, b) {
			return true
		}
	}
	return false
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg, details string) {
	writeJSON(w, status, models.ErrorResponse{Error: msg, Details: details})
}
