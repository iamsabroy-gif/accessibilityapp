#!/usr/bin/env node
/**
 * native_runner.js
 *
 * Runs the Native Accessibility Validation Engine against a given URL
 * using Puppeteer (headless Chrome) and writes a JSON result to stdout.
 *
 * One scan per process. The server normally uses scan_worker.js instead,
 * which keeps one browser alive across scans; this script is the fallback
 * and the manual entry point.
 *
 * Usage:
 *   node native_runner.js <url> [wcag_level]
 */

const { launchBrowser, scanPage } = require('./native_scan');

const [,, url] = process.argv;

if (!url) {
  console.log(JSON.stringify({ error: 'URL argument is required' }));
  process.exit(1);
}

(async () => {
  let browser;
  let exitCode = 0;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    const result = await scanPage(page, url);
    console.log(JSON.stringify(result));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message || String(err), stack: err.stack }));
    exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  process.exit(exitCode);
})();
