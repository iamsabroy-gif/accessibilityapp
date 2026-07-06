module.exports = {
  id: 'aria-conditional-attr',
  type: 'dom',
  description: 'Conditional ARIA attributes must be used correctly.',
  help: 'Ensure ARIA attributes are used as per their conditional requirements.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
  tags: ['wcag412'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Heuristic 1: aria-errormessage should ideally be accompanied by aria-invalid="true"
    const errorElements = Array.from(document.querySelectorAll('*[aria-errormessage]'));
    
    errorElements.forEach(el => {
      const invalid = el.getAttribute('aria-invalid');
      if (invalid === 'true' || invalid === 'spelling' || invalid === 'grammar') {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      } else {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: 'Element has aria-errormessage but is not marked as aria-invalid="true".'
        });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
