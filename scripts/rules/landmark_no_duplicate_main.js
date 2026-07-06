module.exports = {
  id: 'landmark-no-duplicate-main',
  type: 'dom',
  description: 'Document must not have more than one main landmark.',
  help: 'Ensure the page has at most one main landmark.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html',
  tags: ['wcag131'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const mains = Array.from(document.querySelectorAll('main, *[role="main"]'));
    
    if (mains.length > 1) {
      mains.forEach(el => {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: `Document has multiple (${mains.length}) main landmarks.`
        });
      });
    } else if (mains.length === 1) {
      passes.push({ html: mains[0].outerHTML.substring(0, 100), target: [mains[0].tagName.toLowerCase()] });
    }
    
    return { violations, passes, incomplete };
  }
};
