module.exports = {
  id: 'label-title-only',
  type: 'dom',
  description: 'Form elements should not solely rely on the title attribute for an accessible name.',
  help: 'Provide a visible label or aria-label instead of just a title attribute.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/labels-or-instructions.html',
  tags: ['wcag131', 'wcag332'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const formEls = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select'));
    
    formEls.forEach(el => {
      let hasRealLabel = false;
      
      // 1. Check aria-label
      if (el.hasAttribute('aria-label') && el.getAttribute('aria-label').trim().length > 0) {
        hasRealLabel = true;
      }
      // 2. Check aria-labelledby
      if (!hasRealLabel && el.hasAttribute('aria-labelledby')) {
        const id = el.getAttribute('aria-labelledby');
        if (document.getElementById(id)) {
          hasRealLabel = true;
        }
      }
      // 3. Check for="id" explicit label
      if (!hasRealLabel && el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label) hasRealLabel = true;
      }
      // 4. Check implicit wrapping label
      if (!hasRealLabel) {
        let parent = el.parentElement;
        while (parent && parent.tagName.toLowerCase() !== 'body') {
          if (parent.tagName.toLowerCase() === 'label') {
            hasRealLabel = true;
            break;
          }
          parent = parent.parentElement;
        }
      }
      
      const hasTitle = el.hasAttribute('title') && el.getAttribute('title').trim().length > 0;
      
      // If it ONLY has a title, it's a violation for this specific rule
      if (!hasRealLabel && hasTitle) {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: 'Form element relies solely on the title attribute for its accessible name.'
        });
      } else {
        // If it has a real label, or neither (caught by 'label' rule), it doesn't fail this rule.
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
