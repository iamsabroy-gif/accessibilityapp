package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/go-chi/httprate"
	"github.com/golang-jwt/jwt/v4"
	"github.com/webaccessibility/server/internal/access"
	"github.com/webaccessibility/server/internal/config"
	"go.uber.org/zap"
)

const userSubjectPrefix = "user:"

type scansRemainingKey struct{}

func withScansRemaining(ctx context.Context, n int) context.Context {
	return context.WithValue(ctx, scansRemainingKey{}, n)
}

func scansRemainingFromContext(ctx context.Context) *int {
	if v, ok := ctx.Value(scansRemainingKey{}).(int); ok {
		return &v
	}
	return nil
}

func (h *Handler) ensureAuthLimiters() {
	h.authLimitOnce.Do(func() {
		h.codeEmailLimiter = httprate.NewRateLimiter(3, time.Hour,
			httprate.WithLimitHandler(func(w http.ResponseWriter, r *http.Request) {
				writeError(w, http.StatusTooManyRequests, "too many code requests",
					"at most 3 login codes per email per hour; please wait before trying again")
			}),
		)
		h.newAccountIPLimiter = httprate.NewRateLimiter(3, 24*time.Hour,
			httprate.WithLimitHandler(func(w http.ResponseWriter, r *http.Request) {
				writeError(w, http.StatusTooManyRequests, "too many new accounts",
					"at most 3 new accounts per IP per day; please try again tomorrow")
			}),
		)
	})
}

func parseSingleEmail(raw string) (string, bool) {
	email := strings.TrimSpace(raw)
	if email == "" || len(email) > 254 {
		return "", false
	}
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email {
		return "", false
	}
	return email, true
}

// tokenSubject returns the Subject of the request's bearer token. Only call it
// behind jwtAuthMiddleware, which has already verified the signature.
func tokenSubject(r *http.Request) string {
	claims := &jwt.StandardClaims{}
	tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	_, _, _ = new(jwt.Parser).ParseUnverified(tok, claims)
	return claims.Subject
}

func writeDBUnavailable(w http.ResponseWriter) {
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{
		"error": "accounts are unavailable, try again shortly",
		"code":  "db_unavailable",
	})
}

// AuthCode handles POST /api/v1/auth/code {email}.
// It validates a single plain email, enforces 3 codes/email/hour in memory,
// generates and emails a 6-digit HMAC-hashed code, and always returns 200 {"ok":true}.
func (h *Handler) AuthCode(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
	var req struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "")
		return
	}
	email, ok := parseSingleEmail(req.Email)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid email address", "")
		return
	}
	if h.Access == nil {
		writeDBUnavailable(w)
		return
	}

	h.ensureAuthLimiters()
	norm := strings.ToLower(email)
	if h.codeEmailLimiter.RespondOnLimit(w, r, norm) {
		return
	}

	code, err := h.Access.CreateLoginCode(email, config.GetSecret(), access.DefaultLoginCodeTTL)
	if err != nil {
		if h.Logger != nil {
			h.Logger.Error("failed to create login code", zap.Error(err))
		}
		writeDBUnavailable(w)
		return
	}

	if h.AccessMailer != nil {
		subject, body := access.LoginCodeEmail(code, access.DefaultLoginCodeTTL)
		if err := h.AccessMailer.Send(email, subject, body); err != nil && h.Logger != nil {
			h.Logger.Warn("failed to send login code email", zap.Error(err))
		}
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// AuthVerify handles POST /api/v1/auth/verify {email, code}.
// It verifies the 6-digit code, upserts the user (enforcing 3 new accounts/IP/day),
// and returns a session JWT with subject "user:<id>".
func (h *Handler) AuthVerify(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
	var req struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "")
		return
	}
	email, ok := parseSingleEmail(req.Email)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid email address", "")
		return
	}
	code := strings.TrimSpace(req.Code)
	if code == "" {
		writeError(w, http.StatusBadRequest, "code is required", "")
		return
	}
	if h.Access == nil {
		writeDBUnavailable(w)
		return
	}
	secret := config.GetSecret()
	if secret == "" {
		writeError(w, http.StatusInternalServerError, "JWT secret is not configured on the server", "")
		return
	}

	h.ensureAuthLimiters()
	ip := getClientIP(r)

	// Check new-account-per-IP limit only when the email does not yet have an account,
	// so existing users on shared IPs are never blocked from logging in.
	_, lookupErr := h.Access.GetUserByEmail(email)
	if lookupErr != nil && !errors.Is(lookupErr, access.ErrNotFound) {
		if h.Logger != nil {
			h.Logger.Error("failed to look up user", zap.Error(lookupErr))
		}
		writeDBUnavailable(w)
		return
	}
	if errors.Is(lookupErr, access.ErrNotFound) {
		if _, rate, err := h.newAccountIPLimiter.Status(ip); err == nil && rate >= 3 {
			writeError(w, http.StatusTooManyRequests, "too many new accounts",
				"at most 3 new accounts per IP per day; please try again tomorrow")
			return
		}
	}

	user, created, err := h.Access.VerifyLoginCode(email, code, secret, config.GetAccessTrialScans())
	if err != nil {
		switch {
		case errors.Is(err, access.ErrTooManyAttempts):
			writeJSON(w, http.StatusTooManyRequests, map[string]string{
				"error": err.Error(),
				"code":  "too_many_attempts",
			})
		case errors.Is(err, access.ErrInvalidLoginCode):
			writeJSON(w, http.StatusUnauthorized, map[string]string{
				"error": err.Error(),
				"code":  "invalid_code",
			})
		default:
			if h.Logger != nil {
				h.Logger.Error("failed to verify login code", zap.Error(err))
			}
			writeDBUnavailable(w)
		}
		return
	}

	if created {
		_ = h.newAccountIPLimiter.Counter().Increment(ip, time.Now().UTC().Truncate(24*time.Hour))
	}

	if user.Status != access.UserStatusActive {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "your account has been blocked",
			"code":  "blocked",
		})
		return
	}

	days := config.GetAuthSessionDays()
	if days <= 0 {
		days = 30
	}
	ttl := time.Duration(days) * 24 * time.Hour
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.StandardClaims{
		ExpiresAt: time.Now().Add(ttl).Unix(),
		Issuer:    "webaccessibility",
		Subject:   userSubjectPrefix + user.ID,
	})
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to sign token", "")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token":      signed,
		"expires_in": int(ttl.Seconds()),
		"email":      user.Email,
		"scans_left": user.Remaining(),
	})
}

// AuthMe handles GET /api/v1/auth/me (protected by jwtAuthMiddleware).
func (h *Handler) AuthMe(w http.ResponseWriter, r *http.Request) {
	sub := tokenSubject(r)
	if !strings.HasPrefix(sub, userSubjectPrefix) {
		unauthorized(w)
		return
	}
	if h.Access == nil {
		writeDBUnavailable(w)
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
			h.Logger.Error("failed to load user for /auth/me", zap.Error(err))
		}
		writeDBUnavailable(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"email":      user.Email,
		"scans_left": user.Remaining(),
	})
}
