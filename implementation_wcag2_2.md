# WCAG 2.2 A/AA Missing Criteria — Implementation Plan

*Project: webaccessibility (Go + Puppeteer + axe-core + native rule engine)*
*Date: 2026-07-06*
*IDE: Antigravity*

---

## 1. Overview

Seven WCAG 2.2 A/AA success criteria currently have zero automated coverage. This document provides complete, copy-paste-ready rule implementations for all seven.

| SC | Name | Level | Difficulty | Rule ID | File | Type |
|---|---|---|---|---|---|---|
| 2.5.8 | Target Size (Minimum) | AA | Easy | `target-size` | `target_size.js` | dom |
| 3.3.8 | Accessible Authentication (Minimum) | AA | Medium | `accessible-authentication` | `accessible_authentication.js` | dom |
| 2.5.7 | Dragging Movements | AA | Medium | `dragging-movements` | `dragging_movements.js` | dom |
| 2.4.11 | Focus Not Obscured (Minimum) | AA | Medium | `focus-not-obscured` | `focus_not_obscured.js` | puppeteer |
| 3.2.6 | Consistent Help | A | Hard* | `consistent-help` | `consistent_help.js` | dom |
| 3.3.7 | Redundant Entry | A | Hard* | `redundant-entry` | `redundant_entry.js` | dom |
| 2.4.13 | Focus Appearance | AA | Hard | `focus-appearance` | `focus_appearance.js` | puppeteer |

*Hard only because they always emit `incomplete` — the per-page detection logic itself is straightforward.*

**Scoring note:** `incomplete` items do not enter the penalty scorer or AudioEye weighted rate. Rules 3.2.6 and 3.3.7 will never affect the numeric score — their value is the `incomplete` signal in the report, not grade impact.

---

## 2. SC 2.5.8 — Target Size (Minimum)

**SC reference:** 2.5.8, Level AA
**Understanding link:** https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

### Failure scenario examples

- An icon-only button (`<button>` containing only a 16×16px SVG icon) renders at 20×20 CSS pixels.
- A tag/chip component in a list renders at 18×18px.
- Small radio button labels without adequate padding render below 24px in both dimensions.

### Detection approach

DOM-only. Call `getBoundingClientRect()` on every interactive element. Flag width < 24 OR height < 24 as a `violation`. Apply the **inline text exception**: an `<a>` or `[role="link"]` element whose immediate parent is a paragraph-flow element (`p`, `li`, `td`, `th`, `dd`, `dt`) is exempt — emit `incomplete` instead. The spacing exception (adjacent target offset ≥ 24px) is too expensive to compute in DOM context; a comment in the rule directs reviewers to check manually when the element is borderline.

### Limitations

- Cannot automatically verify the spacing exception (requires knowing exact inter-target distances).
- `getBoundingClientRect()` returns rendered size; CSS transforms may cause mismatch — not handled.
- Hidden elements (off-screen, `display:none`) return 0×0 and are skipped.

### Rule file — `scripts/rules/target_size.js`

```js
module.exports = {
  id: 'target-size',
  type: 'dom',
  description: 'Interactive targets must be at least 24×24 CSS pixels.',
  help: 'Ensure pointer targets are at least 24×24 CSS pixels, or have adequate offset spacing from adjacent targets.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html',
  tags: ['wcag22aa', 'wcag258'],
  impact: 'serious',

  evaluate: function(document) {
    var violations = [];
    var passes = [];
    var incomplete = [];

    // Parent tags that indicate an inline text flow — links inside these are exempt
    var INLINE_CONTAINERS = ['p', 'li', 'td', 'th', 'dd', 'dt', 'blockquote', 'caption'];

    var selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([type="hidden"]):not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[role="button"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="menuitem"]',
      '[role="menuitemcheckbox"]',
      '[role="menuitemradio"]',
      '[role="option"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="tab"]'
    ].join(', ');

    var elements = Array.from(document.querySelectorAll(selector));

    elements.forEach(function(el) {
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      var rect = el.getBoundingClientRect();
      // Skip zero-size elements (off-screen, hidden via other means)
      if (rect.width === 0 && rect.height === 0) return;

      var w = rect.width;
      var h = rect.height;
      var tag = el.tagName.toLowerCase();
      var role = el.getAttribute('role') || '';

      // Inline text exception: <a> or role="link" inside flowing text
      var isInlineTextLink = false;
      if (tag === 'a' || role === 'link') {
        var parent = el.parentElement;
        if (parent) {
          var parentTag = parent.tagName.toLowerCase();
          if (INLINE_CONTAINERS.indexOf(parentTag) !== -1) {
            isInlineTextLink = true;
          }
        }
      }

      var htmlSnippet = el.outerHTML.substring(0, 120);

      if (isInlineTextLink) {
        if (w < 24 || h < 24) {
          incomplete.push({
            html: htmlSnippet,
            target: [tag],
            failureSummary: 'Inline text link (' + Math.round(w) + '\xd7' + Math.round(h) + 'px) is exempt from the 24\xd724 requirement under the inline exception. Verify spacing to adjacent links is ≥24px if target is below threshold.'
          });
        } else {
          passes.push({ html: htmlSnippet, target: [tag] });
        }
        return;
      }

      if (w >= 24 && h >= 24) {
        passes.push({ html: htmlSnippet, target: [tag] });
      } else {
        violations.push({
          html: htmlSnippet,
          target: [tag],
          failureSummary: 'Target size is ' + Math.round(w) + '\xd7' + Math.round(h) + 'px — minimum is 24\xd724 CSS px. If the element has ≥24px of offset spacing to all adjacent targets, it is exempt (spacing exception — verify manually).'
        });
      }
    });

    return { violations: violations, passes: passes, incomplete: incomplete };
  }
};
```

### WCAGMap entry

```go
"target-size": {"2.5.8"},
```

Add after the Phase 3 block in `internal/models/wcag_mapping.go`.

### Test fixtures

**Failing markup:** `<button style="width:18px;height:18px;padding:0">X</button>` — renders 18×18px, no inline-flow parent.

**Passing markup:** `<button style="min-width:44px;min-height:44px">Save</button>` — renders ≥ 24×24px.

**Inline exception (incomplete):** `<p>Read our <a href="/terms">terms</a></p>` — link inside `<p>`, emits incomplete regardless of size.

### Effort estimate

**2–3 hours.** Pure DOM, clear numeric threshold. No Puppeteer required. Highest ROI of all seven.

---

## 3. SC 3.3.8 — Accessible Authentication (Minimum)

**SC reference:** 3.3.8, Level AA
**Understanding link:** https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html

### Failure scenario examples

- Login page loads reCAPTCHA v2 (`api2/anchor` iframe from `google.com/recaptcha`).
- Registration form includes an hCAPTCHA widget (`js.hcaptcha.com/1/api.js`) with no audio alternative.
- Checkout step requires a Cloudflare Turnstile challenge with no bypass for authenticated users.

### Detection approach

DOM-only. Two detection layers:

1. **Script src scan:** Check every `<script src>` for known CAPTCHA provider domain strings. Emit `violation` on match — a CAPTCHA script is almost certainly rendered as a cognitive test.
2. **Iframe src scan:** Check every `<iframe src>` against the same domain list.
3. **Image heuristic:** Inside `<form>` elements, check `<img>` `alt` and `src` for the string "captcha". Emit `violation`.
4. **Class/id heuristic:** Elements with `captcha` in class or id — emit `incomplete` (may be a wrapper div, not the challenge itself).

### Limitations

- Does not verify whether an audio alternative (`<a>` with "audio" text, an audio CAPTCHA button) exists alongside the visual CAPTCHA. Emit `violation` with a message directing the reviewer to verify alternatives.
- Server-side authentication challenges (OTP codes, security questions) are invisible to the DOM scanner.
- Cannot detect first-party CAPTCHA implementations without known signatures.

### Rule file — `scripts/rules/accessible_authentication.js`

```js
module.exports = {
  id: 'accessible-authentication',
  type: 'dom',
  description: 'Authentication must not require a cognitive function test without an accessible alternative.',
  help: 'Ensure CAPTCHAs provide an audio alternative, object recognition alternative, or personal content alternative.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html',
  tags: ['wcag22aa', 'wcag338'],
  impact: 'critical',

  evaluate: function(document) {
    var violations = [];
    var passes = [];
    var incomplete = [];

    // Known CAPTCHA provider domains — extend this list as new providers emerge
    var CAPTCHA_DOMAINS = [
      'recaptcha.net',
      'google.com/recaptcha',
      'gstatic.com/recaptcha',
      'js.hcaptcha.com',
      'hcaptcha.com',
      'challenges.cloudflare.com',
      'turnstile.cloudflare.com',
      'funcaptcha.com',
      'arkoselabs.com',
      'captcha-delivery.com',
      'friendly-captcha.com',
      'mtcaptcha.com',
      'procaptcha.com'
    ];

    function matchesCaptchaDomain(src) {
      if (!src) return false;
      var lower = src.toLowerCase();
      for (var i = 0; i < CAPTCHA_DOMAINS.length; i++) {
        if (lower.indexOf(CAPTCHA_DOMAINS[i]) !== -1) return true;
      }
      return false;
    }

    var captchaFound = false;
    var captchaSource = '';
    var captchaHtml = '';

    // Layer 1: script src
    var scripts = Array.from(document.querySelectorAll('script[src]'));
    for (var si = 0; si < scripts.length; si++) {
      var scriptSrc = scripts[si].getAttribute('src') || '';
      if (matchesCaptchaDomain(scriptSrc)) {
        captchaFound = true;
        captchaSource = scriptSrc.substring(0, 80);
        captchaHtml = '<script src="' + captchaSource + '">';
        break;
      }
    }

    // Layer 2: iframe src
    if (!captchaFound) {
      var iframes = Array.from(document.querySelectorAll('iframe[src]'));
      for (var ii = 0; ii < iframes.length; ii++) {
        var iframeSrc = iframes[ii].getAttribute('src') || '';
        if (matchesCaptchaDomain(iframeSrc)) {
          captchaFound = true;
          captchaSource = iframeSrc.substring(0, 80);
          captchaHtml = iframes[ii].outerHTML.substring(0, 120);
          break;
        }
      }
    }

    // Layer 3: <img> inside <form> with captcha in alt or src
    if (!captchaFound) {
      var forms = Array.from(document.querySelectorAll('form'));
      for (var fi = 0; fi < forms.length; fi++) {
        var imgs = Array.from(forms[fi].querySelectorAll('img'));
        for (var imi = 0; imi < imgs.length; imi++) {
          var alt = (imgs[imi].getAttribute('alt') || '').toLowerCase();
          var imgSrc = (imgs[imi].getAttribute('src') || '').toLowerCase();
          var cls = (imgs[imi].className && typeof imgs[imi].className === 'string'
            ? imgs[imi].className : '').toLowerCase();
          if (alt.indexOf('captcha') !== -1 || imgSrc.indexOf('captcha') !== -1 ||
              cls.indexOf('captcha') !== -1) {
            captchaFound = true;
            captchaHtml = imgs[imi].outerHTML.substring(0, 120);
            captchaSource = 'captcha image inside form';
            break;
          }
        }
        if (captchaFound) break;
      }
    }

    if (captchaFound) {
      violations.push({
        html: captchaHtml,
        target: ['form'],
        failureSummary: 'CAPTCHA or cognitive function test detected (' + captchaSource + '). Verify an accessible alternative exists: (1) audio CAPTCHA, (2) object recognition test, (3) personal-content test, or (4) an authentication method that does not use CAPTCHAs at all.'
      });
      return { violations: violations, passes: passes, incomplete: incomplete };
    }

    // Layer 4: class/id heuristic — less certain, emit incomplete
    var captchaWidgets = Array.from(document.querySelectorAll(
      '[class*="captcha"], [id*="captcha"], [data-sitekey], [data-widget-type="captcha"]'
    ));
    if (captchaWidgets.length > 0) {
      incomplete.push({
        html: captchaWidgets[0].outerHTML.substring(0, 120),
        target: [captchaWidgets[0].tagName.toLowerCase()],
        failureSummary: 'Element with CAPTCHA-related class, id, or data-sitekey attribute detected. Manually verify whether a cognitive function test is required without an accessible alternative.'
      });
      return { violations: violations, passes: passes, incomplete: incomplete };
    }

    // Check whether any authentication form exists at all; if not, SC is not applicable
    var authForms = Array.from(document.querySelectorAll('form')).filter(function(f) {
      var inputs = Array.from(f.querySelectorAll('input'));
      return inputs.some(function(inp) {
        return inp.getAttribute('type') === 'password';
      });
    });

    if (authForms.length > 0) {
      passes.push({
        html: authForms[0].outerHTML.substring(0, 120),
        target: ['form']
      });
    } else {
      passes.push({ html: '<body>', target: ['body'] });
    }

    return { violations: violations, passes: passes, incomplete: incomplete };
  }
};
```

### WCAGMap entry

```go
"accessible-authentication": {"3.3.8"},
```

### Test fixtures

**Failing markup:** Any page loading `<script src="https://www.google.com/recaptcha/api.js">` or an hCaptcha iframe inside or adjacent to a `<form>`.

**Passing markup:** A `<form>` with `<input type="password">` and no CAPTCHA script or iframe — login form with no CAPTCHA, or one using WebAuthn/passkeys.

**Incomplete markup:** `<div id="captcha-container" class="my-captcha-widget">...</div>` — CAPTCHA class present but no known third-party script.

### Effort estimate

**2–3 hours.** Domain list is the main maintenance surface. The CAPTCHA_DOMAINS array should be reviewed quarterly.

---

## 4. SC 2.5.7 — Dragging Movements

**SC reference:** 2.5.7, Level AA
**Understanding link:** https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html

### Failure scenario examples

- A Kanban board where cards can only be repositioned by drag-and-drop, with no "Move to column" button.
- A sortable list (`draggable="true"` items) with no keyboard-accessible reorder controls.
- A slider implemented with `draggable` div elements that lacks `<input type="range">` or arrow-key support.

### Detection approach

DOM-only heuristic. Enumerate elements with `draggable="true"`, common sortable framework classes (`sortable`, `draggable`, `drag-handle`, `drag-item`), and `aria-grabbed` attributes. For each, look for evidence of a single-pointer alternative: sibling or parent `<button>` / `[role="button"]` elements whose accessible name contains move/up/down/sort/reorder keywords. Always emit `incomplete` — cannot prove an alternative does or does not exist without understanding application logic. Emit `violation` only when an ARIA drag pattern (`aria-grabbed`) is present with no evident keyboard alternative.

### Limitations

- JavaScript drag libraries (react-dnd, Sortable.js, dnd-kit) may not set `draggable="true"` on the element itself — the rule will miss these unless class patterns match.
- Cannot test whether the single-pointer alternative actually works.

### Rule file — `scripts/rules/dragging_movements.js`

```js
module.exports = {
  id: 'dragging-movements',
  type: 'dom',
  description: 'All drag-and-drop functionality must have a single-pointer alternative that does not require dragging.',
  help: 'Provide alternatives to drag operations such as click-to-select + click-to-drop, sort buttons, or cut/paste equivalents.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html',
  tags: ['wcag22aa', 'wcag257'],
  impact: 'serious',

  evaluate: function(document) {
    var violations = [];
    var passes = [];
    var incomplete = [];

    // Selector for explicitly draggable elements
    var draggableSelector = [
      '[draggable="true"]',
      '[aria-grabbed]',
      '[class*="sortable-item"]',
      '[class*="draggable-item"]',
      '[class*="drag-item"]',
      '[class*="drag-handle"]',
      '[data-draggable="true"]',
      '[data-drag-id]'
    ].join(', ');

    var draggables = Array.from(document.querySelectorAll(draggableSelector));

    if (draggables.length === 0) {
      passes.push({ html: '<body>', target: ['body'] });
      return { violations: violations, passes: passes, incomplete: incomplete };
    }

    // Keywords that suggest a single-pointer reorder alternative
    var REORDER_KEYWORDS = ['up', 'down', 'move', 'sort', 'reorder', 'higher', 'lower', 'before', 'after'];

    function hasReorderButton(el) {
      // Check siblings and parent for reorder-suggesting buttons
      var searchRoot = el.parentElement || el;
      var buttons = Array.from(searchRoot.querySelectorAll('button, [role="button"], [role="menuitem"]'));
      return buttons.some(function(btn) {
        var label = [
          btn.getAttribute('aria-label') || '',
          btn.getAttribute('title') || '',
          btn.textContent || ''
        ].join(' ').toLowerCase();
        return REORDER_KEYWORDS.some(function(kw) { return label.indexOf(kw) !== -1; });
      });
    }

    // Deduplicate by outerHTML to avoid reporting the same widget multiple times
    var seen = {};
    draggables.forEach(function(el) {
      var key = el.outerHTML.substring(0, 60);
      if (seen[key]) return;
      seen[key] = true;

      var html = el.outerHTML.substring(0, 120);
      var tag = el.tagName.toLowerCase();
      var hasAriaGrab = el.hasAttribute('aria-grabbed');

      if (hasReorderButton(el)) {
        // Evidence of a single-pointer alternative exists
        passes.push({ html: html, target: [tag] });
      } else if (hasAriaGrab) {
        // ARIA drag pattern without evident alternative — more confident incomplete
        incomplete.push({
          html: html,
          target: [tag],
          failureSummary: 'Element uses aria-grabbed (ARIA drag pattern) without an evident single-pointer alternative. Verify that a keyboard-operable move mechanism (e.g., cut/paste buttons, move-up/move-down buttons) is available.'
        });
      } else {
        // draggable="true" or framework class — emit incomplete
        incomplete.push({
          html: html,
          target: [tag],
          failureSummary: 'Draggable element detected. Cannot automatically verify a single-pointer alternative (e.g., button controls for reordering) exists. Manual check required per WCAG 2.5.7.'
        });
      }
    });

    return { violations: violations, passes: passes, incomplete: incomplete };
  }
};
```

### WCAGMap entry

```go
"dragging-movements": {"2.5.7"},
```

### Test fixtures

**Incomplete (draggable, no alternative found):**
```html
<ul>
  <li draggable="true">Item A</li>
  <li draggable="true">Item B</li>
</ul>
```

**Passing (reorder buttons present):**
```html
<li draggable="true">
  Item A
  <button aria-label="Move up">↑</button>
  <button aria-label="Move down">↓</button>
</li>
```

### Effort estimate

**3–4 hours.** The framework-class list should be extended as the codebase encounters new drag libraries. Since all results are `incomplete`, there is no scoring impact — this is a report signal only.

---

## 5. SC 2.4.11 — Focus Not Obscured (Minimum)

**SC reference:** 2.4.11, Level AA
**Understanding link:** https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html

### Failure scenario examples

- A sticky header (`position: fixed; z-index: 100; height: 60px`) covers the top of the page. When Tab moves focus to the first link, the focused link sits behind the header and is completely hidden.
- A cookie consent banner (`position: fixed; bottom: 0; height: 80px`) hides the last focusable element on the page.
- A floating chat widget (`position: fixed; right: 20px; bottom: 20px`) covers a "Submit" button when it receives focus.

### Detection approach

Puppeteer. Tab through up to 20 focusable elements. After each Tab press, evaluate in browser context:

1. Get `getBoundingClientRect()` of `document.activeElement`.
2. Query all `position: fixed` and `position: sticky` elements with a computed `z-index > 0` that are not ancestors of the focused element.
3. Check if any overlay **entirely encloses** the focused element's bounding rect — emit `violation`.
4. Check if any overlay **partially intersects** — emit `incomplete` (partial obscuring is not a violation of 2.4.11, but is a violation of the stricter 2.4.12 AAA).

### Limitations

- Limited to 20 Tab presses; large pages will not be fully sampled.
- Sticky headers that only activate on scroll are not detected unless the page is scrolled.
- `z-index: auto` elements that stack above due to stacking context are not detected.

### Rule file — `scripts/rules/focus_not_obscured.js`

```js
module.exports = {
  id: 'focus-not-obscured',
  type: 'puppeteer',
  description: 'When a UI component receives keyboard focus, it must not be entirely hidden by sticky or fixed-position author-created content.',
  help: 'Ensure focused components are not fully obscured by sticky headers, cookie banners, or other fixed overlays.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html',
  tags: ['wcag22aa', 'wcag2411'],
  impact: 'serious',

  evaluate: async function(page) {
    var violations = [];
    var passes = [];
    var incomplete = [];

    var MAX_TABS = 20;

    await page.focus('body');

    for (var i = 0; i < MAX_TABS; i++) {
      await page.keyboard.press('Tab');

      var result = await page.evaluate(function() {
        var el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) {
          return null;
        }

        var elRect = el.getBoundingClientRect();
        if (elRect.width === 0 || elRect.height === 0) return { skip: true };

        // Collect fixed/sticky overlays with positive z-index
        var allEls = Array.from(document.querySelectorAll('*'));
        var overlays = allEls.filter(function(candidate) {
          if (candidate === el) return false;
          if (candidate.contains(el)) return false; // ancestor
          if (el.contains(candidate)) return false;  // descendant
          var s = window.getComputedStyle(candidate);
          if (s.position !== 'fixed' && s.position !== 'sticky') return false;
          var z = parseInt(s.zIndex, 10);
          if (isNaN(z) || z <= 0) return false;
          var r = candidate.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          return true;
        });

        var fullyObscured = overlays.some(function(ov) {
          var r = ov.getBoundingClientRect();
          return r.left <= elRect.left &&
                 r.right >= elRect.right &&
                 r.top <= elRect.top &&
                 r.bottom >= elRect.bottom;
        });

        var partiallyObscured = !fullyObscured && overlays.some(function(ov) {
          var r = ov.getBoundingClientRect();
          // Rectangles overlap when no axis is fully separated
          return !(r.right <= elRect.left ||
                   r.left >= elRect.right ||
                   r.bottom <= elRect.top ||
                   r.top >= elRect.bottom);
        });

        return {
          html: el.outerHTML.substring(0, 120),
          tag: el.tagName.toLowerCase(),
          fullyObscured: fullyObscured,
          partiallyObscured: partiallyObscured,
          skip: false
        };
      });

      if (!result || result.skip) continue;

      if (result.fullyObscured) {
        violations.push({
          id: 'focus-not-obscured',
          impact: 'serious',
          description: 'Focused element is entirely hidden by a fixed or sticky overlay.',
          help: 'Ensure the focused component is not fully covered by position:fixed or position:sticky content.',
          helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html',
          tags: ['wcag22aa', 'wcag2411'],
          nodes: [{
            html: result.html,
            target: [result.tag],
            failureSummary: 'Element is completely hidden by a position:fixed or position:sticky element with z-index > 0 when it receives keyboard focus.'
          }]
        });
      } else if (result.partiallyObscured) {
        incomplete.push({
          id: 'focus-not-obscured',
          description: 'Focused element is partially covered by a fixed/sticky overlay. WCAG 2.4.11 requires only that it is not entirely hidden — partial obscuring is a WCAG 2.4.12 (AAA) concern.',
          nodeCount: 1
        });
      } else {
        passes.push({
          id: 'focus-not-obscured',
          description: 'Focused element is not obscured by any fixed or sticky overlay.',
          nodeCount: 1
        });
      }
    }

    return { violations: violations, passes: passes, incomplete: incomplete };
  }
};
```

### WCAGMap entry

```go
"focus-not-obscured": {"2.4.11"},
```

### Test fixtures

**Failing markup:**
```html
<header style="position:fixed;top:0;left:0;width:100%;height:60px;z-index:100;background:#fff">
  Site Header
</header>
<main>
  <a href="/page1">First link</a> <!-- entirely behind the header when focused -->
</main>
```

**Passing markup:** Same page but with `scroll-margin-top: 70px` on focusable elements, or the header being `position: static`.

### Effort estimate

**4–6 hours.** The overlay detection logic (`querySelectorAll('*')` then filter) is O(n) per Tab press and may be slow on very large pages. Consider capping the overlay search to the first 500 elements if performance is a concern.

---

## 6. SC 3.2.6 — Consistent Help

**SC reference:** 3.2.6, Level A
**Understanding link:** https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html

### Failure scenario examples

- A "Contact Us" link appears in the footer on the homepage but in the header on subpages — different relative order.
- A live chat widget appears on the checkout page but not on the product page.
- A phone number is present only in the privacy policy and not consistently placed.

### Detection approach

DOM-only. Detect presence of help mechanisms on the current page: `tel:` links, `mailto:` links, elements with CAPTCHA-adjacent ARIA labels, links with help/support/contact/faq in href or text, chat widget class patterns (Intercom, Zendesk, Drift, etc.). **Always emit `incomplete`** — single-page scan cannot verify consistency across pages. If no help mechanism is found, SC is not applicable → emit `pass`.

### Limitations

- Multi-page consistency is fundamentally unverifiable in a single-page scan.
- Cannot determine "relative order" of help mechanisms without comparing multiple pages.
- This rule will never affect the penalty score because all detections are `incomplete`.

### Rule file — `scripts/rules/consistent_help.js`

```js
module.exports = {
  id: 'consistent-help',
  type: 'dom',
  description: 'If the page contains human contact, self-help, or automated contact mechanisms, they must appear in the same relative order across pages.',
  help: 'Ensure help mechanisms (phone, email, chat, FAQ) are positioned consistently across all pages of the site.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html',
  tags: ['wcag22a', 'wcag326'],
  impact: 'moderate',

  evaluate: function(document) {
    var violations = [];
    var passes = [];
    var incomplete = [];

    var found = [];

    // 1. Phone links (tel:)
    var telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
    telLinks.forEach(function(el) {
      found.push({ type: 'phone link', html: el.outerHTML.substring(0, 120), target: ['a'] });
    });

    // 2. Email links (mailto:)
    var emailLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
    emailLinks.forEach(function(el) {
      found.push({ type: 'email link', html: el.outerHTML.substring(0, 120), target: ['a'] });
    });

    // 3. Help/support/contact/FAQ page links
    var helpLinkKeywords = ['faq', 'help', 'support', 'contact', 'helpdesk', 'help-center', 'helpcenter'];
    var allLinks = Array.from(document.querySelectorAll('a[href]'));
    allLinks.forEach(function(el) {
      var href = (el.getAttribute('href') || '').toLowerCase();
      var text = (el.textContent || '').trim().toLowerCase();
      var matched = helpLinkKeywords.some(function(kw) {
        return href.indexOf(kw) !== -1 || text === kw || text.indexOf('contact us') !== -1;
      });
      if (matched) {
        found.push({ type: 'help/contact link', html: el.outerHTML.substring(0, 120), target: ['a'] });
      }
    });

    // 4. Live chat widgets — common third-party class/id patterns
    var chatSelectors = [
      '[class*="intercom"]', '[id*="intercom"]',
      '[class*="zendesk"]', '[id*="zendesk"]',
      '[class*="drift-"]', '[id*="drift-"]',
      '[class*="crisp-"]', '[id*="crisp-"]',
      '[class*="freshchat"]', '[id*="freshchat"]',
      '[class*="livechat"]', '[id*="livechat"]',
      '[class*="chat-widget"]', '[id*="chat-widget"]',
      '[data-testid*="chat"]'
    ].join(', ');
    var chatWidgets = Array.from(document.querySelectorAll(chatSelectors));
    chatWidgets.forEach(function(el) {
      found.push({ type: 'chat widget', html: el.outerHTML.substring(0, 120), target: [el.tagName.toLowerCase()] });
    });

    // 5. ARIA-labelled elements suggesting help
    var ariaEls = Array.from(document.querySelectorAll('[aria-label]')).filter(function(el) {
      var lbl = (el.getAttribute('aria-label') || '').toLowerCase();
      return lbl.indexOf('help') !== -1 || lbl.indexOf('support') !== -1 ||
             lbl.indexOf('contact') !== -1 || lbl.indexOf('chat') !== -1;
    });
    ariaEls.forEach(function(el) {
      found.push({ type: 'aria-labelled help element', html: el.outerHTML.substring(0, 120), target: [el.tagName.toLowerCase()] });
    });

    if (found.length === 0) {
      // SC 3.2.6 is not applicable when no help mechanisms exist
      passes.push({ html: '<body>', target: ['body'] });
      return { violations: violations, passes: passes, incomplete: incomplete };
    }

    // Deduplicate by html snippet to avoid reporting the same element via multiple patterns
    var seen = {};
    found.forEach(function(item) {
      if (seen[item.html]) return;
      seen[item.html] = true;
      incomplete.push({
        html: item.html,
        target: item.target,
        failureSummary: 'Help mechanism detected (' + item.type + '). Cannot verify it appears in the same relative order across all pages — multi-page manual audit required per WCAG 3.2.6.'
      });
    });

    return { violations: violations, passes: passes, incomplete: incomplete };
  }
};
```

### WCAGMap entry

```go
"consistent-help": {"3.2.6"},
```

### Test fixtures

**Incomplete (help mechanism found):** Any page with `<a href="tel:+1800555...">`, `<a href="mailto:support@...">`, a link to `/faq`, or a chat widget script.

**Passing (no help mechanism):** A bare HTML page with no tel/mailto links, no chat widgets, and no support/contact/FAQ links — SC is not applicable.

### Effort estimate

**2–3 hours.** Detection logic is straightforward. The chat widget class list needs updating as the team encounters new chat providers. Zero scoring impact since all results are `incomplete`.

---

## 7. SC 3.3.7 — Redundant Entry

**SC reference:** 3.3.7, Level A
**Understanding link:** https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html

### Failure scenario examples

- An e-commerce checkout with separate "Shipping Address" and "Billing Address" sections that requires the user to re-enter identical information, with no "same as shipping" checkbox.
- A multi-step registration wizard where step 1 asks for the user's email and step 3 asks for it again without pre-populating.
- A loan application form with multiple `<fieldset>` sections that re-collect name and date of birth.

### Detection approach

DOM-only heuristic. Two patterns:

1. **Shipping + billing address fields:** If both `[name*="shipping"]` and `[name*="billing"]` fields exist, check for a "same as" checkbox. If missing → `incomplete`.
2. **Step/wizard indicators:** `[aria-current="step"]`, `[role="progressbar"]`, elements with class containing `step`, `wizard`, `stepper`, or `progress` — emit `incomplete`.
3. **Multi-fieldset forms:** A `<form>` with ≥ 2 `<fieldset>` children — emit `incomplete`.

Always `incomplete` — cannot verify session state or pre-population without executing the form flow.

### Limitations

- Session-state and pre-population are invisible to static DOM analysis.
- Multi-page form flows (wizard spread across multiple URLs) are not detected.
- Will produce false positives on pages with legitimate separate-fieldset groupings (e.g., a form with both personal info and notification preferences sections that are independent).

### Rule file — `scripts/rules/redundant_entry.js`

```js
module.exports = {
  id: 'redundant-entry',
  type: 'dom',
  description: 'Information previously entered by the user must not be required again in the same process without auto-population or a selection option.',
  help: 'In multi-step forms, auto-populate or allow selection of previously entered information.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html',
  tags: ['wcag22a', 'wcag337'],
  impact: 'moderate',

  evaluate: function(document) {
    var violations = [];
    var passes = [];
    var incomplete = [];

    // Pattern 1: Shipping + billing address fields
    var shippingField = document.querySelector(
      '[name*="shipping_"], [name*="ship_"], [id*="shipping"], [class*="shipping-address"]'
    );
    var billingField = document.querySelector(
      '[name*="billing_"], [name*="bill_"], [id*="billing"], [class*="billing-address"]'
    );

    if (shippingField && billingField) {
      // Look for a "same as" checkbox within a reasonable search radius
      var sameAsCheckbox = document.querySelector(
        'input[type="checkbox"][name*="same"], ' +
        'input[type="checkbox"][id*="same"], ' +
        'input[type="checkbox"][class*="same"], ' +
        'input[type="checkbox"][aria-label*="same" i], ' +
        'input[type="checkbox"][aria-label*="billing" i]'
      );

      if (sameAsCheckbox) {
        passes.push({
          html: sameAsCheckbox.outerHTML.substring(0, 120),
          target: ['input[type="checkbox"]']
        });
      } else {
        incomplete.push({
          html: shippingField.outerHTML.substring(0, 120),
          target: [shippingField.tagName.toLowerCase()],
          failureSummary: 'Page has both shipping and billing address fields without a detected "same as shipping" checkbox. Verify the user is not required to re-enter the same address for billing (WCAG 3.3.7).'
        });
      }
      return { violations: violations, passes: passes, incomplete: incomplete };
    }

    // Pattern 2: Step/wizard progress indicators
    var stepSelectors = [
      '[aria-current="step"]',
      '[role="progressbar"]',
      '[class*="step-indicator"]',
      '[class*="wizard-step"]',
      '[class*="stepper"]',
      '[class*="multi-step"]',
      'ol[class*="steps"]',
      'ol[class*="progress"]'
    ].join(', ');

    var stepEls = Array.from(document.querySelectorAll(stepSelectors));
    if (stepEls.length > 0) {
      incomplete.push({
        html: stepEls[0].outerHTML.substring(0, 120),
        target: [stepEls[0].tagName.toLowerCase()],
        failureSummary: 'Multi-step form or wizard detected. Cannot automatically verify that previously entered information is auto-populated or selectable in later steps. Manual session-state audit required (WCAG 3.3.7).'
      });
      return { violations: violations, passes: passes, incomplete: incomplete };
    }

    // Pattern 3: Form with multiple fieldsets (possible multi-section process)
    var forms = Array.from(document.querySelectorAll('form'));
    var multiFieldsetForm = null;
    forms.forEach(function(form) {
      if (!multiFieldsetForm && form.querySelectorAll('fieldset').length >= 2) {
        multiFieldsetForm = form;
      }
    });

    if (multiFieldsetForm) {
      incomplete.push({
        html: multiFieldsetForm.outerHTML.substring(0, 120),
        target: ['form'],
        failureSummary: 'Form with multiple fieldset sections detected. If this represents a multi-step or multi-phase process where information may be collected more than once, verify auto-population or selection is available (WCAG 3.3.7).'
      });
      return { violations: violations, passes: passes, incomplete: incomplete };
    }

    // No multi-step indicators found — pass (SC may not be applicable)
    passes.push({ html: '<body>', target: ['body'] });
    return { violations: violations, passes: passes, incomplete: incomplete };
  }
};
```

### WCAGMap entry

```go
"redundant-entry": {"3.3.7"},
```

### Test fixtures

**Incomplete (shipping + billing, no same-as):**
```html
<form>
  <fieldset><legend>Shipping Address</legend>
    <input name="shipping_street"> <input name="shipping_city">
  </fieldset>
  <fieldset><legend>Billing Address</legend>
    <input name="billing_street"> <input name="billing_city">
  </fieldset>
</form>
```

**Passing (same-as checkbox present):**
```html
<input type="checkbox" id="same-as-shipping" name="same_as_shipping">
<label for="same-as-shipping">Billing same as shipping</label>
```

### Effort estimate

**2–3 hours.** The selector patterns for shipping/billing detection may need tuning for specific apps. Zero scoring impact.

---

## 8. SC 2.4.13 — Focus Appearance

**SC reference:** 2.4.13, Level AA
**Understanding link:** https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html

### Failure scenario examples

- A 1px default browser outline (`outline: 1px solid blue`) on an element with 200px perimeter. Required area = 200 × 2 = 400px²; actual area ≈ 200 × 1 = 200px² → **fails area requirement**.
- A white outline (`outline: 2px solid white`) on a white background → contrast ratio 1:1 → **fails contrast requirement**.
- A focus indicator using `box-shadow: 0 0 0 2px rgba(0,123,255,0.5)` — passes area but the 50% alpha makes the effective contrast unmeasurable automatically → `incomplete`.

### Detection approach

Puppeteer. Tab through up to 15 elements. For each focused element:

1. Read `outline-width`, `outline-style`, `outline-color`, `outline-offset`, `box-shadow`, `background-color` via `getComputedStyle`.
2. **Area check (outline only):** `indicatorArea = perimeter × outlineWidth`. `minArea = perimeter × 2`. Fail if `outlineWidth < 2`.
3. **Contrast check:** Parse `outlineColor` and `backgroundColor` as RGB. Compute ratio. Fail if < 3.0:1.
4. If `box-shadow` is the only indicator — emit `incomplete` (area and color of box-shadow are complex to parse reliably).
5. If no outline or box-shadow — emit `violation` (no indicator detected; this also catches 2.4.7 failures).

**Note on the 2.4.13 contrast definition:** The SC measures contrast between the same pixels in focused vs unfocused states. For an outline indicator, the unfocused pixels in that area show the adjacent background; the focused pixels show the outline color. Therefore, `contrast(outlineColor, adjacentBackground)` is the correct computation.

### Limitations

- `box-shadow` indicators cannot have their area or color reliably computed from the `box-shadow` CSS string without parsing it — these are always `incomplete`.
- `::before` / `::after` pseudo-element focus indicators are not detected by `getComputedStyle`.
- Custom properties (CSS variables) used in outline colors that resolve to non-rgb values at compute time will fail the `parseRgb` check and emit `incomplete`.
- The area calculation for outlines with `border-radius` is a simplification — actual area will be slightly less at corners. This produces a small number of false passes for borderline cases.

### Rule file — `scripts/rules/focus_appearance.js`

```js
module.exports = {
  id: 'focus-appearance',
  type: 'puppeteer',
  description: 'Keyboard focus indicators must meet minimum area (perimeter \xd7 2px) and contrast ratio (3:1) requirements.',
  help: 'Use outline-width ≥2px and ensure the outline color has ≥3:1 contrast against the adjacent background.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html',
  tags: ['wcag22aa', 'wcag2413'],
  impact: 'serious',

  evaluate: async function(page) {
    var violations = [];
    var passes = [];
    var incomplete = [];

    var MAX_TABS = 15;

    // --- Helpers (Node.js context) ---

    function parseRgb(str) {
      if (!str) return null;
      var m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (!m) return null;
      return { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10) };
    }

    function relativeLuminance(r, g, b) {
      var vals = [r, g, b].map(function(v) {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return vals[0] * 0.2126 + vals[1] * 0.7152 + vals[2] * 0.0722;
    }

    function contrastRatio(c1, c2) {
      var l1 = relativeLuminance(c1.r, c1.g, c1.b);
      var l2 = relativeLuminance(c2.r, c2.g, c2.b);
      var lighter = Math.max(l1, l2);
      var darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    // --- Puppeteer loop ---

    await page.focus('body');

    for (var i = 0; i < MAX_TABS; i++) {
      await page.keyboard.press('Tab');

      var data = await page.evaluate(function() {
        var el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) return null;

        var rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return { skip: true };

        var s = window.getComputedStyle(el);

        // Perimeter of the unfocused component
        var perimeter = 2 * (rect.width + rect.height);

        // Outline properties
        var outlineStyle = s.outlineStyle;
        var outlineWidth = parseFloat(s.outlineWidth) || 0;
        var outlineColor = s.outlineColor;

        // Box shadow (as raw string — Node.js will interpret it)
        var boxShadow = s.boxShadow;

        // Background of element (used as proxy for "unfocused pixel color adjacent to indicator")
        var bgColor = s.backgroundColor;

        // Walk up to find the nearest opaque background for contrast computation
        var effectiveBg = bgColor;
        if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
          var p = el.parentElement;
          while (p && p.tagName) {
            var ps = window.getComputedStyle(p);
            var pb = ps.backgroundColor;
            if (pb && pb !== 'rgba(0, 0, 0, 0)' && pb !== 'transparent') {
              effectiveBg = pb;
              break;
            }
            p = p.parentElement;
          }
        }

        var hasOutline = outlineStyle !== 'none' && outlineWidth > 0;
        var hasBoxShadow = boxShadow && boxShadow !== 'none';

        return {
          skip: false,
          html: el.outerHTML.substring(0, 120),
          tag: el.tagName.toLowerCase(),
          perimeter: perimeter,
          hasOutline: hasOutline,
          outlineWidth: outlineWidth,
          outlineColor: outlineColor,
          outlineStyle: outlineStyle,
          hasBoxShadow: hasBoxShadow,
          boxShadow: boxShadow,
          effectiveBg: effectiveBg,
          rectWidth: Math.round(rect.width),
          rectHeight: Math.round(rect.height)
        };
      });

      if (!data || data.skip) continue;

      var html = data.html;
      var tag = data.tag;

      // No indicator at all
      if (!data.hasOutline && !data.hasBoxShadow) {
        violations.push({
          id: 'focus-appearance',
          impact: 'serious',
          description: 'No visible keyboard focus indicator detected (no outline or box-shadow).',
          help: 'Add an outline or box-shadow to focused elements with ≥2px width and ≥3:1 contrast.',
          helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html',
          tags: ['wcag22aa', 'wcag2413'],
          nodes: [{
            html: html,
            target: [tag],
            failureSummary: 'No outline or box-shadow when focused. Element: ' + data.rectWidth + '\xd7' + data.rectHeight + 'px.'
          }]
        });
        continue;
      }

      // Box-shadow only — cannot reliably measure area or color
      if (!data.hasOutline && data.hasBoxShadow) {
        incomplete.push({
          id: 'focus-appearance',
          description: 'Focus indicator uses box-shadow only. Area and contrast ratio cannot be automatically computed from box-shadow. Manually verify: (1) total indicator area ≥ ' + Math.round(data.perimeter * 2) + 'px\xb2 (' + Math.round(data.perimeter) + 'px perimeter \xd7 2px), (2) indicator color has ≥3:1 contrast against adjacent background. box-shadow: ' + (data.boxShadow || '').substring(0, 60),
          nodeCount: 1
        });
        continue;
      }

      // Outline present — check area and contrast
      var minArea = data.perimeter * 2;
      var actualArea = data.perimeter * data.outlineWidth;
      var areaFail = actualArea < minArea;

      var contrastFail = false;
      var contrastValue = null;
      var contrastUnknown = false;

      var indicatorRgb = parseRgb(data.outlineColor);
      var bgRgb = parseRgb(data.effectiveBg);

      if (indicatorRgb && bgRgb) {
        contrastValue = contrastRatio(indicatorRgb, bgRgb);
        contrastFail = contrastValue < 3.0;
      } else {
        contrastUnknown = true;
      }

      if (areaFail) {
        violations.push({
          id: 'focus-appearance',
          impact: 'serious',
          description: 'Focus indicator area is below minimum (perimeter \xd7 2px).',
          help: 'Increase outline-width to at least 2px.',
          helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html',
          tags: ['wcag22aa', 'wcag2413'],
          nodes: [{
            html: html,
            target: [tag],
            failureSummary: 'outline-width: ' + data.outlineWidth + 'px gives area ≈' + Math.round(actualArea) + 'px\xb2; minimum is ' + Math.round(minArea) + 'px\xb2 (perimeter ' + Math.round(data.perimeter) + 'px \xd7 2). Increase outline-width to ≥2px.'
          }]
        });
      } else if (contrastFail) {
        violations.push({
          id: 'focus-appearance',
          impact: 'serious',
          description: 'Focus indicator has insufficient contrast ratio against adjacent background (≥3:1 required).',
          help: 'Choose an outline color with at least 3:1 contrast against the background behind the focus indicator.',
          helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html',
          tags: ['wcag22aa', 'wcag2413'],
          nodes: [{
            html: html,
            target: [tag],
            failureSummary: 'Focus indicator contrast: ' + (contrastValue ? contrastValue.toFixed(2) : '?') + ':1 (required ≥3:1). outline-color: ' + data.outlineColor + ', background: ' + data.effectiveBg + '.'
          }]
        });
      } else if (contrastUnknown) {
        incomplete.push({
          id: 'focus-appearance',
          description: 'Focus indicator present (outline-width: ' + data.outlineWidth + 'px) but contrast could not be computed — outline-color or background is non-rgb (e.g., transparent, CSS variable, currentColor). Manual check for ≥3:1 contrast required.',
          nodeCount: 1
        });
      } else {
        passes.push({
          id: 'focus-appearance',
          description: 'Focus indicator meets area (outline-width ' + data.outlineWidth + 'px ≥ 2px) and contrast (' + (contrastValue ? contrastValue.toFixed(2) : '?') + ':1 ≥ 3:1) requirements.',
          nodeCount: 1
        });
      }
    }

    return { violations: violations, passes: passes, incomplete: incomplete };
  }
};
```

### WCAGMap entry

```go
"focus-appearance": {"2.4.13"},
```

### Test fixtures

**Failing (area):** `button:focus { outline: 1px solid #005fcc; }` on a 100×40px button → perimeter=280px, area=280px² < 560px² minimum.

**Failing (contrast):** `button:focus { outline: 2px solid #aaa; background: #fff; }` → `#aaa` vs `#fff` = ~1.6:1 < 3:1.

**Passing:** `button:focus { outline: 3px solid #005fcc; }` on a white background → area=perimeter×3 > threshold, contrast(`#005fcc`, `#fff`) ≈ 5.9:1.

**Incomplete (box-shadow):** `button:focus { box-shadow: 0 0 0 3px #005fcc; outline: none; }` — area and color extraction from box-shadow string is deferred to manual review.

### Effort estimate

**6–10 hours.** The contrast math is the core complexity. The box-shadow limitation is a known gap — a follow-up enhancement could parse the box-shadow spread-radius and color from the CSS string using a regex, but this is complex enough to defer.

---

## 9. Implementation Order (ROI Ranking)

| Rank | SC | Rule ID | Reason |
|---|---|---|---|
| 1 | 2.5.8 | `target-size` | Pure DOM, clear numeric threshold, affects every interactive element, real violations possible on most sites, scoring impact |
| 2 | 3.3.8 | `accessible-authentication` | Known third-party domain list, medium effort, `critical` impact, significant user harm, scoring impact |
| 3 | 2.4.11 | `focus-not-obscured` | Puppeteer required but logic is clean, common failure pattern (sticky headers), `serious` impact, scoring impact |
| 4 | 2.5.7 | `dragging-movements` | Quick DOM scan, many modern SPAs have drag lists, always `incomplete` so no scoring risk |
| 5 | 2.4.13 | `focus-appearance` | Highest effort but highest value — focus appearance is a market differentiator, emits real violations |
| 6 | 3.2.6 | `consistent-help` | Fast DOM rule, always `incomplete`, completes WCAG 2.2 A coverage, low effort |
| 7 | 3.3.7 | `redundant-entry` | Always `incomplete`, fast DOM rule, completes WCAG 2.2 A coverage, low effort |

**Sprint suggestion:**
- Sprint 1 (1 day): Rules 1 + 2 (target-size, accessible-authentication) — both DOM-only, ship together.
- Sprint 2 (1–2 days): Rules 3 + 4 (focus-not-obscured, dragging-movements) — Puppeteer + DOM.
- Sprint 3 (2 days): Rule 5 (focus-appearance) — standalone, requires careful testing.
- Sprint 4 (half day): Rules 6 + 7 (consistent-help, redundant-entry) — both DOM-only, trivial to ship together.

---

## 10. WCAGMap Diff

Add all 7 entries to `internal/models/wcag_mapping.go` after the existing Phase 3 block:

```go
    // Phase 4 – WCAG 2.2 new criteria
    "target-size":               {"2.5.8"},  // dom   — 24×24px minimum target size
    "accessible-authentication": {"3.3.8"},  // dom   — CAPTCHA / cognitive function test detection
    "dragging-movements":        {"2.5.7"},  // dom   — drag-and-drop without single-pointer alternative
    "focus-not-obscured":        {"2.4.11"}, // pptr  — focused element hidden by fixed/sticky overlay
    "consistent-help":           {"3.2.6"},  // dom   — help mechanism consistency (always incomplete)
    "redundant-entry":           {"3.3.7"},  // dom   — multi-step form redundant data entry (always incomplete)
    "focus-appearance":          {"2.4.13"}, // pptr  — focus indicator area + contrast
```

**Scoring impact of these additions:**

| Rule | Can emit `violation`? | Penalty contribution |
|---|---|---|
| `target-size` | Yes | serious=10 per violation |
| `accessible-authentication` | Yes | critical=20 per violation |
| `dragging-movements` | No (incomplete only) | 0 |
| `focus-not-obscured` | Yes | serious=10 per violation |
| `consistent-help` | No (incomplete only) | 0 |
| `redundant-entry` | No (incomplete only) | 0 |
| `focus-appearance` | Yes | serious=10 per violation |

---

## 11. Testing Checklist

For each rule, follow this verification sequence before merging:

### 11.1 target-size

- [ ] Run against a page with small icon buttons — verify violations for `width < 24 || height < 24`.
- [ ] Run against a page with standard 44×44px buttons — verify passes.
- [ ] Run against a page with inline text links in `<p>` tags — verify `incomplete` (not `violation`) even when link renders below 24px.
- [ ] Check that `<input type="hidden">` does not appear in results.
- [ ] Check that disabled inputs are excluded.

### 11.2 accessible-authentication

- [ ] Run against `https://www.google.com/recaptcha/demo` or a local page loading `api.js` from `google.com/recaptcha` — verify `violation` emitted.
- [ ] Run against a page with `data-sitekey` attribute but no script — verify `incomplete` (not `violation`).
- [ ] Run against a standard login form with password field but no CAPTCHA — verify `pass`.
- [ ] Run against a page with no forms — verify `pass`.

### 11.3 dragging-movements

- [ ] Run against a Sortable.js demo page — verify the `[draggable="true"]` items emit `incomplete`.
- [ ] Run against a list with up/down buttons and `draggable="true"` — verify `pass` (reorder buttons found).
- [ ] Run against a plain page — verify single `pass` on `<body>`.

### 11.4 focus-not-obscured

- [ ] Build a local test page with a `position:fixed; height:60px; z-index:100` header and a focusable link that renders behind it at initial scroll position — verify `violation`.
- [ ] Run against a page with no fixed elements — verify all `passes`.
- [ ] Run against a page with a fixed element that only partially overlaps the focused element — verify `incomplete` (not `violation`).

### 11.5 consistent-help

- [ ] Run against any page with `<a href="tel:...">` — verify `incomplete` mentioning "phone link".
- [ ] Run against a page with an Intercom chat widget div — verify `incomplete` mentioning "chat widget".
- [ ] Run against a bare test page with no help elements — verify `pass`.

### 11.6 redundant-entry

- [ ] Build a test page with `input[name="shipping_street"]` and `input[name="billing_street"]` without a same-as checkbox — verify `incomplete`.
- [ ] Same page but add `<input type="checkbox" name="same_as_shipping">` — verify `pass`.
- [ ] Run against a page with `[aria-current="step"]` — verify `incomplete` mentioning "multi-step form".
- [ ] Run against a page with a single-fieldset form — verify `pass`.

### 11.7 focus-appearance

- [ ] Build a test page with `button:focus { outline: 1px solid blue; }` — verify `violation` citing area failure.
- [ ] Build a test page with `button:focus { outline: 2px solid #aaa; }` on white background — verify `violation` citing contrast failure.
- [ ] Build a test page with `button:focus { outline: 3px solid #005fcc; }` on white background — verify `pass`.
- [ ] Build a test page with `button:focus { box-shadow: 0 0 0 3px blue; outline: none; }` — verify `incomplete`.
- [ ] Build a test page with `button:focus { outline: none; }` — verify `violation` for no indicator.

### 11.8 WCAGMap integration

After all rules are in `scripts/rules/`, verify the Go scoring gate:

```bash
cd /Users/sabyasachiroy/projects/webaccessibility && go test ./...
```

Confirm no compile errors. Confirm the new rule IDs appear in WCAGMap by running:

```bash
grep -n "target-size\|accessible-authentication\|dragging-movements\|focus-not-obscured\|consistent-help\|redundant-entry\|focus-appearance" internal/models/wcag_mapping.go
```

All 7 should appear.

---

## 12. Known Limitations — What This Scanner Will Never Fully Automate for WCAG 2.2

| SC | Limitation | Workaround |
|---|---|---|
| 2.4.11 Focus Not Obscured | Sticky headers that only activate after scroll are missed — the page is scanned at initial viewport, no scrolling is simulated | Manual test: scroll halfway down the page, then Tab through elements |
| 2.4.13 Focus Appearance | `box-shadow` focus indicators cannot have their area measured from the CSS string without a full parser; pseudo-element indicators (`::before`, `::after`) are invisible to `getComputedStyle` | Manual check for any element that emits `incomplete` on box-shadow |
| 2.5.7 Dragging Movements | JavaScript drag libraries that do not set `draggable="true"` (react-dnd with pointer events, native pointer-event drag without HTML drag API) are not detected | Manual test: identify all drag interactions in the app and verify alternatives |
| 2.5.8 Target Size (Minimum) | The spacing exception requires computing exact inter-target CSS pixel distances, which is expensive in DOM context | When a violation is reported at borderline size (22–24px), manually measure spacing to adjacent targets |
| 3.2.6 Consistent Help | Requires visiting multiple pages and comparing help mechanism positions — fundamentally a multi-page check | Manual audit: visit at least 3 representative pages (homepage, category page, detail page) and compare help mechanism positions |
| 3.3.7 Redundant Entry | Requires executing a multi-step form flow with real session state to observe whether data is re-requested | Manual test: complete the form flow end-to-end and observe whether any field asks for information already provided |
| 3.3.8 Accessible Authentication | First-party or custom CAPTCHA implementations without recognizable class names, script domains, or `data-sitekey` attributes are invisible to DOM analysis | Manual review of all authentication flows; search source code for CAPTCHA-related function names |

Additionally, the following WCAG 2.2 items are **out of scope for automation** in any single-page scanner:

- **SC 2.4.12 Focus Not Obscured (Enhanced, AAA):** Requires the focused element to not be *partially* covered — not in scope for A/AA.
- **SC 3.3.9 Accessible Authentication (Enhanced, AAA):** No cognitive function test whatsoever — out of A/AA scope.
- **Any multi-page consistency check (3.2.3, 3.2.4, 3.2.6):** Requires crawling and cross-page analysis, which is an architectural feature extension beyond this scanner's single-URL model.
