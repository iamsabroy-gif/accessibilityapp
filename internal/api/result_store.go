package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/webaccessibility/server/internal/models"
)

const (
	resultTTL        = 24 * time.Hour
	resultMaxEntries = 300
)

var resultIDPattern = regexp.MustCompile(`^[0-9a-f]{24}$`)

type resultEntry struct {
	expiresAt time.Time
	result    *models.ScanResult // only set in memory-only mode
}

// ResultStore keeps recent scan results so that reports and the extension's
// "View Detailed Report" link can be served without scanning the page again.
//
// With a directory, results are written to disk as <id>.json and survive a
// restart; only an index is held in memory. Without one, results are held in
// memory. Entries expire after 24 hours and the store is capped at 300 entries.
type ResultStore struct {
	dir     string
	mu      sync.Mutex
	entries map[string]resultEntry
}

// NewResultStore creates a store. If dir is empty or cannot be created the
// store works in memory only.
func NewResultStore(dir string) *ResultStore {
	s := &ResultStore{entries: make(map[string]resultEntry)}
	if dir == "" {
		return s
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return s
	}
	s.dir = dir
	// Rebuild the index from files left by a previous run.
	files, _ := os.ReadDir(dir)
	now := time.Now()
	for _, f := range files {
		id := strings.TrimSuffix(f.Name(), ".json")
		if f.IsDir() || !resultIDPattern.MatchString(id) {
			continue
		}
		info, err := f.Info()
		if err != nil {
			continue
		}
		exp := info.ModTime().Add(resultTTL)
		if now.After(exp) {
			_ = os.Remove(filepath.Join(dir, f.Name()))
			continue
		}
		s.entries[id] = resultEntry{expiresAt: exp}
	}
	return s
}

func (s *ResultStore) path(id string) string {
	return filepath.Join(s.dir, id+".json")
}

// removeLocked drops an entry and its file. Caller holds s.mu.
func (s *ResultStore) removeLocked(id string) {
	delete(s.entries, id)
	if s.dir != "" {
		_ = os.Remove(s.path(id))
	}
}

// Save stores a result and returns its ID.
func (s *ResultStore) Save(result *models.ScanResult) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	id := hex.EncodeToString(b)

	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	for k, v := range s.entries {
		if now.After(v.expiresAt) {
			s.removeLocked(k)
		}
	}
	for len(s.entries) >= resultMaxEntries {
		var oldest string
		var oldestTime time.Time
		for k, v := range s.entries {
			if oldest == "" || v.expiresAt.Before(oldestTime) {
				oldest, oldestTime = k, v.expiresAt
			}
		}
		s.removeLocked(oldest)
	}

	entry := resultEntry{expiresAt: now.Add(resultTTL)}
	if s.dir != "" {
		data, err := json.Marshal(result)
		if err == nil {
			err = os.WriteFile(s.path(id), data, 0o600)
		}
		if err != nil {
			entry.result = result // disk failed: keep it in memory instead
		}
	} else {
		entry.result = result
	}
	s.entries[id] = entry
	return id
}

// Get returns a stored result, or false if the ID is unknown or expired.
func (s *ResultStore) Get(id string) (*models.ScanResult, bool) {
	if !resultIDPattern.MatchString(id) {
		return nil, false
	}
	s.mu.Lock()
	entry, ok := s.entries[id]
	if ok && time.Now().After(entry.expiresAt) {
		s.removeLocked(id)
		ok = false
	}
	s.mu.Unlock()
	if !ok {
		return nil, false
	}
	if entry.result != nil {
		return entry.result, true
	}
	data, err := os.ReadFile(s.path(id))
	if err != nil {
		return nil, false
	}
	var result models.ScanResult
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, false
	}
	return &result, true
}
