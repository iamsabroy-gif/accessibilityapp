module.exports = {
  id: 'multiple-ways',
  type: 'dom',
  description: 'Multiple ways to find a web page are missing.',
  help: 'Provide multiple ways to find pages (e.g., search, sitemap).',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/multiple-ways.html',
  tags: ['wcag245'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const searchInputs = Array.from(document.querySelectorAll('input[type="search"], input[name*="search"], input[id*="search"]'));
    const sitemapLinks = Array.from(document.querySelectorAll('a')).filter(a => /sitemap/i.test(a.textContent || a.href));
    
    if (searchInputs.length === 0 && sitemapLinks.length === 0) {
      incomplete.push({
        html: 'N/A',
        target: ['document'],
        failureSummary: 'Could not find a search feature or sitemap. Verify manually that multiple ways exist to find pages (e.g. navigation menus AND search).'
      });
    } else {
      passes.push({ html: 'N/A', target: ['document'] });
    }
    
    return { violations, passes, incomplete };
  }
};
