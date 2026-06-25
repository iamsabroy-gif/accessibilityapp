/**
 * wcag122_captions.test.js
 *
 * Unit tests for WCAG 2.1 SC 1.2.2 – Captions (Prerecorded)
 * Technique: H95 – Using the track element to provide captions
 *
 * Runner : Jest  (testEnvironment: jsdom)
 * Install: npm install --save-dev jest jest-environment-jsdom
 * Run    : npx jest scripts/wcag122_captions.test.js --verbose
 *
 * Coverage matrix
 * ───────────────────────────────────────────────────────────────────────────
 * GROUP A – No video elements
 *   A1  Page has no <video> → empty result
 *   A2  Page has only <audio> → not checked, empty result
 *
 * GROUP B – Video without a usable media source
 *   B1  <video> with no src, no <source>, no data-src → incomplete
 *   B2  <video data-src="..."> only → incomplete (lazy-load pattern)
 *
 * GROUP C – Video with source but no caption track
 *   C1  src attr, zero <track> children → critical violation
 *   C2  src attr, <track kind="descriptions"> only → critical violation
 *   C3  src attr, <track kind="metadata"> only → critical violation
 *   C4  <source> child (no src on video), no <track> → critical violation
 *   C5  Autoplay muted video, no <track> → still a violation
 *
 * GROUP D – Video with caption track but incomplete track metadata
 *   D1  <track kind="captions"> present but no src attr → serious violation
 *   D2  <track kind="captions" src="..."> but no srclang → incomplete
 *
 * GROUP E – Fully conformant
 *   E1  <track kind="captions" src="..." srclang="en"> → pass
 *   E2  <track kind="subtitles" ...> (treated equiv. to captions) → pass
 *   E3  Multiple tracks: one captions + one descriptions → pass (captions wins)
 *   E4  Caption track with label attribute → pass, label included in description
 *   E5  Caption track with default attribute → pass
 *
 * GROUP F – Multiple video elements on the page
 *   F1  Two videos: one pass, one violation → 1 pass + 1 violation
 *   F2  Three videos: conformant / missing-track / no-src → mixed results
 *
 * GROUP G – Rule ID and metadata integrity
 *   G1  Violation rule ID is exactly "video-captions-present"
 *   G2  Missing-src violation rule ID is "video-captions-track-src"
 *   G3  Missing-srclang incomplete rule ID is "video-captions-track-lang"
 *   G4  Violation impact is "critical" for missing track
 *   G5  Violation impact is "serious" for missing track src
 *   G6  All results carry the wcag122 tag
 *   G7  Violation nodes array is non-empty with target and failureSummary
 * ───────────────────────────────────────────────────────────────────────────
 */

'use strict';

// @jest-environment jsdom
// jest already provides a global `document` via its jsdom environment.
// We use document.implementation to create isolated sub-documents per test
// so tests do not share state.

const { checkVideoCaptions } = require('./checks/wcag122_captions');

// ---------------------------------------------------------------------------
// Helper: build an isolated document from an HTML fragment
// ---------------------------------------------------------------------------
function doc(html) {
  // document is the jest-provided jsdom global
  const d = document.implementation.createHTMLDocument('');
  d.body.innerHTML = html;
  return d;
}

// ---------------------------------------------------------------------------
// Helper: run the check and return the result object
// ---------------------------------------------------------------------------
function run(html) {
  return checkVideoCaptions(doc(html));
}

// ---------------------------------------------------------------------------
// Shared matchers
// ---------------------------------------------------------------------------
function expectEmpty(result) {
  expect(result.violations).toHaveLength(0);
  expect(result.passes).toHaveLength(0);
  expect(result.incomplete).toHaveLength(0);
}

// ============================================================================
// GROUP A – No video elements
// ============================================================================
describe('A – No video elements', () => {
  test('A1: page with no <video> returns an empty result', () => {
    const result = run('<p>Hello world</p><img src="photo.jpg" alt="photo">');
    expectEmpty(result);
  });

  test('A2: page with only <audio> is not checked', () => {
    const result = run('<audio src="podcast.mp3" controls></audio>');
    expectEmpty(result);
  });
});

// ============================================================================
// GROUP B – Video without a usable media source
// ============================================================================
describe('B – Video with no detectable source', () => {
  test('B1: <video> with no src, no <source>, no data-src → incomplete', () => {
    const result = run('<video controls></video>');
    expect(result.violations).toHaveLength(0);
    expect(result.passes).toHaveLength(0);
    expect(result.incomplete).toHaveLength(1);
    expect(result.incomplete[0].id).toBe('video-captions-present');
  });

  test('B2: <video data-src="..."> only (lazy-load) → violation (src detected, no captions track)', () => {
    // hasSrc() recognises data-src as a valid source indicator.
    // With a source but no <track>, the check correctly emits a violation.
    const result = run('<video data-src="lazy.mp4" controls></video>');
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].id).toBe('video-captions-present');
    expect(result.incomplete).toHaveLength(0);
  });
});

// ============================================================================
// GROUP C – Video with source but no caption track
// ============================================================================
describe('C – Video with source but no caption track', () => {
  test('C1: src attr, zero <track> children → critical violation', () => {
    const result = run('<video src="film.mp4" controls></video>');
    expect(result.violations).toHaveLength(1);
    expect(result.passes).toHaveLength(0);
    expect(result.incomplete).toHaveLength(0);
    expect(result.violations[0].id).toBe('video-captions-present');
    expect(result.violations[0].impact).toBe('critical');
  });

  test('C2: <track kind="descriptions"> only → violation (not a caption track)', () => {
    const result = run(`
      <video src="film.mp4" controls>
        <track kind="descriptions" src="desc.vtt" srclang="en" label="English descriptions">
      </video>`);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].id).toBe('video-captions-present');
  });

  test('C3: <track kind="metadata"> only → violation', () => {
    const result = run(`
      <video src="film.mp4" controls>
        <track kind="metadata" src="chapters.vtt">
      </video>`);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].id).toBe('video-captions-present');
  });

  test('C4: video uses <source> child (no src on <video>) and has no <track> → violation', () => {
    const result = run(`
      <video controls>
        <source src="film.mp4" type="video/mp4">
      </video>`);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].id).toBe('video-captions-present');
  });

  test('C5: autoplay muted video without <track> still requires captions → violation', () => {
    const result = run('<video src="background.mp4" autoplay muted loop></video>');
    // Muted hint is not checked; the rule is structural, not audio-content-aware
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].id).toBe('video-captions-present');
  });
});

// ============================================================================
// GROUP D – Caption track present but metadata incomplete
// ============================================================================
describe('D – Caption track present but incomplete metadata', () => {
  test('D1: <track kind="captions"> with no src → serious violation', () => {
    const result = run(`
      <video src="film.mp4" controls>
        <track kind="captions" srclang="en" label="English">
      </video>`);
    expect(result.violations).toHaveLength(1);
    expect(result.passes).toHaveLength(0);
    expect(result.incomplete).toHaveLength(0);
    expect(result.violations[0].id).toBe('video-captions-track-src');
    expect(result.violations[0].impact).toBe('serious');
  });

  test('D2: <track kind="captions" src="..."> with no srclang → incomplete', () => {
    const result = run(`
      <video src="film.mp4" controls>
        <track kind="captions" src="captions.vtt">
      </video>`);
    expect(result.violations).toHaveLength(0);
    expect(result.passes).toHaveLength(0);
    expect(result.incomplete).toHaveLength(1);
    expect(result.incomplete[0].id).toBe('video-captions-track-lang');
  });
});

// ============================================================================
// GROUP E – Fully conformant
// ============================================================================
describe('E – Fully conformant', () => {
  test('E1: <track kind="captions" src="..." srclang="en"> → pass', () => {
    const result = run(`
      <video src="film.mp4" controls>
        <track kind="captions" src="captions.vtt" srclang="en" label="English">
      </video>`);
    expect(result.violations).toHaveLength(0);
    expect(result.incomplete).toHaveLength(0);
    expect(result.passes).toHaveLength(1);
    expect(result.passes[0].id).toBe('video-captions-present');
  });

  test('E2: <track kind="subtitles" ...> is accepted as captions equivalent → pass', () => {
    const result = run(`
      <video src="film.mp4" controls>
        <track kind="subtitles" src="subs.vtt" srclang="fr" label="French">
      </video>`);
    expect(result.violations).toHaveLength(0);
    expect(result.incomplete).toHaveLength(0);
    expect(result.passes).toHaveLength(1);
    expect(result.passes[0].id).toBe('video-captions-present');
  });

  test('E3: multiple tracks including one captions track → pass (captions takes precedence)', () => {
    const result = run(`
      <video src="film.mp4" controls>
        <track kind="descriptions" src="desc.vtt" srclang="en" label="Descriptions">
        <track kind="captions"     src="caps.vtt" srclang="en" label="English Captions">
        <track kind="metadata"     src="meta.vtt">
      </video>`);
    expect(result.violations).toHaveLength(0);
    expect(result.incomplete).toHaveLength(0);
    expect(result.passes).toHaveLength(1);
  });

  test('E4: pass description includes srclang and label', () => {
    const result = run(`
      <video src="film.mp4" controls>
        <track kind="captions" src="en.vtt" srclang="en" label="English">
      </video>`);
    expect(result.passes[0].description).toContain('srclang="en"');
    expect(result.passes[0].description).toContain('label="English"');
  });

  test('E5: caption track with default attribute → pass', () => {
    const result = run(`
      <video src="film.mp4" controls>
        <track kind="captions" src="auto.vtt" srclang="en" default>
      </video>`);
    expect(result.passes).toHaveLength(1);
    expect(result.passes[0].id).toBe('video-captions-present');
  });
});

// ============================================================================
// GROUP F – Multiple video elements
// ============================================================================
describe('F – Multiple video elements', () => {
  test('F1: two videos – one conformant, one missing track → 1 pass + 1 violation', () => {
    const result = run(`
      <video src="good.mp4" controls>
        <track kind="captions" src="good.vtt" srclang="en">
      </video>
      <video src="bad.mp4" controls></video>`);
    expect(result.passes).toHaveLength(1);
    expect(result.violations).toHaveLength(1);
    expect(result.incomplete).toHaveLength(0);
  });

  test('F2: three videos – conformant / missing-track / no-src → 1 pass + 1 violation + 1 incomplete', () => {
    const result = run(`
      <video src="good.mp4" controls>
        <track kind="captions" src="caps.vtt" srclang="en">
      </video>
      <video src="bad.mp4" controls></video>
      <video controls></video>`);
    expect(result.passes).toHaveLength(1);
    expect(result.violations).toHaveLength(1);
    expect(result.incomplete).toHaveLength(1);
  });

  test('F3: three videos all conformant → 3 passes, no violations', () => {
    const videoHtml = (n) => `
      <video src="film${n}.mp4" controls>
        <track kind="captions" src="caps${n}.vtt" srclang="en" label="English">
      </video>`;
    const result = run(videoHtml(1) + videoHtml(2) + videoHtml(3));
    expect(result.passes).toHaveLength(3);
    expect(result.violations).toHaveLength(0);
    expect(result.incomplete).toHaveLength(0);
  });

  test('F4: three videos all missing track → 3 violations', () => {
    const result = run(`
      <video src="a.mp4" controls></video>
      <video src="b.mp4" controls></video>
      <video src="c.mp4" controls></video>`);
    expect(result.violations).toHaveLength(3);
    expect(result.passes).toHaveLength(0);
  });
});

// ============================================================================
// GROUP G – Rule ID and metadata integrity
// ============================================================================
describe('G – Rule ID and metadata integrity', () => {
  const missingTrackResult = () => run('<video src="film.mp4" controls></video>');
  const missingSrcResult   = () => run(`
    <video src="film.mp4" controls>
      <track kind="captions" srclang="en">
    </video>`);
  const missingLangResult  = () => run(`
    <video src="film.mp4" controls>
      <track kind="captions" src="caps.vtt">
    </video>`);
  const passResult = () => run(`
    <video src="film.mp4" controls>
      <track kind="captions" src="caps.vtt" srclang="en" label="English">
    </video>`);

  test('G1: missing-track violation ID is "video-captions-present"', () => {
    expect(missingTrackResult().violations[0].id).toBe('video-captions-present');
  });

  test('G2: missing-track-src violation ID is "video-captions-track-src"', () => {
    expect(missingSrcResult().violations[0].id).toBe('video-captions-track-src');
  });

  test('G3: missing-srclang incomplete ID is "video-captions-track-lang"', () => {
    expect(missingLangResult().incomplete[0].id).toBe('video-captions-track-lang');
  });

  test('G4: missing-track violation impact is "critical"', () => {
    expect(missingTrackResult().violations[0].impact).toBe('critical');
  });

  test('G5: missing-track-src violation impact is "serious"', () => {
    expect(missingSrcResult().violations[0].impact).toBe('serious');
  });

  test('G6: every violation carries the "wcag122" tag', () => {
    const v1 = missingTrackResult().violations[0];
    const v2 = missingSrcResult().violations[0];
    expect(v1.tags).toContain('wcag122');
    expect(v2.tags).toContain('wcag122');
  });

  test('G7: every incomplete result carries the "wcag122" tag', () => {
    const i = missingLangResult().incomplete[0];
    expect(i.tags).toContain('wcag122');
  });

  test('G8: violation nodes array has exactly one entry', () => {
    expect(missingTrackResult().violations[0].nodes).toHaveLength(1);
  });

  test('G9: violation node has non-empty target array', () => {
    const node = missingTrackResult().violations[0].nodes[0];
    expect(node.target).toBeDefined();
    expect(node.target.length).toBeGreaterThan(0);
  });

  test('G10: violation node failureSummary is non-empty', () => {
    const node = missingTrackResult().violations[0].nodes[0];
    expect(node.failureSummary.length).toBeGreaterThan(0);
  });

  test('G11: pass ID matches "video-captions-present"', () => {
    expect(passResult().passes[0].id).toBe('video-captions-present');
  });

  test('G12: all results include helpUrl pointing to H95 technique', () => {
    const H95 = 'https://www.w3.org/WAI/WCAG21/Techniques/html/H95';
    expect(missingTrackResult().violations[0].helpUrl).toBe(H95);
    expect(missingSrcResult().violations[0].helpUrl).toBe(H95);
    expect(missingLangResult().incomplete[0].helpUrl).toBe(H95);
  });
});
