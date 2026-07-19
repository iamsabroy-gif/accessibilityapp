module.exports = {
  id: 'avoid-inline-spacing',
  type: 'dom',
  description: 'Inline text spacing must not be marked !important.',
  help: 'Ensure that inline styles for text spacing do not use !important.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/text-spacing.html',
  tags: ['wcag1412'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const elementsWithStyle = Array.from(document.querySelectorAll('*[style]'));
    
    elementsWithStyle.forEach(el => {
      const style = el.getAttribute('style').toLowerCase();
      
      // Check if they use !important on text spacing properties
      const hasImportantSpacing = (
        (style.includes('letter-spacing') && style.includes('!important')) ||
        (style.includes('word-spacing') && style.includes('!important')) ||
        (style.includes('line-height') && style.includes('!important'))
      );
      
      if (hasImportantSpacing) {
        // Double check with actual style API
        const letterSpacing = el.style.getPropertyPriority('letter-spacing');
        const wordSpacing = el.style.getPropertyPriority('word-spacing');
        const lineHeight = el.style.getPropertyPriority('line-height');
        
        if (letterSpacing === 'important' || wordSpacing === 'important' || lineHeight === 'important') {
          violations.push({
            html: el.outerHTML.substring(0, 100),
            target: [el.tagName.toLowerCase()],
            failureSummary: 'Inline style uses !important on text spacing properties (letter-spacing, word-spacing, or line-height).'
          });
          return;
        }
      }
      
      passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
    });
    
    return { violations, passes, incomplete };
  }
};
