module.exports = {
  id: 'dragging-movements',
  type: 'dom',
  description: 'All drag-and-drop functionality must have a single-pointer alternative that does not require dragging.',
  help: 'Provide alternatives to drag operations such as click-to-select + click-to-drop, sort buttons, or cut/paste equivalents.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html',
  tags: ['wcag22aa', 'wcag257'],
  impact: 'serious',

  evaluate: function(document) {
    var violations = [];
    var passes = [];
    var incomplete = [];

    // Selector for explicitly draggable elements
    var draggableSelector = [
      '[draggable="true"]',
      '[aria-grabbed]',
      '[class*="sortable-item"]',
      '[class*="draggable-item"]',
      '[class*="drag-item"]',
      '[class*="drag-handle"]',
      '[data-draggable="true"]',
      '[data-drag-id]'
    ].join(', ');

    var draggables = Array.from(document.querySelectorAll(draggableSelector));

    if (draggables.length === 0) {
      passes.push({ html: '<body>', target: ['body'] });
      return { violations: violations, passes: passes, incomplete: incomplete };
    }

    // Keywords that suggest a single-pointer reorder alternative
    var REORDER_KEYWORDS = ['up', 'down', 'move', 'sort', 'reorder', 'higher', 'lower', 'before', 'after'];

    function hasReorderButton(el) {
      // Check siblings and parent for reorder-suggesting buttons
      var searchRoot = el.parentElement || el;
      var buttons = Array.from(searchRoot.querySelectorAll('button, [role="button"], [role="menuitem"]'));
      return buttons.some(function(btn) {
        var label = [
          btn.getAttribute('aria-label') || '',
          btn.getAttribute('title') || '',
          btn.textContent || ''
        ].join(' ').toLowerCase();
        return REORDER_KEYWORDS.some(function(kw) { return label.indexOf(kw) !== -1; });
      });
    }

    // Deduplicate by outerHTML to avoid reporting the same widget multiple times
    var seen = {};
    draggables.forEach(function(el) {
      var key = el.outerHTML.substring(0, 60);
      if (seen[key]) return;
      seen[key] = true;

      var html = el.outerHTML.substring(0, 120);
      var tag = el.tagName.toLowerCase();
      var hasAriaGrab = el.hasAttribute('aria-grabbed');

      if (hasReorderButton(el)) {
        // Evidence of a single-pointer alternative exists
        passes.push({ html: html, target: [tag] });
      } else if (hasAriaGrab) {
        // ARIA drag pattern without evident alternative — more confident incomplete
        incomplete.push({
          html: html,
          target: [tag],
          failureSummary: 'Element uses aria-grabbed (ARIA drag pattern) without an evident single-pointer alternative. Verify that a keyboard-operable move mechanism (e.g., cut/paste buttons, move-up/move-down buttons) is available.'
        });
      } else {
        // draggable="true" or framework class — emit incomplete
        incomplete.push({
          html: html,
          target: [tag],
          failureSummary: 'Draggable element detected. Cannot automatically verify a single-pointer alternative (e.g., button controls for reordering) exists. Manual check required per WCAG 2.5.7.'
        });
      }
    });

    return { violations: violations, passes: passes, incomplete: incomplete };
  }
};
