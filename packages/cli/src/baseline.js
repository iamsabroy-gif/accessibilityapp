/**
 * baseline.js — "only fail on new violations" support for the CLI.
 *
 * A baseline file records every violation known at the time it was written,
 * as fingerprints of (url, rule id, element selector, element HTML). Identical
 * fingerprints are counted, so a second copy of an already-failing element is
 * still detected as new. With --baseline, known violations are removed before
 * thresholds are evaluated, so CI fails only on regressions.
 */

const fs = require('fs');

function fingerprint(url, ruleId, node) {
  const target = node && node.target ? [].concat(node.target).join(' ') : '';
  const html = node && node.html ? String(node.html).slice(0, 300) : '';
  return `${url}|${ruleId}|${target}|${html}`;
}

/** Collect the fingerprints of every violation node in a scan result. */
function fingerprintsOf(scanResult) {
  const out = [];
  for (const v of scanResult.violations || []) {
    const nodes = v.nodes && v.nodes.length ? v.nodes : [null];
    for (const n of nodes) out.push(fingerprint(scanResult.url, v.id, n));
  }
  return out;
}

/** Load a baseline file. Returns a Map of fingerprint -> count (empty if the file is missing). */
function loadBaseline(file) {
  const counts = new Map();
  if (!fs.existsSync(file)) return counts;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const fp of Array.isArray(data.fingerprints) ? data.fingerprints : []) {
    counts.set(fp, (counts.get(fp) || 0) + 1);
  }
  return counts;
}

function saveBaseline(file, fingerprints) {
  const sorted = Array.from(fingerprints).sort();
  fs.writeFileSync(file, JSON.stringify({ version: 1, fingerprints: sorted }, null, 2) + '\n', 'utf8');
}

/**
 * Remove violations already present in the baseline.
 * A violation is kept only if it has at least one node that is not in the baseline,
 * and then only with its new nodes.
 * @returns {{ violations: Array, suppressed: number }}
 */
function filterNew(scanResult, baseline) {
  const remaining = new Map(baseline); // each known occurrence can be matched once
  const isKnown = (fp) => {
    const n = remaining.get(fp) || 0;
    if (n <= 0) return false;
    remaining.set(fp, n - 1);
    return true;
  };
  const violations = [];
  let suppressed = 0;
  for (const v of scanResult.violations || []) {
    if (!v.nodes || v.nodes.length === 0) {
      if (isKnown(fingerprint(scanResult.url, v.id, null))) suppressed++;
      else violations.push(v);
      continue;
    }
    const fresh = v.nodes.filter(n => !isKnown(fingerprint(scanResult.url, v.id, n)));
    suppressed += v.nodes.length - fresh.length;
    if (fresh.length > 0) violations.push({ ...v, nodes: fresh });
  }
  return { violations, suppressed };
}

module.exports = { fingerprintsOf, loadBaseline, saveBaseline, filterNew };
