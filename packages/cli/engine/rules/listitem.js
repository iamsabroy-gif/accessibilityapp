module.exports = {
  id: 'listitem',
  type: 'dom',
  description: 'List items must be contained within lists.',
  help: 'Ensure that list items are contained within appropriate lists.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html',
  tags: ['wcag131'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const items = Array.from(document.querySelectorAll('li, dt, dd, *[role="listitem"]'));
    
    items.forEach(item => {
      const tag = item.tagName.toLowerCase();
      const role = item.getAttribute('role');
      
      let isValid = false;
      let parent = item.parentElement;
      
      if (tag === 'li' || role === 'listitem') {
        while (parent && parent.tagName.toLowerCase() !== 'body') {
          const ptag = parent.tagName.toLowerCase();
          const prole = parent.getAttribute('role');
          if (ptag === 'ul' || ptag === 'ol' || prole === 'list') {
            isValid = true;
            break;
          }
          parent = parent.parentElement;
        }
      } else if (tag === 'dt' || tag === 'dd') {
        while (parent && parent.tagName.toLowerCase() !== 'body') {
          if (parent.tagName.toLowerCase() === 'dl') {
            isValid = true;
            break;
          }
          parent = parent.parentElement;
        }
      }
      
      if (isValid) {
        passes.push({ html: item.outerHTML.substring(0, 100), target: [tag] });
      } else {
        violations.push({
          html: item.outerHTML.substring(0, 100),
          target: [tag],
          failureSummary: 'List item is not contained within an appropriate list element (ul, ol, or dl).'
        });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
