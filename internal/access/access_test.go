package access

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type storeBackend struct {
	name   string
	store  Store
	setNow func(func() time.Time)
	reload func() (Store, func(func() time.Time))
}

func testBackends(t *testing.T) []storeBackend {
	t.Helper()

	path := filepath.Join(t.TempDir(), "access.json")
	js, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	mem := NewMemoryStore()

	backends := []storeBackend{
		{
			name:   "JSONStore",
			store:  js,
			setNow: func(fn func() time.Time) { js.now = fn },
			reload: func() (Store, func(func() time.Time)) {
				s2, err := NewStore(path)
				if err != nil {
					t.Fatal(err)
				}
				return s2, func(fn func() time.Time) { s2.now = fn }
			},
		},
		{
			name:   "MemoryStore",
			store:  mem,
			setNow: func(fn func() time.Time) { mem.now = fn },
		},
	}

	if uri := os.Getenv("MONGODB_TEST_URI"); uri != "" {
		dbName := fmt.Sprintf("accessscan_test_%d", time.Now().UnixNano())
		ctx := context.Background()
		ms, err := NewMongoStore(ctx, uri, dbName)
		if err != nil {
			t.Fatalf("NewMongoStore: %v", err)
		}
		t.Cleanup(func() {
			_ = ms.db.Drop(context.Background())
			_ = ms.Close(context.Background())
		})
		backends = append(backends, storeBackend{
			name:   "MongoStore",
			store:  ms,
			setNow: func(fn func() time.Time) { ms.now = fn },
			reload: func() (Store, func(func() time.Time)) {
				return ms, func(fn func() time.Time) { ms.now = fn }
			},
		})
	}

	return backends
}

func TestStoreLifecycle(t *testing.T) {
	for _, b := range testBackends(t) {
		t.Run(b.name, func(t *testing.T) {
			s := b.store
			now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
			setNow := b.setNow
			setNow(func() time.Time { return now })

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

			s2 := s
			if b.reload != nil {
				s2, setNow = b.reload()
				setNow(func() time.Time { return now })
			}

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

			// Refund restores one scan.
			if err := s2.Refund(r.ID); err != nil {
				t.Fatalf("refund: %v", err)
			}
			if got, err := s2.Consume(r.ID); err != nil || got.Remaining() != 0 {
				t.Fatalf("consume after refund: %+v %v", got, err)
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

			// Trial code uniqueness.
			tCode, tCreated, err := s2.CreateTrial("trial@example.com", 5)
			if err != nil || !tCreated || tCode == "" {
				t.Fatalf("create trial: %q %v %v", tCode, tCreated, err)
			}
			if _, tCreated2, err := s2.CreateTrial("TRIAL@example.com", 5); err != nil || tCreated2 {
				t.Fatalf("duplicate trial should not be created: %v %v", tCreated2, err)
			}
		})
	}
}

func TestLoginCodeAndUserFlow(t *testing.T) {
	const secret = "test-hmac-secret"

	for _, b := range testBackends(t) {
		t.Run(b.name, func(t *testing.T) {
			s := b.store
			now := time.Date(2026, 2, 1, 12, 0, 0, 0, time.UTC)
			b.setNow(func() time.Time { return now })

			// 1. Create 6-digit login code.
			code, err := s.CreateLoginCode("Alice@Example.com", secret, 10*time.Minute)
			if err != nil {
				t.Fatalf("CreateLoginCode: %v", err)
			}
			if len(code) != 6 {
				t.Fatalf("expected 6-digit code, got %q", code)
			}

			// 2. Wrong code 5 times -> deleted on 5th attempt.
			for i := 1; i <= 4; i++ {
				if _, _, err := s.VerifyLoginCode("alice@example.com", "000000", secret, 5); !errors.Is(err, ErrInvalidLoginCode) {
					t.Fatalf("wrong attempt %d: got %v, want ErrInvalidLoginCode", i, err)
				}
			}
			if _, _, err := s.VerifyLoginCode("alice@example.com", "000000", secret, 5); !errors.Is(err, ErrTooManyAttempts) {
				t.Fatalf("5th wrong attempt: got %v, want ErrTooManyAttempts", err)
			}
			// Even the real code should now be deleted.
			if _, _, err := s.VerifyLoginCode("alice@example.com", code, secret, 5); !errors.Is(err, ErrInvalidLoginCode) {
				t.Fatalf("after 5th wrong attempt: got %v, want ErrInvalidLoginCode", err)
			}

			// 3. Expired code is rejected.
			expCode, err := s.CreateLoginCode("alice@example.com", secret, 10*time.Minute)
			if err != nil {
				t.Fatal(err)
			}
			now = now.Add(11 * time.Minute)
			if _, _, err := s.VerifyLoginCode("alice@example.com", expCode, secret, 5); !errors.Is(err, ErrInvalidLoginCode) {
				t.Fatalf("expired code: got %v, want ErrInvalidLoginCode", err)
			}

			// 4. Right code creates user with 5 trial scans and works only once.
			code2, err := s.CreateLoginCode("alice@example.com", secret, 10*time.Minute)
			if err != nil {
				t.Fatal(err)
			}
			user, created, err := s.VerifyLoginCode("alice@example.com", code2, secret, 5)
			if err != nil || !created || user.Email != "alice@example.com" || user.ScansAllowed != 5 || user.Status != UserStatusActive {
				t.Fatalf("verify valid code: user=%+v created=%v err=%v", user, created, err)
			}
			if _, _, err := s.VerifyLoginCode("alice@example.com", code2, secret, 5); !errors.Is(err, ErrInvalidLoginCode) {
				t.Fatalf("reuse code: got %v, want ErrInvalidLoginCode", err)
			}

			// 5. Reserve 5 scans; 6th is refused; refund restores 1.
			for i := 0; i < 5; i++ {
				u, err := s.ReserveUserScan(user.ID)
				if err != nil {
					t.Fatalf("reserve %d: %v", i, err)
				}
				if u.Remaining() != 4-i {
					t.Fatalf("remaining after %d: got %d, want %d", i, u.Remaining(), 4-i)
				}
			}
			if _, err := s.ReserveUserScan(user.ID); !errors.Is(err, ErrExhausted) {
				t.Fatalf("6th reserve: got %v, want ErrExhausted", err)
			}
			if err := s.RefundUserScan(user.ID); err != nil {
				t.Fatalf("refund: %v", err)
			}
			if u, err := s.ReserveUserScan(user.ID); err != nil || u.Remaining() != 0 {
				t.Fatalf("reserve after refund: u=%+v err=%v", u, err)
			}

			// 6. Request & ApproveUserScans adds N scans.
			req, _, reqCreated, err := s.Create("alice@example.com")
			if err != nil || !reqCreated {
				t.Fatalf("create request: %v %v", reqCreated, err)
			}
			decidedReq, updatedUser, err := s.ApproveUserScans(req.ID, 10)
			if err != nil || decidedReq.Status != StatusApproved || updatedUser.ScansAllowed != 15 || updatedUser.Remaining() != 10 {
				t.Fatalf("ApproveUserScans: req=%+v user=%+v err=%v", decidedReq, updatedUser, err)
			}

			// 7. Block & Unblock user.
			if u, err := s.BlockUser(user.ID); err != nil || u.Status != UserStatusBlocked {
				t.Fatalf("BlockUser: %+v %v", u, err)
			}
			if _, err := s.ReserveUserScan(user.ID); !errors.Is(err, ErrUserBlocked) {
				t.Fatalf("blocked reserve: got %v, want ErrUserBlocked", err)
			}
			if u, err := s.UnblockUser(user.ID); err != nil || u.Status != UserStatusActive {
				t.Fatalf("UnblockUser: %+v %v", u, err)
			}
			if _, err := s.ReserveUserScan(user.ID); err != nil {
				t.Fatalf("reserve after unblock: %v", err)
			}

			// 8. Second login returns created=false and preserves scans.
			code3, _ := s.CreateLoginCode("alice@example.com", secret, 10*time.Minute)
			userAgain, createdAgain, err := s.VerifyLoginCode("alice@example.com", code3, secret, 5)
			if err != nil || createdAgain || userAgain.ID != user.ID || userAgain.ScansAllowed != 15 {
				t.Fatalf("second login: user=%+v created=%v err=%v", userAgain, createdAgain, err)
			}
		})
	}
}

func TestConcurrentReserveUserScan(t *testing.T) {
	const secret = "concurrent-secret"

	for _, b := range testBackends(t) {
		t.Run(b.name, func(t *testing.T) {
			s := b.store
			code, err := s.CreateLoginCode("race@example.com", secret, 10*time.Minute)
			if err != nil {
				t.Fatal(err)
			}
			user, _, err := s.VerifyLoginCode("race@example.com", code, secret, 1)
			if err != nil {
				t.Fatal(err)
			}

			const workers = 10
			var wg sync.WaitGroup
			var successes atomic.Int32
			var exhausted atomic.Int32

			wg.Add(workers)
			for i := 0; i < workers; i++ {
				go func() {
					defer wg.Done()
					_, err := s.ReserveUserScan(user.ID)
					if err == nil {
						successes.Add(1)
					} else if errors.Is(err, ErrExhausted) {
						exhausted.Add(1)
					} else {
						t.Errorf("unexpected error: %v", err)
					}
				}()
			}
			wg.Wait()

			if successes.Load() != 1 || exhausted.Load() != workers-1 {
				t.Fatalf("concurrent reserve: successes=%d exhausted=%d, want 1 and %d",
					successes.Load(), exhausted.Load(), workers-1)
			}
		})
	}
}

func TestMailTemplates(t *testing.T) {
	subj, body := LoginCodeEmail("482910", 10*time.Minute)
	if subj == "" || !strings.Contains(body, "482910") || !strings.Contains(body, "10 minutes") {
		t.Fatalf("LoginCodeEmail unexpected: subj=%q body=%q", subj, body)
	}

	subj2, body2 := UserScansAddedEmail(25, "https://example.com/app")
	if !strings.Contains(subj2, "25") || !strings.Contains(body2, "25") || !strings.Contains(body2, "https://example.com/app") {
		t.Fatalf("UserScansAddedEmail unexpected: subj=%q body=%q", subj2, body2)
	}
}
