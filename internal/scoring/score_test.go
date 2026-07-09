package scoring

import (
	"strings"
	"testing"
	"time"

	"github.com/webaccessibility/server/internal/models"
)

// ── TestCalculate_CompliancePctIncludesIncomplete ────────────────────────────
// Gap 3 fix: incomplete count must be part of the denominator.

func TestCalculate_CompliancePctIncludesIncomplete(t *testing.T) {
	t.Parallel()
	violations := []models.Violation{
		{ID: "color-contrast", Impact: "serious", Nodes: make([]models.Node, 1)},
	}
	// passCount=4, violations=1, incomplete=5 → denominator=10 → pct=40
	_, _, pct := Calculate(violations, 4, 5, FormulaCompliance)
	const want = 40.0
	if pct != want {
		t.Errorf("compliance pct = %.2f; want %.2f (incomplete in denominator)", pct, want)
	}
}

func TestCalculate_ZeroIncompleteUnchanged(t *testing.T) {
	t.Parallel()
	violations := []models.Violation{
		{ID: "color-contrast", Impact: "serious", Nodes: make([]models.Node, 1)},
	}
	// When incomplete=0 behaviour is identical to old signature: 3/(3+1)=75%
	_, _, pct := Calculate(violations, 3, 0, FormulaCompliance)
	const want = 75.0
	if pct != want {
		t.Errorf("compliance pct = %.2f; want %.2f", pct, want)
	}
}

// ── TestCalculateAudioEye_ZeroSCsReturnsWarning ──────────────────────────────
// Gap 4 fix: must not return Score:100 when 0 SCs evaluated.

func TestCalculateAudioEye_ZeroSCsReturnsWarning(t *testing.T) {
	t.Parallel()
	result := CalculateAudioEye(nil, nil, map[string][]string{})
	if result.Score != 0 {
		t.Errorf("Score = %d; want 0 (zero SCs evaluated)", result.Score)
	}
	if result.Grade != "F" {
		t.Errorf("Grade = %q; want 'F'", result.Grade)
	}
	if result.Warning == "" {
		t.Error("Warning must be non-empty when zero SCs evaluated")
	}
	if result.SCsEvaluated != 0 {
		t.Errorf("SCsEvaluated = %d; want 0", result.SCsEvaluated)
	}
}

// ── TestConformanceLevel_TestedInconclusive ──────────────────────────────────
// Gap 3 fix: SC with rules that returned incomplete → TestedInconclusive.

func TestConformanceLevel_TestedInconclusive(t *testing.T) {
	t.Parallel()
	sc := models.SCScore{TestedElements: 0, FailedElements: 0}
	got := conformanceLevelForSC("2.4.7", sc, true, true)
	if got != models.ConformanceTestedInconclusive {
		t.Errorf("conformanceLevelForSC = %q; want %q", got, models.ConformanceTestedInconclusive)
	}
}

func TestConformanceLevel_NotEvaluatedWhenNoIncomplete(t *testing.T) {
	t.Parallel()
	sc := models.SCScore{TestedElements: 0}
	got := conformanceLevelForSC("2.4.7", sc, true, false)
	if got != models.ConformanceNotEvaluated {
		t.Errorf("conformanceLevelForSC = %q; want %q", got, models.ConformanceNotEvaluated)
	}
}

func TestConformanceLevel_NotEvaluatedWhenNoRule(t *testing.T) {
	t.Parallel()
	sc := models.SCScore{}
	got := conformanceLevelForSC("2.3.1", sc, false, false)
	if got != models.ConformanceNotEvaluated {
		t.Errorf("conformanceLevelForSC = %q; want %q", got, models.ConformanceNotEvaluated)
	}
}

// ── Helpers for BuildComplianceReport tests ──────────────────────────────────

func minimalScanResult() *models.ScanResult {
	return &models.ScanResult{
		URL:       "https://example.com",
		ScannedAt: time.Now().UTC(),
		Summary:   models.Summary{Level: "AA"},
		AudioEye: &models.AudioEyeResult{
			Score:        100,
			Grade:        "A",
			SCBreakdown:  map[string]models.SCScore{},
			SCsEvaluated: 0,
		},
	}
}

// ── TestBuildComplianceReport_IncludesWCAG22 ─────────────────────────────────
// Gap 1 fix: WCAG 2.2 SCs must appear in reports for non-508 standards.

func TestBuildComplianceReport_IncludesWCAG22(t *testing.T) {
	t.Parallel()
	result := minimalScanResult()
	cr, err := BuildComplianceReport(result, "ADA", models.ReportMeta{})
	if err != nil {
		t.Fatalf("BuildComplianceReport: %v", err)
	}

	wcag22SCs := []string{"2.4.11", "2.4.13", "2.5.7", "2.5.8", "3.2.6", "3.3.7", "3.3.8"}
	found := map[string]bool{}
	for _, row := range cr.Rows {
		found[row.SCID] = true
	}
	for _, sc := range wcag22SCs {
		if !found[sc] {
			t.Errorf("WCAG 2.2 SC %s missing from ADA report", sc)
		}
	}
}

// ── TestBuildComplianceReport_508NotApplicableFor22 ──────────────────────────
// 508 mode: WCAG 2.2 SCs must be NotApplicable (same path as 2.1 SCs).

func TestBuildComplianceReport_508NotApplicableFor22(t *testing.T) {
	t.Parallel()
	result := minimalScanResult()
	cr, err := BuildComplianceReport(result, "508", models.ReportMeta{})
	if err != nil {
		t.Fatalf("BuildComplianceReport: %v", err)
	}

	wcag22SCs := []string{"2.4.11", "2.5.8", "3.3.8"}
	scMap := map[string]models.ConformanceLevel{}
	for _, row := range cr.Rows {
		scMap[row.SCID] = row.Conformance
	}
	for _, sc := range wcag22SCs {
		level, ok := scMap[sc]
		if !ok {
			t.Errorf("SC %s missing from 508 report", sc)
			continue
		}
		if level != models.ConformanceNotApplicable {
			t.Errorf("SC %s in 508 mode: got %q, want %q", sc, level, models.ConformanceNotApplicable)
		}
	}
}

// ── TestBuildComplianceReport_NotAutomatableSCsExplained ─────────────────────
// Gap 2 fix: the 6 newly flagged SCs must have a non-empty LimitationNote remark.

func TestBuildComplianceReport_NotAutomatableSCsExplained(t *testing.T) {
	t.Parallel()
	result := minimalScanResult()
	cr, err := BuildComplianceReport(result, "ADA", models.ReportMeta{})
	if err != nil {
		t.Fatalf("BuildComplianceReport: %v", err)
	}

	newlyFlagged := []string{"1.2.5", "1.4.2", "2.1.4", "2.5.2", "3.3.3", "4.1.3"}
	scMap := map[string]models.SCConformanceRow{}
	for _, row := range cr.Rows {
		scMap[row.SCID] = row
	}
	for _, sc := range newlyFlagged {
		row, ok := scMap[sc]
		if !ok {
			t.Errorf("SC %s missing from report", sc)
			continue
		}
		if row.Conformance != models.ConformanceNotEvaluated {
			t.Errorf("SC %s: expected NotEvaluated (NotAutomatable), got %q", sc, row.Conformance)
		}
		if strings.TrimSpace(row.Remarks) == "" {
			t.Errorf("SC %s: NotAutomatable row must have a non-empty LimitationNote remark", sc)
		}
	}
}

// ── TestBuildComplianceReport_NewFieldsPopulated ─────────────────────────────
// Gap 6 fix: EvaluatedSCs, ManualTestRequiredCount, ScanWCAGLevel must be set.

func TestBuildComplianceReport_NewFieldsPopulated(t *testing.T) {
	t.Parallel()
	result := minimalScanResult()
	cr, err := BuildComplianceReport(result, "ADA", models.ReportMeta{})
	if err != nil {
		t.Fatalf("BuildComplianceReport: %v", err)
	}
	if cr.ScanWCAGLevel == "" {
		t.Error("ScanWCAGLevel must not be empty")
	}
	if cr.TotalSCs == 0 {
		t.Error("TotalSCs must be > 0")
	}
	// ManualTestRequiredCount should be > 0 since many SCs have ManualTestingRequired:true
	if cr.ManualTestRequiredCount == 0 {
		t.Error("ManualTestRequiredCount must be > 0 for a full report")
	}
}

// ── TestBuildComplianceReport_SCRegistryCount ─────────────────────────────────
// Sanity check: SCRegistry now has 57 entries (50 original + 7 WCAG 2.2).

func TestBuildComplianceReport_SCRegistryCount(t *testing.T) {
	t.Parallel()
	n := len(models.SCRegistry)
	if n != 57 {
		t.Errorf("len(SCRegistry) = %d; want 57 (50 original + 7 WCAG 2.2)", n)
	}
}

// ── TestBuildComplianceReport_NotAutomatableWithRealRule ──────────────────────
// Fixture scan includes a violation/pass for timing-adjustable; assert 2.2.1
// is not NotEvaluated and reflects the real outcome.
func TestBuildComplianceReport_NotAutomatableWithRealRule(t *testing.T) {
	t.Parallel()
	result := minimalScanResult()
	
	// Add mock AudioEye breakdown data for 2.2.1:
	result.AudioEye.SCBreakdown["2.2.1"] = models.SCScore{
		FailedElements: 0,
		TestedElements: 5,
		FailureRate:    0.0,
	}

	cr, err := BuildComplianceReport(result, "ADA", models.ReportMeta{})
	if err != nil {
		t.Fatalf("BuildComplianceReport: %v", err)
	}

	var found221 bool
	for _, row := range cr.Rows {
		if row.SCID == "2.2.1" {
			found221 = true
			if row.Conformance != models.ConformanceSupports {
				t.Errorf("SC 2.2.1 expected ConformanceSupports, got %q", row.Conformance)
			}
			expectedLimitation := "Detecting time limits and evaluating adjustment mechanisms requires manual testing during user session interactions."
			if !strings.Contains(row.Remarks, expectedLimitation) {
				t.Errorf("SC 2.2.1 Remarks should contain the LimitationNote, got %q", row.Remarks)
			}
		}
	}
	if !found221 {
		t.Error("SC 2.2.1 not found in report rows")
	}
}

// ── TestBuildComplianceReport_NotAutomatableNoRule ───────────────────────────
// Fixture scan has no data for 1.2.5; assert the row stays NotEvaluated with Remarks == scMeta.LimitationNote.
func TestBuildComplianceReport_NotAutomatableNoRule(t *testing.T) {
	t.Parallel()
	result := minimalScanResult()

	cr, err := BuildComplianceReport(result, "ADA", models.ReportMeta{})
	if err != nil {
		t.Fatalf("BuildComplianceReport: %v", err)
	}

	var found125 bool
	for _, row := range cr.Rows {
		if row.SCID == "1.2.5" {
			found125 = true
			if row.Conformance != models.ConformanceNotEvaluated {
				t.Errorf("SC 1.2.5 expected ConformanceNotEvaluated, got %q", row.Conformance)
			}
			expectedLimitation := "Determining whether audio descriptions exist and are adequate requires manual review of video content with an audio specialist. Automated scanning cannot evaluate audio description quality or completeness."
			if row.Remarks != expectedLimitation {
				t.Errorf("SC 1.2.5 Remarks expected %q, got %q", expectedLimitation, row.Remarks)
			}
		}
	}
	if !found125 {
		t.Error("SC 1.2.5 not found in report rows")
	}
}

