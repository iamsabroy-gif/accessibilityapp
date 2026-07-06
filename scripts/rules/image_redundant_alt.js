module.exports = {
  id: 'image-redundant-alt',
  type: 'dom',
  description: 'Alternative text of an image should not be repeated as text.',
  help: 'Ensure image alternative is not repeated as text.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html',
  tags: ['wcag111'],
  impact: 'minor',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    const images = Array.from(document.querySelectorAll('img'));
    images.forEach(img => {
      const alt = img.getAttribute('alt');
      
      // If no alt or empty alt, this rule is not applicable (passes inherently or caught by image-alt)
      if (alt === null || alt.trim() === '') {
        passes.push({ html: img.outerHTML.substring(0, 100), target: ['img'] });
        return;
      }

      const altText = alt.trim().toLowerCase();
      
      // Get text content from the parent wrapper (e.g., a surrounding <a> or <div>)
      let parent = img.parentElement;
      let isRedundant = false;
      
      if (parent) {
        // Clone the parent to remove the img itself before getting text,
        // although img textContent is empty anyway. We want to see if the surrounding
        // text literally equals or contains the exact alt text.
        const parentText = (parent.textContent || '').trim().toLowerCase();
        
        // Remove extra whitespaces
        const cleanParentText = parentText.replace(/\s+/g, ' ');
        const cleanAltText = altText.replace(/\s+/g, ' ');
        
        // If the exact alt text is found nearby
        if (cleanParentText.includes(cleanAltText) && cleanAltText.length > 3) {
          isRedundant = true;
        }
      }

      if (isRedundant) {
        violations.push({
          html: img.outerHTML.substring(0, 100),
          target: ['img'],
          failureSummary: `Image alt text "${alt.trim()}" is redundant with adjacent text.`
        });
      } else {
        passes.push({ html: img.outerHTML.substring(0, 100), target: ['img'] });
      }
    });

    return { violations, passes, incomplete };
  }
};
