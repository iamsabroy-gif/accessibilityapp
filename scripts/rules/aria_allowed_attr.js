module.exports = {
  id: 'aria-allowed-attr',
  type: 'dom',
  description: 'ARIA attributes must be valid for the role they are used on.',
  help: 'Ensure ARIA attributes are allowed for an element\'s role.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
  tags: ['wcag412'],
  impact: 'critical',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Global attributes are allowed on almost all elements
    const globalAria = new Set([
      'aria-atomic', 'aria-busy', 'aria-controls', 'aria-current', 'aria-describedby',
      'aria-details', 'aria-disabled', 'aria-dropeffect', 'aria-errormessage', 'aria-flowto',
      'aria-grabbed', 'aria-haspopup', 'aria-hidden', 'aria-invalid', 'aria-keyshortcuts',
      'aria-label', 'aria-labelledby', 'aria-live', 'aria-owns', 'aria-relevant',
      'aria-roledescription'
    ]);
    
    // Mapping of restricted attributes to roles they are allowed on (simplified heuristic)
    const allowedMap = {
      'aria-checked': ['checkbox', 'menuitemcheckbox', 'option', 'radio', 'menuitemradio', 'switch', 'treeitem'],
      'aria-pressed': ['button'],
      'aria-expanded': ['button', 'combobox', 'document', 'link', 'row', 'rowheader', 'treeitem', 'window', 'application', 'checkbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab'],
      'aria-required': ['checkbox', 'combobox', 'gridcell', 'listbox', 'radiogroup', 'spinbutton', 'textbox', 'tree', 'columnheader', 'rowheader'],
      'aria-selected': ['cell', 'columnheader', 'gridcell', 'option', 'row', 'rowheader', 'tab', 'treeitem'],
      'aria-level': ['heading', 'listitem', 'row', 'treeitem'],
      'aria-valuemax': ['scrollbar', 'separator', 'slider', 'spinbutton', 'meter', 'progressbar'],
      'aria-valuemin': ['scrollbar', 'separator', 'slider', 'spinbutton', 'meter', 'progressbar'],
      'aria-valuenow': ['scrollbar', 'separator', 'slider', 'spinbutton', 'meter', 'progressbar'],
      'aria-valuetext': ['scrollbar', 'separator', 'slider', 'spinbutton', 'meter', 'progressbar'],
      'aria-autocomplete': ['combobox', 'searchbox', 'textbox']
    };
    
    const elementsWithAria = Array.from(document.querySelectorAll('*'));
    
    elementsWithAria.forEach(el => {
      let role = el.getAttribute('role');
      if (!role) {
        // Native fallback mapping could go here (e.g. <input type="checkbox"> -> checkbox)
        // For simplicity, we only strictly validate against explicit roles if present.
        return;
      }
      role = role.split(/\s+/)[0].toLowerCase();
      
      let hasAria = false;
      let invalidAttr = null;
      
      for (let i = 0; i < el.attributes.length; i++) {
        const attrName = el.attributes[i].name.toLowerCase();
        if (attrName.startsWith('aria-') && !globalAria.has(attrName)) {
          hasAria = true;
          const allowedRoles = allowedMap[attrName];
          if (allowedRoles && !allowedRoles.includes(role)) {
            invalidAttr = attrName;
            break;
          }
        }
      }
      
      if (hasAria) {
        if (invalidAttr) {
          violations.push({
            html: el.outerHTML.substring(0, 100),
            target: [el.tagName.toLowerCase()],
            failureSummary: `The attribute "${invalidAttr}" is not allowed on an element with role="${role}".`
          });
        } else {
          passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
        }
      }
    });
    
    return { violations, passes, incomplete };
  }
};
