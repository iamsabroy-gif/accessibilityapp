# Implementation Iteration 1 — Consolidated Punch List

**Audience**: Antigravity IDE model-based coding agent
**Date**: 2026-07-10
**Status**: READY FOR IMPLEMENTATION — single source of truth for all outstanding verified work
**Supersedes**: open items in `implementation.md` (already implemented — see Task 6), review findings on `walkthrough.md`, and Issues A–D from `suggestion.md`.

Every item below has been verified against the live code on 2026-07-10. Do not re-verify the diagnoses; do verify your fixes with the commands given.

---

## Context (read once)

The FSD gap work (`fsd.md` Gaps 1–6) and the NotAutomatable short-circuit fix (`implementation.md`) have landed and are substantively correct. Two independent reviews found the remaining defects:

- **Review 1 (tech-advisor, against walkthrough.md)**: found the HTML-escaping bug (Task 1) and the silently descoped ADA formatter (Task 2). These are BLOCKING — walkthrough.md was NOT APPROVED because of them.
- **Review 2 (`suggestion.md`)**: independently found the red `go test ./...` suite (Task 3) and three doc defects (Tasks 5–7). Its test-fix proposals were verified correct and minimal. Note: suggestion.md marked Gap 6 "✅ verified" — that claim is wrong/incomplete (it never checked escaping or the ADA formatter); Tasks 1–2 stand.

Tasks are ordered by blocking-ness. Do them in order.

---

## Task 1 (P0 — BLOCKING): Scope block renders as escaped text in every report

**Problem**: `internal/report/scope_block.go:38` — `func ScopeBlockHTML(cr *models.ComplianceReport) string` returns plain `string`. All 8 formatters (aca, aoda, cvaa, dda, en301549, gigw, uk, vpat) pass it into an `html/template` data map and render via `{{.ScopeBlock}}`. `html/template` auto-escapes plain strings, so every generated customer-facing report currently shows the literal text `&lt;div class="scope-block"&gt;...` instead of the styled block. Proven empirically on GenerateACA/GenerateVPAT output.

**Fix** — in `internal/report/scope_block.go`:

1. Change the signature to return `template.HTML` (import `html/template`):

```go
func ScopeBlockHTML(cr *models.ComplianceReport) template.HTML {
```

2. **Security requirement, non-negotiable**: once the return value is marked `template.HTML`, the template engine trusts it verbatim — any raw interpolation inside becomes a live HTML-injection vector in customer-facing HTML/PDF reports. Two values are interpolated raw via `fmt.Sprintf` today and MUST be explicitly escaped first:
   - `cr.AudioEyeWarning` (scope_block.go:41)
   - `scanLevel` (derived from `cr.ScanWCAGLevel`/`cr.WCAGLevel`, interpolated at scope_block.go:65)

   Use `template.HTMLEscapeString(...)` on both before the `fmt.Sprintf` calls:

```go
warning := ""
if cr.AudioEyeWarning != "" {
    warning = fmt.Sprintf(`<div class="audioeye-warning"><strong>⚠ AudioEye Warning:</strong> %s</div>`,
        template.HTMLEscapeString(cr.AudioEyeWarning))
}
...
return template.HTML(fmt.Sprintf(`...`, template.HTMLEscapeString(scanLevel), cr.TotalSCs, cr.EvaluatedSCs, cr.ManualTestRequiredCount, warning))
```

   (`TotalSCs`/`EvaluatedSCs`/`ManualTestRequiredCount` are ints — no escaping needed.)

3. No formatter changes are needed: all 8 call sites pass the value into `map[string]interface{}` (e.g. aca_report.go:94, en301549_generator.go:210), so the type change is drop-in.

4. **Strengthen the tests so this can never regress silently.** The current smoke test (`internal/report/report_test.go:133`, `TestScopeBlockHTML`) only checks `strings.Contains(html, "Scope")`, which passes on the escaped garbage. Update it, and the formatter-level tests, to assert on **unescaped markup in the final generated HTML**:

```go
// in the generated report HTML (e.g. GenerateACA / GenerateVPAT output):
if !strings.Contains(htmlOut, `<div class="scope-block">`) {
    t.Error("scope block was HTML-escaped instead of rendered")
}
if strings.Contains(htmlOut, `&lt;div class=`) {
    t.Error("found escaped scope-block markup in output")
}
```

   Also add one injection test: set `cr.AudioEyeWarning = `<script>alert(1)</script>`` and assert the generated output contains `&lt;script&gt;` and does NOT contain `<script>`.

**Verify**: `go test ./internal/report/...` green; new assertions above pass.

---

## Task 2 (P0 — BLOCKING): ADA formatter has no Scope & Limitations block

**Problem**: `fsd.md` Step 6 explicitly names `ada_report.go`, and the FSD acceptance checklist says "every `Generate*` formatter." `internal/report/ada_report.go:35` `GenerateADA(result *models.ScanResult, opts ADAOptions)` was never touched — it has zero references to `ScopeBlockHTML`. It takes `*models.ScanResult`, not `*models.ComplianceReport`, so the shared helper cannot be dropped in as-is. `walkthrough.md` and `fsd_implementation.md` silently reframed scope as "8 formatters" without disclosing this. ADA is arguably the highest-stakes report in the product.

**Fix** — pick ONE and document the choice in the walkthrough (Task 5):

- **Option A (preferred, matches FSD intent)**: thread a `*models.ComplianceReport` into the ADA path. Either add it to `ADAOptions` (e.g. `ComplianceReport *models.ComplianceReport`) or change the `GenerateADA` signature; update the caller in `internal/api/handler.go` to build/pass it (the handler already builds a ComplianceReport for the other formatters). Then render `ScopeBlockHTML(cr)` in the ADA template exactly like the other 8, and add `scopeLimitationsCSS` to the ADA styles.
- **Option B (fallback, only if Option A is genuinely infeasible in this iteration)**: write a small ScanResult-based variant, e.g. `ScopeBlockHTMLFromScan(result *models.ScanResult) template.HTML`, reusing the same CSS and table structure with the fields derivable from ScanResult. Weaker (no EvaluatedSCs/ManualTestRequiredCount fidelity), so if you take this path, say so explicitly in the walkthrough — do NOT silently descope again.

Whatever you do, this task must not be skipped or reframed. If truly blocked, stop and report the blocker; do not ship a walkthrough claiming completion.

**Verify**: generated ADA report HTML contains unescaped `<div class="scope-block">`; add the same escaped/unescaped assertions from Task 1 to an ADA test.

---

## Task 3 (P0 — CI BLOCKER): `go test ./...` is RED — 2 scanner tests

Both failures are in `internal/scanner/wcag122_test.go`, pre-date the FSD work, and will block any `./...` CI gate. Diagnoses and fixes verified against code.

### 3a. `TestWCAGMap_122_ExistingRulesDoNotClaimSC122` (wcag122_test.go:114-129)

- **Failure**: `unexpected: existing rule "video-captions-track" also maps to 1.2.2`
- **Cause**: the test's skip map (lines 116-120) lists only 3 caption rules, but `internal/models/wcag_mapping.go:15` also legitimately maps `"video-captions-track": {"1.2.2"}`. The assertion trips on a valid mapping.
- **Fix** (minimal, preserves intent) — add the missing rule to the skip map:

```go
new122Rules := map[string]bool{
    "video-captions-present":    true,
    "video-captions-track":      true, // pre-existing 1.2.2 mapper (wcag_mapping.go:15)
    "video-captions-track-src":  true,
    "video-captions-track-lang": true,
}
```

### 3b. `TestIntegration_122_FullPipeline_Violation` (wcag122_test.go:354-385)

- **Failure**: `report.Score = 0; want 80` / `report.Grade = "F"; want 'B'`
- **Cause**: the test asserts penalty-formula math (1 critical = −20 → 80/B), but `scoring.Report(result)` (score.go:108) reads `result.Summary.Score`, which `mapToScanResult` computes with the default `compliance` formula. With 1 violation, 0 passes, 0 incomplete: `0/(0+1+0)*100 = 0` → Score 0 / Grade F.
- **Fix** — preserve the test's original intent (penalty math through the pipeline) by calling the penalty formula explicitly. Keep `scoring.Report` for the URL / TotalViolations / Breakdown / Recommendation assertions; replace the Score/Grade assertions with:

```go
score, grade, _ := scoring.Calculate(result.Violations, result.Summary.PassCount,
    result.Summary.IncompleteCount, scoring.FormulaPenalty)
if score != 80 {
    t.Errorf("penalty score = %d; want 80", score)
}
if grade != "B" {
    t.Errorf("penalty grade = %q; want 'B'", grade)
}
```

(Field names verified: `Summary.PassCount` / `Summary.IncompleteCount` at internal/models/report.go:80-81; `Calculate` signature at score.go:72; `FormulaPenalty` at score.go:30.)

**Verify**: `go test ./...` fully green.

---

## Task 4 (P2 — cosmetic code fix): leading space in remarks

`internal/scoring/score.go:443-446` — when `narrativeForConformance` returns `""` and `LimitationNote` is non-empty, `remarks` becomes `" <note>"` with a leading space. Fix:

```go
remarks = narrativeForConformance(scMeta, conformance)
if scMeta.LimitationNote != "" {
    if remarks != "" {
        remarks += " "
    }
    remarks += scMeta.LimitationNote
}
```

**Verify**: existing scoring tests still pass; optionally add a table case with empty narrative.

---

## Task 5 (P2 — doc-only): fix `walkthrough.md` and `fsd_implementation.md`

Three verified inaccuracies. Doc edits only, no code.

1. **NotAutomatable undercount** (suggestion.md Issue A): both docs say "6 unmapped SCs flagged NotAutomatable" (`walkthrough.md` lines 14, 47; `fsd_implementation.md` line 14 and the table at 42-53). The code actually flags all **15** FSD-unmapped A/AA SCs: 1.2.4, 1.2.5, 1.4.2, 1.4.5, 2.1.4, 2.2.2, 2.3.1, 2.5.2, 2.5.4, 3.2.2, 3.2.3, 3.2.4, 3.3.3, 3.3.4, 4.1.3. Update both docs to say 15 and list them. (Registry total is 20 `NotAutomatable: true`: these 15 + 2 WCAG-2.2-only-incomplete SCs 3.2.6/3.3.7 + 3 real-rule SCs 1.2.3/2.2.1/2.4.5 that the `!hasRule` gate now handles.)
2. **Hidden red suite** (suggestion.md Issue D): `walkthrough.md` lines 80-87 show only the scoped `go test ./internal/scoring/... ./internal/report/...` command. Change the documented verification command to `go test ./...` and state the result honestly (green after Task 3 lands).
3. **Test undercount**: walkthrough says 19 tests; there are 20 — it omits `TestConformanceLevel_NotEvaluatedWhenNoIncomplete` and `TestConformanceLevel_NotEvaluatedWhenNoRule` in `internal/scoring/score_test.go`. Correct the count and list.
4. Add a disclosed note on the ADA formatter resolution from Task 2 (which option was taken and why), replacing the silent "8 formatters" reframing.

---

## Task 6 (P2 — doc-only): close out `implementation.md`

`implementation.md` (suggestion.md Issue C) still reads as an open "Ready for implementation" task doc, but its fix already landed (`score.go:438`: `if scMeta.NotAutomatable && !hasRule`). Add a status banner at the top:

```
> **STATUS: RESOLVED (2026-07-10)** — implemented in internal/scoring/score.go:438
> (`NotAutomatable && !hasRule` gate); verified by score_test.go conformance tests.
> Superseded by implementation_iteration1.md. Kept for historical context.
```

Do not delete it (it documents the why behind the gate), just close it.

---

## Task 7 (P2 — doc-only): annotate `suggestion.md`

Add a short reviewer's note at the top of `suggestion.md` stating that its "Gap 6: ✅ verified" row (line 38) was incomplete: it confirmed wiring into 8 formatters but did not check output escaping (Task 1) or the FSD-mandated ADA formatter (Task 2). Its Issues A–D remain valid and are absorbed into this document. This prevents a future reader from treating Gap 6 as fully verified.

---

## Verification commands (run all, in order, after all tasks)

```bash
go build ./...                 # clean
gofmt -l ./...                 # no output
go test ./...                  # fully green — including internal/scanner
cd scripts && npm test         # unchanged, green
```

Plus the targeted checks named in Tasks 1–3.

## Acceptance criteria

1. `ScopeBlockHTML` returns `template.HTML`; `cr.AudioEyeWarning` and `scanLevel` are HTML-escaped inside it via `template.HTMLEscapeString`.
2. Generated HTML from ACA, VPAT, EN301549, AODA, CVAA, DDA, GIGW, UK **and ADA** contains literal `<div class="scope-block">` and does NOT contain `&lt;div class=`.
3. An injection test proves `AudioEyeWarning` containing `<script>` is escaped in final report output.
4. `go test ./...` is fully green (both wcag122 tests fixed per Task 3, intent preserved — 3b still asserts penalty math 80/B via `FormulaPenalty`).
5. No leading-space remarks when narrative is empty (Task 4).
6. `walkthrough.md`/`fsd_implementation.md` say 15 flagged SCs (listed), 20 tests, use `go test ./...` as the verification command, and disclose the ADA resolution.
7. `implementation.md` carries a RESOLVED banner; `suggestion.md` carries the Gap-6-incomplete note.
8. No scope reframing: if any task cannot be completed, the walkthrough for this iteration says so explicitly instead of adjusting the claimed scope.
