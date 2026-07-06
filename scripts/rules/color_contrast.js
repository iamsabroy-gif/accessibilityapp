module.exports = {
  id: 'color-contrast',
  type: 'dom',
  description: 'Elements must have sufficient color contrast.',
  help: 'Ensure text has a contrast ratio of at least 4.5:1 (or 3:1 for large text).',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html',
  tags: ['wcag143'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Helper to parse rgb(a) strings
    function parseColor(colorStr) {
      const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return null;
      return {
        r: parseInt(match[1], 10),
        g: parseInt(match[2], 10),
        b: parseInt(match[3], 10),
        a: match[4] ? parseFloat(match[4]) : 1
      };
    }

    function getLuminance(r, g, b) {
      const a = [r, g, b].map(function (v) {
        v /= 255;
        return v <= 0.03928
          ? v / 12.92
          : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
    }

    function getContrast(l1, l2) {
      const lightest = Math.max(l1, l2);
      const darkest = Math.min(l1, l2);
      return (lightest + 0.05) / (darkest + 0.05);
    }

    // Traverse up to find effective background color
    function getEffectiveBgColor(el) {
      let bg = { r: 255, g: 255, b: 255, a: 1 }; // Default white
      let current = el;
      while (current && current.tagName) {
        const style = window.getComputedStyle(current);
        const color = parseColor(style.backgroundColor);
        if (color && color.a > 0) {
          // Simplistic alpha blending over white
          if (color.a === 1) return color;
          // Note: Full blending is complex, we'll return first opaque or semi-transparent for heuristic
          return color;
        }
        current = current.parentElement;
      }
      return bg;
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue.trim();
      if (!text) continue;
      
      const parent = node.parentElement;
      if (!parent || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') continue;

      const style = window.getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

      const fgStr = style.color;
      const fg = parseColor(fgStr);
      if (!fg) continue;

      const bg = getEffectiveBgColor(parent);
      if (bg.a < 1 || fg.a < 1) {
        // Can't reliably calculate if transparent
        incomplete.push({
          html: parent.outerHTML.substring(0, 100),
          target: [parent.tagName.toLowerCase()],
          failureSummary: 'Element has transparency; verify contrast manually.'
        });
        continue;
      }

      const l1 = getLuminance(fg.r, fg.g, fg.b);
      const l2 = getLuminance(bg.r, bg.g, bg.b);
      const ratio = getContrast(l1, l2);

      // Large text: 18pt (~24px) or 14pt (~18.66px) bold
      const fontSize = parseFloat(style.fontSize);
      const fontWeight = parseInt(style.fontWeight, 10) || (style.fontWeight === 'bold' ? 700 : 400);
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);

      const requiredRatio = isLarge ? 3.0 : 4.5;

      if (ratio < requiredRatio) {
        violations.push({
          html: parent.outerHTML.substring(0, 100),
          target: [parent.tagName.toLowerCase()],
          failureSummary: `Element has insufficient color contrast of ${ratio.toFixed(2)} (foreground text: ${fgStr}, background: rgb(${bg.r}, ${bg.g}, ${bg.b})). Required: ${requiredRatio}.`
        });
      } else {
        passes.push({ html: parent.outerHTML.substring(0, 100), target: [parent.tagName.toLowerCase()] });
      }
    }

    // De-duplicate passes to prevent massive JSON output
    const uniquePasses = Array.from(new Set(passes.map(p => p.html))).map(html => ({ html, target: ['text'] }));

    return { violations, passes: uniquePasses, incomplete };
  }
};
