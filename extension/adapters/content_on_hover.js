module.exports = {
  id: 'content-on-hover',
  type: 'adapter',
  impact: 'moderate',
  description: 'Hovering or focusing on an element triggers additional content.',
  help: 'Ensure content triggered by hover/focus is dismissible, hoverable, and persistent.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/content-on-hover-or-focus.html',
  tags: ['wcag21aa', 'wcag1413'],
  evaluate: function(doc) {
    var triggers = Array.from(doc.querySelectorAll('a[href], button, [role="button"], [role="menuitem"], .tooltip-trigger')).slice(0, 5);
    var incomplete = [];
    var passes = [];
    triggers.forEach(function(el) {
      var title = el.getAttribute('title');
      var ariaDescribedBy = el.getAttribute('aria-describedby');
      if (title || ariaDescribedBy) {
        incomplete.push({
          id: 'content-on-hover',
          description: 'Hovering or focusing triggered new content (tooltip/title/aria-describedby).',
          nodeCount: 1
        });
      } else {
        passes.push({ id: 'content-on-hover', description: 'No unmanaged hover content detected.', nodeCount: 1 });
      }
    });
    return { violations: [], passes: passes, incomplete: incomplete };
  }
};
