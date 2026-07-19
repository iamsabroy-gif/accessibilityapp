module.exports = {
  id: 'page-has-heading-one',
  type: 'dom',
  description: 'Page must have at least one level-one heading.',
  help: 'Ensure that the page contains at least one <h1> element.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/headings-and-labels.html',
  tags: ['wcag246'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Some apps use role="heading" aria-level="1"
    const h1s = Array.from(document.querySelectorAll('h1, *[role="heading"][aria-level="1"]'));
    
    if (h1s.length > 0) {
      passes.push({ html: h1s[0].outerHTML.substring(0, 100), target: ['html'] });
    } else {
      violations.push({
        html: 'N/A',
        target: ['html'],
        failureSummary: 'The page does not contain a level-one heading (<h1> or role="heading" aria-level="1").'
      });
    }
    
    return { violations, passes, incomplete };
  }
};
