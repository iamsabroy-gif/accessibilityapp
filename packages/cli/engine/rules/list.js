module.exports = {
  id: 'list',
  type: 'dom',
  description: 'Lists must be structured properly.',
  help: 'Ensure that lists are structured correctly.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html',
  tags: ['wcag131'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const lists = Array.from(document.querySelectorAll('ul, ol, dl, *[role="list"]'));
    
    lists.forEach(list => {
      const tag = list.tagName.toLowerCase();
      const role = list.getAttribute('role');
      let isValid = true;
      
      const children = Array.from(list.children);
      
      if (tag === 'ul' || tag === 'ol' || role === 'list') {
        // Only allow li, script, template
        for (const child of children) {
          const ctag = child.tagName.toLowerCase();
          if (ctag !== 'li' && ctag !== 'script' && ctag !== 'template' && child.getAttribute('role') !== 'listitem') {
            isValid = false;
            break;
          }
        }
      } else if (tag === 'dl') {
        // Allow dt, dd, div (which can contain dt/dd), script, template
        for (const child of children) {
          const ctag = child.tagName.toLowerCase();
          if (ctag !== 'dt' && ctag !== 'dd' && ctag !== 'div' && ctag !== 'script' && ctag !== 'template') {
            isValid = false;
            break;
          }
        }
      }
      
      if (isValid) {
        passes.push({ html: list.outerHTML.substring(0, 100), target: [tag] });
      } else {
        violations.push({
          html: list.outerHTML.substring(0, 100),
          target: [tag],
          failureSummary: 'List element contains invalid children. UL/OL should only contain LI; DL should only contain DT/DD/DIV.'
        });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
