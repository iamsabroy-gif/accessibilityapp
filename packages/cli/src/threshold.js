/**
 * threshold.js — Exit-code / severity-threshold logic for the CLI.
 *
 * Pure function: given violations and threshold config, returns the exit code
 * and annotated results (which violations are failures vs warnings).
 *
 * Impact levels (ordered): critical > serious > moderate > minor
 * --fail-on is inclusive-upward: 'serious' fails on serious AND critical.
 * --warn-on violations are annotated but never affect exit code.
 * --fail-on none gives a report-only mode (always exit 0 for violations).
 */

const IMPACT_ORDER = { critical: 4, serious: 3, moderate: 2, minor: 1, none: 0 };

/**
 * Evaluate violations against threshold config.
 *
 * @param {Array} violations - Array of violation objects with `impact` field.
 * @param {Object} config
 * @param {string} [config.failOn='serious'] - Minimum impact level to trigger exit code 1.
 * @param {string} [config.warnOn='moderate'] - Minimum impact level for warnings (annotations only).
 * @returns {{ exitCode: number, failures: Array, warnings: Array, info: Array, summary: Object }}
 */
function evaluateThreshold(violations, config = {}) {
  const { failOn = 'serious', warnOn = 'moderate' } = config;
  const failLevel = IMPACT_ORDER[failOn] || 0;
  const warnLevel = IMPACT_ORDER[warnOn] || 0;

  const failures = [];
  const warnings = [];
  const info = [];

  for (const v of violations) {
    const level = IMPACT_ORDER[v.impact] || 0;

    if (failLevel > 0 && level >= failLevel) {
      failures.push({ ...v, threshold: 'fail' });
    } else if (warnLevel > 0 && level >= warnLevel) {
      warnings.push({ ...v, threshold: 'warn' });
    } else {
      info.push({ ...v, threshold: 'info' });
    }
  }

  const exitCode = failures.length > 0 ? 1 : 0;

  return {
    exitCode,
    failures,
    warnings,
    info,
    summary: {
      total: violations.length,
      failures: failures.length,
      warnings: warnings.length,
      info: info.length,
      failOn,
      warnOn,
      passed: exitCode === 0,
    },
  };
}

module.exports = { evaluateThreshold, IMPACT_ORDER };
