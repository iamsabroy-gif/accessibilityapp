// Package access implements the owner-approval flow for returning users.
//
// A returning user asks for access with their email. The owner gets an email
// with a review link; approving issues a limited-use access code that is
// emailed to the user. Each scan made with that code uses one of its scans,
// and the code stops working once it is used up, expires, or is revoked.
//
// Requests are kept in one JSON file (rewritten atomically on change) because,
// unlike leads and visits, they are updated after creation.
package access

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Request statuses.
const (
	StatusPending  = "pending"
	StatusApproved = "approved"
	StatusDenied   = "denied"
	StatusRevoked  = "revoked"
)

// Errors returned when a code cannot be used.
var (
	ErrNotFound    = errors.New("access request not found")
	ErrInvalidCode = errors.New("invalid access code")
	ErrExhausted   = errors.New("access code has no scans left")
	ErrExpired     = errors.New("access code has expired")
	ErrRevoked     = errors.New("access code has been revoked")
	ErrNotPending  = errors.New("request has already been decided")
	ErrBadKey      = errors.New("invalid review link")
)

// Request is one returning user's access request and, once approved, its code.
type Request struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	Status      string `json:"status"`
	RequestedAt string `json:"requested_at"`
	DecidedAt   string `json:"decided_at,omitempty"`
	// ReviewKeyHash guards the one-click review link sent to the owner.
	ReviewKeyHash string `json:"review_key_hash"`
	// CodeHash is the SHA-256 of the access code; the code itself is never stored.
	CodeHash  string `json:"code_hash,omitempty"`
	MaxScans  int    `json:"max_scans,omitempty"`
	UsedScans int    `json:"used_scans"`
	ExpiresAt string `json:"expires_at,omitempty"`
	LastUsed  string `json:"last_used,omitempty"`
}

// Remaining returns the number of scans left on an approved request.
func (r *Request) Remaining() int {
	if n := r.MaxScans - r.UsedScans; n > 0 {
		return n
	}
	return 0
}

// usable reports why an approved code cannot be used right now, or nil.
func (r *Request) usable(now time.Time) error {
	switch r.Status {
	case StatusApproved:
	case StatusRevoked, StatusDenied:
		return ErrRevoked
	default:
		return ErrInvalidCode
	}
	if r.ExpiresAt != "" {
		if exp, err := time.Parse(time.RFC3339, r.ExpiresAt); err == nil && now.After(exp) {
			return ErrExpired
		}
	}
	if r.Remaining() <= 0 {
		return ErrExhausted
	}
	return nil
}

// Store persists access requests in a JSON file.
type Store struct {
	path string
	mu   sync.Mutex
	reqs map[string]*Request
	now  func() time.Time
}

// NewStore loads (or starts) the store at path. A missing file is fine.
func NewStore(path string) (*Store, error) {
	if path == "" {
		path = "data/access.json"
	}
	s := &Store{path: path, reqs: map[string]*Request{}, now: time.Now}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		return nil, fmt.Errorf("read access store: %w", err)
	}
	var list []*Request
	if len(strings.TrimSpace(string(data))) > 0 {
		if err := json.Unmarshal(data, &list); err != nil {
			return nil, fmt.Errorf("parse access store: %w", err)
		}
	}
	for _, r := range list {
		s.reqs[r.ID] = r
	}
	return s, nil
}

// save writes all requests atomically. Caller holds s.mu.
func (s *Store) save() error {
	list := make([]*Request, 0, len(s.reqs))
	for _, r := range s.reqs {
		list = append(list, r)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].RequestedAt < list[j].RequestedAt })
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	if dir := filepath.Dir(s.path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func hash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func normEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }

func copyOf(r *Request) *Request { c := *r; return &c }

// Create records a new pending request and returns it with the plain review
// key for the owner's link. If the email already has a pending request, that
// request is returned with created=false and an empty key, so repeated clicks
// do not flood the owner's inbox.
func (s *Store) Create(email string) (req *Request, reviewKey string, created bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	email = normEmail(email)
	for _, r := range s.reqs {
		if r.Email == email && r.Status == StatusPending {
			return copyOf(r), "", false, nil
		}
	}
	reviewKey = randomToken(24)
	r := &Request{
		ID:            randomToken(9),
		Email:         email,
		Status:        StatusPending,
		RequestedAt:   s.now().UTC().Format(time.RFC3339),
		ReviewKeyHash: hash(reviewKey),
	}
	s.reqs[r.ID] = r
	if err := s.save(); err != nil {
		delete(s.reqs, r.ID)
		return nil, "", false, err
	}
	return copyOf(r), reviewKey, true, nil
}

// Get returns a copy of the request with the given ID.
func (s *Store) Get(id string) (*Request, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.reqs[id]
	if !ok {
		return nil, ErrNotFound
	}
	return copyOf(r), nil
}

// CheckReviewKey reports whether key matches the request's review link.
func (s *Store) CheckReviewKey(id, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.reqs[id]
	if !ok {
		return ErrNotFound
	}
	if key == "" || subtle.ConstantTimeCompare([]byte(hash(key)), []byte(r.ReviewKeyHash)) != 1 {
		return ErrBadKey
	}
	return nil
}

// Approve approves a pending request and returns it with the new plain access
// code, which is only available here and must be sent to the user.
func (s *Store) Approve(id string, maxScans int, ttl time.Duration) (*Request, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.reqs[id]
	if !ok {
		return nil, "", ErrNotFound
	}
	if r.Status != StatusPending {
		return nil, "", ErrNotPending
	}
	if maxScans <= 0 {
		return nil, "", fmt.Errorf("max scans must be positive")
	}
	prev := *r
	code := "AS-" + randomToken(18)
	now := s.now().UTC()
	r.Status = StatusApproved
	r.DecidedAt = now.Format(time.RFC3339)
	r.CodeHash = hash(code)
	r.MaxScans = maxScans
	r.UsedScans = 0
	if ttl > 0 {
		r.ExpiresAt = now.Add(ttl).Format(time.RFC3339)
	}
	if err := s.save(); err != nil {
		*r = prev
		return nil, "", err
	}
	return copyOf(r), code, nil
}

// Deny rejects a pending request.
func (s *Store) Deny(id string) (*Request, error) {
	return s.setStatus(id, StatusDenied, StatusPending)
}

// Revoke disables an approved code.
func (s *Store) Revoke(id string) (*Request, error) {
	return s.setStatus(id, StatusRevoked, StatusApproved)
}

func (s *Store) setStatus(id, to, from string) (*Request, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.reqs[id]
	if !ok {
		return nil, ErrNotFound
	}
	if r.Status != from {
		return nil, ErrNotPending
	}
	prev := *r
	r.Status = to
	r.DecidedAt = s.now().UTC().Format(time.RFC3339)
	if err := s.save(); err != nil {
		*r = prev
		return nil, err
	}
	return copyOf(r), nil
}

// lookup finds the request owning code. Caller holds s.mu.
func (s *Store) lookup(code string) *Request {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil
	}
	h := hash(code)
	for _, r := range s.reqs {
		if r.CodeHash != "" && subtle.ConstantTimeCompare([]byte(h), []byte(r.CodeHash)) == 1 {
			return r
		}
	}
	return nil
}

// Validate checks that code is usable without using a scan.
func (s *Store) Validate(code string) (*Request, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.lookup(code)
	if r == nil {
		return nil, ErrInvalidCode
	}
	if err := r.usable(s.now()); err != nil {
		return copyOf(r), err
	}
	return copyOf(r), nil
}

// Status returns the request by ID and whether it can still be used.
func (s *Store) Status(id string) (*Request, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.reqs[id]
	if !ok {
		return nil, ErrInvalidCode
	}
	return copyOf(r), r.usable(s.now())
}

// Consume uses one scan on the request with the given ID.
func (s *Store) Consume(id string) (*Request, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.reqs[id]
	if !ok {
		return nil, ErrInvalidCode
	}
	now := s.now()
	if err := r.usable(now); err != nil {
		return copyOf(r), err
	}
	prev := *r
	r.UsedScans++
	r.LastUsed = now.UTC().Format(time.RFC3339)
	if err := s.save(); err != nil {
		*r = prev
		return nil, err
	}
	return copyOf(r), nil
}

// List returns all requests, newest first.
func (s *Store) List() []*Request {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Request, 0, len(s.reqs))
	for _, r := range s.reqs {
		out = append(out, copyOf(r))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RequestedAt > out[j].RequestedAt })
	return out
}
