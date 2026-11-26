package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/webaccessibility/server/internal/access"
	"github.com/webaccessibility/server/internal/config"
	"github.com/webaccessibility/server/internal/models"
	"go.uber.org/zap"
)

type stubScanner struct{}

func (stubScanner) Scan(_ context.Context, url, _ string, _ int) (*models.ScanResult, error) {
	return &models.ScanResult{URL: url}, nil
}

type sentMail struct{ to, subject, body string }

type fakeMailer struct {
	mu   sync.Mutex
	sent []sentMail
}

func (f *fakeMailer) Send(to, subject, body string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, sentMail{to, subject, body})
	return nil
}

func (f *fakeMailer) last() sentMail {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.sent[len(f.sent)-1]
}

func postJSON(t *testing.T, h http.Handler, path string, body interface{}, token string) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestAccessApprovalFlow(t *testing.T) {
	t.Setenv("FRONTEND_DIR", "../../frontend")
	config.InitGlobal(&config.Config{
		JWTSecret:             "test-secret",
		AccessApprovalEnabled: true,
		AccessDefaultScans:    2,
		AccessCodeTTLDays:     30,
		PublicBaseURL:         "https://scan.example.com",
		LeadNotifyEmail:       "owner@example.com",
		MaxConcurrentScans:    2,
		AllowPrivateScans:     true,
	})
	defer config.InitGlobal(&config.Config{})

	store, err := access.NewStore(filepath.Join(t.TempDir(), "access.json"))
	if err != nil {
		t.Fatal(err)
	}
	mailer := &fakeMailer{}
	h := &Handler{Logger: zap.NewNop(), Access: store, AccessMailer: mailer,
		Scanner: stubScanner{}, ScanTimeout: 5 * time.Second, Results: NewResultStore("")}
	router := NewRouter(h, zap.NewNop())

	// 1. Returning user requests access → owner gets an email with a review link.
	if w := postJSON(t, router, "/api/v1/access/request", map[string]string{"email": "user@example.com"}, ""); w.Code != 200 {
		t.Fatalf("request: %d %s", w.Code, w.Body)
	}
	ownerMail := mailer.last()
	if ownerMail.to != "owner@example.com" {
		t.Fatalf("owner email went to %q", ownerMail.to)
	}
	link := regexp.MustCompile(`https://scan\.example\.com(/api/v1/access/review\?\S+)`).FindStringSubmatch(ownerMail.body)
	if link == nil {
		t.Fatalf("no review link in owner email:\n%s", ownerMail.body)
	}

	// A second click while pending does not email the owner again.
	postJSON(t, router, "/api/v1/access/request", map[string]string{"email": "USER@example.com"}, "")
	if len(mailer.sent) != 1 {
		t.Fatalf("expected 1 email, got %d", len(mailer.sent))
	}

	// 2. Opening the link shows the page but does not approve.
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", link[1], nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Approve") {
		t.Fatalf("review page: %d %s", w.Code, w.Body)
	}
	if store.List()[0].Status != access.StatusPending {
		t.Fatal("GET must not change the request")
	}

	// A wrong key is refused.
	u, _ := url.Parse(link[1])
	q := u.Query()
	form := url.Values{"id": {q.Get("id")}, "key": {"wrong"}, "action": {"approve"}, "max_scans": {"2"}}
	w = httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/v1/access/review", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("wrong key: expected 404, got %d", w.Code)
	}

	// 3. Owner approves → user is emailed a code.
	form.Set("key", q.Get("key"))
	w = httptest.NewRecorder()
	req = httptest.NewRequest("POST", "/api/v1/access/review", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	router.ServeHTTP(w, req)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Approved") {
		t.Fatalf("approve: %d %s", w.Code, w.Body)
	}
	userMail := mailer.last()
	if userMail.to != "user@example.com" {
		t.Fatalf("code email went to %q", userMail.to)
	}
	code := regexp.MustCompile(`AS-[A-Za-z0-9_-]+`).FindString(userMail.body)
	if code == "" {
		t.Fatalf("no code in user email:\n%s", userMail.body)
	}

	// 4. Code → scan token; each successful scan uses one of the 2 scans.
	w = postJSON(t, router, "/api/v1/access/session", map[string]string{"code": code}, "")
	var sess struct {
		Token     string `json:"token"`
		Remaining int    `json:"remaining"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &sess)
	if w.Code != 200 || sess.Token == "" || sess.Remaining != 2 {
		t.Fatalf("session: %d %s", w.Code, w.Body)
	}

	// A failed scan (bad URL) does not use a scan.
	if w := postJSON(t, router, "/api/v1/scan", map[string]string{"url": "not a url"}, sess.Token); w.Code != 400 {
		t.Fatalf("bad scan: expected 400, got %d", w.Code)
	}
	if got := store.List()[0].UsedScans; got != 0 {
		t.Fatalf("failed scan was counted: used=%d", got)
	}

	// Successful scans are counted.
	for i := 1; i <= 2; i++ {
		if w := postJSON(t, router, "/api/v1/scan", map[string]string{"url": "http://127.0.0.1/"}, sess.Token); w.Code != 200 {
			t.Fatalf("scan %d: %d %s", i, w.Code, w.Body)
		}
		if got := store.List()[0].UsedScans; got != i {
			t.Fatalf("after scan %d: used=%d", i, got)
		}
	}

	// 5. Used up → scan routes refuse the token and the code no longer exchanges.
	w = postJSON(t, router, "/api/v1/scan", map[string]string{"url": "https://example.com"}, sess.Token)
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "access_exhausted") {
		t.Fatalf("exhausted scan: %d %s", w.Code, w.Body)
	}
	w = postJSON(t, router, "/api/v1/access/session", map[string]string{"code": code}, "")
	if w.Code != http.StatusForbidden {
		t.Fatalf("exhausted session: expected 403, got %d", w.Code)
	}

	// Unknown codes are refused.
	if w := postJSON(t, router, "/api/v1/access/session", map[string]string{"code": "AS-nope"}, ""); w.Code != http.StatusForbidden {
		t.Fatalf("unknown code: expected 403, got %d", w.Code)
	}
}

func TestAccessDisabled(t *testing.T) {
	t.Setenv("FRONTEND_DIR", "../../frontend")
	config.InitGlobal(&config.Config{JWTSecret: "s"})
	defer config.InitGlobal(&config.Config{})
	store, _ := access.NewStore(filepath.Join(t.TempDir(), "a.json"))
	router := NewRouter(&Handler{Logger: zap.NewNop(), Access: store}, zap.NewNop())
	if w := postJSON(t, router, "/api/v1/access/request", map[string]string{"email": "a@b.co"}, ""); w.Code != 404 {
		t.Fatalf("expected 404 when disabled, got %d", w.Code)
	}
}
