package models

// SuggestionMap maps axe-core and custom rule IDs to developer-facing fix guidance.
// Every entry provides a concrete before/after code example and ordered fix steps.
// Rules not present here return nil – callers must nil-check before use.
var SuggestionMap = map[string]*DevSuggestion{

	// ── 1.1.1 Non-text Content ───────────────────────────────────────────────
	"image-alt": {
		Title:    "Add a descriptive alt attribute to the image",
		Language: "html",
		FixSteps: []string{
			"Identify the purpose of the image (informative, decorative, functional).",
			"For informative images: set alt to a concise description of what the image conveys.",
			"For decorative images: set alt=\"\" (empty string) so screen readers skip it.",
			"For functional images (e.g., inside a button): describe the action, not the image.",
		},
		CodeBefore: `<img src="logo.png">
<img src="divider.png">
<button><img src="search-icon.png"></button>`,
		CodeAfter: `<img src="logo.png" alt="Acme Corp logo">
<img src="divider.png" alt="">
<button><img src="search-icon.png" alt="Search"></button>`,
	},
	"image-redundant-alt": {
		Title:    "Remove redundant alt text that duplicates adjacent text",
		Language: "html",
		FixSteps: []string{
			"Check whether the image alt text repeats the caption or surrounding text.",
			"If the adjacent text already describes the image, set alt=\"\" to avoid duplication.",
		},
		CodeBefore: `<figure>
  <img src="chart.png" alt="Sales chart">
  <figcaption>Sales chart</figcaption>
</figure>`,
		CodeAfter: `<figure>
  <img src="chart.png" alt="">
  <figcaption>Sales chart</figcaption>
</figure>`,
	},

	// ── 1.2.1 Audio-only and Video-only ─────────────────────────────────────
	"g58-media-alternative-link": {
		Title:    "Add a link to a transcript immediately adjacent to the media element",
		Language: "html",
		FixSteps: []string{
			"Create a text transcript of the audio/video content.",
			"Host it as a separate page or inline section.",
			"Place a clearly-labelled anchor link directly before or after the media element.",
		},
		CodeBefore: `<video src="interview.mp4" controls></video>`,
		CodeAfter: `<video src="interview.mp4" controls></video>
<p><a href="interview-transcript.html">Read the full transcript</a></p>`,
	},

	// ── 1.2.2 Captions (Prerecorded) ────────────────────────────────────────
	"video-captions-present": {
		Title:    "Add a <track kind=\"captions\"> to the video element",
		Language: "html",
		FixSteps: []string{
			"Create a WebVTT (.vtt) caption file for the video's dialogue and sound cues.",
			"Add a <track> element as a direct child of <video>.",
			`Set kind="captions", src to the .vtt file path, srclang to the BCP-47 language code, and label to a human-readable name.`,
			"Set default on the track if captions should be on by default.",
		},
		CodeBefore: `<video src="movie.mp4" controls>
</video>`,
		CodeAfter: `<video src="movie.mp4" controls>
  <track kind="captions"
         src="movie-captions-en.vtt"
         srclang="en"
         label="English captions"
         default>
</video>`,
	},
	"video-captions-track-src": {
		Title:    "Add a src attribute pointing to the caption file on the <track> element",
		Language: "html",
		FixSteps: []string{
			"Provide the URL of a WebVTT (.vtt) caption file in the src attribute.",
			"Ensure the file is accessible from the page origin (check CORS if cross-origin).",
		},
		CodeBefore: `<track kind="captions" srclang="en" label="English">`,
		CodeAfter:  `<track kind="captions" src="captions-en.vtt" srclang="en" label="English">`,
	},
	"video-captions-track-lang": {
		Title:    "Add srclang and label attributes to the <track kind=\"captions\"> element",
		Language: "html",
		FixSteps: []string{
			"Set srclang to a BCP-47 language tag (e.g. \"en\", \"fr\", \"ar\").",
			"Set label to a human-readable caption track name (e.g. \"English captions\").",
			"These attributes let browsers and assistive technologies identify and select tracks.",
		},
		CodeBefore: `<track kind="captions" src="captions.vtt">`,
		CodeAfter:  `<track kind="captions" src="captions.vtt" srclang="en" label="English captions">`,
	},

	// ── 1.3.1 Info and Relationships ────────────────────────────────────────
	"label": {
		Title:    "Associate a visible <label> with every form input",
		Language: "html",
		FixSteps: []string{
			"Add a <label> element with a for attribute matching the input's id.",
			"Or wrap the input inside the <label> element (implicit association).",
			"Avoid relying solely on placeholder text — placeholders disappear when typing.",
		},
		CodeBefore: `<input type="email" placeholder="Email address">`,
		CodeAfter: `<label for="email">Email address</label>
<input id="email" type="email" placeholder="user@example.com">`,
	},
	"label-title-only": {
		Title:    "Replace title-only labelling with a visible <label>",
		Language: "html",
		FixSteps: []string{
			"Remove the title attribute used as the only accessible name.",
			"Add a visible <label> associated via for/id, or use aria-label.",
			"title attributes are not reliably exposed by all screen readers.",
		},
		CodeBefore: `<input type="text" title="Search">`,
		CodeAfter: `<label for="search">Search</label>
<input id="search" type="text">`,
	},
	"landmark-one-main": {
		Title:    "Wrap the main page content in a <main> landmark",
		Language: "html",
		FixSteps: []string{
			"Identify the primary content area of the page.",
			"Wrap it in a single <main> element (or add role=\"main\" to an existing container).",
			"Ensure there is only one <main> per page.",
		},
		CodeBefore: `<div id="content">
  <h1>Welcome</h1>
  <p>...</p>
</div>`,
		CodeAfter: `<main id="content">
  <h1>Welcome</h1>
  <p>...</p>
</main>`,
	},
	"region": {
		Title:    "Wrap page sections in ARIA landmark elements",
		Language: "html",
		FixSteps: []string{
			"Use semantic HTML5 elements: <header>, <nav>, <main>, <aside>, <footer>.",
			"For generic containers that need a landmark role, add role=\"region\" and aria-label.",
			"This allows keyboard and AT users to skip directly to major page sections.",
		},
		CodeBefore: `<div class="sidebar">Related links</div>`,
		CodeAfter: `<aside aria-label="Related links">Related links</aside>`,
	},
	"list": {
		Title:    "Use semantic list markup for groups of related items",
		Language: "html",
		FixSteps: []string{
			"Replace div/span sequences with <ul>/<ol> containing <li> children.",
			"Use <ul> for unordered lists and <ol> for ordered/sequential lists.",
		},
		CodeBefore: `<div class="list">
  <div>Item one</div>
  <div>Item two</div>
</div>`,
		CodeAfter: `<ul>
  <li>Item one</li>
  <li>Item two</li>
</ul>`,
	},
	"listitem": {
		Title:    "Ensure <li> elements are direct children of <ul> or <ol>",
		Language: "html",
		FixSteps: []string{
			"Move <li> elements inside a parent <ul> or <ol>.",
			"Never use <li> outside a list container.",
		},
		CodeBefore: `<div>
  <li>Item</li>
</div>`,
		CodeAfter: `<ul>
  <li>Item</li>
</ul>`,
	},
	"select-name": {
		Title:    "Add an accessible name to the <select> element",
		Language: "html",
		FixSteps: []string{
			"Associate a <label> with the <select> using matching for/id attributes.",
			"Alternatively use aria-label or aria-labelledby on the <select>.",
		},
		CodeBefore: `<select>
  <option>Option 1</option>
</select>`,
		CodeAfter: `<label for="country">Country</label>
<select id="country">
  <option>Option 1</option>
</select>`,
	},

	// ── 1.3.2 Meaningful Sequence ───────────────────────────────────────────
	"meaningful-sequence-tabindex": {
		Title:    "Remove positive tabindex values to restore natural DOM focus order",
		Language: "html",
		FixSteps: []string{
			"Remove tabindex values greater than 0 from all elements.",
			"Use tabindex=\"0\" to make a non-interactive element focusable without changing order.",
			"Use tabindex=\"-1\" to allow programmatic focus only (e.g., for modals).",
			"Re-order the DOM itself if a different visual sequence is required.",
		},
		CodeBefore: `<button tabindex="3">First visually</button>
<button tabindex="1">Second visually</button>
<button tabindex="2">Third visually</button>`,
		CodeAfter: `<button>First visually</button>
<button>Second visually</button>
<button>Third visually</button>`,
	},
	"meaningful-sequence-css-order": {
		Title:    "Remove CSS order property to match visual and DOM sequence",
		Language: "css",
		FixSteps: []string{
			"Restructure the DOM so source order matches the intended reading/visual order.",
			"If reordering DOM is not possible, document the intended reading order.",
			"Remove or set order: 0 on flex/grid children.",
		},
		CodeBefore: `.card:nth-child(1) { order: 3; }
.card:nth-child(2) { order: 1; }
.card:nth-child(3) { order: 2; }`,
		CodeAfter: `/* Reorder elements in the HTML instead of CSS order */
/* DOM order should reflect reading/tab order */`,
	},
	"meaningful-sequence-letter-spacing": {
		Title:    "Use CSS letter-spacing instead of spacing characters",
		Language: "css",
		FixSteps: []string{
			"Remove extra spaces, &nbsp;, or Unicode spacing characters used for visual spacing.",
			"Apply CSS letter-spacing property to achieve the same visual effect.",
		},
		CodeBefore: `<h1>W E L C O M E</h1>`,
		CodeAfter: `<h1 style="letter-spacing: 0.5em;">WELCOME</h1>`,
	},

	// ── 1.3.3 Sensory Characteristics ───────────────────────────────────────
	"sensory-characteristics": {
		Title:    "Add non-sensory identifiers alongside shape, colour, or location cues",
		Language: "html",
		FixSteps: []string{
			"Identify instructions that rely only on shape, colour, size, or position.",
			"Add a text label, role, or aria-label so the element can be identified without vision.",
			"Example: instead of \"click the red button\", say \"click the Submit button (highlighted in red)\".",
		},
		CodeBefore: `<p>Click the round icon on the left to continue.</p>`,
		CodeAfter: `<p>Click the <strong>Continue</strong> button (the circular arrow icon on the left).</p>`,
	},

	// ── 1.3.4 Orientation ───────────────────────────────────────────────────
	"orientation-lock": {
		Title:    "Remove CSS or JS that restricts display to a single orientation",
		Language: "css",
		FixSteps: []string{
			"Remove @media (orientation: portrait/landscape) rules that hide main content.",
			"Remove calls to screen.orientation.lock() unless the functionality is essential.",
			"Test the page in both orientations to confirm full functionality.",
		},
		CodeBefore: `@media (orientation: portrait) {
  main { display: none; }
  .rotate-msg { display: block; }
}`,
		CodeAfter: `/* Allow content to reflow in both orientations */
/* Use responsive layout instead of orientation lock */
@media (max-width: 600px) {
  .sidebar { display: none; }
}`,
	},

	// ── 1.3.5 Identify Input Purpose ────────────────────────────────────────
	"autocomplete-valid": {
		Title:    "Add a valid autocomplete attribute to personal data inputs",
		Language: "html",
		FixSteps: []string{
			"Identify inputs that collect personal information (name, email, address, etc.).",
			"Set the autocomplete attribute to the appropriate HTML5 autocomplete token.",
			"See the full list: https://html.spec.whatwg.org/multipage/form-elements.html#autofilling-form-controls:-the-autocomplete-attribute",
		},
		CodeBefore: `<input type="text" name="firstname">
<input type="email" name="email">`,
		CodeAfter: `<input type="text" name="firstname" autocomplete="given-name">
<input type="email" name="email" autocomplete="email">`,
	},

	// ── 1.4.1 Use of Color ───────────────────────────────────────────────────
	"color-only-indicator": {
		Title:    "Add a non-colour cue (icon or text) alongside colour-only state changes",
		Language: "css",
		FixSteps: []string{
			"Identify elements that use only background or border colour to indicate state (focus, error, selection).",
			"Add a visible icon, underline, pattern, or text label to supplement the colour change.",
			"Ensure the added cue is visible without colour perception.",
		},
		CodeBefore: `/* Only colour changes on :invalid */
input:invalid {
  border-color: red;
}`,
		CodeAfter: `input:invalid {
  border-color: #c0392b;
  border-width: 2px;
}
/* Add an icon via pseudo-element or adjacent element */
input:invalid + .error-icon { display: inline; }`,
	},

	// ── 1.4.3 Contrast (Minimum) ────────────────────────────────────────────
	"color-contrast": {
		Title:    "Increase text-to-background contrast to at least 4.5:1",
		Language: "css",
		FixSteps: []string{
			"Use a contrast-checking tool (e.g. https://webaim.org/resources/contrastchecker/) to measure the ratio.",
			"For normal text: minimum 4.5:1 ratio required.",
			"For large text (18pt+ / 14pt bold+): minimum 3:1 ratio required.",
			"Darken the text colour or lighten/darken the background until the ratio is met.",
		},
		CodeBefore: `/* Fails: #777 on #fff = 4.48:1 for small text */
p { color: #777777; background: #ffffff; }`,
		CodeAfter: `/* Passes: #595959 on #fff = 7.0:1 */
p { color: #595959; background: #ffffff; }`,
	},

	// ── 1.4.4 Resize Text ───────────────────────────────────────────────────
	"resize-text": {
		Title:    "Use relative units and avoid overflow:hidden on text containers",
		Language: "css",
		FixSteps: []string{
			"Replace px font sizes with em, rem, or % so browser zoom affects them.",
			"Remove overflow: hidden from containers that contain text.",
			"Use min-height instead of height on text containers so they grow with content.",
			"Test at 200% browser zoom: no content should be clipped or require horizontal scrolling.",
		},
		CodeBefore: `body { font-size: 14px; }
.card { height: 200px; overflow: hidden; }`,
		CodeAfter: `body { font-size: 1rem; } /* inherits browser default (typically 16px) */
.card { min-height: 200px; overflow: visible; }`,
	},

	// ── 1.4.10 Reflow ───────────────────────────────────────────────────────
	"meta-viewport": {
		Title:    "Remove user-scalable=no and maximum-scale restrictions from the viewport meta",
		Language: "html",
		FixSteps: []string{
			"Remove user-scalable=no or user-scalable=0 from the content attribute.",
			"Remove maximum-scale=1 or any scale cap below 5.",
			"This allows users to pinch-zoom the page on mobile devices.",
		},
		CodeBefore: `<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no, maximum-scale=1">`,
		CodeAfter:  `<meta name="viewport" content="width=device-width, initial-scale=1">`,
	},
	"meta-viewport-large": {
		Title:    "Ensure the viewport allows user scaling up to 500%",
		Language: "html",
		FixSteps: []string{
			"Remove maximum-scale restrictions from the meta viewport tag.",
			"Allow the browser default scaling behaviour.",
		},
		CodeBefore: `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=2">`,
		CodeAfter:  `<meta name="viewport" content="width=device-width, initial-scale=1">`,
	},

	// ── 1.4.11 Non-text Contrast ────────────────────────────────────────────
	"non-text-contrast": {
		Title:    "Increase UI component border/outline contrast to at least 3:1",
		Language: "css",
		FixSteps: []string{
			"Identify the border or outline colour of the component and its adjacent background.",
			"Use a contrast checker set to 3:1 (non-text threshold).",
			"Darken the border or adjust the background until the 3:1 ratio is met.",
			"Also apply to focus indicators: the focus ring must achieve 3:1 against adjacent colours.",
		},
		CodeBefore: `/* Border #ccc on #fff = 1.6:1 – fails */
input {
  border: 1px solid #cccccc;
  background: #ffffff;
}`,
		CodeAfter: `/* Border #767676 on #fff = 4.54:1 – passes */
input {
  border: 2px solid #767676;
  background: #ffffff;
}`,
	},

	// ── 1.4.12 Text Spacing ──────────────────────────────────────────────────
	"avoid-inline-spacing": {
		Title:    "Remove !important overrides on text-spacing CSS properties",
		Language: "css",
		FixSteps: []string{
			"Find CSS rules that use !important on line-height, letter-spacing, word-spacing, or margin.",
			"Remove the !important declaration so user stylesheets can override them.",
			"Test with a text spacing bookmarklet (https://www.html5accessibility.com/tests/tsbookmarklet.html).",
		},
		CodeBefore: `p {
  line-height: 1.2 !important;
  letter-spacing: 0 !important;
}`,
		CodeAfter: `p {
  line-height: 1.5;
  letter-spacing: 0.05em;
}`,
	},

	// ── 1.4.13 Content on Hover or Focus ────────────────────────────────────
	"content-on-hover": {
		Title:    "Make tooltip/popup content dismissible, hoverable, and persistent",
		Language: "js",
		FixSteps: []string{
			"Add an Escape key listener that hides the tooltip when triggered.",
			"Ensure the tooltip element itself is hoverable (pointer-events: auto) so users can move to it.",
			"Do not auto-dismiss the tooltip when the user moves between the trigger and the tooltip.",
			"Keep the tooltip visible until the user explicitly dismisses it or moves focus away.",
		},
		CodeBefore: `// Tooltip disappears immediately on mouseleave
trigger.addEventListener('mouseleave', () => tooltip.hidden = true);`,
		CodeAfter: `// Escape key dismissal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') tooltip.hidden = true;
});

// Keep open while hovering the tooltip itself
tooltip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
trigger.addEventListener('mouseleave', () => {
  hideTimer = setTimeout(() => tooltip.hidden = true, 300);
});`,
	},

	// ── 2.1.1 Keyboard ──────────────────────────────────────────────────────
	"nested-interactive": {
		Title:    "Remove nested interactive elements (e.g. button inside a link)",
		Language: "html",
		FixSteps: []string{
			"Identify interactive elements nested inside other interactive elements.",
			"Restructure the markup so interactive elements are siblings, not ancestors/descendants.",
			"A <button> must not be inside an <a>, and vice versa.",
		},
		CodeBefore: `<a href="/product">
  Product Name
  <button>Add to cart</button>
</a>`,
		CodeAfter: `<div class="product-card">
  <a href="/product">Product Name</a>
  <button>Add to cart</button>
</div>`,
	},

	// ── 2.1.2 No Keyboard Trap ──────────────────────────────────────────────
	"focus-order-cycling": {
		Title:    "Ensure focus cycles through the page and modals can be dismissed with Escape",
		Language: "js",
		FixSteps: []string{
			"Remove positive tabindex values that break the natural focus order.",
			"For modal dialogs: trap focus inside the modal while open, release on close.",
			"Add an Escape key listener to close modals and return focus to the opener.",
			"After closing the modal, return focus to the element that triggered it.",
		},
		CodeBefore: `// Modal opens but Escape doesn't close it
document.querySelector('.modal').showModal();`,
		CodeAfter: `const modal = document.querySelector('.modal');
const opener = document.activeElement;

modal.showModal();

modal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    modal.close();
    opener.focus(); // return focus to trigger
  }
});`,
	},

	// ── 2.2.1 Timing Adjustable ─────────────────────────────────────────────
	"timing-adjustable": {
		Title:    "Remove automatic page refresh or provide a way to extend/dismiss time limits",
		Language: "html",
		FixSteps: []string{
			"Remove <meta http-equiv=\"refresh\"> tags that cause automatic redirects.",
			"If a time limit is essential (e.g. session timeout): warn the user at least 20 seconds in advance.",
			"Provide a button to extend the session before expiry.",
			"If using setTimeout for a UI timer, add pause/extend controls visible to the user.",
		},
		CodeBefore: `<meta http-equiv="refresh" content="30; url=/timeout">`,
		CodeAfter: `<!-- Remove the meta refresh; implement a session warning dialog instead -->
<div role="alertdialog" aria-modal="true" aria-labelledby="timeout-title" hidden id="timeout-warning">
  <h2 id="timeout-title">Your session is about to expire</h2>
  <p>Click below to stay logged in.</p>
  <button id="extend-session">Extend session</button>
</div>`,
	},

	// ── 2.4.1 Bypass Blocks ─────────────────────────────────────────────────
	"bypass": {
		Title:    "Add a skip-navigation link as the first focusable element",
		Language: "html",
		FixSteps: []string{
			"Add a visually-hidden anchor as the very first element in <body>.",
			"Show it on :focus so keyboard users can see it.",
			"Link it to the main content landmark (#main-content).",
		},
		CodeBefore: `<body>
  <nav>...long navigation...</nav>
  <main id="main-content">...</main>
</body>`,
		CodeAfter: `<body>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <nav>...long navigation...</nav>
  <main id="main-content">...</main>
</body>

<style>
.skip-link {
  position: absolute; top: -40px; left: 0;
  background: #000; color: #fff; padding: .5rem 1rem;
  z-index: 9999; text-decoration: none;
}
.skip-link:focus { top: 0; }
</style>`,
	},

	// ── 2.4.2 Page Titled ───────────────────────────────────────────────────
	"document-title": {
		Title:    "Add a descriptive <title> element to the page",
		Language: "html",
		FixSteps: []string{
			"Add a <title> inside <head> that uniquely identifies the page.",
			"Format: \"Page Name – Site Name\" to give context in both browser tabs and screen readers.",
			"Update the title dynamically in single-page applications when the view changes.",
		},
		CodeBefore: `<head>
  <meta charset="UTF-8">
</head>`,
		CodeAfter: `<head>
  <meta charset="UTF-8">
  <title>Shopping Cart – Acme Store</title>
</head>`,
	},

	// ── 2.4.3 Focus Order ───────────────────────────────────────────────────
	"accesskeys": {
		Title:    "Remove duplicate or conflicting accesskey attributes",
		Language: "html",
		FixSteps: []string{
			"Audit all accesskey attributes across the page.",
			"Ensure each key value is unique and does not conflict with browser/OS shortcuts.",
			"Consider removing accesskeys entirely — they cause more problems than they solve for most users.",
		},
		CodeBefore: `<a href="/" accesskey="h">Home</a>
<a href="/help" accesskey="h">Help</a>`,
		CodeAfter: `<a href="/">Home</a>
<a href="/help">Help</a>`,
	},

	// ── 2.4.4 Link Purpose ──────────────────────────────────────────────────
	"link-name": {
		Title:    "Add descriptive accessible text to every link",
		Language: "html",
		FixSteps: []string{
			"Replace generic link text (\"click here\", \"read more\", \"learn more\") with descriptive text.",
			"If the link contains only an image, set a descriptive alt attribute on the image.",
			"Use aria-label or aria-labelledby to supplement ambiguous link text.",
		},
		CodeBefore: `<a href="/report.pdf">Click here</a>
<a href="/about"><img src="arrow.svg"></a>`,
		CodeAfter: `<a href="/report.pdf">Download the 2024 Annual Report (PDF)</a>
<a href="/about"><img src="arrow.svg" alt="About us"></a>`,
	},

	// ── 2.4.5 Multiple Ways ──────────────────────────────────────────────────
	"multiple-ways": {
		Title:    "Add site search or a sitemap link to provide multiple navigation paths",
		Language: "html",
		FixSteps: []string{
			"Add a site-wide search form with role=\"search\" or input[type=search].",
			"Alternatively provide a sitemap page and link to it from the footer or header.",
			"Both mechanisms allow users who cannot navigate the main menu to find content.",
		},
		CodeBefore: `<nav>
  <a href="/">Home</a>
  <a href="/about">About</a>
</nav>`,
		CodeAfter: `<nav>
  <a href="/">Home</a>
  <a href="/about">About</a>
  <a href="/sitemap">Sitemap</a>
</nav>
<form role="search" action="/search">
  <label for="q">Search site</label>
  <input id="q" type="search" name="q">
  <button type="submit">Search</button>
</form>`,
	},

	// ── 2.4.6 Headings and Labels ───────────────────────────────────────────
	"empty-heading": {
		Title:    "Add visible text content to the heading element",
		Language: "html",
		FixSteps: []string{
			"Provide meaningful text inside every heading tag.",
			"If the heading is used purely for layout, replace it with a div and use CSS for styling.",
		},
		CodeBefore: `<h2></h2>
<h3><img src="icon.svg"></h3>`,
		CodeAfter: `<h2>Product Features</h2>
<h3><img src="icon.svg" alt="Features overview"></h3>`,
	},
	"page-has-heading-one": {
		Title:    "Add a single <h1> that describes the main content of the page",
		Language: "html",
		FixSteps: []string{
			"Each page should have exactly one <h1> representing the primary topic.",
			"Place the <h1> early in the <main> content area.",
			"Do not use the <h1> for the site logo or navigation.",
		},
		CodeBefore: `<body>
  <div class="logo">Acme Corp</div>
  <main>
    <h2>Welcome to our site</h2>
  </main>
</body>`,
		CodeAfter: `<body>
  <header>
    <a href="/" class="logo">Acme Corp</a>
  </header>
  <main>
    <h1>Welcome to Acme Corp</h1>
  </main>
</body>`,
	},
	"heading-order": {
		Title:    "Fix heading hierarchy to avoid skipping levels",
		Language: "html",
		FixSteps: []string{
			"Headings must not skip levels: h1 → h2 → h3, not h1 → h3.",
			"Use headings to reflect document structure, not visual style.",
			"If you need visually smaller text, use CSS rather than a lower heading level.",
		},
		CodeBefore: `<h1>Page Title</h1>
<h3>Section</h3>   <!-- skips h2 -->
<h5>Subsection</h5>`,
		CodeAfter: `<h1>Page Title</h1>
<h2>Section</h2>
<h3>Subsection</h3>`,
	},

	// ── 2.4.7 Focus Visible ─────────────────────────────────────────────────
	"focus-visible": {
		Title:    "Add a visible :focus-visible outline to all interactive elements",
		Language: "css",
		FixSteps: []string{
			"Remove or scope rules that set outline: none or outline: 0 on :focus.",
			"Add a high-contrast :focus-visible rule with at least 3:1 contrast.",
			"Use box-shadow as an alternative to outline for styled components.",
			"Test by tabbing through the page: every interactive element must show a visible indicator.",
		},
		CodeBefore: `/* Removes all focus indicators – NEVER do this */
* { outline: none; }`,
		CodeAfter: `/* Restore native outline for keyboard users only */
:focus-visible {
  outline: 3px solid #4f46e5;
  outline-offset: 2px;
  border-radius: 2px;
}`,
	},

	// ── 2.4.10 Section Headings ─────────────────────────────────────────────
	"heading-order-deprecated": {
		Title:    "Ensure heading levels reflect section structure",
		Language: "html",
		FixSteps: []string{
			"Each heading level should represent a deeper section in the page structure.",
			"Avoid using headings purely for visual size — use CSS font-size instead.",
		},
		CodeBefore: `<h1>Blog</h1>
<h4>Post Title</h4>`,
		CodeAfter: `<h1>Blog</h1>
<h2>Post Title</h2>`,
	},

	// ── 2.5.1 Pointer Gestures ──────────────────────────────────────────────
	"pointer-gestures": {
		Title:    "Add a single-pointer (click/tap) alternative to every multipoint gesture",
		Language: "js",
		FixSteps: []string{
			"Identify all multipoint gestures (pinch-to-zoom, two-finger swipe, etc.).",
			"Add an equivalent control operable with a single pointer (buttons, sliders, links).",
			"Do not rely solely on path-based gestures (swipe) without an alternative action.",
		},
		CodeBefore: `// Pinch to zoom – no single-pointer alternative
canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) handlePinch(e);
});`,
		CodeAfter: `// Pinch gesture retained, but zoom buttons added as alternative
canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) handlePinch(e);
});

document.getElementById('zoom-in').addEventListener('click', () => zoomIn());
document.getElementById('zoom-out').addEventListener('click', () => zoomOut());`,
	},

	// ── 3.1.1 Language of Page ──────────────────────────────────────────────
	"html-has-lang": {
		Title:    "Add a lang attribute to the <html> element",
		Language: "html",
		FixSteps: []string{
			"Add lang=\"xx\" to the opening <html> tag using the appropriate BCP-47 language code.",
			"Common codes: en (English), fr (French), de (German), ar (Arabic), zh (Chinese).",
			"Screen readers use this to select the correct speech synthesis voice.",
		},
		CodeBefore: `<html>`,
		CodeAfter:  `<html lang="en">`,
	},
	"html-lang-valid": {
		Title:    "Use a valid BCP-47 language code on the <html> element",
		Language: "html",
		FixSteps: []string{
			"Replace the invalid lang value with a valid BCP-47 code.",
			"See the IANA subtag registry: https://www.iana.org/assignments/language-subtag-registry",
		},
		CodeBefore: `<html lang="english">`,
		CodeAfter:  `<html lang="en">`,
	},
	"valid-lang": {
		Title:    "Use a valid BCP-47 language code on the lang attribute",
		Language: "html",
		FixSteps: []string{
			"Correct the lang attribute value to a valid BCP-47 subtag.",
			"Check nested elements with lang attributes (e.g., quotes in another language).",
		},
		CodeBefore: `<blockquote lang="francais">Bonjour</blockquote>`,
		CodeAfter:  `<blockquote lang="fr">Bonjour</blockquote>`,
	},

	// ── 3.2.1 On Focus ──────────────────────────────────────────────────────
	"on-focus-context-change": {
		Title:    "Move context-changing behaviour from focus to click/change events",
		Language: "js",
		FixSteps: []string{
			"Identify handlers attached to focus events that navigate, open dialogs, or submit forms.",
			"Move those actions to click, change, or keydown (Enter/Space) events instead.",
			"Focus events should only highlight or describe the element, never trigger navigation.",
		},
		CodeBefore: `// BAD: navigates on focus
input.addEventListener('focus', () => {
  window.location.href = '/step-2';
});`,
		CodeAfter: `// GOOD: navigate on explicit user action
form.addEventListener('submit', (e) => {
  e.preventDefault();
  window.location.href = '/step-2';
});`,
	},

	// ── 3.3.1 Error Identification ──────────────────────────────────────────
	"error-identification": {
		Title:    "Associate an accessible error message with every invalid form field",
		Language: "html",
		FixSteps: []string{
			"Add aria-invalid=\"true\" to the input when it fails validation.",
			"Create an error message element with a unique id.",
			"Link it to the input via aria-describedby.",
			"Ensure the error message element is visible and non-empty when the error occurs.",
		},
		CodeBefore: `<input type="email" class="error">
<span class="error-msg">Invalid email address</span>`,
		CodeAfter: `<input type="email"
       id="email"
       aria-invalid="true"
       aria-describedby="email-error">
<span id="email-error" role="alert">
  Invalid email address – please enter a valid email (e.g. user@example.com)
</span>`,
	},

	// ── 3.3.2 Labels or Instructions ────────────────────────────────────────
	"form-field-multiple-labels": {
		Title:    "Remove duplicate labels from the form field",
		Language: "html",
		FixSteps: []string{
			"A form control must have exactly one accessible name.",
			"Remove duplicate <label> elements or conflicting aria-label/aria-labelledby attributes.",
			"Use a single visible <label> associated with for/id.",
		},
		CodeBefore: `<label for="name">Full name</label>
<input id="name" type="text" aria-label="Name">`,
		CodeAfter: `<label for="name">Full name</label>
<input id="name" type="text">`,
	},

	// ── 4.1.1 Parsing ───────────────────────────────────────────────────────
	"aria-roles": {
		Title:    "Use only valid ARIA roles on elements",
		Language: "html",
		FixSteps: []string{
			"Replace invalid or misspelled role values with valid WAI-ARIA roles.",
			"See the full role list: https://www.w3.org/TR/wai-aria-1.1/#role_definitions",
			"Prefer native HTML elements over ARIA roles where possible.",
		},
		CodeBefore: `<div role="navigaton">...</div>
<button role="pressable">Click</button>`,
		CodeAfter: `<nav>...</nav>
<button>Click</button>`,
	},
	"duplicate-id-aria": {
		Title:    "Ensure all ARIA-referenced IDs are unique",
		Language: "html",
		FixSteps: []string{
			"Find all elements with duplicate id attributes.",
			"Rename or remove duplicates — each id must be unique within the document.",
			"Update any aria-labelledby, aria-describedby, or aria-controls references accordingly.",
		},
		CodeBefore: `<div id="tooltip">Hint 1</div>
<div id="tooltip">Hint 2</div>
<input aria-describedby="tooltip">`,
		CodeAfter: `<div id="tooltip-email">Email must be in format user@example.com</div>
<div id="tooltip-name">Enter your full legal name</div>
<input aria-describedby="tooltip-email">`,
	},

	// ── 4.1.2 Name, Role, Value ─────────────────────────────────────────────
	"button-name": {
		Title:    "Add an accessible name to every button",
		Language: "html",
		FixSteps: []string{
			"Add visible text inside the button element.",
			"If the button is icon-only, add aria-label describing the action.",
			"Avoid using title alone — it is not reliably announced by screen readers.",
		},
		CodeBefore: `<button><svg>...</svg></button>
<button></button>`,
		CodeAfter: `<button aria-label="Close dialog">
  <svg aria-hidden="true">...</svg>
</button>`,
	},
	"aria-allowed-attr": {
		Title:    "Remove ARIA attributes not permitted on this element's role",
		Language: "html",
		FixSteps: []string{
			"Check the WAI-ARIA spec for which attributes are allowed on the element's role.",
			"Remove or replace disallowed attributes.",
			"Use the correct native element if ARIA is being misapplied.",
		},
		CodeBefore: `<ul aria-checked="true">...</ul>`,
		CodeAfter: `<ul role="listbox" aria-multiselectable="true">
  <li role="option" aria-selected="true">...</li>
</ul>`,
	},
	"aria-required-attr": {
		Title:    "Add missing required ARIA attributes for the element's role",
		Language: "html",
		FixSteps: []string{
			"Look up the required properties for the element's ARIA role.",
			"Add any missing required attributes (e.g. aria-checked on role=checkbox).",
			"See: https://www.w3.org/TR/wai-aria-1.1/#requiredState",
		},
		CodeBefore: `<div role="checkbox">Option</div>`,
		CodeAfter:  `<div role="checkbox" aria-checked="false" tabindex="0">Option</div>`,
	},
	"aria-valid-attr-value": {
		Title:    "Fix invalid ARIA attribute values",
		Language: "html",
		FixSteps: []string{
			"Check the allowed values for the ARIA attribute (e.g. aria-expanded accepts true/false).",
			"Replace invalid values with valid tokens.",
		},
		CodeBefore: `<button aria-expanded="yes">Menu</button>`,
		CodeAfter:  `<button aria-expanded="false">Menu</button>`,
	},
}
