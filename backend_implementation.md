# Backend Implementation Plan — Native Engine as Sole Scanner

Status: proposed | Owner: TBD | Supersedes the "backend migration prerequisite" claim in
`chrome_implementation.md` (that claim was based on incomplete investigation — see Correction note
at the bottom).

## TL;DR

The backend is **much further along than the Chrome extension plan assumed**. Dual-engine support
already exists, defaults to native, and the Go-side output parsing / WCAGMap / SuggestionMap are
already fully compatible with native engine output — verified by diffing all 73 native rule IDs
against WCAGMap's keys: **zero gaps**. This is not a ground-up migration. It's five real, bounded
gaps to close before native can be trusted as the *only* engine, plus a decision on whether to
delete the axe-core path entirely.

## Current state (verified against code, not assumed)

- `internal/scanner/axe_runner.go:78-85` — `AxeRunner.Scan()` already branches:
  ```go
  scriptPath := a.axeScriptPath
  if config.GetActiveEngine() == "native" {
      scriptPath = a.nativeScriptPath
  }
  ```
  Both scripts are invoked identically (`node <script> <url> <wcagLevel>`) and their stdout is
  parsed into the same `axeRawResult` struct — the field names match exactly on both sides
  (`url`, `violations[].{id,impact,description,help,helpUrl,tags,nodes}`,
  `passes[].{id,description,nodeCount}`, `incomplete`, `links`, `screenshot`). No Go code change is
  needed for output parsing — this was clearly built as a drop-in swap from day one.
- `internal/config/config.go:135-142` — `GetActiveEngine()` **defaults to `"native"`** when unset.
  `config.go:224` — `Load()` sets `ActiveEngine: getEnv("ACTIVE_ENGINE", "native")`. **The backend
  runs on the native engine by default today**, not axe-core.
- `internal/api/handler.go:279-317` — there is already a runtime admin toggle:
  `GET /admin/settings` returns `active_engine`; `POST /admin/settings {active_engine: "axe"|"native"}`
  flips it live via `config.SetActiveEngine()`. No new endpoint needed to control this.
- `internal/models/wcag_mapping.go` (WCAGMap) — **verified via full extraction and diff**: all 73
  distinct `id:` values across `scripts/rules/*.js` have an exact-match key in WCAGMap already. The
  native engine's rule files were deliberately given axe-core-identical dash-style IDs
  (`color-contrast`, `button-name`, `focus-order-cycling`, etc.) specifically so WCAGMap didn't need
  a separate keyspace. Same for `internal/models/suggestions.go` (SuggestionMap) — spot-checked,
  same naming convention.
- `scripts/native_engine.js` (in-browser runner) and `scripts/native_runner.js` (Puppeteer CLI
  orchestrator) both already exist, are wired to real Chromium (`CHROMIUM_PATH` env, same headless
  launch flags as `axe_runner.js`), and produce the JSON shape the Go side expects, including
  `nodeCount` on passes (required for the AudioEye scorer per CLAUDE.md's "PassRule.node_count → axe
  runner must emit or AudioEye score breaks" warning — confirmed native emits it).

**Conclusion: there is no "wire up the native engine" step to do. It's already wired up and already
the default.** The work here is closing gaps that make it *safe* to rely on exclusively, and
deciding what to do with the axe-core path.

## Gaps to close

### G1 — WCAG level filtering doesn't exist in the native engine (real functional gap)

`axe_runner.js:40-49` filters which rules run via a `tagMap` (`A`/`AA`/`AAA` → axe tag sets), so
requesting a lower level genuinely runs fewer rules. `native_runner.js:16` accepts a `wcagLevel`
CLI arg (`const [,, url, wcagLevel = 'AA'] = process.argv`) but **never references it again in the
file** — every rule in `scripts/rules/` runs unconditionally regardless of what level was requested.
`native_engine.js.run()` also has no level concept — it runs every registered rule.

Practical impact: today, `Summary.Level` in the response says `"WCAG 2.1 AAA"` (or whatever level
was requested) but under the native engine that label doesn't reflect what actually ran — every
rule always runs. This is silent and would mislead anyone reading the report's stated level.
Combined with `handler.go:68`'s hardcoded `const wcagLevel = "AAA"` for `/scan` and `/score`, it's
currently masked in production (since AAA effectively means "run everything" under axe too), but it
becomes a real bug the moment anything requests a non-AAA level — e.g. the Chrome extension overlay,
or a future public API consumer.

**Fix:**
- Add a `levels: string[]` field to each rule module in `scripts/rules/` (mirroring axe's tag
  convention, e.g. `['wcag2a']`, `['wcag2aa']`, `['wcag2aaa']`, `['best-practice']`).
- In `native_runner.js`, filter which `domRules`/`puppeteerRules` get loaded based on the requested
  `wcagLevel`, same shape as `axe_runner.js`'s `tagMap` logic.
- In `native_engine.js`, either keep it level-agnostic (filtering happens at the loader in
  `native_runner.js`, which is consistent with how DOM rules are already selectively injected) —
  **recommended**, keeps `native_engine.js` itself simple and matches its existing minimal design.

### G2 — `video-captions-track-src` / `video-captions-track-lang` are dead under native (coverage gap)

`axe_runner.js`'s custom checks emit three distinct rule IDs for `<track>` validation:
`video-captions-track`, `video-captions-track-src`, `video-captions-track-lang` — each separately
keyed in WCAGMap and SuggestionMap. The native equivalent, `scripts/rules/video_track.js`, collapses
all three checks into **one** rule (`id: 'video-captions-track'`) that concatenates the failure
reasons into a single `failureSummary` string instead of firing three distinct violations.

Practical impact: not a scoring bug (the combined check still fires and still maps to 1.2.2 via the
one WCAGMap entry that does match), but it's a **reporting granularity regression** — dev-suggestion
text keyed to `video-captions-track-src`/`-lang` in `SuggestionMap` will never surface under native,
and any report/analytics that counts distinct rule IDs will undercount `<track>` issues.

**Fix (pick one, this is a product call, not just an engineering one):**
- (a) Split `video_track.js` into three rule modules matching axe's granularity — preserves existing
  WCAGMap/SuggestionMap entries and dev-suggestion text as-is. **Recommended** — least disruption,
  reuses content already written.
- (b) Keep the combined check and delete the two now-orphaned WCAGMap/SuggestionMap entries
  (`video-captions-track-src`, `video-captions-track-lang`) — simpler rule file, loses granularity
  in reporting.

### G3 — No test coverage exercises the native engine end-to-end

`internal/scanner/wcag122_test.go` (409 lines) tests `mapToScanResult` and related Go-side logic
directly — it does not invoke either `axe_runner.js` or `native_runner.js` as a subprocess, and has
zero references to `ActiveEngine`. There is currently no test that would catch a native-engine
regression (e.g. a rule file throwing, a missing `nodeCount`, a malformed JSON emission) before it
reaches production — and production already defaults to native.

**Fix:** add a scanner-level integration test that runs `native_runner.js` against a small local
fixture HTML page (checked into `scripts/` or `testdata/`) and asserts the JSON output shape matches
what `axeRawResult` expects, plus at least one test that intentionally trips a known violation
(e.g. an `<img>` with no `alt`) and confirms it appears in `violations[]` with a WCAGMap-mappable
`id`. This is @test-runner / @scanner-engineer scope.

### G4 — `handler.go:68`'s hardcoded `wcagLevel = "AAA"` becomes load-bearing once G1 lands

Right now the hardcode is close to a no-op under native (since native ignores level anyway, per G1).
Once G1 adds real level filtering, this hardcode will determine the *actual* rule set that runs for
every `/scan` and `/score` call, permanently, regardless of client input (`req.WCAGLevel` is
accepted into the request struct but discarded). **Decide before or alongside G1**: is always-AAA
intentional (run every rule regardless of what's asked, use the level label only for display), or
should the client-supplied level actually gate the rule set once the native engine can honor it?
This is a product decision, not a pure engineering one — flag it to whoever owns scoring/reporting
policy.

### G5 — Decide the fate of the axe-core path

The user's direction is "all use native, not axe-core." Two ways to execute that:
- (a) **Leave the dual-engine switch in place, just don't use it** — `ACTIVE_ENGINE` stays
  configurable but native is the only supported/tested path going forward; axe-core becomes a
  dormant fallback nobody flips to. Lowest risk, reversible if a native-engine regression surfaces
  post-launch.
- (b) **Delete the axe-core path entirely** — remove `AxeRunnerScript`/`axeScriptPath`, the `"axe"`
  branch in `config.SetActiveEngine`/`GetActiveEngine`, and eventually `scripts/axe_runner.js` +
  the axe-core npm dependency. Cleaner long-term, but removes the safety net before G1-G3 are proven
  in production, and axe-core is still the more battle-tested engine (native's rule set is
  hand-rolled and hasn't had axe-core's years of community hardening against edge-case DOM
  structures).

**Recommended: (a) now, (b) later.** Keep the fallback until native has run as the default in
production through at least one full scan-volume cycle with G1-G3 resolved, then remove axe-core in
a follow-up once you're confident. Don't do the irreversible cleanup on the same night as flipping
the effective behavior — the fallback in `SetActiveEngine("axe")` is exactly the tool you want
available for the first week after this ships.

### G6 — CLAUDE.md is now stale

CLAUDE.md's `custom:` line under `WCAGMAP` lists axe-core's custom check names
(`video-captions-present|track-src|track-lang|...`), and `FILES` still lists `axe_runner.js` as *the*
scanner script without mentioning `native_runner.js`/`native_engine.js`/`scripts/rules/` at all —
despite native being the default engine today. Update CLAUDE.md's `FILES` and `WCAGMAP` sections
once G1/G2 land, so the spec doc matches what's actually running. This is documentation hygiene, not
a blocker, but leaving it stale will mislead whichever agent (`@scanner-engineer`, `@wcag-auditor`)
touches this code next.

## What does NOT need to change

- `internal/api/handler.go`'s route wiring, JWT/auth, rate limiting — untouched, engine-agnostic.
- `internal/scoring/score.go` and the AudioEye scorer — both operate on the already-parsed
  `models.Violation`/`models.PassRule` structs, which are identical regardless of which engine
  produced them. No scoring code changes.
- `mapToScanResult()` in `axe_runner.go` — already engine-agnostic, confirmed by the shared
  `axeRawResult` struct working for both scripts' output today.
- WCAGMap's and SuggestionMap's existing entries — no re-keying needed (this directly corrects the
  "WCAGMap must be re-keyed" claim in the earlier Chrome extension plan revision — see Correction
  note below).

## Sequencing

1. **G4 decision first** (cheap, just a product call): confirm whether `handler.go:68`'s AAA
   hardcode should stay absolute or become level-aware. This determines how G1 is implemented.
2. **G1**: add level tagging to `scripts/rules/*.js` and filtering logic to `native_runner.js`.
3. **G2 decision + fix**: split `video_track.js` into three rules (recommended) or prune the two
   orphaned map entries.
4. **G3**: add native-engine integration test(s) so future rule changes can't silently break output
   shape or WCAGMap compatibility.
5. **G6**: update CLAUDE.md's `FILES`/`WCAGMAP` sections to reflect native as the documented default
   engine, not just an undocumented config flip.
6. Run the full `go test ./...` + `cd scripts && npm test` suite (per CLAUDE.md's `CMD` line) and
   confirm nothing regresses with native as the exercised default.
7. Leave `ACTIVE_ENGINE=axe` available as a fallback (G5 option a) for at least one production cycle
   before considering deleting `axe_runner.js` and the axe-core dependency outright.

## Correction note (for `chrome_implementation.md`)

The Chrome extension plan's "Engine: Native, not axe-core" section states the backend "has not been
migrated" and treats backend migration as a hard blocker on the "Get full report" CTA. That was
based on an incomplete grep (only checked for the literal string `native_runner` in
`internal/scanner/*.go` comments, missed `axe_runner.go`'s actual `config.GetActiveEngine()` branch)
and is **wrong** — the backend already defaults to native and already parses native output correctly.
It also claimed "WCAGMap must be re-keyed... or every native rule silently falls outside the
WCAGMap gate" — also wrong, verified zero gap across all 73 rule IDs.

**What the extension plan should say instead**: the backend is already running native by default;
the real pre-CTA dependencies are G1 (level filtering, so the extension's requested WCAG level
actually matches what the backend scores) and G3 (test coverage, so nobody ships a native-engine
regression under the extension's increased traffic). Both are smaller and faster than a "migrate the
backend" step. `chrome_implementation.md` should be updated to reference this doc and drop the
"blocking migration" framing — flagged here, not yet edited, since this doc's purpose is the backend
plan; the extension doc should be revised as a follow-up pass.
