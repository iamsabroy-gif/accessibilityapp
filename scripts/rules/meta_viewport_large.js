module.exports = {
  id: 'meta-viewport-large',
  type: 'dom',
  description: 'Ensure <meta name="viewport"> can scale a significant amount.',
  help: 'Users should be able to zoom and scale the text up to 500%.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/reflow.html',
  tags: ['wcag1410'],
  impact: 'minor',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const metaViewports = Array.from(document.querySelectorAll('meta[name="viewport"]'));
    
    metaViewports.forEach(meta => {
      const content = (meta.getAttribute('content') || '').toLowerCase();
      const cleanContent = content.replace(/\s+/g, '');
      
      let scalable = true;
      let maxScale = 5.0; // default safe
      
      if (cleanContent.includes('user-scalable=no') || cleanContent.includes('user-scalable=0')) {
        scalable = false;
      }
      
      const maxScaleMatch = cleanContent.match(/maximum-scale=([0-9.]+)/);
      if (maxScaleMatch && maxScaleMatch[1]) {
        maxScale = parseFloat(maxScaleMatch[1]);
      }
      
      if (!scalable || maxScale < 5.0) {
        violations.push({
          html: meta.outerHTML.substring(0, 100),
          target: ['meta'],
          failureSummary: `The viewport restricts zooming (user-scalable=${scalable ? 'yes' : 'no'}, maximum-scale=${maxScale}). Should be at least 5.`
        });
      } else {
        passes.push({ html: meta.outerHTML.substring(0, 100), target: ['meta'] });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
