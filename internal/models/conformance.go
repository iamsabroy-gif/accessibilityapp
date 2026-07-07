package models

import "time"

type ConformanceLevel string

const (
    ConformanceSupports          ConformanceLevel = "Supports"
    ConformancePartiallySupports ConformanceLevel = "Partially Supports"
    ConformanceDoesNotSupport    ConformanceLevel = "Does Not Support"
    ConformanceNotApplicable     ConformanceLevel = "Not Applicable"
    ConformanceNotEvaluated      ConformanceLevel = "Not Evaluated"
)

// SCConformanceRow is the common intermediate representation for one SC row.
// All three formatters (ADA, VPAT, EN 301 549) consume this type.
type SCConformanceRow struct {
    SCID                  string           `json:"sc_id"`
    SCName                string           `json:"sc_name"`
    Level                 string           `json:"level"`                    // "A" | "AA"
    WCAGVersion           string           `json:"wcag_version"`             // "2.0" | "2.1" | "2.2"
    EN301549Clause        string           `json:"en301549_clause,omitempty"` // e.g. "9.1.1.1"
    Conformance           ConformanceLevel `json:"conformance"`
    Remarks               string           `json:"remarks"`
    ManualTestingRequired bool             `json:"manual_testing_required"`
    SCScore               *SCScore         `json:"sc_score,omitempty"` // nil for N/A and Not Evaluated rows
}

// ReportMeta holds product/vendor metadata for VPAT and EN 301 549 headers.
type ReportMeta struct {
    ProductName    string `json:"product_name"`
    VendorName     string `json:"vendor_name"`
    ProductVersion string `json:"product_version,omitempty"`
    ContactInfo    string `json:"contact_info,omitempty"`
    Notes          string `json:"notes,omitempty"`
}

// ComplianceReport is the intermediate representation consumed by all report formatters.
// BuildComplianceReport in internal/scoring/score.go produces this from a ScanResult.
type ComplianceReport struct {
    URL         string             `json:"url"`
    ScannedAt   time.Time          `json:"scanned_at"`
    Standard    string             `json:"standard"`    // "ADA" | "508" | "EN301549"
    WCAGLevel   string             `json:"wcag_level"`  // "A" | "AA"
    ReportDate  string             `json:"report_date"` // "2006-01-02"
    Meta        ReportMeta         `json:"meta"`
    Rows        []SCConformanceRow `json:"rows"`
    // Aggregate counts
    TotalSCs      int `json:"total_scs"`
    SupportsCount int `json:"supports"`
    PartialCount  int `json:"partially_supports"`
    FailCount     int `json:"does_not_support"`
    NotEvalCount  int `json:"not_evaluated"`
    NotApplCount  int `json:"not_applicable"`
}
