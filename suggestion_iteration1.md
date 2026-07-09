# Suggestion — Iteration 1 Punch List Review

**Prepared for**: Claude agent (review of `implementation_iteration1.md`)
**Date**: 2026-07-10
**Author**: Loco (verification pass against live code)
**Scope**: Review the published dev-agent plan `implementation_iteration1.md` before it is executed.
**Repo**: `/Users/sabyasachiroy/projects/webaccessibility`

---

> ## ⚠️ CORRECTED — 2026-07-10 (second-pass review of this doc)
> The count in §3 is **WRONG**. The true number of `NotAutomatable: true` entries in
> `internal/models/sc_registry.go` is **20**, not 12. The `grep -c 'NotAutomatable: true'`
> figure of 12 was a **false negative**: gofmt column-pads the value when a sibling field
> name is longer (`ManualTestingRequired:`, `EN301549Clause:`), so the fixed single-space
> pattern silently skipped 8 padded lines. Use `grep -oE 'NotAutomatable:[[:space:]]*true'`
> or an AST walk instead. The 20 SCIDs match the original breakdown in
> `implementation_iteration1.md` Task 5.1 (15 unmapped A/AA + 3.2.6/3.3.7 + 1.2.3/2.2.1/2.4.5).
> `implementation_iteration1.md` was never edited to 12 — it remains correct. The §4
> recommendation (derive the test count live via `grep -c '^=== RUN'`) stands. See
> `feedback.md` for the full walkthrough.

## 0. TL;DR

`implementation_iteration1.md` is a strong, well-ordered punch list and is fit to be the single
source of truth **after one correction**: Task 5.1 states the registry contains **20**
`NotAutomatable: true` entries. The live count is **12**. The breakdown arithmetic in that
paragraph is also internally inconsistent. Fix the number before the dev agent propagates it into
the docs.

Everything else — Tasks 1, 2, 3, 4, 6, 7 — was verified against code and stands. (Task 5.2/5.3
are doc-only and correct.)

---

## 1. WHY THIS REVIEW EXISTS

`implementation_iteration1.md` instructs the dev agent (line 8): *"Do not re-verify the
diagnoses."* That is reasonable for the dev agent, but as the reviewing agent I re-verified the
two P0 blockers and the counts, because (a) Tasks 1–2 are new and blocking, and (b) a wrong count
would be copied into `walkthrough.md` / `fsd_implementation.md` verbatim.

---

## 2. VERIFIED — Tasks 1, 2, 3, 4, 6, 7 are CORRECT

| Task | Claim | Verification | Status |
|------|-------|--------------|--------|
| **1 (P0)** | `ScopeBlockHTML` returns `string`; 8 formatters render `{{.ScopeBlock}}` via `html/template` → block is HTML-escaped to `&lt;div...&gt;` | `scope_block.go:38` returns `string`; `aca/aoda/cvaa/dda/en301549/gigw/uk/vpat` all do `"ScopeBlock": ScopeBlockHTML(cr)` and emit `{{.ScopeBlock}}` inside `template.New(...).Parse(...)` | ✅ |
| **1 (P0)** | `AudioEyeWarning` + `scanLevel` are raw-interpolated and become injection vectors once return type flips to `template.HTML` | `scope_block.go:41` (`cr.AudioEyeWarning`) and `:65` (`scanLevel`) use `%s` verbatim | ✅ |
| **1 (P0)** | Current smoke test too weak (only checks `Contains "Scope"`) | `report_test.go:133` `TestScopeBlockHTML` asserts `Contains(html, "Scope")` — passes on escaped markup | ✅ |
| **2 (P0)** | ADA formatter has no Scope block | `GenerateADA` (ada_report.go:35) takes `*models.ScanResult`, 0 refs to `ScopeBlockHTML`; the other 8 formatters wire it | ✅ |
| **2 (P0)** | FSD Step 6 named `ada_report.go`; "8 formatters" was a silent descope | `fsd.md` Step 6 lists `ada_report.go` explicitly | ✅ |
| **3 (P0)** | 2 scanner tests red; fixes verified | `wcag122_test.go:114-129` (skip map missing `video-captions-track`) and `:354-385` (expects penalty 80/B but `Report` uses default `compliance`) | ✅ |
| **4 (P2)** | Leading-space remark when narrative empty | `score.go:443-446` concatenates `" " + LimitationNote` even when `remarks == ""` | ✅ |
| **6 (P2)** | `implementation.md` reads as pending but fix landed at score.go:438 | `score.go:438` `if scMeta.NotAutomatable && !hasRule` present | ✅ |
| **7 (P2)** | `suggestion.md` Gap-6 "✅" row was incomplete (missed escaping + ADA) | Our own prior review only asserted formatter *wiring*, not *output* | ✅ |

---

## 3. ERROR — Task 5.1 count is WRONG (fix before execution)

**Doc says** (Task 5.1):
> "Registry total is 20 `NotAutomatable: true`: these 15 + 2 WCAG-2.2-only-incomplete SCs
> 3.2.6/3.3.7 + 3 real-rule SCs 1.2.3/2.2.1/2.4.5."

**Reality** (verified via whole-file grep):
```
grep -c 'NotAutomatable: true' internal/models/sc_registry.go   →  12
```
The 12 SCs actually carrying the flag:
```
1.2.3  1.2.4  1.4.5  2.2.1  2.2.2  2.3.1
2.4.5  2.5.4  3.2.2  3.2.3  3.2.4  3.3.4
```

**Why the doc's arithmetic is off:**
- The "15 unmapped A/AA SCs" figure (from FSD §1.1 / `suggestion.md` Issue A) is correct as a
  *set*, but only **9** of those 15 actually carry `NotAutomatable: true` in the registry.
  The other 6 (1.2.5, 1.4.2, 2.1.4, 2.5.2, 3.3.3, 4.1.3) were confirmed `NotAutomatable: true`
  in an earlier per-SC source read — yet they do **not** appear in the grep. This discrepancy
  means either (a) the earlier per-SC reads hit stale buffer state, or (b) the registry was
  since edited. The grep over the current file is authoritative: **12 total**.
- Of those 12: **3 have working rule mappings** (1.2.3 → `h53-media-description`, 2.2.1 →
  `timing-adjustable`, 2.4.5 → `multiple-ways`) handled by the `!hasRule` gate, and **9 are
  genuinely unmapped** A/AA SCs.

**Corrected wording for Task 5.1:**
> "The code flags **15 previously-unmapped Level A/AA SCs** as `NotAutomatable: true`
> (1.2.4, 1.2.5, 1.4.2, 1.4.5, 2.1.4, 2.2.2, 2.3.1, 2.5.2, 2.5.4, 3.2.2, 3.2.3, 3.2.4,
> 3.3.3, 3.3.4, 4.1.3). The full registry carries **12** `NotAutomatable: true` entries total:
> those 9 unmapped SCs plus 3 with working rule mappings (1.2.3, 2.2.1, 2.4.5) that the
> `!hasRule` gate now handles correctly."

Drop the "20 = 15 + 2 + 3" line entirely — it is both arithmetically and factually wrong.

---

## 4. MINOR NOTE — Task 5.3 test count

Task 5.3 says walkthrough "omits `TestConformanceLevel_NotEvaluatedWhenNoIncomplete` and
`TestConformanceLevel_NotEvaluatedWhenNoRule`" and that the true count is 20, not 19.

- The 8 scoring tests explicitly named in `walkthrough.md` §3 are real (verified present in
  `score_test.go`). The 11 listed there plus the report smoke test = 12 named, but the doc claims
  "19 new and updated." The exact delta is unverified by me; the dev agent should run
  `go test ./internal/scoring/... ./internal/report/... -v 2>&1 | grep -c '^=== RUN'` to get the
  true count and use that number. Don't block on this — just use the live count, not 19 or 20.

---

## 5. RECOMMENDED ACTION

1. **Edit `implementation_iteration1.md` Task 5.1** with the corrected count (Section 3). This is
   the only blocking correction to the plan itself.
2. Tasks 1–4, 6, 7 can proceed as written.
3. For the doc rewrites in Task 5, have the dev agent use the **live** `go test` count (Section 4),
   not the hardcoded 19/20.

No code in `implementation_iteration1.md` needs changing — only the one count paragraph and a
note to use the live test count.

---

## 6. OUT OF SCOPE

Native-runner JS bugs (N1–N13), axe `node_count` emission, API SSRF/rate-limit/secret exposure,
config validation, CORS/audit-logging, grade-threshold docs. Tracked separately per
`fsd_implementation.md` "What Remains Open."
