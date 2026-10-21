package visits

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// VisitRecord represents a single captured visit event.
type VisitRecord struct {
	Email     string `json:"email"`
	Timestamp string `json:"ts"` // RFC3339 UTC
}

// Store handles append-only storage of visit records in a JSONL file.
type Store struct {
	filePath string
	mu       sync.Mutex
}

// NewStore creates a new visit store writing to the given file path.
func NewStore(filePath string) *Store {
	if filePath == "" {
		filePath = "data/visits.jsonl"
	}
	return &Store{
		filePath: filePath,
	}
}

// Save appends a VisitRecord as a JSON line to the file.
func (s *Store) Save(rec *VisitRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := filepath.Dir(s.filePath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory for visit store: %w", err)
		}
	}

	data, err := json.Marshal(rec)
	if err != nil {
		return fmt.Errorf("failed to marshal visit record: %w", err)
	}
	data = append(data, '\n')

	f, err := os.OpenFile(s.filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("failed to open visit store file: %w", err)
	}
	defer f.Close()

	if _, err := f.Write(data); err != nil {
		return fmt.Errorf("failed to write visit record: %w", err)
	}

	return nil
}

// ReadAll reads all visit records from the store file.
func (s *Store) ReadAll() ([]VisitRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	return ReadFile(s.filePath)
}

// ReadFile parses all visit records from a JSONL file.
func ReadFile(filePath string) ([]VisitRecord, error) {
	f, err := os.Open(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to open visit file: %w", err)
	}
	defer f.Close()

	var records []VisitRecord
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var rec VisitRecord
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			continue // skip corrupted line
		}
		if rec.Email != "" {
			records = append(records, rec)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading visit file: %w", err)
	}
	return records, nil
}

// UserMonthlyStat summarizes visit statistics for one user in one calendar month.
type UserMonthlyStat struct {
	Email       string   `json:"email"`
	Month       string   `json:"month"` // YYYY-MM
	VisitDays   int      `json:"visit_days"`
	TotalVisits int      `json:"total_visits"`
	DaysList    []string `json:"days,omitempty"`
}

// MonthlySummary aggregates metrics across all users for a given month.
type MonthlySummary struct {
	Month          string            `json:"month"`
	TotalUsers     int               `json:"total_users"`
	TotalVisits    int               `json:"total_visits"`
	TotalVisitDays int               `json:"total_visit_days"`
	ReturnUsers    int               `json:"return_users"` // VisitDays >= 2
	ReturnUserPct  float64           `json:"return_user_pct"`
	FrequentUsers  int               `json:"frequent_users"` // VisitDays >= 5
	Users          []UserMonthlyStat `json:"users"`
}

// AggregateByMonth groups records by month and email, calculating distinct visit days and total visits.
func AggregateByMonth(records []VisitRecord) map[string]*MonthlySummary {
	type userAcc struct {
		days  map[string]bool
		total int
	}

	data := make(map[string]map[string]*userAcc)

	for _, r := range records {
		email := strings.ToLower(strings.TrimSpace(r.Email))
		if email == "" {
			continue
		}
		t, err := time.Parse(time.RFC3339, r.Timestamp)
		if err != nil {
			t, err = time.Parse("2006-01-02T15:04:05Z07:00", r.Timestamp)
			if err != nil {
				continue
			}
		}
		utc := t.UTC()
		month := utc.Format("2006-01")
		day := utc.Format("2006-01-02")

		if data[month] == nil {
			data[month] = make(map[string]*userAcc)
		}
		if data[month][email] == nil {
			data[month][email] = &userAcc{days: make(map[string]bool)}
		}
		data[month][email].days[day] = true
		data[month][email].total++
	}

	summaries := make(map[string]*MonthlySummary)
	for month, users := range data {
		s := &MonthlySummary{
			Month: month,
		}
		for email, acc := range users {
			var daysList []string
			for d := range acc.days {
				daysList = append(daysList, d)
			}
			sort.Strings(daysList)

			uStat := UserMonthlyStat{
				Email:       email,
				Month:       month,
				VisitDays:   len(acc.days),
				TotalVisits: acc.total,
				DaysList:    daysList,
			}
			s.Users = append(s.Users, uStat)
			s.TotalVisits += acc.total
			s.TotalVisitDays += len(acc.days)
			if len(acc.days) >= 2 {
				s.ReturnUsers++
			}
			if len(acc.days) >= 5 {
				s.FrequentUsers++
			}
		}
		s.TotalUsers = len(s.Users)
		if s.TotalUsers > 0 {
			s.ReturnUserPct = (float64(s.ReturnUsers) / float64(s.TotalUsers)) * 100
		}

		sort.Slice(s.Users, func(i, j int) bool {
			if s.Users[i].VisitDays != s.Users[j].VisitDays {
				return s.Users[i].VisitDays > s.Users[j].VisitDays
			}
			return s.Users[i].Email < s.Users[j].Email
		})

		summaries[month] = s
	}

	return summaries
}
