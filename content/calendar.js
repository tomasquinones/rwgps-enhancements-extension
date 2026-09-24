(function () {
  "use strict";

  var R = window.RE;
  var TRIP_CACHE_MAX_AGE = 60 * 60 * 1000; // 1 hour

  var lastCalendarKey = null;
  var calendarSetupDone = false;
  var calendarObserver = null;
  var streakDayNumbers = null; // Map<dateStr, dayNumber>
  var debounceTimer = null;
  var lastMonthHeader = null;
  var activeFeatures = { streak: false, graph: false, views: false };

  // Graph view state
  var graphMode = false;      // is the bar-graph view currently shown?
  var graphButton = null;     // the toolbar toggle button
  var graphTooltip = null;    // shared hover tooltip
  var graphHidden = [];       // [{ el, prev }] native cell children hidden in graph mode

  // Multi-month / heatmap view state
  var calViewMode = "month";  // "month" | "3" | "6" | "12"
  var viewSwitcher = null;    // the segmented period control

  setInterval(checkPage, 1000);
  checkPage();

  // Re-fit responsive multi-month/heatmap cells when the window resizes.
  var multiResizeTimer = null;
  window.addEventListener("resize", function () {
    if (calViewMode === "month") return;
    if (multiResizeTimer) clearTimeout(multiResizeTimer);
    multiResizeTimer = setTimeout(function () {
      if (calViewMode !== "month") renderMultiView();
    }, 150);
  });

  // ─── Utilities (copies from content.js IIFE) ──────────────────────

  function toDateString(dateInput) {
    var d = new Date(dateInput);
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function subtractDays(dateStr, n) {
    var d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() - n);
    return toDateString(d);
  }

  // ─── Trip Cache (shared with content.js) ──────────────────────────

  function loadTripCache(userId) {
    var key = "tripCache_" + userId;
    return browser.storage.local.get(key).then(function (stored) {
      var entry = stored[key];
      if (!entry) return null;
      var age = Date.now() - (entry.ts || 0);
      if (age > TRIP_CACHE_MAX_AGE) return null;
      return { trips: entry.trips || [], range: entry.range || null };
    }).catch(function () { return null; });
  }

  function saveTripCache(userId, trips, range) {
    var key = "tripCache_" + userId;
    var slim = trips.map(function (t) {
      return {
        name: t.name || t.title || "",
        departedAt: t.departedAt || t.departed_at || t.createdAt || t.created_at,
        distance: t.distance || 0,
        movingTime: t.movingTime || t.moving_time || 0,
        elevationGain: t.elevationGain || t.elevation_gain || 0,
        calories: t.calories || 0,
        photos_count: tripPhotoCount(t)
      };
    });
    browser.storage.local.set({ [key]: { trips: slim, range: range, ts: Date.now() } }).catch(function () {});
  }

  function fetchTripsForRange(userId, startStr, endStr) {
    var minDate = startStr || "2000-01-01";
    var tomorrow = subtractDays(toDateString(new Date()), -1);
    var maxDate = endStr < tomorrow ? subtractDays(endStr, -1) : tomorrow;
    var todayStr = toDateString(new Date());
    var includestoday = maxDate >= todayStr;

    return loadTripCache(userId).then(function (cached) {
      if (!includestoday && cached && cached.range &&
          cached.range.min <= minDate && cached.range.max >= maxDate) {
        return cached.trips;
      }

      // Fetch from API
      var allTrips = [];
      function fetchPage(page) {
        var params = new URLSearchParams({
          user_id: userId,
          departed_at_min: minDate,
          departed_at_max: maxDate,
          per_page: "200",
          page: String(page)
        });
        return R.rwgpsFetch("/trips.json?" + params).then(function (data) {
          if (!data) return allTrips;
          var trips = data.results || [];
          allTrips = allTrips.concat(trips);
          var totalCount = data.results_count || data.total_count || 0;
          if (allTrips.length >= totalCount || trips.length < 200) return allTrips;
          return fetchPage(page + 1);
        });
      }

      return fetchPage(0).then(function (trips) {
        var range = { min: minDate, max: maxDate };
        saveTripCache(userId, trips, range);
        return trips;
      });
    });
  }

  // ─── Streak Computation ───────────────────────────────────────────

  function computeStreakDays(userId) {
    var today = toDateString(new Date());
    var oneYearAgo = subtractDays(today, 365);

    return fetchTripsForRange(userId, oneYearAgo, today).then(function (allTrips) {
      // Build day map
      var daySet = {};
      for (var i = 0; i < allTrips.length; i++) {
        var trip = allTrips[i];
        var dateField = trip.departedAt || trip.departed_at || trip.createdAt || trip.created_at;
        if (!dateField) continue;
        var day = toDateString(dateField);
        daySet[day] = true;
      }

      // Walk backwards to find consecutive streak days
      var startOffset = daySet[today] ? 0 : 1;
      var streakDates = [];

      for (var j = startOffset; ; j++) {
        var checkDay = subtractDays(today, j);
        if (daySet[checkDay]) {
          streakDates.push(checkDay);
        } else {
          break;
        }
      }

      if (streakDates.length === 0) return new Map();

      // Reverse so oldest = Day 1, most recent = Day N
      streakDates.reverse();
      var result = new Map();
      for (var k = 0; k < streakDates.length; k++) {
        result.set(streakDates[k], k + 1);
      }
      return result;
    });
  }

  // ─── Calendar DOM Interaction ─────────────────────────────────────

  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  var MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function parseHeaderMonthYear() {
    // Header element: DIV._currentDate_ofq35_28 containing "April 2026"
    var header = document.querySelector('[class*="currentDate"]');
    if (!header) return null;
    var match = header.textContent.trim().match(/([A-Za-z]+)\s+(\d{4})/);
    if (!match) return null;
    var monthIdx = MONTH_NAMES.indexOf(match[1]);
    if (monthIdx < 0) return null;
    return { month: monthIdx, year: parseInt(match[2], 10) };
  }

  function findDayCells() {
    var cells = [];

    var headerDate = parseHeaderMonthYear();
    if (!headerDate) return cells;

    // Day cells: DIV._Day_dm5pw_1, date labels: DIV._date_dm5pw_22
    // Grey class (_grey_) indicates adjacent-month days
    var dayCells = document.querySelectorAll('[class*="Day_"]');
    if (dayCells.length === 0) return cells;

    var headerMonth = headerDate.month;
    var headerYear = headerDate.year;

    for (var i = 0; i < dayCells.length; i++) {
      var dayEl = dayCells[i];
      var dateLabel = dayEl.querySelector('[class*="date_"]');
      if (!dateLabel) continue;
      var dateTxt = dateLabel.textContent.trim();
      // RWGPS shows "Apr 1" on the 1st of each month — extract trailing number
      var dateMatch = dateTxt.match(/(\d+)\s*$/);
      if (!dateMatch) continue;
      var dayNum = parseInt(dateMatch[1], 10);
      if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) continue;

      // Determine the actual month for this cell
      var isGrey = (dayEl.className || "").indexOf("grey") >= 0;
      var cellMonth = headerMonth;
      var cellYear = headerYear;

      if (isGrey) {
        // Grey cells are from adjacent months
        if (dayNum > 15) {
          // High day number + grey = previous month
          cellMonth = headerMonth - 1;
          if (cellMonth < 0) { cellMonth = 11; cellYear--; }
        } else {
          // Low day number + grey = next month
          cellMonth = headerMonth + 1;
          if (cellMonth > 11) { cellMonth = 0; cellYear++; }
        }
      }

      var dateStr = cellYear + "-" + String(cellMonth + 1).padStart(2, "0") + "-" + String(dayNum).padStart(2, "0");
      cells.push({ element: dayEl, dateStr: dateStr });
    }

    return cells;
  }

  function clearHighlights() {
    var highlights = document.querySelectorAll(".rwgps-calendar-streak-highlight, .rwgps-calendar-streak-tooltip");
    for (var i = 0; i < highlights.length; i++) {
      highlights[i].remove();
    }
    // Remove position:relative we may have added
    var cells = document.querySelectorAll("[data-rwgps-streak-day]");
    for (var j = 0; j < cells.length; j++) {
      cells[j].removeAttribute("data-rwgps-streak-day");
    }
  }

  function highlightStreak() {
    clearHighlights();
    if (!streakDayNumbers || streakDayNumbers.size === 0) return;

    var cells = findDayCells();
    if (cells.length === 0) return;

    var totalStreakDays = streakDayNumbers.size;

    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var dayNumber = streakDayNumbers.get(cell.dateStr);
      if (!dayNumber) continue;

      // Ensure cell has position:relative for absolute children
      var pos = window.getComputedStyle(cell.element).position;
      if (pos === "static") cell.element.style.position = "relative";
      cell.element.setAttribute("data-rwgps-streak-day", dayNumber);

      // Add highlight overlay
      var highlight = document.createElement("div");
      highlight.className = "rwgps-calendar-streak-highlight";
      cell.element.appendChild(highlight);

      // Add tooltip (hidden, shown on hover)
      var tooltip = document.createElement("div");
      tooltip.className = "rwgps-calendar-streak-tooltip";
      tooltip.textContent = "Day " + dayNumber + " of " + totalStreakDays;
      cell.element.appendChild(tooltip);

      // Hover handlers on the cell itself
      (function (cellEl, tooltipEl) {
        cellEl.addEventListener("mouseenter", function () {
          tooltipEl.style.display = "block";
        });
        cellEl.addEventListener("mouseleave", function () {
          tooltipEl.style.display = "none";
        });
      })(cell.element, tooltip);
    }
  }

  function reapplyEnabledOverlays() {
    if (calViewMode !== "month") { renderMultiView(); return; }
    if (activeFeatures.streak && streakDayNumbers) highlightStreak();
    if (graphMode) renderGraph();
  }

  // ─── Calendar Graph View ──────────────────────────────────────────
  // A toolbar toggle (left of the native Settings gear) that swaps each day
  // cell's content for a distance bar, turning every week row into a bar graph
  // like the Dashboard weekly chart. Bars are colored by weekday (rainbow) and
  // scaled to a common month-wide max so weeks are comparable.

  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return "0m";
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? (h + "h " + m + "m") : (m + "m");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // dateStr -> array of { name, dist(m), time(s), ele(m) }, one per activity,
  // sorted chronologically so the morning ride is the leftmost bar.
  // Trip photo count across the API's various field shapes.
  function tripPhotoCount(t) {
    if (!t) return 0;
    if (typeof t.photos_count === "number") return t.photos_count;
    if (typeof t.photosCount === "number") return t.photosCount;
    if (typeof t.photo_count === "number") return t.photo_count;
    if (Array.isArray(t.photos)) return t.photos.length;
    return 0;
  }

  function dayActivitiesMap(trips) {
    var map = {};
    for (var i = 0; i < trips.length; i++) {
      var t = trips[i];
      var df = t.departedAt || t.departed_at || t.createdAt || t.created_at;
      if (!df) continue;
      var day = toDateString(df);
      if (!map[day]) map[day] = [];
      map[day].push({
        name: (t.name || t.title || "Activity"),
        dist: (t.distance || 0),
        time: (t.movingTime || t.moving_time || 0),
        ele: (t.elevationGain || t.elevation_gain || 0),
        cal: (t.calories || 0),
        photos: tripPhotoCount(t),
        ts: new Date(df).getTime()
      });
    }
    for (var k in map) {
      if (map.hasOwnProperty(k)) map[k].sort(function (a, b) { return a.ts - b.ts; });
    }
    return map;
  }

  function ensureGraphTooltip() {
    if (graphTooltip && graphTooltip.isConnected) return graphTooltip;
    graphTooltip = document.createElement("div");
    graphTooltip.className = "rwgps-cal-graph-tooltip";
    document.body.appendChild(graphTooltip);
    return graphTooltip;
  }

  function findSettingsAnchor() {
    // The control is something like <a><svg gear/>Settings</a>, so match the
    // SMALLEST element whose entire trimmed text is "Settings" (the wrapper
    // itself — its only descendant is the gear icon), then prefer its
    // clickable ancestor.
    var nodes = document.querySelectorAll("button, a, [role='button'], span, div");
    var best = null, bestCount = Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if ((el.textContent || "").trim() !== "Settings") continue;
      var count = el.getElementsByTagName("*").length;
      if (count < bestCount) { bestCount = count; best = el; }
    }
    if (!best) return null;
    return best.closest("button, a, [role='button']") || best;
  }

  function injectGraphButton() {
    if (document.querySelector(".rwgps-cal-graph-btn")) return;
    var anchor = findSettingsAnchor();
    if (!anchor || !anchor.parentNode) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rwgps-cal-graph-btn" + (graphMode ? " rwgps-cal-graph-btn-active" : "");
    btn.title = "Graph view";
    btn.setAttribute("aria-label", "Toggle graph view");
    btn.innerHTML = '<svg viewBox="0 0 512 512" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M64 64v384h384v-40H104V64H64zm80 256 88-96 64 56 104-128 30 24-128 158-66-58-66 72-26-30z"/></svg>';
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleGraph();
    });
    anchor.parentNode.insertBefore(btn, anchor);
    graphButton = btn;
  }

  function toggleGraph() {
    graphMode = !graphMode;
    if (graphButton) graphButton.classList.toggle("rwgps-cal-graph-btn-active", graphMode);
    if (graphMode) renderGraph();
    else clearGraph();
  }

  function clearGraph() {
    for (var i = 0; i < graphHidden.length; i++) {
      try { graphHidden[i].el.style.display = graphHidden[i].prev; } catch (e) {}
    }
    graphHidden = [];
    var extras = document.querySelectorAll(".rwgps-cal-graph-track, .rwgps-cal-graph-date");
    for (var j = 0; j < extras.length; j++) extras[j].remove();
    var cells = document.querySelectorAll(".rwgps-cal-graph-cell");
    for (var k = 0; k < cells.length; k++) cells[k].classList.remove("rwgps-cal-graph-cell");
    if (graphTooltip) graphTooltip.style.display = "none";
  }

  async function renderGraph() {
    var userId = R.getCurrentUserId();
    if (!userId) return;
    var cells = findDayCells();
    if (cells.length === 0) return;

    var dates = cells.map(function (c) { return c.dateStr; }).sort();
    var minD = dates[0], maxD = dates[dates.length - 1];

    var trips = await fetchTripsForRange(userId, minD, maxD);
    if (!graphMode) return; // toggled off while fetching
    var dayMap = dayActivitiesMap(trips);

    var metric = R.isMetric();
    var distDiv = metric ? 1000 : 1609.34;
    var eleMul = metric ? 1 : 3.28084;
    var distUnit = metric ? "km" : "mi";
    var eleUnit = metric ? "m" : "ft";

    // Scale to the largest single activity across the month so every bar is
    // comparable (days are split into one bar per activity).
    var maxDist = 0;
    for (var i = 0; i < cells.length; i++) {
      var acts = dayMap[cells[i].dateStr];
      if (!acts) continue;
      for (var a = 0; a < acts.length; a++) {
        var d = acts[a].dist / distDiv;
        if (d > maxDist) maxDist = d;
      }
    }

    clearGraph();
    ensureGraphTooltip();

    for (var c = 0; c < cells.length; c++) {
      paintCell(cells[c], dayMap[cells[c].dateStr], maxDist, distDiv, eleMul, distUnit, eleUnit);
    }
  }

  function paintCell(cell, acts, maxDist, distDiv, eleMul, distUnit, eleUnit) {
    var el = cell.element;
    if (window.getComputedStyle(el).position === "static") el.style.position = "relative";
    el.classList.add("rwgps-cal-graph-cell");

    // Hide ALL native content (robust to whatever wrapping RWGPS uses), then
    // render our own small date number so the cell stays oriented.
    for (var i = 0; i < el.children.length; i++) {
      var ch = el.children[i];
      if (ch.classList.contains("rwgps-cal-graph-track") || ch.classList.contains("rwgps-cal-graph-date")) continue;
      graphHidden.push({ el: ch, prev: ch.style.display });
      ch.style.display = "none";
    }

    var dayNum = new Date(cell.dateStr + "T12:00:00").getDate();
    var dateEl = document.createElement("div");
    dateEl.className = "rwgps-cal-graph-date";
    dateEl.textContent = dayNum;
    el.appendChild(dateEl);

    var wd = new Date(cell.dateStr + "T12:00:00").getDay(); // 0=Sun … 6=Sat
    var color = (R.prideColorAt) ? R.prideColorAt(wd / 6) : "#f56200";

    var track = document.createElement("div");
    track.className = "rwgps-cal-graph-track";

    if (!acts || acts.length === 0) {
      // Empty day — faint baseline stub.
      var stub = document.createElement("div");
      stub.className = "rwgps-cal-graph-bar rwgps-cal-graph-bar-empty";
      stub.style.height = "2px";
      track.appendChild(stub);
    } else {
      for (var a = 0; a < acts.length; a++) {
        track.appendChild(makeActivityBar(acts[a], maxDist, distDiv, eleMul, distUnit, eleUnit, color));
      }
    }
    el.appendChild(track);
  }

  // One bar for one activity, with a name + stats hover tooltip.
  function makeActivityBar(act, maxDist, distDiv, eleMul, distUnit, eleUnit, color) {
    var dist = act.dist / distDiv;
    var time = act.time;
    var ele = act.ele * eleMul;
    var name = act.name || "Activity";
    var pct = maxDist > 0 ? (dist / maxDist) * 100 : 0;

    var bar = document.createElement("div");
    bar.className = "rwgps-cal-graph-bar" + (dist <= 0 ? " rwgps-cal-graph-bar-empty" : "");
    bar.style.height = dist > 0 ? Math.max(2, pct) + "%" : "2px";
    if (dist > 0) bar.style.background = color;

    bar.addEventListener("mouseenter", function () {
      var tip = ensureGraphTooltip();
      var html = "<strong>" + escapeHtml(name) + "</strong>";
      html += "<br>" + dist.toFixed(1) + " " + distUnit;
      if (time > 0) html += "<br>" + formatDuration(time);
      if (ele > 0) html += "<br>" + Math.round(ele).toLocaleString() + " " + eleUnit + " elev";
      tip.innerHTML = html;
      tip.style.display = "block";
      var r = bar.getBoundingClientRect();
      tip.style.left = (window.scrollX + r.left + r.width / 2) + "px";
      tip.style.top = (window.scrollY + r.top - 8) + "px";
    });
    bar.addEventListener("mouseleave", function () {
      if (graphTooltip) graphTooltip.style.display = "none";
    });
    return bar;
  }

  // ─── Multi-Month & Year Heatmap Views ─────────────────────────────
  // A segmented period switcher (left of the native Settings gear) swaps the
  // single-month calendar for a 3-month or 6-month stack of heat-shaded month
  // grids, or a GitHub-style 12-month day heatmap. Days are colored by total
  // ridden distance using the extension's orange "more = warmer" ramp.

  var HEAT_LOW = [255, 241, 230];
  var HEAT_HIGH = [196, 62, 0];
  var HEAT_EMPTY = "#ebedef";
  var HEAT_STOPS = [0.18, 0.42, 0.68, 1]; // ramp position for levels 1-4

  function heatColor(t) {
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return "rgb(" +
      Math.round(HEAT_LOW[0] + (HEAT_HIGH[0] - HEAT_LOW[0]) * t) + "," +
      Math.round(HEAT_LOW[1] + (HEAT_HIGH[1] - HEAT_LOW[1]) * t) + "," +
      Math.round(HEAT_LOW[2] + (HEAT_HIGH[2] - HEAT_LOW[2]) * t) + ")";
  }

  // Bucket a day's distance into 0 (no ride) … 4 (busiest). A sqrt scale keeps
  // low-mileage days distinguishable from rest days.
  function distLevel(v, max) {
    if (v <= 0) return 0;
    if (max <= 0) return 1;
    return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(v / max) * 4)));
  }

  function levelColor(level) {
    return level <= 0 ? HEAT_EMPTY : heatColor(HEAT_STOPS[level - 1]);
  }

  function pad2(n) { return String(n).padStart(2, "0"); }
  function ymd(y, m, d) { return y + "-" + pad2(m + 1) + "-" + pad2(d); }

  function dayMeters(acts) {
    var sum = 0;
    if (acts) for (var i = 0; i < acts.length; i++) sum += acts[i].dist || 0;
    return sum;
  }

  // ── Toolbar switcher ──────────────────────────────────────────────

  function injectViewSwitcher() {
    if (document.querySelector(".rwgps-cal-view-seg")) return;
    // Sit to the left of the graph toggle if present, otherwise left of Settings.
    var anchor = document.querySelector(".rwgps-cal-graph-btn") || findSettingsAnchor();
    if (!anchor || !anchor.parentNode) return;

    var seg = document.createElement("div");
    seg.className = "rwgps-cal-view-seg";
    [["month", "Month"], ["3", "3 Mo"], ["6", "6 Mo"], ["12", "Year"]].forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = o[1];
      b.setAttribute("data-view", o[0]);
      b.setAttribute("data-active", calViewMode === o[0] ? "true" : "false");
      b.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        setViewMode(o[0]);
      });
      seg.appendChild(b);
    });
    anchor.parentNode.insertBefore(seg, anchor);
    viewSwitcher = seg;
  }

  function updateSwitcherActive() {
    if (!viewSwitcher) return;
    var btns = viewSwitcher.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("data-active", btns[i].getAttribute("data-view") === calViewMode ? "true" : "false");
    }
  }

  function setViewMode(mode) {
    if (mode === calViewMode) return;
    calViewMode = mode;
    updateSwitcherActive();

    if (mode === "month") {
      removeMultiPanel();
      showNativeGrid();
      if (graphButton && graphButton.isConnected) graphButton.style.display = "";
      else if (activeFeatures.graph) injectGraphButton();
      // Restore whatever single-month overlays were enabled.
      if (activeFeatures.streak && streakDayNumbers) highlightStreak();
      if (graphMode) renderGraph();
    } else {
      // Multi-month views own the grid area; stand down the single-month graph.
      if (graphMode) {
        graphMode = false;
        if (graphButton) graphButton.classList.remove("rwgps-cal-graph-btn-active");
        clearGraph();
      }
      if (graphButton) graphButton.style.display = "none";
      clearHighlights();
      renderMultiView();
    }
  }

  // ── Native grid hide / restore ────────────────────────────────────

  // The grid container holding the month's day cells. Climb from any day cell
  // until an ancestor holds most of a month (≥21 cells), robust to RWGPS's
  // mangled class names.
  function getCalendarGridEl() {
    var cell = document.querySelector('[class*="Day_"]');
    if (!cell) return null;
    var node = cell.parentElement;
    while (node && node.querySelectorAll('[class*="Day_"]').length < 21) {
      node = node.parentElement;
    }
    return node || cell.parentElement;
  }

  function hideNativeGrid(grid) {
    if (!grid) return;
    if (!grid.hasAttribute("data-rwgps-cal-hidden")) {
      grid.setAttribute("data-rwgps-cal-hidden", grid.style.display || "");
    }
    // Re-assert even if previously marked — React may have reset inline styles.
    if (grid.style.display !== "none") grid.style.display = "none";
  }

  function showNativeGrid() {
    var hidden = document.querySelectorAll("[data-rwgps-cal-hidden]");
    for (var i = 0; i < hidden.length; i++) {
      hidden[i].style.display = hidden[i].getAttribute("data-rwgps-cal-hidden");
      hidden[i].removeAttribute("data-rwgps-cal-hidden");
    }
  }

  function ensureMultiPanel(grid) {
    var existing = document.querySelector(".rwgps-cal-multi");
    if (existing && existing.isConnected) return existing;
    var panel = document.createElement("div");
    panel.className = "rwgps-cal-multi";
    if (grid && grid.parentNode) {
      grid.parentNode.insertBefore(panel, grid);
    } else {
      var header = document.querySelector('[class*="currentDate"]');
      var host = header ? header.closest("div") : null;
      if (host && host.parentNode) host.parentNode.appendChild(panel);
      else return null;
    }
    return panel;
  }

  function removeMultiPanel() {
    var panels = document.querySelectorAll(".rwgps-cal-multi");
    for (var i = 0; i < panels.length; i++) panels[i].remove();
  }

  // ── Render orchestration ──────────────────────────────────────────

  // Short-lived memo of dateStr -> activities so switching between the 3/6/12
  // views doesn't re-hit the network each time.
  var multiDayMapCache = null; // { userId, ts, dayMap }

  async function loadMultiDayMap(userId) {
    if (multiDayMapCache && multiDayMapCache.userId === userId &&
        (Date.now() - multiDayMapCache.ts) < 60000) {
      return multiDayMapCache.dayMap;
    }
    // The Year view stacks every calendar year back to ~2007, so we need the
    // rider's full history. fetchUserTrips is cached (and shared with the
    // Activities Graph); fall back to a wide range fetch if it's unavailable.
    var trips;
    try {
      if (R.fetchUserTrips) {
        trips = await R.fetchUserTrips(userId);
      } else {
        trips = await fetchTripsForRange(userId, "2007-01-01", toDateString(new Date()));
      }
    } catch (e) {
      trips = [];
    }
    var dayMap = dayActivitiesMap(trips);
    multiDayMapCache = { userId: userId, ts: Date.now(), dayMap: dayMap };
    return dayMap;
  }

  async function renderMultiView() {
    if (calViewMode === "month") return;
    var userId = R.getCurrentUserId();
    if (!userId) return;
    var mode = calViewMode;

    var grid = getCalendarGridEl();
    if (grid) hideNativeGrid(grid);
    var panel = ensureMultiPanel(grid);
    if (!panel) return;
    if (!panel.firstChild) {
      panel.innerHTML = '<div class="rwgps-cal-multi-status">Loading…</div>';
    }

    var dayMap = await loadMultiDayMap(userId);
    if (calViewMode !== mode) return; // mode changed (or toggled off) while fetching

    // React may have re-rendered the grid during the await — re-acquire.
    grid = getCalendarGridEl();
    if (grid) hideNativeGrid(grid);
    panel = ensureMultiPanel(grid);
    if (!panel) return;

    var metric = R.isMetric();
    panel.innerHTML = "";
    if (mode === "12") renderHeatmap(panel, dayMap, metric);
    else renderMonthGrids(panel, dayMap, mode === "6" ? 6 : 3, metric);
  }

  function attachHeatHover(el, dateStr, acts, distDiv, unit) {
    el.addEventListener("mouseenter", function () {
      var tip = ensureGraphTooltip();
      var v = dayMeters(acts) / distDiv;
      var nice = new Date(dateStr + "T12:00:00").toLocaleDateString(undefined,
        { weekday: "short", month: "short", day: "numeric", year: "numeric" });
      var html = "<strong>" + escapeHtml(nice) + "</strong>";
      if (acts && acts.length) {
        html += "<br>" + v.toFixed(1) + " " + unit + " · " +
          acts.length + (acts.length > 1 ? " rides" : " ride");
      } else {
        html += "<br>No rides";
      }
      tip.innerHTML = html;
      tip.style.display = "block";
      var r = el.getBoundingClientRect();
      tip.style.left = (window.scrollX + r.left + r.width / 2) + "px";
      tip.style.top = (window.scrollY + r.top - 6) + "px";
    });
    el.addEventListener("mouseleave", function () {
      if (graphTooltip) graphTooltip.style.display = "none";
    });
  }

  function buildLegend(unit, max) {
    var leg = document.createElement("div");
    leg.className = "rwgps-cal-heat-legend";
    var less = document.createElement("span");
    less.className = "rwgps-cal-heat-legtext";
    less.textContent = "Less";
    leg.appendChild(less);
    for (var l = 0; l <= 4; l++) {
      var sw = document.createElement("span");
      sw.className = "rwgps-cal-heat-legsw";
      sw.style.background = levelColor(l);
      leg.appendChild(sw);
    }
    var more = document.createElement("span");
    more.className = "rwgps-cal-heat-legtext";
    more.textContent = "More" + (max > 0 ? " (" + Math.round(max).toLocaleString() + " " + unit + ")" : "");
    leg.appendChild(more);
    return leg;
  }

  // ── 3 / 6-month stacked grids ─────────────────────────────────────

  function renderMonthGrids(panel, dayMap, n, metric) {
    var distDiv = metric ? 1000 : 1609.34;
    var unit = metric ? "km" : "mi";
    var now = new Date();

    var months = []; // most recent first
    for (var i = 0; i < n; i++) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ y: d.getFullYear(), m: d.getMonth() });
    }

    // Common color scale across all displayed months.
    var max = 0;
    months.forEach(function (mo) {
      var dim = new Date(mo.y, mo.m + 1, 0).getDate();
      for (var day = 1; day <= dim; day++) {
        var v = dayMeters(dayMap[ymd(mo.y, mo.m, day)]) / distDiv;
        if (v > max) max = v;
      }
    });

    panel.appendChild(buildLegend(unit, max));
    months.forEach(function (mo) {
      panel.appendChild(buildMonthGrid(mo.y, mo.m, dayMap, max, distDiv, unit));
    });
  }

  function buildMonthGrid(year, month, dayMap, max, distDiv, unit) {
    var wrap = document.createElement("div");
    wrap.className = "rwgps-cal-mg";

    var title = document.createElement("div");
    title.className = "rwgps-cal-mg-title";
    title.textContent = MONTH_NAMES[month] + " " + year;
    wrap.appendChild(title);

    var head = document.createElement("div");
    head.className = "rwgps-cal-mg-head";
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach(function (w) {
      var c = document.createElement("div");
      c.className = "rwgps-cal-mg-wd";
      c.textContent = w;
      head.appendChild(c);
    });
    wrap.appendChild(head);

    var gridEl = document.createElement("div");
    gridEl.className = "rwgps-cal-mg-grid";

    var firstDow = new Date(year, month, 1).getDay();
    for (var b = 0; b < firstDow; b++) {
      var blank = document.createElement("div");
      blank.className = "rwgps-cal-mg-cell rwgps-cal-mg-blank";
      gridEl.appendChild(blank);
    }

    var dim = new Date(year, month + 1, 0).getDate();
    var todayStr = toDateString(new Date());
    for (var day = 1; day <= dim; day++) {
      var ds = ymd(year, month, day);
      var acts = dayMap[ds];
      var future = ds > todayStr;
      var lvl = future ? 0 : distLevel(dayMeters(acts) / distDiv, max);

      var cell = document.createElement("div");
      cell.className = "rwgps-cal-mg-cell" +
        (future ? " rwgps-cal-mg-future" : (lvl <= 0 ? " rwgps-cal-mg-empty" : "")) +
        (ds === todayStr ? " rwgps-cal-mg-today" : "");
      if (!future) cell.style.background = levelColor(lvl);

      var num = document.createElement("span");
      num.className = "rwgps-cal-mg-num";
      num.textContent = day;
      num.style.color = future ? "#b3b9b9" : (lvl >= 3 ? "#fff" : (lvl <= 0 ? "#8a9191" : "#1b2828"));
      cell.appendChild(num);

      if (!future) attachHeatHover(cell, ds, acts, distDiv, unit);
      gridEl.appendChild(cell);
    }

    wrap.appendChild(gridEl);
    return wrap;
  }

  // ── GitHub-style per-calendar-year day heatmaps ───────────────────
  // One grid per year, current year on top and previous years stacked below,
  // back to the earliest year with rides (floored at 2007). A single distance
  // scale is shared across all years so a day's color means the same thing
  // every year.

  var RWGPS_FOUNDING_YEAR = 2007;

  function renderHeatmap(panel, dayMap, metric) {
    var distDiv = metric ? 1000 : 1609.34;
    var unit = metric ? "km" : "mi";
    var GAP = 3, WLABEL = 30;

    var today = new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var currentYear = today.getFullYear();

    // Earliest year that has rides (clamped so stray/bad dates can't explode
    // the range). Always show at least the current year.
    var earliest = currentYear, max = 0;
    for (var ds in dayMap) {
      if (!dayMap.hasOwnProperty(ds)) continue;
      var y = parseInt(ds.slice(0, 4), 10);
      if (y < RWGPS_FOUNDING_YEAR || y > currentYear) continue;
      if (y < earliest) earliest = y;
      var v = dayMeters(dayMap[ds]) / distDiv;
      if (v > max) max = v;
    }

    // Uniform cell size across all years, sized so a full 53-week year fills
    // the panel. Partial (current) years are simply left-aligned and shorter.
    var avail = (panel.clientWidth || 0) - 8;
    var CELL = 13;
    if (avail > 0) {
      CELL = Math.floor((avail - WLABEL - GAP * 53) / 53);
      CELL = Math.max(11, Math.min(30, CELL));
    }

    panel.appendChild(buildLegend(unit, max));

    for (var year = currentYear; year >= earliest; year--) {
      panel.appendChild(buildYearGrid(year, dayMap, {
        CELL: CELL, GAP: GAP, WLABEL: WLABEL, today: today,
        distDiv: distDiv, unit: unit, max: max, metric: metric
      }));
    }
  }

  // Sum a calendar year's activities across all six headline metrics.
  function computeYearTotals(dayMap, year) {
    var t = { dist: 0, ele: 0, time: 0, photos: 0, activities: 0, cal: 0 };
    var prefix = year + "-";
    for (var ds in dayMap) {
      if (!dayMap.hasOwnProperty(ds) || ds.slice(0, 5) !== prefix) continue;
      var acts = dayMap[ds];
      for (var i = 0; i < acts.length; i++) {
        var a = acts[i];
        t.dist += a.dist || 0;
        t.ele += a.ele || 0;
        t.time += a.time || 0;
        t.photos += a.photos || 0;
        t.cal += a.cal || 0;
        t.activities++;
      }
    }
    return t;
  }

  // A compact stat strip summarizing a year: distance, elevation, duration,
  // photos, activities, calories. Rendered beside the year heading.
  function buildYearTotals(t, distDiv, unit, metric) {
    var eleMul = metric ? 1 : 3.28084;
    var eleUnit = metric ? "m" : "ft";
    var stats = [
      [Math.round(t.dist / distDiv).toLocaleString() + " " + unit, "Distance"],
      [Math.round(t.ele * eleMul).toLocaleString() + " " + eleUnit, "Elevation"],
      [formatDuration(t.time), "Duration"],
      [t.activities.toLocaleString(), t.activities === 1 ? "Activity" : "Activities"],
      [Math.round(t.cal).toLocaleString(), "Calories"]
    ];
    var strip = document.createElement("div");
    strip.className = "rwgps-cal-year-totals";
    stats.forEach(function (s) {
      var item = document.createElement("div");
      item.className = "rwgps-cal-year-stat";
      var val = document.createElement("span");
      val.className = "rwgps-cal-year-stat-val";
      val.textContent = s[0];
      var lab = document.createElement("span");
      lab.className = "rwgps-cal-year-stat-lab";
      lab.textContent = s[1];
      item.appendChild(val);
      item.appendChild(lab);
      strip.appendChild(item);
    });
    return strip;
  }

  function buildYearGrid(year, dayMap, o) {
    var CELL = o.CELL, GAP = o.GAP, WLABEL = o.WLABEL;
    var jan1 = new Date(year, 0, 1);
    var dec31 = new Date(year, 11, 31);
    var rangeEnd = (year === o.today.getFullYear()) ? o.today : dec31;

    // Sunday on/before Jan 1 → Sunday-aligned week columns through the year.
    var start = new Date(jan1);
    start.setDate(start.getDate() - start.getDay());

    var cols = []; // each: array of 7 Date objects (Sun..Sat)
    var cur = new Date(start);
    while (cur <= rangeEnd) {
      var days = [];
      for (var d = 0; d < 7; d++) {
        var dd = new Date(cur);
        dd.setDate(dd.getDate() + d);
        days.push(dd);
      }
      cols.push(days);
      cur.setDate(cur.getDate() + 7);
    }

    var wrap = document.createElement("div");
    wrap.className = "rwgps-cal-year";

    var head = document.createElement("div");
    head.className = "rwgps-cal-year-head";

    var heading = document.createElement("div");
    heading.className = "rwgps-cal-year-title";
    heading.textContent = year;
    head.appendChild(heading);

    head.appendChild(buildYearTotals(computeYearTotals(dayMap, year), o.distDiv, o.unit, o.metric));
    wrap.appendChild(head);

    var scroll = document.createElement("div");
    scroll.className = "rwgps-cal-heat-scroll";

    // Month labels: placed at the week column that holds the 1st of each month.
    var monthsRow = document.createElement("div");
    monthsRow.className = "rwgps-cal-heat-months";
    monthsRow.style.marginLeft = WLABEL + "px";
    monthsRow.style.marginBottom = "5px";
    monthsRow.style.gap = GAP + "px";
    cols.forEach(function (days) {
      var lab = document.createElement("div");
      lab.className = "rwgps-cal-heat-mlabel";
      lab.style.width = CELL + "px";
      for (var i = 0; i < days.length; i++) {
        if (days[i].getDate() === 1 && days[i].getFullYear() === year) {
          lab.textContent = MONTH_SHORT[days[i].getMonth()];
          break;
        }
      }
      monthsRow.appendChild(lab);
    });
    scroll.appendChild(monthsRow);

    var body = document.createElement("div");
    body.className = "rwgps-cal-heat-body";

    var wdays = document.createElement("div");
    wdays.className = "rwgps-cal-heat-wdays";
    wdays.style.gap = GAP + "px";
    wdays.style.width = WLABEL + "px";
    var WD = ["", "Mon", "", "Wed", "", "Fri", ""];
    for (var w = 0; w < 7; w++) {
      var wl = document.createElement("div");
      wl.className = "rwgps-cal-heat-wd";
      wl.style.height = CELL + "px";
      wl.style.lineHeight = CELL + "px";
      wl.textContent = WD[w];
      wdays.appendChild(wl);
    }
    body.appendChild(wdays);

    var gridEl = document.createElement("div");
    gridEl.className = "rwgps-cal-heat-grid";
    gridEl.style.gap = GAP + "px";
    var todayStr = toDateString(o.today);
    cols.forEach(function (days) {
      var col = document.createElement("div");
      col.className = "rwgps-cal-heat-col";
      col.style.gap = GAP + "px";
      days.forEach(function (dd) {
        var cell = document.createElement("div");
        cell.className = "rwgps-cal-heat-cell";
        cell.style.width = CELL + "px";
        cell.style.height = CELL + "px";
        // Only this calendar year's days are rendered; padding days (from the
        // adjacent year) and future days are left blank for alignment.
        if (dd < jan1 || dd > dec31 || dd > o.today) {
          cell.classList.add("rwgps-cal-heat-future");
          cell.style.background = "transparent";
        } else {
          var ds = toDateString(dd);
          var acts = dayMap[ds];
          var lvl = distLevel(dayMeters(acts) / o.distDiv, o.max);
          cell.style.background = levelColor(lvl);
          if (ds === todayStr) cell.classList.add("rwgps-cal-heat-today");
          attachHeatHover(cell, ds, acts, o.distDiv, o.unit);
        }
        col.appendChild(cell);
      });
      gridEl.appendChild(col);
    });
    body.appendChild(gridEl);
    scroll.appendChild(body);
    wrap.appendChild(scroll);
    return wrap;
  }

  // ─── Month Change Watcher ─────────────────────────────────────────

  function getCurrentMonthHeader() {
    var header = document.querySelector('[class*="currentDate"]');
    return header ? header.textContent.trim() : null;
  }

  function watchForMonthChange(container) {
    if (calendarObserver) calendarObserver.disconnect();
    lastMonthHeader = getCurrentMonthHeader();

    calendarObserver = new MutationObserver(function () {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        var currentHeader = getCurrentMonthHeader();
        if (calViewMode !== "month") {
          // A multi-month view owns the grid. If our panel was lost to a
          // re-render, rebuild it; otherwise just make sure the native grid
          // stays hidden (React may have reset its inline style).
          if (!document.querySelector(".rwgps-cal-multi")) {
            renderMultiView();
          } else {
            var grid = getCalendarGridEl();
            if (grid) hideNativeGrid(grid);
          }
          if (currentHeader !== lastMonthHeader) lastMonthHeader = currentHeader;
          return;
        }
        if (currentHeader !== lastMonthHeader) {
          // Month changed — re-discover cells and re-apply overlays
          lastMonthHeader = currentHeader;
          reapplyEnabledOverlays();
        } else {
          // React re-render may have removed our overlays
          var streakGone = activeFeatures.streak && !document.querySelector(".rwgps-calendar-streak-highlight");
          var graphGone = graphMode && !document.querySelector(".rwgps-cal-graph-track");
          if (streakGone || graphGone) reapplyEnabledOverlays();
        }
      }, 300);
    });

    calendarObserver.observe(container, { childList: true, subtree: true });
  }

  // ─── Page Check ───────────────────────────────────────────────────

  async function checkPage() {
    var R = window.RE;
    if (R && R.contextInvalidated) return;
    var settings = R && R.safeStorageGet
      ? await R.safeStorageGet({ calendarStreakEnabled: true, calendarGraphEnabled: true, calendarViewsEnabled: true })
      : await browser.storage.local.get({ calendarStreakEnabled: true, calendarGraphEnabled: true, calendarViewsEnabled: true });
    if (!settings) return;

    var wantStreak = !!settings.calendarStreakEnabled;
    var wantGraph = !!settings.calendarGraphEnabled;
    var wantViews = !!settings.calendarViewsEnabled;

    var isCalendar = location.pathname === "/calendar" || location.pathname.startsWith("/calendar/");
    if (!isCalendar || (!wantStreak && !wantGraph && !wantViews)) {
      cleanup();
      return;
    }

    var userId = R.getCurrentUserId();
    if (!userId) return;

    var pageKey = location.pathname + ":" + userId + ":" + (wantStreak ? "s" : "") + (wantGraph ? "v" : "") + (wantViews ? "m" : "");

    // Toggle-off of a previously-active feature while staying on the page
    if (calendarSetupDone) {
      if (activeFeatures.streak && !wantStreak) {
        clearHighlights();
        activeFeatures.streak = false;
      }
      if (activeFeatures.graph && !wantGraph) {
        if (graphMode) { graphMode = false; clearGraph(); }
        if (graphButton) { graphButton.remove(); graphButton = null; }
        activeFeatures.graph = false;
      }
      if (activeFeatures.views && !wantViews) {
        if (calViewMode !== "month") { calViewMode = "month"; removeMultiPanel(); showNativeGrid(); }
        if (viewSwitcher) { viewSwitcher.remove(); viewSwitcher = null; }
        if (graphButton) graphButton.style.display = "";
        activeFeatures.views = false;
      }
      // Re-inject toolbar controls if React re-rendered them away.
      if (wantGraph && calViewMode === "month" && !document.querySelector(".rwgps-cal-graph-btn")) injectGraphButton();
      if (wantViews && !document.querySelector(".rwgps-cal-view-seg")) injectViewSwitcher();
      if (pageKey === lastCalendarKey) return;
    }

    lastCalendarKey = pageKey;
    calendarSetupDone = true;

    // Wait for the calendar grid to appear
    var calendarGrid = await R.waitForElement("table, [class*='calendar'], [class*='Calendar']", 10000);
    if (!calendarGrid) return;

    // Recheck we're still on the calendar page
    if (!location.pathname.startsWith("/calendar")) return;

    if (wantStreak && !streakDayNumbers) {
      streakDayNumbers = await computeStreakDays(userId);
    }

    activeFeatures.streak = wantStreak;
    activeFeatures.graph = wantGraph;
    activeFeatures.views = wantViews;

    if (wantStreak && calViewMode === "month") highlightStreak();
    if (wantGraph) injectGraphButton();
    if (wantViews) injectViewSwitcher();
    if (calViewMode !== "month") {
      if (graphButton) graphButton.style.display = "none";
      renderMultiView();
    }
    watchForMonthChange(calendarGrid);
  }

  function cleanup() {
    clearHighlights();
    if (graphMode) clearGraph();
    graphMode = false;
    if (graphButton) { graphButton.remove(); graphButton = null; }
    removeMultiPanel();
    showNativeGrid();
    if (viewSwitcher) { viewSwitcher.remove(); viewSwitcher = null; }
    calViewMode = "month";
    if (calendarObserver) {
      calendarObserver.disconnect();
      calendarObserver = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    lastCalendarKey = null;
    calendarSetupDone = false;
    streakDayNumbers = null;
    activeFeatures.streak = false;
    activeFeatures.graph = false;
    activeFeatures.views = false;
  }

})();
