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
const DEFAULT_API_BASE  = 'https://accessibilityapp-bxzn.onrender.com';
const LS_KEY_TOKEN      = 'wacs_token';
const LS_KEY_TOKEN_EXP  = 'wacs_token_exp';
const LS_KEY_ADMIN_AUTH = 'wacs_admin_authed'; // flag: admin is unlocked this session
const LS_KEY_ADMIN_TOKEN = 'wacs_admin_token';
const LS_KEY_SCAN_MODE   = 'wacs_scan_mode'; // 'parallel' or 'serial'

// Token refresh buffer — refresh when less than this time remains (ms)
const TOKEN_REFRESH_BUFFER_MS = 3 * 60 * 1000; // 3 minutes

// Admin unlock: 5 clicks within 3 s on the tiny dot
let adminClickCount = 0;
let adminClickTimer = null;

// ─── State ────────────────────────────────────────────────────
const state = {
  view: 'hero',
  scanResult: null,
  token: null,
  tokenExp: null,
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
  // Use cached token if still valid
  const cached    = localStorage.getItem(LS_KEY_TOKEN);
  const cachedExp = parseInt(localStorage.getItem(LS_KEY_TOKEN_EXP) || '0', 10);
  if (cached && Date.now() < cachedExp - TOKEN_REFRESH_BUFFER_MS) {
    state.token    = cached;
    state.tokenExp = cachedExp;
    return true;
  }

  // Request a fresh session token from the server
  try {
    const res  = await fetch(`${apiBase()}/api/v1/session`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Session request failed');

    const expiresIn = (data.expires_in || 1200) * 1000; // convert s → ms
    const exp       = Date.now() + expiresIn;

    state.token    = data.token;
    state.tokenExp = exp;
    localStorage.setItem(LS_KEY_TOKEN,     data.token);
    localStorage.setItem(LS_KEY_TOKEN_EXP, String(exp));
    return true;
  } catch (err) {
    showError(`Could not reach the API server: ${err.message}`);
    return false;
  }
}

// Proactively renew the token in the background before it expires
function scheduleTokenRenewal() {
  const exp = state.tokenExp || 0;
  const msUntilRefresh = exp - Date.now() - TOKEN_REFRESH_BUFFER_MS;
  if (msUntilRefresh > 0) {
    setTimeout(async () => {
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
  setView('loading');
  $('loading-url').textContent = url;
  const depthMsg = $('loading-depth-msg');
  if (depthMsg) depthMsg.textContent = depth === 1 ? 'Scanning main page…' : '';
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
    if (!res.ok) throw new Error(data.error || 'Scan failed');

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

    // If depth=1, scan discovered links in parallel from the frontend
    const links = data.discovered_links || [];
    if (depth === 1 && links.length > 0) {
      setDownloadButtonsDisabled(true);
      scanDiscoveredLinks(links, wcagLevel).finally(() => {
        setDownloadButtonsDisabled(false);
        // Reveal Impacted Components only after all child scans have finished
        revealScreenshotSection(data);
      });
    } else {
      setDownloadButtonsDisabled(false);
      // No child scans — reveal immediately
      revealScreenshotSection(data);
    }
  } catch (err) {
    showError(`Scan error: ${err.message}`);
    setView('hero');
  }
}

async function scanDiscoveredLinks(links, wcagLevel) {
  const TIMEOUT_MS = 3 * 60 * 1000;
  const linkedSection = $('linked-pages-section');
  const linkedList    = $('linked-pages-list');
  const linkedCount   = $('linked-pages-count');
  if (!linkedSection || !linkedList) return;

  const mode = getScanMode();

  // Show section with loading placeholders
  linkedCount.textContent = links.length;
  linkedList.innerHTML = '';
  const cardStates = links.map((linkUrl) => {
    const card = document.createElement('article');
    card.className = 'linked-page-card linked-page-loading';
    card.innerHTML = `
      <div class="linked-page-header">
        <div class="linked-page-score linked-page-score-pending">
          <span class="linked-page-grade">…</span>
        </div>
        <div class="linked-page-info">
          <div class="linked-page-url" title="${escapeHTML(linkUrl)}">${escapeHTML(linkUrl)}</div>
          <div class="linked-page-meta">
            <span class="linked-page-stat scanning">Queued…</span>
          </div>
        </div>
      </div>`;
    linkedList.appendChild(card);
    return { url: linkUrl, card, done: false };
  });
  linkedSection.classList.remove('hidden');

  const scanOne = async (entry) => {
    // Update status to scanning (for serial mode where it was "Queued")
    const statusEl = entry.card.querySelector('.linked-page-stat');
    if (statusEl) statusEl.textContent = 'Scanning…';

    const reqController = new AbortController();
    const reqTimeout = setTimeout(() => reqController.abort(), TIMEOUT_MS);

    try {
      await ensureToken();
      const res = await fetch(`${apiBase()}/api/v1/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`,
        },
        body: JSON.stringify({ url: entry.url, wcag_level: wcagLevel, depth: 0 }),
        signal: reqController.signal,
      });

      clearTimeout(reqTimeout);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed');
      entry.done = true;
      renderLinkedPageCard(entry.card, data);
      if (state.scanResult) {
        if (!state.scanResult.embedded_results) state.scanResult.embedded_results = [];
        state.scanResult.embedded_results.push(data);
      }
    } catch (err) {
      clearTimeout(reqTimeout);
      entry.done = true;
      if (reqController.signal.aborted) {
        renderLinkedPageTimeout(entry.card, entry.url);
      } else {
        renderLinkedPageError(entry.card, entry.url, err.message);
      }
    }
  };

  if (mode === 'parallel') {
    let maxConcurrent = 5;
    try {
      const infoRes = await fetch(`${apiBase()}/api/v1/`);
      if (infoRes.ok) {
        const info = await infoRes.json();
        if (info.max_concurrent_scans) maxConcurrent = info.max_concurrent_scans;
      }
    } catch (e) {
      console.warn('Failed to fetch max_concurrent_scans', e);
    }

    let i = 0;
    const workers = Array(maxConcurrent).fill(0).map(async () => {
      while (i < cardStates.length) {
        const entry = cardStates[i++];
        await scanOne(entry);
      }
    });
    await Promise.allSettled(workers);
  } else {
    for (const entry of cardStates) {
      await scanOne(entry);
    }
  }

  cardStates.filter(e => !e.done).forEach(e => renderLinkedPageTimeout(e.card, e.url));
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
      const impacted = subViols.flatMap((violation, vIdx) =>
        (violation.nodes || [])
          .filter(n => n.bbox && n.bbox.width > 0 && n.bbox.height > 0)
          .map((n, nIdx) => ({ violation, violationIndex: vIdx, nodeIndex: nIdx, bbox: n.bbox }))
      );

      summaryEl.textContent = impacted.length
        ? `${impacted.length} impacted component${impacted.length === 1 ? '' : 's'} highlighted.`
        : 'No component positions available for this page.';

      const severities = ['critical', 'serious', 'moderate', 'minor']
        .filter(sev => impacted.some(it => (it.violation.impact || 'minor') === sev));
      let activeSeverity = 'all';

      const applyFilter = sev => {
        activeSeverity = sev;
        overlayEl.querySelectorAll('.issue-indicator').forEach(ind => {
          ind.hidden = sev !== 'all' && ind.dataset.impact !== sev;
        });
        filtersEl.querySelectorAll('button').forEach(btn => {
          const sel = btn.dataset.impact === activeSeverity;
          btn.classList.toggle('active', sel);
          btn.setAttribute('aria-pressed', String(sel));
        });
      };

      filtersEl.replaceChildren();
      ['all', ...severities].forEach(impact => {
        const count = impact === 'all' ? impacted.length : impacted.filter(it => it.violation.impact === impact).length;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `preview-filter ${impact}`;
        btn.dataset.impact = impact;
        btn.textContent = `${impact === 'all' ? 'All' : impact[0].toUpperCase() + impact.slice(1)} (${count})`;
        btn.addEventListener('click', () => applyFilter(impact));
        filtersEl.appendChild(btn);
      });

      const positionIndicators = () => {
        if (!img.naturalWidth || !img.naturalHeight) return;
        overlayEl.replaceChildren();
        impacted.forEach(({ violation, violationIndex, bbox }) => {
          const impact = violation.impact || 'minor';
          const indicator = document.createElement('button');
          indicator.type = 'button';
          indicator.className = `issue-indicator ${impact}`;
          indicator.dataset.impact = impact;
          indicator.hidden = activeSeverity !== 'all' && activeSeverity !== impact;
          indicator.style.left   = `${Math.max(0, bbox.x) / img.naturalWidth  * 100}%`;
          indicator.style.top    = `${Math.max(0, bbox.y) / img.naturalHeight * 100}%`;
          indicator.style.width  = `${Math.min(bbox.width,  img.naturalWidth)  / img.naturalWidth  * 100}%`;
          indicator.style.height = `${Math.min(bbox.height, img.naturalHeight) / img.naturalHeight * 100}%`;
          indicator.setAttribute('aria-label', `${impact} issue: ${violation.help || violation.description || violation.id}`);
          indicator.title = `${violation.id}: ${violation.help || ''}`.trim();

          const badge = document.createElement('span');
          badge.className = 'issue-indicator-badge';
          badge.textContent = String(violationIndex + 1);
          indicator.appendChild(badge);
          overlayEl.appendChild(indicator);
        });
      };

      img.addEventListener('load', positionIndicators, { once: true });
      img.src = screenshotSrc.startsWith('data:') ? screenshotSrc : `data:image/jpeg;base64,${screenshotSrc}`;
      applyFilter('all');
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

function renderIssuePreview(image, violations) {
  const overlay = $('issue-overlay');
  const filters = $('preview-filters');
  const summary = $('preview-summary');
  if (!overlay || !filters || !summary) return;

  const impacted = violations.flatMap((violation, violationIndex) =>
    (violation.nodes || [])
      .filter(node => node.bbox && node.bbox.width > 0 && node.bbox.height > 0)
      .map((node, nodeIndex) => ({ violation, violationIndex, nodeIndex, bbox: node.bbox }))
  );

  overlay.replaceChildren();
  filters.replaceChildren();
  summary.textContent = impacted.length
    ? `${impacted.length} impacted component${impacted.length === 1 ? '' : 's'} highlighted on the scanned page.`
    : 'No impacted component positions were available for this scan.';

  const severities = ['critical', 'serious', 'moderate', 'minor']
    .filter(impact => impacted.some(item => (item.violation.impact || 'minor') === impact));
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

  ['all', ...severities].forEach(impact => {
    const count = impact === 'all' ? impacted.length : impacted.filter(item => item.violation.impact === impact).length;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `preview-filter ${impact}`;
    button.dataset.impact = impact;
    button.textContent = `${impact === 'all' ? 'All' : impact[0].toUpperCase() + impact.slice(1)} (${count})`;
    button.addEventListener('click', () => applyFilter(impact));
    filters.appendChild(button);
  });

  const positionIndicators = () => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    overlay.replaceChildren();
    impacted.forEach(({ violation, violationIndex, bbox }) => {
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
      indicator.title = `${violation.id}: ${violation.help || violation.description || ''}`;

      const badge = document.createElement('span');
      badge.className = 'issue-indicator-badge';
      badge.textContent = String(violationIndex + 1);
      indicator.appendChild(badge);
      indicator.addEventListener('click', () => focusViolation(violationIndex));
      overlay.appendChild(indicator);
    });
  };

  image.addEventListener('load', positionIndicators, { once: true });
  applyFilter('all');
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


function downloadExcelReport() {
  if (state.isScanningDiscoveredLinks) {
    showError('Please wait for the scan to complete before downloading the report.');
    return;
  }
  if (!state.scanResult || typeof XLSX === 'undefined') return;
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
    openAdminPasswordModal();
  } else {
    adminClickTimer = setTimeout(() => { adminClickCount = 0; }, 3000);
  }
}

function openAdminPasswordModal() {
  const modal = $('admin-password-modal');
  const input = $('admin-password-input');
  const errEl = $('admin-password-error');
  if (!modal) return;
  errEl.textContent = '';
  input.value = '';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  modal.removeAttribute('inert');
  setTimeout(() => input.focus(), 100);
  document.body.style.overflow = 'hidden';
}

function closeAdminPasswordModal() {
  const modal = $('admin-password-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('inert', '');
  document.body.style.overflow = '';
}

async function submitAdminPassword() {
  const input   = $('admin-password-input');
  const errEl   = $('admin-password-error');
  const submitBtn = $('admin-password-submit');
  const password = input?.value.trim();

  if (!password) { errEl.textContent = 'Please enter a password.'; return; }

  submitBtn.disabled   = true;
  submitBtn.textContent = 'Verifying…';
  errEl.textContent    = '';

  try {
    const res  = await fetch(`${apiBase()}/api/v1/admin/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || 'Incorrect password.';
      submitBtn.disabled   = false;
      submitBtn.textContent = 'Unlock';
      return;
    }

    // Success — unlock admin
    state.adminUnlocked = true;
    state.adminToken = data.admin_token;
    sessionStorage.setItem(LS_KEY_ADMIN_AUTH, '1');
    sessionStorage.setItem(LS_KEY_ADMIN_TOKEN, data.admin_token);
    closeAdminPasswordModal();
    openAdminDrawer();
  } catch (err) {
    errEl.textContent    = `Error: ${err.message}`;
    submitBtn.disabled   = false;
    submitBtn.textContent = 'Unlock';
  }
}

async function uploadCoverageReport() {
  const input = $('coverage-file-input');
  const status = $('coverage-upload-status');
  const button = $('coverage-upload-btn');
  const file = input?.files?.[0];
  if (!file) { status.textContent = 'Choose an .xlsx file first.'; return; }
  if (!file.name.toLowerCase().endsWith('.xlsx')) { status.textContent = 'Only .xlsx files are accepted.'; return; }
  const form = new FormData();
  form.append('report', file);
  button.disabled = true;
  status.textContent = 'Validating and uploading…';
  try {
    const res = await fetch(`${apiBase()}/api/v1/admin/coverage`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.adminToken || ''}` },
      body: form,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) {
      throw new Error(res.status === 429 ? 'Rate limited — please wait a minute and try again.' : `Server error (${res.status}): ${text.substring(0, 100)}`);
    }
    if (!res.ok) throw new Error(res.status === 401 ? 'Admin session expired. Unlock admin settings again.' : (data.error || 'Upload failed'));
    status.textContent = `Uploaded ${data.entries?.length || 0} coverage entries successfully.`;
    input.value = '';
    state.coverageEntries = data.entries || [];
  } catch (err) {
    status.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

async function loadAdminSettings() {
  const input = $('admin-max-concurrent');
  if (!input) return;
  try {
    const res = await fetch(`${apiBase()}/api/v1/admin/settings`, {
      headers: { 'Authorization': `Bearer ${state.adminToken || ''}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    input.value = data.max_concurrent_scans || 5;

    // Reflect active scoring formula on the toggle buttons
    const formula = data.scoring_formula || 'compliance';
    $('score-formula-compliance')?.classList.toggle('active', formula === 'compliance');
    $('score-formula-penalty')?.classList.toggle('active', formula === 'penalty');

    // Reflect active scanner engine on the toggle buttons
    const engine = data.active_engine || 'axe';
    $('engine-axe')?.classList.toggle('active', engine === 'axe');
    $('engine-native')?.classList.toggle('active', engine === 'native');
  } catch (err) {
    console.error('Failed to load settings', err);
  }
}

function toggleScoringFormula(formula) {
  $('score-formula-compliance')?.classList.toggle('active', formula === 'compliance');
  $('score-formula-penalty')?.classList.toggle('active', formula === 'penalty');
}

function toggleActiveEngine(engine) {
  $('engine-axe')?.classList.toggle('active', engine === 'axe');
  $('engine-native')?.classList.toggle('active', engine === 'native');
}

function updateScanModeToggle() {
  const mode = getScanMode();
  $('scan-mode-serial')?.classList.toggle('active', mode === 'serial');
  $('scan-mode-parallel')?.classList.toggle('active', mode === 'parallel');
}

function setScanMode(mode) {
  localStorage.setItem(LS_KEY_SCAN_MODE, mode);
  updateScanModeToggle();
}

async function saveAllSettings() {
  const status = $('admin-overall-status');
  const btn = $('admin-save-all');
  if (!status || !btn) return;

  const maxConcurrentInput = $('admin-max-concurrent');
  const maxConcurrent = maxConcurrentInput ? parseInt(maxConcurrentInput.value, 10) : 5;

  if (isNaN(maxConcurrent) || maxConcurrent < 1) {
    status.textContent = 'Invalid Max Concurrent value';
    status.className = 'upload-status error';
    return;
  }

  const formula = $('score-formula-penalty')?.classList.contains('active') ? 'penalty' : 'compliance';
  const engine = $('engine-native')?.classList.contains('active') ? 'native' : 'axe';

  btn.disabled = true;
  status.textContent = 'Saving settings...';
  status.className = 'upload-status';

  try {
    const res = await fetch(`${apiBase()}/api/v1/admin/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.adminToken || ''}`
      },
      body: JSON.stringify({
        max_concurrent_scans: maxConcurrent,
        scoring_formula: formula,
        active_engine: engine
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save settings');
    status.textContent = 'All settings saved successfully!';
    status.className = 'upload-status success';
    setTimeout(() => { if (status.textContent === 'All settings saved successfully!') status.textContent = ''; }, 3000);
  } catch (err) {
    status.textContent = err.message;
    status.className = 'upload-status error';
  } finally {
    btn.disabled = false;
  }
}

function openAdminDrawer() {
  const overlay = $('admin-overlay');
  const drawer  = $('admin-drawer');

  updateScanModeToggle();
  updateAdminTokenStatus();
  loadAdminSettings();

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  drawer.removeAttribute('inert');
  document.body.style.overflow = 'hidden';
}

function closeAdminDrawer() {
  $('admin-overlay').classList.remove('open');
  $('admin-overlay').setAttribute('aria-hidden', 'true');
  $('admin-drawer').classList.remove('open');
  $('admin-drawer').setAttribute('aria-hidden', 'true');
  $('admin-drawer').setAttribute('inert', '');
  document.body.style.overflow = '';
}

function updateAdminTokenStatus() {
  const dot  = $('token-status-dot');
  const text = $('token-status-text');
  const exp  = parseInt(localStorage.getItem(LS_KEY_TOKEN_EXP) || '0', 10);

  if (state.token && Date.now() < exp) {
    const mins       = Math.ceil((exp - Date.now()) / 60000);
    dot.className    = 'token-dot ok';
    text.textContent = `Session token active · expires in ${mins}m`;
  } else {
    dot.className    = 'token-dot idle';
    text.textContent = 'No active session token';
  }
}



// ─── Event Wiring ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
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
    
    scanBtn.disabled = true;
    await runScan(url, 'AAA', depth, shouldGenerateReport, reportMeta, reportStandard, reportFormat);
    scanBtn.disabled = false;
  });

  // ── New Scan button ──────────────────────────────
  $('new-scan-btn')?.addEventListener('click', () => { setView('hero'); urlInput?.focus(); });
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

  // ── Admin password modal ─────────────────────────
  $('admin-password-modal-overlay')?.addEventListener('click', closeAdminPasswordModal);
  $('admin-password-cancel')?.addEventListener('click', closeAdminPasswordModal);
  $('admin-password-submit')?.addEventListener('click', submitAdminPassword);
  $('admin-password-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitAdminPassword();
    if (e.key === 'Escape') closeAdminPasswordModal();
  });

  // ── Admin drawer ─────────────────────────────────
  $('admin-overlay')?.addEventListener('click', closeAdminDrawer);
  $('admin-drawer-close')?.addEventListener('click', closeAdminDrawer);

  $('scan-mode-serial')?.addEventListener('click', () => setScanMode('serial'));
  $('scan-mode-parallel')?.addEventListener('click', () => setScanMode('parallel'));
  $('score-formula-compliance')?.addEventListener('click', () => toggleScoringFormula('compliance'));
  $('score-formula-penalty')?.addEventListener('click', () => toggleScoringFormula('penalty'));
  $('engine-axe')?.addEventListener('click', () => toggleActiveEngine('axe'));
  $('engine-native')?.addEventListener('click', () => toggleActiveEngine('native'));
  $('admin-save-all')?.addEventListener('click', saveAllSettings);

  $('coverage-upload-btn')?.addEventListener('click', uploadCoverageReport);
  $('admin-refresh-token')?.addEventListener('click', async () => {
    localStorage.removeItem(LS_KEY_TOKEN);
    localStorage.removeItem(LS_KEY_TOKEN_EXP);
    state.token = null;
    await ensureToken();
    updateAdminTokenStatus();
    scheduleTokenRenewal();
  });

  // ── Keyboard: Escape closes any open panel ────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAdminDrawer(); closeAdminPasswordModal(); }
  });

  // ── Init ─────────────────────────────────────────
  setView('hero');

  // Restore admin session if unlocked earlier this browser session
  if (sessionStorage.getItem(LS_KEY_ADMIN_AUTH) === '1') {
    state.adminUnlocked = true;
    state.adminToken = sessionStorage.getItem(LS_KEY_ADMIN_TOKEN);
  }

  // Eagerly fetch a session token on page load (fully transparent to the user)
  ensureToken().then(ok => {
    if (ok) scheduleTokenRenewal();
  });
});


