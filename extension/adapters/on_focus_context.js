module.exports = {
  id: 'on-focus-context-change',
  type: 'adapter',
  impact: 'serious',
  description: 'Context changed (e.g. navigation/form submit) immediately on focus.',
  help: 'Do not initiate context changes solely on focus.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/general/G107',
  tags: ['wcag321'],
  evaluate: function(doc) {
    var inputs = Array.from(doc.querySelectorAll('input, select, textarea, button, a[href]')).slice(0, 5);
    var violations = [];
    var passes = [];
    inputs.forEach(function(el) {
      var onfocus = el.getAttribute('onfocus');
      if (onfocus && (onfocus.includes('location') || onfocus.includes('submit()') || onfocus.includes('navigate'))) {
        violations.push({
          id: 'on-focus-context-change',
          impact: 'serious',
          description: 'Inline onfocus handler triggers context change.',
          help: 'Do not initiate context changes solely on focus.',
          helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/general/G107',
          tags: ['wcag321'],
          nodes: [{ html: el.outerHTML.substring(0, 200), target: [el.tagName.toLowerCase()], failureSummary: 'Inline onfocus attribute contains redirect/submit.' }]
        });
      } else {
        passes.push({ id: 'on-focus-context-change', description: 'Focus does not cause context change.', nodeCount: 1 });
      }
    });
    return { violations: violations, passes: passes, incomplete: [] };
  }
};
