module.exports = {
  id: 'aria-allowed-role',
  type: 'dom',
  description: 'ARIA role should be appropriate for the element.',
  help: 'Ensure role attribute has an appropriate value for the element.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
  tags: ['wcag412'],
  impact: 'minor',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Heuristics for elements that shouldn't have arbitrary roles
    // For example, heading elements should usually stay headings or presentation.
    const strictElements = {
      'h1': ['heading', 'presentation', 'none', 'tab'],
      'h2': ['heading', 'presentation', 'none', 'tab'],
      'h3': ['heading', 'presentation', 'none', 'tab'],
      'h4': ['heading', 'presentation', 'none', 'tab'],
      'h5': ['heading', 'presentation', 'none', 'tab'],
      'h6': ['heading', 'presentation', 'none', 'tab'],
      'ul': ['directory', 'group', 'list', 'listbox', 'menu', 'menubar', 'radiogroup', 'tablist', 'toolbar', 'tree', 'presentation', 'none'],
      'ol': ['directory', 'group', 'list', 'listbox', 'menu', 'menubar', 'radiogroup', 'tablist', 'toolbar', 'tree', 'presentation', 'none'],
      'dl': ['group', 'list', 'presentation', 'none'],
      'fieldset': ['group', 'radiogroup', 'presentation', 'none'],
      'legend': [], // generally should not have roles
    };
    
    const elementsWithRole = Array.from(document.querySelectorAll('*[role]'));
    
    elementsWithRole.forEach(el => {
      const tag = el.tagName.toLowerCase();
      const allowedRoles = strictElements[tag];
      
      if (allowedRoles) {
        const roleAttr = el.getAttribute('role').trim().toLowerCase();
        const roles = roleAttr.split(/\s+/);
        let hasInvalidRole = false;
        let badRole = null;
        
        for (const role of roles) {
          if (!allowedRoles.includes(role)) {
            hasInvalidRole = true;
            badRole = role;
            break;
          }
        }
        
        if (hasInvalidRole) {
          violations.push({
            html: el.outerHTML.substring(0, 100),
            target: [tag],
            failureSummary: `The role "${badRole}" is not allowed for <${tag}> elements.`
          });
          return;
        }
      }
      
      passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
    });
    
    return { violations, passes, incomplete };
  }
};
