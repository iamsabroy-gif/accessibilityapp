package report

import (
	"bytes"
	"fmt"
	"html/template"

	"github.com/webaccessibility/server/internal/models"
)

type ACAOptions struct {
	Format string // "html" | "pdf"
}

// GenerateACA produces an ACA WCAG compliance report in HTML (and optionally PDF).
func GenerateACA(cr *models.ComplianceReport, opts ACAOptions) (string, []byte, error) {
	tmplStr := `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Accessible Canada Act (ACA) Conformance Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #333; max-width: 1000px; margin: 0 auto; padding: 20px; }
        h1 { color: #d00000; border-bottom: 2px solid #d00000; padding-bottom: 10px; }
        h2 { color: #333; margin-top: 30px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ccc; padding: 10px; text-align: left; vertical-align: top; }
        th { background-color: #f4f4f4; }
        .disclaimer { border-left: 4px solid #d00000; background: #fff8f8; padding: 15px; margin-top: 40px; }
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
    <h1>Accessible Canada Act (ACA) Conformance Report</h1>
    
    <p>This report documents accessibility conformance to support obligations under the <strong>Accessible Canada Act (S.C. 2019, c. 10)</strong>, which aims to realise a barrier-free Canada. Under the ACA, federally regulated entities must ensure their digital technologies are accessible. This assessment measures conformance against the widely adopted standard, Web Content Accessibility Guidelines (WCAG) 2.1 Level AA.</p>
    
    <h2>1. General Information</h2>
    <table>
        <tr><th>Organization / Vendor</th><td>{{.Report.Meta.VendorName}}</td></tr>
        <tr><th>Product / Service Name</th><td>{{.Report.Meta.ProductName}}</td></tr>
        <tr><th>Target URL</th><td>{{.Report.URL}}</td></tr>
        <tr><th>Assessment Date</th><td>{{.Report.ReportDate}}</td></tr>
        <tr><th>Contact Email</th><td>{{.Report.Meta.ContactInfo}}</td></tr>
    </table>

    <h2>2. Conformance Status (WCAG 2.1 AA)</h2>
    <table>
        <tr>
            <th>WCAG 2.1 Criteria</th>
            <th>Level</th>
            <th>Conformance Status</th>
            <th>Findings / Remediation</th>
        </tr>
        {{range .Report.Rows}}
            <tr>
                <td><strong>{{.SCID}} {{.SCName}}</strong></td>
                <td>{{.Level}}</td>
                <td class="{{conformanceClass .Conformance}}">{{.Conformance}}</td>
                <td>{{.Remarks}}</td>
            </tr>
        {{end}}
    </table>
    {{.ScopeBlock}}

    <div class="disclaimer">
        <h3>Disclaimer of Scope</h3>
        <p>This automated assessment was conducted on {{.Report.ScannedAt.Format "January 2, 2006"}}. The findings presented herein are based exclusively on automated evaluation tools and do not represent a complete accessibility audit. Automated testing can only identify a limited percentage of accessibility barriers. A comprehensive manual assessment using assistive technologies is required to definitively prove conformance with the Accessible Canada Act and WCAG standards. This report does not constitute legal advice.</p>
    </div>
</body>
</html>`

	tmpl, err := template.New("aca").Funcs(template.FuncMap{
		"conformanceClass": conformanceClass,
	}).Parse(tmplStr)
	if err != nil {
		return "", nil, fmt.Errorf("failed to parse ACA template: %v", err)
	}

	var buf bytes.Buffer
	err = tmpl.Execute(&buf, map[string]interface{}{
		"Report":     cr,
		"ScopeBlock": ScopeBlockHTML(cr),
	})
	if err != nil {
		return "", nil, fmt.Errorf("failed to execute ACA template: %v", err)
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
