package api

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/webaccessibility/server/internal/config"
	"github.com/webaccessibility/server/internal/models"
	"go.uber.org/zap"
)

func TestResultStoreDiskRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s := NewResultStore(dir)
	id := s.Save(&models.ScanResult{URL: "https://example.com/"})

	got, ok := s.Get(id)
	if !ok || got.URL != "https://example.com/" {
		t.Fatalf("Get after Save: ok=%v result=%+v", ok, got)
	}
	// A new store over the same directory still finds the result (restart).
	if got, ok := NewResultStore(dir).Get(id); !ok || got.URL != "https://example.com/" {
		t.Fatalf("result not found after reopening store")
	}
	for _, bad := range []string{"", "../../etc/passwd", "zzzzzzzzzzzzzzzzzzzzzzzz", id + "/.."} {
		if _, ok := s.Get(bad); ok {
			t.Errorf("Get(%q) should not succeed", bad)
		}
	}
}

func TestResultStoreCap(t *testing.T) {
	s := NewResultStore("")
	first := s.Save(&models.ScanResult{URL: "first"})
	for i := 0; i < resultMaxEntries; i++ {
		s.Save(&models.ScanResult{})
	}
	if len(s.entries) != resultMaxEntries {
		t.Fatalf("store holds %d entries, want %d", len(s.entries), resultMaxEntries)
	}
	if _, ok := s.Get(first); ok {
		t.Fatalf("oldest entry should have been evicted")
	}
}

// failScanner fails the test if a scan is attempted.
type failScanner struct{ t *testing.T }

func (f failScanner) Scan(ctx context.Context, url, level string, depth int) (*models.ScanResult, error) {
	f.t.Fatalf("report endpoint re-scanned %s even though scan_id was supplied", url)
	return nil, nil
}

func TestReportUsesStoredScan(t *testing.T) {
	secret := "test-jwt-secret-12345"
	config.SetSecret(secret)
	h := &Handler{Logger: zap.NewNop(), Scanner: failScanner{t}}
	router := NewRouter(h, zap.NewNop())

	id := h.results().Save(&models.ScanResult{URL: "https://example.com/"})

	for name := range reportSpecs {
		body := []byte(`{"url":"https://example.com/","scan_id":"` + id + `","format":"html"}`)
		req := httptest.NewRequest("POST", "/api/v1/report/"+name, bytes.NewBuffer(body))
		req.Header.Set("Authorization", "Bearer "+helperGenerateToken(secret))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf("report %s: status %d, body %s", name, w.Code, w.Body.String())
			continue
		}
		if !strings.Contains(w.Header().Get("Content-Type"), "text/html") || w.Body.Len() == 0 {
			t.Errorf("report %s: expected a non-empty HTML report", name)
		}
	}
}
