module.exports = {
  id: 'button-name',
  type: 'dom',
  description: 'Buttons must have discernible text.',
  help: 'Ensure buttons have an accessible name.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
  tags: ['wcag412', 'wcag253'],
  impact: 'critical',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const buttons = Array.from(document.querySelectorAll('button, *[role="button"], input[type="button"], input[type="submit"], input[type="reset"]'));
    
    buttons.forEach(el => {
      let hasName = false;
      
      const text = el.textContent.trim();
      const ariaLabel = (el.getAttribute('aria-label') || '').trim();
      const ariaLabelledBy = (el.getAttribute('aria-labelledby') || '').trim();
      const title = (el.getAttribute('title') || '').trim();
      
      let val = '';
      if (el.tagName.toLowerCase() === 'input') {
        val = (el.getAttribute('value') || '').trim();
      }
      
      const hasImgWithAlt = Array.from(el.querySelectorAll('img[alt]')).some(img => img.getAttribute('alt').trim().length > 0);
      
      if (text.length > 0 || ariaLabel.length > 0 || ariaLabelledBy.length > 0 || title.length > 0 || val.length > 0 || hasImgWithAlt) {
        hasName = true;
      }
      
      if (hasName) {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      } else {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: 'Button is empty and has no accessible name.'
        });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
