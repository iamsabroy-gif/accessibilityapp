# AccessScan CLI

**73 automated WCAG 2.1/2.2 checks mapped to A/AA/AAA success criteria, tuned for CI gating.**

A standalone accessibility scanner that runs entirely inside your CI runner — no hosted API, no auth, no account required. Ships a fully owned, proprietary detection engine with rules covering WCAG 2.1 and 2.2 success criteria.

## Quick Start

### Docker (recommended for CI)

```bash
docker run --rm ghcr.io/iamsabroy-gif/accessscan-cli:latest \
  https://example.com \
  --format json,sarif \
  --fail-on serious
```

### GitHub Action

```yaml
name: Accessibility
on: [pull_request]
jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run accessibility scan
        uses: ./.github/actions/accessscan
        with:
          url: 'https://your-staging-url.com'
          fail-on: serious
          format: json,sarif

      - name: Upload SARIF to GitHub
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: ./a11y-results/
```

### Local / npx

```bash
# From the repo root
cd packages/cli
npm install
node bin/a11yscan.js https://example.com --format json
```

## CLI Options

```
a11yscan <url...> [--urls-file urls.txt]
  --wcag-level A|AA          (default AA)
  --fail-on <level>          (default serious)
  --warn-on <level>          (default moderate)
  --format json,sarif,junit  (default json)
  --output-dir ./results     (default ./a11y-results)
  --timeout 180              (default 180 seconds)
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | No violations at or above `--fail-on` |
| `1` | Threshold breached — build should fail |
| `2` | Scan error (page unreachable, browser crash) |

### Severity Levels

`--fail-on` is inclusive-upward: `serious` fails on **serious AND critical**.

| Level | Severity |
|-------|----------|
| `critical` | Highest — completely blocks user access |
| `serious` | Major — significantly impairs access |
| `moderate` | Moderate — causes difficulty but workarounds exist |
| `minor` | Minor — inconvenience, not a blocker |
| `none` | Report-only mode — never fail |

### Config File

Teams can use an `.accessscan.yml` config file instead of CLI flags:

```yaml
# .accessscan.yml
wcag-level: AA
fail-on: serious
warn-on: moderate
format: json,sarif
output-dir: ./a11y-results
timeout: 180
urls:
  - https://your-app.com
  - https://your-app.com/login
```

## Output Formats

### JSON
Raw violation data with threshold annotations (failures, warnings, info). Includes passes and incomplete results.

### SARIF 2.1.0
GitHub Code Scanning native format. Upload to GitHub for inline PR annotations — violations appear directly in the code diff. **This is the highest-leverage output format.**

### JUnit XML
Compatible with CI dashboards that parse JUnit (GitLab, Jenkins, CircleCI). One `<testsuite>` per URL, one `<testcase>` per rule.

## Architecture

The CLI runs the native accessibility engine **entirely locally** — it does not call any hosted API. This is deliberate:

- No auth or API keys needed
- No rate-limit collisions between CI runners
- No network dependency on a hosted service
- Deterministic results (same engine version = same results)

The engine uses Puppeteer (headless Chrome) to load pages and evaluates 73 hand-rolled accessibility rules against the DOM. Rules are mapped to WCAG success criteria via a generated `wcag_map.json` (source of truth: `internal/models/wcag_mapping.go`).

## WCAG Level Filtering

`--wcag-level` works as a post-hoc filter: the engine runs all rules, then drops violations whose WCAG success criteria are entirely above the requested level. This is the standard approach (axe-core works the same way via tag filtering) and is honest — results only show levels the filter actually checked.
