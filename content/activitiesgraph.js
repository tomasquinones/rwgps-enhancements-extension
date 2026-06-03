// Graph view for the Activities list page (/rides).
//
// Adds a "Graph" toggle next to the native "Show Map" control. When active it
// hides the activity list and shows a goal-style cumulative chart of the
// signed-in rider's own rides, navigable by year or by month, for distance,
// elevation, or moving time. Reuses window.RE.drawCumulativeChart (shared with
// the Goals chart) and window.RE.fetchUserTrips (cookie-only per-user fetch).
if (typeof browser === "undefined") { window.browser = chrome; }
(function () {
  "use strict";

  var PALETTES = {
    warm: { line: "#fa6400", area: "rgba(250, 100, 0, 0.08)", bar: "rgba(250, 100, 0, 0.18)", barAxis: "rgba(179, 70, 0, 0.7)", projection: "#d32f2f" },
    cool: { line: "#5c77ff", area: "rgba(92, 119, 255, 0.06)", bar: "rgba(184, 196, 255, 0.4)", barAxis: "rgba(92, 119, 255, 0.5)", projection: "#fa6400" },
  };

  var METRICS = [
    { key: "distance", label: "Distance" },
    { key: "elevation", label: "Elevation" },
    { key: "time", label: "Time" },
  ];

  var state = {
    active: false,
    metric: "distance",
    gran: "year", // "year" | "month"
    year: null,   // resolved on first render
    month: null,  // 0-11, for month granularity
  };

  var hiddenSiblings = []; // list/map nodes hidden while the graph is shown
  var tripsPromise = null; // cached fetch for the current user
  var tripsUserId = null;

  function isRidesPage() {
    return location.pathname === "/rides";
  }

  setInterval(checkPage, 1000);
  checkPage();

  async function checkPage() {
    var R = window.RE;
    if (R && R.contextInvalidated) return;

    var settings = R && R.safeStorageGet
      ? await R.safeStorageGet({ graphViewEnabled: true })
      : await browser.storage.local.get({ graphViewEnabled: true });
    if (!settings || !settings.graphViewEnabled) { teardown(); return; }

    if (!isRidesPage()) { teardown(); return; }

    // (Re)inject the toggle button if missing (survives SPA re-renders).
    var toggle = await window.RE.waitForElement('[class*="exploreToggle"]', 8000);
    if (!toggle || !isRidesPage()) return;
    if (!document.querySelector(".rwgps-graph-toggle")) injectButton(toggle);
  }

  function injectButton(exploreToggle) {
    var row = exploreToggle.parentNode;
    if (!row) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rwgps-graph-toggle" + (state.active ? " rwgps-graph-toggle-active" : "");
    btn.title = "Graph view";
    btn.innerHTML =
      '<svg viewBox="0 0 512 512" class="rwg-icon" height="20" width="20" aria-hidden="true">' +
        '<path fill="currentColor" d="M64 64v384h384v-40H104V64H64zm80 256 88-96 64 56 104-128 30 24-128 158-66-58-66 72-26-30z"/>' +
      '</svg>';
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      setActive(!state.active, exploreToggle);
    });
    row.insertBefore(btn, exploreToggle.nextSibling);
  }

  function setActive(on, exploreToggle) {
    state.active = on;
    var btn = document.querySelector(".rwgps-graph-toggle");
    if (btn) btn.classList.toggle("rwgps-graph-toggle-active", on);

    if (!on) { removePanel(); return; }
    renderPanel(exploreToggle);
  }

  // Mount the graph panel directly under the search/filter bar and hide the
  // list. The search bar and the list live inside the same card, so we anchor
  // on the search container and climb outward until we find a level that has
  // following siblings (the list — possibly several rows/cards). We hide those
  // and insert the panel right after the anchor at that level. Bounded by the
  // MainCol so we never hide the sidebar/other columns.
  function mountPanel(exploreToggle, panel) {
    var mainCol = exploreToggle.closest('[class*="MainCol"]');
    var anchor = exploreToggle.closest('[class*="searchContainer"]') ||
                 exploreToggle.closest('[class*="Card"]');
    if (!anchor || !anchor.parentNode) return false;

    var node = anchor;
    while (node && node !== mainCol && node.parentElement) {
      var following = [];
      var s = node.nextElementSibling;
      while (s) {
        if (!s.classList.contains("rwgps-rides-graph-panel")) following.push(s);
        s = s.nextElementSibling;
      }
      if (following.length) {
        for (var i = 0; i < following.length; i++) {
          following[i].style.display = "none";
          hiddenSiblings.push(following[i]);
        }
        node.parentElement.insertBefore(panel, node.nextSibling);
        return true;
      }
      node = node.parentElement;
    }
    // Fallback: nothing to hide — just mount right after the search bar.
    anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    return true;
  }

  function removePanel() {
    var panel = document.querySelector(".rwgps-rides-graph-panel");
    if (panel) panel.remove();
    for (var i = 0; i < hiddenSiblings.length; i++) {
      hiddenSiblings[i].style.display = "";
    }
    hiddenSiblings = [];
  }

  async function renderPanel(exploreToggle) {
    removePanel();
    hiddenSiblings = [];

    var panel = document.createElement("div");
    panel.className = "rwgps-rides-graph-panel";
    panel.appendChild(buildControls());

    var chart = document.createElement("div");
    chart.className = "rwgps-goal-chart rwgps-rides-graph-chart";
    var canvas = document.createElement("canvas");
    chart.appendChild(canvas);
    var tooltip = document.createElement("div");
    tooltip.className = "rwgps-goal-chart-tooltip";
    chart.appendChild(tooltip);
    var crosshair = document.createElement("div");
    crosshair.className = "rwgps-goal-chart-crosshair";
    chart.appendChild(crosshair);
    panel.appendChild(chart);

    if (!mountPanel(exploreToggle, panel)) return;

    await draw();

    // Redraw on resize (chart is responsive; replace canvas to drop listeners).
    if (!renderPanel._resizeBound) {
      renderPanel._resizeBound = true;
      var t = null;
      window.addEventListener("resize", function () {
        if (!state.active) return;
        clearTimeout(t);
        t = setTimeout(function () { draw(); }, 150);
      });
    }
  }

  function buildControls() {
    var bar = document.createElement("div");
    bar.className = "rwgps-rides-graph-controls";

    // Metric segmented control
    var metricGroup = document.createElement("div");
    metricGroup.className = "rwgps-rides-graph-seg";
    METRICS.forEach(function (m) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = m.label;
      b.setAttribute("data-active", state.metric === m.key ? "true" : "false");
      b.addEventListener("click", function () {
        if (state.metric === m.key) return;
        state.metric = m.key;
        refreshSeg(metricGroup, m.key);
        draw();
      });
      b.setAttribute("data-metric", m.key);
      metricGroup.appendChild(b);
    });
    bar.appendChild(metricGroup);

    // Granularity segmented control
    var granGroup = document.createElement("div");
    granGroup.className = "rwgps-rides-graph-seg";
    [["year", "Year"], ["month", "Month"]].forEach(function (g) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = g[1];
      b.setAttribute("data-metric", g[0]);
      b.setAttribute("data-active", state.gran === g[0] ? "true" : "false");
      b.addEventListener("click", function () {
        if (state.gran === g[0]) return;
        state.gran = g[0];
        refreshSeg(granGroup, g[0]);
        updateNavLabel();
        draw();
      });
      granGroup.appendChild(b);
    });
    bar.appendChild(granGroup);

    // Period navigation
    var nav = document.createElement("div");
    nav.className = "rwgps-rides-graph-nav";
    var prev = document.createElement("button");
    prev.type = "button";
    prev.className = "rwgps-rides-graph-navbtn";
    prev.textContent = "‹";
    prev.addEventListener("click", function () { stepPeriod(-1); });
    var label = document.createElement("span");
    label.className = "rwgps-rides-graph-period";
    var next = document.createElement("button");
    next.type = "button";
    next.className = "rwgps-rides-graph-navbtn";
    next.textContent = "›";
    next.addEventListener("click", function () { stepPeriod(1); });
    nav.appendChild(prev);
    nav.appendChild(label);
    nav.appendChild(next);
    bar.appendChild(nav);

    return bar;
  }

  function refreshSeg(group, activeKey) {
    var btns = group.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("data-active", btns[i].getAttribute("data-metric") === activeKey ? "true" : "false");
    }
  }

  function ensurePeriod() {
    var now = new Date();
    if (state.year == null) state.year = now.getFullYear();
    if (state.month == null) state.month = now.getMonth();
  }

  function stepPeriod(dir) {
    ensurePeriod();
    if (state.gran === "year") {
      state.year += dir;
    } else {
      state.month += dir;
      if (state.month < 0) { state.month = 11; state.year -= 1; }
      else if (state.month > 11) { state.month = 0; state.year += 1; }
    }
    // Don't navigate past the current period.
    var now = new Date();
    if (state.year > now.getFullYear() || (state.gran === "month" && state.year === now.getFullYear() && state.month > now.getMonth())) {
      stepPeriod(-dir);
      return;
    }
    updateNavLabel();
    draw();
  }

  function periodLabel() {
    ensurePeriod();
    if (state.gran === "year") return String(state.year);
    var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return months[state.month] + " " + state.year;
  }

  function updateNavLabel() {
    var el = document.querySelector(".rwgps-rides-graph-period");
    if (el) el.textContent = periodLabel();
    var next = document.querySelectorAll(".rwgps-rides-graph-navbtn")[1];
    if (next) {
      var now = new Date();
      var atPresent = state.gran === "year"
        ? state.year >= now.getFullYear()
        : (state.year === now.getFullYear() && state.month >= now.getMonth());
      next.disabled = atPresent;
    }
  }

  async function getTrips() {
    var userId = window.RE.getCurrentUserId();
    if (!userId) return [];
    if (tripsUserId !== userId) { tripsUserId = userId; tripsPromise = null; }
    if (!tripsPromise) tripsPromise = window.RE.fetchUserTrips(userId);
    return await tripsPromise;
  }

  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

  function metricConfig() {
    var metric = window.RE.isMetric();
    if (state.metric === "elevation") {
      return { field: ["elevation_gain", "elevationGain"], divisor: metric ? 1 : 0.3048, unit: metric ? "m" : "ft" };
    }
    if (state.metric === "time") {
      return { field: ["moving_time", "movingTime"], divisor: 3600, unit: "h" };
    }
    return { field: ["distance"], divisor: metric ? 1000 : 1609.34, unit: metric ? "km" : "mi" };
  }

  function valueOf(trip, fields) {
    for (var i = 0; i < fields.length; i++) {
      if (trip[fields[i]] != null) return trip[fields[i]] || 0;
    }
    return 0;
  }

  function tripDate(trip) {
    return trip.departed_at || trip.departedAt || trip.created_at || trip.createdAt || null;
  }

  function buildSeries(trips) {
    ensurePeriod();
    var cfg = metricConfig();
    var start, days;
    if (state.gran === "year") {
      start = new Date(state.year, 0, 1);
      days = isLeap(state.year) ? 366 : 365;
    } else {
      start = new Date(state.year, state.month, 1);
      days = new Date(state.year, state.month + 1, 0).getDate();
    }

    var dayVals = new Array(days).fill(0);
    for (var i = 0; i < trips.length; i++) {
      var ds = tripDate(trips[i]);
      if (!ds) continue;
      var d = new Date(ds);
      if (d.getFullYear() !== state.year) continue;
      if (state.gran === "month" && d.getMonth() !== state.month) continue;
      var local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var idx = Math.round((local - start) / 86400000);
      if (idx < 0 || idx >= days) continue;
      dayVals[idx] += valueOf(trips[i], cfg.field) / cfg.divisor;
    }

    // Build cumulative points up to today (so an in-progress period stops at
    // today and leaves future slots as empty, hoverable bars).
    var today = new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var lastDay = days - 1;
    var periodEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days - 1);
    if (today < periodEnd) {
      lastDay = Math.round((today - start) / 86400000);
    }
    if (lastDay < 0) lastDay = -1; // entirely future period

    var data = [];
    var cum = 0;
    for (var j = 0; j <= lastDay && j < days; j++) {
      cum += dayVals[j];
      data.push({
        day: j,
        date: new Date(start.getFullYear(), start.getMonth(), start.getDate() + j),
        cumulative: cum,
        dayDist: dayVals[j],
      });
    }
    return { data: data, totalDays: days, startDate: start, unit: cfg.unit };
  }

  async function draw() {
    var panel = document.querySelector(".rwgps-rides-graph-panel");
    if (!panel) return;
    updateNavLabel();

    var chart = panel.querySelector(".rwgps-rides-graph-chart");
    var tooltip = chart.querySelector(".rwgps-goal-chart-tooltip");
    var crosshair = chart.querySelector(".rwgps-goal-chart-crosshair");

    // Fresh canvas to drop old hover listeners.
    var old = chart.querySelector("canvas");
    var canvas = document.createElement("canvas");
    chart.replaceChild(canvas, old);

    var trips = await getTrips();
    if (!state.active) return; // toggled off while fetching
    var series = buildSeries(trips);

    var paletteKey = "cool";
    try {
      var s = window.RE.safeStorageGet
        ? await window.RE.safeStorageGet({ goalsChartPalette: "cool" })
        : await browser.storage.local.get({ goalsChartPalette: "cool" });
      if (s && s.goalsChartPalette === "warm") paletteKey = "warm";
    } catch (e) {}

    window.RE.drawCumulativeChart(
      canvas, series.data, series.totalDays, 0, series.unit,
      series.startDate, tooltip, crosshair, null, PALETTES[paletteKey]
    );
  }

  function teardown() {
    var btn = document.querySelector(".rwgps-graph-toggle");
    if (btn) btn.remove();
    removePanel();
    state.active = false;
  }
})();
