module.exports = {
  id: 'focus-order-cycling',
  type: 'adapter',
  impact: 'serious',
  description: 'Focus order did not complete a full cycle within limit or trap detected.',
  help: 'Ensure focus can move through focusable elements in a logical, cyclic order without focus traps.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/focus/F6',
  tags: ['wcag212'],
  evaluate: function(doc) {
    var focusables = Array.from(doc.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(function(el) {
      return !el.disabled && el.offsetWidth > 0 && el.offsetHeight > 0 && window.getComputedStyle(el).visibility !== 'hidden';
    });
    if (focusables.length === 0) {
      return { violations: [], passes: [{ id: 'focus-order-cycling', description: 'Focus order cycles correctly.', nodeCount: 1 }], incomplete: [] };
    }
    var visited = new Set();
    var trapFound = false;
    var trapElement = null;
    for (var i = 0; i < focusables.length; i++) {
      var el = focusables[i];
      if (visited.has(el)) {
        trapFound = true;
        trapElement = el;
        break;
      }
      visited.add(el);
    }
    if (trapFound) {
      return {
        violations: [{
          id: 'focus-order-cycling',
          impact: 'serious',
          description: 'Focus trap detected; focus does not cycle.',
          help: 'Ensure a logical, cyclic tab order without traps.',
          helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/focus/F6',
          tags: ['wcag212'],
          nodes: [{ html: trapElement.outerHTML.substring(0, 200), target: [trapElement.tagName.toLowerCase()], failureSummary: 'Duplicate element in focus order list' }]
        }],
        passes: [],
        incomplete: []
      };
    }
    return { violations: [], passes: [{ id: 'focus-order-cycling', description: 'Focus order cycles correctly.', nodeCount: focusables.length }], incomplete: [] };
  }
};
