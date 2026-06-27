package scoring

import (
	"fmt"
	"math"

	"github.com/webaccessibility/server/internal/models"
)

// impactPenalty defines how many points each violation impact level deducts.
var impactPenalty = map[string]int{
	"critical": 20,
	"serious":  10,
	"moderate": 5,
	"minor":    2,
}

// ImpactBucket holds per-impact-level stats.
type ImpactBucket struct {
	Count           int    `json:"count"`
	PenaltyPerIssue int    `json:"penalty_per_issue"`
	TotalPenalty    int    `json:"total_penalty"`
	Issues          []string `json:"issues,omitempty"` // violation IDs
}

// ScoreReport is the structured scoring response returned by /api/v1/score.
type ScoreReport struct {
	URL            string                  `json:"url"`
	WCAGLevel      string                  `json:"wcag_level"`
	Score          int                     `json:"score"`
	Grade          string                  `json:"grade"`
	CompliancePct  float64                 `json:"compliance_pct"`
	TotalViolations int                    `json:"total_violations"`
	TotalPasses    int                     `json:"total_passes"`
	TotalPenalty   int                     `json:"total_penalty"`
	Breakdown       map[string]ImpactBucket  `json:"breakdown"`
	Recommendation  string                   `json:"recommendation"`
	AudioEyeScore   int                      `json:"audioeye_score"`
	AudioEyeGrade   string                   `json:"audioeye_grade"`
	AudioEyeDetail  *models.AudioEyeResult   `json:"audioeye_detail,omitempty"`
}

// Calculate computes an accessibility score (0–100), letter grade,
// and compliance percentage from a list of violations and pass count.
func Calculate(violations []models.Violation, passCount int) (score int, grade string, compliancePct float64) {
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

	grade = letterGrade(score)

	total := passCount + len(violations)
	if total > 0 {
		compliancePct = float64(passCount) / float64(total) * 100
	}

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
		return models.AudioEyeResult{Score: 100, Grade: "A", SCsEvaluated: 0}
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
