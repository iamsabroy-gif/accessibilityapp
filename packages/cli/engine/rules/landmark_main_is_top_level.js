module.exports = {
  id: 'landmark-main-is-top-level',
  type: 'dom',
  description: 'The main landmark must be at top level.',
  help: 'Ensure the main landmark is not contained in another landmark.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html',
  tags: ['wcag131'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const mains = Array.from(document.querySelectorAll('main, *[role="main"]'));
    const containerLandmarks = ['header', 'footer', 'nav', 'aside', 'main'];
    const containerRoles = ['banner', 'contentinfo', 'navigation', 'complementary', 'main'];
    
    mains.forEach(main => {
      let isNested = false;
      let parent = main.parentElement;
      let nestedIn = null;
      
      while (parent && parent.tagName.toLowerCase() !== 'body') {
        const tag = parent.tagName.toLowerCase();
        const role = (parent.getAttribute('role') || '').toLowerCase();
        
        if (containerLandmarks.includes(tag) || containerRoles.includes(role)) {
          isNested = true;
          nestedIn = role || tag;
          break;
        }
        parent = parent.parentElement;
      }
      
      if (isNested) {
        violations.push({
          html: main.outerHTML.substring(0, 100),
          target: [main.tagName.toLowerCase()],
          failureSummary: `The main landmark is contained within another landmark (${nestedIn}).`
        });
      } else {
        passes.push({ html: main.outerHTML.substring(0, 100), target: [main.tagName.toLowerCase()] });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
