package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/golang-jwt/jwt/v4"
	"github.com/webaccessibility/server/internal/access"
	"github.com/webaccessibility/server/internal/config"
	"github.com/webaccessibility/server/internal/leads"
	"go.uber.org/zap"
)

// ExtensionFreeScans is the lifetime number of free extension scans per client IP
// (enforced while access approval is switched on in the admin console).
const ExtensionFreeScans = 5

// ExtQuota counts extension scans per hashed client IP. Counts are kept in a
// JSON file so the lifetime cap survives restarts; an empty path keeps them in memory.
type ExtQuota struct {
	path   string
	mu     sync.Mutex
	counts map[string]int
}

// NewExtQuota loads existing counts from path (a missing file means no scans yet).
func NewExtQuota(path string) *ExtQuota {
	q := &ExtQuota{path: path, counts: map[string]int{}}
	if path != "" {
		if data, err := os.ReadFile(path); err == nil {
			_ = json.Unmarshal(data, &q.counts)
		}
	}
	return q
}

// Take uses one free scan for key and returns how many are left after it.
// ok is false when none were left. A failed save is returned as err, but the
// scan is still counted in memory.
func (q *ExtQuota) Take(key string) (remaining int, ok bool, err error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.counts[key] >= ExtensionFreeScans {
		return 0, false, nil
	}
	q.counts[key]++
	return ExtensionFreeScans - q.counts[key], true, writeJSONFile(q.path, q.counts)
}

// writeJSONFile writes v atomically (temp file + rename). An empty path is a no-op.
func writeJSONFile(path string, v interface{}) error {
	if path == "" {
		return nil
	}
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// tokenSubject returns the Subject of the request's bearer token. Only call it
// behind jwtAuthMiddleware, which has already verified the signature.
func tokenSubject(r *http.Request) string {
	claims := &jwt.StandardClaims{}
	tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	_, _, _ = new(jwt.Parser).ParseUnverified(tok, claims)
	return claims.Subject
}

// extensionScanAllowance decides whether an extension scan may run and returns
// how many scans are left after it (nil when unlimited). Access-code tokens are
// counted by meteredAuth after the scan; guest tokens use the per-IP free scans
// while access approval is switched on. On refusal it writes the 403 itself.
func (h *Handler) extensionScanAllowance(w http.ResponseWriter, r *http.Request) (remaining *int, ok bool) {
	sub := tokenSubject(r)
	if strings.HasPrefix(sub, accessSubjectPrefix) {
		if h.Access == nil {
			writeAccessError(w, access.ErrInvalidCode)
			return nil, false
		}
		rec, err := h.Access.Status(strings.TrimPrefix(sub, accessSubjectPrefix))
		if err != nil {
			writeAccessError(w, err)
			return nil, false
		}
		n := rec.Remaining() - 1 // this scan is counted once it succeeds
		return &n, true
	}
	if sub == "admin" || !config.GetAccessApprovalEnabled() {
		return nil, true
	}

	h.quotaOnce.Do(func() {
		if h.ExtQuota == nil {
			h.ExtQuota = NewExtQuota("")
		}
	})
	n, ok, err := h.ExtQuota.Take(leads.HashIP(getClientIP(r), config.GetLeadIPSalt()))
	if err != nil {
		h.Logger.Error("failed to persist extension scan count", zap.Error(err))
	}
	if !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": fmt.Sprintf("you have used the %d free extension scans; request an access code to keep scanning", ExtensionFreeScans),
			"code":  "free_scans_used",
		})
		return nil, false
	}
	return &n, true
}
