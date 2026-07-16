# Web Accessibility Scanner — User Manual

## 1. What This Tool Does

The Web Accessibility Scanner tests any public website for compliance with the **Web Content Accessibility Guidelines (WCAG) 2.1/2.2**, levels A, AA, and AAA. It combines the industry-standard **axe-core** engine with a set of custom checks for gaps axe-core doesn't cover (captions, focus order, non-text contrast, and more).

For each scan you get:
- A **0–100 accessibility score** and letter grade (A–F)
- A full list of **violations**, grouped by severity, each pointing to the exact HTML element responsible
- **Developer-ready fix guidance** for each violation (before/after code snippets)
- Optional **legal compliance reports** (ADA, Section 508/VPAT, EN 301 549, and 8 other regional standards) as PDF or HTML

No account or login is required to run a scan — the tool issues a temporary guest session automatically.

---

## 2. Running a Scan

1. Open the scanner in your browser.
2. Enter the full URL of the page you want to test (e.g. `https://www.example.com`) in the input field.
3. Choose a **scan depth**:
   - **0 — Single page** (default): tests only the URL you entered. Fastest option.
   - **1 — Follow links**: also tests up to 10 links found on that page, as long as they're on the same domain. Slower, but useful for a broader site audit.
4. *(Optional)* Check **Auto-Generate Compliance Report** if you want a formal legal-style report generated automatically once the scan finishes. Selecting this reveals:
   - **Standard**: which regulation to report against (see §5)
   - **Format**: PDF or HTML
   - **Product/Vendor details**: name, version, vendor, contact info, notes — these appear on the report's cover page
5. Click **Scan Now**.

A scan typically takes a few seconds to a couple of minutes depending on depth and page complexity. You'll see a loading indicator while it runs.

> **Note:** Scans of private/internal addresses (localhost, 127.x, 10.x, 192.168.x, etc.) are blocked by default for security reasons. If you need to test an internal staging site, ask whoever manages the server to enable that explicitly.

---

## 3. Reading Your Results

### Score Cards

At the top of the results you'll see four summary numbers:

| Card | Meaning |
|---|---|
| **Score** | 0–100 score with a letter grade (A/B/C/D/F) — see §4 for how it's calculated |
| **Compliance %** | Share of all checks that passed |
| **Violations** | Total number of accessibility issues found |
| **Passes** | Total number of checks the page passed |

If enabled, you'll also see an **AudioEye Score** card — an alternative scoring method that weights failures per WCAG success criterion rather than per rule (see §4).

### Violation List

Each violation is shown as a card with:
- A **color-coded left border**: red = critical, orange = serious, yellow = moderate, green = minor
- The **rule name** and a plain-language **description** of the problem
- The exact **HTML element(s)** on the page that triggered it
- If you requested a visual report, a **screenshot** of the page with the problem element highlighted and numbered
- An expandable **"How to fix"** section with step-by-step instructions and a before/after code example you can hand directly to a developer

### Passes and Incomplete Sections

- **Passes**: checks the page satisfied — useful to confirm what's already working.
- **Incomplete**: checks that couldn't be fully automated and need a human to verify (e.g. "does this instruction rely on color alone?"). These are not failures — they're flagged for manual review.

---

## 4. Understanding Your Score

Two independent scoring methods run on every scan:

### Standard Score (default)
Starts at 100 and subtracts points for each violation based on severity:

| Severity | Points deducted per violation |
|---|---|
| Critical | −20 |
| Serious | −10 |
| Moderate | −5 |
| Minor | −2 |

**Grade scale:** A ≥ 90 · B ≥ 75 · C ≥ 40 · D ≥ 25 · F < 25

### AudioEye Score (supplementary)
Instead of counting violations, this measures what *percentage of tested elements* fail, per WCAG success criterion, then averages across all criteria equally. It's a good sanity check if a page has one rule with many repeated instances (which can skew the standard score) — the AudioEye score won't over-penalize a single systemic issue.

Both scores use the same A–F letter grades.

---

## 5. Generating a Compliance Report

Compliance reports translate your scan results into the format expected for legal/regulatory documentation. Available standards:

| Standard | Region / Use case |
|---|---|
| ADA Title III | US — general legal compliance |
| Section 508 (VPAT) | US — federal/government procurement |
| CVAA | US — video/communications accessibility |
| EN 301 549 | European Union |
| EAA (European Accessibility Act) | European Union |
| Equality Act 2010 | United Kingdom |
| AODA | Ontario, Canada |
| ACA (Accessible Canada Act) | Canada — federal |
| BITV 2.0 | Germany |
| DDA 1992 | Australia |
| GIGW 3.0 | India — government websites |

Each report includes a conformance table mapping every relevant WCAG success criterion to a status (Supports / Partially Supports / Does Not Support / Not Applicable / Not Evaluated), plus narrative remarks explaining the assessment. You can generate a report either automatically at scan time (see §2) or afterward from the results view.

Reports are available as:
- **HTML** — viewable in-browser, printable
- **PDF** — downloadable, includes page numbers and a table of contents

---

## 6. Exporting Results

From the results view you can:
- **Download XLSX** — exports the full violation list as an Excel workbook, useful for tracking remediation work in a spreadsheet
- **Generate Compliance Report** — produces a PDF/HTML report as described in §5
- **Print** — uses your browser's print dialog for a quick paper/PDF copy

---

## 7. Admin Console

The admin console lets an administrator adjust server-wide scanning behavior. It's hidden from regular users by design.

**To open it:**
1. Locate the small, mostly-invisible dot in the top-right corner of the page.
2. Click it **5 times within 3 seconds**.
3. Enter the admin password when prompted.

**What you can configure:**
- **Max Concurrent Scans** — how many scans the server will run at once
- **Scoring Formula** — switch between the penalty-based and compliance-percentage scoring methods
- **Active Engine** — switch between the axe-core engine and the native custom-rules engine
- **Scan Mode** — serial (server processes linked pages one at a time) vs. parallel (your browser requests them concurrently) when using scan depth 1
- **WCAG Coverage Upload** — upload a spreadsheet to update the reference table of which WCAG success criteria are implemented, partial, or missing

Admin sessions last **30 minutes** and end automatically when you close the browser tab.

If you see "admin console password is not configured," the site administrator hasn't set an admin password on the server yet — this is a server configuration step, not something fixable from the browser.

---

## 8. Troubleshooting

| Problem | Likely cause / fix |
|---|---|
| "Invalid URL" error | Make sure the URL starts with `http://` or `https://` and is a complete, publicly reachable address |
| Scan takes a long time or times out | Very large or slow-loading pages can exceed the scan time limit; try scan depth 0 instead of 1, or try again |
| "Too many requests" (429) | The scanner is rate-limited to prevent abuse; wait about a minute and try again |
| "Could not reach the API server" / failed to fetch | Usually a temporary network/DNS issue on your end — refresh the page. If it persists across a full browser restart, report it to your administrator |
| Scan blocked with a private-address error | You're trying to scan an internal/private URL (localhost, 192.168.x, etc.); this is blocked by default for security |
| Admin console won't unlock | Make sure you're clicking the trigger dot 5 times within a 3-second window; if you don't know the password, contact your administrator |

---

## 9. Quick Reference

| Action | Where |
|---|---|
| Run a scan | Enter URL → Scan Now |
| Broader site check | Set scan depth to "1 — Follow links" |
| See exact broken elements | Expand any violation card |
| Get a fix for a specific issue | Open "How to fix" inside a violation card |
| Legal/compliance document | Check "Auto-Generate Compliance Report" before scanning, or generate one from the results view |
| Export to spreadsheet | "Download XLSX" in the results view |
| Change server-wide settings | 5-click the hidden dot (top-right) → admin password |
