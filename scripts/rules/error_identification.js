module.exports = {
  id: 'error-identification',
  type: 'dom',
  description: 'Input marked invalid must have an associated error message.',
  help: 'Use aria-errormessage or aria-describedby to link errors to inputs.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/error-identification.html',
  tags: ['wcag331'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const invalidEls = Array.from(document.querySelectorAll('[aria-invalid="true"]'));
    invalidEls.forEach(el => {
      const errDesc = el.getAttribute('aria-errormessage');
      const descBy = el.getAttribute('aria-describedby');
      if (!errDesc && !descBy) {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: 'Input is marked invalid (aria-invalid="true") but has no linked error message (aria-errormessage or aria-describedby).'
        });
      } else {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      }
    });
    
    if (invalidEls.length === 0) {
      const errTexts = Array.from(document.querySelectorAll('span, div, p, label')).filter(e => /error|invalid|required/i.test(e.textContent));
      if (errTexts.length > 0) {
        incomplete.push({
          html: 'N/A',
          target: ['document'],
          failureSummary: 'Found text resembling error messages; verify that corresponding inputs use aria-invalid and link to errors programmatically.'
        });
      }
    }
    
    return { violations, passes, incomplete };
  }
};
