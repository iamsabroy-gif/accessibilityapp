module.exports = {
  id: 'on-focus-context-change',
  type: 'puppeteer',

  evaluate: async function(page) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const inputs = await page.$$('input, select, textarea, button, a[href]');
    if (inputs.length > 0) {
      for (let i = 0; i < Math.min(inputs.length, 5); i++) {
        const el = inputs[i];
        try {
          const beforeURL = page.url();
          await el.focus();
          await new Promise(r => setTimeout(r, 100)); // wait for potential JS redirect
          const afterURL = page.url();
          if (beforeURL !== afterURL) {
            const nodeHTML = await page.evaluate(e => e.outerHTML.substring(0, 100), el);
            violations.push({
              id: 'on-focus-context-change',
              impact: 'serious',
              description: 'Context changed (e.g. navigation) immediately on focus.',
              help: 'Do not initiate context changes solely on focus.',
              helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/general/G107',
              tags: ['wcag321'],
              nodes: [{ html: nodeHTML, target: [], failureSummary: 'URL changed on focus.' }]
            });
          } else {
            passes.push({ id: 'on-focus-context-change', description: 'No context change on focus.', nodeCount: 1 });
          }
        } catch (e) {
          // Element might not be focusable
        }
      }
    } else {
      passes.push({ id: 'on-focus-context-change', description: 'No focusable elements.', nodeCount: 0 });
    }
    
    return { violations, passes, incomplete };
  }
};
