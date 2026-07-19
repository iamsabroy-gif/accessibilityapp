module.exports = {
  id: 'bypass',
  type: 'dom',
  description: 'Page must have means to bypass repeated blocks.',
  help: 'Ensure each page has at least one mechanism to bypass navigation and jump straight to the content.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/bypass-blocks.html',
  tags: ['wcag241'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Heuristics for bypass blocks:
    // 1. Has a main landmark
    // 2. Has an h1
    // 3. Has a skip link at the top
    
    const hasMain = document.querySelector('main, *[role="main"]') !== null;
    const hasH1 = document.querySelector('h1, *[role="heading"][aria-level="1"]') !== null;
    
    // Skip link heuristic: an internal anchor link early in the DOM
    let hasSkipLink = false;
    const firstLinks = Array.from(document.querySelectorAll('a[href]')).slice(0, 5);
    for (const link of firstLinks) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('#') && href.length > 1) {
        // Verify the target exists
        if (document.getElementById(href.substring(1))) {
          hasSkipLink = true;
          break;
        }
      }
    }
    
    if (hasMain || hasH1 || hasSkipLink) {
      passes.push({ html: 'N/A', target: ['html'] });
    } else {
      violations.push({
        html: 'N/A',
        target: ['html'],
        failureSummary: 'Page does not have a means to bypass repeated blocks (no <main>, no <h1>, no valid skip link).'
      });
    }
    
    return { violations, passes, incomplete };
  }
};
