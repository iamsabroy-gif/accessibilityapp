#!/usr/bin/env node
/**
 * scan_worker.js
 *
 * Long-lived scan process. Keeps one headless browser open and runs each scan
 * in its own isolated browser context, so the server does not pay for a Node
 * and Chromium start-up on every scan.
 *
 * Protocol: one JSON object per line.
 *   stdin:   {"id":"1","url":"https://example.com"}   start a scan
 *            {"id":"2","pdfHtml":"<html>..."}          render HTML to PDF
 *            {"id":"1","cancel":true}                 abort a running scan
 *   stdout:  {"id":"1","result":{...}}                scan finished
 *            {"id":"2","result":{"pdf":"<base64>"}}    PDF rendered
 *            {"id":"1","error":"..."}                 scan failed
 *
 * The process exits when stdin closes (i.e. when the server stops).
 */

const readline = require('readline');
const { launchBrowser, scanPage } = require('./native_scan');

// Restart the browser after this many scans to keep its memory bounded.
const RECYCLE_AFTER = parseInt(process.env.SCAN_WORKER_RECYCLE_AFTER || '50', 10);

// stdout carries the protocol only; anything else goes to stderr.
const out = process.stdout;
console.log = (...args) => console.error(...args);

function send(msg) {
  out.write(JSON.stringify(msg) + '\n');
}

let browserPromise = null;
let scansOnBrowser = 0;
let active = 0;
const running = new Map(); // id -> browser context
const cancelled = new Set(); // ids cancelled before their context existed

async function getBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.connected) return b;
    browserPromise = null;
  }
  scansOnBrowser = 0;
  browserPromise = launchBrowser();
  return browserPromise;
}

async function recycleIfDue() {
  if (active !== 0 || scansOnBrowser < RECYCLE_AFTER || !browserPromise) return;
  const old = browserPromise;
  browserPromise = null;
  const b = await old.catch(() => null);
  if (b) await b.close().catch(() => {});
}

const pending = new Set(); // ids accepted and not yet finished

// Render an HTML document to an A4 PDF (same settings as pdf_generator.js).
async function renderPdf(page, html) {
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const buf = await page.pdf({
    format: 'A4',
    margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
    printBackground: true,
  });
  return { pdf: Buffer.from(buf).toString('base64') };
}

// Run one job (a scan or a PDF render) in its own browser context.
async function handleJob(id, job) {
  active++;
  pending.add(id);
  let context;
  try {
    const browser = await getBrowser();
    scansOnBrowser++;
    context = await browser.createBrowserContext();
    if (cancelled.has(id)) throw new Error('scan cancelled');
    running.set(id, context);
    const page = await context.newPage();
    const result = job.pdfHtml !== undefined
      ? await renderPdf(page, job.pdfHtml)
      : await scanPage(page, job.url);
    send({ id, result });
  } catch (err) {
    send({ id, error: (err && err.message) || String(err) });
  } finally {
    running.delete(id);
    cancelled.delete(id);
    pending.delete(id);
    if (context) await context.close().catch(() => {});
    active--;
    recycleIfDue().catch(() => {});
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    return;
  }
  if (!msg || !msg.id) return;
  if (msg.cancel) {
    // Closing the context makes the in-flight scan reject, which reports the error.
    const ctx = running.get(msg.id);
    if (ctx) ctx.close().catch(() => {});
    else if (pending.has(msg.id)) cancelled.add(msg.id);
    return;
  }
  if (typeof msg.pdfHtml === 'string') {
    handleJob(msg.id, { pdfHtml: msg.pdfHtml });
    return;
  }
  if (!msg.url) {
    send({ id: msg.id, error: 'URL argument is required' });
    return;
  }
  handleJob(msg.id, { url: msg.url });
});

async function shutdown() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b) await b.close().catch(() => {});
  }
  process.exit(0);
}

rl.on('close', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
