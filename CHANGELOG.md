# Changelog

## v20261001a

- **Remove Travel Direction** (`content/traveldir.js`, `content/page-bridge.js`, `content/menu.js`, `content/shared.js`, `popup/`)
  - RWGPS production now has **Map Settings → Directional Arrows** on trip, route, and planner maps for all users
- Add a **Width** slider to **Track Colors** (`content/trackcolors.js`, `content/page-bridge.js`)
  - Scales the native track line from 50% to 400%; the outline (casing) stays thin. Re-applied when the map style refreshes and restored when Track Colors is turned off
- Add **sunrise/sunset markers and the moon** to the **Daylight** graph (`content/daylight.js`, `content/shared.js`)
  - A dashed marker with the clock time wherever the ride crosses sunrise or sunset
  - For rides with night portions: the moon's altitude while the sun is down, plus its phase and illumination (e.g. `71% Waxing Gibbous`)
- Add a **Temperature** map layer (`content/temperature.js`, `content/page-bridge.js`, `popup/`)
  - Color-coded current air temperature at a grid of points across the visible map (Open-Meteo, no key), in your RWGPS units, with a legend; refreshes on pan/zoom and every 15 minutes
- Add **Animate (last 2 hours)** to **Weather Radar** (`content/radar.js`, `content/page-bridge.js`)
  - Loops RainViewer's past frames at 10-minute steps, with the frame time shown on the map. RainViewer's free API no longer offers forecast (nowcast) frames
- **Performance** (`content/page-bridge.js`, `content/shared.js`, `content/heatmaps.js`, `content/sampletime.js`, `content/weather.js`, `content/menu.js`, `content/trip-more-tools.js`, `content/publiclands.js`, `content/page-user.js`)
  - The map layer watchdog no longer forces a map repaint every 500 ms: it only works after the map style changes, and only changes paint properties, layer order, or wind tiles that actually differ
  - Heatmap colors at their defaults no longer override RWGPS's own heatmap styling; turning the override off restores RWGPS's original values (e.g. its 0.9 global heatmap opacity) instead of forcing 1.0
  - Settings polls are served from memory (kept current with `storage.onChanged`) instead of a storage read per module per second
  - Sample Time no longer downloads the trip's track points on every trip page load; they load on the first graph hover. Simultaneous track-point requests for the same trip/route are shared
  - Graph hover handlers run once per animation frame (they ran 2× per mouse move) and reuse a recent graph layout instead of walking the React tree on every move
  - Elevation-graph overlays skip their redraw checks in background tabs and read the canvas fingerprint with one pixel read instead of five
  - Fixed leaks: one outside-click listener per Enhancements dropdown ever created; planner route listeners added on every start; the logged-out user-id poll never stopped
  - Re-inserting the Enhancements button after a React re-render no longer re-runs every active feature
  - The Trip **More** menu watcher scans at most once per animation frame
  - Public Lands loads at zoom 7 and closer (with a "Zoom in to load" hint), requests simplified outlines, and caps its cache
  - Dashboard/profile trip history downloads once per refresh instead of twice (`content/shared.js`). The cookie-only `/users/{id}/trips.json` returns a rider's whole trip list in one unsorted response, which the old pager requested a second time before noticing; the in-memory list is now kept for the 3 most recent riders only. Callers that need a bounded range pass `since`, which will cut downloads further if the server ever pages this endpoint
  - `/goals` no longer re-requests `/goals.json` and every goal about twice a second when you have no goals or a request fails; results are cached for the visit (`content/goals.js`)
  - Stopped observer pile-ups (a new page-wide MutationObserver every second while waiting for an element that never appears) in the Stats card, `/rides` graph, and Goals sidebar link; per-second cleanup scans now run only if the module actually changed the page (`content/content.js`, `content/activitiesgraph.js`, `content/goals.js`, `content/calendar.js`)
  - Stats tab click handlers no longer stack up every second when streaks are off and no chart renders (`content/content.js`)
  - Expired `tripCacheV2_*` entries and old `tripCache_*` keys are pruned from extension storage
- Fix the Calendar using an older trip cache that could hold a truncated history, and a paged request that could fetch the first page twice; it now uses the shared trip list (`content/calendar.js`)
- Calendar streak highlights and the Streak tab now count streaks longer than a year (both checked one year back first, then full history if the streak reaches it)
- Fix stale data after clicking from one rider's profile straight to another's: in-flight chart and Eddington results for the previous rider are dropped (`content/content.js`)
- The Stats card no longer injects on `/users/{id}/<subpage>`, and the Goals sidebar link no longer appears on detail pages (`/routes/{id}`, the planner, `/collections/{id}`, `/events/{id}`)
- Fix Public Lands not refreshing on pan after navigating to another map page in the same tab (`content/page-bridge.js`, `content/publiclands.js`)
- Fix Track Colors, Hill Shading, Weather Radar, and Public Lands dropping off after RWGPS rebuilt the map style on a page reached by in-app navigation: their re-apply listeners stayed on the previous page's map. The planner route watcher now also moves to the new map (`content/page-bridge.js`)
- Fix Sample Time switching itself off on the next trip after visiting a route page (and ET Sample Time after visiting a trip) (`content/menu.js`)
- **Cleanup**: removed unused code left from earlier features (calendar goal-list helpers, an unused graph "ink profile" tracer, the segment-label toggle, unwired hill-shading color settings, debug logging and a debug toast in the Trip More menu, Climbs leftovers), merged three copies of the color-picker drawing helpers into `shared.js`, dropped unused `*.rainviewer.com` and narrowed `*.arcgis.com` host permissions to `services.arcgis.com`, and the popup now reads its version from the manifest

## v20260924a

- **Remove features that RWGPS production now covers** (`manifest.json`, `content/menu.js`, `content/shared.js`, `content/page-bridge.js`, `content/styles.css`, `popup/popup.html`, `popup/popup.js`)
  - **Grade Colors** (map track + elevation graph shading), since production has native grade shading
  - **Climbs**, **Descents**, and **Climb Categories** (map highlights, start/end markers, elevation overlays, color pickers, and the hill finder), which overlapped with production's grade shading
  - **Wildfires** layer, replaced by the official wildfires layer in production
  - Deleted `gradecolors.js`, `climbs.js`, `descents.js`, `climbcats.js`, and `wildfire.js`; removed their popup toggles, Enhancements menu entries, and docs
- Add **Track Colors** (`content/trackcolors.js`, `content/page-bridge.js`)
  - Recolor the native RWGPS track line on trip and route pages with an inline color picker and opacity slider; the override is re-applied whenever the map style refreshes
- Add **Calendar multi-month and heatmap views** (`content/calendar.js`, `content/styles.css`)
  - A period switcher (left of the native Settings gear) swaps the month calendar for a **3-month** or **6-month** stack of heat-shaded grids, or a GitHub-style **12-month** day heatmap colored by distance ridden
  - Each year shows a totals strip: distance, elevation, time, photos, activities, and calories
  - New popup toggle: **Calendar Multi-Month Views**
- Add an **Eddington (Elevation)** tile beside **Eddington (Distance)** in the Career stats grid (`content/content.js`), with its own depth popover and E(N) table
- **HR Zones** now use the zones configured on your RWGPS account, falling back to ride-relative zones when none are set (`content/hrzones.js`)

## v20260618a

- Add an **Activities Graph view** on `/rides` (`content/activitiesgraph.js`, `content/styles.css`)
  - A **Graph** toggle next to "Show Map" hides the ride list and shows a cumulative chart of your own rides — switchable between **Distance**, **Elevation**, and **Time** — navigable by **Year** or **Month**
  - New **Years** mode compares every year of your history with six switchable chart styles: **Heatmap** (year × month color grid), **Totals** (one bar per year, with a *By year* / *By total* sort to rank your biggest years, colored to match the Career stats palette), **Stacked**, **3D** (isometric month × year bars with year labels), **Stream**, and **Lines**
  - Reuses the shared cumulative-chart renderer and the cookie-only per-user trip fetch
- Add a **depth detail popover** to the Eddington tile (`content/content.js`, `content/styles.css`)
  - Hover (or click to pin) the tile for progress to the next `E`, a **depth factor** (`N(E)/E` and surplus days past `E`), and an **E(N) survival table** of distance → days with the `E` row highlighted — so consistency *beyond* the threshold (e.g. a short commute ridden hundreds of times) is finally visible
  - Positioned with `position: fixed` + viewport clamping so it can't be clipped by the stats grid's overflow
- Fix the Stats year view (and Eddington tile / activities graphs) **only showing the most recent activities** — older years were missing entirely (`content/shared.js`, `content/content.js`)
  - Root cause: `fetchUserTrips` requested a single page of the cookie-only `/users/{id}/trips.json` endpoint, which returns only the most-recent bounded page
  - Now pages through the full history (sends both `offset`/`limit` and `page`/`per_page`, detects page size from the response, and stops safely if the server ignores paging); concurrent callers are de-duped; the persistent trip cache key was bumped so pre-fix truncated lists aren't served stale
- Replace the calendar **Goal Indicators** with a **Calendar Graph View** (`content/calendar.js`, `content/goals.js`, `popup/popup.html`, `popup/popup.js`)
  - A toolbar toggle (left of the native Settings gear) swaps each day cell for a distance bar, turning every week row into a bar graph like the Dashboard weekly chart — bars colored by weekday and scaled to a common month-wide max, with a hover tooltip of each day's activities, distance, time, and elevation
  - The popup toggle is renamed accordingly (`calendarGoalsEnabled` → `calendarGraphEnabled`)

## v20260602a

- Fix dashboard activity graphs, streak panel, and Eddington tile showing the **logged-in user's data on other people's profiles** (`content/content.js`)
  - Root cause: the v3 api-key trips endpoint always returns the *authenticated* user's trips — the `/users/{id}` path and `user_id=` param are both ignored — so every `/users/{id}` profile rendered your own rides
  - Now fetches via the cookie-only endpoint (`rwgpsFetchPlain` → `/users/{id}/trips.json`), which honors the path and returns that user's full trip list (only their publicly visible trips, enforced server-side by your session)
  - The in-memory trip cache is keyed per-user so one profile's data is never served to another; removed dead `fetchTrips`/`cachedTripsRange`

## v20260601a

- Add **color schemes** to the dashboard activity graphs (`content/content.js`, `content/styles.css`)
  - Bars now support three palettes: **Warm** (orange, the original look), **Cool** (the same `#5c77ff` blue as the Goal graph), and **Pride** (a red → orange → yellow → green → blue → purple rainbow interpolated across the bars)
  - A gear icon in the Stats card's top-right corner opens a menu to switch palettes; matches the Goal chart's settings widget
  - The choice persists per browser (`statsChartPalette`, default **Pride**) and applies to every tab (Week/Month/Year/Career/Streak)

## v20260528b

- Add **Eddington Number** to the Career stats on `/dashboard` (`content/content.js`)
  - Adds a seventh tile to the native "at a glance" Career stats, compressing the grid from three to four columns so it sits to the right of **Photos Taken** (an empty spacer keeps the existing tiles grouped as before)
  - The Eddington number `E` is the largest integer such that you've ridden at least `E` units on at least `E` separate days — computed from your full ride history by summing each day's distance and taking the Eddington of the per-day totals
  - Uses your RWGPS unit preference: miles for imperial accounts, km for metric
  - Hover the tile for a one-line explanation of the metric
  - Reuses the cached all-time trip list already fetched for the Career chart (no extra API calls when the chart is loaded); injected tile matches native stat styling and re-attaches if the stats grid re-renders

## v20260528a

- Add **Climb Categories** feature for trips and routes (`content/climbcats.js`)
  - New independent toggle in the Enhancements dropdown (trip and route pages)
  - Categorizes each detected ascent using the pro-cycling scoring formula `score = length_km × (avg_gradient%)²`, gated by both a score threshold and a minimum elevation gain per category: **HC**, **Cat 1**, **Cat 2**, **Cat 3**, **Cat 4** (climbs below Cat 4 are uncategorized)
  - Paints each categorized climb as a translucent color band over the elevation graph (purple HC → red Cat 1 → orange Cat 2 → amber Cat 3 → green Cat 4)
  - Adds a category line to the native elevation-graph hover tooltip showing label, average gradient, distance, and elevation gain (e.g. `Cat 4 — 3.5% · 1.0 mi · 180 ft`) in the category's color; distance/gain units follow your RWGPS metric preference
  - Reuses the cached track points and detected ascents from the Climbs feature; overlay re-syncs on graph zoom/redraw via pixel-scan (or projection fallback on tainted canvases)

## v20260508a

- Goal chart polish on `/goals/{id}` pages
  - Top stats card now reads, left to right: **Remaining → Ahead/Behind of pace → Days left → Avg per day needed → Projected total** (the "% Complete" tile was redundant with the progress bar so it's removed)
  - Y-axes swapped on the chart: **daily/weekly bar scale on the left, cumulative total on the right** — putting the bigger total numbers next to the line they describe
  - Removed the "Goal: {distance} {units}" label from the upper-right corner; the dashed target-pace line still anchors the goal visually

## v20260506a

- Add a goal browser to the `/goals` listing page
  - Replaces the native wide-row "Your Goals" list with a 4-column card grid styled like Collections, using each goal's cover/icon, name, date range, percent complete, progress bar, and current/target amount
  - Adds two new sections below the **Set a goal:** row:
    - **Completed** — expired goals at 100% or more
    - **Incomplete** — expired goals below 100%
  - Active goals are sorted by soonest deadline; expired goals by most-recent end date
  - Fetches the full goal list via `/goals.json` (with `?scope=challenges` for challenges) and per-goal participant detail via `/goals/{id}.json` so percentages reflect your actual progress, including past goals beyond the "relevant" window the native page exposes
  - Popup label updated to "Goal Charts & Past Goals Listing" — same toggle controls both

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
