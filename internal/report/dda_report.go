package report

import (
	"bytes"
	"fmt"
	"html/template"

	"github.com/webaccessibility/server/internal/models"
)

type DDAOptions struct {
	Format string // "html" | "pdf"
}

// GenerateDDA produces a DDA WCAG compliance report in HTML (and optionally PDF).
func GenerateDDA(cr *models.ComplianceReport, opts DDAOptions) (string, []byte, error) {
	tmplStr := `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Accessibility Conformance Report (Australia DDA)</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #111; max-width: 1000px; margin: 0 auto; padding: 20px; }
        h1 { color: #004d40; border-bottom: 2px solid #004d40; padding-bottom: 10px; }
        h2 { color: #00695c; margin-top: 30px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ccc; padding: 10px; text-align: left; vertical-align: top; }
        th { background-color: #f1f8e9; color: #33691e; }
        .disclaimer { border-left: 4px solid #004d40; background: #e0f2f1; padding: 15px; margin-top: 40px; }
        .supports { color: #155724; font-weight: bold; }
        .partial { color: #856404; font-weight: bold; }
        .does-not-support { color: #721c24; font-weight: bold; }
        .not-eval { color: #6c757d; }
    </style>
</head>
<body>
    <h1>Accessibility Conformance Report</h1>
    
    <p>This report documents the accessibility conformance of the specified digital service in alignment with the expectations of the <strong>Disability Discrimination Act 1992 (DDA)</strong> and the Digital Transformation Agency (DTA). The Australian government mandates conformance to the Web Content Accessibility Guidelines (WCAG) 2.1 (and progressing towards 2.2) Level AA to ensure digital services are usable by everyone.</p>
    
    <h2>1. Service Details</h2>
    <table>
        <tr><th>Product / Website</th><td>{{.Report.Meta.ProductName}}</td></tr>
        <tr><th>Organisation</th><td>{{.Report.Meta.VendorName}}</td></tr>
        <tr><th>Scanned URL</th><td>{{.Report.URL}}</td></tr>
        <tr><th>Report Generated</th><td>{{.Report.ReportDate}}</td></tr>
        <tr><th>Contact Email</th><td>{{.Report.Meta.ContactInfo}}</td></tr>
    </table>

    <h2>2. WCAG Conformance Evaluation (Level AA)</h2>
    <p>The following table details the findings from an automated evaluation against WCAG success criteria.</p>
    <table>
        <tr>
            <th>Success Criterion</th>
            <th>Conformance Status</th>
            <th>Findings / Recommended Actions</th>
        </tr>
        {{range .Report.Rows}}
            <tr>
                <td><strong>{{.SCID}} {{.SCName}}</strong><br>(Level {{.Level}})</td>
                <td class="{{conformanceClass .Conformance}}">{{.Conformance}}</td>
                <td>{{.Remarks}}</td>
            </tr>
        {{end}}
    </table>

    <div class="disclaimer">
        <h3>Statement of Commitment & Evaluation Limitations</h3>
        <p>This assessment was conducted using automated evaluation methodologies on {{.Report.ScannedAt.Format "2 Jan 2006"}}. While automated testing is a crucial step in identifying accessibility barriers, it is not a substitute for comprehensive manual testing, including testing with assistive technologies (such as NVDA, JAWS, or VoiceOver) and users with disabilities. Therefore, this report constitutes an initial baseline assessment rather than a complete certification of DDA compliance.</p>
    </div>
</body>
</html>`

	tmpl, err := template.New("dda").Funcs(template.FuncMap{
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
		return "", nil, fmt.Errorf("failed to parse DDA template: %v", err)
	}

	var buf bytes.Buffer
	err = tmpl.Execute(&buf, map[string]interface{}{
		"Report": cr,
	})
	if err != nil {
		return "", nil, fmt.Errorf("failed to execute DDA template: %v", err)
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
