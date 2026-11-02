/**
 * AccessScan — Admin Console JavaScript (admin.js)
 * Vanilla JS, zero dependencies, full WCAG 2.2 AA accessibility.
 */

// ─── Pure Helper Functions (Exported for Unit Tests) ─────────────

function formatRemaining(ms) {
  if (!ms || ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDateTime(isoString) {
  if (!isoString) return 'never';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const pad = n => String(n).padStart(2, '0');
    const y = d.getUTCFullYear();
    const m = pad(d.getUTCMonth() + 1);
    const day = pad(d.getUTCDate());
    const h = pad(d.getUTCHours());
    const min = pad(d.getUTCMinutes());
    return `${y}-${m}-${day} ${h}:${min} UTC`;
  } catch (_) {
    return isoString;
  }
}

function filterRows(users, filters) {
  if (!Array.isArray(users)) return [];
  const q = (filters.q || '').trim().toLowerCase();
  const status = filters.status || 'all';
  const source = filters.source || 'all';
  const month = filters.month || ''; // YYYY-MM

  return users.filter(u => {
    // Search filter (email or source substring)
    if (q) {
      const email = (u.email || '').toLowerCase();
      const src = (u.source || '').toLowerCase();
      if (!email.includes(q) && !src.includes(q)) return false;
    }

    // Status filter
    if (status === 'registered' && !u.registered) return false;
    if (status === 'unregistered' && u.registered) return false;

    // Source filter
    if (source !== 'all' && (u.source || '') !== source) return false;

    // Month filter (YYYY-MM against last_seen or registered_at)
    if (month) {
      const lastSeenMatch = u.last_seen && u.last_seen.startsWith(month);
      const regMatch = u.registered_at && u.registered_at.startsWith(month);
      if (!lastSeenMatch && !regMatch) return false;
    }

    return true;
  });
}

function sortRows(users, col, dir = 'asc') {
  if (!Array.isArray(users)) return [];
  const multiplier = dir === 'desc' ? -1 : 1;

  return [...users].sort((a, b) => {
    let valA = a[col];
    let valB = b[col];

    // Handle numeric columns
    if (col === 'visit_days' || col === 'total_visits') {
      const numA = Number(valA) || 0;
      const numB = Number(valB) || 0;
      return (numA - numB) * multiplier;
    }

    // Handle string / date columns
    valA = valA ? String(valA).toLowerCase() : '';
    valB = valB ? String(valB).toLowerCase() : '';
    if (valA < valB) return -1 * multiplier;
    if (valA > valB) return 1 * multiplier;
    return 0;
  });
}

function paginate(items, page = 1, pageSize = 25) {
  const totalItems = Array.isArray(items) ? items.length : 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalItems);
  const sliced = Array.isArray(items) ? items.slice(startIdx, endIdx) : [];

  return {
    page: currentPage,
    pageSize,
    totalItems,
    totalPages,
    items: sliced,
    startIdx: totalItems > 0 ? startIdx + 1 : 0,
    endIdx
  };
}

function escapeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val);
  // Formula injection defense: prefix with apostrophe if starts with = + - @ \t \r
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // Escape double quotes by doubling them
  str = str.replace(/"/g, '""');
  return `"${str}"`;
}

function toCsv(users) {
  if (!Array.isArray(users)) return '';
  const headers = ['Email', 'Status', 'Source', 'RegisteredAt', 'VisitDays', 'TotalVisits', 'LastSeen'];
  const rows = [headers.map(escapeCsvCell).join(',')];

  for (const u of users) {
    const status = u.registered ? 'Registered' : 'Unregistered';
    const row = [
      escapeCsvCell(u.email),
      escapeCsvCell(status),
      escapeCsvCell(u.source || ''),
      escapeCsvCell(u.registered_at || ''),
      escapeCsvCell(u.visit_days || 0),
      escapeCsvCell(u.total_visits || 0),
      escapeCsvCell(u.last_seen || '')
    ];
    rows.push(row.join(','));
  }

  // Prepend UTF-8 BOM so Excel opens it with proper encoding
  return '\uFEFF' + rows.join('\r\n');
}

// Module export for Node testing environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatRemaining,
    formatDateTime,
    filterRows,
    sortRows,
    paginate,
    escapeCsvCell,
    toCsv
  };
}

// ─── Browser Client Code ─────────────────────────────────────────
(function () {
  if (typeof window === 'undefined') return;

  const STORAGE_KEY = 'wacs_admin';
  const SCAN_MODE_KEY = 'wacs_scan_mode';

  // State object
  const state = {
    session: null, // { token, exp }
    sessionTimer: null,
    lastAnnouncedMilestone: null,
    activeTab: 'settings',
    savedSettings: null,
    settingsLoaded: false,
    activityData: {
      raw: [],
      filtered: [],
      q: '',
      status: 'all',
      source: 'all',
      month: '',
      sortCol: 'last_seen',
      sortDir: 'desc',
      page: 1,
      pageSize: 25,
      loaded: false
    },
    pendingRetry: null // queued request to retry after re-auth
  };

  // DOM Helpers
  const $ = id => document.getElementById(id);

  function announce(msg, liveRegionId = 'admin-live') {
    const el = $(liveRegionId);
    if (!el) return;
    el.textContent = '';
    setTimeout(() => { el.textContent = msg; }, 50);
  }

  function showToast(msg, type = 'info', duration = 5000) {
    const region = $('toast-region');
    if (!region) return;
    const toast = document.createElement('div');
    toast.className = `admin-toast ${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const span = document.createElement('span');
    span.textContent = msg;
    toast.appendChild(span);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-xs-secondary';
    closeBtn.setAttribute('aria-label', 'Dismiss toast');
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => toast.remove();
    toast.appendChild(closeBtn);

    region.appendChild(toast);
    announce(msg);

    if (duration > 0) {
      setTimeout(() => {
        if (toast.parentNode) toast.remove();
      }, duration);
    }
  }

  // ─── Session Management ──────────────────────────────────────────

  function loadStoredSession() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && data.token && data.exp && data.exp > Date.now()) {
        return data;
      }
    } catch (_) {}
    return null;
  }

  function saveSession(token, expiresInSec = 1800) {
    const exp = Date.now() + expiresInSec * 1000;
    const data = { token, exp };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    state.session = data;
    startSessionTimer();
  }

  function clearSession() {
    sessionStorage.removeItem(STORAGE_KEY);
    state.session = null;
    if (state.sessionTimer) clearInterval(state.sessionTimer);
    updateSessionUI();
  }

  function startSessionTimer() {
    if (state.sessionTimer) clearInterval(state.sessionTimer);
    updateSessionUI();
    state.sessionTimer = setInterval(updateSessionUI, 1000);
  }

  function updateSessionUI() {
    const timerDisplay = $('session-time');
    const warningBanner = $('session-warning-banner');
    const warningTime = $('session-warning-time');
    const sessionBar = $('admin-session-bar');

    if (!state.session || state.session.exp <= Date.now()) {
      if (timerDisplay) timerDisplay.textContent = '00:00';
      if (sessionBar) sessionBar.classList.add('hidden');
      if (warningBanner) warningBanner.classList.add('hidden');
      if (state.session) {
        clearSession();
        showLoginView();
        showToast('Your admin session has expired. Please sign in again.', 'error');
        announce('Admin session expired', 'admin-session-live');
      }
      return;
    }

    if (sessionBar) sessionBar.classList.remove('hidden');

    const remainingMs = state.session.exp - Date.now();
    const formatted = formatRemaining(remainingMs);
    if (timerDisplay) timerDisplay.textContent = formatted;

    const remainingMins = Math.ceil(remainingMs / 60000);

    // Milestone Announcements (polite, non-spammy)
    if (remainingMins <= 5 && remainingMins > 2 && state.lastAnnouncedMilestone !== 5) {
      state.lastAnnouncedMilestone = 5;
      announce('Admin session expires in 5 minutes', 'admin-session-live');
    } else if (remainingMins <= 2 && remainingMins > 0) {
      if (warningBanner) warningBanner.classList.remove('hidden');
      if (warningTime) warningTime.textContent = `${formatted}`;
      if (state.lastAnnouncedMilestone !== 2) {
        state.lastAnnouncedMilestone = 2;
        announce(`Warning: admin session expires in ${remainingMins} minutes. Extend session to prevent loss of unsaved work.`, 'admin-session-live');
      }
    } else {
      if (warningBanner) warningBanner.classList.add('hidden');
    }
  }

  // ─── adminFetch Wrapper with 401 Re-Auth & Retry ─────────────────

  async function adminFetch(endpoint, options = {}) {
    if (!state.session || state.session.exp <= Date.now()) {
      openReauthDialog(() => adminFetch(endpoint, options));
      throw new Error('Session expired');
    }

    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${state.session.token}`);

    const config = {
      ...options,
      headers
    };

    const res = await fetch(endpoint, config);

    if (res.status === 401) {
      // Session invalidated or expired on server
      return new Promise((resolve, reject) => {
        state.pendingRetry = async () => {
          try {
            const retryRes = await adminFetch(endpoint, options);
            resolve(retryRes);
          } catch (err) {
            reject(err);
          }
        };
        openReauthDialog();
      });
    }

    return res;
  }

  function openReauthDialog(callback) {
    if (callback) state.pendingRetry = callback;
    const dlg = $('reauth-dialog');
    const pwdInput = $('reauth-password');
    const errEl = $('reauth-error');
    if (errEl) errEl.textContent = '';
    if (pwdInput) pwdInput.value = '';
    if (dlg && typeof dlg.showModal === 'function') {
      dlg.showModal();
      setTimeout(() => pwdInput?.focus(), 50);
    }
  }

  function closeReauthDialog() {
    const dlg = $('reauth-dialog');
    if (dlg && dlg.open) dlg.close();
  }

  // ─── Login View vs Console View ──────────────────────────────────

  function showLoginView() {
    $('admin-login-view')?.classList.remove('hidden');
    $('admin-app')?.classList.add('hidden');
    $('admin-session-bar')?.classList.add('hidden');
    setTimeout(() => $('admin-login-password')?.focus(), 100);
  }

  function showConsoleView() {
    $('admin-login-view')?.classList.add('hidden');
    $('admin-app')?.classList.remove('hidden');
    $('admin-session-bar')?.classList.remove('hidden');

    // Restore hash tab or default to settings
    const hash = (window.location.hash || '').replace('#', '');
    if (['settings', 'activity', 'coverage'].includes(hash)) {
      switchTab(hash, false);
    } else {
      switchTab('settings', false);
    }
  }

  // ─── WAI-ARIA Tabs Implementation ────────────────────────────────

  const TAB_IDS = ['settings', 'activity', 'coverage'];

  function switchTab(tabId, updateHash = true) {
    if (!TAB_IDS.includes(tabId)) tabId = 'settings';
    state.activeTab = tabId;

    TAB_IDS.forEach(id => {
      const tab = $(`tab-${id}`);
      const panel = $(`panel-${id}`);
      const isSelected = id === tabId;

      if (tab) {
        tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        tab.setAttribute('tabindex', isSelected ? '0' : '-1');
        tab.classList.toggle('active', isSelected);
      }

      if (panel) {
        if (isSelected) {
          panel.removeAttribute('hidden');
        } else {
          panel.setAttribute('hidden', '');
        }
      }
    });

    if (updateHash) {
      window.location.hash = tabId;
    }

    // Tab activation callbacks
    if (tabId === 'settings' && !state.settingsLoaded) {
      loadSettings();
    } else if (tabId === 'activity' && !state.activityData.loaded) {
      loadActivity();
    }

    announce(`Switched to ${tabId} tab`);
  }

  function setupTabs() {
    const tablist = document.querySelector('[role="tablist"]');
    if (!tablist) return;

    TAB_IDS.forEach((id, index) => {
      const tab = $(`tab-${id}`);
      if (!tab) return;

      tab.addEventListener('click', () => {
        switchTab(id);
      });

      tab.addEventListener('keydown', e => {
        let nextIndex = null;
        if (e.key === 'ArrowRight') {
          nextIndex = (index + 1) % TAB_IDS.length;
        } else if (e.key === 'ArrowLeft') {
          nextIndex = (index - 1 + TAB_IDS.length) % TAB_IDS.length;
        } else if (e.key === 'Home') {
          nextIndex = 0;
        } else if (e.key === 'End') {
          nextIndex = TAB_IDS.length - 1;
        }

        if (nextIndex !== null) {
          e.preventDefault();
          const nextId = TAB_IDS[nextIndex];
          switchTab(nextId);
          $(`tab-${nextId}`)?.focus();
        }
      });
    });

    window.addEventListener('hashchange', () => {
      const hash = (window.location.hash || '').replace('#', '');
      if (TAB_IDS.includes(hash) && hash !== state.activeTab) {
        switchTab(hash, false);
      }
    });
  }

  // ─── Settings Tab ────────────────────────────────────────────────

  function getSettingsFormValues() {
    const form = $('settings-form');
    if (!form) return {};
    const maxVal = parseInt($('admin-max-concurrent')?.value, 10);
    return {
      active_engine: form.elements['active_engine']?.value || 'axe',
      max_concurrent_scans: isNaN(maxVal) ? 5 : maxVal,
      scoring_formula: form.elements['scoring_formula']?.value || 'compliance',
      landing_page_enabled: form.elements['landing_page_enabled']?.value === 'true',
      pdf_scanning_visible: form.elements['pdf_scanning_visible']?.value === 'true'
    };
  }

  function setSettingsFormValues(values) {
    const form = $('settings-form');
    if (!form || !values) return;

    if (values.active_engine && form.elements['active_engine']) {
      form.elements['active_engine'].value = values.active_engine;
    }
    if (values.max_concurrent_scans !== undefined && $('admin-max-concurrent')) {
      $('admin-max-concurrent').value = values.max_concurrent_scans;
    }
    if (values.scoring_formula && form.elements['scoring_formula']) {
      form.elements['scoring_formula'].value = values.scoring_formula;
    }
    if (values.landing_page_enabled !== undefined && form.elements['landing_page_enabled']) {
      form.elements['landing_page_enabled'].value = String(values.landing_page_enabled);
    }
    if (values.pdf_scanning_visible !== undefined && form.elements['pdf_scanning_visible']) {
      form.elements['pdf_scanning_visible'].value = String(values.pdf_scanning_visible);
    }

    updateRadioCheckedClasses();
    checkSettingsDirty();
  }

  function updateRadioCheckedClasses() {
    document.querySelectorAll('.segmented-option').forEach(label => {
      const radio = label.querySelector('input[type="radio"]');
      if (radio) {
        label.classList.toggle('checked', radio.checked);
      }
    });
  }

  function setSettingsBusy(isBusy) {
    const form = $('settings-form');
    if (!form) return;
    form.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    const fieldsets = form.querySelectorAll('fieldset:not(.local-scope-fieldset)');
    fieldsets.forEach(fs => {
      fs.disabled = isBusy;
    });
  }

  function checkSettingsDirty() {
    if (!state.savedSettings) return;
    const current = getSettingsFormValues();
    const isDirty = (
      current.active_engine !== state.savedSettings.active_engine ||
      current.max_concurrent_scans !== state.savedSettings.max_concurrent_scans ||
      current.scoring_formula !== state.savedSettings.scoring_formula ||
      current.landing_page_enabled !== state.savedSettings.landing_page_enabled ||
      current.pdf_scanning_visible !== state.savedSettings.pdf_scanning_visible
    );

    const saveBtn = $('btn-save-settings');
    const discardBtn = $('btn-discard-settings');
    const dirtyStatus = $('settings-dirty-status');
    const dirtyDot = $('status-dot');
    const dirtyText = $('dirty-status-text');

    if (saveBtn) saveBtn.disabled = !isDirty || !state.settingsLoaded;
    if (discardBtn) discardBtn.disabled = !isDirty || !state.settingsLoaded;

    if (isDirty) {
      if (dirtyDot) { dirtyDot.className = 'status-dot dirty'; }
      if (dirtyText) dirtyText.textContent = 'Unsaved changes pending';
    } else {
      if (dirtyDot) { dirtyDot.className = 'status-dot clean'; }
      if (dirtyText) dirtyText.textContent = 'All settings saved';
    }
  }

  async function loadSettings() {
    const statusBox = $('settings-status-box');
    setSettingsBusy(true);
    if (statusBox) {
      statusBox.textContent = 'Loading server settings…';
      statusBox.classList.remove('hidden');
    }

    try {
      const res = await adminFetch('/api/v1/admin/settings');
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      const data = await res.json();

      state.savedSettings = {
        active_engine: data.active_engine || 'axe',
        max_concurrent_scans: data.max_concurrent_scans || 5,
        scoring_formula: data.scoring_formula || 'compliance',
        landing_page_enabled: data.landing_page_enabled === true,
        pdf_scanning_visible: data.pdf_scanning_visible === true
      };

      setSettingsFormValues(state.savedSettings);
      state.settingsLoaded = true;
      setSettingsBusy(false);

      if (statusBox) statusBox.classList.add('hidden');
      announce('Settings loaded successfully');
    } catch (err) {
      setSettingsBusy(true);
      if (statusBox) {
        statusBox.innerHTML = '';
        const p = document.createElement('p');
        p.textContent = `Failed to load settings: ${err.message}.`;
        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'btn-xs-secondary';
        retryBtn.textContent = 'Retry';
        retryBtn.onclick = () => loadSettings();
        statusBox.appendChild(p);
        statusBox.appendChild(retryBtn);
        statusBox.classList.remove('hidden');
      }
      showToast('Could not load settings from server.', 'error');
    }
  }

  function handleSaveSettings(e) {
    if (e) e.preventDefault();
    const current = getSettingsFormValues();

    // Concurrency Validation
    const concurrentInput = $('admin-max-concurrent');
    const concurrentError = $('error-concurrent');
    if (isNaN(current.max_concurrent_scans) || current.max_concurrent_scans < 1 || current.max_concurrent_scans > 100) {
      if (concurrentInput) {
        concurrentInput.setAttribute('aria-invalid', 'true');
        concurrentInput.focus();
      }
      if (concurrentError) concurrentError.textContent = 'Must be an integer between 1 and 100.';
      return;
    }
    if (concurrentInput) concurrentInput.removeAttribute('aria-invalid');
    if (concurrentError) concurrentError.textContent = '';

    // Check for risky toggles that require confirmation
    const riskyChanges = [];
    if (current.landing_page_enabled !== state.savedSettings.landing_page_enabled) {
      if (current.landing_page_enabled) {
        riskyChanges.push('Root / will serve marketing landing page (Scan tool remains at /app).');
      } else {
        riskyChanges.push('Root / will serve the Accessibility Scanner directly.');
      }
    }
    if (current.scoring_formula !== state.savedSettings.scoring_formula) {
      if (current.scoring_formula === 'penalty') {
        riskyChanges.push('Scoring formula switched to Penalty-based (scores drop quickly for severe issues).');
      } else {
        riskyChanges.push('Scoring formula switched to Compliance-aligned (tracks pass-rule ratio).');
      }
    }
    if (current.active_engine !== state.savedSettings.active_engine && current.active_engine === 'native') {
      riskyChanges.push('Scanner engine switched to Native Validation (experimental in production).');
    }

    if (riskyChanges.length > 0) {
      openConfirmDialog(riskyChanges, () => executeSaveSettings(current));
    } else {
      executeSaveSettings(current);
    }
  }

  async function executeSaveSettings(settingsToSave) {
    const saveBtn = $('btn-save-settings');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
    }

    try {
      const res = await adminFetch('/api/v1/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsToSave)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

      state.savedSettings = {
        active_engine: data.active_engine,
        max_concurrent_scans: data.max_concurrent_scans,
        scoring_formula: data.scoring_formula,
        landing_page_enabled: data.landing_page_enabled === true,
        pdf_scanning_visible: data.pdf_scanning_visible === true
      };

      setSettingsFormValues(state.savedSettings);
      showToast('Settings saved successfully!', 'success');
      announce('Settings saved successfully');
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error');
    } finally {
      if (saveBtn) {
        saveBtn.textContent = 'Save Settings';
      }
      checkSettingsDirty();
    }
  }

  function openConfirmDialog(changes, onConfirm) {
    const dlg = $('confirm-dialog');
    const list = $('confirm-changes-list');
    const okBtn = $('btn-confirm-ok');
    const cancelBtn = $('btn-confirm-cancel');

    if (list) {
      list.innerHTML = '';
      changes.forEach(c => {
        const li = document.createElement('li');
        li.textContent = c;
        list.appendChild(li);
      });
    }

    const handleConfirm = () => {
      dlg?.close();
      cleanup();
      onConfirm();
    };

    const handleCancel = () => {
      dlg?.close();
      cleanup();
    };

    const cleanup = () => {
      okBtn?.removeEventListener('click', handleConfirm);
      cancelBtn?.removeEventListener('click', handleCancel);
    };

    okBtn?.addEventListener('click', handleConfirm);
    cancelBtn?.addEventListener('click', handleCancel);

    if (dlg && typeof dlg.showModal === 'function') {
      dlg.showModal();
    }
  }

  // ─── Activity Tab ────────────────────────────────────────────────

  async function loadActivity() {
    const msg = $('activity-state-message');
    const tableWrap = $('activity-table-container');

    if (msg) {
      msg.textContent = 'Loading user activity…';
      msg.classList.remove('hidden');
    }
    if (tableWrap) tableWrap.setAttribute('aria-busy', 'true');

    try {
      const res = await adminFetch('/api/v1/admin/activity');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      state.activityData.raw = Array.isArray(data.users) ? data.users : [];
      state.activityData.loaded = true;

      // Populate source dropdown
      populateSourceFilter(state.activityData.raw);

      // Render
      renderActivity();

      const timeEl = $('activity-updated-time');
      if (timeEl) {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        timeEl.textContent = `Updated ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      }

      announce(`Loaded ${state.activityData.raw.length} user records`);
    } catch (err) {
      if (msg) {
        msg.innerHTML = '';
        const p = document.createElement('p');
        p.textContent = `Failed to load activity: ${err.message}.`;
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn-xs-secondary';
        retry.textContent = 'Retry';
        retry.onclick = () => loadActivity();
        msg.appendChild(p);
        msg.appendChild(retry);
        msg.classList.remove('hidden');
      }
      showToast('Could not load user activity.', 'error');
    } finally {
      if (tableWrap) tableWrap.removeAttribute('aria-busy');
    }
  }

  function populateSourceFilter(users) {
    const sel = $('filter-source-select');
    if (!sel) return;
    const currentVal = sel.value;
    const sources = new Set();
    users.forEach(u => {
      if (u.source && u.source.trim()) sources.add(u.source.trim());
    });

    sel.innerHTML = '<option value="all">All sources</option>';
    Array.from(sources).sort().forEach(src => {
      const opt = document.createElement('option');
      opt.value = src;
      opt.textContent = src;
      sel.appendChild(opt);
    });

    if (Array.from(sources).includes(currentVal)) {
      sel.value = currentVal;
    }
  }

  function renderActivity() {
    const act = state.activityData;
    const filtered = filterRows(act.raw, {
      q: act.q,
      status: act.status,
      source: act.source,
      month: act.month
    });

    const sorted = sortRows(filtered, act.sortCol, act.sortDir);
    const pagination = paginate(sorted, act.page, act.pageSize);

    // Update Summary Ribbon
    const registeredCount = filtered.filter(u => u.registered).length;
    const unregisteredCount = filtered.length - registeredCount;
    const totalVisits = filtered.reduce((acc, u) => acc + (u.total_visits || 0), 0);

    const mTotal = $('metric-total-users');
    const mReg = $('metric-registered-users');
    const mUnreg = $('metric-unregistered-users');
    const mVisits = $('metric-total-visits');

    if (mTotal) mTotal.textContent = filtered.length.toLocaleString();
    if (mReg) mReg.textContent = registeredCount.toLocaleString();
    if (mUnreg) mUnreg.textContent = unregisteredCount.toLocaleString();
    if (mVisits) mVisits.textContent = totalVisits.toLocaleString();

    // Update Clear Filters button visibility
    const isFiltered = act.q || act.status !== 'all' || act.source !== 'all' || act.month;
    const clearBtn = $('btn-clear-filters');
    if (clearBtn) clearBtn.classList.toggle('hidden', !isFiltered);

    // Update Table Headers ARIA Sort
    document.querySelectorAll('.activity-table th[data-col]').forEach(th => {
      const col = th.getAttribute('data-col');
      if (col === act.sortCol) {
        th.setAttribute('aria-sort', act.sortDir === 'desc' ? 'descending' : 'ascending');
      } else {
        th.setAttribute('aria-sort', 'none');
      }
    });

    // Populate Table Rows
    const tbody = $('activity-tbody');
    const msg = $('activity-state-message');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (filtered.length === 0) {
      if (msg) {
        if (act.raw.length === 0) {
          msg.textContent = 'No registered users yet. Enable LEAD_CAPTURE_ENABLED or VISIT_TRACKING_ENABLED to collect activity.';
        } else {
          msg.textContent = 'No users match the active filters.';
        }
        msg.classList.remove('hidden');
      }
    } else {
      if (msg) msg.classList.add('hidden');

      pagination.items.forEach(u => {
        const tr = document.createElement('tr');
        tr.setAttribute('role', 'row');

        // Email
        const tdEmail = document.createElement('td');
        tdEmail.className = 'email-cell';
        tdEmail.setAttribute('data-label', 'Email');
        tdEmail.textContent = u.email || '—';
        tr.appendChild(tdEmail);

        // Source / Status Tag
        const tdSource = document.createElement('td');
        tdSource.setAttribute('data-label', 'Source');
        if (u.registered) {
          tdSource.textContent = u.source || 'registered';
        } else {
          const badge = document.createElement('span');
          badge.className = 'badge-tag unregistered';
          badge.textContent = 'unregistered';
          tdSource.appendChild(badge);
        }
        tr.appendChild(tdSource);

        // Registered Date
        const tdReg = document.createElement('td');
        tdReg.setAttribute('data-label', 'Registered');
        if (u.registered_at) {
          const time = document.createElement('time');
          time.dateTime = u.registered_at;
          time.textContent = u.registered_at.slice(0, 10);
          tdReg.appendChild(time);
        } else {
          tdReg.textContent = 'never';
        }
        tr.appendChild(tdReg);

        // Days
        const tdDays = document.createElement('td');
        tdDays.className = 'num';
        tdDays.setAttribute('data-label', 'Days');
        tdDays.textContent = String(u.visit_days || 0);
        tr.appendChild(tdDays);

        // Visits
        const tdVisits = document.createElement('td');
        tdVisits.className = 'num';
        tdVisits.setAttribute('data-label', 'Visits');
        tdVisits.textContent = String(u.total_visits || 0);
        tr.appendChild(tdVisits);

        // Last Seen
        const tdSeen = document.createElement('td');
        tdSeen.setAttribute('data-label', 'Last seen');
        if (u.last_seen) {
          const time = document.createElement('time');
          time.dateTime = u.last_seen;
          time.textContent = formatDateTime(u.last_seen);
          tdSeen.appendChild(time);
        } else {
          tdSeen.textContent = 'never';
        }
        tr.appendChild(tdSeen);

        tbody.appendChild(tr);
      });
    }

    // Update Pagination Controls
    const prevBtn = $('btn-page-prev');
    const nextBtn = $('btn-page-next');
    const pageStatus = $('pagination-status');

    if (prevBtn) prevBtn.disabled = pagination.page <= 1;
    if (nextBtn) nextBtn.disabled = pagination.page >= pagination.totalPages;
    if (pageStatus) {
      pageStatus.textContent = `Page ${pagination.page} of ${pagination.totalPages} (${pagination.startIdx}–${pagination.endIdx} of ${pagination.totalItems})`;
    }
  }

  function setupActivityListeners() {
    let debounceTimer = null;
    $('activity-search-input')?.addEventListener('input', e => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.activityData.q = e.target.value;
        state.activityData.page = 1;
        renderActivity();
        announce(`Filtered: ${state.activityData.q}`);
      }, 150);
    });

    $('filter-status-select')?.addEventListener('change', e => {
      state.activityData.status = e.target.value;
      state.activityData.page = 1;
      renderActivity();
    });

    $('filter-source-select')?.addEventListener('change', e => {
      state.activityData.source = e.target.value;
      state.activityData.page = 1;
      renderActivity();
    });

    $('filter-month-input')?.addEventListener('change', e => {
      state.activityData.month = e.target.value;
      state.activityData.page = 1;
      renderActivity();
    });

    $('btn-clear-filters')?.addEventListener('click', () => {
      const search = $('activity-search-input');
      const status = $('filter-status-select');
      const source = $('filter-source-select');
      const month = $('filter-month-input');

      if (search) search.value = '';
      if (status) status.value = 'all';
      if (source) source.value = 'all';
      if (month) month.value = '';

      state.activityData.q = '';
      state.activityData.status = 'all';
      state.activityData.source = 'all';
      state.activityData.month = '';
      state.activityData.page = 1;
      renderActivity();
      announce('Filters cleared');
    });

    // Column Header Sorting
    document.querySelectorAll('.activity-table th[data-col]').forEach(th => {
      const btn = th.querySelector('.th-sort-btn');
      const col = th.getAttribute('data-col');
      btn?.addEventListener('click', () => {
        if (state.activityData.sortCol === col) {
          state.activityData.sortDir = state.activityData.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.activityData.sortCol = col;
          state.activityData.sortDir = 'desc';
        }
        renderActivity();
        announce(`Sorted by ${col} ${state.activityData.sortDir}`);
      });
    });

    // Mobile Sort Dropdown
    $('mobile-sort-select')?.addEventListener('change', e => {
      const [col, dir] = e.target.value.split('-');
      state.activityData.sortCol = col;
      state.activityData.sortDir = dir;
      renderActivity();
    });

    // Pagination
    $('btn-page-prev')?.addEventListener('click', () => {
      if (state.activityData.page > 1) {
        state.activityData.page--;
        renderActivity();
        announce(`Page ${state.activityData.page}`);
      }
    });

    $('btn-page-next')?.addEventListener('click', () => {
      state.activityData.page++;
      renderActivity();
      announce(`Page ${state.activityData.page}`);
    });

    // Refresh button
    $('btn-refresh-activity')?.addEventListener('click', () => {
      loadActivity();
    });

    // CSV Export
    $('btn-export-csv')?.addEventListener('click', () => {
      const act = state.activityData;
      const filtered = filterRows(act.raw, {
        q: act.q,
        status: act.status,
        source: act.source,
        month: act.month
      });
      const sorted = sortRows(filtered, act.sortCol, act.sortDir);
      const csvContent = toCsv(sorted);

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      link.setAttribute('href', url);
      link.setAttribute('download', `activity-${dateStr}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(`Exported ${sorted.length} user rows to CSV.`, 'success');
    });
  }

  // ─── Coverage Tab ────────────────────────────────────────────────

  function setupCoverageListeners() {
    $('coverage-upload-btn')?.addEventListener('click', async () => {
      const fileInput = $('coverage-file-input');
      const statusBox = $('coverage-upload-status');
      const btn = $('coverage-upload-btn');
      const file = fileInput?.files?.[0];

      if (!file) {
        if (statusBox) {
          statusBox.textContent = 'Please choose a .xlsx file first.';
          statusBox.className = 'upload-status-box error';
        }
        return;
      }

      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        if (statusBox) {
          statusBox.textContent = 'Only .xlsx workbooks are supported.';
          statusBox.className = 'upload-status-box error';
        }
        return;
      }

      const form = new FormData();
      form.append('report', file);

      if (btn) btn.disabled = true;
      if (statusBox) {
        statusBox.textContent = 'Validating and uploading spreadsheet…';
        statusBox.className = 'upload-status-box';
      }

      try {
        const res = await adminFetch('/api/v1/admin/coverage', {
          method: 'POST',
          body: form
        });
        const text = await res.text();
        let data = {};
        try { data = JSON.parse(text); } catch (_) {}

        if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);

        const count = data.entries ? data.entries.length : 0;
        if (statusBox) {
          statusBox.textContent = `Successfully uploaded and parsed ${count} coverage entries.`;
          statusBox.className = 'upload-status-box success';
        }
        if (fileInput) fileInput.value = '';
        showToast(`Coverage uploaded (${count} rules)`, 'success');
      } catch (err) {
        if (statusBox) {
          statusBox.textContent = err.message;
          statusBox.className = 'upload-status-box error';
        }
        showToast(err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  // ─── Main Init ───────────────────────────────────────────────────

  function init() {
    // 1. Session check on page load
    state.session = loadStoredSession();

    if (state.session) {
      startSessionTimer();
      showConsoleView();
    } else {
      showLoginView();
    }

    // 2. Setup Login Form
    $('admin-login-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const pwdInput = $('admin-login-password');
      const errEl = $('admin-login-error');
      const btn = $('admin-login-submit');
      const password = pwdInput ? pwdInput.value.trim() : '';

      if (!password) {
        if (errEl) errEl.textContent = 'Please enter the admin password.';
        pwdInput?.focus();
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Verifying…';
      }
      if (errEl) errEl.textContent = '';

      try {
        const res = await fetch('/api/v1/admin/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Incorrect password.');
        }

        saveSession(data.admin_token, data.expires_in || 1800);
        showConsoleView();
        showToast('Signed in successfully!', 'success');
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
        pwdInput?.focus();
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Unlock Console';
        }
      }
    });

    // 3. Setup Re-auth Form
    $('reauth-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const pwdInput = $('reauth-password');
      const errEl = $('reauth-error');
      const btn = $('btn-reauth-submit');
      const password = pwdInput ? pwdInput.value.trim() : '';

      if (!password) {
        if (errEl) errEl.textContent = 'Please enter password.';
        return;
      }

      if (btn) btn.disabled = true;
      if (errEl) errEl.textContent = '';

      try {
        const res = await fetch('/api/v1/admin/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Incorrect password.');

        saveSession(data.admin_token, data.expires_in || 1800);
        closeReauthDialog();
        showToast('Session extended successfully!', 'success');

        if (state.pendingRetry) {
          const retry = state.pendingRetry;
          state.pendingRetry = null;
          retry();
        }
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    $('btn-reauth-cancel')?.addEventListener('click', () => {
      closeReauthDialog();
      clearSession();
      showLoginView();
      showToast('Signed out.', 'info');
    });

    // 4. Session Action Buttons
    $('btn-extend-session')?.addEventListener('click', () => openReauthDialog());
    $('btn-banner-extend')?.addEventListener('click', () => openReauthDialog());
    $('btn-sign-out')?.addEventListener('click', () => {
      clearSession();
      showLoginView();
      showToast('Signed out.', 'info');
    });

    // 5. Tabs
    setupTabs();

    // 6. Settings Form Listeners
    $('settings-form')?.addEventListener('input', () => {
      updateRadioCheckedClasses();
      checkSettingsDirty();
    });
    $('settings-form')?.addEventListener('change', () => {
      updateRadioCheckedClasses();
      checkSettingsDirty();
    });
    $('settings-form')?.addEventListener('submit', handleSaveSettings);

    $('btn-discard-settings')?.addEventListener('click', () => {
      if (state.savedSettings) {
        setSettingsFormValues(state.savedSettings);
        showToast('Changes discarded.', 'info');
      }
    });

    $('btn-reload-settings')?.addEventListener('click', () => {
      loadSettings();
    });

    // Browser-local scan mode radio
    const storedScanMode = localStorage.getItem(SCAN_MODE_KEY) || 'serial';
    const scanModeRadios = document.querySelectorAll('input[name="scan_mode"]');
    scanModeRadios.forEach(radio => {
      if (radio.value === storedScanMode) radio.checked = true;
      radio.addEventListener('change', () => {
        if (radio.checked) {
          localStorage.setItem(SCAN_MODE_KEY, radio.value);
          localStorage.setItem('wacs_scan_mode', radio.value);
          showToast(`Link scan mode saved: ${radio.value}`, 'info');
        }
      });
    });

    // 7. Activity Listeners
    setupActivityListeners();

    // 8. Coverage Listeners
    setupCoverageListeners();

    // 9. Unload warning for unsaved dirty settings
    window.addEventListener('beforeunload', e => {
      if (!state.savedSettings || !state.settingsLoaded) return;
      const current = getSettingsFormValues();
      const isDirty = (
        current.active_engine !== state.savedSettings.active_engine ||
        current.max_concurrent_scans !== state.savedSettings.max_concurrent_scans ||
        current.scoring_formula !== state.savedSettings.scoring_formula ||
        current.landing_page_enabled !== state.savedSettings.landing_page_enabled ||
        current.pdf_scanning_visible !== state.savedSettings.pdf_scanning_visible
      );
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
