package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/webaccessibility/server/internal/models"
)

// SCLevel maps WCAG 2.1/2.2 success criterion numbers to their conformance level.
// Source: https://www.w3.org/TR/WCAG22/#conformance
var SCLevel = map[string]string{
	// WCAG 2.1 Level A
	"1.1.1": "A", "1.2.1": "A", "1.2.2": "A", "1.2.3": "A",
	"1.3.1": "A", "1.3.2": "A", "1.3.3": "A",
	"1.4.1": "A", "1.4.2": "A",
	"2.1.1": "A", "2.1.2": "A", "2.1.4": "A",
	"2.2.1": "A", "2.2.2": "A",
	"2.3.1": "A",
	"2.4.1": "A", "2.4.2": "A", "2.4.3": "A", "2.4.4": "A",
	"2.5.1": "A", "2.5.2": "A", "2.5.3": "A", "2.5.4": "A",
	"3.1.1": "A",
	"3.2.1": "A", "3.2.2": "A",
	"3.3.1": "A", "3.3.2": "A",
	"4.1.1": "A", "4.1.2": "A",

	// WCAG 2.1 Level AA
	"1.2.4": "AA", "1.2.5": "AA",
	"1.3.4": "AA", "1.3.5": "AA",
	"1.4.3": "AA", "1.4.4": "AA", "1.4.5": "AA",
	"1.4.10": "AA", "1.4.11": "AA", "1.4.12": "AA", "1.4.13": "AA",
	"2.4.5": "AA", "2.4.6": "AA", "2.4.7": "AA",
	"3.1.2": "AA",
	"3.2.3": "AA", "3.2.4": "AA",
	"3.3.3": "AA", "3.3.4": "AA",
	"4.1.3": "AA",

	// WCAG 2.1 Level AAA
	"1.2.6": "AAA", "1.2.7": "AAA", "1.2.8": "AAA", "1.2.9": "AAA",
	"1.3.6": "AAA",
	"1.4.6": "AAA", "1.4.7": "AAA", "1.4.8": "AAA", "1.4.9": "AAA",
	"2.1.3": "AAA",
	"2.2.3": "AAA", "2.2.4": "AAA", "2.2.5": "AAA", "2.2.6": "AAA",
	"2.3.2": "AAA", "2.3.3": "AAA",
	"2.4.8": "AAA", "2.4.9": "AAA", "2.4.10": "AAA",
	"2.5.5": "AAA", "2.5.6": "AAA",
	"3.1.3": "AAA", "3.1.4": "AAA", "3.1.5": "AAA", "3.1.6": "AAA",
	"3.2.5": "AAA",
	"3.3.5": "AAA", "3.3.6": "AAA",

	// WCAG 2.2 new criteria
	"2.4.11": "AA",  // Focus Not Obscured (Minimum)
	"2.4.12": "AAA", // Focus Not Obscured (Enhanced)
	"2.4.13": "AAA", // Focus Appearance
	"2.5.7": "A",    // Dragging Movements
	"2.5.8": "AA",   // Target Size (Minimum)
	"3.2.6": "A",    // Consistent Help
	"3.3.7": "A",    // Redundant Entry
	"3.3.8": "AA",   // Accessible Authentication (Minimum)
	"3.3.9": "AAA",  // Accessible Authentication (Enhanced)
}

type wcagMapOutput struct {
	Rules   map[string][]string `json:"rules"`    // ruleID → SC numbers
	Levels  map[string]string   `json:"sc_levels"` // SC number → A/AA/AAA
}

func main() {
	output := wcagMapOutput{
		Rules:  models.WCAGMap,
		Levels: SCLevel,
	}

	data, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "error marshaling wcag map: %v\n", err)
		os.Exit(1)
	}

	// Write to packages/cli/wcag_map.json relative to the repo root
	_, thisFile, _, _ := runtime.Caller(0)
	repoRoot := filepath.Join(filepath.Dir(thisFile), "..", "..")
	outPath := filepath.Join(repoRoot, "packages", "cli", "wcag_map.json")

	if err := os.MkdirAll(filepath.Dir(outPath), 0755); err != nil {
		fmt.Fprintf(os.Stderr, "error creating output dir: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(outPath, data, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "error writing %s: %v\n", outPath, err)
		os.Exit(1)
	}

	fmt.Printf("Generated %s (%d rules, %d SC levels)\n", outPath, len(output.Rules), len(output.Levels))
}
