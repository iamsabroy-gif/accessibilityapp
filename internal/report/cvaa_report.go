package report

import (
	"bytes"
	"fmt"
	"html/template"

	"github.com/webaccessibility/server/internal/models"
)

type CVAAOptions struct {
	Format string // "html" | "pdf"
}

// GenerateCVAA produces an FCC CVAA recordkeeping document in HTML (and optionally PDF).
func GenerateCVAA(cr *models.ComplianceReport, opts CVAAOptions) (string, []byte, error) {
	tmplStr := `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CVAA Recordkeeping Compliance Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #222; max-width: 1000px; margin: 0 auto; padding: 20px; }
        h1 { color: #1e3a8a; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px; }
        h2 { color: #1d4ed8; margin-top: 30px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ccc; padding: 10px; text-align: left; vertical-align: top; }
        th { background-color: #eff6ff; color: #1e3a8a; }
        .disclaimer { border-left: 4px solid #1e3a8a; background: #eff6ff; padding: 15px; margin-top: 40px; }
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
    <h1>CVAA Recordkeeping Compliance Report</h1>
    
    <p>This document serves as an internal record of accessibility evaluation efforts to support annual certification requirements under the <strong>Twenty-First Century Communications and Video Accessibility Act (CVAA)</strong> and Sections 255, 716, and 718 of the Communications Act. This record helps demonstrate whether accessibility of the covered Advanced Communications Services (ACS) is "readily achievable."</p>
    
    <h2>1. Product and Organization Profile</h2>
    <table>
        <tr><th>Organization / Manufacturer</th><td>{{.Report.Meta.VendorName}}</td></tr>
        <tr><th>Product / Service Tested</th><td>{{.Report.Meta.ProductName}}</td></tr>
        <tr><th>Service URL</th><td>{{.Report.URL}}</td></tr>
        <tr><th>Assessment Date</th><td>{{.Report.ReportDate}}</td></tr>
        <tr><th>Contact Email</th><td>{{.Report.Meta.ContactInfo}}</td></tr>
    </table>

    <h2>2. Accessibility Conformance Status (WCAG Base)</h2>
    <p>The matrix below outlines the automated evaluation results against the technical requirements of the Web Content Accessibility Guidelines (WCAG), which forms the baseline for many digital accessibility assessments.</p>
    <table>
        <tr>
            <th>Success Criterion</th>
            <th>Conformance Status</th>
            <th>Findings / Remediation</th>
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
        <h3>Compliance Certification Notice</h3>
        <p>This automated assessment was executed on {{.Report.ScannedAt.Format "January 2, 2006"}}. This document alone does not constitute full compliance with the CVAA. Entities must also file an annual Recordkeeping Compliance Certification with the Federal Communications Commission (FCC) via the RCCCI Registry. This report provides technical evidence of accessibility efforts but does not cover all CVAA requirements, such as documentation of consultation with individuals with disabilities. Legal review is recommended to determine "readily achievable" thresholds.</p>
    </div>
</body>
</html>`

	tmpl, err := template.New("cvaa").Funcs(template.FuncMap{
		"conformanceClass": conformanceClass,
	}).Parse(tmplStr)
	if err != nil {
		return "", nil, fmt.Errorf("failed to parse CVAA template: %v", err)
	}

	var buf bytes.Buffer
	err = tmpl.Execute(&buf, map[string]interface{}{
		"Report":     cr,
		"ScopeBlock": ScopeBlockHTML(cr),
	})
	if err != nil {
		return "", nil, fmt.Errorf("failed to execute CVAA template: %v", err)
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
