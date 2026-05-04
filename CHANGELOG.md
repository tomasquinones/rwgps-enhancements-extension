# Changelog

## v20260503a

- Fix Enhancements button placement on route and trip pages
  - Was being appended to the basemap-dropdown row and clipped behind the "RWGPS Cycle" selector
  - Now inserted inline as the previous visual sibling of the **Layers** dropdown so it sits in the same row as Layers / Heatmaps / Settings / RWGPS Cycle
  - Falls back to a floating top-right position if the Layers dropdown can't be located
  - Planner placement (inside `rightControls`) is unchanged

## v20260429

- Add **Layers** section to the Enhancements dropdown with two new map overlays
  - **Public Lands** — translucent fill polygons for federal/protected lands. In US viewports, fetches USFS forests, NPS park boundaries, and BLM surface management areas from public ArcGIS REST FeatureServers (no API key). Outside the US, falls back to OpenStreetMap `boundary=protected_area` / `boundary=national_park` ways via the Overpass API. Re-fetches as you pan, with bbox-keyed caching to avoid duplicate requests.
  - **Weather Radar** — global precipitation radar via the free RainViewer public API (no key). Latest "past" frame is shown as a translucent overlay; refreshes every 5 minutes.
  - Both layers are available on **planner, route, and trip pages** and persist across navigation. Off by default on first load (network-heavy; opt-in).
- New popup group "Layers" with checkboxes for `publicLandsEnabled` and `radarEnabled`.
- New `host_permissions` for the underlying public endpoints (`apps.fs.usda.gov`, `gis.blm.gov`, `services1.arcgis.com`, `overpass-api.de`, `rainviewer.com`).

## v20260428e

- Add **ET Sample Time** feature for routes
  - New independent toggle in the Enhancements dropdown (route pages only)
  - Adds an `ET h:mm` line to RWGPS's native elevation-graph hover tooltip showing the **estimated elapsed time** from the start at the point under your cursor
  - Computed from the user's grade-vs-speed profile (the same profile RWGPS uses for its own time estimates) — fidelity matches that estimate, not a precise prediction
  - Independent popup setting (`etSampleTimeEnabled`), separate from trip Sample Time, with cross-page state carryover and default-on behavior on first visit
  - Trip **Sample Time** behavior is unchanged (still shows recorded local time)

## v20260428d

- **Sample Time** now defaults to ON when a trip page first loads
  - Previously the toggle started off and required a manual click; the carryover state was overwriting the intended default on first navigation, and is now skipped when there's no previous page to carry from

## v20260428c

- Fix Goal chart "Days left" and "Avg per day needed" calculations
  - **Days left** is now inclusive of both today and the goal end date (e.g. Apr 28 with end Apr 30 → 3 days, not 2)
  - **Avg per day needed** drops today from the denominator once you've logged a ride today, so it reflects only the days you still have to ride
  - Help tooltip on the chart updated to describe the new behavior

## v20260428b

- Split the elevation-graph time tooltip out of Daylight into its own **Sample Time** feature
  - New independent toggle in the Enhancements dropdown (trip pages only)
  - Works without Daylight enabled — see ride times alongside any or no other overlays
  - Independent popup setting (`sampleTimeEnabled`) and cross-page state carryover
  - When Daylight is also active, reuses its computed times to avoid duplicate work

## v20260428

- Add point time to elevation-graph hover tooltip when Daylight is active on a trip
  - Native `.sg-hover-details` tooltip now appends a `HH:MM:SS` local time line below the existing elevation/speed/HR values
  - Time follows the browser locale (12-hour with AM/PM in US, 24-hour elsewhere)
  - Reuses Daylight's already-computed `R.cachedDaylightTimes` per-point timestamps; no extra API calls

## v20260427a

- Fix Dashboard Streak counter missing late-evening rides
  - `departed_at_max` window now pads by 2 days when the range includes today, so the API returns rides whose UTC date rolls into tomorrow (e.g. 9pm PDT = 04:00 UTC next day) for users in negative UTC offsets
  - Add a 60s TTL on the in-memory trip cache for today-inclusive ranges so a long-open dashboard tab picks up new rides on the next refresh of the Streak panel

## v20260426d

- Redesign Weather overlay on the elevation graph for legibility
  - New per-segment strip above the graph: time of day, temperature, wind direction + speed, cloud cover %, and rain chance %
  - Wind arrow rotates to show the direction the wind is blowing toward
  - Faint cloud/rain wash inside the elevation graph replaces the dense in-plot percentage labels
  - Time label per cell (range when wide enough; tooltip with full range on every cell)
  - Temperature and wind units follow user's RWGPS metric preference (°F/mph or °C/km/h)
  - Open-Meteo request now also fetches `temperature_2m`
- Rename Weather feature contextually
  - **Weather Prediction** on routes (uses Open-Meteo forecast)
  - **Weather History** on trips/activities (uses Open-Meteo historical archive)
  - Popup label is **Weather Prediction & History** (single toggle controls both)
  - Modal title reads "Weather Prediction — Choose Start Time"

## v20260426c

- Add Moving Time goal support to the Goal progress chart
  - Chart, stats cards, projection, and tooltip render in hours (`h`)
  - "Longest ride" effort stat reports longest ride by moving time for time goals
  - Distance and Elevation Gain goals continue to render unchanged

## v20260426b

- Shift Goal chart palette to warm RWGPS colors
  - Cumulative progress line, area fill, and activity bars now use RWGPS orange (#fa6400) and warm tints
  - Projection line, endpoint marker, and "Projected total" stat use red (#d32f2f) for contrast against the orange line
- Add gear icon next to the help mark on the Goal chart
  - Opens a popover with **Warm** (default) and **Cool** (original blue) palette options
  - Selection persists across page loads via `goalsChartPalette` in `browser.storage.local`
  - Switching repaints the chart in place

## v20260417a

- Improve HR Zones overlay to match the graph's HR Y-axis
  - Zone bar heights now span each zone's actual HR value range instead of fixed-height pills
  - Square bar ends replace rounded pill shapes
  - Bars clamp to the visible plot area so zones outside the data range don't overflow
- Extract HR Y-axis projection from RWGPS graph layout for accurate zone positioning

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
