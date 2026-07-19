module.exports = {
  id: 'target-size',
  type: 'dom',
  description: 'Interactive targets must be at least 24×24 CSS pixels.',
  help: 'Ensure pointer targets are at least 24×24 CSS pixels, or have adequate offset spacing from adjacent targets.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html',
  tags: ['wcag22aa', 'wcag258'],
  impact: 'serious',

  evaluate: function(document) {
    var violations = [];
    var passes = [];
    var incomplete = [];

    // Parent tags that indicate an inline text flow — links inside these are exempt
    var INLINE_CONTAINERS = ['p', 'li', 'td', 'th', 'dd', 'dt', 'blockquote', 'caption'];

    var selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([type="hidden"]):not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[role="button"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="menuitem"]',
      '[role="menuitemcheckbox"]',
      '[role="menuitemradio"]',
      '[role="option"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="tab"]'
    ].join(', ');

    var elements = Array.from(document.querySelectorAll(selector));

    elements.forEach(function(el) {
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      var rect = el.getBoundingClientRect();
      // Skip zero-size elements (off-screen, hidden via other means)
      if (rect.width === 0 && rect.height === 0) return;

      var w = rect.width;
      var h = rect.height;
      var tag = el.tagName.toLowerCase();
      var role = el.getAttribute('role') || '';

      // Inline text exception: <a> or role="link" inside flowing text
      var isInlineTextLink = false;
      if (tag === 'a' || role === 'link') {
        var parent = el.parentElement;
        if (parent) {
          var parentTag = parent.tagName.toLowerCase();
          if (INLINE_CONTAINERS.indexOf(parentTag) !== -1) {
            isInlineTextLink = true;
          }
        }
      }

      var htmlSnippet = el.outerHTML.substring(0, 120);

      if (isInlineTextLink) {
        if (w < 24 || h < 24) {
          incomplete.push({
            html: htmlSnippet,
            target: [tag],
            failureSummary: 'Inline text link (' + Math.round(w) + '×' + Math.round(h) + 'px) is exempt from the 24×24 requirement under the inline exception. Verify spacing to adjacent links is ≥24px if target is below threshold.'
          });
        } else {
          passes.push({ html: htmlSnippet, target: [tag] });
        }
        return;
      }

      if (w >= 24 && h >= 24) {
        passes.push({ html: htmlSnippet, target: [tag] });
      } else {
        violations.push({
          html: htmlSnippet,
          target: [tag],
          failureSummary: 'Target size is ' + Math.round(w) + '×' + Math.round(h) + 'px — minimum is 24×24 CSS px. If the element has ≥24px of offset spacing to all adjacent targets, it is exempt (spacing exception — verify manually).'
        });
      }
    });

    return { violations: violations, passes: passes, incomplete: incomplete };
  }
};
