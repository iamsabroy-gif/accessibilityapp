package scoring

import (
	"math"
	"testing"

	"github.com/webaccessibility/server/internal/models"
)

func TestCalculateAudioEye_WorkedExample(t *testing.T) {
	violations := []models.Violation{
		{
			ID:     "image-alt",
			Impact: "serious",
			Nodes:  make([]models.Node, 5),
		},
		{
			ID:     "color-contrast",
			Impact: "serious",
			Nodes:  make([]models.Node, 2),
		},
	}

	passRules := []models.PassRule{
		{ID: "image-alt", NodeCount: 95},
		{ID: "color-contrast", NodeCount: 38},
		{ID: "document-title", NodeCount: 1},
		{ID: "html-has-lang", NodeCount: 1},
	}

	wcagMap := map[string][]string{
		"image-alt":       {"1.1.1"},
		"color-contrast":  {"1.4.3"},
		"document-title":  {"2.4.2"},
		"html-has-lang":   {"3.1.1"},
	}

	result := CalculateAudioEye(violations, passRules, wcagMap)

	if result.Score != 98 {
		t.Errorf("expected Score=98, got %d", result.Score)
	}
	if result.Grade != "A" {
		t.Errorf("expected Grade=A, got %s", result.Grade)
	}
	if result.SCsEvaluated != 4 {
		t.Errorf("expected SCsEvaluated=4, got %d", result.SCsEvaluated)
	}
	if math.Abs(result.WeightedFailure-0.025) > 0.0001 {
		t.Errorf("expected WeightedFailure≈0.025, got %f", result.WeightedFailure)
	}

	// Verify SC breakdown
	sc111 := result.SCBreakdown["1.1.1"]
	if sc111.FailedElements != 5 || sc111.TestedElements != 100 {
		t.Errorf("SC 1.1.1: expected 5/100, got %d/%d", sc111.FailedElements, sc111.TestedElements)
	}
	sc143 := result.SCBreakdown["1.4.3"]
	if sc143.FailedElements != 2 || sc143.TestedElements != 40 {
		t.Errorf("SC 1.4.3: expected 2/40, got %d/%d", sc143.FailedElements, sc143.TestedElements)
	}
	sc242 := result.SCBreakdown["2.4.2"]
	if sc242.FailedElements != 0 || sc242.TestedElements != 1 {
		t.Errorf("SC 2.4.2: expected 0/1, got %d/%d", sc242.FailedElements, sc242.TestedElements)
	}
}

func TestCalculateAudioEye_NoViolations(t *testing.T) {
	passRules := []models.PassRule{
		{ID: "image-alt", NodeCount: 10},
	}
	wcagMap := map[string][]string{"image-alt": {"1.1.1"}}

	result := CalculateAudioEye(nil, passRules, wcagMap)
	if result.Score != 100 {
		t.Errorf("expected Score=100 with no violations, got %d", result.Score)
	}
}

func TestCalculateAudioEye_Empty(t *testing.T) {
	result := CalculateAudioEye(nil, nil, map[string][]string{})
	if result.Score != 100 || result.SCsEvaluated != 0 {
		t.Errorf("expected Score=100, SCsEvaluated=0 for empty input, got %d, %d", result.Score, result.SCsEvaluated)
	}
}

func TestCalculateAudioEyeSite(t *testing.T) {
	scores := []int{98, 100, 90}
	site := CalculateAudioEyeSite(scores, nil)
	expected := int(math.Round(float64(98+100+90) / 3.0))
	if site != expected {
		t.Errorf("expected site score %d, got %d", expected, site)
	}
}

func TestCalculateAudioEyeSite_Weighted(t *testing.T) {
	scores := []int{100, 80}
	pageviews := []int{3, 1}
	site := CalculateAudioEyeSite(scores, pageviews)
	expected := int(math.Round((100.0*3 + 80.0*1) / 4.0))
	if site != expected {
		t.Errorf("expected site score %d, got %d", expected, site)
	}
}
