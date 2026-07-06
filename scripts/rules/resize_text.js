module.exports = {
  id: 'resize-text',
  type: 'dom',
  description: 'Horizontal scrolling appears when text is resized to 200%.',
  help: 'Ensure layout accommodates 200% text resize without loss of content or function.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/resize-text.html',
  tags: ['wcag144'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const originalSize = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = '200%';
    // Check if horizontal scrollbar appears (indicates layout break)
    const hasHScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth;
    // Restore
    document.documentElement.style.fontSize = originalSize;
    
    if (hasHScroll) {
      violations.push({
        html: 'N/A',
        target: ['html'],
        failureSummary: 'Horizontal scroll detected at 200%.'
      });
    } else {
      passes.push({ html: 'N/A', target: ['html'] });
    }
    
    return { violations, passes, incomplete };
  }
};
