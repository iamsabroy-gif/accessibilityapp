package api

import (
	"encoding/json"
	"errors"
	"html/template"
	"net/http"
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

// Returning-user approval & user account flow (see internal/access):
//
//	POST /api/v1/auth/code        email → 6-digit HMAC login code emailed
//	POST /api/v1/auth/verify      email + code → user:<id> JWT
//	GET  /api/v1/auth/me          user:<id> JWT → {email, scans_left}
//	POST /api/v1/access/request   user:<id> JWT asks for more scans → owner emailed
//	GET  /api/v1/access/review    owner's review page (from the email link)
//	POST /api/v1/access/review    owner approves/denies → scans added to user account
//	POST /api/v1/access/session   legacy access code → access:<id> JWT (kept until Phase 4)

const accessSubjectPrefix = "access:"

var errAccessRequired = errors.New("an access code is required to scan")

func isAccessDomainError(err error) bool {
	return errors.Is(err, access.ErrNotFound) ||
		errors.Is(err, access.ErrInvalidCode) ||
		errors.Is(err, access.ErrExhausted) ||
		errors.Is(err, access.ErrExpired) ||
		errors.Is(err, access.ErrRevoked)
}

// accessErrorCode maps legacy access-code errors to machine-readable error codes.
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
	if !config.GetAccessApprovalEnabled() {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "access approval is disabled"})
		return false
	}
	if h.Access == nil {
		writeDBUnavailable(w)
		return false
	}
	return true
}

// RequestAccess handles POST /api/v1/access/request (protected by jwtAuthMiddleware).
// Requires a "user:" JWT; uses the account's email and deduplicates pending requests.
func (h *Handler) RequestAccess(w http.ResponseWriter, r *http.Request) {
	if !h.accessEnabled(w) {
		return
	}
	sub := tokenSubject(r)
	if !strings.HasPrefix(sub, userSubjectPrefix) {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "sign in to request more scans",
			"code":  "login_required",
		})
		return
	}
	uid := strings.TrimPrefix(sub, userSubjectPrefix)
	user, err := h.Access.GetUser(uid)
	if err != nil {
		if errors.Is(err, access.ErrNotFound) {
			unauthorized(w)
			return
		}
		if h.Logger != nil {
			h.Logger.Error("failed to look up user for access request", zap.Error(err))
		}
		writeDBUnavailable(w)
		return
	}
	if user.Status != access.UserStatusActive {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "your account has been blocked",
			"code":  "blocked",
		})
		return
	}

	rec, key, created, err := h.Access.Create(user.Email)
	if err != nil {
		if h.Logger != nil {
			h.Logger.Error("failed to save access request", zap.Error(err))
		}
		writeDBUnavailable(w)
		return
	}
	if created && h.AccessMailer != nil {
		reviewURL := h.publicBaseURL(r) + "/api/v1/access/review?" + url.Values{"id": {rec.ID}, "key": {key}}.Encode()
		subject, body := access.OwnerRequestEmail(rec, reviewURL, config.GetAccessDefaultScans())
		if err := h.AccessMailer.Send(config.GetLeadNotifyEmail(), subject, body); err != nil && h.Logger != nil {
			h.Logger.Warn("failed to send access request email", zap.Error(err))
		}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "status": access.StatusPending})
}

// AccessSession handles POST /api/v1/access/session: exchanges a legacy access code
// for a scan token. Kept during switchover until Phase 4; logs every use.
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
		if isAccessDomainError(err) {
			writeAccessError(w, err)
			return
		}
		writeDBUnavailable(w)
		return
	}
	if h.Logger != nil {
		h.Logger.Info("legacy access/session used", zap.String("request_id", rec.ID), zap.String("email", rec.Email))
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

// meteredAuth wraps extension scan routes (/scan/client).
func (h *Handler) meteredAuth(next http.HandlerFunc) http.HandlerFunc {
	return h.metered(next)
}

// appMeteredAuth wraps web app scan routes (/scan, /crawl).
func (h *Handler) appMeteredAuth(next http.HandlerFunc) http.HandlerFunc {
	return h.metered(next)
}

func (h *Handler) metered(next http.HandlerFunc) http.HandlerFunc {
	return jwtAuthMiddleware(func(w http.ResponseWriter, r *http.Request) {
		sub := tokenSubject(r)
		if !config.GetAccessApprovalEnabled() || sub == "admin" {
			next(w, r)
			return
		}

		if strings.HasPrefix(sub, userSubjectPrefix) {
			if h.Access == nil {
				writeDBUnavailable(w)
				return
			}
			uid := strings.TrimPrefix(sub, userSubjectPrefix)
			user, err := h.Access.ReserveUserScan(uid)
			if err != nil {
				switch {
				case errors.Is(err, access.ErrNotFound):
					writeJSON(w, http.StatusForbidden, map[string]string{
						"error": "sign in to scan",
						"code":  "login_required",
					})
				case errors.Is(err, access.ErrUserBlocked):
					writeJSON(w, http.StatusForbidden, map[string]string{
						"error": "your account has been blocked",
						"code":  "blocked",
					})
				case errors.Is(err, access.ErrExhausted):
					writeJSON(w, http.StatusForbidden, map[string]string{
						"error": "you have used all your scans; request more to keep scanning",
						"code":  "scans_used_up",
					})
				default:
					if h.Logger != nil {
						h.Logger.Error("failed to reserve user scan", zap.String("user_id", uid), zap.Error(err))
					}
					writeDBUnavailable(w)
				}
				return
			}
			r = r.WithContext(withScansRemaining(r.Context(), user.Remaining()))
			lrw := &loggingResponseWriter{ResponseWriter: w, status: http.StatusOK}
			next(lrw, r)
			if lrw.status >= 400 {
				if rerr := h.Access.RefundUserScan(uid); rerr != nil && h.Logger != nil {
					h.Logger.Warn("failed to refund user scan", zap.String("user_id", uid), zap.Error(rerr))
				}
			}
			return
		}

		// Legacy access:<id> token support during switchover until Phase 4.
		if strings.HasPrefix(sub, accessSubjectPrefix) {
			if h.Access == nil {
				writeDBUnavailable(w)
				return
			}
			id := strings.TrimPrefix(sub, accessSubjectPrefix)
			rec, err := h.Access.Consume(id)
			if err != nil {
				if isAccessDomainError(err) {
					writeAccessError(w, err)
					return
				}
				if h.Logger != nil {
					h.Logger.Error("failed to reserve legacy access scan", zap.String("id", id), zap.Error(err))
				}
				writeDBUnavailable(w)
				return
			}
			r = r.WithContext(withScansRemaining(r.Context(), rec.Remaining()))
			lrw := &loggingResponseWriter{ResponseWriter: w, status: http.StatusOK}
			next(lrw, r)
			if lrw.status >= 400 {
				if rerr := h.Access.Refund(id); rerr != nil && h.Logger != nil {
					h.Logger.Warn("failed to refund legacy access scan", zap.String("id", id), zap.Error(rerr))
				}
			}
			return
		}

		// Guest or unknown subject while access approval is enabled.
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "sign in to scan",
			"code":  "login_required",
		})
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
{{if eq .Status "approved"}}<dt>Scans added</dt><dd>{{.ScansGranted}}</dd>{{end}}
</dl>{{end}}
{{if .CanDecide}}
<form method="post" action="/api/v1/access/review">
<input type="hidden" name="id" value="{{.Req.ID}}"><input type="hidden" name="key" value="{{.Key}}">
<label for="max_scans">Scans to add</label>
<input id="max_scans" name="max_scans" type="number" min="1" max="10000" value="{{.DefaultScans}}" required>
<div class="row">
<button class="approve" name="action" value="approve" type="submit">Approve &amp; add scans</button>
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
		msg = "Approved. Added " + strconv.Itoa(rec.ScansGranted) + " scans to " + rec.Email + "."
	}
	renderReview(w, http.StatusOK, reviewView{Req: rec, Message: msg, Tone: "ok"})
}

// decide applies an owner decision and, on approval, adds scans to the user's account and emails them.
func (h *Handler) decide(r *http.Request, id, action string, scans int) (*access.Request, error) {
	switch action {
	case "approve":
		if scans <= 0 {
			scans = config.GetAccessDefaultScans()
		}
		if scans > 10000 {
			return nil, errors.New("scans to allow must be 10000 or fewer")
		}
		rec, _, err := h.Access.ApproveUserScans(id, scans)
		if err != nil {
			return nil, err
		}
		if h.AccessMailer != nil {
			subject, body := access.UserScansAddedEmail(scans, h.publicBaseURL(r)+"/app")
			if err := h.AccessMailer.Send(rec.Email, subject, body); err != nil && h.Logger != nil {
				h.Logger.Warn("failed to send scans-added email", zap.Error(err))
			}
		}
		if h.Logger != nil {
			h.Logger.Info("access request approved", zap.String("id", id), zap.Int("scans_granted", scans))
		}
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
	ID           string `json:"id"`
	Email        string `json:"email"`
	Status       string `json:"status"`
	Kind         string `json:"kind,omitempty"`
	RequestedAt  string `json:"requested_at"`
	DecidedAt    string `json:"decided_at,omitempty"`
	ScansGranted int    `json:"scans_granted,omitempty"`
	MaxScans     int    `json:"max_scans,omitempty"`
	UsedScans    int    `json:"used_scans,omitempty"`
	LastUsed     string `json:"last_used,omitempty"`
}

func toAccessRow(q *access.Request) accessRow {
	return accessRow{
		ID:           q.ID,
		Email:        q.Email,
		Status:       q.Status,
		Kind:         q.Kind,
		RequestedAt:  q.RequestedAt,
		DecidedAt:    q.DecidedAt,
		ScansGranted: q.ScansGranted,
		MaxScans:     q.MaxScans,
		UsedScans:    q.UsedScans,
		LastUsed:     q.LastUsed,
	}
}

type userRow struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	ScansUsed    int    `json:"scans_used"`
	ScansAllowed int    `json:"scans_allowed"`
	ScansLeft    int    `json:"scans_left"`
	Status       string `json:"status"`
	LastScanAt   string `json:"last_scan_at,omitempty"`
	LastLoginAt  string `json:"last_login_at,omitempty"`
	CreatedAt    string `json:"created_at"`
}

func toUserRow(u *access.User) userRow {
	return userRow{
		ID:           u.ID,
		Email:        u.Email,
		ScansUsed:    u.ScansUsed,
		ScansAllowed: u.ScansAllowed,
		ScansLeft:    u.Remaining(),
		Status:       u.Status,
		LastScanAt:   u.LastScanAt,
		LastLoginAt:  u.LastLoginAt,
		CreatedAt:    u.CreatedAt,
	}
}

// ListAccess handles GET /api/v1/admin/access.
func (h *Handler) ListAccess(w http.ResponseWriter, r *http.Request) {
	rows := []accessRow{}
	users := []userRow{}
	if h.Access != nil {
		reqs, err := h.Access.List()
		if err != nil {
			if h.Logger != nil {
				h.Logger.Error("failed to list access requests", zap.Error(err))
			}
			writeDBUnavailable(w)
			return
		}
		for _, q := range reqs {
			rows = append(rows, toAccessRow(q))
		}
		userList, err := h.Access.ListUsers()
		if err != nil {
			if h.Logger != nil {
				h.Logger.Error("failed to list users", zap.Error(err))
			}
			writeDBUnavailable(w)
			return
		}
		for _, u := range userList {
			users = append(users, toUserRow(u))
		}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"enabled":       config.GetAccessApprovalEnabled(),
		"default_scans": config.GetAccessDefaultScans(),
		"trial_scans":   config.GetAccessTrialScans(),
		"requests":      rows,
		"users":         users,
	})
}

// AdminDecideAccess handles POST /api/v1/admin/access/{id}/{action} (approve|deny|revoke).
func (h *Handler) AdminDecideAccess(w http.ResponseWriter, r *http.Request) {
	if h.Access == nil {
		writeDBUnavailable(w)
		return
	}
	var body struct {
		Scans    int `json:"scans"`
		MaxScans int `json:"max_scans"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body)
	scans := body.Scans
	if scans <= 0 {
		scans = body.MaxScans
	}
	rec, err := h.decide(r, chi.URLParam(r, "id"), chi.URLParam(r, "action"), scans)
	if err != nil {
		status := http.StatusBadRequest
		switch {
		case errors.Is(err, access.ErrNotFound):
			status = http.StatusNotFound
		case errors.Is(err, access.ErrNotPending):
			status = http.StatusConflict
		}
		writeError(w, status, err.Error(), "")
		return
	}
	writeJSON(w, http.StatusOK, toAccessRow(rec))
}

// AdminBlockUser handles POST /api/v1/admin/users/{id}/block.
func (h *Handler) AdminBlockUser(w http.ResponseWriter, r *http.Request) {
	if h.Access == nil {
		writeDBUnavailable(w)
		return
	}
	u, err := h.Access.BlockUser(chi.URLParam(r, "id"))
	if err != nil {
		if errors.Is(err, access.ErrNotFound) {
			writeError(w, http.StatusNotFound, err.Error(), "")
			return
		}
		writeDBUnavailable(w)
		return
	}
	writeJSON(w, http.StatusOK, toUserRow(u))
}

// AdminUnblockUser handles POST /api/v1/admin/users/{id}/unblock.
func (h *Handler) AdminUnblockUser(w http.ResponseWriter, r *http.Request) {
	if h.Access == nil {
		writeDBUnavailable(w)
		return
	}
	u, err := h.Access.UnblockUser(chi.URLParam(r, "id"))
	if err != nil {
		if errors.Is(err, access.ErrNotFound) {
			writeError(w, http.StatusNotFound, err.Error(), "")
			return
		}
		writeDBUnavailable(w)
		return
	}
	writeJSON(w, http.StatusOK, toUserRow(u))
}
