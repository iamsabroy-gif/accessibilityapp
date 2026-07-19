module.exports = {
  id: 'label',
  type: 'dom',
  description: 'Every form element must have a label.',
  help: 'Ensure that every form element has an associated label or aria-label.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/labels-or-instructions.html',
  tags: ['wcag131', 'wcag332'],
  impact: 'critical',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Select form elements, excluding buttons and hidden inputs, and excluding select (handled by select-name)
    const formEls = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea'));
    
    formEls.forEach(el => {
      let hasLabel = false;
      
      // 1. Check aria-label
      if (el.hasAttribute('aria-label') && el.getAttribute('aria-label').trim().length > 0) {
        hasLabel = true;
      }
      // 2. Check aria-labelledby
      if (!hasLabel && el.hasAttribute('aria-labelledby')) {
        const id = el.getAttribute('aria-labelledby');
        if (document.getElementById(id)) {
          hasLabel = true;
        }
      }
      // 3. Check for="id" explicit label
      if (!hasLabel && el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label) hasLabel = true;
      }
      // 4. Check implicit wrapping label
      if (!hasLabel) {
        let parent = el.parentElement;
        while (parent && parent.tagName.toLowerCase() !== 'body') {
          if (parent.tagName.toLowerCase() === 'label') {
            hasLabel = true;
            break;
          }
          parent = parent.parentElement;
        }
      }
      // 5. Check title
      if (!hasLabel && el.hasAttribute('title') && el.getAttribute('title').trim().length > 0) {
        hasLabel = true;
      }
      
      if (hasLabel) {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      } else {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: 'Form element is missing a label (no <label>, aria-label, aria-labelledby, or title).'
        });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
