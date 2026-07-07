package report

import (
	"bytes"
	"fmt"
	"html/template"
	"sort"
	"strings"
	"time"

	"github.com/webaccessibility/server/internal/models"
)

type ADAOptions struct {
	Format string // "html" (default) | "pdf"
	Meta   models.ReportMeta
}

type ADABarrier struct {
	RuleID      string
	Description string
	Impact      string   // "critical" | "serious"
	SCIDs       []string // WCAG SCs this violation maps to
	NodeCount   int
	HelpURL     string
	LegalRisk   string // "High" (critical) | "Medium" (serious)
	FixSummary  string // from DevSuggestion if available
}

type ADAReport struct {
	HTML string
	PDF  []byte // non-nil only when ADAOptions.Format == "pdf"
}

func GenerateADA(result *models.ScanResult, opts ADAOptions) (*ADAReport, error) {
	barriers, bestPractice := classifyBarriers(result.Violations)
	riskBanner := adaRiskBanner(barriers)

	tmplStr := `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ADA Title III Accessibility Assessment</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 1000px; margin: 0 auto; padding: 20px; }
        h1, h2, h3 { color: #2c3e50; }
        .header { border-bottom: 2px solid #eee; padding-bottom: 10px; margin-bottom: 20px; }
        .summary-card { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px; margin-bottom: 30px; }
        .risk-banner { display: inline-block; padding: 5px 15px; border-radius: 4px; font-weight: bold; margin-bottom: 15px; }
        .risk-HIGH { background: #fee2e2; color: #dc2626; border: 1px solid #f87171; }
        .risk-MODERATE { background: #fef3c7; color: #d97706; border: 1px solid #fbbf24; }
        .risk-LOW { background: #dcfce7; color: #16a34a; border: 1px solid #4ade80; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; vertical-align: top; }
        th { background-color: #f4f4f4; }
        .disclaimer { border: 2px solid #eab308; background: #fefce8; padding: 15px; margin-top: 40px; font-size: 0.9em; }
        .badge { display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold; margin-right: 5px; }
        .impact-critical { background: #fee2e2; color: #991b1b; }
        .impact-serious { background: #ffedd5; color: #9a3412; }
        .impact-moderate { background: #fef3c7; color: #92400e; }
        .impact-minor { background: #e0f2fe; color: #075985; }
        details { margin-bottom: 15px; border: 1px solid #ddd; padding: 10px; border-radius: 4px; }
        summary { font-weight: bold; cursor: pointer; }
    </style>
</head>
<body>
    <div class="header">
        <h1>ADA Title III Accessibility Assessment</h1>
        <p><strong>Target URL:</strong> {{.Result.URL}}</p>
        <p><strong>Scan Date:</strong> {{.Result.ScannedAt.Format "January 2, 2006 at 3:04 PM"}}</p>
        <p><strong>Report Date:</strong> {{.Now.Format "January 2, 2006"}}</p>
    </div>

    <div class="summary-card">
        <h2>Executive Summary</h2>
        <div class="risk-banner risk-{{.RiskBanner}}">RISK LEVEL: {{.RiskBanner}}</div>
        <p><strong>Score:</strong> {{.Result.Summary.Score}}/100 (Grade {{.Result.Summary.Grade}})</p>
        <p><strong>Total Access Barriers:</strong> {{len .Barriers}}</p>
        <p>This automated scan identified {{len .Barriers}} potential access barriers on {{.Result.URL}} that may constitute ADA Title III violations under the 'meaningful access' standard established by <em>Robles v. Domino's Pizza (9th Cir. 2019)</em>.</p>
    </div>

    {{if .Barriers}}
    <h2>Access Barriers (Critical & Serious)</h2>
    <table>
        <tr>
            <th>WCAG SC</th>
            <th>Violation</th>
            <th>Impact</th>
            <th>Affected Elements</th>
            <th>ADA Risk</th>
            <th>Recommended Fix</th>
        </tr>
        {{range .Barriers}}
        <tr>
            <td>{{join .SCIDs ", "}}</td>
            <td><strong>{{.RuleID}}</strong><br>{{.Description}}<br><a href="{{.HelpURL}}" target="_blank">More info</a></td>
            <td><span class="badge impact-{{.Impact}}">{{.Impact}}</span></td>
            <td>{{.NodeCount}} element(s)</td>
            <td><strong>{{.LegalRisk}}</strong></td>
            <td>{{if .FixSummary}}{{.FixSummary}}{{else}}Review issue details for remediation.{{end}}</td>
        </tr>
        {{end}}
    </table>
    {{else}}
    <h2>Access Barriers (Critical & Serious)</h2>
    <p>No critical or serious access barriers were detected in this automated scan.</p>
    {{end}}

    {{if .BestPractice}}
    <h2>Best Practice Recommendations (Moderate & Minor)</h2>
    <p>These items are technical deviations from WCAG 2.1 AA guidelines. While generally not the basis for ADA litigation, remediation is recommended as a defense-in-depth measure.</p>
    <table>
        <tr>
            <th>Violation</th>
            <th>Impact</th>
            <th>Affected Elements</th>
        </tr>
        {{range .BestPractice}}
        <tr>
            <td><strong>{{.ID}}</strong><br>{{.Description}}</td>
            <td><span class="badge impact-{{.Impact}}">{{.Impact}}</span></td>
            <td>{{len .Nodes}} element(s)</td>
        </tr>
        {{end}}
    </table>
    {{end}}

    <div class="disclaimer">
        <h3>Scope Disclosure & Legal Disclaimer</h3>
        <p>This assessment covers {{.Result.URL}} scanned at {{.Result.ScannedAt.Format "2006-01-02 15:04:05"}}. Compliance of untested pages, dynamic content loaded after interaction, and pages behind authentication is not represented.</p>
        <p>This accessibility conformance report was generated using automated scanning tools including axe-core and custom Puppeteer-based checks. Automated analysis detects a subset of accessibility barriers. Issues requiring human judgment — including the adequacy of alternative text descriptions, the logical sequence of content, the functional usability with assistive technologies, and the accessibility of dynamically generated content — were not evaluated. This report covers the URL(s) listed above at the time of scanning and does not represent the accessibility of unscanned pages or future states of the site.</p>
        <p><strong>This report does not constitute legal advice and does not create an attorney-client relationship. The findings herein represent technical observations made by automated software and should be reviewed with qualified legal counsel. A passing score or absence of detected violations does not guarantee compliance with the Americans with Disabilities Act or any other applicable law.</strong></p>
    </div>
</body>
</html>`

	tmpl, err := template.New("ada").Funcs(template.FuncMap{
		"join": strings.Join,
	}).Parse(tmplStr)
	if err != nil {
		return nil, fmt.Errorf("failed to parse ADA template: %v", err)
	}

	var buf bytes.Buffer
	err = tmpl.Execute(&buf, map[string]interface{}{
		"Result":       result,
		"Barriers":     barriers,
		"BestPractice": bestPractice,
		"RiskBanner":   riskBanner,
		"Now":          time.Now(),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to execute ADA template: %v", err)
	}

	htmlStr := buf.String()
	report := &ADAReport{HTML: htmlStr}

	if opts.Format == "pdf" {
		pdfBytes, err := ExportToPDF(htmlStr)
		if err != nil {
			return nil, fmt.Errorf("failed to generate PDF: %v", err)
		}
		report.PDF = pdfBytes
	}

	return report, nil
}

func classifyBarriers(violations []models.Violation) ([]ADABarrier, []models.Violation) {
	var barriers []ADABarrier
	var bestPractice []models.Violation

	for _, v := range violations {
		if v.Impact == "critical" || v.Impact == "serious" {
			scids := models.WCAGMap[v.ID]
			// Sort SCIDs just in case
			scidsCopy := append([]string(nil), scids...)
			sort.Strings(scidsCopy)

			var fixSummary string
			if v.DevSuggestion != nil && len(v.DevSuggestion.FixSteps) > 0 {
				fixSummary = strings.Join(v.DevSuggestion.FixSteps, " ")
			}

			barriers = append(barriers, ADABarrier{
				RuleID:      v.ID,
				Description: v.Description,
				Impact:      v.Impact,
				SCIDs:       scidsCopy,
				NodeCount:   len(v.Nodes),
				HelpURL:     v.HelpURL,
				LegalRisk:   adaRiskTier(v.Impact),
				FixSummary:  fixSummary,
			})
		} else {
			bestPractice = append(bestPractice, v)
		}
	}

	return barriers, bestPractice
}

func adaRiskTier(impact string) string {
	if impact == "critical" {
		return "High"
	}
	if impact == "serious" {
		return "Medium"
	}
	return "Low"
}

func adaRiskBanner(barriers []ADABarrier) string {
	if len(barriers) == 0 {
		return "LOW"
	}
	for _, b := range barriers {
		if b.Impact == "critical" {
			return "HIGH"
		}
	}
	return "MODERATE"
}
