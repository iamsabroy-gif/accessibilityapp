/**
 * wcag122_captions.js
 *
 * WCAG 2.1 SC 1.2.2 – Captions (Prerecorded)
 * Technique: H95 – Using the track element to provide captions
 *
 * Pure-function implementation: accepts a `document` object so it can run both
 * inside Puppeteer's page.evaluate() and in a jsdom unit-test environment.
 *
 * Rule IDs emitted (map all three to "1.2.2" in wcag_mapping.go):
 *   video-captions-present   – no <track kind="captions|subtitles"> at all
 *   video-captions-track-src – caption track exists but has no src attribute
 *   video-captions-track-lang – caption track exists + has src, but no srclang
 *
 * Usage inside axe_runner.js (after the existing G58/H53 block):
 *   const { checkVideoCaptions } = require('./checks/wcag122_captions');
 *   const c122 = await page.evaluate(checkVideoCaptions.toString() + '; return checkVideoCaptions(document);');
 *
 * Or, more idiomatically, inline the function body via page.evaluate(() => { ... }).
 */

'use strict';

/**
 * @param {Document} document
 * @returns {{ violations: object[], passes: object[], incomplete: object[] }}
 */
function checkVideoCaptions(document) {
  const violations = [];
  const passes     = [];
  const incomplete = [];

  const HELP_URL = 'https://www.w3.org/WAI/WCAG21/Techniques/html/H95';
  const TAGS     = ['wcag122', 'cat.time-and-media'];

  /**
   * Returns true when the video element has at least one resolvable media source.
   * Covers: src attribute, <source> children, and data-src lazy-load pattern.
   */
  function hasSrc(video) {
    if (video.getAttribute('src')) return true;
    const sources = Array.from(video.querySelectorAll('source'));
    if (sources.some(s => s.getAttribute('src') || s.getAttribute('data-src'))) return true;
    if (video.getAttribute('data-src')) return true;
    return false;
  }

  /** Serialise the element's opening tag only (keeps outerHTML short in test output). */
  function openTag(el) {
    const clone = el.cloneNode(false);
    // cloneNode(false) copies attributes but no children → single self-closing-like tag
    const div = document.createElement('div');
    div.appendChild(clone);
    return div.innerHTML;
  }

  const videos = Array.from(document.querySelectorAll('video'));

  if (videos.length === 0) {
    // No video elements – nothing to check, no result pushed.
    return { violations, passes, incomplete };
  }

  videos.forEach((video, idx) => {
    const nodeTarget = `video:nth-of-type(${idx + 1})`;

    // ── 1. No detectable source ─────────────────────────────────────────────
    if (!hasSrc(video)) {
      incomplete.push({
        id:          'video-captions-present',
        description: 'Video element has no src or <source> child. Cannot determine whether captions are required.',
        help:        'Ensure the video has a media source, then add <track kind="captions" src="..." srclang="..."> if it contains audio.',
        helpUrl:     HELP_URL,
        tags:        TAGS,
        nodes:       [{ html: openTag(video), target: [nodeTarget], failureSummary: '' }],
      });
      return;
    }

    const tracks = Array.from(video.querySelectorAll('track'));
    const captionTrack = tracks.find(t => {
      const kind = (t.getAttribute('kind') || '').toLowerCase();
      return kind === 'captions' || kind === 'subtitles';
    });

    // ── 2. No caption/subtitle track at all ─────────────────────────────────
    if (!captionTrack) {
      violations.push({
        id:          'video-captions-present',
        impact:      'critical',
        description: 'Prerecorded video does not have a synchronised caption track.',
        help:        'Add <track kind="captions" src="captions.vtt" srclang="en" label="English"> inside the <video> element.',
        helpUrl:     HELP_URL,
        tags:        TAGS,
        nodes:       [{
          html:           openTag(video),
          target:         [nodeTarget],
          failureSummary: 'No <track kind="captions"> or <track kind="subtitles"> found.',
        }],
      });
      return;
    }

    // ── 3. Caption track has no src ──────────────────────────────────────────
    const trackSrc = captionTrack.getAttribute('src') || '';
    if (!trackSrc) {
      violations.push({
        id:          'video-captions-track-src',
        impact:      'serious',
        description: 'Caption <track> element is missing a src attribute; the captions file cannot be loaded.',
        help:        'Set src on the <track kind="captions"> element to a valid WebVTT (.vtt) URL.',
        helpUrl:     HELP_URL,
        tags:        TAGS,
        nodes:       [{
          html:           openTag(video),
          target:         [nodeTarget],
          failureSummary: '<track kind="captions"> has no src attribute.',
        }],
      });
      return;
    }

    // ── 4. Caption track has no srclang ─────────────────────────────────────
    const srclang = captionTrack.getAttribute('srclang') || '';
    if (!srclang) {
      incomplete.push({
        id:          'video-captions-track-lang',
        description: 'Caption <track> is missing the srclang attribute. Cannot verify language matches video content.',
        help:        'Add srclang (e.g., srclang="en") and label attributes to the <track kind="captions"> element.',
        helpUrl:     HELP_URL,
        tags:        TAGS,
        nodes:       [{
          html:           openTag(video),
          target:         [nodeTarget],
          failureSummary: '<track kind="captions"> is missing srclang.',
        }],
      });
      return;
    }

    // ── 5. Fully conformant ──────────────────────────────────────────────────
    const kind  = captionTrack.getAttribute('kind');
    const label = captionTrack.getAttribute('label') || '';
    passes.push({
      id:          'video-captions-present',
      description: `Video has a valid caption track (kind="${kind}", srclang="${srclang}"${label ? `, label="${label}"` : ''}).`,
    });
  });

  return { violations, passes, incomplete };
}

module.exports = { checkVideoCaptions };
