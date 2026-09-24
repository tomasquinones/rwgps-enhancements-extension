# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Detailed shared context lives in [CONTEXT.md](CONTEXT.md) (feature list, overlay/hill pipelines, known-fragile code you must not "improve"). Read it first. It is gitignored, so it exists only locally; [AGENTS.md](AGENTS.md) is the tracked equivalent for style and commit conventions. When project guidance changes, update `CONTEXT.md` first and keep only Claude-specific differences here.

## Commands

No dependencies, bundler, linter, or test suite. Everything is plain JS loaded directly by the browser.

- Run: load the repo root unpacked (Firefox `about:debugging#/runtime/this-firefox` -> Load Temporary Add-on -> `manifest.json`; Chromium `chrome://extensions` -> Developer mode -> Load unpacked), then reload the extension after each edit.
- Package: `./build.sh` writes `dist/rwgps-enhancements-<version>-{firefox,chrome,source}.zip`, using `manifest.json` `"version"`.
- Release: bump both `version` (`YYYY.M.D`) and `version_name` (`YYYYMMDDa`) in `manifest.json` and add a `## vYYYYMMDDa` entry to `CHANGELOG.md`.

## Architecture Essentials

- **One shared content-script context.** Every file in `manifest.json` `content_scripts.js` runs in the same isolated world, in listed order. `content/shared.js` creates the `window.RE` namespace (conventionally aliased `R`), which holds cross-module state flags (`R.climbsActive`, …), caches (`R.cachedTrackPoints`, …), and helpers (`R.waitForElement`, `R.findSampleGraphCanvas`, `R.fetchTrackPoints`, `R.fetchUserTrips`, `R.drawCumulativeChart`, …). Feature modules are IIFEs that read and write `R`. A new module must come after `shared.js` in the manifest.
- **Two worlds.** Content scripts can't reach page globals (React fibers, MapLibre map). `content/bridge.js` injects `content/page-bridge.js` and `content/page-user.js` (listed in `web_accessible_resources`) into the page. They talk through `rwgps-*` CustomEvents (content -> page, GeoJSON payloads) and `data-rwgps-*` attributes on `<html>` (page -> content, e.g. user id and metric preference). All map layer, marker, and paint-property work happens in `page-bridge.js`.
- **Two fetch helpers with different semantics** (`shared.js`):
  - `R.rwgpsFetch` sends the api-key and v3 headers. The v3 trips endpoint always returns the *logged-in* user's trips and ignores the user id.
  - `R.rwgpsFetchPlain` is cookie-only. Use it for per-user data (`/users/{id}/trips.json`) and for legacy-shaped responses (`/goals/{id}.json`).

  Choosing the wrong helper caused the "own data on other profiles" bug in v20260602a.
- **Settings** live in `browser.storage.local` under camelCase keys such as `<feature>Enabled`. The popup (`popup/popup.js`) and the in-page Enhancements menu (`content/menu.js`) both toggle them.
- **SPA:** RWGPS is a React SPA. Modules poll `location.pathname` and use `R.waitForElement` / MutationObservers to re-inject after React re-renders. Match mangled CSS-module classes with `[class*="…"]`. Prefix our classes with `rwgps-`.

## Cross-Browser Compatibility Rules

Every bug fix and feature addition MUST maintain cross-browser compatibility (Firefox + Chromium). Follow these rules:

1. **Always use `browser.storage.local`** for storage calls. Never use `chrome.storage.local` directly. The shim in `content/content.js` (line 1) aliases `browser` to `chrome` on Chromium browsers.
2. **Do not add `chrome.*` API calls anywhere.** If a new browser API is needed, use the `browser.*` namespace and verify it works on both Firefox and Chromium.
3. **Keep `manifest.json` as Manifest V3.** Use `action` (not `browser_action`). Keep `host_permissions` separate from `permissions`. Any new external API host must be added to `host_permissions`.
4. **No inline scripts in extension HTML pages** (popup.html). MV3 forbids them. Use external `<script src="...">` only.
5. **If adding a new content script file**, add it to the `content_scripts.js` array in `manifest.json` AFTER `content/content.js` (which provides the browser shim) and `content/shared.js` (which provides `window.RE`).
6. **If adding a new popup script**, add the browser shim line at the top: `if (typeof browser === "undefined") { window.browser = chrome; }`
7. **Test awareness**: When making changes, consider whether the feature relies on Firefox-specific behavior. Content script injection, storage, and DOM APIs are cross-compatible. React fiber traversal and canvas APIs work identically across browsers.
