module.exports = {
  id: 'link-name',
  type: 'dom',
  description: 'Links must have discernible text.',
  help: 'Ensure links have an accessible name.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/link-purpose-in-context.html',
  tags: ['wcag244'],
  impact: 'critical',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const links = Array.from(document.querySelectorAll('a[href], *[role="link"]'));
    
    links.forEach(el => {
      let hasName = false;
      
      const text = el.textContent.trim();
      const ariaLabel = (el.getAttribute('aria-label') || '').trim();
      const ariaLabelledBy = (el.getAttribute('aria-labelledby') || '').trim();
      const title = (el.getAttribute('title') || '').trim();
      
      const hasImgWithAlt = Array.from(el.querySelectorAll('img[alt]')).some(img => img.getAttribute('alt').trim().length > 0);
      
      if (text.length > 0 || ariaLabel.length > 0 || ariaLabelledBy.length > 0 || title.length > 0 || hasImgWithAlt) {
        hasName = true;
      }
      
      if (hasName) {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      } else {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: 'Link is empty and has no accessible name.'
        });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
