module.exports = {
  id: 'image-alt',
  type: 'dom',
  description: 'Images must have alternate text.',
  help: 'Provide alternate text for images.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html',
  tags: ['wcag111'],
  impact: 'critical',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const images = Array.from(document.querySelectorAll('img'));
    images.forEach(img => {
      // Check if image is hidden from screen readers
      const ariaHidden = img.getAttribute('aria-hidden');
      if (ariaHidden === 'true') {
        passes.push({ html: img.outerHTML.substring(0, 100), target: ['img'] });
        return;
      }

      const role = img.getAttribute('role');
      if (role === 'presentation' || role === 'none') {
        passes.push({ html: img.outerHTML.substring(0, 100), target: ['img'] });
        return;
      }

      // Check for valid text alternatives
      const hasAlt = img.hasAttribute('alt');
      const hasAriaLabel = img.hasAttribute('aria-label') && img.getAttribute('aria-label').trim().length > 0;
      const hasAriaLabelledBy = img.hasAttribute('aria-labelledby') && img.getAttribute('aria-labelledby').trim().length > 0;
      const hasTitle = img.hasAttribute('title') && img.getAttribute('title').trim().length > 0;

      if (hasAlt || hasAriaLabel || hasAriaLabelledBy || hasTitle) {
        passes.push({ html: img.outerHTML.substring(0, 100), target: ['img'] });
      } else {
        violations.push({
          html: img.outerHTML.substring(0, 100),
          target: ['img'],
          failureSummary: 'Image element is missing an alt attribute or other accessible name.'
        });
      }
    });

    // Also check <input type="image">
    const inputImages = Array.from(document.querySelectorAll('input[type="image"]'));
    inputImages.forEach(input => {
      const hasAlt = input.hasAttribute('alt') && input.getAttribute('alt').trim().length > 0;
      const hasAriaLabel = input.hasAttribute('aria-label') && input.getAttribute('aria-label').trim().length > 0;
      const hasAriaLabelledBy = input.hasAttribute('aria-labelledby') && input.getAttribute('aria-labelledby').trim().length > 0;
      const hasTitle = input.hasAttribute('title') && input.getAttribute('title').trim().length > 0;

      if (hasAlt || hasAriaLabel || hasAriaLabelledBy || hasTitle) {
        passes.push({ html: input.outerHTML.substring(0, 100), target: ['input'] });
      } else {
        violations.push({
          html: input.outerHTML.substring(0, 100),
          target: ['input'],
          failureSummary: '<input type="image"> element is missing an alt attribute or other accessible name.'
        });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
