# Email Signup / Lead Capture Plan — AccessScan Landing Page

Status: proposal (planning only, no code written)
Author: tech-advisor
Date: 2026-08-02
Owner: iamsabroy@gmail.com

---

## 1. Requirements Recap

The product owner wants, on the marketing landing page (`frontend/landing.html`, served at `/` when `LANDING_PAGE_ENABLED=true`):

1. Before a visitor acts on "Open Scanner App" or "Download Extension (.zip)", show an email signup prompt.
2. The prompt should fire **once per session on the visitor's laptop** — i.e. per-browser-session, not permanent.
3. The captured email must (a) be **notified to the owner** (iamsabroy@gmail.com) as a lead, and (b) be **added to a list** for later marketing updates.

**Verified facts about the current code (do not re-derive):**

- The landing page is pure HTML with **no JavaScript** today. The two CTAs are plain anchors:
  - `<a href="/app" class="btn-nav-cta">Open Scanner App →</a>` (nav CTA at ~line 615, hero at ~line 636, footer CTAs ~963/971)
  - `<a href="/web-accessibility-scanner.zip" download>Download Extension (.zip) →</a>` (~line 855)
- The scanner app lives at `/app` (`index.html`); the extension zip is a static file at `/web-accessibility-scanner.zip` served by the file server in `router.go`.
- Backend is a **stateless Go service** — no database anywhere. Config is env-driven via `internal/config/config.go` (`Load()`, `getEnv`, `getEnvBool`, `.env` auto-loaded by `loadDotEnv`).
- Routing is in `internal/api/router.go`; there is a public route group and a rate-limited group (`rateLimitMiddleware()`, 10 req/min) wrapping scan/score. Public unauthenticated endpoints already exist (`/session`, `/admin/verify`, `/token`).
- No email-sending, CRM, or newsletter integration exists today.

**Assumption flagged:** "list for later updates" means an owned list we can later export/sync to Mailchimp/etc. — not that we must integrate a marketing platform now. This plan keeps the list local and swappable.

---

## 2. Soft Gate vs Hard Gate — Recommendation

**Recommendation: soft gate (dismissible modal with "Maybe later"), not a hard block.**

Rationale:

- This is a **free, no-registration** tool whose entire positioning is "instant scan in 30 seconds, no signup" (that copy is literally on the page — hero subhead and footer "No registration required"). A hard gate directly contradicts the value prop and will read as a bait-and-switch.
- The extension download is a **trust action** — a hard email wall in front of a `.zip` download materially depresses installs, which is the top-of-funnel you actually want.
- A soft gate still captures the majority of motivated leads (people who want updates will give an email) while letting the rest through. You keep conversion **and** get leads.

**The tradeoff (stated honestly):** a soft gate captures fewer emails per visitor than a hard gate. If the owner's #1 goal is maximizing list size over product usage, a hard gate collects more addresses — but at the cost of higher bounce and lower-quality emails (people type `a@a.com` to get past walls). For a free developer tool trying to build a top-of-funnel, **usage > list size**. Soft gate wins.

**Concrete UX:**

- Modal appears the first time (per session) the visitor clicks any Scan or Download CTA.
- Fields: one email input + a primary button ("Email me & continue") + a secondary text link ("No thanks, just continue").
- Either choice **completes the original action** (navigates to `/app` or triggers the `.zip` download). We never trap the user.
- Submitting a valid email fires the capture request, marks the session as "prompted", then proceeds.
- Dismissing marks the session as "prompted" too — so we honor "once per session" for dismissals as well and don't nag on every click.

This is gated behind `LEAD_CAPTURE_ENABLED` so it can be turned off instantly without a redeploy.

---

## 3. Session Scoping — Mechanism

**Use `sessionStorage`.**

| Option | Behavior | Fit |
|---|---|---|
| `sessionStorage` | Cleared when the browser tab/session ends; per-tab | **Chosen** — matches "current session on his laptop" exactly |
| `localStorage` | Persists forever until cleared | Too sticky — visitor never re-prompted even weeks later; contradicts "per session" |
| Cookie | Sent to server on every request, needs expiry management, adds header weight | Overkill; we don't need the server to read this flag |

Key: `accessscan_lead_prompted` = `"1"`. Set it after either submit or dismiss. Check it before showing the modal. Because it's client-side only, no server round-trip is needed to decide whether to show the prompt — the gate stays instant.

Note on "once per session" nuance: `sessionStorage` is per-tab. If the visitor opens the landing page in two tabs they could see it twice. That is acceptable and arguably correct for "session." If the owner wants strictly one-prompt-per-browser-until-close, that still maps best to `sessionStorage`; don't upgrade to `localStorage` unless the owner explicitly wants "never ask again."

---

## 4. Backend Surface

### New endpoint

```
POST /api/v1/leads        (public, unauthenticated, rate-limited)
```

**Why public/unauthenticated:** the landing page is served at `/` and has no JWT/guest-session bootstrap today (the guest `/session` token flow lives in the scanner app). Forcing the landing modal to first fetch a guest token adds a round-trip and failure mode for zero security benefit — the endpoint writes a low-value lead record, not a privileged action. Keep it public but **rate-limited and validated**, consistent with how `/admin/verify` and `/token` are already public.

### Request shape

```json
{
  "email": "visitor@example.com",
  "source": "scan_cta" | "extension_cta",
  "consent": true,
  "website": ""            // honeypot — must be empty
}
```

### Response shape

Always return `200` with a generic body on both success and "soft" rejection (honeypot/duplicate) so bots can't distinguish outcomes:

```json
{ "ok": true }
```

On hard validation failure (malformed email, missing body), return `400` with the existing `ErrorResponse{error, details?}` type already defined in `models`.

### Validation (in `handler.go`)

1. **Email format** — use `net/mail.ParseAddress`. Reject if it errors or if local/domain is empty. Cap length at 254 chars.
2. **Honeypot** — the `website` field is hidden via CSS on the form. If non-empty, silently return `{ "ok": true }` and drop the record. This kills the majority of dumb bots with zero UX cost.
3. **Consent** — require `consent == true` (checkbox or implicit-by-submit; see §7). Store the boolean with the record for GDPR-lite defensibility.
4. **Source allow-list** — accept only `scan_cta` / `extension_cta`; default to `unknown` otherwise. Prevents junk in the analytics.

### Middleware / router wiring (`router.go`)

Add inside the existing **rate-limited group** (so it inherits `rateLimitMiddleware()` = 10 req/min per client), as a public route (no `jwtAuthMiddleware`):

```go
r.Group(func(r chi.Router) {
    r.Use(rateLimitMiddleware())
    r.Post("/leads", h.CaptureLead)   // public + rate-limited
    r.Post("/scan", jwtAuthMiddleware(h.Scan))
    // ... existing rate-limited routes
})
```

Handler `CaptureLead` goes in `internal/api/handler.go`. Because 10 req/min already applies, a scripted signup flood is throttled at the same tier as scans — sufficient for Phase 1.

---

## 5. Storage

**Recommendation: append-only JSONL file for Phase 1, structured for a trivial SQLite/Sheet migration later. Do not add a database.**

The service is stateless and this is a lead list, not transactional data. A DB is overengineering for day one.

- Write each accepted lead as one line to a file, path from env `LEAD_STORE_PATH` (default `data/leads.jsonl`).
- One JSON object per line:

```json
{"email":"visitor@example.com","source":"scan_cta","consent":true,"ip_hash":"<sha256(ip+salt)>","user_agent":"...","ts":"2026-08-02T10:15:00Z"}
```

- Guard concurrent writes with a package-level `sync.Mutex` in a small `internal/leads` package (open file with `O_APPEND|O_CREATE|O_WRONLY`, `0600` perms). Append-only + mutex avoids corruption without a DB.
- **De-dup:** Phase 1 does not need dedup on write (append is fine; dedup at export). If the owner wants dedup now, keep an in-memory `map[string]struct{}` seeded from the file on startup — cheap at this volume.

**Deployment note (important):** the app runs on a Contabo VPS via Docker Compose + Caddy (per project memory). `data/leads.jsonl` **must live on a mounted volume**, not inside the container's ephemeral layer, or every redeploy wipes the list. Add a bind mount / named volume for `./data` in the compose file. Call this out to the owner explicitly — it's the easiest way to silently lose every lead.

**When to graduate:** move to SQLite (`modernc.org/sqlite`, pure-Go, no CGO) once you need dedup + querying + "how many leads this week" — realistically past a few hundred leads or when you build an admin view. Until then JSONL + `wc -l` is enough.

---

## 6. Notification + "Later Updates" List Delivery

Two jobs from one capture: (a) notify the owner now, (b) retain for later marketing.

### (a) Owner notification — SMTP via Go stdlib `net/smtp`

- Use `net/smtp` with STARTTLS to a provider you already control. Env-driven:
  - `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`.
  - `LEAD_NOTIFY_EMAIL` (default `iamsabroy@gmail.com`) = recipient.
- **Recommended provider:** a transactional sender with a free tier — **Brevo (formerly Sendinblue)** or **Resend**. Both give SMTP creds and a free monthly quota that comfortably covers early lead volume. Avoid using a personal Gmail account's SMTP directly: Google now requires an App Password, throttles aggressively, and lead mail landing in your own Sent folder is messy. (Verify current free-tier limits at signup — these change; check before committing.)
- **Do the send asynchronously.** Fire the email in a goroutine after the file write succeeds, with a timeout. The HTTP response to the visitor must not block on SMTP — a slow mail server should never slow the "continue to /app" UX. If the send fails, log it (without the raw email at info level) and rely on the JSONL file as the durable record; the lead is not lost.

**Alternative considered — transactional API (Resend/Postmark HTTP API) instead of raw SMTP:** cleaner error handling and deliverability, but adds an HTTP client + JSON contract to maintain. For a single notification email, `net/smtp` is fewer moving parts. If deliverability becomes a problem (owner notifications landing in spam), switch to the HTTP API — it's a drop-in behind the same `internal/leads.Notifier` interface. Design the notifier as an interface now so the swap is a one-file change.

### (b) "Later updates" list

- **Phase 1: the JSONL file _is_ the list.** Every accepted lead with `consent:true` is a subscriber. Export with a one-liner (`jq -r 'select(.consent) | .email' data/leads.jsonl | sort -u`) whenever you want to seed a campaign.
- **Do NOT integrate Mailchimp/SendGrid Marketing now.** That's speculative infrastructure — you have no campaigns yet and no volume. Adding an ESP API + list ID + double-opt-in flow before you've sent a single newsletter is pure overhead.
- **Graduation trigger:** the day the owner actually wants to send a broadcast, sync the exported CSV into an ESP (Brevo/Mailchimp both import CSV). Wire a background sync only if manual export becomes a chore — realistically never at this scale.

---

## 7. Frontend Implementation

The landing page has **no JS today**, so this is additive and low-risk.

### Where to hook

1. Add a hidden modal markup block near the end of `frontend/landing.html` `<body>` (before the closing `</body>`), containing the form: email input, a visually-hidden honeypot `website` input, primary submit, secondary "No thanks, just continue" link, and a one-line privacy note (§8).
2. Add a small inline `<script>` (or a new `frontend/landing.js` referenced from `landing.html`) that:
   - On `DOMContentLoaded`, selects **all** scan/download CTAs. Since they're anchors, the cleanest hook is by attribute: every `a[href="/app"]` and the `a[href="/web-accessibility-scanner.zip"]`. Give them a shared class (e.g. `data-lead-cta`) during the edit so the selector is explicit and future CTAs opt in by adding the attribute.
   - Adds a click listener that:
     - If `sessionStorage.getItem('accessscan_lead_prompted') === '1'` → do nothing, let the default navigation/download happen.
     - Else → `event.preventDefault()`, stash the intended action (the anchor's `href` + whether it's a `download`), and open the modal.
   - Modal submit: validate email client-side (basic regex, real check is server-side), `POST /api/v1/leads`, then **regardless of the response** set `sessionStorage` flag and perform the stashed action (assign `window.location` for `/app`, or programmatically click a temp `<a download>` for the zip). Never let a network hiccup trap the user.
   - "No thanks": set the flag, perform the stashed action.

### Key implementation notes

- **Fail open.** If the fetch throws or times out, still complete the navigation. The gate is a lead-capture nicety, not a paywall.
- **Extension download nuance:** because we `preventDefault()` the `download` anchor, after capture we must re-trigger it. Simplest: create a transient `<a href="/web-accessibility-scanner.zip" download>`, append, `.click()`, remove. Test this in Chrome specifically (the target audience) — programmatic `download` clicks are reliable there.
- **Accessibility (eat your own dog food):** this is an *accessibility* tool — the modal must be keyboard-navigable, trap focus while open, restore focus on close, have `role="dialog"` + `aria-modal="true"` + a labelled heading, and be dismissible with `Esc`. Shipping an inaccessible modal on an accessibility product is an embarrassing own-goal; treat this as non-negotiable, not polish.

---

## 8. Config / Env Vars

Follow the existing pattern in `config.go`: add fields to `Config`, load in `Load()` via `getEnv`/`getEnvBool`, add thread-safe getters, and document in `CLAUDE.md`'s ENV block.

| Env var | Default | Purpose |
|---|---|---|
| `LEAD_CAPTURE_ENABLED` | `false` | Master on/off for the whole feature (backend accepts + frontend shows modal). Ship dark, flip on when ready. |
| `LEAD_NOTIFY_EMAIL` | `iamsabroy@gmail.com` | Owner notification recipient. |
| `LEAD_STORE_PATH` | `data/leads.jsonl` | Append-only lead store (mount as a volume — see §5). |
| `LEAD_IP_SALT` | (required if capture enabled) | Salt for hashing visitor IP; never store raw IP. |
| `SMTP_HOST` | (empty) | If empty, skip notification, still persist to file. |
| `SMTP_PORT` | `587` | STARTTLS submission port. |
| `SMTP_USERNAME` | (empty) | SMTP auth user. |
| `SMTP_PASSWORD` | (empty) | SMTP auth pass — secret, never log. |
| `SMTP_FROM` | (empty) | From address (e.g. `leads@accessscan.in`). |

- Expose `LEAD_CAPTURE_ENABLED` in the frontend via a tiny public config read. The landing page has no config endpoint today; simplest is to have the `/` handler inject a `<meta name="lead-capture" content="true">` (or a `window.__LEAD_CAPTURE__` inline flag) when the flag is on, mirroring how `LANDING_PAGE_ENABLED` already gates which file `/` serves. Avoids a config fetch on page load.
- Add getters `GetLeadCaptureEnabled()`, `GetLeadNotifyEmail()`, etc., matching the existing `GetLandingPageEnabled()` style (RWMutex-guarded).

---

## 9. Security / Privacy

- **Never store raw IP or log the raw email at info level.** Store `sha256(ip + LEAD_IP_SALT)` for coarse abuse detection only. Log leads at debug level or log a redacted form (`v****@domain`).
- **Secrets management:** `SMTP_PASSWORD` and `LEAD_IP_SALT` come from env (already the project's model via `.env` + real env). Do not commit `.env`. On the VPS, inject via the Docker Compose env / an env file with `0600` perms — not baked into the image.
- **Rate limiting:** endpoint sits inside the existing 10 req/min group. That's adequate for Phase 1. If you see abuse, add a stricter per-IP limiter specifically for `/leads` (e.g. 3/min) — but don't pre-build it.
- **Honeypot** (`website` field) + server-side `net/mail` validation is your Phase 1 bot defense. No CAPTCHA — it's friction on a free tool and unnecessary at this volume.
- **CORS:** the endpoint is same-origin (served from the same host as the landing page), so the existing `corsMiddleware` is fine. Do not loosen CORS to add this.
- **Input handling:** cap request body size (chi/`http.MaxBytesReader`, e.g. 4KB) on `/leads` so a giant payload can't be used to exhaust memory. Reject non-JSON content types.
- **GDPR-lite:** store `consent: true` + timestamp with every record. Put a one-line note under the form: *"We'll email you occasional product updates. No spam, unsubscribe anytime."* with a link to a short privacy note. Since this is a marketing list, include an unsubscribe path before you send the *first* broadcast (not required to capture, required to send). Keeping consent + timestamp now makes that defensible later.
- **Fail-closed on the durable record, fail-open on UX:** the file write is the source of truth; the email notification is best-effort. Never lose a lead because SMTP was down, and never block a visitor because the file write was slow (write is fast + mutexed; if it errors, log and still let them through).

---

## 10. Phased Rollout

### Phase 1 — Minimal viable (ship this)
- `LEAD_CAPTURE_ENABLED` flag (default off).
- Soft, dismissible, accessible modal on `landing.html`, `sessionStorage`-scoped.
- `POST /api/v1/leads` — public, rate-limited, honeypot + `net/mail` validation, body-size cap.
- Append to `data/leads.jsonl` (volume-mounted) with hashed IP + consent + timestamp.
- Async owner notification via `net/smtp` (skips cleanly if SMTP env unset).
- Privacy one-liner + consent stored.
- The JSONL file *is* the "later updates" list; export via `jq`.

### Phase 2 — Nice-to-have (only when justified)
- Dedup on capture (in-memory set from file on startup) — when duplicates get noisy.
- Migrate store to pure-Go SQLite — when you need queries/counts/an admin view.
- Admin view of leads behind the existing `adminAuthMiddleware` (`/admin/leads`) — reuse the admin password flow already in `router.go`.
- ESP sync (Brevo/Mailchimp CSV import or API) with double-opt-in + unsubscribe — the day you actually send a broadcast.
- Per-endpoint stricter rate limit + optional CAPTCHA — only if you see real abuse.
- Simple funnel metric: count `scan_cta` vs `extension_cta` sources to see which CTA drives signups.

---

## Cost Estimate

- **Storage:** ~zero. Text file on the existing VPS.
- **Email:** free tier of Brevo/Resend covers early volume at $0/mo. Cost only becomes a factor at thousands of notifications/month — far past current scale. (Confirm current free-tier caps at signup.)
- **Infra:** no new services. Runs inside the existing Go container + Caddy on the Contabo VPS.
- **Scale point that changes the profile:** when the list crosses into real campaign volume (you're actively broadcasting to thousands and want automation/segmentation), you graduate to a paid ESP tier — that's a marketing decision, not a technical forcing function.

## Biggest Technical Risk

**Losing the lead file on redeploy.** The single most likely silent failure is `data/leads.jsonl` living inside the container's ephemeral filesystem and getting wiped on every `docker compose up --build`. Mount it as a volume from day one and verify persistence across a redeploy before flipping `LEAD_CAPTURE_ENABLED` on. Everything else is recoverable; a wiped list is gone.

## Next Action

Add the `data/` volume mount to the Compose file and confirm a file written inside the container survives a redeploy. Once persistence is proven, implement Phase 1 behind `LEAD_CAPTURE_ENABLED=false`, then flip it on.
