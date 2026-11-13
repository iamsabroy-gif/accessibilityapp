package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/webaccessibility/server/internal/config"
	"github.com/webaccessibility/server/internal/models"
	"go.uber.org/zap"
)

// fakeSiteScanner returns a canned result per URL and records what was scanned.
type fakeSiteScanner struct {
	mu      sync.Mutex
	scanned []string
}

func (f *fakeSiteScanner) Scan(ctx context.Context, url, level string, depth int) (*models.ScanResult, error) {
	f.mu.Lock()
	f.scanned = append(f.scanned, url)
	f.mu.Unlock()
	if strings.HasSuffix(url, "/broken") {
		return nil, fmt.Errorf("page navigation failed")
	}
	res := &models.ScanResult{
		URL:       url,
		ScannedAt: time.Now(),
		Violations: []models.Violation{{
			ID: "image-alt", Impact: "critical",
			Nodes: []models.Node{{HTML: "<img>", Target: []string{"img"}}},
		}},
		Passes:    []string{"document-title"},
		PassRules: []models.PassRule{{ID: "document-title", NodeCount: 1}},
	}
	if depth == 1 {
		res.DiscoveredLinks = []string{"https://example.com/a", "https://example.com/broken", "https://example.com/b"}
	}
	return res, nil
}

func TestCrawlLifecycleAndCombinedReport(t *testing.T) {
	secret := "test-jwt-secret-12345"
	config.SetSecret(secret)
	config.SetMaxConcurrentScans(3)
	sc := &fakeSiteScanner{}
	h := &Handler{Logger: zap.NewNop(), Scanner: sc, ScanTimeout: 5 * time.Second}
	router := NewRouter(h, zap.NewNop())
	auth := "Bearer " + helperGenerateToken(secret)

	do := func(method, path, body string, authed bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		if authed {
			req.Header.Set("Authorization", auth)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}

	if w := do("POST", "/api/v1/crawl", `{"url":"https://example.com/"}`, false); w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated crawl: got %d, want 401", w.Code)
	}
	if w := do("POST", "/api/v1/crawl", `{"url":"http://127.0.0.1/"}`, true); w.Code != http.StatusForbidden {
		t.Fatalf("private crawl: got %d, want 403", w.Code)
	}

	w := do("POST", "/api/v1/crawl", `{"url":"https://example.com/","parallel":true}`, true)
	if w.Code != http.StatusAccepted {
		t.Fatalf("start crawl: got %d: %s", w.Code, w.Body.String())
	}
	var snap crawlSnapshot
	_ = json.Unmarshal(w.Body.Bytes(), &snap)
	if snap.CrawlID == "" {
		t.Fatal("no crawl_id returned")
	}

	deadline := time.Now().Add(5 * time.Second)
	for snap.Status != crawlDone {
		if time.Now().After(deadline) {
			t.Fatalf("crawl did not finish, last status %q", snap.Status)
		}
		time.Sleep(20 * time.Millisecond)
		w = do("GET", "/api/v1/crawl/"+snap.CrawlID, "", false)
		if w.Code != http.StatusOK {
			t.Fatalf("get crawl: %d", w.Code)
		}
		snap = crawlSnapshot{}
		_ = json.Unmarshal(w.Body.Bytes(), &snap)
	}

	if snap.MainScanID == "" || snap.Total != 3 || snap.Finished != 3 {
		t.Fatalf("unexpected final snapshot: %+v", snap)
	}
	statuses := map[string]string{}
	for _, p := range snap.Pages {
		statuses[p.URL] = p.Status
		if p.Status == pageDone {
			if w := do("GET", "/api/v1/report/"+p.ScanID, "", false); w.Code != http.StatusOK {
				t.Errorf("page result %s not retrievable: %d", p.URL, w.Code)
			}
		}
	}
	if statuses["https://example.com/a"] != pageDone || statuses["https://example.com/b"] != pageDone ||
		statuses["https://example.com/broken"] != pageError {
		t.Fatalf("unexpected page statuses: %v", statuses)
	}

	// The combined result pools elements from the start page and both good pages.
	combined, ok := h.crawlResult(snap.CrawlID)
	if !ok {
		t.Fatal("crawlResult not available")
	}
	if len(combined.PagesScanned) != 3 || len(combined.Violations) != 1 || len(combined.Violations[0].Nodes) != 3 {
		t.Fatalf("combined result wrong: pages=%v violations=%d", combined.PagesScanned, len(combined.Violations))
	}
	if combined.PassRules[0].NodeCount != 3 {
		t.Fatalf("pass node counts not summed: %+v", combined.PassRules)
	}

	// A report by crawl_id covers all pages and does not scan again.
	before := len(sc.scanned)
	w = do("POST", "/api/v1/report/vpat", `{"crawl_id":"`+snap.CrawlID+`","format":"html"}`, true)
	if w.Code != http.StatusOK {
		t.Fatalf("crawl report: %d %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, "Pages Covered (3)") || !strings.Contains(body, "https://example.com/b") {
		t.Errorf("report does not list the pages it covers")
	}
	if len(sc.scanned) != before {
		t.Errorf("report by crawl_id triggered a new scan")
	}

	if w := do("GET", "/api/v1/crawl/doesnotexist", "", false); w.Code != http.StatusNotFound {
		t.Errorf("unknown crawl: got %d, want 404", w.Code)
	}
}

// blockingScanner blocks every linked-page scan until the context is cancelled.
type blockingScanner struct{}

func (blockingScanner) Scan(ctx context.Context, url, level string, depth int) (*models.ScanResult, error) {
	if depth == 1 {
		return &models.ScanResult{URL: url, DiscoveredLinks: []string{"https://example.com/slow1", "https://example.com/slow2"}}, nil
	}
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestCrawlCancel(t *testing.T) {
	secret := "test-jwt-secret-12345"
	config.SetSecret(secret)
	config.SetMaxConcurrentScans(3)
	h := &Handler{Logger: zap.NewNop(), Scanner: blockingScanner{}, ScanTimeout: 30 * time.Second}
	router := NewRouter(h, zap.NewNop())

	req := httptest.NewRequest("POST", "/api/v1/crawl", bytes.NewBufferString(`{"url":"https://example.com/"}`))
	req.Header.Set("Authorization", "Bearer "+helperGenerateToken(secret))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	var snap crawlSnapshot
	_ = json.Unmarshal(w.Body.Bytes(), &snap)

	job, _ := h.crawls.get(snap.CrawlID)
	waitFor := func(cond func(crawlSnapshot) bool, what string) crawlSnapshot {
		deadline := time.Now().Add(5 * time.Second)
		for {
			s := job.snapshot()
			if cond(s) {
				return s
			}
			if time.Now().After(deadline) {
				t.Fatalf("timed out waiting for %s; snapshot %+v", what, s)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	waitFor(func(s crawlSnapshot) bool { return len(s.Pages) == 2 && s.Pages[0].Status == pageScanning }, "first page to start")

	w = httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/crawl/"+snap.CrawlID+"/cancel", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("cancel: %d", w.Code)
	}
	final := waitFor(func(s crawlSnapshot) bool { return s.Finished == 2 }, "pages to stop")
	if final.Status != crawlCancelled {
		t.Fatalf("status after cancel = %q, want %q", final.Status, crawlCancelled)
	}
}
