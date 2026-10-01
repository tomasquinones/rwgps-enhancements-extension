# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Detailed shared context lives in [CONTEXT.md](CONTEXT.md) (file map, elevation-graph overlay and speed-color pipelines, known-fragile code you must not "improve"). Read it first. It is gitignored, so it exists only locally; [AGENTS.md](AGENTS.md) is the tracked equivalent for style and commit conventions. When project guidance changes, update `CONTEXT.md` first and keep only Claude-specific differences here.

## Commands

No dependencies, bundler, linter, or test suite. Everything is plain JS loaded directly by the browser.

- Run: load the repo root unpacked (Firefox `about:debugging#/runtime/this-firefox` -> Load Temporary Add-on -> `manifest.json`; Chromium `chrome://extensions` -> Developer mode -> Load unpacked), then reload the extension after each edit.
- Package: `./build.sh` wipes `dist/` and writes `dist/rwgps-enhancements-<version>-{firefox,chrome,source}.zip`, using `manifest.json` `"version"`.
- Release: bump both `version` (`YYYY.M.D`) and `version_name` (`YYYYMMDDa`) in `manifest.json` and add a `## vYYYYMMDDa` entry to `CHANGELOG.md`.

## Architecture Essentials

- **One shared content-script context.** Every file in `manifest.json` `content_scripts.js` runs in the same isolated world, in listed order. `content/content.js` loads first (browser shim), then `content/shared.js`, which creates the `window.RE` namespace (conventionally aliased `R`). `R` holds cross-module state flags (`R.speedColorsActive`, …), caches (`R.cachedTrackPoints`, …), and helpers (`R.getPageInfo`, `R.waitForElement`, `R.findSampleGraphCanvas`, `R.fetchTrackPoints`, `R.fetchUserTrips`, `R.drawCumulativeChart`, …). Feature modules are IIFEs that read and write `R`.
- **Two worlds.** Content scripts can't reach page globals (`window.rwgps`, React fibers, the MapLibre map), so two scripts listed in `web_accessible_resources` are injected into the page:
  - `content/content.js` injects `content/page-user.js`, which publishes the user id and metric preference as `data-rwgps-*` attributes on `<html>` (read via `R.getCurrentUserId()` / `R.isMetric()`).
  - `content/bridge.js` injects `content/page-bridge.js`, which finds the MapLibre map through React fiber keys. All map layer, marker, and paint-property work happens there.

  Content and page talk through `rwgps-*` CustomEvents on `document` in both directions: content sends GeoJSON and paint payloads; the page replies with events such as `rwgps-hillshade-status`, `rwgps-mapviewport`, and `rwgps-planner-route-update`.
- **Two fetch helpers with different semantics** (`shared.js`):
  - `R.rwgpsFetch` sends the api-key and v3 headers. The v3 trips endpoint always returns the *logged-in* user's trips and ignores the user id.
  - `R.rwgpsFetchPlain` is cookie-only. Use it for per-user data (`/users/{id}/trips.json`) and for legacy-shaped responses (`/goals/{id}.json`).

  Choosing the wrong helper caused the "own data on other profiles" bug in v20260602a.
- **Settings** live in `browser.storage.local` under camelCase keys such as `<feature>Enabled`. Modules re-read their keys on each 1 s poll via `R.safeStorageGet`, which serves them from an in-memory cache that a `storage.onChanged` listener keeps current, and defaults are repeated at every read site. A new toggle needs: a checkbox in `popup/popup.html`; entries in `popup/popup.js` `STORAGE_DEFAULTS` and `CHECKBOX_CONFIG`; the defaults object in the module that reads it; and, for trip/route/planner features, `content/menu.js` (its settings read in `checkTRoutePageInner` and the in-page Enhancements dropdown). Keep the default identical everywhere.
- **SPA:** RWGPS is a React SPA. Modules poll `location.pathname` every 1 s (`R.getPageInfo()` classifies trip, route, and planner pages) and use `R.waitForElement` / MutationObservers to re-inject after React re-renders. Match mangled CSS-module classes with `[class*="…"]`. Prefix our classes with `rwgps-`.

## Cross-Browser Rules

Every change must keep working in Firefox and Chromium.

1. **Use `browser.*`, never `chrome.*`.** `content/content.js` and `popup/popup.js` each start with the shim `if (typeof browser === "undefined") { window.browser = chrome; }`. Any new extension-page script (popup, options) needs the same first line.
2. **Keep `manifest.json` Manifest V3.** Use `action` (not `browser_action`). Keep `host_permissions` separate from `permissions`. Any new external API host must be added to `host_permissions`.
3. **No inline scripts in extension HTML** (`popup.html`). MV3 forbids them. Use external `<script src="...">` only.
4. **New content scripts** go in `content_scripts.js` after `content/content.js` and `content/shared.js`. New page-context scripts must also be listed in `web_accessible_resources`.
5. **Chromium invalidates running content scripts when the extension reloads.** Storage reads in polling loops must go through `R.safeStorageGet`, which sets `R.contextInvalidated` so loops stop quietly instead of throwing. Otherwise DOM, canvas, storage, and React fiber traversal behave the same in both browsers.
