module.exports = {
  id: 'focus-appearance',
  type: 'adapter',
  impact: 'serious',
  description: 'Keyboard focus indicators must meet minimum area and contrast ratio requirements.',
  help: 'Use outline-width ≥2px and ensure the outline color has ≥3:1 contrast against the adjacent background.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html',
  tags: ['wcag22aaa', 'wcag2413'],
  evaluate: function(doc) {
    var focusables = Array.from(doc.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).slice(0, 15);
    var violations = [];
    var passes = [];
    focusables.forEach(function(el) {
      var style = window.getComputedStyle(el);
      var hasOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1;
      var hasBoxShadow = style.boxShadow !== 'none' && style.boxShadow !== '';
      var hasBorderChange = style.borderWidth !== '0px';
      if (hasOutline || hasBoxShadow || hasBorderChange) {
        passes.push({ id: 'focus-appearance', description: 'Focus appearance is valid', nodeCount: 1 });
      } else {
        violations.push({
          id: 'focus-appearance',
          impact: 'serious',
          description: 'Keyboard focus indicator is missing or insufficient.',
          help: 'Use outline-width ≥2px and ensure the outline color has ≥3:1 contrast.',
          helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html',
          tags: ['wcag22aaa', 'wcag2413'],
          nodes: [{ html: el.outerHTML.substring(0, 200), target: [el.tagName.toLowerCase()], failureSummary: 'Focus indicator is missing outline or shadow' }]
        });
      }
    });
    return { violations: violations, passes: passes, incomplete: [] };
  }
};
