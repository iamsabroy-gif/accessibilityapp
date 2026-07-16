# PDF Accessibility Scanning — Implementation Plan

**Status: NOT GREENLIT.** This document specifies a fully-designed, ready-to-build plan for adding PDF/UA-1 + WCAG-relevant document scanning to the existing web-accessibility scanning product. Per the Product Framing section below, **do not begin engineering work** until the stated business gate (5 validated buyer conversations) has cleared. Treat this as the spec to execute once greenlit, not a current sprint plan.

---

## Product Framing

**Verdict: Defer. This is a real second product, not a feature — build it after the web-scanner's public launch, and only after validating demand with the actual buyer.**

### 1. Should we build this now?

No. The web-scanner product is ~10-11 weeks from its public CLI + GitHub Action launch, which is the wedge the business is actually betting on (rules-as-code accessibility checks in CI, targeted at design-system engineering teams). Adding 2.5-3 weeks of PDF/UA engineering now is a 25-30% schedule tax on that launch, plus context-switch cost disproportionate to a small team. It does nothing to de-risk the core hypothesis under test (will engineers adopt rules-as-code in CI?). It also drags in a third runtime (JVM) into a Go+Node deploy that is still being tuned for scan concurrency (`MAX_CONCURRENT_SCANS`).

**Sequencing: after the public web-scanner launch, not in parallel, not before.**

### 2. Does PDF accessibility fit the existing wedge?

No — it serves a fundamentally different buyer. The web-scanner wedge buyer is a staff/lead frontend engineer who wants accessibility enforced as versioned rules in CI. That person doesn't own PDF remediation and doesn't produce PDFs. PDF/UA-1 and Section 508 / EN 301 549 conformance is bought by:

- Government / higher-ed compliance and 508 officers (procurement-driven)
- Publishers and document-heavy orgs (finance, insurance, legal, HR) producing forms/statements/policy docs
- Accessibility remediation agencies

These buyers want **conformance reports and audit artifacts** (VPAT/ACR), not CI rule authoring. Different pain, different sales motion (procurement/legal vs. bottoms-up engineering adoption), different buyer-discovery channels.

**Conclusion: PDF scanning is a second product riding the same scanning/scoring engine — a diversification bet, not a launch-completing feature.**

### 3. Pricing / positioning

Do **not** bundle PDF scanning free into the existing scan endpoint or plan. That gives away a deliverable a compliance officer will pay for, to a buyer (the engineer) who won't value it, and muddies positioning at the moment the web-scanner needs its message sharpest.

Recommended:
1. **Separate SKU, own price, own buyer** (preferred, once validated) — PDF/UA compliance is a procurement line item. Price around VPAT/ACR-ready output and batch document scanning, sold to a compliance/legal persona at a compliance-tier price point, distinct from engineer-facing CI usage pricing.
2. **Interim/acceptable:** premium add-on toggle on higher web-plan tiers, but only once a paying web customer is confirmed to also have PDF pain (unlikely given the buyer mismatch).
3. **Avoid:** free-in-plan bundling — it kills future pricing power and signals PDF conformance is a commodity, when the actual monetizable layer is the compliance report (Phase 3), not the raw scan (Phases 1-2). veraPDF's underlying checks are open-source and available to anyone; that's the competitive floor. The report/ACR/VPAT packaging is the differentiator worth charging for.

### 4. Biggest risk + required validation

**Biggest risk:** launch slippage on the core web-scanner product for a buyer we have zero validated demand from — every week spent on PDF is a week the actual hypothesis (rules-as-code adoption) goes untested in market.

**Required validation before any engineering time is spent:** talk to 5 PDF/UA buyers — compliance/508 officers at a university, a government vendor, a bank, and an accessibility remediation agency. Ask: (a) what they use today for PDF conformance and what it costs (known alternatives: CommonLook/Allyant, free PAC 2024, Adobe Acrobat Pro's built-in checker), and (b) whether they'd pay for a batch scanner producing an ACR/VPAT-ready report, and at what budget. **3-of-5 "yes + named budget" is the greenlight condition.** If that bar isn't cleared, do not build Phases 1-2 below.

---

## Technical Architecture

*Grounded in the repo's verified current state as of this plan (files read directly: `internal/scanner/scanner.go`, `internal/models/report.go`, `internal/models/wcag_mapping.go`, `internal/config/config.go`, `internal/api/handler.go`, `internal/scoring/score.go`, `Dockerfile`, `docker-compose.yml`, `openapi.yaml`). Corrections to an earlier, less-verified draft of this plan are called out explicitly below.*

### Corrections to the earlier draft spec

- The request type is **`ScanRequest`**, not `ScanReq` (fields: `URL`, `WCAGLevel`, `Depth`, `VisualReport`).
- The `Scanner` interface today is `Scan(ctx context.Context, url string, wcagLevel string, depth int) (*models.ScanResult, error)` — **no document-type or byte-payload parameter exists.** This needs an explicit design decision (see below), not an assumption that PDFRunner "just satisfies the interface."
- No `VERAPDF_BIN` / `PDF_MAX_BYTES` config exists yet in `internal/config/config.go`. Existing relevant config: `MaxConcurrentScans` (code default 5; Dockerfile `ENV` sets `MAX_CONCURRENT_SCANS=1`; recent commit history shows work raising this toward 3), `ScoringFormula` (`"compliance"` default or `"penalty"`, runtime-switchable), `ActiveEngine` (`"axe"` or `"native"`, default `"native"`).
- The Dockerfile runtime base is **`node:22-slim` (Debian, not Alpine)** — this matters because it means `apt-get install openjdk-17-jre-headless` is a straightforward, low-risk addition, using the exact same pattern already used to install Chromium's shared-lib dependencies. No base-image migration needed.
- `docker-compose.yml` caps the **entire container** (Go server + all concurrent Chromium instances + any future JVM subprocess) at **3.5 CPUs / 5GB RAM**, with Caddy running as a separate sidecar container. This is the binding constraint for resource planning, not the Dockerfile's own `MAX_CONCURRENT_SCANS` default.
- `internal/scoring/score.go`'s `ScoreReport` has `AudioEyeDetail *models.AudioEyeResult` as an optional field alongside the main score — confirming the "two scorers" are one pipeline with an optional detail block, not two independent pipelines requiring separate wiring.
- Only two scan-triggering endpoints exist today: `POST /scan` (full `ScanResult`) and `POST /score` (compact `ScoreReport`). No upload endpoint and no `document_type` field exist anywhere yet.

### 1. Scanner interface: does it accommodate a PDFRunner cleanly?

**Recommendation: do not force PDFRunner through the existing `Scan(ctx, url, wcagLevel, depth)` signature as-is. Widen the interface with a struct-based request, or add a sibling interface — struct-based widening is cleaner.**

The current signature's `url string` parameter is ambiguous once PDFs enter the picture (remote URL to fetch vs. a server-local temp file path from an upload) and `depth int` is meaningless for a single PDF document. Rather than overload `url` semantically (fragile, invites bugs where a PDF path is treated as a fetchable URL or vice versa), introduce:

```go
type ScanInput struct {
    URL         string // remote URL, HTML or PDF-serving
    FilePath    string // local temp file path (upload case), mutually exclusive with URL
    WCAGLevel   string
    Depth       int
    DocumentType string // "html" | "pdf" | "auto"
}

type Scanner interface {
    Scan(ctx context.Context, in ScanInput) (*models.ScanResult, error)
}
```

This is a one-time breaking change to the interface (two call sites: the existing HTML scanner and the router/handler), done once, before either PDFRunner or any future document type is added — cheaper now than retrofitting later. Both `HTMLRunner` (existing) and `PDFRunner` (new) implement the same interface; handler-level logic picks which one to invoke based on `DocumentType`/magic-byte sniffing.

### 2. Tool choice: veraPDF — confirmed, with an explicit resource-contention caveat

**Confirmed: veraPDF remains the right choice.** ~100+ machine-verifiable PDF/UA-1 checks, reference implementation, native `--format json` output, subprocess boundary avoids GPLv3/MPLv2 license contamination in the Go binary, and — now verified — the Debian-based `node:22-slim` runtime image can accept `openjdk-17-jre-headless` via `apt-get` exactly like the existing Chromium dependency installation. Rejected alternatives (pdf-lib, pdfjs-dist, PDFBox, pdfminer/pdfplumber) remain correctly rejected for the same reasons as before (writer-only, no a11y ruleset, stale, extraction-only/wrong runtime).

**New, must-flag risk: JVM subprocess calls will compete for the same 3.5 CPU / 5GB RAM container ceiling that concurrent headless-Chromium instances already consume.** Puppeteer/Chromium is already the dominant resource consumer at `MAX_CONCURRENT_SCANS` > 1; a JRE cold start (~1-2s, ~150-300MB transient) invoked concurrently with 2-3 active Chromium scans risks OOM or scan-timeout cascades under load. This must be load-tested (see Risks) before raising `MAX_CONCURRENT_SCANS` further with PDF scanning live, and likely argues for a **separate, lower concurrency cap for PDF scans** (e.g. `MAX_CONCURRENT_PDF_SCANS`, independent of the Puppeteer gate) rather than sharing one global semaphore.

### 3. Data model changes

Confirmed additions needed on the **current** (verified) types:

- `ScanRequest`: add `DocumentType string` (`omitempty`, values `auto`/`html`/`pdf`, default `auto`).
- `ScanResult`: add `DocumentType string` (`omitempty`) and `Document *DocumentMeta` (`omitempty`).
- New type: `DocumentMeta{PageCount int, Tagged bool, Title string, Producer string, SizeBytes int64}`.
- `Violation` and `PassRule` — **unchanged.** PDF-derived findings map into the existing `Violation{ID, Impact, Description, Help, HelpURL, Tags, Nodes, DevSuggestion}` shape; veraPDF's clause/rule IDs become `Violation.ID` values via a translation map (see below), with `Nodes` populated from whatever location data veraPDF provides (page number / object reference in place of DOM `target`/`bbox`).
- **`PassRule.NodeCount` must be populated for PDF passes** — this is a hard dependency for the AudioEye-style scorer (`AudioEyeResult`/`SCScore` compute `failure_rate` from `FailedElements`/`TestedElements`, sourced from `PassRule.NodeCount` + violation node counts). Skipping this silently breaks AudioEye scoring for PDF scans exactly as it would for a web scan missing pass-rule counts.
- New file: `internal/models/pdf_ua_mapping.go` — `VeraPDFRuleMap` (veraPDF clause/test ID → internal rule ID) and `PDFImpactMap` (internal rule ID → impact level, since veraPDF doesn't natively emit critical/serious/moderate/minor).
- `internal/models/wcag_mapping.go` — add the 12 Group A rule IDs (Phase 1) to the existing `WCAGMap`. **Add a unit test asserting every `VeraPDFRuleMap` value exists in both `WCAGMap` and `PDFImpactMap`** — this closes the three-hop mapping-drift risk (veraPDF clause → internal rule ID → WCAGMap) which is exactly the class of bug this repo has already hit once (the G58 rule-ID mismatch noted in project history).

### 4. Scorer integration

No changes needed to `internal/scoring/score.go` logic itself. Because PDF violations/pass-rules flow through the same `Violation`/`PassRule`/`WCAGMap` types, both the penalty scorer (`Summary.Score`, impact-weighted deductions) and the AudioEye-style scorer (`ScoreReport.AudioEyeDetail`, rate × weight per WCAG SC) work unmodified, provided `PDFImpactMap` supplies a valid impact level per rule ID (for the penalty scorer) and `PassRule.NodeCount` is populated per PDF page/element (for AudioEye). This is the main payoff of not inventing new result types — the "gate" architecture (`WCAGMap` is scoring's source of truth) already generalizes to a second content type for free.

### 5. API design

Given `/scan` and `/score` are already fully documented in `openapi.yaml` for the engineer-facing product, and the business side has already decided PDF/UA is a **separately priced, separately buyered SKU**, overloading `/scan` with a hidden `document_type` field is the wrong long-term shape even though it's the cheapest Phase-1 implementation path. Recommendation:

- **Phase 1 (internal/beta only, not customer-facing):** extend `ScanRequest` with optional `document_type` for internal testing and dogfooding — no new endpoint yet, since there's no paying PDF customer to gate. Handler sniffs `%PDF-` magic bytes when `document_type: auto`.
- **Phase 2+ (once a real compliance buyer exists):** introduce a **dedicated `POST /documents/scan` (or `/scan/pdf`) endpoint**, separately billed/gated/rate-limited from `/scan`, with its own request/response shapes in `openapi.yaml` (`DocumentScanRequest{url?, document_type, wcag_level?}`, response reusing `ScanResult` + `DocumentMeta`). This matches the compliance buyer's expectation of a distinct product surface and gives clean hooks for separate pricing/entitlement checks later, rather than smuggling a compliance product behind a field on the engineer-facing endpoint.
- Multipart upload (`POST /documents/scan/upload` or similar) is Phase 2/3, after URL-based fetching is proven out — mirrors the original draft's sequencing, just renamed off `/scan/upload` to match the dedicated-endpoint decision above.

### 6. File upload handling (architectural summary — see Security Considerations for the full threat-model treatment)

- Magic-byte validation (`%PDF-`) before any parsing.
- Size cap via `io.LimitReader` (proposed 25MB — reasonable starting point, tune after real document samples from validated buyers).
- Timeout via `context.WithTimeout` + `exec.CommandContext` (proposed 30s).
- Temp file per scan, `defer os.Remove`, unique random names (not attacker-influenced), narrow permissions.
- SSRF-equivalent protection for the URL-fetch case must reuse (and, per the security review, first **fix**) the existing private-IP blocking used by the web scanner — see Security Considerations, this is not a rubber-stamp reuse.

---

## Data Model & Scoring Integration

Summary table of type-level deltas (all additive, non-breaking to existing web-scan clients):

| Type | Change | File |
|---|---|---|
| `ScanRequest` | + `DocumentType string` (omitempty) | `internal/models/report.go` |
| `ScanResult` | + `DocumentType string`, + `Document *DocumentMeta` | `internal/models/report.go` |
| `DocumentMeta` | new: `PageCount, Tagged, Title, Producer, SizeBytes` | `internal/models/report.go` |
| `VeraPDFRuleMap` | new: veraPDF clause/test → internal rule ID | `internal/models/pdf_ua_mapping.go` |
| `PDFImpactMap` | new: internal rule ID → impact level | `internal/models/pdf_ua_mapping.go` |
| `WCAGMap` | + 12 Group A entries (Phase 1), + 5 Group B (Phase 2) | `internal/models/wcag_mapping.go` |
| `Violation`, `PassRule`, `Summary`, `SCScore`, `AudioEyeResult` | unchanged | `internal/models/report.go` |
| `Scanner` interface | signature widened to struct-based `ScanInput` | `internal/scanner/scanner.go` |
| `ScoreReport` | unchanged (already generic via `AudioEyeDetail`) | `internal/scoring/score.go` |

**Scoring dependency chain to protect:** `PDFRunner` → `VeraPDFRuleMap` → `WCAGMap` (gate) + `PDFImpactMap` (penalty weight) → penalty scorer & AudioEye scorer, both unmodified. Break any link in that chain (unmapped rule ID, missing `PassRule.NodeCount`) and scoring for PDF results either silently excludes a check or crashes the AudioEye rate calculation the same way an unmapped axe rule would today.

---

## API Design

- **Phase 1 (internal/beta):** `ScanRequest.document_type` optional enum (`auto`/`html`/`pdf`) on existing `POST /scan`; response gains optional `document_type` and `document` fields on `ScanResult`. No `openapi.yaml` breaking changes — purely additive schema fields.
- **Phase 2+ (customer-facing compliance SKU):** new `POST /documents/scan` endpoint, own `openapi.yaml` section, own auth/rate-limit/entitlement gate (distinct from the 10 req/min engineer-facing limit — compliance buyers plausibly need batch/bulk scanning, which argues for a different rate profile entirely, to be defined once buyer conversations clarify volume expectations).
- **Phase 2/3:** `POST /documents/scan/upload` (multipart), `http.MaxBytesReader`-enforced size cap, same veraPDF pipeline, output identical `ScanResult` shape.
- **Phase 3:** compliance report generation reuses the existing Puppeteer report pattern (`page.pdf({tagged: true})`), extending `internal/scoring/report/generator.go` — deliberately not a Go-native PDF-writing library, since an *untagged* PDF-about-PDF-accessibility would be a credibility-destroying irony bug.

---

## Security Considerations

*Reviewed adversarially against the CURRENT code (not the proposed design in the abstract) — `internal/api/handler.go` (lines 69, 355, 387-396, 429), `internal/api/middleware.go:54` (rate limiting), `internal/scanner/axe_runner.go:88` and `internal/report/pdf_exporter.go:21` (existing `exec.CommandContext` subprocess pattern), `internal/config/config.go`.*

**Critical, prerequisite finding: the SSRF protection this design proposes to "reuse" is already broken — it must be fixed before it is extended, not just re-checked per redirect hop.** `isPrivateURL()` (`internal/api/handler.go:387-396`) does `strings.Contains(lower, "127.")` and similar substring matches **against the raw, unparsed URL text**, before any DNS resolution ever happens. Consequences:
- A hostname like `evil.example.com` that resolves to `127.0.0.1` sails through untouched — the check never resolves DNS.
- Decimal (`http://2130706433/`), hex (`http://0x7f000001/`), and IPv6-mapped (`http://[::ffff:127.0.0.1]/`) address forms all bypass it — none contain the blocked substrings (`"127."`, `"10."`, `"192.168."`, `"172.16."`, `"localhost"`, `"::1"`).
- It omits the cloud-metadata address `169.254.169.254` entirely.
- "Re-check on every redirect hop," as proposed, inherits this exact same flaw at every hop — it adds no real protection if it's just re-running the same substring match on the `Location` header.

**Fix (prerequisite, not a PDF-specific nice-to-have):** replace with a custom `net.Dialer.Control` / `http.Transport.DialContext` hook that resolves the hostname and checks the **actual dialed `net.IP`** via `IsPrivate()`, `IsLoopback()`, `IsLinkLocalUnicast()`, `IsUnspecified()`, plus an explicit deny of `169.254.169.254` — evaluated at connect time, on every dial including each redirect hop (via `http.Client.CheckRedirect` combined with the same dialer-level check, not by re-running the string match on the redirect target). This closes DNS-rebinding as a side effect, since the check runs per-TCP-dial against the resolved IP rather than once against a hostname string. This is a standing gap affecting the *existing* web scanner too — worth fixing on its own merits, independent of PDF timing.

**Priority-ordered findings for the PDF-specific design:**

1. **(Critical, same as above)** SSRF guard must be fixed at the dialer level before PDF URL-fetching ships.
2. **(High) veraPDF as a JVM subprocess is materially higher attack surface than the existing Puppeteer subprocess and needs its own resource fence, not just the process-wide 3.5 CPU / 5GB cap.** A single malicious PDF — recursive `/Pages` object cycles, deeply nested XObjects, decompression-bomb `FlateDecode` streams, malformed XFA/XML — can pin a CPU core or balloon JVM heap independent of what Chromium is doing, starving concurrent scans. `exec.CommandContext` + a 30s timeout only bounds wall-clock time, not memory. **Fix:** launch veraPDF with explicit `-Xmx512m -Xss8m` to cap heap/stack; disable attachment/embedded-file extraction in the validation profile if veraPDF's config supports it (avoid parsing structures not needed for accessibility validation); additionally wrap the command with a cgroup or `systemd-run --scope -p MemoryMax=512M -p CPUQuota=100%` (or an equivalent ulimit wrapper) so a JVM OOM cannot take down the memory budget shared with concurrent Chromium instances. **The 25MB fetch-size cap and the `-Xmx` heap cap are one connected control, not two independent ones** — a compressed PDF stream can inflate far past 25MB in memory during validation, so document/enforce both together.
3. **(High) Explicitly verify — don't assume — that veraPDF's PDFBox-based parser never executes embedded JavaScript or follows `/OpenAction`/`/AA` triggers.** It shouldn't, being a validator not a renderer, but confirm no plugin/validation profile invokes a JS engine, and never add a future "extract embedded JS for review" feature without routing it through a separate, sandboxed JS engine — not the same JVM process that parses untrusted file structure.
4. **(Medium) Temp file handling.** Use `os.CreateTemp(dir, "pdfscan-*.pdf")` for random, non-predictable names with `0600` permissions in a dedicated scan-temp directory. `defer os.Remove` alone is insufficient — a `SIGKILL`/OOM-kill of the process (made materially more likely by finding #2 above) leaks the file past the `defer`; add a periodic reaper goroutine sweeping files older than `ScanTimeoutSeconds`. Never derive the temp filename from any request-supplied string (URL or upload filename) — generate it server-side only. `exec.Command`'s argv-based invocation already avoids shell interpolation; just confirm no code path wraps veraPDF in `exec.Command("sh", "-c", ...)`.
5. **(Medium) Resource-contention blast radius.** Because the JVM subprocess and Chromium subprocesses share one container's 3.5 CPU / 5GB RAM cap, gate PDF scans behind their own concurrency semaphore (`MAX_CONCURRENT_PDF_SCANS`), independent from `MAX_CONCURRENT_SCANS`, so a burst of PDF scans cannot starve in-flight web scans or vice versa — load-test this before launch.
6. **(Low, deferred multipart-upload phase) Polyglot and MIME-sniffing bypass risk.** The PDF spec tolerates leading garbage before the `%PDF-` marker — a known polyglot trick embeds a valid ZIP/JAR local file header before it. Require `%PDF-` within the first 1024 bytes **and** reject files that also contain a trailing `PK\x05\x06` ZIP end-of-central-directory signature, to block PDF/ZIP polyglots specifically. Never derive the server-side temp filename or path from the client-supplied upload filename — use the original filename only in a response `Content-Disposition` header, never in a file-system or shell context.

**Requires live testing before shipping, not just design review:**
- veraPDF's actual behavior (hang vs. clean failure vs. OOM) against a real decompression-bomb and recursive-object-reference PDF sample, under the proposed `-Xmx`/timeout caps.
- A live DNS-rebinding proof-of-concept (a domain that flips its A record between a public IP at check-time and `127.0.0.1`/`169.254.169.254` at connect-time) against the new dialer-level SSRF check, to confirm it actually closes the gap rather than just relocating it.

---

## Phased Implementation Plan

**Framing: this is the plan to execute once the business gate above clears (3-of-5 validated buyer conversations with named budget). Do not start Phase 1 before that.**

### Phase 1 — Core PDF/UA scanning MVP (~1.5-2 weeks)

New files:
- `internal/scanner/pdf_runner.go` — `PDFRunner` implementing the widened `Scanner` interface; `fetchPDF` (SSRF re-checked at the dialer level on every redirect hop — depends on the SSRF fix above being in place first; 25MB cap via `io.LimitReader`; 30s timeout; `%PDF-` magic-byte check); `exec.CommandContext` invocation of veraPDF with a JVM heap cap; `defer os.Remove` plus startup temp-file sweep.
- `internal/scanner/pdf_runner_test.go` — golden veraPDF JSON fixtures.
- `internal/models/pdf_ua_mapping.go` — `VeraPDFRuleMap`, `PDFImpactMap`.
- `testdata/pdfs/` — 3-4 fixture PDFs (tagged-good, untagged-bad, malformed/edge-case, large/near-size-cap).

Modified files:
- `internal/scanner/scanner.go` — widen `Scanner` interface to struct-based `ScanInput`; update the existing HTML runner call site.
- `internal/models/wcag_mapping.go` — add 12 Group A entries; add the map-completeness unit test (`VeraPDFRuleMap` values ⊆ `WCAGMap` ∩ `PDFImpactMap`).
- `internal/models/report.go` — `ScanRequest.DocumentType`, `ScanResult.DocumentType`/`Document`, new `DocumentMeta` type.
- `internal/api/handler.go` — `sniffDocumentType()` branch at the Scan handler; dialer-level SSRF fix (prerequisite, benefits the web scanner too).
- `internal/config/config.go` — `VERAPDF_BIN` (default `/opt/verapdf/verapdf` or `/usr/local/bin/verapdf`), `PDF_MAX_BYTES` (default 26214400), `MAX_CONCURRENT_PDF_SCANS`.
- `cmd/server/main.go` — construct `PDFRunner`, inject into `Handler`.
- `openapi.yaml` — `document_type` field, `DocumentMeta` schema, additive `ScanResult` fields (internal/beta only — no public doc changes yet).
- `Dockerfile` — `apt-get install openjdk-17-jre-headless` + veraPDF binary layer (same pattern as Chromium deps); pin veraPDF version explicitly.

No new Node script needed in Phase 1.

### Phase 2 — Upload endpoint, Group B rules, dedicated API surface (~1.5 weeks)

- `POST /documents/scan` and `POST /documents/scan/upload` as dedicated, separately-billed endpoints (per the API Design decision above) — supersedes the Phase 1 hidden-field approach for any customer-facing rollout.
- `http.MaxBytesReader` for multipart size enforcement; `ScanFile` method on `PDFRunner`.
- Group B (5 rules: reading-order, part-lang, bookmarks, scanned-text heuristic, field-label) via a custom veraPDF XML validation profile (`profiles/wcag-extra.xml`).
- Add Group B entries to `WCAGMap` + `PDFImpactMap`.
- Load test JVM/Chromium concurrency contention under realistic mixed traffic; tune `MAX_CONCURRENT_PDF_SCANS`.

### Phase 3 — Compliance report deliverable (the actual monetizable layer, per Product Framing) (~1 week+)

- Compliance/VPAT-ready report generation via existing Puppeteer (`scripts/report_pdf.js` pattern, `page.pdf({tagged: true})`), extending `internal/scoring/report/generator.go`.
- CI dogfood test: scan the generated report itself, assert score ≥ 90 (catches the "PDF about PDF accessibility is itself inaccessible" failure mode).
- This phase is where the separate-SKU pricing decision becomes real — do not ship Phases 1-2 as a standalone paid product; the report is the product.

---

## Risks & Open Questions

**Business risk (highest priority — gates everything below):**
1. No validated PDF/UA buyer demand yet. Do not spend engineering time until 3-of-5 target buyer conversations confirm willingness to pay for a named budget.

**Technical risks to validate before/during Phase 1:**
2. **JVM/Chromium resource contention** under the shared 3.5 CPU / 5GB RAM container cap — untested; requires load testing with concurrent PDF + web scans before raising `MAX_CONCURRENT_SCANS`/`MAX_CONCURRENT_PDF_SCANS` in production.
3. **Existing SSRF guard (`isPrivateURL()`) is weaker than assumed** — hostname-substring blocklist, not IP-resolved, pre-dates any redirect-hop re-check design. Must be fixed at the dialer level as a prerequisite, not an extension.
4. **Three-hop mapping drift** (veraPDF clause → internal rule ID → WCAGMap) — same class of bug this repo has already hit once (G58 rule-ID mismatch); mitigated by a day-one map-completeness unit test, but must actually be written and enforced in CI, not just planned.
5. **veraPDF version/output stability** — pin the version in the Dockerfile; add a CI check that fails loudly if veraPDF's JSON output shape changes on upgrade (silent schema drift would corrupt scoring without raising an error).
6. **`Scanner` interface widening is a breaking internal change** — small blast radius today (one other call site) but should be done deliberately, with tests, before PDFRunner lands, not bundled invisibly into the PDF PR.

**Open questions to resolve during buyer validation, before Phase 2 starts:**
7. What rate/volume do compliance buyers actually need (single-document ad hoc checks vs. batch/bulk scanning of a document library)? This determines whether the 10 req/min engineer-facing rate limit is even the right model for the compliance SKU, or whether a different (e.g. async/job-queue) API shape is needed.
8. What does a compliance buyer consider "done" — a VPAT, a full ACR, or just a pass/fail report? This determines Phase 3 scope and is not yet known.

---

## Addendum (2026-07-17): Admin-Console Visibility Toggle for PDF Scanning

**Status: independent of Phase 1 gating.** This addendum covers a narrow follow-up request — adding an admin-console toggle to control *visibility* of the (still unbuilt) PDF scanning feature — evaluated separately from the Phase 1 build decision above, which remains DEFERRED.

### Should We Do This Now

**Yes, build the inert flag now — but scoped as an internal-only visibility switch, not a customer-facing on/off boolean.**

The concern raised going in was whether adding admin-toggleable visibility for a feature that isn't built yet quietly pre-commits scope to something that may never ship. It doesn't, provided the flag guards nothing but a UI affordance. The scope-creep risk lives entirely in building `PDFRunner` and the scanning pipeline, not in a boolean that shows or hides a "coming soon" card. That remains fully gated behind the 3-of-5 buyer-validation requirement from the Product Framing section above and is untouched by this addendum.

The distinction that resolves the rest of the ambiguity: this toggle lives in the **existing admin console**, used by the product's own team, not by customers. That reframes the ask from "ship a half-built feature flag to users" (premature) to "give the sales/product team a way to reveal a 'coming soon / request early access' state during the very buyer conversations the business gate requires" (directly useful *now*). A customer-facing self-service toggle would be wrong at this stage — it implies the feature exists and invites support tickets for something that isn't built. An internal admin switch does not have that problem.

Net: this is one of the few pieces of PDF-related work that's justified *before* Phase 1 starts, because it helps clear the validation gate (e.g., by capturing who clicks "request early access" as a demand signal) rather than jumping ahead of it. Total cost is roughly an hour of plumbing, not a feature commitment.

### Settings Architecture (as verified in the actual code)

Verified directly against the current repo, not assumed:

- **Persistence is in-memory only, env-seeded, mutex-guarded — there is no file or database-backed settings store.** `internal/config/config.go:14-30` defines the `Config` struct; a single package-global `*Config` is guarded by `sync.RWMutex` (`config.go:33-36`); `Load()` (`config.go:174-199`) reads env vars once at startup, plus a hand-rolled `.env` parser (`config.go:201-227`). Runtime setters (`SetMaxConcurrentScans` `config.go:86-92`, `SetScoringFormula` `config.go:117-127`, `SetActiveEngine` `config.go:140-150`) mutate the in-memory struct only — **nothing persists across a process restart or deploy; every admin-settings change reverts to env defaults.**
- **`GetSettings`** (`handler.go:274-280`) returns exactly `{"max_concurrent_scans": int, "scoring_formula": "compliance|penalty", "active_engine": "axe|native"}`.
- **`UpdateSettings`** (`handler.go:283-310`) decodes an anonymous struct with the same three fields and applies each only if non-zero/non-empty — partial-update-by-omission semantics. This means a plain `bool` field cannot be used (there is no way to explicitly send `false` and have it apply); any new boolean must be a `*bool` pointer field.
- **Auth**: `POST /admin/verify` (`router.go:25`) is public and does a constant-time password compare (`handler.go:188`, `subtle.ConstantTimeCompare`) before minting a 30-minute HS256 JWT with `Subject: "admin"`. `GET`/`POST /admin/settings` (`router.go:27-28`) are behind `adminAuthMiddleware` (`jwt_middleware.go:43-64`), which validates the HMAC JWT and requires `claims.Subject == "admin"`.
- **Public precedent for exposing non-sensitive config**: `GET /api/v1/` → `Info` (`handler.go:42-50`) already publicly (unauthenticated) exposes `max_concurrent_scans`. This is the existing pattern for surfacing settings the non-admin frontend needs to read without an admin token.
- **Frontend pattern to clone**: the admin drawer (`index.html:572-654`, `#admin-drawer`) uses `.admin-toggle-section` blocks with two-button toggles (see the Active Scanner Engine control, `index.html:610-620`, `#engine-axe`/`#engine-native`, `.toggle-btn`/`.active` classes). `frontend/app-v2.js` is the live file (`index.html:672` loads only `app-v2.js`; `app.js` is a dead legacy copy). `loadAdminSettings()` (`app-v2.js:2037-2060`) fetches settings and sets `.active` classes; `saveAllSettings()` (`app-v2.js:2083-2128`) derives values from which button is `.active` and POSTs the full JSON in one shot on Save (no per-click network calls).

**Verdict on structural feasibility:** a runtime-toggleable setting is possible today exactly as far as the existing three settings go — in-memory, mutex-safe, reset on restart. That is an acceptable failure mode for this specific flag (see below), but would not be acceptable if this were a durable business setting.

### Backend Changes

1. **`internal/config/config.go`**
   - Add `PDFScanningVisible bool` to `Config` (after `ActiveEngine`, ~line 29).
   - Add `GetPDFScanningVisible() bool` / `SetPDFScanningVisible(bool)` following the exact `GetActiveEngine`/`SetActiveEngine` pattern (`config.go:130-150`), including the `global == nil` guard.
   - In `Load()` (~line 197): `PDFScanningVisible: getEnvBool("PDF_SCANNING_VISIBLE", false)`.
2. **`internal/api/handler.go`**
   - `GetSettings` (`handler.go:275-279`): add `"pdf_scanning_visible": config.GetPDFScanningVisible()`.
   - `UpdateSettings` request struct (`handler.go:284-288`): add `PDFScanningVisible *bool \`json:"pdf_scanning_visible"\`` (pointer required, per the partial-update semantics above). Apply with `if req.PDFScanningVisible != nil { config.SetPDFScanningVisible(*req.PDFScanningVisible) }` and include it in the echoed response (`handler.go:305-309`).
   - Add `"pdf_scanning_visible": config.GetPDFScanningVisible()` to the public `Info` handler (`handler.go:43-49`) so the unauthenticated main-app UI can read it without an admin token — same precedent as `max_concurrent_scans`.
3. **`internal/api/router.go`** — no route changes needed; the new field rides the existing `/admin/settings` routes.
4. **`openapi.yaml`** — sync the `/admin/settings` and `/` response schemas with the new field, per CLAUDE.md's `openapi.yaml(sync↔handler.go)` rule.
5. **CLAUDE.md ENV line** — add `PDF_SCANNING_VISIBLE(opt,def:false)`.

**Persistence decision:** do not build a JSON-file or DB-backed store for this one bool. Env-seeded + in-memory (identical to every other setting) is sufficient: the flag defaults OFF and fails closed on any restart, which is the safe direction for a pre-validation feature. If the team wants it to survive the auto-deploy-on-push workflow (commit `7c52b43`), they set `PDF_SCANNING_VISIBLE=true` in the VPS `.env`, already parsed by `loadDotEnv`.

**Server-side enforcement note — the part that matters most:** UI hiding is not access control, and today that's fine because there is no PDF backend for this flag to gate. But the moment a real `POST /api/v1/scan/pdf` (or equivalent) handler is built, that handler must independently enforce its own enablement check as its first statement, mirroring the existing `isPrivateURL`/`GetAllowPrivateScans` guard pattern (`handler.go:355-358`):

```go
if !config.GetPDFScanningEnabled() { // a SEPARATE flag — see Security Considerations
    writeError(w, http.StatusForbidden, "PDF scanning is not enabled", "")
    return
}
```

### Frontend Changes

1. **Admin drawer row** — insert a new `.admin-toggle-section` after the Max Concurrent Scans block (`index.html:634-638`), cloning the engine-toggle markup (`index.html:610-620`):
   ```html
   <div class="admin-toggle-section" style="margin-top: 1rem;">
     <label class="form-label">PDF Scanning (Coming Soon) Visibility</label>
     <div class="toggle-row">
       <button id="pdf-visible-off" class="toggle-btn active" type="button" data-pdf="off">Hidden</button>
       <button id="pdf-visible-on" class="toggle-btn" type="button" data-pdf="on">Visible</button>
     </div>
     <p class="field-hint">Internal only: reveals the "PDF scanning — coming soon / request early access" card in the main UI for sales demos. No PDF scanning backend exists; this is visibility-only.</p>
   </div>
   ```
2. **`loadAdminSettings()`** (`app-v2.js:2037-2060`): read `data.pdf_scanning_visible` and toggle `.active` on `#pdf-visible-on`/`#pdf-visible-off`, mirroring `app-v2.js:2054-2056`.
3. **`saveAllSettings()`** (`app-v2.js:2083-2128`): derive `pdfVisible` from which button has `.active` (pattern at `app-v2.js:2097-2098`), add `pdf_scanning_visible: pdfVisible` to the POST body (`app-v2.js:2111-2115`), and bind the two buttons' click handlers near the existing engine-toggle bindings (`app-v2.js:2259`). Keep the single-save-on-click-Save pattern — do not fire a POST per button click.
4. **Main-app affordance**: add a hidden-by-default card (e.g. `#pdf-coming-soon`, `hidden` attribute) near the scan form in `index.html`. On app init, read `pdf_scanning_visible` from the existing public `GET /api/v1/` call and set `$('pdf-coming-soon').hidden = !data.pdf_scanning_visible`. This keeps the check server-driven (no localStorage) — a demo admin flipping the drawer toggle takes effect for any viewer on next page load.

### Security Considerations

1. **Public exposure of the flag on unauthenticated `GET /api/v1/` — safe.** A boolean that only toggles a marketing card carries no confidentiality value and creates no meaningful oracle (it reveals nothing about backend capability, since no PDF endpoint exists to infer anything about). The `max_concurrent_scans` precedent supports this. **Caveat to enforce going forward:** this endpoint must stay a dumping ground only for cosmetic/non-authoritative flags. Any future flag added here that gates real functionality (not just UI copy) needs its own scrutiny before being bolted onto this same public payload — do not let this precedent silently expand scope.

2. **Write path via `adminAuthMiddleware` + `POST /admin/settings` — no new risk.** This is a bearer-JWT-in-header API, not cookie-based, so there is no CSRF vector (CSRF requires ambient cookie transmission). The new field introduces nothing beyond what `MaxConcurrentScans`/`ScoringFormula` already do. The partial-update-by-pointer pattern itself is fine for this flag, but is a **latent generic risk for future admin-settings fields**: if a security-relevant boolean is ever added to this same struct using the same "apply only if non-nil" pattern, an easy-to-miss omission-vs-explicit-false bug becomes possible. Worth a one-line review note for future admin-settings PRs, not a blocker here.

3. **Highest-priority risk: flag reuse months from now.** The realistic failure mode is that a future developer building the actual PDF scan handler finds `PDFScanningVisible` already wired end-to-end (env var → admin settings → public info endpoint) and, taking the path of least resistance, guards the real scan handler with `if cfg.GetPDFScanningVisible()` instead of adding a proper `PDFScanningEnabled` flag. That would collapse "show a coming-soon card to a demo viewer" into "authorize arbitrary input into a PDF-parsing pipeline" — the same class of mistake this codebase already takes seriously for SSRF on URL scanning (see Risk #3 in the Risks & Open Questions section above). **This must be written down explicitly, now, as a standing rule:** `PDFScanningVisible` MUST NOT be read by any code path that accepts, queues, or processes a PDF document. It is UI-only. Enablement of real PDF scanning, whenever Phase 1 is greenlit, requires its own separately-seeded flag (e.g. `PDFScanningEnabled`), and any future PR that makes real scanning logic conditional on `PDFScanningVisible` should be rejected in review on sight.

### Recommendation

Build the flag now, scoped exactly as above: `pdf_scanning_visible`, default `false`, env-seeded, admin-JWT-write, publicly-readable, UI-only. It costs about an hour of plumbing following patterns that already exist in this codebase (`ActiveEngine` for the config/handler shape, the engine toggle buttons for the frontend shape), it directly supports the buyer-validation motion the Product Framing section requires before Phase 1 can start, and — provided the "visibility ≠ enablement" rule above is written into this document and enforced at review time when Phase 1 actually begins — it introduces no meaningful security or scope-creep risk. The one thing that must not happen is treating this flag as a placeholder for the real enablement gate later; that distinction is the entire point of this addendum.
