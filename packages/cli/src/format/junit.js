/**
 * junit.js — JUnit XML output formatter.
 *
 * Generates JUnit XML compatible with CI dashboards (GitLab, Jenkins,
 * CircleCI, generic test reporters). One <testsuite> per scanned URL,
 * one <testcase> per unique rule, <failure> elements for violations.
 */

/**
 * Escape XML special characters.
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format scan results as JUnit XML.
 *
 * @param {Object} scanResult - Raw scan result from scan().
 * @param {Object} thresholdResult - Result from evaluateThreshold().
 * @returns {string} JUnit XML string.
 */
function formatJUnit(scanResult, thresholdResult) {
  const allViolations = [
    ...thresholdResult.failures,
    ...thresholdResult.warnings,
    ...thresholdResult.info,
  ];

  // Collect unique rule IDs from passes and violations
  const ruleResults = new Map();

  // Mark passed rules
  for (const p of scanResult.passes || []) {
    if (p.id && !ruleResults.has(p.id)) {
      ruleResults.set(p.id, { id: p.id, status: 'passed', description: p.description });
    }
  }

  // Overwrite with violation data
  for (const v of allViolations) {
    const existing = ruleResults.get(v.id);
    if (!existing || existing.status === 'passed') {
      ruleResults.set(v.id, {
        id: v.id,
        status: 'failed',
        impact: v.impact,
        help: v.help || v.description,
        nodes: v.nodes || [],
        threshold: v.threshold,
      });
    }
  }

  const testcases = [];
  let failures = 0;
  let tests = 0;

  for (const [ruleId, data] of ruleResults) {
    tests++;
    if (data.status === 'failed') {
      failures++;

      // Build failure message from nodes
      const nodeMessages = (data.nodes || []).map((n, i) => {
        const parts = [`  Node ${i + 1}:`];
        if (n.target && n.target[0]) parts.push(`    Selector: ${n.target[0]}`);
        if (n.html) parts.push(`    HTML: ${n.html}`);
        if (n.failureSummary) parts.push(`    Issue: ${n.failureSummary}`);
        return parts.join('\n');
      });

      const failureMessage = [
        `Rule: ${ruleId}`,
        `Impact: ${data.impact || 'unknown'}`,
        `Help: ${data.help || 'N/A'}`,
        `Affected nodes (${data.nodes ? data.nodes.length : 0}):`,
        ...nodeMessages,
      ].join('\n');

      const failureType = data.threshold === 'fail' ? 'failure' : 'warning';

      testcases.push(
        `    <testcase name="${escapeXml(ruleId)}" classname="accessibility.${escapeXml(ruleId)}" time="0">`,
        `      <failure type="${failureType}" message="${escapeXml(data.help || ruleId)}">`,
        `${escapeXml(failureMessage)}`,
        `      </failure>`,
        `    </testcase>`
      );
    } else {
      testcases.push(
        `    <testcase name="${escapeXml(ruleId)}" classname="accessibility.${escapeXml(ruleId)}" time="0" />`
      );
    }
  }

  const timestamp = new Date().toISOString();
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="accessscan" tests="${tests}" failures="${failures}" time="0">`,
    `  <testsuite name="${escapeXml(scanResult.url)}" tests="${tests}" failures="${failures}" timestamp="${timestamp}">`,
    ...testcases,
    '  </testsuite>',
    '</testsuites>',
  ];

  return lines.join('\n');
}

module.exports = { formatJUnit };
