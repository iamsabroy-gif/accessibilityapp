package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v4"
	"github.com/webaccessibility/server/internal/access"
	"github.com/webaccessibility/server/internal/config"
	"github.com/webaccessibility/server/internal/models"
	"github.com/webaccessibility/server/internal/scanner"
	"go.uber.org/zap"
)

type failingScanner struct{}

func (failingScanner) Scan(_ context.Context, _ string, _ string, _ int) (*models.ScanResult, error) {
	return nil, errors.New("browser crashed")
}

func setupPhase2Test(t *testing.T, sc scanner.Scanner) (http.Handler, *access.JSONStore, *fakeMailer) {
	t.Helper()
	t.Setenv("FRONTEND_DIR", "../../frontend")
	config.InitGlobal(&config.Config{
		JWTSecret:             "test-secret-phase2",
		AdminPassword:         "admin-pass",
		AccessApprovalEnabled: true,
		AccessDefaultScans:    10,
		AccessTrialScans:      5,
		AuthSessionDays:       30,
		PublicBaseURL:         "https://scan.example.com",
		LeadNotifyEmail:       "owner@example.com",
		MaxConcurrentScans:    20,
		AllowPrivateScans:     true,
	})
	t.Cleanup(func() { config.InitGlobal(&config.Config{}) })

	store := access.NewMemoryStore()
	mailer := &fakeMailer{}
	if sc == nil {
		sc = stubScanner{}
	}
	h := &Handler{
		Logger:       zap.NewNop(),
		Access:       store,
		AccessMailer: mailer,
		Scanner:      sc,
		ScanTimeout:  5 * time.Second,
		Results:      NewResultStore(""),
	}
	return NewRouter(h, zap.NewNop()), store, mailer
}

func loginTestUser(t *testing.T, router http.Handler, mailer *fakeMailer, email, ip string) (token string, scansLeft int) {
	t.Helper()
	req := httptest.NewRequest("POST", "/api/v1/auth/code", strings.NewReader(`{"email":"`+email+`"}`))
	req.Header.Set("Content-Type", "application/json")
	if ip != "" {
		req.Header.Set("X-Forwarded-For", ip)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("auth/code(%s): %d %s", email, w.Code, w.Body.String())
	}
	code := regexp.MustCompile(`\b\d{6}\b`).FindString(mailer.last().body)
	if code == "" {
		t.Fatalf("no 6-digit code in email: %s", mailer.last().body)
	}

	vreq := httptest.NewRequest("POST", "/api/v1/auth/verify", strings.NewReader(`{"email":"`+email+`","code":"`+code+`"}`))
	vreq.Header.Set("Content-Type", "application/json")
	if ip != "" {
		vreq.Header.Set("X-Forwarded-For", ip)
	}
	vw := httptest.NewRecorder()
	router.ServeHTTP(vw, vreq)
	if vw.Code != http.StatusOK {
		t.Fatalf("auth/verify(%s): %d %s", email, vw.Code, vw.Body.String())
	}
	var resp struct {
		Token     string `json:"token"`
		ScansLeft int    `json:"scans_left"`
		ExpiresIn int    `json:"expires_in"`
		Email     string `json:"email"`
	}
	_ = json.Unmarshal(vw.Body.Bytes(), &resp)
	if resp.Token == "" || resp.ExpiresIn != 30*86400 {
		t.Fatalf("unexpected verify response: %+v", resp)
	}
	return resp.Token, resp.ScansLeft
}

func makeAdminToken(secret string) string {
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.StandardClaims{
		ExpiresAt: time.Now().Add(30 * time.Minute).Unix(),
		Issuer:    "webaccessibility",
		Subject:   "admin",
	})
	s, _ := tok.SignedString([]byte(secret))
	return s
}

func TestAuthCodeValidationAndVerification(t *testing.T) {
	router, store, mailer := setupPhase2Test(t, nil)

	// Invalid email formats (including display name and header injection) are rejected.
	for _, bad := range []string{"", "not-an-email", "Name <a@b.com>", "a@b.com\r\nBcc: evil@x.com"} {
		w := postJSON(t, router, "/api/v1/auth/code", map[string]string{"email": bad}, "")
		if w.Code != http.StatusBadRequest {
			t.Errorf("bad email %q: expected 400, got %d", bad, w.Code)
		}
	}

	// Known and unknown emails return the exact same 200 {"ok":true}.
	w1 := postJSON(t, router, "/api/v1/auth/code", map[string]string{"email": "alice@example.com"}, "")
	if w1.Code != http.StatusOK || strings.TrimSpace(w1.Body.String()) != `{"ok":true}` {
		t.Fatalf("auth/code response = %d %s", w1.Code, w1.Body.String())
	}
	code := regexp.MustCompile(`\b\d{6}\b`).FindString(mailer.last().body)

	// Right code logs in and /auth/me returns email + scans_left.
	vw := postJSON(t, router, "/api/v1/auth/verify", map[string]string{"email": "alice@example.com", "code": code}, "")
	if vw.Code != http.StatusOK {
		t.Fatalf("verify right code: %d %s", vw.Code, vw.Body.String())
	}
	var vr struct {
		Token     string `json:"token"`
		ScansLeft int    `json:"scans_left"`
	}
	_ = json.Unmarshal(vw.Body.Bytes(), &vr)
	if vr.ScansLeft != 5 {
		t.Fatalf("expected 5 trial scans, got %d", vr.ScansLeft)
	}

	meReq := httptest.NewRequest("GET", "/api/v1/auth/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+vr.Token)
	meW := httptest.NewRecorder()
	router.ServeHTTP(meW, meReq)
	if meW.Code != http.StatusOK || !strings.Contains(meW.Body.String(), `"email":"alice@example.com"`) || !strings.Contains(meW.Body.String(), `"scans_left":5`) {
		t.Fatalf("/auth/me: %d %s", meW.Code, meW.Body.String())
	}

	// Same code cannot be used twice.
	if w := postJSON(t, router, "/api/v1/auth/verify", map[string]string{"email": "alice@example.com", "code": code}, ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("reuse code: expected 401, got %d", w.Code)
	}

	// Wrong code 5 times deletes the code; 6th attempt with the real code fails.
	_ = postJSON(t, router, "/api/v1/auth/code", map[string]string{"email": "alice@example.com"}, "")
	realCode := regexp.MustCompile(`\b\d{6}\b`).FindString(mailer.last().body)
	for i := 1; i <= 4; i++ {
		w := postJSON(t, router, "/api/v1/auth/verify", map[string]string{"email": "alice@example.com", "code": "000000"}, "")
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("wrong attempt %d: expected 401, got %d", i, w.Code)
		}
	}
	w5 := postJSON(t, router, "/api/v1/auth/verify", map[string]string{"email": "alice@example.com", "code": "000000"}, "")
	if w5.Code != http.StatusTooManyRequests {
		t.Fatalf("5th wrong attempt: expected 429, got %d %s", w5.Code, w5.Body.String())
	}
	if w := postJSON(t, router, "/api/v1/auth/verify", map[string]string{"email": "alice@example.com", "code": realCode}, ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("real code after 5 wrong attempts: expected 401, got %d", w.Code)
	}

	// Expired code is refused.
	expCode, err := store.CreateLoginCode("expired@example.com", config.GetSecret(), time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(10 * time.Millisecond)
	if w := postJSON(t, router, "/api/v1/auth/verify", map[string]string{"email": "expired@example.com", "code": expCode}, ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("expired code: expected 401, got %d", w.Code)
	}
}

func TestAuthRateLimits(t *testing.T) {
	router, _, mailer := setupPhase2Test(t, nil)

	// 4th code request for the same email in an hour is refused.
	for i := 1; i <= 3; i++ {
		if w := postJSON(t, router, "/api/v1/auth/code", map[string]string{"email": "ratelimit@example.com"}, ""); w.Code != http.StatusOK {
			t.Fatalf("code request %d: %d %s", i, w.Code, w.Body.String())
		}
	}
	if w := postJSON(t, router, "/api/v1/auth/code", map[string]string{"email": "ratelimit@example.com"}, ""); w.Code != http.StatusTooManyRequests {
		t.Fatalf("4th code request: expected 429, got %d %s", w.Code, w.Body.String())
	}

	// 4th new account from one IP in a day is refused, while existing user on same IP still logs in.
	ip := "198.51.100.42"
	for i := 1; i <= 3; i++ {
		email := "new" + string(rune('a'+i)) + "@example.com"
		_, _ = loginTestUser(t, router, mailer, email, ip)
	}
	// Request code for 4th new email, then verify from same IP -> 429.
	_ = postJSON(t, router, "/api/v1/auth/code", map[string]string{"email": "newe@example.com"}, "")
	code4 := regexp.MustCompile(`\b\d{6}\b`).FindString(mailer.last().body)
	req4 := httptest.NewRequest("POST", "/api/v1/auth/verify", strings.NewReader(`{"email":"newe@example.com","code":"`+code4+`"}`))
	req4.Header.Set("Content-Type", "application/json")
	req4.Header.Set("X-Forwarded-For", ip)
	w4 := httptest.NewRecorder()
	router.ServeHTTP(w4, req4)
	if w4.Code != http.StatusTooManyRequests {
		t.Fatalf("4th new account from same IP: expected 429, got %d %s", w4.Code, w4.Body.String())
	}

	// Existing user ("newb@example.com") can still log in from that IP.
	tok, _ := loginTestUser(t, router, mailer, "newb@example.com", ip)
	if tok == "" {
		t.Fatal("existing user should still be able to log in from same IP")
	}
}

func TestUserScanQuotaRefundAndConcurrency(t *testing.T) {
	router, store, mailer := setupPhase2Test(t, nil)
	token, left := loginTestUser(t, router, mailer, "scanner@example.com", "203.0.113.10")
	if left != 5 {
		t.Fatalf("expected 5 scans_left, got %d", left)
	}

	// Failed scan (400 bad URL) is refunded.
	if w := postJSON(t, router, "/api/v1/scan", map[string]string{"url": "not-a-url"}, token); w.Code != http.StatusBadRequest {
		t.Fatalf("bad url scan: expected 400, got %d", w.Code)
	}
	u, _ := store.GetUserByEmail("scanner@example.com")
	if u.Remaining() != 5 {
		t.Fatalf("expected 5 scans left after 400 refund, got %d", u.Remaining())
	}

	// Use 4 scans (3 via /scan, 1 via /scan/client), leaving 1 scan.
	for i := 0; i < 3; i++ {
		if w := postJSON(t, router, "/api/v1/scan", map[string]string{"url": "http://127.0.0.1/"}, token); w.Code != http.StatusOK {
			t.Fatalf("scan %d: %d %s", i, w.Code, w.Body.String())
		}
	}
	cw := postJSON(t, router, "/api/v1/scan/client", map[string]interface{}{
		"url": "http://localhost:3000", "violations": []interface{}{}, "passes": []interface{}{}, "incomplete": []interface{}{},
	}, token)
	if cw.Code != http.StatusOK || !strings.Contains(cw.Body.String(), `"scans_remaining":1`) {
		t.Fatalf("scan/client: %d %s", cw.Code, cw.Body.String())
	}

	// 10 concurrent scans with 1 scan left: exactly 1 succeeds, 9 get 403 scans_used_up.
	var okCount, usedUpCount int32
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := postJSON(t, router, "/api/v1/scan", map[string]string{"url": "http://127.0.0.1/"}, token)
			switch w.Code {
			case http.StatusOK:
				atomic.AddInt32(&okCount, 1)
			case http.StatusForbidden:
				if strings.Contains(w.Body.String(), "scans_used_up") {
					atomic.AddInt32(&usedUpCount, 1)
				}
			}
		}()
	}
	wg.Wait()
	if okCount != 1 || usedUpCount != 9 {
		t.Fatalf("concurrent scans with 1 left: ok=%d used_up=%d (want 1 and 9)", okCount, usedUpCount)
	}

	// Scanner failure (500) is also refunded.
	failRouter, failStore, failMailer := setupPhase2Test(t, failingScanner{})
	failTok, _ := loginTestUser(t, failRouter, failMailer, "fail@example.com", "203.0.113.11")
	if w := postJSON(t, failRouter, "/api/v1/scan", map[string]string{"url": "http://127.0.0.1/"}, failTok); w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 from failing scanner, got %d", w.Code)
	}
	fu, _ := failStore.GetUserByEmail("fail@example.com")
	if fu.Remaining() != 5 {
		t.Fatalf("expected 5 scans left after 500 refund, got %d", fu.Remaining())
	}
}

func TestApprovalsAndBlocking(t *testing.T) {
	router, store, mailer := setupPhase2Test(t, nil)
	token, _ := loginTestUser(t, router, mailer, "bob@example.com", "203.0.113.20")
	adminTok := makeAdminToken(config.GetSecret())

	// Guest cannot request more scans.
	guestTok := helperGenerateToken(config.GetSecret())
	if w := postJSON(t, router, "/api/v1/access/request", map[string]string{}, guestTok); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "login_required") {
		t.Fatalf("guest access/request: %d %s", w.Code, w.Body.String())
	}

	// User requests more scans (deduplicated).
	if w := postJSON(t, router, "/api/v1/access/request", map[string]string{}, token); w.Code != http.StatusOK {
		t.Fatalf("access/request: %d %s", w.Code, w.Body.String())
	}
	sentBefore := len(mailer.sent)
	if w := postJSON(t, router, "/api/v1/access/request", map[string]string{}, token); w.Code != http.StatusOK {
		t.Fatalf("duplicate access/request: %d %s", w.Code, w.Body.String())
	}
	if len(mailer.sent) != sentBefore {
		t.Fatalf("duplicate request should not re-email owner")
	}

	// Admin lists requests and users.
	listReq := httptest.NewRequest("GET", "/api/v1/admin/access", nil)
	listReq.Header.Set("Authorization", "Bearer "+adminTok)
	listW := httptest.NewRecorder()
	router.ServeHTTP(listW, listReq)
	if listW.Code != http.StatusOK {
		t.Fatalf("admin/access: %d %s", listW.Code, listW.Body.String())
	}
	var listResp struct {
		Requests []accessRow `json:"requests"`
		Users    []userRow   `json:"users"`
	}
	_ = json.Unmarshal(listW.Body.Bytes(), &listResp)
	if len(listResp.Requests) != 1 || len(listResp.Users) != 1 {
		t.Fatalf("unexpected admin list: %+v", listResp)
	}
	reqID := listResp.Requests[0].ID
	userID := listResp.Users[0].ID

	// Admin approves +3 scans -> user now has 8 scans and receives email.
	appW := postJSON(t, router, "/api/v1/admin/access/"+reqID+"/approve", map[string]int{"scans": 3}, adminTok)
	if appW.Code != http.StatusOK {
		t.Fatalf("approve: %d %s", appW.Code, appW.Body.String())
	}
	u, _ := store.GetUser(userID)
	if u.ScansAllowed != 8 {
		t.Fatalf("expected 8 scans_allowed, got %d", u.ScansAllowed)
	}
	if !strings.Contains(mailer.last().body, "3 more scans") {
		t.Fatalf("expected scans-added email, got: %s", mailer.last().body)
	}

	// Block user mid-session -> scan and access/request are refused with 403 blocked.
	blkW := postJSON(t, router, "/api/v1/admin/users/"+userID+"/block", map[string]string{}, adminTok)
	if blkW.Code != http.StatusOK || !strings.Contains(blkW.Body.String(), `"status":"blocked"`) {
		t.Fatalf("block user: %d %s", blkW.Code, blkW.Body.String())
	}
	if w := postJSON(t, router, "/api/v1/scan", map[string]string{"url": "http://127.0.0.1/"}, token); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "blocked") {
		t.Fatalf("blocked user scan: %d %s", w.Code, w.Body.String())
	}
	if w := postJSON(t, router, "/api/v1/access/request", map[string]string{}, token); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "blocked") {
		t.Fatalf("blocked user request: %d %s", w.Code, w.Body.String())
	}

	// Unblock user -> scanning works again.
	unblkW := postJSON(t, router, "/api/v1/admin/users/"+userID+"/unblock", map[string]string{}, adminTok)
	if unblkW.Code != http.StatusOK || !strings.Contains(unblkW.Body.String(), `"status":"active"`) {
		t.Fatalf("unblock user: %d %s", unblkW.Code, unblkW.Body.String())
	}
	if w := postJSON(t, router, "/api/v1/scan", map[string]string{"url": "http://127.0.0.1/"}, token); w.Code != http.StatusOK {
		t.Fatalf("unblocked user scan: %d %s", w.Code, w.Body.String())
	}
}

func TestDatabaseOutageFailsClosed(t *testing.T) {
	t.Setenv("FRONTEND_DIR", "../../frontend")
	config.InitGlobal(&config.Config{
		JWTSecret:             "test-secret-outage",
		AccessApprovalEnabled: true,
		MaxConcurrentScans:    2,
		AllowPrivateScans:     true,
	})
	defer config.InitGlobal(&config.Config{})

	// Handler with nil Access (simulating unavailable DB) fails closed with 503, never free scans.
	h := &Handler{Logger: zap.NewNop(), Access: nil, Scanner: stubScanner{}, ScanTimeout: 5 * time.Second}
	router := NewRouter(h, zap.NewNop())

	userTok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.StandardClaims{
		ExpiresAt: time.Now().Add(time.Hour).Unix(),
		Issuer:    "webaccessibility",
		Subject:   "user:some-id",
	})
	signed, _ := userTok.SignedString([]byte(config.GetSecret()))

	for _, ep := range []struct {
		method, path string
		body         interface{}
		tok          string
	}{
		{"POST", "/api/v1/scan", map[string]string{"url": "http://127.0.0.1/"}, signed},
		{"POST", "/api/v1/crawl", map[string]string{"url": "http://127.0.0.1/"}, signed},
		{"POST", "/api/v1/scan/client", map[string]string{"url": "http://localhost:3000"}, signed},
		{"POST", "/api/v1/auth/code", map[string]string{"email": "a@example.com"}, ""},
		{"POST", "/api/v1/auth/verify", map[string]string{"email": "a@example.com", "code": "123456"}, ""},
		{"GET", "/api/v1/auth/me", nil, signed},
		{"POST", "/api/v1/access/request", map[string]string{}, signed},
	} {
		var w *httptest.ResponseRecorder
		if ep.method == "GET" {
			req := httptest.NewRequest("GET", ep.path, nil)
			req.Header.Set("Authorization", "Bearer "+ep.tok)
			w = httptest.NewRecorder()
			router.ServeHTTP(w, req)
		} else {
			w = postJSON(t, router, ep.path, ep.body, ep.tok)
		}
		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("%s %s during DB outage: expected 503, got %d %s", ep.method, ep.path, w.Code, w.Body.String())
		}
	}
}
