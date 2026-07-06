module.exports = {
  id: 'focus-order-cycling',
  type: 'puppeteer',

  evaluate: async function(page) {
    const maxPresses = 50;
    const visited = new Set();
    let firstKey = null;
    
    // Ensure starting focus on body
    await page.focus('body');
    
    for (let i = 0; i < maxPresses; i++) {
      await page.keyboard.press('Tab');
      const elInfo = await page.evaluate(() => {
        const el = document.activeElement;
        return { html: el.outerHTML, tag: el.tagName.toLowerCase() };
      });
      
      const key = elInfo.html;
      if (!firstKey) firstKey = key;
      
      // Cycle detected – focus returned to start after at least one press
      if (key === firstKey && visited.size > 0) {
        return { violations: [], passes: [{ id: 'focus-order-cycling', description: 'Focus order cycles correctly.', nodeCount: 1 }], incomplete: [] };
      }
      
      if (visited.has(key)) {
        const node = { html: elInfo.html, target: [elInfo.tag], failureSummary: '' };
        return {
          violations: [{
            id: 'focus-order-cycling',
            impact: 'serious',
            description: 'Focus trap detected; focus does not cycle.',
            help: 'Ensure a logical, cyclic tab order without traps.',
            helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/focus/F6',
            tags: ['wcag212'],
            nodes: [node]
          }],
          passes: [],
          incomplete: []
        };
      }
      visited.add(key);
    }
    
    // No cycle within limit – report violation
    return {
      violations: [{
        id: 'focus-order-cycling',
        impact: 'serious',
        description: 'Focus order did not complete a full cycle within limit.',
        help: 'Ensure focus can move through all focusable elements and return to start.',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/focus/F6',
        tags: ['wcag212'],
        nodes: []
      }],
      passes: [],
      incomplete: []
    };
  }
};
