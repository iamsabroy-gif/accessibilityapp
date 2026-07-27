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

        // Capture visible screenshot
        let screenshotB64 = null;
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
          if (dataUrl) {
            screenshotB64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
          }
        } catch (err) {
          console.warn('Screenshot capture skipped:', err.message);
        }

        const payload = {
          url: rawScan.url || tab.url,
          violations: rawScan.violations || [],
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

        const scanResult = await response.json();
        sendResponse({ success: true, result: scanResult });
      } catch (err) {
        sendResponse({ success: false, error: err.message || String(err) });
      }
    })();
    return true; // async response
  }
});
