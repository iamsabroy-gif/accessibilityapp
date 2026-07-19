module.exports = {
  id: 'meaningful-sequence-tabindex',
  type: 'dom',
  description: 'Positive tabindex disrupts logical DOM sequence.',
  help: 'Avoid using tabindex greater than 0.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/meaningful-sequence.html',
  tags: ['wcag132'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const positiveTabindex = Array.from(document.querySelectorAll('[tabindex]')).filter(el => {
      const ti = parseInt(el.getAttribute('tabindex'), 10);
      return !isNaN(ti) && ti > 0;
    });
    
    positiveTabindex.forEach(el => {
      violations.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()], failureSummary: 'Positive tabindex disrupts logical DOM sequence.' });
    });
    
    return { violations, passes, incomplete };
  }
};
