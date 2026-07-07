package report

import "github.com/webaccessibility/server/internal/models"

// EN301549Clause4Rows: Functional Performance Statements
// Same 9 statements as VPAT Chapter 3 — all Not Evaluated.
var EN301549Clause4Rows = []VPATStaticRow{
	{"4.2.1 Usage without vision", models.ConformanceNotEvaluated, "Screen reader testing required."},
	{"4.2.2 Usage with limited vision", models.ConformanceNotEvaluated, "Low vision testing required."},
	{"4.2.3 Usage without perception of colour", models.ConformanceNotEvaluated, "Colour-blind testing required."},
	{"4.2.4 Usage without hearing", models.ConformanceNotEvaluated, "Deaf user scenario testing required."},
	{"4.2.5 Usage with limited hearing", models.ConformanceNotEvaluated, "Hard-of-hearing testing required."},
	{"4.2.6 Usage without vocal capability", models.ConformanceNotEvaluated, "Non-vocal input testing required."},
	{"4.2.7 Usage with limited manipulation or strength", models.ConformanceNotEvaluated, "Motor impairment testing required."},
	{"4.2.8 Usage with limited reach", models.ConformanceNotEvaluated, "Physical access testing required."},
	{"4.2.9 Minimize photosensitive seizure triggers", models.ConformanceNotEvaluated, "Requires specialized flash analysis tools."},
	{"4.2.10 Usage with limited cognition", models.ConformanceNotEvaluated, "Cognitive accessibility evaluation required."},
}

// EN301549Clause5Rows: Generic Requirements
var EN301549Clause5Rows = []VPATStaticRow{
	{"5.2 Activation of accessibility features", models.ConformanceNotApplicable,
		"Web content does not have closed functionality; not applicable."},
	{"5.3 Biometrics", models.ConformanceNotApplicable,
		"No biometric authentication detected."},
	{"5.4 Preservation of accessibility information during conversion", models.ConformanceNotApplicable,
		"This product does not convert content formats."},
	{"5.5 Operable parts", models.ConformanceNotApplicable,
		"Not a hardware product."},
	{"5.6 Locking or toggle controls", models.ConformanceNotApplicable,
		"Not a hardware product."},
	{"5.7 Key repeat", models.ConformanceNotApplicable,
		"Not a hardware product."},
	{"5.8 Double-strike key acceptance", models.ConformanceNotApplicable,
		"Not a hardware product."},
	{"5.9 Simultaneous user actions", models.ConformanceNotApplicable,
		"Not a hardware product."},
}

// EN301549Clause6Rows: ICT with Two-Way Voice Communication
var EN301549Clause6Rows = []VPATStaticRow{
	{"6.1 Audio bandwidth for speech", models.ConformanceNotApplicable,
		"Web content does not provide two-way voice communication."},
	{"6.2 Real-time text (RTT) functionality", models.ConformanceNotApplicable,
		"Web content does not provide real-time voice communication."},
	{"6.3 Caller ID", models.ConformanceNotApplicable, "Not applicable."},
	{"6.4 Alternatives to voice-based services", models.ConformanceNotApplicable, "Not applicable."},
	{"6.5 Video communication", models.ConformanceNotApplicable, "Not applicable."},
}

// EN301549Clause8Rows: Hardware — all Not Applicable
var EN301549Clause8Rows = []VPATStaticRow{
	{"8.1 General", models.ConformanceNotApplicable, "Not a hardware product."},
	{"8.2 Hardware products with speech output", models.ConformanceNotApplicable, "Not applicable."},
	{"8.3 Stationary ICT", models.ConformanceNotApplicable, "Not applicable."},
	{"8.4 ICT with mechanically operable parts", models.ConformanceNotApplicable, "Not applicable."},
	{"8.5 Tactile indication of speech mode", models.ConformanceNotApplicable, "Not applicable."},
}

// EN301549Clause10Rows: Non-Web Documents
var EN301549Clause10Rows = []VPATStaticRow{
	{"10.1 through 10.6", models.ConformanceNotEvaluated,
		"Non-web documents (PDFs, Office files) linked from the scanned page were not evaluated. " +
			"For complete EN 301 549 conformance, non-web documents require separate evaluation."},
}

// EN301549Clause11Rows: Software
var EN301549Clause11Rows = []VPATStaticRow{
	{"11.0 General", models.ConformanceNotApplicable,
		"Web content is evaluated under Clause 9. Clause 11 (software) applies to native " +
			"applications and is not applicable to web content accessed through a browser."},
	{"11.5.2 Accessibility services", models.ConformanceNotEvaluated,
		"AT interoperability for any native components requires manual testing with JAWS, NVDA, or VoiceOver."},
	{"11.8 Authoring tools", models.ConformanceNotApplicable,
		"This product does not function as an authoring tool."},
}

// EN301549Clause12Rows: Documentation and Support Services
var EN301549Clause12Rows = []VPATStaticRow{
	{"12.1 Product documentation", models.ConformanceNotEvaluated,
		"Accessibility of product documentation was not evaluated by this automated scan."},
	{"12.2 Support services", models.ConformanceNotEvaluated,
		"Accessibility of support services (chat, phone, email) requires separate manual evaluation."},
}

// EN301549Clause13Rows: ICT Providing Relay or Emergency Service Access
var EN301549Clause13Rows = []VPATStaticRow{
	{"13.1 Relay services requirements", models.ConformanceNotApplicable, "Not applicable to this web product."},
	{"13.2 Access to relay services", models.ConformanceNotApplicable, "Not applicable."},
	{"13.3 Access to emergency services", models.ConformanceNotApplicable, "Not applicable."},
}
