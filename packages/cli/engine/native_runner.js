#!/usr/bin/env node
/**
 * native_runner.js
 *
 * Runs the Native Accessibility Validation Engine against a given URL 
 * using Puppeteer (headless Chrome) and writes a JSON result to stdout.
 *
 * Usage:
 *   node native_runner.js <url> [wcag_level]
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const [,, url, wcagLevel = 'AA'] = process.argv;

if (!url) {
  console.log(JSON.stringify({ error: 'URL argument is required' }));
  process.exit(1);
}

(async () => {
  let browser;
  try {
    let execPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';
    if (!process.env.CHROMIUM_PATH && process.platform === 'darwin') {
      execPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    }

    browser = await puppeteer.launch({
      executablePath: execPath,
      headless: 'new',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--js-flags=--max-old-space-size=256'
      ],
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setDefaultTimeout(180000);
    await page.setBypassCSP(true);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    } catch (_) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.log(JSON.stringify({ error: 'page navigation failed', details: e.message }));
        process.exit(1);
      }
    }

    // Inject Native Engine
    const engineSrc = fs.readFileSync(path.join(__dirname, 'native_engine.js'), 'utf8');
    await page.evaluate(engineSrc);

    // Load rules
    const rulesDir = path.join(__dirname, 'rules');
    const domRules = [];
    const puppeteerRules = [];

    if (fs.existsSync(rulesDir)) {
      const files = fs.readdirSync(rulesDir);
      for (const file of files) {
        if (file.endsWith('.js')) {
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
              evaluateStr: rule.evaluate.toString()
            });
          }
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
          evaluate: fn
        });
      }
    }, domRules);

    // Execute Native Engine (DOM rules)
    const results = await page.evaluate(() => {
      return window.NativeEngine.run();
    });

    // Execute Puppeteer rules
    for (const rule of puppeteerRules) {
      try {
        const res = await rule.evaluate(page);
        if (res.violations) results.violations.push(...res.violations);
        if (res.passes) results.passes.push(...res.passes);
        if (res.incomplete) results.incomplete.push(...res.incomplete);
      } catch (e) {
        console.error("Puppeteer rule error in " + rule.id, e);
      }
    }

    // Extract links for embedded scanning
    const extractedLinks = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const links = [];
      for (const a of anchors) {
        const href = a.getAttribute('href');
        if (!href) continue;
        const lower = href.toLowerCase();
        if (lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('javascript:')) continue;
        if (lower.startsWith('#')) continue;
        try {
          const url = new URL(href, location.href);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
          const host = url.hostname;
          const blocked = ['localhost', '127.', '10.', '192.168.', '172.16.', '0.0.0.0', '::1'];
          if (blocked.some(b => host.startsWith(b))) continue;
          links.push(url.href);
        } catch (e) {
        }
      }
      return links;
    });

    // Capture bounding boxes for each violation node
    const violationsWithBBox = await Promise.all(results.violations.map(async (v, violIdx) => {
      const nodesWithBBox = await Promise.all(v.nodes.map(async (n) => {
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
          } catch (_) {}
        }
        return { ...n, bbox };
      }));
      return { ...v, violationIndex: violIdx + 1, nodes: nodesWithBBox };
    }));

    let screenshotB64 = null;
    try {
      await page.evaluate(() => window.scrollTo(0, 0));
      const screenshotBuf = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 70 });
      screenshotB64 = Buffer.from(screenshotBuf).toString('base64');
    } catch (e) {
      console.error('screenshot failed:', e.message);
    }

    const merged = {
      url: url,
      violations: violationsWithBBox,
      passes: results.passes,
      incomplete: results.incomplete,
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
