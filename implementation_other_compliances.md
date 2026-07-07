# Compliance Reporting Implementation Plan: ADA, Section 508 (VPAT), and EN 301 549

Generated: 2026-07-06

---

## Overview

Add three compliance report types to the existing scanner by building a shared conformance engine on top of the current `AudioEyeResult.SCBreakdown` data, then layering three formatters:

- **ADA**: HTML/PDF legal risk report (WCAG 2.1 AA framing)
- **VPAT**: Section 508 INT edition (WCAG 2.0 AA + EN 301 549 + WCAG 2.1 in one document)
- **EN 301 549**: ACR for the European standard (Clause 9 = WCAG 2.1 AA)

All three consume a common `ComplianceReport` intermediate type built from existing scan data. Estimated total: **12–17 developer-days**. Phases 2–5 run in parallel after Phase 1.

---

## Mandatory Pre-Work (Day 0 — 0.5 days)

Fix `internal/models/wcag_mapping.go` before anything else:

```go
// Change:
"heading-order": {"2.4.10"},
// To:
"heading-order": {"1.3.1"},
```

SC `2.4.10` is Level **AAA** and does not appear in any A/AA conformance table. The `heading-order` rule tests heading nesting structure — correctly a `1.3.1` (Info and Relationships) violation. Leaving this wrong will silently corrupt `SCBreakdown` and all three report types.

---

## Standards Mapping and Gap Inventory

### What Each Standard Requires

| Standard | WCAG Basis | Scope |
|---|---|---|
| ADA Title III | WCAG 2.1 AA (de facto, per case law) | Web content |
| Section 508 (2017 refresh) | WCAG **2.0** AA (incorporated by reference) | Web + software + hardware + docs |
| EN 301 549 v3.2.1 (2021) | WCAG **2.1** AA (Clause 9) | Web + software + docs + voice |

**ADA note:** No enacted technical web rule for Title III exists as of 2026. Federal courts uniformly apply WCAG 2.1 AA (based on DOJ guidance and circuit court decisions including *Robles v. Domino's Pizza*, 9th Cir. 2019). The DOJ published a final rule for Title II (government entities) in April 2024 mandating WCAG 2.1 AA effective April 2026 for large entities. Report against WCAG 2.1 A/AA — your current WCAGMap scope is correct.

**Section 508 note:** The 2017 refresh incorporated WCAG 2.0, not 2.1. The 12 WCAG 2.1-only SCs (`1.3.4, 1.3.5, 1.4.10, 1.4.11, 1.4.12, 1.4.13, 2.1.4, 2.5.1, 2.5.2, 2.5.3, 2.5.4, 4.1.3`) are `Not Applicable` in VPAT Chapter 2 but are evaluated in EN 301 549 and ADA.

**EN 301 549 note:** The EU Web Accessibility Directive (2016/2102) mandates it for public sector. The European Accessibility Act (2019/882) extends to private sector from June 2025. Clause 9 = WCAG 2.1 A/AA verbatim. Clauses 4–8, 10–13 are mostly `Not Applicable` for a web-only scanner.

### SC Gaps — Missing from WCAGMap

**Required for WCAG 2.0 AA (Section 508):**

| SC | Name | Automatable? |
|---|---|---|
| 1.2.4 | Live Captions | No — manual only |
| 1.2.5 | Audio Description (Prerecorded) | Partial — detect `<video>` without `<track kind="descriptions">` |
| 1.4.2 | Audio Control | Partial — detect `<audio autoplay>` |
| 1.4.5 | Images of Text | Partial — unreliable without vision model |
| 2.2.2 | Pause, Stop, Hide | Partial — detect `<marquee>`, CSS `animation` on non-decorative elements |
| 2.3.1 | Three Flashes or Below Threshold | No — requires pixel-level video analysis |
| 3.2.2 | On Input | Partial — DOM mutation on `<select>` change |
| 3.2.3 | Consistent Navigation | No — requires multi-page comparison |
| 3.2.4 | Consistent Identification | No — requires multi-page comparison |
| 3.3.3 | Error Suggestion | Partial — check `aria-describedby` on `aria-invalid` fields |
| 3.3.4 | Error Prevention (Legal) | No — domain-specific, manual only |

All 11 appear as `Not Evaluated` in VPAT Chapter 2.

**Additional SCs missing for WCAG 2.1 AA (ADA, EN 301 549):**

| SC | Name | Automatable? |
|---|---|---|
| 2.1.4 | Character Key Shortcuts | Partial — detect `keydown` without modifier key check |
| 2.5.2 | Pointer Cancellation | Partial — detect `mousedown` without cancel path |
| 2.5.4 | Motion Actuation | Partial — detect `DeviceMotion` events without alternative |
| 4.1.3 | Status Messages | Partial — detect `aria-live` on dynamic content |

**WCAG 2.2 SCs already in WCAGMap** (`2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8`): exclude from all three main conformance tables. Include only as an optional appendix labeled "WCAG 2.2 Observations."

---

## Conformance Level Vocabulary

This vocabulary is exact and non-negotiable in VPAT/ACR format:

| Level | Meaning |
|---|---|
| `Supports` | Zero violations, at least one passing element |
| `Partially Supports` | Violations exist but `FailureRate < 0.5` |
| `Does Not Support` | `FailureRate >= 0.5` or no passing elements |
| `Not Applicable` | Criterion structurally inapplicable (hardware criteria for web product; WCAG 2.1 SCs in 508 chapter) |
| `Not Evaluated` | SC exists in standard but scanner has no rule, or requires manual-only testing |

**Critical distinction:** `Not Evaluated` and `Not Applicable` are not interchangeable. Your 11+ missing SCs must always appear as `Not Evaluated` — they exist in the standard but your scanner cannot test them. `Not Applicable` is reserved for criteria that structurally cannot apply. Conflating these is the most common ACR quality failure and causes federal/EU procurement rejections.

---

## Phase 1: Shared Foundation

**Estimate: 3–4 days. All subsequent phases depend on this.**

### 1.1 New File: `internal/models/conformance.go`

```go
package models

import "time"

type ConformanceLevel string

const (
    ConformanceSupports          ConformanceLevel = "Supports"
    ConformancePartiallySupports ConformanceLevel = "Partially Supports"
    ConformanceDoesNotSupport    ConformanceLevel = "Does Not Support"
    ConformanceNotApplicable     ConformanceLevel = "Not Applicable"
    ConformanceNotEvaluated      ConformanceLevel = "Not Evaluated"
)

// SCConformanceRow is the common intermediate representation for one SC row.
// All three formatters (ADA, VPAT, EN 301 549) consume this type.
type SCConformanceRow struct {
    SCID                  string           `json:"sc_id"`
    SCName                string           `json:"sc_name"`
    Level                 string           `json:"level"`                    // "A" | "AA"
    WCAGVersion           string           `json:"wcag_version"`             // "2.0" | "2.1" | "2.2"
    EN301549Clause        string           `json:"en301549_clause,omitempty"` // e.g. "9.1.1.1"
    Conformance           ConformanceLevel `json:"conformance"`
    Remarks               string           `json:"remarks"`
    ManualTestingRequired bool             `json:"manual_testing_required"`
    SCScore               *SCScore         `json:"sc_score,omitempty"` // nil for N/A and Not Evaluated rows
}

// ReportMeta holds product/vendor metadata for VPAT and EN 301 549 headers.
type ReportMeta struct {
    ProductName    string `json:"product_name"`
    VendorName     string `json:"vendor_name"`
    ProductVersion string `json:"product_version,omitempty"`
    ContactInfo    string `json:"contact_info,omitempty"`
    Notes          string `json:"notes,omitempty"`
}

// ComplianceReport is the intermediate representation consumed by all report formatters.
// BuildComplianceReport in internal/scoring/score.go produces this from a ScanResult.
type ComplianceReport struct {
    URL         string             `json:"url"`
    ScannedAt   time.Time          `json:"scanned_at"`
    Standard    string             `json:"standard"`    // "ADA" | "508" | "EN301549"
    WCAGLevel   string             `json:"wcag_level"`  // "A" | "AA"
    ReportDate  string             `json:"report_date"` // "2006-01-02"
    Meta        ReportMeta         `json:"meta"`
    Rows        []SCConformanceRow `json:"rows"`
    // Aggregate counts
    TotalSCs      int `json:"total_scs"`
    SupportsCount int `json:"supports"`
    PartialCount  int `json:"partially_supports"`
    FailCount     int `json:"does_not_support"`
    NotEvalCount  int `json:"not_evaluated"`
    NotApplCount  int `json:"not_applicable"`
}
```

### 1.2 New File: `internal/models/sc_registry.go`

This is the authoritative SC metadata table — separate from `wcag_mapping.go` (which maps rule IDs to SC IDs). Every formatter reads from this registry for SC names, WCAG version, EN 301 549 clause numbers, and narrative templates. Target: **54 entries** — 43 covered SCs + 11 not-automatable SCs.

The `SupportNarrative` / `PartialNarrative` / `FailureNarrative` strings flow directly into the Remarks column of every VPAT and EN 301 549 row. Per-SC narratives that describe what was specifically tested are the key differentiator between a useful ACR and a rejected boilerplate one.

```go
package models

type SCMetadata struct {
    SCID                  string
    SCName                string
    Level                 string // "A" | "AA"
    WCAGVersion           string // "2.0" | "2.1" | "2.2"
    EN301549Clause        string // "9.x.x.x"; empty for non-web clauses
    SupportNarrative      string // Remarks text when Conformance == Supports
    PartialNarrative      string // Remarks text when Conformance == PartiallySupports
    FailureNarrative      string // Remarks text when Conformance == DoesNotSupport
    LimitationNote        string // Always appended; describes automation limits
    ManualTestingRequired bool
    NotAutomatable        bool   // true = always NotEvaluated; no rule can exist
}

var SCRegistry = map[string]SCMetadata{
    "1.1.1": {
        SCID: "1.1.1", SCName: "Non-text Content", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.1.1.1",
        SupportNarrative: "Automated testing checked all img, input[type=image], and icon elements for programmatic text alternatives. All tested elements passed.",
        PartialNarrative: "Some images or interactive elements are missing text alternatives. See violation details for affected elements.",
        FailureNarrative: "A majority of tested elements lack adequate text alternatives, representing a significant barrier for screen reader users.",
        LimitationNote:   "Complex images (charts, infographics) require manual review to verify that alternative text is accurate and meaningful. CAPTCHA alternatives require manual evaluation.",
        ManualTestingRequired: true,
    },
    "1.2.1": {
        SCID: "1.2.1", SCName: "Audio-only and Video-only (Prerecorded)", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.1.2.1",
        SupportNarrative: "Automated testing detected prerecorded audio/video elements and verified the presence of text transcripts or audio descriptions.",
        PartialNarrative: "Some prerecorded media elements lack accompanying text alternatives.",
        FailureNarrative: "Prerecorded media lacks required text alternatives.",
        LimitationNote:   "Automated testing can detect presence of transcripts but cannot verify their accuracy or completeness.",
        ManualTestingRequired: true,
    },
    "1.2.2": {
        SCID: "1.2.2", SCName: "Captions (Prerecorded)", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.1.2.2",
        SupportNarrative: "All detected video elements include caption tracks with valid source and language attributes.",
        PartialNarrative: "Some video elements are missing caption tracks or have incomplete track attributes.",
        FailureNarrative: "Most video elements lack caption tracks, preventing access for deaf and hard-of-hearing users.",
        LimitationNote:   "Automated testing verifies presence and attributes of <track kind=\"captions\"> elements but cannot verify caption timing accuracy or synchronization.",
        ManualTestingRequired: true,
    },
    "1.2.3": {
        SCID: "1.2.3", SCName: "Audio Description or Media Alternative (Prerecorded)", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.1.2.3",
        LimitationNote: "Requires manual evaluation to verify that a media alternative or audio description is present and adequate.",
        NotAutomatable: true,
    },
    "1.2.4": {
        SCID: "1.2.4", SCName: "Captions (Live)", Level: "AA", WCAGVersion: "2.0",
        EN301549Clause: "9.1.2.4",
        LimitationNote: "Live captions cannot be evaluated by automated scanning. Manual testing is required during live broadcasts or streaming events.",
        NotAutomatable: true,
    },
    "1.2.5": {
        SCID: "1.2.5", SCName: "Audio Description (Prerecorded)", Level: "AA", WCAGVersion: "2.0",
        EN301549Clause: "9.1.2.5",
        SupportNarrative: "Automated testing detected video elements and verified the presence of audio description tracks.",
        PartialNarrative: "Some video elements lack audio description tracks.",
        FailureNarrative: "Video elements lack audio description tracks.",
        LimitationNote:   "Automated testing detects presence of <track kind=\"descriptions\"> but cannot verify audio description quality or completeness.",
        ManualTestingRequired: true,
    },
    "1.3.1": {
        SCID: "1.3.1", SCName: "Info and Relationships", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.1.3.1",
        SupportNarrative: "Automated testing verified landmark structure, form label associations, list semantics, heading hierarchy, table markup, and ARIA role usage.",
        PartialNarrative: "Some interface elements convey structure through visual presentation alone without programmatic equivalents.",
        FailureNarrative: "Significant structural information is conveyed through visual presentation without programmatic markup.",
        LimitationNote:   "CSS-only layout patterns and complex data tables require manual verification.",
        ManualTestingRequired: true,
    },
    "1.3.2": {
        SCID: "1.3.2", SCName: "Meaningful Sequence", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.1.3.2",
        SupportNarrative: "DOM order and reading sequence appear programmatically correct.",
        PartialNarrative: "Some content may be presented in a reading order that differs from visual order.",
        FailureNarrative: "Content reading sequence is not correctly programmatically determinable.",
        LimitationNote:   "Complex layout patterns require manual screen reader verification.",
        ManualTestingRequired: true,
    },
    "1.3.3": {
        SCID: "1.3.3", SCName: "Sensory Characteristics", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.1.3.3",
        SupportNarrative: "Instructions do not rely solely on sensory characteristics.",
        PartialNarrative: "Some instructions may rely solely on shape, size, color, or spatial location.",
        FailureNarrative: "Instructions rely solely on sensory characteristics without text alternatives.",
        LimitationNote:   "Requires manual review of instructional content.",
        ManualTestingRequired: true,
    },
    "1.3.4": {
        SCID: "1.3.4", SCName: "Orientation", Level: "AA", WCAGVersion: "2.1",
        EN301549Clause: "9.1.3.4",
        SupportNarrative: "No orientation lock detected in CSS or JavaScript event handlers.",
        PartialNarrative: "Orientation restrictions were detected in some contexts.",
        FailureNarrative: "Content restricts display to a single orientation.",
        LimitationNote:   "Dynamic orientation locking triggered by specific interactions requires manual device testing.",
        ManualTestingRequired: true,
    },
    "1.3.5": {
        SCID: "1.3.5", SCName: "Identify Input Purpose", Level: "AA", WCAGVersion: "2.1",
        EN301549Clause: "9.1.3.5",
        SupportNarrative: "Form inputs use appropriate autocomplete attribute values.",
        PartialNarrative: "Some form inputs are missing appropriate autocomplete attributes.",
        FailureNarrative: "Form inputs lack autocomplete attributes that would allow browsers to auto-fill personal data.",
        LimitationNote:   "Effectiveness of autocomplete tokens requires testing with browser autofill tools.",
        ManualTestingRequired: false,
    },
    "1.4.1": {
        SCID: "1.4.1", SCName: "Use of Color", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.1.4.1",
        SupportNarrative: "No instances detected where color is the sole visual indicator of information.",
        PartialNarrative: "Some elements may rely on color alone to convey information.",
        FailureNarrative: "Color is used as the sole visual means of conveying information.",
        LimitationNote:   "Complex charts, graphs, and custom UI patterns require manual review.",
        ManualTestingRequired: true,
    },
    "1.4.2": {
        SCID: "1.4.2", SCName: "Audio Control", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.1.4.2",
        SupportNarrative: "No auto-playing audio detected.",
        PartialNarrative: "Some auto-playing audio detected; control mechanism availability requires manual verification.",
        FailureNarrative: "Auto-playing audio present without a mechanism to pause, stop, or control volume.",
        LimitationNote:   "Detection of auto-playing audio is heuristic and may not catch all cases. Manual testing recommended.",
        ManualTestingRequired: true,
    },
    "1.4.3": {
        SCID: "1.4.3", SCName: "Contrast (Minimum)", Level: "AA", WCAGVersion: "2.0",
        EN301549Clause: "9.1.4.3",
        SupportNarrative: "All tested text elements meet the 4.5:1 contrast ratio requirement (3:1 for large text).",
        PartialNarrative: "Some text elements fail the minimum contrast ratio. See violation details.",
        FailureNarrative: "Widespread contrast failures detected. Text readability is significantly impacted for low-vision users.",
        LimitationNote:   "Contrast of text rendered on dynamic or image backgrounds requires manual evaluation. Semi-transparent overlays may not be detected.",
        ManualTestingRequired: true,
    },
    "1.4.4": {
        SCID: "1.4.4", SCName: "Resize Text", Level: "AA", WCAGVersion: "2.0",
        EN301549Clause: "9.1.4.4",
        SupportNarrative: "No CSS preventing text scaling detected.",
        PartialNarrative: "Some CSS may restrict text resizing.",
        FailureNarrative: "CSS detected that prevents text from scaling up to 200% without loss of content or functionality.",
        LimitationNote:   "Text resize behavior at 200% requires manual browser testing.",
        ManualTestingRequired: true,
    },
    "1.4.5": {
        SCID: "1.4.5", SCName: "Images of Text", Level: "AA", WCAGVersion: "2.0",
        EN301549Clause: "9.1.4.5",
        LimitationNote: "Detecting images that contain text requires visual analysis not achievable by DOM inspection alone. Manual review required.",
        NotAutomatable: true,
    },
    "1.4.10": {
        SCID: "1.4.10", SCName: "Reflow", Level: "AA", WCAGVersion: "2.1",
        EN301549Clause: "9.1.4.10",
        SupportNarrative: "No CSS preventing content reflow at 320px width detected.",
        PartialNarrative: "Some layout patterns may cause horizontal scrolling at 320px equivalent width.",
        FailureNarrative: "Horizontal scrolling is required at 320px CSS width, preventing access for users relying on reflow.",
        LimitationNote:   "Reflow testing requires manual verification at 320px CSS width.",
        ManualTestingRequired: true,
    },
    "1.4.11": {
        SCID: "1.4.11", SCName: "Non-text Contrast", Level: "AA", WCAGVersion: "2.1",
        EN301549Clause: "9.1.4.11",
        SupportNarrative: "UI component boundaries and graphical objects meet the 3:1 contrast ratio.",
        PartialNarrative: "Some UI components or graphical objects do not meet the 3:1 contrast ratio.",
        FailureNarrative: "Widespread non-text contrast failures detected.",
        LimitationNote:   "Focus indicators and complex graphical objects require manual contrast evaluation.",
        ManualTestingRequired: true,
    },
    "1.4.12": {
        SCID: "1.4.12", SCName: "Text Spacing", Level: "AA", WCAGVersion: "2.1",
        EN301549Clause: "9.1.4.12",
        SupportNarrative: "No CSS that prevents text spacing overrides detected.",
        PartialNarrative: "Some CSS may cause layout breakage when text spacing properties are applied.",
        FailureNarrative: "CSS prevents content and functionality from being accessible when text spacing properties are overridden.",
        LimitationNote:   "Requires manual testing by applying the text spacing bookmarklet.",
        ManualTestingRequired: true,
    },
    "1.4.13": {
        SCID: "1.4.13", SCName: "Content on Hover or Focus", Level: "AA", WCAGVersion: "2.1",
        EN301549Clause: "9.1.4.13",
        SupportNarrative: "Hover and focus-triggered content is dismissible, hoverable, and persistent.",
        PartialNarrative: "Some hover or focus-triggered content may not meet all three requirements.",
        FailureNarrative: "Hover or focus-triggered content cannot be dismissed, hovered over, or persists only briefly.",
        LimitationNote:   "Requires manual interaction testing with keyboard and mouse.",
        ManualTestingRequired: true,
    },
    "2.1.1": {
        SCID: "2.1.1", SCName: "Keyboard", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.2.1.1",
        SupportNarrative: "All interactive elements are keyboard accessible.",
        PartialNarrative: "Some interactive functionality is not fully keyboard accessible.",
        FailureNarrative: "Keyboard-only users cannot access significant functionality.",
        LimitationNote:   "Complete keyboard navigation testing requires manual keyboard-only interaction across all interactive features.",
        ManualTestingRequired: true,
    },
    "2.1.2": {
        SCID: "2.1.2", SCName: "No Keyboard Trap", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.2.1.2",
        SupportNarrative: "No keyboard traps detected in automated testing.",
        PartialNarrative: "Potential keyboard traps detected in some components.",
        FailureNarrative: "Keyboard trap(s) detected that prevent users from navigating away from a component.",
        LimitationNote:   "Keyboard trap detection requires manual keyboard testing of modal dialogs, date pickers, and custom widgets.",
        ManualTestingRequired: true,
    },
    "2.1.4": {
        SCID: "2.1.4", SCName: "Character Key Shortcuts", Level: "A", WCAGVersion: "2.1",
        EN301549Clause: "9.2.1.4",
        SupportNarrative: "No single-character keyboard shortcuts detected without modifier key alternatives.",
        PartialNarrative: "Some single-character keyboard shortcuts detected; remapping or disabling options require manual verification.",
        FailureNarrative: "Single-character keyboard shortcuts implemented without mechanism to remap or disable them.",
        LimitationNote:   "Requires manual testing to verify shortcut remapping functionality.",
        ManualTestingRequired: true,
    },
    "2.2.1": {
        SCID: "2.2.1", SCName: "Timing Adjustable", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.2.2.1",
        LimitationNote: "Detecting time limits and evaluating adjustment mechanisms requires manual testing during user session interactions.",
        NotAutomatable: true,
    },
    "2.2.2": {
        SCID: "2.2.2", SCName: "Pause, Stop, Hide", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.2.2.2",
        LimitationNote: "Detecting moving, blinking, or scrolling content and verifying pause controls requires manual testing.",
        NotAutomatable: true,
    },
    "2.3.1": {
        SCID: "2.3.1", SCName: "Three Flashes or Below Threshold", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.2.3.1",
        LimitationNote: "Requires specialized photosensitivity analysis tools. Automated DOM scanning cannot evaluate flash rate or duration.",
        NotAutomatable: true,
    },
    "2.4.1": {
        SCID: "2.4.1", SCName: "Bypass Blocks", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.2.4.1",
        SupportNarrative: "Skip navigation links or ARIA landmark regions are present, enabling users to bypass repetitive content.",
        PartialNarrative: "Bypass mechanisms exist but may be inconsistently implemented.",
        FailureNarrative: "No bypass mechanism detected; keyboard-only users must tab through all navigation on every page.",
        LimitationNote:   "Effectiveness of bypass mechanisms requires manual keyboard testing.",
        ManualTestingRequired: true,
    },
    "2.4.2": {
        SCID: "2.4.2", SCName: "Page Titled", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.2.4.2",
        SupportNarrative: "Page has a descriptive <title> element.",
        PartialNarrative: "Page title is present but may not adequately describe the page topic or purpose.",
        FailureNarrative: "Page is missing a <title> element or has an empty title.",
        LimitationNote:   "Title adequacy (whether it describes topic and purpose) requires manual review.",
        ManualTestingRequired: false,
    },
    "2.4.3": {
        SCID: "2.4.3", SCName: "Focus Order", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.2.4.3",
        SupportNarrative: "Focus order appears to preserve meaning and operability.",
        PartialNarrative: "Focus order may be disrupted in some sections.",
        FailureNarrative: "Focus order does not preserve meaning and operability.",
        LimitationNote:   "Complete focus order evaluation requires manual keyboard navigation testing.",
        ManualTestingRequired: true,
    },
    "2.4.4": {
        SCID: "2.4.4", SCName: "Link Purpose (In Context)", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.2.4.4",
        SupportNarrative: "All links have accessible names that describe their purpose.",
        PartialNarrative: "Some links have ambiguous names (e.g., 'click here', 'read more') without sufficient context.",
        FailureNarrative: "Many links lack accessible names or have ambiguous names without context.",
        LimitationNote:   "Contextual link purpose evaluation requires manual review of surrounding content.",
        ManualTestingRequired: true,
    },
    "2.4.5": {
        SCID: "2.4.5", SCName: "Multiple Ways", Level: "AA", WCAGVersion: "2.0",
        EN301549Clause: "9.2.4.5",
        LimitationNote: "Multiple means of navigation (search, site map, related links) require multi-page manual evaluation.",
        NotAutomatable: true,
    },
    "2.4.6": {
        SCID: "2.4.6", SCName: "Headings and Labels", Level: "AA", WCAGVersion: "2.0",
        EN301549Clause: "9.2.4.6",
        SupportNarrative: "Headings and form labels appear descriptive.",
        PartialNarrative: "Some headings or labels may not adequately describe topic or purpose.",
        FailureNarrative: "Headings or labels are missing or do not describe topic or purpose.",
        LimitationNote:   "Meaningfulness of heading and label text requires manual content review.",
        ManualTestingRequired: true,
    },
    "2.4.7": {
        SCID: "2.4.7", SCName: "Focus Visible", Level: "AA", WCAGVersion: "2.0",
        EN301549Clause: "9.2.4.7",
        SupportNarrative: "Keyboard focus indicators are visible on interactive elements.",
        PartialNarrative: "Focus indicators are absent or insufficient on some interactive elements.",
        FailureNarrative: "No visible keyboard focus indicators detected on interactive elements.",
        LimitationNote:   "Focus visibility testing requires manual keyboard navigation. CSS :focus styles may be overridden by OS themes.",
        ManualTestingRequired: true,
    },
    "2.5.1": {
        SCID: "2.5.1", SCName: "Pointer Gestures", Level: "A", WCAGVersion: "2.1",
        EN301549Clause: "9.2.5.1",
        SupportNarrative: "Multi-point and path-based gestures have single-pointer alternatives.",
        PartialNarrative: "Some multi-point or path-based gesture functionality lacks single-pointer alternatives.",
        FailureNarrative: "Functionality requiring multi-point or path-based gestures lacks alternatives.",
        LimitationNote:   "Gesture detection is heuristic. Manual testing on touch devices required.",
        ManualTestingRequired: true,
    },
    "2.5.2": {
        SCID: "2.5.2", SCName: "Pointer Cancellation", Level: "A", WCAGVersion: "2.1",
        EN301549Clause: "9.2.5.2",
        SupportNarrative: "No instances of activation on down-event without cancellation mechanism detected.",
        PartialNarrative: "Some interactions activate on down-event without a cancellation mechanism.",
        FailureNarrative: "Interactions activate on down-event and cannot be cancelled.",
        LimitationNote:   "Complete pointer cancellation evaluation requires manual interaction testing.",
        ManualTestingRequired: true,
    },
    "2.5.3": {
        SCID: "2.5.3", SCName: "Label in Name", Level: "A", WCAGVersion: "2.1",
        EN301549Clause: "9.2.5.3",
        SupportNarrative: "Accessible names of labeled controls contain the visible label text.",
        PartialNarrative: "Some controls have accessible names that do not include the visible label text.",
        FailureNarrative: "Controls have accessible names that do not match visible label text, breaking voice control.",
        LimitationNote:   "Label-in-name verification for dynamically generated or styled content may require manual review.",
        ManualTestingRequired: false,
    },
    "2.5.4": {
        SCID: "2.5.4", SCName: "Motion Actuation", Level: "A", WCAGVersion: "2.1",
        EN301549Clause: "9.2.5.4",
        LimitationNote: "Device motion and orientation events require manual testing on physical devices.",
        NotAutomatable: true,
    },
    "3.1.1": {
        SCID: "3.1.1", SCName: "Language of Page", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.3.1.1",
        SupportNarrative: "The html element has a valid lang attribute.",
        PartialNarrative: "The html element is missing a lang attribute or has an invalid language code.",
        FailureNarrative: "The page language is not programmatically determinable.",
        ManualTestingRequired: false,
    },
    "3.1.2": {
        SCID: "3.1.2", SCName: "Language of Parts", Level: "AA", WCAGVersion: "2.0",
        EN301549Clause: "9.3.1.2",
        SupportNarrative: "Content in languages other than the primary page language uses lang attributes.",
        PartialNarrative: "Some multi-language content passages lack lang attributes.",
        FailureNarrative: "Multi-language content does not use lang attributes to identify language changes.",
        LimitationNote:   "Language of parts requires manual review of multilingual content.",
        ManualTestingRequired: true,
    },
    "3.2.1": {
        SCID: "3.2.1", SCName: "On Focus", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.3.2.1",
        SupportNarrative: "No context changes triggered solely by keyboard focus detected.",
        PartialNarrative: "Some focus events may trigger unexpected context changes.",
        FailureNarrative: "Context changes triggered by focus detected.",
        LimitationNote:   "Focus-triggered context changes require manual keyboard navigation testing.",
        ManualTestingRequired: true,
    },
    "3.2.2": {
        SCID: "3.2.2", SCName: "On Input", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.3.2.2",
        LimitationNote: "Input-triggered context changes require manual interaction testing.",
        NotAutomatable: true,
    },
    "3.2.3": {
        SCID: "3.2.3", SCName: "Consistent Navigation", Level: "AA", WCAGVersion: "2.0",
        EN301549Clause: "9.3.2.3",
        LimitationNote: "Requires multi-page manual testing to verify navigation consistency across the site.",
        NotAutomatable: true,
    },
    "3.2.4": {
        SCID: "3.2.4", SCName: "Consistent Identification", Level: "AA", WCAGVersion: "2.0",
        EN301549Clause: "9.3.2.4",
        LimitationNote: "Requires multi-page manual testing to verify consistent labeling of identical functionality.",
        NotAutomatable: true,
    },
    "3.3.1": {
        SCID: "3.3.1", SCName: "Error Identification", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.3.3.1",
        SupportNarrative: "Form errors are identified in text and describe the item in error.",
        PartialNarrative: "Some form errors may not be programmatically identified or may not describe the error in text.",
        FailureNarrative: "Form errors are not identified in text.",
        LimitationNote:   "Dynamic error states require manual form submission testing.",
        ManualTestingRequired: true,
    },
    "3.3.2": {
        SCID: "3.3.2", SCName: "Labels or Instructions", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.3.3.2",
        SupportNarrative: "Form inputs have associated labels or instructions.",
        PartialNarrative: "Some form inputs lack associated labels or instructions.",
        FailureNarrative: "Form inputs generally lack associated labels or instructions.",
        ManualTestingRequired: false,
    },
    "3.3.3": {
        SCID: "3.3.3", SCName: "Error Suggestion", Level: "AA", WCAGVersion: "2.0",
        EN301549Clause: "9.3.3.3",
        SupportNarrative: "Error messages include suggestions for correction where appropriate.",
        PartialNarrative: "Some error messages do not include suggestions for correction.",
        FailureNarrative: "Error messages generally lack suggestions for correction.",
        LimitationNote:   "Error suggestion adequacy requires manual form interaction testing.",
        ManualTestingRequired: true,
    },
    "3.3.4": {
        SCID: "3.3.4", SCName: "Error Prevention (Legal, Financial, Data)", Level: "AA", WCAGVersion: "2.0",
        EN301549Clause: "9.3.3.4",
        LimitationNote: "Requires manual testing with domain knowledge to verify error prevention mechanisms for consequential actions (purchases, legal submissions, financial transactions).",
        NotAutomatable: true,
    },
    "4.1.1": {
        SCID: "4.1.1", SCName: "Parsing", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.4.1.1",
        SupportNarrative: "HTML parsing errors that affect accessibility were not detected.",
        PartialNarrative: "Some HTML parsing errors detected that may affect assistive technology processing.",
        FailureNarrative: "Significant HTML parsing errors detected that are likely to cause assistive technology failures.",
        ManualTestingRequired: false,
    },
    "4.1.2": {
        SCID: "4.1.2", SCName: "Name, Role, Value", Level: "A", WCAGVersion: "2.0",
        EN301549Clause: "9.4.1.2",
        SupportNarrative: "Automated testing verified ARIA roles, states, properties, and accessible names for interactive components.",
        PartialNarrative: "Some interactive components have missing or incorrect ARIA attributes.",
        FailureNarrative: "A majority of interactive components have ARIA violations, significantly impeding assistive technology users.",
        LimitationNote:   "Dynamic state changes triggered by user interaction require manual testing with assistive technologies.",
        ManualTestingRequired: true,
    },
    "4.1.3": {
        SCID: "4.1.3", SCName: "Status Messages", Level: "AA", WCAGVersion: "2.1",
        EN301549Clause: "9.4.1.3",
        SupportNarrative: "Status messages are implemented using aria-live regions.",
        PartialNarrative: "Some status messages are not conveyed programmatically via ARIA live regions.",
        FailureNarrative: "Status messages are not conveyed to assistive technology users.",
        LimitationNote:   "Dynamic status messages require manual testing with a screen reader to verify announcement timing and content.",
        ManualTestingRequired: true,
    },
}
```

### 1.3 Additions to `internal/scoring/score.go`

Add these functions without modifying existing scorers:

```go
// conformanceLevelForSC maps SCScore data to a conformance level.
// Pass hasRule=false if no rule in WCAGMap covers this SC.
func conformanceLevelForSC(scID string, sc models.SCScore, hasRule bool) models.ConformanceLevel {
    if !hasRule || sc.TestedElements == 0 {
        return models.ConformanceNotEvaluated
    }
    if sc.FailedElements == 0 {
        return models.ConformanceSupports
    }
    if sc.FailureRate < 0.5 {
        return models.ConformancePartiallySupports
    }
    return models.ConformanceDoesNotSupport
}

// narrativeForConformance picks the correct template string from SCMetadata.
func narrativeForConformance(m models.SCMetadata, c models.ConformanceLevel) string {
    switch c {
    case models.ConformanceSupports:          return m.SupportNarrative
    case models.ConformancePartiallySupports: return m.PartialNarrative
    case models.ConformanceDoesNotSupport:    return m.FailureNarrative
    default:                                  return ""
    }
}

// scIDLess sorts "1.1.1" < "1.2.1" < "2.4.1" numerically by dot-separated parts.
func scIDLess(a, b string) bool {
    pa := strings.Split(a, ".")
    pb := strings.Split(b, ".")
    for i := 0; i < len(pa) && i < len(pb); i++ {
        na, _ := strconv.Atoi(pa[i])
        nb, _ := strconv.Atoi(pb[i])
        if na != nb {
            return na < nb
        }
    }
    return len(pa) < len(pb)
}

// BuildComplianceReport constructs a ComplianceReport from a completed ScanResult.
// standard must be "ADA", "508", or "EN301549".
// Runs CalculateAudioEye internally if result.AudioEye is nil.
func BuildComplianceReport(
    result *models.ScanResult,
    standard string,
    meta models.ReportMeta,
) (*models.ComplianceReport, error) {
    ae := result.AudioEye
    if ae == nil {
        aeResult := CalculateAudioEye(result.Violations, result.PassRules, models.WCAGMap)
        ae = &aeResult
    }

    // Build set of SCs that have at least one rule in WCAGMap.
    scHasRule := map[string]bool{}
    for _, scs := range models.WCAGMap {
        for _, sc := range scs {
            scHasRule[sc] = true
        }
    }

    report := &models.ComplianceReport{
        URL: result.URL, ScannedAt: result.ScannedAt,
        Standard: standard, WCAGLevel: result.Summary.WCAGLevel,
        ReportDate: result.ScannedAt.Format("2006-01-02"), Meta: meta,
    }

    for scID, scMeta := range models.SCRegistry {
        // WCAG 2.2 excluded from all three main conformance tables.
        if scMeta.WCAGVersion == "2.2" {
            continue
        }

        // 508 only covers WCAG 2.0. WCAG 2.1-only SCs → Not Applicable in 508 mode.
        if standard == "508" && scMeta.WCAGVersion != "2.0" {
            row := models.SCConformanceRow{
                SCID: scID, SCName: scMeta.SCName, Level: scMeta.Level,
                WCAGVersion: scMeta.WCAGVersion, EN301549Clause: scMeta.EN301549Clause,
                Conformance: models.ConformanceNotApplicable,
                Remarks: "This criterion was introduced in WCAG 2.1. Section 508 (2017 refresh) references WCAG 2.0 and does not require this criterion.",
            }
            report.Rows = append(report.Rows, row)
            report.NotApplCount++
            continue
        }

        scScore, hasSCData := ae.SCBreakdown[scID]
        hasRule := scHasRule[scID]

        var conformance models.ConformanceLevel
        var remarks string

        if scMeta.NotAutomatable {
            conformance = models.ConformanceNotEvaluated
            remarks = scMeta.LimitationNote
        } else {
            conformance = conformanceLevelForSC(scID, scScore, hasRule)
            remarks = narrativeForConformance(scMeta, conformance)
            if scMeta.LimitationNote != "" {
                remarks += " " + scMeta.LimitationNote
            }
        }

        var scorePtr *models.SCScore
        if hasSCData {
            s := scScore
            scorePtr = &s
        }

        row := models.SCConformanceRow{
            SCID: scID, SCName: scMeta.SCName, Level: scMeta.Level,
            WCAGVersion: scMeta.WCAGVersion, EN301549Clause: scMeta.EN301549Clause,
            Conformance: conformance, Remarks: remarks,
            ManualTestingRequired: scMeta.ManualTestingRequired,
            SCScore: scorePtr,
        }
        report.Rows = append(report.Rows, row)

        switch conformance {
        case models.ConformanceSupports:           report.SupportsCount++
        case models.ConformancePartiallySupports:  report.PartialCount++
        case models.ConformanceDoesNotSupport:     report.FailCount++
        case models.ConformanceNotEvaluated:       report.NotEvalCount++
        case models.ConformanceNotApplicable:      report.NotApplCount++
        }
    }

    sort.Slice(report.Rows, func(i, j int) bool {
        return scIDLess(report.Rows[i].SCID, report.Rows[j].SCID)
    })
    report.TotalSCs = len(report.Rows)
    return report, nil
}
```

---

## Phase 2: ADA Report Generator

**Estimate: 2–3 days. Can start after Phase 1 types are defined.**

### Standards Context

ADA Title III has no enacted technical web rule as of 2026. Federal courts uniformly apply WCAG 2.1 AA (*Robles v. Domino's Pizza*, 9th Cir. 2019; DOJ guidance). Courts evaluate "meaningful access" — whether a disabled user can complete primary tasks — not technical perfection. The ADA report frames violations by whether they constitute barriers to task completion, not just technical counts.

### New File: `internal/report/ada_report.go`

```go
package report

import (
    "bytes"
    "html/template"
    "time"

    "github.com/webaccessibility/server/internal/models"
)

type ADAOptions struct {
    Format string            // "html" (default) | "pdf"
    Meta   models.ReportMeta
}

// ADABarrier is a critical or serious violation classified as a potential ADA barrier.
type ADABarrier struct {
    RuleID      string
    Description string
    Impact      string   // "critical" | "serious"
    SCIDs       []string // WCAG SCs this violation maps to
    NodeCount   int
    HelpURL     string
    LegalRisk   string   // "High" (critical) | "Medium" (serious)
    FixSummary  string   // from DevSuggestion if available
}

// ADAReport holds the generated ADA compliance report.
type ADAReport struct {
    HTML string
    PDF  []byte // non-nil only when ADAOptions.Format == "pdf"
}

// GenerateADA produces an ADA compliance report from a completed ScanResult.
// Does not re-scan — call Scanner.Scan first, then pass the ScanResult here.
func GenerateADA(result *models.ScanResult, opts ADAOptions) (*ADAReport, error)

// classifyBarriers splits violations into ADA barriers (critical/serious impact = potential
// barriers to meaningful access) and best-practice items (moderate/minor).
func classifyBarriers(violations []models.Violation) (barriers []ADABarrier, bestPractice []models.Violation)

// adaRiskTier returns "High" for critical, "Medium" for serious.
func adaRiskTier(impact string) string

// adaRiskBanner returns "HIGH" | "MODERATE" | "LOW" for the executive summary.
// HIGH if any critical violations; MODERATE if serious-only; LOW if none.
func adaRiskBanner(barriers []ADABarrier) string
```

### HTML Template Structure

```
1. Header
   - Report type: "ADA Title III Accessibility Assessment"
   - URL scanned, scan date, report generation date

2. Executive Summary (prominent card)
   - Accessibility score + grade (from Summary.Score, Summary.Grade)
   - Total barriers (critical + serious violations only)
   - Risk banner: HIGH / MODERATE / LOW
   - Plain-English sentence:
     "This automated scan identified N potential access barriers on [URL]
      that may constitute ADA Title III violations under the 'meaningful
      access' standard established by Robles v. Domino's Pizza (9th Cir. 2019)."

3. Access Barrier Table (critical + serious violations only)
   Columns: WCAG SC | Violation | Impact | Affected Elements | ADA Risk | Recommended Fix
   - DevSuggestion.Fix populates the "Recommended Fix" column where available

4. Best Practice Recommendations (<details> collapsed by default)
   - Moderate + minor violations grouped by SC
   - Caption: "These items are technical deviations from WCAG 2.1 AA guidelines.
     While generally not the basis for ADA litigation, remediation is recommended
     as a defense-in-depth measure."

5. Scope Disclosure
   "This assessment covers [URL] scanned at [timestamp] at depth [depth].
    Compliance of untested pages, dynamic content loaded after interaction,
    and pages behind authentication is not represented."

6. Legal Disclaimer (mandatory, prominently boxed)
   See legal disclaimer text below.
```

### New Handler

In `internal/api/handler.go`:

```go
// ReportADA handles POST /api/v1/report/ada.
func (h *Handler) ReportADA(w http.ResponseWriter, r *http.Request) {
    var req struct {
        URL       string            `json:"url"`
        WCAGLevel string            `json:"wcag_level,omitempty"` // default "AA"
        Format    string            `json:"format,omitempty"`     // "html" | "pdf"
        Meta      models.ReportMeta `json:"meta,omitempty"`
    }
    // decode → SSRF check (reuse existing isPrivateURL) → scan → GenerateADA → respond
    // PDF: w.Header().Set("Content-Type", "application/pdf")
    //      w.Header().Set("Content-Disposition", "attachment; filename=\"ada-report.pdf\"")
    // HTML: writeJSON(w, 200, map[string]any{"html": ..., "generated_at": ..., "url": ...})
}
```

In `internal/api/router.go`, inside the rate-limited+JWT group:

```go
r.Post("/report/ada", h.ReportADA)
```

---

## Phase 3: VPAT / Section 508 Generator

**Estimate: 3–4 days. Runs in parallel with Phase 4 after Phase 1.**

### VPAT Background

The VPAT (Voluntary Product Accessibility Template) is the blank ITI template. A filled-out VPAT is formally called an **ACR (Accessibility Conformance Report)**. Federal agencies require VPATs under FAR clause 52.239-2 (derived from Section 508 of the Rehabilitation Act). A missing or boilerplate ACR disqualifies vendors from federal procurement consideration.

**Generate INT edition by default** — it satisfies all audiences from one document:

| Edition | Covers |
|---|---|
| `508` | WCAG 2.0 A/AA only |
| `WCAG` | WCAG 2.1 A/AA |
| `EU` | EN 301 549 |
| `INT` | All three combined (recommended default) |

### New File: `internal/report/vpat_generator.go`

```go
package report

type VPATEdition string

const (
    VPATEdition508  VPATEdition = "508"
    VPATEditionWCAG VPATEdition = "WCAG"
    VPATEditionEU   VPATEdition = "EU"
    VPATEditionINT  VPATEdition = "INT"
)

type VPATOptions struct {
    Edition VPATEdition // default "INT"
    Format  string      // "html" | "pdf"
}

// GenerateVPAT produces a VPAT conformance report in HTML (and optionally PDF).
// cr must have been built with BuildComplianceReport(result, "508", meta) for 508/INT editions.
func GenerateVPAT(cr *models.ComplianceReport, opts VPATOptions) (html string, pdf []byte, err error)
```

### VPAT HTML Table Structure

```
Chapter 1: Product Information (static metadata from ReportMeta + scan metadata)
  Vendor Name | Product Name | Version | Report Date | Evaluation Methods
  Evaluation Methods: "Automated scanning using axe-core [version] + Puppeteer [version]
  + custom WCAG 2.x rule implementations. Scan performed [date] against [URL]."

Chapter 2: Applicable Technical Standards
  Section A: WCAG 2.x Success Criteria
    Columns: [Criteria] [Conformance Level] [Remarks and Explanations]
    One <tr> per SCConformanceRow, sorted by SCID
    INT edition: additional [EN 301 549 Clause] column

Chapter 3: Functional Performance Criteria (9 rows — all "Not Evaluated")
  See VPAT508Chapter3Rows in vpat_static.go

Chapter 4: Hardware
  All rows: "Not Applicable" — this product is web-based software

Chapter 5: Software
  Most rows: "Not Applicable" for web content
  502.3 (Accessibility Services): "Not Evaluated" — AT interoperability requires manual testing
  503.2 (User Preferences): "Not Evaluated"

Chapter 6: Support Documentation and Services
  All rows: "Not Evaluated" — not within scope of this automated web scan
```

### New File: `internal/report/vpat_static.go`

```go
package report

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
```

### New Handler

```go
// ReportVPAT handles POST /api/v1/report/vpat.
func (h *Handler) ReportVPAT(w http.ResponseWriter, r *http.Request) {
    var req struct {
        URL     string            `json:"url"`
        Edition string            `json:"edition,omitempty"` // "508"|"WCAG"|"EU"|"INT" — default "INT"
        Format  string            `json:"format,omitempty"`  // "html" | "pdf"
        Meta    models.ReportMeta `json:"meta,omitempty"`
    }
    // ...
}
```

```go
r.Post("/report/vpat", h.ReportVPAT)
```

---

## Phase 4: EN 301 549 Generator

**Estimate: 2 days. Runs in parallel with Phase 3 after Phase 1.**

### Standards Context

EN 301 549 v3.2.1 (2021) is the EU harmonized standard for ICT accessibility. The EU Web Accessibility Directive (2016/2102) mandates it for public sector. The European Accessibility Act (2019/882) extends to private sector from June 2025.

**Practical scope for this tool:** Generate Clause 9 fully (WCAG 2.1 A/AA, driven by WCAGMap + scan results), Clause 7.1 partially (if `<video>` elements detected), all other clauses `Not Applicable` or `Not Evaluated` with accurate explanations. This is a complete, honest ACR for web content.

### New File: `internal/report/en301549_generator.go`

```go
package report

import "strings"

type EN301549Options struct {
    Format string // "html" | "pdf"
}

// GenerateEN301549 produces an EN 301 549 v3.2.1 ACR.
// cr must have been built with BuildComplianceReport(result, "EN301549", meta).
// result (the original ScanResult) is also needed for hasVideoContent detection.
func GenerateEN301549(
    cr *models.ComplianceReport,
    result *models.ScanResult,
    opts EN301549Options,
) (html string, pdf []byte, err error)

// hasVideoContent returns true if the scan detected <video> elements via rule IDs.
// Used to determine whether clause 7.1.x rows are evaluable or Not Applicable.
func hasVideoContent(result *models.ScanResult) bool {
    for _, v := range result.Violations {
        if strings.HasPrefix(v.ID, "video-captions") {
            return true
        }
    }
    for _, p := range result.PassRules {
        if strings.HasPrefix(p.ID, "video-captions") {
            return true
        }
    }
    return false
}
```

**Table column set** extends VPAT by adding the EN clause number:

```
| EN 301 549 Clause | Criterion Name       | Conformance Level | Remarks                      |
| 9.1.1.1           | Non-text Content     | Supports          | All tested elements passed.. |
```

`SCConformanceRow.EN301549Clause` (populated from `SCRegistry`) provides the clause number directly.

**Clause 7 video caption handling:**

```go
// Inside GenerateEN301549, before rendering static clauses:
clause71Conformance := models.ConformanceNotApplicable
clause71Remarks := "No video content detected on the scanned page."

if hasVideoContent(result) {
    for _, row := range cr.Rows {
        if row.SCID == "1.2.2" {
            clause71Conformance = row.Conformance
            clause71Remarks = row.Remarks
            break
        }
    }
}
```

### New File: `internal/report/en301549_static.go`

```go
package report

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
```

### New Handler

```go
// ReportEN301549 handles POST /api/v1/report/en301549.
func (h *Handler) ReportEN301549(w http.ResponseWriter, r *http.Request) {
    var req struct {
        URL    string            `json:"url"`
        Format string            `json:"format,omitempty"` // "html" | "pdf"
        Meta   models.ReportMeta `json:"meta,omitempty"`
    }
    // ...
}
```

```go
r.Post("/report/en301549", h.ReportEN301549)
```

---

## Phase 5: PDF Export Infrastructure

**Estimate: 1–2 days. Runs in parallel with Phases 2–4.**

### New File: `scripts/pdf_generator.js`

Separate from `axe_runner.js`. Reads HTML from stdin, writes raw PDF bytes to stdout. Same process-boundary contract as `axe_runner.go`.

```javascript
// scripts/pdf_generator.js
// Input:  stdin — UTF-8 HTML string (terminated by EOF)
// Output: stdout — raw PDF bytes
// Stderr: error messages only

const puppeteer = require('puppeteer');

async function main() {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const html = Buffer.concat(chunks).toString('utf8');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
    });
    await browser.close();
    process.stdout.write(pdf);
}

main().catch(e => {
    process.stderr.write(e.message + '\n');
    process.exit(1);
});
```

### New File: `internal/report/pdf_exporter.go`

```go
package report

import (
    "bytes"
    "context"
    "fmt"
    "os/exec"
    "path/filepath"
    "runtime"
    "time"
)

// ExportToPDF converts an HTML string to a PDF byte slice via pdf_generator.js.
func ExportToPDF(html string) ([]byte, error) {
    return ExportToPDFContext(context.Background(), html)
}

// ExportToPDFContext is the context-aware variant with a 60-second timeout.
func ExportToPDFContext(ctx context.Context, html string) ([]byte, error) {
    ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
    defer cancel()

    _, file, _, _ := runtime.Caller(0)
    scriptPath := filepath.Join(filepath.Dir(file), "..", "..", "scripts", "pdf_generator.js")

    cmd := exec.CommandContext(ctx, "node", scriptPath)
    cmd.Stdin = bytes.NewBufferString(html)

    var stdout, stderr bytes.Buffer
    cmd.Stdout = &stdout
    cmd.Stderr = &stderr

    if err := cmd.Run(); err != nil {
        return nil, fmt.Errorf("pdf_generator.js: %w — stderr: %s", err, stderr.String())
    }
    if stdout.Len() == 0 {
        return nil, fmt.Errorf("pdf_generator.js produced no output — stderr: %s", stderr.String())
    }
    return stdout.Bytes(), nil
}
```

---

## API Changes

### New routes in `internal/api/router.go`

Add inside the rate-limited + JWT group:

```go
r.Post("/report/ada",      h.ReportADA)
r.Post("/report/vpat",     h.ReportVPAT)
r.Post("/report/en301549", h.ReportEN301549)
```

All three: JWT required, same 10 req/min rate limit (each triggers a full scan), SSRF-checked via existing `isPrivateURL`.

### `openapi.yaml` additions

Add to paths section:

```yaml
/api/v1/report/ada:
  post:
    summary: Generate ADA Title III accessibility compliance report
    security:
      - bearerAuth: []
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required: [url]
            properties:
              url:        { type: string, format: uri }
              wcag_level: { type: string, enum: [A, AA], default: AA }
              format:     { type: string, enum: [html, pdf], default: html }
              meta:       { $ref: '#/components/schemas/ReportMeta' }
    responses:
      '200':
        description: ADA report
        content:
          application/json:
            schema: { $ref: '#/components/schemas/ADAReportResponse' }
          application/pdf:
            schema: { type: string, format: binary }
      '400': { $ref: '#/components/responses/BadRequest' }
      '401': { $ref: '#/components/responses/Unauthorized' }
      '429': { $ref: '#/components/responses/TooManyRequests' }
      '500': { $ref: '#/components/responses/InternalError' }

/api/v1/report/vpat:
  post:
    summary: Generate VPAT / Section 508 Accessibility Conformance Report
    security:
      - bearerAuth: []
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required: [url]
            properties:
              url:     { type: string, format: uri }
              edition: { type: string, enum: [508, WCAG, EU, INT], default: INT }
              format:  { type: string, enum: [html, pdf], default: html }
              meta:    { $ref: '#/components/schemas/ReportMeta' }
    responses:
      '200':
        content:
          application/json:
            schema: { $ref: '#/components/schemas/VPATReportResponse' }
          application/pdf:
            schema: { type: string, format: binary }
      '400': { $ref: '#/components/responses/BadRequest' }
      '401': { $ref: '#/components/responses/Unauthorized' }
      '429': { $ref: '#/components/responses/TooManyRequests' }
      '500': { $ref: '#/components/responses/InternalError' }

/api/v1/report/en301549:
  post:
    summary: Generate EN 301 549 v3.2.1 Accessibility Conformance Report
    security:
      - bearerAuth: []
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required: [url]
            properties:
              url:    { type: string, format: uri }
              format: { type: string, enum: [html, pdf], default: html }
              meta:   { $ref: '#/components/schemas/ReportMeta' }
    responses:
      '200':
        content:
          application/json:
            schema: { $ref: '#/components/schemas/EN301549ReportResponse' }
          application/pdf:
            schema: { type: string, format: binary }
      '400': { $ref: '#/components/responses/BadRequest' }
      '401': { $ref: '#/components/responses/Unauthorized' }
      '429': { $ref: '#/components/responses/TooManyRequests' }
      '500': { $ref: '#/components/responses/InternalError' }
```

Add to `components/schemas`:

```yaml
ReportMeta:
  type: object
  properties:
    product_name:    { type: string }
    vendor_name:     { type: string }
    product_version: { type: string }
    contact_info:    { type: string }
    notes:           { type: string }

SCConformanceRow:
  type: object
  properties:
    sc_id:                   { type: string, example: "1.1.1" }
    sc_name:                 { type: string }
    level:                   { type: string, enum: [A, AA] }
    wcag_version:            { type: string, enum: ["2.0", "2.1", "2.2"] }
    en301549_clause:         { type: string, example: "9.1.1.1" }
    conformance:
      type: string
      enum: [Supports, "Partially Supports", "Does Not Support", "Not Applicable", "Not Evaluated"]
    remarks:                 { type: string }
    manual_testing_required: { type: boolean }

ADAReportResponse:
  type: object
  properties:
    html:         { type: string }
    generated_at: { type: string, format: date-time }
    url:          { type: string }

VPATReportResponse:
  type: object
  properties:
    html:         { type: string }
    edition:      { type: string }
    generated_at: { type: string, format: date-time }

EN301549ReportResponse:
  type: object
  properties:
    html:         { type: string }
    generated_at: { type: string, format: date-time }
```

---

## Legal Disclaimers

These are exact strings to embed in report templates — not advisory text, mandatory copy.

### Baseline Disclaimer (all three reports)

> "This accessibility conformance report was generated using automated scanning tools including axe-core and custom Puppeteer-based checks. Automated analysis detects a subset of accessibility barriers. Issues requiring human judgment — including the adequacy of alternative text descriptions, the logical sequence of content, the functional usability with assistive technologies, and the accessibility of dynamically generated content — were not evaluated. This report covers the URL(s) listed above at the time of scanning and does not represent the accessibility of unscanned pages or future states of the site."

### ADA-Specific Addition

> "This report does not constitute legal advice and does not create an attorney-client relationship. The findings herein represent technical observations made by automated software and should be reviewed with qualified legal counsel. A passing score or absence of detected violations does not guarantee compliance with the Americans with Disabilities Act or any other applicable law."

### VPAT / Section 508-Specific Addition

> "This Accessibility Conformance Report was prepared using automated testing methods. Conformance levels of 'Supports' or 'Partially Supports' reflect automated scan results only and have not been independently verified through manual testing with assistive technologies. Federal agencies are advised to conduct additional testing for mission-critical procurement decisions. This report does not constitute a legally binding representation of product conformance under the Rehabilitation Act of 1973, Section 508."

### EN 301 549-Specific Addition

> "This Accessibility Conformance Report addresses web content as defined in Clause 9 of EN 301 549 v3.2.1 (2021). Clauses 10 (non-web documents), 11 (software), 12 (documentation and support), and 13 (relay services) were not evaluated by this automated scan. For compliance with the EU Web Accessibility Directive (2016/2102) or the European Accessibility Act (2019/882), additional manual evaluation and documentation review may be required."

---

## Cross-Cutting Decisions

**Caching:** No caching for MVP. Report generation from a `ScanResult` is CPU-cheap (< 5 ms); the scan itself is the expensive operation and the rate limiter already throttles that. If needed later: `sync.Map` in `Handler` keyed by `sha256(url + standard + edition + wcag_level)`, 1-hour TTL, implemented in `internal/report/cache.go`.

**PDF responses:** `Content-Type: application/pdf` + `Content-Disposition: attachment; filename="[type]-report.pdf"`. Do not write files to disk — pipe bytes directly to the response writer.

**Pre-existing scan results:** For MVP, always re-scan at report request time. A future v2 can accept an inline `ScanResult` JSON body to skip the scan cost — useful for clients who want all three report types from one scan pass.

**WCAG 2.2 SCs:** Exclude from all three main conformance tables. Include only as an optional `<details>` appendix labeled "WCAG 2.2 Observations (informational)" to surface the existing 2.4.11, 2.5.7, etc. checks without conflating them with the required A/AA criteria.

---

## File Inventory

### New Files

| Path | Contents |
|---|---|
| `internal/models/conformance.go` | `ConformanceLevel`, `SCConformanceRow`, `ComplianceReport`, `ReportMeta` |
| `internal/models/sc_registry.go` | `SCMetadata`, `SCRegistry` (54 entries: 43 covered + 11 not-automatable SCs) |
| `internal/report/ada_report.go` | `GenerateADA`, `ADAOptions`, `ADABarrier`, `classifyBarriers`, `adaRiskBanner` |
| `internal/report/vpat_generator.go` | `GenerateVPAT`, `VPATEdition`, `VPATOptions` |
| `internal/report/vpat_static.go` | `VPAT508Chapter3Rows` through Chapter 6 static rows |
| `internal/report/en301549_generator.go` | `GenerateEN301549`, `EN301549Options`, `hasVideoContent` |
| `internal/report/en301549_static.go` | Static clause rows for chapters 4–8, 10–13 |
| `internal/report/pdf_exporter.go` | `ExportToPDF`, `ExportToPDFContext` |
| `scripts/pdf_generator.js` | Puppeteer HTML → PDF subprocess |

### Modified Files

| Path | Change |
|---|---|
| `internal/models/wcag_mapping.go` | Fix `heading-order` → `"1.3.1"` (do this first) |
| `internal/scoring/score.go` | Add `conformanceLevelForSC`, `BuildComplianceReport`, `narrativeForConformance`, `scIDLess` |
| `internal/api/handler.go` | Add `ReportADA`, `ReportVPAT`, `ReportEN301549` handler methods |
| `internal/api/router.go` | Add three routes to rate-limited+JWT group |
| `openapi.yaml` | Add three path stubs + four component schemas |

---

## Effort Estimates and Schedule

| Phase | Deliverables | Days |
|---|---|---|
| Pre-work | Fix `heading-order` SC mapping | 0.5 |
| Phase 1: Foundation | `sc_registry.go` (54 entries with narratives), `conformance.go`, `BuildComplianceReport` | 3–4 |
| Phase 2: ADA | `ada_report.go`, HTML template, barrier classifier, handler | 2–3 |
| Phase 3: VPAT | `vpat_generator.go`, `vpat_static.go`, HTML template, handler | 3–4 |
| Phase 4: EN 301 549 | `en301549_generator.go`, `en301549_static.go`, handler | 2 |
| Phase 5: PDF | `pdf_generator.js`, `pdf_exporter.go` | 1–2 |
| **Total** | | **12–17 days** |

**Parallelization:** Phases 2, 3, 4, and 5 are independent after Phase 1 types are defined. You can write the HTML templates and static row tables for Phases 3–4 concurrently with Phase 1 development since they don't depend on `BuildComplianceReport` being complete. Realistic schedule for one senior developer: Phase 1 (days 1–4), then Phases 2+3+4+5 in parallel (days 5–9) = approximately **2 weeks wall-clock**.

The largest single investment in Phase 1 — and the biggest product differentiator — is populating all 54 `SCRegistry` entries with accurate, specific narrative text. Per-SC narratives describing what was and was not tested are what cause ACRs to pass federal and EU procurement review rather than get rejected as boilerplate.
