/**
 * native_engine.js
 * 
 * The core browser-side engine for executing native accessibility rules.
 * This is injected into the page by native_runner.js.
 */

window.NativeEngine = {
  rules: [],
  
  // Register a new rule
  addRule: function(rule) {
    this.rules.push(rule);
  },

  // Run all registered rules against the document
  run: function() {
    const results = {
      violations: [],
      passes: [],
      incomplete: []
    };

    for (const rule of this.rules) {
      try {
        const result = rule.evaluate(document);
        
        // Append rule metadata to violations
        if (result.violations && result.violations.length > 0) {
          results.violations.push({
            id: rule.id,
            impact: rule.impact || 'serious',
            description: rule.description,
            help: rule.help,
            helpUrl: rule.helpUrl,
            tags: rule.tags,
            nodes: result.violations.map(v => ({
              html: v.html,
              target: v.target,
              failureSummary: v.failureSummary || ''
            }))
          });
        }

        // Passes
        if (result.passes && result.passes.length > 0) {
          results.passes.push({
            id: rule.id,
            description: rule.description,
            nodeCount: result.passes.length
          });
        }

        // Incomplete
        if (result.incomplete && result.incomplete.length > 0) {
          results.incomplete.push({
            id: rule.id,
            description: rule.description,
            nodeCount: result.incomplete.length
          });
        }
      } catch (err) {
        // If a rule fails to execute, log it as incomplete
        results.incomplete.push({
          id: rule.id,
          description: 'Rule execution failed: ' + err.message,
          nodeCount: 0
        });
      }
    }

    return results;
  }
};
