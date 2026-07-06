# Web Accessibility Scanner — State of the Build
**Dateline: 2026-07-06**
*Updated from MARKET_STUDY.md (2026-07-05). Covers the "native engine updates" commit landed 2026-07-06.*

---

## Headline

**As an engine: 54/100. As a product: 44/100.**

The native engine commit is the most architecturally significant change in this project's history. It converts the product from an axe-core wrapper — undifferentiated, replicable in a weekend — into a programmable rule platform. That is real and defensible. It is also early and fragile in three specific ways that must be fixed before the platform's value can be built on top of it. Net effect on market readiness: +4 points, driven entirely by differentiating features and a marginal DX gain. Coverage scores went *down* — that is the honest call, and it is explained below.

---

## 1. Technical State Assessment

### What the Native Engine Actually Changed

The `scripts/native_engine.js` + `scripts/native_runner.js` + `scripts/rules/` system introduces a clean two-tier execution model for accessibility rules:

- **`type: "dom"` rules (62 of 66):** serialized to strings in Node, injected into page context, run synchronously by `window.NativeEngine.run()`. One pass over the live DOM, zero CDP round-trips per rule.
- **`type: "puppeteer"` rules (4 of 66):** async, run in Node context, can dispatch keyboard events, measure viewport changes, wait for timers.

The rule contract — `{ id, type, description, help, helpUrl, tags, impact, evaluate }` — is minimal, composable, and self-contained. Each of the 66 files in `scripts/rules/` is independently testable and independently shippable. `native_engine.js` already wraps each rule execution in try/catch, so a single throwing rule degrades gracefully rather than killing the scan. This is production-grade design at the rule-runner level.

The significance: the rule contract *is* the product wedge. Every paying use case (custom component rules, versioned rule packs, CI enforcement, white-label engines) hangs off this interface. Which is exactly why its current fragility is the critical path.

### Risk 1 — Injection Mechanism (High severity, 1–2 days to fix)

`native_runner.js` line 102 uses `eval()` to reconstruct DOM rule functions from serialized strings:

```js
await page.evaluate((rules) => {
  for (const r of rules) {
    let fn;
    eval(`fn = ${r.evaluateStr}`);
    window.NativeEngine.addRule({ ...r, evaluate: fn });
  }
}, domRules);
```

**Corrected diagnosis:** `native_runner.js:53` calls `page.setBypassCSP(true)` before navigation, which in Chromium disables CSP enforcement on the main frame including `unsafe-eval` restrictions. The "silently fails on CSP-hardened sites" claim should be reproduced against a real CSP fixture before being cited — it may not be the failure mode. The *real* problem is more fundamental: `.toString()` serialization strips closures and module-scope references. A rule author who writes `const SELECTORS = [...]` above their `evaluate` function ships a rule that throws `ReferenceError` at scan time. The per-rule try/catch saves the scan but silently drops the rule — undetectable by the caller. This is a landmine directly under the custom-rule authoring wedge. **The injection mechanism defines the authoring contract, which is why this fix must precede publishing any SDK.**

**Fix — Option A (page.addScriptTag):**

```js
const registration = domRules.map(r =>
  `window.NativeEngine.addRule({ ...${JSON.stringify(metaOf(r))}, evaluate: ${r.evaluateStr} });`
).join('\n');
await page.addScriptTag({ content: `(function(){\n${registration}\n})();` });
```

The function source becomes a function expression in real script text — parsed by the normal script pipeline, no `eval`. Pair with: a free-variable validator that parses each `evaluateStr` at load time using a short AST walk and rejects rules with closures. This turns the silent runtime failure into a build-time error and becomes part of the SDK contract. Effort: 1–2 days including a CSP test fixture.

### Risk 2 — G58 Rule ID Mismatch Bug (High severity, 1-line fix)

`wcag_mapping.go` registers `"g58-link-to-text-alternative"` but `axe_runner.js` (the **axe** engine) emits violations with `id: 'g58-media-alternative-link'`. The WCAGMap scoring gate silently drops all G58 results when running the axe engine — the SC 1.2.1 rule has never contributed to scoring. The native engine (`scripts/rules/g58.js`) already uses the correct ID, so switching to native silently fixes this bug as a side effect.

**Fix:** grep `axe_runner.js` for `g58-media-alternative-link` and change the emitted `id` to `g58-link-to-text-alternative`. Do **not** add a WCAGMap alias — that entrenches the drift and creates a second source of truth. Fix at source.

### Risk 3 — Rule Parity Gap (High-trust severity, undisclosed)

Native engine: 66 rules. axe-core 4.12: ~100 rules. When `ACTIVE_ENGINE=native`, users get fewer checks with no disclosure in the API response. The gap clusters into categories with real enterprise blast radius:

| Missing category | Key absent rules | Blast radius |
|---|---|---|
| Data tables | td-headers-attr, th-has-data-cells, scope-attr-valid, table-duplicate-name | Enterprise dashboards, gov/finance sites — table-heavy by nature |
| Frames/iframes | frame-title, frame-title-unique, frame-focusable-content | Worse than missing rules: `native_runner.js` never iterates `page.frames()` — **all iframe content is invisible to every rule** |
| ARIA widget names | aria-command-name, aria-dialog-name, aria-meter-name, aria-toggle-field-name, aria-treeitem-name, aria-input-field-name | Custom-widget SPAs — modern enterprise SaaS |
| Alt-text long tail | area-alt, input-image-alt, object-alt, role-img-alt, svg-img-alt | Legacy pages and SVG-heavy UIs |

With native engine active, scores are inflated because fewer rules means fewer penalties. A buyer comparing against an axe-based competitor will conclude the scanner is wrong, not lenient. **Silent under-coverage is a trust-destroying defect for a compliance product.** Cheap mitigation: add `engine`, `rules_executed` (count + IDs), and `sc_coverage` to `ScanResult` — honest disclosure before parity work.

### Risk 4 — Performance (Medium severity, 1–2 days to fix)

`native_runner.js:156–157`: per-violation bounding boxes are fetched via nested `Promise.all` of individual `page.evaluate` calls — O(violations × nodes) CDP round-trips. Additionally, line 182 runs a full-page JPEG screenshot unconditionally regardless of whether `visual_report` was requested in `ScanReq`. On violation-heavy pages on Render's small instances, this combination pushes into timeout territory. Fix: one `page.evaluate` that resolves all selectors and returns a rect map (N round-trips → 1); gate screenshot behind `req.visual_report`.

### Risk 5 — WCAGMap as Hand-Maintained Source of Truth (Architectural)

The G58 bug is an instance of a class problem: `internal/models/wcag_mapping.go` is a hand-maintained Go map gating a JS rule set, and they can drift silently. The scorer drops unmapped rule IDs without logging. Long-term fix: add `wcag` metadata to the rule contract (`wcag: ["1.2.1"]`), emit `wcag_mapping.go` via `go generate` from rule files, and make the scorer error-log on any unmapped ID rather than silently discarding. One source of truth, enforced at build time.

---

## 2. WCAG Coverage Gap Analysis

### Current Honest Coverage Claim

| Status | Count | Pct of 56 A/AA SCs |
|---|---|---|
| Fully covered | 12 | 21% |
| Partially covered | 22 | 39% |
| Completely missing | 22 | 39% |
| WCAG 2.2-specific A/AA | 0 of 6 | 0% |

The 66-rule native engine does not change these numbers. The rules it contains replicate functionality previously embedded inline in `axe_runner.js` — it's the same checks, now modularized. Coverage count did not increase; rule maintainability increased.

### Highest-ROI Gaps to Close

**Priority 1 — Quick wins (1–3 days each):**
1. Fix G58 ID mismatch — one line, SC 1.2.1 starts scoring (axe engine only)
2. Add `label-content-name-mismatch` to WCAGMap — axe rule already runs under `wcag21a` tags, just missing a map entry (SC 2.5.3)
3. **2.5.8 Target Size (Minimum)** — measure `getBoundingClientRect()` on all interactive elements; flag `width < 24 || height < 24`. Easiest WCAG 2.2 win. Ships as a native rule + fixture. (SC 2.5.8)
4. **1.4.2 Audio Control** — check `<audio autoplay>` and `<video autoplay>` without adjacent pause/mute control. (SC 1.4.2)
5. **4.1.3 Status Messages** — check elements with dynamic content lacking `aria-live`, `role="alert"`, or `role="status"`. Emit as `incomplete` where uncertain. (SC 4.1.3)
6. **2.4.11 Focus Not Obscured** — for each focused element, check intersection with `position: fixed` / `position: sticky` elements with `z-index > 0`. (SC 2.4.11)
7. **3.2.2 On Input** — attach change listener to `<select>` and `<input type="radio">` and monitor for URL change or dialog appearance. (SC 3.2.2)

**Priority 2 — Medium effort, WCAG 2.2 completeness:**
8. 2.4.13 Focus Appearance — extend `focus-visible` to measure indicator geometry and contrast ratio
9. 3.3.8 Accessible Authentication — detect CAPTCHA `<img>` in `<form>`, or third-party CAPTCHA domains (recaptcha.net, hcaptcha.com)
10. 2.5.7 Dragging Movements — enumerate dragstart/dragover listeners; verify non-drag alternative exists
11. 1.4.10 Reflow — add viewport resize to 320px and measure `scrollWidth > 320`
12. 2.1.4 Character Key Shortcuts — enumerate keydown listeners for single printable keys without modifier

**Coverage projection after P1+P2:** fully covered: 12 → ~19 SCs; missing: 22 → ~13 SCs; WCAG 2.2: 0 → 4–5 of 6.

**Hard ceilings (document as known limitations, do not chase):** 1.2.4 Captions (Live), 1.2.5 Audio Description, 2.3.1 Three Flashes, 3.2.3/3.2.4 Consistent Navigation/Identification (require multi-page analysis), 3.3.7 Redundant Entry (requires session-state awareness).

---

## 3. Updated Market Readiness Score

| Sub-category | Weight | Prior (2026-07-05) | New (2026-07-06) | Delta | Justification |
|---|---|---|---|---|---|
| Rule coverage & accuracy | 25% | 58 | **54** | **−4** | Native engine has 66 rules vs axe-core's ~100 — coverage *regresses* when native is active. Still 22 SCs missing, 0 of 6 WCAG 2.2. G58 bug still live in axe engine. The native rules are unvalidated against W3C ACT test cases. Score drops because the new engine is not yet a coverage improvement; it is an architectural bet. |
| Developer experience (API, CI/CD) | 20% | 45 | **47** | **+2** | Runtime engine switching via admin API is a genuine dev-facing capability. Marginal. Still zero CI/CD, zero browser extension, zero SDK, no published docs. +2 is generous. |
| Enterprise readiness | 20% | 20 | **20** | **0** | Nothing shipped touches this axis. No user management, RBAC, dashboard, audit log, SSO, or SLA documentation. Unchanged. |
| Reporting & compliance | 15% | 28 | **28** | **0** | No VPAT, no 508/EN 301 549 mapping, no change to xlsx/HTML output. Unchanged. |
| Differentiating features | 20% | 55 | **63** | **+8** | The modular plugin architecture with a clean rule contract is the first thing in this codebase a competitor cannot trivially copy. Runtime engine independence removes the axe-core legal/dependency risk. The two-tier execution model (dom vs puppeteer) is the right design for a rule SDK. This is a real, structural asset. |

**New weighted score:**
```
0.25(54) + 0.20(47) + 0.20(20) + 0.15(28) + 0.20(63)
= 13.5 + 9.4 + 4.0 + 4.2 + 12.6
= 43.7 → 44/100
```

**Up 4 points from 40/100.** The entire gain comes from architectural differentiation. Coverage declined. Enterprise readiness and reporting are unchanged. The score would have been 48 if the native engine had achieved rule parity on day one — those 4 points are recoverable in Phase 1+4.

---

## 4. Strategic Impact of the Native Engine

### What It Actually Does (Defense, Not Offense)

axe-core is MIT/MPL 2.0 licensed. The reasons to build a native engine are: (1) remove a legal dependency risk — Deque's commercial terms complicate building a competing product on their open-source core; (2) own the detection layer so clients can extend it. The native engine is primarily a risk-removal move and an *enabling* architecture. It is not, by itself, a product.

**The axe engine is still the default (`ACTIVE_ENGINE=axe`).** That means today's default product is still an axe wrapper. Until the native engine achieves parity + ACT validation, keeping axe as default is correct — but the switch needs to happen deliberately as part of a product narrative, not drift.

### The One New Product Path That Matters

**Custom, versioned accessibility rules as code.** The modular `{id, evaluate}` contract means a design system team can ship a rule that enforces their specific component conventions — "all our Tabs components must have `role=tablist` with `aria-label`", "our Modal must trap focus" — as a committed file alongside their source. axe DevTools has a custom-rule SDK, but it is enterprise-gated and requires Deque's tooling. At the sub-$200/month price band, nobody offers this. This is the wedge.

**What this is not:** a rules marketplace (needs a developer community you don't have), a licensing play (you'd be competing with free axe-core), or a reason to target enterprise (you don't have the surrounding product — dashboard, services, audit trail — to close there).

### The Architectural Move That Must Not Happen Yet

Do not publish the rule contract as a stable SDK until the injection mechanism is fixed and a free-variable validator exists. Every customer who writes a rule against a fragile contract becomes a breaking-change liability. The native engine is days old. Harden it first; advertise it second.

---

## 5. Competitive Positioning Update

### Repositioning Away From the Fight You Cannot Win

In default `axe` mode, this product is a thinner wrapper around Deque's own open-source core, sold against their commercial product. That is unwinnable: Deque owns the brand, sets the standard, and validates their rules against the ACT test corpus. Every comparison favors them.

The native engine gives one defensible move: **stop being an axe alternative, become the customization layer axe won't be.** Deque monetizes standardization — everyone gets the same rules. The wedge here monetizes the opposite: organization-specific accessibility rules as code.

### Where This Product Can Win

| Competitor | Why they lose to the wedge |
|---|---|
| axe DevTools (Deque) | Custom rules are enterprise-gated in their SDK; they optimize for generic WCAG coverage, not design-system-specific enforcement |
| Lighthouse (Google) | Free — can't beat $0 on generic scans. Custom rules are a non-starter in their architecture. |
| Tenon.io, Pope Tech | Both axe-based. No custom rule system. In the same price band. The native engine is a clean differentiator here. |
| IBM Equal Access | WCAG 2.1 focused, no custom rule mechanism, no CI integration |

**Do not target Siteimprove, Level Access, Monsido.** No dashboard, no services, no legal defense team, no compliance certifications. That market takes 18+ months and $500k+ to enter credibly.

### Revised Positioning Statement

> For **engineering teams shipping design systems who need accessibility enforced as code**, who are frustrated that off-the-shelf scanners only check generic WCAG rules and ignore their component conventions, our product is **an API-first accessibility scanner with a fully programmable rule engine**. Unlike axe DevTools and Pope Tech, which lock you into a fixed rule set built on someone else's engine, we let you write, version, and run your own accessibility rules alongside WCAG checks — in CI, via API, with no vendor rule dependency.

**The buyer:** the staff or lead frontend engineer who owns a design system at a 50–500-person product company. Not the compliance officer (that's the enterprise buyer this product can't serve yet). The person whose pain is "our button component loses its aria-label every three sprints and no scanner catches it because it's not a generic WCAG failure."

---

## 6. Revised Build Order

Total: ~10–11 weeks to end of Phase 5. **Launchable at ~6 weeks (end of Phase 3).** Phases 6–7 are post-launch hardening.

### Phase 1 — Correctness & Injection Foundation
**Duration:** 1 week
**Goal:** no silent wrongness in either engine before any external exposure.

| Deliverable | File | Notes |
|---|---|---|
| Replace `eval()` with `page.addScriptTag` | `native_runner.js:98–113` | See §1 Risk 1 for implementation |
| Free-variable validator on rule load | new util in `scripts/` | Rejects closures at load time; defines SDK contract |
| Fix G58 ID at source | `axe_runner.js` | Change emitted `id` from `g58-media-alternative-link` to `g58-link-to-text-alternative` |
| Add `label-content-name-mismatch` to WCAGMap | `internal/models/wcag_mapping.go` | axe rule already runs; 1-line addition |
| Disclose `engine` + `rules_executed` in ScanResult | `internal/models/report.go`, `openapi.yaml` | Honest disclosure before parity gap becomes a trust issue |
| CSP test fixture | `scripts/test/fixtures/csp-page.html` | Regression test for the injection path |

**Unblocks:** everything. The rule contract is now trustworthy enough to publish.

### Phase 2 — Custom Rule SDK + Fixture Harness
**Duration:** 2 weeks
**Goal:** a third party can write, validate, version, and run a rule. This is the wedge going live.

| Deliverable | Notes |
|---|---|
| Documented rule contract | dom vs puppeteer, no-closure constraint, required metadata including `wcag: [...]`, semver |
| `--rules-dir` support in `native_runner.js` | Load external rule packs at scan time; no server restart |
| Rule-pack manifest with semver | Version rules alongside source |
| `validate` CLI subcommand | Schema check + free-variable check + smoke-run against a fixture HTML |
| Pass/fail fixture pair required per rule, wired into `npm test` | Prevents regression; also the ACT harness plug-in point |
| 3 worked example custom rules | Docs artifact + marketing proof point |
| esbuild bundling path | For rules that need imports/helpers — Option C graduation from Phase 1 |
| Add `wcag: [...]` to rule contract metadata | Prerequisite for Phase 7 WCAGMap generation |

Note: the product-ceo estimated 1 week; the fixture harness makes it 2. Without per-rule fixtures, a CI product that breaks builds on false positives gets uninstalled in one sprint.

**Unblocks:** CI wrapper has something defensible to run; ACT validation has a harness.

### Phase 3 — CLI + GitHub Action
**Duration:** 1.5 weeks
**Goal:** scanner runs in CI with deterministic exit codes.

| Deliverable | Notes |
|---|---|
| Headless CLI mode | Direct Node invocation, bypass JWT/API path |
| Exit-code policy | `--fail-on critical,serious` |
| **Baseline/diff mode** | `--baseline baseline.json` — fail only on *new* violations. Without this, no team with existing debt can adopt. Non-optional. |
| SARIF output | GitHub code-scanning annotations |
| Published GitHub Action | `uses: you/a11y-scan@v1` with pinned engine version |
| 5-line workflow snippet in docs | The actual sales motion |

**Unblocks:** the product motion — rules-as-code enforced on PRs. This is the public launch milestone.

### Phase 4 — ACT Conformance for Top 15 Rules
**Duration:** 1.5 weeks
**Goal:** externally verifiable accuracy claim — the marketing artifact and regression backstop.

| Deliverable | Notes |
|---|---|
| Harness ingesting W3C ACT-Rules testcases JSON into Phase 2 fixture runner | Automated |
| Conformance matrix (rule × pass/fail/inapplicable) regenerated in CI | Published in docs |
| Rule bug fixes | Budget ~40% of the phase — ACT cases are adversarial and will find edge cases |

**Unblocks:** credible answer to "why trust your engine over axe."

### Phase 5 — WCAG 2.2 Quick Wins (0 of 6 → 4–5 of 6)
**Duration:** 1.5 weeks
**Goal:** close the WCAG 2.2 coverage gap competitors' sales decks use against you.

| SC | Rule | Type | Effort |
|---|---|---|---|
| 2.5.8 Target Size | `target_size.js` — getBoundingClientRect, w<24\|\|h<24, with spacing exception | dom | 1 day |
| 1.4.2 Audio Control | `audio_control.js` — `<audio autoplay>` / `<video autoplay>` without mute control | dom | 0.5 day |
| 4.1.3 Status Messages | `status_messages.js` — heuristic, mark `incomplete` not `violation` | dom | 1 day |
| 2.4.11 Focus Not Obscured | `focus_not_obscured.js` — focus traversal + intersection with fixed/sticky elements | puppeteer | 2 days |
| 3.2.2 On Input | `on_input.js` — change listener on select/radio + URL/dialog monitoring | puppeteer | 1.5 days |

Defer 3.2.6, 3.3.7, 3.3.8 — require multi-page context not yet in scope.

**Unblocks:** "WCAG 2.2 support" claim; demonstrates that the custom rule SDK ships real rules.

### Phase 6 — Performance & Frame Traversal
**Duration:** 1.5 weeks
**Goal:** enterprise pages scan correctly and in bounded time.

| Deliverable | Notes |
|---|---|
| Batch bbox collection | Replace nested `Promise.all` at `native_runner.js:156–157` with one `page.evaluate` returning a selector→rect map. N CDP round-trips → 1. |
| Gate screenshot on `visual_report` | Line 182 — saves CPU on every headless CI scan |
| Frame traversal | Iterate `page.frames()`, run NativeEngine per same-origin frame with frame-path-prefixed targets. This is the largest single coverage hole. |
| Per-rule wall-clock timings in output | Identifies slow rules; required for SDK quality bar |
| Scan-level timeout enforced end-to-end | Currently timeout can be exceeded by the screenshot path |

**Unblocks:** iframe content scannable for the first time; prerequisite for frame rules in Phase 7; Render instance no longer burns CPU on unwanted screenshots.

### Phase 7 — Parity Long Tail + Platform Hardening
**Duration:** 3–4 weeks (ongoing alongside other product work)
**Goal:** close the §3 gap categories in blast-radius order; prepare for hosted rule packs.

| Deliverable | Notes |
|---|---|
| Table rules (5) | td-headers-attr, th-has-data-cells, scope-attr-valid, table-duplicate-name, table-fake-caption |
| Frame rules (4) | frame-title, frame-title-unique, frame-tested, frame-focusable-content — now possible after Phase 6 |
| ARIA widget-name rules (~10) | aria-command-name, aria-dialog-name, aria-meter-name, aria-toggle-field-name, aria-treeitem-name, aria-input-field-name |
| Alt-text long tail (6) | area-alt, input-image-alt, object-alt, role-img-alt, svg-img-alt |
| **Generate WCAGMap from rule metadata** | `go generate` step reading `wcag: [...]` from rule files → emits `wcag_mapping.go`. Eliminates the G58 bug class permanently. This is the highest-leverage architectural change in this phase. |
| Rule-pack registry design | Versioned packs served to the runner — this is where per-scan `require()` gets revisited |

---

## 7. Tensions Between Business and Technical Recommendations

### Tension 1 — eval() Severity (Resolved)

The product-ceo analysis framed the eval() issue as "silently fails on CSP-hardened sites." The tech-advisor corrected this: `page.setBypassCSP(true)` is already called at `native_runner.js:53`, which disables CSP enforcement on the main frame in Chromium. The "fails silently on CSP pages" claim should be reproduced against a real CSP fixture before being cited externally.

The *actual* problem (function serialization strips closures and module-scope references) is still severe, but for a different reason: it makes the custom-rule authoring contract unreliable, not the scanner's ability to scan CSP pages. The fix priority is unchanged; the customer-facing message should be "we hardened the rule injection model" rather than "we fixed a CSP failure."

**Resolution:** fix it in Phase 1 regardless. The correct framing is rule-contract reliability, not CSP compatibility.

### Tension 2 — Phase 2 Effort Estimate (Resolved)

Product-ceo estimated 1 week for custom-rule authoring + docs. Tech-advisor amended to 2 weeks, citing the fixture harness as non-optional for a CI product. The 2-week estimate is correct: a CI scanner that breaks builds on false positives gets uninstalled in one sprint. Do not launch the GitHub Action on top of unvalidated rules.

**Resolution:** Phase 2 is 2 weeks. The 1-week discrepancy is recovered by the fact that Phase 3 (CLI + Action) can begin while Phase 4 (ACT validation) runs, compressing the critical path.

### Agreement — Do Not Launch Yet

Both analyses independently concluded: **do not make a public launch before Phase 3 is complete.** A public launch today invites direct comparison with axe DevTools and Lighthouse on generic WCAG coverage, which is the fight this product loses. The addressable launch moment is when the GitHub Action exists and custom rules are documentable — that is the proof-of-wedge artifact.

---

## 8. Recommended Next Steps (in order)

1. **This week — run the half-day closure audit.** Grep all 62 dom rules in `scripts/rules/` for module-scope references (variables or functions defined outside the `evaluate` function body). Quantify the blast radius before writing any fix. If 0 rules have closures, the eval fix is cosmetic-but-correct and can land cleanly. If several do, the fix and the rule rewrites are coupled.

2. **This week — get 5 design-system engineers on a call.** Ask one question: "Would you pay $X/month for a scanner that enforces your component conventions as code, in CI?" Everything else — the eval fix, the CI action, the launch — is wasted motion until you know the answer. Find candidates: maintainers of public Storybook design systems on GitHub; frontend leads at 50–500-person companies. Validate the wedge before polishing the weapon.

3. **Week 1–2 — Ship Phase 1 (Correctness).** Fix G58 at source in `axe_runner.js`. Add `label-content-name-mismatch` to `wcag_mapping.go`. Replace eval with `page.addScriptTag`. Add free-variable validator. Add `engine` + `rules_executed` to `ScanResult`. Write the CSP fixture. None of these are optional before external exposure.

4. **Weeks 2–4 — Ship Phase 2 (Rule SDK).** Freeze the rule contract. Add `--rules-dir`. Write the 3 example rules. Build the validate CLI and per-rule fixture harness. esbuild bundle path. This is the product. Everything else is scaffolding.

5. **Weeks 4–6 — Ship Phase 3 (CI).** Headless CLI. Baseline/diff mode. GitHub Action. SARIF output. Record a 60-second Loom of a custom rule catching a design-system regression that axe misses — this is the top-of-funnel artifact.

---

## Appendix: Scores Snapshot

| Sub-category | Weight | 2026-07-05 | 2026-07-06 | Delta |
|---|---|---|---|---|
| Rule coverage & accuracy | 25% | 58 | 54 | −4 |
| Developer experience | 20% | 45 | 47 | +2 |
| Enterprise readiness | 20% | 20 | 20 | 0 |
| Reporting & compliance | 15% | 28 | 28 | 0 |
| Differentiating features | 20% | 55 | 63 | +8 |
| **Weighted total** | | **40** | **44** | **+4** |

---

*Analysis performed 2026-07-06. Sources: `scripts/native_runner.js`, `scripts/native_engine.js`, `scripts/rules/` (66 files), `internal/models/wcag_mapping.go`, `internal/config/config.go`, `internal/api/handler.go`, `WCAG22_IMPLEMENTATION_GAPS.md`. Technical claims verified against working tree.*
