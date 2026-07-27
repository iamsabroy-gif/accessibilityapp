# Chrome Web Store Listing & Publishing Guide — Web Accessibility Scanner

> **Last Updated**: 2026-07-27

This document serves as the single source of truth for publishing the **Web Accessibility Scanner** Chrome Extension to the Chrome Web Store. It contains all exact store listing metadata, permissions justifications, privacy declarations, and step-by-step instructions.

---

## 🚀 Step-by-Step Publishing Guide

### Step 1: Production Backend URL
The Chrome extension is pre-configured to communicate with your production domain `https://www.accessscan.in`.

In `extension/background.js`:
```js
const DEFAULT_API_BASE = 'https://www.accessscan.in';
```

---

### Step 2: Create Icons
The Chrome Web Store requires a **128×128 PNG icon** for the store listing, and recommended icons for the extension:
- `extension/icons/icon-16.png` (16×16 px)
- `extension/icons/icon-48.png` (48×48 px)
- `extension/icons/icon-128.png` (128×128 px)

Add them to `extension/manifest.json`:
```json
"icons": {
  "16": "icons/icon-16.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png"
}
```

---

### Step 3: Create the Zip Archive
Create a clean `.zip` file containing **only** the contents of the `extension/` directory (not the whole project repo):

```bash
cd extension
zip -r ../web-accessibility-scanner.zip . -x "*.DS_Store"
cd ..
```

---

### Step 4: Register a Chrome Developer Account
1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Sign in with a Google account.
3. Pay the one-time **$5 registration fee** (Google requirement).

---

### Step 5: Upload & Fill Out Store Listing
1. Click **Add new item** and upload `web-accessibility-scanner.zip`.
2. Copy and paste the store listing details below directly into the dashboard.

---

## 📄 Store Listing Metadata

**Extension Name**: Web Accessibility Scanner  
*Character count*: 26 / 75

**Short Description**:
Scan live web pages, SPAs, and local apps for WCAG 2.1 accessibility violations using a client-side native engine.  
*Character count*: 124 / 132

**Detailed Description**:
Web Accessibility Scanner allows developers, QA engineers, and accessibility specialists to perform instant, client-side WCAG 2.1 AA/AAA accessibility audits on live web pages, Single Page Applications (SPAs), and local development environments.

Key Features:
- Client-Side Scanning: Runs native accessibility evaluation directly inside your tab without requiring server-side browser automation.
- Live & SPA Support: Audits dynamic DOM states, authenticated sessions, modal dialogs, and localhost apps.
- Visual Score Ring & Metrics: Instant compliance rating, violation counters, and grade score.
- Detailed Report Deep-Link: Generates a visual report link that opens in the web dashboard for full remediation guidance.
- Privacy-Focused: Operates directly on the page DOM.

How to Use:
1. Navigate to any web page or local environment (e.g. http://localhost:3000).
2. Open the Web Accessibility Scanner popup extension.
3. Click "Scan This Page" to inspect violations.
4. Click "View Detailed Report" for in-depth remediation guidance.

**Category**: Developer Tools (or Accessibility)  
**Single Purpose**: Audits web pages for WCAG accessibility compliance using a client-side evaluation engine.  
**Primary Language**: English  

---

## 🔒 Permissions Justification

The review team reads these. Use these exact justifications in the dashboard:

| Permission | Type | Justification |
|------------|------|---------------|
| `activeTab` | permissions | Required to inject the native accessibility scanner script into the currently active tab when the user clicks "Scan This Page". |
| `scripting` | permissions | Required to execute the client-side accessibility evaluation bundle (`engine.bundle.js`) and capture bounding boxes of accessibility violations. |
| `storage` | permissions | Required to persist user configuration such as API endpoint settings and session authorization tokens locally. |
| `http://*/*` | host_permissions | Required to enable accessibility scanning on local HTTP web servers (e.g. `http://localhost`). |
| `https://*/*` | host_permissions | Required to enable accessibility scanning on public HTTPS websites and SPAs requested by the user. |

---

## 🛡️ Privacy & Data Use Disclosures

**Does the extension collect user data?**: No  
- **Data Sold to Third Parties**: No
- **Used for Creditworthiness/Lending**: No
- **Unrelated Core Functionality Use**: No

### Data Types Declared in Dashboard
- **Website Content**: Read locally in the browser to evaluate WCAG compliance rules (image alt tags, ARIA attributes, contrast). Not stored or sold.
- **Authentication Info**: Session JWT tokens are temporarily stored in `chrome.storage.local` solely to authenticate API communication with the user's configured backend server.

---

## 📋 Recommended Privacy Policy Template

If required by Google, host a simple privacy policy on your website or GitHub Pages:

```markdown
# Privacy Policy for Web Accessibility Scanner

**Effective Date**: July 27, 2026

Web Accessibility Scanner does not collect, store, or sell any personal data.

### 1. Data Usage
The extension inspects DOM structure (such as image alt attributes, headings, ARIA roles, and color contrast) of the active browser tab solely to compute WCAG accessibility compliance scores.

### 2. Local Storage
Configuration settings (such as server URL) and temporary session tokens are stored locally in `chrome.storage.local` on your device.

### 3. Contact
For questions or support, contact: [your-email@example.com]
```

---

## 📊 Distribution & Pricing

- **Visibility**: Public
- **Regions**: All regions
- **Pricing**: Free
