/**
 * scan.js — Core scan module for the CLI.
 *
 * Wraps native_runner logic as an importable scan(url, opts) function.
 * This does NOT shell out to native_runner.js — it reimplements the scan
 * flow directly so we can control output, error handling, and exit semantics.
 *
 * IMPORTANT: Engine files in engine/ are verbatim copies and must NOT be
 * bundled/minified. native_runner.js serializes evaluate() via .toString()
 * and reads native_engine.js from disk at runtime.
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const ENGINE_DIR = path.join(__dirname, '..', 'engine');
const WCAG_MAP_PATH = path.join(__dirname, '..', 'wcag_map.json');

/**
 * Load the WCAG map data (rules → SC numbers, SC → levels).
 * @returns {{ rules: Object<string, string[]>, sc_levels: Object<string, string> }}
 */
function loadWcagMap() {
  const raw = fs.readFileSync(WCAG_MAP_PATH, 'utf8');
  return JSON.parse(raw);
}

/**
 * Filter violations based on WCAG conformance level.
 * A rule is in-scope if ANY of its mapped SC numbers are at or below the requested level.
 * Level ordering: A < AA < AAA.
 *
 * @param {Array} violations - Array of violation objects with `id` field.
 * @param {string} wcagLevel - 'A', 'AA', or 'AAA'.
 * @param {Object} wcagMap - The loaded wcag_map.json data.
 * @returns {Array} Filtered violations.
 */
function filterByWcagLevel(violations, wcagLevel, wcagMap) {
  const levelOrder = { 'A': 1, 'AA': 2, 'AAA': 3 };
  const maxLevel = levelOrder[wcagLevel.toUpperCase()] || 2; // default AA

  return violations.filter(v => {
    const scNumbers = wcagMap.rules[v.id];
    if (!scNumbers || scNumbers.length === 0) {
      // If a rule isn't in the WCAG map, include it conservatively
      return true;
    }
    // Include if ANY mapped SC is at or below the requested level
    return scNumbers.some(sc => {
      const scLevel = wcagMap.sc_levels[sc];
      if (!scLevel) return true; // Unknown SC → include conservatively
      return levelOrder[scLevel] <= maxLevel;
    });
  });
}

/**
 * Resolve the Chromium executable path.
 * @returns {string} Path to Chromium/Chrome binary.
 */
function resolveChromiumPath() {
  if (process.env.CHROMIUM_PATH) {
    return process.env.CHROMIUM_PATH;
  }
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return '/usr/bin/chromium-browser';
}

/**
 * Run an accessibility scan against a URL.
 *
 * @param {string} url - The URL to scan.
 * @param {Object} opts - Options.
 * @param {string} [opts.wcagLevel='AA'] - WCAG conformance level filter (A, AA, AAA).
 * @param {number} [opts.timeout=180] - Page navigation timeout in seconds.
 * @returns {Promise<{url: string, violations: Array, passes: Array, incomplete: Array, error?: string}>}
 */
async function scan(url, opts = {}) {
  const { wcagLevel = 'AA', timeout = 180 } = opts;
  let browser;

  try {
    const execPath = resolveChromiumPath();

    browser = await puppeteer.launch({
      executablePath: execPath,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--js-flags=--max-old-space-size=256',
      ],
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setDefaultTimeout(timeout * 1000);
    await page.setBypassCSP(true);

    // Navigate with fallback
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    } catch (_) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        return {
          url,
          violations: [],
          passes: [],
          incomplete: [],
          error: `Page navigation failed: ${e.message}`,
        };
      }
    }

    // Inject the native engine
    const engineSrc = fs.readFileSync(path.join(ENGINE_DIR, 'native_engine.js'), 'utf8');
    await page.evaluate(engineSrc);

    // Load DOM and puppeteer rules
    const rulesDir = path.join(ENGINE_DIR, 'rules');
    const domRules = [];
    const puppeteerRules = [];

    if (fs.existsSync(rulesDir)) {
      const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.js'));
      for (const file of files) {
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

    // Inject DOM rules into the browser NativeEngine
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

    // Run DOM rules
    const results = await page.evaluate(() => window.NativeEngine.run());

    // Run puppeteer rules
    for (const rule of puppeteerRules) {
      try {
        const res = await rule.evaluate(page);
        if (res.violations) results.violations.push(...res.violations);
        if (res.passes) results.passes.push(...res.passes);
        if (res.incomplete) results.incomplete.push(...res.incomplete);
      } catch (e) {
        // Log puppeteer rule errors as incomplete
        results.incomplete.push({
          id: rule.id,
          description: `Puppeteer rule error: ${e.message}`,
          nodeCount: 0,
        });
      }
    }

    // Apply WCAG level filter
    const wcagMap = loadWcagMap();
    const filteredViolations = filterByWcagLevel(results.violations, wcagLevel, wcagMap);
    const filteredIncomplete = filterByWcagLevel(results.incomplete, wcagLevel, wcagMap);

    return {
      url,
      violations: filteredViolations,
      passes: results.passes,
      incomplete: filteredIncomplete,
    };
  } catch (err) {
    return {
      url,
      violations: [],
      passes: [],
      incomplete: [],
      error: err.message || String(err),
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { scan, loadWcagMap, filterByWcagLevel };
