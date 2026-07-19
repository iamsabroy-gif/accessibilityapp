module.exports = {
  id: 'consistent-help',
  type: 'dom',
  description: 'If the page contains human contact, self-help, or automated contact mechanisms, they must appear in the same relative order across pages.',
  help: 'Ensure help mechanisms (phone, email, chat, FAQ) are positioned consistently across all pages of the site.',
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html',
  tags: ['wcag22a', 'wcag326'],
  impact: 'moderate',

  evaluate: function(document) {
    var violations = [];
    var passes = [];
    var incomplete = [];

    var found = [];

    // 1. Phone links (tel:)
    var telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
    telLinks.forEach(function(el) {
      found.push({ type: 'phone link', html: el.outerHTML.substring(0, 120), target: ['a'] });
    });

    // 2. Email links (mailto:)
    var emailLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
    emailLinks.forEach(function(el) {
      found.push({ type: 'email link', html: el.outerHTML.substring(0, 120), target: ['a'] });
    });

    // 3. Help/support/contact/FAQ page links
    var helpLinkKeywords = ['faq', 'help', 'support', 'contact', 'helpdesk', 'help-center', 'helpcenter'];
    var allLinks = Array.from(document.querySelectorAll('a[href]'));
    allLinks.forEach(function(el) {
      var href = (el.getAttribute('href') || '').toLowerCase();
      var text = (el.textContent || '').trim().toLowerCase();
      var matched = helpLinkKeywords.some(function(kw) {
        return href.indexOf(kw) !== -1 || text === kw || text.indexOf('contact us') !== -1;
      });
      if (matched) {
        found.push({ type: 'help/contact link', html: el.outerHTML.substring(0, 120), target: ['a'] });
      }
    });

    // 4. Live chat widgets — common third-party class/id patterns
    var chatSelectors = [
      '[class*="intercom"]', '[id*="intercom"]',
      '[class*="zendesk"]', '[id*="zendesk"]',
      '[class*="drift-"]', '[id*="drift-"]',
      '[class*="crisp-"]', '[id*="crisp-"]',
      '[class*="freshchat"]', '[id*="freshchat"]',
      '[class*="livechat"]', '[id*="livechat"]',
      '[class*="chat-widget"]', '[id*="chat-widget"]',
      '[data-testid*="chat"]'
    ].join(', ');
    var chatWidgets = Array.from(document.querySelectorAll(chatSelectors));
    chatWidgets.forEach(function(el) {
      found.push({ type: 'chat widget', html: el.outerHTML.substring(0, 120), target: [el.tagName.toLowerCase()] });
    });

    // 5. ARIA-labelled elements suggesting help
    var ariaEls = Array.from(document.querySelectorAll('[aria-label]')).filter(function(el) {
      var lbl = (el.getAttribute('aria-label') || '').toLowerCase();
      return lbl.indexOf('help') !== -1 || lbl.indexOf('support') !== -1 ||
             lbl.indexOf('contact') !== -1 || lbl.indexOf('chat') !== -1;
    });
    ariaEls.forEach(function(el) {
      found.push({ type: 'aria-labelled help element', html: el.outerHTML.substring(0, 120), target: [el.tagName.toLowerCase()] });
    });

    if (found.length === 0) {
      // SC 3.2.6 is not applicable when no help mechanisms exist
      passes.push({ html: '<body>', target: ['body'] });
      return { violations: violations, passes: passes, incomplete: incomplete };
    }

    // Deduplicate by html snippet to avoid reporting the same element via multiple patterns
    var seen = {};
    found.forEach(function(item) {
      if (seen[item.html]) return;
      seen[item.html] = true;
      incomplete.push({
        html: item.html,
        target: item.target,
        failureSummary: 'Help mechanism detected (' + item.type + '). Cannot verify it appears in the same relative order across all pages — multi-page manual audit required per WCAG 3.2.6.'
      });
    });

    return { violations: violations, passes: passes, incomplete: incomplete };
  }
};
