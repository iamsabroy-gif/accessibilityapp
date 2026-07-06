module.exports = {
  id: 'landmark-contentinfo-is-top-level',
  type: 'dom',
  description: 'The contentinfo landmark must be at top level.',
  help: 'Ensure the contentinfo landmark is not contained in another landmark.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html',
  tags: ['wcag131'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Find explicit contentinfo and footers that act as contentinfo
    // footer is contentinfo if it's not a descendant of article, aside, main, nav, or section
    const contentinfos = Array.from(document.querySelectorAll('*[role="contentinfo"], footer'));
    const containerLandmarks = ['header', 'footer', 'nav', 'aside', 'main'];
    const containerRoles = ['banner', 'contentinfo', 'navigation', 'complementary', 'main'];
    
    contentinfos.forEach(el => {
      let isNested = false;
      let parent = el.parentElement;
      let nestedIn = null;
      let isTrueContentInfo = el.getAttribute('role') === 'contentinfo';
      
      // If it's a footer, verify it's actually acting as a contentinfo landmark
      if (!isTrueContentInfo && el.tagName.toLowerCase() === 'footer') {
        let p = el.parentElement;
        let scoped = false;
        while (p && p.tagName.toLowerCase() !== 'body') {
          if (['article', 'aside', 'main', 'nav', 'section'].includes(p.tagName.toLowerCase())) {
            scoped = true;
            break;
          }
          p = p.parentElement;
        }
        if (!scoped) isTrueContentInfo = true;
      }
      
      if (!isTrueContentInfo) return; // not a landmark
      
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
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: `The contentinfo landmark is contained within another landmark (${nestedIn}).`
        });
      } else {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
