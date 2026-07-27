# Chrome Extension Scanning (Native Engine Only)

## Context

The scanner currently only reaches pages the server's headless Puppeteer instance can navigate to directly. It can't scan pages that require login, SPA client-side state, or anything behind `localhost`/internal networks (blocked by the SSRF guard anyway). A Chrome extension that runs the scan **inside the user's live, already-authenticated tab** removes that limitation entirely — no navigation, no SSRF concern, no login walls.

Per direction, this uses the **native engine only** (`scripts/native_engine.js` + `scripts/rules/*.js` — already the server's default engine, `ACTIVE_ENGINE=native`), not axe-core. That engine is a natural fit: 67 of its 73 rules are pure `evaluate(document)` functions with no Puppeteer dependency — they already run unmodified inside a browser page context. Only 6 rules (`focus_order`, `focus_appearance`, `focus_visible`, `focus_not_obscured`, `content_on_hover`, `on_focus_context`) use `page.keyboard`/`page.mouse` and need content-script equivalents.

The rule IDs the native engine emits (`image-alt`, `focus-order-cycling`, etc.) already exist in `internal/models/wcag_mapping.go`, so **no WCAGMap changes are needed** — client-scanned results score identically to server-scanned ones.

## Architecture

```
Popup click → content script (native engine bundle runs in live tab)
            → background service worker (adds auth, POSTs to server)
            → NEW: POST /api/v1/scan/client  (Go)
            → same mapToScanResult() + scoring.Calculate/-AudioEye pipeline
            → ScanResult JSON back to popup
```

No Puppeteer, no `isPrivateURL()` check on this path — the server never fetches the page, so localhost/internal/authenticated pages work by design.

## 1. Shared rule source, single build step

Add `scripts/build-extension-engine.js`: reads `scripts/native_engine.js` + every `scripts/rules/*.js`, and for `type !== 'puppeteer'` rules inlines `id/impact/description/help/helpUrl/tags` plus `evaluate.toString()` (same technique `native_runner.js` already uses at line 91) into one generated bundle. This keeps the rule logic single-sourced — editing a rule in `scripts/rules/` updates both the server engine and the extension automatically on next build.

For the 6 `type: 'puppeteer'` rules, add hand-written content-script adapters in `extension/adapters/*.js` that reimplement the same check using DOM APIs instead of Puppeteer's CDP input (e.g. `focus_order.js`'s `page.keyboard.press('Tab')` becomes a content-script walk over the computed focus order calling `el.focus()` directly, comparing `document.activeElement`). Same rule `id` so scoring/WCAGMap treatment is unchanged.

Output: `extension/content/engine.bundle.js` (generated), containing `window.NativeEngine` + all 73 rules registered, ready to `chrome.scripting.executeScript` into a tab.

## 2. Extension (Manifest V3)

New `extension/` directory:
- `manifest.json` — MV3, `permissions: ["activeTab", "scripting", "storage"]`, `host_permissions` for the API origin, `action` (popup), no `content_scripts` declared statically — inject on demand via `chrome.scripting.executeScript` when the user clicks "Scan this page" (avoids running on every page load).
- `background.js` (service worker) — owns:
  - Token lifecycle: `GET /api/v1/session` → cache `{token, exp}` in `chrome.storage.local`, refresh before expiry. Direct port of `ensureToken()`/`scheduleTokenRenewal()` in `frontend/app.js`.
  - Screenshot capture via `chrome.tabs.captureVisibleTab()` (content scripts can't call this — must be background-driven), matching the `{fullPage jpeg}` shape `native_runner.js` produces (visible-tab only, not full-page, is the extension's realistic ceiling — known gap vs. server scans).
  - Relays the content script's raw `{violations, passes, incomplete}` message, attaches `url`, `links` (reuse the same anchor-extraction + blocked-host filter logic from `native_runner.js` lines 133–153, ported to content-script form), `screenshot`, then does the actual cross-origin `fetch` (background workers aren't bound by the page's CSP the way content scripts are).
- `content/engine.bundle.js` (generated, see §1) — injected on demand, calls `window.NativeEngine.run()` plus the 6 adapter checks, computes bounding boxes via `getBoundingClientRect()` (same math as `native_runner.js` lines 156–180), `postMessage`s the result back to `background.js`.
- `popup.html` / `popup.js` — "Scan this page" button → triggers injection + scan → shows `Summary.score`/`grade` once the server responds; link/button to open the full report (existing frontend can render a `ScanResult` — simplest path is opening the web app in a new tab with the result passed via `sessionStorage`/query param, no new server-side report storage needed for v1).

## 3. New server endpoint: ingest client-scanned results

`internal/api/handler.go`: add `func (h *Handler) ScanClient(w http.ResponseWriter, r *http.Request)`.
- Request body: `{url, violations, passes, incomplete, links?, screenshot?}` — same shape as `axeRawResult`/native engine output.
- Validate: URL format only (no `isPrivateURL()` — this path is expected to receive localhost/internal/authenticated URLs). Cap payload size and array lengths (violations/nodes/html snippet length) since input now comes from an untrusted browser extension rather than the sandboxed Puppeteer process — this is the one real trust-boundary change and needs explicit bounds.
- Reuse the existing mapping/scoring path: `mapToScanResult()` in `internal/scanner/axe_runner.go:150` currently takes an `axeRawResult` — export it (or add a thin exported wrapper) so `handler.go` can call it directly with the client-submitted JSON decoded into that same struct, then run it through the existing `scoring.Calculate`/`scoring.CalculateAudioEye` calls exactly as `AxeRunner.Scan()` does.
- Router (`internal/api/router.go`): `r.Post("/scan/client", jwtAuthMiddleware(h.ScanClient))`, alongside `/scan` and `/score`, inheriting the same rate-limit group. Add to `openapi.yaml` per CLAUDE.md's sync requirement.
- Auth: same guest-JWT flow as everything else — extension calls `/api/v1/session` exactly like the frontend does, no new auth mechanism.

## Files touched/added

- New: `scripts/build-extension-engine.js`
- New: `extension/manifest.json`, `extension/background.js`, `extension/popup.html`, `extension/popup.js`, `extension/adapters/*.js` (6 files)
- Generated: `extension/content/engine.bundle.js`
- Modified: `internal/scanner/axe_runner.go` (export `mapToScanResult` or add wrapper), `internal/api/handler.go` (add `ScanClient`), `internal/api/router.go` (add route), `openapi.yaml` (document new endpoint)
- No changes: `internal/models/wcag_mapping.go` (rule IDs already covered)

## Verification

1. `go build ./...` after handler/router changes.
2. `go test ./...` — add a table test for `ScanClient` covering: valid payload scores correctly, oversized payload rejected, malformed JSON rejected.
3. Manual: load `extension/` unpacked in `chrome://extensions`, open a page requiring login (or `localhost`), click "Scan this page", confirm popup shows a score and it matches running the same page's rules would produce server-side (spot-check a couple of known-bad elements).
4. Confirm `/api/v1/scan/client` rejects a request without a valid JWT (existing `jwtAuthMiddleware` behavior) and rejects a payload from a `localhost` URL is **not** blocked (unlike `/scan`).
