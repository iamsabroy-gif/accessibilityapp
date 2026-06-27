#!/usr/bin/env node
/**
 * axe_runner.js
 *
 * Runs axe-core against a given URL using Puppeteer (headless Chrome)
 * and writes a JSON result to stdout.
 *
 * Usage:
 *   node axe_runner.js <url> [wcag_level]
 *
 * wcag_level: "AA" (default) or "AAA"
 *
 * Outputs a JSON object with keys: url, violations, passes, incomplete, error
 *
 * **Custom WCAG 2.1 Checks Added**
 *   • G58 – Link to text alternative adjacent to media (audio/video/object/iframe)
 *   • H53 – Object body provides alternative for time‑based media
 *   • 1.2.2 – video-captions-present (existing)
 *   • 1.2.2 – video-captions-track-attrs: <track> srclang + label validation (H95)
 *   • 1.3.3 – sensory-characteristics: text heuristic (incomplete)
 *   • 1.3.4 – orientation-lock: CSS orientation media query + JS API
 *   • 1.4.1 – color-only-indicator (existing)
 *   • 1.4.4 – resize-text: 200% font-size overflow check (restores original)
 *   • 1.4.11 – non-text-contrast: UI component border contrast 3:1
 *   • 1.4.13 – content-on-hover: tooltip dismissibility check
 *   • 2.1.2 – focus-order-cycling (existing)
 *   • 2.2.1 – timing-adjustable: meta refresh + setTimeout/setInterval detection
 *   • 2.4.3 – meaningful-sequence-* (existing)
 *   • 2.4.5 – multiple-ways: search input / sitemap link heuristic
 *   • 2.4.7 – focus-visible: compare computed style before/after focus
 *   • 2.5.1 – pointer-gestures: multi-touch event listener analysis (incomplete)
 *   • 3.2.1 – on-focus-context-change: detect nav/dialog on focus
 *   • 3.3.1 – error-identification: aria-invalid + accessible error message
 */

const puppeteer = require('puppeteer');
const { axe } = require('axe-core');
const fs = require('fs');

const [,, url, wcagLevel = 'AA'] = process.argv;

if (!url) {
  console.log(JSON.stringify({ error: 'URL argument is required' }));
  process.exit(1);
}

// Map WCAG level to axe tag sets
const tagMap = {
  A:   ['wcag2a', 'wcag21a', 'best-practice'],
  AA:  ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
  AAA: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag21aaa', 'best-practice'],
};
const tags = tagMap[wcagLevel.toUpperCase()] || tagMap['AA'];

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();

    // Set a realistic viewport and user agent
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // increase default timeout for all puppeteer operations
    await page.setDefaultTimeout(180000);

    // Bypass CSP so we can inject axe-core regardless of the target page's policy
    await page.setBypassCSP(true);

    // Load axe-core source for injection
    const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

    // Pre-navigation injection so axe is present from page load
    await page.evaluateOnNewDocument(axeSrc);

    // Navigate to the target page
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
      console.log(JSON.stringify({ error: 'page navigation failed', details: e.message }));
      process.exit(1);
    }

    // Post-navigation injection as a fallback (evaluate the source directly)
    await page.evaluate(axeSrc);

    const results = await page.evaluate((tags) => {
        // `axe` is now available in the page context and returns a promise
        return axe.run(document, {
          runOnly: { type: 'tag', values: tags },
          reporter: 'v2',
        });
      }, tags);

    // Re-run axe with raw reporter for violated rules to get total tested node
    // counts (v2 reporter only reports failing nodes for violated rules).
    const violatedRuleIds = results.violations.map(v => v.id);
    let ruleNodeTotals = {};
    if (violatedRuleIds.length > 0) {
      try {
        ruleNodeTotals = await page.evaluate(async (ids) => {
          const raw = await axe.run(document, {
            runOnly: { type: 'rule', values: ids },
            reporter: 'raw',
          });
          const totals = {};
          for (const rule of raw) {
            totals[rule.id] = rule.nodes ? rule.nodes.length : 0;
          }
          return totals;
        }, violatedRuleIds);
      } catch (_) { /* raw reporter unavailable — fallback to fail-only counts */ }
    }

    // ---------- Custom Checks ----------
    const custom = await page.evaluate(() => {
      // Helper to test adjacency of a transcript link
      function isAdjacentAlternative(mediaEl) {
        const parent = mediaEl.parentElement;
        if (!parent) return false;
        const siblings = Array.from(parent.children);
        const idx = siblings.indexOf(mediaEl);
        const near = siblings.slice(Math.max(0, idx - 2), Math.min(siblings.length, idx + 3)).filter(el => el !== mediaEl);
        // If the media is inside a <figure>, also consider its <figcaption>
        if (parent.tagName === 'FIGURE') {
          const fc = parent.querySelector('figcaption');
          if (fc) near.push(fc);
        }
        return near.some(el => {
          const links = el.tagName === 'A' ? [el] : Array.from(el.querySelectorAll('a'));
          return links.some(a => {
            const text = (a.textContent || '').toLowerCase();
            const href = (a.getAttribute('href') || '').toLowerCase();
            return /transcript|text alternative|description|text version|full text/.test(text)
              || /\.(txt|html?)$|transcript|description/.test(href);
          });
        });
      }

      // Helper for object body alternative detection
      function isObjectAlternative(obj) {
        const clone = obj.cloneNode(true);
        clone.querySelectorAll('param, embed').forEach(e => e.remove());
        const text = clone.textContent.trim();
        const hasLink = Array.from(clone.querySelectorAll('a')).some(a => /transcript|text alternative|description/.test((a.textContent || '').toLowerCase()));
        const hasTranscript = text.length > 200 && ( /\w+\s*:/.test(text) || /\[.*\]/.test(text) || text.toLowerCase().includes('transcript') );
        const readable = text.length > 30;
        return hasLink || hasTranscript || readable;
      }

      const violations = [];
      const passes = [];
      const incomplete = [];

      // ---------- Check A – G58 ----------
      const mediaSelectors = 'video, audio, object, iframe, embed';
      const mediaEls = Array.from(document.querySelectorAll(mediaSelectors));
      mediaEls.forEach(el => {
        // Skip if element already has an aria-describedby that mentions a text alternative
        const ariaDesc = el.getAttribute('aria-describedby') || '';
        if (/media alternative for text|text alternative/.test(ariaDesc.toLowerCase())) return;
        // Determine if element is a candidate (has src/data/href that looks like media)
        const src = el.getAttribute('src') || el.getAttribute('data') || '';
        const type = el.getAttribute('type') || '';
        const isCandidate = /\.(mp4|webm|ogg|ogv|mp3|wav|m4a|mov)$/.test(src) || /video|audio/.test(type);
        if (!isCandidate) return;
        if (!isAdjacentAlternative(el)) {
          const node = { html: el.outerHTML, target: [el.tagName.toLowerCase()], failureSummary: '' };
          violations.push({
            id: 'g58-media-alternative-link',
            impact: 'serious',
            description: 'Prerecorded time-based media does not have a link to a text alternative immediately adjacent to it.',
            help: 'Place a link to the transcript or text alternative immediately next to the media element.',
            helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/general/G58',
            tags: ['wcag123', 'cat.time-and-media'],
            nodes: [node]
          });
        } else {
          passes.push({
            id: 'g58-media-alternative-link',
            description: 'Media element has an adjacent link to a text alternative.'
          });
        }
      });

      // ---------- Check B – H53 ----------
      const objectEls = Array.from(document.querySelectorAll('object'));
      objectEls.forEach(obj => {
        const data = obj.getAttribute('data') || '';
        const type = obj.getAttribute('type') || '';
        const isMultimedia = /\.(mp4|webm|ogg|ogv|mp3|wav|m4a|mov)$/.test(data) || /video\/|audio\/|application\/x-shockwave-flash/.test(type);
        if (!isMultimedia) return;
        // If we cannot confidently determine media type, mark incomplete
        if (!data && !type) {
          incomplete.push({
            id: 'h53-object-alternative',
            description: 'Unable to determine media type for <object> element; could not evaluate alternative.'
          });
          return;
        }
        if (!isObjectAlternative(obj)) {
          const node = { html: obj.outerHTML, target: ['object'], failureSummary: '' };
          violations.push({
            id: 'h53-object-alternative',
            impact: 'serious',
            description: 'The object element embedding multimedia does not provide an alternative for time-based media in its body content.',
            help: 'Use the body of the object element to provide a transcript, text alternative, or a link to one.',
            helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/html/H53',
            tags: ['wcag123', 'cat.time-and-media'],
            nodes: [node]
          });
        } else {
          passes.push({
            id: 'h53-object-alternative',
            description: 'Object element provides an appropriate alternative.'
          });
        }
      });

      return { violations, passes, incomplete };
    });

    // Return results of custom G58/H53 block
    const customResult = custom;

// ---------- Video Captions Check (WCAG 1.2.2) ----------
const videoCheck = await page.evaluate(() => {
  const violations = [];
  const passes = [];
  document.querySelectorAll('video').forEach(video => {
    const hasCaptions = Array.from(video.querySelectorAll('track')).some(track => {
      const kind = (track.getAttribute('kind') || '').toLowerCase();
      return kind === 'captions';
    });
    const hasPosterOnly = video.hasAttribute('poster') && !video.querySelector('source, track');
    if (!hasCaptions && !hasPosterOnly) {
      const node = { html: video.outerHTML, target: ['video'], failureSummary: '' };
      violations.push({
        id: 'video-captions-present',
        impact: 'serious',
        description: 'Video element lacks captions track and is not a poster‑only placeholder.',
        help: 'Provide a <track kind="captions"> element for the video or use a static poster image.',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/html/H58',
        tags: ['wcag122'],
        nodes: [node]
      });
    } else {
      passes.push({ id: 'video-captions-present', description: 'Video has appropriate captions or is poster‑only.' });
    }
  });
  return { violations, passes };
});

// ---------- Video Track Attribute Check (WCAG 1.2.2 – H95) ----------
// Extends the captions check: validates src, srclang and label on <track kind="captions">
// Emits two distinct rule IDs to match the Go WCAGMap and test expectations:
//   video-captions-track-src  – <track> has no src attribute
//   video-captions-track-lang – <track> is missing srclang and/or label
const videoTrackCheck = await page.evaluate(() => {
  const violations = [];
  const passes = [];
  document.querySelectorAll('video').forEach(video => {
    const captionTracks = Array.from(video.querySelectorAll('track')).filter(t =>
      (t.getAttribute('kind') || '').toLowerCase() === 'captions'
    );
    captionTracks.forEach(track => {
      const src     = (track.getAttribute('src') || '').trim();
      const srclang = (track.getAttribute('srclang') || '').trim();
      const label   = (track.getAttribute('label') || '').trim();

      // Rule 1 – missing src
      if (!src) {
        violations.push({
          id: 'video-captions-track-src',
          impact: 'serious',
          description: '<track kind="captions"> has no src attribute pointing to a caption file.',
          help: 'Provide a valid src URL on the caption track element.',
          helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/html/H95',
          tags: ['wcag122'],
          nodes: [{ html: track.outerHTML, target: ['track'], failureSummary: '' }]
        });
      } else {
        passes.push({ id: 'video-captions-track-src', description: 'Caption track has a src attribute.' });
      }

      // Rule 2 – missing srclang and/or label
      if (!srclang || !label) {
        const missing = [];
        if (!srclang) missing.push('srclang');
        if (!label)   missing.push('label');
        violations.push({
          id: 'video-captions-track-lang',
          impact: 'moderate',
          description: `<track kind="captions"> is missing required attribute(s): ${missing.join(', ')}.`,
          help: 'Provide srclang (BCP 47 language code) and label (human-readable name) on caption tracks.',
          helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/html/H95',
          tags: ['wcag122'],
          nodes: [{ html: track.outerHTML, target: ['track'], failureSummary: '' }]
        });
      } else {
        passes.push({ id: 'video-captions-track-lang', description: 'Caption track has valid srclang and label.' });
      }
    });
  });
  return { violations, passes };
});

    // ---------- Color‑Only State Indicator Check (WCAG 1.4.1) ----------
const colorCheck = await page.evaluate(() => {
  const violations = [];
  const passes = [];
  const cssRules = [];
  // Collect selectors that use :focus or :invalid and change background or border colour
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        const selector = rule.selectorText || '';
        const style = rule.style || {};
        if (!selector) continue;
        const pseudoMatch = selector.match(/([^:\s]+)\s*:(focus|invalid)/i);
        if (!pseudoMatch) continue;
        const baseSelector = pseudoMatch[1];
        if (style.backgroundColor || style.borderColor) {
          cssRules.push(baseSelector);
        }
      }
    } catch (e) {
      // ignore cross‑origin sheets
    }
  }
  const uniqueSelectors = Array.from(new Set(cssRules));
  uniqueSelectors.forEach(sel => {
    let elements;
    try {
      elements = document.querySelectorAll(sel);
    } catch (e) {
      // Skip selectors that are valid CSS but not valid for querySelectorAll
      // (e.g. complex pseudo-class combinations found in third-party stylesheets)
      return;
    }
    elements.forEach(el => {
      // Heuristic: no textual or iconic indicator within the element
      const hasIcon = el.querySelector('svg, img, [role="img"]');
      const hasText = el.textContent.trim().length > 0;
      if (!hasIcon && !hasText) {
        const node = { html: el.outerHTML, target: [el.tagName.toLowerCase()], failureSummary: '' };
        violations.push({
          id: 'color-only-indicator',
          impact: 'serious',
          description: 'Element relies solely on colour change (background or border) to convey state.',
          help: 'Provide an additional non‑colour cue such as an icon or text label.',
          helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/css/C15',
          tags: ['wcag141'],
          nodes: [node]
        });
      } else {
        passes.push({ id: 'color-only-indicator', description: 'Element provides non‑colour state indication.' });
      }
    });
  });
  return { violations, passes };
});

// ---------- Non-text Contrast Check (WCAG 1.4.11) ----------
const nonTextContrastCheck = await page.evaluate(() => {
  const violations = [];
  const passes = [];

  function getLuminance(r, g, b) {
    return [r, g, b].reduce((sum, c, i) => {
      const s = c / 255;
      const lin = s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      return sum + lin * [0.2126, 0.7152, 0.0722][i];
    }, 0);
  }

  function parseRGB(cssColor) {
    const m = cssColor.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : null;
  }

  function contrastRatio(c1, c2) {
    const l1 = getLuminance(...c1);
    const l2 = getLuminance(...c2);
    const lighter = Math.max(l1, l2);
    const darker  = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  const uiSelectors = 'input, textarea, select, button, [role="checkbox"], [role="radio"], [role="slider"], [role="switch"], [role="spinbutton"]';
  document.querySelectorAll(uiSelectors).forEach(el => {
    const style = window.getComputedStyle(el);
    const bgColor = style.backgroundColor;
    // Prefer borderColor; fall back to outlineColor
    const boundaryColor = style.borderColor || style.outlineColor;
    const bgRGB = parseRGB(bgColor);
    const boundaryRGB = parseRGB(boundaryColor);
    if (!bgRGB || !boundaryRGB) return;
    // Skip fully transparent backgrounds
    if (bgColor.startsWith('rgba') && parseFloat(bgColor.split(',')[3]) === 0) return;
    const ratio = contrastRatio(bgRGB, boundaryRGB);
    if (ratio < 3) {
      violations.push({
        id: 'non-text-contrast',
        impact: 'serious',
        description: `UI component border has insufficient contrast ratio of ${ratio.toFixed(2)}:1 against background (minimum 3:1 required).`,
        help: 'Ensure UI component boundaries (borders, outlines) have at least 3:1 contrast ratio against adjacent colours.',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html',
        tags: ['wcag21aa', 'wcag1411'],
        nodes: [{ html: el.outerHTML, target: [el.tagName.toLowerCase()], failureSummary: '' }]
      });
    } else {
      passes.push({ id: 'non-text-contrast', description: 'UI component has sufficient border contrast.' });
    }
  });
  return { violations, passes };
});

// ---------- Error Identification Check (WCAG 3.3.1) ----------
const errorIdentificationCheck = await page.evaluate(() => {
  const violations = [];
  const passes = [];
  const incomplete = [];

  // Check aria-invalid="true" elements
  document.querySelectorAll('[aria-invalid="true"]').forEach(el => {
    const describedBy = el.getAttribute('aria-describedby') || '';
    let hasAccessibleError = false;

    if (describedBy) {
      hasAccessibleError = describedBy.split(/\s+/).some(id => {
        const ref = document.getElementById(id);
        return ref && ref.textContent.trim().length > 0;
      });
    }

    if (!hasAccessibleError) {
      // Look for adjacent role=alert or aria-live element in same parent
      const parent = el.parentElement;
      if (parent) {
        const alertEl = parent.querySelector('[role="alert"], [aria-live="polite"], [aria-live="assertive"]');
        if (alertEl && alertEl.textContent.trim().length > 0) {
          hasAccessibleError = true;
        }
      }
    }

    if (hasAccessibleError) {
      passes.push({ id: 'error-identification', description: 'Error field has an accessible, associated error message.' });
    } else {
      violations.push({
        id: 'error-identification',
        impact: 'serious',
        description: 'Input marked aria-invalid="true" lacks an accessible error message via aria-describedby or role="alert".',
        help: 'Associate a descriptive error message using aria-describedby referencing a visible error element, or place a role="alert" adjacent to the field.',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/error-identification.html',
        tags: ['wcag2a', 'wcag331'],
        nodes: [{ html: el.outerHTML, target: [el.tagName.toLowerCase()], failureSummary: '' }]
      });
    }
  });

  // Native HTML5 required fields without an associated error container → flag incomplete
  document.querySelectorAll('input[required], select[required], textarea[required]').forEach(el => {
    if (el.getAttribute('aria-invalid') === 'true') return; // already handled above
    if (!el.getAttribute('aria-describedby') && !el.getAttribute('aria-errormessage')) {
      incomplete.push({
        id: 'error-identification',
        description: 'Required field has no aria-describedby or aria-errormessage. Verify that HTML5 validation errors are programmatically accessible.',
        help: 'Associate error messages with form fields using aria-describedby.',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/error-identification.html'
      });
    }
  });

  return { violations, passes, incomplete };
});

// ---------- Focus Order Check (WCAG 2.1.2) ----------
const focusCheck = await (async () => {
  const maxPresses = 50;
  const visited = new Set();
  let firstKey = null;
  // Ensure starting focus on body
  await page.focus('body');
  for (let i = 0; i < maxPresses; i++) {
    await page.keyboard.press('Tab');
    const elInfo = await page.evaluate(() => {
      const el = document.activeElement;
      return { html: el.outerHTML, tag: el.tagName.toLowerCase() };
    });
    const key = elInfo.html;
    if (!firstKey) firstKey = key;
    // Cycle detected – focus returned to start after at least one press
    if (key === firstKey && visited.size > 0) {
      return { violations: [], passes: [{ id: 'focus-order-cycling', description: 'Focus order cycles correctly.' }] };
    }
    if (visited.has(key)) {
      const node = { html: elInfo.html, target: [elInfo.tag], failureSummary: '' };
      return {
        violations: [{
          id: 'focus-order-cycling',
          impact: 'serious',
          description: 'Focus trap detected; focus does not cycle.',
          help: 'Ensure a logical, cyclic tab order without traps.',
          helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/focus/F6',
          tags: ['wcag212'],
          nodes: [node]
        }],
        passes: []
      };
    }
    visited.add(key);
  }
  // No cycle within limit – report violation
  return {
    violations: [{
      id: 'focus-order-cycling',
      impact: 'serious',
      description: 'Focus order did not complete a full cycle within limit.',
      help: 'Ensure focus can move through all focusable elements and return to start.',
      helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/focus/F6',
      tags: ['wcag212'],
      nodes: []
    }],
    passes: []
  };
})();

// ---------- Modal Escape Check (WCAG 2.1.2) ----------
const modalCheck = await page.evaluate(() => {
  const violations = [];
  const passes = [];
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog, [aria-modal="true"]'));
  dialogs.forEach(dialog => {
    // Store element that had focus before opening dialog (if any)
    const previous = document.activeElement;
    // Attempt to focus dialog
    if (typeof dialog.focus === 'function') dialog.focus();
    // Simulate Escape key press
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    dialog.dispatchEvent(ev);
    const after = document.activeElement;
    const stillInDialog = dialog.contains(after);
    if (stillInDialog) {
      const node = { html: dialog.outerHTML, target: ['dialog'], failureSummary: '' };
      violations.push({
        id: 'focus-order-cycling',
        impact: 'serious',
        description: 'Escape key does not close modal or restore focus.',
        help: 'Ensure modals close with Escape and focus returns to the opener.',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/focus/F77',
        tags: ['wcag212'],
        nodes: [node]
      });
    } else {
      passes.push({ id: 'focus-order-cycling', description: 'Modal closes with Escape and restores focus.' });
    }
  });
  return { violations, passes };
});

// ---------- Phase 1 – C27: Meaningful Sequence Checks ----------
    const c27 = await page.evaluate(() => {
      const violations = [];
      const passes = [];
      const incomplete = [];

      // 1️⃣ tabindex > 0
      document.querySelectorAll('[tabindex]').forEach(el => {
        const idx = parseInt(el.getAttribute('tabindex'), 10);
        if (idx > 0) {
          violations.push({
            id: 'meaningful-sequence-tabindex',
            impact: 'serious',
            description: 'Element has tabindex > 0, breaking natural DOM reading order.',
            help: 'Remove positive tabindex or rely on DOM order.',
            helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/css/C27',
            tags: ['wcag2aa', 'wcag21aa'],
            nodes: [{ html: el.outerHTML, target: [el.tagName.toLowerCase()], failureSummary: '' }]
          });
        } else {
          passes.push({ id: 'meaningful-sequence-tabindex', description: 'Element respects natural reading order.' });
        }
      });

      // 2️⃣ flex/grid order !== 0
      document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        if ((style.display === 'flex' || style.display === 'grid') && style.order && style.order !== '0') {
          violations.push({
            id: 'meaningful-sequence-css-order',
            impact: 'serious',
            description: 'Flex/Grid child has non‑zero order, changing visual sequence.',
            help: 'Use order: 0 or rely on source order.',
            helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/css/C27',
            tags: ['wcag2aa', 'wcag21aa'],
            nodes: [{ html: el.outerHTML, target: [el.tagName.toLowerCase()], failureSummary: '' }]
          });
        }
      });

      // 3️⃣ position: absolute|fixed on meaningful content
      document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        if ((style.position === 'absolute' || style.position === 'fixed') && el.offsetWidth > 0 && el.offsetHeight > 0) {
          incomplete.push({
            id: 'meaningful-sequence-absolute',
            description: 'Element is positioned absolutely/fixed which may reorder content.',
            help: 'Ensure visual order matches DOM order or flag for manual review.',
            helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/css/C27',
            tags: ['wcag2aa', 'wcag21aa']
          });
        }
      });

      // 4️⃣ grid placement (grid‑row / grid‑column) out of source order
      document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.display === 'grid' && (style.gridRowStart !== 'auto' || style.gridColumnStart !== 'auto')) {
          incomplete.push({
            id: 'meaningful-sequence-grid',
            description: 'Grid item placed via explicit row/column which may diverge from source order.',
            help: 'Prefer natural DOM order or document the intended visual order.',
            helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/css/C27',
            tags: ['wcag2aa', 'wcag21aa']
          });
        }
      });

      return { violations, passes, incomplete };
    });

    // ---------- Phase 2 – C8: Letter‑spacing Check ----------
    const c8 = await page.evaluate(() => {
      const violations = [];
      const passes = [];
      const incomplete = [];

      const spacingRegex = /\w(?:\s{2,}|&nbsp;|&#8203;|&ensp;|&emsp;)\w/;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent) continue;
        const tag = parent.tagName.toLowerCase();
        if (['pre', 'code', 'script', 'style'].includes(tag)) continue;
        const text = node.textContent;
        if (spacingRegex.test(text)) {
          const style = window.getComputedStyle(parent);
          if (style.letterSpacing === 'normal' || style.letterSpacing === '0px') {
            violations.push({
              id: 'meaningful-sequence-letter-spacing',
              impact: 'moderate',
              description: 'Word contains internal spacing characters without explicit letter‑spacing CSS.',
              help: 'Use CSS `letter-spacing` instead of multiple spaces or spacing entities.',
              helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/css/C8',
              tags: ['wcag2aa', 'wcag21aa'],
              nodes: [{ html: parent.outerHTML, target: [tag], failureSummary: '' }]
            });
          } else {
            passes.push({ id: 'meaningful-sequence-letter-spacing', description: 'Spacing characters are compensated by letter‑spacing.' });
          }
        }
      }
      return { violations, passes, incomplete };
    });

// =====================================================================
// PHASE 1 – New DOM-only checks
// =====================================================================

// ---------- Focus Visible Check (WCAG 2.4.7) ----------
const focusVisibleCheck = await (async () => {
  const violations = [];
  const passes = [];
  // Exclude: hidden inputs, inputs with type=hidden, zero-size elements,
  // and elements injected by third-party widgets (Cloudflare, reCAPTCHA, etc.)
  const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex="0"]',
  ].join(', ');

  // Stamp data attributes to uniquely identify elements
  await page.evaluate((sel) => {
    document.querySelectorAll(sel).forEach((el, i) => {
      if (i >= 30) return;
      // Skip zero-size or hidden elements (they can't show a focus indicator)
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
      el.setAttribute('data-fv-idx', i);
    });
  }, focusableSelector);

  const count = await page.$$eval('[data-fv-idx]', els => els.length);

  let anyViolation = false;
  let anyPass = false;
  const violatingNodes = [];

  for (let i = 0; i < count; i++) {
    const sel = `[data-fv-idx="${i}"]`;
    try {
      // Capture unfocused computed styles
      const unfocused = await page.$eval(sel, el => {
        const s = window.getComputedStyle(el);
        return { outline: s.outline, boxShadow: s.boxShadow, border: s.border, html: el.outerHTML, tag: el.tagName.toLowerCase() };
      });

      await page.focus(sel);

      // Capture focused computed styles
      const focused = await page.$eval(sel, el => {
        const s = window.getComputedStyle(el);
        return { outline: s.outline, boxShadow: s.boxShadow, border: s.border };
      });

      const outlineChanged   = focused.outline    !== unfocused.outline    && focused.outline    !== 'none' && !/\b0px\b/.test(focused.outline);
      const shadowChanged    = focused.boxShadow  !== unfocused.boxShadow  && focused.boxShadow  !== 'none';
      const borderChanged    = focused.border     !== unfocused.border;
      const hasVisibleIndicator = outlineChanged || shadowChanged || borderChanged;

      if (hasVisibleIndicator) {
        anyPass = true;
      } else {
        anyViolation = true;
        violatingNodes.push({ html: unfocused.html, target: [unfocused.tag], failureSummary: '' });
      }
    } catch (_) { /* element hidden or stale – skip */ }
  }

  // Clean up stamped attributes
  await page.evaluate(() => {
    document.querySelectorAll('[data-fv-idx]').forEach(el => el.removeAttribute('data-fv-idx'));
  });

  // Report as a single violation (with all failing nodes) or a single pass
  // — not one entry per element — to prevent score inflation.
  if (anyViolation) {
    violations.push({
      id: 'focus-visible',
      impact: 'serious',
      description: 'One or more elements show no visible focus indicator (outline, box-shadow, or border unchanged on :focus).',
      help: 'Add a visible :focus style using outline, box-shadow, or border.',
      helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/focus-visible.html',
      tags: ['wcag21aa', 'wcag247'],
      nodes: violatingNodes,
    });
  } else if (anyPass) {
    passes.push({ id: 'focus-visible', description: 'All interactive elements have a visible focus indicator.' });
  }

  return { violations, passes };
})();

// ---------- Resize Text Check (WCAG 1.4.4) – restores original font-size ----------
const resizeTextCheck = await (async () => {
  const violations = [];
  const passes = [];

  // Capture original font-size before modification
  const originalFontSize = await page.evaluate(() => document.documentElement.style.fontSize || '');

  try {
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });

    const overflow = await page.evaluate(() => ({
      hasHorizontalScroll: document.documentElement.scrollWidth > window.innerWidth,
      hasClippedText: Array.from(document.querySelectorAll('*')).some(el => {
        const s = window.getComputedStyle(el);
        return (s.overflow === 'hidden' || s.overflowX === 'hidden') && el.scrollWidth > el.clientWidth;
      })
    }));

    if (overflow.hasHorizontalScroll || overflow.hasClippedText) {
      violations.push({
        id: 'resize-text',
        impact: 'serious',
        description: 'Text resized to 200% causes horizontal scrolling or content clipping, indicating loss of content or functionality.',
        help: 'Ensure page content is fully readable when text is resized to 200% without horizontal scrollbars or clipping.',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/resize-text.html',
        tags: ['wcag21aa', 'wcag144'],
        nodes: []
      });
    } else {
      passes.push({ id: 'resize-text', description: 'Content remains accessible when text is resized to 200%.' });
    }
  } finally {
    // Always restore the original font-size to avoid side-effects on subsequent checks
    await page.evaluate((orig) => { document.documentElement.style.fontSize = orig; }, originalFontSize);
  }

  return { violations, passes };
})();

// ---------- On-Focus Context Change Check (WCAG 3.2.1) ----------
const onFocusContextChangeCheck = await (async () => {
  const violations = [];
  const passes = [];
  const initialUrl = page.url();
  // Exclude hidden inputs — same reasoning as focus-visible
  const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    '[tabindex="0"]',
  ].join(', ');

  // Stamp elements (limit to 20 to keep runtime reasonable)
  await page.evaluate((sel) => {
    document.querySelectorAll(sel).forEach((el, i) => {
      if (i >= 20) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      el.setAttribute('data-oc-idx', i);
    });
  }, focusableSelector);

  const count = await page.$$eval('[data-oc-idx]', els => els.length);

  let contextChangeFound = false;
  let anyPass = false;
  const violatingNodes = [];

  for (let i = 0; i < count; i++) {
    const sel = `[data-oc-idx="${i}"]`;
    try {
      const elInfo = await page.$eval(sel, el => ({ html: el.outerHTML, tag: el.tagName.toLowerCase() }));
      const dialogsBefore = await page.$$eval('[role="dialog"], dialog[open]', els => els.length);

      await page.focus(sel);
      await new Promise(r => setTimeout(r, 200));

      const currentUrl = page.url();
      const dialogsAfter = await page.$$eval('[role="dialog"], dialog[open]', els => els.length);

      if (currentUrl !== initialUrl) {
        contextChangeFound = true;
        violatingNodes.push({ html: elInfo.html, target: [elInfo.tag], failureSummary: 'Focusing this element triggered a page navigation (URL changed).' });
        // Navigate back before continuing
        await page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        break;
      } else if (dialogsAfter > dialogsBefore) {
        contextChangeFound = true;
        violatingNodes.push({ html: elInfo.html, target: [elInfo.tag], failureSummary: 'Focusing this element opened a dialog.' });
      } else {
        anyPass = true;
      }
    } catch (_) { /* hidden / removed element – skip */ }
  }

  // Clean up
  await page.evaluate(() => {
    document.querySelectorAll('[data-oc-idx]').forEach(el => el.removeAttribute('data-oc-idx'));
  });

  // Report as a single violation with all affected nodes, or a single pass
  if (contextChangeFound) {
    violations.push({
      id: 'on-focus-context-change',
      impact: 'serious',
      description: 'Focusing one or more elements caused an unexpected context change (URL navigation or dialog).',
      help: 'Do not cause context changes (navigation, dialogs) solely from focus events.',
      helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/on-focus.html',
      tags: ['wcag2a', 'wcag321'],
      nodes: violatingNodes,
    });
  } else if (anyPass) {
    passes.push({ id: 'on-focus-context-change', description: 'Focusing elements causes no context change.' });
  }

  return { violations, passes };
})();

// =====================================================================
// PHASE 2 – Heuristic / Partial checks (reported as `incomplete`)
// =====================================================================

// ---------- Orientation Lock Check (WCAG 1.3.4) ----------
const orientationLockCheck = await page.evaluate(() => {
  const violations = [];
  const passes = [];
  const incomplete = [];
  let foundLock = false;

  // Scan stylesheets for orientation media queries that hide content
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.type !== CSSRule.MEDIA_RULE) continue;
        const media = (rule.conditionText || (rule.media && rule.media.mediaText) || '');
        if (!/orientation\s*:\s*(landscape|portrait)/i.test(media)) continue;
        for (const nested of rule.cssRules) {
          const style = nested.style || {};
          if (style.display === 'none' || style.visibility === 'hidden') {
            foundLock = true;
            violations.push({
              id: 'orientation-lock',
              impact: 'serious',
              description: `CSS hides content in "@media (${media})" query, potentially restricting display to one orientation.`,
              help: 'Do not restrict content to a single orientation unless absolutely essential (e.g., piano app).',
              helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/orientation.html',
              tags: ['wcag21aa', 'wcag134'],
              nodes: []
            });
            break;
          }
        }
      }
    } catch (_) { /* cross-origin stylesheet */ }
  }

  // Check inline scripts for screen.orientation.lock() calls
  Array.from(document.querySelectorAll('script:not([src])')).forEach(script => {
    if (/screen\.orientation\.lock\s*\(/.test(script.textContent)) {
      foundLock = true;
      incomplete.push({
        id: 'orientation-lock',
        description: 'Inline script calls screen.orientation.lock() — verify this lock is not applied without essential justification.',
        help: 'Only lock orientation when absolutely essential to the content\'s function.',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/orientation.html'
      });
    }
  });

  if (!foundLock) {
    passes.push({ id: 'orientation-lock', description: 'No orientation lock detected in stylesheets or inline scripts.' });
  }

  return { violations, passes, incomplete };
});

// ---------- Multiple Ways Check (WCAG 2.4.5) ----------
const multipleWaysCheck = await page.evaluate(() => {
  const passes = [];
  const incomplete = [];

  const hasSearch = !!(
    document.querySelector('input[type="search"]') ||
    document.querySelector('[role="search"]') ||
    document.querySelector('form[action*="search"]') ||
    document.querySelector('input[name*="search"]') ||
    document.querySelector('input[placeholder*="earch"]')
  );

  const hasSitemap = Array.from(document.querySelectorAll('a')).some(a =>
    /sitemap/i.test(a.textContent) ||
    /sitemap/i.test(a.getAttribute('href') || '')
  );

  if (hasSearch || hasSitemap) {
    passes.push({ id: 'multiple-ways', description: 'Page provides search or sitemap link — multiple ways to navigate confirmed.' });
  } else {
    incomplete.push({
      id: 'multiple-ways',
      description: 'No search input or sitemap link detected. Single-page scan cannot confirm multiple navigation pathways exist across the site.',
      help: 'Provide at least two ways to locate content: site search, sitemap, navigation menus, related links, etc.',
      helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/multiple-ways.html'
    });
  }

  return { violations: [], passes, incomplete };
});

// ---------- Sensory Characteristics Check (WCAG 1.3.3) – incomplete only ----------
const sensoryCharacteristicsCheck = await page.evaluate(() => {
  const passes = [];
  const incomplete = [];

  // Pattern: sensory adjective followed within 60 chars by a UI element noun
  const sensoryPattern = /\b(red|blue|green|yellow|orange|pink|purple|round|square|circular|triangle|left|right|above|below|top|bottom|corner|shape|colour|color)\b.{0,60}(button|icon|link|field|box|image|picture|element|area|section)/i;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  let node;
  const flagged = new Set();

  while ((node = walker.nextNode())) {
    const text = node.textContent.trim();
    if (text.length < 10) continue;
    const parent = node.parentElement;
    if (!parent || ['SCRIPT', 'STYLE', 'CODE', 'PRE'].includes(parent.tagName)) continue;
    if (flagged.has(parent)) continue;
    if (sensoryPattern.test(text)) {
      flagged.add(parent);
      incomplete.push({
        id: 'sensory-characteristics',
        description: `Text may rely on sensory characteristics: "${text.substring(0, 100).replace(/"/g, "'")}". Verify instructions do not rely solely on shape, colour, size, or location.`,
        help: 'Supplement sensory references (e.g., "the red button") with non-sensory identification (e.g., name, function).',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/sensory-characteristics.html'
      });
    }
  }

  if (incomplete.length === 0) {
    passes.push({ id: 'sensory-characteristics', description: 'No obvious sensory-only instruction patterns detected.' });
  }

  return { violations: [], passes, incomplete };
});

// ---------- Pointer Gestures Check (WCAG 2.5.1) – incomplete only ----------
const pointerGesturesCheck = await page.evaluate(() => {
  const passes = [];
  const incomplete = [];

  const multiTouchPattern = /touches\s*\.\s*length\s*[>=>]\s*[2-9]|e\.touches\[1\]|pointermove.*multitouch|pinch|swipe/i;
  const singlePointerPattern = /\b(click|pointerdown|mousedown|touchstart)\b/i;
  let foundMultiTouch = false;

  Array.from(document.querySelectorAll('script:not([src])')).forEach(script => {
    const content = script.textContent;
    if (!multiTouchPattern.test(content)) return;
    foundMultiTouch = true;
    if (singlePointerPattern.test(content)) {
      passes.push({ id: 'pointer-gestures', description: 'Multi-touch gesture detected alongside an apparent single-pointer handler.' });
    } else {
      incomplete.push({
        id: 'pointer-gestures',
        description: 'Inline script uses multi-touch or pointer gestures (pinch/swipe) without a detected single-pointer alternative.',
        help: 'All functionality using multipoint gestures must also be operable with a single pointer (click/tap).',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/pointer-gestures.html'
      });
    }
  });

  if (!foundMultiTouch) {
    passes.push({ id: 'pointer-gestures', description: 'No multi-touch gesture patterns detected in inline scripts.' });
  }

  return { violations: [], passes, incomplete };
});

// ---------- Timing Adjustable Check (WCAG 2.2.1) ----------
const timingAdjustableCheck = await page.evaluate(() => {
  const violations = [];
  const passes = [];
  const incomplete = [];
  let foundTiming = false;

  // Check <meta http-equiv="refresh"> with a short timeout
  const metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
  if (metaRefresh) {
    const seconds = parseInt((metaRefresh.getAttribute('content') || ''), 10);
    if (!isNaN(seconds) && seconds < 72000) {
      foundTiming = true;
      violations.push({
        id: 'timing-adjustable',
        impact: 'serious',
        description: `Page uses <meta http-equiv="refresh"> with a ${seconds}s timeout. Users cannot extend or disable this time limit.`,
        help: 'Do not use automatic page refresh/redirect under 20 hours, or provide a mechanism to turn off, adjust, or extend the limit.',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/timing-adjustable.html',
        tags: ['wcag2a', 'wcag221'],
        nodes: [{ html: metaRefresh.outerHTML, target: ['meta'], failureSummary: '' }]
      });
    }
  }

  // Scan inline scripts for setTimeout/setInterval with short durations
  const timerRegex = /set(?:Timeout|Interval)\s*\([^,]+,\s*(\d+)/g;
  Array.from(document.querySelectorAll('script:not([src])')).forEach(script => {
    const content = script.textContent;
    let match;
    while ((match = timerRegex.exec(content)) !== null) {
      const ms = parseInt(match[1], 10);
      // Only flag timers under 20 hours that are non-trivial (>= 3 seconds)
      if (ms >= 3000 && ms < 72000000) {
        foundTiming = true;
        incomplete.push({
          id: 'timing-adjustable',
          description: `Script contains a ${ms < 60000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms / 60000) + 'min'} timer (set${match[0].includes('Interval') ? 'Interval' : 'Timeout'}). Verify whether this represents a user-facing time limit requiring adjustability.`,
          help: 'If this timer controls user-facing expiry (session, form, media), ensure users can turn off, adjust, or extend the time limit.',
          helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/timing-adjustable.html'
        });
      }
    }
  });

  if (!foundTiming) {
    passes.push({ id: 'timing-adjustable', description: 'No automatic time limits (meta refresh or significant timers) detected.' });
  }

  return { violations, passes, incomplete };
});

// ---------- Content on Hover or Focus Check (WCAG 1.4.13) ----------
const contentOnHoverCheck = await (async () => {
  const violations = [];
  const passes = [];
  const incomplete = [];

  // Stamp tooltip candidates (limit to 20)
  const candidates = await page.evaluate(() => {
    const sel = '[title], [data-tooltip], [data-tip], [aria-describedby]';
    return Array.from(document.querySelectorAll(sel)).slice(0, 20).map((el, i) => {
      el.setAttribute('data-hov-idx', i);
      return { idx: i, tag: el.tagName.toLowerCase(), html: el.outerHTML };
    });
  });

  for (const candidate of candidates) {
    const sel = `[data-hov-idx="${candidate.idx}"]`;
    try {
      const domBefore = await page.evaluate(() => document.body.innerHTML.length);
      await page.hover(sel);
      await new Promise(r => setTimeout(r, 300));
      const domAfter = await page.evaluate(() => document.body.innerHTML.length);

      if (domAfter > domBefore + 50) {
        // Tooltip-like content appeared – check if it can be dismissed with Escape
        const escapeDismissed = await page.evaluate(() => {
          const before = document.body.innerHTML.length;
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          return document.body.innerHTML.length < before;
        });

        if (escapeDismissed) {
          passes.push({ id: 'content-on-hover', description: 'Hover-triggered content is dismissible via Escape key.' });
        } else {
          violations.push({
            id: 'content-on-hover',
            impact: 'moderate',
            description: 'Content appears on hover but cannot be dismissed with the Escape key.',
            help: 'Tooltip/popup content must be: (1) dismissible without moving pointer, (2) hoverable without disappearing, (3) persistent until dismissed.',
            helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/content-on-hover-or-focus.html',
            tags: ['wcag21aa', 'wcag1413'],
            nodes: [{ html: candidate.html, target: [candidate.tag], failureSummary: '' }]
          });
        }
      }
    } catch (_) { /* hover not possible or element removed */ }
  }

  // Clean up stamped attributes
  await page.evaluate(() => {
    document.querySelectorAll('[data-hov-idx]').forEach(el => el.removeAttribute('data-hov-idx'));
  });

  if (candidates.length === 0) {
    passes.push({ id: 'content-on-hover', description: 'No hover/focus-triggered content candidates found.' });
  }

  return { violations, passes, incomplete };
})();

    // Merge ALL custom results into one object
    const mergedCustom = {
  violations: [
    ...customResult.violations,
    ...videoCheck.violations,
    ...videoTrackCheck.violations,
    ...colorCheck.violations,
    ...focusCheck.violations,
    ...modalCheck.violations,
    ...c27.violations,
    ...c8.violations,
    // Phase 1
    ...nonTextContrastCheck.violations,
    ...errorIdentificationCheck.violations,
    ...focusVisibleCheck.violations,
    ...resizeTextCheck.violations,
    ...onFocusContextChangeCheck.violations,
    // Phase 2 (heuristic – violations only where applicable)
    ...orientationLockCheck.violations,
    ...timingAdjustableCheck.violations,
    ...contentOnHoverCheck.violations,
  ],
  passes: [
    ...customResult.passes,
    ...videoCheck.passes,
    ...videoTrackCheck.passes,
    ...colorCheck.passes,
    ...focusCheck.passes,
    ...modalCheck.passes,
    ...c27.passes,
    ...c8.passes,
    // Phase 1
    ...nonTextContrastCheck.passes,
    ...errorIdentificationCheck.passes,
    ...focusVisibleCheck.passes,
    ...resizeTextCheck.passes,
    ...onFocusContextChangeCheck.passes,
    // Phase 2 (heuristic)
    ...orientationLockCheck.passes,
    ...multipleWaysCheck.passes,
    ...sensoryCharacteristicsCheck.passes,
    ...pointerGesturesCheck.passes,
    ...timingAdjustableCheck.passes,
    ...contentOnHoverCheck.passes,
  ],
  incomplete: [
    ...customResult.incomplete,
    ...c27.incomplete,
    ...c8.incomplete,
    // Phase 1
    ...errorIdentificationCheck.incomplete,
    // Phase 2 (heuristic – all flagged as incomplete)
    ...orientationLockCheck.incomplete,
    ...multipleWaysCheck.incomplete,
    ...sensoryCharacteristicsCheck.incomplete,
    ...pointerGesturesCheck.incomplete,
    ...timingAdjustableCheck.incomplete,
    ...contentOnHoverCheck.incomplete,
  ],
};

    // Extract links for embedded scanning (depth=1)
    const extractedLinks = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const links = [];
      for (const a of anchors) {
        const href = a.getAttribute('href');
        if (!href) continue;
        // Filter out mailto:, tel:, javascript:, and fragment-only links
        const lower = href.toLowerCase();
        if (lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('javascript:')) continue;
        if (lower.startsWith('#')) continue;
        try {
          const url = new URL(href, location.href);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
          // Exclude private/internal hosts
          const host = url.hostname;
          const blocked = ['localhost', '127.', '10.', '192.168.', '172.16.', '0.0.0.0', '::1'];
          if (blocked.some(b => host.startsWith(b))) continue;
          links.push(url.href);
        } catch (e) {
          // Ignore invalid URLs
        }
      }
      return links;
    });

    // Merge custom results with axe results (use full mergedCustom, not just G58/H53)
    const allViolations = results.violations.map(v => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      help: v.help,
      helpUrl: v.helpUrl,
      tags: v.tags,
      nodes: v.nodes.map(n => ({ html: n.html, target: n.target, failureSummary: n.failureSummary })),
    })).concat(mergedCustom.violations);

    // ---------- Capture bounding boxes for each violation node ----------
    const violationsWithBBox = await Promise.all(allViolations.map(async (v, violIdx) => {
      const nodesWithBBox = await Promise.all(v.nodes.map(async (n) => {
        // Use the first CSS selector from target[] to find the element
        const selector = (n.target && n.target[0]) ? n.target[0] : null;
        let bbox = null;
        if (selector) {
          try {
            bbox = await page.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (!el) return null;
              const r = el.getBoundingClientRect();
              const scrollX = window.scrollX || 0;
              const scrollY = window.scrollY || 0;
              return {
                x: Math.round(r.left + scrollX),
                y: Math.round(r.top  + scrollY),
                width:  Math.round(r.width),
                height: Math.round(r.height),
              };
            }, selector);
          } catch (_) { /* ignore */ }
        }
        return { ...n, bbox };
      }));
      return { ...v, violationIndex: violIdx + 1, nodes: nodesWithBBox };
    }));

    // ---------- Full-page screenshot (base64 PNG) ----------
    let screenshotB64 = null;
    try {
      // Scroll back to top before screenshot
      await page.evaluate(() => window.scrollTo(0, 0));
      const screenshotBuf = await page.screenshot({ fullPage: true, type: 'png' });
      screenshotB64 = screenshotBuf.toString('base64');
    } catch (e) {
      console.error('screenshot failed:', e.message);
    }

    // Compute passing node counts for violated rules (total - failing)
    const violatedPassEntries = results.violations
      .map(v => ({
        id: v.id,
        description: '',
        nodeCount: Math.max(0, (ruleNodeTotals[v.id] || 0) - v.nodes.length),
      }))
      .filter(p => p.nodeCount > 0);

    const merged = {
      url: results.url,
      violations: violationsWithBBox,
      passes: results.passes.map(p => ({ id: p.id, description: p.description, nodeCount: p.nodes ? p.nodes.length : 0 })).concat(mergedCustom.passes.map(p => ({ ...p, nodeCount: p.nodeCount || 1 }))).concat(violatedPassEntries),
      incomplete: results.incomplete.map(i => ({ id: i.id, description: i.description, nodeCount: i.nodes ? i.nodes.length : 0 })).concat(mergedCustom.incomplete.map(i => ({ ...i, nodeCount: i.nodeCount || 0 }))),
      links: extractedLinks,
      screenshot: screenshotB64,
    };

    console.log(JSON.stringify(merged));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message || String(err), stack: err.stack }));
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
