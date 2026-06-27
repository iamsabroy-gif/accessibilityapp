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
const LS_KEY_API_BASE   = 'wacs_api_base';
const LS_KEY_TOKEN      = 'wacs_token';
const LS_KEY_TOKEN_EXP  = 'wacs_token_exp';
const LS_KEY_ADMIN_AUTH = 'wacs_admin_authed'; // flag: admin is unlocked this session

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
};

// ─── DOM refs ─────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ─── Utility ──────────────────────────────────────────────────
function apiBase() {
  const stored = localStorage.getItem(LS_KEY_API_BASE);
  if (stored) return stored.replace(/\/$/, '');
  
  const host = window.location.hostname;
  const proto = window.location.protocol;
  if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || proto === 'file:') {
    return host ? window.location.origin : 'http://localhost:8080';
  }
  return DEFAULT_API_BASE;
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
  state.view = v;
  $('hero-view').classList.toggle('hidden',    v !== 'hero');
  $('loading-view').classList.toggle('hidden', v !== 'loading');
  $('results-view').classList.toggle('hidden', v !== 'results');
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

// ─── Scan ──────────────────────────────────────────────────────
async function runScan(url, wcagLevel, depth = 0) {
  setView('loading');
  $('loading-url').textContent = url;
  const depthMsg = $('loading-depth-msg');
  if (depthMsg) depthMsg.textContent = depth === 1 ? 'Following internal links…' : '';
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
      // Token rejected — clear and retry once
      localStorage.removeItem(LS_KEY_TOKEN);
      localStorage.removeItem(LS_KEY_TOKEN_EXP);
      state.token = null;
      const retried = await ensureToken();
      if (!retried) { setView('hero'); return; }
      return runScan(url, wcagLevel, depth);
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scan failed');

    state.scanResult = data;
    renderResults(data);
    setView('results');
    scheduleTokenRenewal();
  } catch (err) {
    showError(`Scan error: ${err.message}`);
    setView('hero');
  }
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

  // ── Page Screenshot ───────────────────────────
  const screenshotSection = $('screenshot-section');
  const screenshotImg     = $('screenshot-img');
  const screenshotSrc     = result.screenshot || result.visual_report_screenshot;
  if (screenshotSection && screenshotImg && screenshotSrc) {
    screenshotImg.src = screenshotSrc.startsWith('data:') ? screenshotSrc : `data:image/png;base64,${screenshotSrc}`;
    screenshotSection.classList.remove('hidden');
  } else if (screenshotSection) {
    screenshotSection.classList.add('hidden');
  }
}

function impactOrder(impact) {
  return { critical: 4, serious: 3, moderate: 2, minor: 1 }[impact] || 0;
}

function buildViolationCard(v) {
  const card = document.createElement('div');
  card.className = `violation-card ${v.impact || 'minor'}`;

  const nodes    = v.nodes || [];
  const wcagRefs = (v.tags || [])
    .filter(t => t.startsWith('wcag') && t.length <= 8)
    .map(t => t.replace('wcag', 'WCAG '))
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
  setTimeout(() => input.focus(), 100);
  document.body.style.overflow = 'hidden';
}

function closeAdminPasswordModal() {
  const modal = $('admin-password-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
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
    sessionStorage.setItem(LS_KEY_ADMIN_AUTH, '1');
    closeAdminPasswordModal();
    openAdminDrawer();
  } catch (err) {
    errEl.textContent    = `Error: ${err.message}`;
    submitBtn.disabled   = false;
    submitBtn.textContent = 'Unlock';
  }
}

function openAdminDrawer() {
  const overlay = $('admin-overlay');
  const drawer  = $('admin-drawer');
  const apiInput = $('admin-api-base');

  if (apiInput) apiInput.value = localStorage.getItem(LS_KEY_API_BASE) || DEFAULT_API_BASE;
  updateAdminTokenStatus();

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeAdminDrawer() {
  $('admin-overlay').classList.remove('open');
  $('admin-overlay').setAttribute('aria-hidden', 'true');
  $('admin-drawer').classList.remove('open');
  $('admin-drawer').setAttribute('aria-hidden', 'true');
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

async function saveAdminSettings() {
  const apiInput = $('admin-api-base');
  const saveBtn  = $('admin-save-btn');
  const newBase  = (apiInput?.value || DEFAULT_API_BASE).trim().replace(/\/$/, '');

  localStorage.setItem(LS_KEY_API_BASE, newBase);

  // Clear old token so next scan gets one from the new base
  localStorage.removeItem(LS_KEY_TOKEN);
  localStorage.removeItem(LS_KEY_TOKEN_EXP);
  state.token = null;

  saveBtn.textContent = 'Verifying connection…';
  saveBtn.disabled    = true;

  const ok = await ensureToken();
  updateAdminTokenStatus();

  saveBtn.textContent = ok ? '✓ Saved & Connected' : '✗ Could not reach API';
  saveBtn.disabled    = false;

  if (ok) {
    setTimeout(() => { closeAdminDrawer(); saveBtn.textContent = 'Save Settings'; scheduleTokenRenewal(); }, 1200);
  } else {
    setTimeout(() => { saveBtn.textContent = 'Save Settings'; }, 3000);
  }
}

// ─── Event Wiring ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // ── Scan form ────────────────────────────────────
  const form     = $('scan-form-el');
  const urlInput = $('url-input');
  const scanBtn  = $('scan-btn');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput?.value.trim();
    if (!url) { showError('Please enter a URL to scan.'); return; }
    const wcagLevel = document.querySelector('input[name="wcag-level"]:checked')?.value || 'AA';
    const depth     = parseInt(document.querySelector('input[name="scan-depth"]:checked')?.value ?? '0', 10);
    scanBtn.disabled = true;
    await runScan(url, wcagLevel, depth);
    scanBtn.disabled = false;
  });

  // ── New Scan button ──────────────────────────────
  $('new-scan-btn')?.addEventListener('click', () => { setView('hero'); urlInput?.focus(); });

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
  $('admin-save-btn')?.addEventListener('click', saveAdminSettings);
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
  }

  // Eagerly fetch a session token on page load (fully transparent to the user)
  ensureToken().then(ok => {
    if (ok) scheduleTokenRenewal();
  });
});
