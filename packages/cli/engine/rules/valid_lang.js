module.exports = {
  id: 'valid-lang',
  type: 'dom',
  description: 'The lang attribute of elements must have a valid value.',
  help: 'Ensure that the language specified in the lang attribute is valid.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/language-of-parts.html',
  tags: ['wcag312'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Heuristic regex for BCP 47 language tags (e.g. en, en-US, zh-Hant)
    const validLangRegex = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]+)*$/;
    
    const elementsWithLang = Array.from(document.querySelectorAll('*[lang]'));
    
    elementsWithLang.forEach(el => {
      // We already check html element in html-lang-valid
      if (el.tagName.toLowerCase() === 'html') return;
      
      const lang = el.getAttribute('lang').trim();
      
      // Empty lang is allowed in HTML5 to signify unknown language
      if (lang === '') {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
        return;
      }
      
      if (validLangRegex.test(lang)) {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      } else {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: `The lang attribute value "${lang}" does not appear to be a valid BCP 47 language tag.`
        });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
