# Project Audit — Web Accessibility Scanner
**Date**: 2026-07-07  
**Scope**: Full codebase audit covering WCAG coverage, scanner implementation (axe_runner.js, native_engine.js, native_runner.js, rules/), scoring logic, API surface, models, config, security, tests, and dependencies.

> **⚠ PARTIAL RESOLUTION — 2026-07-10**
> Gaps 1, 2, 3, 4, 5, 6 from the FSD (`fsd.md`) have been implemented.
> See §1.1, §1.2, §3.1, §3.2 RESOLVED notes below.
> All remaining issues (security, native runner, API) are still open.

---

## Summary Table

| # | Category | Issue | Severity |
|---|----------|-------|----------|
| 1 | WCAG Coverage | 16 WCAG 2.1/2.2 Level AA criteria have no mapped rules | HIGH |
| 2 | WCAG Coverage | 7 WCAG 2.2 custom rules have no sc_registry entries | HIGH |
| 3 | Scanner (axe) | Custom checks don't emit `node_count` — AudioEye rates miscalculated | HIGH |
| 4 | Scanner (axe) | Silent `catch` blocks swallow errors with no logging | MEDIUM |
| N1 | Native Runner | `console.error` on Puppeteer rule failure corrupts stdout JSON — Go JSON parse fails | CRITICAL |
| N2 | Native Runner | `eval()` used to reconstruct DOM rule functions — breaks closure-dependent rules silently | HIGH |
| N3 | Native Runner | Missing rules directory silently produces zero rules → score reported as 100 | HIGH |
| N4 | Native Runner | SSRF blocklist in link extraction covers only `172.16.x` — rest of RFC 1918 `172.17–31` unblocked | HIGH |
| N5 | Native Runner | `ignoreHTTPSErrors: true` allows connecting to hosts with invalid TLS certificates without warning | MEDIUM |
| N6 | Native Runner | `wcagLevel` argument received but never passed to rules — AA/A filtering has no effect | MEDIUM |
| N7 | Native Runner | Top-level error handler leaks full stack trace to stdout, which Go parses as scan output | MEDIUM |
| N8 | Native Engine | No per-rule execution timeout — one hanging rule blocks all subsequent rules | MEDIUM |
| N9 | Native Engine | Rule errors classified as `incomplete` with `nodeCount:0` — not visible in scoring | MEDIUM |
| N10 | Native Rules | `focus-appearance` tagged `wcag22aaa`; WCAG 2.4.13 is Level AA in WCAG 2.2 | MEDIUM |
| N11 | Native Rules | `color_contrast.js` custom luminance implementation may diverge from WCAG spec algorithm | MEDIUM |
| N12 | Native Rules | `color_contrast.js` deduplicates passes but not violations — pages with repeated text inflate violation counts | LOW |
| N13 | Native Runner | First navigation failure (`networkidle2`) is silently discarded with `catch (_)` | LOW |
| N14 | Native Engine | `node_count` correctly emitted by native engine — §3 (axe_runner.js) does not apply here | INFO |
| 5 | Scoring | Compliance % ignores `incomplete` rule count | MEDIUM |
| 6 | Scoring | AudioEye silently returns score 100 when no rules are evaluated | MEDIUM |
| 7 | Scoring | Grade thresholds are hardcoded with no documentation | LOW |
| 8 | API | SSRF blocklist is inconsistent between handler and middleware | HIGH |
| 9 | API | Public auth endpoints (`/token`, `/admin/verify`) are not rate-limited | HIGH |
| 10 | API | `GET /secret` endpoint exposes the JWT signing secret | HIGH |
| 11 | API | Admin password stored and compared as plaintext | MEDIUM |
| 12 | API | Error responses expose internal details | MEDIUM |
| 13 | API | `depth` scan parameter accepts negative values | LOW |
| 14 | Models | `violationIndex` JSON tag is camelCase; all others are snake_case | MEDIUM |
| 15 | Models | `Passes []string` and `PassRules []PassRule` duplicate pass data | LOW |
| 16 | Models | `PassGuidelines`, `ViolationGuidelines`, `IncompleteGuidelines` unused | LOW |
| 17 | Config | `generateRandomSecret` falls back to a hardcoded static string | HIGH |
| 18 | Config | No validation on `PORT`, `SCAN_TIMEOUT_SECONDS`, `MAX_CONCURRENT_SCANS`, `WCAG_LEVEL` | MEDIUM |
| 19 | Security | CORS allows wildcard origin (`*`) | MEDIUM |
| 20 | Security | No audit logging for auth failures, secret changes, or admin operations | MEDIUM |
| 21 | Security | Puppeteer `--no-sandbox` flag in use | HIGH* |
| 22 | Tests | Scoring formula, compliance %, and edge cases have no test coverage | MEDIUM |
| 23 | Tests | Only 1 of 22+ custom scanner checks has a test file | MEDIUM |

*Mitigated if scanner runs in an isolated container or VM.

---

## 1. WCAG Coverage

**File**: `internal/models/wcag_mapping.go`

### 1.1 — WCAG 2.1/2.2 Level A/AA criteria with no rules mapped
**Severity**: HIGH | **Status**: ✅ RESOLVED (2026-07-10, fsd.md implementation)

> **Correction**: The original audit listed 16 unmapped SCs. Re-verification (2026-07-10) shows **2.4.6 is already mapped** (`empty-heading`, `page-has-heading-one` → `2.4.6`). The live unmapped set was **15**.
>
> **Resolution**: Of the 15, 9 were already declared `NotAutomatable:true` with LimitationNotes. The remaining 6 (`1.2.5`, `1.4.2`, `2.1.4`, `2.5.2`, `3.3.3`, `4.1.3`) have been flagged `NotAutomatable:true` in `sc_registry.go` with honest LimitationNote text. All 15 now render as explicit `Not Evaluated` with a non-empty remark instead of silently dropping from reports.

The following success criteria have no rules in `WCAGMap` and are therefore completely undetected by the scanner (all now declared `NotAutomatable:true`):

| SC | Title | Level | Resolution |
|----|-------|-------|------------|
| 1.2.4 | Captions (Live) | AA | Pre-existing NotAutomatable |
| 1.2.5 | Audio Description (Prerecorded) | AA | **Newly flagged 2026-07-10** |
| 1.4.2 | Audio Control | A | **Newly flagged 2026-07-10** |
| 1.4.5 | Images of Text | AA | Pre-existing NotAutomatable |
| 2.1.4 | Character Key Shortcuts | A (2.1) | **Newly flagged 2026-07-10** |
| 2.2.2 | Pause, Stop, Hide | A | Pre-existing NotAutomatable |
| 2.3.1 | Three Flashes or Below Threshold | A | Pre-existing NotAutomatable |
| 2.4.6 | Headings and Labels | AA | ~~Unmapped~~ — **already mapped** (was a stale audit entry) |
| 2.5.2 | Pointer Cancellation | A (2.1) | **Newly flagged 2026-07-10** |
| 2.5.4 | Motion Actuation | A (2.1) | Pre-existing NotAutomatable |
| 3.2.2 | On Input | A | Pre-existing NotAutomatable |
| 3.2.3 | Consistent Navigation | AA | Pre-existing NotAutomatable |
| 3.2.4 | Consistent Identification | AA | Pre-existing NotAutomatable |
| 3.3.3 | Error Suggestion | AA | **Newly flagged 2026-07-10** |
| 3.3.4 | Error Prevention (Legal, Financial, Data) | AA | Pre-existing NotAutomatable |
| 4.1.3 | Status Messages | AA (2.1) | **Newly flagged 2026-07-10** |

**Impact**: Scans report partial compliance while these criteria go completely unchecked. Compliance percentages are overstated.

### 1.2 — WCAG 2.2 custom rules missing from sc_registry
**Severity**: HIGH | **Status**: ✅ RESOLVED (2026-07-10, fsd.md implementation)

> **Resolution**: All 7 WCAG 2.2 SCRegistry entries have been added to `internal/models/sc_registry.go`. The WCAG 2.2 skip (`if scMeta.WCAGVersion == "2.2" { continue }`) has been removed from `BuildComplianceReport`. WCAG 2.2 SCs now appear in all compliance reports except 508-mode (where they render as `Not Applicable`).

These rules exist as custom checks in `axe_runner.js` and now have entries in `internal/models/sc_registry.go`:

- `target-size` → 2.5.8 (scores via normal path — real signal)
- `accessible-authentication` → 3.3.8 (scores via normal path — real signal)
- `dragging-movements` → 2.5.7 (scores via normal path — real signal)
- `focus-not-obscured` → 2.4.11 (scores via normal path — real signal)
- `consistent-help` → 3.2.6 (NotAutomatable — always incomplete, multi-page)
- `redundant-entry` → 3.3.7 (NotAutomatable — always incomplete, multi-step)
- `focus-appearance` → 2.4.13 (scores via normal path — real signal)

---

## 2. Scanner Implementation

**File**: `scripts/axe_runner.js`

### 2.1 — Custom pass results do not emit `node_count`
**Severity**: HIGH

The AudioEye scorer uses `node_count` (aliased as `nodeCount` in JS) to compute per-SC failure rates. When a pass result omits this field, the scorer falls back to `p.nodeCount || 1` (line 1343), treating every passing check as testing exactly 1 element regardless of how many elements were actually found. This distorts the `failure_rate` calculation for every affected SC.

**Affected checks** (all custom, not axe-core):
- `g58-media-alternative-link`
- `h53-object-alternative`
- `video-captions-present`
- `video-captions-track-src`
- `video-captions-track-lang`
- `color-only-indicator`
- `non-text-contrast`
- `focus-order-cycling`
- `focus-visible`
- `resize-text`
- `on-focus-context-change`
- `orientation-lock`
- `multiple-ways`
- `pointer-gestures`
- `sensory-characteristics`
- `content-on-hover`
- `timing-adjustable`
- All `meaningful-sequence-*` variants

**Fix**: Each pass push should include `nodeCount: <count of elements tested>`, e.g.:
```javascript
passes.push({
  id: 'video-captions-present',
  description: 'Video element has captions.',
  nodeCount: videoEls.length - failCount
});
```

### 2.2 — Silent `catch` blocks suppress error context
**Severity**: MEDIUM  
**Lines**: ~362, 370, 774, 897, 936 (representative)

Multiple try/catch blocks silently discard errors:
```javascript
catch (e) { /* ignore cross-origin sheets */ }
catch (_) { /* element hidden or stale – skip */ }
```

When a check fails entirely (e.g., CSS parsing crash, stale Puppeteer handle), violations are silently lost. There is no way to distinguish "no violations found" from "check crashed."

**Fix**: Log suppressed errors at debug level: `console.error('[axe_runner] check skipped:', e.message)`.

---

## 2b. Native Engine & Native Runner

**Files**: `scripts/native_runner.js`, `scripts/native_engine.js`, `scripts/rules/`

The native engine is the alternative scanner (activated when `ACTIVE_ENGINE=native`). It replaces axe-core with a fully custom DOM + Puppeteer pipeline: `native_engine.js` is injected into the browser page to run DOM rules; `native_runner.js` orchestrates the Puppeteer session and drives both DOM rules and Puppeteer rules from `scripts/rules/`. Results flow back to Go through the same `axeRawResult` JSON contract.

---

### N1 — `console.error` in Puppeteer rule handler corrupts stdout JSON
**Severity**: CRITICAL  
**File**: `native_runner.js`, lines 127–129

```javascript
} catch (e) {
    console.error("Puppeteer rule error in " + rule.id, e);  // goes to stderr
}
```

Go calls the script with `cmd.CombinedOutput()`, which **merges stdout and stderr into a single byte slice** before JSON parsing. Any `console.error` call during a Puppeteer rule error prefixes or interleaves text into the JSON stream, breaking `json.Unmarshal` and returning a parse error for the entire scan.

**Affected rules**: all 6 Puppeteer-type rules (`focus_appearance`, `focus_visible`, `focus_not_obscured`, `focus_order`, `on_focus_context`, `content_on_hover`).

**Fix**: Replace `console.error` with `process.stderr.write(...)` and switch Go to use `cmd.Output()` (stdout only) plus `cmd.Stderr = os.Stderr` for stderr separately, so the two streams never merge.

---

### N2 — `eval()` to reconstruct DOM rule functions silently breaks closure-dependent rules
**Severity**: HIGH  
**File**: `native_runner.js`, lines 99–113

```javascript
await page.evaluate((rules) => {
    for (const r of rules) {
        let fn;
        eval(`fn = ${r.evaluateStr}`);  // reconstructed from .toString()
        window.NativeEngine.addRule({ ..., evaluate: fn });
    }
}, domRules);
```

`rule.evaluate.toString()` serialises the function body but strips all closure references. Any rule whose `evaluate` function closes over a module-level import, helper function, or constant defined outside the function will fail silently at runtime — the `NativeEngine` catch block records it as `incomplete` with `nodeCount: 0`, with no indication of the real cause.

This also means **no new DOM rule can safely use module-level helpers** without either inlining them into `evaluate` or using the Puppeteer rule path instead.

**Fix**: For DOM rules, either (a) require all helpers to be inlined inside the `evaluate` function body (document this contract), or (b) bundle each rule's source into a self-contained IIFE before injection using a build step (e.g., `esbuild --bundle --format=iife`).

---

### N3 — Missing rules directory silently produces empty results and a perfect score
**Severity**: HIGH  
**File**: `native_runner.js`, lines 72–96

```javascript
if (fs.existsSync(rulesDir)) {
    // load rules
}
// If directory doesn't exist, domRules = [] and puppeteerRules = []
```

If `scripts/rules/` is absent (e.g., after a partial deployment, Docker build omission, or misconfigured `NATIVE_RUNNER_SCRIPT` path), the scanner runs with zero rules, emits `{ violations: [], passes: [], incomplete: [] }`, and the Go scorer returns a perfect score with no warning.

**Fix**: Exit with a non-zero status and emit `{ error: "rules directory not found: <path>" }` if the directory does not exist or contains zero `.js` files.

---

### N4 — Link extraction SSRF blocklist is incomplete (172.17–172.31 unblocked)
**Severity**: HIGH  
**File**: `native_runner.js`, lines 146–148

```javascript
const blocked = ['localhost', '127.', '10.', '192.168.', '172.16.', '0.0.0.0', '::1'];
if (blocked.some(b => host.startsWith(b))) continue;
```

Only `172.16.x.x` is blocked. The full RFC 1918 `172.16.0.0/12` range runs from `172.16.0.0` through `172.31.255.255`. A target page embedding a link like `http://172.17.0.1/` (common in Docker bridge networks) would be extracted and, if depth scanning is enabled, subsequently scanned.

This duplicates the same gap found in `axe_runner.go` (§8) and `axe_runner.js`, confirming the pattern is copy-pasted without the fix applied.

**Fix**: Use the same CIDR-based check applied in `middleware.go` (which correctly blocks `172.16`–`172.31`), or extract a shared `isPrivateHost()` utility used by all three files.

---

### N5 — `ignoreHTTPSErrors: true` silently accepts invalid TLS certificates
**Severity**: MEDIUM  
**File**: `native_runner.js`, line 42

```javascript
ignoreHTTPSErrors: true,
```

Scans of sites with expired, self-signed, or mismatched certificates succeed without any indication in scan output. Scan results appear identical to a valid-cert site. Consumers of the API cannot distinguish "scanned https://example.com with a valid cert" from "scanned https://example.com ignoring an expired cert."

**Fix**: Remove `ignoreHTTPSErrors` (default is `false`). If support for private/dev sites with self-signed certs is required, expose it via an explicit `ALLOW_INSECURE_TLS` env var that also annotates the scan result with a warning.

---

### N6 — `wcagLevel` argument is captured but never used
**Severity**: MEDIUM  
**File**: `native_runner.js`, line 16

```javascript
const [,, url, wcagLevel = 'AA'] = process.argv;
```

`wcagLevel` is parsed from the command line but never passed into either `NativeEngine.run()` or the Puppeteer rule `evaluate()` calls. Every rule runs its Level A and Level AA checks regardless of the level requested. There is no way to request a Level-A-only scan through the native engine.

**Fix**: Pass `wcagLevel` to `NativeEngine.run(wcagLevel)` and filter rules by matching their `tags` against the requested level, consistent with how axe-core filters by `runOnly.values`.

---

### N7 — Top-level error handler leaks stack trace to stdout
**Severity**: MEDIUM  
**File**: `native_runner.js`, line 202

```javascript
console.log(JSON.stringify({ error: err.message || String(err), stack: err.stack }));
```

On top-level failure, the runner emits a JSON object to stdout that includes `stack` — a full Node.js stack trace with file paths and line numbers. The Go handler parses `raw.Error` and returns it in the API response via the `details` field (§12), potentially surfacing internal file paths to API callers.

**Fix**: Omit `stack` from the emitted JSON, or gate it on a `DEBUG` environment variable. Log it to stderr instead.

---

### N8 — No per-rule execution timeout in `native_engine.js`
**Severity**: MEDIUM  
**File**: `native_engine.js`, lines 24–70

The `run()` loop calls `rule.evaluate(document)` synchronously with no timeout. A rule that enters an infinite loop (e.g., due to circular DOM references or pathological page structure) will hang indefinitely, blocking all remaining rules and causing the Puppeteer process to time out at the page level (180s default). All subsequent rules produce no output.

**Fix**: Wrap each synchronous rule call in a `Promise.race` with a timeout (e.g., 5000ms per rule). Since DOM rules are synchronous, convert the call to a microtask with a racing timeout signal, or move rule execution to a Web Worker context.

---

### N9 — Rule execution errors recorded as `incomplete` with `nodeCount: 0` — invisible to scoring
**Severity**: MEDIUM  
**File**: `native_engine.js`, lines 62–69

```javascript
} catch (err) {
    results.incomplete.push({
        id: rule.id,
        description: 'Rule execution failed: ' + err.message,
        nodeCount: 0
    });
}
```

A crashed rule is indistinguishable in scan output from a rule that genuinely returned `incomplete` results. `nodeCount: 0` means the AudioEye scorer sees zero tested elements for this SC, which is treated as "no data" rather than "error." There is no field in `ScanResult` to surface rule-level execution failures to the API consumer.

**Fix**: Add a `rule_errors` array to the output JSON (`{ id, error }`) and thread it through `axeRawResult` → `ScanResult` → API response so consumers can detect and act on rule failures.

---

### N10 — `focus-appearance` incorrectly tagged `wcag22aaa`
**Severity**: MEDIUM  
**File**: `scripts/rules/focus_appearance.js`, lines 7–8

```javascript
tags: ['wcag22aaa', 'wcag2413'],
```

WCAG 2.4.13 Focus Appearance is **Level AA** in WCAG 2.2, not Level AAA. The `wcag22aaa` tag causes this rule to be excluded from any AA-level scoring that filters by tag, even though conformance requires it. The `wcag2413` tag is correct.

**Fix**: Change to `tags: ['wcag22aa', 'wcag2413']`.

---

### N11 — `color_contrast.js` uses a custom luminance algorithm that may diverge from WCAG
**Severity**: MEDIUM  
**File**: `scripts/rules/color_contrast.js`, lines 21–30 and 51–62

The rule implements its own relative luminance and contrast ratio calculations instead of using axe-core's audited implementation. Two known gaps:

1. **Alpha blending is heuristic** (line 57): `// Note: Full blending is complex, we'll return first opaque or semi-transparent for heuristic`. Semi-transparent text over a gradient or image background is skipped entirely rather than flagged as `incomplete`.
2. **Background traversal stops at the first parent with any non-zero alpha** rather than computing a composited background colour. This can produce incorrect luminance values for layered UI elements (modals, overlays, cards).

Both gaps can produce false negatives (contrast violations not detected) on modern UIs with layered colours.

**Fix**: Either use axe-core's `color-contrast` rule (already available when running in axe mode) or implement full alpha compositing per the WCAG 2.1 definition of relative luminance.

---

### N12 — `color_contrast.js` deduplicates passes but not violations
**Severity**: LOW  
**File**: `scripts/rules/color_contrast.js`, lines 97–100

```javascript
const uniquePasses = Array.from(new Set(passes.map(p => p.html))).map(html => ({ html, target: ['text'] }));
return { violations, passes: uniquePasses, incomplete };
```

Passes are deduped by `html` content to prevent bloat, but violations are returned as-is. A page with many repeated text elements (e.g., a table with identical low-contrast cells) will produce one violation entry per text node rather than one per unique element, inflating violation counts and AudioEye failure rates for SC 1.4.3.

**Fix**: Apply the same deduplication to `violations` before returning, keyed on `(html, failureSummary)`.

---

### N13 — First navigation failure is silently discarded
**Severity**: LOW  
**File**: `native_runner.js`, lines 55–65

```javascript
try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
} catch (_) {   // <-- first failure swallowed with no log
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
```

The first navigation attempt (`networkidle2`) failure is caught and discarded with `_`. There is no record of which URLs required fallback navigation or what error triggered the retry. This makes it impossible to diagnose flaky scans or detect sites that consistently time out on `networkidle2`.

**Fix**: Log the first failure to stderr before the retry: `process.stderr.write(\`[native_runner] networkidle2 failed for ${url}: ${_.message}, retrying with domcontentloaded\n\`)`.

---

### N14 — Native engine correctly emits `nodeCount` (§3 does not apply)
**Severity**: INFO

The original finding §3 ("custom checks don't emit `node_count`") applies only to `axe_runner.js`. In `native_engine.js`, pass and incomplete results always include `nodeCount: result.passes.length` and `nodeCount: result.incomplete.length` respectively (lines 50, 59). Puppeteer rules in `scripts/rules/` also emit `nodeCount` on each pass/incomplete object. AudioEye scoring is correct for the native engine path.

---

## 3. Scoring Logic

**File**: `internal/scoring/score.go`

### 3.1 — Compliance % excludes `incomplete` count
**Severity**: MEDIUM | **Status**: ✅ RESOLVED (2026-07-10, fsd.md implementation)

> **Resolution**: `Calculate` now takes an `incomplete int` parameter that is added to the denominator. All callers updated (`axe_runner.go`, `wcag122_test.go`). The fix closes Gap 3 from fsd.md.

```go
// BEFORE (overstatement)
compliancePct = float64(passCount) / float64(passCount + len(violations)) * 100

// AFTER
total := passCount + len(violations) + incomplete
compliancePct = float64(passCount) / float64(total) * 100
```

The `incomplete` count is now included. A page with 100 passes, 10 violations, and 5 incomplete rules reports 86.9% compliance (not 90.9%).

### 3.2 — AudioEye score silently returns 100 with zero evaluated SCs
**Severity**: MEDIUM | **Status**: ✅ RESOLVED (2026-07-10, fsd.md implementation)

> **Resolution**: `CalculateAudioEye` now returns `Score:0, Grade:"F", Warning:"No success criteria evaluated..."` when zero SCs evaluated. The `Warning` field is propagated to `ComplianceReport.AudioEyeWarning` and rendered in all 8 formatter templates. This closes Gap 4 from fsd.md.

```go
// BEFORE (silent overstatement)
if n == 0 {
    return models.AudioEyeResult{Score: 100, Grade: "A", SCsEvaluated: 0}
}

// AFTER
if n == 0 {
    return models.AudioEyeResult{
        Score: 0, Grade: "F", SCsEvaluated: 0,
        Warning: "No success criteria evaluated — result is not a compliance score.",
    }
}
```

### 3.3 — Grade thresholds are undocumented magic numbers
**Severity**: LOW  
**Lines**: 286–298

Thresholds (90/75/40/25) have no rationale documented in code or comments and cannot be configured. Consider documenting the basis for these thresholds.

---

## 4. API Surface

**Files**: `internal/api/handler.go`, `router.go`, `middleware.go`, `jwt_middleware.go`, `openapi.yaml`

### 4.1 — SSRF blocklist inconsistency
**Severity**: HIGH  
**handler.go line 389 vs middleware.go lines 60–63**

The handler's inline SSRF check only blocks `172.16.x.x`:
```go
// handler.go
blocked := []string{"localhost", "127.", "10.", "192.168.", "172.16.", "0.0.0.0", "::1"}
```

The middleware blocks the full RFC 1918 private range `172.16.0.0/12` (172.16–172.31):
```go
// middleware.go
blocked := []string{..., "172.16.", "172.17.", ..., "172.31.", ...}
```

A URL like `http://172.17.0.1/` passes the handler check and could reach internal services if middleware is bypassed or reordered.

**Fix**: Consolidate into a single `isPrivateURL()` utility used by both paths; use CIDR-based comparison rather than prefix strings.

### 4.2 — Public auth endpoints not rate-limited
**Severity**: HIGH  
**File**: `internal/api/router.go`, lines 22–31

The 10 req/min rate limit applies only to scan and score endpoints. These endpoints are unprotected:

- `POST /api/v1/token` — brute-force target for shared secrets
- `POST /api/v1/admin/verify` — brute-force target for admin password
- `GET /api/v1/session` — token issuance without limit

**Fix**: Apply the rate limiter (or a stricter one, e.g., 5 req/min) to all auth endpoints.

### 4.3 — `GET /secret` exposes the JWT signing key
**Severity**: HIGH  
**File**: `handler.go`, lines 334–338

```go
func (h *Handler) GetSecret(w http.ResponseWriter, r *http.Request) {
    secret := config.GetSecret()
    writeJSON(w, http.StatusOK, map[string]string{"secret": secret})
}
```

Any caller with a valid JWT (including guest JWTs) can retrieve the JWT secret and use it to forge arbitrary tokens.

**Fix**: Remove this endpoint entirely, or restrict it to admin-only with explicit justification and audit logging.

### 4.4 — Admin password compared as plaintext
**Severity**: MEDIUM  
**File**: `handler.go`, lines 173–203

`subtle.ConstantTimeCompare()` is used (good), but the password lives in memory as plaintext.

**Fix**: Hash the admin password with bcrypt/argon2 at startup; store and compare only the hash.

### 4.5 — Error responses expose internal details
**Severity**: MEDIUM  
**File**: `handler.go`, line 405

```go
writeJSON(w, status, models.ErrorResponse{Error: msg, Details: details})
```

The `details` field can contain Go error strings, file paths, or internal messages. These are returned verbatim to API callers.

**Fix**: Gate `details` on a development mode flag; strip it in production.

### 4.6 — `depth` parameter accepts invalid values
**Severity**: LOW  
**File**: `handler.go`, lines 53–83

No validation prevents `depth: -1` or `depth: 999`. Server-side crawling logic should enforce `0 <= depth <= 1` (or whatever the supported range is).

---

## 5. Models & Types

**File**: `internal/models/report.go`

### 5.1 — `violationIndex` JSON tag is camelCase
**Severity**: MEDIUM  
**Line**: 72

```go
ViolationIndex int `json:"violationIndex,omitempty"` // should be violation_index
```

Every other field in `report.go` uses `snake_case`. This inconsistency breaks API consumers that expect uniform naming.

### 5.2 — Duplicate pass data fields
**Severity**: LOW  
**Lines**: 94–96

```go
Passes    []string   `json:"passes,omitempty"`      // rule IDs only
PassRules []PassRule `json:"pass_rules,omitempty"`  // structured
```

Both carry pass data. `Passes` is a subset of `PassRules` with no documented distinction.

**Fix**: Remove `Passes` and document that `PassRules` is the canonical field.

### 5.3 — Unused guideline fields
**Severity**: LOW  
**Lines**: 95, 98–101

`PassGuidelines`, `ViolationGuidelines`, and `IncompleteGuidelines` are populated by the scanner but never consumed by any API handler or scorer.

---

## 6. Configuration

**File**: `internal/config/config.go`

### 6.1 — Static fallback JWT secret
**Severity**: HIGH  
**Lines**: 152–160

```go
func generateRandomSecret(n int) string {
    b := make([]byte, n)
    if _, err := rand.Read(b); err != nil {
        return "fallback-static-secret-please-set-JWT_SECRET"
    }
    return base64.RawURLEncoding.EncodeToString(b)
}
```

If the OS entropy pool is unavailable, the server uses a known static secret. Any token signed with this string is universally forgeable.

**Fix**: Return the error and fail startup if random generation fails. Never silently fall back to a fixed string.

### 6.2 — Environment variable values not validated
**Severity**: MEDIUM  
**Lines**: 170–187

No validation is performed on:
- `PORT` — non-numeric or out-of-range value crashes at bind time
- `SCAN_TIMEOUT_SECONDS` — zero or negative accepted
- `MAX_CONCURRENT_SCANS` — zero or negative accepted
- `WCAG_LEVEL` — accepts any string; silently falls through if not `"AA"` or `"AAA"`

**Fix**: Add validation at config load time and return descriptive errors.

---

## 7. Entry Point

**File**: `cmd/server/main.go`

### 7.1 — Port fallback silently shifts to a different port
**Severity**: LOW  
**Lines**: 62–74

The server tries up to 5 consecutive ports if the configured port is in use. It logs a warning but does not fail or emit a prominent startup notice. Deployments behind a load balancer or service mesh may route to the wrong port.

**Fix**: Either fail fast on bind failure or log the effective port at `INFO` level after binding.

---

## 8. Test Coverage

### 8.1 — Scoring logic undertested
**Severity**: MEDIUM  
**File**: `internal/scoring/score_audioeye_test.go`

Existing test functions cover the AudioEye path (normal flow, no violations, empty input, site-level aggregation). Missing:
- Penalty-based scoring formula (`Calculate`)
- Compliance percentage edge cases (all fail, all pass, mixed with incomplete)
- Unknown/unsupported impact values in violations
- `ComplianceReport` builder

### 8.2 — Only 1 of 22+ custom scanner checks has a test
**Severity**: MEDIUM  
**File**: `scripts/wcag122_captions.test.js`

WCAG 1.2.2 has a thorough test suite (50+ cases). No other custom check (`color-only-indicator`, `focus-order-cycling`, `resize-text`, `meaningful-sequence-*`, etc.) has any test coverage.

**Fix**: Add unit tests for each custom check using `jest-environment-jsdom` following the pattern established by `wcag122_captions.test.js`.

---

## 9. Security

### 9.1 — CORS wildcard origin
**Severity**: MEDIUM  
**File**: `internal/api/middleware.go`, line 41

```go
w.Header().Set("Access-Control-Allow-Origin", "*")
```

Any web page can call the API from a browser context. For a JWT-gated API this is lower risk, but combined with the long token lifetime (§9.2), it widens the attack surface for token theft via XSS on third-party sites.

**Fix**: Restrict to an explicit allowlist via `ALLOWED_ORIGINS` env var.

### 9.2 — No audit logging for sensitive operations
**Severity**: MEDIUM  
**File**: `internal/api/handler.go`

The following operations produce no log entry on failure:
- Failed JWT verification
- Failed admin password attempts
- Secret rotation
- Scan rate-limit rejections

Without these logs, brute-force attempts and token abuse are undetectable.

### 9.3 — Puppeteer sandbox disabled
**Severity**: HIGH (mitigated by container isolation)  
**File**: `scripts/axe_runner.js`, lines 66–72

```javascript
args: ['--no-sandbox', '--disable-setuid-sandbox', ...]
```

With `--no-sandbox`, a malicious target page that exploits a Chromium renderer vulnerability can execute arbitrary code on the scanning host. SSRF protection blocks internal IPs, but does not prevent renderer exploits.

**Mitigation already in place**: SSRF blocklist, recommended container/VM isolation.

**Additional mitigations to consider**: Run Puppeteer as a separate process with a read-only filesystem overlay; use `seccomp` or `gVisor` for syscall filtering.

---

## 10. Dependencies

**Files**: `go.mod`, `scripts/package.json`

All direct dependencies are current and no known CVEs are present in the versions used:

| Package | Version | Status |
|---------|---------|--------|
| `go-chi/chi/v5` | 5.3.0 | Current |
| `go-chi/httprate` | 0.15.0 | Current |
| `golang-jwt/jwt/v4` | 4.5.0 | Current |
| `go.uber.org/zap` | 1.28.0 | Current |
| `axe-core` | ^4.12.1 | Current |
| `puppeteer-core` | ^23.0.0 | Current |
| Go toolchain | 1.23.0 | Current |

No action required on dependencies at this time.

---

## Prioritized Remediation

### Immediate (before next public deployment)
1. **§10 / N1** — Fix `console.error` corrupting stdout JSON in native runner; switch Go to `cmd.Output()`
2. **§4.3** — Remove or lock down the `GET /secret` endpoint
3. **§6.1** — Fail fast on random secret generation failure; remove static fallback
4. **§4.2** — Rate-limit `/token` and `/admin/verify`
5. **§4.1 / N4** — Consolidate SSRF blocklist into one CIDR-aware utility covering full `172.16–172.31` range; apply to `axe_runner.go`, `axe_runner.js`, and `native_runner.js`
6. **§N3** — Exit with error if `scripts/rules/` is missing or empty

### Short-term (next sprint)
7. **§N2** — Document DOM rule closure contract (all helpers must be inlined), or add a bundle step
8. **§N10** — Fix `focus-appearance` tag from `wcag22aaa` to `wcag22aa`
9. **§N6** — Wire `wcagLevel` through to `NativeEngine.run()` and rule tag filtering
10. **§2.1** — Add `nodeCount` to all custom pass results in `axe_runner.js`
11. **§1.1** — Add rules for the 16 uncovered WCAG SCs
12. **§1.2** — Register WCAG 2.2 rules in `sc_registry.go`
13. **§9.1** — Replace CORS wildcard with explicit origin allowlist
14. **§6.2** — Add env var validation at startup

### Medium-term (backlog)
15. **§N5** — Remove `ignoreHTTPSErrors: true`; gate on env var with scan-result annotation
16. **§N8** — Add per-rule timeout in `native_engine.js`
17. **§N9** — Add `rule_errors` field to scan output for crashed rules
18. **§N11** — Fix `color_contrast.js` alpha blending and background traversal
19. **§N12** — Deduplicate violations in `color_contrast.js`
20. **§3.1** — Include incomplete count in compliance % denominator
21. **§3.2** — Surface a warning when AudioEye evaluates zero SCs
22. **§5.1** — Fix `violationIndex` JSON tag to snake_case
23. **§8.1/8.2** — Expand test coverage for scoring and custom scanner checks
24. **§9.2** — Add audit logging for auth failures and secret changes
25. **§4.4** — Hash admin password with bcrypt at startup
