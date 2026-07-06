module.exports = {
  id: 'empty-heading',
  type: 'dom',
  description: 'Headings must not be empty.',
  help: 'Ensure headings have discernible text.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/headings-and-labels.html',
  tags: ['wcag246'],
  impact: 'minor',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, *[role="heading"]'));
    
    headings.forEach(el => {
      // Check for inner text or aria-label
      const text = el.textContent.trim();
      const ariaLabel = (el.getAttribute('aria-label') || '').trim();
      const ariaLabelledBy = (el.getAttribute('aria-labelledby') || '').trim();
      
      // Also check if they contain an image with an alt attribute
      const hasImgWithAlt = Array.from(el.querySelectorAll('img[alt]')).some(img => img.getAttribute('alt').trim().length > 0);
      
      if (text.length > 0 || ariaLabel.length > 0 || ariaLabelledBy.length > 0 || hasImgWithAlt) {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      } else {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: 'Heading element is empty (contains no text or image with alt text).'
        });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
