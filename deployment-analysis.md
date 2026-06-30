# Deployment Platform Analysis
**App:** webaccessibility · Go + Node/Puppeteer/Chromium
**Date:** 2026-06-30

---

## App Resource Profile

| Dimension | Value | Notes |
|---|---|---|
| RAM per scan | 300–500 MB | Headless Chromium process |
| Concurrent scans | 5 (default) | Up to 2.5 GB peak RAM |
| Scan timeout | 180 s | Long-lived HTTP connections (WriteTimeout: 190 s) |
| Disk (dependencies) | ~700 MB | Chromium binary ~170 MB + node_modules ~500 MB |
| CPU burst | High | JS rendering + 22 custom DOM checks per scan |
| Persistence | None required | Stateless JWT, no database |

### Why Chromium is the bottleneck

Each `/scan` request spawns a headless Chrome process via Puppeteer. The scanner runs axe-core plus 22 custom WCAG checks including full DOM traversals (`querySelectorAll('*')`), computed style reads on every element, 50 simulated Tab keypresses, and hover interactions. This makes each scan CPU and memory intensive for its full 180 s window.

### Key deployment constraints

- **RAM floor:** ~350 MB minimum for a single scan; free tiers below 512 MB are not viable
- **Request duration:** 180 s scan timeout rules out serverless platforms with ≤30 s limits
- **Chromium binary:** Puppeteer 25.x bundles its own Chromium (~170 MB); needs `--no-sandbox` flag (already set in `axe_runner.js` ✓)
- **No sleep tolerance:** Cold starts are expensive — Chromium init adds ~8–10 s on first request

---

## Platform Comparison

| Platform | Free RAM | Free CPU | Sleeps? | Request timeout | Viable? |
|---|---|---|---|---|---|
| Oracle Cloud Always Free | **6 GB** | 1 OCPU | Never | No limit | ✅ Best |
| Google Cloud Run | Up to 4 GB (configurable) | Up to 4 vCPU | Yes (cold start) | 3600 s | ✅ Good |
| Render.com | 512 MB | 0.1 vCPU | Yes (15 min) | No limit | ⚠️ Marginal |
| Railway.app | 512 MB | Shared | No | No limit | ⚠️ Marginal |
| Fly.io | 256 MB | Shared | Yes | No limit | ❌ Insufficient |
| Heroku | — | — | — | — | ❌ No free tier |

---

## Platform Details

### ✅ Oracle Cloud Always Free — Recommended

**Resources:** 2 AMD VMs × (1 OCPU + 6 GB RAM) — or 4 ARM VMs sharing 24 GB RAM total. Free forever, no expiry.

**Why it fits:**
- 6 GB RAM handles 2–3 concurrent Chrome scans with headroom
- Never sleeps — no cold starts
- Full VM control: install exact Node, Go, and Chromium versions needed
- No request timeout limits

**Config changes needed:**
- Set `MAX_CONCURRENT_SCANS=2` (safe for 6 GB; default 5 would risk OOM)
- Install system dependencies: `nodejs`, `golang`, `chromium-browser`, `fonts-liberation`, `libnss3`
- Run Go server as a systemd service
- Put nginx in front for TLS termination

**Trade-off:** You manage the VM (OS updates, security patches, nginx config).

---

### ✅ Google Cloud Run — Zero-ops option

**Resources:** Configurable up to 4 GB RAM, 4 vCPU per instance. Free tier: 2M requests/month + 360k vCPU-seconds + 180k GB-seconds.

**Why it fits:**
- `--no-sandbox` already set in `axe_runner.js` ✓
- Request timeout configurable up to 3600 s ✓
- No infrastructure to manage

**Config changes needed:**
```
--memory 2Gi
--cpu 2
--concurrency 1
--timeout 300
--min-instances 0   # free tier; set to 1 to eliminate cold starts (costs money)
```

**Trade-offs:**
- Cold starts: ~8–10 s Chromium init after inactivity
- `min-instances=0` means first request after idle is slow
- Free quota runs out at moderate traffic

**Dockerfile tip:** Use a Chromium base image to avoid Puppeteer downloading its own binary:
```dockerfile
FROM ghcr.io/puppeteer/puppeteer:22
# then COPY and build your Go binary separately
```

---

### ⚠️ Render.com — Marginal

**Resources:** 512 MB RAM, 0.1 vCPU. Sleeps after 15 min inactivity.

**Why it's marginal:**
- 512 MB is barely enough for 1 scan (Chrome alone uses 300–400 MB)
- 0.1 vCPU makes scans very slow
- Cold start after sleep adds latency on top of Chromium init

**To make it work:**
- Set `MAX_CONCURRENT_SCANS=1`
- Replace `puppeteer` with `puppeteer-core` + system Chromium to reclaim ~170 MB:
  ```bash
  npm uninstall puppeteer
  npm install puppeteer-core
  ```
  Then update `axe_runner.js`:
  ```js
  const puppeteer = require('puppeteer-core');
  browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    ...
  });
  ```
- Add a health-check ping (e.g. UptimeRobot → `/api/v1/health` every 14 min) to prevent sleep

---

### ⚠️ Railway.app — Marginal

**Resources:** ~512 MB RAM, shared CPU. $5/month free credit (finite).

Same memory constraints as Render. No sleep is a plus. Free credit runs out — not truly free long-term.

---

### ❌ Fly.io — Not viable on free tier

**Resources:** 256 MB RAM per shared VM on free tier.

256 MB is insufficient for headless Chrome (minimum ~300 MB). Would require upgrading to a paid 512 MB machine.

---

## Recommended Configuration Changes

Regardless of platform, apply these before deploying:

### 1. Switch to puppeteer-core + system Chromium
Saves ~170 MB disk and lets the platform manage the browser binary.

```js
// axe_runner.js
const puppeteer = require('puppeteer-core');
browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
```

### 2. Cap concurrent scans for memory-constrained platforms
```bash
# Render / Railway (512 MB)
MAX_CONCURRENT_SCANS=1

# Oracle Cloud (6 GB)
MAX_CONCURRENT_SCANS=2

# Cloud Run (2 GB configured)
MAX_CONCURRENT_SCANS=1   # enforced by --concurrency 1
```

### 3. Required environment variables
```bash
JWT_SECRET=<32-char random string>   # required
WCAG_LEVEL=AA                        # default
SCAN_TIMEOUT_SECONDS=180             # default
ALLOW_PRIVATE_SCANS=false            # default
```

---

## Decision Summary

| If you want… | Choose |
|---|---|
| Best resources, free forever, full control | Oracle Cloud Always Free |
| Zero infrastructure management | Google Cloud Run |
| Simplest setup, accept degraded perf | Render.com (with workarounds above) |
