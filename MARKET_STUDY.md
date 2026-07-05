# Web Accessibility Scanner — Market Study & Positioning Report
*Prepared 2026-07-05 · Subject: in-house Go/axe-core WCAG scanner*

---

## Executive Take (Read This First)

You have built a **technically credible automated scanning engine** and, unusually, a **defensible dual scoring layer** (penalty-based + AudioEye-weighted SC failure rate). That is real. But as a *product*, it is currently a headless engine — not something a buyer can purchase, deploy, or defend a lawsuit with.

The market is not short of scanning engines. axe-core (which you wrap) is free and open-source. So are Lighthouse and IBM Equal Access. **Nobody pays for "a scanner." They pay for the wrapper: workflow, reporting, monitoring, remediation, and legal cover.** Your "known gaps" list is exactly that wrapper.

**Honest headline: as an engine you're ~70/100. As a sellable product you're ~34/100.**

---

## 1. Competitive Landscape

This is not one market — it is four markets that outsiders lump together.

### Group A — Developer / Shift-Left Testing Tools

| Tool | Engine | Deployment | Pricing (2026) | Primary Buyer |
|---|---|---|---|---|
| **axe DevTools** (Deque) | axe-core (they own it) | Browser ext + CLI + API + CI | Pro ~$45/mo; enterprise ~$1,200–2,500/seat/yr | Dev/QA leads |
| **Lighthouse** (Google) | axe-core subset | Chrome DevTools, CLI, CI | Free | Individual devs |
| **IBM Equal Access** | Own (ACT-aligned) | Ext + Node CLI + CI | Free / open-source | Devs at large orgs |
| **Tenon.io** | Own API | API-first | ~$10–50/mo | Devs wanting an API |
| **Pope Tech** | WAVE (WebAIM) | Hosted dashboard | Free tier; ~$59–199/yr | Higher-ed, SMB, agencies |

> **Critical:** Deque owns axe-core — the engine this tool depends on. Anything you build on axe-core, they can build faster and market as "the source."

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

- **AudioEye** — JS widget + automated fixes + human remediation. ~$45/mo to $15k+/yr. Overlays are under sustained legal and community fire — they don't fix accessibility, and plaintiffs' firms increasingly sue sites *using* overlays.
- **UserWay** (now Level Access) — overlay widget, ~$49–199/mo by pageviews.

> **Note:** Your engine is the *opposite* of an overlay (real detection vs. cosmetic patching). Do not let anyone conflate them. Also: the weighted scorer is internally called "AudioEye-style" — rebrand this in any external-facing docs before shipping.

---

## 2. Feature Comparison Matrix

Legend: ✅ full · 🟡 partial/limited · ❌ none

| Dimension | **In-house** | axe DevTools | Lighthouse | IBM Equal Access | WAVE/Pope Tech | Siteimprove | Level Access | Silktide |
|---|---|---|---|---|---|---|---|---|
| WCAG 2.1 A/AA | 🟡 (14 full/21 partial/8 missing) | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ |
| WCAG 2.2 | ❌ | ✅ | 🟡 | ✅ | 🟡 | ✅ | ✅ | ✅ |
| Automated rule count | ~63 mapped + 22 custom | ~90+ | ~40 | ~160+ | ~60–70 | ~200+ | ~200+ | ~150+ |
| REST API access | ✅ (JWT-secured) | ✅ | 🟡 | ✅ | 🟡 | ✅ | ✅ | 🟡 |
| Browser extension | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 |
| CI/CD integration | ❌ | ✅ | ✅ | ✅ | 🟡 | 🟡 | 🟡 | ❌ |
| Multi-page crawl | 🟡 (partial depth) | 🟡 | ❌ | 🟡 | ✅ | ✅ | ✅ | ✅ |
| PDF/document scanning | ❌ | 🟡 | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Historical trend dashboard | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Remediation guidance | 🟡 basic (dev hints) | ✅ detailed + AI | 🟡 basic | ✅ detailed | 🟡 basic | ✅ | ✅ | ✅ |
| Team/user management | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Compliance reporting (ADA/508/EN 301 549) | ❌ | 🟡 | ❌ | 🟡 | 🟡 | ✅ | ✅ | ✅ |
| Dual scoring (penalty + weighted SC rate) | ✅ **unique** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Self-hosted / on-prem | ✅ | 🟡 | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| White-label / embeddable API | 🟡 (possible, unbuilt) | 🟡 | ❌ | ❌ | 🟡 | ❌ | ❌ | ❌ |

**What this table says:** Your only current column-wins are *dual scoring* (genuinely unique), *self-hosted*, and *latent white-label capacity*. Every ❌ in a row where three or more competitors show ✅ is a purchase-blocker.

---

## 3. Market Readiness Score — 40 / 100

| Sub-category | Weight | Score | Justification |
|---|---|---|---|
| Rule coverage & accuracy | 25% | 58 | axe-core base + 22 custom Puppeteer checks are solid. But 8 SCs missing + 21 partial = cannot truthfully claim "WCAG 2.1 AA coverage," and there is no 2.2 in a market that has moved to 2.2. |
| Developer experience (API, CI/CD) | 20% | 45 | Clean REST+JWT API, SSRF protection, rate limiting = good engineering. But zero CI/CD integration, no extension, no CLI. For a dev-tools play, that is the whole product missing. |
| Enterprise readiness | 20% | 20 | No user/team management, no RBAC, no multi-tenant, no audit log, no dashboard, no SSO. Single-tenant JWT is not enterprise-sellable. |
| Reporting & compliance | 15% | 28 | xlsx/HTML report generation exists. But no ADA/508/EN 301 549 mapping, no VPAT support. This is #1 thing enterprise/gov buyers pay for. |
| Differentiating features | 20% | 55 | Dual scoring is genuinely rare and your best asset. Undercut by not being exposed in any buyer-facing way. |

**Weighted total: ~40/100** — Viable engine, not yet a market entrant. You would lose every competitive bake-off today not on detection quality but on everything wrapped around it.

---

## 4. Gap Prioritization

### Tier 1 — Must-Close (blocks market entry)

| Gap | Effort | Impact | Persona Unlocked |
|---|---|---|---|
| Close 8 missing SCs + firm up 21 partials; add WCAG 2.2 | High | High | Everyone — table-stakes credibility |
| CI/CD integration (GitHub Action first) | Low–Med | High | Dev/QA leads — cheapest, highest-leverage move since the REST API already exists |
| Multi-page crawl (finish depth scanning) | Med | High | Compliance/marketing — single-page disqualifies from Group C entirely |
| Compliance report (ADA / Section 508 / EN 301 549 + VPAT-style) | Med | High | Legal, gov, edu — WCAGMap already exists; this is data-mapping work, not a rebuild |
| Historical trend tracking + minimal dashboard | Med–High | Med–High | Compliance managers, agencies — the recurring-revenue hook |
| Team/user management (multi-tenant + RBAC) | High | Med | Any paying account with more than 1 user |

### Tier 2 — Nice-to-Have (viable → preferred)

| Gap | Effort | Impact | Persona Unlocked |
|---|---|---|---|
| AI-assisted remediation (code-level fix suggestions) | Med | High | Devs + agencies — where axe DevTools and AI-native newcomers are pushing |
| Browser extension | Med | Med | Individual devs — good for top-of-funnel PLG, low direct revenue |
| White-label / embedded API productization | Low–Med | Med–High | Agencies + SaaS platforms — already 80% of the way there |
| PDF/document scanning | High | Med | Gov/edu/finance — only if explicitly targeting those verticals |
| Screen-reader simulation / guided manual testing | High | Med | Enterprise a11y teams — buy rather than build early |

---

## 5. Recommended Positioning Strategy

### Do Not Fight the War You Will Lose

Do not position as "a better scanner than axe DevTools." You wrap axe-core; Deque *is* axe-core — 90+ rules, an extension, CI, AI remediation, and enterprise sales. Head-to-head, you lose.

Do not go near the overlay market. It is legally toxic and your engine is the opposite of an overlay. Your engine is the moral and technical high ground.

### Target Segment #1: Agency / White-Label Embedded API

You have a clean, self-hostable, JWT-secured Go REST API with SSRF protection and rate limiting — exactly what a digital agency or SaaS platform needs to embed accessibility scanning under their own brand. None of the major players sell this well. Siteimprove and Level Access want to *be* the brand. That is your gap.

### Target Segment #2: Shift-Left Dev Tooling (via GitHub Action)

Once the API is white-label-ready, the GitHub Action is the cheapest path to bottom-up adoption.

### The Unique Angle: Transparent Dual Scoring

This is your genuine differentiator. Build the narrative on it:

> *"Every accessibility tool gives you a number you cannot defend. We give you two you can — a severity-weighted penalty score and a per-success-criterion weighted failure rate — so engineers know what to fix first and legal teams can show a defensible, criterion-by-criterion methodology."*

Most tools output an opaque count or a black-box score that a plaintiff's expert shreds in deposition. A transparent, dual-lens, per-SC score is a legitimately better story for both the compliance buyer and the dev buyer. Expose the scoring math as a feature. The openness *is* the moat.

---

## 6. Build Order to Minimum Viable Competitive Position

| Phase | Work | Timeline |
|---|---|---|
| 1 | **GitHub Action** wrapping existing scan API → publish to GitHub Marketplace | Weeks 1–3 |
| 2 | **Multi-page crawl** (finish depth scanning) | Weeks 2–6 |
| 3 | **Compliance report export** (508 + EN 301 549 mapping over existing WCAGMap) | Weeks 4–8 |
| 4 | **Close 8 missing SCs + WCAG 2.2** (parallel to above) | Weeks 1–10 |
| 5 | **Multi-tenant + trend storage + minimal dashboard** | Weeks 8–14 |
| 6 | **Package the white-label API tier** (pricing, docs, sandbox key) | Weeks 10–14 |
| 7 | **AI remediation** | Post-MVP |

---

## 7. Pricing Strategy

### A) White-label / Embedded API — usage-based, primary revenue

| Tier | Price | Volume |
|---|---|---|
| Starter | ~$99/mo | 5,000 scans/mo |
| Growth | ~$399/mo | 30,000 scans/mo |
| Platform / White-label | from ~$1,500/mo | volume-based + white-label rights |

Know your cost-per-scan (Puppeteer is CPU-heavy) before setting this number.

### B) Direct Dev/SMB — freemium PLG funnel

| Tier | Price | Limits |
|---|---|---|
| Free | $0 | 1 site, 100 pages/mo, GitHub Action, public report only |
| Pro | ~$49/mo | Trend dashboard, compliance export, 5 sites |
| Team | ~$199/mo | Multi-user, RBAC, more sites |

> **India note:** If selling domestically, price direct tiers in INR (₹1,999/mo Pro / ₹6,999/mo Team via Razorpay/UPI, +18% GST). The serious accessibility-compliance money is US/EU/gov (ADA, Section 508, EN 301 549, and the European Accessibility Act, in force June 2025). Price and sell the white-label API tier in USD to Western agencies.

---

## 8. Biggest Risk

Your engine's dependency on axe-core means your single largest competitor owns your foundation, and "a scanner" is a commodity worth nothing. If you position as a scanner, you are selling free software with a UI.

The only survivable positions are where the *wrapper* is the product: the transparent dual-scoring methodology, the embeddable white-label API, and the compliance-report packaging.

---

## 9. First Action This Week

**Ship the GitHub Action** wrapping your existing scan API and publish it to GitHub Marketplace.

- Low effort (API already exists)
- Cheapest path to real users and feedback
- Forces two decisions you have avoided: how to authenticate external callers and what your per-scan cost actually is

**You cannot price anything until you know cost-per-scan.**

---

*Report generated by advisor-orchestrator · 2026-07-05*
