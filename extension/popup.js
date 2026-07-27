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

  let currentApiBase = 'https://www.accessscan.in';

  // Load configuration
  chrome.runtime.sendMessage({ action: 'GET_CONFIG' }, (response) => {
    if (response && response.apiBaseUrl) {
      apiBaseInput.value = response.apiBaseUrl;
      currentApiBase = response.apiBaseUrl;
    }
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
