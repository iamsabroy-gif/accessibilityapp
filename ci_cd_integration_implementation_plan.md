# CI/CD Integration — Implementation Plan

Status: planning document, synthesized 2026-07-19; **revised 2026-07-19** to correct an engine assumption (see "Revision note" below).
Scope: turns the landing page's `#ci-cd` teaser (frontend/landing.html, mailto CTA) into a real, shippable capability.

Verified against current code before planning (see "System facts confirmed" below) — this plan does not assume the CLAUDE.md summary is complete; it was checked against `internal/api/router.go`, `handler.go`, `middleware.go`, `jwt_middleware.go`, `internal/config/config.go`, `internal/scanner/scanner.go` / `axe_runner.go`, `scripts/native_runner.js`, `scripts/native_engine.js`, `scripts/rules/`, `internal/models/wcag_mapping.go`, `backend_implementation.md`, and `status.md`.

**Revision note:** the original version of this plan assumed `scripts/axe_runner.js` (Puppeteer + axe-core) is the engine to package into the CLI/Docker image/GitHub Action. That's wrong — the product's default scanning engine is now an in-house "native engine" (`scripts/native_runner.js` + `scripts/native_engine.js` + `scripts/rules/*`, 73 hand-rolled rules given axe-core-identical dash-style IDs so the existing WCAGMap gate works unchanged). `internal/config/config.go` confirms `native` is the default engine (`GetActiveEngine()`, line ~144/247), selected via `ACTIVE_ENGINE` (the old `axe` path still exists as a togglable fallback — see §9). Everything below is corrected for this. The MVP framing, auth/rate-limit analysis, exit-code semantics, output-format strategy, and mailto-CTA staging did not depend on which engine does the scanning and are carried over unchanged; sections that were axe-core-specific are rewritten and marked.

---

## 1. Recommended MVP scope

**Ship (Phase 1 — free, no auth, no backend changes):**
- A CLI + Docker image that bundles Puppeteer + **the native engine** (`native_engine.js` + `scripts/rules/*`, not axe-core) and runs the scan **entirely inside the CI runner** — it does NOT call the hosted `/api/v1/scan` endpoint.
- One published GitHub Action (Docker-based) wrapping that CLI.
- Configurable severity threshold for pass/fail (not the A–F grade, not the AudioEye score — those stay informational/exec-facing).
- Output formats: JSON (raw), SARIF (native GitHub code-scanning PR annotations), JUnit XML.
- WCAG rule gating consistent with the main product, via a generated `wcag_map.json` snapshot of `internal/models/wcag_mapping.go`.
- **New in this revision — a validation gate before public/paid launch:** an axe-vs-native side-by-side accuracy pass (see §9) and a minimal native-engine test floor (see §10), both required before this ships as something customers gate their builds on.

**Defer to Phase 2 (paid, hosted, async):**
- GitLab/Bitbucket CI templates (GitHub Actions first — it's where the SARIF integration is native and free, and where the initial buyer persona lives).
- PR-comment bot (beyond what SARIF's native annotations already give you).
- Hosted/authenticated scanning via the existing Go API (async job + polling).
- Historical trend dashboards.
- API keys / service-account auth system.

**Why this split:** product-ceo's read is that the buyer is a senior/staff engineer or eng lead who's been burned by an audit, legal letter, or an enterprise contract requiring VPAT/WCAG compliance — they want a deterministic CI gate, not a grade. tech-advisor's read is that running the scan locally in the runner sidesteps the two biggest current infrastructure blockers (IP-based rate limiting and the global concurrency semaphore) entirely, so **Phase 1 requires ~zero backend changes**. Both agents converge on the same MVP boundary independently — that convergence is the strongest signal in this plan and is unaffected by the engine correction.

---

## 2. Auth / API-key model

**Phase 1: none needed.** The CLI never calls the Go backend. It's a standalone artifact (Docker image + npm package) that runs Puppeteer + the native engine directly in the runner. This is deliberate — it also avoids exposing the current auth model's rough edges to external CI traffic (see below).

**Confirmed current auth reality (for Phase 2 planning):**
- `GET /api/v1/session` issues a **guest JWT with zero credentials required** — anyone can call it, 20-min expiry, `Subject: "guest"`.
- `POST /api/v1/token` issues a 30-min JWT but requires the caller already know the server's actual `JWT_SECRET` env var (`secret`/`client_secret` field) — this is a shared-deploy-secret flow, not a customer-facing credential. It cannot mint per-customer tokens today.
- `jwtAuthMiddleware` only validates signature + expiry — it does not check the subject claim at all (only `adminAuthMiddleware` checks `Subject == "admin"`). Any validly-signed JWT, guest or otherwise, passes every protected route except admin ones.
- **There is no concept of API keys or per-client identity anywhere in the codebase.**

This means the current auth model is structurally unfit for CI/machine-to-machine use as-is: it has no way to identify, rate-limit, revoke, or bill a specific customer's CI pipeline. Building Phase 2 hosted scanning without an API-key layer would mean every CI customer shares the same "guest" identity bucket.

**Phase 2 direction (do not build now, just don't paint into a corner):**
- Introduce API keys (`sk_live_...`, hashed at rest) as a parallel auth mechanism alongside the existing JWT flow — additive, not a replacement. Existing guest/session JWT behavior for the browser-based scan tool at `/app` is untouched.
- API keys map to a customer/org, enabling per-key rate limits, revocation, and billing — none of which "any signed JWT" can do.
- New route group (e.g. `/api/v1/ci/*` or version-namespaced) authenticated by API key, separate from `jwtAuthMiddleware`.

---

## 3. Rate limiting changes required

**Phase 1: none required** — the CLI doesn't hit the API, so the existing `httprate.LimitByIP(10, 1)` (10 req/min per IP, applied only to the `/scan`, `/score`, `/report/*` group in `router.go`) is never touched by CI traffic.

**Why this matters for Phase 2 (confirmed problem, not hypothetical):** the current limiter is keyed by IP. GitHub-hosted runners draw from shared IP pools used concurrently by many unrelated orgs and repos — a naive "just let CI call the hosted API" approach would have unrelated customers colliding against each other's rate limit, or a single busy CI customer exhausting the pool for others sharing that IP range. Any Phase 2 hosted-CI design must rate-limit **by API key**, not IP, and the global `MaxConcurrentScans` semaphore (`internal/config/config.go`, default 5, admin-adjustable via `/admin/settings`) will need either a per-key allocation or a separate pool from interactive/browser traffic so CI load can't starve the main scan tool.

---

## 4. CLI / GitHub Action interface

**Packaging:** Docker image as primary distribution (`ghcr.io/<org>/accessscan:vX`, built on `node:18-slim`). **Revised from the axe-core version:** the native runner (`native_runner.js:26`) already reads Chromium's path from a `CHROMIUM_PATH` env var and uses `puppeteer-core`, which never downloads its own Chromium — so there is no "Puppeteer download step" to skip in the first place. The Docker image just needs a distro Chromium installed and `CHROMIUM_PATH` set; `PUPPETEER_SKIP_DOWNLOAD` is moot for this engine. This is actually simpler than the axe-core assumption, not harder. Also publish an npm package (`npx @accessscan/cli`) for local/non-container use. The GitHub Action is a thin `docker` action (`action.yml`, ~20 lines) referencing the image.

**Source layout (revised):** extract `scripts/native_runner.js` + `scripts/native_engine.js` + `scripts/rules/*` (73 rule files, confirmed self-contained — no `require()` of any repo-internal module; each rule is a bare `module.exports = {id, type, tags, impact, evaluate}`) into a proper package (e.g. `packages/cli/`), refactored into an importable `scan(url, opts)` module plus a thin `bin/a11yscan.js` entry (commander/yargs). Existing Go-side usage via `internal/scanner/axe_runner.go` (which shells out via `exec.CommandContext(ctx, nodeBin, scriptPath, url, wcagLevel)`, selecting the script per `config.GetActiveEngine()`) must keep working unchanged — either the Go backend keeps pointing at a `scripts/` shim, or its `NATIVE_RUNNER_SCRIPT` config path is repointed at the new package location.

**Packaging constraint not present in the axe-core world:** `native_runner.js` serializes each DOM-type rule's `evaluate` function via `.toString()` and `eval()`s it inside the browser page, and reads `native_engine.js` from disk at runtime (`fs.readFileSync(path.join(__dirname, ...))`). This means the CLI package **must ship the engine and rule files as verbatim, unbundled assets** — running them through a minifier/bundler (esbuild, webpack, ncc) will break function serialization or the relative-path file reads. Copy-as-assets, don't bundle.

**Config schema:**
```
a11yscan <url...> [--urls-file urls.txt]
  --wcag-level A|AA            (default AA; see §9 on how this is honored — post-hoc filter, not native to the engine)
  --fail-on critical|serious|moderate|minor|none   (default serious)
  --warn-on <level>             (default moderate)
  --format json,sarif,junit     (default json)
  --output-dir ./a11y-results
  --timeout 180
```
Also supports an `.accessscan.yml` config file for teams that don't want long CI step arguments.

**Exit code semantics:**
- `0` — no violations at or above `--fail-on`.
- `1` — threshold breached (build should fail).
- `2` — scan error (page unreachable, browser crash) — deliberately distinct from `1` so CI can tell "the site is accessible but we couldn't reach it" apart from "the site has violations." Confirmed compatible: `native_runner.js` exits 1 with an `{error: ...}` JSON payload on navigation failure — the CLI wrapper maps that case to exit code 2.
- `--fail-on` is inclusive-upward (`serious` fails on serious AND critical). `--warn-on` violations are annotated but never affect exit code. `--fail-on none` gives a report-only adoption-ramp mode — useful for teams piloting the gate before enforcing it.

---

## 5. Output formats for CI consumption

- **SARIF** — highest leverage: GitHub's code-scanning native format, surfaces violations inline in the PR diff without building a custom PR-comment bot. This is the single biggest "looks like a real product" moment for Phase 1.
- **JUnit XML** — for teams whose CI dashboards (GitLab, Jenkins, CircleCI, generic test reporters) already parse JUnit as the lingua franca of pass/fail test results.
- **Plain JSON** — raw violation data (native engine schema — `id`, `impact`, `help`, `helpUrl`, `tags`, `nodes[].{html,target,failureSummary}`), confirmed shape-compatible with the axe-based output the Go backend already parses via the shared `axeRawResult` struct in `internal/scanner/axe_runner.go`. Note: minor prerequisite before building SARIF/JUnit formatters — audit `scripts/rules/*` for missing `tags`/`helpUrl` fields (e.g. `content_on_hover.js` currently has no tags at all), since SARIF rule metadata wants them populated.

Formatter code lives in the Node CLI package (`packages/cli/src/format/{sarif.js,junit.js,json.js}`), not in `internal/report/` — the CLI never touches the Go binary or API, so adding Go-side formatting logic would mean shipping two runtimes for no benefit. The one shared artifact between Go and the CLI is the WCAG rule gate: generate `wcag_map.json` from `internal/models/wcag_mapping.go` via a `go generate` step, checked into the CLI package, so CI results stay consistent with what the hosted scan tool considers in-scope — and so it can't silently drift. **Revised in this pass:** this generation step is extended to also emit a static SC-number → WCAG-level (A/AA/AAA) table, since `wcag_mapping.go` maps rule ID → SC numbers only, not levels — this table is what makes `--wcag-level` filtering honest (see §9).

Scoring note: the CLI does **not** port the penalty-based scorer or the AudioEye weighted scorer (`internal/scoring/score.go`) — those are informational/exec-facing, per product-ceo's guidance that engineers gating a build want severity thresholds, not a letter grade. Raw violation counts are carried in the JSON output for anyone who wants to compute their own summary.

---

## 6. Engineering task breakdown (priority order)

**Revised ordering** — the two gaps introduced by the engine swap (no test coverage, no level filtering) are pulled to the front because everything downstream packages and ships whatever the engine currently does, bugs and all.

1. **Native-engine test floor (NEW — blocking, do first).** Today nothing exercises `native_runner.js`/`native_engine.js` end-to-end, and `native_engine.js` currently swallows rule exceptions into a silent "incomplete" result with no failure signal — a broken rule produces no error anywhere. Minimum responsible coverage before packaging: (a) a rule-loader smoke test that loads all 73 rule files and asserts each exports `{id, evaluate}`, and — for DOM-type rules — that `evaluate.toString()` round-trips through `eval` (catches the asset-serialization hazard from §4); (b) a golden-fixture test against a local HTML page with planted violations spanning each impact tier, asserting the right rule IDs fire and every ID is a valid WCAGMap key; (c) a clean-page test asserting zero violations on a valid page (the false-positive guard — false positives are the failure mode that kills a CI-gate product); (d) exit-code/error-path tests (unreachable URL → error JSON + correct exit code). Roughly 2-3 days of work.
2. **Axe-vs-native validation pass (NEW — blocking before public/paid launch, see §9).** Use the still-present `ACTIVE_ENGINE=axe` toggle to run both engines across a corpus of 50-100 real pages, quantify per-rule divergence, and fix or disable outlier native rules before this ships as something a customer's build gate depends on.
3. **Engine/rules versioning (NEW — blocking for packaging).** Neither `native_runner.js` nor `native_engine.js` currently exposes any version identifier — there is no equivalent of an "axe-core version" today. Add an `ENGINE_VERSION` constant plus a rules manifest (rule-ID list + content hash) emitted in every CLI output. Without this, "my build started failing after an unrelated update" is undiagnosable — a regression from the axe-core case, since axe at least had an npm-published version.
4. **Extract the scan engine (revised).** Move `native_runner.js` + `native_engine.js` + `scripts/rules/*` into `packages/cli/` as an importable `scan(url, opts)` module (not just a script invoked by the Go scanner), with a CLI entrypoint wrapping it. Ship engine/rules as verbatim assets, not bundled/minified (§4 constraint). Existing Go-side usage via `internal/scanner/axe_runner.go` / `config.GetActiveEngine()` must keep working unchanged.
5. **Generate `wcag_map.json` + static SC-to-level table.** Add a `go generate` step that exports `internal/models/wcag_mapping.go` to JSON, extended with a static WCAG-spec SC→level (A/AA/AAA) lookup (~50 fixed entries); wire a CI check so it can't drift from the Go source of truth.
6. **Implement `--wcag-level` as a post-hoc filter (revised — see §9 for why this is the right approach given G1).** Run all rules, then drop violations whose SCs are entirely above the requested level using the table from step 5. This is honest and correct even though the engine itself doesn't natively distinguish levels; label results only with levels the CLI actually filtered on the WCAGMap data, never with a level the engine "silently" claims. Filing native, loader-level rule tagging (rules declaring their own level) as a fast-follow performance optimization, not a v1 blocker.
7. **Build the threshold/exit-code logic** (`--fail-on`/`--warn-on`, exit codes 0/1/2) as a small pure function in the CLI package — unit-tested in isolation.
8. **Build the three formatters** (SARIF, JUnit, JSON) consuming the native-engine violation output + the WCAG gate.
9. **Package the Docker image** with a distro Chromium and `CHROMIUM_PATH` (simpler than originally planned — see §4); verify cold-start time and image size are CI-friendly.
10. **Publish the GitHub Action** (`action.yml` wrapping the Docker image) with a README showing a real workflow snippet (checkout → run action → upload SARIF via `github/codeql-action/upload-sarif`).
11. **Publish the npm package** for local/non-Action use (`npx @accessscan/cli`), with `puppeteer-core` as its only meaningful runtime dependency — `axe-core` is dropped entirely from the CLI's dependency tree.
12. **Update the landing page CTA** (see §7) once the Action is published, validated (step 2), and works end-to-end against a real repo.
13. *(Explicitly not in this pass, tracked for Phase 2 only):* API-key auth layer, per-key rate limiting, async hosted-scan job endpoint (`POST /api/v1/scans` → `202 {job_id}` → `GET /api/v1/scans/{id}`), GitLab/Bitbucket templates, PR-comment bot, native rule-level tagging (fast-follow perf optimization from step 6).

**Phase 2 corner-avoidance note for whoever picks this up later:** keep `ScanResult` JSON byte-stable; Phase 2 should wrap it (`{job_id, status, result: ScanResult}`) rather than mutate it, and the CLI's "get result" step should already be isolated behind one function so a future `--hosted --api-key` flag can swap local execution for polling without touching the formatters.

---

## 7. The mailto placeholder — what to do now

Keep it as a capture mechanism, but change what it signals — don't leave it as a dead-drop, and don't jump straight to a fake self-serve flow either (that was the correct call originally and remains correct until there's a working, validated Action to point to).

**Now (before MVP ships):** Update the CTA copy on `frontend/landing.html` (`#ci-cd` section, ~line 724) from a bare `mailto:` link to an honest in-development message with a segmentation hook, e.g.:

> "CI/CD integration is in active development — GitHub Action shipping soon. Tell us your CI system (GitHub Actions / GitLab / generic CLI) and we'll prioritize accordingly."

This keeps the mailto (or a lightweight form backed by the same mailto/waitlist) but adds a data point: which CI system to build the *second* integration for, since GitHub Actions is first by design (native SARIF support).

**At MVP ship:** replace the CTA with a direct link to the GitHub Action's marketplace listing / repo README — a real "try it" link, not a signup form, since Phase 1 requires no auth and no account. Ship this only after §9's validation pass, not right after §6 step 1's test floor alone.

**At Phase 2 (paid hosted tier):** only then does the CTA become a self-serve signup flow (API key issuance, billing) — because only at that point does a real customer-facing product exist behind the button.

---

## 8. Positioning — no more "industry-standard engine" implication (NEW, product-ceo)

The old plan implicitly leaned on axe-core's reputation (a decade-old, widely-trusted engine also used by Lighthouse, pa11y, jest-axe) as a credibility anchor. That anchor is gone. Do not say or imply "powered by axe-core" or any other "industry-standard engine" claim anywhere in the CLI's docs, README, or marketing — it's now false, and false claims are a specific landmine in a compliance product.

**Honest reframe:** lead with outcomes and coverage, not engine pedigree — e.g. "73 automated checks mapped to WCAG 2.1/2.2 A/AA/AAA success criteria, tuned for CI gating." Anchor credibility on the *standard being tested against* (WCAG), not the tool doing the testing.

**Differentiator, earned only after §9:** "fully owned, proprietary detection engine" is a legitimate sellable differentiator — no upstream MPL-2.0 dependency, faster iteration on new WCAG 2.2 criteria, custom rules a stock-axe competitor can't match, full roadmap control. But this story is only credible once backed by validation data (§9). Sell "owned + accurate," never "owned" alone — unvalidated, "proprietary engine" reads as a liability being spun, not a strength.

---

## 9. Validation gate before public/paid launch (NEW, product-ceo + tech-advisor)

The native engine ships 73 hand-rolled rules directly into customers' build gates with, as of this writing, zero end-to-end test coverage. In a CI gate product specifically, the two failure modes are asymmetric and both bad: a false positive breaks a paying customer's deploy (churn, public complaint); a false negative means the tool certified an inaccessible page as passing (undermines the entire compliance claim the buyer is paying for). The §6 step 1 test floor proves the engine *runs*; it does not prove the engine is *right*.

**Recommendation (product-ceo, concurred by tech-advisor): gate v1 public/paid launch on an axe-vs-native validation pass, not just the test floor.** The codebase still has a dormant `ACTIVE_ENGINE=axe` toggle (per `backend_implementation.md`'s planned G5 removal, this will not be true forever) — use it now, while it's nearly free, to run both engines across a corpus of 50-100 real pages, quantify per-rule precision/recall divergence, and fix or disable outlier native rules before those rules can fail a customer's build. This is the cheapest insurance available and gets meaningfully more expensive once the axe path is removed.

**On `--wcag-level`:** ship it in v1 rather than dropping it — it's table stakes for a CI gate (teams need to gate on AA specifically) and the post-hoc filtering approach (§6 step 6) is honest and standard practice once built (axe-core itself works the same way via tag filtering). Only mark it experimental if the validation pass surfaces level-mapping gaps; don't ship it silently broken, and don't hide it either.

**Timeline call:** slip v1 to accommodate the validation pass. It is realistically days, not weeks, given the toggle already exists. Sequence: test floor (§6 step 1) → axe-vs-native validation (§6 step 2) → fix/disable outlier rules → package and ship. Shipping a compliance gate on an unvalidated detector to save one to two weeks is the trade most likely to damage the product's core promise; the slip is worth taking.

---

## 10. Where product-ceo and tech-advisor agreed (confidence-boosting convergence)

- Both independently concluded Phase 1 should run **entirely inside the CI runner**, not call the hosted API — product-ceo for adoption/simplicity reasons, tech-advisor because it structurally avoids the IP rate-limit and concurrency-semaphore problems that are real, verified constraints in the current code. Unaffected by the engine correction.
- Both agreed pass/fail should be **severity-threshold based**, not the letter grade or AudioEye score. Unaffected by the engine correction.
- Both agreed the mailto placeholder should evolve in stages tied to what's actually true at each point, not jump straight to self-serve — now explicitly gated on §9's validation pass, not just a working Action.
- **New convergence in this revision:** both agents independently concluded the native engine's current lack of test coverage and validation data is a launch-blocking issue, not a nice-to-have — tech-advisor from an engineering-risk angle (silent exception swallowing, no version identity), product-ceo from a trust/compliance-claim angle (false positives/negatives are product-killing in this category).

## Tension worth flagging

product-ceo frames Phase 2 pricing as "Team tier, ~$49–99/mo per org" bundled with hosted scanning, trend dashboards, and a PR-comment bot. tech-advisor's Phase 2 sketch (API keys, async job endpoint) is scoped more narrowly — just enough infrastructure to support hosted CI scanning, not the full dashboard/bot feature set. These aren't in conflict, but Phase 2 engineering scope will need its own follow-up plan once there's real Phase 1 adoption data — don't pre-build the dashboard/bot before confirming paid demand exists.

## System facts confirmed by reading the code (2026-07-19, extended for the engine correction)

- `internal/api/router.go`: `/scan`, `/score`, `/report/*` are grouped under `rateLimitMiddleware()`; all are also behind `jwtAuthMiddleware`.
- `internal/api/middleware.go`: `httprate.LimitByIP(10, 1)` — 10 req/min, keyed by IP. CORS is wide open (`Access-Control-Allow-Origin: *`).
- `internal/api/jwt_middleware.go`: `jwtAuthMiddleware` checks signature + expiry only, not subject — any validly signed JWT (including guest) passes. `adminAuthMiddleware` additionally requires `Subject == "admin"`.
- `internal/api/handler.go`: `GET /session` issues a no-credential guest JWT (20 min). `POST /token` requires the caller supply the actual `JWT_SECRET` value (30 min) — not usable as a customer credential. No API-key concept exists anywhere.
- `POST /api/v1/scan` is fully synchronous: `context.WithTimeout` (default 180s via `SCAN_TIMEOUT_SECONDS`), gated by a global `MaxConcurrentScans` semaphore (default 5, adjustable via `/admin/settings`), calling `h.Scanner.Scan(...)` via `internal/scanner/axe_runner.go`, which shells out (`exec.CommandContext(ctx, nodeBin, scriptPath, url, wcagLevel)`) to whichever script `config.GetActiveEngine()` selects — `native_runner.js` by default, `axe_runner.js` still available via the `ACTIVE_ENGINE=axe` toggle. Returns full `ScanResult` JSON synchronously. No async/job-id/webhook pattern exists.
- `internal/config/config.go` (~line 144/247): confirms `native` is the default active engine.
- `native_runner.js` (line 9/16): `node native_runner.js <url> [wcag_level]`, arg handling byte-identical to `axe_runner.js` — but the `wcag_level` argument is accepted and never used (confirmed gap G1: the native engine runs every registered rule regardless of level, no A/AA/AAA distinction).
- `scripts/rules/*` (73 files): each a bare `module.exports = {id, type, tags, impact, evaluate}` with zero `require()` of repo-internal modules — self-contained and portable, but only ~11 WCAG 2.2 rules carry level tags; most others carry SC-number tags only, and at least one (`content_on_hover.js`) has no tags at all. `internal/models/wcag_mapping.go` maps rule ID → SC numbers, not levels — a static SC→level table needs to be added (§6 step 5).
- `native_engine.js`: swallows rule-evaluation exceptions into a silent "incomplete" result with no failure signal (confirmed gap G3: no end-to-end test coverage exists for the native engine today).
- `native_runner.js` serializes DOM-rule `evaluate` functions via `.toString()`/`eval()` and reads `native_engine.js` from disk at runtime — CLI packaging must ship these as unbundled, verbatim assets.
- `ScanResult` includes a penalty-based score/grade and an AudioEye-weighted score; no SARIF/JUnit output exists today.
- Deployment: Docker + Caddy on a single VPS; GitHub Actions already auto-deploys on push to `main` (internal deploy pipeline, unrelated to this feature).
