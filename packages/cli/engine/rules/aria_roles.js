module.exports = {
  id: 'aria-roles',
  type: 'dom',
  description: 'ARIA roles used must conform to valid values.',
  help: 'Elements must only use allowed ARIA roles.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
  tags: ['wcag411', 'wcag412'],
  impact: 'critical',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const validRoles = new Set([
      'alert', 'alertdialog', 'application', 'article', 'banner', 'button', 'cell',
      'checkbox', 'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition',
      'dialog', 'directory', 'document', 'feed', 'figure', 'form', 'grid', 'gridcell',
      'group', 'heading', 'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main',
      'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
      'navigation', 'none', 'note', 'option', 'presentation', 'progressbar', 'radio',
      'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search',
      'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'switch', 'tab', 'table',
      'tablist', 'tabpanel', 'term', 'textbox', 'timer', 'toolbar', 'tooltip', 'tree',
      'treegrid', 'treeitem'
    ]);
    
    const elementsWithRole = Array.from(document.querySelectorAll('*[role]'));
    
    elementsWithRole.forEach(el => {
      const roleAttr = el.getAttribute('role').trim();
      if (!roleAttr) return;
      
      const roles = roleAttr.split(/\s+/);
      let isValid = true;
      let invalidRole = '';
      
      for (const role of roles) {
        if (!validRoles.has(role.toLowerCase())) {
          isValid = false;
          invalidRole = role;
          break;
        }
      }
      
      if (isValid) {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      } else {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: `The role "${invalidRole}" is not a valid ARIA role.`
        });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
