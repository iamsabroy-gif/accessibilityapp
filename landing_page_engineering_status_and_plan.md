# Landing Page — Engineering Status & Remaining Work Plan

Status snapshot as of 2026-07-19. All findings below were verified by reading the actual uncommitted working-tree code (not assumed from a prior proposal). This is a build-status and remaining-work document, not a product/messaging plan — see `landing_page_implementation_plan.md` for the original product+tech proposal; content/copy decisions made there are final and not revisited here.

All files referenced are uncommitted (working tree only) unless noted.

---

## 1. What's Already Implemented and Working

**Routing logic** — `internal/api/router.go:59-67`
```go
r.Get("/", func(w http.ResponseWriter, req *http.Request) {
    w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
    if config.GetLandingPageEnabled() {
        http.ServeFile(w, req, filepath.Join(frontendDir, "landing.html"))
        return
    }
    http.ServeFile(w, req, filepath.Join(frontendDir, "index.html"))
})
```
`/app` (router.go:70-74) always serves `index.html` (the scan tool) regardless of the flag. The catch-all `/*` (router.go:76-84) still serves static files or falls back to `index.html` for unknown paths. Architecture is correct and matches the original plan (root = marketing when enabled, `/app` = scan tool always).

**Config plumbing** — `internal/config/config.go`
- `LandingPageEnabled bool` field (line 37), documented inline.
- `GetLandingPageEnabled()` / `SetLandingPageEnabled()` (lines 182-199), mutex-protected, exactly mirrors the existing `PDFScanningVisible` pattern.
- `LANDING_PAGE_ENABLED` env var read at boot, default `false` (line 249).

**Marketing page** — `frontend/landing.html` (778 lines, new). Fully built: header nav, hero, features/preview section, dual-scoring section, compliance badges, CI/CD integration section (`#ci-cd`), final CTA, footer. Content and copy are final per the earlier plan — not re-litigated here.

**`.env.example`** — one line added, `LANDING_PAGE_ENABLED=false`, correct format, consistent with existing entries.

**CLAUDE.md** — already documents `LANDING_PAGE_ENABLED` accurately against current router.go behavior.

**Build** — `go build ./...` passes clean as of this snapshot.

**CTA links that are real, not stubs**:
- CI/CD "Get Early Access" CTA (`landing.html:731`) — a genuine `mailto:early-access@accessscan.in?subject=...` link. This is a working lightweight lead-capture mechanism, not a dead button and not something requiring a backend form.
- Footer support link (`landing.html:771`) — working `mailto:support@accessscan.in`.

**Test file exists** — `internal/api/router_test.go` (new). `TestRouterLandingPageToggle` passes (`go test ./internal/api/... -run TestRouterLandingPageToggle -v` → PASS). It checks: `GET /` returns 200 with the flag off, 200 with the flag on, `GET /app` returns 200, `GET /api/v1/health` unaffected.

---

## 2. What's Incomplete, Missing, Untested, or Not Wired Up

Ranked by how release-blocking each is.

### 2.1 Dead auto-scan code path (highest priority — this is the core gap)
`frontend/app-v2.js` lines 2323-2338 (uncommitted, 19 lines added) read a `?url=` query param on `DOMContentLoaded`, prefill the URL input, strip the param via `history.replaceState`, then auto-trigger `runScan(autoUrl, 'AAA', depth)`.

**This code has no caller.** Verified by reading all of `landing.html`:
- Nav CTA (`landing.html:511`) → `href="/app"` — no query string.
- Hero CTA (`landing.html:528`) → `href="/app"` — no query string.
- Final hero CTA (`landing.html:757`) → `href="/app"` — no query string.
- Footer link (`landing.html:769`) → `href="/app"` — no query string.
- There is **no `<input>` or `<form>` anywhere on `landing.html`** for a visitor to type a URL before clicking through.

So the "hero CTA redirects into `/app?url=...`" behavior described in the original plan was never actually built into `landing.html` — only the *receiving* half (`app-v2.js`) was implemented. It is correct in isolation but unreachable in production today.

### 2.2 AAA hardcoded in the dead auto-scan path
Even setting aside 2.1, `runScan(autoUrl, 'AAA', depth)` hardcodes WCAG level `AAA` regardless of any level selector the app UI exposes, and regardless of CLAUDE.md's documented `WCAG_LEVEL` default of `AA`. This is a technical bug, not a copy issue — if/when this path is wired up, it will silently run every landing-page-referred scan at the wrong conformance level.

### 2.3 gofmt violations (hard CI-gate issue per CLAUDE.md)
CLAUDE.md defines `lint=gofmt -l .`. Running it now:
```
internal/api/handler.go
internal/config/config.go
```
Both files have misaligned struct/map-literal formatting introduced by the new field insertions (`LandingPageEnabled`, `pdf_scanning_visible` map entries). Confirmed via `gofmt -d` — pure whitespace realignment, no logic changes needed. This must be fixed before commit; it will fail lint otherwise.

### 2.4 Weak test coverage — status-code-only assertions
`router_test.go`'s `TestRouterLandingPageToggle` only asserts `w.Code == 200` in all four cases. It does **not** assert that the correct file body was actually served (e.g., a landing-page-only heading string vs. an index.html-only string). As written, the test would still pass even if the `if config.GetLandingPageEnabled()` branch in router.go were inverted or broken, since both `landing.html` and `index.html` return 200. This is the exact regression class most likely to occur here and the test currently can't catch it. There is also no coverage at all — Go or otherwise — of the `/app?url=` auto-scan behavior in app-v2.js.

### 2.5 Admin-settings parity gap (minor, inconsistency not a bug)
The codebase has an established pattern for exactly this kind of UI-only runtime flag: `PDFScanningVisible` is wired into `GetSettings`/`UpdateSettings` in `internal/api/handler.go` (lines 48, 280, 292, 310-318), letting an admin flip it live via `POST /api/v1/admin/settings` without a restart. `LandingPageEnabled` has the identical `Get`/`Set` shape in config.go but is **not** exposed in `handler.go` at all — `SetLandingPageEnabled()` is currently dead code, only ever called from `router_test.go`. Today, flipping the landing page live requires an env var change and a process restart, unlike the PDF-visibility flag it was explicitly modeled on. There's also no corresponding checkbox in any admin frontend UI (grepped `frontend/*.js`, `frontend/*.html` for "landing" — no hits outside `landing.html` itself).

---

## 3. Ordered Remaining-Task List

1. **Decide the fate of the auto-scan code (blocks the rest of the feature).**
   - *Recommended*: Add a single URL input + submit control to the landing hero (`landing.html`, near line 527) that builds `/app?url=<encodeURIComponent(value)>` and navigates there, so the already-correct `app-v2.js` logic actually gets exercised. This is the smaller lift since the JS receiving side is otherwise complete.
   - *Fallback*: if the hero must stay exactly as currently built (a single "Open Scanner App" link, no input box, per locked copy), then strip the `?url=` handling out of `app-v2.js` now and reintroduce it in a follow-up PR alongside the input. Do not ship unreachable, untested code silently.
2. **Fix the `'AAA'` hardcoding** in the auto-scan call — read whatever level control exists in the app (or default to `AA` per CLAUDE.md), regardless of which path from step 1 is taken.
3. **Run `gofmt -w internal/config/config.go internal/api/handler.go`**, then confirm `gofmt -l .` returns empty and `go build ./...` still passes.
4. **Resolve the admin-settings parity gap** — recommended: add `LandingPageEnabled` to `GetSettings`/`UpdateSettings` in `handler.go` following the exact `PDFScanningVisible` shape (pointer-bool request field so explicit `false` is distinguishable from omitted). Justification: the mutex-backed getter/setter already exists purely to support this, the added handler code is minimal, and a marketing on/off switch is exactly the kind of low-risk flag operators expect to flip without a redeploy.
5. **Strengthen `router_test.go`** to assert response *body* content (e.g., a string unique to `landing.html`'s hero heading vs. a string unique to `index.html`) for both flag states, not just HTTP status — this is the only way the test will actually catch a swapped/broken file-selection branch.
6. **Re-run full suite**: `go test ./...` and `cd scripts && npm test`.
7. **Final diff review** before commit: confirm no product copy/content changed, only code/tests/config, and that `.env.example` and CLAUDE.md stay in sync with whatever env var default is shipped.

---

## 4. Risk Notes Relative to Codebase Conventions

- **SSRF / `isPrivateURL()`**: The `?url=` auto-scan path (once wired) still routes through the existing `POST /api/v1/scan` endpoint and the same `runScan()` client call as manual use — it does not bypass the backend SSRF guard. No new server-side attack surface.
- **Phishing/CSRF-lite consideration**: because the auto-scan (if wired per step 1) fires on page load with no manual confirmation step, a crafted link like `yoursite.com/app?url=http://internal-service` requires only one click to trigger a scan, versus the current manual flow's paste-and-click. Worth a brief inline confirmation before auto-running once this path goes live — not worth over-engineering given the backend guard is unchanged either way.
- **FRONTEND_DIR / static-serving conventions**: both `/` and `/app` handlers correctly resolve through `frontendPath()` (respects `FRONTEND_DIR` override), consistent with the rest of router.go's static-file handling. No inconsistency found here.
- **WCAGMap gate**: not implicated by this feature — no new scan rules or scoring logic introduced.
