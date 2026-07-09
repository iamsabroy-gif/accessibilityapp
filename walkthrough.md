# Web Accessibility Scanner — FSD & Correctness Walkthrough

This document walks through the complete implementation of the **Functional Specification Document (FSD)** compliance-reporting integrity gaps, alongside the **conformance-logic short-circuit bugfix** implemented in the second phase.

---

## 1. Summary of Implementations

A total of **6 architectural gaps** and **1 critical bug** were closed:

| Gap / Issue | Impact / Problem | Resolution |
|-------------|------------------|------------|
| **Gap 1** | WCAG 2.2 criteria were completely skipped during report builds. | Removed WCAG 2.2 `continue` skip; added 7 WCAG 2.2 criteria to the registry. |
| **Gap 2** | Unmapped A/AA criteria rendered silently with blank remarks, confusing users. | Flagged 6 unmapped SCs as `NotAutomatable: true` with detailed explanation notes. |
| **Gap 3** | Compliance % calculation ignored the count of incomplete tests in the denominator. | Included `incomplete` rule results in the compliance denominator to avoid overstating scores. |
| **Gap 4** | AudioEye scored a perfect `100 / A` when no success criteria were actually evaluated. | Gated zero-evaluations to return `Score: 0 / Grade: F` with an explicit warning banner. |
| **Gap 5** | Report generation scans were hardcoded to WCAG `AAA` instead of matching config. | Integrated `config.GetWCAGLevel()` to respect configured target levels dynamically. |
| **Gap 6** | Reports lacked scope metadata. Users couldn't see scan levels or manual-test needs. | Injected a comprehensive **Scope & Limitations** section into all 8 compliance formatters. |
| **Correctness Bug** | `NotAutomatable` criteria with working rule mappings were forced to `NotEvaluated`. | Gated the short-circuit on `!hasRule` so criteria like 1.2.3, 2.2.1, and 2.4.5 utilize real scan data. |

---

## 2. Key Architecture & File Changes

### Backend Logic (`internal/scoring/score.go`)
- **`Calculate` signature updated**: `Calculate(violations []models.Violation, passCount, incomplete int, formula string)`
- **`conformanceLevelForSC` updated**: Detects `ConformanceTestedInconclusive` when rules ran but returned only incomplete results.
- **`BuildComplianceReport` updated**:
  - Gated `NotAutomatable` check:
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
  - Populates new `ComplianceReport` fields for metadata.

### Models (`internal/models/`)
- Added `ConformanceTestedInconclusive` to `conformance.go`.
- Added 7 WCAG 2.2 criteria (2.4.11, 2.4.13, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8) to `sc_registry.go`.
- Set `NotAutomatable: true` and added description limitations to 6 silent A/AA criteria.

### UI & Reporting (`internal/report/`)
- Injected `ScopeBlockHTML` via a new shared module `scope_block.go`.
- Added CSS classes for `.tested-inconclusive` (purple styling for inconclusive results) and `.scope-block` to all formatters:
  - VPAT, EN 301 549, AODA, ACA, DDA, GIGW, CVAA, and UK Equality Act reports.

---

## 3. Test Coverage

A total of **19 new and updated unit/smoke tests** were added and validated:

### Scoring Engine tests (`internal/scoring/score_test.go`)
- `TestCalculate_CompliancePctIncludesIncomplete` (Denominators includes incomplete)
- `TestCalculate_ZeroIncompleteUnchanged` (Regression guard)
- `TestCalculateAudioEye_ZeroSCsReturnsWarning` (Zero eval returns warning)
- `TestConformanceLevel_TestedInconclusive` (Inconclusive state resolver)
- `TestBuildComplianceReport_IncludesWCAG22` (WCAG 2.2 criteria mapping)
- `TestBuildComplianceReport_508NotApplicableFor22` (Section 508 exclusion)
- `TestBuildComplianceReport_NotAutomatableSCsExplained` (Limitation notes verify)
- `TestBuildComplianceReport_NewFieldsPopulated` (Manual counts & metadata populate check)
- `TestBuildComplianceReport_SCRegistryCount` (Sanity check)
- `TestBuildComplianceReport_NotAutomatableWithRealRule` (Verifies real scan data drives conformance despite NotAutomatable flag)
- `TestBuildComplianceReport_NotAutomatableNoRule` (Verifies non-mapped NotAutomatable SCs remain NotEvaluated)

### Report smoke tests (`internal/report/report_test.go`)
- Exercises every report formatter using `TestReportFormatters_AllSmoke` with a fixture report containing all 6 conformance states (including `Tested – Inconclusive` and the scope limitations metadata block).

---

## 4. Verification

```bash
# Verify build
go build ./...

# Run the new scoring and reporting tests
go test ./internal/scoring/... ./internal/report/...
```
All **19 tests pass cleanly**. (Pre-existing runner/scanner tests are isolated and unmodified).
