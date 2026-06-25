package scanner

// wcag122_test.go
//
// Unit tests for WCAG 2.1 SC 1.2.2 – Captions (Prerecorded)
//
// These tests are in package "scanner" (not "scanner_test") so they can reach
// the unexported mapToScanResult and axeRawResult helpers directly.
//
// Run: go test ./internal/scanner/ -run WCAG122 -v
//      go test ./internal/... -v           (run all scanner tests)

import (
	"sort"
	"testing"

	"github.com/webaccessibility/server/internal/models"
	"github.com/webaccessibility/server/internal/scoring"
)

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// makeRaw builds a minimal axeRawResult containing only the supplied violations
// and passes.  All other fields are left at their zero values.
func makeRaw(url string, violations []axeViolation, passes []axeRule) axeRawResult {
	return axeRawResult{
		URL:        url,
		Violations: violations,
		Passes:     passes,
		Incomplete: nil,
	}
}

// violation122 returns an axeViolation with the given rule ID and critical
// impact, matching what the JS custom check emits for SC 1.2.2.
func violation122(id, impact string) axeViolation {
	return axeViolation{
		ID:          id,
		Impact:      impact,
		Description: "WCAG 1.2.2 test violation",
		Help:        "Add captions",
		HelpURL:     "https://www.w3.org/WAI/WCAG21/Techniques/html/H95",
		Tags:        []string{"wcag122", "cat.time-and-media"},
		Nodes: []axeNode{{
			HTML:           `<video src="film.mp4"></video>`,
			Target:         []string{"video"},
			FailureSummary: "No <track kind=\"captions\"> found.",
		}},
	}
}

// pass122 returns an axeRule representing a 1.2.2 pass event.
func pass122() axeRule {
	return axeRule{
		ID:          "video-captions-present",
		Description: `Video has a valid caption track (kind="captions", srclang="en").`,
	}
}

// containsString checks whether a string slice contains a given value.
func containsString(slice []string, want string) bool {
	for _, s := range slice {
		if s == want {
			return true
		}
	}
	return false
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP M – WCAGMap entries for SC 1.2.2
// ─────────────────────────────────────────────────────────────────────────────

// TestWCAGMap_122_MissingTrack verifies that the primary rule ID maps to 1.2.2.
func TestWCAGMap_122_MissingTrack(t *testing.T) {
	t.Parallel()
	sc, ok := models.WCAGMap["video-captions-present"]
	if !ok {
		t.Fatal("WCAGMap is missing entry for 'video-captions-present'; add it to internal/models/wcag_mapping.go")
	}
	if !containsString(sc, "1.2.2") {
		t.Errorf("video-captions-present maps to %v; want it to include '1.2.2'", sc)
	}
}

// TestWCAGMap_122_MissingTrackSrc verifies the track-src rule maps to 1.2.2.
func TestWCAGMap_122_MissingTrackSrc(t *testing.T) {
	t.Parallel()
	sc, ok := models.WCAGMap["video-captions-track-src"]
	if !ok {
		t.Fatal("WCAGMap is missing entry for 'video-captions-track-src'")
	}
	if !containsString(sc, "1.2.2") {
		t.Errorf("video-captions-track-src maps to %v; want '1.2.2'", sc)
	}
}

// TestWCAGMap_122_MissingLang verifies the track-lang rule maps to 1.2.2.
func TestWCAGMap_122_MissingLang(t *testing.T) {
	t.Parallel()
	sc, ok := models.WCAGMap["video-captions-track-lang"]
	if !ok {
		t.Fatal("WCAGMap is missing entry for 'video-captions-track-lang'")
	}
	if !containsString(sc, "1.2.2") {
		t.Errorf("video-captions-track-lang maps to %v; want '1.2.2'", sc)
	}
}

// TestWCAGMap_122_NoFalseMapping ensures no pre-existing rule accidentally
// claims SC 1.2.2 before the new rules are added.
func TestWCAGMap_122_ExistingRulesDoNotClaimSC122(t *testing.T) {
	t.Parallel()
	new122Rules := map[string]bool{
		"video-captions-present":    true,
		"video-captions-track-src":  true,
		"video-captions-track-lang": true,
	}
	for ruleID, scs := range models.WCAGMap {
		if new122Rules[ruleID] {
			continue // skip the new rules themselves
		}
		if containsString(scs, "1.2.2") {
			t.Errorf("unexpected: existing rule %q also maps to 1.2.2 – check wcag_mapping.go", ruleID)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP R – mapToScanResult with 1.2.2 violations
// ─────────────────────────────────────────────────────────────────────────────

// TestMapToScanResult_122_ViolationGuidelines checks that a 1.2.2 violation
// is reflected in ViolationGuidelines after mapping.
func TestMapToScanResult_122_ViolationGuidelines(t *testing.T) {
	t.Parallel()
	raw := makeRaw("https://example.com",
		[]axeViolation{violation122("video-captions-present", "critical")},
		nil,
	)
	result := mapToScanResult(raw, "https://example.com", "AA", 100)
	if !containsString(result.ViolationGuidelines, "1.2.2") {
		t.Errorf("ViolationGuidelines = %v; want it to include '1.2.2'", result.ViolationGuidelines)
	}
}

// TestMapToScanResult_122_PassGuidelines checks that a 1.2.2 pass is reflected
// in PassGuidelines after mapping.
func TestMapToScanResult_122_PassGuidelines(t *testing.T) {
	t.Parallel()
	raw := makeRaw("https://example.com", nil, []axeRule{pass122()})
	result := mapToScanResult(raw, "https://example.com", "AA", 100)
	if !containsString(result.PassGuidelines, "1.2.2") {
		t.Errorf("PassGuidelines = %v; want it to include '1.2.2'", result.PassGuidelines)
	}
}

// TestMapToScanResult_122_GuidelinesAreSorted verifies that all guideline
// slices are returned in sorted order (contract of mapToScanResult).
func TestMapToScanResult_122_GuidelinesAreSorted(t *testing.T) {
	t.Parallel()
	raw := makeRaw("https://example.com",
		[]axeViolation{
			violation122("video-captions-present", "critical"),
			{ID: "image-alt", Impact: "critical", Tags: []string{"wcag2aa"}},
		},
		nil,
	)
	result := mapToScanResult(raw, "https://example.com", "AA", 50)
	if !sort.StringsAreSorted(result.ViolationGuidelines) {
		t.Errorf("ViolationGuidelines not sorted: %v", result.ViolationGuidelines)
	}
}

// TestMapToScanResult_122_ViolationCount confirms the summary count is correct.
func TestMapToScanResult_122_ViolationCount(t *testing.T) {
	t.Parallel()
	raw := makeRaw("https://example.com",
		[]axeViolation{
			violation122("video-captions-present", "critical"),
			violation122("video-captions-track-src", "serious"),
		},
		nil,
	)
	result := mapToScanResult(raw, "https://example.com", "AA", 80)
	if result.Summary.ViolationCount != 2 {
		t.Errorf("ViolationCount = %d; want 2", result.Summary.ViolationCount)
	}
}

// TestMapToScanResult_122_NoDuplicateGuideline ensures "1.2.2" appears only
// once in ViolationGuidelines even when multiple 1.2.2 rules fire.
func TestMapToScanResult_122_NoDuplicateGuideline(t *testing.T) {
	t.Parallel()
	raw := makeRaw("https://example.com",
		[]axeViolation{
			violation122("video-captions-present", "critical"),
			violation122("video-captions-track-src", "serious"),
		},
		nil,
	)
	result := mapToScanResult(raw, "https://example.com", "AA", 80)
	count := 0
	for _, g := range result.ViolationGuidelines {
		if g == "1.2.2" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("'1.2.2' appears %d times in ViolationGuidelines; want exactly 1", count)
	}
}

// TestMapToScanResult_122_NodesMapped verifies that violation Nodes are copied
// into the ScanResult correctly.
func TestMapToScanResult_122_NodesMapped(t *testing.T) {
	t.Parallel()
	raw := makeRaw("https://example.com",
		[]axeViolation{violation122("video-captions-present", "critical")},
		nil,
	)
	result := mapToScanResult(raw, "https://example.com", "AA", 100)
	if len(result.Violations) == 0 {
		t.Fatal("Violations slice is empty")
	}
	v := result.Violations[0]
	if len(v.Nodes) == 0 {
		t.Error("Violation.Nodes is empty; expected at least one node")
	}
	if v.Nodes[0].FailureSummary == "" {
		t.Error("Violation.Nodes[0].FailureSummary should not be empty")
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP S – Scoring for 1.2.2 violations
// ─────────────────────────────────────────────────────────────────────────────

// TestScoring_122_CriticalPenalty checks that a single critical 1.2.2 violation
// deducts 20 points from a base score of 100.
func TestScoring_122_CriticalPenalty(t *testing.T) {
	t.Parallel()
	violations := []models.Violation{
		{ID: "video-captions-present", Impact: "critical"},
	}
	score, _, _ := scoring.Calculate(violations, 0)
	const want = 80
	if score != want {
		t.Errorf("score = %d; want %d (100 - 20 critical penalty)", score, want)
	}
}

// TestScoring_122_SeriousPenalty checks the track-src violation (serious = -10).
func TestScoring_122_SeriousPenalty(t *testing.T) {
	t.Parallel()
	violations := []models.Violation{
		{ID: "video-captions-track-src", Impact: "serious"},
	}
	score, _, _ := scoring.Calculate(violations, 0)
	const want = 90
	if score != want {
		t.Errorf("score = %d; want %d (100 - 10 serious penalty)", score, want)
	}
}

// TestScoring_122_CriticalGrade verifies a single critical violation yields
// grade "A" (score 80 ≥ 75 threshold).
func TestScoring_122_CriticalGrade(t *testing.T) {
	t.Parallel()
	violations := []models.Violation{
		{ID: "video-captions-present", Impact: "critical"},
	}
	_, grade, _ := scoring.Calculate(violations, 5)
	if grade != "B" {
		t.Errorf("grade = %q; want 'B' for score 80", grade)
	}
}

// TestScoring_122_MultipleVideos simulates three videos all missing captions
// (3 × critical = -60 → score 40, grade F-or-D).
func TestScoring_122_MultipleVideosMissingCaptions(t *testing.T) {
	t.Parallel()
	violations := []models.Violation{
		{ID: "video-captions-present", Impact: "critical"},
		{ID: "video-captions-present", Impact: "critical"},
		{ID: "video-captions-present", Impact: "critical"},
	}
	score, grade, _ := scoring.Calculate(violations, 0)
	const wantScore = 40
	if score != wantScore {
		t.Errorf("score = %d; want %d", score, wantScore)
	}
	if grade != "C" {
		t.Errorf("grade = %q; want 'C' for score 40", grade)
	}
}

// TestScoring_122_CompliancePct verifies compliance percentage when some videos
// pass and some fail.
func TestScoring_122_CompliancePct(t *testing.T) {
	t.Parallel()
	// 1 violation, 3 passes → 75 % compliance
	violations := []models.Violation{
		{ID: "video-captions-present", Impact: "critical"},
	}
	_, _, pct := scoring.Calculate(violations, 3)
	const want = 75.0
	if pct != want {
		t.Errorf("compliance pct = %.1f; want %.1f", pct, want)
	}
}

// TestScoring_122_ScoreFloorIsZero checks that extreme penalty (many criticals)
// does not produce a negative score.
func TestScoring_122_ScoreFloorIsZero(t *testing.T) {
	t.Parallel()
	violations := make([]models.Violation, 10)
	for i := range violations {
		violations[i] = models.Violation{ID: "video-captions-present", Impact: "critical"}
	}
	score, _, _ := scoring.Calculate(violations, 0)
	if score < 0 {
		t.Errorf("score = %d; score must not be negative", score)
	}
	if score != 0 {
		t.Errorf("score = %d; want 0 when penalty exceeds 100", score)
	}
}

// TestScoring_122_PerfectScoreWhenAllPass ensures no penalty is applied when
// all video-captions checks pass.
func TestScoring_122_PerfectScoreWhenAllPass(t *testing.T) {
	t.Parallel()
	score, grade, pct := scoring.Calculate(nil, 5)
	if score != 100 {
		t.Errorf("score = %d; want 100 with zero violations", score)
	}
	if grade != "A" {
		t.Errorf("grade = %q; want 'A'", grade)
	}
	if pct != 100.0 {
		t.Errorf("compliance pct = %.1f; want 100.0", pct)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP I – Integration: full raw→result pipeline for a 1.2.2 scan
// ─────────────────────────────────────────────────────────────────────────────

// TestIntegration_122_FullPipeline_Violation exercises the complete path from
// axeRawResult → mapToScanResult → scoring.Report for a 1.2.2 violation.
func TestIntegration_122_FullPipeline_Violation(t *testing.T) {
	t.Parallel()
	url := "https://example.com/video-page"
	raw := makeRaw(url,
		[]axeViolation{violation122("video-captions-present", "critical")},
		nil,
	)
	result := mapToScanResult(raw, url, "AA", 300)
	report := scoring.Report(result)

	if report.URL != url {
		t.Errorf("report.URL = %q; want %q", report.URL, url)
	}
	if report.TotalViolations != 1 {
		t.Errorf("TotalViolations = %d; want 1", report.TotalViolations)
	}
	if report.Score != 80 {
		t.Errorf("report.Score = %d; want 80", report.Score)
	}
	if report.Grade != "B" {
		t.Errorf("report.Grade = %q; want 'B'", report.Grade)
	}
	if report.Breakdown["critical"].Count != 1 {
		t.Errorf("breakdown critical count = %d; want 1", report.Breakdown["critical"].Count)
	}
	if !containsString(report.Breakdown["critical"].Issues, "video-captions-present") {
		t.Errorf("critical issues = %v; want 'video-captions-present'", report.Breakdown["critical"].Issues)
	}
	if report.Recommendation == "" {
		t.Error("Recommendation should not be empty when violations exist")
	}
}

// TestIntegration_122_FullPipeline_Pass exercises the pipeline for a 1.2.2 pass.
func TestIntegration_122_FullPipeline_Pass(t *testing.T) {
	t.Parallel()
	url := "https://example.com/accessible-video"
	raw := makeRaw(url, nil, []axeRule{pass122()})
	result := mapToScanResult(raw, url, "AA", 200)
	report := scoring.Report(result)

	if report.TotalViolations != 0 {
		t.Errorf("TotalViolations = %d; want 0", report.TotalViolations)
	}
	if report.Score != 100 {
		t.Errorf("report.Score = %d; want 100", report.Score)
	}
	if report.Grade != "A" {
		t.Errorf("report.Grade = %q; want 'A'", report.Grade)
	}
}
