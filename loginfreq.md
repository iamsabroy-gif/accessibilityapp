# Implementation Plan: Monthly Return-Visit Frequency for Registered Users

## 1. Problem

We need to know how often registered users come back to the app on a
monthly basis (e.g. "how many of the 340 registered users visited
≥2 times in October").

This is currently impossible: `leads.jsonl` records a registration
**event once per email** (the `isUserRegistered()` / `isRegistered()`
localStorage gate in `app-v2.js` / `landing.html` ensures `/api/v1/leads`
is only POSTed the first time a browser registers). There is no visit
log anywhere in the codebase — `GET /api/v1/session` issues anonymous
guest JWTs with no identity attached. Nothing links a later visit back
to the email a user registered with.

This plan adds the minimum new instrumentation + storage + reporting
needed, using the same file-based patterns already used for leads
(`internal/leads/leads.go`), since production is a single Contabo
container with a bind-mounted `./data` volume (`docker-compose.yml`) —
no DB required (see prior discussion; revisit if the app ever moves to
multiple replicas/load-balanced instances).

## 2. Scope

In scope:
- Log a "visit" event for every page load where a registered email is
  already known client-side (i.e. the registration gate already passed).
- Persist visits server-side, keyed by email + timestamp.
- Produce a monthly aggregation: distinct active days (or visits) per
  email per calendar month.
- A simple way to pull the report (CLI/script first; admin API endpoint
  optional stretch).

Out of scope (flag, don't build yet):
- Cross-device/cross-browser identity resolution — this still relies on
  the email already stored in `localStorage.accessscan_user_email`
  (app-v2.js:2337), same limitation as the registration gate itself.
  If a user clears storage or switches browsers, visits won't be
  attributed to them.
- Real user accounts / login / passwords (separate, bigger effort,
  discussed previously).
- Any change to the registration-gate UX itself.

## 3. Data Model

New record type, mirrors `leads.LeadRecord`:

```go
// internal/visits/visits.go
type VisitRecord struct {
    Email     string `json:"email"`
    Timestamp string `json:"ts"` // RFC3339 UTC
}
```

New append-only JSONL store, identical pattern to `leads.Store`
(mutex-guarded, `O_APPEND|O_CREATE|O_WRONLY`, 0600, directory
auto-created):

```go
// internal/visits/visits.go
type Store struct {
    filePath string
    mu       sync.Mutex
}

func NewStore(filePath string) *Store { ... }
func (s *Store) Save(rec *VisitRecord) error { ... }
```

No dedup/rate-limit logic needed at write time — one line per visit is
fine at current traffic volume; the monthly aggregation collapses
duplicates.

## 4. Backend Changes

### 4.1 New endpoint: `POST /api/v1/visit`

- Public, rate-limited (reuse `rateLimitMiddleware()` group in
  `router.go`, same group as `/leads`).
- Request body: `{ "email": "user@example.com" }`.
- Validation: same email format/length checks as `CaptureLead`
  (`handler.go:997-1005`); silently 200 on malformed/missing email to
  avoid giving the frontend a reason to retry-loop.
- No consent/honeypot needed — this isn't collecting new PII, it's
  logging activity for an email the user already consented to register.
- Feature-flagged behind a new `VISIT_TRACKING_ENABLED` config (default
  `false`), following the same opt-in pattern as `LEAD_CAPTURE_ENABLED`.
- Writes via `h.VisitStore.Save(...)`.

Files touched:
- `internal/visits/visits.go` (new, store + record type)
- `internal/visits/visits_test.go` (new, mirrors `leads_test.go`)
- `internal/api/handler.go`: add `VisitStore *visits.Store` field to
  `Handler`; add `CaptureVisit` handler function.
- `internal/api/router.go`: add
  `r.Post("/visit", h.CaptureVisit)` inside the existing rate-limited
  group.
- `internal/config/config.go`: add `VisitTrackingEnabled bool` +
  `VisitStorePath string` (default `data/visits.jsonl`), plus getters
  `GetVisitTrackingEnabled()` / `GetVisitStorePath()`, following the
  exact shape of `GetLeadCaptureEnabled()` / `GetLeadStorePath()`
  (config.go:360-362).
- `cmd/server/main.go`: construct `visits.NewStore(cfg.VisitStorePath)`
  and wire into `Handler`, next to the existing `leadStore` wiring
  (main.go:45).
- `openapi.yaml`: document the new endpoint, matching the `/leads`
  entry style.

### 4.2 Monthly aggregation

Two options, pick based on how often you need the report:

**A. One-off script (ship first, cheapest)**
A small Go command (`cmd/visitreport/main.go`) or just a local
`jq`/Python pass over `data/visits.jsonl` that:
1. Parses every line's `email` + `ts`.
2. Buckets by `(email, YYYY-MM)`.
3. Counts distinct visit-days per bucket (not raw visit count, to avoid
   over-counting someone who refreshes 10 times in one sitting).
4. Outputs a CSV: `email, month, visit_days, total_visits`.

Run manually/monthly via SSH on the Contabo box, or wrapped in a cron
job later.

**B. Admin API endpoint (stretch)**
`GET /api/v1/admin/visits/monthly?month=2026-10`, behind
`adminAuthMiddleware` (same middleware already protecting
`/admin/settings`, `/admin/coverage`), reads `visits.jsonl` + `leads.jsonl`
at request time, returns the same aggregation as JSON for display in
the admin panel. Only worth building once (A) has proven the data is
useful.

Recommendation: ship A first, revisit B only if this becomes a
recurring need rather than a one-time curiosity check.

## 5. Frontend Changes

- `frontend/app-v2.js`: on app load (not gated by the registration
  modal), if `localStorage.getItem('accessscan_user_email')` is set,
  fire `fetch(\`${apiBase()}/api/v1/visit\`, { method: 'POST', body:
  JSON.stringify({ email }) })` — fire-and-forget, no UI, no await
  blocking render, ignore failures silently.
- `frontend/landing.html`: same ping if `accessscan_registered` /
  email is already set when the page loads (covers users who return
  directly to the landing page without going to `/app`).
- No UI changes, no new modals — this is pure background telemetry.

## 6. Config / Deployment

- Add to `docker-compose.yml` environment block (or `.env`):
  `VISIT_TRACKING_ENABLED=true`
- `data/visits.jsonl` lands in the already-bind-mounted `./data`
  volume — no volume changes needed, survives redeploys exactly like
  `leads.jsonl` does today.
- No DB, no migration, no new infra — consistent with single-container
  Contabo deployment confirmed earlier.

## 7. Testing

- `internal/visits/visits_test.go`: unit test `Store.Save` (concurrent
  writes, directory creation) — copy `internal/leads/leads_test.go`
  structure.
- `internal/api/visits_test.go`: handler test for `/api/v1/visit`
  (valid email, malformed email, flag disabled → 404), copy
  `internal/api/leads_test.go` structure.
- Manual: deploy, register one test email, hit `/app` a few times
  across different days, run the aggregation script, confirm counts.

## 8. Rollout / Caveats

- This only counts visits **from the point of deployment onward** —
  there is no way to backfill history that was never logged.
- Attribution is per-browser-localStorage, not per-verified-identity;
  flag this limitation in whatever report/dashboard consumes the data
  so monthly numbers aren't read as more precise than they are.
- If this later needs to extend into real per-user accounts (login,
  quotas, dashboards), this visit log becomes the first building block
  of that larger user-store effort discussed separately — no rework
  needed, just extend `VisitRecord` with a real `UserID` once accounts
  exist.

## 9. Effort Estimate

- Backend (store + endpoint + config + tests): ~0.5–1 day
- Frontend ping (2 files, no UI): ~1 hour
- Aggregation script (option A): ~1–2 hours
- Admin endpoint (option B, stretch): ~0.5 day, defer until needed

Total for MVP (sections 3, 4.1, 4.2A, 5, 6, 7): **~1 day**.
