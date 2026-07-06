module.exports = {
  id: 'orientation-lock',
  type: 'dom',
  description: 'Orientation lock detected via script.',
  help: 'Avoid restricting orientation unless essential.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/orientation.html',
  tags: ['wcag134'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const scripts = Array.from(document.querySelectorAll('script'));
    let hasLockCall = false;
    scripts.forEach(s => {
      if (s.textContent && s.textContent.includes('screen.orientation.lock')) {
        hasLockCall = true;
      }
    });
    
    if (hasLockCall) {
      incomplete.push({
        html: 'N/A',
        target: ['script'],
        failureSummary: 'Inline script contains screen.orientation.lock(); verify it does not restrict view unnecessarily.'
      });
    }
    
    return { violations, passes, incomplete };
  }
};
