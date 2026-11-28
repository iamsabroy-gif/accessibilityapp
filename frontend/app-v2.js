/**
 * Web Accessibility Scanner — App Logic
 *
 * Auth model:
 *   - Regular users: GET /api/v1/session → auto-issued JWT, fully transparent
 *   - Admin: 5-click dot → password prompt → POST /api/v1/admin/verify → settings panel
 *
 * The JWT_SECRET never leaves the server. Users need no credentials to scan.
 */

// ─── Constants ────────────────────────────────────────────────
const DEFAULT_API_BASE  = 'https://www.accessscan.in';
const LS_KEY_TOKEN      = 'wacs_token';
const LS_KEY_TOKEN_EXP  = 'wacs_token_exp';
const LS_KEY_TOKEN_KIND = 'wacs_token_kind';        // 'guest' or 'user'
const LS_KEY_SCAN_MODE   = 'wacs_scan_mode'; // 'parallel' or 'serial'

// Token refresh buffer — refresh when less than this time remains (ms)
const TOKEN_REFRESH_BUFFER_MS = 3 * 60 * 1000; // 3 minutes

// Admin unlock: 5 clicks within 3 s on the tiny dot
let adminClickCount = 0;
let adminClickTimer = null;

// ─── State ────────────────────────────────────────────────────
const state = {
  view: 'hero',
  accessApprovalEnabled: false,   // from GET /api/v1/
  infoReady: Promise.resolve(),
  scanResult: null,
  token: null,
  tokenExp: null,
  userEmail: null,
  scansLeft: null,
  adminUnlocked: false,
  adminToken: null,
  coverageEntries: [],
  previousView: 'hero',
};

// ─── DOM refs ─────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ─── Utility ──────────────────────────────────────────────────
function apiBase() {
  if (window.location.protocol === 'file:') {
    return DEFAULT_API_BASE;
  }
  return window.location.origin;
}

function getScanMode() {
  return localStorage.getItem(LS_KEY_SCAN_MODE) || 'serial';
}


function showToast(msg, type = 'info', sticky = false) {
  const container = document.getElementById('toast-container');
  if (!container) return null;
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  if (type === 'info') {
    toast.innerHTML = `<div class="spinner"></div><span>${msg}</span>`;
  } else {
    toast.innerHTML = `<span>${msg}</span>`;
  }
  
  container.appendChild(toast);
  
  if (!sticky) {
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
  
  return {
    hide: () => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    },
    update: (newMsg, newType) => {
      toast.className = `toast toast-${newType}`;
      toast.innerHTML = `<span>${newMsg}</span>`;
    }
  };
}

function showError(msg, clickHandler) {
  const banner  = $('error-banner');
  const msgEl   = $('error-msg');
  msgEl.textContent = msg;
  banner.classList.remove('hidden');
  if (clickHandler) {
    banner.style.cursor = 'pointer';
    banner.title = 'Click to open settings';
    banner.onclick = clickHandler;
  } else {
    banner.style.cursor = '';
    banner.title = '';
    banner.onclick = null;
  }
  setTimeout(() => banner.classList.add('hidden'), 10000);
}

function hideError() {
  $('error-banner').classList.add('hidden');
}

function setView(v) {
  if (v === 'coverage' && state.view !== 'coverage') state.previousView = state.view;
  state.view = v;
  $('hero-view').classList.toggle('hidden',    v !== 'hero');
  $('loading-view').classList.toggle('hidden', v !== 'loading');
  $('results-view').classList.toggle('hidden', v !== 'results');
  $('coverage-view').classList.toggle('hidden', v !== 'coverage');
}

async function showCoverage() {
  setView('coverage');
  $('coverage-loading').classList.remove('hidden');
  $('coverage-error').classList.add('hidden');
  $('coverage-content').classList.add('hidden');
  try {
    const res = await fetch(`${apiBase()}/api/v1/coverage`);
    const report = await res.json();
    if (!res.ok) throw new Error(report.error || 'Coverage report could not be loaded');
    state.coverageEntries = report.entries || [];
    $('coverage-subtitle').textContent = report.title || 'Current scanner coverage by success criterion.';
    $('coverage-implemented').textContent = report.implemented || 0;
    $('coverage-partial').textContent = report.partial || 0;
    $('coverage-missing').textContent = report.not_implemented || 0;
    $('coverage-total').textContent = state.coverageEntries.length;
    $('coverage-updated').textContent = `Source: ${report.filename || 'coverage report'} · Updated ${new Date(report.updated_at).toLocaleString()}`;
    renderCoverageRows();
    $('coverage-content').classList.remove('hidden');
  } catch (err) {
    $('coverage-error').textContent = err.message;
    $('coverage-error').classList.remove('hidden');
  } finally {
    $('coverage-loading').classList.add('hidden');
  }
}

function renderCoverageRows() {
  const query = ($('coverage-search')?.value || '').trim().toLowerCase();
  const status = $('coverage-status-filter')?.value || 'all';
  const entries = state.coverageEntries.filter(entry => {
    const matchesStatus = status === 'all' || String(entry.status).toLowerCase() === status;
    const haystack = [entry.sc, entry.title, entry.level, entry.status, entry.techniques, entry.implementation_detail].join(' ').toLowerCase();
    return matchesStatus && (!query || haystack.includes(query));
  });
  const body = $('coverage-table-body');
  body.innerHTML = entries.map(entry => {
    const normalizedStatus = String(entry.status || '').toLowerCase().replace(/\s+/g, '-');
    const detail = [entry.techniques, entry.implementation_detail].filter(Boolean).map(escapeHTML).join('<br><span class="coverage-detail">');
    return `<tr>
      <td data-label="SC"><strong>${escapeHTML(entry.sc || '')}</strong></td>
      <td data-label="Criterion">${escapeHTML(entry.title || '')}</td>
      <td data-label="Level">${escapeHTML(entry.level || '')}</td>
      <td data-label="Status"><span class="coverage-status ${normalizedStatus}">${escapeHTML(entry.status || '')}</span></td>
      <td data-label="Techniques / implementation">${detail || '—'}${detail.includes('coverage-detail') ? '</span>' : ''}</td>
    </tr>`;
  }).join('');
  $('coverage-result-count').textContent = `Showing ${entries.length} of ${state.coverageEntries.length} criteria`;
}

// ─── Session / Token Management ───────────────────────────────
// All visitors get a JWT automatically. No secret needed from the client.
async function ensureToken() {
  const cached    = localStorage.getItem(LS_KEY_TOKEN);
  const cachedExp = parseInt(localStorage.getItem(LS_KEY_TOKEN_EXP) || '0', 10);
  const cachedKind = localStorage.getItem(LS_KEY_TOKEN_KIND) || 'guest';

  if (cached && (cachedKind === 'user' || cachedKind === 'guest') && Date.now() < cachedExp - TOKEN_REFRESH_BUFFER_MS) {
    state.token    = cached;
    state.tokenExp = cachedExp;
    return true;
  }

  // Request a fresh guest session token from the server
  try {
    const res = await fetch(`${apiBase()}/api/v1/session`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Session request failed');

    const expiresIn = (data.expires_in || 1200) * 1000; // convert s → ms
    const exp       = Date.now() + expiresIn;

    state.token    = data.token;
    state.tokenExp = exp;
    localStorage.setItem(LS_KEY_TOKEN,     data.token);
    localStorage.setItem(LS_KEY_TOKEN_EXP, String(exp));
    localStorage.setItem(LS_KEY_TOKEN_KIND, 'guest');
    return true;
  } catch (err) {
    showError(`Could not reach the API server: ${err.message}`);
    return false;
  }
}

// Proactively renew guest tokens in the background before expiry (user tokens last 30 days)
function scheduleTokenRenewal() {
  if (localStorage.getItem(LS_KEY_TOKEN_KIND) === 'user') return;
  const exp = state.tokenExp || 0;
  const msUntilRefresh = exp - Date.now() - TOKEN_REFRESH_BUFFER_MS;
  if (msUntilRefresh > 0) {
    setTimeout(async () => {
      if (localStorage.getItem(LS_KEY_TOKEN_KIND) === 'user') return;
      localStorage.removeItem(LS_KEY_TOKEN);
      localStorage.removeItem(LS_KEY_TOKEN_EXP);
      state.token = null;
      await ensureToken();
      scheduleTokenRenewal();
    }, msUntilRefresh);
  }
}

function setDownloadButtonsDisabled(disabled) {
  state.isScanningDiscoveredLinks = disabled;
  const ids = ['download-report-btn', 'download-md-btn', 'download-xlsx-btn', 'generate-compliance-btn'];
  ids.forEach(id => {
    const btn = $(id);
    if (btn) {
      if (disabled) btn.classList.add('scanning-disabled');
      else btn.classList.remove('scanning-disabled');
    }
  });
}

// ─── Scan ──────────────────────────────────────────────────────
async function runScan(url, wcagLevel, depth = 0, shouldGenerateReport = false, reportMeta = null, reportStandard = 'ada', reportFormat = 'html') {
  // Multi-page scans run as a job on the server; this page only follows progress.
  if (depth === 1) {
    return runCrawl(url, { shouldGenerateReport, reportMeta, reportStandard, reportFormat });
  }

  stopFollowingCrawl();
  setView('loading');
  $('loading-url').textContent = url;
  const depthMsg = $('loading-depth-msg');
  if (depthMsg) depthMsg.textContent = '';
  hideError();

  const ok = await ensureToken();
  if (!ok) { setView('hero'); return; }

  try {
    const res = await fetch(`${apiBase()}/api/v1/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      body: JSON.stringify({ url, wcag_level: wcagLevel, depth }),
    });

    if (res.status === 401) {
      localStorage.removeItem(LS_KEY_TOKEN);
      localStorage.removeItem(LS_KEY_TOKEN_EXP);
      state.token = null;
      const retried = await ensureToken();
      if (!retried) { setView('hero'); return; }
      return runScan(url, wcagLevel, depth, shouldGenerateReport, reportMeta, reportStandard, reportFormat);
    }

    const data = await res.json();
    if (isAccessError(res, data)) {
      setView('hero');
      handleAccessDenied(data, () => runScan(url, wcagLevel, depth, shouldGenerateReport, reportMeta, reportStandard, reportFormat));
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Scan failed');
    if (isUserLoggedIn()) refreshAuthMe();

    state.scanResult = data;
    data.embedded_results = [];
    renderResults(data);
    setView('results');
    scheduleTokenRenewal();

    // Auto-generate compliance report if requested
    if (shouldGenerateReport && reportMeta) {
      // Small delay to let the results view render first
      setTimeout(() => {
        generateComplianceReportDirect(reportStandard, reportFormat, reportMeta, data);
      }, 500);
    }

    setDownloadButtonsDisabled(false);
    revealScreenshotSection(data);
  } catch (err) {
    showError(`Scan error: ${err.message}`);
    setView('hero');
  }
}

// ─── Multi-page scan (server-side crawl) ──────────────────────
// The server scans the start page and its linked pages as one job. The job ID
// is remembered so that reloading or reopening the page resumes the same scan.
const LS_KEY_CRAWL = 'wacs_crawl_job';
const CRAWL_POLL_MS = 1500;
let crawlFollowSeq = 0; // bumped to stop following the current crawl

function rememberCrawl(id) {
  try { localStorage.setItem(LS_KEY_CRAWL, id); } catch (_) {}
}
function forgetCrawl() {
  try { localStorage.removeItem(LS_KEY_CRAWL); } catch (_) {}
}

// Stop following the active crawl (if any) and tell the server to stop scanning it.
function stopFollowingCrawl() {
  crawlFollowSeq++;
  let id = null;
  try { id = localStorage.getItem(LS_KEY_CRAWL); } catch (_) {}
  if (id) {
    fetch(`${apiBase()}/api/v1/crawl/${encodeURIComponent(id)}/cancel`, { method: 'POST' }).catch(() => {});
    forgetCrawl();
  }
  setDownloadButtonsDisabled(false);
}

async function runCrawl(url, opts = {}) {
  stopFollowingCrawl();
  setView('loading');
  $('loading-url').textContent = url;
  const depthMsg = $('loading-depth-msg');
  if (depthMsg) depthMsg.textContent = 'Scanning main page…';
  hideError();

  const ok = await ensureToken();
  if (!ok) { setView('hero'); return; }

  try {
    const start = () => fetch(`${apiBase()}/api/v1/crawl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      body: JSON.stringify({ url, parallel: getScanMode() === 'parallel' }),
    });

    let res = await start();
    if (res.status === 401) {
      localStorage.removeItem(LS_KEY_TOKEN);
      localStorage.removeItem(LS_KEY_TOKEN_EXP);
      state.token = null;
      const retried = await ensureToken();
      if (!retried) { setView('hero'); return; }
      res = await start();
    }
    const job = await res.json();
    if (isAccessError(res, job)) {
      setView('hero');
      handleAccessDenied(job, () => runCrawl(url, opts));
      return;
    }
    if (!res.ok) throw new Error(job.error || 'Scan failed');
    if (isUserLoggedIn()) refreshAuthMe();

    rememberCrawl(job.crawl_id);
    scheduleTokenRenewal();
    await followCrawl(job.crawl_id, opts);
  } catch (err) {
    forgetCrawl();
    showError(`Scan error: ${err.message}`);
    setView('hero');
  }
}

// Build the placeholder cards for a crawl's linked pages.
function buildLinkedPageCards(pages) {
  const linkedSection = $('linked-pages-section');
  const linkedList    = $('linked-pages-list');
  const linkedCount   = $('linked-pages-count');
  if (!linkedSection || !linkedList) return [];

  if (linkedCount) linkedCount.textContent = pages.length;
  linkedList.innerHTML = '';
  const cards = pages.map((page) => {
    const card = document.createElement('article');
    card.className = 'linked-page-card linked-page-loading';
    card.innerHTML = `
      <div class="linked-page-header">
        <div class="linked-page-score linked-page-score-pending">
          <span class="linked-page-grade">…</span>
        </div>
        <div class="linked-page-info">
          <div class="linked-page-url" title="${escapeHTML(page.url)}">${escapeHTML(page.url)}</div>
          <div class="linked-page-meta">
            <span class="linked-page-stat scanning">Queued…</span>
          </div>
        </div>
      </div>`;
    linkedList.appendChild(card);
    return { url: page.url, card, handled: false };
  });
  linkedSection.classList.remove('hidden');
  return cards;
}

async function fetchStoredResult(scanId) {
  const res = await fetch(`${apiBase()}/api/v1/report/${encodeURIComponent(scanId)}`);
  if (!res.ok) throw new Error('Result not found or expired');
  return res.json();
}

// Follow a crawl until it finishes: render the start page as soon as it is
// scanned, then each linked page as it completes.
// opts.resumed is true when picking up a crawl after a page reload.
async function followCrawl(crawlId, opts = {}) {
  const seq = ++crawlFollowSeq;
  const active = () => seq === crawlFollowSeq;
  let main = null;
  let cards = null;
  let failures = 0;

  while (active()) {
    let job;
    try {
      const res = await fetch(`${apiBase()}/api/v1/crawl/${encodeURIComponent(crawlId)}`);
      if (res.status === 404) {
        // The job is gone (expired, or the server restarted).
        if (!active()) return;
        forgetCrawl();
        if (main) {
          setDownloadButtonsDisabled(false);
          revealScreenshotSection(main);
          showError('The multi-page scan was interrupted. Results so far are shown; run the scan again for the remaining pages.');
        } else {
          if (!opts.resumed) showError('Scan error: the scan is no longer available. Please run it again.');
          setView('hero');
        }
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      job = await res.json();
      failures = 0;
    } catch (err) {
      // Tolerate brief network trouble; give up after about 30 seconds of it.
      if (++failures > 20) {
        if (!active()) return;
        showError(`Scan error: lost contact with the server (${err.message}). Reload the page to resume.`);
        if (!main) setView('hero');
        setDownloadButtonsDisabled(false);
        return;
      }
      await new Promise(r => setTimeout(r, CRAWL_POLL_MS));
      continue;
    }
    if (!active()) return;

    if (!main) {
      if ($('loading-url') && job.url) $('loading-url').textContent = job.url;
      if (job.status === 'error' || (job.status === 'cancelled' && !job.main_scan_id)) {
        forgetCrawl();
        if (!opts.resumed || job.status === 'error') showError(`Scan error: ${job.error || 'Scan failed'}`);
        setView('hero');
        return;
      }
      if (job.main_scan_id) {
        try {
          main = await fetchStoredResult(job.main_scan_id);
        } catch (err) {
          if (!active()) return;
          forgetCrawl();
          showError(`Scan error: ${err.message}`);
          setView('hero');
          return;
        }
        if (!active()) return;
        main.embedded_results = [];
        main.crawl_id = crawlId;
        state.scanResult = main;
        renderResults(main);
        setView('results');
        setDownloadButtonsDisabled(true);
      }
    }

    if (main) {
      const pages = job.pages || [];
      if (!cards && pages.length > 0) cards = buildLinkedPageCards(pages);
      for (let i = 0; cards && i < cards.length && i < pages.length; i++) {
        const entry = cards[i];
        const page = pages[i];
        if (entry.handled) continue;
        if (page.status === 'scanning') {
          const statusEl = entry.card.querySelector('.linked-page-stat');
          if (statusEl) statusEl.textContent = 'Scanning…';
        } else if (page.status === 'done') {
          entry.handled = true;
          try {
            const sub = await fetchStoredResult(page.scan_id);
            if (!active()) return;
            renderLinkedPageCard(entry.card, sub);
            main.embedded_results.push(sub);
          } catch (err) {
            renderLinkedPageError(entry.card, entry.url, err.message);
          }
        } else if (page.status === 'timeout') {
          entry.handled = true;
          renderLinkedPageTimeout(entry.card, entry.url);
        } else if (page.status === 'error') {
          entry.handled = true;
          renderLinkedPageError(entry.card, entry.url, page.error || 'Scan failed');
        }
      }

      const finished = job.status === 'done' || job.status === 'cancelled' || job.status === 'error';
      if (finished && (!cards || cards.every(c => c.handled))) {
        forgetCrawl();
        setDownloadButtonsDisabled(false);
        // Reveal Impacted Components only after all child scans have finished
        revealScreenshotSection(main);
        // The compliance report requested with the scan covers every scanned page.
        if (opts.shouldGenerateReport && opts.reportMeta) {
          generateComplianceReportDirect(opts.reportStandard, opts.reportFormat, opts.reportMeta, main);
        }
        return;
      }
    }

    // Poll faster until the start page is in, so first results appear promptly.
    await new Promise(r => setTimeout(r, main ? CRAWL_POLL_MS : 600));
  }
}

// On page load, pick up a multi-page scan that was still running when the
// page was closed or reloaded.
function resumeCrawlIfAny() {
  let id = null;
  try { id = localStorage.getItem(LS_KEY_CRAWL); } catch (_) {}
  if (!id) return false;
  setView('loading');
  const depthMsg = $('loading-depth-msg');
  if (depthMsg) depthMsg.textContent = 'Resuming your multi-page scan…';
  followCrawl(id, { resumed: true });
  return true;
}

function renderLinkedPageCard(card, sub) {
  const s     = sub.summary || {};
  const sc    = s.score ?? 0;
  const gr    = s.grade || 'F';
  const subViols = sub.violations || [];
  const viol  = s.violation_count ?? subViols.length;
  const pass  = s.pass_count ?? (sub.passes || []).length;
  const comp  = s.compliance_pct ?? 0;
  const colors = { A:'#10b981', B:'#06b6d4', C:'#f59e0b', D:'#f97316', F:'#f43f5e' };
  const color = colors[gr] || '#6366f1';

  card.className = 'linked-page-card';
  card.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'linked-page-header';
  header.setAttribute('role', 'button');
  header.setAttribute('aria-expanded', 'false');
  header.tabIndex = 0;
  header.innerHTML = `
    <div class="linked-page-score" style="border-color:${color}">
      <span class="linked-page-grade grade-${gr}">${gr}</span>
      <span class="linked-page-score-num">${sc}</span>
    </div>
    <div class="linked-page-info">
      <div class="linked-page-url" title="${escapeHTML(sub.url || '')}">${escapeHTML(sub.url || '')}</div>
      <div class="linked-page-meta">
        <span class="linked-page-stat viol">${viol} violation${viol !== 1 ? 's' : ''}</span>
        <span class="linked-page-stat pass">${pass} passed</span>
        <span class="linked-page-stat comp">${comp.toFixed(1)}% compliant</span>
      </div>
    </div>
    <svg class="linked-page-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <polyline points="6 9 12 15 18 9"/>
    </svg>`;

  const body = document.createElement('div');
  body.className = 'linked-page-body';
  body.style.display = 'none';

  // ── Inline screenshot panel for this linked page ──
  const screenshotSrc = sub.screenshot || sub.visual_report_screenshot;
  if (screenshotSrc) {
    const cardId = `linked-preview-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const previewSection = document.createElement('div');
    previewSection.className = 'linked-page-preview-section';

    // Toolbar: summary text + severity filters
    const toolbar = document.createElement('div');
    toolbar.className = 'preview-toolbar';

    const summaryEl = document.createElement('p');
    summaryEl.className = 'preview-summary';
    toolbar.appendChild(summaryEl);

    const filtersEl = document.createElement('div');
    filtersEl.className = 'preview-filters';
    filtersEl.setAttribute('aria-label', 'Filter issue indicators by severity');
    toolbar.appendChild(filtersEl);
    previewSection.appendChild(toolbar);

    // Image + overlay wrapper
    const wrap = document.createElement('div');
    wrap.className = 'screenshot-wrap';

    const img = document.createElement('img');
    img.className = 'screenshot-img';
    img.alt = `Screenshot of ${escapeHTML(sub.url || 'scanned page')}`;

    const overlayEl = document.createElement('div');
    overlayEl.className = 'issue-overlay';
    overlayEl.setAttribute('aria-label', 'Accessibility issue indicators');

    wrap.appendChild(img);
    wrap.appendChild(overlayEl);
    previewSection.appendChild(wrap);

    const helpEl = document.createElement('p');
    helpEl.className = 'preview-help';
    helpEl.textContent = 'Select an indicator to jump to its issue details.';
    previewSection.appendChild(helpEl);

    body.appendChild(previewSection);

    // Wire up renderIssuePreview logic inline (scoped to this card's elements)
    const buildInlinePreview = () => {
      const syncIfLoaded = setupIssuePreview({
        image: img,
        overlay: overlayEl,
        filters: filtersEl,
        summary: summaryEl,
        violations: subViols,
        formatSummary: count => count
          ? `${count} impacted component${count === 1 ? '' : 's'} highlighted.`
          : 'No component positions available for this page.',
        formatTitle: violation => `${violation.id}: ${violation.help || ''}`.trim(),
      });

      img.src = screenshotSrc.startsWith('data:') ? screenshotSrc : `data:image/jpeg;base64,${screenshotSrc}`;
      syncIfLoaded();
    };

    // Build preview lazily on first open to avoid loading all images upfront
    let previewBuilt = false;
    const origToggle = () => {
      if (!previewBuilt) { buildInlinePreview(); previewBuilt = true; }
    };
    // store for the toggle handler below
    card._buildPreview = origToggle;
  }

  if (subViols.length > 0) {
    const violTitle = document.createElement('div');
    violTitle.className = 'linked-page-body-title';
    violTitle.textContent = `Violations (${subViols.length})`;
    body.appendChild(violTitle);
    subViols
      .sort((a, b) => impactOrder(b.impact) - impactOrder(a.impact))
      .forEach(v => body.appendChild(buildViolationCard(v)));
  } else {
    const noViols = document.createElement('p');
    noViols.className = 'linked-page-no-viols';
    noViols.textContent = 'No violations found on this page.';
    body.appendChild(noViols);
  }

  const toggle = () => {
    const isOpen = card.classList.toggle('open');
    body.style.display = isOpen ? 'block' : 'none';
    header.setAttribute('aria-expanded', String(isOpen));
    if (isOpen && card._buildPreview) card._buildPreview();
  };
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });

  card.appendChild(header);
  card.appendChild(body);
}

function renderLinkedPageTimeout(card, linkUrl) {
  card.className = 'linked-page-card linked-page-flagged';
  card.innerHTML = `
    <div class="linked-page-header">
      <div class="linked-page-score linked-page-score-timeout">
        <span class="linked-page-grade">!</span>
      </div>
      <div class="linked-page-info">
        <div class="linked-page-url" title="${escapeHTML(linkUrl)}">${escapeHTML(linkUrl)}</div>
        <div class="linked-page-meta">
          <span class="linked-page-stat timeout">Timed out — exceeded 3 minute limit</span>
        </div>
      </div>
    </div>`;
}

function renderLinkedPageError(card, linkUrl, errMsg) {
  card.className = 'linked-page-card linked-page-flagged';
  card.innerHTML = `
    <div class="linked-page-header">
      <div class="linked-page-score linked-page-score-error">
        <span class="linked-page-grade">✕</span>
      </div>
      <div class="linked-page-info">
        <div class="linked-page-url" title="${escapeHTML(linkUrl)}">${escapeHTML(linkUrl)}</div>
        <div class="linked-page-meta">
          <span class="linked-page-stat error">${escapeHTML(errMsg)}</span>
        </div>
      </div>
    </div>`;
}

// ─── Render Results ────────────────────────────────────────────
function renderResults(result) {
  const summary    = result.summary || {};
  const violations = result.violations || [];
  const passes     = result.passes || [];

  const score         = summary.score         ?? 0;
  const grade         = summary.grade         ?? 'F';
  const compliancePct = summary.compliance_pct ?? summary.compliancePct ?? 0;
  const passCount     = summary.pass_count    ?? summary.passCount     ?? passes.length;
  const violCount     = summary.violation_count ?? summary.violationCount ?? violations.length;

  // ── Score Ring ──────────────────────────────────
  const circumference = 440;
  const dashOffset    = circumference - (score / 100) * circumference;
  const ringFill      = $('score-ring-fill');

  const ringColors = { A: '#10b981', B: '#06b6d4', C: '#f59e0b', D: '#f97316', F: '#f43f5e' };
  ringFill.style.stroke = ringColors[grade] || '#6366f1';

  requestAnimationFrame(() => {
    setTimeout(() => { ringFill.style.strokeDashoffset = dashOffset; }, 100);
  });

  animateCount($('score-number'), 0, score, 1200);

  const gradeEl = $('grade-badge');
  gradeEl.textContent = grade;
  gradeEl.className   = `grade-badge grade-${grade}`;

  const compFill  = $('compliance-fill');
  const compLabel = $('compliance-value');
  compFill.style.width = `${compliancePct.toFixed(1)}%`;
  if (compLabel) compLabel.textContent = `${compliancePct.toFixed(1)}%`;

  // Update progressbar aria value
  const compBar = compFill.parentElement;
  if (compBar) compBar.setAttribute('aria-valuenow', Math.round(compliancePct));

  // ── Score headline ──────────────────────────────
  const urlEl  = $('result-url');
  const wcagEl = $('result-wcag');
  if (urlEl)  urlEl.textContent  = result.url || '';
  if (wcagEl) wcagEl.textContent = `WCAG ${summary.level || 'AA'}`;

  // ── Impact breakdown ────────────────────────────
  const impactCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  violations.forEach(v => { if (impactCounts[v.impact] !== undefined) impactCounts[v.impact]++; });

  animateCount($('stat-critical'), 0, impactCounts.critical, 700);
  animateCount($('stat-serious'),  0, impactCounts.serious,  800);
  animateCount($('stat-moderate'), 0, impactCounts.moderate, 900);
  animateCount($('stat-minor'),    0, impactCounts.minor,    700);
  animateCount($('stat-passes'),   0, passCount,             1000);

  // ── Recommendation ──────────────────────────────
  const recEl = $('recommendation-text');
  if (recEl) recEl.textContent = summary.recommendation || buildRecommendation(score, violations);

  // ── Passes count ────────────────────────────────
  const passesCountEl = $('passes-count');
  if (passesCountEl) passesCountEl.textContent = passCount;

  // Show "out of N rules checked" to prevent the raw count being mistaken for a %
  const passesTotalEl = $('passes-total');
  if (passesTotalEl) {
    const totalRules = passCount + violCount;
    passesTotalEl.textContent = totalRules > 0
      ? `out of ${totalRules} rules checked`
      : '';
  }

  // ── Score Explanation Panel ──────────────────────
  buildScoreExplanation({ score, compliancePct, passCount, violCount, violations, summary });

  // ── Violations list ─────────────────────────────
  const titleEl   = $('violations-section-title');
  const violList  = $('violations-list');
  const noViolMsg = $('no-violations-msg');

  if (titleEl) {
    const badge = titleEl.querySelector('.count-badge');
    if (badge) badge.textContent = violCount;
  }

  violList.innerHTML = '';
  if (violations.length === 0) {
    if (noViolMsg) noViolMsg.classList.remove('hidden');
  } else {
    if (noViolMsg) noViolMsg.classList.add('hidden');
    violations
      .sort((a, b) => impactOrder(b.impact) - impactOrder(a.impact))
      .forEach(v => violList.appendChild(buildViolationCard(v)));
  }

  // ── Linked Pages — reset; populated by scanLinksInParallel() ──
  const linkedSection = $('linked-pages-section');
  if (linkedSection) linkedSection.classList.add('hidden');

  // ── Page Screenshot ── (hidden until all child scans complete) ───
  const screenshotSection = $('screenshot-section');
  const screenshotImg     = $('screenshot-img');
  const screenshotSrc     = result.screenshot || result.visual_report_screenshot;
  if (screenshotSection) screenshotSection.classList.add('hidden');
  if (screenshotSection && screenshotImg && screenshotSrc) {
    renderIssuePreview(screenshotImg, violations);
    screenshotImg.src = screenshotSrc.startsWith('data:') ? screenshotSrc : `data:image/jpeg;base64,${screenshotSrc}`;
  } else if (screenshotImg) {
    screenshotImg.removeAttribute('src');
  }
  // Section is revealed by revealScreenshotSection() after all child scans finish.
}

// Reveal the Impacted Components / screenshot section only when a screenshot exists.
function revealScreenshotSection(result) {
  const src = result && (result.screenshot || result.visual_report_screenshot);
  const ss  = $('screenshot-section');
  if (ss && src) {
    ss.classList.remove('hidden');
  }
}

/**
 * Returns true when a bounding box covers >= 90% of both natural dimensions
 * (e.g. page-level <html> or <body> nodes that would tint the entire screenshot).
 */
function isFullPageBbox(bbox, naturalWidth, naturalHeight) {
  if (!bbox || !naturalWidth || !naturalHeight || naturalWidth <= 0 || naturalHeight <= 0) {
    return false;
  }
  return bbox.width >= naturalWidth * 0.9 && bbox.height >= naturalHeight * 0.9;
}

/**
 * Collects renderable violation node bounding boxes, excluding full-page boxes
 * once image dimensions are known.
 */
function collectImpactedNodes(violations, naturalWidth = 0, naturalHeight = 0) {
  return (violations || []).flatMap((violation, violationIndex) =>
    (violation.nodes || [])
      .filter(node =>
        node.bbox &&
        node.bbox.width > 0 &&
        node.bbox.height > 0 &&
        !isFullPageBbox(node.bbox, naturalWidth, naturalHeight)
      )
      .map((node, nodeIndex) => ({ violation, violationIndex, nodeIndex, bbox: node.bbox }))
  );
}

/**
 * Shared setup for both single-page and multi-page screenshot issue previews.
 * Returns a callback that immediately renders indicators if the image is already loaded.
 */
function setupIssuePreview({
  image,
  overlay,
  filters,
  summary,
  violations,
  formatSummary,
  formatTitle,
  onIndicatorClick,
}) {
  let activeSeverity = 'all';

  const applyFilter = severity => {
    activeSeverity = severity;
    overlay.querySelectorAll('.issue-indicator').forEach(indicator => {
      indicator.hidden = severity !== 'all' && indicator.dataset.impact !== severity;
    });
    filters.querySelectorAll('button').forEach(button => {
      const selected = button.dataset.impact === activeSeverity;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  };

  const renderSummaryAndFilters = items => {
    summary.textContent = formatSummary(items.length);

    const severities = ['critical', 'serious', 'moderate', 'minor']
      .filter(impact => items.some(item => (item.violation.impact || 'minor') === impact));

    if (activeSeverity !== 'all' && !severities.includes(activeSeverity)) {
      activeSeverity = 'all';
    }

    filters.replaceChildren();
    ['all', ...severities].forEach(impact => {
      const count = impact === 'all'
        ? items.length
        : items.filter(item => (item.violation.impact || 'minor') === impact).length;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `preview-filter ${impact}`;
      button.dataset.impact = impact;
      button.textContent = `${impact === 'all' ? 'All' : impact[0].toUpperCase() + impact.slice(1)} (${count})`;
      button.addEventListener('click', () => applyFilter(impact));
      filters.appendChild(button);
    });
  };

  const positionIndicators = () => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const visibleImpacted = collectImpactedNodes(violations, image.naturalWidth, image.naturalHeight);
    renderSummaryAndFilters(visibleImpacted);
    overlay.replaceChildren();

    visibleImpacted.forEach(({ violation, violationIndex, bbox }) => {
      const indicator = document.createElement('button');
      const impact = violation.impact || 'minor';
      indicator.type = 'button';
      indicator.className = `issue-indicator ${impact}`;
      indicator.dataset.impact = impact;
      indicator.hidden = activeSeverity !== 'all' && activeSeverity !== impact;
      indicator.style.left = `${Math.max(0, bbox.x) / image.naturalWidth * 100}%`;
      indicator.style.top = `${Math.max(0, bbox.y) / image.naturalHeight * 100}%`;
      indicator.style.width = `${Math.min(bbox.width, image.naturalWidth) / image.naturalWidth * 100}%`;
      indicator.style.height = `${Math.min(bbox.height, image.naturalHeight) / image.naturalHeight * 100}%`;
      indicator.setAttribute('aria-label', `${impact} issue: ${violation.help || violation.description || violation.id}`);
      indicator.title = formatTitle(violation);

      const badge = document.createElement('span');
      badge.className = 'issue-indicator-badge';
      badge.textContent = String(violationIndex + 1);
      indicator.appendChild(badge);
      if (onIndicatorClick) {
        indicator.addEventListener('click', () => onIndicatorClick(violationIndex));
      }
      overlay.appendChild(indicator);
    });

    applyFilter(activeSeverity);
  };

  overlay.replaceChildren();
  renderSummaryAndFilters(collectImpactedNodes(violations));
  applyFilter('all');

  image.addEventListener('load', positionIndicators, { once: true });

  const syncIfLoaded = () => {
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      positionIndicators();
    }
  };
  syncIfLoaded();
  return syncIfLoaded;
}

function renderIssuePreview(image, violations) {
  const overlay = $('issue-overlay');
  const filters = $('preview-filters');
  const summary = $('preview-summary');
  if (!overlay || !filters || !summary) return;

  setupIssuePreview({
    image,
    overlay,
    filters,
    summary,
    violations,
    formatSummary: count => count
      ? `${count} impacted component${count === 1 ? '' : 's'} highlighted on the scanned page.`
      : 'No impacted component positions were available for this scan.',
    formatTitle: violation => `${violation.id}: ${violation.help || violation.description || ''}`,
    onIndicatorClick: focusViolation,
  });
}

function focusViolation(violationIndex) {
  const card = document.querySelector(`[data-violation-index="${violationIndex}"]`);
  if (!card) return;
  card.classList.add('open', 'indicator-focus');
  card.querySelector('.violation-header')?.setAttribute('aria-expanded', 'true');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.querySelector('.violation-header')?.focus({ preventScroll: true });
  setTimeout(() => card.classList.remove('indicator-focus'), 1800);
}

function impactOrder(impact) {
  return { critical: 4, serious: 3, moderate: 2, minor: 1 }[impact] || 0;
}

function buildViolationCard(v) {
  const card = document.createElement('div');
  card.className = `violation-card ${v.impact || 'minor'}`;
  card.dataset.violationIndex = String((state.scanResult?.violations || []).indexOf(v));

  const nodes    = v.nodes || [];
  const wcagRefs = (v.tags || [])
    .filter(t => /^wcag/i.test(t) && t.length <= 9)
    .map(formatWcagTag)
    .join(', ');

  // ── Affected element nodes ───────────────────────
  const nodeHTML = nodes.slice(0, 3).map(n => {
    const html    = n.html ? escapeHTML(n.html) : '';
    const summary = n.failureSummary || n.failure_summary || '';
    return `
      <div class="node-item">
        ${html ? `<div class="node-html">${html}</div>` : ''}
        ${summary ? `<div class="node-summary">${summary.replace(/^Fix (?:any|all) of the following:\s*/i, '')}</div>` : ''}
      </div>`;
  }).join('');

  const moreNodes = nodes.length > 3
    ? `<p style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">+${nodes.length - 3} more element(s)</p>`
    : '';

  // ── Dev Suggestion ───────────────────────────────
  const ds = v.dev_suggestion || v.devSuggestion || null;
  let devSuggestionHTML = '';
  if (ds) {
    const fixStepsHTML = (ds.fix_steps || []).map(s => `<li>${escapeHTML(s)}</li>`).join('');
    const codeBefore   = ds.code_before || '';
    const codeAfter    = ds.code_after  || '';
    const lang         = escapeHTML(ds.language || 'code');

    devSuggestionHTML = `
      <details class="dev-suggestion">
        <summary class="dev-suggestion-summary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          <span>🔧 Developer Fix Suggestion</span>
          <span class="ds-title-preview">${escapeHTML(ds.title || '')}</span>
        </summary>
        <div class="dev-suggestion-body">
          ${ds.title ? `<div class="ds-heading">${escapeHTML(ds.title)}</div>` : ''}
          ${fixStepsHTML ? `
            <ol class="ds-fix-steps">${fixStepsHTML}</ol>
          ` : ''}
          ${(codeBefore || codeAfter) ? `
            <div class="ds-code-pair">
              ${codeBefore ? `
                <div class="ds-code-block ds-bad">
                  <div class="ds-code-label">❌ Before</div>
                  <pre><code class="lang-${lang}">${escapeHTML(codeBefore)}</code></pre>
                </div>` : ''}
              ${codeAfter ? `
                <div class="ds-code-block ds-good">
                  <div class="ds-code-label">✅ After</div>
                  <pre><code class="lang-${lang}">${escapeHTML(codeAfter)}</code></pre>
                </div>` : ''}
            </div>` : ''}
        </div>
      </details>`;
  }

  card.innerHTML = `
    <div class="violation-header" role="button" aria-expanded="false" tabindex="0">
      <span class="impact-pill ${v.impact || 'minor'}">${v.impact || 'unknown'}</span>
      <div class="violation-meta">
        <div class="violation-id">${escapeHTML(v.id || '')}</div>
        <div class="violation-desc">${escapeHTML(v.description || v.help || '')}</div>
      </div>
      ${wcagRefs ? `<span class="wcag-tag">${wcagRefs}</span>` : ''}
      <svg class="chevron-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>
    <div class="violation-body">

      ${v.description ? `<p class="vb-description">${escapeHTML(v.description)}</p>` : ''}

      ${v.help && v.help !== v.description ? `
        <div class="vb-help-row">
          <span class="vb-help-label">Help</span>
          <span class="vb-help-text">
            ${escapeHTML(v.help)}
            ${v.helpUrl ? ` — <a href="${escapeHTML(v.helpUrl)}" target="_blank" rel="noopener" class="vb-help-link">WCAG reference ↗</a>` : ''}
          </span>
        </div>` : v.helpUrl ? `
        <div class="vb-help-row">
          <span class="vb-help-label">Reference</span>
          <a href="${escapeHTML(v.helpUrl)}" target="_blank" rel="noopener" class="vb-help-link">WCAG documentation ↗</a>
        </div>` : ''}

      ${nodes.length > 0 ? `
        <div class="nodes-title">Affected Elements (${nodes.length})</div>
        ${nodeHTML}
        ${moreNodes}
      ` : ''}

      ${devSuggestionHTML}

    </div>`;

  const header = card.querySelector('.violation-header');
  const toggle = () => {
    card.classList.toggle('open');
    header.setAttribute('aria-expanded', String(card.classList.contains('open')));
  };
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });

  return card;
}

/**
 * Builds the content of the "How is this score calculated?" collapsible panel.
 * Uses fully inline styles so it renders correctly regardless of CSS caching.
 */
function buildScoreExplanation({ score, compliancePct, passCount, violCount, violations, summary }) {
  const el = $('score-explain-body');
  if (!el) return;

  const total        = passCount + violCount;

  // Auto-detect formula: if score matches round(compliancePct) it's compliance-aligned,
  // otherwise it's penalty-based (summary.scoring_formula is not included in the API response).
  const expectedCompliance = Math.round(compliancePct);
  const isCompliance = Math.abs(score - expectedCompliance) <= 1;

  // Impact counts
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  (violations || []).forEach(v => { if (counts[v.impact] !== undefined) counts[v.impact]++; });
  const totalPenalty = counts.critical * 20 + counts.serious * 10 + counts.moderate * 5 + counts.minor * 2;

  // Grade → color
  const gradeColors = { A: '#10b981', B: '#06b6d4', C: '#f59e0b', D: '#f97316', F: '#f43f5e' };
  const grade      = summary?.grade || 'F';
  const scoreColor = gradeColors[grade] || '#6366f1';

  // ── shared inline style helpers ──────────────────
  const S = {
    wrap:     'padding:18px 0 4px;font-family:inherit;',
    badge:    'display:inline-flex;align-items:center;gap:6px;font-size:0.72rem;font-weight:700;' +
              'letter-spacing:0.05em;text-transform:uppercase;padding:4px 10px;border-radius:99px;' +
              'background:rgba(99,102,241,0.15);color:#818cf8;margin-bottom:16px;',
    row:      'display:grid;grid-template-columns:36px 1fr auto;align-items:start;gap:14px;' +
              'padding:14px 16px;border-radius:10px;background:rgba(255,255,255,0.04);' +
              'border:1px solid rgba(255,255,255,0.07);margin-bottom:10px;',
    num:      'width:28px;height:28px;border-radius:50%;background:rgba(99,102,241,0.2);' +
              'color:#818cf8;font-size:0.75rem;font-weight:800;display:flex;' +
              'align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;',
    label:    'font-size:0.84rem;line-height:1.6;color:#94a3b8;',
    strong:   'color:#e2e8f0;font-weight:700;',
    mono:     'font-family:monospace;font-size:0.82rem;background:rgba(99,102,241,0.13);' +
              'color:#818cf8;padding:2px 7px;border-radius:5px;',
    val:      'font-size:1.15rem;font-weight:800;white-space:nowrap;align-self:center;padding-top:2px;',
    divider:  'border:none;border-top:1px solid rgba(255,255,255,0.07);margin:16px 0;',
    result:   'display:flex;align-items:center;justify-content:space-between;' +
              'padding:16px 18px;border-radius:12px;background:rgba(99,102,241,0.08);' +
              'border:1px solid rgba(99,102,241,0.22);margin-top:14px;',
    scoreNum: `font-size:2rem;font-weight:900;line-height:1;color:${scoreColor};`,
    scoreSub: 'font-size:0.78rem;color:#64748b;margin-top:3px;',
    penTbl:   'width:100%;border-collapse:collapse;font-size:0.82rem;margin-top:10px;',
    penTh:    'text-align:left;padding:5px 8px;color:#64748b;font-weight:600;font-size:0.72rem;' +
              'text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid rgba(255,255,255,0.07);',
    penTd:    'padding:7px 8px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.04);',
  };

  const h = (style, tag, content) => `<${tag} style="${style}">${content}</${tag}>`;

  let stepsHTML = '';

  if (isCompliance) {
    // ── Compliance-aligned ───────────────────────────
    stepsHTML = `
      <div style="${S.row}">
        <div style="${S.num}">1</div>
        <div style="${S.label}">
          <span style="${S.strong}">Rules checked</span><br>
          axe-core tested <span style="${S.strong}">${total} accessibility rules</span> on this page.
          <span style="color:#10b981;font-weight:700">${passCount} passed</span> —
          <span style="color:#f43f5e;font-weight:700">${violCount} failed</span>.
        </div>
        <div style="${S.val};color:#10b981">${passCount}<span style="font-size:0.75rem;font-weight:500;color:#64748b"> / ${total}</span></div>
      </div>

      <div style="${S.row}">
        <div style="${S.num}">2</div>
        <div style="${S.label}">
          <span style="${S.strong}">Compliance rate</span><br>
          <span style="${S.mono}">${passCount} ÷ ${total} × 100 = ${compliancePct.toFixed(1)}%</span><br>
          This is the same number shown on the <em>Compliance</em> progress bar above.
        </div>
        <div style="${S.val};color:#818cf8">${compliancePct.toFixed(1)}%</div>
      </div>

      <div style="${S.row}">
        <div style="${S.num}">3</div>
        <div style="${S.label}">
          <span style="${S.strong}">Score = rounded compliance %</span><br>
          <span style="${S.mono}">round(${compliancePct.toFixed(1)}%) → ${score}</span><br>
          The score is the compliance % rounded to the nearest whole number.
          Since <strong>${passCount}</strong> of <strong>${total}</strong> rules passed
          (${compliancePct.toFixed(1)}%), the score is <strong>${score}</strong>.
        </div>
        <div style="${S.val};color:${scoreColor}">${score}</div>
      </div>`;

  } else {
    // ── Penalty-based ────────────────────────────────
    const penRows = [
      { sev: 'Critical', count: counts.critical, pts: 20, color: '#f43f5e' },
      { sev: 'Serious',  count: counts.serious,  pts: 10, color: '#f97316' },
      { sev: 'Moderate', count: counts.moderate, pts:  5, color: '#f59e0b' },
      { sev: 'Minor',    count: counts.minor,    pts:  2, color: '#a3e635' },
    ];

    const penTableRows = penRows.map(r => `
      <tr>
        <td style="${S.penTd};color:${r.color};font-weight:700">${r.sev}</td>
        <td style="${S.penTd}">${r.count} violation${r.count !== 1 ? 's' : ''}</td>
        <td style="${S.penTd};color:#64748b">× ${r.pts} pts each</td>
        <td style="${S.penTd};font-weight:700;color:${r.count > 0 ? '#f43f5e' : '#64748b'}">
          ${r.count > 0 ? `−${r.count * r.pts} pts` : '—'}
        </td>
      </tr>`).join('');

    stepsHTML = `
      <div style="${S.row}">
        <div style="${S.num}">1</div>
        <div style="${S.label}">
          <span style="${S.strong}">Start at 100</span><br>
          Every page begins with a perfect score of <span style="color:#818cf8;font-weight:700">100</span>.
          Points are deducted for each accessibility violation found.
        </div>
        <div style="${S.val};color:#818cf8">100</div>
      </div>

      <div style="${S.row}">
        <div style="${S.num}">2</div>
        <div style="${S.label}">
          <span style="${S.strong}">Deduct points per violation severity</span><br>
          <table style="${S.penTbl}">
            <thead>
              <tr>
                <th style="${S.penTh}">Severity</th>
                <th style="${S.penTh}">Found</th>
                <th style="${S.penTh}">Rate</th>
                <th style="${S.penTh}">Deducted</th>
              </tr>
            </thead>
            <tbody>${penTableRows}</tbody>
            <tfoot>
              <tr>
                <td colspan="3" style="${S.penTd};font-weight:700;color:#e2e8f0;border-top:1px solid rgba(255,255,255,0.1)">Total deduction</td>
                <td style="${S.penTd};font-weight:900;color:#f43f5e;border-top:1px solid rgba(255,255,255,0.1)">−${totalPenalty} pts</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div style="${S.val};color:#f43f5e">−${totalPenalty}</div>
      </div>

      <div style="${S.row}">
        <div style="${S.num}">3</div>
        <div style="${S.label}">
          <span style="${S.strong}">Final score</span><br>
          <span style="${S.mono}">max(0,  100 − ${totalPenalty})  =  ${score}</span><br>
          Score is floored at 0 — it can never go below zero regardless of violations.
        </div>
        <div style="${S.val};color:${scoreColor}">${score}</div>
      </div>`;
  }

  el.innerHTML = `
    <div style="${S.wrap}">
      <div style="${S.badge}">${isCompliance ? '📐' : '⚖️'} &nbsp;${isCompliance ? 'Compliance-Aligned' : 'Penalty-Based'} formula</div>
      ${stepsHTML}
      <div style="${S.result}">
        <div>
          <div style="font-size:0.82rem;font-weight:700;color:#94a3b8;margin-bottom:3px;">Score breakdown</div>
          <div style="font-size:0.75rem;color:#475569;">
            ${passCount} passed &nbsp;·&nbsp; ${violCount} failed &nbsp;·&nbsp; ${total} rules total &nbsp;·&nbsp; ${compliancePct.toFixed(1)}% compliance
          </div>
        </div>
        <div style="text-align:right">
          <div style="${S.scoreNum}">${score}<span style="font-size:1rem;font-weight:400;color:#475569">/100</span></div>
          <div style="${S.scoreSub}">Grade ${grade}</div>
        </div>
      </div>
    </div>`;
}


function buildRecommendation(score, violations) {
  if (!violations.length) return 'Excellent! No violations detected. Keep up the great accessibility practices.';
  const counts = violations.reduce((acc, v) => { acc[v.impact] = (acc[v.impact] || 0) + 1; return acc; }, {});
  if (score >= 90) return `Great score! Address the ${violations.length} minor issue(s) to reach a perfect score.`;
  if (score >= 75) return `Good score, but ${counts.serious || 0} serious violation(s) need attention to improve assistive technology support.`;
  if (score >= 50) return `Moderate accessibility issues detected (${counts.critical || 0} critical, ${counts.serious || 0} serious, ${counts.moderate || 0} moderate). Prioritize critical and serious violations first.`;
  return `Significant accessibility barriers found. ${counts.critical || 0} critical and ${counts.serious || 0} serious violations must be resolved immediately.`;
}

function animateCount(el, from, to, duration) {
  if (!el) return;
  const start = performance.now();
  const step  = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Converts a raw axe-core WCAG tag into a human-readable label.
 *
 * Two formats exist in axe-core tags:
 *   1. Conformance-level tags  – wcag2a / wcag2aa / wcag2aaa / wcag21aa / wcag22aa
 *   2. Success-criterion tags  – wcag111 / wcag122 / wcag146 / wcag244 …
 *
 * Examples:
 *   wcag2aaa  → "WCAG 2 AAA"
 *   wcag21aa  → "WCAG 2.1 AA"
 *   wcag22aa  → "WCAG 2.2 AA"
 *   wcag2a    → "WCAG 2 A"
 *   wcag146   → "WCAG 1.4.6"
 *   wcag244   → "WCAG 2.4.4"
 */
function formatWcagTag(raw) {
  const s = raw.replace(/^wcag/i, '');

  // Conformance-level pattern: optional version digits, then 'a'/'aa'/'aaa'
  // e.g.  2a | 2aa | 2aaa | 21aa | 22aa
  const levelMatch = s.match(/^(2(?:\.?[12])?)(a{1,3})$/i);
  if (levelMatch) {
    const ver   = levelMatch[1].replace('.', '');         // "21" → "21"
    const level = levelMatch[2].toUpperCase();            // "aaa" → "AAA"
    // Insert a dot for sub-versions: 21 → 2.1, 22 → 2.2
    const vDisplay = ver.length === 2 ? `${ver[0]}.${ver[1]}` : ver;
    return `WCAG ${vDisplay} ${level}`;
  }

  // Success-criterion pattern: 3 or 4 digits → X.Y.Z or X.Y.ZZ
  // Principle (X) and guideline (Y) are always single digits; only the SC number (Z) can be 2 digits.
  // e.g. wcag146 → 1.4.6 | wcag1411 → 1.4.11 | wcag2410 → 2.4.10
  const scMatch = s.match(/^(\d)(\d)(\d{1,2})$/);
  if (scMatch) {
    return `WCAG ${scMatch[1]}.${scMatch[2]}.${scMatch[3]}`;
  }

  // Fallback: just capitalise prefix
  return `WCAG ${s}`;
}

function buildAIIssueBrief(result) {
  const summary = result.summary || {};
  const violations = result.violations || [];
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  violations.forEach(v => { if (counts[v.impact] !== undefined) counts[v.impact]++; });

  const text = value => String(value ?? '').replace(/\r?\n/g, ' ').trim();
  const list = value => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
  const lines = [
    '# Accessibility Remediation Brief',
    '',
    '> Purpose: Give an AI coding assistant the complete scan context needed to locate and resolve the accessibility issues below.',
    '',
    '## Instructions for the AI assistant',
    '',
    '1. Resolve issues in severity order: critical, serious, moderate, then minor.',
    '2. Preserve existing behavior and visual design unless a change is required for accessibility.',
    '3. Treat selectors and HTML snippets as evidence from scan time; confirm them against the current source before editing.',
    '4. Apply fixes to shared components when multiple affected elements have the same root cause.',
    '5. After changes, run the project tests and repeat the accessibility scan.',
    '',
    '## Scan context',
    '',
    `- **URL:** ${text(result.url) || 'Not provided'}`,
    `- **Scanned at:** ${text(result.scanned_at || result.scannedAt) || 'Not provided'}`,
    `- **WCAG level:** ${text(summary.wcag_level || summary.level) || 'Not provided'}`,
    `- **Score:** ${summary.score ?? 0}/100 (${text(summary.grade) || 'ungraded'})`,
    `- **Compliance:** ${Number(summary.compliance_pct ?? summary.compliancePct ?? 0).toFixed(1)}%`,
    `- **Issues:** ${violations.length} rules; ${violations.reduce((total, v) => total + (v.nodes || []).length, 0)} affected elements`,
    `- **Severity:** ${counts.critical} critical, ${counts.serious} serious, ${counts.moderate} moderate, ${counts.minor} minor`,
    '',
    '## Issues',
    '',
  ];

  if (!violations.length) {
    lines.push('No automated accessibility violations were found.', '');
  }

  violations.forEach((violation, issueIndex) => {
    const tags = list(violation.tags);
    const suggestion = violation.dev_suggestion || violation.devSuggestion;
    lines.push(
      `### ${issueIndex + 1}. ${text(violation.id) || 'Unknown rule'} — ${text(violation.impact || 'unknown').toUpperCase()}`,
      '',
      `- **What failed:** ${text(violation.help || violation.description) || 'No description provided'}`,
      `- **Description:** ${text(violation.description) || 'No additional description provided'}`,
      `- **WCAG/axe tags:** ${tags.length ? tags.join(', ') : 'Not provided'}`,
      `- **Reference:** ${text(violation.help_url || violation.helpUrl) || 'Not provided'}`,
      `- **Affected elements:** ${(violation.nodes || []).length}`,
      ''
    );

    (violation.nodes || []).forEach((node, nodeIndex) => {
      const targets = list(node.target);
      lines.push(`#### Affected element ${nodeIndex + 1}`, '');
      if (targets.length) lines.push(`- **Selector:** \`${targets.join(' > ').replace(/`/g, '\\`')}\``);
      const failure = text(node.failureSummary || node.failure_summary);
      if (failure) lines.push(`- **Failure reason:** ${failure}`);
      if (node.html) lines.push('', '~~~html', String(node.html).trim(), '~~~');
      lines.push('');
    });

    if (suggestion) {
      lines.push('#### Suggested remediation', '');
      if (suggestion.title) lines.push(`**${text(suggestion.title)}**`, '');
      list(suggestion.fix_steps).forEach((step, stepIndex) => lines.push(`${stepIndex + 1}. ${step}`));
      if (suggestion.code_before) lines.push('', 'Before:', '', `~~~${text(suggestion.language) || 'html'}`, String(suggestion.code_before).trim(), '~~~');
      if (suggestion.code_after) lines.push('', 'After:', '', `~~~${text(suggestion.language) || 'html'}`, String(suggestion.code_after).trim(), '~~~');
      lines.push('');
    }
  });

  lines.push('## Completion checklist', '', '- [ ] All critical issues resolved', '- [ ] All serious issues resolved', '- [ ] Moderate and minor issues reviewed', '- [ ] Keyboard and screen-reader behavior manually checked', '- [ ] Automated tests pass', '- [ ] Accessibility scan rerun', '');
  return lines.join('\n');
}

function downloadAIIssueBrief() {
  if (state.isScanningDiscoveredLinks) {
    showError('Please wait for the scan to complete before downloading the report.');
    return;
  }
  if (!state.scanResult) return;
  const results = [state.scanResult, ...(state.scanResult.embedded_results || [])];
  const markdown = results.map(r => buildAIIssueBrief(r)).join('\n\n---\n\n');
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const objectURL = URL.createObjectURL(blob);
  const link = document.createElement('a');
  let host = 'scanned-page';
  try { host = new URL(state.scanResult.url).hostname || host; } catch (_) { /* use fallback */ }
  link.href = objectURL;
  link.download = `${host.replace(/[^a-z0-9.-]+/gi, '-')}-accessibility-issues.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
}

// ─── Downloadable HTML Report ─────────────────────────────────
function buildSingleUserReport(result, isFirst) {
  const summary    = result.summary || {};
  const violations = result.violations || [];
  const passes     = result.passes || [];

  const score         = summary.score ?? 0;
  const grade         = summary.grade ?? 'F';
  const compliancePct = Number(summary.compliance_pct ?? summary.compliancePct ?? 0).toFixed(1);
  const violCount     = summary.violation_count ?? summary.violationCount ?? violations.length;
  const passCount     = summary.pass_count ?? summary.passCount ?? passes.length;
  const incompleteCount = summary.incomplete_count ?? summary.incompleteCount ?? 0;
  const wcagLevel    = summary.wcag_level || summary.level || 'AA';
  const scannedAt    = result.scanned_at || result.scannedAt || new Date().toISOString();
  const durationMs   = result.duration_ms || result.durationMs || 0;

  const impactCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  violations.forEach(v => { if (impactCounts[v.impact] !== undefined) impactCounts[v.impact]++; });

  const gradeColors = { A: '#10b981', B: '#06b6d4', C: '#f59e0b', D: '#f97316', F: '#ef4444' };
  const impactColors = { critical: '#ef4444', serious: '#f97316', moderate: '#eab308', minor: '#22c55e' };
  const impactBgColors = { critical: '#fef2f2', serious: '#fff7ed', moderate: '#fefce8', minor: '#f0fdf4' };
  const gradeColor = gradeColors[grade] || '#6366f1';

  const esc = str => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let violationsHTML = '';
  if (violations.length === 0) {
    violationsHTML = '<div style="text-align:center;padding:40px 20px;color:#6b7280;"><div style="font-size:2.5rem;margin-bottom:12px;">&#127881;</div><div style="font-size:1.1rem;font-weight:600;color:#10b981;margin-bottom:6px;">No violations found!</div><div>This page meets all checked WCAG criteria.</div></div>';
  } else {
    violations
      .sort((a, b) => impactOrder(b.impact) - impactOrder(a.impact))
      .forEach((v, idx) => {
        const impact = v.impact || 'minor';
        const color = impactColors[impact] || '#6b7280';
        const bgColor = impactBgColors[impact] || '#f9fafb';
        const nodes = v.nodes || [];
        const wcagTags = (v.tags || []).filter(t => /^wcag/i.test(t) && t.length <= 9).map(formatWcagTag).join(', ');

        let nodesHTML = '';
        nodes.slice(0, 5).forEach(n => {
          const html = n.html ? esc(n.html) : '';
          const summary = n.failureSummary || n.failure_summary || '';
          nodesHTML += `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px 12px;margin-bottom:6px;font-family:'JetBrains Mono',monospace;font-size:0.78rem;color:#374151;word-break:break-all;white-space:pre-wrap;">${html}${summary ? '<div style="margin-top:4px;color:#6b7280;font-family:sans-serif;font-size:0.75rem;">' + esc(summary.replace(/^Fix (?:any|all) of the following:\s*/i, '')) + '</div>' : ''}</div>`;
        });
        if (nodes.length > 5) nodesHTML += `<p style="font-size:0.8rem;color:#9ca3af;">+${nodes.length - 5} more element(s)</p>`;

        const ds = v.dev_suggestion || v.devSuggestion || null;
        let suggestionHTML = '';
        if (ds) {
          const steps = (ds.fix_steps || []).map(s => `<li>${esc(s)}</li>`).join('');
          suggestionHTML = `<div style="margin-top:12px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;"><div style="background:#f5f3ff;padding:8px 12px;font-size:0.82rem;font-weight:600;color:#7c3aed;">&#128295; ${esc(ds.title || 'Developer Fix Suggestion')}</div><div style="padding:10px 14px;">`;
          if (steps) suggestionHTML += `<ol style="margin:0 0 8px 16px;padding:0;font-size:0.8rem;color:#374151;line-height:1.7;">${steps}</ol>`;
          if (ds.code_before || ds.code_after) {
            suggestionHTML += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
            if (ds.code_before) suggestionHTML += `<div><div style="font-size:0.7rem;font-weight:700;padding:4px 8px;background:#fef2f2;color:#ef4444;border-radius:4px 4px 0 0;">BEFORE</div><pre style="margin:0;padding:8px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:0 0 4px 4px;font-size:0.72rem;white-space:pre-wrap;word-break:break-all;">${esc(ds.code_before)}</pre></div>`;
            if (ds.code_after) suggestionHTML += `<div><div style="font-size:0.7rem;font-weight:700;padding:4px 8px;background:#f0fdf4;color:#16a34a;border-radius:4px 4px 0 0;">AFTER</div><pre style="margin:0;padding:8px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:0 0 4px 4px;font-size:0.72rem;white-space:pre-wrap;word-break:break-all;">${esc(ds.code_after)}</pre></div>`;
            suggestionHTML += '</div>';
          }
          suggestionHTML += '</div></div>';
        }

        violationsHTML += `
          <div style="border:1px solid #e5e7eb;border-left:4px solid ${color};border-radius:8px;padding:16px 20px;margin-bottom:12px;background:#fff;page-break-inside:avoid;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${color};color:#fff;font-size:0.7rem;font-weight:700;flex-shrink:0;">${idx + 1}</span>
                <span style="font-size:0.9rem;font-weight:600;color:#1f2937;">${esc(v.id || '')}</span>
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                ${wcagTags ? `<span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;background:#eff6ff;color:#2563eb;">${wcagTags}</span>` : ''}
                <span style="font-size:0.72rem;font-weight:600;padding:3px 10px;border-radius:99px;text-transform:uppercase;background:${bgColor};color:${color};">${impact}</span>
              </div>
            </div>
            <p style="font-size:0.85rem;color:#4b5563;margin:0 0 6px;">${esc(v.description || v.help || '')}</p>
            ${v.help_url || v.helpUrl ? `<a href="${esc(v.help_url || v.helpUrl)}" style="font-size:0.8rem;color:#6366f1;" target="_blank" rel="noopener">${esc(v.help || 'WCAG reference')} &#8599;</a>` : ''}
            ${nodes.length > 0 ? `<div style="margin-top:10px;"><div style="font-size:0.78rem;font-weight:600;color:#6b7280;margin-bottom:6px;">Affected Elements (${nodes.length})</div>${nodesHTML}</div>` : ''}
            ${suggestionHTML}
          </div>`;
      });
  }

  let passesHTML = '';
  if (passes.length > 0) {
    const passItems = passes.map(p => {
      const id = typeof p === 'string' ? p : (p.id || '');
      return `<span style="display:inline-block;background:#f0fdf4;border:1px solid #bbf7d0;color:#16a34a;border-radius:6px;padding:4px 10px;font-size:0.78rem;font-family:monospace;">${esc(id)}</span>`;
    }).join(' ');
    passesHTML = `
      <div style="margin-top:32px;page-break-before:auto;">
        <h2 style="font-size:1.1rem;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-bottom:14px;">Passing Rules (${passCount})</h2>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${passItems}</div>
      </div>`;
  }

  return `
<div class="container"${!isFirst ? ' style="page-break-before: always; margin-top: 60px; padding-top: 40px; border-top: 4px dashed #e5e7eb;"' : ''}>

  <!-- Header -->
  <div style="border-bottom:2px solid #e5e7eb;padding:32px 0 24px;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
      <span style="font-size:1.8rem;">&#9855;</span>
      <h1 style="font-size:1.5rem;font-weight:700;color:#111827;">Accessibility Report</h1>
    </div>
    <p style="font-size:0.9rem;color:#6366f1;word-break:break-all;margin-top:4px;">${esc(result.url || '')}</p>
    <p style="font-size:0.78rem;color:#9ca3af;margin-top:4px;">Scanned ${new Date(scannedAt).toLocaleString()} &middot; WCAG ${wcagLevel}${durationMs ? ` &middot; ${(durationMs / 1000).toFixed(1)}s` : ''}</p>
  </div>

  <!-- Score Cards -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:14px;padding:24px 0;">
    <div style="text-align:center;padding:20px;border-radius:12px;border:1px solid #e5e7eb;background:#fafafa;">
      <div style="font-size:2.2rem;font-weight:700;color:${gradeColor};">${score}</div>
      <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;margin-top:4px;">Score (0-100)</div>
    </div>
    <div style="text-align:center;padding:20px;border-radius:12px;border:1px solid #e5e7eb;background:#fafafa;">
      <div style="font-size:2.2rem;font-weight:700;color:${gradeColor};">${grade}</div>
      <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;margin-top:4px;">Grade</div>
    </div>
    <div style="text-align:center;padding:20px;border-radius:12px;border:1px solid #e5e7eb;background:#fafafa;">
      <div style="font-size:2.2rem;font-weight:700;color:#ef4444;">${violCount}</div>
      <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;margin-top:4px;">Violations</div>
    </div>
    <div style="text-align:center;padding:20px;border-radius:12px;border:1px solid #e5e7eb;background:#fafafa;">
      <div style="font-size:2.2rem;font-weight:700;color:#10b981;">${passCount}</div>
      <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;margin-top:4px;">Passes</div>
    </div>
    <div style="text-align:center;padding:20px;border-radius:12px;border:1px solid #e5e7eb;background:#fafafa;">
      <div style="font-size:2.2rem;font-weight:700;color:#6366f1;">${compliancePct}%</div>
      <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;margin-top:4px;">Compliance</div>
    </div>
  </div>

  <!-- Compliance Bar -->
  <div style="margin-bottom:24px;">
    <div style="background:#e5e7eb;border-radius:99px;height:10px;overflow:hidden;">
      <div style="height:100%;border-radius:99px;background:linear-gradient(90deg,#6366f1,#8b5cf6);width:${compliancePct}%;"></div>
    </div>
  </div>

  <!-- Impact Breakdown -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:28px;">
    <div style="text-align:center;padding:12px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;">
      <div style="font-size:1.4rem;font-weight:700;color:#ef4444;">${impactCounts.critical}</div>
      <div style="font-size:0.72rem;color:#b91c1c;">Critical</div>
    </div>
    <div style="text-align:center;padding:12px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;">
      <div style="font-size:1.4rem;font-weight:700;color:#f97316;">${impactCounts.serious}</div>
      <div style="font-size:0.72rem;color:#c2410c;">Serious</div>
    </div>
    <div style="text-align:center;padding:12px;border-radius:8px;background:#fefce8;border:1px solid #fef08a;">
      <div style="font-size:1.4rem;font-weight:700;color:#eab308;">${impactCounts.moderate}</div>
      <div style="font-size:0.72rem;color:#a16207;">Moderate</div>
    </div>
    <div style="text-align:center;padding:12px;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0;">
      <div style="font-size:1.4rem;font-weight:700;color:#22c55e;">${impactCounts.minor}</div>
      <div style="font-size:0.72rem;color:#15803d;">Minor</div>
    </div>
  </div>

  <!-- Violations -->
  <div>
    <h2 style="font-size:1.1rem;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-bottom:14px;">Violations (${violCount})</h2>
    ${violationsHTML}
  </div>

  <!-- Passes -->
  ${passesHTML}

  <!-- Footer -->
  <div style="text-align:center;padding:32px 0;font-size:0.75rem;color:#9ca3af;border-top:1px solid #e5e7eb;margin-top:32px;">
    Generated by AccessScan &middot; ${new Date(scannedAt).toLocaleString()}
  </div>

</div>`;
}

function buildUserReport(mainResult) {
  const results = [mainResult, ...(mainResult.embedded_results || [])];
  const bodyHTML = results.map((r, idx) => buildSingleUserReport(r, idx === 0)).join('\n');
  const esc = str => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Accessibility Report - ${esc(mainResult.url || '')}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #fff; color: #1f2937; line-height: 1.6; }
  .container { max-width: 900px; margin: 0 auto; padding: 0 24px; }
  @media print {
    body { font-size: 11pt; }
    .container { max-width: 100%; padding: 0; }
    .no-print { display: none !important; }
    a[href]::after { content: " (" attr(href) ")"; font-size: 0.8em; color: #6b7280; }
  }
</style>
</head>
<body>
${bodyHTML}
</body>
</html>`;
}

function downloadUserReport() {
  if (state.isScanningDiscoveredLinks) {
    showError('Please wait for the scan to complete before downloading the report.');
    return;
  }
  if (!state.scanResult) return;
  const html = buildUserReport(state.scanResult);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const objectURL = URL.createObjectURL(blob);
  const link = document.createElement('a');
  let host = 'scanned-page';
  try { host = new URL(state.scanResult.url).hostname || host; } catch (_) { /* use fallback */ }
  link.href = objectURL;
  link.download = `${host.replace(/[^a-z0-9.-]+/gi, '-')}-accessibility-report.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
}

// ─── Compliance Report Generation ─────────────────────────────

/**
 * Registry of all supported compliance standards.
 * Each entry maps the UI value to:
 *   endpoint  - the backend route key (ada | vpat | en301549)
 *   label     - human-readable name used in toasts/filenames
 *   basis     - the underlying technical standard
 *   note      - shown in the info card inside the modal
 */
const COMPLIANCE_STANDARDS = {
  ada: {
    endpoint: 'ada',
    label: 'ADA Title III',
    jurisdiction: '🇺🇸 United States',
    basis: 'WCAG 2.1 Level AA (per DOJ 2024 rule)',
    note: 'Applies to places of public accommodation. Courts uniformly apply WCAG 2.1 AA (Robles v. Domino\'s, 9th Cir. 2019). DOJ April 2024 rule mandates AA for Title II entities; Title III follows the same standard in practice.',
  },
  vpat: {
    endpoint: 'vpat',
    label: 'Section 508 VPAT',
    jurisdiction: '🇺🇸 United States (Federal)',
    basis: 'WCAG 2.0 Level AA + Section 508 (2017 refresh)',
    note: 'Required for technology procured by US federal agencies under the Rehabilitation Act. Produced as a Voluntary Product Accessibility Template (VPAT® INT edition). Note: Section 508 references WCAG 2.0, not 2.1.',
  },
  cvaa: {
    endpoint: 'cvaa',
    label: 'CVAA',
    jurisdiction: '🇺🇸 United States (FCC)',
    basis: 'WCAG 2.0 Level AA (telecom & video context)',
    note: 'The 21st Century Communications and Video Accessibility Act covers advanced communications services and video programming. Web-content obligations overlap with ADA/Section 508. This report uses the FCC recordkeeping framework.',
  },
  en301549: {
    endpoint: 'en301549',
    label: 'EN 301 549',
    jurisdiction: '🇪🇺 European Union',
    basis: 'WCAG 2.1 Level AA (Clause 9)',
    note: 'The harmonised EU standard for ICT accessibility. Clause 9 = WCAG 2.1 AA verbatim. Mandated by the EU Web Accessibility Directive (2016/2102) for public sector and the European Accessibility Act (2019/882) for private sector from June 2025.',
  },
  eaa: {
    endpoint: 'eaa',
    label: 'EAA (European Accessibility Act)',
    jurisdiction: '🇪🇺 European Union',
    basis: 'EN 301 549 → WCAG 2.1 Level AA',
    note: 'The European Accessibility Act (Directive 2019/882) came into force for private sector from 28 June 2025. Technical conformance is measured against EN 301 549 V3.2.1. This report uses the EAA-specific EN 301 549 ACR format.',
  },
  equality_act: {
    endpoint: 'uk',
    label: 'Equality Act 2010 (UK)',
    jurisdiction: '🇬🇧 United Kingdom',
    basis: 'WCAG 2.1 Level AA (PSBAR / BS 8878)',
    note: 'Post-Brexit UK law covering disability discrimination. Public sector bodies must follow Public Sector Bodies Accessibility Regulations (PSBAR) mandating WCAG 2.1 AA. This report uses the UK Gov Accessibility Statement framework.',
  },
  aoda: {
    endpoint: 'aoda',
    label: 'AODA',
    jurisdiction: '🇨🇦 Canada — Ontario',
    basis: 'WCAG 2.0 Level AA (IASR 2012, updated 2021)',
    note: 'The Accessibility for Ontarians with Disabilities Act requires WCAG 2.0 AA for large private-sector organisations. Many organisations voluntarily target WCAG 2.1 AA. This report uses the Ontario AODA compliance declaration format.',
  },
  aca: {
    endpoint: 'aca',
    label: 'ACA (Accessible Canada Act)',
    jurisdiction: '🇨🇦 Canada — Federal',
    basis: 'WCAG 2.1 Level AA (proposed federal standard)',
    note: 'The Accessible Canada Act (S.C. 2019, c. 10) applies to federally regulated organisations. Technical standards are still being formalised; WCAG 2.1 AA is the de facto benchmark. This report uses the ACA specific statement framework.',
  },
  bitv: {
    endpoint: 'bitv',
    label: 'BITV 2.0',
    jurisdiction: '🇩🇪 Germany',
    basis: 'EN 301 549 → WCAG 2.1 Level AA',
    note: 'The Barrierefreie-Informationstechnik-Verordnung (BITV 2.0) implements the EU Web Accessibility Directive for German federal public bodies. It references EN 301 549 V3.2.1 and WCAG 2.1 AA. This report uses the German Erklärung zur Barrierefreiheit format.',
  },
  dda: {
    endpoint: 'dda',
    label: 'DDA (Australia)',
    jurisdiction: '🇦🇺 Australia',
    basis: 'WCAG 2.1 Level AA (ACAG / AGMO advisory)',
    note: 'Australia\'s Disability Discrimination Act 1992 prohibits disability discrimination in goods and services including websites. The Australian Human Rights Commission advises WCAG 2.1 AA conformance. This report uses the Australian DTA format.',
  },
  gigw: {
    endpoint: 'gigw',
    label: 'GIGW (India)',
    jurisdiction: '🇮🇳 India',
    basis: 'WCAG 2.0 / 2.1 Level AA (GIGW 3.0)',
    note: 'Guidelines for Indian Government Websites v3.0 (2023) mandate WCAG 2.0/2.1 AA for all central and state government portals under the Rights of Persons with Disabilities Act, 2016. This report uses the GIGW 3.0 checklist framework.',
  },
};

/**
 * Updates the info card in the compliance modal when the user changes the
 * standard dropdown. Shows jurisdiction, technical basis, and a plain-English note.
 */
function updateComplianceInfoCard() {
  const sel = document.getElementById('modal-compliance-standard');
  const card = document.getElementById('compliance-standard-info');
  if (!sel || !card) return;
  const info = COMPLIANCE_STANDARDS[sel.value];
  if (!info) { card.innerHTML = ''; return; }
  card.innerHTML = `
    <span style="font-weight:600;color:var(--text-primary);">${info.jurisdiction}</span>
    &nbsp;·&nbsp;
    <span style="color:var(--text-accent);">${info.basis}</span>
    <br>
    ${info.note}
    ${info.endpoint !== sel.value ? `<br><em style="color:var(--text-muted);">Report format: ${COMPLIANCE_STANDARDS[info.endpoint]?.label || info.endpoint} template</em>` : ''}
  `;
}

/**
 * Calls the backend compliance report endpoint and either opens HTML in a new
 * tab or triggers a PDF download.
 *
 * @param {string} standard  - any key from COMPLIANCE_STANDARDS
 * @param {string} format    - "html" | "pdf"
 * @param {object} meta      - { product_name, vendor_name, product_version, contact_info, notes }
 * @param {object} scanData  - the ScanResult from the last scan (provides the URL)
 */
async function generateComplianceReportDirect(standard, format, meta, scanData) {
  if (!scanData || !scanData.url) {
    showToast('No scan result available. Please run a scan first.', 'error');
    return;
  }

  const stdInfo = COMPLIANCE_STANDARDS[standard] || { endpoint: standard, label: standard.toUpperCase() };
  const label = stdInfo.label;
  const endpoint = stdInfo.endpoint;        // resolved backend route
  const toast = showToast(`Generating ${label} report…`, 'info', true);


  const ok = await ensureToken();
  if (!ok) {
    toast?.hide();
    showToast('Session expired — please refresh the page.', 'error');
    return;
  }

  try {
    const apiEndpoint = `/api/v1/report/${endpoint}`;
    const payload = {
      url: scanData.url,
      // Lets the server build the report from the scan already shown,
      // instead of scanning the page a second time.
      scan_id: scanData.scan_id || scanData.report_id || undefined,
      // For a multi-page scan the report covers every page that was scanned.
      crawl_id: scanData.crawl_id || undefined,
      format: format || 'html',
      meta: meta || {},
    };

    const res = await fetch(`${apiBase()}${apiEndpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      body: JSON.stringify(payload),
    });

    toast?.hide();

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      showToast(`Failed to generate ${label} report: ${err.error || 'Unknown error'}`, 'error');
      return;
    }

    if (format === 'pdf') {
      const blob = await res.blob();
      const objectURL = URL.createObjectURL(blob);
      const link = document.createElement('a');
      let host = 'report';
      try { host = new URL(scanData.url).hostname || host; } catch (_) {}
      link.href = objectURL;
      link.download = `${host.replace(/[^a-z0-9.-]+/gi, '-')}-${standard}-report.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectURL), 2000);
      showToast(`${label} PDF downloaded.`, 'success');
    } else {
      // Open HTML report in new tab
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const objectURL = URL.createObjectURL(blob);
      const tab = window.open(objectURL, '_blank');
      if (!tab) {
        // Fallback: force download if popup was blocked
        const link = document.createElement('a');
        let host = 'report';
        try { host = new URL(scanData.url).hostname || host; } catch (_) {}
        link.href = objectURL;
        link.download = `${host.replace(/[^a-z0-9.-]+/gi, '-')}-${standard}-report.html`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        showToast(`${label} report downloaded (popup blocked).`, 'success');
      } else {
        showToast(`${label} report opened in a new tab.`, 'success');
      }
      setTimeout(() => URL.revokeObjectURL(objectURL), 5000);
    }
  } catch (err) {
    toast?.hide();
    showToast(`Error generating ${label} report: ${err.message}`, 'error');
  }
}

/**
 * Reads the compliance modal form values and triggers generateComplianceReportDirect().
 * Called by the "Generate" button inside the results-view compliance modal.
 */
async function submitComplianceModal() {
  if (!state.scanResult) {
    showToast('No scan result available.', 'error');
    return;
  }
  const standard = document.getElementById('modal-compliance-standard')?.value || 'ada';
  const format   = document.getElementById('modal-compliance-format')?.value || 'html';
  const meta = {
    product_name:    document.getElementById('modal-comp-product-name')?.value || '',
    vendor_name:     document.getElementById('modal-comp-vendor-name')?.value || '',
    product_version: document.getElementById('modal-comp-version')?.value || '',
    contact_info:    document.getElementById('modal-comp-contact')?.value || '',
    notes:           document.getElementById('modal-comp-notes')?.value || '',
  };
  closeComplianceModal();
  await generateComplianceReportDirect(standard, format, meta, state.scanResult);
}

function openComplianceModal() {
  const modal = document.getElementById('compliance-report-modal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  modal.removeAttribute('inert');
  updateComplianceInfoCard();
  setTimeout(() => document.getElementById('modal-compliance-standard')?.focus(), 100);
  document.body.style.overflow = 'hidden';
}

function closeComplianceModal() {
  const modal = document.getElementById('compliance-report-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('inert', '');
  document.body.style.overflow = '';
}


// The spreadsheet library (~1 MB) is only needed for the Excel download, so it
// is fetched on first use instead of blocking every page load.
const XLSX_SRC = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let xlsxLoading = null;
function loadXLSX() {
  if (typeof XLSX !== 'undefined') return Promise.resolve();
  if (!xlsxLoading) {
    xlsxLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = XLSX_SRC;
      script.onload = () => resolve();
      script.onerror = () => { xlsxLoading = null; script.remove(); reject(new Error('load failed')); };
      document.head.appendChild(script);
    });
  }
  return xlsxLoading;
}

async function downloadExcelReport() {
  if (state.isScanningDiscoveredLinks) {
    showError('Please wait for the scan to complete before downloading the report.');
    return;
  }
  if (!state.scanResult) return;
  if (typeof XLSX === 'undefined') {
    const toast = showToast('Preparing Excel report…', 'info', true);
    try {
      await loadXLSX();
    } catch (_) {
      toast?.hide();
      showError('Could not load the Excel export library. Check your connection and try again.');
      return;
    }
    toast?.hide();
  }
  const result = state.scanResult;
  const wb = XLSX.utils.book_new();

  const safeSheet = (name) => name.replace(/[\\/*?:\[\]]/g, '_').substring(0, 31);
  const ts = (d) => d ? new Date(d).toLocaleString() : '';

  function buildSummaryRows(r) {
    const s = r.summary || {};
    return [
      ['URL', r.url || ''],
      ['Scanned At', ts(r.scanned_at)],
      ['Duration (ms)', r.duration_ms ?? ''],
      ['Score', s.score ?? ''],
      ['Grade', s.grade || ''],
      ['Compliance %', s.compliance_pct ?? ''],
      ['WCAG Level', s.wcag_level || s.level || ''],
      ['Violations', s.violation_count ?? (r.violations || []).length],
      ['Passes', s.pass_count ?? (r.passes || []).length],
    ];
  }

  function buildViolationRows(violations) {
    if (!violations || violations.length === 0) return [['No violations found']];
    const headers = ['Impact', 'Rule ID', 'Description', 'Help', 'WCAG Tags', 'Affected Elements', 'Failure Summary', 'Help URL'];
    const rows = [headers];
    violations
      .sort((a, b) => impactOrder(b.impact) - impactOrder(a.impact))
      .forEach(v => {
        const wcagTags = (v.tags || []).filter(t => t.startsWith('wcag')).join(', ');
        const nodes = v.nodes || [];
        if (nodes.length === 0) {
          rows.push([v.impact || '', v.id || '', v.description || '', v.help || '', wcagTags, '', '', v.helpUrl || v.help_url || '']);
        } else {
          nodes.forEach((n, i) => {
            rows.push([
              i === 0 ? (v.impact || '') : '',
              i === 0 ? (v.id || '') : '',
              i === 0 ? (v.description || '') : '',
              i === 0 ? (v.help || '') : '',
              i === 0 ? wcagTags : '',
              n.html || '',
              n.failureSummary || n.failure_summary || '',
              i === 0 ? (v.helpUrl || v.help_url || '') : '',
            ]);
          });
        }
      });
    return rows;
  }

  function buildPassRows(passes) {
    if (!passes || passes.length === 0) return [['No pass data']];
    return [['Rule ID', 'Nodes Tested'], ...passes.map(p => [p.id || '', p.node_count ?? ''])];
  }

  function addPageSheet(wb, r, sheetName) {
    const summaryRows = buildSummaryRows(r);
    const violRows = buildViolationRows(r.violations);
    const passRows = buildPassRows(r.passes || r.pass_rules);

    const data = [
      ...summaryRows,
      [],
      ['VIOLATIONS'],
      ...violRows,
      [],
      ['PASSED RULES'],
      ...passRows,
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Bold summary labels and section headers
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let R = range.s.r; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: 0 })];
      if (cell && (R < summaryRows.length || cell.v === 'VIOLATIONS' || cell.v === 'PASSED RULES')) {
        if (!cell.s) cell.s = {};
        cell.s.font = { bold: true };
      }
    }

    // Auto-size columns
    const colWidths = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
      let max = 10;
      for (let R = range.s.r; R <= range.e.r; R++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (cell && cell.v != null) max = Math.max(max, Math.min(String(cell.v).length + 2, 60));
      }
      colWidths.push({ wch: max });
    }
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, safeSheet(sheetName));
  }

  // 1. Index sheet
  const embedded = result.embedded_results || [];
  const indexRows = [
    ['AccessScan — Full Report'],
    ['Generated', new Date().toLocaleString()],
    [],
    ['#', 'Page URL', 'Score', 'Grade', 'Compliance %', 'Violations', 'Passes', 'Sheet'],
  ];
  const mainSummary = result.summary || {};
  const mainSheetName = 'Main Page';
  indexRows.push([
    1,
    result.url || '',
    mainSummary.score ?? '',
    mainSummary.grade || '',
    mainSummary.compliance_pct ?? '',
    mainSummary.violation_count ?? (result.violations || []).length,
    mainSummary.pass_count ?? (result.passes || []).length,
    mainSheetName,
  ]);
  const sheetNames = [];
  embedded.forEach((sub, i) => {
    const s = sub.summary || {};
    let name = 'Link ' + (i + 1);
    try { name = new URL(sub.url).pathname.replace(/\//g, '_').substring(0, 20) || name; } catch (_) {}
    name = safeSheet(name) || 'Link ' + (i + 1);
    if (sheetNames.includes(name)) name = name.substring(0, 28) + '_' + (i + 1);
    sheetNames.push(name);
    indexRows.push([
      i + 2,
      sub.url || '',
      s.score ?? '',
      s.grade || '',
      s.compliance_pct ?? '',
      s.violation_count ?? (sub.violations || []).length,
      s.pass_count ?? (sub.passes || []).length,
      name,
    ]);
  });

  const indexWs = XLSX.utils.aoa_to_sheet(indexRows);
  indexWs['!cols'] = [{ wch: 4 }, { wch: 50 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, indexWs, 'Index');

  // 2. Main page sheet
  addPageSheet(wb, result, mainSheetName);

  // 3. Linked page sheets
  embedded.forEach((sub, i) => {
    addPageSheet(wb, sub, sheetNames[i]);
  });

  // Download
  let host = 'scan-report';
  try { host = new URL(result.url).hostname || host; } catch (_) {}
  XLSX.writeFile(wb, `${host.replace(/[^a-z0-9.-]+/gi, '-')}-accessibility-report.xlsx`);
}

// ─── Admin Panel ───────────────────────────────────────────────
// Step 1: 5-click the dot → show password prompt modal
// Step 2: enter ADMIN_PASSWORD → verify via POST /api/v1/admin/verify
// Step 3: on success → open settings drawer

function triggerAdminClick() {
  adminClickCount++;
  clearTimeout(adminClickTimer);
  if (adminClickCount >= 5) {
    adminClickCount = 0;
    window.location.href = '/admin';
  } else {
    adminClickTimer = setTimeout(() => { adminClickCount = 0; }, 3000);
  }
}

// ─── Email-Code Auth & Session Helpers ────────────────────────
let pendingScanCallback = null;
let pendingLoginEmail = '';
let resendTimerId = null;

function isUserRegistered() {
  return localStorage.getItem('accessscan_registered') === '1' || sessionStorage.getItem('accessscan_registered') === '1';
}

function isUserLoggedIn() {
  try {
    const token = localStorage.getItem(LS_KEY_TOKEN);
    const kind = localStorage.getItem(LS_KEY_TOKEN_KIND);
    const exp = parseInt(localStorage.getItem(LS_KEY_TOKEN_EXP) || '0', 10);
    return Boolean(token && kind === 'user' && Date.now() < exp - TOKEN_REFRESH_BUFFER_MS);
  } catch (_) {
    return false;
  }
}

function needsLogin() {
  return state.accessApprovalEnabled && !isUserLoggedIn();
}

function clearAccessToken() {
  localStorage.removeItem(LS_KEY_TOKEN);
  localStorage.removeItem(LS_KEY_TOKEN_EXP);
  localStorage.removeItem(LS_KEY_TOKEN_KIND);
  state.token = null;
  state.tokenExp = null;
}

function showAccessRemaining(remaining) {
  const note = $('access-remaining-note');
  if (!note || typeof remaining !== 'number') return;
  note.textContent = `${remaining} scan${remaining === 1 ? '' : 's'} left on your account.`;
  note.hidden = false;
}

function updateHeaderSession() {
  const bar = $('user-session-bar');
  const emailEl = $('user-email-label');
  const scansEl = $('user-scans-left');
  const signInBtn = $('user-signin-btn');
  const loggedIn = isUserLoggedIn();
  const email = state.userEmail || localStorage.getItem('accessscan_user_email') || '';

  if (bar && emailEl && scansEl) {
    if (loggedIn && email) {
      emailEl.textContent = email;
      scansEl.textContent = typeof state.scansLeft === 'number'
        ? `${state.scansLeft} scan${state.scansLeft === 1 ? '' : 's'} left`
        : '';
      bar.classList.remove('hidden');
    } else {
      emailEl.textContent = '';
      scansEl.textContent = '';
      bar.classList.add('hidden');
    }
  }
  if (signInBtn) {
    signInBtn.classList.toggle('hidden', loggedIn || !state.accessApprovalEnabled);
  }
  const guestBanner = $('guest-signin-banner');
  if (guestBanner) {
    guestBanner.classList.toggle('hidden', loggedIn || !state.accessApprovalEnabled);
  }
}

async function refreshAuthMe() {
  if (!isUserLoggedIn()) {
    updateHeaderSession();
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/v1/auth/me`, {
      headers: { 'Authorization': `Bearer ${state.token}` },
    });
    if (res.status === 401) {
      await logoutUser();
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    state.userEmail = data.email || state.userEmail;
    state.scansLeft = typeof data.scans_left === 'number' ? data.scans_left : state.scansLeft;
    if (state.userEmail) localStorage.setItem('accessscan_user_email', state.userEmail);
    updateHeaderSession();
    if (typeof state.scansLeft === 'number') showAccessRemaining(state.scansLeft);
  } catch (_) {}
}

async function logoutUser() {
  clearAccessToken();
  localStorage.removeItem('accessscan_user_email');
  state.userEmail = null;
  state.scansLeft = null;
  const note = $('access-remaining-note');
  if (note) note.hidden = true;
  updateHeaderSession();
  await ensureToken();
}

function clearResendTimer() {
  if (resendTimerId) {
    clearInterval(resendTimerId);
    resendTimerId = null;
  }
}

function startResendCountdown() {
  clearResendTimer();
  const resendBtn = $('app-login-resend');
  const statusEl = $('app-verify-status');
  if (resendBtn) resendBtn.classList.add('hidden');
  let remaining = 60;
  if (statusEl) {
    statusEl.textContent = `You can resend the code in ${remaining}s.`;
    statusEl.style.display = 'block';
  }
  resendTimerId = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearResendTimer();
      if (resendBtn) resendBtn.classList.remove('hidden');
      if (statusEl) statusEl.textContent = 'Didn’t receive a code? You can resend it now.';
    } else if (statusEl) {
      statusEl.textContent = `You can resend the code in ${remaining}s.`;
    }
  }, 1000);
}

function showLoginStep(step) {
  const step1 = $('app-register-form');
  const step2 = $('app-verify-form');
  const pill1 = $('auth-step-pill-1');
  const pill2 = $('auth-step-pill-2');
  if (!step1 || !step2) return;
  if (step === 2) {
    step1.classList.add('hidden');
    step2.classList.remove('hidden');
    pill1?.classList.remove('active');
    pill1?.classList.add('done');
    pill2?.classList.add('active');
    const codeInput = $('app-login-code');
    if (codeInput) {
      codeInput.value = '';
      setTimeout(() => codeInput.focus(), 50);
    }
    startResendCountdown();
  } else {
    clearResendTimer();
    step2.classList.add('hidden');
    step1.classList.remove('hidden');
    pill1?.classList.remove('done');
    pill1?.classList.add('active');
    pill2?.classList.remove('active');
    setTimeout(() => $('app-register-email')?.focus(), 50);
  }
}

function openAppRegisterModal(onSuccess, message = '') {
  pendingScanCallback = typeof onSuccess === 'function' ? onSuccess : null;
  const modal = $('app-register-modal');
  const input = $('app-register-email');
  const errEl = $('app-register-error');
  const verifyErr = $('app-verify-error');
  const statusEl = $('app-register-status');
  if (!modal) return;
  if (errEl) { errEl.textContent = message || ''; errEl.style.display = message ? 'block' : 'none'; }
  if (verifyErr) { verifyErr.textContent = ''; verifyErr.style.display = 'none'; }
  if (statusEl) { statusEl.textContent = ''; statusEl.style.display = 'none'; }
  if (input && !input.value) input.value = localStorage.getItem('accessscan_user_email') || '';
  showLoginStep(1);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  modal.removeAttribute('inert');
  setTimeout(() => input?.focus(), 100);
  document.body.style.overflow = 'hidden';
}

function closeAppRegisterModal() {
  clearResendTimer();
  const modal = $('app-register-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('inert', '');
  document.body.style.overflow = '';
}

function isAccessError(res, data) {
  return res.status === 403 && data && (
    data.code === 'login_required' ||
    data.code === 'scans_used_up' ||
    data.code === 'blocked'
  );
}

function handleAccessDenied(data, retry) {
  const code = data && data.code;
  if (code === 'login_required') {
    clearAccessToken();
    state.userEmail = null;
    state.scansLeft = null;
    updateHeaderSession();
    openAppRegisterModal(retry, (data && data.error) || 'Please sign in with your email to scan.');
    return;
  }
  if (code === 'scans_used_up') {
    state.scansLeft = 0;
    updateHeaderSession();
    showAccessRemaining(0);
    openAccessModal(retry, (data && data.error) || "You've used all your scans. Request more scans below.", false);
    return;
  }
  if (code === 'blocked') {
    openAccessModal(null, (data && data.error) || 'Your account has been blocked.', true);
  }
}

let pendingAccessCallback = null;

function openAccessModal(onSuccess, message = '', blocked = false) {
  pendingAccessCallback = typeof onSuccess === 'function' ? onSuccess : null;
  const modal = $('app-access-modal');
  if (!modal) return;
  const titleEl = $('app-access-title');
  const subtitleEl = $('app-access-subtitle');
  const notice = $('app-access-notice');
  const reqBtn = $('app-access-request-btn');
  const status = $('app-access-request-status');
  if (titleEl) titleEl.textContent = blocked ? 'Account blocked' : 'Out of scans';
  if (subtitleEl) subtitleEl.textContent = blocked
    ? 'Scanning is disabled for this account.'
    : 'Request additional scans for your account.';
  if (notice) {
    notice.textContent = message;
    notice.style.display = message ? 'block' : 'none';
  }
  if (reqBtn) {
    reqBtn.classList.toggle('hidden', blocked);
    reqBtn.disabled = false;
    reqBtn.textContent = 'Request more scans';
  }
  if (status) { status.textContent = ''; status.style.display = 'none'; }
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  modal.removeAttribute('inert');
  document.body.style.overflow = 'hidden';
  setTimeout(() => (blocked ? $('app-access-cancel') : reqBtn)?.focus(), 100);
}

function closeAccessModal() {
  const modal = $('app-access-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('inert', '');
  document.body.style.overflow = '';
}

async function submitAccessRequest() {
  const btn = $('app-access-request-btn');
  const status = $('app-access-request-status');
  const show = (msg) => { if (status) { status.textContent = msg; status.style.display = 'block'; } };
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const res = await fetch(`${apiBase()}/api/v1/access/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed. Please try again.');
    show("Request sent. We'll email you once more scans are added to your account.");
  } catch (err) {
    show(err.message || 'Request failed. Please try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Request more scans'; }
  }
}

// ─── Event Wiring ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // ── Return-visit telemetry ────────────────────────
  (function trackVisit() {
    try {
      const email = localStorage.getItem('accessscan_user_email');
      if (email && email.includes('@')) {
        fetch(`${apiBase()}/api/v1/visit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        }).catch(() => {});
      }
    } catch (_) {}
  })();

  // ── Scan form ────────────────────────────────────
  const form     = $('scan-form-el');
  const urlInput = $('url-input');
  const scanBtn  = $('scan-btn');

  const autoReportToggle = document.getElementById('auto-report-toggle');
  const compliancePanel = document.getElementById('compliance-panel');
  if (autoReportToggle && compliancePanel) {
    autoReportToggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        compliancePanel.classList.remove('hidden');
      } else {
        compliancePanel.classList.add('hidden');
      }
    });
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput?.value.trim();
    if (!url) { showError('Please enter a URL to scan.'); return; }
    const depth     = parseInt(document.querySelector('input[name="scan-depth"]:checked')?.value ?? '0', 10);
    
    const shouldGenerateReport = autoReportToggle ? autoReportToggle.checked : false;
    let reportMeta = null;
    let reportStandard = 'ada';
    let reportFormat = 'html';
    
    if (shouldGenerateReport) {
      reportStandard = document.getElementById('compliance-standard')?.value || 'ada';
      reportFormat = document.getElementById('compliance-format')?.value || 'html';
      reportMeta = {
        product_name: document.getElementById('comp-product-name')?.value || '',
        vendor_name: document.getElementById('comp-vendor-name')?.value || '',
        product_version: document.getElementById('comp-version')?.value || '',
        contact_info: document.getElementById('comp-contact')?.value || '',
        notes: document.getElementById('comp-notes')?.value || ''
      };
    }
    
    const triggerScan = async () => {
      scanBtn.disabled = true;
      try {
        await runScan(url, 'AAA', depth, shouldGenerateReport, reportMeta, reportStandard, reportFormat);
      } finally {
        scanBtn.disabled = false;
      }
    };

    await state.infoReady;
    if (needsLogin() || (!state.accessApprovalEnabled && !isUserRegistered())) {
      openAppRegisterModal(triggerScan);
      return;
    }

    await triggerScan();
  });

  // ── Two-step email-code login modal wiring ───────
  async function sendLoginCode(email) {
    const res = await fetch(`${apiBase()}/api/v1/auth/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not send verification code.');
    return data;
  }

  $('app-register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailInput = $('app-register-email');
    const consentInput = $('app-register-consent');
    const submitBtn = $('app-register-submit');
    const errEl = $('app-register-error');
    const email = emailInput?.value.trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (errEl) {
        errEl.textContent = 'Please enter a valid email address.';
        errEl.style.display = 'block';
      }
      emailInput?.focus();
      return;
    }

    const honeypot = document.querySelector('#app-register-form input[name="website"]')?.value || '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending code…';
    }
    if (errEl) {
      errEl.textContent = '';
      errEl.style.display = 'none';
    }

    try {
      // Keep lead capture when user consents
      if (!consentInput || consentInput.checked) {
        fetch(`${apiBase()}/api/v1/leads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            source: 'app_scan',
            consent: true,
            website: honeypot,
          }),
        }).catch(() => {});
      }

      await sendLoginCode(email);
      pendingLoginEmail = email;
      const sentToEl = $('app-verify-sent-to');
      if (sentToEl) sentToEl.textContent = `We sent a 6-digit code to ${email}.`;
      showLoginStep(2);
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'Could not send verification code.';
        errEl.style.display = 'block';
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send code →';
      }
    }
  });

  $('app-verify-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const codeInput = $('app-login-code');
    const submitBtn = $('app-verify-submit');
    const errEl = $('app-verify-error');
    const code = (codeInput?.value || '').trim();

    if (!/^\d{6}$/.test(code)) {
      if (errEl) {
        errEl.textContent = 'Please enter the 6-digit code from your email.';
        errEl.style.display = 'block';
      }
      codeInput?.focus();
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Verifying…';
    }
    if (errEl) {
      errEl.textContent = '';
      errEl.style.display = 'none';
    }

    try {
      const res = await fetch(`${apiBase()}/api/v1/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingLoginEmail, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Verification failed. Please check the code.');

      const expiresIn = (data.expires_in || 30 * 86400) * 1000;
      const exp = Date.now() + expiresIn;
      state.token = data.token;
      state.tokenExp = exp;
      state.userEmail = data.email || pendingLoginEmail;
      state.scansLeft = typeof data.scans_left === 'number' ? data.scans_left : null;

      localStorage.setItem(LS_KEY_TOKEN, data.token);
      localStorage.setItem(LS_KEY_TOKEN_EXP, String(exp));
      localStorage.setItem(LS_KEY_TOKEN_KIND, 'user');
      localStorage.setItem('accessscan_registered', '1');
      sessionStorage.setItem('accessscan_registered', '1');
      localStorage.setItem('accessscan_user_email', state.userEmail);

      updateHeaderSession();
      if (typeof state.scansLeft === 'number') showAccessRemaining(state.scansLeft);
      closeAppRegisterModal();

      const cb = typeof pendingScanCallback === 'function' ? pendingScanCallback : null;
      pendingScanCallback = null;
      if (cb) cb();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'Verification failed.';
        errEl.style.display = 'block';
      }
      codeInput?.focus();
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Verify & Sign In →';
      }
    }
  });

  $('app-login-resend')?.addEventListener('click', async () => {
    const resendBtn = $('app-login-resend');
    const errEl = $('app-verify-error');
    const statusEl = $('app-verify-status');
    if (!pendingLoginEmail) return;
    if (resendBtn) resendBtn.disabled = true;
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
    try {
      await sendLoginCode(pendingLoginEmail);
      startResendCountdown();
      if (statusEl) statusEl.textContent = `A new code was sent to ${pendingLoginEmail}.`;
      $('app-login-code')?.focus();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'Could not resend code.';
        errEl.style.display = 'block';
      }
    } finally {
      if (resendBtn) resendBtn.disabled = false;
    }
  });

  $('app-login-back')?.addEventListener('click', () => {
    const errEl = $('app-verify-error');
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
    showLoginStep(1);
  });

  $('app-register-modal-overlay')?.addEventListener('click', () => {
    pendingScanCallback = null;
    closeAppRegisterModal();
  });
  $('app-register-close')?.addEventListener('click', () => {
    pendingScanCallback = null;
    closeAppRegisterModal();
  });

  $('user-signin-btn')?.addEventListener('click', () => openAppRegisterModal());
  $('guest-signin-cta')?.addEventListener('click', () => openAppRegisterModal());
  $('user-logout-btn')?.addEventListener('click', logoutUser);

  // ── Out-of-scans / request-more-scans modal ───────
  $('app-access-request-btn')?.addEventListener('click', submitAccessRequest);
  $('app-access-cancel')?.addEventListener('click', () => { pendingAccessCallback = null; closeAccessModal(); });
  document.querySelector('#app-access-modal .modal-overlay')?.addEventListener('click', () => { pendingAccessCallback = null; closeAccessModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('app-access-modal')?.classList.contains('open')) {
      pendingAccessCallback = null;
      closeAccessModal();
    }
    if (e.key === 'Escape' && $('app-register-modal')?.classList.contains('open')) {
      pendingScanCallback = null;
      closeAppRegisterModal();
    }
  });

  // ── New Scan button ──────────────────────────────
  $('new-scan-btn')?.addEventListener('click', () => { stopFollowingCrawl(); setView('hero'); urlInput?.focus(); });
  $('download-report-btn')?.addEventListener('click', downloadUserReport);
  $('download-md-btn')?.addEventListener('click', downloadAIIssueBrief);
  $('download-xlsx-btn')?.addEventListener('click', downloadExcelReport);
  $('generate-compliance-btn')?.addEventListener('click', openComplianceModal);
  $('coverage-menu-btn')?.addEventListener('click', showCoverage);
  $('coverage-back-btn')?.addEventListener('click', () => setView(state.previousView === 'coverage' ? 'hero' : state.previousView));
  $('coverage-search')?.addEventListener('input', renderCoverageRows);
  $('coverage-status-filter')?.addEventListener('change', renderCoverageRows);

  // ── Compliance report modal ──────────────────────
  $('compliance-modal-overlay')?.addEventListener('click', closeComplianceModal);
  $('compliance-modal-cancel')?.addEventListener('click', closeComplianceModal);
  $('compliance-modal-submit')?.addEventListener('click', submitComplianceModal);
  document.getElementById('modal-compliance-standard')?.addEventListener('change', updateComplianceInfoCard);


  // ── Admin trigger (5 clicks on hidden dot) ───────
  $('admin-trigger')?.addEventListener('click', triggerAdminClick);

  // ── Init ─────────────────────────────────────────
  setView('hero');

  // Deep link: /app#coverage (e.g. from the landing page footer) opens the
  // WCAG coverage view directly instead of the scanner hero.
  if (window.location.hash === '#coverage') showCoverage();
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#coverage') showCoverage();
  });

  // Eagerly fetch a session token on page load (or restore logged-in user session)
  ensureToken().then(ok => {
    if (ok) {
      scheduleTokenRenewal();
      if (isUserLoggedIn()) refreshAuthMe();
      else updateHeaderSession();
    }
  });

  // Drive the PDF coming-soon card visibility from the public Info endpoint.
  // No auth required — pdf_scanning_visible is intentionally unauthenticated
  // (same precedent as max_concurrent_scans). Only controls UI copy, not access.
  state.infoReady = fetch(`${apiBase()}/api/v1/`).then(r => r.ok ? r.json() : null).then(info => {
    if (!info) return;
    state.accessApprovalEnabled = info.access_approval_enabled === true;
    updateHeaderSession();
    const card = $('pdf-coming-soon');
    if (card) {
      const show = info.pdf_scanning_visible === true;
      card.hidden = !show;
      card.setAttribute('aria-hidden', show ? 'false' : 'true');
    }
  }).catch(() => { /* non-critical */ });

  // Auto-trigger scan if redirected from landing page with ?url= query param
  const urlParams = new URLSearchParams(window.location.search);
  const autoUrl   = urlParams.get('url');
  if (autoUrl) {
    if (urlInput) urlInput.value = autoUrl;
    // Strip query param cleanly so refresh doesn't re-scan
    const cleanPath = window.location.pathname.endsWith('/app') ? window.location.pathname : '/app';
    window.history.replaceState(null, '', cleanPath);

    const autoScan = () => ensureToken().then(async ok => {
      if (ok && scanBtn) {
        scanBtn.disabled = true;
        const depth = parseInt(document.querySelector('input[name="scan-depth"]:checked')?.value ?? '0', 10);
        await runScan(autoUrl, 'AAA', depth);
        scanBtn.disabled = false;
      }
    });
    state.infoReady.then(() => (needsLogin() ? openAppRegisterModal(autoScan) : autoScan()));
  }

  // Extension report deep-link: ?report=<id>
  // When Chrome extension opens /app?report=<id>, fetch and render the full detailed report
  const reportId = urlParams.get('report');
  if (reportId) {
    const cleanPath = window.location.pathname.endsWith('/app') ? window.location.pathname : '/app';
    window.history.replaceState(null, '', cleanPath);

    setView('loading');
    (async function loadExtensionReport() {
      try {
        const res = await fetch(`${apiBase()}/api/v1/report/${encodeURIComponent(reportId)}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Report not found or expired');
        }
        const data = await res.json();
        state.scanResult = data;
        if (!data.embedded_results) data.embedded_results = [];
        renderResults(data);
        setView('results');
        setDownloadButtonsDisabled(false);
        revealScreenshotSection(data);
      } catch (err) {
        showError(`Could not load extension report: ${err.message}`);
        setView('hero');
      }
    })();
  }

  // Resume a multi-page scan that was still running when the page was last closed.
  if (!reportId && !autoUrl && window.location.hash !== '#coverage') {
    resumeCrawlIfAny();
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isFullPageBbox,
    collectImpactedNodes,
    setupIssuePreview,
    renderIssuePreview,
  };
}


