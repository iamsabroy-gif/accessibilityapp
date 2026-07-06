module.exports = {
  id: 'pointer-gestures',
  type: 'dom',
  description: 'Multipoint or path-based gestures may lack single-pointer alternatives.',
  help: 'Ensure multi-touch gestures have single-pointer alternatives.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/pointer-gestures.html',
  tags: ['wcag251'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const gestureEls = Array.from(document.querySelectorAll('*')).filter(el => {
      const s = window.getComputedStyle(el);
      return s.touchAction && s.touchAction !== 'auto';
    });
    
    if (gestureEls.length > 0) {
      incomplete.push({
        html: gestureEls[0].outerHTML.substring(0, 100),
        target: [gestureEls[0].tagName.toLowerCase()],
        failureSummary: 'CSS touch-action is restricted. Verify that any path-based or multipoint gestures have single-pointer alternatives.'
      });
    } else {
      passes.push({ html: 'N/A', target: ['document'] });
    }
    
    return { violations, passes, incomplete };
  }
};
