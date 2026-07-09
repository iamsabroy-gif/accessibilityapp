package scoring

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/webaccessibility/server/internal/models"
)

// impactPenalty defines how many points each violation impact level deducts.
var impactPenalty = map[string]int{
	"critical": 20,
	"serious":  10,
	"moderate": 5,
	"minor":    2,
}

// Scoring formula constants.
const (
	// FormulaCompliance scores by pass-rate: round(passCount / total * 100).
	// Score tracks the compliance % shown in the UI.
	FormulaCompliance = "compliance"

	// FormulaPenalty deducts fixed points per violation severity:
	// critical=-20, serious=-10, moderate=-5, minor=-2.
	// Score drops quickly when high-severity issues accumulate.
	FormulaPenalty = "penalty"
)

// ImpactBucket holds per-impact-level stats.
type ImpactBucket struct {
	Count           int      `json:"count"`
	PenaltyPerIssue int      `json:"penalty_per_issue"`
	TotalPenalty    int      `json:"total_penalty"`
	Issues          []string `json:"issues,omitempty"` // violation IDs
}

// ScoreReport is the structured scoring response returned by /api/v1/score.
type ScoreReport struct {
	URL             string                  `json:"url"`
	WCAGLevel       string                  `json:"wcag_level"`
	Score           int                     `json:"score"`
	Grade           string                  `json:"grade"`
	CompliancePct   float64                 `json:"compliance_pct"`
	TotalViolations int                     `json:"total_violations"`
	TotalPasses     int                     `json:"total_passes"`
	TotalPenalty    int                     `json:"total_penalty"`
	Breakdown       map[string]ImpactBucket `json:"breakdown"`
	Recommendation  string                  `json:"recommendation"`
	AudioEyeScore   int                     `json:"audioeye_score"`
	AudioEyeGrade   string                  `json:"audioeye_grade"`
	AudioEyeDetail  *models.AudioEyeResult  `json:"audioeye_detail,omitempty"`
}

// Calculate computes an accessibility score (0-100), letter grade,
// and compliance percentage from a list of violations, pass count, and incomplete count.
//
// incomplete is added to the denominator so that partially-tested pages
// do not overstate their compliance percentage (Gap 3 fix).
//
// formula selects the scoring method:
//
//	"compliance" (default) - score = round(passCount / (passCount + violations + incomplete) * 100)
//	                          Score tracks the compliance % shown in the UI.
//
//	"penalty"              - score = max(0, 100 - sum impactPenalty[impact])
//	                          Each critical violation costs 20 pts, serious 10 pts,
//	                          moderate 5 pts, minor 2 pts.
func Calculate(violations []models.Violation, passCount, incomplete int, formula string) (score int, grade string, compliancePct float64) {
	// Compliance % denominator includes incomplete (Gap 3 fix).
	total := passCount + len(violations) + incomplete
	if total > 0 {
		compliancePct = float64(passCount) / float64(total) * 100
	}

	switch formula {
	case FormulaPenalty:
		penalty := 0
		for _, v := range violations {
			if p, ok := impactPenalty[v.Impact]; ok {
				penalty += p
			} else {
				penalty += 2
			}
		}
		score = 100 - penalty
		if score < 0 {
			score = 0
		}
	default: // FormulaCompliance
		score = int(math.Round(compliancePct))
		if score < 0 {
			score = 0
		}
		if score > 100 {
			score = 100
		}
	}

	grade = letterGrade(score)
	return score, grade, compliancePct
}

// Report builds a full ScoreReport from a completed ScanResult.
func Report(result *models.ScanResult) ScoreReport {
	// Build per-impact breakdown
	breakdown := map[string]ImpactBucket{
		"critical": {PenaltyPerIssue: impactPenalty["critical"]},
		"serious":  {PenaltyPerIssue: impactPenalty["serious"]},
		"moderate": {PenaltyPerIssue: impactPenalty["moderate"]},
		"minor":    {PenaltyPerIssue: impactPenalty["minor"]},
	}

	totalPenalty := 0
	for _, v := range result.Violations {
		penalty := impactPenalty[v.Impact]
		if penalty == 0 {
			penalty = 2
		}
		b := breakdown[v.Impact]
		b.Count++
		b.TotalPenalty += penalty
		b.Issues = append(b.Issues, v.ID)
		breakdown[v.Impact] = b
		totalPenalty += penalty
	}

	aeResult := CalculateAudioEye(result.Violations, result.PassRules, models.WCAGMap)

	return ScoreReport{
		URL:             result.URL,
		WCAGLevel:       result.Summary.Level,
		Score:           result.Summary.Score,
		Grade:           result.Summary.Grade,
		CompliancePct:   result.Summary.CompliancePct,
		TotalViolations: result.Summary.ViolationCount,
		TotalPasses:     result.Summary.PassCount,
		TotalPenalty:    totalPenalty,
		Breakdown:       breakdown,
		Recommendation:  recommendation(result.Summary.Score, result.Violations),
		AudioEyeScore:   aeResult.Score,
		AudioEyeGrade:   aeResult.Grade,
		AudioEyeDetail:  &aeResult,
	}
}

// recommendation returns a human-readable action based on the score and violations.
func recommendation(score int, violations []models.Violation) string {
	if len(violations) == 0 {
		return "Excellent! No violations detected. Keep up the great accessibility practices."
	}

	// Count by impact
	counts := map[string]int{}
	for _, v := range violations {
		counts[v.Impact]++
	}

	switch {
	case score >= 90:
		return fmt.Sprintf(
			"Great accessibility score! Address the %d minor issue(s) to reach a perfect score.",
			len(violations),
		)
	case score >= 75:
		if counts["serious"] > 0 {
			return fmt.Sprintf(
				"Good score, but %d serious violation(s) need urgent attention to improve accessibility for assistive technology users.",
				counts["serious"],
			)
		}
		return fmt.Sprintf(
			"Good score. Fixing the %d moderate issue(s) will push you into the A range.",
			counts["moderate"],
		)
	case score >= 50:
		return fmt.Sprintf(
			"Moderate accessibility issues detected (%d critical, %d serious, %d moderate). Prioritize critical and serious violations first.",
			counts["critical"], counts["serious"], counts["moderate"],
		)
	default:
		return fmt.Sprintf(
			"Significant accessibility barriers found. %d critical and %d serious violations must be resolved to meet WCAG compliance. Immediate action recommended.",
			counts["critical"], counts["serious"],
		)
	}
}

// CalculateAudioEye implements the AudioEye element-level failure-rate scoring methodology.
func CalculateAudioEye(
	violations []models.Violation,
	passRules []models.PassRule,
	wcagMap map[string][]string,
) models.AudioEyeResult {
	type scCounts struct{ failed, tested int }
	scMap := map[string]*scCounts{}

	for _, v := range violations {
		scs := wcagMap[v.ID]
		for _, sc := range scs {
			if scMap[sc] == nil {
				scMap[sc] = &scCounts{}
			}
			n := len(v.Nodes)
			scMap[sc].failed += n
			scMap[sc].tested += n
		}
	}

	for _, p := range passRules {
		scs := wcagMap[p.ID]
		for _, sc := range scs {
			if scMap[sc] == nil {
				scMap[sc] = &scCounts{}
			}
			scMap[sc].tested += p.NodeCount
		}
	}

	for sc, c := range scMap {
		if c.tested == 0 {
			delete(scMap, sc)
		}
	}

	n := len(scMap)
	if n == 0 {
		// Gap 4 fix: do not return a perfect score when nothing was evaluated.
		return models.AudioEyeResult{
			Score:        0,
			Grade:        "F",
			SCsEvaluated: 0,
			Warning:      "No success criteria evaluated - result is not a compliance score.",
		}
	}

	w := 1.0 / float64(n)
	weightedFailure := 0.0
	breakdown := map[string]models.SCScore{}

	for sc, c := range scMap {
		rate := float64(c.failed) / float64(c.tested)
		wr := w * rate
		weightedFailure += wr
		breakdown[sc] = models.SCScore{
			FailedElements: c.failed,
			TestedElements: c.tested,
			FailureRate:    rate,
			Weight:         w,
			WeightedRate:   wr,
		}
	}

	rawScore := (1.0 - weightedFailure) * 100.0
	score := int(math.Round(rawScore))
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}

	return models.AudioEyeResult{
		Score:           score,
		Grade:           letterGrade(score),
		SCBreakdown:     breakdown,
		SCsEvaluated:    n,
		WeightedFailure: weightedFailure,
	}
}

// CalculateAudioEyeSite aggregates page-level AudioEye scores into a
// pageview-weighted site score. Pass pageviews=nil to weight all pages equally.
func CalculateAudioEyeSite(pageScores []int, pageviews []int) int {
	if len(pageScores) == 0 {
		return 0
	}
	totalWeight := 0.0
	weightedSum := 0.0
	for i, s := range pageScores {
		pv := 1
		if pageviews != nil && i < len(pageviews) {
			pv = pageviews[i]
		}
		weightedSum += float64(s) * float64(pv)
		totalWeight += float64(pv)
	}
	return int(math.Round(weightedSum / totalWeight))
}

// letterGrade converts a numeric score to a letter grade.
func letterGrade(score int) string {
	switch {
	case score >= 90:
		return "A"
	case score >= 75:
		return "B"
	case score >= 40:
		return "C"
	case score >= 25:
		return "D"
	default:
		return "F"
	}
}

// conformanceLevelForSC maps SCScore data to a conformance level.
// Pass hasRule=false if no rule in WCAGMap covers this SC.
// Pass hasIncomplete=true if the SC has rules that returned incomplete results.
func conformanceLevelForSC(scID string, sc models.SCScore, hasRule, hasIncomplete bool) models.ConformanceLevel {
	_ = scID // unused but kept for potential future logging
	if !hasRule {
		return models.ConformanceNotEvaluated
	}
	// Rules ran and returned only incomplete (no element-level data yet).
	if sc.TestedElements == 0 && hasIncomplete {
		return models.ConformanceTestedInconclusive
	}
	// Rules exist but produced no tested elements and no incomplete.
	if sc.TestedElements == 0 {
		return models.ConformanceNotEvaluated
	}
	if sc.FailedElements == 0 {
		return models.ConformanceSupports
	}
	if sc.FailureRate < 0.5 {
		return models.ConformancePartiallySupports
	}
	return models.ConformanceDoesNotSupport
}

// narrativeForConformance picks the correct template string from SCMetadata.
func narrativeForConformance(m models.SCMetadata, c models.ConformanceLevel) string {
	switch c {
	case models.ConformanceSupports:
		return m.SupportNarrative
	case models.ConformancePartiallySupports:
		return m.PartialNarrative
	case models.ConformanceDoesNotSupport:
		return m.FailureNarrative
	default:
		return ""
	}
}

// scIDLess sorts "1.1.1" < "1.2.1" < "2.4.1" numerically by dot-separated parts.
func scIDLess(a, b string) bool {
	pa := strings.Split(a, ".")
	pb := strings.Split(b, ".")
	for i := 0; i < len(pa) && i < len(pb); i++ {
		na, _ := strconv.Atoi(pa[i])
		nb, _ := strconv.Atoi(pb[i])
		if na != nb {
			return na < nb
		}
	}
	return len(pa) < len(pb)
}

// BuildComplianceReport constructs a ComplianceReport from a completed ScanResult.
// standard must be "ADA", "508", "EN301549", "EAA", etc.
// Runs CalculateAudioEye internally if result.AudioEye is nil.
func BuildComplianceReport(
	result *models.ScanResult,
	standard string,
	meta models.ReportMeta,
) (*models.ComplianceReport, error) {
	ae := result.AudioEye
	if ae == nil {
		aeResult := CalculateAudioEye(result.Violations, result.PassRules, models.WCAGMap)
		ae = &aeResult
	}

	// Build set of SCs that have at least one rule in WCAGMap.
	scHasRule := map[string]bool{}
	for _, scs := range models.WCAGMap {
		for _, sc := range scs {
			scHasRule[sc] = true
		}
	}

	// Build set of SCs associated with incomplete rule results.
	// ScanResult.Incomplete holds rule IDs that returned incomplete axe results.
	scHasIncomplete := map[string]bool{}
	for _, ruleID := range result.Incomplete {
		if scs, ok := models.WCAGMap[ruleID]; ok {
			for _, sc := range scs {
				scHasIncomplete[sc] = true
			}
		}
	}

	report := &models.ComplianceReport{
		URL: result.URL, ScannedAt: result.ScannedAt,
		Standard: standard, WCAGLevel: result.Summary.Level,
		ReportDate: result.ScannedAt.Format("2006-01-02"), Meta: meta,
		ScanWCAGLevel: result.Summary.Level,
	}

	// Propagate AudioEye warning when nothing was evaluated.
	if ae.Warning != "" {
		report.AudioEyeWarning = ae.Warning
	}

	for scID, scMeta := range models.SCRegistry {
		// 508 only covers WCAG 2.0. WCAG 2.1 and 2.2 SCs -> Not Applicable in 508 mode.
		if standard == "508" && scMeta.WCAGVersion != "2.0" {
			var remark string
			switch scMeta.WCAGVersion {
			case "2.1":
				remark = "This criterion was introduced in WCAG 2.1. Section 508 (2017 refresh) references WCAG 2.0 and does not require this criterion."
			case "2.2":
				remark = "This criterion was introduced in WCAG 2.2. Section 508 (2017 refresh) references WCAG 2.0 and does not require this criterion."
			default:
				remark = "This criterion is not required by Section 508."
			}
			row := models.SCConformanceRow{
				SCID: scID, SCName: scMeta.SCName, Level: scMeta.Level,
				WCAGVersion: scMeta.WCAGVersion, EN301549Clause: scMeta.EN301549Clause,
				Conformance: models.ConformanceNotApplicable,
				Remarks:     remark,
			}
			report.Rows = append(report.Rows, row)
			report.NotApplCount++
			continue
		}

		scScore, hasSCData := ae.SCBreakdown[scID]
		hasRule := scHasRule[scID]
		hasIncomplete := scHasIncomplete[scID]

		var conformance models.ConformanceLevel
		var remarks string

		if scMeta.NotAutomatable && !hasRule {
			conformance = models.ConformanceNotEvaluated
			remarks = scMeta.LimitationNote
		} else {
			conformance = conformanceLevelForSC(scID, scScore, hasRule, hasIncomplete)
			remarks = narrativeForConformance(scMeta, conformance)
			if scMeta.LimitationNote != "" {
				if remarks != "" {
					remarks += " "
				}
				remarks += scMeta.LimitationNote
			}
		}

		var scorePtr *models.SCScore
		if hasSCData {
			s := scScore
			scorePtr = &s
		}

		row := models.SCConformanceRow{
			SCID: scID, SCName: scMeta.SCName, Level: scMeta.Level,
			WCAGVersion: scMeta.WCAGVersion, EN301549Clause: scMeta.EN301549Clause,
			Conformance: conformance, Remarks: remarks,
			ManualTestingRequired: scMeta.ManualTestingRequired,
			SCScore:               scorePtr,
		}
		report.Rows = append(report.Rows, row)

		// Track extended metadata counts.
		if scMeta.ManualTestingRequired {
			report.ManualTestRequiredCount++
		}
		if hasSCData && scScore.TestedElements > 0 {
			report.EvaluatedSCs++
		}

		switch conformance {
		case models.ConformanceSupports:
			report.SupportsCount++
		case models.ConformancePartiallySupports:
			report.PartialCount++
		case models.ConformanceDoesNotSupport:
			report.FailCount++
		case models.ConformanceNotEvaluated:
			report.NotEvalCount++
		case models.ConformanceNotApplicable:
			report.NotApplCount++
		case models.ConformanceTestedInconclusive:
			report.TestedInconclusiveCount++
		}
	}

	sort.Slice(report.Rows, func(i, j int) bool {
		return scIDLess(report.Rows[i].SCID, report.Rows[j].SCID)
	})
	report.TotalSCs = len(report.Rows)
	return report, nil
}
