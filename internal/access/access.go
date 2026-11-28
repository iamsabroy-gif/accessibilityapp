// Package access implements user access, email-code login, and scan quota
// storage.
//
// Phase 1/2 supports both a MongoDB-backed Store (MongoStore) and a JSON/in-memory
// Store (JSONStore) for tests and local/rollback deployments without MONGODB_URI.
package access

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
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

	// KindTrial marks the free scans every new user gets at registration.
	KindTrial = "trial"
)

// User account statuses.
const (
	UserStatusActive  = "active"
	UserStatusBlocked = "blocked"
)

const (
	// DefaultLoginCodeTTL is the lifetime of a 6-digit email login code.
	DefaultLoginCodeTTL = 10 * time.Minute
	// MaxLoginCodeAttempts is the maximum number of wrong guesses before a code is deleted.
	MaxLoginCodeAttempts = 5
)

// Errors returned by Store operations.
var (
	ErrNotFound         = errors.New("access request not found")
	ErrInvalidCode      = errors.New("invalid access code")
	ErrExhausted        = errors.New("access code has no scans left")
	ErrExpired          = errors.New("access code has expired")
	ErrRevoked          = errors.New("access code has been revoked")
	ErrNotPending       = errors.New("request has already been decided")
	ErrBadKey           = errors.New("invalid review link")
	ErrUserBlocked      = errors.New("user account is blocked")
	ErrInvalidLoginCode = errors.New("invalid or expired login code")
	ErrTooManyAttempts  = errors.New("too many failed login attempts")
)

// Request is one returning user's access request and, in Phase 1/legacy, its code.
type Request struct {
	ID          string `json:"id" bson:"_id"`
	Email       string `json:"email" bson:"email"`
	Status      string `json:"status" bson:"status"`
	Kind        string `json:"kind,omitempty" bson:"kind,omitempty"` // "trial" or "" (owner-approved)
	RequestedAt string `json:"requested_at" bson:"requested_at"`
	DecidedAt   string `json:"decided_at,omitempty" bson:"decided_at,omitempty"`
	// ReviewKeyHash guards the one-click review link sent to the owner.
	ReviewKeyHash string `json:"review_key_hash" bson:"review_key_hash"`
	// CodeHash is the SHA-256 of the legacy access code; the code itself is never stored.
	CodeHash     string `json:"code_hash,omitempty" bson:"code_hash,omitempty"`
	MaxScans     int    `json:"max_scans,omitempty" bson:"max_scans,omitempty"`
	UsedScans    int    `json:"used_scans" bson:"used_scans"`
	ScansGranted int    `json:"scans_granted,omitempty" bson:"scans_granted,omitempty"`
	ExpiresAt    string `json:"expires_at,omitempty" bson:"expires_at,omitempty"`
	LastUsed     string `json:"last_used,omitempty" bson:"last_used,omitempty"`
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

// User represents a registered AccessScan account identified by email.
type User struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	ScansAllowed int    `json:"scans_allowed"`
	ScansUsed    int    `json:"scans_used"`
	Status       string `json:"status"` // "active" or "blocked"
	CreatedAt    string `json:"created_at"`
	LastLoginAt  string `json:"last_login_at,omitempty"`
	LastScanAt   string `json:"last_scan_at,omitempty"`
}

// Remaining returns the number of scans left on the user's account.
func (u *User) Remaining() int {
	if n := u.ScansAllowed - u.ScansUsed; n > 0 {
		return n
	}
	return 0
}

// loginCodeRecord is the internal representation of a pending 6-digit login code.
type loginCodeRecord struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	CodeHash  string    `json:"code_hash"`
	Attempts  int       `json:"attempts"`
	ExpiresAt time.Time `json:"expires_at"`
}

// Store defines the persistence contract for access requests, users and login codes.
type Store interface {
	// Phase 1 / legacy access-request & access-code methods.
	Create(email string) (req *Request, reviewKey string, created bool, err error)
	CreateTrial(email string, scans int) (code string, created bool, err error)
	Get(id string) (*Request, error)
	CheckReviewKey(id, key string) error
	Approve(id string, maxScans int, ttl time.Duration) (*Request, string, error)
	Deny(id string) (*Request, error)
	Revoke(id string) (*Request, error)
	Validate(code string) (*Request, error)
	Status(id string) (*Request, error)
	Consume(id string) (*Request, error)
	Refund(id string) error
	List() ([]*Request, error)

	// Phase 2 email-code login & user account methods.
	CreateLoginCode(email, secret string, ttl time.Duration) (code string, err error)
	VerifyLoginCode(email, code, secret string, trialScans int) (user *User, created bool, err error)
	GetUser(id string) (*User, error)
	GetUserByEmail(email string) (*User, error)
	ListUsers() ([]*User, error)
	ReserveUserScan(id string) (*User, error)
	RefundUserScan(id string) error
	ApproveUserScans(requestID string, scans int) (*Request, *User, error)
	BlockUser(id string) (*User, error)
	UnblockUser(id string) (*User, error)

	// Lifecycle.
	Ping(ctx context.Context) error
	Close(ctx context.Context) error
}

// JSONStore persists access requests and users in a JSON
// file (or purely in memory when created with NewMemoryStore).
type JSONStore struct {
	path     string
	inMemory bool
	mu       sync.Mutex
	reqs     map[string]*Request
	users    map[string]*User
	codes    []*loginCodeRecord
	now      func() time.Time
}

type jsonSnapshot struct {
	Requests []*Request `json:"requests,omitempty"`
	Users    []*User    `json:"users,omitempty"`
}

// NewStore loads (or starts) the JSON store at path. A missing file is fine.
func NewStore(path string) (*JSONStore, error) {
	if path == "" {
		path = "data/access.json"
	}
	s := &JSONStore{
		path:  path,
		reqs:  map[string]*Request{},
		users: map[string]*User{},
		now:   time.Now,
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		return nil, fmt.Errorf("read access store: %w", err)
	}
	trimmed := strings.TrimSpace(string(data))
	if len(trimmed) == 0 {
		return s, nil
	}
	// Support both legacy array format ([{...}]) and extended snapshot format ({requests: [...]}).
	if strings.HasPrefix(trimmed, "[") {
		var list []*Request
		if err := json.Unmarshal(data, &list); err != nil {
			return nil, fmt.Errorf("parse access store: %w", err)
		}
		for _, r := range list {
			s.reqs[r.ID] = r
		}
		return s, nil
	}
	var snap jsonSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return nil, fmt.Errorf("parse access store: %w", err)
	}
	for _, r := range snap.Requests {
		s.reqs[r.ID] = r
	}
	for _, u := range snap.Users {
		s.users[u.ID] = u
	}
	return s, nil
}

// NewMemoryStore creates an in-memory Store with no disk persistence (for tests).
func NewMemoryStore() *JSONStore {
	return &JSONStore{
		inMemory: true,
		reqs:     map[string]*Request{},
		users:    map[string]*User{},
		now:      time.Now,
	}
}

// save writes state atomically. Caller holds s.mu.
func (s *JSONStore) save() error {
	if s.inMemory {
		return nil
	}
	list := make([]*Request, 0, len(s.reqs))
	for _, r := range s.reqs {
		list = append(list, r)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].RequestedAt < list[j].RequestedAt })

	var data []byte
	var err error
	if len(s.users) == 0 {
		// Keep legacy array format when only requests exist.
		data, err = json.MarshalIndent(list, "", "  ")
	} else {
		users := make([]*User, 0, len(s.users))
		for _, u := range s.users {
			users = append(users, u)
		}
		sort.Slice(users, func(i, j int) bool { return users[i].CreatedAt < users[j].CreatedAt })
		data, err = json.MarshalIndent(jsonSnapshot{
			Requests: list,
			Users:    users,
		}, "", "  ")
	}
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

func generateSixDigitCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", fmt.Errorf("generate login code: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func hmacCode(secret, code string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(code))
	return hex.EncodeToString(mac.Sum(nil))
}

func hash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func normEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }

func copyOf(r *Request) *Request { c := *r; return &c }
func copyOfUser(u *User) *User   { c := *u; return &c }

// Create records a new pending request and returns it with the plain review
// key for the owner's link. If the email already has a pending request, that
// request is returned with created=false and an empty key, so repeated clicks
// do not flood the owner's inbox.
func (s *JSONStore) Create(email string) (req *Request, reviewKey string, created bool, err error) {
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

// CreateTrial issues the one-time free-scan code for a newly registered email.
// Each email gets one trial ever; if it already had one, code is empty and
// created is false.
func (s *JSONStore) CreateTrial(email string, scans int) (code string, created bool, err error) {
	if scans <= 0 {
		return "", false, fmt.Errorf("trial scans must be positive")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	email = normEmail(email)
	for _, r := range s.reqs {
		if r.Email == email && r.Kind == KindTrial {
			return "", false, nil
		}
	}
	code = "AS-" + randomToken(18)
	now := s.now().UTC().Format(time.RFC3339)
	r := &Request{
		ID:          randomToken(9),
		Email:       email,
		Kind:        KindTrial,
		Status:      StatusApproved,
		RequestedAt: now,
		DecidedAt:   now,
		CodeHash:    hash(code),
		MaxScans:    scans,
	}
	s.reqs[r.ID] = r
	if err := s.save(); err != nil {
		delete(s.reqs, r.ID)
		return "", false, err
	}
	return code, true, nil
}

// Get returns a copy of the request with the given ID.
func (s *JSONStore) Get(id string) (*Request, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.reqs[id]
	if !ok {
		return nil, ErrNotFound
	}
	return copyOf(r), nil
}

// CheckReviewKey reports whether key matches the request's review link.
func (s *JSONStore) CheckReviewKey(id, key string) error {
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
func (s *JSONStore) Approve(id string, maxScans int, ttl time.Duration) (*Request, string, error) {
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
func (s *JSONStore) Deny(id string) (*Request, error) {
	return s.setStatus(id, StatusDenied, StatusPending)
}

// Revoke disables an approved code.
func (s *JSONStore) Revoke(id string) (*Request, error) {
	return s.setStatus(id, StatusRevoked, StatusApproved)
}

func (s *JSONStore) setStatus(id, to, from string) (*Request, error) {
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
func (s *JSONStore) lookup(code string) *Request {
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
func (s *JSONStore) Validate(code string) (*Request, error) {
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
func (s *JSONStore) Status(id string) (*Request, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.reqs[id]
	if !ok {
		return nil, ErrInvalidCode
	}
	return copyOf(r), r.usable(s.now())
}

// Consume uses one scan on the request with the given ID.
func (s *JSONStore) Consume(id string) (*Request, error) {
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

// Refund returns one scan to the request with the given ID (used on scan failure).
func (s *JSONStore) Refund(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.reqs[id]
	if !ok {
		return ErrNotFound
	}
	if r.UsedScans <= 0 {
		return nil
	}
	prev := *r
	r.UsedScans--
	if err := s.save(); err != nil {
		*r = prev
		return err
	}
	return nil
}

// List returns all requests, newest first.
func (s *JSONStore) List() ([]*Request, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Request, 0, len(s.reqs))
	for _, r := range s.reqs {
		out = append(out, copyOf(r))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RequestedAt > out[j].RequestedAt })
	return out, nil
}

// CreateLoginCode generates a 6-digit login code, stores its HMAC-SHA256 hash,
// and returns the plain code for emailing.
func (s *JSONStore) CreateLoginCode(email, secret string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		ttl = DefaultLoginCodeTTL
	}
	code, err := generateSixDigitCode()
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC()
	s.pruneExpiredCodesLocked(now)
	s.codes = append(s.codes, &loginCodeRecord{
		ID:        randomToken(9),
		Email:     normEmail(email),
		CodeHash:  hmacCode(secret, code),
		Attempts:  0,
		ExpiresAt: now.Add(ttl),
	})
	return code, nil
}

func (s *JSONStore) pruneExpiredCodesLocked(now time.Time) {
	kept := s.codes[:0]
	for _, c := range s.codes {
		if c.ExpiresAt.After(now) {
			kept = append(kept, c)
		}
	}
	s.codes = kept
}

// VerifyLoginCode verifies the newest unexpired login code for email.
// Wrong attempts increment attempts and delete the code on the 5th failure.
// A valid code is deleted immediately and upserts the user account.
func (s *JSONStore) VerifyLoginCode(email, code, secret string, trialScans int) (*User, bool, error) {
	if trialScans <= 0 {
		trialScans = 5
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	email = normEmail(email)
	code = strings.TrimSpace(code)
	now := s.now().UTC()
	s.pruneExpiredCodesLocked(now)

	idx := -1
	for i := len(s.codes) - 1; i >= 0; i-- {
		if s.codes[i].Email == email && s.codes[i].ExpiresAt.After(now) {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil, false, ErrInvalidLoginCode
	}
	rec := s.codes[idx]
	expected := hmacCode(secret, code)
	if code == "" || subtle.ConstantTimeCompare([]byte(expected), []byte(rec.CodeHash)) != 1 {
		rec.Attempts++
		if rec.Attempts >= MaxLoginCodeAttempts {
			s.codes = append(s.codes[:idx], s.codes[idx+1:]...)
			return nil, false, ErrTooManyAttempts
		}
		return nil, false, ErrInvalidLoginCode
	}

	// Valid code: delete immediately so it can only be used once.
	s.codes = append(s.codes[:idx], s.codes[idx+1:]...)

	nowStr := now.Format(time.RFC3339)
	for _, u := range s.users {
		if u.Email == email {
			prev := *u
			u.LastLoginAt = nowStr
			if err := s.save(); err != nil {
				*u = prev
				return nil, false, err
			}
			return copyOfUser(u), false, nil
		}
	}

	u := &User{
		ID:           randomToken(9),
		Email:        email,
		ScansAllowed: trialScans,
		ScansUsed:    0,
		Status:       UserStatusActive,
		CreatedAt:    nowStr,
		LastLoginAt:  nowStr,
	}
	s.users[u.ID] = u
	if err := s.save(); err != nil {
		delete(s.users, u.ID)
		return nil, false, err
	}
	return copyOfUser(u), true, nil
}

// GetUser returns a copy of the user with the given ID.
func (s *JSONStore) GetUser(id string) (*User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok {
		return nil, ErrNotFound
	}
	return copyOfUser(u), nil
}

// GetUserByEmail returns a copy of the user with the given email.
func (s *JSONStore) GetUserByEmail(email string) (*User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	email = normEmail(email)
	for _, u := range s.users {
		if u.Email == email {
			return copyOfUser(u), nil
		}
	}
	return nil, ErrNotFound
}

// ListUsers returns all users, newest first.
func (s *JSONStore) ListUsers() ([]*User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*User, 0, len(s.users))
	for _, u := range s.users {
		out = append(out, copyOfUser(u))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out, nil
}

// ReserveUserScan atomically reserves one scan on an active user account.
func (s *JSONStore) ReserveUserScan(id string) (*User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok {
		return nil, ErrNotFound
	}
	if u.Status != UserStatusActive {
		return nil, ErrUserBlocked
	}
	if u.ScansUsed >= u.ScansAllowed {
		return nil, ErrExhausted
	}
	prev := *u
	u.ScansUsed++
	u.LastScanAt = s.now().UTC().Format(time.RFC3339)
	if err := s.save(); err != nil {
		*u = prev
		return nil, err
	}
	return copyOfUser(u), nil
}

// RefundUserScan returns one reserved scan to the user's account.
func (s *JSONStore) RefundUserScan(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok {
		return ErrNotFound
	}
	if u.ScansUsed <= 0 {
		return nil
	}
	prev := *u
	u.ScansUsed--
	if err := s.save(); err != nil {
		*u = prev
		return err
	}
	return nil
}

// ApproveUserScans approves a pending request and adds scans to the user's account.
func (s *JSONStore) ApproveUserScans(requestID string, scans int) (*Request, *User, error) {
	if scans <= 0 {
		return nil, nil, fmt.Errorf("scans must be positive")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.reqs[requestID]
	if !ok {
		return nil, nil, ErrNotFound
	}
	if r.Status != StatusPending {
		return nil, nil, ErrNotPending
	}
	prevReq := *r
	nowStr := s.now().UTC().Format(time.RFC3339)
	r.Status = StatusApproved
	r.DecidedAt = nowStr
	r.ScansGranted = scans

	var target *User
	for _, u := range s.users {
		if u.Email == r.Email {
			target = u
			break
		}
	}
	var prevUser User
	createdUser := false
	if target != nil {
		prevUser = *target
		target.ScansAllowed += scans
	} else {
		createdUser = true
		target = &User{
			ID:           randomToken(9),
			Email:        r.Email,
			ScansAllowed: scans,
			ScansUsed:    0,
			Status:       UserStatusActive,
			CreatedAt:    nowStr,
		}
		s.users[target.ID] = target
	}
	if err := s.save(); err != nil {
		*r = prevReq
		if createdUser {
			delete(s.users, target.ID)
		} else {
			*target = prevUser
		}
		return nil, nil, err
	}
	return copyOf(r), copyOfUser(target), nil
}

// BlockUser sets a user's status to blocked.
func (s *JSONStore) BlockUser(id string) (*User, error) {
	return s.setUserStatus(id, UserStatusBlocked)
}

// UnblockUser sets a user's status to active.
func (s *JSONStore) UnblockUser(id string) (*User, error) {
	return s.setUserStatus(id, UserStatusActive)
}

func (s *JSONStore) setUserStatus(id, status string) (*User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok {
		return nil, ErrNotFound
	}
	prev := *u
	u.Status = status
	if err := s.save(); err != nil {
		*u = prev
		return nil, err
	}
	return copyOfUser(u), nil
}

// Ping verifies the store is reachable.
func (s *JSONStore) Ping(context.Context) error { return nil }

// Close releases resources held by the store.
func (s *JSONStore) Close(context.Context) error { return nil }
