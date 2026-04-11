# CONTEXT.md

Shared project context for coding agents working in this repository.

## Project Overview

Firefox extension (Manifest V2) for ridewithgps.com. No build step, no dependencies, plain vanilla JavaScript injected as content scripts.

Primary features:

1. **Activity Streak** (`content.js`): Adds a "Streak" tab to the Stats card on profile (`/users/:id`) and dashboard pages, showing streak days, miles, longest activity, active hours, elevation, and calories.
2. **Speed Colors** (`speedcolors.js`): On trip (`/trips/:id`) and route (`/routes/:id`) pages, colors the map track line and elevation graph by speed using a dark red -> red -> yellow gradient.

## Loading / Testing

No build or test commands.

Manual workflow:

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click "Load Temporary Add-on" and select `manifest.json`.
3. After code changes, click "Reload" on the extension card.
4. Navigate to ridewithgps.com and validate behavior.

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

### Speed Color Pipeline

- Trips: speed from haversine distance / timestamp delta between GPS points, smoothed with 5-point moving average
- Routes: no timestamps, speed estimated from grade with `25 - grade * 1.5` kph model (aligned with RWGPS `estimatedSpeedFromGrade`)
- Map: GeoJSON LineString features per speed bucket, rendered via maplibre layers discovered through React fiber traversal (`__reactFiber$` keys)
- Elevation graph: pixel-scanning approach reads base canvas `ImageData`, finds largest contiguous filled-pixel run per column, and paints speed colors at matching pixel positions on an overlay canvas

### CSS Class Matching

RWGPS uses CSS Modules with mangled class names. Selectors should use partial class matching such as `[class*="SampleGraph"]` and `[class*="rightControls"]`.
