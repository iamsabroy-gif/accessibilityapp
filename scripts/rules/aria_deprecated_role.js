module.exports = {
  id: 'aria-deprecated-role',
  type: 'dom',
  description: 'Elements must not use deprecated roles.',
  help: 'Ensure no deprecated ARIA roles are used.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
  tags: ['wcag412'],
  impact: 'minor',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const deprecatedRoles = new Set(['directory']);
    
    const elementsWithRole = Array.from(document.querySelectorAll('*[role]'));
    
    elementsWithRole.forEach(el => {
      const roleAttr = el.getAttribute('role').trim().toLowerCase();
      if (!roleAttr) return;
      
      const roles = roleAttr.split(/\s+/);
      let hasDeprecated = false;
      let badRole = '';
      
      for (const role of roles) {
        if (deprecatedRoles.has(role)) {
          hasDeprecated = true;
          badRole = role;
          break;
        }
      }
      
      if (hasDeprecated) {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: `The role "${badRole}" is deprecated in WAI-ARIA.`
        });
      } else {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
