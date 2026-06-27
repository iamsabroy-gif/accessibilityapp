package models

import "time"

// ScanRequest is the payload for POST /api/v1/scan.
type ScanRequest struct {
	URL          string `json:"url"`
	WCAGLevel    string `json:"wcag_level,omitempty"` // "AA" or "AAA"; defaults to server config
	Depth        int    `json:"depth,omitempty"` // 0 (default) or 1, max 1
	VisualReport bool   `json:"visual_report,omitempty"` // request visual HTML report
}

// BBox holds the absolute pixel coordinates of a DOM element on the scanned page.
type BBox struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

// PassRule represents a passing axe rule with its tested node count.
type PassRule struct {
	ID        string `json:"id"`
	NodeCount int    `json:"node_count"`
}

// SCScore holds per-success-criterion scoring data for the AudioEye methodology.
type SCScore struct {
	FailedElements int     `json:"failed_elements"`
	TestedElements int     `json:"tested_elements"`
	FailureRate    float64 `json:"failure_rate"`
	Weight         float64 `json:"weight"`
	WeightedRate   float64 `json:"weighted_rate"`
}

// AudioEyeResult holds the AudioEye element-level failure-rate score.
type AudioEyeResult struct {
	Score           int                `json:"score"`
	Grade           string             `json:"grade"`
	SCBreakdown     map[string]SCScore `json:"sc_breakdown"`
	SCsEvaluated    int                `json:"scs_evaluated"`
	WeightedFailure float64            `json:"weighted_failure"`
	SiteScore       int                `json:"site_score,omitempty"`
}

// Node represents a specific DOM element that triggered a violation.
type Node struct {
	HTML           string   `json:"html"`
	Target         []string `json:"target"`
	FailureSummary string   `json:"failure_summary,omitempty"`
	BBox           *BBox    `json:"bbox,omitempty"` // pixel coords on full-page screenshot
}

// DevSuggestion holds developer-facing remediation guidance for a violation.
type DevSuggestion struct {
	Title      string   `json:"title"`
	FixSteps   []string `json:"fix_steps"`
	CodeBefore string   `json:"code_before,omitempty"`
	CodeAfter  string   `json:"code_after,omitempty"`
	Language   string   `json:"language,omitempty"` // "html" | "css" | "js"
}

// Violation represents a single WCAG accessibility violation.
type Violation struct {
	ID             string         `json:"id"`
	Impact         string         `json:"impact"` // "critical" | "serious" | "moderate" | "minor"
	Description    string         `json:"description"`
	Help           string         `json:"help"`
	HelpURL        string         `json:"help_url"`
	Tags           []string       `json:"tags"`
	Nodes          []Node         `json:"nodes"`
	ViolationIndex int            `json:"violationIndex,omitempty"` // 1-based index for overlay markers
	DevSuggestion  *DevSuggestion `json:"dev_suggestion,omitempty"` // developer fix guidance
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
	AudioEyeScore   int     `json:"audioeye_score"`
}

// ScanResult is the full response payload returned after a scan.
type ScanResult struct {
	URL        string      `json:"url"`
	ScannedAt  time.Time   `json:"scanned_at"`
	DurationMs int64       `json:"duration_ms"`
	Summary    Summary     `json:"summary"`
	Violations []Violation `json:"violations"`
	Passes               []string         `json:"passes,omitempty"`
	PassRules            []PassRule       `json:"pass_rules,omitempty"`
	AudioEye             *AudioEyeResult  `json:"audioeye,omitempty"`
	PassGuidelines       []string    `json:"passes_guidelines,omitempty"`
	ViolationGuidelines  []string    `json:"violation_guidelines,omitempty"`
	Incomplete           []string    `json:"incomplete,omitempty"`
	IncompleteGuidelines []string    `json:"incomplete_guidelines,omitempty"`
	EmbeddedResults      []ScanResult `json:"embedded_results,omitempty"`
	PageHTML         string       `json:"page_html,omitempty"`
	VisualReportPath string       `json:"visual_report_path,omitempty"`
	VisualReportHTML string       `json:"visual_report_html,omitempty"` // full HTML report, returned when visual_report=true
	Screenshot       string       `json:"screenshot,omitempty"`         // base64-encoded PNG of the scanned page
}

// ErrorResponse is the standard error envelope.
type ErrorResponse struct {
	Error   string `json:"error"`
	Details string `json:"details,omitempty"`
}
