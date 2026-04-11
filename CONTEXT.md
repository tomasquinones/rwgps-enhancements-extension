# CONTEXT.md

Shared project context for coding agents working in this repository.

## Project Overview

Cross-browser extension (Manifest V3) for ridewithgps.com. Works on Firefox, Chrome, Vivaldi, Edge, and Brave. No build step, no dependencies, plain vanilla JavaScript injected as content scripts.

Primary features:

1. **Activity Streak** (`content/content.js`): Adds a "Streak" tab to the Stats card on profile (`/users/:id`) and dashboard pages, showing streak days, miles, longest activity, active hours, elevation, and calories.
2. **Speed Colors** (`content/speedcolors.js`): On trip (`/trips/:id`) and route (`/routes/:id`) pages, colors the map track line and elevation graph by speed using a dark red -> red -> yellow gradient.

## Loading / Testing

No build or test commands.

Manual workflow:

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click "Load Temporary Add-on" and select `manifest.json`.
3. After code changes, click "Reload" on the extension card.
4. Navigate to ridewithgps.com and validate behavior.

## File Structure

```
icons/          — Extension icon assets (SVG + PNG sizes)
popup/          — Browser action popup (popup.html, popup.js)
content/        — Content scripts injected into ridewithgps.com
  content.js    — Entry point, activity streak feature
  shared.js     — Shared utilities, helpers, graph functions
  bridge.js     — Page context communication (React fiber traversal)
  menu.js       — Enhancements dropdown menu
  speedcolors.js, climbs.js, descents.js, daylight.js, segments.js, traveldir.js, goals.js — Feature modules
  styles.css    — Injected styles
```

All content scripts share a single execution context loaded in order by `manifest.json`.

### Cross-Browser Shim

`content/content.js` (first loaded script) includes: `if (typeof browser === "undefined") { window.browser = chrome; }`. This aliases Firefox's `browser` API onto Chromium's `chrome` global so all code uses `browser.*` uniformly. The same shim exists in `popup/popup.js` (separate execution context).

## Architecture

### Content Script Isolation

Content scripts cannot access page JavaScript globals (`window.rwgps`, React fibers, maplibre). Scripts inject `<script>` tags into page context and communicate via:

- Data attributes on `<html>` (streak: user ID and metric preference)
- Custom events (speed colors: `rwgps-speed-colors-add/remove`)

### SPA Navigation

RWGPS is a React SPA. Content scripts run only on initial load, so navigation handling uses:

- `setInterval` polling of `location.pathname` every 1s
- `MutationObserver` through `waitForElement()` for target DOM availability

### API Usage

Fetches use headers (not query params):

- `x-rwgps-api-key: ak17s7k3`
- `x-rwgps-api-version: 3`

API payloads can use camelCase or snake_case keys; code should tolerate both.

### Elevation Graph Overlay Pipeline

All three overlay features (Speed Colors, Climbs, Descents) color the elevation graph using the same two-strategy approach:

1. **Pixel-scanning (primary)**: Reads the base canvas `ImageData`, finds the largest contiguous filled-pixel run per column, and paints colored pixels on an overlay canvas positioned on top. This produces pixel-perfect results that exactly follow the graph fill shape.

2. **Projection fallback (tainted canvas)**: Some RWGPS route pages draw cross-origin images onto the elevation canvas, which taints it — `getImageData()` throws "The operation is insecure." When this happens, the overlay draws the elevation profile shape from track point data using either the React fiber graph layout projections (`xProjection`/`yProjection` via `R.getGraphLayout()`) or estimated plot margins, then fills from the computed elevation curve down to the plot bottom.

The `findSampleGraphCanvas()` function in `content/shared.js` locates the graph canvas via `[class*="SampleGraph"]` container lookup with fallbacks for `BottomPanel`/`Elevation`/`Profile` containers and graph marker sibling proximity.

**Important**: Do not add validation (size checks, `isConnected`, map canvas filtering) to the canvas finder beyond filtering out our own overlay canvases. Previous attempts at "robust" canvas scoring broke the lookup on pages where the canvas was valid but didn't pass validation at the moment of checking. The simple `querySelector` approach is proven reliable.

**Important**: Do not replace the pixel-scanning approach with ink-profile top-edge tracing or single-strip rendering. The column-fill approach (scanning every column, finding the longest filled-pixel run, painting the full run) is the correct rendering method. Previous attempts at "optimized" rendering drew only a thin strip at the graph top edge.

### Speed Color Pipeline

- Trips: speed from haversine distance / timestamp delta between GPS points, smoothed with 5-point moving average
- Routes: no timestamps, speed estimated from grade with `25 - grade * 1.5` kph model (aligned with RWGPS `estimatedSpeedFromGrade`)
- Map: GeoJSON LineString features per speed bucket, rendered via maplibre layers discovered through React fiber traversal (`__reactFiber$` keys)

### CSS Class Matching

RWGPS uses CSS Modules with mangled class names. Selectors should use partial class matching such as `[class*="SampleGraph"]` and `[class*="rightControls"]`.
