# Changelog

## v20260416b

- Add adjustable Hill Shading controls for trips, routes, and the route planner
  - Intensity slider (0–500%) scales the hillshade exaggeration across all zoom levels
  - Sun Angle slider (0–359°) adjusts the illumination direction
  - Reset button restores defaults without disabling the feature
  - Settings persist across page navigations and survive RWGPS style resets
- Limit Enhancements menu to Hill Shading only on planner pages (/routes/new, /routes/:id/edit)
- Fix hill shading not reverting to defaults on disable or reset
- Add Hill Shading toggle to popup settings

## v20260415

- Add HR Zones overlay on the elevation graph for activities with heart rate data
  - Horizontal pill-shaped bars show time spent in each zone (Z1–Z5) positioned by zone height
  - Zone colors: green (Z1), light green (Z2), yellow (Z3), orange (Z4), red (Z5)
  - White stroke on each bar for contrast against the graph fill
  - Hover tooltip shows HR zone number alongside existing elevation, speed, and bpm data
- Add Weather overlay on the elevation graph using Open-Meteo historical/forecast data
- Add wind layer time override support in page bridge
- Fix calendar streak highlight parsing for "Apr 1" style date labels on first of month
- Fix streak chart to show only the current active streak instead of a fixed 30-day window
- Add Weather and HR Zones toggles to popup and Enhancements dropdown

## v20260413

- Add reset-to-default button on all color pickers (heatmaps, climbs, descents, speed colors)
- Hide heatmap color controls when their parent heatmap is toggled off or radio selection changes
- Remove opacity percentage label in favor of gradient bar as sole visual indicator
- Update contact email to rwgps.enhancements@tomasquinones.com

## v20260412b

- Add heatmap color picker and opacity slider injected into the native RWGPS heatmap dropdown
- Support per-layer color and opacity for Global, Rides, and Routes heatmaps
- Apply color via Maplibre raster paint properties (hue-rotate, saturation, brightness)
- Auto-size heatmap dropdown to avoid overlapping the elevation profile
- Add Heatmap Colors toggle to popup

## v20260412a

- Add Quick Laps Trip tool entry to the native **More** menu under an `rwgps extension` section
- Add Quick Laps draw-mode handler wiring and finish-line event plumbing between content scripts and page bridge

## v20260412

- Add Elevation Gain goal support to goal progress chart
- Add secondary Y-axis for daily/weekly activity bars on goal chart
- Fix goal chart hover alignment and future-date tooltip issue
- Replace native color picker with inline HSV color picker in Enhancements dropdown
- Add scrollable Enhancements popover to prevent overlap with elevation graph
- Align goal chart and stats card styles with RWGPS style guide

## v20260411

- Add calendar streak highlight with hover tooltip showing streak day number
- Enable segments overlay on trip pages (previously route-only)
- Update extension icon to RWGPS cyclist logo with plus sign
- Fix elevation graph overlay on routes with cross-origin tainted canvases (projection-based fallback)
- Fix projection fallback overlay Y-axis scaling to use graph's yProjection instead of raw min/max elevation
- Fix canvas finder rejecting valid canvases due to over-validation
- Fix Stats card charts not showing today's rides (persistent cache was serving stale data)
- Fix Chrome inline script injection blocked by CSP (extract to web_accessible_resources)
- Add moving time and elevation gain to Stats card bar chart hover tooltip
- Replace slow native browser tooltip with instant custom tooltip on bar hover
- Move color picker controls from popup into the on-page Enhancements dropdown
- Remove Segments Labels sub-toggle (hover tooltips retained)
- Align Zoom out Map and Segment Details links in segment popup bubble
- Organize files into icons/, popup/, and content/ subdirectories
- Upgrade to Manifest V3 with cross-browser support (Firefox, Chrome, Vivaldi, Edge, Brave)

## v20260410

- Add segments map overlay with colored tracks, start/end markers, hover tooltips, and click-to-select
- Add "Segment Details" link in segment popup bubble
- Auto-expand sidebar segment list for routes with 4+ segments
- Improve goals chart with stats card, hover tooltip, and adaptive axis labels
- Use account's speed-by-grade profile for route daylight time estimates

## v20260409

- Add activity bar chart to Stats card (daily/weekly/yearly bars for Week, Month, Year, Career, Streak tabs)
- Cache trip data in browser.storage.local for fast tab switches
- Add daylight sun position overlay on elevation graph (daylight, civil twilight, night bands)
- Fix daylight overlay on route pages (React fiber layout fallback for tainted canvas)

## v20260408

- Add climbs and descents detection with gradient-colored map overlays and label toggles
- Add climb elevation graph overlay with zoom-aware rendering
- Add "Climbs" pill in elevation graph controls
- Add Goals sidebar link and goal progress chart on goal detail pages

## v20260407

- Add travel direction with animated marching ants (speed-tiered animation rates)
- Replace individual toggle buttons with unified Enhancements dropdown matching RWGPS native UI
- Add Travel Direction popup toggle
- Prepare manifest for AMO submission

## v20260406

- Add extension popup UI with checkboxes to enable/disable features
- Add R+ icon for toolbar button

## v20260405

- Add speed-colored track and elevation graph overlay on trip/route pages
- Add route speed estimation from grade (25 kph base, adjusted by grade)
- Improve elevation graph reliability with retry logic and better canvas discovery

## v20260404

- Initial release
- Activity streak tab in Stats card on profile and dashboard pages
- Shows streak days, distance, longest activity, active hours, elevation, and calories
