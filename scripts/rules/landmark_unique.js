module.exports = {
  id: 'landmark-unique',
  type: 'dom',
  description: 'Landmarks must have a unique role or role/label/title combination.',
  help: 'Ensure landmarks are unique.',
  helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html',
  tags: ['wcag131'],
  impact: 'moderate',

  evaluate: function(document) {
    const violations = [];
    const passes = [];
    const incomplete = [];
    
    // Core landmark roles
    const landmarkRoles = ['banner', 'complementary', 'contentinfo', 'form', 'main', 'navigation', 'region', 'search'];
    
    // Find all landmarks
    const landmarks = [];
    
    const elements = Array.from(document.querySelectorAll('*'));
    elements.forEach(el => {
      const tag = el.tagName.toLowerCase();
      let role = el.getAttribute('role');
      
      if (!role) {
        if (tag === 'header') role = 'banner';
        if (tag === 'footer') role = 'contentinfo';
        if (tag === 'main') role = 'main';
        if (tag === 'nav') role = 'navigation';
        if (tag === 'aside') role = 'complementary';
        if (tag === 'section' && (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby'))) role = 'region';
        if (tag === 'form' && (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby'))) role = 'form';
      }
      
      if (role && landmarkRoles.includes(role)) {
        // Compute accessible name
        let name = el.getAttribute('aria-label') || '';
        if (!name && el.hasAttribute('aria-labelledby')) {
          const ids = el.getAttribute('aria-labelledby').split(/\s+/);
          name = ids.map(id => {
            const ref = document.getElementById(id);
            return ref ? ref.textContent : '';
          }).join(' ');
        }
        if (!name) name = el.getAttribute('title') || '';
        
        landmarks.push({ el, role, name: name.trim() });
      }
    });
    
    // Check for duplicates
    const counts = {};
    landmarks.forEach(lm => {
      const key = `${lm.role}::${lm.name}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    
    landmarks.forEach(lm => {
      const key = `${lm.role}::${lm.name}`;
      if (counts[key] > 1) {
        violations.push({
          html: lm.el.outerHTML.substring(0, 100),
          target: [lm.el.tagName.toLowerCase()],
          failureSummary: `Landmark has the same role ("${lm.role}") and name ("${lm.name}") as another landmark.`
        });
      } else {
        passes.push({ html: lm.el.outerHTML.substring(0, 100), target: [lm.el.tagName.toLowerCase()] });
      }
    });
    
    return { violations, passes, incomplete };
  }
};
