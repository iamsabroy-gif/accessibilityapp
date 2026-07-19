module.exports = {
  id: 'meta-viewport',
  type: 'dom',
  description: 'Ensure <meta name="viewport"> does not disable text scaling and zooming.',
  help: 'Zooming and scaling must not be disabled.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/resize-text.html',
  tags: ['wcag144'],
  impact: 'critical',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const metaViewports = Array.from(document.querySelectorAll('meta[name="viewport"]'));
    
    metaViewports.forEach(meta => {
      const content = (meta.getAttribute('content') || '').toLowerCase();
      // Remove all spaces for easier parsing
      const cleanContent = content.replace(/\s+/g, '');
      
      let scalable = true;
      let maxScale = 2.0; // default safe
      
      // Parse user-scalable
      if (cleanContent.includes('user-scalable=no') || cleanContent.includes('user-scalable=0')) {
        scalable = false;
      }
      
      // Parse maximum-scale
      const maxScaleMatch = cleanContent.match(/maximum-scale=([0-9.]+)/);
      if (maxScaleMatch && maxScaleMatch[1]) {
        maxScale = parseFloat(maxScaleMatch[1]);
      }
      
      if (!scalable || maxScale < 2.0) {
        violations.push({
          html: meta.outerHTML.substring(0, 100),
          target: ['meta'],
          failureSummary: 'The viewport meta tag disables zooming (user-scalable=no) or sets maximum-scale less than 2.0.'
        });
      } else {
        passes.push({ html: meta.outerHTML.substring(0, 100), target: ['meta'] });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
