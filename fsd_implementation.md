# FSD Implementation Summary
**Date**: 2026-07-10  
**Reference**: [`fsd.md`](./fsd.md) · [`audit.md`](./audit.md)  
**Scope**: Closes 6 compliance-reporting integrity gaps identified in the FSD, plus subsequent correctness reviews.  
**Engine coverage**: Go backend (engine-agnostic — applies to both axe and native engine paths).

---

## What Was Fixed

| Gap | Description | Status |
|-----|-------------|--------|
| **1** | WCAG 2.2 SCs silently skipped in `BuildComplianceReport` — never appeared in any report | ✅ Fixed |
| **2** | 15 unmapped A/AA SCs rendered with empty remarks (`NotEvaluated` with no explanation) | ✅ Fixed |
| **3** | Compliance % excluded `incomplete` rule count from denominator — overstated pass rate | ✅ Fixed |
| **4** | AudioEye returned `Score:100 / Grade:A` when zero SCs were evaluated — silent overstatement | ✅ Fixed |
| **5** | `processReportRequest` hardcoded WCAG scan level to `"AAA"` regardless of server config | ✅ Fixed |
| **6** | Reports contained no scope metadata — no way to see evaluated SCs, manual-test-required count, or scan level | ✅ Fixed |
| **Correctness** | `NotAutomatable` short-circuit bug fixed so 1.2.3, 2.2.1, 2.4.5 utilize real scan data. | ✅ Fixed |

---

## Files Changed

### Models (`internal/models/`)

| File | Change |
|------|--------|
| [`conformance.go`](./internal/models/conformance.go) | Added `ConformanceTestedInconclusive = "Tested – Inconclusive"` (6th conformance state). Added `ManualTestRequiredCount`, `EvaluatedSCs`, `AudioEyeWarning`, `ScanWCAGLevel`, `TestedInconclusiveCount` to `ComplianceReport`. |
| [`report.go`](./internal/models/report.go) | Added `Warning string` to `AudioEyeResult` for propagating "no SCs evaluated" signal. |
| [`sc_registry.go`](./internal/models/sc_registry.go) | Added **7 WCAG 2.2 entries** (registry now has **57 total**). Flagged all **15 previously-unmapped/silent A/AA SCs** as `NotAutomatable:true` with detailed `LimitationNote` text. |

#### WCAG 2.2 SCRegistry entries added

| SCID | Name | Level | Decision |
|------|------|-------|----------|
| 2.4.11 | Focus Not Obscured (Minimum) | AA | Scores normally |
| 2.4.13 | Focus Appearance | AAA | Scores normally |
| 2.5.7 | Dragging Movements | AA | Scores normally |
| 2.5.8 | Target Size (Minimum) | AA | Scores normally |
| 3.2.6 | Consistent Help | A | `NotAutomatable` — rule always returns incomplete (multi-page check) |
| 3.3.7 | Redundant Entry | A | `NotAutomatable` — rule always returns incomplete (multi-step check) |
| 3.3.8 | Accessible Authentication (Minimum) | AA | Scores normally |

#### Flagged `NotAutomatable:true` (15 total previously-unmapped A/AA SCs)

| SCID | Name | Category | Reason / Limitation |
|------|------|----------|---------------------|
| 1.2.4 | Captions (Live) | Pre-existing | Live audio broadcasts cannot be scanned automatically |
| 1.2.5 | Audio Description (Prerecorded) | Newly Flagged | Requires manual audio quality and descriptive track review |
| 1.4.2 | Audio Control | Newly Flagged | Audio control overlays require session keyboard interaction |
| 1.4.5 | Images of Text | Pre-existing | OCR is heuristic; visual text check is manual |
| 2.1.4 | Character Key Shortcuts | Newly Flagged | Runtime shortcut keys are not detectable in static DOM |
| 2.2.2 | Pause, Stop, Hide | Pre-existing | Motion, blinking elements, and controls are dynamic |
| 2.3.1 | Three Flashes | Pre-existing | Screen refresh flash frequency check is dynamic |
| 2.5.2 | Pointer Cancellation | Newly Flagged | Single-pointer down/up runtime flows are dynamic |
| 2.5.4 | Motion Actuation | Pre-existing | Device tilt/movement events cannot be scanned automatically |
| 3.2.2 | On Input | Pre-existing | Context changing elements must be evaluated manually |
| 3.2.3 | Consistent Navigation | Pre-existing | Repetitive multi-page layout sequence requires manual check |
| 3.2.4 | Consistent Identification | Pre-existing | Component label consistency requires multi-page manual review |
| 3.3.3 | Error Suggestion | Newly Flagged | Validation message adequacy requires manual feedback checks |
| 3.3.4 | Error Prevention | Pre-existing | Legal and transaction rollback logic requires manual audit |
| 4.1.3 | Status Messages | Newly Flagged | Live screen-reader aria announcements require manual audit |

---

### Scoring Engine (`internal/scoring/`)

| File | Change |
|------|--------|
| [`score.go`](./internal/scoring/score.go) | Full rework — see detail below. |
| [`score_audioeye_test.go`](./internal/scoring/score_audioeye_test.go) | Updated `TestCalculateAudioEye_Empty` to expect `Score:0 / Grade:F / Warning` (not `100/A`). |

**`score.go` changes in detail:**

- **`Calculate` signature** — Added `incomplete int` as third parameter; included in the denominator so `compliancePct = passCount / (passCount + violations + incomplete)`.
- **`conformanceLevelForSC`** — Added `hasIncomplete bool` parameter; returns `ConformanceTestedInconclusive` when a rule ran but produced only incomplete results (no element-level data).
- **`CalculateAudioEye` zero guard** — Now returns `Score:0, Grade:"F", Warning:"No success criteria evaluated — result is not a compliance score."` instead of the previous `Score:100, Grade:"A"`.
- **`BuildComplianceReport`** — Removed the `if scMeta.WCAGVersion == "2.2" { continue }` skip. Threads `hasIncomplete` per SC from `result.Incomplete` rule IDs → WCAGMap lookup. Gated `NotAutomatable` short-circuit on `!hasRule` so criteria with working rule mappings (1.2.3, 2.2.1, 2.4.5) correctly evaluate scan data. Populates all new `ComplianceReport` fields. Adds `ConformanceTestedInconclusive` to the aggregate count switch. Extends the 508 `NotApplicable` path to cover both `WCAGVersion == "2.1"` and `"2.2"` with distinct remark strings.

---

### Config & API (`internal/config/`, `internal/api/`, `internal/scanner/`)

| File | Change |
|------|--------|
| [`config.go`](./internal/config/config.go) | Added `GetWCAGLevel()` string getter — returns `"AA"` if config is nil. |
| [`handler.go`](./internal/api/handler.go) | Replaced hardcoded `"AAA"` in `processReportRequest` with `config.GetWCAGLevel()`. Under `ReportADA` (Option A), builds and passes the `ComplianceReport` to `GenerateADA` so the ADA report correctly displays scan scope limitations. |
| [`axe_runner.go`](./internal/scanner/axe_runner.go) | Updated `Calculate` call to pass `len(incompleteIDs)` as the new `incomplete` parameter. |

---

### Report Formatters (`internal/report/`)

New shared helper: [`scope_block.go`](./internal/report/scope_block.go)  
Provides `conformanceClass()`, `scopeLimitationsCSS`, and `ScopeBlockHTML()` (returns secure `template.HTML` with escaped dynamic inputs via `template.HTMLEscapeString`).

All 9 formatters updated (VPAT, EN301549, AODA, ACA, DDA, GIGW, CVAA, UK, and ADA):
- Displays styled Scope & Limitations block containing Scan WCAG Level, total SCs, evaluated SCs, manual test required count, and AudioEye warnings.
- CSS styling renders `tested-inconclusive` state in purple (`#7c3aed`).

---

### Tests (`internal/scoring/`, `internal/report/`)

New test files:

| File | Tests | Covers |
|------|-------|--------|
| [`score_test.go`](./internal/scoring/score_test.go) | 13 tests | Gaps 1, 2, 3, 4, 6, and review fixes (NotAutomatable) |
| [`report_test.go`](./internal/report/report_test.go) | 2 tests (11 subtests) | All 6 conformance states; all 9 formatters; Scope block unescaped HTML verification and script injection escaping |

**All tests in the scoring, report, and scanner packages pass cleanly (including 15 FSD-specific test functions and 11 report formatter smoke subtests).**

---

## Engine Scope

| Layer | Affected? | Notes |
|-------|-----------|-------|
| Go backend (models, scoring, formatters, API) | ✅ Yes | All fixes are here; applies to any engine |
| Axe runner (`axe_runner.go`) | ✅ Yes | `incomplete` count now wired into `Calculate` |
| Native runner (`native_runner.js`, native Go plumbing) | ❌ No | Native engine produces `ScanResult`; backend fixes apply automatically. JS-level issues (N1–N14 in `audit.md`) remain open. |

---

## Build & Test Results

```
go build ./...                                       ✅ clean
go test ./...                                        ✅ fully green
grep -c 'SCID:' internal/models/sc_registry.go      → 57
```

All package test suites are now completely passing and verified.

---

## What Remains Open

The following `audit.md` items are **not** covered by this FSD:

- **N1–N13**: Native runner / native engine JS bugs (stdout corruption, eval(), SSRF, etc.)
- **§2 (axe)**: `node_count` not emitted by custom checks — AudioEye rates miscalculated for axe path (JS change required)
- **§4 (API)**: SSRF blocklist, rate limiting, secret exposure, plaintext password
- **§5 (Config)**: Input validation, static fallback secret
- **§6 (Security)**: CORS wildcard, audit logging, Puppeteer sandbox
- **§3.3**: Grade threshold documentation
