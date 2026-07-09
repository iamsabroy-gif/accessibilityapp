# Functional Specification & Implementation Plan — Compliance Report Gaps

**Status**: Verified against codebase 2026-07-10 — ready for implementation
**Author**: Engineering (Loco)
**Audience**: Antigravity IDE model-based coding agent
**Scope**: Close the compliance-reporting integrity gaps identified in the codebase audit.
**Repo root**: `/Users/sabyasachiroy/projects/webaccessibility`

---

## 1. Context & Problem Statement

The compliance-reporting subsystem produces conformance reports across 11 report endpoints /
standards (ADA, VPAT/508, EN 301 549, UK Equality Act, AODA, ACA, DDA, GIGW, CVAA, EAA, BITV —
EAA and BITV reuse the EN 301 549 generator) from a single intermediate representation
(`models.ComplianceReport`) built by `BuildComplianceReport` (`internal/scoring/score.go`).

The conformance engine can emit only five conformance states:
`Supports`, `Partially Supports`, `Does Not Support`, `Not Evaluated`, `Not Applicable`.
It has **no state for "tested but inconclusive."**

Three structural defects cause reports to systematically **overstate** conformance:

1. **WCAG 2.2 is excluded entirely** from every report (`score.go:374` `continue` on
   `WCAGVersion == "2.2"`), yet 7 WCAG 2.2 rules exist in `WCAGMap` and the `SCRegistry` has
   **zero** 2.2 entries, so they can never render a row even if the skip were removed.
2. **15 Level A/AA success criteria have no rule in `WCAGMap`** (verified: 0 rule→SC mappings
   exist for them), so they can never score as failures. 9 of the 15 are already declared
   `NotAutomatable:true` in `SCRegistry` (honest `NotEvaluated` + limitation note); the other 6
   fall through `conformanceLevelForSC` with `hasRule=false` into a **silent** `NotEvaluated`.
   See §4.7 for the split.
3. **"Incomplete" results are invisible**: `Calculate` computes compliance % from
   `passCount / (passCount + violations)` ignoring incomplete (score.go:71-74); `conformanceLevelForSC`
   collapses any SC with `TestedElements == 0` into `NotEvaluated` (score.go:304); and
   `CalculateAudioEye` returns a perfect `A/100` when zero SCs evaluate (score.go:227-229).

Net effect: the evaluated-SC denominator is small and skewed toward criteria the tool handles
well, while the compliance % and AudioEye score both ignore uncertainty. Reports overstate
conformance, worst exactly where automation is weakest.

> NOTE: the prior `audit.md` §1.1 lists 16 unmapped SCs. Re-verification (2026-07-10) shows
> **2.4.6 is already mapped** (`empty-heading`, `page-has-heading-one` → `2.4.6`), so audit.md
> is stale on this point. The live unmapped set is **15**.

### 1.1 Verification status (2026-07-10)

Recent commit titles suggest related work landed — it did not land in the scoring/reporting
engine. Verified against HEAD (`ec51770`):

- `2148e2c` "wcag2.2 gaps implementation" — added the 7 WCAG 2.2 **scanner rules**
  (`scripts/rules/*.js`) and their `WCAGMap` entries. It did **not** touch `SCRegistry`,
  `BuildComplianceReport`, or the 2.2 skip. This is why Gap 1's asymmetry exists.
- `746cade` / `c7d1422` "compliance updates" — added the compliance-report subsystem itself
  (formatters, handlers, `sc_registry.go`, `conformance.go`) including the 9 pre-existing
  `NotAutomatable` flags. Prior work, not this FSD's steps.
- `ec51770` "front page edits" — frontend only, unrelated.

**Of the 8 steps below: Step 3 is already complete (verified, no change needed). Step 2 is
partially complete (9 of 15 SCs already flagged). Steps 1, 4, 5, 6, 7, 8 are fully open.**
Specifically re-verified as still open: the 2.2 `continue` (score.go:374), the hardcoded `"AAA"`
in `processReportRequest` (handler.go:441), the `Calculate` signature (no `incomplete` param,
score.go:69), the missing `ConformanceTestedInconclusive` state (conformance.go has only 5
states), the missing `Warning` field on `AudioEyeResult`, the `n == 0 → Score:100` return
(score.go:227-229), and the absence of any test files in `internal/report/` and
`internal/coverage/` (only `internal/scoring/score_audioeye_test.go` and the unrelated
`internal/scanner/wcag122_test.go` exist).

---

## 2. Goals & Non-Goals

### Goals
- G1. Render all WCAG 2.2 criteria in conformance reports (ADA/VPAT/508/EN301549/EAA/BITV/etc.).
- G2. Make every Level A/AA criterion either (a) actually scorable via a `WCAGMap` rule, or
  (b) explicitly declared `NotAutomatable` so the report is honest about non-coverage.
- G3. Distinguish "tested but inconclusive" (incomplete) from "no automation exists" in both the
  conformance state and the compliance % denominator.
- G4. Stop silent overstatement: AudioEye must not report a perfect score when nothing was evaluated.
- G5. Lock the whole report path behind regression tests (currently 0 test files in
  `internal/report`, `internal/coverage`; the report path is covered only indirectly by
  `internal/scoring/score_audioeye_test.go`).
- G6. Make report metadata (scan level, evaluated-SC count, manual-testing count) truthful.

### Non-Goals
- NG1. Building new axe/Puppeteer rules to *detect* criteria that are genuinely not automatable
  (e.g. 2.3.1 Three Flashes). Those are declared `NotAutomatable`, not faked.
- NG2. Rewriting the 11 report HTML/PDF formatters' visual design. Only shared engine + metadata change.
- NG3. Changing the public REST contract shape beyond additive fields.
- NG4. Fixing the hardcoded `const wcagLevel = "AAA"` in the `/scan` (handler.go:67) and `/score`
  (handler.go:359) paths. Those are intentionally scan-everything paths; this FSD only fixes the
  *report* path's claim about what level was scanned (see §4.8).

---

## 3. Current Architecture (relevant slice)

```
POST /api/v1/report/{ada,vpat,en301549,uk,aoda,aca,dda,gigw,cvaa,eaa,bitv}
        │
        ▼
processReportRequest(handler.go:415)
   - decodes ReportRequest{URL,Format,Depth,Meta}
   - Scan(ctx, url, "AAA", depth)  (handler.go:441)  ◀── always "AAA", ignores WCAG_LEVEL & standard
   - returns *models.ScanResult
        │
        ▼
scoring.BuildComplianceReport(result, standard, meta)   (score.go:347)
   - runs CalculateAudioEye (score.go:190) if result.AudioEye==nil  ◀── gate: only SCs in WCAGMap count
   - for each SCRegistry entry:
        skip if WCAGVersion == "2.2" (score.go:374)   ◀── GAP 1
        if standard=="508" && version!="2.0": mark NotApplicable (score.go:379-389)
        if scMeta.NotAutomatable: NotEvaluated + LimitationNote (score.go:397-399)
        else conformance = conformanceLevelForSC(...)  (score.go:303)
            hasRule==false || TestedElements==0  → NotEvaluated   ◀── GAP 2/4
        else: Supports / Partial / DoesNotSupport
   - aggregate counts → ComplianceReport (conformance.go)
        │
        ▼
report.Generate{ADA,VPAT,EN301549,UK,AODA,ACA,DDA,GIGW,CVAA}(…)   (EAA/BITV → EN301549 generator)
   - formatters consume ComplianceReport.Rows + aggregate counts
```

Key files:
- `internal/scoring/score.go` — `BuildComplianceReport`, `conformanceLevelForSC`,
  `Calculate`, `CalculateAudioEye`.
- `internal/models/conformance.go` — `ConformanceLevel` enum, `SCConformanceRow`, `ComplianceReport`.
- `internal/models/sc_registry.go` — `SCRegistry` (50 entries, all WCAG 2.0/2.1; per-SC metadata
  + `NotAutomatable`).
- `internal/models/wcag_mapping.go` — `WCAGMap` rule→SC gate.
- `internal/api/handler.go` — `processReportRequest`, 11 `Report*` handlers.
- `internal/report/*.go` — 9 formatter files + `generator.go` (generic HTML) + `pdf_exporter.go`.
- `internal/models/report.go` — `ScanResult` (verified: has `Summary.IncompleteCount` at
  report.go:80 and `Incomplete []string` at report.go:100).
- `internal/config/config.go` — loads `WCAG_LEVEL` env into `Config.WCAGLevel` (default "AA",
  config.go:177) but **nothing consumes it and no getter exists** — see §4.8.

---

## 4. Target Design

### 4.1 New conformance state
Add to `models.ConformanceLevel` (conformance.go):
```go
ConformanceTestedInconclusive ConformanceLevel = "Tested – Inconclusive"
```
Rationale: an SC whose rules ran and returned `incomplete` (not zero-tested, not a crash) is
materially different from "no automation exists." This is the missing third state.

### 4.2 ComplianceReport metadata additions (conformance.go)
```go
ManualTestRequiredCount int `json:"manual_test_required"`   // rows where ManualTestingRequired
EvaluatedSCs          int `json:"evaluated_scs"`            // rows with hasRule && TestedElements>0
AudioEyeWarning       string `json:"audioeye_warning,omitempty"` // set when AE scored on 0/partial SCs
ScanWCAGLevel         string `json:"scan_wcag_level"`       // actual level the scan ran at
```

### 4.3 Reworked `conformanceLevelForSC` (score.go)
Signature gains a `hasIncomplete bool` param:
```go
func conformanceLevelForSC(scID string, sc models.SCScore, hasRule, hasIncomplete bool) models.ConformanceLevel
```
Logic:
- `!hasRule || sc.TestedElements == 0 && !hasIncomplete` → `NotEvaluated` (truly nothing ran).
- `hasIncomplete && sc.TestedElements == 0` → `TestedInconclusive`.
- `sc.TestedElements > 0 && sc.FailedElements == 0` → `Supports`.
- `sc.TestedElements > 0 && FailureRate < 0.5` → `PartiallySupports`.
- else → `DoesNotSupport`.

### 4.4 Compliance % must include incomplete (score.go `Calculate`)
Change denominator to `passCount + len(violations) + incompleteCount`. Add `incomplete int`
param to `Calculate`. Audit §3.1 fix. The report HTML compliance value + bar
(generator.go:230/236) then reflect reality. Note generator.go already renders
`Summary.IncompleteCount` as a card (generator.go:226) — the count is visible, the percentage
just ignores it.

### 4.5 AudioEye zero-eval guard (score.go `CalculateAudioEye`)
Replace the silent `return Score:100` (score.go:227-229) with:
```go
if n == 0 {
    return models.AudioEyeResult{Score: 0, Grade: "F", SCsEvaluated: 0,
        Warning: "No success criteria evaluated — result is not a compliance score."}
}
```
Add `Warning string` to `models.AudioEyeResult` (verified absent today). Propagate
`AudioEyeWarning` into `ComplianceReport`.

### 4.6 Remove the 2.2 skip + add 2.2 registry entries
- Delete `if scMeta.WCAGVersion == "2.2" { continue }` in `BuildComplianceReport` (score.go:373-375).
- Add 7 entries to `SCRegistry` (sc_registry.go) for: 2.4.11, 2.4.13, 2.5.7, 2.5.8, 3.2.6,
  3.3.7, 3.3.8 — each with `Level`, `WCAGVersion:"2.2"`, `EN301549Clause:"9.x.x.x"`,
  `LimitationNote`, and `NotAutomatable:true` where no heuristic rule can fully judge.
  **Caveat (see §4.7 note): `NotAutomatable:true` short-circuits scoring even when a mapped
  rule produced data.** All 7 SCs have heuristic rules in `WCAGMap` (verified,
  wcag_mapping.go:87-93; `consistent-help` and `redundant-entry` are annotated "always
  incomplete"). Recommended: declare the always-incomplete/manual ones `NotAutomatable` with
  honest limitation notes, but let rules with real pass/fail signal (e.g. `target-size`,
  `focus-not-obscured`) score via the normal path — decide per SC at implementation time
  rather than blanket-flagging all 7.
- 508 mode: 2.2 SCs → `NotApplicable` with the same explanation path as 2.1 SCs
  (score.go:379-389; the remark string will need to cover 2.2 as well as 2.1).
  This makes 508 consistent (Gap 6 fixed).

### 4.7 Close the 15 unmapped A/AA gaps (sc_registry.go)
15 unmapped SCs (verified 2026-07-10 — zero occurrences of each in wcag_mapping.go):
`1.2.4, 1.2.5, 1.4.2, 2.1.4, 1.4.5, 2.2.2, 2.3.1, 2.5.2, 2.5.4, 3.2.2, 3.2.3, 3.2.4, 3.3.3,
3.3.4, 4.1.3`.

**Already done (9 of 15)** — flagged `NotAutomatable:true` with limitation notes in
sc_registry.go: `1.2.4, 1.4.5, 2.2.2, 2.3.1, 2.5.4, 3.2.2, 3.2.3, 3.2.4, 3.3.4`.

**Remaining (6 of 15)** — have `ManualTestingRequired:true` and full narrative templates but
no `NotAutomatable` flag and no mapped rule, so they currently render as a silent
`NotEvaluated`: `1.2.5, 1.4.2, 2.1.4, 2.5.2, 3.3.3, 4.1.3`. For each, choose **one** of:
- **Map a rule** if a rule exists but is unregistered (verify against `WCAGMap` keys — none
  found today).
- **Declare `NotAutomatable:true`** with an honest `LimitationNote` (matches all 6: audio
  description quality, audio control, character-key shortcuts, pointer cancellation, error
  suggestion, status messages).

> **Related inconsistency found during verification**: 3 SCs are flagged `NotAutomatable:true`
> yet **do** have mapped rules — `1.2.3` (`h53-media-description`), `2.2.1`
> (`timing-adjustable`), `2.4.5` (`multiple-ways`). Because `BuildComplianceReport`
> short-circuits `NotAutomatable` rows to `NotEvaluated` before consulting SC data
> (score.go:397-399), any pass/fail signal those rules produce is discarded in compliance
> reports. Resolve during Step 2: either remove the flag (let the heuristic rule score, keeping
> the `LimitationNote`) or unmap the rule — do not leave the contradiction.

### 4.8 Truthful scan level (handler.go)
- `processReportRequest` should pass the configured WCAG level (default "AA") to `Scan`, not
  the hardcoded `"AAA"` at handler.go:441. **Correction**: `config.GetWCAGLevel()` does not
  exist. `Config.WCAGLevel` is loaded from `WCAG_LEVEL` (config.go:177) but never consumed
  anywhere; add a `GetWCAGLevel()` getter following the existing getter pattern
  (`GetScoringFormula` etc.) and wire it in.
- Stamp `ComplianceReport.ScanWCAGLevel` from `result.Summary.Level`.
- Out of scope but noted: `/scan` and `/score` also hardcode `const wcagLevel = "AAA"`
  (handler.go:67, handler.go:359) — see NG4.

### 4.9 Formatters surface the new fields
Each `Generate*` formatter should render (additive, low-risk):
- A "Scope & Limitations" block: total SCs, evaluated SCs, manual-test-required count,
  AudioEye warning (if any), scan WCAG level.
- `Tested – Inconclusive` rows styled distinctly from `Not Evaluated`.

---

## 5. Step-wise Implementation Plan (model-executable)

Each step is independently compilable. The agent should run `go build ./...` and the new tests
after every step. Order is dependency-aware.

### Step 1 — Models: extend enums & structs  *(open)*
**Files**: `internal/models/conformance.go`, `internal/models/report.go` (AudioEyeResult Warning).
**Actions**:
1. Add `ConformanceTestedInconclusive` to the `ConformanceLevel` const block (verified: only 5
   states exist today).
2. Add `ManualTestRequiredCount`, `EvaluatedSCs`, `AudioEyeWarning`, `ScanWCAGLevel` fields to
   `ComplianceReport`.
3. Add `Warning string` to `models.AudioEyeResult` (verified absent).
**Verification**: `go build ./...` passes.

### Step 2 — SCRegistry: add 2.2 entries + flag remaining 6 unmapped as NotAutomatable  *(partially done)*
**Files**: `internal/models/sc_registry.go`.
**Actions**:
1. Append 7 WCAG 2.2 entries (2.4.11, 2.4.13, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8) with
   `WCAGVersion:"2.2"`, correct `Level`/`EN301549Clause`, `LimitationNote`; set
   `NotAutomatable` per the per-SC decision in §4.6 (not a blanket flag).
2. ~~For the 15 unmapped A/AA SCs, set `NotAutomatable:true`~~ **9 of 15 already flagged**
   (see §4.7). For the remaining 6 (`1.2.5, 1.4.2, 2.1.4, 2.5.2, 3.3.3, 4.1.3`), set
   `NotAutomatable:true` and write an honest `LimitationNote` (they already have
   `LimitationNote` text; adjust wording to state non-automatability plainly).
3. Resolve the 3 flagged-but-mapped contradictions (`1.2.3`, `2.2.1`, `2.4.5`) per §4.7 note.
**Verification**: `go build ./...`. Confirm: `len(SCRegistry)` increased from 50 to 57; the 6
target SCs now have `NotAutomatable:true`; grep each of the 7 new 2.2 SC IDs in sc_registry.go.

### Step 3 — WCAGMap: 2.2 rules  *(✅ done — verified 2026-07-10, no change required)*
**Files**: `internal/models/wcag_mapping.go`.
**Status**: The 7 WCAG 2.2 rule keys exist (wcag_mapping.go:87-93) and map correctly:
`target-size→2.5.8`, `accessible-authentication→3.3.8`, `dragging-movements→2.5.7`,
`focus-not-obscured→2.4.11`, `consistent-help→3.2.6`, `redundant-entry→3.3.7`,
`focus-appearance→2.4.13`. Landed in commit `2148e2c`. Keep this step as a checkpoint only:
re-grep the 7 SC IDs before Step 4 removes the 2.2 skip.

### Step 4 — Scoring: rework conformance + compliance % + AudioEye guard  *(open)*
**Files**: `internal/scoring/score.go`.
**Actions**:
1. Change `Calculate` signature to `Calculate(violations, passCount, incomplete int, formula string)`
   and include `incomplete` in the denominator (Audit §3.1). Verified: current signature at
   score.go:69 has no `incomplete` param.
2. Update `conformanceLevelForSC` to take `hasIncomplete bool` and return
   `ConformanceTestedInconclusive` when rules ran but only `incomplete` results exist.
3. Replace the `n == 0` perfect-score return in `CalculateAudioEye` (score.go:227-229) with the
   `Score:0, Grade:"F", Warning:...` result (Gap 4/5).
4. In `BuildComplianceReport`: remove the 2.2 `continue` (score.go:373-375); thread
   `hasIncomplete` per SC into `conformanceLevelForSC`; populate `EvaluatedSCs`,
   `ManualTestRequiredCount`, `AudioEyeWarning`, `ScanWCAGLevel`; set 2.2-in-508 rows to
   `NotApplicable` via existing path (adjust the WCAG-2.1-specific remark text); add the new
   `TestedInconclusive` case to the aggregate-count switch (score.go:423-434) or the count is
   silently dropped.
5. Update all callers of `Calculate` (search `internal/` for `scoring.Calculate(` and the
   handler `Report`/`Score` paths) to pass `result.Summary.IncompleteCount` (field verified
   present, report.go:80).

**Verification**: `go build ./...`; `go test ./internal/scoring/...`.

### Step 5 — Handler + config: truthful scan level  *(open)*
**Files**: `internal/api/handler.go`, `internal/config/config.go`.
**Actions**:
1. Add `GetWCAGLevel() string` to config.go (getter for the already-loaded `Config.WCAGLevel`,
   default "AA" — verified no getter exists today).
2. In `processReportRequest`, replace `Scan(ctx, req.URL, "AAA", req.Depth)` (handler.go:441)
   with `Scan(ctx, req.URL, config.GetWCAGLevel(), req.Depth)`.
**Verification**: `go build ./...`.

### Step 6 — Formatters: surface new fields  *(open)*
**Files**: `internal/report/{ada_report,vpat_generator,en301549_generator,uk_report,aoda_report,aca_report,dda_report,gigw_report,cvaa_report}.go`
(EAA/BITV flow through `en301549_generator.go` via `ReportType`; no separate files exist).
**Actions**:
1. Render a "Scope & Limitations" summary block using the new `ComplianceReport` fields.
2. Render `ConformanceTestedInconclusive` rows with a distinct label/style from `Not Evaluated`.
3. Emit `AudioEyeWarning` prominently when non-empty.
**Verification**: `go build ./...`.

### Step 7 — Tests (close Gap 9)  *(open — verified: no test files in internal/report or internal/coverage)*
**Files**: `internal/scoring/score_test.go` (new), `internal/report/*_test.go` (new, at least one
per formatter or one shared smoke test), `internal/coverage/coverage_test.go` (new).
**Test cases to add**:
1. `TestBuildComplianceReport_IncludesWCAG22` — report contains rows for 2.4.11/2.5.8/etc.
2. `TestConformanceLevel_TestedInconclusive` — SC with TestedElements==0 but hasIncomplete →
   `TestedInconclusive`, not `NotEvaluated`.
3. `TestCalculate_CompliancePctIncludesIncomplete` — denominator includes incomplete.
4. `TestCalculateAudioEye_ZeroSCsReturnsWarning` — Score 0 + non-empty Warning.
5. `TestBuildComplianceReport_508NotApplicableFor22` — 2.2 SCs → `NotApplicable` in 508 mode.
6. `TestReportFormatters_AllSmoke` — each `Generate*` (including EN301549 with
   `ReportType:"EAA"`/`"BITV"`) returns non-empty HTML without panic for a fixture
   `ComplianceReport` that exercises every conformance state.
7. `TestCoverageParse` — parse a minimal XLSX fixture and assert entry counts
   (`internal/coverage/report.go` parses the coverage workbook).
**Verification**: `go test ./...`.

### Step 8 — Docs & audit reconciliation  *(open)*
**Files**: `audit.md`, `README.md` (if it claims coverage), `openapi.yaml` (if adding fields).
**Actions**:
1. Mark audit.md §1.1, §1.2, §3.1, §3.2 as RESOLVED with references to this FSD + commit.
   While there, correct audit.md §1.1's stale "16 unmapped" count (2.4.6 is mapped; live set
   is 15, of which 9 were already NotAutomatable-flagged before this FSD).
2. Update `openapi.yaml` `Summary`/`ComplianceReport` schemas if new fields are surfaced via API.
**Verification**: `go build ./...`; `go test ./...`.

---

## 6. Acceptance Criteria

- [ ] A generated ADA/VPAT/EN301549 report lists WCAG 2.2 criteria (2.4.11, 2.4.13, 2.5.7, 2.5.8,
      3.2.6, 3.3.7, 3.3.8) — none silently dropped.
- [ ] All 15 previously-unmapped A/AA SCs render with an explicit non-coverage explanation
      (`NotAutomatable` limitation note), not a silent blank `Not Evaluated` — including the
      6 newly flagged (`1.2.5, 1.4.2, 2.1.4, 2.5.2, 3.3.3, 4.1.3`).
- [ ] The 3 flagged-but-mapped contradictions (`1.2.3`, `2.2.1`, `2.4.5`) are resolved one way
      or the other (§4.7 note).
- [ ] A report whose checks return `incomplete` shows a "Tested – Inconclusive" state and a
      compliance % that accounts for incomplete results (not 100% when mostly incomplete).
- [ ] AudioEye returns `Score:0` + `Warning` (not `A/100`) when no SCs are evaluated.
- [ ] The report header states the actual scan WCAG level (AA by default via `WCAG_LEVEL`),
      not hardcoded AAA.
- [ ] Every `Generate*` formatter renders a Scope & Limitations block.
- [ ] `go test ./...` passes; new tests in Steps 1, 4, 6, 7 cover the changed paths.

---

## 7. Risks & Mitigations

- **R1**: Flagging the remaining 6 SCs `NotAutomatable` will increase "Not Evaluated" counts in
  existing reports, lowering apparent conformance. *Mitigation*: this is the honest result;
  communicate via changelog. Do NOT fake mappings.
- **R2**: Changing `Calculate` signature touches multiple callers. *Mitigation*: Step 4 greps all
  call sites; build fails fast if one is missed.
- **R3**: `ConformanceTestedInconclusive` must be handled by every formatter switch **and** the
  aggregate-count switch in `BuildComplianceReport` or it renders blank / vanishes from totals.
  *Mitigation*: Step 4.4 + Step 6 add the cases; smoke test 6 exercises every state.
- **R4**: Removing the 2.2 skip without registry entries would produce no 2.2 rows at all (the
  loop iterates `SCRegistry`, which has zero 2.2 entries — it would not panic, it would silently
  do nothing). Step 2 must land before Step 4's skip removal (order enforced above).
- **R5** *(new)*: Blanket `NotAutomatable:true` on the 7 new 2.2 entries would discard real
  pass/fail data from the 7 existing scanner rules (same short-circuit as the §4.7
  contradiction). *Mitigation*: per-SC decision in §4.6.

---

## 8. Verification Command Cheat-sheet

```bash
cd /Users/sabyasachiroy/projects/webaccessibility
go build ./...                                  # must pass after every step
go test ./internal/scoring/... ./internal/report/... ./internal/coverage/...
gofmt -l ./internal                             # lint per CLAUDE.md
# Registry sanity after Step 2:
grep -c 'SCID:' internal/models/sc_registry.go          # expect 57
grep -n '"2.4.11"\|"2.4.13"\|"2.5.7"\|"2.5.8"\|"3.2.6"\|"3.3.7"\|"3.3.8"' internal/models/sc_registry.go
# Manual smoke (after Step 5):
# POST /api/v1/report/ada  { "url":"https://example.com", "format":"html" }
#   inspect rows for 2.4.11 / 2.5.8; confirm Scope & Limitations block present.
```
