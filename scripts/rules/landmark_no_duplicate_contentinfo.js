module.exports = {
  id: 'landmark-no-duplicate-contentinfo',
  type: 'dom',
  description: 'Document must not have more than one contentinfo landmark.',
  help: 'Ensure the page has at most one contentinfo landmark.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html',
  tags: ['wcag131'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const contentinfos = Array.from(document.querySelectorAll('*[role="contentinfo"], footer')).filter(el => {
      let isTrueContentInfo = el.getAttribute('role') === 'contentinfo';
      if (!isTrueContentInfo && el.tagName.toLowerCase() === 'footer') {
        let p = el.parentElement;
        let scoped = false;
        while (p && p.tagName.toLowerCase() !== 'body') {
          if (['article', 'aside', 'main', 'nav', 'section'].includes(p.tagName.toLowerCase())) {
            scoped = true;
            break;
          }
          p = p.parentElement;
        }
        if (!scoped) isTrueContentInfo = true;
      }
      return isTrueContentInfo;
    });
    
    if (contentinfos.length > 1) {
      contentinfos.forEach(el => {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: `Document has multiple (${contentinfos.length}) contentinfo landmarks.`
        });
      });
    } else if (contentinfos.length === 1) {
      passes.push({ html: contentinfos[0].outerHTML.substring(0, 100), target: [contentinfos[0].tagName.toLowerCase()] });
    }
    
    return { violations, passes, incomplete };
  }
};
