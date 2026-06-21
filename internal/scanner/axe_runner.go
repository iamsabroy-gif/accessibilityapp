package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"

	"github.com/webaccessibility/server/internal/models"
	"github.com/webaccessibility/server/internal/scoring"

	neturl "net/url"
	"strings"
	"sort"
)

// axeRawResult mirrors the raw JSON output from axe_runner.js.
type axeRawResult struct {
	URL        string          `json:"url"`
	Violations []axeViolation  `json:"violations"`
	Passes     []axeRule       `json:"passes"`
	Incomplete []axeRule       `json:"incomplete"`
	Error      string          `json:"error,omitempty"`
	Links      []string        `json:"links,omitempty"`
}

type axeViolation struct {
	ID          string    `json:"id"`
	Impact      string    `json:"impact"`
	Description string    `json:"description"`
	Help        string    `json:"help"`
	HelpURL     string    `json:"helpUrl"`
	Tags        []string  `json:"tags"`
	Nodes       []axeNode `json:"nodes"`
}

type axeNode struct {
	HTML           string   `json:"html"`
	Target         []string `json:"target"`
	FailureSummary string   `json:"failureSummary"`
}

type axeRule struct {
	ID          string `json:"id"`
	Description string `json:"description"`
}

// AxeRunner implements Scanner using axe-core via a Node.js subprocess.
type AxeRunner struct {
	nodeBin    string
	scriptPath string
}

// NewAxeRunner creates a new AxeRunner with the given node binary and script path.
func NewAxeRunner(nodeBin, scriptPath string) *AxeRunner {
	return &AxeRunner{nodeBin: nodeBin, scriptPath: scriptPath}
}

// Scan runs axe-core against the given URL and returns a structured ScanResult.
func (a *AxeRunner) Scan(ctx context.Context, url string, wcagLevel string, depth int) (*models.ScanResult, error) {
	start := time.Now()

    // Execute the node script with depth argument (passed for future use)
    cmd := exec.CommandContext(ctx, a.nodeBin, a.scriptPath, url, wcagLevel)
    output, err := cmd.Output()
    if err != nil {
        if ctx.Err() == context.DeadlineExceeded {
            return nil, fmt.Errorf("scan timed out for URL: %s", url)
        }
        // Capture stderr if available
        if exitErr, ok := err.(*exec.ExitError); ok {
            return nil, fmt.Errorf("axe runner failed: %s", string(exitErr.Stderr))
        }
        return nil, fmt.Errorf("axe runner error: %w", err)
    }

    var raw axeRawResult
    if err := json.Unmarshal(output, &raw); err != nil {
        return nil, fmt.Errorf("failed to parse axe output: %w", err)
    }
    if raw.Error != "" {
        return nil, fmt.Errorf("axe scan error: %s", raw.Error)
    }

    // Map base result
    result := mapToScanResult(raw, url, wcagLevel, time.Since(start).Milliseconds())

    // If depth == 1, process embedded links (max 10)
    if depth == 1 && len(raw.Links) > 0 {
        maxLinks := 10
        embedded := make([]models.ScanResult, 0, maxLinks)
        for i, link := range raw.Links {
            if i >= maxLinks {
                break
            }
            // Basic validation: scheme http/https and non-empty host
            u, err := neturl.Parse(link)
            if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
                continue
            }
            // Avoid private URLs similar to main validation
            lower := strings.ToLower(link)
            blocked := []string{"localhost", "127.", "10.", "192.168.", "172.16.", "0.0.0.0", "::1"}
            blockedFlag := false
            for _, b := range blocked {
                if strings.Contains(lower, b) {
                    blockedFlag = true
                    break
                }
            }
            if blockedFlag {
                continue
            }
            // Perform recursive scan with depth 0
            embedRes, err := a.Scan(ctx, link, wcagLevel, 0)
            if err != nil {
                // Log and skip problematic link
                continue
            }
            if embedRes != nil {
                embedded = append(embedded, *embedRes)
            }
        }
        result.EmbeddedResults = embedded
    }

    return result, nil

}

// mapToScanResult converts raw axe output into our canonical ScanResult model.
func mapToScanResult(raw axeRawResult, url, wcagLevel string, durationMs int64) *models.ScanResult {

	// mapGuidelines converts a slice of axe rule IDs into a deduped, sorted list of WCAG 2.1 criterion numbers.
	mapGuidelines := func(ids []string) []string {
		guidelines := make([]string, 0, len(ids))
		seen := make(map[string]struct{})
		for _, id := range ids {
			if nums, ok := models.WCAGMap[id]; ok {
				for _, n := range nums {
					if _, dup := seen[n]; !dup {
						seen[n] = struct{}{}
						guidelines = append(guidelines, n)
					}
				}
			}
		}
		sort.Strings(guidelines)
		return guidelines
	}

	violations := make([]models.Violation, 0, len(raw.Violations))
	for _, v := range raw.Violations {
		nodes := make([]models.Node, 0, len(v.Nodes))
		for _, n := range v.Nodes {
			nodes = append(nodes, models.Node{
				HTML:           n.HTML,
				Target:         n.Target,
				FailureSummary: n.FailureSummary,
			})
		}
		violations = append(violations, models.Violation{
			ID:          v.ID,
			Impact:      v.Impact,
			Description: v.Description,
			Help:        v.Help,
			HelpURL:     v.HelpURL,
			Tags:        v.Tags,
			Nodes:       nodes,
		})
	}

	passIDs := make([]string, 0, len(raw.Passes))
	for _, p := range raw.Passes {
		passIDs = append(passIDs, p.ID)
	}
	incompleteIDs := make([]string, 0, len(raw.Incomplete))
	for _, i := range raw.Incomplete {
		incompleteIDs = append(incompleteIDs, i.ID)
	}

	score, grade, compliancePct := scoring.Calculate(violations, len(passIDs))

	// Build guideline slices
	passGuidelines := mapGuidelines(passIDs)
	violationIDs := make([]string, 0, len(raw.Violations))
	for _, v := range raw.Violations {
		violationIDs = append(violationIDs, v.ID)
	}
	violationGuidelines := mapGuidelines(violationIDs)
	incompleteGuidelines := mapGuidelines(incompleteIDs)

	return &models.ScanResult{
		URL:        url,
		ScannedAt:  time.Now().UTC(),
		DurationMs: durationMs,
		Summary: models.Summary{
			ViolationCount:  len(violations),
			PassCount:       len(passIDs),
			IncompleteCount: len(incompleteIDs),
			Level:           "WCAG 2.1 " + wcagLevel,
			Score:           score,
			Grade:           grade,
			CompliancePct:   compliancePct,
		},
		Violations: violations,
		Passes:     passIDs,
		PassGuidelines:       passGuidelines,
		ViolationGuidelines:  violationGuidelines,
		Incomplete: incompleteIDs,
		IncompleteGuidelines: incompleteGuidelines,
		EmbeddedResults:      nil,
	}
}
