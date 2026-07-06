# WCAG 2.2 Implementation Gap Analysis

*Source of truth: `internal/models/wcag_mapping.go` and `scripts/axe_runner.js`*
*Analysis date: 2026-07-06*

---

## Summary

| Status | Count |
|---|---|
| Fully covered (A/AA) | 12 SCs |
| Partially implemented | 22 SCs |
| Completely missing | 22 SCs |
| **Total A/AA in scope** | **56 SCs** |

The scanner covers ~21% of WCAG 2.2 A/AA criteria fully and touches another 39% partially, leaving 22 criteria with zero automated coverage.

---

## Part 1 — Fully Covered (no action needed)

| SC | Name | Level | Covering Rules |
|---|---|---|---|
| 1.1.1 | Non-text Content | A | `image-alt`, `image-redundant-alt` |
| 1.3.1 | Info and Relationships | A | `label`, `label-title-only`, 7 landmark rules, `list`, `listitem`, `region`, `select-name` |
| 1.3.5 | Identify Input Purpose | AA | `autocomplete-valid` |
| 1.4.3 | Contrast (Minimum) | AA | `color-contrast` |
| 1.4.12 | Text Spacing | AA | `avoid-inline-spacing` |
| 2.4.2 | Page Titled | A | `document-title` |
| 2.4.4 | Link Purpose (In Context) | A | `link-name` |
| 3.1.1 | Language of Page | A | `html-has-lang`, `valid-lang` |
| 3.1.2 | Language of Parts | AA | `html-lang-valid` |
| 3.2.1 | On Focus | A | `on-focus-context-change` |
| 3.3.2 | Labels or Instructions | A | `label`, `form-field-multiple-labels` |
| 4.1.2 | Name, Role, Value | AA | 9 `aria-*` rules, `presentation-role-conflict` |

---

## Part 2 — Partially Implemented

### 1.2.1 — Audio-only and Video-only (Prerecorded) | Level A

**What's done:** `g58-link-to-text-alternative` checks for an adjacent link to a text alternative near `<video>`, `<audio>`, `<object>`, `<iframe>`.

**What's missing:**
- **BUG:** WCAGMap registers `g58-link-to-text-alternative` but `axe_runner.js` emits `g58-media-alternative-link` — the scoring gate drops all G58 results silently.
- Only checks adjacency heuristically (2 siblings); does not confirm the link target is a transcript.
- Does not handle `aria-describedby` pointing to a transcript container.

**Fix:** Align the rule ID in either `wcag_mapping.go` or `axe_runner.js`.

---

### 1.2.2 — Captions (Prerecorded) | Level A

**What's done:** `video-captions-present`, `video-captions-track`, `video-captions-track-src`, `video-captions-track-lang` — checks HTML5 `<video>` for a `<track kind="captions">`.

**What's missing:**
- Only handles HTML5 `<video>`. Embedded YouTube/Vimeo iframes and `<object>`/`<embed>` elements are unchecked.
- Does not validate whether the caption file is reachable or non-empty.
- Does not catch `kind="subtitles"` used incorrectly instead of `kind="captions"`.

**Fix:** Detect iframe `src` pointing to known video platforms and flag as incomplete.

---

### 1.2.3 — Audio Description or Media Alternative (Prerecorded) | Level A

**What's done:** `h53-media-description` checks that `<object>` elements have non-trivial body content (>30 chars or a link with transcript keywords).

**What's missing:**
- The 30-character heuristic is too loose — any `<object>` with any text passes.
- Does not check `<video>` for `<track kind="descriptions">`.
- Does not check `aria-describedby` pointing to a long description.

**Fix:** Add `<track kind="descriptions">` check on `<video>`. Tighten the `<object>` body heuristic.

---

### 1.3.2 — Meaningful Sequence | Level A

**What's done:** Checks `tabindex > 0`, `css order !== 0`, `position: absolute/fixed`, and grid explicit placement.

**What's missing:**
- `meaningful-sequence-absolute` and `meaningful-sequence-grid` are always emitted as `incomplete` regardless of whether visual order actually differs from DOM order — noisy on any page with positioned elements.
- Does not compare visual rendering order against DOM order via coordinates.

**Fix:** Only flag positioned elements whose bounding box top/left coordinates are significantly out of DOM index order.

---

### 1.3.3 — Sensory Characteristics | Level A

**What's done:** `sensory-characteristics` — regex scan of text nodes for colour/shape/location words adjacent to UI element nouns.

**What's missing:**
- Only scans text nodes; does not scan `alt`, `aria-label`, or `title` attributes.
- Regex is over-broad; always emits `incomplete`, never `violation` — never affects score.

**Fix:** Narrow pattern to imperative instruction phrasing (`click the`, `select the`, `press the`). Emit `violation` for high-confidence matches.

---

### 1.3.4 — Orientation | Level AA

**What's done:** `orientation-lock` — scans CSS `@media (orientation:...)` rules for `display: none`/`visibility: hidden`, and inline scripts for `screen.orientation.lock()`.

**What's missing:**
- Only checks `display: none` and `visibility: hidden`; misses `opacity: 0`, `height: 0`, `pointer-events: none`.
- Does not use viewport rotation to actually test reflow.

**Fix:** Use `page.emulateMediaFeatures` or equivalent viewport rotation to test whether content disappears in portrait/landscape.

---

### 1.4.1 — Use of Color | Level A

**What's done:** `color-only-indicator` — checks CSS `:focus`, `:focus-visible`, `:invalid` pseudo-classes for color-only changes.

**What's missing:**
- Only covers form state. Links conveyed only by colour (no underline) are not checked.
- Does not find `<a>` elements with `text-decoration: none` and no other distinguisher from surrounding text.

**Fix:** Add a link-colour check for `<a>` tags where `text-decoration: none` and colour is the only differentiator.

---

### 1.4.4 — Resize Text | Level AA

**What's done:** `resize-text` — sets `document.documentElement.style.fontSize = '200%'` and checks for horizontal scroll or clipped text.

**What's missing:**
- Font-size override is not the same as browser zoom (SC 1.4.4 means viewport-level zoom).
- Does not check whether functionality is lost after resize.

**Fix:** Add `page.evaluate('document.body.style.zoom = "2"')` or browser zoom (`--force-device-scale-factor=2`) as a secondary test.

---

### 1.4.10 — Reflow | Level AA

**What's done:** `meta-viewport` and `meta-viewport-large` — checks whether the meta viewport tag disables user scaling.

**What's missing:**
- These only check the meta tag. The actual reflow test (320px viewport width, no horizontal scroll) is not implemented.
- Sticky/fixed elements that obscure content at narrow widths are not detected.

**Fix:** Add a Puppeteer check: set viewport to `{ width: 320, height: 568 }` and measure `document.documentElement.scrollWidth > 320`.

---

### 1.4.11 — Non-text Contrast | Level AA

**What's done:** `non-text-contrast` — computes contrast ratio of `borderColor` against `backgroundColor` for form inputs, buttons, and ARIA widget roles.

**What's missing:**
- Graphical objects (icons, charts, SVGs) are not checked.
- Uses `borderColor` shorthand; fails on elements with only a bottom border.
- Does not check `outline` as an alternative boundary indicator.
- SVG icon strokes and fills against their backgrounds are not measured.

**Fix:** Extend selector to include `svg[aria-label], img[role="img"], [role="img"]`. Use `getPropertyValue('border-bottom-color')` when full border is transparent.

---

### 1.4.13 — Content on Hover or Focus | Level AA

**What's done:** `content-on-hover` — hovers over tooltip-trigger elements, detects DOM growth >50 bytes, checks whether Escape dismisses the content.

**What's missing:**
- SC 1.4.13 has three requirements; only (1) dismissibility is checked.
- Requirement (2) — hovering over the tooltip itself — is not tested.
- Requirement (3) — persistence — is not tested.
- DOM length delta misses tooltips that toggle `display: none → block`.

**Fix:** After tooltip appears, move pointer to the tooltip element and confirm it remains. Add visibility-state detection as an alternative to DOM length delta.

---

### 2.1.1 — Keyboard | Level A

**What's done:** `nested-interactive` (axe rule) — detects interactive elements nested inside other interactive elements.

**What's missing:**
- One axe rule barely covers this SC. Custom JS widgets (carousels, date pickers, trees) that are not keyboard-operable are not detected.
- `pointer-events: none` on interactive elements is not checked.

**Fix:** Add a check for interactive ARIA roles (`role="listbox"`, `role="tree"`, `role="grid"`, `role="tablist"`) that lack expected keyboard event patterns. Emit as `incomplete`.

---

### 2.1.2 — No Keyboard Trap | Level A

**What's done:** `focus-order-cycling` checks Tab cycling. `focus-order-modal-escape` dispatches an Escape event on dialogs.

**What's missing:**
- Dispatches a JS event rather than a real keypress — pages listening to real events will give false passes.
- Tab cycle check stops at 50 elements; large pages may false-positive as traps.

**Fix:** Use `page.keyboard.press('Escape')` (real keypress simulation) instead of `dispatchEvent`.

---

### 2.2.1 — Timing Adjustable | Level A

**What's done:** `timing-adjustable` — checks `<meta http-equiv="refresh">` and inline `setTimeout`/`setInterval` calls with durations between 3s and 20h.

**What's missing:**
- External script timers (the majority) are not scanned.
- Flags all timers ≥3s, including animation frames and polling — very noisy.
- Does not check for user controls to extend/disable the timer.

**Fix:** Narrow to timers that trigger page-level changes (navigation, `location.href` assignment, dialog appearance).

---

### 2.4.1 — Bypass Blocks | Level A

**What's done:** `bypass` (axe) — checks for a skip link or ARIA landmark. `accesskeys` — checks for unique accesskey values.

**What's missing:**
- Does not verify the skip link actually **works** (moves focus to main content).

**Fix:** Add a Puppeteer check that activates the first skip link and verifies `document.activeElement` moves into `<main>` or `[role="main"]`.

---

### 2.4.3 — Focus Order | Level A

**What's done:** `focus-order-cycling` verifies Tab cycling returns to start. `focus-order-modal-escape` checks Escape key in dialogs.

**What's missing:**
- Only confirms cycling, not logical/meaningful order (the actual SC requirement).
- Does not compare DOM order against visual render order for positioned elements.

**Fix:** After recording tab order, compare vertical `y` coordinates; flag jumps backward >100px as `incomplete`.

---

### 2.4.5 — Multiple Ways | Level AA

**What's done:** `multiple-ways` — checks for search input/role or sitemap link.

**What's missing:**
- Site-level requirement evaluated per-page; a sitemap on another URL will false-fail.
- Navigation menus, breadcrumbs, and table of contents are not checked.
- Never emits `violation`; never affects score.

**Fix:** Extend heuristic to check for `<nav>`, `aria-label="breadcrumb"`, `[aria-current="page"]`, and `rel="index"` links.

---

### 2.4.6 — Headings and Labels | Level AA

**What's done:** `empty-heading`, `page-has-heading-one`, `heading-order`.

**What's missing:**
- SC 2.4.6 requires headings be **descriptive** — not checked.
- Form `<label>` elements with empty or non-descriptive text are not caught.

**Fix:** Flag headings shorter than 3 characters or matching non-descriptive patterns (`untitled`, `section`, `page`) as `incomplete`.

---

### 2.4.7 — Focus Visible | Level AA

**What's done:** `focus-visible` — compares `outline`, `boxShadow`, and `border` before/after focus on up to 30 elements.

**What's missing:**
- Hard-coded 30-element limit under-samples large pages.
- Does not check `background-color` change as a valid focus indicator.
- Does not check `::before`/`::after` pseudo-element focus indicators.

**Fix:** Increase or randomly sample beyond 30 elements. Add `backgroundColor` to the comparison set.

---

### 2.5.1 — Pointer Gestures | Level A

**What's done:** `pointer-gestures` — regex scan of inline scripts for multi-touch patterns.

**What's missing:**
- Only covers inline scripts; external scripts (the majority of gesture handlers) are not scanned.
- Never emits `violation`.

**Fix:** Use `page.evaluate` with Chrome DevTools Protocol to enumerate `touchmove`/`touchstart` listeners on `document` and `window`.

---

### 2.5.3 — Label in Name | Level A

**What's done:** `button-name` (axe) — requires buttons have an accessible name. Adjacent to but not equivalent to this SC.

**What's missing:**
- SC 2.5.3 requires the accessible name **contains** the visible label text. The axe rule `label-content-name-mismatch` covers this and is not in WCAGMap.

**Fix:** Add `"label-content-name-mismatch": {"2.5.3"}` to `wcag_mapping.go`. This axe rule exists in axe-core 4.x and runs automatically under `wcag21a` tags.

---

### 3.3.1 — Error Identification | Level A

**What's done:** `error-identification` — checks `aria-invalid="true"` elements for an associated `aria-describedby` message or adjacent `role="alert"`.

**What's missing:**
- Only catches `aria-invalid="true"`. Native HTML5 constraint validation errors are not checked.
- Does not verify error message text is non-empty or actionable.

**Fix:** After form submission simulation, check if `input:invalid` elements lack `aria-describedby` referencing a non-empty message. Emit as `violation`.

---

### 4.1.1 — Parsing | Level A

**What's done:** `aria-roles`, `duplicate-id-aria`.

**What's missing:**
- Complete tag, duplicate attribute, and nesting validation are not tested.
- **Note:** WCAG 2.2 has effectively deprecated this SC for HTML content served with correct MIME type. Consider zero-weighting.

---

## Part 3 — Completely Missing Success Criteria

### WCAG 2.0 Gaps

| SC | Name | Level | Implementation Difficulty |
|---|---|---|---|
| **1.2.4** | Captions (Live) | AA | Hard — requires runtime stream inspection |
| **1.2.5** | Audio Description (Prerecorded) | AA | Hard — requires content-level analysis |
| **1.4.2** | Audio Control | A | Medium — check `<audio autoplay>` / `<video autoplay>` without mute control |
| **1.4.5** | Images of Text | AA | Medium — detect `<img>` with text-heavy alt or CSS background images |
| **2.2.2** | Pause, Stop, Hide | A | Medium — check CSS `animation`/`transition` and whether pause control exists |
| **2.3.1** | Three Flashes or Below Threshold | A | Hard — requires frame-rate analysis |
| **3.2.2** | On Input | A | Medium — listen for `change` on `<select>` / `<input type="radio">` triggering navigation |
| **3.2.3** | Consistent Navigation | AA | Hard — multi-page analysis required |
| **3.2.4** | Consistent Identification | AA | Hard — multi-page analysis required |
| **3.3.3** | Error Suggestion | AA | Medium — check whether error messages include correction guidance |
| **3.3.4** | Error Prevention (Legal, Financial, Data) | AA | Hard — heuristic only; check for confirmation dialogs |

### WCAG 2.1 Gaps

| SC | Name | Level | Implementation Difficulty |
|---|---|---|---|
| **2.1.4** | Character Key Shortcuts | A | Medium — detect single-key `keydown` handlers without modifier keys |
| **2.5.2** | Pointer Cancellation | A | Medium — check `mousedown`/`touchstart` does not execute the action directly |
| **2.5.4** | Motion Actuation | A | Medium — detect `devicemotion`/`deviceorientation` event listeners |
| **4.1.3** | Status Messages | AA | Medium — check `role="alert"`, `role="status"`, `aria-live` on dynamically updated elements |

### WCAG 2.2 New Criteria — All Missing

| SC | Name | Level | Implementation Difficulty |
|---|---|---|---|
| **2.4.11** | Focus Not Obscured (Minimum) | AA | Medium — check fixed/sticky element intersection with focused element bbox |
| **2.4.13** | Focus Appearance | AA | Hard — measure focus indicator geometry and contrast ratio |
| **2.5.7** | Dragging Movements | AA | Medium — detect `dragstart`/`dragover` without a single-pointer alternative |
| **2.5.8** | Target Size (Minimum) | AA | Medium — measure bounding boxes of interactive elements against 24×24px |
| **3.2.6** | Consistent Help | A | Hard — multi-page; per-page `incomplete` if chat/contact element found |
| **3.3.7** | Redundant Entry | A | Hard — requires session-state awareness across form steps |
| **3.3.8** | Accessible Authentication (Minimum) | AA | Medium — detect CAPTCHA patterns and third-party CAPTCHA domains |

> **None of the 6 in-scope WCAG 2.2-specific A/AA success criteria have any implementation.**

---

## Part 4 — WCAG 2.2 Criteria Quick Reference

| SC | Name | Level | Status |
|---|---|---|---|
| 2.4.11 | Focus Not Obscured (Minimum) | AA | **MISSING** |
| 2.4.12 | Focus Not Obscured (Enhanced) | AAA | Out of A/AA scope |
| 2.4.13 | Focus Appearance | AA | **MISSING** (exists check only, no geometry/contrast) |
| 2.5.7 | Dragging Movements | AA | **MISSING** |
| 2.5.8 | Target Size (Minimum) | AA | **MISSING** |
| 3.2.6 | Consistent Help | A | **MISSING** |
| 3.3.7 | Redundant Entry | A | **MISSING** |
| 3.3.8 | Accessible Authentication (Minimum) | AA | **MISSING** |
| 3.3.9 | Accessible Authentication (Enhanced) | AAA | Out of A/AA scope |

---

## Part 5 — Active Bug: Rule ID Mismatch (1.2.1 / G58)

`wcag_mapping.go` registers `"g58-link-to-text-alternative"` but `axe_runner.js` emits violations with `id: 'g58-media-alternative-link'`. The WCAGMap scoring gate silently excludes all G58 results. **Fix immediately** — align the ID in either file.

---

## Part 6 — Priority Implementation Order

### Priority 1 — Quick wins, zero or low complexity

1. **Fix G58 rule ID mismatch** (1.2.1) — one-line change
2. **Add `label-content-name-mismatch` to WCAGMap** (2.5.3) — axe rule already runs; just needs a mapping entry in `wcag_mapping.go`
3. **2.5.8 Target Size** — measure `getBoundingClientRect()` on all interactive elements; flag `width < 24 || height < 24`
4. **1.4.2 Audio Control** — check `<audio autoplay>` and `<video autoplay>` without adjacent pause/mute control
5. **4.1.3 Status Messages** — check elements with dynamic content lacking `aria-live`, `role="alert"`, or `role="status"`
6. **2.4.11 Focus Not Obscured** — for each focused element, check intersection with `position: fixed` / `position: sticky` elements with `z-index > 0`
7. **3.2.2 On Input** — attach `change` listener to `<select>` and `<input type="radio">` and monitor for URL change or dialog appearance

### Priority 2 — Medium effort, WCAG 2.2 completeness

8. **2.4.13 Focus Appearance** — extend `focus-visible` to measure focus indicator perimeter and contrast ratio
9. **3.3.8 Accessible Authentication** — detect CAPTCHA `<img>` inside `<form>`, or third-party CAPTCHA script domains (recaptcha.net, hcaptcha.com)
10. **2.5.7 Dragging Movements** — enumerate `dragstart`/`dragover` listeners; verify a non-drag alternative exists
11. **1.4.10 Reflow** — add viewport resize to 320px and measure horizontal scroll
12. **2.1.4 Character Key Shortcuts** — enumerate `keydown` listeners for single printable keys without Ctrl/Alt/Meta
13. **2.5.2 Pointer Cancellation** — check that `mousedown`/`touchstart` handlers do not directly invoke the action

### Priority 3 — Enhance existing partials

14. Extend `non-text-contrast` (1.4.11) — add SVG icon and graphical object coverage
15. Extend `resize-text` (1.4.4) — add zoom-level test in addition to font-size override
16. Fix modal escape (2.1.2) — replace `dispatchEvent` with `page.keyboard.press('Escape')`
17. Extend `error-identification` (3.3.1) — add post-submission `input:invalid` check
18. Add 3.3.3 Error Suggestion — check whether `role="alert"` messages include actionable correction text
19. 2.5.4 Motion Actuation — detect `devicemotion`/`deviceorientation` event listeners

### Priority 4 — Hard / multi-page (document as known limitations)

| SC | Reason |
|---|---|
| 1.2.4 Captions (Live) | Requires runtime stream inspection |
| 1.2.5 Audio Description | Requires content-level analysis |
| 2.3.1 Three Flashes | Requires frame-rate capture |
| 3.2.3 Consistent Navigation | Multi-page analysis required |
| 3.2.4 Consistent Identification | Multi-page analysis required |
| 3.2.6 Consistent Help | Multi-page; emit per-page `incomplete` if help element found |
| 3.3.7 Redundant Entry | Requires session-state awareness |

---

## Coverage Projection

If Priority 1 and 2 items are implemented:

| Status | Current | After P1+P2 |
|---|---|---|
| Fully covered | 12 SCs | ~19 SCs |
| Partially covered | 22 SCs | ~24 SCs |
| Missing | 22 SCs | ~13 SCs |
| Known limitations | 0 | ~7 SCs |
