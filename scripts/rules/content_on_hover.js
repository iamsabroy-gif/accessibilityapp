module.exports = {
  id: 'content-on-hover',
  type: 'puppeteer',

  evaluate: async function(page) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const elements = await page.$$('a[href], button, [role="button"], [role="menuitem"], .tooltip-trigger');
    if (elements.length > 0) {
      for (let i = 0; i < Math.min(elements.length, 3); i++) {
        const el = elements[i];
        try {
          const beforeContent = await page.evaluate(() => document.body.innerText.length);
          await el.hover();
          await new Promise(r => setTimeout(r, 200));
          const afterContent = await page.evaluate(() => document.body.innerText.length);
          
          if (afterContent > beforeContent) {
            const nodeHTML = await page.evaluate(e => e.outerHTML.substring(0, 100), el);
            incomplete.push({
              id: 'content-on-hover',
              description: 'Hovering triggered new content.',
              html: nodeHTML,
              target: [],
              failureSummary: 'Hovering triggered new content. Verify it is dismissable, hoverable, and persistent.'
            });
          }
        } catch(e) { }
      }
    }
    
    return { violations, passes, incomplete };
  }
};
