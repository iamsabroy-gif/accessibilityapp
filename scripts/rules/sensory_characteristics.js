module.exports = {
  id: 'sensory-characteristics',
  type: 'dom',
  description: 'Instructions may rely solely on sensory characteristics.',
  help: 'Verify instructions do not rely solely on shape, size, location, or sound.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/sensory-characteristics.html',
  tags: ['wcag133'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const bodyText = document.body.innerText || '';
    const hasSensoryWords = /(above|below|left|right|top|bottom|red|blue|green|round|square)/i.test(bodyText);
    
    if (hasSensoryWords) {
      incomplete.push({
        html: 'N/A',
        target: ['body'],
        failureSummary: 'Page contains sensory words (e.g., above, right, red). Verify that instructions do not rely solely on shape, size, visual location, or sound.'
      });
    } else {
      passes.push({ html: 'N/A', target: ['body'] });
    }
    
    return { violations, passes, incomplete };
  }
};
