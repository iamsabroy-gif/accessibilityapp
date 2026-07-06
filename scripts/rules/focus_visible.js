module.exports = {
  id: 'focus-visible',
  type: 'puppeteer',

  evaluate: async function(page) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    await page.focus('body');
    await page.keyboard.press('Tab');
    
    const check = await page.evaluate(() => {
      const el = document.activeElement;
      if (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        if (style.outlineStyle === 'none' && style.boxShadow === 'none') {
          return { fail: true, html: el.outerHTML, tag: el.tagName.toLowerCase() };
        }
        return { fail: false, html: el.outerHTML, tag: el.tagName.toLowerCase() };
      }
      return null;
    });
    
    if (check) {
      if (check.fail) {
        violations.push({
          id: 'focus-visible',
          impact: 'serious',
          description: 'Focused element has outline: none without fallback.',
          help: 'Provide a visible focus indicator.',
          helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/general/G195',
          tags: ['wcag247'],
          nodes: [{ html: check.html, target: [check.tag], failureSummary: '' }]
        });
      } else {
        passes.push({ id: 'focus-visible', description: 'Focus is visible.', nodeCount: 1 });
      }
    }
    
    return { violations, passes, incomplete };
  }
};
