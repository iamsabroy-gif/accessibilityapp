# Landing Page Implementation Plan — AccessScan

Status: proposed, **revised 2026-07-20 for Phase 1 CI/CD alignment** (see §7) | Owner: TBD | Related: `CLAUDE.md`, `internal/api/router.go`, `frontend/`, `ci_cd_integration_implementation_plan.md`

**Revision note:** the base landing page (sections 1–6 below) is already built and largely matches this plan (`frontend/landing.html` exists, router/config wiring is in place — see `landing_page_engineering_status_and_plan.md` for build status). This revision does two things: (a) corrects a factual engine claim the live page currently makes, and (b) updates the CI/CD section's copy and destination now that a real Phase 1 CI/CD implementation plan exists (`ci_cd_integration_implementation_plan.md`). Nothing about the hero/live-preview/two-score/compliance sections changes.

## 1. Problem

`accessscan.in` currently has no marketing/landing page. The root URL (`/`) serves
`frontend/index.html`, which is the scan tool itself — a hero section immediately
followed by the live scan form. A cold visitor sees the tool but nothing that
explains what it does, why it's trustworthy, or what else it can do (dual
scoring, per-violation fix guidance, multi-format compliance reports, CI/custom
rule enforcement for engineering teams).

Goal: add a real landing page that showcases the product's capabilities and
funnels visitors into the existing scan tool, without regressing the current
scan UX, the guest-JWT flow, or anything under `/api/v1/*`.

## 2. Decisions (product + technical, synthesized)

| Decision | Choice | Why |
|---|---|---|
| Landing page location | New page becomes `/` | Cold traffic should land on marketing content, not straight into a bare form |
| Scan tool location | Moves to `/app` (already resolvable today via the SPA catch-all fallback — no new file move required, just an explicit route) | Keeps the tool's URL stable and bookmarkable; no behavior change to the tool itself |
| Hero CTA mechanism | Landing page hero has its own lightweight URL input that **redirects** to `/app?url=<encoded>` — it does NOT call `/api/v1/session` or `/api/v1/scan` directly | Avoids duplicating scan/session/render logic on two pages; keeps the landing page's only dependency being a redirect, not the API |
| Auto-run on `/app` | `/app` reads `?url=` on load, prefills the input, and auto-triggers the existing scan flow, then `history.replaceState`s the query param away so a refresh doesn't re-scan | One click from landing → result, no duplicate "paste it again" friction |
| Tech for the landing page | Hand-authored `frontend/landing.html` + inline/scoped CSS, no bundler, no framework | Matches the zero-tooling convention already used by `index.html`/`app-v2.js`; introducing Astro/Vite/etc. for one static page is unjustified complexity |
| Rollout control | `LANDING_PAGE_ENABLED` env var (default `false`) | Matches the existing `PDF_SCANNING_VISIBLE` precedent in this codebase for UI-only toggles; lets this ship dark and flip on without a deploy |
| Deployment | No Dockerfile/Caddyfile/GitHub Actions changes | Dockerfile already does `COPY frontend/ ./frontend/` — new static files under `frontend/` are picked up automatically |

## 3. What the landing page must communicate (product framing)

The core positioning call: **the tool itself is the hook — don't hide it
behind a "Learn More" click.** A cold visitor can already get a real,
personalized result in ~30 seconds with zero signup (guest JWT). Lead with
that literally.

### Section order for `frontend/landing.html`

1. **Hero** — H1 + subhead + a live URL input (redirects to `/app?url=...`) +
   button "Scan my site — free." Micro-trust line beneath: *"No account
   needed. Results in ~30 seconds. axe-core 4.12 engine."* A small chip row:
   `axe-core 4.12` · `63 rules across 43 WCAG 2.1 A/AA criteria` · `22 custom
   checks` · `per-element fix guidance`. Do not expose internal coverage
   status breakdowns (e.g. "14 implemented / 21 partial / 8 missing") —
   that's engineering truth-table detail, not marketing content, and it hands
   a skeptical buyer a reason not to trust the tool.

2. **Live result preview** — a static, realistic rendering of an actual scan
   result: grade dial (e.g. "C" + weighted score), 2–3 violation cards each
   showing impact badge (critical/serious/moderate/minor), the failing DOM
   snippet, and the dev fix suggestion. This is the #1 trust builder for a
   no-brand tool — it proves the tool is real without needing testimonials or
   logo walls (do not fabricate either).

3. **Two-score explainer** — "One score for your boss. One score for your
   engineers." Two cards side by side: the penalty-based A–F grade, and the
   AudioEye-style weighted-by-success-criterion score. This is the clearest
   differentiator vs. single-number competitors.

4. **How it works** — 3 steps: Paste URL → We scan (axe-core + 22 custom
   checks, real headless-browser rendering via Puppeteer, not static HTML
   parsing) → Get a graded report with per-element fixes.

5. **Compliance-format band** — "One scan, every compliance framework you'll
   be asked about." Chip/logo grid: ADA · VPAT · EN 301549 · EAA · UK · AODA
   · ACA · DDA · GIGW · CVAA · BITV. Worth calling out EAA specifically since
   it became enforceable in 2025 — a live buying trigger.

6. **For engineering teams / CI band** — "Enforce your own accessibility
   rules in CI — not just generic WCAG." Sells the modular/custom-rule
   architecture to the staff/lead frontend engineer buyer. Because CI
   self-serve signup doesn't exist yet, the CTA here should be honest:
   "CI integration — get early access" (mailto/contact form), not a fake
   "Sign up" flow. Overselling this to a technical buyer backfires harder
   than most audiences.

7. **Final CTA** — repeat the scan box + "Scan my site — free."

8. **Footer** — links, contact. Minimal.

### Explicitly excluded from the page
SSRF/private-URL protection, rate limiting (10 req/min), admin controls, and
the internal WCAG coverage status breakdown — all backend/ops concerns or
detail that undermines trust rather than building it.

## 4. Technical implementation

### 4.1 Routing changes — `internal/api/router.go`

Two explicit routes are added **before** the existing catch-all `r.Get("/*",
...)`. Chi resolves more specific routes first regardless of registration
order for static paths, but keep them declared before the wildcard for
readability and to avoid any ambiguity:

```go
frontendDir := frontendPath()
fs := http.FileServer(http.Dir(frontendDir))

// Landing page at root (feature-flagged)
r.Get("/", func(w http.ResponseWriter, req *http.Request) {
    if os.Getenv("LANDING_PAGE_ENABLED") == "true" {
        http.ServeFile(w, req, filepath.Join(frontendDir, "landing.html"))
        return
    }
    http.ServeFile(w, req, filepath.Join(frontendDir, "index.html"))
})

// Scan tool now lives explicitly at /app (works today via fallback; this
// just makes it a first-class, stable route)
r.Get("/app", func(w http.ResponseWriter, req *http.Request) {
    http.ServeFile(w, req, filepath.Join(frontendDir, "index.html"))
})

// Everything else: existing SPA-style fallback, unchanged.
r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
    path := filepath.Join(frontendDir, filepath.Clean("/"+req.URL.Path))
    w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
    if info, err := os.Stat(path); err == nil && !info.IsDir() {
        fs.ServeHTTP(w, req)
        return
    }
    http.ServeFile(w, req, filepath.Join(frontendDir, "index.html"))
})
```

No collision risk with `/api/v1/*` — that subtree is registered under its own
`r.Route("/api/v1", ...)` block, which chi matches before any top-level `/`
or `/app` handler regardless of ordering.

Because `/` is now an explicit `r.Get("/", ...)` route, static assets that
used to rely on the wildcard for path `/` (there weren't any — `/` always
fell through to `index.html` in the old code) are unaffected. Asset requests
like `/style-v2.css`, `/app-v2.js` still hit the wildcard fallback and are
served from disk as before, since chi treats `/` as distinct from `/*`.

### 4.2 Config — `internal/config/config.go`

Add `LANDING_PAGE_ENABLED` alongside the existing `PDF_SCANNING_VISIBLE`-style
optional boolean env vars. Default `false` so this ships dark and is flipped
on deliberately once the page is reviewed live. Document it in `CLAUDE.md`'s
`ENV` line the same way `PDF_SCANNING_VISIBLE` is documented today.

### 4.3 New file — `frontend/landing.html`

Hand-authored HTML, inline/scoped `<style>` (or a new `landing.css` if it
grows large), no build step — matching the existing `index.html` /
`app-v2.js` / `style-v2.css` convention (confirmed: `index.html` references
`style-v2.css` and `app-v2.js`, not the older `app.js`/`style.css` — use
`-v2` conventions for anything new).

The hero form is a plain `<form>` with a single URL `<input>` that, on
submit, navigates to `/app?url=<encodeURIComponent(value)>` — no fetch calls,
no JWT/session logic, zero JS dependency on the API from the landing page
itself.

### 4.4 Changes to `frontend/app-v2.js` (the live scan app script)

Add a small init check (near existing page-load init logic) that:
1. Reads `?url=` from `window.location.search`.
2. If present, prefills the URL input and calls the existing scan-trigger
   path (reuse the same function the manual "Scan" button calls — do not
   duplicate scan logic).
3. Calls `history.replaceState(null, '', '/app')` to strip the query param
   so a page refresh doesn't silently re-trigger a scan.

This is additive — no existing manual-entry behavior changes.

### 4.5 Deployment

Verified: `Dockerfile` already does `COPY frontend/ ./frontend/` (whole
directory), and `Caddyfile` just reverse-proxies all traffic to the Go
service on 8080. No Dockerfile, Caddyfile, or GitHub Actions workflow changes
are needed — new files under `frontend/` are picked up automatically on the
next build/deploy.

Only the VPS `.env` (referenced by `docker-compose.yml`'s `env_file: .env`)
needs `LANDING_PAGE_ENABLED=true` added once the page is ready to go live —
otherwise root continues to serve `index.html` exactly as it does today.

## 5. Step-by-step task breakdown

1. Confirm which script/stylesheet pair `index.html` currently loads
   (verified: `app-v2.js` + `style-v2.css` — the `-v2` files, not the older
   `app.js`/`style.css`, which appear to be legacy/unused).
2. Add `LANDING_PAGE_ENABLED` (default `false`) to `internal/config/config.go`
   and document it in `CLAUDE.md`'s ENV line.
3. Update `internal/api/router.go`: add explicit `r.Get("/", ...)` (flag-gated
   between `landing.html` and `index.html`) and `r.Get("/app", ...)` routes
   before the existing wildcard fallback, per section 4.1.
4. Author `frontend/landing.html` following the section order in section 3,
   reusing `style-v2.css` where possible for visual consistency with the
   scan tool (shared header/footer look).
5. Build the "live result preview" section (3.2) using a static, hand-crafted
   example result — no live API call needed for this section since it's
   illustrative, not a real scan.
6. Add the `?url=` auto-run + `history.replaceState` logic to
   `frontend/app-v2.js` (section 4.4), reusing the existing scan-trigger
   function.
7. Local test: run `go run cmd/server/main.go` with
   `LANDING_PAGE_ENABLED=true`, verify:
   - `/` serves the new landing page.
   - `/app` serves the existing scan tool unchanged.
   - Submitting the landing hero form navigates to `/app?url=...` and
     auto-starts a scan.
   - Refreshing `/app` after an auto-scan does not re-trigger the scan.
   - `/api/v1/session`, `/api/v1/scan`, and other API routes are unaffected.
   - With `LANDING_PAGE_ENABLED` unset/`false`, `/` behaves exactly as it
     does today (regression check).
8. Run `gofmt -l .` and `go build ./...` per `CLAUDE.md`'s CMD line.
9. Deploy via the existing GitHub Actions → VPS flow (push to `main`); leave
   `LANDING_PAGE_ENABLED` unset/`false` in the VPS `.env` initially.
10. Once reviewed on a staging/preview basis (or directly on prod with the
    flag off for everyone but the reviewer, if a preview path isn't
    available), set `LANDING_PAGE_ENABLED=true` in the VPS `.env` and restart
    the `webaccessibility` compose service to go live.
11. After the page is stable for a period, consider removing the flag and
    making the landing page the unconditional default at `/` (delete the
    `index.html`-at-root fallback branch), simplifying `router.go`.

## 7. Phase 1 CI/CD alignment updates (2026-07-20 revision)

Two changes, both to already-shipped `frontend/landing.html`, not to router/config/architecture — the routing and rollout-flag work in sections 4/5 above is unaffected.

### 7.1 Fix the engine claim (bug, not a CI/CD dependency — do this regardless)

The live page currently states, in three places, "Powered by axe-core 4.12":
- `<meta name="description">` (line 7)
- Hero micro-trust line: `"✓ No account required • Results in ~30 seconds • Powered by axe-core 4.12"` (line 534)
- A hero feature chip: `"🎯 axe-core 4.12 Engine"` (line 538)

This is factually wrong today — the product's default scanner is the in-house native engine (`scripts/native_engine.js` + `scripts/rules/*`, confirmed via `internal/config/config.go`'s `GetActiveEngine()`), not axe-core. Per the CI/CD plan's §8 positioning guidance: don't claim or imply an "industry-standard engine" that isn't actually running — it's a specific credibility landmine in a compliance product, and it's also just inaccurate marketing copy independent of any CI/CD work.

**Fix:** replace all three with engine-neutral, outcome-focused language:
- Meta description → `"...an accessibility scanner with a proprietary detection engine covering WCAG 2.1/2.2 A/AA..."` (drop "powered by axe-core 4.12" entirely; do not substitute "powered by our native engine" either until the CI plan's §9 validation pass gives that claim real backing).
- Hero micro-trust line → `"✓ No account required • Results in ~30 seconds • 63 checks across 43 WCAG success criteria"`.
- Hero chip → `"🎯 63 Automated Checks"` (replaces the axe-core-branded chip; the "63 rules across 43 WCAG 2.1 A/AA criteria" chip already two slots over becomes redundant once this changes — collapse to one chip, don't duplicate the number).

This is a pure copy fix in `frontend/landing.html`, no router/config changes, and can ship independently of the CI/CD work below.

### 7.2 CI/CD section — copy and destination, staged to match actual build status

`frontend/landing.html`'s `#ci-cd` section (~line 724) currently has a CTA: `<a href="mailto:early-access@accessscan.in?subject=CI/CD%20Accessibility%20Rules%20Early%20Access" ...>CI Integration — Get Early Access →</a>`. Per `ci_cd_integration_implementation_plan.md` §7, this should evolve in three stages tied to what's actually true, not jump ahead of the real build:

| Stage | When | CTA |
|---|---|---|
| **Now** | Before the CLI/Action exists | Keep the mailto, but change the copy to signal active development and capture a segmentation signal: *"CI/CD integration is in active development — GitHub Action shipping soon. Tell us your CI system (GitHub Actions / GitLab / generic CLI) and we'll prioritize accordingly."* Still a `mailto:`, not a form — no new backend needed. |
| **At MVP ship** | After the CI plan's engineering steps 1–11 land (native-engine test floor → axe-vs-native validation pass → CLI/Action built and published) | Replace the CTA with a direct link to the GitHub Action's marketplace listing / repo README — a real "try it" link, since Phase 1 needs no auth or account. |
| **At Phase 2** | Only once hosted/paid scanning with API keys exists | CTA becomes a self-serve signup flow (API key issuance, billing). |

**Do this now:** update the CTA copy per the "Now" row above — this is the only landing-page change the CI/CD plan requires today, since the CLI/Action itself isn't built yet. Do not link to a GitHub repo/Action that doesn't exist, and do not change the CTA again until the CI plan's validation gate (§9 of that plan) is actually passed — shipping the "real try it" link before validation would let a customer gate their build on an unvalidated detector, which is the exact risk that plan's timeline slip exists to avoid.

**No other landing page sections need to change for Phase 1 CI/CD** — the hero, live-preview, two-score, how-it-works, and compliance-format sections don't reference the scanning engine's CI story and stand as-is.

## 8. Open items / things to verify during implementation, not before

- Whether `frontend/app.js` and `frontend/style.css` (the non-`-v2` files)
  are still referenced anywhere (e.g. an old cached page, a test) before
  they're candidates for deletion — out of scope for this plan, just don't
  let landing.html accidentally reference the stale pair.
- Whether the "for engineering teams / CI" section's "get early access" CTA
  should point to a real mailto address or a lightweight form — a product
  decision, not a technical blocker; a `mailto:` link is sufficient for v1.
