package report

import "github.com/webaccessibility/server/internal/models"

// VPATStaticRow represents one row in VPAT chapters 3–6.
type VPATStaticRow struct {
	Criterion   string
	Conformance models.ConformanceLevel
	Remarks     string
}

// VPAT508Chapter3Rows are the 9 Functional Performance Criteria (Section 508 §302).
// All are Not Evaluated — they require manual testing with assistive technology users.
var VPAT508Chapter3Rows = []VPATStaticRow{
	{"302.1 Without Vision", models.ConformanceNotEvaluated,
		"Screen reader testing with JAWS, NVDA, or VoiceOver required to evaluate."},
	{"302.2 With Limited Vision", models.ConformanceNotEvaluated,
		"Zoom and magnification testing up to 400% required."},
	{"302.3 Without Perception of Color", models.ConformanceNotEvaluated,
		"Color-blind simulation and grayscale testing required."},
	{"302.4 Without Hearing", models.ConformanceNotEvaluated,
		"Deaf user scenario testing with captions and visual alerts required."},
	{"302.5 With Limited Hearing", models.ConformanceNotEvaluated,
		"Hard-of-hearing user scenario testing required."},
	{"302.6 Without Speech", models.ConformanceNotEvaluated,
		"Voice input alternative scenario testing required."},
	{"302.7 With Limited Manipulation", models.ConformanceNotEvaluated,
		"Switch access and eye-gaze device testing required."},
	{"302.8 With Limited Reach and Strength", models.ConformanceNotEvaluated,
		"Physical access scenario testing required."},
	{"302.9 With Limited Language, Cognitive, and Learning Abilities", models.ConformanceNotEvaluated,
		"Cognitive accessibility evaluation by qualified evaluators required."},
}

var VPAT508Chapter4Rows = []VPATStaticRow{
	{"402 Closed Functionality", models.ConformanceNotApplicable, "Web-based software; not applicable."},
	{"403 Biometrics", models.ConformanceNotApplicable, "No biometric authentication used."},
	{"404 Preservation of Information", models.ConformanceNotApplicable, "Not a hardware product."},
	{"405 Privacy", models.ConformanceNotApplicable, "Not a hardware product."},
	{"406 Standard Connections", models.ConformanceNotApplicable, "Not a hardware product."},
	{"407 Operable Parts", models.ConformanceNotApplicable, "Not a hardware product."},
	{"408 Display Screen", models.ConformanceNotApplicable, "Not a hardware product."},
	{"409 Status Indicators", models.ConformanceNotApplicable, "Not a hardware product."},
	{"410 Color Coding", models.ConformanceNotApplicable, "Not a hardware product."},
	{"411 Audible Signals", models.ConformanceNotApplicable, "Not a hardware product."},
	{"412 ICT with Two-Way Voice Communication", models.ConformanceNotApplicable, "Not a hardware product."},
	{"413 Closed Caption Processing Technologies", models.ConformanceNotApplicable, "Not a hardware product."},
	{"414 Audio Description Processing Technologies", models.ConformanceNotApplicable, "Not a hardware product."},
	{"415 User Controls for Captions and Audio Descriptions", models.ConformanceNotApplicable, "Not a hardware product."},
}

var VPAT508Chapter6Rows = []VPATStaticRow{
	{"601.1 Scope", models.ConformanceNotEvaluated,
		"Support documentation and services are not within the scope of this automated web accessibility scan."},
	{"602 Support Documentation", models.ConformanceNotEvaluated,
		"Documentation accessibility requires manual review of help content, user manuals, and online support materials."},
	{"603 Support Services", models.ConformanceNotEvaluated,
		"Support service accessibility (chat, phone, email support) requires manual evaluation."},
	{"604 Authoring Tools", models.ConformanceNotApplicable,
		"This product does not function as an authoring tool."},
}
