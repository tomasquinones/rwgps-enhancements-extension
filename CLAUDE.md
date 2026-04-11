# CLAUDE.md

Claude-specific entrypoint for this repository.

Primary shared context lives in [CONTEXT.md](/Users/tomasquinones/My_Dev/rwgps-enhancement-extension/CONTEXT.md). Read that first for project architecture, workflow, and implementation constraints.

## Claude-Specific Notes

- Keep this file minimal and Claude-specific only.
- If project guidance changes, update `CONTEXT.md` first, then reflect only Claude-only differences here.

## Cross-Browser Compatibility Rules

Every bug fix and feature addition MUST maintain cross-browser compatibility (Firefox + Chromium). Follow these rules:

1. **Always use `browser.storage.local`** for storage calls — never use `chrome.storage.local` directly. The shim in `content/content.js` (line 1) aliases `browser` to `chrome` on Chromium browsers.
2. **Do not add `chrome.*` API calls anywhere.** If a new browser API is needed, use the `browser.*` namespace and verify it works on both Firefox and Chromium.
3. **Keep `manifest.json` as Manifest V3.** Use `action` (not `browser_action`). Keep `host_permissions` separate from `permissions`.
4. **No inline scripts in extension HTML pages** (popup.html). MV3 forbids them. Use external `<script src="...">` only.
5. **If adding a new content script file**, add it to the `content_scripts.js` array in `manifest.json` AFTER `content/content.js` (which provides the browser shim).
6. **If adding a new popup script**, add the browser shim line at the top: `if (typeof browser === "undefined") { window.browser = chrome; }`
7. **Test awareness**: When making changes, consider whether the feature relies on Firefox-specific behavior. Content script injection, storage, and DOM APIs are cross-compatible. React fiber traversal and canvas APIs work identically across browsers.
