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
    });

    const page = await browser.newPage();

    // Set a realistic viewport and user agent
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

    // Inject axe-core from the installed package
    const axeSource = fs.readFileSync(
      require.resolve('axe-core/axe.min.js'),
      'utf8'
    );
    await page.evaluate(axeSource);

    // Run the standard axe audit
    const results = await page.evaluate(async (tags) => {
      return await axe.run(document, {
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

    // Merge custom results with axe results
    const merged = {
      url: results.url,
      violations: results.violations.map(v => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        tags: v.tags,
        nodes: v.nodes.map(n => ({ html: n.html, target: n.target, failureSummary: n.failureSummary })),
      })).concat(custom.violations),
      passes: results.passes.map(p => ({ id: p.id, description: p.description })).concat(custom.passes),
      incomplete: results.incomplete.map(i => ({ id: i.id, description: i.description })).concat(custom.incomplete),
    };

    console.log(JSON.stringify(merged));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message || String(err) }));
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
