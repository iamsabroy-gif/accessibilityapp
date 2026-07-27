module.exports = {
  id: 'focus-visible',
  type: 'adapter',
  impact: 'serious',
  description: 'Any keyboard-operable user interface has a mode of operation where the keyboard focus indicator is visible.',
  help: 'Ensure focusable elements have visible outline or shadow when focused.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/css/C15',
  tags: ['wcag2aa', 'wcag247'],
  evaluate: function(doc) {
    var focusables = Array.from(doc.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).slice(0, 10);
    var violations = [];
    var passes = [];
    focusables.forEach(function(el) {
      var style = window.getComputedStyle(el);
      if (style.outlineStyle === 'none' && (style.boxShadow === 'none' || style.boxShadow === '')) {
        violations.push({
          id: 'focus-visible',
          impact: 'serious',
          description: 'Focus indicator is hidden or suppressed via CSS.',
          help: 'Do not set outline: none without providing an alternative focus indicator.',
          helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/css/C15',
          tags: ['wcag2aa', 'wcag247'],
          nodes: [{ html: el.outerHTML.substring(0, 200), target: [el.tagName.toLowerCase()], failureSummary: 'Element has outline-style none and no box-shadow.' }]
        });
      } else {
        passes.push({ id: 'focus-visible', description: 'Visible focus indicator detected.', nodeCount: 1 });
      }
    });
    return { violations: violations, passes: passes, incomplete: [] };
  }
};
