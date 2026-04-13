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

Navigate to ridewithgps.com/dashboard. The graphs appear automatically alongside your existing dashboard data.

<img width="1103" height="459" alt="image" src="https://github.com/user-attachments/assets/3beb4d3b-19c3-4bee-8b62-86162515c566" />

### Daylight Graph — Past Activities

Open any recorded trip/activity page. The daylight graph appears automatically.

<img width="1333" height="300" alt="image" src="https://github.com/user-attachments/assets/6acf79a0-2c7b-43c8-8357-212ef5620d22" />

### Daylight Graph — Routes (Planned Rides)

Open any route page. Set your planned start time and date using the controls the extension adds. The graph updates to show expected sun position and daylight window along the route.

<img width="1358" height="358" alt="image" src="https://github.com/user-attachments/assets/066f27b2-08e2-4504-a380-61c203978195" />

### Highlight Climbs and Descents

Open any trip or route page. Climbs and descents are automatically highlighted on both the map track and the elevation graph.

<img width="927" height="791" alt="image" src="https://github.com/user-attachments/assets/1a63e7ca-ba54-4ab9-9c16-913ef88e0039" />

### Goal Graph and Stats

Navigate to any goal detail page on ridewithgps.com (requires a goal set in your RWGPS account). A progress chart with stats card appears automatically, showing cumulative progress against the goal pace line. Weekly bars show activity volume on a secondary Y-axis. Supports both Distance and Elevation Gain goals.

<img width="989" alt="image" src="https://s3.amazonaws.com/rwgps/screenshots/2026041215-51-36.png" />

### Calendar Streak Highlight

Navigate to ridewithgps.com/calendar. Days in your current ride streak are highlighted with a subtle orange tint. Hover over any highlighted day to see a tooltip showing which day of the streak it is (e.g., "Day 15 of 19"). The highlight follows your streak across month boundaries as you navigate the calendar.

<img width="989" alt="image" src="https://s3.amazonaws.com/rwgps/screenshots/2026041117-54-24.png" />

### Custom Highlighter Colors

The color pickers for Speed Colors, Climbs, and Descents are built right into the Enhancements dropdown — no system color dialog required. Click any color swatch to open an inline HSV picker with a saturation/brightness gradient and a hue bar. You can also type a hex value directly into the text field.

<img width="989" alt="image" src="https://s3.amazonaws.com/rwgps/screenshots/2026041120-20-58.png" />

### Segment Highlights on Tracks

Open any trip or route page that has segments. Segment coverage is automatically overlaid on the map track with colored highlights. Hover over a segment to see its name and stats. Click the start marker (triangle) of any segment to open a popup with more details and a link to the full segment page.

<img width="989" alt="image" src="https://s3.amazonaws.com/rwgps/screenshots/2026041218-07-54.png" />

### Quick Laps (Trips, More Menu Tool)

On trip pages, open **More** and click **Quick Laps** (under `rwgps extension`) to start the finish-line lap tool.

<img width="989" alt="Quick Laps in More menu" src="https://s3.amazonaws.com/rwgps/screenshots/2026041216-32-17.png" />
