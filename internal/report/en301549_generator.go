package report

import (
	"bytes"
	"fmt"
	"html/template"

	"github.com/webaccessibility/server/internal/models"
)

type EN301549Options struct {
	Format     string // "html" | "pdf"
	ReportType string // "" (default), "EAA", or "BITV"
}

// GenerateEN301549 produces an EN 301 549 ACR in HTML (and optionally PDF).
func GenerateEN301549(cr *models.ComplianceReport, opts EN301549Options) (string, []byte, error) {
	tmplStr := `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Accessibility Conformance Report (EN 301 549)</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.5; color: #333; max-width: 1000px; margin: 0 auto; padding: 20px; }
        h1, h2, h3 { color: #0056b3; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        th, td { border: 1px solid #ddd; padding: 10px; text-align: left; vertical-align: top; }
        th { background-color: #f4f4f4; }
        .disclaimer { border: 1px solid #ccc; background: #f9f9f9; padding: 15px; margin-top: 40px; font-size: 0.9em; }
        .supports { color: #155724; font-weight: bold; }
        .partial { color: #856404; font-weight: bold; }
        .does-not-support { color: #721c24; font-weight: bold; }
        .not-eval { color: #6c757d; }
        .tested-inconclusive { color: #7c3aed; font-weight: bold; }
        .scope-block { border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 6px; padding: 16px 20px; margin: 24px 0; }
        .scope-block h3 { margin: 0 0 10px; color: #1e40af; font-size: 1rem; }
        .scope-block table { border: none; margin: 0; }
        .scope-block td, .scope-block th { border: 1px solid #dbeafe; padding: 6px 10px; font-size: 0.9em; }
        .scope-block th { background: #dbeafe; font-weight: bold; }
        .audioeye-warning { background: #fef3c7; border: 1px solid #fcd34d; border-radius: 4px; padding: 8px 12px; margin-top: 10px; font-size: 0.9em; color: #92400e; }
    </style>
</head>
<body>
    {{if eq .Type "EAA"}}
    <h1>European Accessibility Act (EAA) Conformance Statement</h1>
    <div style="background: #f0f7ff; border-left: 4px solid #0056b3; padding: 15px; margin-bottom: 20px;">
        <strong>Pursuant to Directive (EU) 2019/882</strong><br>
        This statement documents accessibility conformance in accordance with the European Accessibility Act, effective for private sector entities from 28 June 2025. Technical conformance is evaluated against EN 301 549.
    </div>
    {{else if eq .Type "BITV"}}
    <h1>Erklärung zur Barrierefreiheit (BITV 2.0) / EN 301 549 ACR</h1>
    <div style="background: #fdfae6; border-left: 4px solid #d4b106; padding: 15px; margin-bottom: 20px;">
        <strong>Gemäß § 12d BGG und BITV 2.0</strong><br>
        Dieser Bericht dokumentiert die Konformität mit der Barrierefreie-Informationstechnik-Verordnung (BITV 2.0) und der Europäischen Norm EN 301 549. 
        Bei Beschwerden oder für ein Schlichtungsverfahren wenden Sie sich bitte an die Schlichtungsstelle nach § 16 BGG (BFIT-Bund).
    </div>
    {{else}}
    <h1>Accessibility Conformance Report (EN 301 549)</h1>
    {{end}}
    
    <h2>1. Product Information</h2>
    <table>
        <tr><th>Name of Product</th><td>{{.Report.Meta.ProductName}}</td></tr>
        <tr><th>Product Description</th><td>Web content accessible at {{.Report.URL}}</td></tr>
        <tr><th>Report Date</th><td>{{.Report.ReportDate}}</td></tr>
        <tr><th>Contact Information</th><td>{{.Report.Meta.ContactInfo}}</td></tr>
        <tr><th>Evaluation Methods Used</th>
            <td>Automated scanning using custom rules and Puppeteer on {{.Report.ScannedAt.Format "January 2, 2006"}}.</td>
        </tr>
    </table>

    <h2>2. Applicable Standards</h2>
    <p>This report covers conformance for Web technologies against EN 301 549 V3.2.1.</p>

    <h2>Chapter 4: Functional Performance Statements</h2>
    <table>
        <tr><th>Criteria</th><th>Conformance Level</th><th>Remarks and Explanations</th></tr>
        {{range .Chapter4}}
        <tr><td>{{.Criterion}}</td><td class="not-eval">{{.Conformance}}</td><td>{{.Remarks}}</td></tr>
        {{end}}
    </table>

    <h2>Chapter 5: Generic Requirements</h2>
    <table>
        <tr><th>Criteria</th><th>Conformance Level</th><th>Remarks and Explanations</th></tr>
        {{range .Chapter5}}
        <tr><td>{{.Criterion}}</td><td class="not-eval">{{.Conformance}}</td><td>{{.Remarks}}</td></tr>
        {{end}}
    </table>

    <h2>Chapter 6: ICT with Two-Way Voice Communication</h2>
    <table>
        <tr><th>Criteria</th><th>Conformance Level</th><th>Remarks and Explanations</th></tr>
        {{range .Chapter6}}
        <tr><td>{{.Criterion}}</td><td class="not-eval">{{.Conformance}}</td><td>{{.Remarks}}</td></tr>
        {{end}}
    </table>

    <h2>Chapter 7: ICT with Video Capabilities</h2>
    <table>
        <tr><th>Criteria</th><th>Conformance Level</th><th>Remarks and Explanations</th></tr>
        <tr>
            <td>7.1.1 Caption processing technology</td>
            <td class="{{conformanceClass .Chapter7Conf}}">{{.Chapter7Conf}}</td>
            <td>{{.Chapter7Rem}}</td>
        </tr>
        <tr>
            <td>7.1.2 Audio description processing technology</td>
            <td class="{{conformanceClass .Chapter7Conf}}">{{.Chapter7Conf}}</td>
            <td>{{.Chapter7Rem}}</td>
        </tr>
        <tr>
            <td>7.1.3 Preservation of audio description</td>
            <td class="not-eval">Not Evaluated</td>
            <td>Requires manual review if video content is present.</td>
        </tr>
        <tr>
            <td>7.2.1 Audio description synchronization</td>
            <td class="not-eval">Not Evaluated</td>
            <td>Synchronization requires manual review.</td>
        </tr>
    </table>

    <h2>Chapter 8: Hardware</h2>
    <table>
        <tr><th>Criteria</th><th>Conformance Level</th><th>Remarks and Explanations</th></tr>
        {{range .Chapter8}}
        <tr><td>{{.Criterion}}</td><td class="not-eval">{{.Conformance}}</td><td>{{.Remarks}}</td></tr>
        {{end}}
    </table>

    <h2>Chapter 9: Web</h2>
    <table>
        <tr>
            <th>EN 301 549 Clause</th>
            <th>WCAG 2.1 SC</th>
            <th>Conformance Level</th>
            <th>Remarks and Explanations</th>
        </tr>
        {{range .Report.Rows}}
        <tr>
            <td>{{.EN301549Clause}}</td>
            <td>{{.SCID}} {{.SCName}}</td>
            <td class="{{conformanceClass .Conformance}}">{{.Conformance}}</td>
            <td>{{.Remarks}}</td>
        </tr>
        {{end}}
    </table>
    {{.ScopeBlock}}

    <h2>Chapter 10: Non-Web Documents</h2>
    <table>
        <tr><th>Criteria</th><th>Conformance Level</th><th>Remarks and Explanations</th></tr>
        {{range .Chapter10}}
        <tr><td>{{.Criterion}}</td><td class="not-eval">{{.Conformance}}</td><td>{{.Remarks}}</td></tr>
        {{end}}
    </table>

    <h2>Chapter 11: Software</h2>
    <table>
        <tr><th>Criteria</th><th>Conformance Level</th><th>Remarks and Explanations</th></tr>
        {{range .Chapter11}}
        <tr><td>{{.Criterion}}</td><td class="not-eval">{{.Conformance}}</td><td>{{.Remarks}}</td></tr>
        {{end}}
    </table>

    <h2>Chapter 12: Documentation and Support Services</h2>
    <table>
        <tr><th>Criteria</th><th>Conformance Level</th><th>Remarks and Explanations</th></tr>
        {{range .Chapter12}}
        <tr><td>{{.Criterion}}</td><td class="not-eval">{{.Conformance}}</td><td>{{.Remarks}}</td></tr>
        {{end}}
    </table>

    <h2>Chapter 13: ICT Providing Relay or Emergency Service Access</h2>
    <table>
        <tr><th>Criteria</th><th>Conformance Level</th><th>Remarks and Explanations</th></tr>
        {{range .Chapter13}}
        <tr><td>{{.Criterion}}</td><td class="not-eval">{{.Conformance}}</td><td>{{.Remarks}}</td></tr>
        {{end}}
    </table>

    <div class="disclaimer">
        <p>This accessibility conformance report was generated using automated scanning tools including custom Puppeteer-based checks. Automated analysis detects a subset of accessibility barriers. Issues requiring human judgment — including the adequacy of alternative text descriptions, the logical sequence of content, the functional usability with assistive technologies, and the accessibility of dynamically generated content — were not evaluated.</p>
        <p><strong>This Accessibility Conformance Report was prepared using automated testing methods. Conformance levels of 'Supports' or 'Partially Supports' reflect automated scan results only and have not been independently verified through manual testing with assistive technologies. This report does not constitute a legally binding representation of product conformance under the European standard EN 301 549.</strong></p>
    </div>
</body>
</html>`

	tmpl, err := template.New("en301549").Funcs(template.FuncMap{
		"conformanceClass": conformanceClass,
	}).Parse(tmplStr)
	if err != nil {
		return "", nil, fmt.Errorf("failed to parse EN 301 549 template: %v", err)
	}

	hasVideo := hasVideoContent(cr)
	ch7Conf := models.ConformanceNotApplicable
	ch7Rem := "No video elements detected on the scanned page."
	if hasVideo {
		ch7Conf = models.ConformanceNotEvaluated
		ch7Rem = "Video elements detected. Manual evaluation required to confirm caption and audio description processing."
	}

	var buf bytes.Buffer
	err = tmpl.Execute(&buf, map[string]interface{}{
		"Report":       cr,
		"Type":         opts.ReportType,
		"ScopeBlock":   ScopeBlockHTML(cr),
		"Chapter7Conf": ch7Conf,
		"Chapter7Rem":  ch7Rem,
		"Chapter4":     EN301549Clause4Rows,
		"Chapter5":     EN301549Clause5Rows,
		"Chapter6":     EN301549Clause6Rows,
		"Chapter8":     EN301549Clause8Rows,
		"Chapter10":    EN301549Clause10Rows,
		"Chapter11":    EN301549Clause11Rows,
		"Chapter12":    EN301549Clause12Rows,
		"Chapter13":    EN301549Clause13Rows,
	})
	if err != nil {
		return "", nil, fmt.Errorf("failed to execute EN 301 549 template: %v", err)
	}

	htmlStr := buf.String()
	var pdfBytes []byte

	if opts.Format == "pdf" {
		pdfBytes, err = ExportToPDF(htmlStr)
		if err != nil {
			return "", nil, fmt.Errorf("failed to generate PDF: %v", err)
		}
	}

	return htmlStr, pdfBytes, nil
}

// hasVideoContent checks if 1.2.1 or 1.2.2 SC rows have tested elements.
func hasVideoContent(cr *models.ComplianceReport) bool {
	for _, row := range cr.Rows {
		if row.SCID == "1.2.1" || row.SCID == "1.2.2" {
			if row.SCScore != nil && row.SCScore.TestedElements > 0 {
				return true
			}
		}
	}
	return false
}
