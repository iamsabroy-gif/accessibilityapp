module.exports = {
  id: 'focus-appearance',
  type: 'puppeteer',
  description: 'Keyboard focus indicators must meet minimum area (perimeter × 2px) and contrast ratio (3:1) requirements.',
  help: 'Use outline-width ≥2px and ensure the outline color has ≥3:1 contrast against the adjacent background.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html',
  tags: ['wcag22aaa', 'wcag2413'],
  impact: 'serious',

  evaluate: async function(page) {
    var violations = [];
    var passes = [];
    var incomplete = [];

    var MAX_TABS = 15;

    // --- Helpers (Node.js context) ---

    function parseRgb(str) {
      if (!str) return null;
      var m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (!m) return null;
      return { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10) };
    }

    function relativeLuminance(r, g, b) {
      var vals = [r, g, b].map(function(v) {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return vals[0] * 0.2126 + vals[1] * 0.7152 + vals[2] * 0.0722;
    }

    function contrastRatio(c1, c2) {
      var l1 = relativeLuminance(c1.r, c1.g, c1.b);
      var l2 = relativeLuminance(c2.r, c2.g, c2.b);
      var lighter = Math.max(l1, l2);
      var darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    // --- Puppeteer loop ---

    await page.focus('body');

    for (var i = 0; i < MAX_TABS; i++) {
      await page.keyboard.press('Tab');

      var data = await page.evaluate(function() {
        var el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) return null;

        var rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return { skip: true };

        var s = window.getComputedStyle(el);

        // Perimeter of the unfocused component
        var perimeter = 2 * (rect.width + rect.height);

        // Outline properties
        var outlineStyle = s.outlineStyle;
        var outlineWidth = parseFloat(s.outlineWidth) || 0;
        var outlineColor = s.outlineColor;

        // Box shadow (as raw string — Node.js will interpret it)
        var boxShadow = s.boxShadow;

        // Background of element (used as proxy for "unfocused pixel color adjacent to indicator")
        var bgColor = s.backgroundColor;

        // Walk up to find the nearest opaque background for contrast computation
        var effectiveBg = bgColor;
        if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
          var p = el.parentElement;
          while (p && p.tagName) {
            var ps = window.getComputedStyle(p);
            var pb = ps.backgroundColor;
            if (pb && pb !== 'rgba(0, 0, 0, 0)' && pb !== 'transparent') {
              effectiveBg = pb;
              break;
            }
            p = p.parentElement;
          }
        }

        var hasOutline = outlineStyle !== 'none' && outlineWidth > 0;
        var hasBoxShadow = boxShadow && boxShadow !== 'none';

        return {
          skip: false,
          html: el.outerHTML.substring(0, 120),
          tag: el.tagName.toLowerCase(),
          perimeter: perimeter,
          hasOutline: hasOutline,
          outlineWidth: outlineWidth,
          outlineColor: outlineColor,
          outlineStyle: outlineStyle,
          hasBoxShadow: hasBoxShadow,
          boxShadow: boxShadow,
          effectiveBg: effectiveBg,
          rectWidth: Math.round(rect.width),
          rectHeight: Math.round(rect.height)
        };
      });

      if (!data || data.skip) continue;

      var html = data.html;
      var tag = data.tag;

      // No indicator at all
      if (!data.hasOutline && !data.hasBoxShadow) {
        violations.push({
          id: 'focus-appearance',
          impact: 'serious',
          description: 'No visible keyboard focus indicator detected (no outline or box-shadow).',
          help: 'Add an outline or box-shadow to focused elements with ≥2px width and ≥3:1 contrast.',
          helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html',
          tags: ['wcag22aaa', 'wcag2413'],
          nodes: [{
            html: html,
            target: [tag],
            failureSummary: 'No outline or box-shadow when focused. Element: ' + data.rectWidth + '×' + data.rectHeight + 'px.'
          }]
        });
        continue;
      }

      // Box-shadow only — cannot reliably measure area or color
      if (!data.hasOutline && data.hasBoxShadow) {
        incomplete.push({
          id: 'focus-appearance',
          description: 'Focus indicator uses box-shadow only. Area and contrast ratio cannot be automatically computed from box-shadow. Manually verify: (1) total indicator area ≥ ' + Math.round(data.perimeter * 2) + 'px² (' + Math.round(data.perimeter) + 'px perimeter × 2px), (2) indicator color has ≥3:1 contrast against adjacent background. box-shadow: ' + (data.boxShadow || '').substring(0, 60),
          nodeCount: 1
        });
        continue;
      }

      // Outline present — check area and contrast
      var minArea = data.perimeter * 2;
      var actualArea = data.perimeter * data.outlineWidth;
      var areaFail = actualArea < minArea;

      var contrastFail = false;
      var contrastValue = null;
      var contrastUnknown = false;

      var indicatorRgb = parseRgb(data.outlineColor);
      var bgRgb = parseRgb(data.effectiveBg);

      if (indicatorRgb && bgRgb) {
        contrastValue = contrastRatio(indicatorRgb, bgRgb);
        contrastFail = contrastValue < 3.0;
      } else {
        contrastUnknown = true;
      }

      if (areaFail) {
        violations.push({
          id: 'focus-appearance',
          impact: 'serious',
          description: 'Focus indicator area is below minimum (perimeter × 2px).',
          help: 'Increase outline-width to at least 2px.',
          helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html',
          tags: ['wcag22aaa', 'wcag2413'],
          nodes: [{
            html: html,
            target: [tag],
            failureSummary: 'outline-width: ' + data.outlineWidth + 'px gives area ≈' + Math.round(actualArea) + 'px²; minimum is ' + Math.round(minArea) + 'px² (perimeter ' + Math.round(data.perimeter) + 'px × 2). Increase outline-width to ≥2px.'
          }]
        });
      } else if (contrastFail) {
        violations.push({
          id: 'focus-appearance',
          impact: 'serious',
          description: 'Focus indicator has insufficient contrast ratio against adjacent background (≥3:1 required).',
          help: 'Choose an outline color with at least 3:1 contrast against the background behind the focus indicator.',
          helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html',
          tags: ['wcag22aaa', 'wcag2413'],
          nodes: [{
            html: html,
            target: [tag],
            failureSummary: 'Focus indicator contrast: ' + (contrastValue ? contrastValue.toFixed(2) : '?') + ':1 (required ≥3:1). outline-color: ' + data.outlineColor + ', background: ' + data.effectiveBg + '.'
          }]
        });
      } else if (contrastUnknown) {
        incomplete.push({
          id: 'focus-appearance',
          description: 'Focus indicator present (outline-width: ' + data.outlineWidth + 'px) but contrast could not be computed — outline-color or background is non-rgb (e.g., transparent, CSS variable, currentColor). Manual check for ≥3:1 contrast required.',
          nodeCount: 1
        });
      } else {
        passes.push({
          id: 'focus-appearance',
          description: 'Focus indicator meets area (outline-width ' + data.outlineWidth + 'px ≥ 2px) and contrast (' + (contrastValue ? contrastValue.toFixed(2) : '?') + ':1 ≥ 3:1) requirements.',
          nodeCount: 1
        });
      }
    }

    return { violations: violations, passes: passes, incomplete: incomplete };
  }
};
