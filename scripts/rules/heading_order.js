module.exports = {
  id: 'heading-order',
  type: 'dom',
  description: 'Heading levels should only increase by one.',
  help: 'Ensure headings are in a logical order.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/section-headings.html',
  tags: ['wcag2410'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    let previousLevel = null;
    
    headings.forEach(el => {
      const currentLevel = parseInt(el.tagName.substring(1), 10);
      
      if (previousLevel !== null) {
        // Heading level should not jump by more than 1 (e.g., H2 -> H4 is a jump)
        if (currentLevel - previousLevel > 1) {
          violations.push({
            html: el.outerHTML.substring(0, 100),
            target: [el.tagName.toLowerCase()],
            failureSummary: `Heading level skipped. Jumped from H${previousLevel} to H${currentLevel}.`
          });
        } else {
          passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
        }
      } else {
        // First heading doesn't have a previous level to compare against
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      }
      
      previousLevel = currentLevel;
    });
    
    return { violations, passes, incomplete };
  }
};
