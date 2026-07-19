module.exports = {
  id: 'html-has-lang',
  type: 'dom',
  description: 'The <html> element must have a lang attribute.',
  help: 'Ensure that the page has a language assigned.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/language-of-page.html',
  tags: ['wcag311'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const htmlEl = document.documentElement;
    if (htmlEl) {
      if (htmlEl.hasAttribute('lang') && htmlEl.getAttribute('lang').trim().length > 0) {
        passes.push({ html: htmlEl.outerHTML.substring(0, 100), target: ['html'] });
      } else {
        violations.push({
          html: htmlEl.outerHTML.substring(0, 100),
          target: ['html'],
          failureSummary: 'The <html> element does not have a lang attribute.'
        });
      }
    }
    
    return { violations, passes, incomplete };
  }
};
