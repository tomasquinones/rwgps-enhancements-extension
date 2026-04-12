# Changelog

## v20260411

- Add calendar streak highlight with hover tooltip showing streak day number
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
