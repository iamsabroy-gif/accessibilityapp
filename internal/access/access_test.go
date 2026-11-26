package access

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestStoreLifecycle(t *testing.T) {
	path := filepath.Join(t.TempDir(), "access.json")
	s, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }

	r, key, created, err := s.Create("User@Example.com")
	if err != nil || !created || key == "" || r.Email != "user@example.com" {
		t.Fatalf("create: %+v %q %v %v", r, key, created, err)
	}
	if _, _, created, _ := s.Create("user@example.com"); created {
		t.Fatal("duplicate pending request should not be created")
	}
	if err := s.CheckReviewKey(r.ID, "bad"); !errors.Is(err, ErrBadKey) {
		t.Fatalf("bad key: %v", err)
	}
	if err := s.CheckReviewKey(r.ID, key); err != nil {
		t.Fatalf("good key: %v", err)
	}

	r, code, err := s.Approve(r.ID, 2, 24*time.Hour)
	if err != nil || code == "" {
		t.Fatalf("approve: %v", err)
	}
	if _, _, err := s.Approve(r.ID, 2, 0); !errors.Is(err, ErrNotPending) {
		t.Fatalf("second approve: %v", err)
	}

	// Survives a reload; the code itself is not stored.
	s2, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	s2.now = s.now
	got, err := s2.Validate(code)
	if err != nil || got.ID != r.ID || got.Remaining() != 2 {
		t.Fatalf("validate after reload: %+v %v", got, err)
	}

	for i := 0; i < 2; i++ {
		if _, err := s2.Consume(r.ID); err != nil {
			t.Fatalf("consume %d: %v", i, err)
		}
	}
	if _, err := s2.Consume(r.ID); !errors.Is(err, ErrExhausted) {
		t.Fatalf("third consume: %v", err)
	}

	// Expiry and revocation.
	r2, _, _, _ := s2.Create("other@example.com")
	_, code2, _ := s2.Approve(r2.ID, 5, time.Hour)
	now = now.Add(2 * time.Hour)
	if _, err := s2.Validate(code2); !errors.Is(err, ErrExpired) {
		t.Fatalf("expired: %v", err)
	}
	r3, _, _, _ := s2.Create("third@example.com")
	_, code3, _ := s2.Approve(r3.ID, 5, 0)
	if _, err := s2.Revoke(r3.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s2.Validate(code3); !errors.Is(err, ErrRevoked) {
		t.Fatalf("revoked: %v", err)
	}
	if _, err := s2.Validate("AS-unknown"); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("unknown: %v", err)
	}
}
