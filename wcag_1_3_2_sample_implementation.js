/**
 * Sample custom check for WCAG 1.3.2 (Meaningful Sequence) — C27 & C8
 *
 * This block is intended to be inserted into scripts/axe_runner.js
 * after the existing G58 / H53 custom checks (around line 180).
 *
 * It demonstrates the DOM-order-vs-visual-order detection (C27)
 * and the letter-spacing vs blank-character detection (C8).
 */

// ---------- Check C — C27 (DOM order vs visual order) ----------
const domOrderEls = Array.from(document.querySelectorAll('body, body *'));
const meaningfulSequenceViolations = [];
const meaningfulSequencePasses = [];
const meaningfulSequenceIncomplete = [];

// Whitelist of decorative / known-safe patterns
function isDecorative(el) {
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  // Skip elements that are visually hidden or 0-size
  if (rect.width === 0 && rect.height === 0) return true;
  if (style.display === 'none' || style.visibility === 'hidden') return true;
  // Skip if role is presentational
  const role = el.getAttribute('role');
  if (role === 'presentation' || role === 'none') return true;
  return false;
}

domOrderEls.forEach(el => {
  const style = window.getComputedStyle(el);
  const tag = el.tagName.toLowerCase();

  // 1. tabindex > 0 (definite violation of natural reading order)
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && parseInt(tabindex, 10) > 0) {
    meaningfulSequenceViolations.push({
      id: 'meaningful-sequence-tabindex',
      impact: 'serious',
      description: 'Element has a positive tabindex value which disrupts the natural DOM reading order.',
      help: 'Remove positive tabindex values or set tabindex="0" to keep the element in the natural focus order.',
      helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/css/C27',
      tags: ['wcag132', 'cat.structure'],
      nodes: [{ html: el.outerHTML, target: [axe.utils.getSelector(el)], failureSummary: '' }]
    });
    return;
  }

  // 2. CSS order in flex/grid container (definite violation)
  const order = style.order;
  if (order && parseInt(order, 10) !== 0) {
    const parent = el.parentElement;
    if (parent) {
      const parentStyle = window.getComputedStyle(parent);
      const parentDisplay = parentStyle.display;
      if (parentDisplay.includes('flex') || parentDisplay.includes('grid')) {
        meaningfulSequenceViolations.push({
          id: 'meaningful-sequence-css-order',
          impact: 'serious',
          description: 'Element has a non-zero CSS order value inside a flex/grid container, changing its visual position relative to the DOM order.',
          help: 'Avoid using the CSS order property to rearrange content that affects meaning. Reorder the DOM instead.',
          helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/css/C27',
          tags: ['wcag132', 'cat.structure'],
          nodes: [{ html: el.outerHTML, target: [axe.utils.getSelector(el)], failureSummary: `order: ${order}` }]
        });
        return;
      }
    }
  }

  // 3. position: absolute / fixed on meaningful content (incomplete / review needed)
  const position = style.position;
  if ((position === 'absolute' || position === 'fixed') && !isDecorative(el)) {
    // Check if element contains text or interactive content
    const hasText = el.textContent.trim().length > 0;
    const hasInteractive = el.querySelector('a, button, input, select, textarea, [tabindex]') !== null;
    if (hasText || hasInteractive) {
      meaningfulSequenceIncomplete.push({
        id: 'meaningful-sequence-absolute',
        description: `Element with position: ${position} may have been visually repositioned away from its DOM order. Manual review required to confirm reading order is preserved.`,
        nodes: [{ html: el.outerHTML, target: [axe.utils.getSelector(el)], failureSummary: `position: ${position}` }]
      });
      return;
    }
  }

  // 4. CSS Grid explicit placement (incomplete / review needed)
  const gridRow = style.gridRow;
  const gridColumn = style.gridColumn;
  const gridArea = style.gridArea;
  if ((gridRow && gridRow !== 'auto') || (gridColumn && gridColumn !== 'auto') || (gridArea && gridArea !== 'auto')) {
    meaningfulSequenceIncomplete.push({
      id: 'meaningful-sequence-grid',
      description: 'Element has explicit CSS Grid placement (grid-row / grid-column / grid-area) which may place it visually before earlier DOM siblings.',
      nodes: [{ html: el.outerHTML, target: [axe.utils.getSelector(el)], failureSummary: `grid-row: ${gridRow}, grid-column: ${gridColumn}` }]
    });
    return;
  }
});

// If no issues found, push a pass for C27
if (meaningfulSequenceViolations.length === 0 && meaningfulSequenceIncomplete.length === 0) {
  meaningfulSequencePasses.push({
    id: 'meaningful-sequence-css-order',
    description: 'No CSS ordering properties that disrupt meaningful sequence were detected.'
  });
  meaningfulSequencePasses.push({
    id: 'meaningful-sequence-tabindex',
    description: 'No positive tabindex values detected.'
  });
}

// ---------- Check D — C8 (letter-spacing vs blank characters) ----------
const letterSpacingViolations = [];
const letterSpacingPasses = [];

function walkTextNodes(node, callback) {
  if (node.nodeType === Node.TEXT_NODE) {
    callback(node);
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'pre' || tag === 'code') return;
    Array.from(node.childNodes).forEach(child => walkTextNodes(child, callback));
  }
}

const spacingEntityPattern = /&(?:nbsp|ensp|emsp|thinsp|#8203|#8194|#8195|#8196|#8197|#8198|#8199|#8200|#8201|#8202);/;
const multiSpacePattern = /\w\s{2,}\w/;

walkTextNodes(document.body, (textNode) => {
  const text = textNode.textContent;
  if (!text || text.length < 3) return;

  // Check for multiple spaces between word characters
  const hasBlankSpacing = multiSpacePattern.test(text) || spacingEntityPattern.test(text);
  if (!hasBlankSpacing) return;

  const parent = textNode.parentElement;
  if (!parent) return;

  const parentStyle = window.getComputedStyle(parent);
  const letterSpacing = parentStyle.letterSpacing;

  // If letter-spacing is explicitly set (not 'normal'), the technique is likely applied
  if (letterSpacing && letterSpacing !== 'normal' && parseFloat(letterSpacing) > 0) {
    return;
  }

  // Check inline style for letter-spacing
  const inlineStyle = parent.getAttribute('style') || '';
  if (inlineStyle.includes('letter-spacing')) {
    return;
  }

  letterSpacingViolations.push({
    id: 'meaningful-sequence-letter-spacing',
    impact: 'moderate',
    description: 'Text appears to use blank characters or multiple spaces for visual letter spacing instead of CSS letter-spacing.',
    help: 'Use the CSS letter-spacing property to control spacing within words rather than inserting blank characters.',
    helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/css/C8',
    tags: ['wcag132', 'cat.structure'],
    nodes: [{ html: parent.outerHTML, target: [axe.utils.getSelector(parent)], failureSummary: `Text: "${text.trim().substring(0, 80)}"` }]
  });
});

if (letterSpacingViolations.length === 0) {
  letterSpacingPasses.push({
    id: 'meaningful-sequence-letter-spacing',
    description: 'No blank-character spacing detected; CSS letter-spacing appears to be used correctly.'
  });
}

// Merge into custom results
// (After this block, concatenate with custom.violations / custom.passes / custom.incomplete)
