module.exports = {
  id: 'meaningful-sequence-css-order',
  type: 'dom',
  description: 'CSS order property alters visual sequence.',
  help: 'Ensure visual reading order matches DOM order.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/meaningful-sequence.html',
  tags: ['wcag132'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const flexGridItems = Array.from(document.querySelectorAll('*')).filter(el => {
      const s = window.getComputedStyle(el);
      return s.order && s.order !== '0' && s.order !== '';
    });
    
    flexGridItems.forEach(el => {
      violations.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()], failureSummary: 'CSS order property alters visual sequence.' });
    });
    
    return { violations, passes, incomplete };
  }
};
