# Suggestion Memo — Compliance Report Gap Implementation Review

> **Reviewer's Note (2026-07-10)**: The "Gap 6: ✅ verified" row in the table below (line 38) was incomplete. While it confirmed wiring into 8 report formatters, it failed to verify HTML escaping of the output (leading to escaped markup rendering in reports, fixed in Task 1 of implementation_iteration1.md) and overlooked the FSD-mandated ADA formatter (which was silently skipped, fixed in Task 2). The remaining Issues A–D remain valid and have been fully addressed.

**Prepared for**: Claude agent (review / remediation pass)
**Date**: 2026-07-10
**Author**: Loco (verification pass against code, not prose)
**Scope**: Reconcile `fsd.md`, `fsd_implementation.md`, `implementation.md`, `walkthrough.md`
with the ACTUAL code state, and clear the CI-blocking test failures.
**Repo**: `/Users/sabyasachiroy/projects/webaccessibility`

---

## 0. TL;DR

The backend FSD work (Gaps 1–6) and the NotAutomatable short-circuit bugfix are **real and
verified in code**. The deliverable docs are accurate in substance but have two defects that
matter before merge:

1. **Docs undercount coverage** — they say "6 unmapped SCs flagged NotAutomatable" but the code
   flags all **15** FSD-unmapped A/AA SCs. Misleads a doc-based auditor.
2. **`go test ./...` is RED** — 2 stale tests in `internal/scanner` fail. They pre-date this work
   but will block CI. The walkthrough only shows the scoped test command, hiding this.

Both are cheap to fix. Recommendations below.

---

## 1. VERIFIED GOOD — do not re-litigate

These claims were checked directly in source and match:

| Claim | Evidence (file:line) | Status |
|-------|----------------------|--------|
| Gap 1: 2.2 `continue` skip removed | no `WCAGVersion == "2.2"` skip in `BuildComplianceReport` (score.go:408+) | ✅ |
| Gap 1: 7 WCAG 2.2 registry entries added | sc_registry.go 2.4.11/2.4.13/2.5.7/2.5.8/3.2.6/3.3.7/3.3.8 present | ✅ |
| Gap 3: `incomplete` in compliance denominator | `Calculate(violations, passCount, incomplete, formula)`; `total = passCount + len(violations) + incomplete` (score.go:72,74) | ✅ |
| Gap 4: AudioEye zero-eval → 0/F + Warning | score.go:230-238 | ✅ |
| Gap 5: scan level uses config | handler.go:441 `config.GetWCAGLevel()` | ✅ |
| Gap 6: Scope & Limitations block | `scope_block.go` exports `ScopeBlockHTML`/`conformanceClass`; wired into 8 formatters | ✅ |
| Bug: `NotAutomatable && !hasRule` gate | score.go:438 | ✅ |
| 15 unmapped A/AA SCs now `NotAutomatable:true` | verified each: 1.2.4,1.2.5,1.4.2,1.4.5,2.1.4,2.2.2,2.3.1,2.5.2,2.5.4,3.2.2,3.2.3,3.2.4,3.3.3,3.3.4,4.1.3 | ✅ |
| `go build ./...` clean; scoring+report 19 tests pass | confirmed | ✅ |

---

## 2. ISSUE A — Doc undercount of NotAutomatable SCs (cosmetic, but misleading)

**Where**:
- `walkthrough.md` line 14 ("Flagged 6 unmapped SCs"), line 47 ("Set `NotAutomatable: true` ... to 6 silent A/AA criteria")
- `fsd_implementation.md` line 14 (Gap 2: "6 unmapped A/AA SCs"), line 42-53 table ("Newly flagged NotAutomatable:true" lists 6)

**Reality**: The code flags **all 15** FSD-unmapped A/AA SCs as `NotAutomatable:true` (verified above). The 6 named in the docs (1.2.5, 1.4.2, 2.1.4, 2.5.2, 3.3.3, 4.1.3) are a subset; the other 9 (1.2.4, 1.4.5, 2.2.2, 2.3.1, 2.5.4, 3.2.2, 3.2.3, 3.2.4, 3.3.4) are also flagged but undocumented.

**Why it matters**: A reviewer reading only the docs would conclude 9 SCs are still silently
`NotEvaluated`. They are not. The doc understates the fix.

**Suggestion**: Update both docs to say "15 previously-unmapped Level A/AA SCs" and either list
all 15 or state the count explicitly. No code change.

---

## 3. ISSUE B — `go test ./...` is RED (CI blocker)

Two tests in `internal/scanner/wcag122_test.go` fail. They pre-date this PR (confirmed via the
`fsd_implementation.md` git-stash note) but are still red and will break any `./...` CI gate.

### B1. `TestWCAGMap_122_ExistingRulesDoNotClaimSC122` (line 114-129)
- **Fails**: `unexpected: existing rule "video-captions-track" also maps to 1.2.2`
- **Root cause**: The test skips only 3 "new" 1.2.2 rules
  (`video-captions-present`, `video-captions-track-src`, `video-captions-track-lang`) but
  `wcag_mapping.go:16` also maps `"video-captions-track": {"1.2.2"}` — a legitimate pre-existing
  1.2.2 mapper not in the skip set. So the assertion trips on a valid mapping.
- **Suggested fix** (minimal, preserves intent): add `"video-captions-track"` to the
  `new122Rules` skip map at line 116-120:
  ```go
  new122Rules := map[string]bool{
      "video-captions-present":    true,
      "video-captions-track":      true, // pre-existing 1.2.2 mapper (wcag_mapping.go:16)
      "video-captions-track-src":  true,
      "video-captions-track-lang": true,
  }
  ```
  Alternative (stronger): rename the test to assert "no rule maps to 1.2.2 UNLESS it is a
  known caption rule" and keep the full allowlist. Either is fine.

### B2. `TestIntegration_122_FullPipeline_Violation` (line 354-375)
- **Fails**: `report.Score = 0; want 80` and `report.Grade = "F"; want 'B'`
- **Root cause**: The test assumes the **penalty** formula (1 critical = −20 → 80/B). But
  `scoring.Report(result)` reads `result.Summary.Score`, which the scanner computes with the
  **default `compliance` formula**. With 1 violation and 0 passes:
  `compliancePct = 0/(0+1+0)*100 = 0` → Score 0 / Grade F. The test's expected 80/B reflects the
  old default, not current behavior.
- **Suggested fix** — pick ONE, depending on intent:
  - **Option 1 (exercise penalty path explicitly)**: the test clearly wants to assert the penalty
    formula. Change the scoring call to:
    ```go
    score, grade, _ := scoring.Calculate(result.Violations, result.Summary.PassCount,
        result.Summary.IncompleteCount, scoring.FormulaPenalty)
    // assert score==80, grade=="B"
    ```
    Keep `scoring.Report` only for the URL/violation-count assertions.
  - **Option 2 (match current default)**: if the integration test should track the real default
    pipeline, change expectations to `Score == 0`, `Grade == "F"`. Weaker assertion, but honest.

  Recommend **Option 1** — it preserves the test's original purpose (verify penalty math through
  the pipeline) without depending on a global default.

**Verification after fix**: `go test ./...` should be fully green.

---

## 4. ISSUE C — `implementation.md` reads as pending but the fix is already merged

**Where**: `implementation.md` is written as a task spec ("Ready for implementation", §6
Acceptance Criteria) describing the NotAutomatable short-circuit fix as to-be-done.

**Reality**: The fix is already in `score.go:438` (`if scMeta.NotAutomatable && !hasRule`). The
`fsd_implementation.md` "Known Issues Found During Review (Fixed)" section already confirms it.

**Suggestion**: Either (a) mark `implementation.md` as RESOLVED/CLOSED at top with a one-line note
("implemented in score.go:438; verified"), or (b) delete it if it was only a planning scratch.
Leaving a "ready for implementation" doc alongside merged code invites a double-apply or
confusion about repo state.

---

## 5. ISSUE D — walkthrough.md hides the red suite

**Where**: `walkthrough.md` line 80-87 shows only `go test ./internal/scoring/... ./internal/report/...`
and says "Pre-existing runner/scanner tests are isolated and unmodified" — without stating they
FAIL.

**Suggestion**: Add a line noting `go test ./...` currently fails on the 2 scanner tests (§3 B1/B2)
and that they must be fixed before merge, or change the documented verification command to
`go test ./...` so the red state is visible.

---

## 6. RECOMMENDED ACTION ORDER

1. **Fix B1 + B2** (Issue B) — makes `go test ./...` green; CI-safe. Highest priority.
2. **Fix A** (doc undercount) — edit `walkthrough.md` + `fsd_implementation.md` wording.
3. **Fix C** — close/reconcile `implementation.md`.
4. **Fix D** — update walkthrough verification command.

None require re-implementing the FSD logic. Steps 2–4 are doc-only.

---

## 7. OUT OF SCOPE (noted, not for this pass)

Per `fsd_implementation.md` "What Remains Open": native-runner JS bugs (N1–N13), axe `node_count`
emission (§2), API SSRF/rate-limit/secret exposure (§4), config validation (§5), security
CORS/audit-logging (§6), grade-threshold docs (§3.3). These are real but outside the FSD
compliance-report gap scope and should be tracked separately.
