module.exports = {
  id: 'focus-not-obscured',
  type: 'adapter',
  impact: 'serious',
  description: 'When a UI component receives keyboard focus, it must not be entirely hidden by sticky or fixed-position author-created content.',
  help: 'Ensure focused components are not fully obscured by sticky headers, cookie banners, or other fixed overlays.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html',
  tags: ['wcag22aa', 'wcag2411'],
  evaluate: function(doc) {
    var fixedElements = Array.from(doc.querySelectorAll('*')).filter(function(el) {
      var s = window.getComputedStyle(el);
      return (s.position === 'fixed' || s.position === 'sticky') && el.offsetWidth > 0 && el.offsetHeight > 0;
    });
    var focusables = Array.from(doc.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).slice(0, 20);
    var violations = [];
    var passes = [];
    focusables.forEach(function(el) {
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      var isObscured = fixedElements.some(function(fix) {
        if (fix === el || fix.contains(el)) return false;
        var fRect = fix.getBoundingClientRect();
        return (rect.left >= fRect.left && rect.right <= fRect.right && rect.top >= fRect.top && rect.bottom <= fRect.bottom);
      });
      if (isObscured) {
        violations.push({
          id: 'focus-not-obscured',
          impact: 'serious',
          description: 'Focused element is fully obscured by sticky or fixed element.',
          help: 'Ensure focused components are not fully obscured.',
          helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html',
          tags: ['wcag22aa', 'wcag2411'],
          nodes: [{ html: el.outerHTML.substring(0, 200), target: [el.tagName.toLowerCase()], failureSummary: 'Focused component is fully obscured.' }]
        });
      } else {
        passes.push({ id: 'focus-not-obscured', description: 'Focused element is not obscured.', nodeCount: 1 });
      }
    });
    return { violations: violations, passes: passes, incomplete: [] };
  }
};
