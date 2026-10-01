# RWGPS Enhancements Extension

Unofficial enhancements for your ridewithgps.com account.

## Installation

First, download the extension:

1. Go to https://github.com/tomasquinones/rwgps-enhancements-extension in your browser.
2. Click the green **Code** button near the top right of the file list.
3. Click **Download ZIP** from the dropdown.
4. Once downloaded, unzip the file somewhere easy to find, like your Desktop or Documents folder.

### Firefox

5. Type `about:debugging` in the address bar and press Enter.
6. Click **This Firefox** in the left sidebar.
7. Click **Load Temporary Add-on…**
8. Navigate to the unzipped folder and select the `manifest.json` file inside it.
9. The extension is now active and you'll see its icon in the Firefox toolbar.

**Note:** Firefox removes temporary extensions when it's restarted. To re-enable it, repeat steps 5–8.

### Chrome, Vivaldi, Edge, and Brave

5. Open the extensions page:
   - **Chrome / Brave:** `chrome://extensions`
   - **Vivaldi:** `vivaldi://extensions`
   - **Edge:** `edge://extensions`
6. Enable **Developer mode** (toggle in the top-right corner).
7. Click **Load unpacked**.
8. Select the unzipped folder (the folder that contains `manifest.json`).
9. The extension is now active and you'll see its icon in the browser toolbar.

**Note:** The extension stays loaded across browser restarts. After updating the files, click the reload icon on the extension card to pick up changes.

## Features and How to Use Them

### Speed Colors (Trips and Routes)

Open any trip or route page on ridewithgps.com. Click the Speed Colors button that the extension injects into the page. The map track updates to display color coding based on speed.

<img width="1386" height="1099" alt="image" src="https://github.com/user-attachments/assets/4f6bc7fd-2b29-46e4-a813-3301f5ab50be" />

### Streak Counter (Dashboard)

Navigate to ridewithgps.com/dashboard. Streak stats are added to the Stats card automatically — no action required.

<img width="1114" height="452" alt="image" src="https://github.com/user-attachments/assets/b0fe15aa-e4d6-40be-960b-6ce5e34e9dc8" />

### Activity Graphs (Weekly / Monthly / Yearly / Career / Streak)

Navigate to ridewithgps.com/dashboard. The graphs appear automatically alongside your existing dashboard data. They also render on any other user's profile (`/users/{id}`), showing that rider's publicly visible activity.

<img width="1103" height="459" alt="image" src="https://github.com/user-attachments/assets/3beb4d3b-19c3-4bee-8b62-86162515c566" />

Use the gear icon in the top-right corner of the Stats card to pick a bar color scheme: **Warm** (orange), **Cool** (the same blue as the Goal graph), or **Pride** (a rainbow spread across the bars). Your choice is remembered and applies to every tab.

<img width="1078" height="428" alt="Stats graph color schemes" src="screenshots/stats-color-schemes.png" />

### Activities Graph View (Rides List)

Navigate to ridewithgps.com/rides. A **Graph** toggle appears next to the native "Show Map" control; turning it on hides the ride list and shows a cumulative chart of your rides, switchable between **Distance**, **Elevation**, and **Time**.

- **Year / Month:** a goal-style cumulative chart for the selected period, navigable with the ‹ › arrows.
- **Years:** an all-time, year-over-year comparison with several chart styles you can flip between — **Heatmap** (year × month color grid), **Totals** (one bar per year, with a *By year* / *By total* sort so you can rank your biggest years), **Stacked**, **3D** (isometric month × year bars), **Stream**, and **Lines**.

Toggle the feature in the popup under the Dashboard group.

### Eddington Number (Career Stats)

Navigate to ridewithgps.com/dashboard and open the **Career** tab in the Stats card. The extension adds a seventh stat tile, **Eddington Number**, next to the native six.

Your Eddington number `E` is the largest number such that you've ridden at least `E` miles on at least `E` separate days — a classic cyclist's measure of sustained mileage that's much harder to grow than a simple total (going from 70 to 71 takes a whole extra day of 71+ miles). It's computed from your entire ride history and follows your unit preference (miles, or km for metric accounts). For reference, Arthur Eddington — the astrophysicist the number is named for — reached 84.

Hover (or click to pin) the tile for a **depth detail** popover that shows how far past the headline number you really are:

- **Progress to next E** — how many more rides at `≥ E+1` it takes to tick over.
- **Depth factor** — how far above the line you sit at your current `E` (e.g. `2.6× (+110 days past E)`), so consistency beyond the bare threshold is rewarded.
- **Survival table** — for a set of milestone distances, the number of days you've ridden at least that far (e.g. `20 mi → 810 days`), with your `E` row highlighted. A short commute done hundreds of times shows up here even though it doesn't move `E`.

### Daylight Graph — Past Activities

Open any recorded trip/activity page. The daylight graph appears automatically.

Where the ride crosses sunrise or sunset, a dashed marker shows the clock time at that point (for example, `Sunset 7:10 PM`). If any part of the ride is after dark, the graph also draws the moon's height above the horizon while the sun is down, and labels the moon's phase and illumination (for example, `71% Waxing Gibbous`). The same markers appear on routes for your planned start time.

<img width="1333" height="300" alt="image" src="https://github.com/user-attachments/assets/6acf79a0-2c7b-43c8-8357-212ef5620d22" />

### Daylight Graph — Routes (Planned Rides)

Open any route page. Set your planned start time and date using the controls the extension adds. The graph updates to show expected sun position and daylight window along the route.

<img width="1358" height="358" alt="image" src="https://github.com/user-attachments/assets/066f27b2-08e2-4504-a380-61c203978195" />

### Weather Prediction & History

Toggle Weather from the Enhancements dropdown to see hourly conditions along the ride, plotted in matching segments above the elevation graph. The label changes by context:

- **Weather Prediction** on routes — pick a planned start time in the modal that appears, and the strip fills with forecasted conditions per segment of the ride.
- **Weather History** on activities (trips) — uses the recorded `departed_at`, fetches the historical archive, and shows what the conditions actually were along the way.

Each segment cell shows the time of day, **temperature**, **wind direction + speed** (arrow points the way the wind is blowing), and **cloud cover / rain chance**. A faint cloud/rain wash inside the elevation graph echoes the same data so you can see at a glance which stretches were stormy or overcast. Units follow your RWGPS profile (°F + mph for imperial, °C + km/h for metric). Powered by the Open-Meteo API.

<img width="1273" alt="Weather strip above an elevation graph showing time of day, temperature, wind, cloud, and rain per segment" src="https://s3.amazonaws.com/rwgps/screenshots/2026042614-54-25.png" />

### Goal Graph and Stats

Navigate to any goal detail page on ridewithgps.com (requires a goal set in your RWGPS account). A progress chart with stats cards appears automatically. Supports **Distance**, **Elevation Gain**, and **Moving Time** goals.

The chart shows:

- **Cumulative progress** plotted against the dashed **goal pace line** (straight line from 0 to target).
- **Current-pace projection** — a dashed line extending from today's progress to the goal end date using your average daily rate so far. The endpoint is labeled with the projected total so you can see at a glance whether you're on track.
- **Weekly activity bars** on a secondary Y-axis showing volume per week across the goal window.
- **Stats cards** summarizing Current progress, Daily goal (avg per day needed to finish on target), Projected total, plus an effort row with ride count, total time, elevation gain, and longest ride during the goal window. For Moving Time goals the chart and stats are shown in hours, and "Longest ride" reports the longest ride by moving time.
- A small **?** icon on the chart reveals the formulas used for Daily goal and Projected total.
- A **gear icon** next to it lets you switch the chart palette between **Warm** (orange/red, default) and **Cool** (blue). Your choice is remembered.

<img width="989" alt="Goal progress chart with warm palette and color settings popover open" src="https://s3.amazonaws.com/rwgps/screenshots/2026042613-36-33.png" />

### Goals Listing — Past Goal Browser

The native `/goals` page only shows your active goals as a wide list. The extension replaces that section with a 4-column card grid styled like Collections, and adds two more sections below the **Set a goal:** row:

- **Your Goals** — active goals (sorted by soonest deadline)
- **Completed** — expired goals where you reached 100%
- **Incomplete** — expired goals where you didn't

Each card uses the goal's cover/icon image, with name, date range, percent complete, progress bar, and current/target distance (or hours / elevation in your preferred units). Click a card to jump to the goal's detail page.

<img width="989" alt="Goals listing with Your Goals, Completed, and Incomplete card grids" src="https://s3.amazonaws.com/rwgps/screenshots/2026050611-04-09.png" />

### Calendar Streak & Graph View

Navigate to ridewithgps.com/calendar.

- **Streak highlights:** Days in your current ride streak are tinted orange. Hover over a highlighted day to see which day of the streak it is (e.g., "Day 15 of 19"). The highlight follows your streak across month boundaries as you navigate.
- **Graph view:** A toggle (left of the native Settings gear) swaps each day cell's contents for a distance bar, turning every week row into a bar graph like the Dashboard weekly chart. Bars are colored by weekday and scaled to a common month-wide maximum so weeks are directly comparable; hover a bar for that day's activities, distance, time, and elevation.

Both overlays can be toggled independently in the popup under the Dashboard group.

<img width="989" alt="Calendar with streak highlights" src="https://s3.amazonaws.com/rwgps/screenshots/2026042211-50-36.png" />

### Custom Highlighter Colors

The color pickers for Speed Colors are built right into the Enhancements dropdown — no system color dialog required. Click any color swatch to open an inline HSV picker with a saturation/brightness gradient and a hue bar. You can also type a hex value directly into the text field.

### Segment Highlights on Tracks

Open any trip or route page that has segments. Segment coverage is automatically overlaid on the map track with colored highlights. Hover over a segment to see its name and stats. Click the start marker (triangle) of any segment to open a popup with more details and a link to the full segment page.

<img width="989" alt="image" src="https://s3.amazonaws.com/rwgps/screenshots/2026041218-07-54.png" />

### Track Colors and Line Width (Trips and Routes)

Toggle **Track Colors** in the Enhancements dropdown to recolor the RWGPS track line. The panel has a color picker, an **Opacity** slider, and a **Width** slider (50%–400% of the normal line width) for anyone who finds the default line hard to see. Settings are remembered and re-applied when the map style changes.

### Quick Laps (Trips, More Menu Tool)

On trip pages, open **More** and click **Quick Laps** (under `rwgps extension`) to start the finish-line lap tool.

<img width="989" alt="Quick Laps in More menu" src="https://s3.amazonaws.com/rwgps/screenshots/2026041216-32-17.png" />

### HR Zones (Trips with Heart Rate Data)

Open any trip page that has heart rate data. Toggle **HR Zones** in the Enhancements dropdown. Colored zone bars overlay the elevation graph, spanning the HR value range for each zone (Z1–Z5) so they align with the blue HR trace. Hover over the graph to see the current HR zone in the tooltip alongside elevation, speed, and bpm.

<img width="989" alt="HR Zones overlay on elevation graph" src="https://s3.amazonaws.com/rwgps/screenshots/2026041711-07-35.png" />

### Sample Time (Trips)

Open any recorded trip page and toggle **Sample Time** in the Enhancements dropdown. RWGPS's native elevation-graph hover tooltip gains a `HH:MM:SS` line showing the local time of day at the point under your cursor — appended below the existing elevation, speed, and HR values. Format follows your browser locale (12-hour with AM/PM in US, 24-hour elsewhere). The toggle is independent of every other feature, so you can see ride times with any or none of the other overlays active. Defaults on for trip pages.

<img width="856" alt="Elevation graph hover tooltip showing sample time below bpm" src="https://s3.amazonaws.com/rwgps/screenshots/2026042810-44-30.png" />

### ET Sample Time (Routes)

Open any route page and toggle **ET Sample Time** in the Enhancements dropdown. The elevation-graph hover tooltip gains an `ET h:mm` line showing the **estimated elapsed time** from the start at the point under your cursor — computed using your RWGPS grade-vs-speed profile (the same profile RWGPS uses for its own time estimates). It is a rough estimate, not a precise prediction. Defaults on for route pages.

### Public Lands Overlay (Planner, Routes, Trips)

Toggle **Public Lands** under the new **Layers** section of the Enhancements dropdown. Translucent polygons appear on the map showing public-lands boundaries:

- **In the US**: National Forest (USFS), National Park (NPS), BLM, Fish & Wildlife, DoD, and Bureau of Reclamation lands, from the Esri Living Atlas "USA Federal Lands" layer.
- **Elsewhere**: OpenStreetMap `boundary=protected_area` and `boundary=national_park` ways, fetched via the Overpass API.

Polygons load at zoom level 7 and closer (the legend says "Zoom in to load" when you're zoomed out further). The layer re-fetches as you pan, with bbox-keyed caching so revisited areas don't re-hit the network. No API keys required. Useful for finding ride-able forest roads, knowing where you can legally bikepack, and avoiding restricted-access areas.

### Weather Radar (Planner, Routes, Trips)

Toggle **Weather Radar** under **Layers** in the Enhancements dropdown. A translucent precipitation-radar overlay appears on the map, sourced from the free public [RainViewer](https://www.rainviewer.com/) API. Shows the latest available frame and auto-refreshes every 5 minutes. Global where radar coverage exists. No API keys required.

Turn on **Animate (last 2 hours)** under Weather Radar to loop the past two hours of radar in 10-minute steps, pausing briefly on the newest frame. A label in the bottom-left corner of the map shows the time of the frame on screen.

### Temperature (Planner, Routes, Trips)

Toggle **Temperature** under **Layers** in the Enhancements dropdown. Color-coded chips show the current air temperature at a grid of points across the visible map, in °F or °C to match your RWGPS units. Data comes from the free [Open-Meteo](https://open-meteo.com/) API (no key). Values refresh as you pan or zoom and every 15 minutes. Chips appear at zoom level 4 and closer.

### Hill Shading (Trips, Routes, and Planner)

Open any trip, route, or planner page using the RWGPS Cycle map style. Toggle **Hill Shading** in the Enhancements dropdown to adjust terrain shading. The Intensity slider scales the hillshade exaggeration from 0% to 500%, and the Sun Angle slider rotates the illumination direction. Settings persist across navigations. On planner pages, the Enhancements menu shows Hill Shading, ET Sample Time, and the Layers section.

<img width="989" alt="Hill Shading controls in Enhancements dropdown" src="https://s3.amazonaws.com/rwgps/screenshots/2026041619-08-25.png" />

### Heatmap Color & Opacity

On any map page with heatmap layers enabled, the extension injects a color picker and opacity slider into the native RWGPS heatmap dropdown for each layer (Global, Rides, Routes). Pick a custom color to make heatmap tiles easier to see, and adjust opacity to blend them with the base map.

<img width="989" alt="Heatmap color picker and opacity slider" src="https://s3.amazonaws.com/rwgps/screenshots/2026041220-39-05.png" />
