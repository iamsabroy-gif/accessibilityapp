package api

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"net"
	"net/mail"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v4"
	"github.com/webaccessibility/server/internal/config"
	"github.com/webaccessibility/server/internal/coverage"
	"github.com/webaccessibility/server/internal/leads"
	"github.com/webaccessibility/server/internal/models"
	"github.com/webaccessibility/server/internal/report"
	"github.com/webaccessibility/server/internal/scanner"
	"github.com/webaccessibility/server/internal/scoring"
	"go.uber.org/zap"
	"sync/atomic"
)

// reportCacheEntry holds a cached scan result with expiry.
type reportCacheEntry struct {
	Result    *models.ScanResult
	ExpiresAt time.Time
}

// Handler holds shared dependencies for all route handlers.
type Handler struct {
	Scanner      scanner.Scanner
	Logger       *zap.Logger
	WCAGLevel    string
	ScanTimeout  time.Duration
	Coverage     *coverage.Store
	LeadStore    *leads.Store
	LeadNotifier leads.Notifier
	activeScans  int32

	// In-memory report cache for extension "View Detailed Report" links.
	reportCacheMu sync.Mutex
	reportCache   map[string]reportCacheEntry
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
		"pdf_scanning_visible": config.GetPDFScanningVisible(),
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
		writeError(w, http.StatusInternalServerError, "scan failed", err.Error())
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

// ScanClient handles POST /api/v1/scan/client to ingest client-side scan results from Chrome extension.
func (h *Handler) ScanClient(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	// Limit request body to 10MB
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)

	var raw scanner.AxeRawResult
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", err.Error())
		return
	}

	if raw.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required", "")
		return
	}

	if err := validateURL(raw.URL); err != nil {
		writeError(w, http.StatusBadRequest, "invalid url", err.Error())
		return
	}

	// Payload bounds validation for untrusted extension input
	if len(raw.Violations) > 1000 {
		writeError(w, http.StatusBadRequest, "too many violations in payload", "max 1000 violations allowed")
		return
	}
	for i := range raw.Violations {
		if len(raw.Violations[i].Nodes) > 1000 {
			writeError(w, http.StatusBadRequest, "too many violation nodes in payload", "max 1000 nodes per violation allowed")
			return
		}
		for j := range raw.Violations[i].Nodes {
			if len(raw.Violations[i].Nodes[j].HTML) > 10000 {
				raw.Violations[i].Nodes[j].HTML = raw.Violations[i].Nodes[j].HTML[:10000]
			}
		}
	}

	r.Header.Set("X-Scan-URL", raw.URL)
	h.Logger.Info("ingesting client scan result", zap.String("url", raw.URL), zap.Int("violations", len(raw.Violations)))

	durationMs := time.Since(start).Milliseconds()
	result := scanner.MapToScanResult(raw, raw.URL, "AAA", durationMs)

	// Store in report cache so the extension can open a detailed report in the web app
	reportID := h.storeReport(result)
	h.Logger.Info("stored extension report", zap.String("report_id", reportID), zap.String("url", raw.URL))

	// Wrap in envelope that includes report_id for the extension
	envelope := struct {
		ReportID string `json:"report_id"`
		models.ScanResult
	}{
		ReportID:   reportID,
		ScanResult: *result,
	}
	writeJSON(w, http.StatusOK, envelope)
}

// storeReport saves a ScanResult in the in-memory cache and returns a unique ID.
// Entries expire after 30 minutes. Cache is capped at 200 entries (oldest evicted first).
func (h *Handler) storeReport(result *models.ScanResult) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	id := hex.EncodeToString(b)

	h.reportCacheMu.Lock()
	defer h.reportCacheMu.Unlock()

	if h.reportCache == nil {
		h.reportCache = make(map[string]reportCacheEntry)
	}

	// Evict expired entries
	now := time.Now()
	for k, v := range h.reportCache {
		if now.After(v.ExpiresAt) {
			delete(h.reportCache, k)
		}
	}

	// Cap at 200 — evict oldest if needed
	if len(h.reportCache) >= 200 {
		var oldestKey string
		var oldestTime time.Time
		for k, v := range h.reportCache {
			if oldestKey == "" || v.ExpiresAt.Before(oldestTime) {
				oldestKey = k
				oldestTime = v.ExpiresAt
			}
		}
		delete(h.reportCache, oldestKey)
	}

	h.reportCache[id] = reportCacheEntry{
		Result:    result,
		ExpiresAt: now.Add(30 * time.Minute),
	}
	return id
}

// GetReport handles GET /api/v1/report/{id} — returns a cached scan result by ID.
func (h *Handler) GetReport(w http.ResponseWriter, r *http.Request) {
	// Extract report ID from the URL path: /api/v1/report/{id}
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/report/")
	id := strings.TrimSpace(path)
	if id == "" {
		writeError(w, http.StatusBadRequest, "report id is required", "")
		return
	}

	h.reportCacheMu.Lock()
	entry, ok := h.reportCache[id]
	h.reportCacheMu.Unlock()

	if !ok || time.Now().After(entry.ExpiresAt) {
		writeError(w, http.StatusNotFound, "report not found or expired", "")
		return
	}

	writeJSON(w, http.StatusOK, entry.Result)
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
		"scoring_formula":      config.GetScoringFormula(),
		"active_engine":        config.GetActiveEngine(),
		"pdf_scanning_visible": config.GetPDFScanningVisible(),
		"landing_page_enabled": config.GetLandingPageEnabled(),
	})
}

// UpdateSettings handles POST /api/v1/admin/settings
func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MaxConcurrentScans int    `json:"max_concurrent_scans"`
		ScoringFormula     string `json:"scoring_formula"`
		ActiveEngine       string `json:"active_engine"`
		// PDFScanningVisible uses *bool so an explicit false is distinguishable from omitted.
		// WARNING: This flag is UI-only. Do NOT use it to gate actual PDF scan processing.
		PDFScanningVisible *bool `json:"pdf_scanning_visible"`
		// LandingPageEnabled uses *bool for the same explicit-false reason.
		LandingPageEnabled *bool `json:"landing_page_enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", err.Error())
		return
	}
	if req.MaxConcurrentScans > 0 {
		config.SetMaxConcurrentScans(req.MaxConcurrentScans)
		h.Logger.Info("max_concurrent_scans updated via API", zap.Int("max_concurrent_scans", req.MaxConcurrentScans))
	}
	if req.ScoringFormula != "" {
		config.SetScoringFormula(req.ScoringFormula)
		h.Logger.Info("scoring_formula updated via API", zap.String("scoring_formula", req.ScoringFormula))
	}
	if req.ActiveEngine != "" {
		config.SetActiveEngine(req.ActiveEngine)
		h.Logger.Info("active_engine updated via API", zap.String("active_engine", req.ActiveEngine))
	}
	if req.PDFScanningVisible != nil {
		config.SetPDFScanningVisible(*req.PDFScanningVisible)
		h.Logger.Info("pdf_scanning_visible updated via API", zap.Bool("pdf_scanning_visible", *req.PDFScanningVisible))
	}
	if req.LandingPageEnabled != nil {
		config.SetLandingPageEnabled(*req.LandingPageEnabled)
		h.Logger.Info("landing_page_enabled updated via API", zap.Bool("landing_page_enabled", *req.LandingPageEnabled))
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"max_concurrent_scans": config.GetMaxConcurrentScans(),
		"scoring_formula":      config.GetScoringFormula(),
		"active_engine":        config.GetActiveEngine(),
		"pdf_scanning_visible": config.GetPDFScanningVisible(),
		"landing_page_enabled": config.GetLandingPageEnabled(),
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

type ReportRequest struct {
	URL    string            `json:"url"`
	Format string            `json:"format"`
	Depth  int               `json:"depth"`
	Meta   models.ReportMeta `json:"meta"`
}

func (h *Handler) processReportRequest(w http.ResponseWriter, r *http.Request) (*ReportRequest, *models.ScanResult, error) {
	var req ReportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", err.Error())
		return nil, nil, fmt.Errorf("invalid request body")
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required", "")
		return nil, nil, fmt.Errorf("url is required")
	}
	if err := validateURL(req.URL); err != nil {
		writeError(w, http.StatusBadRequest, "invalid url", err.Error())
		return nil, nil, err
	}
	if isPrivateURL(req.URL) && !config.GetAllowPrivateScans() {
		writeError(w, http.StatusForbidden, "scanning private/internal addresses is not allowed", "")
		return nil, nil, fmt.Errorf("scanning private/internal addresses is not allowed")
	}
	if req.Format != "pdf" {
		req.Format = "html" // default
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.ScanTimeout)
	defer cancel()

	h.Logger.Info("starting scan for compliance report", zap.String("url", req.URL))
	result, err := h.Scanner.Scan(ctx, req.URL, config.GetWCAGLevel(), req.Depth)
	if err != nil {
		h.Logger.Error("scan failed", zap.String("url", req.URL), zap.Error(err))
		writeError(w, http.StatusInternalServerError, "scan failed", err.Error())
		return nil, nil, err
	}

	return &req, result, nil
}

// ReportADA handles POST /api/v1/report/ada
func (h *Handler) ReportADA(w http.ResponseWriter, r *http.Request) {
	req, result, err := h.processReportRequest(w, r)
	if err != nil {
		return
	}

	compReport, err := scoring.BuildComplianceReport(result, "ADA", req.Meta)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build compliance report", err.Error())
		return
	}

	opts := report.ADAOptions{
		Format:           req.Format,
		Meta:             req.Meta,
		ComplianceReport: compReport,
	}
	ada, err := report.GenerateADA(result, opts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate ADA report", err.Error())
		return
	}

	if req.Format == "pdf" {
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="ada_report.pdf"`)
		w.Write(ada.PDF)
	} else {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(ada.HTML))
	}
}

// ReportVPAT handles POST /api/v1/report/vpat
func (h *Handler) ReportVPAT(w http.ResponseWriter, r *http.Request) {
	req, result, err := h.processReportRequest(w, r)
	if err != nil {
		return
	}

	compReport, err := scoring.BuildComplianceReport(result, "508", req.Meta)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build compliance report", err.Error())
		return
	}

	opts := report.VPATOptions{Edition: report.VPATEditionINT, Format: req.Format}
	html, pdf, err := report.GenerateVPAT(compReport, opts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate VPAT report", err.Error())
		return
	}

	if req.Format == "pdf" {
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="vpat_report.pdf"`)
		w.Write(pdf)
	} else {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
	}
}

// ReportEN301549 handles POST /api/v1/report/en301549
func (h *Handler) ReportEN301549(w http.ResponseWriter, r *http.Request) {
	req, result, err := h.processReportRequest(w, r)
	if err != nil {
		return
	}

	compReport, err := scoring.BuildComplianceReport(result, "EN301549", req.Meta)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build compliance report", err.Error())
		return
	}

	opts := report.EN301549Options{Format: req.Format}
	html, pdf, err := report.GenerateEN301549(compReport, opts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate EN 301 549 report", err.Error())
		return
	}

	if req.Format == "pdf" {
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="en301549_report.pdf"`)
		w.Write(pdf)
	} else {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
	}
}

// ReportUK handles POST /api/v1/report/uk
func (h *Handler) ReportUK(w http.ResponseWriter, r *http.Request) {
	req, result, err := h.processReportRequest(w, r)
	if err != nil {
		return
	}

	compReport, err := scoring.BuildComplianceReport(result, "ADA", req.Meta)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build compliance report", err.Error())
		return
	}

	opts := report.UKOptions{Format: req.Format}
	html, pdf, err := report.GenerateUKEquality(compReport, opts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate UK report", err.Error())
		return
	}

	if req.Format == "pdf" {
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="uk_report.pdf"`)
		w.Write(pdf)
	} else {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
	}
}

// ReportAODA handles POST /api/v1/report/aoda
func (h *Handler) ReportAODA(w http.ResponseWriter, r *http.Request) {
	req, result, err := h.processReportRequest(w, r)
	if err != nil {
		return
	}

	compReport, err := scoring.BuildComplianceReport(result, "ADA", req.Meta)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build compliance report", err.Error())
		return
	}

	opts := report.AODAOptions{Format: req.Format}
	html, pdf, err := report.GenerateAODA(compReport, opts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate AODA report", err.Error())
		return
	}

	if req.Format == "pdf" {
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="aoda_report.pdf"`)
		w.Write(pdf)
	} else {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
	}
}

// ReportACA handles POST /api/v1/report/aca
func (h *Handler) ReportACA(w http.ResponseWriter, r *http.Request) {
	req, result, err := h.processReportRequest(w, r)
	if err != nil {
		return
	}

	compReport, err := scoring.BuildComplianceReport(result, "ADA", req.Meta)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build compliance report", err.Error())
		return
	}

	opts := report.ACAOptions{Format: req.Format}
	html, pdf, err := report.GenerateACA(compReport, opts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate ACA report", err.Error())
		return
	}

	if req.Format == "pdf" {
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="aca_report.pdf"`)
		w.Write(pdf)
	} else {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
	}
}

// ReportDDA handles POST /api/v1/report/dda
func (h *Handler) ReportDDA(w http.ResponseWriter, r *http.Request) {
	req, result, err := h.processReportRequest(w, r)
	if err != nil {
		return
	}

	compReport, err := scoring.BuildComplianceReport(result, "ADA", req.Meta)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build compliance report", err.Error())
		return
	}

	opts := report.DDAOptions{Format: req.Format}
	html, pdf, err := report.GenerateDDA(compReport, opts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate DDA report", err.Error())
		return
	}

	if req.Format == "pdf" {
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="dda_report.pdf"`)
		w.Write(pdf)
	} else {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
	}
}

// ReportGIGW handles POST /api/v1/report/gigw
func (h *Handler) ReportGIGW(w http.ResponseWriter, r *http.Request) {
	req, result, err := h.processReportRequest(w, r)
	if err != nil {
		return
	}

	compReport, err := scoring.BuildComplianceReport(result, "ADA", req.Meta)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build compliance report", err.Error())
		return
	}

	opts := report.GIGWOptions{Format: req.Format}
	html, pdf, err := report.GenerateGIGW(compReport, opts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate GIGW report", err.Error())
		return
	}

	if req.Format == "pdf" {
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="gigw_report.pdf"`)
		w.Write(pdf)
	} else {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
	}
}

// ReportCVAA handles POST /api/v1/report/cvaa
func (h *Handler) ReportCVAA(w http.ResponseWriter, r *http.Request) {
	req, result, err := h.processReportRequest(w, r)
	if err != nil {
		return
	}

	compReport, err := scoring.BuildComplianceReport(result, "ADA", req.Meta)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build compliance report", err.Error())
		return
	}

	opts := report.CVAAOptions{Format: req.Format}
	html, pdf, err := report.GenerateCVAA(compReport, opts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate CVAA report", err.Error())
		return
	}

	if req.Format == "pdf" {
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="cvaa_report.pdf"`)
		w.Write(pdf)
	} else {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
	}
}

// ReportEAA handles POST /api/v1/report/eaa (European Accessibility Act)
func (h *Handler) ReportEAA(w http.ResponseWriter, r *http.Request) {
	req, result, err := h.processReportRequest(w, r)
	if err != nil {
		return
	}

	compReport, err := scoring.BuildComplianceReport(result, "EN301549", req.Meta)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build compliance report", err.Error())
		return
	}

	opts := report.EN301549Options{Format: req.Format, ReportType: "EAA"}
	html, pdf, err := report.GenerateEN301549(compReport, opts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate EAA report", err.Error())
		return
	}

	if req.Format == "pdf" {
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="eaa_report.pdf"`)
		w.Write(pdf)
	} else {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
	}
}

// ReportBITV handles POST /api/v1/report/bitv (German BITV 2.0)
func (h *Handler) ReportBITV(w http.ResponseWriter, r *http.Request) {
	req, result, err := h.processReportRequest(w, r)
	if err != nil {
		return
	}

	compReport, err := scoring.BuildComplianceReport(result, "EN301549", req.Meta)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build compliance report", err.Error())
		return
	}

	opts := report.EN301549Options{Format: req.Format, ReportType: "BITV"}
	html, pdf, err := report.GenerateEN301549(compReport, opts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate BITV report", err.Error())
		return
	}

	if req.Format == "pdf" {
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="bitv_report.pdf"`)
		w.Write(pdf)
	} else {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
	}
}

// CaptureLeadReq defines the request body for POST /api/v1/leads
type CaptureLeadReq struct {
	Email   string `json:"email"`
	Source  string `json:"source"`
	Consent bool   `json:"consent"`
	Website string `json:"website"` // Honeypot field — must be empty
}

// getClientIP extracts the real client IP from headers or RemoteAddr.
func getClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			return strings.TrimSpace(parts[0])
		}
	}
	if xreal := r.Header.Get("X-Real-IP"); xreal != "" {
		return strings.TrimSpace(xreal)
	}
	addr := r.RemoteAddr
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
}

// CaptureLead handles POST /api/v1/leads
func (h *Handler) CaptureLead(w http.ResponseWriter, r *http.Request) {
	if !config.GetLeadCaptureEnabled() {
		writeJSON(w, http.StatusNotFound, models.ErrorResponse{Error: "Lead capture is disabled"})
		return
	}

	// Limit request payload to 4KB
	r.Body = http.MaxBytesReader(w, r.Body, 4096)

	var req CaptureLeadReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "Invalid JSON payload"})
		return
	}

	req.Email = strings.TrimSpace(req.Email)
	req.Website = strings.TrimSpace(req.Website)

	// Honeypot check: silently succeed if bot filled hidden field
	if req.Website != "" {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}

	// Validate email format and max length (254 chars)
	if len(req.Email) == 0 || len(req.Email) > 254 {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "Invalid email address"})
		return
	}
	if _, err := mail.ParseAddress(req.Email); err != nil {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "Invalid email address format"})
		return
	}

	// Consent check
	if !req.Consent {
		writeJSON(w, http.StatusBadRequest, models.ErrorResponse{Error: "Consent is required"})
		return
	}

	// Source normalization
	source := req.Source
	if source != "scan_cta" && source != "extension_cta" {
		source = "unknown"
	}

	ip := getClientIP(r)
	ipHash := leads.HashIP(ip, config.GetLeadIPSalt())
	userAgent := r.UserAgent()

	rec := &leads.LeadRecord{
		Email:     req.Email,
		Source:    source,
		Consent:   req.Consent,
		IPHash:    ipHash,
		UserAgent: userAgent,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	if h.LeadStore != nil {
		if err := h.LeadStore.Save(rec); err != nil {
			if h.Logger != nil {
				h.Logger.Error("failed to save lead record", zap.Error(err))
			}
		}
	}

	if h.LeadNotifier != nil {
		_ = h.LeadNotifier.Notify(r.Context(), rec)
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

