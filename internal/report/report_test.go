package report

import (
	"strings"
	"testing"
	"time"

	"github.com/webaccessibility/server/internal/models"
)

// fixtureComplianceReport returns a ComplianceReport that exercises every
// ConformanceLevel state, including the new TestedInconclusive.
func fixtureComplianceReport() *models.ComplianceReport {
	now := time.Now().UTC()
	return &models.ComplianceReport{
		URL:                     "https://example.com",
		ScannedAt:               now,
		Standard:                "ADA",
		WCAGLevel:               "AA",
		ScanWCAGLevel:           "AA",
		ReportDate:              now.Format("2006-01-02"),
		Meta:                    models.ReportMeta{ProductName: "Test Product", VendorName: "Test Vendor"},
		TotalSCs:                6,
		SupportsCount:           1,
		PartialCount:            1,
		FailCount:               1,
		NotEvalCount:            1,
		NotApplCount:            1,
		TestedInconclusiveCount: 1,
		EvaluatedSCs:            2,
		ManualTestRequiredCount: 3,
		AudioEyeWarning:         "No success criteria evaluated — result is not a compliance score.",
		Rows: []models.SCConformanceRow{
			{SCID: "1.1.1", SCName: "Non-text Content", Level: "A", WCAGVersion: "2.0",
				Conformance: models.ConformanceSupports, Remarks: "All images have alt text."},
			{SCID: "1.4.3", SCName: "Contrast (Minimum)", Level: "AA", WCAGVersion: "2.0",
				Conformance: models.ConformancePartiallySupports, Remarks: "Some contrast issues."},
			{SCID: "2.1.1", SCName: "Keyboard", Level: "A", WCAGVersion: "2.0",
				Conformance: models.ConformanceDoesNotSupport, Remarks: "Keyboard traps found."},
			{SCID: "1.2.4", SCName: "Captions (Live)", Level: "AA", WCAGVersion: "2.0",
				Conformance: models.ConformanceNotEvaluated, Remarks: "Live captions require manual testing."},
			{SCID: "2.1.2", SCName: "No Keyboard Trap", Level: "A", WCAGVersion: "2.0",
				Conformance: models.ConformanceNotApplicable, Remarks: "Not applicable for 508."},
			{SCID: "2.4.11", SCName: "Focus Not Obscured (Minimum)", Level: "AA", WCAGVersion: "2.2",
				EN301549Clause: "9.2.4.11",
				Conformance:    models.ConformanceTestedInconclusive, Remarks: "Rule ran but returned incomplete results."},
		},
	}
}

// TestReportFormatters_AllSmoke runs each Generate* formatter against a fixture
// ComplianceReport that exercises all six conformance states. It checks that:
//   - no panic occurs
//   - output is non-empty HTML
//   - the TestedInconclusive state is rendered
//   - the Scope & Limitations block is present
func TestReportFormatters_AllSmoke(t *testing.T) {
	cr := fixtureComplianceReport()

	tests := []struct {
		name string
		fn   func() (string, error)
	}{
		{"VPAT", func() (string, error) {
			html, _, err := GenerateVPAT(cr, VPATOptions{Edition: VPATEditionINT})
			return html, err
		}},
		{"EN301549", func() (string, error) {
			html, _, err := GenerateEN301549(cr, EN301549Options{})
			return html, err
		}},
		{"EN301549_EAA", func() (string, error) {
			html, _, err := GenerateEN301549(cr, EN301549Options{ReportType: "EAA"})
			return html, err
		}},
		{"EN301549_BITV", func() (string, error) {
			html, _, err := GenerateEN301549(cr, EN301549Options{ReportType: "BITV"})
			return html, err
		}},
		{"AODA", func() (string, error) {
			html, _, err := GenerateAODA(cr, AODAOptions{})
			return html, err
		}},
		{"ACA", func() (string, error) {
			html, _, err := GenerateACA(cr, ACAOptions{})
			return html, err
		}},
		{"DDA", func() (string, error) {
			html, _, err := GenerateDDA(cr, DDAOptions{})
			return html, err
		}},
		{"GIGW", func() (string, error) {
			html, _, err := GenerateGIGW(cr, GIGWOptions{})
			return html, err
		}},
		{"CVAA", func() (string, error) {
			html, _, err := GenerateCVAA(cr, CVAAOptions{})
			return html, err
		}},
		{"UKEquality", func() (string, error) {
			html, _, err := GenerateUKEquality(cr, UKOptions{})
			return html, err
		}},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			html, err := tc.fn()
			if err != nil {
				t.Fatalf("%s: unexpected error: %v", tc.name, err)
			}
			if len(html) == 0 {
				t.Fatalf("%s: got empty HTML", tc.name)
			}
			if !strings.Contains(html, "<html") {
				t.Errorf("%s: output does not look like HTML", tc.name)
			}
			// Scope & Limitations block must be present
			if !strings.Contains(html, "Scope") {
				t.Errorf("%s: missing Scope & Limitations block", tc.name)
			}
			// TestedInconclusive state must appear somewhere
			if !strings.Contains(html, "Tested") && !strings.Contains(html, "tested-inconclusive") {
				t.Errorf("%s: Tested – Inconclusive state not rendered", tc.name)
			}
		})
	}
}

// TestScopeBlockHTML verifies the scope block renders key fields.
func TestScopeBlockHTML(t *testing.T) {
	cr := fixtureComplianceReport()
	block := ScopeBlockHTML(cr)
	if !strings.Contains(block, "Scope") {
		t.Error("ScopeBlockHTML: missing 'Scope' heading")
	}
	if !strings.Contains(block, "AA") {
		t.Error("ScopeBlockHTML: missing scan level 'AA'")
	}
	if !strings.Contains(block, "audioeye-warning") {
		t.Error("ScopeBlockHTML: missing audioeye-warning for non-empty AudioEyeWarning")
	}
}
