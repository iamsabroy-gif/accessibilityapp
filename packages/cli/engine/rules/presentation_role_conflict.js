module.exports = {
  id: 'presentation-role-conflict',
  type: 'dom',
  description: 'Elements marked as decorative should not have hidden semantics or be focusable.',
  help: 'Ensure elements with role="presentation" or role="none" are not focusable and have no global ARIA states.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
  tags: ['wcag412'],
  impact: 'minor',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const presentationEls = Array.from(document.querySelectorAll('*[role="presentation"], *[role="none"]'));
    
    // Some global ARIA attributes that shouldn't be on presentation elements
    const globalAria = [
      'aria-atomic', 'aria-busy', 'aria-controls', 'aria-current', 'aria-describedby',
      'aria-details', 'aria-disabled', 'aria-dropeffect', 'aria-errormessage', 'aria-flowto',
      'aria-grabbed', 'aria-haspopup', 'aria-hidden', 'aria-invalid', 'aria-keyshortcuts',
      'aria-label', 'aria-labelledby', 'aria-live', 'aria-owns', 'aria-relevant',
      'aria-roledescription'
    ];
    
    presentationEls.forEach(el => {
      let isFocusable = false;
      let hasGlobalAria = false;
      
      // Basic focusable heuristic
      const tag = el.tagName.toLowerCase();
      if ((tag === 'a' && el.hasAttribute('href')) ||
          tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea' ||
          el.hasAttribute('tabindex')) {
        isFocusable = true;
      }
      
      for (const attr of globalAria) {
        if (el.hasAttribute(attr)) {
          hasGlobalAria = true;
          break;
        }
      }
      
      if (isFocusable || hasGlobalAria) {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [tag],
          failureSummary: 'Element has role="presentation" or role="none" but is focusable or has global ARIA attributes.'
        });
      } else {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [tag] });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
