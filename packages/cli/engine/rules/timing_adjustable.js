module.exports = {
  id: 'timing-adjustable',
  type: 'dom',
  description: 'Time limit exists but cannot be adjusted or turned off.',
  help: 'Allow users to turn off, adjust, or extend time limits.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/timing-adjustable.html',
  tags: ['wcag221'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
    if (metaRefresh) {
      const content = metaRefresh.getAttribute('content');
      if (content) {
        const time = parseInt(content.split(';')[0], 10);
        if (!isNaN(time) && time > 0 && time < 72000) {
          violations.push({
            html: metaRefresh.outerHTML.substring(0, 100),
            target: ['meta'],
            failureSummary: `Meta refresh forces a time limit of ${time} seconds without providing a way to adjust it.`
          });
        }
      }
    } else {
      incomplete.push({
        html: 'N/A',
        target: ['document'],
        failureSummary: 'Verify manually that there are no unadjustable JS timeouts or time limits (WCAG 2.2.1).'
      });
    }
    
    return { violations, passes, incomplete };
  }
};
