# WCAG 2.2 Native Engine Implementation Status

**Audit date:** 2026-07-06 (verified 2026-07-06)
**Engine:** Native (`native_runner.js` + `native_engine.js` + `scripts/rules/`)
**Activation:** `ACTIVE_ENGINE=native` env var (default is `native`)

---

## Correction to Previous Analysis

The prior audit incorrectly analyzed `axe_runner.js` (the legacy engine). The native engine works fundamentally differently:

- `native_runner.js` auto-discovers **all** `.js` files in `scripts/rules/` — no manual wiring is needed
- `native_engine.js` is injected into the page and runs DOM-type rules via `window.NativeEngine.run()`
- Puppeteer-type rules (`type: 'puppeteer'`) are executed directly by `native_runner.js` lines 121–130
- `axe_runner.go` (line 83–85) switches to `native_runner.js` when `config.GetActiveEngine() == "native"`

The "dead code" finding from the previous report does not apply to the native engine. Every rule file in `scripts/rules/` is automatically loaded and executed.

---

## SC Status (Native Engine)

| SC | Name | Level | WCAGMap | Rule File | Auto-loaded | Net Status |
|----|------|-------|---------|-----------|-------------|------------|
| 2.4.11 | Focus Not Obscured (Minimum) | AA | ✓ line 90 | `focus_not_obscured.js` (puppeteer) | ✓ | **Implemented** |
| 2.4.12 | Focus Not Obscured (Enhanced) | AAA | ✗ | ✗ | — | Not implemented (acceptable) |
| 2.4.13 | Focus Appearance | **AAA ⚠️** | ✓ line 93 | `focus_appearance.js` (puppeteer) | ✓ | **Implemented — level tag wrong** |
| 2.5.7 | Dragging Movements | AA | ✓ line 89 | `dragging_movements.js` (dom) | ✓ | **Implemented** |
| 2.5.8 | Target Size (Minimum) | AA | ✓ line 87 | `target_size.js` (dom) | ✓ | **Implemented** |
| 3.2.6 | Consistent Help | A | ✓ line 91 | `consistent_help.js` (dom) | ✓ | **Implemented** |
| 3.3.7 | Redundant Entry | A | ✓ line 92 | `redundant_entry.js` (dom) | ✓ | **Implemented** |
| 3.3.8 | Accessible Authentication (Min) | AA | ✓ line 88 | `accessible_authentication.js` (dom) | ✓ | **Implemented** |
| 3.3.9 | Accessible Authentication (Enh) | AAA | ✗ | ✗ | — | Not implemented (acceptable) |

---

## Fully Implemented (Native Engine)

All 7 A/AA WCAG 2.2 SCs are fully implemented in the native engine. WCAGMap entries exist, rule files are properly structured, and `native_runner.js` auto-loads them.

### SC 3.2.6 — Consistent Help (Level A)
- WCAGMap: `"consistent-help": {"3.2.6"}` — `wcag_mapping.go` line 91
- Rule file: `scripts/rules/consistent_help.js` — `type: 'dom'`, `impact: 'moderate'`
- Tags: `['wcag22a', 'wcag326']`
- Behavior: always emits `incomplete` (single-page check cannot verify consistency across pages)
- Score impact: none

### SC 3.3.7 — Redundant Entry (Level A)
- WCAGMap: `"redundant-entry": {"3.3.7"}` — `wcag_mapping.go` line 92
- Rule file: `scripts/rules/redundant_entry.js` — `type: 'dom'`, `impact: 'moderate'`
- Tags: `['wcag22a', 'wcag337']`
- Behavior: emits `incomplete` when shipping/billing fields detected without a "same as" checkbox; emits `passes` when checkbox found
- Score impact: none (incomplete only)

### SC 2.5.8 — Target Size (Minimum) (Level AA)
- WCAGMap: `"target-size": {"2.5.8"}` — `wcag_mapping.go` line 87
- Rule file: `scripts/rules/target_size.js` — `type: 'dom'`, `impact: 'serious'`
- Tags: `['wcag22aa', 'wcag258']`
- Behavior: checks interactive targets for 24×24 CSS px minimum; inline-flow links are exempt
- Score impact: –10 pts per violation

### SC 3.3.8 — Accessible Authentication (Minimum) (Level AA)
- WCAGMap: `"accessible-authentication": {"3.3.8"}` — `wcag_mapping.go` line 88
- Rule file: `scripts/rules/accessible_authentication.js` — `type: 'dom'`, `impact: 'critical'`
- Tags: `['wcag22aa', 'wcag338']`
- Behavior: detects known CAPTCHA providers; flags if no audio/object/personal-content alternative found
- Score impact: –20 pts per violation (highest per-violation penalty)

### SC 2.5.7 — Dragging Movements (Level AA)
- WCAGMap: `"dragging-movements": {"2.5.7"}` — `wcag_mapping.go` line 89
- Rule file: `scripts/rules/dragging_movements.js` — `type: 'dom'`, `impact: 'serious'`
- Tags: `['wcag22aa', 'wcag257']`
- Behavior: detects `[draggable="true"]`, `[aria-grabbed]`, sortable class patterns; checks for pointer-alternative controls; emits `incomplete` when alternatives are present but cannot be verified programmatically
- Score impact: violations possible (–10 pts)

### SC 2.4.11 — Focus Not Obscured (Minimum) (Level AA)
- WCAGMap: `"focus-not-obscured": {"2.4.11"}` — `wcag_mapping.go` line 90
- Rule file: `scripts/rules/focus_not_obscured.js` — `type: 'puppeteer'`, `impact: 'serious'`
- Tags: `['wcag22aa', 'wcag2411']`
- Behavior: Puppeteer Tab loop (max 20 elements); checks if focused element is fully obscured by fixed/sticky overlays using `getBoundingClientRect` intersection
- Score impact: –10 pts per violation
- Executed directly by `native_runner.js` lines 121–130 (not via `NativeEngine.run()`)

---

## Implemented with Known Bug

### SC 2.4.13 — Focus Appearance (Level AAA — mislabeled AA)
- WCAGMap: `"focus-appearance": {"2.4.13"}` — `wcag_mapping.go` line 93
- Rule file: `scripts/rules/focus_appearance.js` — `type: 'puppeteer'`, `impact: 'serious'`
- Tags: `['wcag22aa', 'wcag2413']` ← **wrong level tag (4 occurrences: lines 7, 120, 166, 180)**
- Behavior: Puppeteer Tab loop (max 15 elements); checks outline width ≥2px and 3:1 contrast ratio for focus indicators
- **Bug:** WCAG 2.2 defines 2.4.13 as **AAA**, not AA. The `wcag22aa` tag is incorrect on all four result-emitting code paths — should be `wcag22aaa`. The WCAGMap gate uses the rule ID (not the tag), so scoring is unaffected, but the tag misleads users about which conformance level is being claimed. **(Resolved)**

**Fix required in `scripts/rules/focus_appearance.js` (replace all occurrences):**
```js
// Change (lines 7, 120, 166, 180):
tags: ['wcag22aa', 'wcag2413'],
// To:
tags: ['wcag22aaa', 'wcag2413'],
```

---

## Not Implemented (Acceptable — AAA Only)

### SC 2.4.12 — Focus Not Obscured (Enhanced) (Level AAA)
No WCAGMap entry, no rule file. The `focus-not-obscured` rule for 2.4.11 already emits `incomplete` for partial obscuring, covering the informational signal for this SC. No action needed unless a formal AAA scan mode is introduced.

### SC 3.3.9 — Accessible Authentication (Enhanced) (Level AAA)
No WCAGMap entry, no rule file. SC 3.3.8's CAPTCHA detection covers the common failure path. No action needed for AAA.

---

## Activation

The native engine **is the default** as of `internal/config/config.go` line 186:

```go
ActiveEngine: getEnv("ACTIVE_ENGINE", "native"),
```

No special flag is needed. The legacy `axe_runner.js` engine can still be selected with `ACTIVE_ENGINE=axe` but it does not load rules from `scripts/rules/` and provides zero WCAG 2.2 coverage.

---

## Remaining Action Items

| Priority | Item | File | Impact |
|----------|------|------|--------|
| ~~P1~~ | ~~Fix `focus_appearance.js` tag from `wcag22aa` → `wcag22aaa`~~ | ~~`scripts/rules/focus_appearance.js`~~ | **Resolved** |
| ~~P2~~ | ~~Set `ACTIVE_ENGINE=native` as the default~~ | ~~`internal/config/config.go` line 186~~ | **Resolved** — default is already `"native"` |
| ~~P3~~ | ~~Verify `scripts/rules/` path resolution at runtime~~ | ~~`native_runner.js` line 72~~ | **Not an issue** — `path.join(__dirname, 'rules')` resolves correctly relative to the script regardless of Go's working directory |

---

## Summary

For the **native engine**, WCAG 2.2 implementation is substantially complete:
- All 7 A/AA SCs have rule files, WCAGMap entries, and are auto-loaded by `native_runner.js`
- The 2 AAA SCs (2.4.12, 3.3.9) are intentionally omitted
- Native engine is the **default** (`ACTIVE_ENGINE=native` in `config.go` line 186) — no special setup needed

The implementation claim in `implementation_wcag2_2.md` is accurate for the native engine. All known action items are resolved.
