module.exports = {
  id: 'aria-required-attr',
  type: 'dom',
  description: 'Required ARIA attributes must be provided.',
  help: 'Ensure elements with ARIA roles have all required ARIA attributes.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
  tags: ['wcag412'],
  impact: 'critical',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Mapping of roles to their required attributes
    const requiredMap = {
      'checkbox': ['aria-checked'],
      'combobox': ['aria-expanded'],
      'menuitemcheckbox': ['aria-checked'],
      'menuitemradio': ['aria-checked'],
      'meter': ['aria-valuenow'],
      'radio': ['aria-checked'],
      'scrollbar': ['aria-valuenow', 'aria-controls'],
      'slider': ['aria-valuenow'],
      'spinbutton': ['aria-valuenow'],
      'switch': ['aria-checked']
    };
    
    const elementsWithRole = Array.from(document.querySelectorAll('*[role]'));
    
    elementsWithRole.forEach(el => {
      const roleAttr = el.getAttribute('role').trim().toLowerCase();
      if (!roleAttr) return;
      
      const roles = roleAttr.split(/\s+/);
      let missingAttr = null;
      let failingRole = null;
      
      for (const role of roles) {
        const requiredAttrs = requiredMap[role];
        if (requiredAttrs) {
          for (const attr of requiredAttrs) {
            if (!el.hasAttribute(attr)) {
              missingAttr = attr;
              failingRole = role;
              break;
            }
          }
        }
        if (missingAttr) break;
      }
      
      if (missingAttr) {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: `The role "${failingRole}" requires the attribute "${missingAttr}" to be present.`
        });
      } else {
        // If it had a role that has requirements, and they were met, pass it.
        const hasReqRole = roles.some(r => requiredMap[r]);
        if (hasReqRole) {
          passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
        }
      }
    });
    
    return { violations, passes, incomplete };
  }
};
