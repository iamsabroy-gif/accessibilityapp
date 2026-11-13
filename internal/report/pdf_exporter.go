package report

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"time"
)

// PDFRenderer, when set, renders PDFs on an already-running browser (the scan
// worker) so a new Chromium does not have to start for every PDF. If it is nil
// or fails, the one-shot scripts/pdf_generator.js process is used instead.
var PDFRenderer func(ctx context.Context, html string) ([]byte, error)

// ExportToPDF converts HTML string to PDF bytes using Puppeteer.
// Defaults to a 60-second timeout.
func ExportToPDF(html string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	return ExportToPDFContext(ctx, html)
}

// ExportToPDFContext converts HTML string to PDF bytes with a provided context.
func ExportToPDFContext(ctx context.Context, html string) ([]byte, error) {
	if PDFRenderer != nil {
		if pdf, err := PDFRenderer(ctx, html); err == nil {
			return pdf, nil
		}
	}

	cmd := exec.CommandContext(ctx, "node", "scripts/pdf_generator.js")
	cmd.Stdin = bytes.NewBufferString(html)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		return nil, fmt.Errorf("pdf generation failed: %v, stderr: %s", err, stderr.String())
	}

	return stdout.Bytes(), nil
}
