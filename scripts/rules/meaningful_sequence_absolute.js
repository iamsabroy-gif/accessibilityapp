module.exports = {
  id: 'meaningful-sequence-absolute',
  type: 'dom',
  description: 'Absolute positioning may disconnect visual from DOM order.',
  help: 'Ensure visual reading order matches DOM order.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/meaningful-sequence.html',
  tags: ['wcag132'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const absItems = Array.from(document.querySelectorAll('*')).filter(el => window.getComputedStyle(el).position === 'absolute');
    
    absItems.forEach(el => {
      violations.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()], failureSummary: 'Absolute positioning may disconnect visual from DOM order.' });
    });
    
    return { violations, passes, incomplete };
  }
};
