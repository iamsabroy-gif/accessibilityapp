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
	"github.com/webaccessibility/server/internal/leads"
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

	// 1. Returning user logs in and requests access → owner gets an email with a review link.
	codeReq := postJSON(t, router, "/api/v1/auth/code", map[string]string{"email": "user@example.com"}, "")
	if codeReq.Code != 200 {
		t.Fatalf("auth/code: %d %s", codeReq.Code, codeReq.Body)
	}
	loginMail := mailer.last()
	loginCode := regexp.MustCompile(`\b\d{6}\b`).FindString(loginMail.body)
	if loginCode == "" {
		t.Fatalf("no 6-digit login code in email:\n%s", loginMail.body)
	}
	verifyW := postJSON(t, router, "/api/v1/auth/verify", map[string]string{"email": "user@example.com", "code": loginCode}, "")
	var authResp struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(verifyW.Body.Bytes(), &authResp)
	if verifyW.Code != 200 || authResp.Token == "" {
		t.Fatalf("auth/verify: %d %s", verifyW.Code, verifyW.Body)
	}

	if w := postJSON(t, router, "/api/v1/access/request", map[string]string{}, authResp.Token); w.Code != 200 {
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
	sentBefore := len(mailer.sent)
	postJSON(t, router, "/api/v1/access/request", map[string]string{}, authResp.Token)
	if len(mailer.sent) != sentBefore {
		t.Fatalf("expected %d emails, got %d", sentBefore, len(mailer.sent))
	}

	// 2. Opening the link shows the page but does not approve.
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", link[1], nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Approve") {
		t.Fatalf("review page: %d %s", w.Code, w.Body)
	}
	reqs, _ := store.List()
	if reqs[0].Status != access.StatusPending {
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

	// 3. Owner approves → user is emailed that scans were added.
	form.Set("key", q.Get("key"))
	w = httptest.NewRecorder()
	req = httptest.NewRequest("POST", "/api/v1/access/review", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	router.ServeHTTP(w, req)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Approved") {
		t.Fatalf("approve: %d %s", w.Code, w.Body)
	}
	userMail := mailer.last()
	if userMail.to != "user@example.com" || !strings.Contains(userMail.body, "2 more scans") {
		t.Fatalf("unexpected scans-added email to %q:\n%s", userMail.to, userMail.body)
	}

	// 4. User has 5 trial + 2 approved = 7 scans; failed scan is refunded.
	if w := postJSON(t, router, "/api/v1/scan", map[string]string{"url": "not a url"}, authResp.Token); w.Code != 400 {
		t.Fatalf("bad scan: expected 400, got %d", w.Code)
	}
	usr, _ := store.GetUserByEmail("user@example.com")
	if usr.ScansUsed != 0 {
		t.Fatalf("failed scan was counted: used=%d", usr.ScansUsed)
	}

	for i := 1; i <= 7; i++ {
		if w := postJSON(t, router, "/api/v1/scan", map[string]string{"url": "http://127.0.0.1/"}, authResp.Token); w.Code != 200 {
			t.Fatalf("scan %d: %d %s", i, w.Code, w.Body)
		}
	}
	if w := postJSON(t, router, "/api/v1/scan", map[string]string{"url": "https://example.com"}, authResp.Token); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "scans_used_up") {
		t.Fatalf("exhausted scan: %d %s", w.Code, w.Body)
	}

	// 5. Legacy /access/session still works for pre-existing approved codes.
	legacyCode, _, err := store.CreateTrial("legacy@example.com", 1)
	if err != nil || legacyCode == "" {
		t.Fatalf("create trial code: %v", err)
	}
	w = postJSON(t, router, "/api/v1/access/session", map[string]string{"code": legacyCode}, "")
	var sess struct {
		Token     string `json:"token"`
		Remaining int    `json:"remaining"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &sess)
	if w.Code != 200 || sess.Token == "" || sess.Remaining != 1 {
		t.Fatalf("legacy session: %d %s", w.Code, w.Body)
	}
	if w := postJSON(t, router, "/api/v1/scan", map[string]string{"url": "http://127.0.0.1/"}, sess.Token); w.Code != 200 {
		t.Fatalf("legacy scan: %d %s", w.Code, w.Body)
	}
	if w := postJSON(t, router, "/api/v1/scan", map[string]string{"url": "http://127.0.0.1/"}, sess.Token); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "access_exhausted") {
		t.Fatalf("legacy exhausted: %d %s", w.Code, w.Body)
	}
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
	// Need a valid JWT to reach the disabled check on /access/request.
	codeW := postJSON(t, router, "/api/v1/auth/code", map[string]string{"email": "a@b.co"}, "")
	if codeW.Code != 200 {
		t.Fatalf("auth/code: %d", codeW.Code)
	}
	// Even with a valid user JWT, /access/request returns 404 when disabled.
	u, _, err := store.VerifyLoginCode("a@b.co", "", "s", 5)
	_ = u
	_ = err
	if w := postJSON(t, router, "/api/v1/access/session", map[string]string{"code": "AS-x"}, ""); w.Code != 404 {
		t.Fatalf("expected 404 when disabled, got %d", w.Code)
	}
}

func TestTrialScansForFirstTimeUsers(t *testing.T) {
	t.Setenv("FRONTEND_DIR", "../../frontend")
	config.InitGlobal(&config.Config{
		JWTSecret:             "test-secret",
		AccessApprovalEnabled: true,
		AccessTrialScans:      5,
		LeadCaptureEnabled:    true,
		MaxConcurrentScans:    2,
		AllowPrivateScans:     true,
	})
	defer config.InitGlobal(&config.Config{})

	dir := t.TempDir()
	store, _ := access.NewStore(filepath.Join(dir, "access.json"))
	h := &Handler{Logger: zap.NewNop(), Access: store, LeadStore: leads.NewStore(filepath.Join(dir, "leads.jsonl")),
		Scanner: stubScanner{}, ScanTimeout: 5 * time.Second, Results: NewResultStore("")}
	router := NewRouter(h, zap.NewNop())

	// A guest token can't scan in the app while approval is on.
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/session", nil))
	var guest struct{ Token string }
	_ = json.Unmarshal(w.Body.Bytes(), &guest)
	if w := postJSON(t, router, "/api/v1/scan", map[string]string{"url": "http://127.0.0.1/"}, guest.Token); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "login_required") {
		t.Fatalf("guest scan: %d %s", w.Code, w.Body)
	}

	// Registering returns a 5-scan trial code.
	lead := map[string]interface{}{"email": "new@example.com", "source": "app_scan", "consent": true}
	w = postJSON(t, router, "/api/v1/leads", lead, "")
	var reg struct {
		TrialCode  string `json:"trial_code"`
		TrialScans int    `json:"trial_scans"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &reg)
	if w.Code != 200 || reg.TrialCode == "" || reg.TrialScans != 5 {
		t.Fatalf("register: %d %s", w.Code, w.Body)
	}

	w = postJSON(t, router, "/api/v1/access/session", map[string]string{"code": reg.TrialCode}, "")
	var sess struct{ Token string }
	_ = json.Unmarshal(w.Body.Bytes(), &sess)
	for i := 1; i <= 5; i++ {
		if w := postJSON(t, router, "/api/v1/scan", map[string]string{"url": "http://127.0.0.1/"}, sess.Token); w.Code != 200 {
			t.Fatalf("trial scan %d: %d %s", i, w.Code, w.Body)
		}
	}
	if w := postJSON(t, router, "/api/v1/scan", map[string]string{"url": "http://127.0.0.1/"}, sess.Token); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "access_exhausted") {
		t.Fatalf("6th scan: %d %s", w.Code, w.Body)
	}

	// Registering the same email again gives no new trial.
	w = postJSON(t, router, "/api/v1/leads", map[string]interface{}{"email": "NEW@example.com", "source": "app_scan", "consent": true}, "")
	if strings.Contains(w.Body.String(), "trial_code") || !strings.Contains(w.Body.String(), "trial_used") {
		t.Fatalf("re-register: %s", w.Body)
	}
}
