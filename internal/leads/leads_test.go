package leads

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"
)

func TestStoreSave(t *testing.T) {
	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "leads_test.jsonl")

	store := NewStore(filePath)

	rec1 := &LeadRecord{
		Email:     "user1@example.com",
		Source:    "scan_cta",
		Consent:   true,
		IPHash:    HashIP("192.168.1.1", "salt123"),
		UserAgent: "Mozilla/5.0",
		Timestamp: time.Now().Format(time.RFC3339),
	}

	err := store.Save(rec1)
	if err != nil {
		t.Fatalf("expected no error saving lead, got: %v", err)
	}

	rec2 := &LeadRecord{
		Email:     "user2@example.com",
		Source:    "extension_cta",
		Consent:   true,
		IPHash:    HashIP("10.0.0.1", "salt123"),
		UserAgent: "Chrome/100.0",
		Timestamp: time.Now().Format(time.RFC3339),
	}

	err = store.Save(rec2)
	if err != nil {
		t.Fatalf("expected no error saving second lead, got: %v", err)
	}

	// Read and verify JSONL file lines
	file, err := os.Open(filePath)
	if err != nil {
		t.Fatalf("expected to open lead file, got error: %v", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	var records []*LeadRecord
	for scanner.Scan() {
		var rec LeadRecord
		if err := json.Unmarshal(scanner.Bytes(), &rec); err != nil {
			t.Fatalf("failed to unmarshal line: %v", err)
		}
		records = append(records, &rec)
	}

	if len(records) != 2 {
		t.Fatalf("expected 2 records, got %d", len(records))
	}

	if records[0].Email != "user1@example.com" || records[0].Source != "scan_cta" {
		t.Errorf("record 0 mismatch: %+v", records[0])
	}
	if records[1].Email != "user2@example.com" || records[1].Source != "extension_cta" {
		t.Errorf("record 1 mismatch: %+v", records[1])
	}
}

func TestStoreConcurrentSave(t *testing.T) {
	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "concurrent_leads.jsonl")

	store := NewStore(filePath)
	var wg sync.WaitGroup
	count := 20

	for i := 0; i < count; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			rec := &LeadRecord{
				Email:     "concurrent@example.com",
				Source:    "scan_cta",
				Consent:   true,
				Timestamp: time.Now().Format(time.RFC3339),
			}
			_ = store.Save(rec)
		}(i)
	}

	wg.Wait()

	file, err := os.Open(filePath)
	if err != nil {
		t.Fatalf("failed to open file: %v", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	lines := 0
	for scanner.Scan() {
		lines++
	}

	if lines != count {
		t.Errorf("expected %d lines in file, got %d", count, lines)
	}
}

func TestHashIP(t *testing.T) {
	ip := "127.0.0.1"
	salt := "mysalt"
	h1 := HashIP(ip, salt)
	h2 := HashIP(ip, salt)

	if h1 == "" {
		t.Error("expected non-empty hash")
	}
	if h1 != h2 {
		t.Error("expected deterministic hash output")
	}

	h3 := HashIP(ip, "different_salt")
	if h1 == h3 {
		t.Error("expected different hash with different salt")
	}
}

func TestUnconfiguredSMTPNotifier(t *testing.T) {
	notifier := NewSMTPNotifier("", 587, "", "", "", "iamsabroy@gmail.com", zap.NewNop())
	err := notifier.Notify(context.Background(), &LeadRecord{Email: "test@example.com"})
	if err != nil {
		t.Errorf("expected nil error for unconfigured notifier, got %v", err)
	}
}
