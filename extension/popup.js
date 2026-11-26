document.addEventListener('DOMContentLoaded', () => {
  const scanBtn = document.getElementById('scanBtn');
  const btnSpinner = document.getElementById('btnSpinner');
  const btnText = document.getElementById('btnText');
  const errorBox = document.getElementById('errorBox');
  const statusPanel = document.getElementById('statusPanel');
  const scoreValue = document.getElementById('scoreValue');
  const scoreGrade = document.getElementById('scoreGrade');
  const compliancePct = document.getElementById('compliancePct');
  const violCount = document.getElementById('violCount');
  const passCount = document.getElementById('passCount');
  const incCount = document.getElementById('incCount');
  const toggleConfig = document.getElementById('toggleConfig');
  const configPanel = document.getElementById('configPanel');
  const apiBaseInput = document.getElementById('apiBaseInput');
  const saveConfigBtn = document.getElementById('saveConfigBtn');
  const detailedReportLink = document.getElementById('detailedReportLink');

  const scansLeft = document.getElementById('scansLeft');
  const toggleAccess = document.getElementById('toggleAccess');
  const accessPanel = document.getElementById('accessPanel');
  const accessForm = document.getElementById('accessForm');
  const accessSubmit = document.getElementById('accessSubmit');
  const accessStatus = document.getElementById('accessStatus');
  const codeForm = document.getElementById('codeForm');
  const accessCode = document.getElementById('accessCode');
  const codeStatus = document.getElementById('codeStatus');

  let currentApiBase = 'https://www.accessscan.in';

  // Load configuration
  chrome.runtime.sendMessage({ action: 'GET_CONFIG' }, (response) => {
    if (response && response.apiBaseUrl) {
      apiBaseInput.value = response.apiBaseUrl;
      currentApiBase = response.apiBaseUrl;
    }
    if (response && response.hasAccessCode) {
      codeStatus.textContent = 'An access code is saved. Saving an empty code removes it.';
    }
  });

  function setAccessOpen(open) {
    accessPanel.classList.toggle('open', open);
    toggleAccess.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  toggleAccess.addEventListener('click', () => {
    setAccessOpen(!accessPanel.classList.contains('open'));
  });

  accessForm.addEventListener('submit', (e) => {
    e.preventDefault();
    accessSubmit.disabled = true;
    accessStatus.textContent = 'Sending request…';
    chrome.runtime.sendMessage({
      action: 'REQUEST_ACCESS',
      email: document.getElementById('accessEmail').value.trim()
    }, (res) => {
      accessSubmit.disabled = false;
      accessStatus.textContent = res && res.success
        ? 'Request sent. You will get an access code by email once it is approved.'
        : `Could not send request: ${res ? res.error : 'unknown error'}`;
    });
  });

  codeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = accessCode.value.trim();
    chrome.runtime.sendMessage({ action: 'SET_ACCESS_CODE', code }, () => {
      accessCode.value = '';
      codeStatus.textContent = code ? 'Access code saved. Your next scans will use it.' : 'Access code removed.';
    });
  });

  toggleConfig.addEventListener('click', () => {
    configPanel.classList.toggle('open');
  });

  saveConfigBtn.addEventListener('click', () => {
    const url = apiBaseInput.value.trim().replace(/\/$/, '');
    currentApiBase = url;
    chrome.runtime.sendMessage({ action: 'SET_CONFIG', apiBaseUrl: url }, (res) => {
      if (res && res.success) {
        configPanel.classList.remove('open');
      }
    });
  });

  scanBtn.addEventListener('click', () => {
    // Reset UI state
    errorBox.style.display = 'none';
    errorBox.textContent = '';
    statusPanel.classList.remove('active');
    detailedReportLink.classList.add('hidden');
    scansLeft.textContent = '';
    scanBtn.disabled = true;
    btnSpinner.style.display = 'block';
    btnText.textContent = 'Scanning Page...';

    chrome.runtime.sendMessage({ action: 'SCAN_PAGE' }, (response) => {
      scanBtn.disabled = false;
      btnSpinner.style.display = 'none';
      btnText.textContent = 'Scan This Page';

      if (chrome.runtime.lastError) {
        showError(chrome.runtime.lastError.message);
        return;
      }

      if (!response || !response.success) {
        showError(response ? response.error : 'Unknown scan error');
        if (response && response.code === 'quota') setAccessOpen(true);
        return;
      }

      renderResults(response.result);
    });
  });

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
  }

  function renderResults(result) {
    if (!result || !result.summary) {
      showError('Invalid scan result received from server');
      return;
    }

    const summary = result.summary;
    scoreValue.textContent = summary.score !== undefined ? summary.score : '--';

    const grade = summary.grade || 'F';
    scoreGrade.textContent = `Grade ${grade}`;
    scoreGrade.className = `score-grade grade-${grade}`;

    compliancePct.textContent = `${summary.compliance_pct ? summary.compliance_pct.toFixed(1) : 0}% Compliance`;
    violCount.textContent = summary.violations !== undefined ? summary.violations : (result.violations ? result.violations.length : 0);
    passCount.textContent = summary.passes !== undefined ? summary.passes : (result.passes ? result.passes.length : 0);
    incCount.textContent = summary.incomplete !== undefined ? summary.incomplete : (result.incomplete ? result.incomplete.length : 0);

    statusPanel.classList.add('active');

    if (typeof result.scans_remaining === 'number') {
      scansLeft.textContent = `${result.scans_remaining} scan${result.scans_remaining === 1 ? '' : 's'} left.`;
    }

    // Show "View Detailed Report" link if report_id is available
    if (result.report_id) {
      const reportUrl = `${currentApiBase}/app?report=${encodeURIComponent(result.report_id)}`;
      detailedReportLink.href = reportUrl;
      detailedReportLink.classList.remove('hidden');
    } else {
      detailedReportLink.classList.add('hidden');
    }
  }
});
