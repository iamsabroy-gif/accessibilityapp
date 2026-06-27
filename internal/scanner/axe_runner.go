package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"

	"github.com/webaccessibility/server/internal/config"
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
	Screenshot string          `json:"screenshot,omitempty"`
}

type axeViolation struct {
	ID             string    `json:"id"`
	Impact         string    `json:"impact"`
	Description    string    `json:"description"`
	Help           string    `json:"help"`
	HelpURL        string    `json:"helpUrl"`
	Tags           []string  `json:"tags"`
	Nodes          []axeNode `json:"nodes"`
	ViolationIndex int       `json:"violationIndex,omitempty"`
}

type axeNode struct {
	HTML           string    `json:"html"`
	Target         []string  `json:"target"`
	FailureSummary string    `json:"failureSummary"`
	BBox           *axeBBox  `json:"bbox,omitempty"`
}

type axeBBox struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type axeRule struct {
	ID          string `json:"id"`
	Description string `json:"description"`
	NodeCount   int    `json:"nodeCount"`
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
    output, err := cmd.CombinedOutput()
    if err != nil {
        // Try to parse JSON error from stdout (which may contain {"error":...})
        var rawErr struct { Error string `json:"error"` }
        if jsonErr := json.Unmarshal(output, &rawErr); jsonErr == nil && rawErr.Error != "" {
            return nil, fmt.Errorf("axe runner error: %s", rawErr.Error)
        }
        if ctx.Err() == context.DeadlineExceeded {
            return nil, fmt.Errorf("scan timed out for URL: %s", url)
        }
        // Fallback to whatever output we have (may include stderr/stdout)
        return nil, fmt.Errorf("axe runner failed: %s", string(output))
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
            if blockedFlag && !config.GetAllowPrivateScans() {
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

        // Compute site-level AudioEye score across all pages
        if result.AudioEye != nil && len(embedded) > 0 {
            allScores := []int{result.AudioEye.Score}
            for _, er := range embedded {
                if er.AudioEye != nil {
                    allScores = append(allScores, er.AudioEye.Score)
                }
            }
            result.AudioEye.SiteScore = scoring.CalculateAudioEyeSite(allScores, nil)
        }
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
			node := models.Node{
				HTML:           n.HTML,
				Target:         n.Target,
				FailureSummary: n.FailureSummary,
			}
			if n.BBox != nil {
				node.BBox = &models.BBox{
					X:      n.BBox.X,
					Y:      n.BBox.Y,
					Width:  n.BBox.Width,
					Height: n.BBox.Height,
				}
			}
			nodes = append(nodes, node)
		}
		violation := models.Violation{
			ID:             v.ID,
			Impact:         v.Impact,
			Description:    v.Description,
			Help:           v.Help,
			HelpURL:        v.HelpURL,
			Tags:           v.Tags,
			Nodes:          nodes,
			ViolationIndex: v.ViolationIndex,
		}
		// Attach developer fix suggestion if one exists for this rule
		if suggestion, ok := models.SuggestionMap[v.ID]; ok {
			violation.DevSuggestion = suggestion
		}
		violations = append(violations, violation)
	}

	passRules := make([]models.PassRule, 0, len(raw.Passes))
	passIDs := make([]string, 0, len(raw.Passes))
	for _, p := range raw.Passes {
		passIDs = append(passIDs, p.ID)
		passRules = append(passRules, models.PassRule{ID: p.ID, NodeCount: p.NodeCount})
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

	// Create the ScanResult struct (base fields)
	result := &models.ScanResult{
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
		Violations:  violations,
		Passes:      passIDs,
		PassRules:   passRules,
		Incomplete:  incompleteIDs,
		EmbeddedResults: nil,
		Screenshot:  raw.Screenshot,
	}

	// Compute AudioEye element-level failure-rate score
	aeResult := scoring.CalculateAudioEye(violations, passRules, models.WCAGMap)
	result.AudioEye = &aeResult
	result.Summary.AudioEyeScore = aeResult.Score

	// Populate guideline slices into the result struct
	result.PassGuidelines = passGuidelines
	result.ViolationGuidelines = violationGuidelines
	result.IncompleteGuidelines = incompleteGuidelines
	return result
}
