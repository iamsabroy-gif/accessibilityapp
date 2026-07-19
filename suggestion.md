# Chrome Extension — Implementation Suggestions (for build agent)

Source: review of `chrome_implementation.md` against the current backend (`internal/api/*`, `scripts/axe_runner.js`, `CLAUDE.md`). These are concrete gaps and doc-bugs that will cause rework if not addressed. Items are ordered by impact.

Status: proposed | For: Antigravity build agent | Do NOT implement code here — this is a review handoff.

---

## BLOCKERS — contradictions between the plan and the real backend

### B1. "Get full report" cannot reach localhost / authenticated pages (the stated differentiator)
The plan (lines 33-35) correctly notes the *pure remote* model can't reach private URLs. But its own "Get full report" CTA calls `POST /api/v1/scan`, which is a **server-side Puppeteer re-scan of the URL**.

- `internal/api/handler.go:69` sets `X-Scan-URL` from the request body.
- `internal/api/middleware.go:58-77` (`ssrfGuard`) blocks `127.x / localhost / 10.x / 192.168.x / 172.16-31.x / ::1 / 0.0.0.0` unless `ALLOW_PRIVATE_SCANS=true`.
- The plan names "developers scanning localhost / authenticated SPAs" as the core differentiator (lines 12-14).

So for that exact audience, "Get full report" returns 403, or scans a login wall / stale DOM state.

**Required decision (pick one, write it into the plan):**
- (a) Scope "Get full report" to public URLs only; localhost is overlay-only in v1. Document this explicitly.
- (b) Add an `ALLOW_PRIVATE_SCANS`-gated path and document that localhost reporting is opt-in server config.

Do not leave this ambiguous — it determines whether the differentiator actually works.

### B2. Backend scan WCAG level is hardcoded to AAA, not AA
- `internal/api/handler.go:68` — `const wcagLevel = "AAA"` (ignores any client-supplied level).
- `scripts/axe_runner.js:40,49` defaults to **AA**.
- Plan line 127 says the overlay should use "the same rule config as `scripts/axe_runner.js`" for parity.

Result: overlay (AA) and report (AAA) flag **different rule sets** — the opposite of the parity the plan wants.

**Fix:**
- Pin the extension's `axe.run()` config to **AAA** so it matches what `/api/v1/scan` actually executes (not axe_runner.js's AA default).
- Fix the doc wording: "match the backend scan rule set (AAA per handler.go), not axe_runner.js's AA default."
- SEPARATE ISSUE: confirm whether the hardcoded-AAA in `handler.go` is intentional. If the product should honor `wcag_level`, that's a backend bug to raise independently.

### B3. Doc bug: `/api/v1/session` is GET, not POST
- Plan lines 53-54 and line 111 say "POST /api/v1/session."
- `internal/api/router.go:24` — `r.Get("/session", ...)`.

The service worker must `GET` the session endpoint. Copying the plan verbatim will burn a build cycle. Fix the doc.

---

## UNDERSPECIFIED HANDOFFS — will block build if not resolved

### U1. Report handoff contract is undefined
Plan says "open result in the existing frontend (or a popup report view)" and "reuse `frontend/app-v2.js`." But `/scan` returns **JSON**, and the frontend SPA normally runs its own scan. You must define exactly how the extension surfaces the report:

- **A.** Extension opens `<frontend>/report?url=<enc>` → frontend re-runs `/scan` (double scan, simplest).
- **B.** Backend returns a shareable report URL/id the frontend deep-links to (needs backend change).
- **C.** Extension posts the JSON into the frontend via query/blob and frontend renders it (needs a documented entry point in `app-v2.js`).

Pick one, write the contract. **Also verify `frontend/app-v2.js` exists and exposes a render-from-JSON path before relying on "reuse."** If it doesn't, the "reuse" assumption is false and the extension needs its own minimal report view.

### U2. "Live overlay while they work" is not deliverable under the v1 permission model
- Manifest uses `activeTab` + `scripting` with **on-click** injection (no `content_scripts` declared).
- True always-on overlay requires `<all_urls>` + `content_scripts` — explicitly deferred to v2 (non-goals, line 158).

The plan calls the live overlay "the differentiated feature" but v1 UX is really **click → inject → overlay**. Reword so v1 is described as on-demand, and position auto-live as the v2 consequence of the deferred `<all_urls>` work. Otherwise it reads as a promised v1 feature the permissions can't deliver.

---

## SECURITY / ROBUSTNESS — mostly fine, add these

### S1. Overlay must render in a Shadow DOM, not global injected styles
Appending highlight boxes / tooltips to `<body>` with a global `<style>` will be clobbered by or clobber host page CSS, and strict page CSP can block inline `<style>`/`<script>` in the main world.

- The **axe scan** itself runs in the isolated world (`chrome.scripting` world `'ISOLATED'`, CSP-exempt) — that part is fine.
- The **overlay rendering** must be isolated: inject into a **Shadow Root** (or sandboxed iframe).

### S2. Overlay is a superset of what the report scores — state this explicitly
Overlay runs raw axe-core (pre-WCAGMap gate). Report only scores rules present in `wcag_mapping.go` (ruleID ∉ WCAGMap → excluded, per CLAUDE.md). The plan worries about "extension said fine, report said failing" but the **more likely** confusion is the reverse: "extension flagged X, report scored nothing."

Add one line: overlay = diagnostic superset; only WCAGMap-gated rules affect the score.

### S3. Pin the axe-core version explicitly
CLAUDE.md pins axe-core 4.12. Bundle that **exact** version in `vendor/axe.min.js` and keep the server on the same build so rule IDs line up. Plan currently just says "bundled axe-core" — add the explicit version pin.

### S4. Rate limit is fine — acknowledge it
All scan/score routes are 10/min per client IP (`router.go:36`, `middleware.go:53`). Overlay is client-side, so only "Get full report" hits the limit — 10 reports/min/user is plenty. No change needed; note it so a power user isn't surprised.

### S5. CORS forward-trap (no action now, note it)
`corsMiddleware` (`middleware.go:41`) sets `Access-Control-Allow-Origin: *`, which accepts `chrome-extension://` origins for **non-credentialed** fetches — so no CORS change is needed for v1. BUT if you ever add `credentials: 'include'`, `*` breaks and you must switch to the specific extension origin. Note as a forward trap.

---

## THINGS THE PLAN GETS RIGHT (keep, do not revisit)
- "Never accept client-computed axe as scoring input" (line 28): correct — backend signs its own JWT and re-fetches server-side; no trust path from client to score.
- Guest-token-then-scan mirrors the existing public frontend auth surface — no new auth attack surface.
- Web Store hygiene: bundled axe (no remote code), minimal permissions, privacy disclosure for URL transmission — all correct.
- JWT-refresh-as-prereq for free→paid handoff correctly identified as **backend scope**, not extension scope.

---

## SEQUENCING TWEAK
Add **item 0** before the competitive check: confirm the hardcoded-AAA in `handler.go:68` is intentional (see B2). It affects overlay parity AND the WCAG level the report claims. Resolve before building the overlay config, not after.

---

## ACTION CHECKLIST FOR BUILD AGENT
- [x] B1 — decide localhost report scope (public-only or ALLOW_PRIVATE_SCANS-gated); write into plan. → Resolved: public-only recommended for v1, documented as a "Known constraint" section.
- [x] B2 — pin extension axe run to AAA; fix plan wording; raise handler.go AAA-hardcode question. → Resolved: overlay pinned to AAA, open question flagged as sequencing item 0.
- [x] B3 — fix plan: `/api/v1/session` is GET. → Fixed throughout `chrome_implementation.md`.
- [x] U1 — define report handoff contract (A/B/C); verify `frontend/app-v2.js` render-from-JSON path exists. → Verified `renderResults()` (app-v2.js:619) exists but has no external entry point; chose option A (`?prefill=` query param, frontend re-scans) for v1, deferred postMessage direct-render (would reuse `renderResults` without a second scan) to v2.
- [x] U2 — reword v1 overlay as on-demand, not always-live. → Reworded; `<all_urls>` + `content_scripts` explicitly deferred.
- [x] S1 — render overlay in Shadow DOM / sandboxed iframe. → Added as a hard requirement.
- [x] S2 — add "overlay is superset; WCAGMap gates score" note. → Added as a required UI footnote.
- [x] S3 — pin `vendor/axe.min.js` to axe-core 4.12. → Added.
- [x] S5 — note CORS `*` forward-trap. → Added.

---

## ADDENDUM (second-pass verification, folded into `chrome_implementation.md`)

Two things this review didn't check that materially change the plan:

1. **The "JWT refresh prerequisite" in the original plan's sequencing was unnecessary.**
   `frontend/app-v2.js` (`ensureToken()` / `scheduleTokenRenewal()`, lines 169-208) already handles
   silent guest-session renewal by re-calling `GET /api/v1/session` before the cached token expires —
   there's no dedicated `/refresh` route on the backend, just a repeat call to `/session`. The
   extension should copy this client-side pattern instead of waiting on a backend change. This
   removes what was previously sequencing item 2 (backend JWT refresh work) as a blocker.
2. **U1's "reuse app-v2.js" instinct was correct but needed verification, and it's now done.**
   `renderResults(result)` (app-v2.js:619) is a real, working render-from-JSON function — confirming
   reuse is viable — but it has zero external entry points (no query param, no postMessage listener)
   as of this review. The v1 handoff therefore goes through a `prefill` query param that re-triggers
   the frontend's own `runScan()` (double-scan cost, zero new render code), with a direct-JSON
   postMessage handoff into `renderResults` deferred to v2 if the double scan proves too slow.
