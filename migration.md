# Migration plan: user access to MongoDB Atlas + email-code login

Status: **final plan**, no code changed yet. Written 2026-11-28; Atlas limits checked against MongoDB's own docs the same day (sources in section 3).

## 1. What we are doing, in one paragraph

Today, scan limits and approvals live in JSON files on the server (`data/access.json`, `data/extension_scans.json`), and users prove who they are by pasting an access code. We will move that data to a free MongoDB Atlas cluster and replace access codes with a simple login: the user types their email, gets a 6-digit code, and stays logged in for 30 days. Free scans and approved scans then belong to the account (the email), not to a code or an IP address. The website and the extension use the same account.

## 2. Scope

In scope:
- Access data (users, requests, scan counts) moves to Atlas.
- Email-code login for the website and the extension.
- Approved scans are added to the user's account (no code to paste).
- One-time import of existing approved codes and free-scan counts.

Out of scope (stays as it is):
- `data/leads.jsonl` and `data/visits.jsonl`: append-only logs read only by the admin Activity tab. Files are fine; move them only if we ever run more than one server.
- `data/reports/`: scan results with screenshots, around 1 MB each. These must never go into the database (512 MB would hold only a few hundred).
- Passwords. Not needed; the emailed code is the login.

## 3. Atlas free tier: checked facts

Sources: [Atlas Free Cluster Limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/), [Pause/Resume a Cluster](https://www.mongodb.com/docs/atlas/pause-terminate-cluster/), [Flex costs](https://www.mongodb.com/docs/atlas/billing/atlas-flex-costs/), [MongoDB Pricing](https://www.mongodb.com/pricing). Checked 2026-11-28.

| Limit | Value | What it means for us |
|---|---|---|
| Storage | **0.5 GB, counted uncompressed, indexes included** | About 1 million users (see 5.1). Alert at 400 MB. |
| Throughput | **100 operations per second**; above that Atlas throttles | A scan needs 1 to 3 operations; the app's own limit (60 requests/min per IP) keeps us far below. Alert at 80. |
| Connections | 500 | The Go driver keeps a small pool (cap it at 20). |
| Data transfer | 10 GB in and 10 GB out per rolling 7 days | Our documents are tiny; not a concern. |
| Idle pause | **Paused after 30 days with zero connections** | Our server stays connected, so it only bites if the server is down for 30 days. |
| Backups | **None** (only a private preview) | We must run our own `mongodump` (supported, except on the `admin` database). |
| Regions | Only some AWS / Google Cloud / Azure regions | Pick the nearest free region to the Contabo server. |
| Alerts | Only on Connections, Logical Size, Network, Opscounter | Enough: we use Logical Size and Opscounter. |
| Clusters | One free cluster per project | Fine. |
| Upgrade path | **Flex: $8 to $30 per month**, 5 GB, one daily snapshot | Move here at 400 MB or if we need managed backups. |

Corrections to earlier notes: storage is counted **uncompressed** (compression does not help), and the idle pause is **30** days (not 60).

## 4. Where things are today

| Piece | File | What it does |
|---|---|---|
| Access store | `internal/access/access.go` | `Store` with `Create`, `CreateTrial`, `Approve`, `Deny`, `Revoke`, `Validate`, `Status`, `Consume`, `List`. One JSON file, rewritten on every change. |
| Access emails | `internal/access/mail.go` | `SMTPMailer`, `OwnerRequestEmail`, `UserApprovedEmail` |
| Access HTTP | `internal/api/access.go` | `/access/request`, `/access/review`, `/access/session`, admin list/decide, `metered` middleware (JWT subject `access:<id>`) |
| What is counted | `internal/api/router.go` | `/scan`, `/crawl` (one multi-page crawl = **one** scan) and `/scan/client`. Report downloads are **not** counted. |
| Trial at registration | `internal/api/handler.go` `CaptureLead` | `h.Access.CreateTrial(email, 5)` returns a `trial_code` |
| Extension free scans | `internal/api/ext_quota.go` | 5 lifetime scans per hashed IP for guest tokens on `/scan/client` |
| Website client | `frontend/app-v2.js` | stores `accessscan_access_code` / `accessscan_trial_code`, swaps them at `/access/session` |
| Extension client | `extension/background.js`, `popup.*` | stores `accessCode`, swaps it at `/access/session` |
| Admin console | `frontend/admin.*` | Access tab lists and decides requests |
| Switch | `ACCESS_APPROVAL_ENABLED` | turns the whole flow on or off (also a runtime toggle in admin settings) |

## 5. Target design

### 5.1 Collections (3)

`users`: one per email.
```json
{
  "_id": "ObjectId",
  "email": "user@example.com",
  "scans_allowed": 5,
  "scans_used": 0,
  "status": "active",
  "created_at": "Date",
  "last_login_at": "Date",
  "last_scan_at": "Date"
}
```
- `email` is lower-cased and trimmed, the same as today's `normEmail`.
- `scans_allowed` starts at 5 free and goes up when you approve a request.
- `status` is `active` or `blocked`.
- Indexes: `{email: 1}` unique.

`login_codes`: short-lived, deleted automatically.
```json
{
  "_id": "ObjectId",
  "email": "user@example.com",
  "code_hash": "hex",
  "attempts": 0,
  "expires_at": "Date"
}
```
- `code_hash` is HMAC-SHA256(`JWT_SECRET`, code); the code itself is never stored.
- `attempts` counts wrong tries, at most 5.
- `expires_at` is creation time plus 10 minutes.
- Indexes: `{expires_at: 1}` TTL with `expireAfterSeconds: 0`, and `{email: 1}`.
- Mongo's expiry sweep runs about once a minute, so `/auth/verify` must still check `expires_at` itself.

`access_requests`: history of "I need more scans".
```json
{
  "_id": "ObjectId",
  "email": "user@example.com",
  "status": "pending",
  "scans_granted": 25,
  "requested_at": "Date",
  "decided_at": "Date",
  "review_key_hash": "hex"
}
```
- `status` is `pending`, `approved` or `denied`.
- `review_key_hash` keeps the owner's one-click review link from the email working.
- Indexes: `{status: 1, requested_at: -1}` and `{email: 1, status: 1}`.

**Size (uncompressed, indexes included):** about 400 B per user (document plus 2 indexes) and about 300 B per request. 0.5 GB holds roughly **1 million users with one request each**. We alert at 400 MB and move to Flex well before the cap.

### 5.2 Counting scans: reserve first, refund on failure

Two scans at the same moment must not both use the last scan. So we take the scan **before** running it, in one atomic call, and give it back if the scan fails:

```
// reserve
users.findOneAndUpdate(
  { _id: uid, status: "active", $expr: { $lt: ["$scans_used", "$scans_allowed"] } },
  { $inc: { scans_used: 1 }, $set: { last_scan_at: now } },
  { returnDocument: "after" })
// nothing returned → 403 scans_used_up (or login_required / blocked)

// refund, only if the handler answered with an error (status >= 400)
users.updateOne({ _id: uid }, { $inc: { scans_used: -1 } })
```

- This replaces today's "count after success", which has a race: two scans could pass the check together and both run on the last scan.
- A failed scan still costs nothing, because it gets refunded.
- The cost is 1 or 2 database operations per scan.
- The `scans_remaining` figure in the response comes from the reserved document.

### 5.3 Login and session

- **`POST /api/v1/auth/code` `{email}`:**
  - Check the email with the same rule as `RequestAccess`: `mail.ParseAddress`, and the address must equal the input.
  - Make a 6-digit code with `crypto/rand`, store its HMAC, and email it.
  - Always answer `200 {"ok":true}`, so the endpoint doesn't reveal who has an account.
  - Limits:
    - 3 codes per email per hour, using an in-memory `httprate` limiter keyed by email (the same library the app already uses). Codes delete themselves after 10 minutes, so the database can't count sends.
    - The existing 60/min per-IP limit.
  - `shortcut: send limits are in memory, so they reset on restart and aren't shared between servers; move them to a collection if we run more than one server.`
- **`POST /api/v1/auth/verify` `{email, code}`:**
  - Find the newest unexpired code for that email.
  - A wrong code adds 1 to `attempts`; at 5 the code is deleted.
  - A right code is deleted at once, so it works only once.
  - Then upsert the user. New users get `scans_allowed = ACCESS_TRIAL_SCANS` (default 5).
  - Return a JWT: HS256 as now, subject `user:<id>`, expiry `AUTH_SESSION_DAYS` (default 30).
  - New-account limit: at most 3 new accounts per IP per day (in-memory `httprate`, same shortcut note).
- **`GET /api/v1/auth/me` (JWT):** returns `{email, scans_left}` for the website header and the extension popup.
- **Blocking works straight away:** the reserve call in 5.2 checks `status: "active"`, so blocking a user stops their 30-day token on the next scan.
- **HMAC, not plain SHA-256:** a 6-digit code has only a million values, so a leaked plain hash could be guessed in seconds. HMAC with the server secret prevents that.
- **Secret rotation:** changing `JWT_SECRET` (`POST /api/v1/secret`) logs everyone out and voids any codes in flight. That's acceptable; just know it.

### 5.4 Scan routes

`metered` changes from "token is `access:<id>`" to "token is `user:<id>`" and uses 5.2:

| Token | `/scan`, `/crawl` (`appMeteredAuth`) | `/scan/client` (extension) |
|---|---|---|
| `user:<id>` | counted on the account | counted on the account |
| guest (`/session`) while approval is on | 403 `login_required` | 403 `login_required` |
| `admin` | unlimited | unlimited |
| approval switched off | open, as today | open, as today |

- Unchanged: one multi-page crawl = one scan, and report downloads are free.
- **Database down: fail closed.** If Atlas can't be reached, scan routes return **503** "accounts are unavailable, try again shortly". They never fall back to free scanning. The server refuses to start if `MONGODB_URI` is set but Atlas is unreachable, which is the same fail-fast behaviour `access.NewStore` has today.

### 5.5 Asking for more scans

- **Request:** `POST /api/v1/access/request` now needs a `user:` JWT. The email comes from the account, so the user fills in nothing. If a request is already pending for that email, nothing new is created.
- **Owner notice:** the owner email and the one-click review link (`/access/review`) stay.
- **Approve** (review link or admin tab): add the granted scans to the user (`$inc: {scans_allowed: N}`) and email "You've been approved for N more scans". No code is sent. The code-expiry setting (`ACCESS_CODE_TTL_DAYS`) is no longer needed.
- **Deny:** mark the request `denied` and send no email, as today.
- **Block** (new admin button): set `users.status = "blocked"`. **Unblock** sets it back.

### 5.6 Code layout (keep the current structure)

- Turn `internal/access.Store` into an interface with two implementations:
  - `internal/access/mongo.go`, used in production when `MONGODB_URI` is set.
  - An in-memory version for tests: today's store, trimmed. The `internal/api` tests then run without a database.
- New dependency: `go.mongodb.org/mongo-driver/v2` (the official driver; works with our Go 1.23). Nothing else.
- Indexes are created at startup with `CreateIndexes`, which is safe to repeat.
- Env vars:
  - New: `MONGODB_URI` (secret), `MONGODB_DB` (default `accessscan`), `AUTH_SESSION_DAYS` (default 30).
  - Removed after Phase 4: `ACCESS_STORE_PATH`, `ACCESS_CODE_TTL_DAYS`.
  - Unchanged: `ACCESS_APPROVAL_ENABLED`, `ACCESS_TRIAL_SCANS`, `ACCESS_DEFAULT_SCANS`, `PUBLIC_BASE_URL`, the SMTP settings.

## 6. Phases

Each phase ships on its own and can be rolled back on its own.

### Phase 0: Atlas setup (about 1 hour, no code)

1. Find which data centre the Contabo server is in (it's in the Contabo panel; the repo doesn't say). Create the free cluster in the **nearest supported free region**.
2. Create a database user with read/write on the `accessscan` database only, using a password (SCRAM), which the free tier supports.
3. Network Access: add **only** the server's public IP. Never `0.0.0.0/0`.
4. Put `MONGODB_URI` in the server's `.env`, not in git and not in `docker-compose.yml`. Add `maxPoolSize=20` to the URI.
5. Alerts: Logical Size above 400 MB, and Opscounter above 80 per second.
6. Backups (the free tier has none). Add a **daily** cron on the server and keep 14 files; the data is tiny:
   `mongodump --uri "$MONGODB_URI" --db accessscan --archive=/backups/accessscan-$(date +%F).gz --gzip`
   Restore it once into a scratch database to prove it works.
7. Update the privacy policy: account emails are now stored with MongoDB Atlas, in the region chosen in step 1.

### Phase 1: same features, data in Atlas (about 1.5 days)

Goal: nothing changes for users; only the storage moves.

1. Extract the `Store` interface from `internal/access/access.go` (methods listed in section 4).
2. Write `MongoStore` with the same behaviour. Access codes stay hashed. `Consume` uses the reserve/refund pattern from 5.2 on the `access_requests` document.
3. ~~Move the extension per-IP counter into an `ext_free_scans` collection.~~ Dropped (2026-11-28): guests are refused with `login_required` once login ships, so the counter could never run. `ext_quota.go` and `extension_scans.json` are gone.
4. `cmd/server/main.go`: if `MONGODB_URI` is set, use Mongo; otherwise keep the JSON files. **This is the rollback switch.**
5. Import tool `cmd/migrateaccess`:
   - Reads `data/access.json` and upserts it into Atlas.
   - Safe to run twice (idempotent).
   - `-dry-run` prints counts only.
6. Tests: run the existing `internal/access` lifecycle test against both stores. The Mongo run uses `MONGODB_TEST_URI` and is skipped when that's unset.
7. Deploy: back up `data/`, stop the container, run the import, set `MONGODB_URI`, start. Check the admin Access tab shows the same requests.

Rollback: remove `MONGODB_URI` and restart. The import leaves the JSON files untouched.

### Phase 2: email-code login on the server (about 2 days)

1. Add the `users` and `login_codes` collections and their indexes.
2. Add the endpoints from 5.3, and the new `metered` rules from 5.4 with reserve/refund.
3. Add `access/request`, approve, deny, block and unblock from 5.5. Add a new email, `UserScansAddedEmail`, next to `UserApprovedEmail` in `mail.go`.
4. Keep `/access/session` working during the switch-over, so old codes still scan. Log every use, so we know when nobody needs it any more.
5. Tests:
   - Codes: right code, wrong code 5 times, expired code, a code used twice.
   - Limits: the 4th code request in an hour is refused; the 4th new account from one IP in a day is refused.
   - Scans: a new user gets 5 and the 6th is refused; a failed scan is refunded.
   - Concurrency: **10 concurrent scans with 1 scan left, and exactly one succeeds.**
   - Approvals: approving adds N scans; a blocked user is refused mid-session.
   - Outage: database unreachable gives 503, never a free scan.

### Phase 3: website, extension and admin switch to login (about 2.5 days)

Website (`frontend/app-v2.js`, `index.html`):
1. Replace the registration modal's trial-code step with a two-step login: email, then "Send code", then a 6-digit field, then logged in. Keep the consent checkbox and lead capture, so `/leads` still records the email.
2. Store the session token as today (`LS_KEY_TOKEN`, kind `user`), and remove the `accessscan_access_code` / `accessscan_trial_code` handling.
3. The header shows the email, "N scans left" and a Log out button.
4. "Request more scans" becomes a single button, with no email field.

Extension (`background.js`, `popup.*`):
1. The popup gets the same two-step login, with the token stored in `chrome.storage.local`.
2. Remove the "Have an access code?" field and the `accessCode` key.
3. On 403 `scans_used_up`, show the one-button request. On `login_required`, show the login.

Admin console (`frontend/admin.*`):
1. The Access tab shows users: email, scans used and allowed, last scan, status. It also lists pending requests.
2. Approve takes a number of scans and adds them. Add Block and Unblock buttons. Remove the code expiry from the UI.

Accessibility (we sell accessibility, so this is not optional):
- The code field has `inputmode="numeric"`, `autocomplete="one-time-code"` and a visible label.
- Errors are announced through the existing `role="alert"` and status regions.
- Focus moves to the code field after "Send code". A "Resend code" button appears after 60 seconds.

Old extension versions still send access codes to `/access/session`, which keeps working until Phase 4. **Publish the new extension and wait for it to be live in the Chrome Web Store before Phase 4.**

### Phase 4: move old codes to accounts, then clean up (about 1 day)

1. One-time script: for every approved, unexpired access code, upsert the user by email and add the code's remaining scans to `scans_allowed`. Email those users: "No code needed any more; just log in with this email."
2. Remove `/access/session`, the `access:` token subject, trial codes in `CaptureLead`, and the code fields in both clients.
3. ~~Remove the per-IP scan cap.~~ Done early (2026-11-28). Free scans belong to the account, and the new-accounts-per-IP limit (5.3) covers abuse.
4. After a final backup, delete `data/access.json` and `data/extension_scans.json` from the server.
5. Update `openapi.yaml`, `CLAUDE.md` and the user manual.

**Total: about 7 to 8 working days.**

## 7. Decisions (settled; change any of them before Phase 2 if you disagree)

| # | Question | Decision |
|---|---|---|
| 1 | Abuse with new email addresses | At most 3 new accounts per IP per day; drop the per-IP scan cap in Phase 4 |
| 2 | How long a login lasts | 30 days (`AUTH_SESSION_DAYS`) |
| 3 | Free scans for existing users | Everyone starts with 5 (we can't link old IP counts to emails) |
| 4 | Leads and visits | Stay as files |
| 5 | Cost of a multi-page crawl | Stays 1 scan, as today |
| 6 | When to upgrade to Flex ($8 to $30/month) | When the 400 MB alert fires, or if managed daily snapshots become worth paying for |

## 8. Security checklist

- [ ] `MONGODB_URI` only in the server env; the Atlas network list holds only the server IP; the database user can reach only `accessscan`.
- [ ] Codes: made with `crypto/rand`, stored as HMAC, expire after 10 minutes, 5 tries, work only once, 3 sends per email per hour.
- [ ] `/auth/code` gives the same answer for known and unknown emails.
- [ ] Emails validated as a single plain address (blocks header injection), as `RequestAccess` does now.
- [ ] Every scan's reserve call checks `status: "active"`, so a blocked user is stopped at once.
- [ ] Database down means 503, never free scans.
- [ ] The 30-day token lives in `localStorage` / `chrome.storage`. That's acceptable here, but an XSS bug would expose it, so keep rendering user data with `textContent`.
- [ ] The daily `mongodump` is running and one restore has been tested.
- [ ] Privacy policy names MongoDB Atlas and its region.

## 9. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| No backups on the free tier | Accounts lost | Daily `mongodump`, 14 kept, restore tested (Phase 0) |
| Storage cap (0.5 GB uncompressed) | Writes fail | Alert at 400 MB; upgrade to Flex |
| Throughput cap (100 ops/sec) | Requests throttled, scans slow | 1 to 3 operations per scan and the app's 60/min per-IP limit; Opscounter alert at 80 |
| Idle pause (30 days with no connections) | Logins fail after a long outage | The server stays connected; after any long downtime, check the cluster is resumed |
| Atlas unreachable | No scans for logged-in users | Fail closed with 503 and a clear message; Phase 1 rollback switch |
| Email delivery fails | Nobody can log in | SMTP already carries approvals; test it before Phase 3; "Resend code" after 60 s |
| Old extension in users' browsers | Code-based scans break at Phase 4 | Keep `/access/session` until the new extension is live |
| `JWT_SECRET` rotated | Everyone logged out | Known side effect; rotate only when needed |
| Network delay to Atlas | Each scan adds 1 or 2 round trips | Nearest region; negligible next to a scan of about 10 s |
