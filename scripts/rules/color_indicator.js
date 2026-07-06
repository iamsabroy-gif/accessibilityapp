module.exports = {
  id: 'color-only-indicator',
  type: 'dom',
  description: 'Element may rely solely on color to convey state.',
  help: 'Provide semantic state (e.g., aria-current) or a secondary visual indicator.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html',
  tags: ['wcag141'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    const candidates = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [aria-current], [aria-selected], .active, .selected, .current, [class*="active"], [class*="selected"], [class*="current"]'));
    
    candidates.forEach(el => {
      // Simplify: if an element has state attributes (like aria-current or aria-selected)
      // we consider it a pass because state is semantically exposed.
      if (el.hasAttribute('aria-current') || el.hasAttribute('aria-selected')) {
        passes.push({ html: el.outerHTML.substring(0,100), target: [el.tagName.toLowerCase()] });
      } else {
        // If it has class-based state but lacks semantic state, it's a potential violation.
        const classes = el.className;
        if (typeof classes === 'string' && (classes.includes('active') || classes.includes('selected') || classes.includes('current'))) {
          violations.push({
            html: el.outerHTML.substring(0,100),
            target: [el.tagName.toLowerCase()],
            failureSummary: 'Element has a state class ("active", "selected", etc.) but lacks semantic state (e.g. aria-current).'
          });
        }
      }
    });

    return { violations, passes, incomplete };
  }
};
