package report

import (
	"fmt"

	"github.com/webaccessibility/server/internal/models"
)

// conformanceClass returns the CSS class for a given conformance level.
// Used by all formatter templates.
func conformanceClass(c models.ConformanceLevel) string {
	switch c {
	case models.ConformanceSupports:
		return "supports"
	case models.ConformancePartiallySupports:
		return "partial"
	case models.ConformanceDoesNotSupport:
		return "does-not-support"
	case models.ConformanceTestedInconclusive:
		return "tested-inconclusive"
	default:
		return "not-eval"
	}
}

// scopeLimitationsCSS is the shared CSS for scope & limitations blocks and the
// tested-inconclusive state used across all formatters.
const scopeLimitationsCSS = `
        .tested-inconclusive { color: #7c3aed; font-weight: bold; }
        .scope-block { border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 6px; padding: 16px 20px; margin: 24px 0; }
        .scope-block h3 { margin: 0 0 10px; color: #1e40af; font-size: 1rem; }
        .scope-block table { border: none; margin: 0; }
        .scope-block td, .scope-block th { border: 1px solid #dbeafe; padding: 6px 10px; font-size: 0.9em; }
        .scope-block th { background: #dbeafe; font-weight: bold; }
        .audioeye-warning { background: #fef3c7; border: 1px solid #fcd34d; border-radius: 4px; padding: 8px 12px; margin-top: 10px; font-size: 0.9em; color: #92400e; }`

// ScopeBlockHTML renders an HTML "Scope & Limitations" block from a ComplianceReport.
func ScopeBlockHTML(cr *models.ComplianceReport) string {
	warning := ""
	if cr.AudioEyeWarning != "" {
		warning = fmt.Sprintf(`<div class="audioeye-warning"><strong>⚠ AudioEye Warning:</strong> %s</div>`, cr.AudioEyeWarning)
	}
	scanLevel := cr.ScanWCAGLevel
	if scanLevel == "" {
		scanLevel = cr.WCAGLevel
	}
	if scanLevel == "" {
		scanLevel = "AA"
	}
	return fmt.Sprintf(`
    <div class="scope-block">
        <h3>Scope &amp; Limitations</h3>
        <table>
            <tr><th>Scan WCAG Level</th><td>%s</td></tr>
            <tr><th>Total Success Criteria in Report</th><td>%d</td></tr>
            <tr><th>Evaluated (automated test data)</th><td>%d</td></tr>
            <tr><th>Require Manual Testing</th><td>%d</td></tr>
        </table>
        %s
        <p style="margin:8px 0 0;font-size:0.85em;color:#374151;">
            Rows marked <em>Tested – Inconclusive</em> indicate a rule ran but returned only incomplete
            results; these rows are distinct from <em>Not Evaluated</em> (no automation exists).
        </p>
    </div>`,
		scanLevel,
		cr.TotalSCs,
		cr.EvaluatedSCs,
		cr.ManualTestRequiredCount,
		warning,
	)
}
