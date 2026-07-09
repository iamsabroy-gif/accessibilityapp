# Web Accessibility Scanner — FSD & Correctness Walkthrough

This document walks through the complete implementation of the **Functional Specification Document (FSD)** compliance-reporting integrity gaps, alongside the **conformance-logic short-circuit bugfix** implemented in the second phase.

---

## 1. Summary of Implementations

A total of **6 architectural gaps** and **1 critical bug** were closed:

| Gap / Issue | Impact / Problem | Resolution |
|-------------|------------------|------------|
| **Gap 1** | WCAG 2.2 criteria were completely skipped during report builds. | Removed WCAG 2.2 `continue` skip; added 7 WCAG 2.2 criteria to the registry. |
| **Gap 2** | Unmapped A/AA criteria rendered silently with blank remarks, confusing users. | Flagged all 15 previously-unmapped SCs as `NotAutomatable: true` with detailed explanation notes. |
| **Gap 3** | Compliance % calculation ignored the count of incomplete tests in the denominator. | Included `incomplete` rule results in the compliance denominator to avoid overstating scores. |
| **Gap 4** | AudioEye scored a perfect `100 / A` when no success criteria were actually evaluated. | Gated zero-evaluations to return `Score: 0 / Grade: F` with an explicit warning banner. |
| **Gap 5** | Report generation scans were hardcoded to WCAG `AAA` instead of matching config. | Integrated `config.GetWCAGLevel()` to respect configured target levels dynamically. |
| **Gap 6** | Reports lacked scope metadata. Users couldn't see scan levels or manual-test needs. | Injected a comprehensive **Scope & Limitations** section into all 9 compliance formatters. |
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
            if remarks != "" {
                remarks += " "
            }
            remarks += scMeta.LimitationNote
        }
    }
    ```
  - Populates new `ComplianceReport` fields for metadata.

### Models (`internal/models/`)
- Added `ConformanceTestedInconclusive` to `conformance.go`.
- Added 7 WCAG 2.2 criteria (2.4.11, 2.4.13, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8) to `sc_registry.go`.
- Flagged all **15 previously-unmapped/silent A/AA SCs** as `NotAutomatable:true` in `sc_registry.go` (1.2.4, 1.2.5, 1.4.2, 1.4.5, 2.1.4, 2.2.2, 2.3.1, 2.5.2, 2.5.4, 3.2.2, 3.2.3, 3.2.4, 3.3.3, 3.3.4, 4.1.3) with LimitationNotes.

### UI & Reporting (`internal/report/`)
- Injected `ScopeBlockHTML` via a new shared module `scope_block.go`.
- Added CSS classes for `.tested-inconclusive` (purple styling for inconclusive results) and `.scope-block` to all formatters.
- In addition to the other 8 formatters, **ADA report generation** now fully builds and supports the `ComplianceReport` and dynamically renders the `Scope & Limitations` block (using Option A from reviews).
- Output variables in `ScopeBlockHTML` are securely escaped using `template.HTMLEscapeString` before rendering as `template.HTML`.

---

## 3. Test Coverage

A total of 15 FSD-specific test functions and 11 report formatter smoke subtests were added and validated:

### Scoring Engine tests (`internal/scoring/score_test.go`)
- `TestCalculate_CompliancePctIncludesIncomplete` (Denominators includes incomplete)
- `TestCalculate_ZeroIncompleteUnchanged` (Regression guard)
- `TestCalculateAudioEye_ZeroSCsReturnsWarning` (Zero eval returns warning)
- `TestConformanceLevel_TestedInconclusive` (Inconclusive state resolver)
- `TestConformanceLevel_NotEvaluatedWhenNoIncomplete` (NotEvaluated resolver with incomplete false)
- `TestConformanceLevel_NotEvaluatedWhenNoRule` (NotEvaluated resolver with hasRule false)
- `TestBuildComplianceReport_IncludesWCAG22` (WCAG 2.2 criteria mapping)
- `TestBuildComplianceReport_508NotApplicableFor22` (Section 508 exclusion)
- `TestBuildComplianceReport_NotAutomatableSCsExplained` (Limitation notes verify)
- `TestBuildComplianceReport_NewFieldsPopulated` (Manual counts & metadata populate check)
- `TestBuildComplianceReport_SCRegistryCount` (Sanity check)
- `TestBuildComplianceReport_NotAutomatableWithRealRule` (Verifies real scan data drives conformance despite NotAutomatable flag)
- `TestBuildComplianceReport_NotAutomatableNoRule` (Verifies non-mapped NotAutomatable SCs remain NotEvaluated)

### Report smoke tests (`internal/report/report_test.go`)
- Exercises every report formatter (now including **ADA**) using `TestReportFormatters_AllSmoke` with a fixture report containing all 6 conformance states (including `Tested – Inconclusive` and the scope limitations metadata block).
- Tests assert that no output is HTML-escaped as raw text (`&lt;div class=`) and that HTML-injection fields in `AudioEyeWarning` are correctly sanitized.

---

## 4. Verification

```bash
# Verify build
go build ./...

# Run the complete test suite
go test ./...
```
All **test suites pass cleanly** and are fully green.
