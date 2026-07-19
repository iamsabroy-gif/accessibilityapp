module.exports = {
  id: 'aria-valid-attr',
  type: 'dom',
  description: 'ARIA attributes must conform to valid names.',
  help: 'Ensure all aria-* attributes are valid.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
  tags: ['wcag411', 'wcag412'],
  impact: 'critical',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const validAriaAttrs = new Set([
      'aria-activedescendant', 'aria-atomic', 'aria-autocomplete', 'aria-busy', 'aria-checked',
      'aria-colcount', 'aria-colindex', 'aria-colspan', 'aria-controls', 'aria-current',
      'aria-describedby', 'aria-details', 'aria-disabled', 'aria-dropeffect', 'aria-errormessage',
      'aria-expanded', 'aria-flowto', 'aria-grabbed', 'aria-haspopup', 'aria-hidden', 'aria-invalid',
      'aria-keyshortcuts', 'aria-label', 'aria-labelledby', 'aria-level', 'aria-live', 'aria-modal',
      'aria-multiline', 'aria-multiselectable', 'aria-orientation', 'aria-owns', 'aria-placeholder',
      'aria-posinset', 'aria-pressed', 'aria-readonly', 'aria-relevant', 'aria-required',
      'aria-roledescription', 'aria-rowcount', 'aria-rowindex', 'aria-rowspan', 'aria-selected',
      'aria-setsize', 'aria-sort', 'aria-valuemax', 'aria-valuemin', 'aria-valuenow', 'aria-valuetext'
    ]);
    
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null, false);
    let el;
    while ((el = walker.nextNode())) {
      let hasAria = false;
      let invalidAttr = null;
      
      for (let i = 0; i < el.attributes.length; i++) {
        const attrName = el.attributes[i].name.toLowerCase();
        if (attrName.startsWith('aria-')) {
          hasAria = true;
          if (!validAriaAttrs.has(attrName)) {
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
            failureSummary: `The attribute "${invalidAttr}" is not a valid ARIA attribute.`
          });
        } else {
          passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
        }
      }
    }
    
    return { violations, passes, incomplete };
  }
};
