/**
 * h53.js
 * Native rule for WCAG 2.1 - H53
 */

module.exports = {
  id: 'h53-media-description',
  type: 'dom',
  description: 'The object element embedding multimedia does not provide an alternative for time-based media in its body content.',
  help: 'Use the body of the object element to provide a transcript, text alternative, or a link to one.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/html/H53',
  tags: ['wcag123', 'cat.time-and-media'],
  impact: 'serious',

  evaluate: function(doc) {
    const violations = [];
    const passes = [];
    const incomplete = [];

    function isObjectAlternative(obj) {
      const clone = obj.cloneNode(true);
      if (clone.querySelectorAll) {
          clone.querySelectorAll('param, embed').forEach(e => e.remove());
      }
      const text = clone.textContent.trim();
      let hasLink = false;
      if (clone.querySelectorAll) {
          hasLink = Array.from(clone.querySelectorAll('a')).some(a => /transcript|text alternative|description/.test((a.textContent || '').toLowerCase()));
      }
      const hasTranscript = text.length > 200 && ( /\w+\s*:/.test(text) || /\[.*\]/.test(text) || text.toLowerCase().includes('transcript') );
      const readable = text.length > 30;
      return hasLink || hasTranscript || readable;
    }

    const objectEls = Array.from(doc.querySelectorAll('object'));
    objectEls.forEach(obj => {
      const data = obj.getAttribute('data') || '';
      const type = obj.getAttribute('type') || '';
      const isMultimedia = /\.(mp4|webm|ogg|ogv|mp3|wav|m4a|mov)$/.test(data) || /video\/|audio\/|application\/x-shockwave-flash/.test(type);
      if (!isMultimedia) return;
      
      if (!data && !type) {
        incomplete.push(obj);
        return;
      }

      if (!isObjectAlternative(obj)) {
        violations.push({
          html: obj.outerHTML,
          target: ['object'],
          failureSummary: ''
        });
      } else {
        passes.push(obj);
      }
    });

    return { violations, passes, incomplete };
  }
};
