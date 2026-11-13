/**
 * native_scan.js
 *
 * Shared scan logic for the Native Accessibility Validation Engine.
 * Used by both native_runner.js (one scan per process) and scan_worker.js
 * (long-lived process that reuses one browser across scans).
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

// Screenshots taller than this are clipped, which keeps the response size and
// Chromium's memory use bounded on very long pages.
const MAX_SCREENSHOT_HEIGHT = 10000;

const NAV_TIMEOUT_MS = 30000;
const NETWORK_IDLE_TIMEOUT_MS = 10000;

function resolveChromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return '/usr/bin/chromium-browser';
}

function launchBrowser() {
  return puppeteer.launch({
    executablePath: resolveChromiumPath(),
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--js-flags=--max-old-space-size=256',
    ],
    // puppeteer-core >= 23 uses acceptInsecureCerts; older versions use ignoreHTTPSErrors.
    acceptInsecureCerts: true,
    ignoreHTTPSErrors: true,
  });
}

// Rules are read from disk once per process.
let cachedRules = null;
let cachedEngineSrc = null;

function loadRules() {
  if (cachedRules) return cachedRules;
  const rulesDir = path.join(__dirname, 'rules');
  const domRules = [];
  const puppeteerRules = [];
  if (fs.existsSync(rulesDir)) {
    for (const file of fs.readdirSync(rulesDir).sort()) {
      if (!file.endsWith('.js')) continue;
      const rule = require(path.join(rulesDir, file));
      if (rule.type === 'puppeteer') {
        puppeteerRules.push(rule);
      } else {
        domRules.push({
          id: rule.id,
          impact: rule.impact || 'serious',
          description: rule.description,
          help: rule.help,
          helpUrl: rule.helpUrl,
          tags: rule.tags,
          evaluateStr: rule.evaluate.toString(),
        });
      }
    }
  }
  cachedRules = { domRules, puppeteerRules };
  return cachedRules;
}

function loadEngineSrc() {
  if (!cachedEngineSrc) {
    cachedEngineSrc = fs.readFileSync(path.join(__dirname, 'native_engine.js'), 'utf8');
  }
  return cachedEngineSrc;
}

/**
 * Scan one URL on an already-open page.
 * Resolves with the raw result object; rejects if the page cannot be loaded.
 */
async function scanPage(page, url) {
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  page.setDefaultTimeout(180000);
  await page.setBypassCSP(true);

  // Wait for the DOM, then give the network a bounded time to go quiet.
  // Pages that never go idle (analytics, chat widgets, polling) no longer
  // cost a full navigation timeout plus a second navigation.
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  } catch (e) {
    const err = new Error('page navigation failed: ' + e.message);
    err.navigation = true;
    throw err;
  }
  await page
    .waitForNetworkIdle({ idleTime: 500, concurrency: 2, timeout: NETWORK_IDLE_TIMEOUT_MS })
    .catch(() => {});

  const { domRules, puppeteerRules } = loadRules();

  await page.evaluate(loadEngineSrc());

  await page.evaluate((rules) => {
    for (const r of rules) {
      let fn;
      eval(`fn = ${r.evaluateStr}`);
      window.NativeEngine.addRule({
        id: r.id,
        impact: r.impact,
        description: r.description,
        help: r.help,
        helpUrl: r.helpUrl,
        tags: r.tags,
        evaluate: fn,
      });
    }
  }, domRules);

  const results = await page.evaluate(() => window.NativeEngine.run());

  for (const rule of puppeteerRules) {
    try {
      const res = await rule.evaluate(page);
      if (res.violations) results.violations.push(...res.violations);
      if (res.passes) results.passes.push(...res.passes);
      if (res.incomplete) results.incomplete.push(...res.incomplete);
    } catch (e) {
      // A crashed rule is reported as incomplete so its success criterion is
      // not silently treated as untested (same behaviour as DOM rules).
      console.error('Puppeteer rule error in ' + rule.id, e);
      results.incomplete.push({
        id: rule.id,
        description: 'Rule execution failed: ' + (e && e.message ? e.message : String(e)),
        nodeCount: 0,
      });
    }
  }

  const extractedLinks = await page.evaluate(() => {
    const links = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!href) continue;
      const lower = href.toLowerCase();
      if (lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('javascript:')) continue;
      if (lower.startsWith('#')) continue;
      try {
        const u = new URL(href, location.href);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
        links.push(u.href);
      } catch (e) {}
    }
    return links;
  });

  // Page dimensions decide whether the screenshot has to be clipped.
  await page.evaluate(() => window.scrollTo(0, 0));
  const dims = await page.evaluate(() => ({
    width: Math.max(document.documentElement.scrollWidth, window.innerWidth),
    height: Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
      window.innerHeight
    ),
  }));
  const shotHeight = Math.min(dims.height, MAX_SCREENSHOT_HEIGHT);

  // Bounding boxes for every violation node, in one browser round-trip.
  const selectors = results.violations.map(v =>
    v.nodes.map(n => (n.target && n.target[0]) ? n.target[0] : null)
  );
  let boxes = [];
  try {
    boxes = await page.evaluate((sels) => {
      const scrollX = window.scrollX || 0;
      const scrollY = window.scrollY || 0;
      return sels.map(group => group.map(sel => {
        if (!sel) return null;
        try {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            x: Math.round(r.left + scrollX),
            y: Math.round(r.top + scrollY),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        } catch (e) {
          return null;
        }
      }));
    }, selectors);
  } catch (e) {
    console.error('bbox capture failed:', e.message);
  }

  const violations = results.violations.map((v, vi) => ({
    ...v,
    violationIndex: vi + 1,
    nodes: v.nodes.map((n, ni) => {
      let bbox = (boxes[vi] && boxes[vi][ni]) || null;
      // Drop boxes that fall outside a clipped screenshot.
      if (bbox && bbox.y + bbox.height > shotHeight) bbox = null;
      return { ...n, bbox };
    }),
  }));

  let screenshot = null;
  try {
    const opts = { type: 'jpeg', quality: 70 };
    if (dims.height > MAX_SCREENSHOT_HEIGHT) {
      opts.clip = { x: 0, y: 0, width: dims.width, height: MAX_SCREENSHOT_HEIGHT };
      opts.captureBeyondViewport = true;
    } else {
      opts.fullPage = true;
    }
    const buf = await page.screenshot(opts);
    screenshot = Buffer.from(buf).toString('base64');
  } catch (e) {
    console.error('screenshot failed:', e.message);
  }

  return {
    url,
    violations,
    passes: results.passes,
    incomplete: results.incomplete,
    links: extractedLinks,
    screenshot,
  };
}

module.exports = { launchBrowser, scanPage, loadRules, MAX_SCREENSHOT_HEIGHT };
