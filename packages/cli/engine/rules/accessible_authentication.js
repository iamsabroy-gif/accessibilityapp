module.exports = {
  id: 'accessible-authentication',
  type: 'dom',
  description: 'Authentication must not require a cognitive function test without an accessible alternative.',
  help: 'Ensure CAPTCHAs provide an audio alternative, object recognition alternative, or personal content alternative.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html',
  tags: ['wcag22aa', 'wcag338'],
  impact: 'critical',

  evaluate: function(document) {
    var violations = [];
    var passes = [];
    var incomplete = [];

    // Known CAPTCHA provider domains — extend this list as new providers emerge
    var CAPTCHA_DOMAINS = [
      'recaptcha.net',
      'google.com/recaptcha',
      'gstatic.com/recaptcha',
      'js.hcaptcha.com',
      'hcaptcha.com',
      'challenges.cloudflare.com',
      'turnstile.cloudflare.com',
      'funcaptcha.com',
      'arkoselabs.com',
      'captcha-delivery.com',
      'friendly-captcha.com',
      'mtcaptcha.com',
      'procaptcha.com'
    ];

    function matchesCaptchaDomain(src) {
      if (!src) return false;
      var lower = src.toLowerCase();
      for (var i = 0; i < CAPTCHA_DOMAINS.length; i++) {
        if (lower.indexOf(CAPTCHA_DOMAINS[i]) !== -1) return true;
      }
      return false;
    }

    var captchaFound = false;
    var captchaSource = '';
    var captchaHtml = '';

    // Layer 1: script src
    var scripts = Array.from(document.querySelectorAll('script[src]'));
    for (var si = 0; si < scripts.length; si++) {
      var scriptSrc = scripts[si].getAttribute('src') || '';
      if (matchesCaptchaDomain(scriptSrc)) {
        captchaFound = true;
        captchaSource = scriptSrc.substring(0, 80);
        captchaHtml = '<script src="' + captchaSource + '">';
        break;
      }
    }

    // Layer 2: iframe src
    if (!captchaFound) {
      var iframes = Array.from(document.querySelectorAll('iframe[src]'));
      for (var ii = 0; ii < iframes.length; ii++) {
        var iframeSrc = iframes[ii].getAttribute('src') || '';
        if (matchesCaptchaDomain(iframeSrc)) {
          captchaFound = true;
          captchaSource = iframeSrc.substring(0, 80);
          captchaHtml = iframes[ii].outerHTML.substring(0, 120);
          break;
        }
      }
    }

    // Layer 3: <img> inside <form> with captcha in alt or src
    if (!captchaFound) {
      var forms = Array.from(document.querySelectorAll('form'));
      for (var fi = 0; fi < forms.length; fi++) {
        var imgs = Array.from(forms[fi].querySelectorAll('img'));
        for (var imi = 0; imi < imgs.length; imi++) {
          var alt = (imgs[imi].getAttribute('alt') || '').toLowerCase();
          var imgSrc = (imgs[imi].getAttribute('src') || '').toLowerCase();
          var cls = (imgs[imi].className && typeof imgs[imi].className === 'string'
            ? imgs[imi].className : '').toLowerCase();
          if (alt.indexOf('captcha') !== -1 || imgSrc.indexOf('captcha') !== -1 ||
              cls.indexOf('captcha') !== -1) {
            captchaFound = true;
            captchaHtml = imgs[imi].outerHTML.substring(0, 120);
            captchaSource = 'captcha image inside form';
            break;
          }
        }
        if (captchaFound) break;
      }
    }

    if (captchaFound) {
      violations.push({
        html: captchaHtml,
        target: ['form'],
        failureSummary: 'CAPTCHA or cognitive function test detected (' + captchaSource + '). Verify an accessible alternative exists: (1) audio CAPTCHA, (2) object recognition test, (3) personal-content test, or (4) an authentication method that does not use CAPTCHAs at all.'
      });
      return { violations: violations, passes: passes, incomplete: incomplete };
    }

    // Layer 4: class/id heuristic — less certain, emit incomplete
    var captchaWidgets = Array.from(document.querySelectorAll(
      '[class*="captcha"], [id*="captcha"], [data-sitekey], [data-widget-type="captcha"]'
    ));
    if (captchaWidgets.length > 0) {
      incomplete.push({
        html: captchaWidgets[0].outerHTML.substring(0, 120),
        target: [captchaWidgets[0].tagName.toLowerCase()],
        failureSummary: 'Element with CAPTCHA-related class, id, or data-sitekey attribute detected. Manually verify whether a cognitive function test is required without an accessible alternative.'
      });
      return { violations: violations, passes: passes, incomplete: incomplete };
    }

    // Check whether any authentication form exists at all; if not, SC is not applicable
    var authForms = Array.from(document.querySelectorAll('form')).filter(function(f) {
      var inputs = Array.from(f.querySelectorAll('input'));
      return inputs.some(function(inp) {
        return inp.getAttribute('type') === 'password';
      });
    });

    if (authForms.length > 0) {
      passes.push({
        html: authForms[0].outerHTML.substring(0, 120),
        target: ['form']
      });
    } else {
      passes.push({ html: '<body>', target: ['body'] });
    }

    return { violations: violations, passes: passes, incomplete: incomplete };
  }
};
