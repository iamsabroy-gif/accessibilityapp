module.exports = {
  id: 'aria-valid-attr-value',
  type: 'dom',
  description: 'ARIA attributes must have valid values.',
  help: 'Ensure all aria-* attributes have valid values.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
  tags: ['wcag411', 'wcag412'],
  impact: 'critical',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const ariaTypes = {
      'aria-atomic': 'boolean',
      'aria-busy': 'boolean',
      'aria-controls': 'idlist',
      'aria-current': ['page', 'step', 'location', 'date', 'time', 'true', 'false'],
      'aria-describedby': 'idlist',
      'aria-details': 'id',
      'aria-disabled': 'boolean',
      'aria-dropeffect': ['copy', 'execute', 'link', 'move', 'none', 'popup'],
      'aria-errormessage': 'id',
      'aria-expanded': ['true', 'false', 'undefined'],
      'aria-flowto': 'idlist',
      'aria-grabbed': ['true', 'false', 'undefined'],
      'aria-haspopup': ['false', 'true', 'menu', 'listbox', 'tree', 'grid', 'dialog'],
      'aria-hidden': ['true', 'false', 'undefined'],
      'aria-invalid': ['grammar', 'false', 'spelling', 'true'],
      'aria-keyshortcuts': 'string',
      'aria-label': 'string',
      'aria-labelledby': 'idlist',
      'aria-live': ['assertive', 'off', 'polite'],
      'aria-modal': 'boolean',
      'aria-multiline': 'boolean',
      'aria-multiselectable': 'boolean',
      'aria-orientation': ['horizontal', 'undefined', 'vertical'],
      'aria-owns': 'idlist',
      'aria-placeholder': 'string',
      'aria-pressed': ['true', 'false', 'mixed', 'undefined'],
      'aria-readonly': 'boolean',
      'aria-relevant': 'tokenlist', // additions, all, removals, text
      'aria-required': 'boolean',
      'aria-roledescription': 'string',
      'aria-selected': ['true', 'false', 'undefined'],
      'aria-sort': ['ascending', 'descending', 'none', 'other'],
      'aria-checked': ['true', 'false', 'mixed', 'undefined'],
      'aria-colcount': 'integer',
      'aria-colindex': 'integer',
      'aria-colspan': 'integer',
      'aria-level': 'integer',
      'aria-posinset': 'integer',
      'aria-rowcount': 'integer',
      'aria-rowindex': 'integer',
      'aria-rowspan': 'integer',
      'aria-setsize': 'integer',
      'aria-valuemax': 'number',
      'aria-valuemin': 'number',
      'aria-valuenow': 'number',
      'aria-valuetext': 'string',
      'aria-autocomplete': ['inline', 'list', 'both', 'none']
    };
    
    function isValid(attr, value) {
      const type = ariaTypes[attr];
      if (!type) return true; // unknown attr, let aria-valid-attr handle it
      
      const val = value.trim().toLowerCase();
      
      if (Array.isArray(type)) {
        return type.includes(val);
      }
      if (type === 'boolean') {
        return val === 'true' || val === 'false';
      }
      if (type === 'integer') {
        return /^[+-]?\d+$/.test(val);
      }
      if (type === 'number') {
        return /^[+-]?\d+(\.\d+)?$/.test(val);
      }
      // id, idlist, string, tokenlist - hard to strictly validate globally without context, 
      // but we can check if they are not empty when they shouldn't be.
      if (type === 'id' || type === 'idlist' || type === 'string') {
        return value.trim() !== '';
      }
      return true;
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null, false);
    let el;
    while ((el = walker.nextNode())) {
      let hasAria = false;
      let invalidAttr = null;
      let invalidVal = null;
      
      for (let i = 0; i < el.attributes.length; i++) {
        const attrName = el.attributes[i].name.toLowerCase();
        if (attrName.startsWith('aria-')) {
          hasAria = true;
          const val = el.attributes[i].value;
          if (!isValid(attrName, val)) {
            invalidAttr = attrName;
            invalidVal = val;
            break;
          }
        }
      }
      
      if (hasAria) {
        if (invalidAttr) {
          violations.push({
            html: el.outerHTML.substring(0, 100),
            target: [el.tagName.toLowerCase()],
            failureSummary: `The attribute "${invalidAttr}" has an invalid value "${invalidVal}".`
          });
        } else {
          passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
        }
      }
    }
    
    return { violations, passes, incomplete };
  }
};
