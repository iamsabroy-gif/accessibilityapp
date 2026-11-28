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
  const accountBar = document.getElementById('accountBar');
  const accountEmail = document.getElementById('accountEmail');
  const accountScansLeft = document.getElementById('accountScansLeft');
  const logoutBtn = document.getElementById('logoutBtn');

  const toggleLogin = document.getElementById('toggleLogin');
  const loginPanel = document.getElementById('loginPanel');
  const loginError = document.getElementById('loginError');
  const loginEmailForm = document.getElementById('loginEmailForm');
  const loginEmail = document.getElementById('loginEmail');
  const sendCodeBtn = document.getElementById('sendCodeBtn');
  const loginCodeForm = document.getElementById('loginCodeForm');
  const loginCode = document.getElementById('loginCode');
  const verifyCodeBtn = document.getElementById('verifyCodeBtn');
  const resendCodeBtn = document.getElementById('resendCodeBtn');
  const changeEmailBtn = document.getElementById('changeEmailBtn');
  const loginStatus = document.getElementById('loginStatus');

  const requestPanel = document.getElementById('requestPanel');
  const requestScansBtn = document.getElementById('requestScansBtn');
  const requestScansStatus = document.getElementById('requestScansStatus');

  let currentApiBase = 'https://www.accessscan.in';
  let pendingEmail = '';
  let resendTimerId = null;

  function formatScansLeft(n) {
    return `${n} scan${n === 1 ? '' : 's'} left`;
  }

  function clearResendTimer() {
    if (resendTimerId !== null) {
      clearTimeout(resendTimerId);
      resendTimerId = null;
    }
  }

  function startResendTimer() {
    clearResendTimer();
    resendCodeBtn.hidden = true;
    resendTimerId = setTimeout(() => {
      resendCodeBtn.hidden = false;
      resendTimerId = null;
    }, 60000);
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
  }

  function clearError() {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }

  function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.style.display = 'block';
  }

  function clearLoginError() {
    loginError.style.display = 'none';
    loginError.textContent = '';
  }

  function setLoginOpen(open) {
    loginPanel.classList.toggle('open', open);
    toggleLogin.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function showLoginStep(step) {
    if (step === 'code') {
      loginEmailForm.hidden = true;
      loginCodeForm.hidden = false;
      loginCode.value = '';
      loginCode.focus();
      startResendTimer();
    } else {
      clearResendTimer();
      resendCodeBtn.hidden = true;
      loginCodeForm.hidden = true;
      loginEmailForm.hidden = false;
    }
  }

  function setSignedOutState() {
    accountBar.hidden = true;
    accountEmail.textContent = '';
    accountScansLeft.textContent = '';
    toggleLogin.hidden = false;
    requestPanel.hidden = true;
    requestPanel.classList.remove('open');
    requestScansStatus.textContent = '';
  }

  function setSignedInState(email, scansRemaining) {
    accountEmail.textContent = email || '';
    accountScansLeft.textContent = typeof scansRemaining === 'number'
      ? formatScansLeft(scansRemaining)
      : '';
    accountBar.hidden = false;
    toggleLogin.hidden = true;
    setLoginOpen(false);
    showLoginStep('email');
    loginStatus.textContent = '';
    clearLoginError();
  }

  function refreshMe() {
    chrome.runtime.sendMessage({ action: 'GET_ME' }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      if (res.success) {
        setSignedInState(res.email, res.scans_left);
      } else if (res.code === 'login_required') {
        setSignedOutState();
      }
    });
  }

  // Load configuration and current session
  chrome.runtime.sendMessage({ action: 'GET_CONFIG' }, (response) => {
    if (response && response.apiBaseUrl) {
      apiBaseInput.value = response.apiBaseUrl;
      currentApiBase = response.apiBaseUrl;
    }
    if (response && response.isLoggedIn) {
      setSignedInState(response.userEmail || '', undefined);
      refreshMe();
    } else {
      setSignedOutState();
    }
  });

  toggleLogin.addEventListener('click', () => {
    const nextOpen = !loginPanel.classList.contains('open');
    setLoginOpen(nextOpen);
    if (nextOpen) {
      if (!loginCodeForm.hidden) {
        loginCode.focus();
      } else {
        loginEmail.focus();
      }
    }
  });

  function sendAuthCode(email) {
    clearLoginError();
    loginStatus.textContent = 'Sending code…';
    sendCodeBtn.disabled = true;
    resendCodeBtn.disabled = true;

    chrome.runtime.sendMessage({ action: 'SEND_AUTH_CODE', email }, (res) => {
      sendCodeBtn.disabled = false;
      resendCodeBtn.disabled = false;
      if (chrome.runtime.lastError) {
        loginStatus.textContent = '';
        showLoginError(chrome.runtime.lastError.message);
        return;
      }
      if (!res || !res.success) {
        loginStatus.textContent = '';
        showLoginError(res && res.error ? res.error : 'Could not send code.');
        return;
      }
      pendingEmail = email;
      loginStatus.textContent = `Code sent to ${email}. Check your inbox.`;
      showLoginStep('code');
    });
  }

  loginEmailForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = loginEmail.value.trim();
    if (!email) return;
    sendAuthCode(email);
  });

  resendCodeBtn.addEventListener('click', () => {
    if (!pendingEmail) return;
    sendAuthCode(pendingEmail);
  });

  changeEmailBtn.addEventListener('click', () => {
    clearLoginError();
    loginStatus.textContent = '';
    showLoginStep('email');
    loginEmail.focus();
  });

  loginCodeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = loginCode.value.trim();
    if (!code) return;
    clearLoginError();
    loginStatus.textContent = 'Verifying code…';
    verifyCodeBtn.disabled = true;

    chrome.runtime.sendMessage({
      action: 'VERIFY_AUTH_CODE',
      email: pendingEmail || loginEmail.value.trim(),
      code
    }, (res) => {
      verifyCodeBtn.disabled = false;
      if (chrome.runtime.lastError) {
        loginStatus.textContent = '';
        showLoginError(chrome.runtime.lastError.message);
        return;
      }
      if (!res || !res.success) {
        loginStatus.textContent = '';
        showLoginError(res && res.error ? res.error : 'Invalid or expired code.');
        return;
      }
      clearResendTimer();
      clearError();
      setSignedInState(res.email || pendingEmail, res.scans_left);
      refreshMe();
    });
  });

  logoutBtn.addEventListener('click', () => {
    clearResendTimer();
    chrome.runtime.sendMessage({ action: 'LOGOUT' }, () => {
      clearError();
      scansLeft.textContent = '';
      setSignedOutState();
    });
  });

  requestScansBtn.addEventListener('click', () => {
    requestScansBtn.disabled = true;
    requestScansStatus.textContent = 'Sending request…';
    chrome.runtime.sendMessage({ action: 'REQUEST_ACCESS' }, (res) => {
      requestScansBtn.disabled = false;
      if (chrome.runtime.lastError) {
        requestScansStatus.textContent = `Could not send request: ${chrome.runtime.lastError.message}`;
        return;
      }
      if (res && res.code === 'login_required') {
        setSignedOutState();
        showError(res.error || 'Please sign in first.');
        setLoginOpen(true);
        loginEmail.focus();
        return;
      }
      requestScansStatus.textContent = res && res.success
        ? 'Request sent. You will get an email once more scans are approved.'
        : `Could not send request: ${res && res.error ? res.error : 'unknown error'}`;
    });
  });

  toggleConfig.addEventListener('click', () => {
    const open = configPanel.classList.toggle('open');
    toggleConfig.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  saveConfigBtn.addEventListener('click', () => {
    const url = apiBaseInput.value.trim().replace(/\/$/, '');
    currentApiBase = url;
    chrome.runtime.sendMessage({ action: 'SET_CONFIG', apiBaseUrl: url }, (res) => {
      if (res && res.success) {
        configPanel.classList.remove('open');
        toggleConfig.setAttribute('aria-expanded', 'false');
      }
    });
  });

  scanBtn.addEventListener('click', () => {
    clearError();
    statusPanel.classList.remove('active');
    detailedReportLink.classList.add('hidden');
    scansLeft.textContent = '';
    requestPanel.hidden = true;
    requestPanel.classList.remove('open');
    requestScansStatus.textContent = '';
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
        if (response && response.code === 'login_required') {
          setSignedOutState();
          setLoginOpen(true);
          loginEmail.focus();
        } else if (response && response.code === 'scans_used_up') {
          accountScansLeft.textContent = formatScansLeft(0);
          requestPanel.hidden = false;
          requestPanel.classList.add('open');
        }
        return;
      }

      renderResults(response.result);
    });
  });

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
      const text = `${formatScansLeft(result.scans_remaining)}.`;
      scansLeft.textContent = text;
      if (!accountBar.hidden) {
        accountScansLeft.textContent = formatScansLeft(result.scans_remaining);
      }
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
