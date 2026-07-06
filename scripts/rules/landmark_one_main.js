module.exports = {
  id: 'landmark-one-main',
  type: 'dom',
  description: 'Document must have one main landmark.',
  help: 'Ensure the page has exactly one main landmark.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html',
  tags: ['wcag131'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const mains = Array.from(document.querySelectorAll('main, *[role="main"]'));
    
    if (mains.length === 0) {
      violations.push({
        html: 'N/A',
        target: ['html'],
        failureSummary: 'Document does not have a main landmark.'
      });
    } else if (mains.length === 1) {
      passes.push({ html: mains[0].outerHTML.substring(0, 100), target: [mains[0].tagName.toLowerCase()] });
    } else {
      // Handled by landmark-no-duplicate-main, but we can also fail here or leave it. Axe fails it here too.
      violations.push({
        html: 'N/A',
        target: ['html'],
        failureSummary: `Document has multiple (${mains.length}) main landmarks.`
      });
    }
    
    return { violations, passes, incomplete };
  }
};
