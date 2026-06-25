# WCAG 1.3.2 Meaningful Sequence — Implementation Feasibility Analysis

## Executive Summary

WCAG 1.3.2 (Meaningful Sequence) is **not currently implemented** in the web scanner as confirmed by the `wcag_scanner_implementation_matrix.xlsx` (44 rows, no 1.3.2 entry). Additionally, **axe-core does not provide any native rule tagged for `wcag132`** (verified by inspecting `node_modules/axe-core/axe.js`). The existing `aria-hidden-body` → `1.3.2` mapping in `internal/models/wcag_mapping.go` is a custom project mapping; axe-core natively tags `aria-hidden-body` under `wcag131` (1.3.1) and `wcag412` (4.1.2), not 1.3.2.

This document analyzes the five requested techniques and provides actionable implementation recommendations.

---

## Technique-by-Technique Analysis

### H34 — Using Unicode RLM/LRM to Mix Text Direction Inline

| Attribute | Assessment |
|-----------|------------|
| **Purpose** | Ensure bidirectional text (e.g., Arabic/Hebrew mixed with English) reads correctly when neutral characters (spaces, punctuation) appear between directional runs. |
| **Automatability** | **LOW** — Not recommended for automated implementation. |
| **Rationale** | Detecting incorrect bidi placement requires natural-language analysis (identifying the language/script of each text run, determining paragraph direction, and checking whether the Unicode bidi algorithm would misplace neutral characters). A scanner would need to: <br>1. Detect mixed-direction text runs.<br>2. Identify neutral characters at directional boundaries.<br>3. Determine if the bidi algorithm produces wrong results.<br>4. Check for `&lrm;`/`&rlm;` or U+200E/U+200F presence.<br>Steps 1–3 are NLP-hard and prone to false positives across languages. |
| **Suggested Approach** | Manual review only. If desired, a very limited heuristic could be added to the scanner's **informational / incomplete** category: flag `<p>` elements whose `dir` attribute differs from the document `dir` and contain punctuation marks at the boundary, warning that human review is needed. |

---

### H56 — Using the `dir` Attribute on an Inline Element to Resolve Nested Directional Runs

| Attribute | Assessment |
|-----------|------------|
| **Purpose** | Mark inline text direction changes to help assistive technologies and browsers render content in the correct order. |
| **Automatability** | **LOW** — Not recommended for automated implementation. |
| **Rationale** | Similar to H34, this requires understanding the text content's actual directionality. A `<span>` with `dir="rtl"` is only correct if it contains RTL text nested inside LTR content. Automated detection of whether the `dir` attribute is *correctly* applied is not feasible without language detection. |
| **Suggested Approach** | Manual review only. A limited scanner check could count inline elements with `dir` attributes as a **pass indicator** (presence of the technique), but cannot verify correctness. |

---

### C6 — Positioning Content Based on Structural Markup

| Attribute | Assessment |
|-----------|------------|
| **Purpose** | Use CSS positioning in a way that preserves the structural reading order of the DOM (e.g., using CSS to place navigation after content visually while keeping it before in the source). |
| **Automatability** | **LOW** — Not recommended for automated implementation. |
| **Rationale** | This is a design-pattern technique. Whether CSS positioning is "based on structural markup" is a semantic judgment that cannot be made by static analysis. The scanner cannot distinguish between legitimate visual reordering (e.g., a sticky footer) and accessibility-breaking reordering without understanding the content's meaning. |
| **Suggested Approach** | Manual review only. Cannot be reliably encoded as a pass/fail rule. |

---

### C8 — Using CSS `letter-spacing` to Control Spacing Within a Word

| Attribute | Assessment |
|-----------|------------|
| **Purpose** | Prevent authors from using blank characters (spaces, `&nbsp;`, zero-width spaces) to create visual letter spacing, because screen readers may read those blank characters and alter pronunciation. |
| **Automatability** | **MEDIUM** — **Recommended for partial implementation.** |
| **Rationale** | The failure mode (F32) is easier to detect than the technique itself: find text nodes where a single word contains multiple consecutive spaces or HTML entities used as spacing (`&nbsp;`, `&#8203;`, `&ensp;`, `&emsp;`) and verify that the element does **not** have a computed `letter-spacing` CSS value. |
| **Implementation Sketch** | In `axe_runner.js`, add a custom check that:<br>1. Traverses all text nodes in the document.<br>2. Detects words with internal spacing characters (regex `\w\s{2,}\w` or entity-based spacing).<br>3. Checks computed `letter-spacing` on the parent element.<br>4. If no `letter-spacing` is found, flag as a **violation** (F32) or **incomplete** review item. |
| **Confidence** | Moderate. False positives may occur in legitimate preformatted text or code blocks, which should be excluded. |

---

### C27 — Making the DOM Order Match the Visual Order

| Attribute | Assessment |
|-----------|------------|
| **Purpose** | Ensure that the programmatic (DOM) reading order matches the visual presentation order, so screen-reader users and keyboard users experience content in the same sequence as sighted users. |
| **Automatability** | **MEDIUM-HIGH** — **Recommended for implementation.** |
| **Rationale** | While a perfect DOM-vs-visual comparison requires pixel-level layout analysis, the **common failure modes** are highly detectable via CSS property inspection using Puppeteer's `page.evaluate()` + `getComputedStyle`. The most impactful checks are: |
| **Recommended Checks** | 1. **`tabindex > 0`** — Elements with a positive `tabindex` value force a focus order that diverges from DOM order. This is a straightforward selector check.<br>2. **`order` property in flexbox/grid** — Any element with `display: flex` or `display: grid` parent and a computed `order` ≠ `0` has been visually reordered. Flag as a warning/violation.<br>3. **CSS Grid placement out of natural order** — Elements with `grid-row` or `grid-column` values that place them before earlier siblings in the grid. Check for explicit grid placement properties.<br>4. **`position: absolute` / `position: fixed` on meaningful content** — Content taken out of normal flow and repositioned via `top`/`left`/`right`/`bottom` may appear in a visual order unrelated to DOM order. Can be detected and flagged for review.<br>5. **`float` reordering** — Heavy use of `float` on non-tabular content can create visual columns that linearize incorrectly. Heuristic: if multiple sibling blocks all have `float: left/right` and collectively form a multi-column layout without an explicit `display: flex`/`grid` or structural list/table wrapper, flag for review.<br>6. **CSS `transform` / `translate` that reorders visually** — Large `translateX`/`translateY` values may move elements out of their DOM sequence. |
| **Implementation Sketch** | In `axe_runner.js`, add a custom `check-meaningful-sequence` function that:<br>1. Queries all elements with `tabindex` attribute and flags those with `tabindex > 0`.<br>2. For each element, reads `getComputedStyle(element)` and checks `order`, `gridRow`, `gridColumn`, `cssFloat`, `position`, `transform`.<br>3. Builds a list of suspicious elements and reports them as **violations** (for `tabindex > 0` and `order ≠ 0`) or **incomplete** (for `position: absolute/fixed`, grid placement, float layouts). |
| **Confidence** | High for `tabindex > 0` and `order` checks. Medium for `position: absolute/fixed` and grid placement (some legitimate uses exist). Can be tuned by whitelisting decorative elements or known UI patterns (e.g., skip links). |

---

## Summary Matrix

| Technique | Automatability | Recommendation | Priority |
|-----------|---------------|----------------|----------|
| **H34** (Unicode RLM/LRM) | LOW | Do not implement; manual review only. | — |
| **H56** (`dir` on inline elements) | LOW | Do not implement; manual review only. | — |
| **C6** (Structural positioning) | LOW | Do not implement; manual review only. | — |
| **C8** (CSS `letter-spacing`) | MEDIUM | **Implement as custom check** in `axe_runner.js` for F32-style detection (blank characters used for spacing). | Medium |
| **C27** (DOM order matches visual) | MEDIUM-HIGH | **Implement as custom check** in `axe_runner.js` focusing on `tabindex > 0`, `order` property, CSS grid placement, and `position: absolute/fixed`. | **High** |

---

## Suggested Implementation Plan

### Phase 1 — C27 (Highest Impact)
Add a custom check block in `scripts/axe_runner.js` after the existing G58/H53 checks. The check should:

1. Iterate over all elements in the document body.
2. For each element, capture `getComputedStyle` properties.
3. Flag violations for:
   - `tabindex > 0` (violates natural reading order).
   - Parent `display: flex/grid` + child `order !== 0`.
4. Flag incomplete items for:
   - `position: absolute/fixed` with meaningful content (not `width: 0/height: 0` decorative elements).
   - Explicit `grid-row`/`grid-column` on grid children.
   - Multi-column `float` layouts without a semantic container.

Map the custom rule IDs to WCAG `1.3.2` in `internal/models/wcag_mapping.go`:
```go
"meaningful-sequence-tabindex":    {"1.3.2"},
"meaningful-sequence-css-order":   {"1.3.2"},
"meaningful-sequence-absolute":    {"1.3.2"},
"meaningful-sequence-grid":        {"1.3.2"},
```

### Phase 2 — C8 (Medium Impact)
Add a second custom check block in `scripts/axe_runner.js` that:

1. Walks text nodes (skipping `<pre>`, `<code>`, `<script>`, `<style>`).
2. Detects sequences where a word contains two or more consecutive whitespace characters or spacing entities (`&nbsp;`, `&ensp;`, `&emsp;`, `&#8203;`).
3. Checks the computed `letter-spacing` of the parent element.
4. If no `letter-spacing` is applied, reports an **incomplete** or **violation** under a custom rule ID mapped to `1.3.2`.

### Phase 3 — Documentation Update
Add a new row to `wcag_scanner_implementation_matrix.xlsx`:

| WCAG Guideline | Techniques Used | Logic for Tags | Logic Implementation |
|----------------|-----------------|----------------|----------------------|
| 1.3.2 Meaningful Sequence (A) | C27, C8, F1, F32 | `body`, `* [tabindex]`, `* [style*="order"]`, `* [style*="position"]`, `* [style*="grid"]`, text nodes | `meaningful-sequence-tabindex`: flag elements with `tabindex > 0`. `meaningful-sequence-css-order`: flag flex/grid children with computed `order != 0`. `meaningful-sequence-absolute`: flag non-decorative elements with `position: absolute/fixed` that may visually reorder content. `meaningful-sequence-letter-spacing`: flag text nodes with blank-character spacing but no `letter-spacing` CSS. |

---

## Appendix — Why H34, H56, and C6 Are Not Suitable for Automation

- **H34 / H56**: Require language/script detection and understanding of the Unicode Bidirectional Algorithm's behavior for mixed-direction text. Static scanners cannot determine whether punctuation marks are correctly placed without rendering the text in a bidirectional context and comparing with the intended semantics.
- **C6**: Is a positive design guideline ("position based on structure") rather than a detectable failure. The opposite failure (F1 — changing meaning by positioning with CSS) is partially detectable, but C6 itself is about author intent and cannot be inferred from code.

For completeness, **F1** (Failure of 1.3.2 due to positioning information with CSS) is partially covered by the C27 implementation above, because the same CSS properties (`order`, `float`, `position`) that break meaningful sequence are the mechanisms of F1.

