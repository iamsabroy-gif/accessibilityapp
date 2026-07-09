# FSD Implementation Summary
**Date**: 2026-07-10  
**Reference**: [`fsd.md`](./fsd.md) · [`audit.md`](./audit.md)  
**Scope**: Closes 6 compliance-reporting integrity gaps identified in the FSD.  
**Engine coverage**: Go backend (engine-agnostic — applies to both axe and native engine paths).

---

## What Was Fixed

| Gap | Description | Status |
|-----|-------------|--------|
| **1** | WCAG 2.2 SCs silently skipped in `BuildComplianceReport` — never appeared in any report | ✅ Fixed |
| **2** | 6 unmapped A/AA SCs rendered with empty remarks (`NotEvaluated` with no explanation) | ✅ Fixed |
| **3** | Compliance % excluded `incomplete` rule count from denominator — overstated pass rate | ✅ Fixed |
| **4** | AudioEye returned `Score:100 / Grade:A` when zero SCs were evaluated — silent overstatement | ✅ Fixed |
| **5** | `processReportRequest` hardcoded WCAG scan level to `"AAA"` regardless of server config | ✅ Fixed |
| **6** | Reports contained no scope metadata — no way to see evaluated SCs, manual-test-required count, or scan level | ✅ Fixed |

---

## Files Changed

### Models (`internal/models/`)

| File | Change |
|------|--------|
| [`conformance.go`](./internal/models/conformance.go) | Added `ConformanceTestedInconclusive = "Tested – Inconclusive"` (6th conformance state). Added `ManualTestRequiredCount`, `EvaluatedSCs`, `AudioEyeWarning`, `ScanWCAGLevel`, `TestedInconclusiveCount` to `ComplianceReport`. |
| [`report.go`](./internal/models/report.go) | Added `Warning string` to `AudioEyeResult` for propagating "no SCs evaluated" signal. |
| [`sc_registry.go`](./internal/models/sc_registry.go) | Added **7 WCAG 2.2 entries** (registry now has **57 total**). Flagged **6 previously-silent SCs** `NotAutomatable:true` with detailed `LimitationNote` text. |

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

#### Newly flagged `NotAutomatable:true`

| SCID | Name | Reason |
|------|------|--------|
| 1.2.5 | Audio Description (Prerecorded) | Requires manual review of audio quality |
| 1.4.2 | Audio Control | Requires live audio interaction testing |
| 2.1.4 | Character Key Shortcuts | Requires runtime keyboard event observation |
| 2.5.2 | Pointer Cancellation | Requires runtime pointer event observation |
| 3.3.3 | Error Suggestion | Requires manual form interaction and content review |
| 4.1.3 | Status Messages | Requires screen reader testing for announcement timing |

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
- **`BuildComplianceReport`** — Removed the `if scMeta.WCAGVersion == "2.2" { continue }` skip. Threads `hasIncomplete` per SC from `result.Incomplete` rule IDs → WCAGMap lookup. Populates all new `ComplianceReport` fields. Adds `ConformanceTestedInconclusive` to the aggregate count switch. Extends the 508 `NotApplicable` path to cover both `WCAGVersion == "2.1"` and `"2.2"` with distinct remark strings.

---

### Config & API (`internal/config/`, `internal/api/`, `internal/scanner/`)

| File | Change |
|------|--------|
| [`config.go`](./internal/config/config.go) | Added `GetWCAGLevel() string` getter — returns `"AA"` if config is nil. |
| [`handler.go`](./internal/api/handler.go) | Replaced hardcoded `"AAA"` in `processReportRequest` with `config.GetWCAGLevel()`. |
| [`axe_runner.go`](./internal/scanner/axe_runner.go) | Updated `Calculate` call to pass `len(incompleteIDs)` as the new `incomplete` parameter. |

---

### Report Formatters (`internal/report/`)

New shared helper: [`scope_block.go`](./internal/report/scope_block.go)  
Provides `conformanceClass()`, `scopeLimitationsCSS`, and `ScopeBlockHTML()` used by all formatters.

All 8 formatters updated:

| File | Changes |
|------|---------|
| [`vpat_generator.go`](./internal/report/vpat_generator.go) | Added scope CSS + block, shared `conformanceClass` |
| [`en301549_generator.go`](./internal/report/en301549_generator.go) | Added scope CSS + block, shared `conformanceClass` |
| [`aoda_report.go`](./internal/report/aoda_report.go) | Added scope CSS + block, shared `conformanceClass` |
| [`aca_report.go`](./internal/report/aca_report.go) | Added scope CSS + block, shared `conformanceClass` |
| [`dda_report.go`](./internal/report/dda_report.go) | Added scope CSS + block, shared `conformanceClass` |
| [`gigw_report.go`](./internal/report/gigw_report.go) | Added scope CSS + block, shared `conformanceClass` |
| [`cvaa_report.go`](./internal/report/cvaa_report.go) | Added scope CSS + block, shared `conformanceClass` |
| [`uk_report.go`](./internal/report/uk_report.go) | Added scope CSS + block, shared `conformanceClass` |

The Scope & Limitations block rendered in each report includes:
- Scan WCAG Level (from `ScanWCAGLevel`)
- Total SCs in report
- Evaluated SCs (automated test data)
- Manual Testing Required count
- AudioEye Warning (shown if `AudioEyeWarning` is non-empty)
- Explanation of `Tested – Inconclusive` vs `Not Evaluated`

The `tested-inconclusive` CSS class renders the new conformance state in **purple** (`#7c3aed`) to distinguish it from grey `not-eval`.

---

### Tests (`internal/scoring/`, `internal/report/`)

New test files:

| File | Tests | Covers |
|------|-------|--------|
| [`score_test.go`](./internal/scoring/score_test.go) | 11 tests | Gaps 1, 2, 3, 4, 6, and review fixes |
| [`report_test.go`](./internal/report/report_test.go) | 11 subtests | All 6 conformance states; all 8 formatters; Scope block |

**All 19 new tests pass.**

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
go test ./internal/scoring/... ./internal/report/... ✅ 19 pass
grep -c 'SCID:' internal/models/sc_registry.go      → 57
```

**Pre-existing failures (not caused by this work):**
- `TestWCAGMap_122_ExistingRulesDoNotClaimSC122` — `video-captions-track` already mapped to 1.2.2 before this PR
- `TestIntegration_122_FullPipeline_Violation` — expects penalty-formula Score=80 but default formula is `"compliance"`

Both confirmed via `git stash` to pre-date this implementation.

---

## Known Issues Found During Review (Fixed)

- **NotAutomatable Short-Circuit Bug**: Success Criteria flagged as `NotAutomatable: true` in `sc_registry.go` were previously forced to `NotEvaluated` unconditionally, discarding real scan data for criteria with working rule mappings (1.2.3, 2.2.1, 2.4.5). This has been resolved by gating the short-circuit on the absence of a rule mapping (`scMeta.NotAutomatable && !hasRule`), preserving real pass/fail conformance data while maintaining correct `NotEvaluated` behaviour for non-mapped criteria.

---

## What Remains Open

The following `audit.md` items are **not** covered by this FSD:

- **N1–N13**: Native runner / native engine JS bugs (stdout corruption, eval(), SSRF, etc.)
- **§2 (axe)**: `node_count` not emitted by custom checks — AudioEye rates miscalculated for axe path (JS change required)
- **§4 (API)**: SSRF blocklist, rate limiting, secret exposure, plaintext password
- **§5 (Config)**: Input validation, static fallback secret
- **§6 (Security)**: CORS wildcard, audit logging, Puppeteer sandbox
- **§3.3**: Grade threshold documentation
