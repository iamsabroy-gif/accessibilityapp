package visits

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestStoreSave(t *testing.T) {
	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "visits_test.jsonl")

	store := NewStore(filePath)

	rec1 := &VisitRecord{
		Email:     "user1@example.com",
		Timestamp: "2026-10-01T10:00:00Z",
	}

	err := store.Save(rec1)
	if err != nil {
		t.Fatalf("expected no error saving visit, got: %v", err)
	}

	rec2 := &VisitRecord{
		Email:     "user2@example.com",
		Timestamp: "2026-10-02T12:00:00Z",
	}

	err = store.Save(rec2)
	if err != nil {
		t.Fatalf("expected no error saving second visit, got: %v", err)
	}

	records, err := store.ReadAll()
	if err != nil {
		t.Fatalf("expected no error reading visits, got: %v", err)
	}

	if len(records) != 2 {
		t.Fatalf("expected 2 records, got: %d", len(records))
	}

	if records[0].Email != "user1@example.com" || records[1].Email != "user2@example.com" {
		t.Errorf("unexpected records: %+v", records)
	}
}

func TestStoreConcurrentSave(t *testing.T) {
	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "concurrent_visits.jsonl")

	store := NewStore(filePath)
	const numGoroutines = 20
	const writesPerGoroutine = 5

	var wg sync.WaitGroup
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for j := 0; j < writesPerGoroutine; j++ {
				rec := &VisitRecord{
					Email:     fmt.Sprintf("user_%d@example.com", id),
					Timestamp: time.Now().UTC().Format(time.RFC3339),
				}
				if err := store.Save(rec); err != nil {
					t.Errorf("failed to save concurrent record: %v", err)
				}
			}
		}(i)
	}

	wg.Wait()

	records, err := store.ReadAll()
	if err != nil {
		t.Fatalf("failed to read records: %v", err)
	}

	expectedTotal := numGoroutines * writesPerGoroutine
	if len(records) != expectedTotal {
		t.Errorf("expected %d records, got %d", expectedTotal, len(records))
	}
}

func TestAggregateByMonth(t *testing.T) {
	records := []VisitRecord{
		// User A in October: 3 visits across 2 distinct days
		{Email: "userA@example.com", Timestamp: "2026-10-01T10:00:00Z"},
		{Email: "userA@example.com", Timestamp: "2026-10-01T15:00:00Z"},
		{Email: "userA@example.com", Timestamp: "2026-10-05T09:00:00Z"},

		// User B in October: 1 visit (1 day)
		{Email: "userB@example.com", Timestamp: "2026-10-02T11:00:00Z"},

		// User C in October: 5 visits across 5 distinct days
		{Email: "userC@example.com", Timestamp: "2026-10-01T12:00:00Z"},
		{Email: "userC@example.com", Timestamp: "2026-10-02T12:00:00Z"},
		{Email: "userC@example.com", Timestamp: "2026-10-03T12:00:00Z"},
		{Email: "userC@example.com", Timestamp: "2026-10-04T12:00:00Z"},
		{Email: "userC@example.com", Timestamp: "2026-10-05T12:00:00Z"},

		// User A in November: 1 visit (1 day)
		{Email: "userA@example.com", Timestamp: "2026-11-01T10:00:00Z"},
	}

	summaries := AggregateByMonth(records)

	// Check October
	oct, ok := summaries["2026-10"]
	if !ok {
		t.Fatalf("expected 2026-10 summary")
	}

	if oct.TotalUsers != 3 {
		t.Errorf("expected 3 total users in Oct, got %d", oct.TotalUsers)
	}
	// Return users (days >= 2): User A (2 days) and User C (5 days) = 2 users
	if oct.ReturnUsers != 2 {
		t.Errorf("expected 2 return users in Oct, got %d", oct.ReturnUsers)
	}
	// Frequent users (days >= 5): User C (5 days) = 1 user
	if oct.FrequentUsers != 1 {
		t.Errorf("expected 1 frequent user in Oct, got %d", oct.FrequentUsers)
	}
	if oct.TotalVisits != 9 {
		t.Errorf("expected 9 total visits in Oct, got %d", oct.TotalVisits)
	}

	// Check November
	nov, ok := summaries["2026-11"]
	if !ok {
		t.Fatalf("expected 2026-11 summary")
	}
	if nov.TotalUsers != 1 || nov.ReturnUsers != 0 {
		t.Errorf("unexpected Nov summary: %+v", nov)
	}
}

func TestStoreDefaultPath(t *testing.T) {
	s := NewStore("")
	if s.filePath != "data/visits.jsonl" {
		t.Errorf("expected default data/visits.jsonl, got %s", s.filePath)
	}
}

func TestReadFileNonExistent(t *testing.T) {
	records, err := ReadFile(filepath.Join(os.TempDir(), "non_existent_file_abc.jsonl"))
	if err != nil {
		t.Fatalf("expected no error for non-existent file, got %v", err)
	}
	if len(records) != 0 {
		t.Errorf("expected 0 records, got %d", len(records))
	}
}
