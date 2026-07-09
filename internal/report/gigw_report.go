package report

import (
	"bytes"
	"fmt"
	"html/template"

	"github.com/webaccessibility/server/internal/models"
)

type GIGWOptions struct {
	Format string // "html" | "pdf"
}

// GenerateGIGW produces a GIGW WCAG compliance report in HTML (and optionally PDF).
func GenerateGIGW(cr *models.ComplianceReport, opts GIGWOptions) (string, []byte, error) {
	tmplStr := `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GIGW 3.0 Accessibility Conformance Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #222; max-width: 1000px; margin: 0 auto; padding: 20px; }
        h1 { color: #f97316; border-bottom: 2px solid #f97316; padding-bottom: 10px; }
        h2 { color: #ea580c; margin-top: 30px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ccc; padding: 10px; text-align: left; vertical-align: top; }
        th { background-color: #fff7ed; color: #9a3412; }
        .disclaimer { border-left: 4px solid #f97316; background: #fff7ed; padding: 15px; margin-top: 40px; }
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
    <h1>GIGW 3.0 Accessibility Conformance Report</h1>
    
    <p>This document details the accessibility compliance status of the referenced digital service against the <strong>Guidelines for Indian Government Websites (GIGW) 3.0</strong>. To fulfill obligations under the Rights of Persons with Disabilities Act, 2016, government and public sector digital services must comply with WCAG 2.1 Level AA.</p>
    
    <h2>1. Service Information</h2>
    <table>
        <tr><th>Department / Vendor</th><td>{{.Report.Meta.VendorName}}</td></tr>
        <tr><th>Website / Service</th><td>{{.Report.Meta.ProductName}}</td></tr>
        <tr><th>Assessed URL</th><td>{{.Report.URL}}</td></tr>
        <tr><th>Date of Assessment</th><td>{{.Report.ReportDate}}</td></tr>
        <tr><th>Contact Email</th><td>{{.Report.Meta.ContactInfo}}</td></tr>
    </table>

    <h2>2. WCAG 2.1 Conformance Status</h2>
    <p>The matrix below outlines the automated evaluation results against the technical requirements of WCAG 2.1 Level AA.</p>
    <table>
        <tr>
            <th>Success Criterion</th>
            <th>Conformance Status</th>
            <th>Remarks / Details</th>
        </tr>
        {{range .Report.Rows}}
            <tr>
                <td><strong>{{.SCID}} {{.SCName}}</strong><br>(Level {{.Level}})</td>
                <td class="{{conformanceClass .Conformance}}">{{.Conformance}}</td>
                <td>{{.Remarks}}</td>
            </tr>
        {{end}}
    </table>
    {{.ScopeBlock}}

    <div class="disclaimer">
        <h3>Evaluation Scope & Methodology</h3>
        <p>This automated assessment was executed on {{.Report.ScannedAt.Format "02 Jan 2006"}}. While this report provides critical technical insights into GIGW 3.0 and WCAG 2.1 compliance, automated testing tools cannot identify all accessibility barriers. Complete certification and Safe-to-Host auditing processes as prescribed by MeitY or STQC require comprehensive manual testing combined with assistive technologies. This document serves as a preliminary evaluation and internal record, not a formal accessibility certificate.</p>
    </div>
</body>
</html>`

	tmpl, err := template.New("gigw").Funcs(template.FuncMap{
		"conformanceClass": conformanceClass,
	}).Parse(tmplStr)
	if err != nil {
		return "", nil, fmt.Errorf("failed to parse GIGW template: %v", err)
	}

	var buf bytes.Buffer
	err = tmpl.Execute(&buf, map[string]interface{}{
		"Report":     cr,
		"ScopeBlock": ScopeBlockHTML(cr),
	})
	if err != nil {
		return "", nil, fmt.Errorf("failed to execute GIGW template: %v", err)
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
