package leads

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/smtp"
	"os"
	"path/filepath"
	"sync"

	"go.uber.org/zap"
)

// LeadRecord represents a single captured email lead.
type LeadRecord struct {
	Email     string `json:"email"`
	Source    string `json:"source"`
	Consent   bool   `json:"consent"`
	IPHash    string `json:"ip_hash"`
	UserAgent string `json:"user_agent"`
	Timestamp string `json:"ts"`
}

// Store handles append-only storage of lead records in a JSONL file.
type Store struct {
	filePath string
	mu       sync.Mutex
}

// NewStore creates a new lead store writing to the given file path.
func NewStore(filePath string) *Store {
	if filePath == "" {
		filePath = "data/leads.jsonl"
	}
	return &Store{
		filePath: filePath,
	}
}

// Save appends a LeadRecord as a JSON line to the file.
func (s *Store) Save(rec *LeadRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := filepath.Dir(s.filePath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory for lead store: %w", err)
		}
	}

	data, err := json.Marshal(rec)
	if err != nil {
		return fmt.Errorf("failed to marshal lead record: %w", err)
	}
	data = append(data, '\n')

	f, err := os.OpenFile(s.filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("failed to open lead store file: %w", err)
	}
	defer f.Close()

	if _, err := f.Write(data); err != nil {
		return fmt.Errorf("failed to write lead record: %w", err)
	}

	return nil
}

// HashIP creates a SHA-256 hash of the IP address with a salt.
func HashIP(ip, salt string) string {
	if ip == "" {
		return ""
	}
	h := sha256.New()
	h.Write([]byte(ip + ":" + salt))
	return hex.EncodeToString(h.Sum(nil))
}

// Notifier defines the interface for sending lead notification alerts.
type Notifier interface {
	Notify(ctx context.Context, rec *LeadRecord) error
}

// SMTPNotifier sends lead notification emails via net/smtp.
type SMTPNotifier struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	To       string
	Logger   *zap.Logger
}

// NewSMTPNotifier initializes an SMTPNotifier.
func NewSMTPNotifier(host string, port int, username, password, from, to string, logger *zap.Logger) *SMTPNotifier {
	if port == 0 {
		port = 587
	}
	if to == "" {
		to = "iamsabroy@gmail.com"
	}
	return &SMTPNotifier{
		Host:     host,
		Port:     port,
		Username: username,
		Password: password,
		From:     from,
		To:       to,
		Logger:   logger,
	}
}

// Notify sends an owner notification email asynchronously.
func (n *SMTPNotifier) Notify(ctx context.Context, rec *LeadRecord) error {
	if n == nil || n.Host == "" || n.From == "" {
		return nil // SMTP not configured; skip cleanly
	}

	addr := fmt.Sprintf("%s:%d", n.Host, n.Port)
	var auth smtp.Auth
	if n.Username != "" {
		auth = smtp.PlainAuth("", n.Username, n.Password, n.Host)
	}

	subject := fmt.Sprintf("Subject: New AccessScan Lead: %s\r\n", rec.Email)
	headers := fmt.Sprintf("From: %s\r\nTo: %s\r\n%sMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n", n.From, n.To, subject)
	body := fmt.Sprintf("New lead captured on AccessScan landing page!\n\nEmail: %s\nSource: %s\nConsent: %t\nTimestamp: %s\nUser Agent: %s\nIP Hash: %s\n",
		rec.Email, rec.Source, rec.Consent, rec.Timestamp, rec.UserAgent, rec.IPHash)

	msg := []byte(headers + body)

	// Fire in goroutine to not block caller
	go func() {
		err := smtp.SendMail(addr, auth, n.From, []string{n.To}, msg)
		if err != nil && n.Logger != nil {
			n.Logger.Warn("failed to send lead notification email", zap.Error(err))
		}
	}()

	return nil
}
