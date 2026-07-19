/**
 * json.js — JSON output formatter.
 *
 * Passthrough of scan results with threshold annotations applied.
 * Raw violation data uses the native engine schema: id, impact, help,
 * helpUrl, tags, nodes[].{html, target, failureSummary}.
 */

/**
 * Format scan results as JSON.
 *
 * @param {Object} scanResult - Raw scan result from scan().
 * @param {Object} thresholdResult - Result from evaluateThreshold().
 * @returns {string} Pretty-printed JSON string.
 */
function formatJSON(scanResult, thresholdResult) {
  const output = {
    url: scanResult.url,
    timestamp: new Date().toISOString(),
    summary: thresholdResult.summary,
    failures: thresholdResult.failures,
    warnings: thresholdResult.warnings,
    info: thresholdResult.info,
    passes: scanResult.passes,
    incomplete: scanResult.incomplete,
  };

  if (scanResult.error) {
    output.error = scanResult.error;
  }

  return JSON.stringify(output, null, 2);
}

module.exports = { formatJSON };
