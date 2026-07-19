module.exports = {
  id: 'focus-order-modal-escape',
  type: 'dom',
  description: 'Escape key does not close modal or restore focus.',
  help: 'Ensure modals close with Escape and focus returns to the opener.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/focus/F77',
  tags: ['wcag212'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog, [aria-modal="true"]'));
    dialogs.forEach(dialog => {
      // Attempt to focus dialog
      if (typeof dialog.focus === 'function') dialog.focus();
      // Simulate Escape key press
      const ev = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      dialog.dispatchEvent(ev);
      const after = document.activeElement;
      const stillInDialog = dialog.contains(after);
      
      if (stillInDialog) {
        violations.push({
          html: dialog.outerHTML.substring(0, 100),
          target: [dialog.tagName.toLowerCase()],
          failureSummary: 'Escape key does not close modal or restore focus.'
        });
      } else {
        passes.push({ html: dialog.outerHTML.substring(0, 100), target: [dialog.tagName.toLowerCase()] });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
