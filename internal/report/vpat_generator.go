package report

import (
	"bytes"
	"fmt"
	"html/template"

	"github.com/webaccessibility/server/internal/models"
)

type VPATEdition string

const (
	VPATEdition508  VPATEdition = "508"
	VPATEditionWCAG VPATEdition = "WCAG"
	VPATEditionEU   VPATEdition = "EU"
	VPATEditionINT  VPATEdition = "INT"
)

type VPATOptions struct {
	Edition VPATEdition // default "INT"
	Format  string      // "html" | "pdf"
}

// GenerateVPAT produces a VPAT conformance report in HTML (and optionally PDF).
func GenerateVPAT(cr *models.ComplianceReport, opts VPATOptions) (string, []byte, error) {
	if opts.Edition == "" {
		opts.Edition = VPATEditionINT
	}

	tmplStr := `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Accessibility Conformance Report (VPAT)</title>
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
    <h1>Accessibility Conformance Report (VPAT&reg; Version 2.5Rev)</h1>
    
    <h2>Chapter 1: Product Information</h2>
    <table>
        <tr><th>Vendor Name</th><td>{{.Report.Meta.VendorName}}</td></tr>
        <tr><th>Product Name</th><td>{{.Report.Meta.ProductName}}</td></tr>
        <tr><th>Product Version</th><td>{{.Report.Meta.ProductVersion}}</td></tr>
        <tr><th>Report Date</th><td>{{.Report.ReportDate}}</td></tr>
        <tr><th>Contact Information</th><td>{{.Report.Meta.ContactInfo}}</td></tr>
        <tr><th>Notes</th><td>{{.Report.Meta.Notes}}</td></tr>
        <tr><th>Evaluation Methods Used</th>
            <td>Automated scanning using custom rules and Puppeteer. Scan performed {{.Report.ScannedAt.Format "January 2, 2006"}} against {{.Report.URL}}.</td>
        </tr>
    </table>

    <h2>Chapter 2: Applicable Technical Standards</h2>
    <p>This report covers conformance for Web technologies.</p>
    <table>
        <tr>
            <th>Criteria</th>
            {{if eq .Edition "INT"}}<th>EN 301 549 Clause</th>{{end}}
            <th>Conformance Level</th>
            <th>Remarks and Explanations</th>
        </tr>
        {{range .Report.Rows}}
        <tr>
            <td><strong>{{.SCID}} {{.SCName}}</strong><br>(Level {{.Level}})</td>
            {{if eq $.Edition "INT"}}<td>{{.EN301549Clause}}</td>{{end}}
            <td class="{{conformanceClass .Conformance}}">{{.Conformance}}</td>
            <td>{{.Remarks}}</td>
        </tr>
        {{end}}
    </table>
    {{.ScopeBlock}}

    <h2>Chapter 3: Functional Performance Criteria (FPC)</h2>
    <table>
        <tr><th>Criteria</th><th>Conformance Level</th><th>Remarks and Explanations</th></tr>
        {{range .Chapter3}}
        <tr><td>{{.Criterion}}</td><td class="not-eval">{{.Conformance}}</td><td>{{.Remarks}}</td></tr>
        {{end}}
    </table>

    <h2>Chapter 4: Hardware</h2>
    <table>
        <tr><th>Criteria</th><th>Conformance Level</th><th>Remarks and Explanations</th></tr>
        {{range .Chapter4}}
        <tr><td>{{.Criterion}}</td><td class="not-eval">{{.Conformance}}</td><td>{{.Remarks}}</td></tr>
        {{end}}
    </table>

    <h2>Chapter 5: Software</h2>
    <p>Most rows are Not Applicable for web content.</p>
    <table>
        <tr><th>Criteria</th><th>Conformance Level</th><th>Remarks and Explanations</th></tr>
        <tr><td>502.3 Accessibility Services</td><td class="not-eval">Not Evaluated</td><td>AT interoperability requires manual testing.</td></tr>
        <tr><td>503.2 User Preferences</td><td class="not-eval">Not Evaluated</td><td>Requires manual testing.</td></tr>
    </table>

    <h2>Chapter 6: Support Documentation and Services</h2>
    <table>
        <tr><th>Criteria</th><th>Conformance Level</th><th>Remarks and Explanations</th></tr>
        {{range .Chapter6}}
        <tr><td>{{.Criterion}}</td><td class="not-eval">{{.Conformance}}</td><td>{{.Remarks}}</td></tr>
        {{end}}
    </table>

    <div class="disclaimer">
        <p>This accessibility conformance report was generated using automated scanning tools including axe-core and custom Puppeteer-based checks. Automated analysis detects a subset of accessibility barriers. Issues requiring human judgment — including the adequacy of alternative text descriptions, the logical sequence of content, the functional usability with assistive technologies, and the accessibility of dynamically generated content — were not evaluated. This report covers the URL(s) listed above at the time of scanning and does not represent the accessibility of unscanned pages or future states of the site.</p>
        <p><strong>This Accessibility Conformance Report was prepared using automated testing methods. Conformance levels of 'Supports' or 'Partially Supports' reflect automated scan results only and have not been independently verified through manual testing with assistive technologies. Federal agencies are advised to conduct additional testing for mission-critical procurement decisions. This report does not constitute a legally binding representation of product conformance under the Rehabilitation Act of 1973, Section 508.</strong></p>
    </div>
</body>
</html>`

	tmpl, err := template.New("vpat").Funcs(template.FuncMap{
		"conformanceClass": conformanceClass,
	}).Parse(tmplStr)
	if err != nil {
		return "", nil, fmt.Errorf("failed to parse VPAT template: %v", err)
	}

	var buf bytes.Buffer
	err = tmpl.Execute(&buf, map[string]interface{}{
		"Report":     cr,
		"Edition":    opts.Edition,
		"Chapter3":   VPAT508Chapter3Rows,
		"Chapter4":   VPAT508Chapter4Rows,
		"Chapter6":   VPAT508Chapter6Rows,
		"ScopeBlock": ScopeBlockHTML(cr),
	})
	if err != nil {
		return "", nil, fmt.Errorf("failed to execute VPAT template: %v", err)
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
