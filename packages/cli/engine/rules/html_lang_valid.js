module.exports = {
  id: 'html-lang-valid',
  type: 'dom',
  description: 'The lang attribute of the <html> element must have a valid value.',
  help: 'Ensure that the language specified in the lang attribute is valid.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/language-of-page.html',
  tags: ['wcag311'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Heuristic regex for BCP 47 language tags (e.g. en, en-US, zh-Hant)
    const validLangRegex = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]+)*$/;
    
    const htmlEl = document.documentElement;
    if (htmlEl && htmlEl.hasAttribute('lang')) {
      const lang = htmlEl.getAttribute('lang').trim();
      if (lang === '') {
        // Handled by html-has-lang
        return { violations, passes, incomplete };
      }
      
      if (validLangRegex.test(lang)) {
        passes.push({ html: htmlEl.outerHTML.substring(0, 100), target: ['html'] });
      } else {
        violations.push({
          html: htmlEl.outerHTML.substring(0, 100),
          target: ['html'],
          failureSummary: `The lang attribute value "${lang}" does not appear to be a valid BCP 47 language tag.`
        });
      }
    }
    
    return { violations, passes, incomplete };
  }
};
