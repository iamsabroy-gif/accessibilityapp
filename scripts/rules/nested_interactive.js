module.exports = {
  id: 'nested-interactive',
  type: 'dom',
  description: 'Interactive controls must not be nested.',
  help: 'Ensure interactive controls are not nested as they are not always announced by screen readers.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
  tags: ['wcag412'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Selectors for interactive elements
    const interactiveSelectors = [
      'a[href]', 'button', 'input', 'select', 'textarea',
      '*[role="button"]', '*[role="link"]', '*[role="checkbox"]', '*[role="menuitem"]',
      '*[role="menuitemcheckbox"]', '*[role="menuitemradio"]', '*[role="option"]',
      '*[role="radio"]', '*[role="searchbox"]', '*[role="slider"]', '*[role="spinbutton"]',
      '*[role="switch"]', '*[role="textbox"]', '*[tabindex]:not([tabindex="-1"])'
    ].join(', ');
    
    const elements = Array.from(document.querySelectorAll(interactiveSelectors));
    
    elements.forEach(el => {
      // Check if any descendant is also an interactive element
      const nested = Array.from(el.querySelectorAll(interactiveSelectors));
      
      // Filter out self or weird pseudo-matches
      const actualNested = nested.filter(n => n !== el);
      
      if (actualNested.length > 0) {
        // Nested interactive element found
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: `Interactive element contains another interactive element (${actualNested[0].tagName.toLowerCase()}).`
        });
      } else {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
