module.exports = {
  id: 'duplicate-id-aria',
  type: 'dom',
  description: 'IDs used in ARIA and labels must be unique.',
  help: 'Ensure every id attribute value used in ARIA is unique.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/parsing.html',
  tags: ['wcag411'],
  impact: 'critical',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Find all elements with an ID
    const allElementsWithId = Array.from(document.querySelectorAll('*[id]'));
    
    // Count occurrences of each ID
    const idCounts = {};
    allElementsWithId.forEach(el => {
      const id = el.id;
      if (id) {
        idCounts[id] = (idCounts[id] || 0) + 1;
      }
    });
    
    // The aria attributes that reference IDs
    const ariaRefAttrs = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-errormessage', 'aria-flowto'];
    
    const elementsWithAriaRefs = Array.from(document.querySelectorAll(
      ariaRefAttrs.map(attr => `*[${attr}]`).join(', ')
    ));
    
    elementsWithAriaRefs.forEach(el => {
      let hasDuplicateRef = false;
      let duplicatedId = null;
      
      for (const attr of ariaRefAttrs) {
        if (el.hasAttribute(attr)) {
          const val = el.getAttribute(attr);
          if (val) {
            const ids = val.split(/\s+/);
            for (const id of ids) {
              if (idCounts[id] > 1) {
                hasDuplicateRef = true;
                duplicatedId = id;
                break;
              }
            }
          }
        }
        if (hasDuplicateRef) break;
      }
      
      if (hasDuplicateRef) {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: `The ARIA attribute references an ID "${duplicatedId}" which is not unique in the document.`
        });
      } else {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
