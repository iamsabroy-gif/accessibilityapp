/**
 * Background Service Worker for Web Accessibility Scanner Chrome Extension
 */

const DEFAULT_API_BASE = 'https://www.accessscan.in';

async function getApiBaseUrl() {
  const data = await chrome.storage.local.get(['apiBaseUrl']);
  return data.apiBaseUrl || DEFAULT_API_BASE;
}

async function ensureToken(apiBase) {
  const data = await chrome.storage.local.get(['authToken', 'tokenExp']);
  const now = Math.floor(Date.now() / 1000);
  if (data.authToken && data.tokenExp && (data.tokenExp - now > 60)) {
    return data.authToken;
  }

  const res = await fetch(`${apiBase}/api/v1/session`, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Failed to obtain guest session token from server (${res.status})`);
  }
  const body = await res.json();
  const token = body.token;
  const expiresIn = body.expires_in || 1200;
  const tokenExp = now + expiresIn;

  await chrome.storage.local.set({ authToken: token, tokenExp: tokenExp });
  return token;
}

// ─── Full-page screenshot ─────────────────────────────────────
// Chrome only captures the visible part of a tab, so the page is scrolled one
// viewport at a time and the captures are stitched into a single image. The
// image is drawn at CSS-pixel size so that violation bounding boxes line up
// with it on any display density.

// Pages taller than this are clipped (matches the server-side scanner).
const MAX_SCREENSHOT_HEIGHT = 10000;
// Chrome allows at most 2 captureVisibleTab calls per second.
const CAPTURE_INTERVAL_MS = 550;

// Time of the most recent capture, shared across scans so that two scans in
// quick succession still respect the rate limit.
let lastCapture = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function inPage(tabId, func, args = []) {
  const res = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res && res[0] ? res[0].result : undefined;
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Capture the whole page of a tab as one JPEG.
 * @returns {Promise<{base64: string, height: number}>} image data and its height in CSS pixels
 */
async function captureFullPage(tab) {
  const metrics = await inPage(tab.id, () => {
    const de = document.documentElement;
    const body = document.body;
    const state = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      fullHeight: Math.max(de.scrollHeight, body ? body.scrollHeight : 0, window.innerHeight),
    };
    // Remember and disable smooth scrolling so each scroll lands immediately.
    window.__a11yScanPrevScrollBehavior = de.style.scrollBehavior;
    de.style.scrollBehavior = 'auto';
    return state;
  });
  if (!metrics || !metrics.viewportWidth || !metrics.viewportHeight) {
    throw new Error('Could not measure the page');
  }

  const { viewportWidth: vw, viewportHeight: vh } = metrics;
  const totalHeight = Math.min(metrics.fullHeight, MAX_SCREENSHOT_HEIGHT);
  const canvas = new OffscreenCanvas(vw, totalHeight);
  const ctx = canvas.getContext('2d');

  try {
    for (let y = 0, first = true; y < totalHeight; y += vh, first = false) {
      // The last slice is aligned to the bottom of the page rather than scrolled past it.
      const target = Math.max(0, Math.min(y, metrics.fullHeight - vh));
      const actualY = await inPage(tab.id, (top) => {
        window.scrollTo(0, top);
        return window.scrollY;
      }, [target]);

      if (!first && y === vh) {
        // After the first slice, hide fixed and sticky elements (headers, cookie
        // bars, chat buttons) so they are not repeated in every slice.
        await inPage(tab.id, () => {
          const hidden = [];
          for (const el of document.querySelectorAll('body *')) {
            const pos = getComputedStyle(el).position;
            if (pos === 'fixed' || pos === 'sticky') {
              hidden.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
              el.style.setProperty('visibility', 'hidden', 'important');
            }
          }
          window.__a11yScanHidden = hidden;
        });
      }

      // Let the page paint, and stay under Chrome's capture rate limit.
      const wait = Math.max(150, CAPTURE_INTERVAL_MS - (Date.now() - lastCapture));
      await sleep(wait);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
      lastCapture = Date.now();

      const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
      ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, actualY, vw, vh);
      bitmap.close();
    }
  } finally {
    // Put the page back exactly as it was.
    await inPage(tab.id, (x, yPos) => {
      for (const [el, value, priority] of window.__a11yScanHidden || []) {
        if (value) el.style.setProperty('visibility', value, priority);
        else el.style.removeProperty('visibility');
      }
      delete window.__a11yScanHidden;
      window.scrollTo(x, yPos);
      document.documentElement.style.scrollBehavior = window.__a11yScanPrevScrollBehavior || '';
      delete window.__a11yScanPrevScrollBehavior;
    }, [metrics.scrollX, metrics.scrollY]).catch(() => {});
  }

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  return { base64: await blobToBase64(blob), height: totalHeight };
}

// Fallback: capture only the visible part of the tab.
async function captureVisibleOnly(tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
  return dataUrl ? dataUrl.replace(/^data:image\/jpeg;base64,/, '') : null;
}

// ─── Scan ─────────────────────────────────────────────────────

async function scanTab(tab) {
  if (!tab || !tab.id) {
    throw new Error('No active tab found');
  }

  const apiBase = await getApiBaseUrl();
  const token = await ensureToken(apiBase);

  // Inject content bundle
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content/engine.bundle.js']
  });

  // Run client-side evaluation
  const evalResults = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      if (typeof window.__runNativeEngineScan === 'function') {
        return window.__runNativeEngineScan();
      }
      throw new Error('Native Engine runner is missing');
    }
  });

  if (!evalResults || !evalResults[0] || !evalResults[0].result) {
    throw new Error('Failed to retrieve scan results from page');
  }

  const rawScan = evalResults[0].result;
  const violations = rawScan.violations || [];

  // Full-page screenshot; fall back to the visible area if stitching fails.
  let screenshotB64 = null;
  try {
    const shot = await captureFullPage(tab);
    screenshotB64 = shot.base64;
    // Drop boxes that fall below a clipped screenshot.
    for (const v of violations) {
      for (const n of v.nodes || []) {
        if (n.bbox && n.bbox.y + n.bbox.height > shot.height) delete n.bbox;
      }
    }
  } catch (err) {
    console.warn('Full-page screenshot failed, using visible area:', err.message);
    try {
      await sleep(Math.max(0, CAPTURE_INTERVAL_MS - (Date.now() - lastCapture)));
      screenshotB64 = await captureVisibleOnly(tab);
      lastCapture = Date.now();
    } catch (err2) {
      console.warn('Screenshot capture skipped:', err2.message);
    }
  }

  const payload = {
    url: rawScan.url || tab.url,
    violations,
    passes: rawScan.passes || [],
    incomplete: rawScan.incomplete || [],
    links: rawScan.links || [],
    screenshot: screenshotB64
  };

  const response = await fetch(`${apiBase}/api/v1/scan/client`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error || `Server responded with status ${response.status}`);
  }

  return response.json();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'GET_CONFIG') {
    getApiBaseUrl().then(url => sendResponse({ apiBaseUrl: url }));
    return true;
  }

  if (message.action === 'SET_CONFIG') {
    chrome.storage.local.set({ apiBaseUrl: message.apiBaseUrl }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'SCAN_PAGE') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const scanResult = await scanTab(tab);
        sendResponse({ success: true, result: scanResult });
      } catch (err) {
        sendResponse({ success: false, error: err.message || String(err) });
      }
    })();
    return true; // async response
  }
});
