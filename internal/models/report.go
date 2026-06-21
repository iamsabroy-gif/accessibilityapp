package models

import "time"

// ScanRequest is the payload for POST /api/v1/scan.
type ScanRequest struct {
	URL       string `json:"url"`
	WCAGLevel string `json:"wcag_level,omitempty"` // "AA" or "AAA"; defaults to server config
	Depth     int    `json:"depth,omitempty"` // 0 (default) or 1, max 1
}

// Node represents a specific DOM element that triggered a violation.
type Node struct {
	HTML           string   `json:"html"`
	Target         []string `json:"target"`
	FailureSummary string   `json:"failure_summary,omitempty"`
}

// Violation represents a single WCAG accessibility violation.
type Violation struct {
	ID          string   `json:"id"`
	Impact      string   `json:"impact"` // "critical" | "serious" | "moderate" | "minor"
	Description string   `json:"description"`
	Help        string   `json:"help"`
	HelpURL     string   `json:"help_url"`
	Tags        []string `json:"tags"`
	Nodes       []Node   `json:"nodes"`
}

// Summary holds aggregated counts and the accessibility score for the scan.
type Summary struct {
	ViolationCount  int     `json:"violations"`
	PassCount       int     `json:"passes"`
	IncompleteCount int     `json:"incomplete"`
	Level           string  `json:"wcag_level"`
	Score           int     `json:"score"`            // 0–100, higher is better
	Grade           string  `json:"grade"`            // A, B, C, D, or F
	CompliancePct   float64 `json:"compliance_pct"`   // passes / (passes + violations) × 100
}

// ScanResult is the full response payload returned after a scan.
type ScanResult struct {
	URL        string      `json:"url"`
	ScannedAt  time.Time   `json:"scanned_at"`
	DurationMs int64       `json:"duration_ms"`
	Summary    Summary     `json:"summary"`
	Violations []Violation `json:"violations"`
	Passes               []string    `json:"passes,omitempty"`
	PassGuidelines       []string    `json:"passes_guidelines,omitempty"`
	ViolationGuidelines  []string    `json:"violation_guidelines,omitempty"`
	Incomplete           []string    `json:"incomplete,omitempty"`
	IncompleteGuidelines []string    `json:"incomplete_guidelines,omitempty"`
	EmbeddedResults      []ScanResult `json:"embedded_results,omitempty"`
}

// ErrorResponse is the standard error envelope.
type ErrorResponse struct {
	Error   string `json:"error"`
	Details string `json:"details,omitempty"`
}
