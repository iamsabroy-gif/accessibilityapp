# Admin Console UI Optimization - Implementation Plan

Status: plan only, no app code changed. Written 2026-11-02 against commit 42d01fe.
Scope rule: vanilla JS, no new dependencies, no framework, no build step.

## TL;DR

Move the admin console out of the 420px slide-in drawer into a dedicated `/admin` page (`admin.html` + `admin.js` + `admin.css`) with three tabs: **Settings**, **Activity**, **Coverage**. Keep the hidden 5-click dot, but make it just a link to `/admin`; the login form lives on the page. Fix a11y properly (real tabs, `aria-pressed` toggles, live regions, focus management, session-expiry handling). Delete the drawer, its inline styles, and ~250 lines of admin code from `app-v2.js` (the public scanner bundle stops shipping admin code).

---

## 1. Current-state problems (verified in code)

Source: `frontend/index.html` L539-575 (password modal), L630-768 (drawer); `frontend/app-v2.js` L1924-2260, L2420-2480; `frontend/style-v2.css` L459-470, L1017-1110.

**Layout / IA**
- Everything is one 420px scrolling column: 5 settings groups, Save, Force Token Refresh, Activity table, Coverage upload, an "How auth works" blurb. Roughly 3 screens of scroll; Activity (the most data-dense thing) is last and squeezed.
- The Activity table has 6 columns at 0.78rem in 420px minus 48px padding. It scrolls horizontally inside a nested `overflow-x:auto`, so emails truncate/scroll and the user must scroll in two axes. The planned columns (scans, downloads) and filters cannot fit.
- Unrelated concerns are mixed: persistent config (Save), one-shot action (coverage upload), diagnostics (token refresh), read-only reporting (activity).
- "Force Token Refresh" and the token-status row are mislabeled for admin use: `updateAdminTokenStatus()` reads the **guest** session token expiry (`LS_KEY_TOKEN_EXP`), not the admin token. The admin token's 30-min lifetime (`expires_in: 1800` returned by `/admin/verify`) is discarded.
- Scan Mode (Serial/Parallel) is saved to `localStorage` immediately in the admin's browser (`setScanMode`) while the other four settings need "Save Settings" and go to the server. Same panel, two different persistence models, no indication which is which. This is a real UX trap.
- The "How auth works" footer is developer documentation inside the UI. Delete it.

**Accessibility gaps (the product is accessibility; this must be fixed first)**
- Drawer has `role="dialog" aria-modal="true"` but **no focus trap**, no focus move on open (nothing calls `.focus()`; it only removes `inert`), and no focus return to the trigger on close. The trigger is a hidden dot, so return target is also undefined.
- Escape handler is global and closes both drawer and password modal indiscriminately (L2461); a second admin overlay stacking would close wrongly.
- Background is not made `inert` while the drawer is open (only `aria-modal`, which is unevenly supported). Page behind remains tabbable.
- Toggle groups (Scan Mode, Engine, Scoring, PDF, Landing) are plain `<button>` + CSS class `active`. **No `aria-pressed`, no group role**, so a screen reader cannot tell which option is selected. The group "label" is a `<label class="form-label">` with no `for` target (invalid association). Needs `<fieldset><legend>` + radio semantics.
- State is conveyed by background color only (`.toggle-btn.active`).
- `Max Concurrent Scans` input has `style="width:80px"` and no validation message beyond a status string; `max=100` is a client hint only.
- Save/activity status use `role="status" aria-live="polite"` (good) but the same element is reused for errors; errors should be `role="alert"`. Success text auto-clears after 3s, which can disappear before AT reads it (WCAG 2.2.1-adjacent).
- Activity table: has `<caption class="sr-only">` (good) but no sort affordance, no `scope="row"`, rows are clickable-nothing, and timestamps are mangled strings (`replace('T',' ')`) with no `<time>` element or timezone.
- Close button label is a literal "✕" with `aria-label`; fine, but 32x32px is below the 44px comfortable target (24px minimum for 2.5.8 is met).
- `backdrop-filter` overlay and 0.35s slide transition have no `prefers-reduced-motion` guard in the admin block.
- Drawer background is hard-coded `#0d1424` rather than a token; contrast of `.field-hint` / `--text-muted` on it is unverified.

**Session / errors**
- 401 handling is inconsistent: `loadAdminSettings` silently `return`s on any non-OK response (user sees stale default values, 5, and thinks they are real). `loadAdminActivity` and coverage upload show a text message "unlock again" but give no way to re-authenticate; the user must close the drawer and do the 5-click dance again. Save Settings surfaces the raw server error.
- No countdown or warning before the 30-minute admin token expires. Worst case: user edits settings for 25 minutes, clicks Save, gets a failure, loses edits.
- Admin token is in `sessionStorage` (reasonable) but `wacs_admin_authed` flag is a redundant second key.
- No loading skeleton for settings; the controls render with default state (`axe`, `compliance`, off) before fetch resolves, so an admin can Save defaults over real values if the GET failed. This is a data-safety bug, not cosmetic. **Disable Save until settings loaded successfully.**

**Code hygiene**
- ~12 inline `style="..."` attributes on drawer markup, plus JS-set `td.style.*` in the activity renderer. Cannot be restyled, and a strict CSP (`style-src` without `unsafe-inline`) would break them.
- The scanner page (`index.html`, `app-v2.js`) ships all admin code to every public visitor.
- Duplicate toggle plumbing: four near-identical functions (`toggleScoringFormula`, `toggleActiveEngine`, `togglePDFVisibility`, `toggleLandingEnabled`) that each flip two classes.

---

## 2. Target design

### 2.1 Decision: dedicated page, not drawer, not modal

Reasons: the table needs width; tabs need URL addressability (`/admin#activity`); a page has a natural focus/landmark model (no trap needed, which removes the hardest a11y piece); admin code leaves the public bundle; it can be tested in isolation.

Rejected: "full-width drawer" (still needs a trap, still hides the URL), framework/SPA (violates YAGNI).

### 2.2 Entry point

- **Keep** the hidden dot (it is existing muscle memory, costs nothing) but change its 5-click handler to `location.href = '/admin'`. Remove `openAdminPasswordModal`, the password modal markup, and `submitAdminPassword` from the public page.
- Be honest in the plan: obscurity is not the control; `ADMIN_PASSWORD` + 30-min JWT is. `/admin` is a normal reachable URL. Add `<meta name="robots" content="noindex">` and `X-Robots-Tag` is optional.
- Hidden dot is invisible to keyboard/AT users; that is acceptable for an internal entry, and admins can type `/admin`. Do **not** add a visible link.

### 2.3 Page structure (`frontend/admin.html`)

```
<header>  Admin console [badge]   Session: 28:41 left [Extend/Sign out]
<nav aria-label="Admin sections"> (tablist)  Settings | Activity | Coverage
<main id="main"> three <section role="tabpanel"> (one visible)
<div id="admin-live" class="sr-only" aria-live="polite">   // global announcer
<div id="toast-region" role="status">                       // visible save feedback
```

- Login state: if no valid token, the page shows only a centered login form (`<form>`, labeled password input, `autocomplete="current-password"`, error `role="alert"`). Replaces the modal. A real `<form>` gives Enter-to-submit for free (no keydown handler).
- Tabs follow the WAI-ARIA tabs pattern with automatic activation: `role=tablist/tab/tabpanel`, `aria-selected`, roving `tabindex`, Left/Right/Home/End. ~30 lines of JS. Tab state is mirrored in `location.hash` (`#settings` default, `#activity`, `#coverage`); `hashchange` switches tab. Deep links work.
- Landmarks: `header`, `nav`, `main`, skip link to `#main`, one `h1` ("Admin console"), `h2` per panel.
- Layout: max-width 1100px container for Settings/Coverage (readable measure ~720px), Activity uses full container width.

### 2.4 Reuse

Reuse `style-v2.css` tokens (`--border`, `--text-*`, `--accent`, radii). Put admin-only rules in a new `admin.css` that is loaded after it, rather than growing the 1,400-line shared sheet. Do not fork a second token set.

---

## 3. Activity tab

Data: `GET /admin/activity` returns the complete list (`users[]`), small today (JSONL, tens to low thousands). **Do all sort/filter/paginate client-side in v1.** Server-side only if rows exceed ~5k (open question 3).

| Feature | Decision |
|---|---|
| Search | Single `<input type=search>` with visible label "Filter by email or source", debounced 150ms, case-insensitive substring on email+source. Announce "N of M users" via the live region. |
| Sort | Header buttons inside `<th>`; `aria-sort="ascending/descending/none"` on the `th`; default Last seen desc (matches server). Click toggles; stable sort. Numeric cols sort numerically, dates by ISO string. |
| Filters | Status select: All / Registered / Unregistered. Source select built from distinct `source` values. |
| Month filter | v1 (client-only): `<input type="month">` filters rows whose `last_seen` or `registered_at` falls in that month. Honest limitation: `visit_days`/`total_visits` remain all-time. v2 (backend, with the planned per-user columns): add `?month=YYYY-MM` to `/admin/activity` so the visit counts are scoped to the month; update `openapi.yaml` + `activity_test.go`. Do v1 now, v2 only when per-user scans/downloads land. |
| Pagination | Client-side, 25 rows/page, Prev/Next buttons + "Page 2 of 7 (51-75 of 168)". `<nav aria-label="Activity pages">`. After page change focus stays on the button; live region announces range. No infinite scroll. |
| CSV export | "Export CSV" exports **the filtered, sorted set** (all pages) via `Blob` + `URL.createObjectURL`, filename `activity-YYYY-MM-DD.csv`. Prepend `'` to cells beginning with `= + - @` (CSV/formula injection; emails are user-supplied). Quote all fields. UTF-8 BOM so Excel opens it. |
| Sticky header | `thead th { position: sticky; top: 0 }` inside a `max-height: 70vh; overflow:auto` wrapper with `tabindex="0"` + `role="region"` + `aria-label="Activity table (scrollable)"` so keyboard users can scroll it. |
| Dates | Render `<time datetime="ISO">2026-10-30 14:02 UTC</time>`; one `fmt()` helper; show "never" instead of blank. Title attribute not relied on. |
| Mobile (<640px) | CSS-only: `thead` visually hidden (kept for AT), each `tr` becomes a stacked card, `td::before { content: attr(data-label) }`. Keep `display:table*` semantics intact by adding `role="table/row/cell"` etc. to the elements (CSS `display:block` strips table semantics in some browsers). Sort moves to a `<select>` ("Sort by") visible only in this breakpoint. |
| States | **Loading**: `aria-busy="true"` on the table wrapper + "Loading activity..." text (no spinner-only). **Empty (no data)**: "No registered users yet. Enable LEAD_CAPTURE_ENABLED / VISIT_TRACKING_ENABLED to collect activity." **Empty (filter)**: "No users match. [Clear filters]". **Error**: `role="alert"` message + Retry button; on 401 route to re-auth (section 5). Keep prior rows visible with a "stale" note on refresh failure rather than blanking. |
| Summary | Above table: "168 users - 142 registered - 26 unregistered - 1,904 visits" computed from the filtered set. Replaces the current bare status string. |
| Refresh | Button "Refresh" + "Updated 14:02" text. No auto-polling (YAGNI). |

Skipped on purpose: column chooser, row detail drawer, charts, server-side paging, virtualization.

---

## 4. Settings tab UX

- **Grouping** (each a `<fieldset>` with `<legend>`, a short hint via `aria-describedby`):
  1. *Scanning*: Scanner engine (radio), Link scan mode (radio), Max concurrent scans (number).
  2. *Scoring*: Scoring formula (radio).
  3. *Public site*: Landing page at root (radio), PDF "coming soon" card visibility (radio).
- **Controls**: replace the 5 toggle-button pairs with native `<input type=radio>` styled as a segmented control (visually the same, keyboard arrow-key behavior and `checked` state for free, no `aria-pressed` bookkeeping, no four toggle functions). One `readSettings()`/`writeSettings(obj)` pair replaces them all.
- **Scan Mode scope fix**: it is browser-local. Move it to its own "This browser only" fieldset with the hint "Not saved to the server", and exclude it from dirty tracking and Save. (Open question 1: should it be a server setting? Out of scope.)
- **Dirty state**: keep a `saved` snapshot; on any `input`/`change` compare to it. When dirty: Save button enabled + "Unsaved changes" text (in text, not color alone), and a `beforeunload` guard. When clean: Save disabled. "Discard" button resets to snapshot. After successful save, snapshot = current.
- **Load safety**: controls `disabled` + `aria-busy` until GET succeeds. On GET failure show an error with Retry; Save stays disabled. (Fixes the overwrite-with-defaults hazard.)
- **Save feedback**: sticky action bar at the bottom of the panel ("Unsaved changes - Discard - Save"). Result goes to `#toast-region` (`role=status`) and persists until dismissed or next action (no 3s auto-clear for errors; success may auto-clear after 6s since it is also in the live region). Move focus nowhere on success; on validation error, focus the first invalid field and set `aria-invalid` + `aria-describedby` error text.
- **Validation**: Max concurrent: integer 1-100, inline error text, enforce on the client and rely on the server's own check (confirm it exists in `UpdateSettings`; if not, add it, see risks).
- **Confirm for risky toggles**: only two actually matter. Use a native `<dialog>` (`showModal()` gives focus trap, Escape, inert background and focus return for free, which is also the right tool for the re-auth dialog):
  - *Landing page at root* switching on/off changes what every public visitor sees at `/`. Confirm on **Save**, naming the change: "Root `/` will serve the landing page. Scan app stays at `/app`."
  - *Scoring formula* change alters every score returned to all users. Confirm on Save: "Scores for new scans will use the Penalty formula."
  - Scanner engine -> native: confirm (untested engine in prod). PDF visibility, concurrency, scan mode: no confirm.
  - Single combined confirm listing every risky diff, not one dialog per toggle.
- **Hints**: keep the existing copy but shorten; remove the "Reverts to env on restart" ambiguity by showing it as a visible note on the affected fieldset ("Runtime override; resets on server restart").
- **Force Token Refresh**: delete. It refreshes the guest token, which is irrelevant to admin work. Replaced by the session control in section 5.

---

## 5. Session handling

- On successful verify, store `{token, exp: Date.now() + expires_in*1000}` as one `sessionStorage` JSON key `wacs_admin` (replaces `wacs_admin_token` + `wacs_admin_authed`). Add a one-time migration read of the old key or just let users re-login (internal tool; simply re-login).
- Header shows "Session: 28:41 remaining", updated each second **visually** but announced only at thresholds (5 min, 1 min, expired) via the polite live region. Do not put a per-second ticking value inside a live region (screen reader spam, WCAG 2.2.1 concern). `aria-hidden` the ticking text and keep a separate sr-only milestone announcer.
- At 2 minutes left, show a non-blocking banner (`role="status"`): "Session expires in 2 minutes. [Extend session]". Extend = re-run login via the dialog below (no refresh endpoint exists; do **not** add one now, YAGNI. Open question 2).
- Single `adminFetch(path, opts)` wrapper: adds the bearer header, and on 401/expired sets `sessionExpired` and opens the re-auth `<dialog>` (password field only, "Your session expired. Enter the admin password to continue."). On success it **retries the pending request once** and keeps the page state, including dirty settings edits. On cancel -> return to the login screen (edits are lost, warn before).
- Sign out button: clears storage, shows the login form.
- Pre-flight check on page load: if stored `exp` is past, go straight to login rather than firing three failing requests.
- Multiple tabs: no coordination (YAGNI); sessionStorage is per tab anyway.

---

## 6. Accessibility checklist and verification

Target: WCAG 2.2 AA on `/admin`, and it must be clean under this project's own scanner.

**Checklist**
- [ ] 1.3.1 Landmarks, one h1, fieldset/legend groups, `th scope`, real `<form>`, `<time>`
- [ ] 1.4.3 / 1.4.11 Contrast >= 4.5:1 text, >= 3:1 for input borders, focus ring, segmented-control selected state (verify tokens on admin bg; replace hard-coded `#0d1424`)
- [ ] 1.4.10 Reflow at 320px: no two-axis scroll except the labeled table region, which becomes cards under 640px
- [ ] 1.4.13 / 2.5.8 targets >= 24px (aim 40px), selected state not by color alone (add check icon/weight/underline)
- [ ] 2.1.1 / 2.1.2 Everything operable by keyboard, no traps; tabs use arrow keys; `<dialog>` handles its own trap
- [ ] 2.4.1 Skip link; 2.4.3 focus order; 2.4.7 + 2.4.11 visible focus not obscured by the sticky header/action bar (use `scroll-padding-top/bottom`)
- [ ] 2.2.1 Timeouts: session warning + extend (section 5)
- [ ] 3.3.1 / 3.3.3 Inline errors with `aria-invalid` + `aria-describedby`; 3.3.7 no re-entering info (retry-after-reauth preserves edits)
- [ ] 4.1.2 Names/roles/states for tabs, radios, sort buttons (`aria-sort`), busy regions
- [ ] 4.1.3 Status messages: save result, filter counts, page changes, session milestones via live regions; errors `role=alert`
- [ ] `prefers-reduced-motion: reduce` disables transitions; `forced-colors` check for the segmented control (use `:checked` + outline, not just background)
- [ ] Both `prefers-color-scheme` themes if the site supports them (follow whatever `style-v2.css` does; do not invent a theme switch)

**How to verify**
1. **Self-scan with our own product**: add `admin.html` to a Go/Node test that boots the server with `ALLOW_PRIVATE_SCANS=true` and `ADMIN_PASSWORD`, signs in via Puppeteer (already a dependency in `scripts/`), visits each tab and the dialog states, and runs axe-core on each. Fail the test on any violation of impact >= serious. Lives in `scripts/` next to existing tests (`npm test`). The login screen and each tab are separate runs because hidden panels are not scanned.
2. **Keyboard script** (Puppeteer, same file): Tab through login -> tabs (arrow keys, Home/End) -> radios -> Save; assert focus returns correctly after dialog close; assert `document.activeElement` after tab switch.
3. **Manual screen reader pass** (once per phase release, ~30 min): VoiceOver+Safari on macOS and NVDA+Firefox if available. Script: log in, switch tabs, change a setting, save (hear result), sort a column (hear `aria-sort`), filter (hear count), let session hit the 2-min warning (set short `expires_in` via env/dev flag).
4. **Zoom/reflow**: 400% zoom and 320px viewport screenshot review of all three tabs.
5. Contrast: axe covers most; spot-check the disabled/hint/selected states manually with a contrast tool.

---

## 7. CSS cleanup

- Remove every `style="..."` in the drawer markup (12 occurrences) and `td.style.*` in JS. Replace with classes: `.stack`, `.stack-lg`, `.field-narrow`, `.num` (right-aligned numeric cell), `.btn-block`.
- New `admin.css` with a small set of local custom properties derived from existing tokens; no new colors except the semantic ones already present (`--pass`, `--critical`, plus one `--warn` if missing):
  - `--admin-bg`, `--admin-surface`, `--admin-border` -> alias existing `--bg-*`/`--border`. Delete the three hard-coded `#0d1424` / `#111827` / `#64748b` usages that come with the drawer.
- Delete from `style-v2.css`: `#admin-overlay`, `#admin-drawer`, `.drawer-*`, `.admin-badge` (move), `.admin-toggle-section`, `.toggle-row`, `.toggle-btn` (L459-466, L1017-1110) after verifying nothing else uses them (`grep`; `.token-status*` is used only by the drawer, confirm). Keep `.admin-upload-section` styles by moving them.
- Add `@media (prefers-reduced-motion: reduce) { * { transition: none; animation: none } }` scoped to admin.
- Keep the shared `.sr-only`.
- If a CSP is later tightened, this makes `/admin` compatible with no `unsafe-inline` styles (still needs an inline-script review: use an external `admin.js`, no inline handlers).

---

## 8. File-by-file change list

| File | Change |
|---|---|
| `frontend/admin.html` (new) | Page shell: header, tablist, three panels, login form, re-auth `<dialog>`, confirm `<dialog>`, live regions. Links `style-v2.css`, `admin.css`, `admin.js` (`defer`). Own `<!doctype>`, `lang`, viewport, `noindex`. |
| `frontend/admin.js` (new, ~350-450 lines) | `adminFetch`, session module, login, tabs, settings (`readSettings/writeSettings`, dirty, save, confirm), activity (state `{rows,q,sort,filters,page}`; `render()`; CSV), coverage upload (moved as-is, plus 401 via `adminFetch`). One state object, no classes, no libs. |
| `frontend/admin.css` (new, ~200 lines) | All admin styles, segmented control, sticky header, cards breakpoint, dialogs, reduced motion. |
| `frontend/index.html` | Remove `#admin-password-modal` (L539-575) and the whole drawer + overlay (L630-768). Keep `#admin-trigger`. |
| `frontend/app-v2.js` | Remove admin functions L1924-2260 (modal, submit, settings, activity, toggles, save, drawer, token status) and their listeners (L2420-2461, L2474-2478). Replace trigger handler with `location.href='/admin'`. Keep `setScanMode/getScanMode/updateScanModeToggle` only if the public page uses them; otherwise move to `admin.js` (check usage first; scan mode is read by the scanner, so the getter stays). Narrow the Escape handler to what remains. Net: about -300 lines. |
| `frontend/style-v2.css` | Delete drawer/toggle CSS as in section 7. |
| `frontend/app.js`, `style.css`, `landing.html` | Check for admin references (`grep -n admin`); landing/legacy bundles are unaffected unless they link the drawer. No change expected. |
| `internal/api/router.go` | Add `r.Get("/admin", ...)` serving `frontend/admin.html` (mirror the existing `/app` handler at L86). The `FileServer` fallback already serves `/admin.js` and `/admin.css`. Add test in `router_test.go`: `GET /admin` -> 200 text/html; unauthenticated, no secrets in the page. |
| `internal/api/handler.go` | Phase 1: none. Phase 3 only: optional `?month=YYYY-MM` on `GetActivity` and, if missing, server-side range validation (1-100) for `max_concurrent_scans` in `UpdateSettings`. |
| `openapi.yaml` | Phase 3: document `month` query param on `/admin/activity` and (if added) new per-user fields. Per CLAUDE.md, keep in sync with `handler.go`. `/admin` HTML route is not part of the API spec. |
| `internal/api/activity_test.go` | Phase 3: month filter cases. |
| `scripts/admin_a11y.test.js` (new) | Puppeteer + axe self-scan and keyboard checks (section 6). Wire into `cd scripts && npm test`. |
| `CLAUDE.md` | One line: FILES += `frontend/admin.{html,js,css}`; note admin console location. |

No changes to scanner, scoring, or WCAGMap.

---

## 9. Tests

- **Unit-ish (Node, no browser)**: pure functions extracted to the top of `admin.js` under a tiny `if (typeof module !== 'undefined') module.exports = {...}` guard: `filterRows`, `sortRows`, `paginate`, `toCsv` (incl. formula-injection and quoting cases), `formatRemaining`. Test with `node --test` (built in, no dependency). These carry the real logic risk.
- **Go**: `router_test.go` for `/admin` route; existing `activity_test.go` unchanged until Phase 3.
- **E2E (Puppeteer)**: login happy/sad path; tab switching + hash deep link; settings dirty -> save -> reload shows persisted values; GET failure keeps Save disabled; expired token -> re-auth dialog -> retried request succeeds with edits intact; CSV download content; mobile viewport card layout; axe on every state (section 6).
- Regression: public `/app` page still loads and scans with the admin code removed; 5-click dot navigates to `/admin`; PDF "coming soon" card still reflects the server setting (it is driven by the public Info endpoint, not the drawer).

---

## 10. Phased rollout and effort

Effort is focused dev time for one engineer, including tests.

| Phase | Scope | Effort |
|---|---|---|
| **0. Quick safety fixes (can ship alone, drawer still present)** | Disable Save until settings GET succeeds; stop swallowing non-OK in `loadAdminSettings`; add `aria-pressed` to toggles as a stopgap; focus into drawer on open + return on close; scope Escape. | 0.5 day |
| **1. New page, parity** | `admin.html/js/css`, `/admin` route, login form, tabs, settings with radios + dirty state + Save bar, coverage upload, `adminFetch` + re-auth dialog + session countdown, dot redirects. Drawer + modal + dead CSS/JS removed in the same PR so there is never two admin UIs. | 3-4 days |
| **2. Activity upgrade** | Search, sort, status/source filters, month filter (client), pagination, CSV, sticky header, cards layout, states, summary. Pure-function tests. | 2 days |
| **3. Backend-assisted (only with per-user scans/downloads work)** | `?month=` param, new columns, openapi + Go tests. | 1-1.5 days (beyond the planned columns work itself) |
| **4. A11y hardening** | Axe + keyboard Puppeteer suite in CI, manual SR pass, reflow/zoom review, fixes. Start the Puppeteer harness in Phase 1 and extend per phase; this phase is the final sweep. | 1-1.5 days |

Total UI work (phases 0-2 + 4): about 7-9 days. Release plan: Phase 0 immediately (it fixes a data-loss hazard). Phases 1-2 behind no flag (internal tool, one admin, rollback = revert the PR); keep `index.html` drawer deletion in the same commit as Phase 1 so reviewers see one clean cut.

---

## 11. Risks

1. **Hard-coded server-side overwrites**: `UpdateSettings` currently accepts the whole body; if it does not validate ranges or enums, the new UI's client validation is the only guard. Verify and add server checks (small).
2. **Removing admin code from the public bundle breaks something undiscovered** (e.g., `setScanMode` is also used by the scanner). Mitigation: grep every symbol before deleting; E2E on `/app`.
3. **Table semantics lost under CSS card layout** in some browser/AT combos. Mitigation: explicit ARIA table roles on the cards variant; test with VoiceOver.
4. **Client-side-only paging stops scaling** if `leads.jsonl`/`visits.jsonl` grow large (each request re-reads and re-aggregates the whole file in `GetActivity`). Likely fine for thousands; flag at ~5k users or ~100k visits.
5. **CSV contains PII** (emails). It is generated in-browser only, admin-only, but treat the downloaded file as sensitive; no server copy is created. Mention in the UI hint. Confirm this is acceptable under whatever privacy statement the lead-capture consent text promises (consent text is on the lead modal).
6. **Admin token in `sessionStorage`** is readable by any XSS on the origin. Moving to a separate page does not change this; the activity renderer already uses `textContent`, keep that discipline (build rows with `textContent`, never `innerHTML`). A httpOnly-cookie admin session would be better but is a larger backend change (out of scope).
7. **Countdown timer** drift if the tab is backgrounded; compute from stored `exp` timestamp each tick rather than decrementing.
8. `<input type=month>` is unsupported in older Safari desktop; fall back to a text input with `pattern="\d{4}-\d{2}"` and hint "YYYY-MM".

## 12. Open questions

1. Should Scan Mode (Serial/Parallel) stay browser-local, or become a server setting like the others? (Plan assumes: stays local, clearly labeled.)
2. Is it acceptable that "Extend session" means re-entering the password (no refresh endpoint)? Adding a refresh endpoint is small but is an auth-surface change that would warrant a security review.
3. Expected user volume in the next 6 months? Decides whether server-side pagination is ever needed.
4. Is a visible `/admin` URL acceptable, or must discoverability stay near zero? (Plan assumes yes; real security is the password, and `robots noindex` is only courtesy.)
5. Should the month filter scope visit counts (needs backend, Phase 3) or just filter rows (client, Phase 2)? Plan ships the cheap one first and states the limitation in the UI.
6. Are the planned "scans / downloads" per-user columns stored anywhere yet? That determines Phase 3 size.
7. Do we want the admin audit trail (who changed which setting, when)? Not in this plan; likely a future request once there is more than one admin.

## Explicitly out of scope (YAGNI)

Framework or build tooling, charts, WebSocket/live updating, multi-admin accounts/roles, refresh-token endpoint, server-side pagination, column customization, theme switcher, i18n.
