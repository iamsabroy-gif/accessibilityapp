# Implementation Task — Fix NotAutomatable Short-Circuit Bug

> **STATUS: RESOLVED (2026-07-10)** — implemented in internal/scoring/score.go:438
> (`NotAutomatable && !hasRule` gate); verified by score_test.go conformance tests.
> Superseded by implementation_iteration1.md. Kept for historical context.

**Status**: Ready for implementation
**Audience**: Antigravity IDE model-based coding agent
**Reference**: [`fsd.md`](./fsd.md) · [`fsd_implementation.md`](./fsd_implementation.md)
**Scope**: One correctness fix + test coverage + doc/commit hygiene, closing the gap found in
review of `fsd_implementation.md`.

---

## 1. The Bug

`internal/scoring/score.go`, `BuildComplianceReport`, lines ~438-447:

```go
if scMeta.NotAutomatable {
    conformance = models.ConformanceNotEvaluated
    remarks = scMeta.LimitationNote
} else {
    conformance = conformanceLevelForSC(scID, scScore, hasRule, hasIncomplete)
    remarks = narrativeForConformance(scMeta, conformance)
    if scMeta.LimitationNote != "" {
        remarks += " " + scMeta.LimitationNote
    }
}
```

Any SC flagged `NotAutomatable: true` in `internal/models/sc_registry.go` is forced to
`NotEvaluated`, **regardless of whether a real rule mapping and real scan data exist for it**.

Three SCs are flagged `NotAutomatable: true` in `sc_registry.go` despite having working rule
mappings in `internal/models/wcag_mapping.go`:

| SCID | Rule | wcag_mapping.go entry |
|------|------|------------------------|
| 1.2.3 | `h53-media-description` | `"h53-media-description": {"1.2.3"}` |
| 2.2.1 | `timing-adjustable` | `"timing-adjustable": {"2.2.1"}` |
| 2.4.5 | `multiple-ways` | `"multiple-ways": {"2.4.5"}` |

Effect: when the scanner actually detects a violation or pass for one of these rules, the real
result is discarded and every generated report (ADA, VPAT, 508, EN 301 549, EAA, BITV, UK, AODA,
ACA, DDA, GIGW, CVAA — all 11 formats) shows `Not Evaluated` instead. This suppresses evidence of
non-conformance in documents customers use for legal risk assessment — the most dangerous
direction for this tool to be wrong.

This is distinct from SCs like 3.2.6 (`Consistent Help`) and 3.3.7 (`Redundant Entry`), where
`NotAutomatable: true` is correct: those rules are inherently always-incomplete (multi-page /
multi-step checks) and have no meaningful per-scan signal to preserve.

---

## 2. The Fix

**File**: `internal/scoring/score.go`

Gate the short-circuit on `hasRule` (already in scope at line ~432, from
`hasRule := scHasRule[scID]`). Do **not** gate on `hasSCData` — a rule that ran but tested zero
elements already falls through correctly to `NotEvaluated` / `TestedInconclusive` inside
`conformanceLevelForSC`.

```go
if scMeta.NotAutomatable && !hasRule {
    conformance = models.ConformanceNotEvaluated
    remarks = scMeta.LimitationNote
} else {
    conformance = conformanceLevelForSC(scID, scScore, hasRule, hasIncomplete)
    remarks = narrativeForConformance(scMeta, conformance)
    if scMeta.LimitationNote != "" {
        remarks += " " + scMeta.LimitationNote
    }
}
```

Result:
- 1.2.3 / 2.2.1 / 2.4.5 → real scan data now drives `Supports` / `PartiallySupports` /
  `DoesNotSupport` / `TestedInconclusive`, with `LimitationNote` still appended as a caveat.
- All other `NotAutomatable` SCs with no rule mapping (1.2.5, 1.4.2, 2.1.4, 2.5.2, 3.2.6, 3.3.3,
  3.3.7, 4.1.3, etc.) are unaffected — `hasRule` is `false` for them, so they still resolve to
  `NotEvaluated` exactly as before.

---

## 3. Tests

**File**: `internal/scoring/score_test.go`

Add two table-driven cases to whichever existing test builds a `ComplianceReport` from a fixture
`ScanResult`:

1. `TestBuildComplianceReport_NotAutomatableWithRealRule` — fixture scan includes a violation/pass
   for `timing-adjustable` (or `h53-media-description` / `multiple-ways`); assert the resulting
   row for 2.2.1 (or 1.2.3 / 2.4.5) is **not** `NotEvaluated` and reflects the real scan outcome,
   with `LimitationNote` text still present in `Remarks`.
2. `TestBuildComplianceReport_NotAutomatableNoRule` — fixture scan has no data for `3.2.6` (or any
   SC with no `wcag_mapping.go` entry); assert the row stays `NotEvaluated` with `Remarks ==
   scMeta.LimitationNote`.

**Verification**: `go build ./...` then `go test ./internal/scoring/... ./internal/report/...`.

---

## 4. Documentation & Commit Hygiene

1. Amend `fsd_implementation.md`:
   - Add this bug to a "Known Issues Found During Review" section (or fold into "What Was Fixed"
     once resolved), so the sign-off record matches reality instead of omitting it.
   - Update the test count once the two new cases land.
2. Split the commit into at least two logical commits so the conformance-logic change is
   independently revertable:
   - **(a)** `internal/models/sc_registry.go`, `internal/scoring/score.go`,
     `internal/scoring/score_test.go`, `internal/models/conformance.go`,
     `internal/models/report.go`, `internal/config/config.go`, `internal/api/handler.go`,
     `internal/scanner/axe_runner.go` — registry + scoring logic + tests.
   - **(b)** `internal/report/*.go` (formatters + `scope_block.go`) + `internal/report/report_test.go`
     — Scope & Limitations rendering.
3. Decide whether `fsd.md`, `fsd_implementation.md`, `implementation.md`, and `audit.md` should be
   committed as living planning docs or added to `.gitignore` — do not leave them permanently
   untracked/uncommitted alongside merged code changes.

---

## 5. Non-Blocking Follow-Up (do not implement now, just note in a comment or issue)

`NotAutomatable` is currently overloaded to mean both "no automation exists" and "automation is
inherently incomplete." The registry already has a separate `ManualTestingRequired` flag. Once
this fix lands, consider whether 1.2.3/2.2.1/2.4.5-style SCs (rule exists, partial signal, manual
verification still recommended) should eventually move to `ManualTestingRequired` instead, leaving
`NotAutomatable` reserved for SCs with zero automatable signal. Track as a design note, not part of
this task.

---

## 6. Acceptance Criteria

- [ ] `score.go`'s `NotAutomatable` branch only forces `NotEvaluated` when `!hasRule`.
- [ ] 1.2.3, 2.2.1, 2.4.5 reflect real scan data (with `LimitationNote` appended) in a report
      generated against a fixture that has scan data for those rules.
- [ ] SCs with no rule mapping (e.g. 3.2.6, 3.3.7) still resolve to `NotEvaluated`.
- [ ] Two new test cases pass; `go test ./...` is green.
- [ ] `fsd_implementation.md` discloses this bug and its resolution.
- [ ] Changes are committed in the two logical groupings described in §4.2.
