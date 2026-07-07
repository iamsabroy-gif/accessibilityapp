package report

import (
	"bytes"
	"fmt"
	"html/template"

	"github.com/webaccessibility/server/internal/models"
)

type AODAOptions struct {
	Format string // "html" | "pdf"
}

// GenerateAODA produces an AODA WCAG 2.0 AA compliance report in HTML (and optionally PDF).
func GenerateAODA(cr *models.ComplianceReport, opts AODAOptions) (string, []byte, error) {
	tmplStr := `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AODA Accessibility Compliance Report</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.5; color: #333; max-width: 1000px; margin: 0 auto; padding: 20px; }
        h1 { color: #000; border-bottom: 3px solid #b91d47; padding-bottom: 10px; }
        h2 { color: #b91d47; margin-top: 30px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ccc; padding: 10px; text-align: left; vertical-align: top; }
        th { background-color: #f4f4f4; }
        .disclaimer { border-left: 4px solid #b91d47; background: #fdf5f6; padding: 15px; margin-top: 40px; }
        .supports { color: #155724; font-weight: bold; }
        .partial { color: #856404; font-weight: bold; }
        .does-not-support { color: #721c24; font-weight: bold; }
        .not-eval { color: #6c757d; }
    </style>
</head>
<body>
    <h1>AODA Accessibility Compliance Report</h1>
    
    <p>This report serves to document accessibility compliance in accordance with the <strong>Accessibility for Ontarians with Disabilities Act (AODA)</strong>, specifically the Information and Communications Standards (O. Reg. 191/11). The AODA requires organizations to make their internet websites and web content conform with the World Wide Web Consortium Web Content Accessibility Guidelines (WCAG) 2.0, initially at Level A and increasing to Level AA.</p>
    
    <h2>1. Organization and Website Information</h2>
    <table>
        <tr><th>Organization Name</th><td>{{.Report.Meta.VendorName}}</td></tr>
        <tr><th>Website Name/Product</th><td>{{.Report.Meta.ProductName}}</td></tr>
        <tr><th>URL</th><td>{{.Report.URL}}</td></tr>
        <tr><th>Report Date</th><td>{{.Report.ReportDate}}</td></tr>
        <tr><th>Contact Information</th><td>{{.Report.Meta.ContactInfo}}</td></tr>
    </table>

    <h2>2. Certification Status</h2>
    <p>This section outlines the compliance status against <strong>WCAG 2.0 Level AA</strong>.</p>
    <table>
        <tr>
            <th>WCAG 2.0 Criteria</th>
            <th>Level</th>
            <th>Conformance Status</th>
            <th>Remarks</th>
        </tr>
        {{range .Report.Rows}}
            {{if or (eq .WCAGVersion "2.0") (eq .WCAGVersion "")}}
            <tr>
                <td><strong>{{.SCID}} {{.SCName}}</strong></td>
                <td>{{.Level}}</td>
                <td class="{{conformanceClass .Conformance}}">{{.Conformance}}</td>
                <td>{{.Remarks}}</td>
            </tr>
            {{end}}
        {{end}}
    </table>

    <div class="disclaimer">
        <h3>Statement of Assessment</h3>
        <p>This automated assessment was performed on {{.Report.ScannedAt.Format "January 2, 2006"}} using automated testing tools (axe-core and custom rules). Under the AODA, organizations must file accessibility compliance reports confirming they have met their requirements. <strong>This document serves as supporting evidence for internal recordkeeping and does not replace the requirement to file the official online compliance report via the Ontario portal (Ontario.ca/AODAreporting) by the mandatory deadlines (e.g., December 31, 2026).</strong></p>
        <p>Automated analysis detects a subset of accessibility barriers. A full manual audit is required to certify complete compliance with all WCAG 2.0 Level AA success criteria.</p>
    </div>
</body>
</html>`

	tmpl, err := template.New("aoda").Funcs(template.FuncMap{
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
		return "", nil, fmt.Errorf("failed to parse AODA template: %v", err)
	}

	var buf bytes.Buffer
	err = tmpl.Execute(&buf, map[string]interface{}{
		"Report": cr,
	})
	if err != nil {
		return "", nil, fmt.Errorf("failed to execute AODA template: %v", err)
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
