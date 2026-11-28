package access

import (
	"fmt"
	"net/smtp"
	"strings"
	"time"

	"go.uber.org/zap"
)

// Mailer sends a plain-text email.
type Mailer interface {
	Send(to, subject, body string) error
}

// SMTPMailer sends email through an SMTP server in the background.
type SMTPMailer struct {
	Host, Username, Password, From string
	Port                           int
	Logger                         *zap.Logger
}

// Configured reports whether enough settings are present to send mail.
func (m *SMTPMailer) Configured() bool { return m != nil && m.Host != "" && m.From != "" }

// Send queues the email and returns immediately; failures are logged.
func (m *SMTPMailer) Send(to, subject, body string) error {
	if !m.Configured() {
		if m != nil && m.Logger != nil {
			m.Logger.Warn("SMTP not configured; access email not sent", zap.String("subject", subject))
		}
		return nil
	}
	port := m.Port
	if port == 0 {
		port = 587
	}
	addr := fmt.Sprintf("%s:%d", m.Host, port)
	var auth smtp.Auth
	if m.Username != "" {
		auth = smtp.PlainAuth("", m.Username, m.Password, m.Host)
	}
	subject = strings.NewReplacer("\r", " ", "\n", " ").Replace(subject)
	msg := []byte(fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s",
		m.From, to, subject, body))
	go func() {
		if err := smtp.SendMail(addr, auth, m.From, []string{to}, msg); err != nil && m.Logger != nil {
			m.Logger.Warn("failed to send access email", zap.String("subject", subject), zap.Error(err))
		}
	}()
	return nil
}

// OwnerRequestEmail is sent to the owner when a returning user asks for access.
func OwnerRequestEmail(r *Request, reviewURL string, defaultScans int) (subject, body string) {
	subject = "AccessScan access request: " + r.Email
	body = fmt.Sprintf(`A returning user is asking for access to AccessScan.

Email:     %s
Requested: %s

Review and approve or deny (opens a confirmation page):
%s

If approved, %s gets an email with an access code good for %d scans
(you can change the number on the review page).

You can also manage all requests in the admin console under "Access".
`, r.Email, r.RequestedAt, reviewURL, r.Email, defaultScans)
	return
}

// UserApprovedEmail is sent to the user once the owner approves.
func UserApprovedEmail(r *Request, code, appURL string) (subject, body string) {
	expiry := "does not expire"
	if t, err := time.Parse(time.RFC3339, r.ExpiresAt); err == nil {
		expiry = "is valid until " + t.Format("2 January 2006")
	}
	subject = "Your AccessScan access is approved"
	body = fmt.Sprintf(`Good news — your request for AccessScan access has been approved.

Your access code:

    %s

It includes %d scans and %s.

To use it, open %s, start a scan, and paste the code when asked.
Keep it private: anyone with the code can use your scans.
`, code, r.MaxScans, expiry, appURL)
	return
}

// LoginCodeEmail is sent to a user with their 6-digit email login code.
func LoginCodeEmail(code string, ttl time.Duration) (subject, body string) {
	mins := int(ttl.Minutes())
	if mins <= 0 {
		mins = 10
	}
	subject = "Your AccessScan login code"
	body = fmt.Sprintf(`Your AccessScan login code is:

    %s

It expires in %d minutes and can only be used once.

If you did not request this code, you can safely ignore this email.
`, code, mins)
	return
}

// UserScansAddedEmail is sent to a user when an admin approves additional scans on their account.
func UserScansAddedEmail(scansAdded int, appURL string) (subject, body string) {
	subject = fmt.Sprintf("You've been approved for %d more AccessScan scans", scansAdded)
	linkLine := ""
	if appURL != "" {
		linkLine = fmt.Sprintf("\nSign in with your email at %s to start scanning.\n", appURL)
	}
	body = fmt.Sprintf(`Good news — you've been approved for %d more scans on AccessScan.

The scans have been added to your account automatically; no code is needed.%s`, scansAdded, linkLine)
	return
}
