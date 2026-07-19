/**
 * sarif.js — SARIF 2.1.0 output formatter.
 *
 * Generates GitHub Code Scanning compatible SARIF output.
 * Maps violations to result objects with ruleId, level, message,
 * locations, and relatedLocations. Includes tool.driver.rules[]
 * with helpUri and shortDescription.
 *
 * Reference: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 * GitHub integration: https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning
 */

const { IMPACT_ORDER } = require('../threshold');

/**
 * Map impact level to SARIF result level.
 * SARIF levels: error, warning, note, none.
 */
function impactToSarifLevel(impact) {
  switch (impact) {
    case 'critical': return 'error';
    case 'serious':  return 'error';
    case 'moderate': return 'warning';
    case 'minor':    return 'note';
    default:         return 'warning';
  }
}

/**
 * Format scan results as SARIF 2.1.0.
 *
 * @param {Object} scanResult - Raw scan result from scan().
 * @param {Object} thresholdResult - Result from evaluateThreshold().
 * @returns {string} SARIF JSON string.
 */
function formatSARIF(scanResult, thresholdResult) {
  // Collect all violations (failures + warnings + info) for SARIF output
  const allViolations = [
    ...thresholdResult.failures,
    ...thresholdResult.warnings,
    ...thresholdResult.info,
  ];

  // Build unique rules list
  const rulesMap = new Map();
  for (const v of allViolations) {
    if (!rulesMap.has(v.id)) {
      rulesMap.set(v.id, {
        id: v.id,
        shortDescription: {
          text: v.help || v.description || v.id,
        },
        fullDescription: {
          text: v.description || v.help || v.id,
        },
        helpUri: v.helpUrl || `https://www.w3.org/WAI/WCAG22/Understanding/`,
        properties: {
          impact: v.impact || 'serious',
          tags: v.tags || [],
        },
      });
    }
  }

  const rules = Array.from(rulesMap.values());
  const ruleIndex = new Map(rules.map((r, i) => [r.id, i]));

  // Build results
  const results = [];
  for (const v of allViolations) {
    const nodes = v.nodes || [];
    for (const node of nodes) {
      const result = {
        ruleId: v.id,
        ruleIndex: ruleIndex.get(v.id),
        level: impactToSarifLevel(v.impact),
        message: {
          text: node.failureSummary || v.help || v.description || `Accessibility violation: ${v.id}`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: {
                uri: scanResult.url,
                uriBaseId: '%SRCROOT%',
              },
            },
            logicalLocations: [
              {
                fullyQualifiedName: (node.target && node.target[0]) || 'unknown',
                kind: 'element',
              },
            ],
          },
        ],
        properties: {
          impact: v.impact,
          html: node.html || '',
          target: node.target || [],
        },
      };

      results.push(result);
    }

    // If no nodes, still emit one result for the rule
    if (nodes.length === 0) {
      results.push({
        ruleId: v.id,
        ruleIndex: ruleIndex.get(v.id),
        level: impactToSarifLevel(v.impact),
        message: {
          text: v.help || v.description || `Accessibility violation: ${v.id}`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: {
                uri: scanResult.url,
                uriBaseId: '%SRCROOT%',
              },
            },
          },
        ],
      });
    }
  }

  const sarif = {
    $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'accessscan',
            informationUri: 'https://github.com/iamsabroy-gif/accessibilityapp',
            version: '0.1.0',
            rules,
          },
        },
        results,
        invocations: [
          {
            executionSuccessful: !scanResult.error,
            toolExecutionNotifications: scanResult.error
              ? [
                  {
                    level: 'error',
                    message: { text: scanResult.error },
                  },
                ]
              : [],
          },
        ],
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}

module.exports = { formatSARIF };
