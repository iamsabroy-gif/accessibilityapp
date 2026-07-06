module.exports = {
  id: 'focus-not-obscured',
  type: 'puppeteer',
  description: 'When a UI component receives keyboard focus, it must not be entirely hidden by sticky or fixed-position author-created content.',
  help: 'Ensure focused components are not fully obscured by sticky headers, cookie banners, or other fixed overlays.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html',
  tags: ['wcag22aa', 'wcag2411'],
  impact: 'serious',

  evaluate: async function(page) {
    var violations = [];
    var passes = [];
    var incomplete = [];

    var MAX_TABS = 20;

    await page.focus('body');

    for (var i = 0; i < MAX_TABS; i++) {
      await page.keyboard.press('Tab');

      var result = await page.evaluate(function() {
        var el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) {
          return null;
        }

        var elRect = el.getBoundingClientRect();
        if (elRect.width === 0 || elRect.height === 0) return { skip: true };

        // Collect fixed/sticky overlays with positive z-index
        var allEls = Array.from(document.querySelectorAll('*'));
        var overlays = allEls.filter(function(candidate) {
          if (candidate === el) return false;
          if (candidate.contains(el)) return false; // ancestor
          if (el.contains(candidate)) return false;  // descendant
          var s = window.getComputedStyle(candidate);
          if (s.position !== 'fixed' && s.position !== 'sticky') return false;
          var z = parseInt(s.zIndex, 10);
          if (isNaN(z) || z <= 0) return false;
          var r = candidate.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          return true;
        });

        var fullyObscured = overlays.some(function(ov) {
          var r = ov.getBoundingClientRect();
          return r.left <= elRect.left &&
                 r.right >= elRect.right &&
                 r.top <= elRect.top &&
                 r.bottom >= elRect.bottom;
        });

        var partiallyObscured = !fullyObscured && overlays.some(function(ov) {
          var r = ov.getBoundingClientRect();
          // Rectangles overlap when no axis is fully separated
          return !(r.right <= elRect.left ||
                   r.left >= elRect.right ||
                   r.bottom <= elRect.top ||
                   r.top >= elRect.bottom);
        });

        return {
          html: el.outerHTML.substring(0, 120),
          tag: el.tagName.toLowerCase(),
          fullyObscured: fullyObscured,
          partiallyObscured: partiallyObscured,
          skip: false
        };
      });

      if (!result || result.skip) continue;

      if (result.fullyObscured) {
        violations.push({
          id: 'focus-not-obscured',
          impact: 'serious',
          description: 'Focused element is entirely hidden by a fixed or sticky overlay.',
          help: 'Ensure the focused component is not fully covered by position:fixed or position:sticky content.',
          helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html',
          tags: ['wcag22aa', 'wcag2411'],
          nodes: [{
            html: result.html,
            target: [result.tag],
            failureSummary: 'Element is completely hidden by a position:fixed or position:sticky element with z-index > 0 when it receives keyboard focus.'
          }]
        });
      } else if (result.partiallyObscured) {
        incomplete.push({
          id: 'focus-not-obscured',
          description: 'Focused element is partially covered by a fixed/sticky overlay. WCAG 2.4.11 requires only that it is not entirely hidden — partial obscuring is a WCAG 2.4.12 (AAA) concern.',
          nodeCount: 1
        });
      } else {
        passes.push({
          id: 'focus-not-obscured',
          description: 'Focused element is not obscured by any fixed or sticky overlay.',
          nodeCount: 1
        });
      }
    }

    return { violations: violations, passes: passes, incomplete: incomplete };
  }
};
