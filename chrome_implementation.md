# Chrome Extension Implementation Plan

Status: **strategy under question (see review section) + two small backend gaps to close before the "Get full report" CTA can ship (see `backend_implementation.md`)** | Owner: TBD | Depends on: existing REST API (internal/api), `scripts/native_engine.js` + `scripts/rules/`, WCAGMap, `backend_implementation.md`

Revision note: this doc has had four passes. (1) `suggestion.md` checked the plan against live code
and caught 3 blockers, 2 underspecified handoffs, 5 robustness items — all fixed, see "Resolved from
suggestion.md" below. (2) advisor-orchestrator (product-ceo + tech-advisor) reviewed the
strategy/sequencing and found two load-bearing problems, not yet resolved — see the strategic review
section immediately below. (3) Product direction: the extension (and backend) run on the in-house
**native engine** (`scripts/native_engine.js` + `scripts/rules/*.js`), not axe-core. (4) **Correction
pass**: an earlier revision of this doc claimed the backend "hasn't migrated to native" and that
WCAGMap needed re-keying — both wrong, based on an incomplete grep. Verified: the backend already
defaults to the native engine (`ACTIVE_ENGINE=native`) and WCAGMap already has 100% rule-ID coverage
of the native rule set. The real, smaller gaps are documented in `backend_implementation.md` (WCAG-
level filtering doesn't exist yet in the native engine, and there's no test coverage exercising it
end-to-end) — see "What this means for the plan" below for the corrected framing.

## Engine: Native, not axe-core

**Decision: the extension bundles and runs `scripts/native_engine.js` + the DOM-evaluable subset of
`scripts/rules/*.js`, not axe-core.** This is a bigger change than swapping a vendor file — it
surfaces a real gap that has to be closed first.

### What exists today (verified in code)

- `scripts/native_engine.js` (74 lines): a minimal in-browser rule runner —
  `window.NativeEngine.addRule(rule)` / `.run()` — that evaluates registered rules against
  `document` and returns `{violations, passes, incomplete}` in a shape that already mirrors axe's
  output (`id`, `impact`, `description`, `help`, `helpUrl`, `tags`, `nodes[]`). No third-party
  dependency, no license/bundle-size concerns for the Web Store package.
- `scripts/rules/` (~70 rule files): individual rule modules covering ARIA, color contrast, forms,
  headings, landmarks, focus, WCAG 2.2 items (`dragging_movements`, `target_size`,
  `accessible_authentication`, `focus_appearance`, `focus_not_obscured`), etc.
- `scripts/native_runner.js` (207 lines): the **Node/Puppeteer CLI orchestrator** — reads the rules
  directory, splits rules into two groups, and runs each differently:
  - **DOM rules** (`rule.type !== 'puppeteer'`, ~64 of ~70 files): pure `evaluate(document)`
    functions. `native_runner.js` serializes `rule.evaluate.toString()`, injects it into the page via
    `page.evaluate`, and registers it with `window.NativeEngine.addRule`. **These can run in a
    content script exactly the same way** — no Puppeteer/CDP access required, they only touch the
    DOM.
  - **Puppeteer rules** (`rule.type === 'puppeteer'`, verified 6 files: `content_on_hover.js`,
    `focus_not_obscured.js`, `focus_order.js`, `focus_visible.js`, `focus_appearance.js`,
    `on_focus_context.js`): these receive the Puppeteer `page` object directly (real keyboard/CDP
    interaction — hover simulation, tab-order walking, focus-appearance measurement across paint
    frames). **A content script cannot run these** — there is no Puppeteer API inside a real user's
    browser tab. This is the native-engine equivalent of the "22 custom Puppeteer checks only appear
    in the real report" boundary that already existed in this doc for axe-core — same shape, just a
    slightly different rule count/list now.
- **CORRECTED (previous draft was wrong — see full backend plan in `backend_implementation.md`):**
  `internal/scanner/axe_runner.go:78-85`'s `Scan()` method already branches on
  `config.GetActiveEngine()` and runs `native_runner.js` when set to `"native"` — and
  `internal/config/config.go:224` **defaults `ACTIVE_ENGINE` to `"native"` already**. The backend is
  not "unmigrated axe-core" — it already runs the native engine by default today. The earlier
  version of this doc claimed otherwise based on an incomplete grep (only searched for the literal
  string `native_runner` in `internal/scanner/*.go` comments, missed the actual dispatch logic).

### What this means for the plan

The doc's core parity argument (extension overlay must run the *same* engine/rule set the backend
scan runs) is **already satisfied at the config level** — both sides are native by default. What's
NOT yet satisfied: `native_runner.js` accepts a `wcagLevel` argument but never applies it (every
rule always runs regardless of requested level — see `backend_implementation.md` G1), so "the
overlay ran the AAA rule set, the report ran something else" isn't currently possible, but "the
overlay/report's stated WCAG level doesn't reflect what actually ran" already is. That's the real
pre-CTA dependency, not a from-scratch migration.

**Prerequisite, not extension scope, but smaller than previously stated:** close gaps G1 (WCAG-level
filtering doesn't exist in the native engine) and G3 (no test coverage exercises `native_runner.js`
end-to-end) from `backend_implementation.md` before the extension's "Get full report" CTA ships.
Overlay-only (no CTA) can ship independently of these, same as before. Sequencing below reflects
this as a smaller blocking step than the original "migrate the backend" framing.

### Custom-rule / WCAGMap mapping — verified compatible, no re-keying needed

**CORRECTED:** the previous draft claimed WCAGMap would need re-keying to native engine rule IDs.
Verified via full extraction and diff: all 73 distinct `id:` values across `scripts/rules/*.js`
already have an exact-match key in `internal/models/wcag_mapping.go` — the native rule files were
deliberately given axe-core-identical dash-style IDs (`color-contrast`, `button-name`,
`focus-order-cycling`, etc.) specifically so WCAGMap didn't need a separate keyspace. Zero gap. Same
for `internal/models/suggestions.go` (SuggestionMap), spot-checked. **No WCAGMap work is needed for
the extension to ship.** One minor, non-blocking granularity note (see `backend_implementation.md`
G2): native's `video_track.js` collapses what axe-core split into three rule IDs
(`video-captions-track`/`-track-src`/`-track-lang`) into one combined check, so the two `-src`/`-lang`
WCAGMap/SuggestionMap entries are currently dead weight — cosmetic, not a scoring bug.

## Advisor-orchestrator strategic review (unresolved — read before building)

1. **Sequencing is backwards.** Step 0 (confirm AAA hardcode) and the localhost/SSRF scoping
   decision both lock in architecture before step 1 (competitive research on Chrome Web Store WCAG
   extensions) validates whether this channel converts at all. The category is crowded with free,
   well-established tools (WAVE, axe DevTools, Accessibility Insights) with no obvious upgrade
   path. **Action: move competitive research to step 0.** It's cheap and gates everything else —
   don't finalize the localhost scope decision or start building until it's done.
2. **Public-URLs-only "Get full report" contradicts the plan's own reason for going hybrid.** The
   hybrid architecture (vs. pure-remote) is justified explicitly by "pure-remote can't reach
   localhost — that's our dev-in-the-loop edge." Then the report handoff — the actual paid
   conversion surface — is scoped to public URLs only, i.e. blocked on exactly that use case. A
   developer sees violations on their local build via the overlay, clicks "Get full report," and
   hits a wall. **This isn't a scoped-down differentiator, it's a severed funnel for the persona
   the architecture was built to serve.** Unresolved choice, pick one before building:
   - (a) Ship the `ALLOW_PRIVATE_SCANS` server-side opt-in as part of v1 (small backend config
     change, not a code change) so the localhost story actually closes the loop, or
   - (b) Stop citing "scan localhost" as the reason to prefer hybrid over pure-remote, and be
     explicit in this doc that v1 is a public-URL-only tool by design — reposition the pitch.
3. **Double-scan (client overlay pass + full server Puppeteer re-scan) is an acceptable v1
   tradeoff** — cold Puppeteer scans (8-25s+) are in line with what QA/agency users already expect
   from Lighthouse/WAVE/PageSpeed, so "click CTA → new tab → spinner → report" reads as normal.
   What *will* read as broken is a report that's just the same violation list, slower, with no
   visible payoff for the wait. **Action: add a staged loading state** that names what's coming
   (score, grade, AudioEye breakdown, screenshots, dev suggestions) rather than a bare spinner, so
   the extra latency has a visible reason.
4. **Sharpest open risk, not yet interrogated: buyer mismatch.** The paid product's actual moat is
   design-system teams enforcing custom rules in CI, bought by staff/lead frontend engineers. The
   extension's v1 users are QA/agency one-click scanners and individual devs poking at their own
   pages — different people, different budgets, no established path from "installed a free overlay"
   to "eng lead adopts CI rule enforcement." **Action before building:** talk to 3-5 people who'd
   install a free WCAG extension and ask what would make them escalate it to their eng lead. If
   there's no plausible path, treat this as a content/SEO/brand play rather than a sales wedge, and
   set expectations (and success metrics) accordingly — don't let it quietly masquerade as a funnel
   that isn't there.

Where both product-ceo and tech-advisor agreed: double-scan latency is not the funnel-killer; the
localhost/public-URL scope contradiction is. That's the highest-priority open item in this doc.

## Strategy (via advisor-orchestrator: product-ceo + tech-advisor)

**Extension is a free acquisition wedge, not a standalone product.** The paid product stays the
server-side pipeline (Puppeteer + WCAGMap-gated scoring + xlsx/report generation). The extension's
job is Chrome Web Store discovery — a zero-CAC channel this product doesn't currently have — funneled
into the existing backend.

Two users, one v1 build:
- QA/agency/compliance folks: one-click "scan this tab" → CTA into full graded report.
- Developers: on-demand DOM violation overlay, triggered per page via the toolbar icon (the
  differentiated feature vs. remote-only scanners).

**v1 is click-to-scan, not always-live.** The manifest below requests `activeTab` + `scripting`
with injection on toolbar-icon click — there's no `content_scripts` declaration, so nothing runs
automatically on page load. A true "always watching this page" overlay needs `<all_urls>` +
declared `content_scripts`, which is deferred (see non-goals) because it triggers heavier Chrome
Web Store review and isn't needed to prove the wedge. Frame v2's auto-live overlay as the natural
consequence of picking up that broader permission later, not a v1 promise.

Explicitly **not** in v1: a DevTools panel (axe DevTools/WAVE already own that space — too costly
to compete there), `<all_urls>` broad permissions, multi-page crawling client-side.

### Hard architectural boundary (non-negotiable)

- **Client-side (content script, bundled native engine — DOM-rule subset only)**: raw violation
  list, node targets, impact counts. Visual overlay only. Puppeteer-type native rules (focus
  order/appearance/context, hover) cannot run here — see "Engine: Native, not axe-core."
- **Client-side must NEVER compute or display a score or grade.** WCAGMap and the two scorers
  (`internal/scoring/score.go` penalty model + AudioEye rate×weight model) stay server-authoritative.
  This is both the anti-drift mechanism (one scoring implementation, not two to keep in sync) and
  the paid-report upsell demo — the Puppeteer-only native rules only appear in the real report.
- Never accept client-computed results as scoring input server-side — forgeable, would corrupt scan
  history/quota, and breaks the "one Puppeteer pipeline" guarantee the scanner currently has.

### Why hybrid, not pure client-side or pure remote-call

- Pure remote (call `/api/v1/scan` for every page view): can't reach localhost/authenticated/internal
  pages the backend's `isPrivateURL()` SSRF guard deliberately blocks — useless for the dev-in-the-
  loop use case that's the actual differentiator.
- Pure client-side (ship WCAGMap + scoring logic into the extension): duplicates scoring logic in
  two places, leaks the paid product's mapping/weighting IP into a public extension bundle, and
  Chrome Web Store review scrutinizes bundle contents anyway.
- Hybrid: instant local overlay (native engine's DOM-rule raw output) + "Get full report" button
  that hits the real `POST /api/v1/scan` for anything requiring a score — once that endpoint runs
  the same native engine server-side (see prerequisite above).

## Architecture

```
┌─────────────────────────────┐
│ Chrome Extension (MV3)      │
│                              │
│ popup.html/js  ── activeTab click → inject content script
│ content.js     ── bundled NativeEngine (DOM rules only), isolated world, runs on live DOM
│                 → renders violation overlay (impact/description/target only, no score)
│ service_worker.js (background)
│                 ── owns fetch wrapper + chrome.storage.session token
│                 ── "Get full report" → GET /api/v1/session (if no token)
│                                      → POST /api/v1/scan {url} → open report in new tab / popup
└─────────────────────────────┘
              │ HTTPS, existing CORS (Access-Control-Allow-Origin: *)
              ▼
┌─────────────────────────────┐
│ Go backend (already native by default — see backend_implementation.md for remaining gaps) │
│ /api/v1/session  (guest JWT, 20min)
│ /api/v1/scan     (JWT, Puppeteer+NativeEngine (DOM+Puppeteer rules)+WCAGMap, rate-limited 10/min)
│ /api/v1/score, /api/v1/report/* (unchanged)
└─────────────────────────────┘
```

No new backend endpoints are strictly required for v1 — the extension is a new client of the
existing `/api/v1/session` and `/api/v1/scan` routes. `corsMiddleware` (internal/api/middleware.go:39)
already sets `Access-Control-Allow-Origin: *`, so no CORS change is needed for extension-origin fetches
**as long as fetches stay non-credentialed** (no `credentials: 'include'`) — `*` is incompatible with
credentialed requests. Note as a forward trap if credentialed fetches are ever added.

### Known constraint: `/api/v1/scan` cannot reach localhost or authenticated pages

`ssrfGuard` (internal/api/middleware.go:58-77) blocks any `X-Scan-URL` containing
`localhost / 127.x / 10.x / 192.168.x / 172.16-31.x / ::1 / 0.0.0.0` unless
`ALLOW_PRIVATE_SCANS=true` server-side. This directly affects the "Get full report" CTA for the
dev-on-localhost audience — **decide and document one of**:
- (a) v1 scope: "Get full report" works for public URLs only; localhost/authenticated pages are
  overlay-only (no scored report) until server config opts in. **Recommended for v1** — no backend
  config dependency, ships sooner.
- (b) Document that localhost reporting requires the operator to set `ALLOW_PRIVATE_SCANS=true`,
  and surface that as a clear error state in the extension when a 403 comes back, rather than a
  silent failure.

Pick (a) or (b) before wiring the CTA — do not leave it ambiguous, since it determines whether the
"scan localhost / authenticated SPAs" pitch in the Strategy section actually works end to end.

## Report handoff contract

`POST /api/v1/scan` returns JSON directly — it does not return a URL or an id, and there is no
existing route in `frontend/app-v2.js` that accepts a scan result via query param or postMessage.
Verified: `frontend/app-v2.js` has a real `renderResults(result)` function (line 619) that renders
a JSON `ScanResult` into the score ring / grade badge / violation list — so "reuse the frontend
rendering" is a valid instinct — but it is only ever called internally after the frontend's own
`runScan()`, not from any externally-triggered entry point. There is currently no `?report=` /
`#report` route or postMessage listener wired to it.

**Chosen approach for v1: extension opens `<frontend-origin>/?prefill=<url>` and the frontend
re-runs its own scan.** This is option A (simplest, no backend change, no new frontend surface) —
accept the double-scan cost (one client-side overlay pass + one server-side report pass the user
explicitly asked for via the CTA) in exchange for zero new report-rendering code. Requires one small
frontend addition: read a `prefill` query param on load and auto-populate + trigger the existing
scan flow (not a new render path — reuses `runScan()` and `renderResults()` as-is).

Deferred to v2 if double-scan proves too slow: a dedicated `postMessage`-based hand-off where the
extension passes its already-fetched `/api/v1/scan` JSON directly into a documented `renderResults`
entry point, avoiding the second scan. Not needed to ship v1.

## Directory layout

```
extension/
  manifest.json
  popup/
    popup.html
    popup.js
    popup.css
  content/
    content.js          (injects NativeEngine + DOM rules, runs scan, renders overlay)
    overlay.css
  background/
    service_worker.js   (auth/session + fetch wrapper to backend)
  vendor/
    native_engine.js     (bundled copy of scripts/native_engine.js — build step must sync it)
    native_rules.bundle.js (concatenated/built from scripts/rules/*.js, DOM-type rules only —
                             build step must exclude the 6 `type: 'puppeteer'` files)
  icons/
    icon16.png icon48.png icon128.png
```

## manifest.json (MV3, minimal permissions)

```json
{
  "manifest_version": 3,
  "name": "WebAccessibility Scanner",
  "version": "0.1.0",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["https://<backend-host>/*"],
  "background": { "service_worker": "background/service_worker.js" },
  "action": { "default_popup": "popup/popup.html" },
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

- `activeTab` + `scripting`, not `<all_urls>` — matches the one-click model, keeps Web Store review
  fast. Broader host permissions (auto-scan every page) is an explicitly deferred v2 decision.
- `host_permissions` scoped to the backend origin only, for the `fetch()` calls in the service worker.
- Bundling first-party native engine code (vs. a third-party lib like axe-core) simplifies Web Store
  review slightly — no third-party license disclosure, no upstream CVE surface to track — but the
  MV3 "no remotely hosted/executed code" rule still applies to `vendor/native_engine.js` and
  `vendor/native_rules.bundle.js` exactly as it would to axe-core: build the bundle at package time,
  never `fetch()` it at runtime.

## Auth flow

- On first "Get full report" click, service worker calls `GET /api/v1/session` (note: **GET**, not
  POST — corrected from an earlier draft of this doc) to obtain a guest JWT (20min expiry), stores
  in `chrome.storage.session` (memory-backed, survives service-worker restarts within the browser
  session, clears on browser close — appropriate for a 20min-lived guest token).
- Fetch wrapper in service_worker.js does lazy refresh-on-401, not a proactive refresh timer as the
  primary mechanism — MV3 service workers are non-persistent and can be killed/restarted at any
  time, so a `setTimeout`-based renewal is unreliable across worker restarts.
- **No backend refresh endpoint is needed.** `frontend/app-v2.js` (`ensureToken()` +
  `scheduleTokenRenewal()`, lines 169-208) already solves this client-side today: it calls
  `GET /api/v1/session` again shortly before the cached token's expiry and swaps in the new token —
  there is no dedicated `/refresh` route, just a repeat call to `/session`. The extension should
  mirror this exact pattern (re-call `GET /api/v1/session` on a timer when the popup/service worker
  is alive, plus lazy refresh-on-401 as the fallback for when it wasn't). This removes the earlier
  "backend prerequisite" item from sequencing — it's a client-side pattern reuse, not new backend
  scope.

## Overlay rendering (content.js)

- Bundle `scripts/native_engine.js` verbatim, plus a build-time concatenation of the ~64 DOM-type
  files in `scripts/rules/` (exclude the 6 `type: 'puppeteer'` files listed above — they will throw
  if loaded, since `rule.evaluate` expects a Puppeteer `page` argument, not `document`). **Add a
  build step** (e.g. a small Node script under `extension/build/`) that regenerates
  `vendor/native_rules.bundle.js` from `scripts/rules/` so the extension can't silently drift from
  the source rules — this bundle must be regenerated whenever `scripts/rules/` changes.
- Inject via `chrome.scripting.executeScript` into the page's **isolated world** (CSP-exempt, so it
  runs even on pages with a strict Content-Security-Policy) — same isolation rationale as before,
  the native engine's DOM rules are plain `evaluate(document)` functions with no special
  environment requirements.
- Register each bundled rule with `window.NativeEngine.addRule(rule)` then call
  `window.NativeEngine.run()` — no tag-set/level filtering exists in `native_engine.js` today (it
  runs every registered rule unconditionally; there's no AA/AAA concept like axe's tag system).
  **Open item, resolve during backend migration**: decide whether the native engine needs a level
  filter added (mirroring axe's `wcag2a/wcag2aa/wcag2aaa` tags) so the extension and backend can
  agree on "run this WCAG level's rule subset," or whether the product intentionally always runs the
  full rule set with level info coming only from WCAGMap's SC metadata at scoring time. Whichever is
  chosen, the extension must load the identical rule subset the backend loads — this replaces the
  axe-core AAA-tag-pin concern from the earlier draft with an equivalent native-engine requirement.
- **Overlay rendering must go in a Shadow Root** (`element.attachShadow({mode: 'open'})`), not
  appended to `<body>` with global styles/inline `<script>`. Global injection risks being clobbered
  by host page CSS, clobbering the host page's own styles, and can be blocked outright by a strict
  page CSP on inline `<style>`/`<script>` in the main world. A sandboxed iframe is the fallback if
  Shadow DOM proves insufficient for isolation in testing.
- Render: highlight boxes on `node.target` elements, tooltip on hover showing `description`, `help`,
  `impact` — no compliance_pct, no grade, no weighted score anywhere in this UI.
- **State explicitly in the UI copy**: the overlay is a diagnostic superset, not a preview of the
  score. The overlay only runs the DOM-rule subset (Puppeteer-type rules like focus order/appearance
  are report-only), and WCAGMap gates which rule IDs count toward the score at all (ruleID ∉ WCAGMap
  → excluded from scoring, per CLAUDE.md) — so the overlay can both under- and over-report relative
  to the graded report. A one-line footnote ("Some flagged issues are diagnostic-only and don't
  affect your WCAG score — see full report for details, which also checks focus order and hover
  behavior this quick scan can't") avoids support confusion.
- Footer/CTA: "N issues found — Get full graded WCAG report" → triggers the `/api/v1/scan` flow via
  the service worker, subject to the localhost/SSRF scoping decision above, then hands off per the
  Report Handoff Contract below. **This CTA is blocked until the backend migration prerequisite is
  done** — see "Engine: Native, not axe-core."

## MV3 / Chrome Web Store review risks

- The native engine bundle (`vendor/native_engine.js` + `vendor/native_rules.bundle.js`) must be
  built into the package at publish time, never fetched at runtime — MV3 bans remotely hosted/
  executed code; this is the single easiest rejection to avoid. Being first-party code (not a
  third-party dependency like axe-core) doesn't exempt it from this rule.
- Declare "this extension sends the current URL to a remote server" in the Web Store privacy practices
  tab (triggered by the `/api/v1/scan` call) — required disclosure, not optional.
- Keep permissions minimal (`activeTab`/`scripting`/`storage` only) — broad host permissions trigger
  additional manual review and slow down publishing.
- The `native_runner.js` pattern of `eval("fn = " + rule.evaluate.toString())` (used server-side to
  rehydrate rule functions from source) should **not** be replicated in the extension — `eval()` of
  dynamically-constructed strings is flagged by MV3 CSP by default and by Web Store review as a red
  flag even when the source is first-party. The extension's build step should emit rule functions as
  ordinary bundled JS (real function declarations, not stringified-then-eval'd), not port
  `native_runner.js`'s Node-side loading mechanism verbatim into browser code.

## Sequencing (resequenced per advisor-orchestrator review)

0. **Competitive + buyer validation (moved ahead of all architecture decisions).** (a) Competitive
   check: install counts / ratings / paywall model of top Chrome Web Store WCAG/accessibility
   extensions (WAVE, axe DevTools, Accessibility Insights, etc.) — validates whether this channel
   converts at all before committing engineering time. (b) Talk to 3-5 people who'd install a free
   WCAG extension; ask what would make them escalate it to an eng lead who'd buy the paid product.
   If there's no plausible escalation path, this is a content/SEO play, not a sales wedge — say so
   explicitly and reset success metrics before building. **Do not proceed past this step until
   both are done.**
1. Resolve the localhost/SSRF scope contradiction (see strategic review above): either commit to
   shipping the `ALLOW_PRIVATE_SCANS` server-side opt-in as part of v1, or drop "scan localhost" as
   the stated reason for going hybrid and reposition the pitch as public-URL-only by design. Pick
   one and update the Strategy section accordingly — do not leave both framings in the doc.
2. **CORRECTED — no backend migration needed, but two smaller gaps block the CTA.** The backend
   already runs the native engine by default (`ACTIVE_ENGINE=native`, `axe_runner.go:78-85`) and
   WCAGMap already has full rule-ID coverage (see "Custom-rule / WCAGMap mapping" above and the full
   writeup in `backend_implementation.md`) — no re-keying work exists. What actually blocks the "Get
   full report" CTA is `backend_implementation.md`'s **G1** (native engine ignores the requested
   WCAG level — every rule always runs regardless of what's asked, so the extension and backend
   can't yet agree on "run this level's rule subset") and **G3** (no test coverage exercises
   `native_runner.js` end-to-end, so a rule regression could ship silently). Both are
   @scanner-engineer scope, both are materially smaller than a migration. Resolve `handler.go:68`'s
   AAA hardcode as part of G1/G4 in that doc, not as a fresh decision here.
3. Small frontend addition: `prefill` query-param handling in `frontend/app-v2.js` to support the
   report handoff contract (auto-trigger `runScan()` from a URL param the extension opens), plus a
   staged loading state ("Computing score… Checking AudioEye breakdown… Generating dev suggestions…")
   so the double-scan wait has a visible payoff instead of reading as a slow repeat of the overlay.
4. Build extension v1: popup + content script overlay (bundled `native_engine.js` + DOM-rule subset
   built from `scripts/rules/`, Shadow DOM rendering, unscored) + service worker auth/fetch wrapper
   hitting existing `/api/v1/session` (GET) and `/api/v1/scan`, reusing the
   `ensureToken`/`scheduleTokenRenewal` pattern from `app-v2.js` — no backend auth changes needed.
   The overlay itself (no "Get full report" CTA wired) could start before step 2 lands since it's
   self-contained; the CTA integration must wait for step 2.
5. Wire "Get full report" CTA → opens `<frontend-origin>/?prefill=<url>` per the report handoff
   contract. Requires step 2 complete.
6. Chrome Web Store submission: bundled native engine (first-party, no `eval()` of stringified rule
   functions — see MV3 risks above), minimal permissions, privacy disclosure for URL transmission.
7. Defer: `<all_urls>` auto-scan, DevTools panel, any client-side scoring/WCAGMap logic, postMessage-
   based single-scan handoff (v2 optimization if double-scan cost matters — confirmed acceptable as
   a v1 tradeoff by advisor-orchestrator, not worth coupling extension/frontend release cycles for).

## Explicit non-goals for v1

- No axe-core anywhere in the extension — native engine only (`scripts/native_engine.js` + DOM-rule
  subset of `scripts/rules/`).
- No score/grade computed or displayed client-side, ever.
- No Puppeteer-type native rules (focus order/appearance/context, hover) in the content script —
  they require real Puppeteer/CDP control and stay server-only, same boundary axe-core's custom
  Puppeteer checks used to have.
- No always-live overlay (no `content_scripts`, no `<all_urls>`) — v1 is click-to-scan.
- No DevTools panel.
- No duplication of WCAGMap or its scoring weights into the extension bundle.
- No new backend scoring code path, no new backend auth/refresh endpoint — extension is a new client
  of existing `/api/v1/session` and `/api/v1/scan`, reusing the frontend's existing token-renewal
  pattern.
- No postMessage-based single-scan optimization — v1 accepts the double-scan cost of the
  `prefill`-param handoff; only revisit if double-scan proves too slow in practice.
- No shipping the "Get full report" CTA until `backend_implementation.md` G1 (WCAG-level filtering)
  and G3 (native-engine test coverage) are resolved — the backend itself is already native by
  default, this is not a migration wait.

## Resolved from `suggestion.md`

| ID | Finding | Disposition |
|----|---------|-------------|
| B1 | `ssrfGuard` blocks localhost for "Get full report" | Documented as a v1 scoping decision (public-only recommended); see "Known constraint" section |
| B2 | Backend scan is hardcoded AAA, not AA; plan said match axe_runner.js (AA default) | Fixed: overlay now pinned to AAA to match `handler.go:68`, not axe_runner.js's standalone default; flagged as open question whether the hardcode is intentional |
| B3 | Doc said `/api/v1/session` is POST; it's GET | Fixed throughout |
| U1 | Report handoff contract undefined; "reuse app-v2.js" unverified | Verified `renderResults()` exists but has no external entry point; chose `?prefill=` query-param handoff (option A) as v1, deferred postMessage direct-render as v2 |
| U2 | "Live overlay" oversold vs. `activeTab`-only permission model | Reworded: v1 is click-to-scan; always-live is an explicit v2 consequence of adding `<all_urls>` |
| S1 | Overlay must render isolated from host page | Added: Shadow Root requirement, iframe fallback |
| S2 | Overlay is a scoring superset (more issues than WCAGMap scores) | Added: explicit UI footnote requirement |
| S3 | Pin axe-core version | Superseded: extension no longer uses axe-core at all (see "Engine: Native, not axe-core"); native engine has no separate version to pin, but the bundled `native_rules.bundle.js` must be regenerated from `scripts/rules/` on every change so it can't drift from source |
| S4 | Rate limit (10/min) is fine for the CTA volume | Acknowledged, no change needed |
| S5 | CORS `*` breaks if credentialed fetches are ever added | Added as a forward-trap note |

Additional findings from this pass (not in `suggestion.md`):
- `frontend/app-v2.js` already implements silent guest-session renewal (`ensureToken` +
  `scheduleTokenRenewal`, lines 169-208) by re-calling `GET /api/v1/session` before expiry — this
  **removes** the earlier "backend JWT refresh prerequisite" from sequencing. The extension should
  copy this pattern rather than wait on a backend change.
- `frontend/app-v2.js` has a working `renderResults(result)` function (line 619) but no externally
  reachable entry point (no query-param route, no postMessage listener) — confirms U1 needed a real
  decision rather than an assumption that "reuse" was free.
