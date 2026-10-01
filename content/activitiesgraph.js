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
    pride: { pride: true, line: "#750787", area: "rgba(117, 7, 135, 0.06)", bar: "rgba(117, 7, 135, 0.18)", barAxis: "rgba(90, 97, 97, 0.8)", projection: "#1b2828" },
  };

  var METRICS = [
    { key: "distance", label: "Distance" },
    { key: "elevation", label: "Elevation" },
    { key: "time", label: "Time" },
  ];

  var MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Sequential color scale for the year-comparison heatmap: pale tint (low) to
  // deep orange (high). Empty cells use HEAT_EMPTY.
  var HEAT_LOW = [255, 241, 230];
  var HEAT_HIGH = [196, 62, 0];
  var HEAT_EMPTY = "#f1f3f3";

  function heatColor(t) {
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var r = Math.round(HEAT_LOW[0] + (HEAT_HIGH[0] - HEAT_LOW[0]) * t);
    var g = Math.round(HEAT_LOW[1] + (HEAT_HIGH[1] - HEAT_LOW[1]) * t);
    var b = Math.round(HEAT_LOW[2] + (HEAT_HIGH[2] - HEAT_LOW[2]) * t);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  // Distinct per-year colors for the stacked / ridgeline / 3D views. Falls back
  // to an even HSL spread when a rider has more years than fixed colors.
  var YEAR_COLORS = ["#f56200", "#5c77ff", "#2bb673", "#9b51e0", "#00a8b5", "#e0245e", "#f2a900", "#1b8a4a", "#6457f2", "#d4541e", "#0f8b8d", "#b5179e"];

  function colorForYear(index, count) {
    if (count <= YEAR_COLORS.length) return YEAR_COLORS[index % YEAR_COLORS.length];
    return "hsl(" + Math.round((index * 360) / count) + ", 62%, 52%)";
  }

  // The chart styles available in the multi-year ("Years") view.
  var YEAR_CHARTS = [
    { key: "heatmap", label: "Heatmap" },
    { key: "totals", label: "Totals" },
    { key: "stacked", label: "Stacked" },
    { key: "iso", label: "3D" },
    { key: "stream", label: "Stream" },
    { key: "lines", label: "Lines" },
  ];

  var state = {
    active: false,
    metric: "distance",
    gran: "year", // "year" | "month" | "years"
    yearChart: "heatmap", // chart style within the "years" view (see YEAR_CHARTS)
    totalsSort: "chrono", // "chrono" | "asc" — ordering for the Totals chart
    year: null,   // resolved on first render
    month: null,  // 0-11, for month granularity
  };

  var hiddenSiblings = []; // list/map nodes hidden while the graph is shown
  // How long a fetched trip list is reused for redraws (period steps, metric
  // switches, resizes) before refetching to pick up new rides.
  var TRIPS_TTL_MS = 10 * 60 * 1000;
  // The toggle wait below can take up to 8 s; without this guard every 1 s
  // tick would stack another document-wide MutationObserver.
  var checkPageRunning = false;

  function isRidesPage() {
    return location.pathname === "/rides";
  }

  setInterval(checkPage, 1000);
  checkPage();

  async function checkPage() {
    if (checkPageRunning) return;
    checkPageRunning = true;
    try {
      await checkPageInner();
    } finally {
      checkPageRunning = false;
    }
  }

  async function checkPageInner() {
    var R = window.RE;
    if (R.contextInvalidated) return;

    var settings = await R.safeStorageGet({ graphViewEnabled: true });
    if (!settings || !settings.graphViewEnabled) { teardown(); return; }

    if (!isRidesPage()) { teardown(); return; }

    // (Re)inject the toggle button if missing (survives SPA re-renders).
    if (document.querySelector(".rwgps-graph-toggle")) return;
    var toggle = await R.waitForElement('[class*="exploreToggle"]', 8000);
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

    var legend = document.createElement("div");
    legend.className = "rwgps-rides-graph-legend";
    panel.appendChild(legend);

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
    [["year", "Year"], ["month", "Month"], ["years", "Years"]].forEach(function (g) {
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

    // Chart-style segmented control (only shown in the "years" view).
    var typeGroup = document.createElement("div");
    typeGroup.className = "rwgps-rides-graph-seg rwgps-rides-graph-typeseg";
    YEAR_CHARTS.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = c.label;
      b.setAttribute("data-metric", c.key);
      b.setAttribute("data-active", state.yearChart === c.key ? "true" : "false");
      b.addEventListener("click", function () {
        if (state.yearChart === c.key) return;
        state.yearChart = c.key;
        refreshSeg(typeGroup, c.key);
        draw();
      });
      typeGroup.appendChild(b);
    });
    bar.appendChild(typeGroup);

    // Sort control (only shown for the Totals chart).
    var sortGroup = document.createElement("div");
    sortGroup.className = "rwgps-rides-graph-seg rwgps-rides-graph-sortseg";
    [["chrono", "By year"], ["asc", "By total"]].forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = o[1];
      b.setAttribute("data-metric", o[0]);
      b.setAttribute("data-active", state.totalsSort === o[0] ? "true" : "false");
      b.addEventListener("click", function () {
        if (state.totalsSort === o[0]) return;
        state.totalsSort = o[0];
        refreshSeg(sortGroup, o[0]);
        draw();
      });
      sortGroup.appendChild(b);
    });
    bar.appendChild(sortGroup);

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
    // The year-comparison view spans all years, so the period stepper is N/A;
    // the chart-style picker is shown only there.
    var nav = document.querySelector(".rwgps-rides-graph-nav");
    if (nav) nav.style.display = state.gran === "years" ? "none" : "";
    var typeSeg = document.querySelector(".rwgps-rides-graph-typeseg");
    if (typeSeg) typeSeg.style.display = state.gran === "years" ? "" : "none";
    var sortSeg = document.querySelector(".rwgps-rides-graph-sortseg");
    if (sortSeg) sortSeg.style.display = (state.gran === "years" && state.yearChart === "totals") ? "" : "none";
    if (state.gran === "years") return;

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

  // Trips for the current view. Year and Month views only page back to Jan 1
  // of the shown year (so stepping months within a year reuses one fetch);
  // the all-years view needs the full history. The shared fetcher caches per
  // user and serves any cached list that reaches back far enough.
  async function getTrips() {
    var userId = window.RE.getCurrentUserId();
    if (!userId) return [];
    var since = null;
    if (state.gran !== "years") {
      ensurePeriod();
      since = new Date(state.year, 0, 1); // local midnight
    }
    return await window.RE.fetchUserTrips(userId, { since: since, ttl: TRIPS_TTL_MS });
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

  // Monthly totals per year for the current metric. Returns years ascending and
  // a { year: [12 monthly totals] } map.
  function buildYearMatrix(trips) {
    var cfg = metricConfig();
    var totals = {};
    for (var i = 0; i < trips.length; i++) {
      var ds = tripDate(trips[i]);
      if (!ds) continue;
      var d = new Date(ds);
      var y = d.getFullYear();
      if (!totals[y]) totals[y] = new Array(12).fill(0);
      totals[y][d.getMonth()] += valueOf(trips[i], cfg.field) / cfg.divisor;
    }
    var years = Object.keys(totals).map(Number).sort(function (a, b) { return a - b; });
    return { years: years, totals: totals, unit: cfg.unit };
  }

  function chartFmt(n) {
    if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (n >= 100) return Math.round(n).toString();
    return n.toFixed(1);
  }

  // Heatmap matrix: year rows (recent at top) × month columns. Cell color
  // intensity encodes the metric total for that year/month; empty cells render
  // gray. A sqrt scale keeps low-volume early years visible alongside big
  // recent ones. Hover any cell for the exact year/month/value.
  function drawHeatmap(canvas, matrix, tooltip, crosshair) {
    var years = matrix.years.slice().reverse(); // most recent on top
    var unit = matrix.unit;
    crosshair.style.display = "none";

    var uiFont = '"aktiv-grotesk", "Aktiv Grotesk", "Open Sans", "Gill Sans MT", Corbel, Arial, sans-serif';
    var dpr = window.devicePixelRatio || 1;
    var cs = window.getComputedStyle(canvas.parentNode);
    var padL = parseFloat(cs.paddingLeft) || 0;
    var padT = parseFloat(cs.paddingTop) || 0;
    var width = canvas.parentNode.offsetWidth - padL - (parseFloat(cs.paddingRight) || 0);

    var padding = { top: 26, right: 12, bottom: 10, left: 48 };
    var rows = Math.max(years.length, 1);
    var rowH = Math.max(14, Math.min(32, Math.floor((520 - padding.top - padding.bottom) / rows)));
    var plotW = width - padding.left - padding.right;
    var plotH = rows * rowH;
    var height = padding.top + plotH + padding.bottom;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);

    var maxV = 0;
    for (var yi = 0; yi < years.length; yi++) {
      var row = matrix.totals[years[yi]];
      for (var mi = 0; mi < 12; mi++) if (row[mi] > maxV) maxV = row[mi];
    }

    var colW = plotW / 12;
    var gap = 2;
    var segs = []; // {x, y, w, h, year, value, month}

    ctx.textBaseline = "middle";
    for (var r = 0; r < rows; r++) {
      var year = years[r];
      var totals = matrix.totals[year];
      var cy = padding.top + r * rowH;
      for (var m = 0; m < 12; m++) {
        var v = totals[m];
        var cx = padding.left + m * colW;
        ctx.fillStyle = v > 0 ? heatColor(maxV > 0 ? Math.sqrt(v / maxV) : 0) : HEAT_EMPTY;
        ctx.fillRect(cx + gap / 2, cy + gap / 2, colW - gap, rowH - gap);
        segs.push({ x: cx, y: cy, w: colW, h: rowH, year: year, value: v, month: m });
      }
      ctx.fillStyle = "#5b6161";
      ctx.font = (rowH >= 18 ? "12px " : "11px ") + uiFont;
      ctx.textAlign = "right";
      ctx.fillText(String(year), padding.left - 8, cy + rowH / 2);
    }

    // Month labels along the top.
    ctx.fillStyle = "#5b6161";
    ctx.font = "12px " + uiFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (var ml = 0; ml < 12; ml++) {
      ctx.fillText(MONTH_SHORT[ml], padding.left + ml * colW + colW / 2, padding.top - 9);
    }

    canvas.addEventListener("mousemove", function (e) {
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var hit = null;
      for (var si = 0; si < segs.length; si++) {
        var s = segs[si];
        if (mx >= s.x && mx <= s.x + s.w && my >= s.y && my <= s.y + s.h) { hit = s; break; }
      }
      if (!hit) { tooltip.style.display = "none"; return; }

      tooltip.innerHTML = "<strong>" + MONTH_SHORT[hit.month] + " " + hit.year + "</strong><br>" +
        (hit.value > 0 ? chartFmt(hit.value) + " " + unit : "No rides");
      tooltip.style.display = "block";
      var domX = hit.x + hit.w / 2 + padL;
      var tw = tooltip.offsetWidth;
      if (domX + tw + 20 > canvas.parentNode.offsetWidth) {
        tooltip.style.left = (domX - tw - 12) + "px";
      } else {
        tooltip.style.left = (domX + 12) + "px";
      }
      tooltip.style.top = (hit.y + hit.h / 2 + padT - 10) + "px";
    });
    canvas.addEventListener("mouseleave", function () {
      tooltip.style.display = "none";
    });

    renderHeatmapLegend(maxV, unit);
  }

  // Gradient scale legend (low → high) for the heatmap.
  function renderHeatmapLegend(maxV, unit) {
    var legend = document.querySelector(".rwgps-rides-graph-legend");
    if (!legend) return;
    legend.innerHTML = "";
    if (state.gran !== "years") return;

    var lo = document.createElement("span");
    lo.className = "rwgps-rides-graph-legend-item";
    lo.textContent = "Less";
    var bar = document.createElement("span");
    bar.className = "rwgps-rides-graph-heat-scale";
    bar.style.background = "linear-gradient(to right, " + heatColor(0.05) + ", " + heatColor(1) + ")";
    var hi = document.createElement("span");
    hi.className = "rwgps-rides-graph-legend-item";
    hi.textContent = "More" + (maxV > 0 ? " (" + chartFmt(maxV) + " " + unit + ")" : "");
    legend.appendChild(lo);
    legend.appendChild(bar);
    legend.appendChild(hi);
  }

  function clearLegend() {
    var legend = document.querySelector(".rwgps-rides-graph-legend");
    if (legend) legend.innerHTML = "";
  }

  function niceTicks(max, count) {
    if (!(max > 0)) return [0];
    var rawStep = max / count;
    var mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    var res = rawStep / mag;
    var step = res <= 1.5 ? mag : res <= 3 ? 2 * mag : res <= 7 ? 5 * mag : 10 * mag;
    var ticks = [];
    for (var t = 0; t <= max; t += step) ticks.push(Math.round(t * 100) / 100);
    return ticks;
  }

  var CHART_FONT = '"aktiv-grotesk", "Aktiv Grotesk", "Open Sans", "Gill Sans MT", Corbel, Arial, sans-serif';

  // Per-year color-swatch legend, ascending (oldest first) to match the stack
  // and 3D color assignment.
  function renderYearLegend(years) {
    var legend = document.querySelector(".rwgps-rides-graph-legend");
    if (!legend) return;
    legend.innerHTML = "";
    if (state.gran !== "years") return;
    for (var i = 0; i < years.length; i++) {
      var item = document.createElement("span");
      item.className = "rwgps-rides-graph-legend-item";
      var sw = document.createElement("span");
      sw.className = "rwgps-rides-graph-legend-swatch";
      sw.style.background = colorForYear(i, years.length);
      item.appendChild(sw);
      item.appendChild(document.createTextNode(String(years[i])));
      legend.appendChild(item);
    }
  }

  // Set up a canvas for HiDPI drawing and return its 2D context plus layout.
  function setupCanvas(canvas, height) {
    var dpr = window.devicePixelRatio || 1;
    var cs = window.getComputedStyle(canvas.parentNode);
    var padL = parseFloat(cs.paddingLeft) || 0;
    var padT = parseFloat(cs.paddingTop) || 0;
    var width = canvas.parentNode.offsetWidth - padL - (parseFloat(cs.paddingRight) || 0);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    return { ctx: ctx, width: width, padL: padL, padT: padT };
  }

  // ── Stacked bars: 12 month columns, one segment per year (oldest at bottom).
  function drawStackedYears(canvas, matrix, tooltip, crosshair) {
    var years = matrix.years, unit = matrix.unit;
    crosshair.style.display = "none";
    renderYearLegend(years);

    var width = canvas.parentNode.offsetWidth - 30;
    var height = Math.min(560, Math.max(320, width * 0.5));
    var s = setupCanvas(canvas, height);
    var ctx = s.ctx;
    var padding = { top: 20, right: 16, bottom: 36, left: 56 };
    var plotW = s.width - padding.left - padding.right;
    var plotH = height - padding.top - padding.bottom;

    var maxY = 0;
    for (var m = 0; m < 12; m++) {
      var sum = 0;
      for (var yi = 0; yi < years.length; yi++) sum += matrix.totals[years[yi]][m];
      if (sum > maxY) maxY = sum;
    }
    maxY = maxY > 0 ? maxY * 1.05 : 1;

    var ticks = niceTicks(maxY, 5);
    ctx.strokeStyle = "#dce0e0";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#5b6161";
    ctx.font = "12px " + CHART_FONT;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (var ti = 0; ti < ticks.length; ti++) {
      var gy = padding.top + plotH - (ticks[ti] / maxY) * plotH;
      ctx.beginPath();
      ctx.moveTo(padding.left, gy);
      ctx.lineTo(padding.left + plotW, gy);
      ctx.stroke();
      ctx.fillText(chartFmt(ticks[ti]), padding.left - 8, gy);
    }

    var slotW = plotW / 12;
    var barW = Math.min(48, slotW * 0.62);
    var segs = [];
    for (var mo = 0; mo < 12; mo++) {
      var cx = padding.left + mo * slotW + slotW / 2;
      var baseY = padding.top + plotH;
      for (var yj = 0; yj < years.length; yj++) {
        var val = matrix.totals[years[yj]][mo];
        if (val <= 0) continue;
        var h = (val / maxY) * plotH;
        var topY = baseY - h;
        ctx.fillStyle = colorForYear(yj, years.length);
        ctx.fillRect(cx - barW / 2, topY, barW, h);
        segs.push({ x: cx - barW / 2, y: topY, w: barW, h: h, year: years[yj], value: val, month: mo });
        baseY = topY;
      }
    }

    ctx.fillStyle = "#5b6161";
    ctx.font = "12px " + CHART_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (var ml = 0; ml < 12; ml++) {
      ctx.fillText(MONTH_SHORT[ml], padding.left + ml * slotW + slotW / 2, padding.top + plotH + 8);
    }

    bindSegHover(canvas, tooltip, segs, s.padL, s.padT, unit, function (hit) {
      return "<strong>" + MONTH_SHORT[hit.month] + " " + hit.year + "</strong><br>" + chartFmt(hit.value) + " " + unit;
    });
  }

  // ── 3D isometric bars: X=month, depth=year, height=distance. Colored by
  // value (taller = deeper orange). Acknowledged poor for exact reading; here
  // for visual comparison. Drawn back-to-front; hover hit-tests front-to-back.
  function draw3DBars(canvas, matrix, tooltip, crosshair) {
    var years = matrix.years; // ascending; nearest (front) = most recent
    var unit = matrix.unit;
    crosshair.style.display = "none";
    renderHeatmapLegend(0, unit); // gradient (value-encoded); maxV set below

    var rows = Math.max(years.length, 1);
    var probeW = canvas.parentNode.offsetWidth - 30;
    // Reserve ~56px on the right for the year labels so the far (oldest) row
    // label doesn't clip on narrower windows.
    var hw = Math.max(8, Math.min(26, (probeW - 56) / (12 + rows)));
    var hh = hw * 0.5;
    var maxBarPx = Math.max(40, Math.min(150, hh * 7));
    var padding = { top: 12, right: 44, bottom: 28, left: 20 };

    var ox = padding.left + (rows - 1) * hw + hw;
    var oy = padding.top + maxBarPx;
    var maxDepth = (11 + rows - 1);
    var height = oy + maxDepth * hh + hh + padding.bottom;
    var s = setupCanvas(canvas, height);
    var ctx = s.ctx;

    var maxV = 0;
    for (var yi = 0; yi < years.length; yi++) {
      var r0 = matrix.totals[years[yi]];
      for (var mi = 0; mi < 12; mi++) if (r0[mi] > maxV) maxV = r0[mi];
    }
    if (!(maxV > 0)) maxV = 1;
    renderHeatmapLegend(maxV, unit);

    // Cells ordered back (small m+depthIdx) to front. depthIdx: most recent
    // year should be in front, so depth grows for older years.
    var cells = [];
    for (var r = 0; r < rows; r++) {
      var depthIdx = r; // years ascending: index 0 (oldest) at back
      for (var m = 0; m < 12; m++) {
        cells.push({ m: m, depth: depthIdx, year: years[r], value: matrix.totals[years[r]][m] });
      }
    }
    cells.sort(function (a, b) { return (a.m + a.depth) - (b.m + b.depth) || a.depth - b.depth; });

    function cellCenter(m, depth) {
      return { x: ox + (m - depth) * hw, y: oy + (m + depth) * hh };
    }

    var hitList = [];
    for (var ci = 0; ci < cells.length; ci++) {
      var c = cells[ci];
      var ctr = cellCenter(c.m, c.depth);
      var H = c.value > 0 ? Math.sqrt(c.value / maxV) * maxBarPx : 0;
      var fw = hw * 0.82, fh = hh * 0.82;
      var N = [ctr.x, ctr.y - fh], E = [ctr.x + fw, ctr.y], S = [ctr.x, ctr.y + fh], W = [ctr.x - fw, ctr.y];
      if (H <= 0) {
        // Empty cell: faint diamond footprint.
        ctx.beginPath();
        ctx.moveTo(N[0], N[1]); ctx.lineTo(E[0], E[1]); ctx.lineTo(S[0], S[1]); ctx.lineTo(W[0], W[1]); ctx.closePath();
        ctx.fillStyle = "#f1f3f3";
        ctx.fill();
        continue;
      }
      var Nt = [N[0], N[1] - H], Et = [E[0], E[1] - H], St = [S[0], S[1] - H], Wt = [W[0], W[1] - H];
      var base = heatRgb(Math.sqrt(c.value / maxV));
      // Left face (W-S), right face (S-E), then top.
      fillPoly(ctx, [W, S, St, Wt], rgbStr(shade(base, 0.72)));
      fillPoly(ctx, [S, E, Et, St], rgbStr(shade(base, 0.85)));
      fillPoly(ctx, [Nt, Et, St, Wt], rgbStr(base));
      hitList.push({ poly: [Wt, Nt, Et, E, S, W], year: c.year, value: c.value, month: c.m });
    }

    // Month labels along the front-bottom edge.
    ctx.fillStyle = "#5b6161";
    ctx.font = "11px " + CHART_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (var ml = 0; ml < 12; ml++) {
      var fc = cellCenter(ml, rows - 1);
      ctx.fillText(MONTH_SHORT[ml], fc.x, fc.y + hh + 4);
    }

    // Year labels along the right (month-11) edge — the depth axis. Drawn last,
    // on top of the bars, with a white halo so they stay readable where the
    // edge passes behind taller bars.
    ctx.font = "11px " + CHART_FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    for (var yr = 0; yr < rows; yr++) {
      var lc = cellCenter(11, yr);
      var lx = lc.x + hw * 0.82 + 5;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.strokeText(String(years[yr]), lx, lc.y);
      ctx.fillStyle = "#1b2828";
      ctx.fillText(String(years[yr]), lx, lc.y);
    }

    canvas.addEventListener("mousemove", function (e) {
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var hit = null;
      for (var i = hitList.length - 1; i >= 0; i--) { // front-to-back
        if (pointInPoly(mx, my, hitList[i].poly)) { hit = hitList[i]; break; }
      }
      if (!hit) { tooltip.style.display = "none"; return; }
      tooltip.innerHTML = "<strong>" + MONTH_SHORT[hit.month] + " " + hit.year + "</strong><br>" + chartFmt(hit.value) + " " + unit;
      tooltip.style.display = "block";
      var domX = mx + s.padL;
      var tw = tooltip.offsetWidth;
      tooltip.style.left = (domX + tw + 24 > canvas.parentNode.offsetWidth ? domX - tw - 14 : domX + 14) + "px";
      tooltip.style.top = (my + s.padT - 28) + "px";
    });
    canvas.addEventListener("mouseleave", function () { tooltip.style.display = "none"; });
  }

  // Small geometry/color helpers for the stacked/ridgeline/3D renderers.
  function bindSegHover(canvas, tooltip, segs, padL, padT, unit, fmt) {
    canvas.addEventListener("mousemove", function (e) {
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var hit = null;
      for (var si = 0; si < segs.length; si++) {
        var s = segs[si];
        if (mx >= s.x && mx <= s.x + s.w && my >= s.y && my <= s.y + s.h) { hit = s; break; }
      }
      if (!hit) { tooltip.style.display = "none"; return; }
      tooltip.innerHTML = fmt(hit);
      tooltip.style.display = "block";
      var domX = hit.x + hit.w / 2 + padL;
      var tw = tooltip.offsetWidth;
      tooltip.style.left = (domX + tw + 20 > canvas.parentNode.offsetWidth ? domX - tw - 12 : domX + 12) + "px";
      tooltip.style.top = (hit.y + padT - 10) + "px";
    });
    canvas.addEventListener("mouseleave", function () { tooltip.style.display = "none"; });
  }

  function fillPoly(ctx, pts, color) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function pointInPoly(px, py, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function heatRgb(t) {
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return [
      Math.round(HEAT_LOW[0] + (HEAT_HIGH[0] - HEAT_LOW[0]) * t),
      Math.round(HEAT_LOW[1] + (HEAT_HIGH[1] - HEAT_LOW[1]) * t),
      Math.round(HEAT_LOW[2] + (HEAT_HIGH[2] - HEAT_LOW[2]) * t),
    ];
  }
  function rgbStr(a) { return "rgb(" + a[0] + "," + a[1] + "," + a[2] + ")"; }
  function shade(a, f) { return [Math.round(a[0] * f), Math.round(a[1] * f), Math.round(a[2] * f)]; }

  function hexToRgba(hex, alpha) {
    if (hex.charAt(0) !== "#") return hex; // already a color string (e.g. hsl())
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function matrixMax(matrix) {
    var mx = 0;
    for (var i = 0; i < matrix.years.length; i++) {
      var r = matrix.totals[matrix.years[i]];
      for (var m = 0; m < 12; m++) if (r[m] > mx) mx = r[m];
    }
    return mx;
  }

  // Mirror the Career stats-card palette (default "pride" rainbow spread; warm/
  // cool are solid fills) for the per-year Totals chart.
  var yearBarPaletteKey = "pride";
  async function loadYearBarPalette() {
    try {
      var s = await window.RE.safeStorageGet({ statsChartPalette: "pride" });
      if (s && s.statsChartPalette) yearBarPaletteKey = s.statsChartPalette;
    } catch (e) {}
  }
  function yearBarColors(n) {
    var out = [];
    if (yearBarPaletteKey === "pride" && window.RE.prideColorAt) {
      for (var i = 0; i < n; i++) out.push(window.RE.prideColorAt(n > 1 ? i / (n - 1) : 0));
    } else {
      var solid = yearBarPaletteKey === "cool" ? "#5c77ff" : "#f56200";
      for (var j = 0; j < n; j++) out.push(solid);
    }
    return out;
  }

  function roundRectTop(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  // ── Totals: one bar per year (year's total of the current metric), matching
  // the Career stats-card chart — colored per the stats palette, year labels
  // below, no axes.
  function drawYearTotals(canvas, matrix, tooltip, crosshair) {
    var years = matrix.years, unit = matrix.unit;
    crosshair.style.display = "none";
    clearLegend();
    var width = canvas.parentNode.offsetWidth - 30;
    var height = Math.min(460, Math.max(300, width * 0.42));
    var s = setupCanvas(canvas, height);
    var ctx = s.ctx;
    var padding = { top: 16, right: 12, bottom: 30, left: 12 };
    var plotW = s.width - padding.left - padding.right, plotH = height - padding.top - padding.bottom;
    var n = Math.max(years.length, 1);

    var items = [], maxV = 0;
    for (var i = 0; i < years.length; i++) {
      var sum = 0, row = matrix.totals[years[i]];
      for (var m = 0; m < 12; m++) sum += row[m];
      items.push({ year: years[i], total: sum });
      if (sum > maxV) maxV = sum;
    }
    if (!(maxV > 0)) maxV = 1;
    if (state.totalsSort === "asc") {
      items.sort(function (a, b) { return a.total - b.total || a.year - b.year; });
    }

    // Color is assigned by chronological rank so a given year keeps its color
    // regardless of sort order (pride spread stays tied to the year).
    var chrono = years.slice();
    var palette = yearBarColors(chrono.length);
    var colorFor = {};
    for (var ci = 0; ci < chrono.length; ci++) colorFor[chrono[ci]] = palette[ci];

    var slotW = plotW / n;
    var barW = Math.min(48, slotW * 0.62);
    var segs = [];
    for (var j = 0; j < items.length; j++) {
      var total = items[j].total;
      var h = total > 0 ? Math.max(2, (total / maxV) * plotH) : 0;
      var cx = padding.left + j * slotW + slotW / 2;
      var x = cx - barW / 2, y = padding.top + plotH - h;
      if (h > 0) {
        ctx.fillStyle = colorFor[items[j].year];
        roundRectTop(ctx, x, y, barW, h, Math.min(4, barW / 2));
        ctx.fill();
      }
      segs.push({ x: x, y: y, w: barW, h: Math.max(h, 6), year: items[j].year, value: total, month: -1 });
      ctx.fillStyle = "#5b6161";
      ctx.font = "10px " + CHART_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(String(items[j].year), cx, padding.top + plotH + 6);
    }
    bindSegHover(canvas, tooltip, segs, s.padL, s.padT, unit, function (hit) {
      return "<strong>" + hit.year + "</strong><br>" + chartFmt(hit.value) + " " + unit;
    });
  }

  // Hover binder for point-based charts (bubbles/scatter/lines/radar): finds the
  // nearest plotted point within its hit radius.
  function bindPointHover(canvas, tooltip, pts, padL, padT) {
    canvas.addEventListener("mousemove", function (e) {
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var best = null, bestD = Infinity;
      for (var i = 0; i < pts.length; i++) {
        var dx = mx - pts[i].x, dy = my - pts[i].y, d = dx * dx + dy * dy;
        var hr = Math.max(pts[i].r, 7);
        if (d <= hr * hr && d < bestD) { bestD = d; best = pts[i]; }
      }
      if (!best) { tooltip.style.display = "none"; return; }
      tooltip.innerHTML = best.html;
      tooltip.style.display = "block";
      var domX = best.x + padL, tw = tooltip.offsetWidth;
      tooltip.style.left = (domX + tw + 20 > canvas.parentNode.offsetWidth ? domX - tw - 12 : domX + 12) + "px";
      tooltip.style.top = (best.y + padT - 10) + "px";
    });
    canvas.addEventListener("mouseleave", function () { tooltip.style.display = "none"; });
  }

  // Standard Y-grid + month X-labels used by scatter/lines.
  function drawXYAxes(ctx, padding, plotW, plotH, maxV, colW) {
    var ticks = niceTicks(maxV, 5);
    ctx.strokeStyle = "#dce0e0";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#5b6161";
    ctx.font = "12px " + CHART_FONT;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (var ti = 0; ti < ticks.length; ti++) {
      var gy = padding.top + plotH - (ticks[ti] / maxV) * plotH;
      ctx.beginPath();
      ctx.moveTo(padding.left, gy);
      ctx.lineTo(padding.left + plotW, gy);
      ctx.stroke();
      ctx.fillText(chartFmt(ticks[ti]), padding.left - 8, gy);
    }
    ctx.fillStyle = "#5b6161";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (var ml = 0; ml < 12; ml++) {
      ctx.fillText(MONTH_SHORT[ml], padding.left + ml * colW + colW / 2, padding.top + plotH + 8);
    }
  }

  // ── Stream: a centered streamgraph (theme-river). One flowing band per year,
  // stacked and centered on a wiggling baseline; x = months.
  function drawStream(canvas, matrix, tooltip, crosshair) {
    var years = matrix.years, unit = matrix.unit;
    crosshair.style.display = "none";
    renderYearLegend(years);
    var width = canvas.parentNode.offsetWidth - 30;
    var height = Math.min(520, Math.max(300, width * 0.5));
    var s = setupCanvas(canvas, height);
    var ctx = s.ctx;
    var padding = { top: 16, right: 16, bottom: 34, left: 24 };
    var plotW = s.width - padding.left - padding.right, plotH = height - padding.top - padding.bottom;
    var colW = plotW / 11;
    function px(m) { return padding.left + m * colW; }

    var maxTot = 0;
    for (var m = 0; m < 12; m++) { var tt = 0; for (var yi = 0; yi < years.length; yi++) tt += matrix.totals[years[yi]][m]; if (tt > maxTot) maxTot = tt; }
    if (!(maxTot > 0)) maxTot = 1;
    var scale = (plotH * 0.92) / maxTot, cYc = padding.top + plotH / 2;

    var running = [];
    for (var m2 = 0; m2 < 12; m2++) { var sum = 0; for (var yj = 0; yj < years.length; yj++) sum += matrix.totals[years[yj]][m2]; running[m2] = -sum / 2; }
    var bands = [];
    for (var yi2 = 0; yi2 < years.length; yi2++) {
      var top = [], bot = [];
      for (var m3 = 0; m3 < 12; m3++) {
        var v = matrix.totals[years[yi2]][m3], b = running[m3], t = b + v;
        bot.push(cYc - b * scale);
        top.push(cYc - t * scale);
        running[m3] = t;
      }
      bands.push({ top: top, bot: bot, year: years[yi2], yi: yi2 });
    }
    for (var bi = 0; bi < bands.length; bi++) {
      var bd = bands[bi];
      ctx.beginPath();
      ctx.moveTo(px(0), bd.top[0]);
      for (var ma = 1; ma < 12; ma++) ctx.lineTo(px(ma), bd.top[ma]);
      for (var mb = 11; mb >= 0; mb--) ctx.lineTo(px(mb), bd.bot[mb]);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(colorForYear(bi, years.length), 0.9);
      ctx.fill();
    }
    ctx.fillStyle = "#5b6161";
    ctx.font = "12px " + CHART_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (var ml = 0; ml < 12; ml++) ctx.fillText(MONTH_SHORT[ml], px(ml), padding.top + plotH + 8);

    canvas.addEventListener("mousemove", function (e) {
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var m = Math.round((mx - padding.left) / colW);
      if (m < 0 || m > 11) { tooltip.style.display = "none"; return; }
      var found = null;
      for (var i = 0; i < bands.length; i++) { if (my >= bands[i].top[m] && my <= bands[i].bot[m]) { found = bands[i]; break; } }
      if (!found) { tooltip.style.display = "none"; return; }
      var v = matrix.totals[found.year][m];
      tooltip.innerHTML = "<strong>" + MONTH_SHORT[m] + " " + found.year + "</strong><br>" + chartFmt(v) + " " + unit;
      tooltip.style.display = "block";
      var domX = px(m) + s.padL, tw = tooltip.offsetWidth;
      tooltip.style.left = (domX + tw + 20 > canvas.parentNode.offsetWidth ? domX - tw - 12 : domX + 12) + "px";
      tooltip.style.top = ((found.top[m] + found.bot[m]) / 2 + s.padT - 10) + "px";
    });
    canvas.addEventListener("mouseleave", function () { tooltip.style.display = "none"; });
  }

  // ── Lines: one polyline per year across Jan→Dec, colored by year.
  function drawLines(canvas, matrix, tooltip, crosshair) {
    var years = matrix.years, unit = matrix.unit;
    crosshair.style.display = "none";
    renderYearLegend(years);
    var width = canvas.parentNode.offsetWidth - 30;
    var height = Math.min(520, Math.max(320, width * 0.5));
    var s = setupCanvas(canvas, height);
    var ctx = s.ctx;
    var padding = { top: 18, right: 16, bottom: 34, left: 54 };
    var plotW = s.width - padding.left - padding.right, plotH = height - padding.top - padding.bottom;
    var maxV = matrixMax(matrix); if (!(maxV > 0)) maxV = 1; maxV *= 1.05;
    var colW = plotW / 12;
    function px(m) { return padding.left + m * colW + colW / 2; }
    function py(v) { return padding.top + plotH - (v / maxV) * plotH; }
    drawXYAxes(ctx, padding, plotW, plotH, maxV, colW);
    var pts = [];
    for (var yi = 0; yi < years.length; yi++) {
      var col = colorForYear(yi, years.length), tot = matrix.totals[years[yi]];
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (var m = 0; m < 12; m++) { var x = px(m), y = py(tot[m]); if (m === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
      for (var m2 = 0; m2 < 12; m2++) if (tot[m2] > 0) pts.push({ x: px(m2), y: py(tot[m2]), r: 4, html: "<strong>" + MONTH_SHORT[m2] + " " + years[yi] + "</strong><br>" + chartFmt(tot[m2]) + " " + unit });
    }
    bindPointHover(canvas, tooltip, pts, s.padL, s.padT);
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
    // A newer draw replaced our canvas while we fetched; its fetch matches the
    // current view (ours may be a narrower year-only list), so let it render.
    if (!canvas.isConnected) return;

    if (state.gran === "years") {
      var matrix = buildYearMatrix(trips);
      if (state.yearChart === "totals") await loadYearBarPalette();
      if (!state.active || !canvas.isConnected) return;
      var renderers = {
        heatmap: drawHeatmap, totals: drawYearTotals, stacked: drawStackedYears,
        iso: draw3DBars, stream: drawStream, lines: drawLines,
      };
      (renderers[state.yearChart] || drawHeatmap)(canvas, matrix, tooltip, crosshair);
      return;
    }
    clearLegend(); // legend only applies to the year-comparison views

    var series = buildSeries(trips);

    var paletteKey = "cool";
    try {
      var s = await window.RE.safeStorageGet({ goalsChartPalette: "cool" });
      if (s && PALETTES[s.goalsChartPalette]) paletteKey = s.goalsChartPalette;
    } catch (e) {}
    if (!canvas.isConnected) return; // superseded by a newer draw

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
