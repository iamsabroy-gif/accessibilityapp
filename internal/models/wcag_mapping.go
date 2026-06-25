package models

// WCAGMap maps axe‑core rule IDs to the WCAG 2.1 success‑criterion numbers they satisfy.
// A rule can cover multiple criteria, therefore the value is a slice.
var WCAGMap = map[string][]string{
    // Custom checks added in scripts/axe_runner.js
    "g58-link-to-text-alternative": {"1.2.1"},
    "h53-media-description":        {"1.2.3"},
    // WCAG 1.3.2 custom checks (Phase 1 & Phase 2)
    "meaningful-sequence-tabindex":      {"1.3.2"},
    "meaningful-sequence-css-order":     {"1.3.2"},
    "meaningful-sequence-absolute":      {"1.3.2"},
    "meaningful-sequence-grid":          {"1.3.2"},
    "video-captions-present":      {"1.2.2"},
    "video-captions-track-src":    {"1.2.2"},  // H95: missing src on <track kind="captions">
    "video-captions-track-lang":   {"1.2.2"},  // H95: missing srclang/label on <track kind="captions">
    // Core AXE rules (partial list – extend as needed)
    "accesskeys":                {"2.4.1"},
    "aria-allowed-attr":         {"4.1.2"},
    "aria-allowed-role":         {"4.1.2"},
    "aria-conditional-attr":     {"4.1.2"},
    "aria-deprecated-role":      {"4.1.2"},
    "aria-hidden-body":          {"1.3.2"},
    "aria-prohibited-attr":      {"4.1.2"},
    "aria-required-attr":        {"4.1.2"},
    "aria-roles":                {"4.1.1"},
    "aria-valid-attr-value":     {"4.1.2"},
    "aria-valid-attr":           {"4.1.2"},
    "autocomplete-valid":        {"1.3.5"},
    "avoid-inline-spacing":      {"1.4.12"},
    "button-name":               {"2.5.3"},
    "bypass":                    {"2.4.1"},
    "color-contrast":            {"1.4.3"},
    "document-title":            {"2.4.2"},
    "duplicate-id-aria":         {"4.1.1"},
    "empty-heading":             {"2.4.6"},
    "form-field-multiple-labels": {"3.3.2"},
    "heading-order":             {"2.4.10"},
    "html-has-lang":             {"3.1.1"},
    "html-lang-valid":           {"3.1.2"},
    "image-alt":                 {"1.1.1"},
    "image-redundant-alt":       {"1.1.1"},
    "label-title-only":          {"1.3.1"},
    "label":                     {"1.3.1"},
    "landmark-contentinfo-is-top-level": {"1.3.1"},
    "landmark-main-is-top-level": {"1.3.1"},
    "landmark-no-duplicate-contentinfo": {"1.3.1"},
    "landmark-no-duplicate-main": {"1.3.1"},
    "landmark-one-main":         {"1.3.1"},
    "landmark-unique":           {"1.3.1"},
    "link-name":                 {"2.4.4"},
    "list":                      {"1.3.1"},
    "listitem":                  {"1.3.1"},
    "meta-viewport-large":       {"1.4.10"},
    "meta-viewport":             {"1.4.10"},
    "nested-interactive":        {"2.1.1"},
    "page-has-heading-one":      {"2.4.6"},
    "presentation-role-conflict": {"4.1.2"},
    "region":                    {"1.3.1"},
    "select-name":               {"1.3.1"},
    "valid-lang":                {"3.1.1"},
    // Existing custom checks (previously unregistered)
    "color-only-indicator":              {"1.4.1"},
    "focus-order-cycling":               {"2.1.2", "2.4.3"},
    "meaningful-sequence-letter-spacing": {"1.3.2"},

    // Phase 1 – DOM-only new checks
    "non-text-contrast":     {"1.4.11"}, // UI component border contrast 3:1
    "error-identification":  {"3.3.1"},  // aria-invalid + accessible error message

    // Phase 2 – Puppeteer keyboard/viewport checks
    "focus-visible":           {"2.4.7"}, // visible focus indicator
    "resize-text":             {"1.4.4"}, // 200% text resize without overflow
    "on-focus-context-change": {"3.2.1"}, // no nav/dialog on focus alone

    // Phase 3 – Heuristic / partial checks (reported as incomplete)
    "orientation-lock":          {"1.3.4"}, // CSS orientation lock or screen.orientation.lock()
    "multiple-ways":             {"2.4.5"}, // search input / sitemap link
    "content-on-hover":          {"1.4.13"}, // tooltip dismissibility
    "sensory-characteristics":   {"1.3.3"}, // text heuristic – shape/colour/location cues
    "pointer-gestures":          {"2.5.1"}, // multi-touch without single-pointer fallback
    "timing-adjustable":         {"2.2.1"}, // meta refresh + short timers
}
