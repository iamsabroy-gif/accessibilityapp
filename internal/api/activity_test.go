package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v4"
	"github.com/webaccessibility/server/internal/config"
	"github.com/webaccessibility/server/internal/leads"
	"github.com/webaccessibility/server/internal/visits"
	"go.uber.org/zap"
)

func TestGetActivity(t *testing.T) {
	t.Setenv("FRONTEND_DIR", "../../frontend")
	secret := "test-jwt-secret-12345"
	config.SetSecret(secret)
	dir := t.TempDir()
	ls := leads.NewStore(filepath.Join(dir, "leads.jsonl"))
	vs := visits.NewStore(filepath.Join(dir, "visits.jsonl"))
	_ = ls.Save(&leads.LeadRecord{Email: "A@x.com", Source: "landing", Timestamp: "2026-10-01T10:00:00Z"})
	_ = vs.Save(&visits.VisitRecord{Email: "a@x.com", Timestamp: "2026-10-02T10:00:00Z"})
	_ = vs.Save(&visits.VisitRecord{Email: "a@x.com", Timestamp: "2026-10-02T11:00:00Z"})
	_ = vs.Save(&visits.VisitRecord{Email: "ghost@x.com", Timestamp: "2026-10-03T10:00:00Z"})

	router := NewRouter(&Handler{Logger: zap.NewNop(), LeadStore: ls, VisitStore: vs}, zap.NewNop())

	// no token -> 401
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/admin/activity", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}

	// guest token -> 401
	guest, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.StandardClaims{Subject: "guest", ExpiresAt: time.Now().Add(time.Minute).Unix()}).SignedString([]byte(secret))
	req := httptest.NewRequest("GET", "/api/v1/admin/activity", nil)
	req.Header.Set("Authorization", "Bearer "+guest)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("guest token: expected 401, got %d", w.Code)
	}

	admin, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.StandardClaims{Subject: "admin", ExpiresAt: time.Now().Add(time.Minute).Unix()}).SignedString([]byte(secret))
	req = httptest.NewRequest("GET", "/api/v1/admin/activity", nil)
	req.Header.Set("Authorization", "Bearer "+admin)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var out struct{ Users []activityRow }
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || len(out.Users) != 2 {
		t.Fatalf("bad body: %v %s", err, w.Body.String())
	}
	g, a := out.Users[0], out.Users[1] // ghost seen last
	if g.Email != "ghost@x.com" || g.Registered {
		t.Errorf("ghost row wrong: %+v", g)
	}
	if a.Email != "a@x.com" || !a.Registered || a.Source != "landing" || a.VisitDays != 1 || a.TotalVisits != 2 {
		t.Errorf("registered row wrong: %+v", a)
	}
}
