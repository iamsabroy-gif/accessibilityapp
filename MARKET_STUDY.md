# Web Accessibility Scanner — Market Study & Positioning Report
*Prepared 2026-07-12 · Subject: in-house Go/axe-core + native-engine WCAG scanner · Revision of 2026-07-05 report*

---

## Changelog Since 2026-07-05

| Area | 2026-07-05 Status | 2026-07-12 Status | Source |
|---|---|---|---|
| Compliance reporting | ❌ missing, Tier-1 gap | ✅ **Built.** 11 standards (ADA, VPAT/508, EN 301 549, EAA, BITV, UK Equality Act 2010, AODA, ACA, DDA, GIGW 3.0, CVAA), real per-standard logic, VPAT correctly marks WCAG 2.1+ criteria "Not Applicable," real Puppeteer-based PDF export | `internal/api/handler.go` (10 `Report*` handlers), `internal/report/*.go` (11 generator files), `internal/report/pdf_exporter.go` |
| Compliance reporting — API discoverability | n/a | 🟡 **New gap.** Only 3 of 11 report endpoints (`ada`, `vpat`, `en301549`) are documented in `openapi.yaml`. The other 8 work but are undiscoverable to spec-driven API consumers | `openapi.yaml` lines 42–116 vs. handler.go |
| Compliance reporting — test coverage | n/a | ✅ **Verified solid.** All 11 standards are individually tested via `t.Run()` subtests inside `TestReportFormatters_AllSmoke` — not thin, just consolidated into one table-driven test function | `internal/report/report_test.go` |
| WCAG 2.2 (native engine) | ❌ none | ✅ **All 7 Level A/AA 2.2 SCs implemented** (2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8, and 2.4.13 — mistagged AAA, now fixed to AA) in `ACTIVE_ENGINE=native`, which is the **default** engine | `status.md` (2026-07-06), `audit.md` N10 (resolved) |
| WCAG 2.2 (legacy axe engine) | ❌ none | ❌ **Still none.** `ACTIVE_ENGINE=axe` does not load `scripts/rules/` and provides zero 2.2 coverage | `status.md` line 124 |
| 16 unmapped WCAG 2.1/2.2 SCs | Counted as "8 missing" in CLAUDE.md | ✅ **Resolved 2026-07-10.** Corrected count was 15 (not 16 — one was a stale audit entry). All 15 now flagged `NotAutomatable:true` with honest limitation notes instead of silently dropping from reports | `audit.md` §1.1 |
| WCAG 2.2 sc_registry entries | Missing | ✅ **Resolved 2026-07-10.** All 7 registered; WCAG 2.2 skip removed from `BuildComplianceReport` | `audit.md` §1.2 |
| Compliance % denominator | Excluded `incomplete` (overstated) | ✅ **Resolved 2026-07-10.** `incomplete` now included in denominator | `audit.md` §3.1 |
| AudioEye zero-SC edge case | Silently returned 100/A | ✅ **Resolved 2026-07-10.** Returns 0/F + explicit warning, propagated to all formatters | `audit.md` §3.2 |
| Deployment / ops maturity | Unknown/unstated | ✅ **New signal.** Live on VPS, Docker, HTTPS via Caddy/Let's Encrypt, real domain, GitHub Actions auto-deploy on push to main | Verified this session |
| CI/CD integration (customer-facing GitHub Action) | ❌ open Tier-1 gap | ❌ **Still open — do not confuse with the item above.** No GitHub Marketplace Action wrapping the scan API for external consumers exists | No `action.yml` in repo |
| Multi-page crawl | 🟡 partial | 🟡 **Still partial** — no evidence of resolution in audit.md | `audit.md` (no crawl-depth entry in resolved set) |
| Security — `GET /secret` | Flagged HIGH, exposes JWT signing key | 🔴 **Still open.** Endpoint still present, still returns the raw signing secret to any caller with a valid (including guest) JWT | `internal/api/handler.go`, `router.go` |
| Security — plaintext admin password | Flagged MEDIUM | 🔴 **Still open.** Compared with `subtle.ConstantTimeCompare` (good) but held in memory as plaintext, no hashing | `internal/config/config.go`, `handler.go` |
| Security — other findings (SSRF blocklist gaps, static JWT fallback, CORS wildcard, unrated auth endpoints, native-runner stdout/stderr corruption) | Not assessed in original report | 🔴 **New findings, all still open** — see §9 Security below | `audit.md` §4, §6, §9, §N1–N7 |

**Net effect on market readiness score: 40 → 51/100.** One major Tier-1 gap closed cleanly (compliance reporting) and WCAG 2.2 coverage closed on the default engine. But this audit also surfaced a longer, more specific list of *open* security defects than the original report priced in, and the SC-coverage story is more nuanced (native engine only, legacy engine unaffected) than a flat "closed" would suggest. The recalculation below is not a simple "add points for what's done" — enterprise readiness in particular is held back by newly-documented security findings.

---

## 1. Competitive Landscape

Unchanged from 2026-07-05 — no new competitor intelligence was part of this revision's scope.

This is not one market — it is four markets that outsiders lump together.

### Group A — Developer / Shift-Left Testing Tools

| Tool | Engine | Deployment | Pricing (2026) | Primary Buyer |
|---|---|---|---|---|
| **axe DevTools** (Deque) | axe-core (they own it) | Browser ext + CLI + API + CI | Pro ~$45/mo; enterprise ~$1,200–2,500/seat/yr | Dev/QA leads |
| **Lighthouse** (Google) | axe-core subset | Chrome DevTools, CLI, CI | Free | Individual devs |
| **IBM Equal Access** | Own (ACT-aligned) | Ext + Node CLI + CI | Free / open-source | Devs at large orgs |
| **Tenon.io** | Own API | API-first | ~$10–50/mo | Devs wanting an API |
| **Pope Tech** | WAVE (WebAIM) | Hosted dashboard | Free tier; ~$59–199/yr | Higher-ed, SMB, agencies |

> **Critical:** Deque owns axe-core — the engine your *legacy* mode depends on. Your *native* engine (now the default) reduces this dependency for detection logic, but you still wrap axe-core conceptually and compete on the same rule-count axis in marketing.

### Group B — Free Auditor Tools (top-of-funnel)

- **WAVE (WebAIM)** — free browser tool + paid API. Default free auditor for educators.
- **Accessibility Checker** (Equalize Digital) — freemium WP plugin, ~$149–$3,000+/yr.

### Group C — Enterprise Compliance / Monitoring Platforms

This is where the money is. They sell to compliance, legal, and gov/edu procurement — not to engineers.

| Tool | Pricing (2026) | Primary Buyer |
|---|---|---|
| **Siteimprove** | ~$15k–40k/yr SMB; $75k–150k+/yr enterprise | Gov, higher-ed, marketing ops |
| **Level Access** (acquired UserWay) | Enterprise quote-only; typically $20k–100k+/yr | Legal/compliance, enterprise |
| **Monsido** (Acquia) | ~$10k–30k+/yr | Gov, edu, mid-market marketing |
| **Silktide** | ~$199–990/yr small; enterprise quote-only | Content/marketing teams |
| **BOIA** | ~$99–$500+/mo + audit services | SMB needing legal cover |

### Group D — Overlay Widgets (controversial, large revenue)

- **AudioEye** — JS widget + automated fixes + human remediation. ~$45/mo to $15k+/yr. Overlays are under sustained legal and community fire.
- **UserWay** (now Level Access) — overlay widget, ~$49–199/mo by pageviews.

> **Note:** Your engine is the *opposite* of an overlay. The internal "AudioEye"-named scorer still needs external rebranding before any customer-facing launch — unchanged advice from the prior report.

---

## 2. Feature Comparison Matrix

Legend: ✅ full · 🟡 partial/limited · ❌ none

| Dimension | **In-house** | axe DevTools | Lighthouse | IBM Equal Access | WAVE/Pope Tech | Siteimprove | Level Access | Silktide |
|---|---|---|---|---|---|---|---|---|
| WCAG 2.1 A/AA | 🟡 (15 SCs non-automatable-but-labeled honestly; remainder full/partial per engine) | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ |
| WCAG 2.2 (native engine, default) | ✅ **7/7 A-AA SCs** | ✅ | 🟡 | ✅ | 🟡 | ✅ | ✅ | ✅ |
| WCAG 2.2 (legacy axe engine) | ❌ | — | — | — | — | — | — | — |
| Automated rule count | ~63 mapped + native rule set | ~90+ | ~40 | ~160+ | ~60–70 | ~200+ | ~200+ | ~150+ |
| REST API access | ✅ (JWT-secured) | ✅ | 🟡 | ✅ | 🟡 | ✅ | ✅ | 🟡 |
| Browser extension | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 |
| CI/CD integration (customer-facing) | ❌ | ✅ | ✅ | ✅ | 🟡 | 🟡 | 🟡 | ❌ |
| Multi-page crawl | 🟡 (partial depth, unchanged) | 🟡 | ❌ | 🟡 | ✅ | ✅ | ✅ | ✅ |
| PDF/document scanning | ❌ | 🟡 | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Historical trend dashboard | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Remediation guidance | 🟡 basic (dev hints) | ✅ detailed + AI | 🟡 basic | ✅ detailed | 🟡 basic | ✅ | ✅ | ✅ |
| Team/user management | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Compliance reporting (ADA/508/EN301549/+8 more)** | ✅ **11 standards, real logic, PDF export** | 🟡 | ❌ | 🟡 | 🟡 | ✅ | ✅ | ✅ |
| Compliance reporting — public API discoverability | 🟡 (3 of 11 in openapi.yaml) | — | — | — | — | — | — | — |
| Dual scoring (penalty + weighted SC rate) | ✅ **unique** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Self-hosted / on-prem | ✅ | 🟡 | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| White-label / embeddable API | 🟡 (possible, unbuilt) | 🟡 | ❌ | ❌ | 🟡 | ❌ | ❌ | ❌ |
| Basic production deployment maturity | ✅ (Docker/HTTPS/CI deploy) | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

**What changed:** Compliance reporting flips from a purchase-blocking ❌ to a genuine ✅ — arguably now a *second* differentiator alongside dual scoring, since 11 standards (including less-common ones like BITV, GIGW 3.0, AODA) is broader jurisdictional coverage than most mid-market competitors bother with. WCAG 2.2 flips to ✅ but only conditionally (native engine, which is the default — worth stating plainly, not burying in a footnote). Nothing else in the matrix moved.

---

## 3. Market Readiness Score — 51 / 100 *(was 40/100)*

| Sub-category | Weight | Score (07-05 → 07-12) | Justification |
|---|---|---|---|
| Rule coverage & accuracy | 25% | 58 → **66** | WCAG 2.2 A/AA now fully covered on the default (native) engine — real, verified gain. The 15 non-automatable SCs are now honestly labeled instead of silently dropped, improving *truthfulness* of claims even though it doesn't add detection. Held back because: legacy engine has zero 2.2 coverage (a real fork in what "the product" does depending on config), and audit.md documents specific detection-quality bugs (custom `color_contrast.js` luminance divergence, violation dedup gaps) not present in the original assessment. |
| Developer experience (API, CI/CD) | 20% | 45 → **45** | No change. REST+JWT API remains clean; zero customer-facing CI/CD integration, no extension, no CLI. Live deployment is an *ops* signal, not a *developer-experience-of-the-product* signal — it doesn't move this sub-score. |
| Enterprise readiness | 20% | 20 → **22** | Marginal increase only. Compliance reporting is scored in the Reporting sub-category below, not this one. What *would* move this score — team/user management, RBAC, multi-tenant, SSO, audit logging — is still entirely absent. Worse, this audit surfaced concrete security defects (exposed JWT secret endpoint, plaintext admin password, incomplete SSRF blocklist, hardcoded fallback secret, unrated auth endpoints, CORS wildcard) that a serious enterprise security review would flag immediately. Net: a small increase for basic deploy maturity (Docker/HTTPS/real domain is table stakes but wasn't confirmed before), offset by the security findings. |
| Reporting & compliance | 15% | 28 → **72** | The single largest mover. 11 real compliance standards with distinct per-standard logic, correct VPAT "Not Applicable" handling for WCAG 2.1+ criteria (a specific, easy-to-get-wrong federal procurement nuance — getting it right is a real credibility signal), and genuine PDF export via Puppeteer (not a stub). Not a full 90+ because only 3 of 11 endpoints are in the public OpenAPI spec — a real discoverability gap for external consumers. |
| Differentiating features | 20% | 55 → **62** | Dual scoring remains the strongest asset, still unexposed to buyers. Compliance-report breadth (11 standards, several — BITV, GIGW 3.0, AODA — that competitors don't emphasize) is now a second real differentiator, particularly for agencies selling into Germany, India, or Ontario-regulated sectors specifically. Not higher because neither differentiator is packaged, documented, or marketed yet — they exist in the codebase, not in front of a buyer. |

**Weighted total: 0.25(66) + 0.20(45) + 0.20(22) + 0.15(72) + 0.20(62) = 16.5 + 9.0 + 4.4 + 10.8 + 12.4 = 53.1 ≈ 51/100** (rounded conservatively given the unresolved security findings).

**Why not higher:** The original report's core thesis — "nobody pays for a scanner, they pay for the wrapper" — still holds. You closed the single biggest wrapper gap (compliance reporting) cleanly. But this audit also surfaced a materially longer list of concrete, named security defects than existed in the 07-05 assessment's frame of reference, and those are exactly the kind of finding that kills enterprise/gov deals in security review — the same buyer segment compliance reporting is meant to unlock. Closing compliance reporting without closing `GET /secret` is like fixing the storefront while leaving the back door open; a buyer who reads the VPAT will also run a pen test.

---

## 4. Gap Prioritization

### Tier 1 — Must-Close (blocks market entry)

| Gap | Effort | Impact | Persona Unlocked |
|---|---|---|---|
| **Security remediation batch** (see §9) — remove/lock `GET /secret`, hash admin password, fail-fast on JWT secret generation, consolidate SSRF blocklist to full RFC 1918 range, rate-limit `/token` and `/admin/verify` | Low–Med | High | Any enterprise/gov buyer running a security review — currently a hard "no" |
| CI/CD integration (customer-facing GitHub Action) | Low–Med | High | Dev/QA leads — cheapest, highest-leverage move since the REST API already exists. **Still open**, unchanged from original report |
| Multi-page crawl (finish depth scanning) | Med | High | Compliance/marketing — single-page disqualifies from Group C entirely. **Still open** |
| Publish remaining 8 compliance-report endpoints to openapi.yaml | Low | Med–High | External API consumers, agencies integrating programmatically — cheap fix for a real discoverability gap |
| Close remaining native-runner reliability bugs (stdout/stderr JSON corruption on Puppeteer rule error, silent-empty-rules-directory false-100-score) | Low–Med | High | Anyone running the native engine in production — these are correctness bugs, not polish |
| Historical trend tracking + minimal dashboard | Med–High | Med–High | Compliance managers, agencies — the recurring-revenue hook |
| Team/user management (multi-tenant + RBAC) | High | Med | Any paying account with more than 1 user |

**Moved out of Tier 1 (closed):** ~~Compliance report (ADA / Section 508 / EN 301 549 + VPAT-style)~~ — **done**, now a differentiator, tracked as a Tier-2 polish item below (API doc gap only).

**Moved out of Tier 1 (partially closed, reframed):** ~~Close 8 missing SCs + firm up 21 partials; add WCAG 2.2~~ — WCAG 2.2 is closed *on the native/default engine*. The 15 non-automatable SCs are now honestly labeled rather than closed (labeling ≠ detection). This is now better understood as a documentation-honesty win, not a coverage win — but engine-consistency (native vs. legacy both claiming "the product") is a new, smaller open item worth tracking.

### Tier 2 — Nice-to-Have (viable → preferred)

| Gap | Effort | Impact | Persona Unlocked |
|---|---|---|---|
| AI-assisted remediation (code-level fix suggestions) | Med | High | Devs + agencies |
| Browser extension | Med | Med | Individual devs — PLG top-of-funnel |
| White-label / embedded API productization | Low–Med | Med–High | Agencies + SaaS platforms — already 80% of the way there |
| PDF/document scanning (of target-site PDFs — distinct from the PDF *report export* you now have) | High | Med | Gov/edu/finance verticals |
| Screen-reader simulation / guided manual testing | High | Med | Enterprise a11y teams — buy rather than build early |
| Deprecate or clearly badge legacy `axe` engine's WCAG 2.2 gap | Low | Low–Med | Prevents a support/credibility problem if a customer runs `ACTIVE_ENGINE=axe` and gets a materially different feature set than marketing implies |

---

## 5. Recommended Positioning Strategy

### Do Not Fight the War You Will Lose

Unchanged: do not position as "a better scanner than axe DevTools." Do not go near the overlay market.

### The Story Just Got Better: Two Real Differentiators, Not One

The 07-05 report told you to build your narrative on dual scoring alone. You now have a second, genuinely strong pillar: **the widest compliance-report jurisdiction coverage of any tool at your price point** (which is currently $0, but won't be). 11 standards — including BITV (Germany), GIGW 3.0 (India), AODA (Ontario) — is broader than most $15k–40k/yr platforms bother to offer natively; they typically upsell region-specific compliance as a services add-on. That's a wedge into agencies serving multi-jurisdiction clients (EU + UK + Canada + India), which none of the Group C incumbents specialize in simultaneously.

**Do not lead with this pillar publicly yet.** The `GET /secret` finding and plaintext admin password mean that if a compliance-focused buyer's security team pen-tests you (likely, given the buyer profile), you fail immediately. Fix Tier-1 security items *before* any positioning that invites scrutiny — a VPAT export is exactly the kind of artifact that gets forwarded to a procurement security reviewer.

### Target Segment #1: Agency / White-Label Embedded API (unchanged, now stronger)

Add to the original pitch: "...and ships VPAT/Section 508, EN 301 549, and 9 other jurisdiction-specific compliance reports out of the box" — this is now true and is a meaningfully differentiated claim.

### Target Segment #2: Shift-Left Dev Tooling (via GitHub Action) — unchanged, still not started

### The Unique Angle: Transparent Dual Scoring + Jurisdictional Breadth

> *"Every accessibility tool gives you a number you cannot defend. We give you two you can — plus compliance reports mapped to eleven distinct legal and regulatory standards across four continents, generated from the same underlying WCAG data, so your score and your paperwork always agree."*

The "score and paperwork always agree" framing is new and valuable: most Group C tools generate compliance reports from a separate audit process, creating exactly the kind of inconsistency a plaintiff's expert exploits. Because your VPAT and your dual score share one WCAGMap, you can credibly claim internal consistency competitors can't.

---

## 6. Build Order to Minimum Viable Competitive Position

| Phase | Work | Timeline |
|---|---|---|
| 1 | **Security remediation batch** — remove/lock `GET /secret`, hash admin password (bcrypt/argon2), fail-fast on JWT secret gen failure, rate-limit `/token` + `/admin/verify`, consolidate SSRF blocklist (CIDR-based, full 172.16–172.31) | Weeks 1–2 — **do this first, before any external-facing launch** |
| 2 | **Fix native-runner correctness bugs** (stdout/stderr JSON corruption, missing-rules-directory false-100-score) | Weeks 1–2 (parallel to Phase 1) |
| 3 | **Publish remaining 8 report endpoints to openapi.yaml** | Week 2 — cheap, high discoverability payoff |
| 4 | **GitHub Action** wrapping existing scan API → publish to GitHub Marketplace | Weeks 2–4 |
| 5 | **Multi-page crawl** (finish depth scanning) | Weeks 3–7 |
| 6 | **Multi-tenant + trend storage + minimal dashboard** | Weeks 7–13 |
| 7 | **Package the white-label API tier** (pricing, docs, sandbox key) — now lead with compliance-report breadth in the pitch | Weeks 9–13 |
| 8 | **AI remediation** | Post-MVP |

The security batch moved to Phase 1 ahead of everything else in the original build order — shipping a compliance-reporting feature to enterprise/gov buyers while `GET /secret` is live is a self-inflicted wound the original report's build order didn't need to worry about (because the compliance feature didn't exist yet to invite that scrutiny).

---

## 7. Pricing Strategy

Unchanged in structure from the 07-05 report — the compliance-reporting build doesn't change unit economics, only the value proposition at each tier. One addition:

### A) White-label / Embedded API — usage-based, primary revenue

| Tier | Price | Volume |
|---|---|---|
| Starter | ~$99/mo | 5,000 scans/mo |
| Growth | ~$399/mo | 30,000 scans/mo |
| Platform / White-label | from ~$1,500/mo | volume-based + white-label rights + all 11 compliance report formats |

Consider gating the *full* 11-standard compliance report set behind Growth/Platform tiers (with ADA + VPAT available at Starter, since those are the two already in the public API spec and the two most commonly requested by US buyers) — this gives you a natural upsell lever you didn't have in the original pricing model.

### B) Direct Dev/SMB — freemium PLG funnel

| Tier | Price | Limits |
|---|---|---|
| Free | $0 | 1 site, 100 pages/mo, GitHub Action, public report only |
| Pro | ~$49/mo | Trend dashboard, ADA + VPAT compliance export, 5 sites |
| Team | ~$199/mo | Multi-user, RBAC, all 11 compliance formats, more sites |

> **India note (unchanged):** If selling domestically, price direct tiers in INR (₹1,999/mo Pro / ₹6,999/mo Team via Razorpay/UPI, +18% GST). Given GIGW 3.0 support now exists, this is worth calling out specifically to Indian gov/PSU-adjacent buyers, who are otherwise underserved by the Western-focused incumbents.

**Still true from the original report: you cannot finalize these numbers until you know cost-per-scan.** That has not been established by this revision.

---

## 8. Biggest Risk

The original risk (axe-core dependency, "a scanner is a commodity") still applies, but a second, more urgent risk emerged from this audit:

**You built the enterprise/compliance-buyer feature (11-standard reporting) before closing the enterprise/compliance-buyer disqualifiers (exposed JWT secret, plaintext admin password, inconsistent SSRF coverage).** The buyer persona compliance reporting is meant to attract is exactly the persona most likely to run a security review before signing. Shipping the wrapper without the security baseline risks burning first-contact credibility with the highest-value segment (gov/legal/enterprise) the moment they look under the hood — worse than not having the feature at all, because it gets you into the room only to lose the deal on discovery.

Secondary, unchanged risk: axe-core dependency for the legacy engine; native engine reduces but does not eliminate this, since it's still marketed as part of "the same product" as the axe-core-dependent path.

---

## 9. Security — Open Items Affecting Enterprise Readiness

Verified still open as of this audit (all from `audit.md`, cross-checked against current source):

| Item | Severity | File | Status |
|---|---|---|---|
| `GET /secret` returns raw JWT signing key to any valid-JWT holder (including guest tokens) | HIGH | `internal/api/handler.go`, `router.go` | **Open** — confirmed present, still only JWT-gated (not admin-gated) |
| Admin password held/compared as plaintext (constant-time compare is correct, but no hashing) | MEDIUM | `internal/config/config.go`, `handler.go` | **Open** — confirmed |
| Static fallback JWT secret if OS entropy read fails | HIGH | `internal/config/config.go` | **Open** per audit.md |
| SSRF blocklist inconsistent between handler.go, middleware.go, native_runner.js (172.16 only vs. full 172.16–172.31) | HIGH | `handler.go`, `middleware.go`, `native_runner.js` | **Open** |
| `/token` and `/admin/verify` not rate-limited | HIGH | `router.go` | **Open** |
| `console.error` in native-runner Puppeteer rule handler can corrupt stdout JSON via `CombinedOutput()` | CRITICAL | `native_runner.js` | **Open** |
| Missing `scripts/rules/` directory silently yields a perfect (100) score with no error | HIGH | `native_runner.js` | **Open** |
| CORS wildcard origin | MEDIUM | `middleware.go` | **Open** |

These directly suppress the Enterprise Readiness sub-score in §3 and are the primary reason that sub-score barely moved despite the compliance-reporting build. **None of this blocks the current positioning strategy for the agency/white-label segment in the short term, but all of it blocks the gov/legal/enterprise segment that the compliance-reporting feature was built to attract.** Treat Tier-1 security remediation as a prerequisite for *marketing* the compliance-report capability externally, not just a parallel workstream.

---

## 10. First Action This Week

**Fix `GET /secret` and rate-limit `/token` + `/admin/verify`.** Both are low-effort (hours, not days), both are the kind of finding a first-pass security scanner or a skeptical prospect's engineer finds in minutes, and both sit directly upstream of the compliance-reporting story you now have a right to tell. Shipping the security fix is what makes the pitch in §5 safe to say out loud.

Second action, same week if capacity allows: **publish the remaining 8 report endpoints to openapi.yaml** — it's a documentation change, not a code change, and it closes the one real remaining gap in an otherwise-shipped feature.

---

*Report generated by advisor-orchestrator · 2026-07-12 · Revision of 2026-07-05 report*
