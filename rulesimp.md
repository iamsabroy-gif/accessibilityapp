# Plan: closing the "16 Not Implemented" WCAG gaps

Status: assessment + plan only. No code changed. Written 2026-11-02.

## 0. Where "16" comes from (verified)

`wcag_coverage_report.xlsx` (sheet "Summary", last committed 2026-07-17) has 51 SC rows: **27 Implemented, 8 Partially Implemented, 16 Not Implemented**. The Go admin parser (`internal/coverage/report.go`, `NotImplemented++`) counts exactly that column. So 16 is real, and it is SC-level (not rule-level).

The 16: 1.2.4, 1.2.5, 1.4.2, 1.4.5, 2.1.4, 2.2.2, 2.3.1, 2.4.10, 2.5.2, 2.5.4, 3.2.2, 3.2.3, 3.2.4, 3.3.3, 3.3.4, 4.1.3.

Things that disagree (fix while we are in here):
- CLAUDE.md says "63 rules, 14 impl / 21 partial / 8 missing (2026-06-26)". Stale. `WCAGMap` now has 76 entries (includes the WCAG 2.2 phase-4 rules) and the coverage sheet says 27/8/16.
- Sheet "Level" column is wrong for 1.2.4 and 1.2.5 (listed A, actually AA) and 2.4.10 (listed AA, actually **AAA**).
- 2.4.10 is AAA and has no entry in `SCRegistry` (`internal/models/sc_registry.go`). It is not a real A/AA gap. Remove it from the list; it is out of scope for an A/AA scanner. (So the true A/AA gap is 15.)
- `wcag_scanner_implementation_matrix.xlsx` says it covers "57 SC/categories" and has its own status wording; it is not the source of the 16. It also claims heading-order maps to 2.4.10; code maps it to 1.3.1 only.

## 1. Facts from the code that shape the plan

1. **The gate.** `MapToScanResult` / `CalculateAudioEye` only use rules in `WCAGMap`. Unmapped axe rules still show up as violations and still cost penalty-score points, but they are invisible to AudioEye and to the per-SC report rows. axe 4.12.1 already runs (tag `wcag2a`) `blink`, `marquee`, `no-autoplay-audio`, `audio-caption`, `server-side-image-map`, `scrollable-region-focusable`; none are mapped. So today we penalise users for them and credit them to no SC. Mapping is a correctness fix, not just coverage.
2. **AudioEye is `1 - sum(rate)/n`, n = SCs with tested>0.** An SC enters only if some mapped rule produced a violation node or a pass with `node_count > 0` (`scMap` entries with tested==0 are deleted). Consequences:
   - Incomplete-only rules do not change AudioEye at all. They only move the report row to "Tested - Inconclusive".
   - A rule that emits a pass with node_count>0 adds a zero-failure SC, which raises n and **inflates** scores of failing pages. Never emit a pass for "pattern not found / not applicable". Pass only when we actually evaluated nodes and they met a deterministic test.
   - Existing sensory-characteristics (axe_runner.js ~L1042) emits a pass when its heuristic finds nothing. Do not copy that pattern; consider fixing it in a separate change.
3. **Reports already have the right outlet.** `BuildComplianceReport` (`internal/scoring/score.go` ~L438) returns `NotEvaluated` + `LimitationNote` for `NotAutomatable && !hasRule`, and `TestedInconclusive` when a mapped rule returned only incomplete. So "manual review required" needs only `sc_registry.go` flag/wording changes, not new report code. Caution: `score_test.go` `TestBuildComplianceReport_NotAutomatableSCsExplained` asserts 1.2.5, 1.4.2, 2.1.4, 2.5.2, 3.3.3, 4.1.3 are `NotEvaluated` with a non-empty remark on a minimal scan. That should keep passing after mapping (no tested elements and no incomplete means still NotEvaluated, and LimitationNote stays non-empty), but run it.
4. **Two rule homes.** Inline checks live in `scripts/axe_runner.js` (Puppeteer). Modular rules live in `scripts/rules/*.js` (consumed by `native_runner.js` / `build-extension-engine.js` for the extension, WCAG 2.2 phase-4 rules). New checks must land in the axe_runner.js path (that is what the server runs). Whether to also port to `scripts/rules/` for the extension is an open question (section 9).
5. `PassRule.node_count` is already emitted for axe rules (`nodes.length`) and custom passes (`nodeCount || 1`). New custom passes must set `nodeCount` to the real number of nodes evaluated.

## 2. Verdict table (all 16)

Legend: Automatable? = yes / partly / no. FP = false-positive risk. Effort S (<0.5d), M (1-2d), L (3d+).

### Group A: quick wins, axe rule exists, just map it (2 SCs)

| SC | Automatable? | Approach | FP risk | Effort | Notes |
|---|---|---|---|---|---|
| 1.4.2 Audio Control (A) | partly | Map axe `no-autoplay-audio` -> 1.4.2. axe fails/flags `<audio>`/`<video>` that autoplay >3s without controls; unknown duration lands in incomplete. | Low (needs-review path handles uncertainty) | S | Covers only media elements, not Web Audio API or `<iframe>` players. Keep `ManualTestingRequired`. |
| 2.2.2 Pause, Stop, Hide (A) | partly | Map axe `blink` and `marquee` -> 2.2.2. Optional phase B2 below adds CSS-animation / auto-advancing carousel detection as incomplete-only. | Low for blink/marquee (deprecated elements, trivially correct) | S (map) / M (animation extension) | Today `NotAutomatable: true` is wrong once mapped: flip to `ManualTestingRequired`. Mapping alone only catches ancient markup; do not claim "Implemented", call it Partial. |

Bonus (not in the 16, same mechanism, same PR): `audio-caption` -> 1.2.1, `server-side-image-map` -> 2.1.1, `scrollable-region-focusable` -> 2.1.1 (and 2.1.3 is AAA, skip). Needs the same suggestions.go entries.

### Group B: new custom check is feasible (7 SCs)

Rule of thumb for B: emit a **violation** only for a deterministic failure pattern; otherwise emit **incomplete** (never a pass for "not found").

| SC | Automatable? | Approach | FP risk | Effort | Dependencies |
|---|---|---|---|---|---|
| 3.2.2 On Input (A) | partly | Puppeteer, modelled on `on-focus-context-change`: for up to ~15 `select` / radio / checkbox without an adjacent submit button, change the value, watch for navigation, new window, `dialog` or URL change, then restore/`goBack`. Violation on confirmed context change (classic F36/F37 jump-menu). Static pre-filter: inline `onchange` containing `location`/`submit()`. | Medium: apps that legitimately filter in place do not navigate, fine; but SPAs that route on change are real failures only if no advance warning exists. Emit as violation with `impact: serious` only for full-page navigation; SPA route changes go to incomplete. Side effects: only fire on controls in forms with `method=get` or no form; skip `type=password`, payment fields, and anything inside a `post` form. | M | None. Reuse of focus-change harness. |
| 2.5.4 Motion Actuation (A) | partly | DOM/script heuristic like `pointer-gestures`: look in inline scripts and same-origin script bodies for `devicemotion` / `deviceorientation` / `DeviceMotionEvent` listeners. Found -> incomplete ("verify a UI alternative and a disable setting exist"). Nothing found -> no result (not a pass). | Low for the "found" signal; cannot find listeners in minified third-party bundles we do not fetch | S | Optional: CDP `DOMDebugger.getEventListeners` on `window` for the two event types catches non-inline cases. |
| 2.5.2 Pointer Cancellation (A) | partly | Incomplete-only: elements with inline `onmousedown` / `onpointerdown` / `ontouchstart` handlers, or `addEventListener` for those on interactive elements (via CDP `getEventListeners`, cap 50 nodes) without a paired `click`/`up` handler. Hint only. | High if it ever failed hard (down-event handlers are often drag handles or analytics), so keep incomplete-only | M | CDP session; tag nodes with `data-*` and cap volume. |
| 2.1.4 Character Key Shortcuts (A) | partly | Incomplete-only: CDP `getEventListeners(document|window|body)` for `keydown`/`keypress`/`keyup`; also `accesskey` is already mapped to 2.4.1 and is a different thing. Flag "global key handlers present, verify single-character shortcuts can be turned off/remapped". | High as a fail signal (every SPA has a keydown handler), so incomplete-only and cap to one finding per page | S | CDP. Honest: this is a "look here" pointer, not a test. |
| 1.2.5 Audio Description, Prerecorded (AA) | partly | Reuse the `h53-media-description` machinery: for each `<video>`/known embed with no `<track kind="descriptions">` and no adjacent "audio described version" link, emit **incomplete** with the element. Never a violation (description may be burned into the main audio, or an alternate version). Map (dual) `h53-media-description` or add `h95-audio-description` -> 1.2.5. | Medium; hence incomplete-only | S | Fix the sheet level to AA. |
| 3.2.3 Consistent Navigation (AA) | partly | Needs more than one page. Extract ordered list of primary-nav link texts/hrefs from `nav` / `[role=navigation]` / `header a` per page. The scanner already crawls `depth=1` links. Compare relative order of the common links across pages in Go after the crawl; violation when shared links appear in a different relative order; NotEvaluated when depth < 1 or <2 pages. | Medium: A/B-tested or logged-in variants; mitigate by requiring >=3 shared links and same-origin pages only | L | Needs a cross-page aggregation step (new Go function over per-page results; see section 4 phase 3) plus the per-page nav extraction in axe_runner.js. Not a single-page rule, so it does not fit `WCAGMap` rule semantics cleanly: report it as a site-level finding. |
| 3.2.4 Consistent Identification (AA) | partly | Same cross-page machinery: for controls sharing the same `href` target or same icon `src` / `aria-label` across pages, compare accessible names. Violation on differing names for the same function, incomplete otherwise. | Medium-high: "same function" is hard to infer; restrict to identical `href` + same `nav`/`footer` region | L | Depends on 3.2.3 plumbing. Do it second or defer. |

### Group C: cannot be reliably automated, label "manual review required", do not fake a pass (7 SCs; one of them is out of scope)

| SC | Why not | What to do in the product |
|---|---|---|
| 1.2.4 Captions (Live) (AA) | Live streaming cannot be observed in a one-shot scan. | Keep `NotAutomatable`. Fix sheet level (AA). Optionally list detected live-stream embeds (HLS `.m3u8`, YouTube live) as an informational hint. |
| 1.4.5 Images of Text (AA) | Needs visual analysis. OCR (e.g. tesseract.js on image nodes) is possible but slow, heavy in a 10 req/min server, and logo text is exempt, so false positives would be frequent. | Keep `NotAutomatable`. Revisit only if buyers ask; see open questions. |
| 2.3.1 Three Flashes (A) | Real algorithm exists (frame luminance analysis, PEAT-style) but needs screencast capture, animated GIF/video decoding and a defensible methodology. Wrong result here is a safety claim. | Keep `NotAutomatable`. Cheap honest hint only: report presence of animated GIF/APNG/autoplay video as incomplete (no verdict). |
| 3.3.3 Error Suggestion (AA) | Judging whether an error message suggests a correction is language understanding and requires triggering real validation. Submitting forms in a scanner has side effects. | Keep `ManualTestingRequired` (no rule). Existing `error-identification` stays the only 3.3.x automated signal. |
| 3.3.4 Error Prevention (AA) | Requires knowing a form is legal/financial/data-modifying and whether confirm/reverse/review exists. Keyword heuristics (checkout, payment) would mislabel. | Keep `NotAutomatable`. |
| 4.1.3 Status Messages (AA) | Dynamic: needs an interaction and an observed DOM change that is not announced. Presence of `role=status`/`aria-live` proves nothing about coverage. Optional hint: page has forms/search but zero live regions -> incomplete. | Keep `ManualTestingRequired`; hint is optional and low value. |
| 2.4.10 Section Headings (AAA) | Not an A/AA criterion; not a gap. | Remove from the gap list and from the sheet's A/AA table; add it to the AAA note if desired. |

Counts: **A = 2, B = 7, C = 7 (6 real manual-review + 1 out-of-scope AAA)**. Total 16.

Honest bottom line: after this plan, fully automatic coverage of those 16 is **0 SCs**. 2 become "Partial" with a real violation signal on narrow markup, 7 become "Tested - Inconclusive"/Partial heuristics, and 7 stay "Not evaluated, manual review required". That is the truthful ceiling; market it that way.

## 3. Per-rule file checklist

Every new/mapped rule touches the same set. Do all of these or the rule is half-done:

1. `scripts/axe_runner.js` (Group B only): new `page.evaluate` block returning `{violations, passes, incomplete}`; add the arrays to the merged spread lists (~L1195-1255). Violations must carry `impact`, `tags` (`wcagNNN`), `nodes[{html,target}]`; passes must carry `nodeCount` of nodes actually evaluated.
2. `internal/models/wcag_mapping.go`: add `"rule-id": {"x.y.z"}` with a trailing comment. Rule-ID must match the emitted `id` exactly or it is gated out. Group A: `"no-autoplay-audio": {"1.4.2"}`, `"blink": {"2.2.2"}`, `"marquee": {"2.2.2"}`.
3. `internal/models/suggestions.go`: `SuggestionMap` entry (before/after code + FixSteps) for every rule that can emit a violation. Incomplete-only rules need none; nil is handled.
4. `internal/models/sc_registry.go`: adjust `ManualTestingRequired` / `NotAutomatable` and the narrative strings (`SupportNarrative`, `PartialNarrative`, `FailureNarrative`, `LimitationNote`) for each touched SC. Rule: any SC that gains a rule must flip `NotAutomatable` to false (otherwise a violation would be reported as `NotEvaluated` only when `!hasRule`, which is fine, but the flag is then lying).
5. `internal/report/*_static.go`, `vpat_static.go`, `en301549_static.go`: check rows for the touched SCs (static VPAT rows). Verify only; edit if they hard-code "Not evaluated".
6. `openapi.yaml`: no schema change for rules (they are data). Only update enum/examples if rule IDs are listed. Verify with grep before editing.
7. `CLAUDE.md`: update WCAGMAP line and counts (section 7).
8. `wcag_coverage_report.xlsx` and `wcag_scanner_implementation_matrix.xlsx`: regenerate through the `report-generator` agent after merge (do not hand-edit). Fix the Level column for 1.2.4/1.2.5/2.4.10 at the same time.
9. Tests (section 6).

## 4. Phasing (opinionated)

- **Phase 1, one small PR (S, ~half a day): Group A + registry honesty.**
  Map `no-autoplay-audio`, `blink`, `marquee`, plus bonus `audio-caption`, `server-side-image-map`, `scrollable-region-focusable`. Add suggestions. Flip registry flags for 2.2.2 and 1.4.2 narrative. This changes scoring (see section 5), so it ships with a re-baseline.
- **Phase 2 (M, ~3 days): cheap Group B, incomplete-only.** 2.5.4, 2.1.4, 2.5.2, 1.2.5. All are "look here" pointers that do not move AudioEye. Safe to ship together. They turn 4 "Not evaluated" rows into "Tested - Inconclusive" with concrete elements.
- **Phase 3 (M): 3.2.2.** The only Group B rule that can emit a real violation on one page. Needs side-effect guards. Ship alone.
- **Phase 4 (L, only after buyer validation): 3.2.3 / 3.2.4 cross-page.** Needs the Go-side aggregation and a site-level finding concept. Per `implementaion_pdf.md` precedent in memory, defer until a buyer asks; it is the expensive one with medium FP risk.
- **Never / revisit on demand:** every Group C item.
- Optional in phase 2/3: 2.2.2 CSS-animation extension (`document.getAnimations()` with `iterations: Infinity`, duration >5s, no nearby pause control -> incomplete only).

## 5. Keeping scores comparable

- **Penalty score (`Summary.score`)**: unchanged by Group A, because those axe violations already count today (penalty counts every violation regardless of the gate). Group A changes the AudioEye score and the SC report rows. Group B incomplete-only rules change neither score. Only a new violation-capable rule (3.2.2, later 3.2.3/3.2.4) can change the penalty score.
- **AudioEye**: mapping a new violating/passing rule adds an SC to n. Every existing SC's weight drops from 1/n to 1/(n+1). Pages with failures concentrated in few SCs will go **up** slightly when a zero-failure SC enters, and go **down** when the new SC fails. Expect shifts of a few points, up to the grade boundaries (90/75/40/25) on borderline sites.
- **Re-baseline procedure (do once, in Phase 1, repeat when Phase 3 ships):**
  1. Freeze a fixture set of ~20 URLs (or saved HTML fixtures) in `testdata/`, covering clean, broken and media-heavy pages.
  2. Run the scanner on the pre-change build and store `score`, `audioeye_score`, `grade` as a JSON baseline.
  3. Run again on the post-change build, diff, and put the diff table in the PR description. Grade changes get called out explicitly.
  4. Add a `scoring_version` (or `rules_version`) field to `ScanResult.Summary` / report so stored historical scans can be told apart. Open question whether this needs a schema/openapi change (section 9).
- Never use incomplete-only rules to emit passes; that is the single largest source of silent score inflation (section 1, item 2).

## 6. Test strategy

- **Fixtures**: one HTML file per rule under `scripts/fixtures/<rule>/{fail,pass,na}.html`. `na.html` must prove the rule emits nothing (no pass, no violation) when the feature is absent.
- **Node tests (jest, `cd scripts && npm test`)**: extract the page-eval function into a small module exported for testing (as `scripts/checks/wcag122_captions.js` + `wcag122_captions.test.js` already does) and run against fixtures with jsdom where DOM-only (2.5.4, 1.2.5), Puppeteer where behavioural (3.2.2). Assert id, impact, tags, `nodeCount`, and that the `na` fixture yields empty arrays.
- **Go tests**:
  - `internal/models`: test that every ID in a "required rule IDs" list exists in `WCAGMap` (guards the gate), and that every rule that can emit a violation has a `SuggestionMap` entry.
  - `internal/scoring/score_audioeye_test.go`: add cases proving (a) an incomplete-only rule leaves AudioEye unchanged, (b) a pass-with-nodes for a new SC changes n as expected.
  - `internal/scanner`: extend `MapToScanResult` test with a raw payload containing `blink`, `marquee`, `no-autoplay-audio`, and assert they now show in `ViolationGuidelines` with the right SC.
  - `internal/scoring/score_test.go`: run `TestBuildComplianceReport_NotAutomatableSCsExplained` unchanged; add a case where 1.4.2 has an incomplete result -> `TestedInconclusive`.
- **Golden re-baseline test**: the baseline JSON from section 5 checked in; a test (or manual script) fails when a score moves by more than 5 points without the baseline being regenerated.

## 7. Count and doc updates after each phase

- `CLAUDE.md` WCAGMAP line: replace "63 rules, 43 A/AA SCs, 14|21|8 (2026-06-26)" with the generated truth. Suggest computing the numbers with a tiny one-off (or a Go test that prints them) rather than hand-counting: rules = `len(WCAGMap)` (76 today), distinct SCs = unique values.
- Add the new custom IDs to the `custom:` list in `CLAUDE.md`.
- Coverage sheet counts (currently 27 / 8 / 16 over 51 rows): after Phase 1-3 expected roughly 27 / 8+(1.4.2, 2.2.2) / 16-2 and "Not Implemented" rows that become heuristic should be relabelled "Partially Implemented (heuristic, incomplete-only)" **only if the rule exists**, otherwise remain "Not Implemented - manual review". Decide the final wording of the status column once, and keep the Go parser's `normalizeStatus` in sync (it only recognises implemented / partial / not implemented / missing).
- `openapi.yaml`: only if a new field (e.g. `scoring_version`) is added.

## 8. Risks

- **Overclaiming.** Marking heuristic SCs "Implemented" would be the real risk for a compliance product. Use "Partially Implemented" or "Tested - Inconclusive" only.
- **Side effects of behavioural checks** (3.2.2 changes select values and may navigate): restrict to GET/no-form controls, restore state, cap at 15 controls, hard timeout, never touch password/payment inputs. SSRF/private-network rules are unaffected.
- **Scan-time budget**: each Puppeteer behavioural check adds seconds; the endpoint is rate-limited at 10 req/min. Cap nodes and add per-check timeouts.
- **Score drift complaints** after Phase 1; mitigate with the baseline table and release note.
- **Dual engines drift** (`axe_runner.js` vs `scripts/rules/*.js`): a rule implemented in one and not the other produces different results between server and extension.
- **Cross-page checks (3.2.3/3.2.4)** change the data model (site-level findings); biggest scope-creep risk.

## 9. Open questions (not verified)

1. Should new checks also be ported to `scripts/rules/*.js` so the Chrome extension engine has them? I did not trace `native_runner.js` vs `axe_runner.js` parity end to end.
2. Does anything outside the files I read hard-code the 16 / the SC statuses (frontend coverage page, `frontend/app*.js`, `vpat_static.go`)? I grepped the coverage report path and the Go parser only; I did not read the frontend coverage page.
3. I did not execute any scan, `npm test`, or `go test`; all claims about test behaviour (e.g. `NotAutomatableSCsExplained` still passing after mapping) are from reading the code. Run them before merging Phase 1.
4. Whether `no-autoplay-audio` fires in practice on headless Puppeteer (autoplay policy may block playback and push results to incomplete). Needs one real fixture run.
5. Business question: is there buyer demand for cross-page (3.2.3/3.2.4) or OCR (1.4.5)? If not, stop after Phase 3.
6. Whether to introduce a `scoring_version` field (needs api-engineer + openapi change).
7. I did not open the `.numbers` copy of the matrix, nor verify the matrix's "57 SC/categories" total.
