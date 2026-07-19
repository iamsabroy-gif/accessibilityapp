module.exports = {
  id: 'video-captions-present',
  type: 'dom',
  description: 'Video element is missing captions/subtitles track.',
  help: 'Provide a text track for video.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/captions-prerecorded.html',
  tags: ['wcag122'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    const videos = Array.from(document.querySelectorAll('video'));

    videos.forEach(v => {
      const hasTrack = v.querySelector('track[kind="captions"], track[kind="subtitles"]');
      if (v.getAttribute('src') && !hasTrack) {
        violations.push({
          html: v.outerHTML.substring(0, 150),
          target: ['video'],
          failureSummary: 'Video element is missing a <track> for captions/subtitles.'
        });
      } else {
        passes.push({ html: v.outerHTML.substring(0, 150), target: ['video'] });
      }
    });

    return { violations, passes, incomplete };
  }
};
