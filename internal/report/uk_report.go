package report

import (
	"bytes"
	"fmt"
	"html/template"

	"github.com/webaccessibility/server/internal/models"
)

type UKOptions struct {
	Format string // "html" | "pdf"
}

// GenerateUKEquality produces a UK PSBAR accessibility statement in HTML (and optionally PDF).
func GenerateUKEquality(cr *models.ComplianceReport, opts UKOptions) (string, []byte, error) {
	tmplStr := `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Accessibility Statement (UK Equality Act 2010 / PSBAR)</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #0b0c0c; max-width: 900px; margin: 0 auto; padding: 30px; }
        h1 { color: #0b0c0c; font-size: 2rem; border-bottom: 2px solid #1d70b8; padding-bottom: 10px; margin-bottom: 30px; }
        h2 { color: #0b0c0c; font-size: 1.5rem; margin-top: 30px; }
        h3 { color: #0b0c0c; font-size: 1.17rem; }
        p, li { font-size: 1.125rem; margin-bottom: 15px; }
        a { color: #1d70b8; text-decoration: underline; }
        a:hover { color: #003078; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #b1b4b6; padding: 12px; text-align: left; vertical-align: top; }
        th { background-color: #f3f2f1; font-weight: bold; }
        .disclaimer { border-left: 5px solid #1d70b8; background: #f3f2f1; padding: 20px; margin-top: 40px; }
        .supports { color: #00703c; font-weight: bold; }
        .partial { color: #f47738; font-weight: bold; }
        .does-not-support { color: #d4351c; font-weight: bold; }
        .not-eval { color: #505a5f; }
    </style>
</head>
<body>
    <h1>Accessibility statement for {{.Report.Meta.ProductName}}</h1>
    
    <p>This accessibility statement applies to the website accessible at <strong>{{.Report.URL}}</strong>. This website is run by {{.Report.Meta.VendorName}}.</p>
    
    <p>We want as many people as possible to be able to use this website. This document provides a record of our current level of compliance in accordance with the <em>Public Sector Bodies (Websites and Mobile Applications) (No. 2) Accessibility Regulations 2018</em> and the <em>Equality Act 2010</em>.</p>

    <h2>Compliance status</h2>
    <p>This website is 
    <strong>
    {{if eq .Report.FailCount 0}}
        fully compliant
    {{else if gt .Report.SupportsCount 0}}
        partially compliant
    {{else}}
        not compliant
    {{end}}
    </strong>
    with the <a href="https://www.w3.org/TR/WCAG21/" target="_blank">Web Content Accessibility Guidelines version 2.1</a> AA standard, due to the non-compliances listed below.</p>

    <h2>Non-accessible content</h2>
    <p>The content listed below is non-accessible for the following reasons:</p>
    
    <h3>Non-compliance with the accessibility regulations</h3>
    <table>
        <tr>
            <th>WCAG 2.1 Success Criterion</th>
            <th>Conformance Status</th>
            <th>Details / Remarks</th>
        </tr>
        {{range .Report.Rows}}
            {{if or (eq .Conformance "Does Not Support") (eq .Conformance "Partially Supports")}}
            <tr>
                <td><strong>{{.SCID}} {{.SCName}}</strong><br>(Level {{.Level}})</td>
                <td class="{{conformanceClass .Conformance}}">{{.Conformance}}</td>
                <td>{{.Remarks}}</td>
            </tr>
            {{end}}
        {{end}}
    </table>

    {{if eq .Report.FailCount 0}}
    <p>No critical or serious non-compliances were identified in the automated scan.</p>
    {{end}}

    <h2>Feedback and contact information</h2>
    <p>If you need information on this website in a different format like accessible PDF, large print, easy read, audio recording or braille, please contact us at:</p>
    <p><strong>Email:</strong> {{if .Report.Meta.ContactInfo}}{{.Report.Meta.ContactInfo}}{{else}}[Insert Contact Email]{{end}}</p>
    <p>We’ll consider your request and get back to you.</p>
    
    <h2>Enforcement procedure</h2>
    <p>The Equality and Human Rights Commission (EHRC) is responsible for enforcing the Public Sector Bodies (Websites and Mobile Applications) (No. 2) Accessibility Regulations 2018 (the ‘accessibility regulations’). If you’re not happy with how we respond to your complaint, <a href="https://www.equalityadvisoryservice.com/" target="_blank">contact the Equality Advisory and Support Service (EASS)</a>.</p>

    <h2>Preparation of this accessibility statement</h2>
    <p>This statement was prepared on <strong>{{.Report.ReportDate}}</strong>.</p>
    <p>This website was last tested on {{.Report.ScannedAt.Format "2 January 2006"}}. The test was carried out using automated scanning tools including axe-core and custom Puppeteer-based checks.</p>

    <div class="disclaimer">
        <p><strong>Limitations of automated testing:</strong> This report represents findings from an automated scan. Automated analysis detects a subset of accessibility barriers. Issues requiring human judgment — including the adequacy of alternative text descriptions, the logical sequence of content, the functional usability with assistive technologies, and the accessibility of dynamically generated content — were not evaluated and must be assessed manually.</p>
    </div>
</body>
</html>`

	tmpl, err := template.New("uk").Funcs(template.FuncMap{
		"conformanceClass": func(c models.ConformanceLevel) string {
			switch c {
			case models.ConformanceSupports:
				return "supports"
			case models.ConformancePartiallySupports:
				return "partial"
			case models.ConformanceDoesNotSupport:
				return "does-not-support"
			default:
				return "not-eval"
			}
		},
	}).Parse(tmplStr)
	if err != nil {
		return "", nil, fmt.Errorf("failed to parse UK Equality template: %v", err)
	}

	var buf bytes.Buffer
	err = tmpl.Execute(&buf, map[string]interface{}{
		"Report": cr,
	})
	if err != nil {
		return "", nil, fmt.Errorf("failed to execute UK Equality template: %v", err)
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
