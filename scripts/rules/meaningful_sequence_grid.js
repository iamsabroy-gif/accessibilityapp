module.exports = {
  id: 'meaningful-sequence-grid',
  type: 'dom',
  description: 'CSS Grid explicit placement alters visual sequence.',
  help: 'Ensure visual reading order matches DOM order.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/meaningful-sequence.html',
  tags: ['wcag132'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const gridItems = Array.from(document.querySelectorAll('*')).filter(el => {
      const s = window.getComputedStyle(el);
      return (s.gridColumn && s.gridColumn !== 'auto') || (s.gridRow && s.gridRow !== 'auto');
    });
    
    gridItems.forEach(el => {
      violations.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()], failureSummary: 'CSS Grid explicit placement alters visual sequence.' });
    });
    
    return { violations, passes, incomplete };
  }
};
