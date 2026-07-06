module.exports = {
  id: 'form-field-multiple-labels',
  type: 'dom',
  description: 'Form field must not have multiple label elements.',
  help: 'Ensure form field does not have multiple label elements.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/labels-or-instructions.html',
  tags: ['wcag332'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const formEls = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'));
    
    formEls.forEach(el => {
      let labelCount = 0;
      
      // 1. Check explicit <label for="id">
      if (el.id) {
        const labels = document.querySelectorAll(`label[for="${el.id}"]`);
        labelCount += labels.length;
      }
      
      // 2. Check implicit wrapping <label>
      let parent = el.parentElement;
      while (parent && parent.tagName.toLowerCase() !== 'body') {
        if (parent.tagName.toLowerCase() === 'label') {
          labelCount += 1;
        }
        parent = parent.parentElement;
      }
      
      if (labelCount > 1) {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: `Form element has multiple (${labelCount}) <label> elements associated with it.`
        });
      } else if (labelCount === 1) {
        // We only push pass if it actually has exactly 1 label, so we don't spam passes for elements without labels (handled by 'label' rule).
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
