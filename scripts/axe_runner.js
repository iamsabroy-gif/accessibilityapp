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
 *   These checks run after axe.run() using native DOM APIs and are merged
 *   into the standard `violations`, `passes`, and `incomplete` arrays.
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

    // ---------- Color‑Only State Indicator Check (WCAG 1.4.1) ----------
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
    document.querySelectorAll(sel).forEach(el => {
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
// ---------- Focus Order Check (WCAG 2.1.2) ----------
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

// ---------- Modal Escape Check (WCAG 2.1.2) ----------
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

// ---------- Phase 1 – C27: Meaningful Sequence Checks ----------
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

    // ---------- Phase 2 – C8: Letter‑spacing Check ----------
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

    // Merge all custom results
    const mergedCustom = {
  violations: customResult.violations.concat(focusCheck.violations, modalCheck.violations, c27.violations, c8.violations),
  passes: customResult.passes.concat(focusCheck.passes, modalCheck.passes, c27.passes, c8.passes),
  incomplete: customResult.incomplete.concat(c27.incomplete, c8.incomplete),
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

    // Merge custom results with axe results
    const allViolations = results.violations.map(v => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      help: v.help,
      helpUrl: v.helpUrl,
      tags: v.tags,
      nodes: v.nodes.map(n => ({ html: n.html, target: n.target, failureSummary: n.failureSummary })),
    })).concat(custom.violations);

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

    const merged = {
      url: results.url,
      violations: violationsWithBBox,
      passes: results.passes.map(p => ({ id: p.id, description: p.description })).concat(custom.passes),
      incomplete: results.incomplete.map(i => ({ id: i.id, description: i.description })).concat(custom.incomplete),
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
