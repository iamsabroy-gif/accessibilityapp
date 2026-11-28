/**
 * Unit tests for full-page bounding box filtering in frontend/app-v2.js.
 */

function createMockElement(tagName = 'div') {
  const listeners = {};
  const classes = new Set();
  const el = {
    tagName: tagName.toUpperCase(),
    children: [],
    dataset: {},
    style: {},
    hidden: false,
    textContent: '',
    title: '',
    type: '',
    className: '',
    attributes: {},
    complete: false,
    naturalWidth: 0,
    naturalHeight: 0,
    src: '',
    classList: {
      toggle(name, force) {
        if (force === undefined) {
          if (classes.has(name)) classes.delete(name);
          else classes.add(name);
        } else if (force) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      },
      contains(name) { return classes.has(name); },
      add(...names) { names.forEach(n => classes.add(n)); },
      remove(...names) { names.forEach(n => classes.delete(n)); },
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    addEventListener(type, fn, opts) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push({ fn, once: Boolean(opts && opts.once) });
    },
    dispatchEvent(type) {
      const list = listeners[type] || [];
      listeners[type] = list.filter(entry => !entry.once);
      list.forEach(entry => entry.fn());
    },
    querySelectorAll(selector) {
      if (selector === '.issue-indicator') {
        return this.children.filter(c => String(c.className).split(/\s+/).includes('issue-indicator'));
      }
      if (selector === 'button') {
        return this.children.filter(c => c.tagName === 'BUTTON');
      }
      return [];
    },
  };
  return el;
}

function loadAppV2() {
  const elementsById = {
    'issue-overlay': createMockElement('div'),
    'preview-filters': createMockElement('div'),
    'preview-summary': createMockElement('p'),
  };

  global.window = {
    location: { protocol: 'https:', origin: 'https://example.test', pathname: '/app', search: '', hash: '' },
    history: { replaceState: () => {} },
  };
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  global.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  global.document = {
    getElementById: id => elementsById[id] || null,
    createElement: tag => createMockElement(tag),
    querySelector: () => null,
    addEventListener: () => {},
  };

  jest?.resetModules?.();
  const app = require('../frontend/app-v2.js');
  return { app, elementsById };
}

describe('frontend/app-v2.js issue preview full-page bbox filtering', () => {
  test('isFullPageBbox detects >= 90% of both naturalWidth and naturalHeight', () => {
    const { app } = loadAppV2();
    const { isFullPageBbox } = app;

    expect(isFullPageBbox({ x: 0, y: 0, width: 1280, height: 800 }, 1280, 800)).toBe(true);
    expect(isFullPageBbox({ x: 0, y: 0, width: 1152, height: 720 }, 1280, 800)).toBe(true); // exact 90%
    expect(isFullPageBbox({ x: 0, y: 0, width: 1151, height: 720 }, 1280, 800)).toBe(false); // < 90% width
    expect(isFullPageBbox({ x: 0, y: 0, width: 1280, height: 80 }, 1280, 800)).toBe(false); // full-width banner
    expect(isFullPageBbox({ x: 0, y: 0, width: 240, height: 800 }, 1280, 800)).toBe(false); // full-height sidebar
    expect(isFullPageBbox({ x: 0, y: 0, width: 1280, height: 800 }, 0, 800)).toBe(false); // 0 naturalWidth
  });

  test('renderIssuePreview filters full-page bboxes on async image load and updates summary & filter counts', () => {
    const { app, elementsById } = loadAppV2();
    const img = createMockElement('img');
    const violations = [
      {
        id: 'document-title',
        impact: 'serious',
        help: 'Page must have title',
        nodes: [{ bbox: { x: 0, y: 0, width: 1280, height: 800 } }],
      },
      {
        id: 'color-contrast',
        impact: 'serious',
        help: 'Contrast too low',
        nodes: [{ bbox: { x: 40, y: 120, width: 200, height: 40 } }],
      },
      {
        id: 'image-alt',
        impact: 'critical',
        help: 'Missing alt',
        nodes: [{ bbox: { x: 10, y: 10, width: 1280, height: 100 } }],
      },
    ];

    app.renderIssuePreview(img, violations);
    expect(elementsById['issue-overlay'].children.length).toBe(0);

    // Simulate image finishing load
    img.complete = true;
    img.naturalWidth = 1280;
    img.naturalHeight = 800;
    img.dispatchEvent('load');

    const overlay = elementsById['issue-overlay'];
    const filters = elementsById['preview-filters'];
    const summary = elementsById['preview-summary'];

    expect(overlay.children.length).toBe(2);
    expect(summary.textContent).toBe('2 impacted components highlighted on the scanned page.');
    expect(filters.children.map(b => b.textContent)).toEqual([
      'All (2)',
      'Critical (1)',
      'Serious (1)',
    ]);
  });

  test('setupIssuePreview handles already-complete image and all-filtered-out case', () => {
    const { app } = loadAppV2();
    const img = createMockElement('img');
    img.complete = true;
    img.naturalWidth = 1000;
    img.naturalHeight = 1000;

    const overlay = createMockElement('div');
    const filters = createMockElement('div');
    const summary = createMockElement('p');

    const violations = [
      {
        id: 'html-has-lang',
        impact: 'serious',
        help: 'Missing lang',
        nodes: [{ bbox: { x: 0, y: 0, width: 950, height: 950 } }],
      },
    ];

    app.setupIssuePreview({
      image: img,
      overlay,
      filters,
      summary,
      violations,
      formatSummary: count => count
        ? `${count} impacted component${count === 1 ? '' : 's'} highlighted.`
        : 'No component positions available for this page.',
      formatTitle: v => v.id,
    });

    expect(overlay.children.length).toBe(0);
    expect(summary.textContent).toBe('No component positions available for this page.');
    expect(filters.children.map(b => b.textContent)).toEqual(['All (0)']);
  });
});
