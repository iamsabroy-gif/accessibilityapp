module.exports = {
  id: 'autocomplete-valid',
  type: 'dom',
  description: 'Ensure the autocomplete attribute is correct and suitable for the form field.',
  help: 'autocomplete attribute must be used correctly.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/identify-input-purpose.html',
  tags: ['wcag135'],
  impact: 'serious',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Core HTML5 autocomplete tokens
    const validTokens = [
      'on', 'off', 'name', 'honorific-prefix', 'given-name', 'additional-name', 'family-name',
      'honorific-suffix', 'nickname', 'email', 'username', 'new-password', 'current-password',
      'organization-title', 'organization', 'street-address', 'address-line1', 'address-line2',
      'address-line3', 'address-level4', 'address-level3', 'address-level2', 'address-level1',
      'country', 'country-name', 'postal-code', 'cc-name', 'cc-given-name', 'cc-additional-name',
      'cc-family-name', 'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-type',
      'transaction-currency', 'transaction-amount', 'language', 'bday', 'bday-day', 'bday-month',
      'bday-year', 'sex', 'tel', 'tel-country-code', 'tel-national', 'tel-area-code', 'tel-local',
      'tel-extension', 'impp', 'url', 'photo'
    ];
    
    const validModifiers = ['shipping', 'billing', 'home', 'work', 'mobile', 'fax', 'pager'];
    
    const inputs = Array.from(document.querySelectorAll('input[autocomplete], select[autocomplete], textarea[autocomplete]'));
    
    inputs.forEach(el => {
      const autocomplete = el.getAttribute('autocomplete').trim().toLowerCase();
      if (autocomplete === '') return;
      
      const tokens = autocomplete.split(/\s+/);
      let isValid = true;
      
      for (const token of tokens) {
        if (!validTokens.includes(token) && !validModifiers.includes(token) && !token.startsWith('section-')) {
          isValid = false;
          break;
        }
      }
      
      if (isValid) {
        passes.push({ html: el.outerHTML.substring(0, 100), target: [el.tagName.toLowerCase()] });
      } else {
        violations.push({
          html: el.outerHTML.substring(0, 100),
          target: [el.tagName.toLowerCase()],
          failureSummary: `The autocomplete attribute value "${autocomplete}" is invalid.`
        });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
