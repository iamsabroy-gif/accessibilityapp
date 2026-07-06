module.exports = {
  id: 'aria-prohibited-attr',
  type: 'dom',
  description: 'ARIA attributes must not be used where they are prohibited.',
  help: 'Ensure ARIA attributes are not used on roles where they are prohibited.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
  tags: ['wcag412'],
  impact: 'minor',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Prohibited mappings (heuristic subset for common violations)
    // Naming attributes are prohibited on structural/generic roles
    const prohibitedNamingRoles = new Set(['caption', 'code', 'deletion', 'emphasis', 'generic', 'insertion', 'mark', 'paragraph', 'presentation', 'none', 'strong', 'subscript', 'superscript', 'time']);
    
    const namingAttrs = ['aria-label', 'aria-labelledby'];
    
    const elementsWithRole = Array.from(document.querySelectorAll('*[role]'));
    
    elementsWithRole.forEach(el => {
      const roleAttr = el.getAttribute('role').trim().toLowerCase();
      if (!roleAttr) return;
      
      const roles = roleAttr.split(/\s+/);
      let isProhibited = false;
      let badAttr = null;
      let badRole = null;
      
      for (const role of roles) {
        if (prohibitedNamingRoles.has(role)) {
          for (const attr of namingAttrs) {
            if (el.hasAttribute(attr)) {
              isProhibited = true;
              badAttr = attr;
              badRole = role;
              break;
            }
          }
        }
        if (isProhibited) break;
      }
      
      if (isProhibited) {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: `The attribute "${badAttr}" is prohibited on an element with role="${badRole}".`
        });
      } else {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
