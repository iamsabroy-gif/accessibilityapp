module.exports = {
  id: 'aria-hidden-body',
  type: 'dom',
  description: 'aria-hidden="true" must not be present on the document body.',
  help: 'Ensure aria-hidden="true" is not present on the document body.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
  tags: ['wcag412', 'wcag131'],
  impact: 'critical',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const body = document.body;
    if (body) {
      if (body.getAttribute('aria-hidden') === 'true') {
        violations.push({
          html: body.outerHTML.substring(0, 100),
          target: ['body'],
          failureSummary: 'The document body has aria-hidden="true", which hides the entire page from screen readers.'
        });
      } else {
        passes.push({ html: body.outerHTML.substring(0, 100), target: ['body'] });
      }
    }
    
    return { violations, passes, incomplete };
  }
};
