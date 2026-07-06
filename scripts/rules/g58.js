/**
 * g58.js
 * Native rule for WCAG 2.1 - G58
 */

module.exports = {
  id: 'g58-link-to-text-alternative',
  type: 'dom',
  description: 'Prerecorded time-based media does not have a link to a text alternative immediately adjacent to it.',
  help: 'Place a link to the transcript or text alternative immediately next to the media element.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/general/G58',
  tags: ['wcag123', 'cat.time-and-media'],
  impact: 'serious',
  
  evaluate: function(doc) {
    const violations = [];
    const passes = [];
    const incomplete = [];

    function isAdjacentAlternative(mediaEl) {
      const parent = mediaEl.parentElement;
      if (!parent) return false;
      const siblings = Array.from(parent.children);
      const idx = siblings.indexOf(mediaEl);
      const near = siblings.slice(Math.max(0, idx - 2), Math.min(siblings.length, idx + 3)).filter(el => el !== mediaEl);
      
      if (parent.tagName === 'FIGURE') {
        const fc = parent.querySelector('figcaption');
        if (fc) near.push(fc);
      }
      
      return near.some(el => {
        const links = el.tagName === 'A' ? [el] : Array.from(el.querySelectorAll('a'));
        return links.some(a => {
          const text = (a.textContent || '').toLowerCase();
          const href = (a.getAttribute('href') || '').toLowerCase();
          return /transcript|text alternative|description|text version|full text/.test(text)
            || /\.(txt|html?)$|transcript|description/.test(href);
        });
      });
    }

    const mediaSelectors = 'video, audio, object, iframe, embed';
    const mediaEls = Array.from(doc.querySelectorAll(mediaSelectors));
    
    mediaEls.forEach(el => {
      const ariaDesc = el.getAttribute('aria-describedby') || '';
      if (/media alternative for text|text alternative/.test(ariaDesc.toLowerCase())) return;
      
      const src = el.getAttribute('src') || el.getAttribute('data') || '';
      const type = el.getAttribute('type') || '';
      const isCandidate = /\.(mp4|webm|ogg|ogv|mp3|wav|m4a|mov)$/.test(src) || /video|audio/.test(type);
      
      if (!isCandidate) return;
      
      if (!isAdjacentAlternative(el)) {
        violations.push({
          html: el.outerHTML,
          target: [el.tagName.toLowerCase()],
          failureSummary: ''
        });
      } else {
        passes.push({ html: el.outerHTML, target: [el.tagName.toLowerCase()] });
      }
    });

    return { violations, passes, incomplete };
  }
};
