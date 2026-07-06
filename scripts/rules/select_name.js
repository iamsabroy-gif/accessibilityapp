module.exports = {
  id: 'select-name',
  type: 'dom',
  description: 'Select element must have an accessible name.',
  help: 'Ensure that every <select> element has a label or aria-label.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/labels-or-instructions.html',
  tags: ['wcag131', 'wcag412'],
  impact: 'critical',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const selects = Array.from(document.querySelectorAll('select'));
    
    selects.forEach(el => {
      let hasLabel = false;
      
      if (el.hasAttribute('aria-label') && el.getAttribute('aria-label').trim().length > 0) hasLabel = true;
      if (!hasLabel && el.hasAttribute('aria-labelledby')) hasLabel = true;
      if (!hasLabel && el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label) hasLabel = true;
      }
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
      if (!hasLabel && el.hasAttribute('title') && el.getAttribute('title').trim().length > 0) hasLabel = true;
      
      if (hasLabel) {
        passes.push({ html: el.outerHTML.substring(0, 100), target: ['select'] });
      } else {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: ['select'],
          failureSummary: 'Select element is missing an accessible name.'
        });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
