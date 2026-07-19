module.exports = {
  id: 'non-text-contrast',
  type: 'dom',
  description: 'UI component lacks a distinct border; verify 3:1 contrast ratio manually.',
  help: 'Ensure UI components have a 3:1 contrast ratio against adjacent colors.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html',
  tags: ['wcag1411'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    const uis = Array.from(document.querySelectorAll('input, button, select, textarea, [role="button"], [role="checkbox"], [role="switch"]'));
    
    uis.forEach(el => {
      const style = window.getComputedStyle(el);
      const borderStyle = style.borderStyle;
      const borderWidth = parseFloat(style.borderWidth) || 0;
      const bgColor = style.backgroundColor;
      const borderColor = style.borderColor;
      
      if (borderStyle !== 'none' && borderWidth > 0 && borderColor !== bgColor && borderColor !== 'rgba(0, 0, 0, 0)' && borderColor !== 'transparent') {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      } else {
        incomplete.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: 'UI component lacks a distinct border; verify 3:1 contrast ratio manually against adjacent background.'
        });
      }
    });

    return { violations, passes, incomplete };
  }
};
