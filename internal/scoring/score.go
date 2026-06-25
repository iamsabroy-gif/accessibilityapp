package scoring

import (
	"fmt"

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
	Breakdown      map[string]ImpactBucket `json:"breakdown"`
	Recommendation string                  `json:"recommendation"`
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
