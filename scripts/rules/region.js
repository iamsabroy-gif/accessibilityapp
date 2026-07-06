module.exports = {
  id: 'region',
  type: 'dom',
  description: 'All page content should be contained by landmarks.',
  help: 'Ensure all content is contained within a landmark region.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html',
  tags: ['wcag131', 'best-practice'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Check if body has any text nodes or significant content that is not in a landmark
    const landmarkSelectors = 'header, footer, nav, aside, main, *[role="banner"], *[role="contentinfo"], *[role="navigation"], *[role="complementary"], *[role="main"], *[role="region"], *[role="search"]';
    
    const landmarks = Array.from(document.querySelectorAll(landmarkSelectors));
    
    // We walk text nodes and check if they are contained in a landmark
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    let hasContentOutside = false;
    let badNode = null;
    
    while ((node = walker.nextNode())) {
      const text = node.nodeValue.trim();
      if (!text) continue;
      
      const parent = node.parentElement;
      if (['script', 'style', 'noscript'].includes(parent.tagName.toLowerCase())) continue;
      
      // Check if this text node is inside a landmark
      let p = parent;
      let inLandmark = false;
      while (p && p.tagName.toLowerCase() !== 'body') {
        if (p.matches(landmarkSelectors)) {
          inLandmark = true;
          break;
        }
        p = p.parentElement;
      }
      
      if (!inLandmark) {
        hasContentOutside = true;
        badNode = parent;
        break; // we just need to flag it once for the page, or flag the specific element
      }
    }
    
    if (hasContentOutside) {
      violations.push({
        html: badNode.outerHTML.substring(0, 100),
        target: [badNode.tagName.toLowerCase()],
        failureSummary: 'Page content is not contained by a landmark region.'
      });
    } else {
      passes.push({ html: 'N/A', target: ['html'] });
    }
    
    return { violations, passes, incomplete };
  }
};
