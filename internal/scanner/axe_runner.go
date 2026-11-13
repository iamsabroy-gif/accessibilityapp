package scanner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/webaccessibility/server/internal/config"
	"github.com/webaccessibility/server/internal/models"
	"github.com/webaccessibility/server/internal/scoring"

	"sort"
	"strings"
)

// AxeRawResult mirrors the raw JSON output from axe_runner.js or client-side native engine.
type AxeRawResult struct {
	URL        string         `json:"url"`
	Violations []AxeViolation `json:"violations"`
	Passes     []AxeRule      `json:"passes"`
	Incomplete []AxeRule      `json:"incomplete"`
	Error      string         `json:"error,omitempty"`
	Links      []string       `json:"links,omitempty"`
	Screenshot string         `json:"screenshot,omitempty"`
}

type AxeViolation struct {
	ID             string    `json:"id"`
	Impact         string    `json:"impact"`
	Description    string    `json:"description"`
	Help           string    `json:"help"`
	HelpURL        string    `json:"helpUrl"`
	Tags           []string  `json:"tags"`
	Nodes          []AxeNode `json:"nodes"`
	ViolationIndex int       `json:"violationIndex,omitempty"`
}

type AxeNode struct {
	HTML           string   `json:"html"`
	Target         []string `json:"target"`
	FailureSummary string   `json:"failureSummary"`
	BBox           *AxeBBox `json:"bbox,omitempty"`
}

type AxeBBox struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type AxeRule struct {
	ID          string `json:"id"`
	Description string `json:"description"`
	NodeCount   int    `json:"nodeCount"`
}

// AxeRunner implements Scanner using a Node.js subprocess.
//
// With the native engine, scans run on a persistent worker process that keeps
// one browser open (see scripts/scan_worker.js). If the worker cannot be used,
// or the axe engine is active, each scan runs in its own process instead.
// Set SCAN_WORKER=off to always use one process per scan.
type AxeRunner struct {
	nodeBin          string
	axeScriptPath    string
	nativeScriptPath string
	worker           *nodeWorker
}

// NewAxeRunner creates a new AxeRunner with the given node binary and script paths.
func NewAxeRunner(nodeBin, axeScriptPath, nativeScriptPath string) *AxeRunner {
	a := &AxeRunner{
		nodeBin:          nodeBin,
		axeScriptPath:    axeScriptPath,
		nativeScriptPath: nativeScriptPath,
	}
	if strings.ToLower(os.Getenv("SCAN_WORKER")) != "off" {
		workerScript := filepath.Join(filepath.Dir(nativeScriptPath), "scan_worker.js")
		if _, err := os.Stat(workerScript); err == nil {
			a.worker = newNodeWorker(nodeBin, workerScript)
		}
	}
	return a
}

// Close stops the persistent scan worker, if one is running.
func (a *AxeRunner) Close() {
	if a.worker != nil {
		a.worker.Close()
	}
}

// runOnce executes a runner script in its own process and returns its stdout.
func (a *AxeRunner) runOnce(ctx context.Context, scriptPath, url, wcagLevel string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, a.nodeBin, scriptPath, url, wcagLevel)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		// The script reports failures as {"error":...} on stdout.
		var rawErr struct {
			Error string `json:"error"`
		}
		if jsonErr := json.Unmarshal(stdout.Bytes(), &rawErr); jsonErr == nil && rawErr.Error != "" {
			return nil, fmt.Errorf("axe runner error: %s", rawErr.Error)
		}
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("scan timed out for URL: %s", url)
		}
		return nil, fmt.Errorf("axe runner failed: %s%s", stdout.String(), stderr.String())
	}
	return stdout.Bytes(), nil
}

// Scan runs the active engine against the given URL and returns a structured ScanResult.
func (a *AxeRunner) Scan(ctx context.Context, url string, wcagLevel string, depth int) (*models.ScanResult, error) {
	start := time.Now()

	var output []byte
	var err error
	if config.GetActiveEngine() == "native" {
		usedWorker := false
		if a.worker != nil {
			output, err = a.worker.Scan(ctx, url)
			usedWorker = !errors.Is(err, errWorkerUnavailable)
			if usedWorker && err != nil {
				if ctx.Err() == context.DeadlineExceeded {
					return nil, fmt.Errorf("scan timed out for URL: %s", url)
				}
				return nil, fmt.Errorf("axe runner error: %s", err.Error())
			}
		}
		if !usedWorker {
			output, err = a.runOnce(ctx, a.nativeScriptPath, url, wcagLevel)
		}
	} else {
		output, err = a.runOnce(ctx, a.axeScriptPath, url, wcagLevel)
	}
	if err != nil {
		return nil, err
	}

	var raw AxeRawResult
	if err := json.Unmarshal(output, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse axe output: %w", err)
	}
	if raw.Error != "" {
		return nil, fmt.Errorf("axe scan error: %s", raw.Error)
	}

	// Map base result
	result := MapToScanResult(raw, url, wcagLevel, time.Since(start).Milliseconds())

	// If depth == 1, return discovered links for frontend-driven scanning.
	// Only same-site pages are returned, so they share the host that was
	// already validated for this scan.
	if depth == 1 && len(raw.Links) > 0 {
		result.DiscoveredLinks = SelectLinks(url, raw.Links, 10)
	}

	return result, nil
}

// MapToScanResult converts raw axe or native engine output into our canonical ScanResult model.
func MapToScanResult(raw AxeRawResult, url, wcagLevel string, durationMs int64) *models.ScanResult {

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

	score, grade, compliancePct := scoring.Calculate(violations, len(passIDs), len(incompleteIDs), config.GetScoringFormula())

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
		Violations:      violations,
		Passes:          passIDs,
		PassRules:       passRules,
		Incomplete:      incompleteIDs,
		EmbeddedResults: nil,
		Screenshot:      raw.Screenshot,
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
