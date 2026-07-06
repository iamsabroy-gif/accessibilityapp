module.exports = {
  id: 'redundant-entry',
  type: 'dom',
  description: 'Information previously entered by the user must not be required again in the same process without auto-population or a selection option.',
  help: 'In multi-step forms, auto-populate or allow selection of previously entered information.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html',
  tags: ['wcag22a', 'wcag337'],
  impact: 'moderate',

  evaluate: function(document) {
    var violations = [];
    var passes = [];
    var incomplete = [];

    // Pattern 1: Shipping + billing address fields
    var shippingField = document.querySelector(
      '[name*="shipping_"], [name*="ship_"], [id*="shipping"], [class*="shipping-address"]'
    );
    var billingField = document.querySelector(
      '[name*="billing_"], [name*="bill_"], [id*="billing"], [class*="billing-address"]'
    );

    if (shippingField && billingField) {
      // Look for a "same as" checkbox within a reasonable search radius
      var sameAsCheckbox = document.querySelector(
        'input[type="checkbox"][name*="same"], ' +
        'input[type="checkbox"][id*="same"], ' +
        'input[type="checkbox"][class*="same"], ' +
        'input[type="checkbox"][aria-label*="same" i], ' +
        'input[type="checkbox"][aria-label*="billing" i]'
      );

      if (sameAsCheckbox) {
        passes.push({
          html: sameAsCheckbox.outerHTML.substring(0, 120),
          target: ['input[type="checkbox"]']
        });
      } else {
        incomplete.push({
          html: shippingField.outerHTML.substring(0, 120),
          target: [shippingField.tagName.toLowerCase()],
          failureSummary: 'Page has both shipping and billing address fields without a detected "same as shipping" checkbox. Verify the user is not required to re-enter the same address for billing (WCAG 3.3.7).'
        });
      }
      return { violations: violations, passes: passes, incomplete: incomplete };
    }

    // Pattern 2: Step/wizard progress indicators
    var stepSelectors = [
      '[aria-current="step"]',
      '[role="progressbar"]',
      '[class*="step-indicator"]',
      '[class*="wizard-step"]',
      '[class*="stepper"]',
      '[class*="multi-step"]',
      'ol[class*="steps"]',
      'ol[class*="progress"]'
    ].join(', ');

    var stepEls = Array.from(document.querySelectorAll(stepSelectors));
    if (stepEls.length > 0) {
      incomplete.push({
        html: stepEls[0].outerHTML.substring(0, 120),
        target: [stepEls[0].tagName.toLowerCase()],
        failureSummary: 'Multi-step form or wizard detected. Cannot automatically verify that previously entered information is auto-populated or selectable in later steps. Manual session-state audit required (WCAG 3.3.7).'
      });
      return { violations: violations, passes: passes, incomplete: incomplete };
    }

    // Pattern 3: Form with multiple fieldsets (possible multi-section process)
    var forms = Array.from(document.querySelectorAll('form'));
    var multiFieldsetForm = null;
    forms.forEach(function(form) {
      if (!multiFieldsetForm && form.querySelectorAll('fieldset').length >= 2) {
        multiFieldsetForm = form;
      }
    });

    if (multiFieldsetForm) {
      incomplete.push({
        html: multiFieldsetForm.outerHTML.substring(0, 120),
        target: ['form'],
        failureSummary: 'Form with multiple fieldset sections detected. If this represents a multi-step or multi-phase process where information may be collected more than once, verify auto-population or selection is available (WCAG 3.3.7).'
      });
      return { violations: violations, passes: passes, incomplete: incomplete };
    }

    // No multi-step indicators found — pass (SC may not be applicable)
    passes.push({ html: '<body>', target: ['body'] });
    return { violations: violations, passes: passes, incomplete: incomplete };
  }
};
