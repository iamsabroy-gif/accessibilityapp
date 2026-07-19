module.exports = {
  id: 'video-captions-track',
  type: 'dom',
  description: 'Text track for video is missing required attributes.',
  help: 'Provide src, srclang, and label attributes for captions/subtitles track.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/captions-prerecorded.html',
  tags: ['wcag122'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    const tracks = Array.from(document.querySelectorAll('track[kind="captions"], track[kind="subtitles"]'));

    tracks.forEach(t => {
      let fail = '';
      if (!t.getAttribute('src')) fail += 'Missing src. ';
      if (!t.getAttribute('srclang')) fail += 'Missing srclang. ';
      if (!t.getAttribute('label')) fail += 'Missing label.';
      
      if (fail) {
        violations.push({
          html: t.outerHTML.substring(0, 150),
          target: ['track'],
          failureSummary: fail.trim()
        });
      } else {
        passes.push({ html: t.outerHTML.substring(0, 150), target: ['track'] });
      }
    });

    return { violations, passes, incomplete };
  }
};
