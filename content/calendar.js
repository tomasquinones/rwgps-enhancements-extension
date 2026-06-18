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
  var activeFeatures = { streak: false, graph: false };

  // Graph view state
  var graphMode = false;      // is the bar-graph view currently shown?
  var graphButton = null;     // the toolbar toggle button
  var graphTooltip = null;    // shared hover tooltip
  var graphHidden = [];       // [{ el, prev }] native cell children hidden in graph mode

  setInterval(checkPage, 1000);
  checkPage();

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
        calories: t.calories || 0
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
      ? await R.safeStorageGet({ calendarStreakEnabled: true, calendarGraphEnabled: true })
      : await browser.storage.local.get({ calendarStreakEnabled: true, calendarGraphEnabled: true });
    if (!settings) return;

    var wantStreak = !!settings.calendarStreakEnabled;
    var wantGraph = !!settings.calendarGraphEnabled;

    var isCalendar = location.pathname === "/calendar" || location.pathname.startsWith("/calendar/");
    if (!isCalendar || (!wantStreak && !wantGraph)) {
      cleanup();
      return;
    }

    var userId = R.getCurrentUserId();
    if (!userId) return;

    var pageKey = location.pathname + ":" + userId + ":" + (wantStreak ? "s" : "") + (wantGraph ? "v" : "");

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
      // Re-inject the graph button if React re-rendered the toolbar away.
      if (wantGraph && !document.querySelector(".rwgps-cal-graph-btn")) injectGraphButton();
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

    if (wantStreak) highlightStreak();
    if (wantGraph) injectGraphButton();
    watchForMonthChange(calendarGrid);
  }

  function cleanup() {
    clearHighlights();
    if (graphMode) clearGraph();
    graphMode = false;
    if (graphButton) { graphButton.remove(); graphButton = null; }
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
  }

})();
