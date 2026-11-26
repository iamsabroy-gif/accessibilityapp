package api

import (
	"encoding/json"
	"errors"
	"html/template"
	"net/http"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v4"
	"github.com/webaccessibility/server/internal/access"
	"github.com/webaccessibility/server/internal/config"
	"go.uber.org/zap"
)

// Returning-user approval flow (see internal/access):
//
//	POST /api/v1/access/request   user asks for access → owner is emailed a review link
//	GET  /api/v1/access/review    owner's review page (from the email link)
//	POST /api/v1/access/review    owner approves/denies → user is emailed an access code
//	POST /api/v1/access/session   user exchanges the code for a scan token
//
// Scan tokens issued from a code carry Subject "access:<request id>"; the
// metered scan routes use one of the code's scans for every successful scan.

const accessSubjectPrefix = "access:"

var errAccessRequired = errors.New("an access code is required to scan")

// accessError codes returned to the client so it can show the right message.
func accessErrorCode(err error) string {
	switch {
	case errors.Is(err, access.ErrExhausted):
		return "access_exhausted"
	case errors.Is(err, access.ErrExpired):
		return "access_expired"
	case errors.Is(err, access.ErrRevoked):
		return "access_revoked"
	case errors.Is(err, errAccessRequired):
		return "access_required"
	default:
		return "access_invalid"
	}
}

func writeAccessError(w http.ResponseWriter, err error) {
	writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error(), "code": accessErrorCode(err)})
}

// publicBaseURL returns the site URL used in email links.
func (h *Handler) publicBaseURL(r *http.Request) string {
	if base := config.GetPublicBaseURL(); base != "" {
		return base
	}
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	if h.Logger != nil {
		h.Logger.Warn("PUBLIC_BASE_URL is not set; building email links from the request host")
	}
	return scheme + "://" + r.Host
}

func (h *Handler) accessEnabled(w http.ResponseWriter) bool {
	if !config.GetAccessApprovalEnabled() || h.Access == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "access approval is disabled"})
		return false
	}
	return true
}

// RequestAccess handles POST /api/v1/access/request.
func (h *Handler) RequestAccess(w http.ResponseWriter, r *http.Request) {
	if !h.accessEnabled(w) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
	var req struct {
		Email   string `json:"email"`
		Website string `json:"website"` // honeypot
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "")
		return
	}
	if strings.TrimSpace(req.Website) != "" {
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "status": access.StatusPending})
		return
	}
	email := strings.TrimSpace(req.Email)
	if email == "" || len(email) > 254 {
		writeError(w, http.StatusBadRequest, "invalid email address", "")
		return
	}
	if addr, err := mail.ParseAddress(email); err != nil || addr.Address != email {
		writeError(w, http.StatusBadRequest, "invalid email address", "")
		return
	}

	rec, key, created, err := h.Access.Create(email)
	if err != nil {
		h.Logger.Error("failed to save access request", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "could not save your request, please try again", "")
		return
	}
	if created && h.AccessMailer != nil {
		reviewURL := h.publicBaseURL(r) + "/api/v1/access/review?" + url.Values{"id": {rec.ID}, "key": {key}}.Encode()
		subject, body := access.OwnerRequestEmail(rec, reviewURL, config.GetAccessDefaultScans())
		if err := h.AccessMailer.Send(config.GetLeadNotifyEmail(), subject, body); err != nil {
			h.Logger.Warn("failed to send access request email", zap.Error(err))
		}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "status": access.StatusPending})
}

// AccessSession handles POST /api/v1/access/session: exchanges a code for a scan token.
// It does not use a scan; scans are counted when they run.
func (h *Handler) AccessSession(w http.ResponseWriter, r *http.Request) {
	if !h.accessEnabled(w) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "")
		return
	}
	rec, err := h.Access.Validate(req.Code)
	if err != nil {
		writeAccessError(w, err)
		return
	}
	const ttl = 20 * time.Minute
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.StandardClaims{
		ExpiresAt: time.Now().Add(ttl).Unix(),
		Issuer:    "webaccessibility",
		Subject:   accessSubjectPrefix + rec.ID,
	})
	signed, err := token.SignedString([]byte(config.GetSecret()))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to sign token", "")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token":           signed,
		"expires_in":      int(ttl.Seconds()),
		"remaining":       rec.Remaining(),
		"max_scans":       rec.MaxScans,
		"code_expires_at": rec.ExpiresAt,
	})
}

// meteredAuth wraps a scan route: it validates the JWT and, for tokens issued
// from an access code, refuses the request when the code is used up and uses
// one scan when the request succeeds. Guest tokens pass through unchanged.
func (h *Handler) meteredAuth(next http.HandlerFunc) http.HandlerFunc {
	return h.metered(next, false)
}

// appMeteredAuth is meteredAuth for the web app's scan routes: while access
// approval is on, guest tokens are refused there, so every app scan is counted
// against a trial or approved code. (The extension's /scan/client stays open.)
func (h *Handler) appMeteredAuth(next http.HandlerFunc) http.HandlerFunc {
	return h.metered(next, true)
}

func (h *Handler) metered(next http.HandlerFunc, requireCode bool) http.HandlerFunc {
	return jwtAuthMiddleware(func(w http.ResponseWriter, r *http.Request) {
		claims := &jwt.StandardClaims{}
		tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		// Signature already verified by jwtAuthMiddleware; only the subject is needed.
		if _, _, err := new(jwt.Parser).ParseUnverified(tok, claims); err != nil ||
			!strings.HasPrefix(claims.Subject, accessSubjectPrefix) {
			if requireCode && config.GetAccessApprovalEnabled() && claims.Subject != "admin" {
				writeAccessError(w, errAccessRequired)
				return
			}
			next(w, r)
			return
		}
		id := strings.TrimPrefix(claims.Subject, accessSubjectPrefix)
		if h.Access == nil {
			writeAccessError(w, access.ErrInvalidCode)
			return
		}
		if _, err := h.Access.Status(id); err != nil {
			writeAccessError(w, err)
			return
		}
		lrw := &loggingResponseWriter{ResponseWriter: w, status: http.StatusOK}
		next(lrw, r)
		if lrw.status < 400 {
			if _, err := h.Access.Consume(id); err != nil && h.Logger != nil {
				h.Logger.Warn("could not count scan against access code", zap.String("id", id), zap.Error(err))
			}
		}
	})
}

// ─── Owner review page (linked from the request email) ───────────────────────

var reviewTmpl = template.Must(template.New("review").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Access request · AccessScan</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px 16px}
main{max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px}
h1{font-size:1.25rem;margin:0 0 16px}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0 0 20px}
dt{color:#475569}dd{margin:0;word-break:break-all}label{display:block;font-weight:600;margin-bottom:6px}
input[type=number]{width:120px;padding:8px;border:1px solid #94a3b8;border-radius:6px;font-size:1rem}
.row{display:flex;gap:12px;margin-top:20px;flex-wrap:wrap}
button{font-size:1rem;padding:10px 18px;border-radius:8px;border:1px solid transparent;cursor:pointer}
.approve{background:#15803d;color:#fff}.deny{background:#fff;color:#b91c1c;border-color:#b91c1c}
.msg{padding:12px;border-radius:8px;background:#f1f5f9}.ok{background:#dcfce7}.bad{background:#fee2e2}
@media (prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}main{background:#1e293b;border-color:#334155}dt{color:#94a3b8}.msg{background:#334155}.ok{background:#14532d}.bad{background:#7f1d1d}.deny{background:transparent;color:#fca5a5;border-color:#fca5a5}input[type=number]{background:#0f172a;color:#e2e8f0}}
</style></head><body><main>
<h1>Access request</h1>
{{if .Message}}<p class="msg {{.Tone}}" role="status">{{.Message}}</p>{{end}}
{{with .Req}}<dl>
<dt>Email</dt><dd>{{.Email}}</dd>
<dt>Requested</dt><dd>{{.RequestedAt}}</dd>
<dt>Status</dt><dd>{{.Status}}</dd>
{{if eq .Status "approved"}}<dt>Scans</dt><dd>{{.UsedScans}} of {{.MaxScans}} used</dd>{{if .ExpiresAt}}<dt>Expires</dt><dd>{{.ExpiresAt}}</dd>{{end}}{{end}}
</dl>{{end}}
{{if .CanDecide}}
<form method="post" action="/api/v1/access/review">
<input type="hidden" name="id" value="{{.Req.ID}}"><input type="hidden" name="key" value="{{.Key}}">
<label for="max_scans">Scans to allow</label>
<input id="max_scans" name="max_scans" type="number" min="1" max="10000" value="{{.DefaultScans}}" required>
<div class="row">
<button class="approve" name="action" value="approve" type="submit">Approve &amp; email code</button>
<button class="deny" name="action" value="deny" type="submit" formnovalidate>Deny</button>
</div></form>{{end}}
</main></body></html>`))

type reviewView struct {
	Req          *access.Request
	Key          string
	Message      string
	Tone         string
	CanDecide    bool
	DefaultScans int
}

func renderReview(w http.ResponseWriter, status int, v reviewView) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.WriteHeader(status)
	_ = reviewTmpl.Execute(w, v)
}

// ReviewAccess handles GET /api/v1/access/review. It only shows the request;
// approving takes a button press, so mail scanners that open links can't approve.
func (h *Handler) ReviewAccess(w http.ResponseWriter, r *http.Request) {
	if h.Access == nil {
		renderReview(w, http.StatusNotFound, reviewView{Message: "Access approval is not set up on this server.", Tone: "bad"})
		return
	}
	id, key := r.URL.Query().Get("id"), r.URL.Query().Get("key")
	if err := h.Access.CheckReviewKey(id, key); err != nil {
		renderReview(w, http.StatusNotFound, reviewView{Message: "This review link is invalid.", Tone: "bad"})
		return
	}
	rec, _ := h.Access.Get(id)
	v := reviewView{Req: rec, Key: key, DefaultScans: config.GetAccessDefaultScans(), CanDecide: rec.Status == access.StatusPending}
	if !v.CanDecide {
		v.Message = "This request has already been " + rec.Status + "."
	}
	renderReview(w, http.StatusOK, v)
}

// DecideAccess handles POST /api/v1/access/review (the review page's form).
func (h *Handler) DecideAccess(w http.ResponseWriter, r *http.Request) {
	if h.Access == nil {
		renderReview(w, http.StatusNotFound, reviewView{Message: "Access approval is not set up on this server.", Tone: "bad"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
	if err := r.ParseForm(); err != nil {
		renderReview(w, http.StatusBadRequest, reviewView{Message: "Invalid form.", Tone: "bad"})
		return
	}
	id, key := r.PostForm.Get("id"), r.PostForm.Get("key")
	if err := h.Access.CheckReviewKey(id, key); err != nil {
		renderReview(w, http.StatusNotFound, reviewView{Message: "This review link is invalid.", Tone: "bad"})
		return
	}
	maxScans, _ := strconv.Atoi(r.PostForm.Get("max_scans"))
	rec, err := h.decide(r, id, r.PostForm.Get("action"), maxScans)
	if err != nil {
		cur, _ := h.Access.Get(id)
		renderReview(w, http.StatusConflict, reviewView{Req: cur, Message: err.Error(), Tone: "bad"})
		return
	}
	msg := "Denied. No email was sent to the user."
	if rec.Status == access.StatusApproved {
		msg = "Approved. An access code for " + strconv.Itoa(rec.MaxScans) + " scans has been emailed to " + rec.Email + "."
	}
	renderReview(w, http.StatusOK, reviewView{Req: rec, Message: msg, Tone: "ok"})
}

// decide applies an owner decision and, on approval, emails the code to the user.
func (h *Handler) decide(r *http.Request, id, action string, maxScans int) (*access.Request, error) {
	switch action {
	case "approve":
		if maxScans <= 0 {
			maxScans = config.GetAccessDefaultScans()
		}
		if maxScans > 10000 {
			return nil, errors.New("scans to allow must be 10000 or fewer")
		}
		ttl := time.Duration(config.GetAccessCodeTTLDays()) * 24 * time.Hour
		rec, code, err := h.Access.Approve(id, maxScans, ttl)
		if err != nil {
			return nil, err
		}
		if h.AccessMailer != nil {
			subject, body := access.UserApprovedEmail(rec, code, h.publicBaseURL(r)+"/app")
			if err := h.AccessMailer.Send(rec.Email, subject, body); err != nil {
				h.Logger.Warn("failed to send access code email", zap.Error(err))
			}
		}
		h.Logger.Info("access request approved", zap.String("id", id), zap.Int("max_scans", maxScans))
		return rec, nil
	case "deny":
		return h.Access.Deny(id)
	case "revoke":
		return h.Access.Revoke(id)
	}
	return nil, errors.New("unknown action")
}

// ─── Admin console API ───────────────────────────────────────────────────────

type accessRow struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	Status      string `json:"status"`
	Kind        string `json:"kind,omitempty"`
	RequestedAt string `json:"requested_at"`
	DecidedAt   string `json:"decided_at,omitempty"`
	MaxScans    int    `json:"max_scans"`
	UsedScans   int    `json:"used_scans"`
	ExpiresAt   string `json:"expires_at,omitempty"`
	LastUsed    string `json:"last_used,omitempty"`
}

// ListAccess handles GET /api/v1/admin/access.
func (h *Handler) ListAccess(w http.ResponseWriter, r *http.Request) {
	rows := []accessRow{}
	if h.Access != nil {
		for _, q := range h.Access.List() {
			rows = append(rows, accessRow{q.ID, q.Email, q.Status, q.Kind, q.RequestedAt, q.DecidedAt, q.MaxScans, q.UsedScans, q.ExpiresAt, q.LastUsed})
		}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"enabled":       config.GetAccessApprovalEnabled(),
		"default_scans": config.GetAccessDefaultScans(),
		"trial_scans":   config.GetAccessTrialScans(),
		"ttl_days":      config.GetAccessCodeTTLDays(),
		"requests":      rows,
	})
}

// AdminDecideAccess handles POST /api/v1/admin/access/{id}/{action} (approve|deny|revoke).
func (h *Handler) AdminDecideAccess(w http.ResponseWriter, r *http.Request) {
	if h.Access == nil {
		writeError(w, http.StatusNotFound, "access approval is not set up", "")
		return
	}
	var body struct {
		MaxScans int `json:"max_scans"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body)
	rec, err := h.decide(r, chi.URLParam(r, "id"), chi.URLParam(r, "action"), body.MaxScans)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, access.ErrNotFound) {
			status = http.StatusNotFound
		} else if errors.Is(err, access.ErrNotPending) {
			status = http.StatusConflict
		}
		writeError(w, status, err.Error(), "")
		return
	}
	writeJSON(w, http.StatusOK, accessRow{rec.ID, rec.Email, rec.Status, rec.Kind, rec.RequestedAt, rec.DecidedAt, rec.MaxScans, rec.UsedScans, rec.ExpiresAt, rec.LastUsed})
}
