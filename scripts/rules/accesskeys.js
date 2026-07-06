module.exports = {
  id: 'accesskeys',
  type: 'dom',
  description: 'Every accesskey attribute value must be unique.',
  help: 'Ensure that accesskey attribute values are unique.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/keyboard.html',
  tags: ['wcag211', 'best-practice'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const elementsWithAccessKey = Array.from(document.querySelectorAll('*[accesskey]'));
    const keyMap = {};
    
    elementsWithAccessKey.forEach(el => {
      const keys = el.getAttribute('accesskey').trim().toLowerCase().split(/\s+/);
      keys.forEach(k => {
        if (!keyMap[k]) keyMap[k] = [];
        keyMap[k].push(el);
      });
    });
    
    elementsWithAccessKey.forEach(el => {
      const keys = el.getAttribute('accesskey').trim().toLowerCase().split(/\s+/);
      let isDuplicate = false;
      let dupKey = null;
      
      for (const k of keys) {
        if (keyMap[k].length > 1) {
          isDuplicate = true;
          dupKey = k;
          break;
        }
      }
      
      if (isDuplicate) {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: `The accesskey "${dupKey}" is not unique on the page.`
        });
      } else {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
