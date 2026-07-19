module.exports = {
  id: 'document-title',
  type: 'dom',
  description: 'Documents must have a title element.',
  help: 'Ensure the document has a <title> element that is not empty.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/page-titled.html',
  tags: ['wcag242'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const titleEl = document.querySelector('title');
    
    if (titleEl && titleEl.textContent.trim().length > 0) {
      passes.push({ html: titleEl.outerHTML.substring(0, 100), target: ['title'] });
    } else {
      violations.push({
        html: 'N/A',
        target: ['html'],
        failureSummary: 'The document does not have a <title> element or the title is empty.'
      });
    }
    
    return { violations, passes, incomplete };
  }
};
