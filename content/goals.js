(function () {
  "use strict";

  var goalsLink = null;
  var lastGoalPage = null;
  // The #side-nav-links wait can take up to 10 s; without this guard every
  // 1 s tick would stack another document-wide MutationObserver.
  var sidebarWaitRunning = false;

  // Pages that use the sidebar layout
  var SIDEBAR_PATHS = ["/", "/dashboard", "/calendar", "/routes", "/rides", "/collections", "/events", "/analyze", "/activities", "/upload", "/feed", "/more"];

  // A listed section page, or a non-detail sub-page of one (e.g. /rides/explore).
  // A plain prefix match also caught /routes/:id, /routes/:id/edit and
  // /routes/new (the planner), which have no sidebar, so sub-pages whose first
  // segment is an id or "new" are excluded — except under /calendar, which
  // calendar.js also treats as the calendar page.
  function isSidebarPath(path) {
    var p = path.length > 1 ? path.replace(/\/+$/, "") : path;
    if (SIDEBAR_PATHS.indexOf(p) !== -1) return true;
    var m = p.match(/^(\/[^\/]+)\/([^\/]+)/);
    if (!m || SIDEBAR_PATHS.indexOf(m[1]) === -1) return false;
    if (m[1] === "/calendar") return true;
    return !/^\d+$/.test(m[2]) && m[2] !== "new";
  }

  var COLOR_PALETTES = {
    warm: {
      line: "#fa6400",
      area: "rgba(250, 100, 0, 0.08)",
      bar: "rgba(250, 100, 0, 0.18)",
      barAxis: "rgba(179, 70, 0, 0.7)",
      projection: "#d32f2f",
    },
    cool: {
      line: "#5c77ff",
      area: "rgba(92, 119, 255, 0.06)",
      bar: "rgba(184, 196, 255, 0.4)",
      barAxis: "rgba(92, 119, 255, 0.5)",
      projection: "#fa6400",
    },
    pride: {
      pride: true,                       // rainbow bars + gradient line (see R.drawCumulativeChart)
      line: "#750787",                   // fallback / projected-total stat color
      area: "rgba(117, 7, 135, 0.06)",
      bar: "rgba(117, 7, 135, 0.18)",    // fallback when pride rendering is unavailable
      barAxis: "rgba(90, 97, 97, 0.8)",
      projection: "#1b2828",
    },
  };

  var PALETTE_KEYS = { warm: 1, cool: 1, pride: 1 };
  function resolvePaletteKey(v) { return PALETTE_KEYS[v] ? v : "cool"; }

  // A rainbow gradient swatch for the Pride menu option.
  var PRIDE_SWATCH = "linear-gradient(90deg,#E40303,#FF8C00,#FFED00,#008026,#004DFF,#750787)";

  // Current palette + registry of every chart on the page so a change made on
  // one chart (the main goal chart's gear) re-colors them all at once.
  var goalPaletteKey = "cool";
  var chartInstances = []; // { wrapper, redraw: function(key, palette) }

  function registerChart(wrapper, redraw) {
    chartInstances.push({ wrapper: wrapper, redraw: redraw });
  }

  function applyPaletteToAll(newKey) {
    newKey = resolvePaletteKey(newKey);
    goalPaletteKey = newKey;
    browser.storage.local.set({ goalsChartPalette: newKey });
    var palette = COLOR_PALETTES[newKey];
    // Prune charts whose DOM is gone, then redraw the rest.
    chartInstances = chartInstances.filter(function (c) { return c.wrapper && c.wrapper.isConnected; });
    for (var i = 0; i < chartInstances.length; i++) {
      try { chartInstances[i].redraw(newKey, palette); } catch (e) {}
    }
  }

  setInterval(checkPage, 1000);
  checkPage();

  async function checkPage() {
    var R = window.RE;
    if (R.contextInvalidated) return;
    var settings = await R.safeStorageGet({ goalsEnabled: true });
    if (!settings) return;
    if (!settings.goalsEnabled) {
      cleanup();
      cleanupChart();
      cleanupGoalsListing();
      lastGoalPage = null;
      return;
    }

    // Check for goal show page chart
    var goalMatch = location.pathname.match(/^\/goals\/(\d+)$/);
    if (goalMatch) {
      var goalId = goalMatch[1];
      if (lastGoalPage !== goalId) {
        lastGoalPage = goalId;
        cleanupChart();
        injectGoalChart(goalId);
        injectLeaderboardCharts(goalId);
      }
    } else {
      if (lastGoalPage) {
        cleanupChart();
        lastGoalPage = null;
      }
    }

    if (location.pathname === "/goals") {
      maybeInjectGoalsListing();
    } else {
      cleanupGoalsListing();
    }

    if (!isSidebarPath(location.pathname)) {
      cleanup();
      return;
    }

    // Already injected and still in DOM
    if (goalsLink && document.contains(goalsLink)) {
      updateActiveState();
      return;
    }

    if (sidebarWaitRunning) return;
    sidebarWaitRunning = true;
    var nav;
    try {
      nav = await R.waitForElement("#side-nav-links", 10000);
    } finally {
      sidebarWaitRunning = false;
    }
    if (!nav || !isSidebarPath(location.pathname)) return;

    injectGoalsLink(nav);
  }

  function cleanup() {
    if (goalsLink && goalsLink.parentNode) {
      goalsLink.parentNode.removeChild(goalsLink);
    }
    goalsLink = null;
  }

  function injectGoalsLink(nav) {
    // Prevent duplicates — if a Goals link already exists in this nav, reuse it
    var existing = nav.querySelector(".rwgps-goals-link");
    if (existing) {
      goalsLink = existing;
      updateActiveState();
      return;
    }

    // Find the Collections link to insert before it
    var links = nav.querySelectorAll("a");
    var collectionsLink = null;
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute("href") === "/collections") {
        collectionsLink = links[i];
        break;
      }
    }
    if (!collectionsLink) return;

    // Clone structure from an existing link
    var templateLink = links[0];
    if (!templateLink) return;

    // Get the base link class (SideNavLink_xxx)
    var linkClass = "";
    for (var j = 0; j < templateLink.classList.length; j++) {
      if (templateLink.classList[j].includes("SideNavLink") && !templateLink.classList[j].includes("Active")) {
        linkClass = templateLink.classList[j];
        break;
      }
    }

    // Find the text span class
    var textSpan = templateLink.querySelector("span");
    var textClass = textSpan ? textSpan.className : "";

    // Create the Goals link
    var a = document.createElement("a");
    a.href = "/goals";
    if (linkClass) a.className = linkClass;
    a.classList.add("rwgps-goals-link");

    // Target/bullseye SVG icon matching RWGPS icon style
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("fill", "none");
    svg.setAttribute("viewBox", "0 0 512 512");
    svg.setAttribute("height", "20");
    svg.setAttribute("width", "20");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", "M256 48C141.1 48 48 141.1 48 256s93.1 208 208 208 208-93.1 208-208S370.9 48 256 48zm0 374.4c-91.7 0-166.4-74.7-166.4-166.4S164.3 89.6 256 89.6 422.4 164.3 422.4 256 347.7 422.4 256 422.4zm0-291.2c-68.8 0-124.8 56-124.8 124.8S187.2 380.8 256 380.8 380.8 324.8 380.8 256 324.8 131.2 256 131.2zm0 208c-45.9 0-83.2-37.3-83.2-83.2s37.3-83.2 83.2-83.2 83.2 37.3 83.2 83.2-37.3 83.2-83.2 83.2zm0-124.8c-22.9 0-41.6 18.7-41.6 41.6s18.7 41.6 41.6 41.6 41.6-18.7 41.6-41.6-18.7-41.6-41.6-41.6z");
    svg.appendChild(path);
    a.appendChild(svg);

    // Text label
    var span = document.createElement("span");
    if (textClass) span.className = textClass;
    span.textContent = "Goals";
    a.appendChild(span);

    // Insert before Collections
    nav.insertBefore(a, collectionsLink);
    goalsLink = a;

    updateActiveState();
  }

  function updateActiveState() {
    if (!goalsLink) return;

    var nav = goalsLink.parentNode;
    if (!nav) return;

    // Find the active class name from any currently active sibling
    var activeClass = findActiveClassName(nav);
    var isActive = location.pathname.startsWith("/goals");

    if (isActive && activeClass) {
      goalsLink.classList.add(activeClass);
    } else if (activeClass) {
      goalsLink.classList.remove(activeClass);
    }
  }

  function findActiveClassName(nav) {
    var links = nav.querySelectorAll("a");
    for (var i = 0; i < links.length; i++) {
      for (var j = 0; j < links[i].classList.length; j++) {
        if (links[i].classList[j].includes("Active")) {
          return links[i].classList[j];
        }
      }
    }
    return null;
  }

  // --- Goal Progress Chart ---

  function cleanupChart() {
    cleanupLeaderboardCharts();
    var charts = document.querySelectorAll(".rwgps-goal-chart");
    for (var i = 0; i < charts.length; i++) charts[i].remove();
    var stats = document.querySelectorAll(".rwgps-goal-stats");
    for (var i = 0; i < stats.length; i++) stats[i].remove();
  }

  async function injectGoalChart(goalId) {
    // Read color-palette preference (default: warm)
    var R = window.RE;
    var paletteSettings = await R.safeStorageGet({ goalsChartPalette: "cool" });
    var paletteKey = resolvePaletteKey(paletteSettings && paletteSettings.goalsChartPalette);
    goalPaletteKey = paletteKey;
    var palette = COLOR_PALETTES[paletteKey];

    // Fetch goal data
    var goalData = await window.RE.rwgpsFetchPlain("/goals/" + goalId + ".json");
    if (!goalData || !goalData.goal) return;

    var goal = goalData.goal;

    // Support distance, elevation_gain, and moving_time goals
    var goalType = goal.goal_type || goal.goalType;
    if (goalType !== "distance" && goalType !== "elevation_gain" && goalType !== "moving_time") return;

    var participant = goalData.goal_participant || goalData.goalParticipant;
    if (!participant) return;

    var startsOn = goal.starts_on || goal.startsOn;
    var endsOn = goal.ends_on || goal.endsOn;
    var goalParams = goal.goal_params || goal.goalParams || {};
    var targetMeters = goalParams.max;
    if (!startsOn || !targetMeters) return;

    // Fetch all trips for this participant
    var allTrips = [];
    var offset = 0;
    var limit = 100;
    while (true) {
      var tripData = await window.RE.rwgpsFetchPlain(
        "/goal_participants/" + participant.id + "/trips.json?limit=" + limit + "&offset=" + offset
      );
      if (!tripData || !tripData.results) break;
      allTrips = allTrips.concat(tripData.results);
      if (allTrips.length >= (tripData.results_count || 0) || tripData.results.length < limit) break;
      offset += limit;
    }

    // Filter out excluded trips
    allTrips = allTrips.filter(function (t) { return !(t.is_excluded || t.isExcluded); });

    // Check we're still on the same goal page
    if (lastGoalPage !== goalId) return;

    // Determine unit preference and metric field based on goal type
    var isMetric = false;
    var participantParams = participant.goal_params || participant.goalParams || {};
    if (participantParams.trailer) {
      isMetric = goalType === "distance"
        ? participantParams.trailer.toLowerCase().indexOf("km") !== -1
        : participantParams.trailer.toLowerCase().indexOf("meter") !== -1;
    }

    var distDivisor, distUnit, targetDist, tripField;
    if (goalType === "elevation_gain") {
      distDivisor = isMetric ? 1 : 0.3048;
      distUnit = isMetric ? "m" : "ft";
      targetDist = targetMeters / distDivisor;
      tripField = "elevation_gain";
    } else if (goalType === "moving_time") {
      // targetMeters is actually seconds for time goals; display in hours
      distDivisor = 3600;
      distUnit = "h";
      targetDist = targetMeters / distDivisor;
      tripField = "moving_time";
    } else {
      distDivisor = isMetric ? 1000 : 1609.34;
      distUnit = isMetric ? "km" : "mi";
      targetDist = targetMeters / distDivisor;
      tripField = "distance";
    }

    // Build day-by-day data
    var startDate = new Date(startsOn + "T00:00:00");
    var endDate = endsOn ? new Date(endsOn + "T00:00:00") : null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    // If no end date, use today or last trip date
    if (!endDate) {
      endDate = today;
    }

    var totalDays = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    if (totalDays < 1) return;

    // Build a map of date -> total distance for that day, and aggregate effort stats
    var dayDistances = {};
    var rideCount = 0;
    var totalMovingSec = 0;
    var totalElevMeters = 0;
    var longestRideMeters = 0;
    var longestRideMovingSec = 0;
    // Normalize period bounds as yyyy-mm-dd strings for filtering
    var periodStartKey = startsOn.substring(0, 10);
    var periodEndDate = endsOn ? new Date(endsOn + "T23:59:59") : null;
    var periodEndKey = periodEndDate
      ? periodEndDate.getFullYear() + "-" +
        String(periodEndDate.getMonth() + 1).padStart(2, "0") + "-" +
        String(periodEndDate.getDate()).padStart(2, "0")
      : null;

    for (var i = 0; i < allTrips.length; i++) {
      var trip = allTrips[i];
      var departedAt = trip.departed_at || trip.departedAt;
      if (!departedAt) continue;
      // Use the date string directly if available (avoids timezone shift),
      // otherwise fall back to parsing as local date
      var dayKey;
      if (typeof departedAt === "string" && departedAt.length >= 10) {
        dayKey = departedAt.substring(0, 10);
      } else {
        var tripDate = new Date(departedAt);
        dayKey = tripDate.getFullYear() + "-" +
          String(tripDate.getMonth() + 1).padStart(2, "0") + "-" +
          String(tripDate.getDate()).padStart(2, "0");
      }
      var tripValue;
      if (tripField === "elevation_gain") {
        tripValue = trip.elevation_gain != null ? trip.elevation_gain : (trip.elevationGain || 0);
      } else if (tripField === "moving_time") {
        tripValue = trip.moving_time != null ? trip.moving_time : (trip.movingTime || 0);
      } else {
        tripValue = trip[tripField] || 0;
      }
      dayDistances[dayKey] = (dayDistances[dayKey] || 0) + tripValue;

      // Only aggregate effort stats for trips within the goal period
      if (dayKey >= periodStartKey && (!periodEndKey || dayKey <= periodEndKey)) {
        rideCount++;
        var mt = trip.moving_time != null ? trip.moving_time : trip.movingTime;
        if (typeof mt === "number") {
          totalMovingSec += mt;
          if (mt > longestRideMovingSec) longestRideMovingSec = mt;
        }
        var eg = trip.elevation_gain != null ? trip.elevation_gain : trip.elevationGain;
        if (typeof eg === "number") totalElevMeters += eg;
        var td = typeof trip.distance === "number" ? trip.distance : 0;
        if (td > longestRideMeters) longestRideMeters = td;
      }
    }

    // Build cumulative data points (only up to today)
    var cumulativeData = [];
    var cumulative = 0;
    var todayMidnight = new Date();
    todayMidnight.setHours(23, 59, 59, 999);
    for (var d = 0; d < totalDays; d++) {
      var date = new Date(startDate);
      date.setDate(date.getDate() + d);
      if (date > todayMidnight) break;
      var key = date.getFullYear() + "-" +
        String(date.getMonth() + 1).padStart(2, "0") + "-" +
        String(date.getDate()).padStart(2, "0");
      if (dayDistances[key]) {
        cumulative += dayDistances[key] / distDivisor;
      }
      cumulativeData.push({
        day: d,
        date: date,
        cumulative: cumulative,
        dayDist: (dayDistances[key] || 0) / distDivisor,
      });
    }

    // Wait for the user's progress card to appear (confirms participation has loaded)
    var progressCard = await R.waitForElement('[class*="gpCardContainer"] [class*="GoalParticipantCard"]', 15000);
    if (!progressCard || lastGoalPage !== goalId) return;

    var gpContainer = progressCard.closest('[class*="gpCardContainer"]');
    if (!gpContainer) return;

    // Don't inject twice
    if (document.querySelector(".rwgps-goal-chart")) return;

    // Calculate stats
    var currentDist = cumulativeData.length > 0 ? cumulativeData[cumulativeData.length - 1].cumulative : 0;

    // Goal-achieved confetti — fires every page load (including refresh)
    // whenever the user has hit or exceeded the target.
    if (currentDist >= targetDist) {
      fireGoalConfetti();
    }
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var endDateObj = endsOn ? new Date(endsOn + "T00:00:00") : null;
    // Inclusive: counts today through the goal end date. E.g. today Apr 28
    // with end date Apr 30 → 3 days left (today, the 29th, the 30th).
    var daysRemaining = endDateObj ? Math.max(0, Math.round((endDateObj - today) / (1000 * 60 * 60 * 24)) + 1) : 0;
    var distRemaining = Math.max(0, targetDist - currentDist);
    // If the user has already logged activity today, exclude today from the
    // days they still need to ride. Otherwise today still counts toward the
    // average since they could still ride.
    var todayKey = today.getFullYear() + "-" +
      String(today.getMonth() + 1).padStart(2, "0") + "-" +
      String(today.getDate()).padStart(2, "0");
    var hasActivityToday = (dayDistances[todayKey] || 0) > 0;
    var avgDaysRemaining = hasActivityToday ? Math.max(0, daysRemaining - 1) : daysRemaining;
    var avgNeeded = avgDaysRemaining > 0 ? distRemaining / avgDaysRemaining : 0;
    var todayDayIndex = cumulativeData.length > 0
      ? cumulativeData[cumulativeData.length - 1].day
      : 0;
    var expectedToday = totalDays > 1
      ? targetDist * todayDayIndex / (totalDays - 1)
      : targetDist;
    var paceDelta = currentDist - expectedToday;
    var paceLabel = paceDelta >= 0 ? "Ahead of pace" : "Behind pace";

    // Current-pace projection: extend avg daily rate to end of period
    var daysElapsed = todayDayIndex + 1;
    var avgDaily = daysElapsed > 0 ? currentDist / daysElapsed : 0;
    var projectedTotal = currentDist + avgDaily * Math.max(0, daysRemaining);
    var hasProjection = daysRemaining > 0 && daysElapsed > 0 && daysElapsed < totalDays;

    // Effort stats — convert to user units
    var elevDivisor = isMetric ? 1 : 0.3048;
    var elevUnit = isMetric ? "m" : "ft";
    var totalElevDisplay = totalElevMeters / elevDivisor;
    var longestRideDisplay = longestRideMeters / distDivisor;

    // Create primary stats card
    var statsCard = document.createElement("div");
    statsCard.className = "rwgps-goal-stats";
    var primaryHtml =
      '<div class="rwgps-goal-stat">' +
        '<div class="rwgps-goal-stat-value">' + formatNumber(distRemaining) + ' ' + distUnit + '</div>' +
        '<div class="rwgps-goal-stat-label">Remaining</div>' +
      '</div>' +
      '<div class="rwgps-goal-stat">' +
        '<div class="rwgps-goal-stat-value">' + formatNumber(Math.abs(paceDelta)) + ' ' + distUnit + '</div>' +
        '<div class="rwgps-goal-stat-label">' + paceLabel + '</div>' +
      '</div>' +
      '<div class="rwgps-goal-stat">' +
        '<div class="rwgps-goal-stat-value">' + daysRemaining + '</div>' +
        '<div class="rwgps-goal-stat-label">Days left</div>' +
      '</div>' +
      '<div class="rwgps-goal-stat">' +
        '<div class="rwgps-goal-stat-value">' + formatNumber(avgNeeded) + ' ' + distUnit + '</div>' +
        '<div class="rwgps-goal-stat-label">Avg per day needed</div>' +
      '</div>';
    if (hasProjection) {
      primaryHtml +=
        '<div class="rwgps-goal-stat">' +
          '<div class="rwgps-goal-stat-value rwgps-goal-stat-projected" style="color:' + palette.projection + '">' + formatNumber(projectedTotal) + ' ' + distUnit + '</div>' +
          '<div class="rwgps-goal-stat-label">Projected total</div>' +
        '</div>';
    }
    statsCard.innerHTML = primaryHtml;

    // Insert stats card before the chart
    gpContainer.parentNode.insertBefore(statsCard, gpContainer);

    // Create chart container
    var chartWrapper = document.createElement("div");
    chartWrapper.className = "rwgps-goal-chart";

    var canvas = document.createElement("canvas");
    chartWrapper.appendChild(canvas);

    // Help icon explaining the calculations
    var help = document.createElement("div");
    help.className = "rwgps-goal-chart-help";
    help.setAttribute("tabindex", "0");
    help.setAttribute("aria-label", "How these numbers are calculated");
    help.innerHTML =
      '<span class="rwgps-goal-chart-help-mark">?</span>' +
      '<div class="rwgps-goal-chart-help-content">' +
        '<div class="rwgps-goal-chart-help-title">How these are calculated</div>' +
        '<div class="rwgps-goal-chart-help-row"><strong>Avg per day needed</strong><br>' +
          '(Goal − Total so far) ÷ Days left, excluding today if you\'ve already ridden today' +
        '</div>' +
        '<div class="rwgps-goal-chart-help-row"><strong>Projected total</strong><br>' +
          'Total so far + (Total so far ÷ Days elapsed) × Days remaining' +
        '</div>' +
        '<div class="rwgps-goal-chart-help-row"><strong>Pace delta</strong><br>' +
          'Total so far − expected at today (linear from 0 to Goal)' +
        '</div>' +
      '</div>';
    chartWrapper.appendChild(help);

    // Settings icon — toggles between warm and cool color palettes
    var settings = document.createElement("div");
    settings.className = "rwgps-goal-chart-settings";
    settings.setAttribute("tabindex", "0");
    settings.setAttribute("role", "button");
    settings.setAttribute("aria-label", "Chart appearance");
    settings.innerHTML =
      '<svg class="rwgps-goal-chart-settings-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
        '<path fill="currentColor" d="M19.14 12.94c.04-.3.06-.62.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61L4.89 11.06c-.04.3-.06.62-.06.94s.02.64.06.94L2.86 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 12c0 1.98-1.62 3.6-3.6 3.6 1.98 0 3.6-1.62 3.6-3.6zm-3.6-3.6c-1.98 0-3.6 1.62-3.6 3.6s1.62 3.6 3.6 3.6 3.6-1.62 3.6-3.6-1.62-3.6-3.6-3.6z"/>' +
      '</svg>' +
      '<div class="rwgps-goal-chart-settings-content" role="menu">' +
        '<div class="rwgps-goal-chart-settings-title">Chart colors</div>' +
        '<button class="rwgps-goal-chart-settings-option" type="button" data-palette="warm" role="menuitemradio">' +
          '<span class="rwgps-goal-chart-settings-swatch" style="background:' + COLOR_PALETTES.warm.line + '"></span>' +
          'Warm' +
        '</button>' +
        '<button class="rwgps-goal-chart-settings-option" type="button" data-palette="cool" role="menuitemradio">' +
          '<span class="rwgps-goal-chart-settings-swatch" style="background:' + COLOR_PALETTES.cool.line + '"></span>' +
          'Cool' +
        '</button>' +
        '<button class="rwgps-goal-chart-settings-option" type="button" data-palette="pride" role="menuitemradio">' +
          '<span class="rwgps-goal-chart-settings-swatch" style="background:' + PRIDE_SWATCH + '"></span>' +
          'Pride' +
        '</button>' +
      '</div>';
    chartWrapper.appendChild(settings);

    function setActiveOption(key) {
      var opts = settings.querySelectorAll(".rwgps-goal-chart-settings-option");
      for (var oi = 0; oi < opts.length; oi++) {
        var active = opts[oi].getAttribute("data-palette") === key;
        opts[oi].setAttribute("data-active", active ? "true" : "false");
        opts[oi].setAttribute("aria-checked", active ? "true" : "false");
      }
    }
    setActiveOption(paletteKey);

    settings.addEventListener("click", function (e) {
      if (e.target.closest(".rwgps-goal-chart-settings-option")) return;
      e.stopPropagation();
      settings.classList.toggle("rwgps-goal-chart-settings-open");
    });
    settings.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        if (e.target === settings) {
          e.preventDefault();
          settings.classList.toggle("rwgps-goal-chart-settings-open");
        }
      } else if (e.key === "Escape") {
        settings.classList.remove("rwgps-goal-chart-settings-open");
      }
    });

    var optionEls = settings.querySelectorAll(".rwgps-goal-chart-settings-option");
    for (var oi = 0; oi < optionEls.length; oi++) {
      optionEls[oi].addEventListener("click", function (e) {
        e.stopPropagation();
        var newKey = this.getAttribute("data-palette");
        // Re-color every chart on the page (this one included, via its
        // registered redrawer), and persist the choice.
        if (newKey !== goalPaletteKey) applyPaletteToAll(newKey);
        settings.classList.remove("rwgps-goal-chart-settings-open");
      });
    }

    var outsideClickHandler = function (e) {
      if (!settings.isConnected) {
        document.removeEventListener("click", outsideClickHandler);
        return;
      }
      if (!settings.contains(e.target)) {
        settings.classList.remove("rwgps-goal-chart-settings-open");
      }
    };
    document.addEventListener("click", outsideClickHandler);

    // Insert chart after stats, before the user's progress card
    gpContainer.parentNode.insertBefore(chartWrapper, gpContainer);

    // Secondary effort-summary stats (only if the user has rides in the period)
    if (rideCount > 0) {
      var effortCard = document.createElement("div");
      effortCard.className = "rwgps-goal-stats rwgps-goal-stats-effort";
      effortCard.innerHTML =
        '<div class="rwgps-goal-stat">' +
          '<div class="rwgps-goal-stat-value">' + rideCount + '</div>' +
          '<div class="rwgps-goal-stat-label">' + (rideCount === 1 ? "Ride" : "Rides") + '</div>' +
        '</div>' +
        '<div class="rwgps-goal-stat">' +
          '<div class="rwgps-goal-stat-value">' + formatDuration(totalMovingSec) + '</div>' +
          '<div class="rwgps-goal-stat-label">Total time</div>' +
        '</div>' +
        '<div class="rwgps-goal-stat">' +
          '<div class="rwgps-goal-stat-value">' + formatNumber(totalElevDisplay) + ' ' + elevUnit + '</div>' +
          '<div class="rwgps-goal-stat-label">Elevation gain</div>' +
        '</div>' +
        '<div class="rwgps-goal-stat">' +
          '<div class="rwgps-goal-stat-value">' +
            (goalType === "moving_time"
              ? formatDuration(longestRideMovingSec)
              : formatNumber(longestRideDisplay) + ' ' + distUnit) +
          '</div>' +
          '<div class="rwgps-goal-stat-label">Longest ride</div>' +
        '</div>';
      gpContainer.parentNode.insertBefore(effortCard, gpContainer);
    }

    // Create tooltip element
    var tooltip = document.createElement("div");
    tooltip.className = "rwgps-goal-chart-tooltip";
    chartWrapper.appendChild(tooltip);

    // Create vertical crosshair line
    var crosshair = document.createElement("div");
    crosshair.className = "rwgps-goal-chart-crosshair";
    chartWrapper.appendChild(crosshair);

    // Draw the chart and set up hover
    var chartProjection = hasProjection ? { total: projectedTotal, avgDaily: avgDaily } : null;
    drawChart(canvas, cumulativeData, totalDays, targetDist, distUnit, startDate, tooltip, crosshair, chartProjection, palette);

    // Re-color this chart (and its gear + projected-total stat) when the
    // palette changes anywhere on the page.
    registerChart(chartWrapper, function (key, pal) {
      setActiveOption(key);
      var projectedEl = statsCard.querySelector(".rwgps-goal-stat-projected");
      if (projectedEl) projectedEl.style.color = pal.projection;
      var nc = document.createElement("canvas");
      chartWrapper.replaceChild(nc, canvas);
      canvas = nc;
      drawChart(canvas, cumulativeData, totalDays, targetDist, distUnit, startDate, tooltip, crosshair, chartProjection, pal);
    });
  }

  // ─── Leaderboard per-participant charts ──────────────────────────────

  // WeakSet of cards we've already augmented + MutationObserver for cards
  // that get added after initial paint (filter toggle: all / friends).
  var leaderboardState = { cards: new WeakSet(), observer: null };

  function cleanupLeaderboardCharts() {
    if (leaderboardState.observer) {
      leaderboardState.observer.disconnect();
      leaderboardState.observer = null;
    }
    leaderboardState.cards = new WeakSet();
    var nodes = document.querySelectorAll(".rwgps-leaderboard-toggle, .rwgps-leaderboard-chart-host");
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();
  }

  async function injectLeaderboardCharts(goalId) {
    var R = window.RE;
    if (!R) return;

    // Wait for at least one leaderboard card; the user's own GoalParticipantCard
    // (inside gpCardContainer) typically appears first, so we wait for any card
    // and then filter out the gpCardContainer one when enhancing.
    var firstCard = await R.waitForElement('[class*="GoalParticipantCard"]', 15000);
    if (!firstCard || lastGoalPage !== goalId) return;

    var paletteSettings = await R.safeStorageGet({ goalsChartPalette: "cool" });
    if (lastGoalPage !== goalId) return;
    // Participant charts paint with goalPaletteKey when opened.
    goalPaletteKey = resolvePaletteKey(paletteSettings && paletteSettings.goalsChartPalette);

    // Fetch goal + leaderboard participants in parallel. The participants
    // endpoint returns each participant's id, user.id, user.name, rank, and
    // goal_params.trailer (used to detect their unit preference).
    var responses = await Promise.all([
      R.rwgpsFetchPlain("/goals/" + goalId + ".json"),
      R.rwgpsFetchPlain("/goals/" + goalId + "/participants.json?per_page=200"),
    ]);
    if (lastGoalPage !== goalId) return;

    var goalData = responses[0];
    var participantsData = responses[1];
    if (!goalData || !goalData.goal) return;
    if (!participantsData || !Array.isArray(participantsData.results)) return;

    var goal = goalData.goal;
    var goalType = goal.goal_type || goal.goalType;
    if (goalType !== "distance" && goalType !== "elevation_gain" && goalType !== "moving_time") return;
    if (!(goal.starts_on || goal.startsOn)) return;
    var goalParams = goal.goal_params || goal.goalParams || {};
    if (!goalParams.max) return;

    var participantsByUser = {};
    for (var pi = 0; pi < participantsData.results.length; pi++) {
      var p = participantsData.results[pi];
      if (p && p.user && p.user.id != null) {
        participantsByUser[String(p.user.id)] = p;
      }
    }

    function enhanceCard(card) {
      if (lastGoalPage !== goalId) return;
      if (!card || card.nodeType !== 1) return;
      // Skip the user's main progress card above the leaderboard.
      if (card.closest && card.closest('[class*="gpCardContainer"]')) return;
      if (leaderboardState.cards.has(card)) return;

      var anchor = card.querySelector && card.querySelector('a[href^="/users/"]');
      if (!anchor) return;
      var m = (anchor.getAttribute("href") || "").match(/^\/users\/(\d+)/);
      if (!m) return;
      var participant = participantsByUser[m[1]];
      if (!participant) return;

      leaderboardState.cards.add(card);
      addLeaderboardToggle(card, anchor, goal, participant);
    }

    var initial = document.querySelectorAll('[class*="GoalParticipantCard"]');
    for (var i = 0; i < initial.length; i++) enhanceCard(initial[i]);

    if (leaderboardState.observer) leaderboardState.observer.disconnect();
    leaderboardState.observer = new MutationObserver(function (muts) {
      if (lastGoalPage !== goalId) return;
      for (var mi = 0; mi < muts.length; mi++) {
        var added = muts[mi].addedNodes;
        for (var ai = 0; ai < added.length; ai++) {
          var node = added[ai];
          if (!node || node.nodeType !== 1) continue;
          if (node.matches && node.matches('[class*="GoalParticipantCard"]')) {
            enhanceCard(node);
          }
          if (node.querySelectorAll) {
            var nested = node.querySelectorAll('[class*="GoalParticipantCard"]');
            for (var ni = 0; ni < nested.length; ni++) enhanceCard(nested[ni]);
          }
        }
      }
    });
    leaderboardState.observer.observe(document.body, { childList: true, subtree: true });
  }

  function addLeaderboardToggle(card, anchor, goal, participant) {
    var host = document.createElement("div");
    host.className = "rwgps-leaderboard-chart-host";
    card.insertBefore(host, card.firstChild);

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "rwgps-leaderboard-toggle";
    toggle.setAttribute("aria-expanded", "false");
    var who = participant.user && participant.user.name ? participant.user.name : "participant";
    toggle.setAttribute("aria-label", "Show goal chart for " + who);
    toggle.title = "Show goal chart";
    toggle.innerHTML = '<span class="rwgps-leaderboard-tri" aria-hidden="true">▶</span>';
    var nameRow = document.createElement("span");
    nameRow.className = "rwgps-leaderboard-name-row";
    anchor.parentNode.insertBefore(nameRow, anchor);
    nameRow.appendChild(anchor);
    nameRow.appendChild(toggle);

    var loadPromise = null;
    toggle.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var expanded = toggle.getAttribute("aria-expanded") === "true";
      if (expanded) {
        toggle.setAttribute("aria-expanded", "false");
        host.classList.remove("is-open");
        return;
      }
      toggle.setAttribute("aria-expanded", "true");
      host.classList.add("is-open");
      if (!loadPromise) {
        host.innerHTML = '<div class="rwgps-leaderboard-chart-loading">Loading…</div>';
        loadPromise = renderParticipantChart(host, goal, participant).catch(function (err) {
          console.warn("[Goals] leaderboard chart error", err);
          host.innerHTML = '<div class="rwgps-leaderboard-chart-loading">Could not load chart.</div>';
        });
      }
    });
  }

  async function renderParticipantChart(host, goal, participant) {
    var R = window.RE;
    var allTrips = [];
    var offset = 0;
    var limit = 100;
    while (true) {
      var data = await R.rwgpsFetchPlain(
        "/goal_participants/" + participant.id + "/trips.json?limit=" + limit + "&offset=" + offset
      );
      if (!data || !data.results) break;
      allTrips = allTrips.concat(data.results);
      if (allTrips.length >= (data.results_count || 0) || data.results.length < limit) break;
      offset += limit;
    }
    allTrips = allTrips.filter(function (t) { return !(t.is_excluded || t.isExcluded); });

    if (!host.isConnected) return;

    var chartData = buildParticipantChartData(goal, participant, allTrips);
    if (!chartData) {
      host.innerHTML = '<div class="rwgps-leaderboard-chart-loading">No chart data.</div>';
      return;
    }

    var endsOn = goal.ends_on || goal.endsOn;
    var endDateObj = endsOn ? new Date(endsOn + "T00:00:00") : null;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var daysRemaining = endDateObj
      ? Math.max(0, Math.round((endDateObj - today) / (1000 * 60 * 60 * 24)) + 1)
      : 0;
    var cd = chartData.cumulativeData;
    var currentDist = cd.length > 0 ? cd[cd.length - 1].cumulative : 0;
    var todayDayIndex = cd.length > 0 ? cd[cd.length - 1].day : 0;
    var daysElapsed = todayDayIndex + 1;
    var avgDaily = daysElapsed > 0 ? currentDist / daysElapsed : 0;
    var projectedTotal = currentDist + avgDaily * Math.max(0, daysRemaining);
    var hasProjection = daysRemaining > 0 && daysElapsed > 0 && daysElapsed < chartData.totalDays;
    var chartProjection = hasProjection ? { total: projectedTotal, avgDaily: avgDaily } : null;

    host.innerHTML = "";
    var chartWrapper = document.createElement("div");
    chartWrapper.className = "rwgps-goal-chart rwgps-leaderboard-chart";
    var canvas = document.createElement("canvas");
    chartWrapper.appendChild(canvas);
    var tooltip = document.createElement("div");
    tooltip.className = "rwgps-goal-chart-tooltip";
    chartWrapper.appendChild(tooltip);
    var crosshair = document.createElement("div");
    crosshair.className = "rwgps-goal-chart-crosshair";
    chartWrapper.appendChild(crosshair);
    host.appendChild(chartWrapper);

    // Always use the page's current palette (it may have changed since this
    // toggle was created) and register so a later change re-colors this chart.
    function paint(pal) {
      var nc = document.createElement("canvas");
      chartWrapper.replaceChild(nc, canvas);
      canvas = nc;
      drawChart(
        canvas,
        chartData.cumulativeData,
        chartData.totalDays,
        chartData.targetDist,
        chartData.distUnit,
        chartData.startDate,
        tooltip,
        crosshair,
        chartProjection,
        pal
      );
    }
    paint(COLOR_PALETTES[goalPaletteKey]);
    registerChart(chartWrapper, function (key, pal) { paint(pal); });
  }

  // Per-participant chart data. Mirrors the data prep in injectGoalChart but
  // omits the effort-summary stats (only used by the main chart).
  function buildParticipantChartData(goal, participant, allTrips) {
    var goalType = goal.goal_type || goal.goalType;
    var startsOn = goal.starts_on || goal.startsOn;
    var endsOn = goal.ends_on || goal.endsOn;
    var goalParams = goal.goal_params || goal.goalParams || {};
    var targetMeters = goalParams.max;
    if (!startsOn || !targetMeters) return null;

    var isMetric = false;
    var participantParams = (participant && (participant.goal_params || participant.goalParams)) || {};
    if (participantParams.trailer) {
      isMetric = goalType === "distance"
        ? participantParams.trailer.toLowerCase().indexOf("km") !== -1
        : participantParams.trailer.toLowerCase().indexOf("meter") !== -1;
    } else if (window.RE && window.RE.isMetric) {
      isMetric = window.RE.isMetric();
    }

    var distDivisor, distUnit, targetDist, tripField;
    if (goalType === "elevation_gain") {
      distDivisor = isMetric ? 1 : 0.3048;
      distUnit = isMetric ? "m" : "ft";
      targetDist = targetMeters / distDivisor;
      tripField = "elevation_gain";
    } else if (goalType === "moving_time") {
      distDivisor = 3600;
      distUnit = "h";
      targetDist = targetMeters / distDivisor;
      tripField = "moving_time";
    } else {
      distDivisor = isMetric ? 1000 : 1609.34;
      distUnit = isMetric ? "km" : "mi";
      targetDist = targetMeters / distDivisor;
      tripField = "distance";
    }

    var startDate = new Date(startsOn + "T00:00:00");
    var endDate = endsOn ? new Date(endsOn + "T00:00:00") : new Date();
    var totalDays = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    if (totalDays < 1) return null;

    var dayDistances = {};
    for (var i = 0; i < allTrips.length; i++) {
      var trip = allTrips[i];
      var departedAt = trip.departed_at || trip.departedAt;
      if (!departedAt) continue;
      var dayKey;
      if (typeof departedAt === "string" && departedAt.length >= 10) {
        dayKey = departedAt.substring(0, 10);
      } else {
        var td = new Date(departedAt);
        dayKey = td.getFullYear() + "-" +
          String(td.getMonth() + 1).padStart(2, "0") + "-" +
          String(td.getDate()).padStart(2, "0");
      }
      var tripValue;
      if (tripField === "elevation_gain") {
        tripValue = trip.elevation_gain != null ? trip.elevation_gain : (trip.elevationGain || 0);
      } else if (tripField === "moving_time") {
        tripValue = trip.moving_time != null ? trip.moving_time : (trip.movingTime || 0);
      } else {
        tripValue = trip[tripField] || 0;
      }
      dayDistances[dayKey] = (dayDistances[dayKey] || 0) + tripValue;
    }

    var cumulativeData = [];
    var cumulative = 0;
    var todayMidnight = new Date();
    todayMidnight.setHours(23, 59, 59, 999);
    for (var d = 0; d < totalDays; d++) {
      var date = new Date(startDate);
      date.setDate(date.getDate() + d);
      if (date > todayMidnight) break;
      var key = date.getFullYear() + "-" +
        String(date.getMonth() + 1).padStart(2, "0") + "-" +
        String(date.getDate()).padStart(2, "0");
      if (dayDistances[key]) cumulative += dayDistances[key] / distDivisor;
      cumulativeData.push({
        day: d,
        date: date,
        cumulative: cumulative,
        dayDist: (dayDistances[key] || 0) / distDivisor,
      });
    }

    return {
      cumulativeData: cumulativeData,
      totalDays: totalDays,
      targetDist: targetDist,
      distUnit: distUnit,
      startDate: startDate,
    };
  }

  // The cumulative chart engine now lives in shared.js (R.drawCumulativeChart)
  // so the Activities Graph view can reuse it. This thin delegate keeps the
  // existing goal call sites unchanged.
  function drawChart(canvas, data, totalDays, targetDist, distUnit, startDate, tooltip, crosshair, projection, palette) {
    return window.RE.drawCumulativeChart(canvas, data, totalDays, targetDist, distUnit, startDate, tooltip, crosshair, projection, palette);
  }

  function formatNumber(n) {
    if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (n >= 100) return Math.round(n).toString();
    if (n >= 10) return n.toFixed(1);
    return n.toFixed(1);
  }

  function formatDuration(totalSeconds) {
    if (!totalSeconds || totalSeconds < 60) return "0m";
    var totalMinutes = Math.round(totalSeconds / 60);
    var hours = Math.floor(totalMinutes / 60);
    var minutes = totalMinutes % 60;
    if (hours === 0) return minutes + "m";
    if (hours >= 100) return hours + "h";
    return hours + "h " + minutes + "m";
  }

  // ─── Goal-Achieved Confetti ─────────────────────────────────────────────
  // Self-contained canvas-based confetti burst — no external library.
  // Fires from all four corners of the viewport, particles arc toward the
  // center under gravity and fade out. Roughly 4 seconds total.

  var CONFETTI_COLORS = [
    "#FF1744", "#FFEA00", "#00E676", "#2979FF",
    "#F50057", "#FF6D00", "#00BFA5", "#AA00FF"
  ];

  function fireGoalConfetti() {
    if (document.querySelector(".rwgps-goal-confetti")) return;

    var canvas = document.createElement("canvas");
    canvas.className = "rwgps-goal-confetti";
    canvas.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;" +
      "pointer-events:none;z-index:99999;";

    var dpr = window.devicePixelRatio || 1;
    var W = window.innerWidth;
    var H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    document.body.appendChild(canvas);

    // Corners ordered clockwise starting top-left. Each corner fires
    // a burst on its turn; per-particle spread is added to the base
    // direction (vx, vy) so the burst fans out toward center.
    var corners = [
      { x: 0,  y: 0,  vx:  1, vy:  1 },  // top-left
      { x: W,  y: 0,  vx: -1, vy:  1 },  // top-right
      { x: W,  y: H,  vx: -1, vy: -1 },  // bottom-right
      { x: 0,  y: H,  vx:  1, vy: -1 }   // bottom-left
    ];

    var PARTICLES_PER_CORNER = 180;
    var GRAVITY = 0.225;
    var DRAG = 0.985;
    var MAX_LIFE = 240;
    var FADE_START = 168; // 70% through life
    var LOOPS = 4;
    var BURST_INTERVAL_MS = 250;

    var particles = [];

    function spawnFromCorner(corner) {
      var baseAngle = Math.atan2(corner.vy, corner.vx);
      for (var p = 0; p < PARTICLES_PER_CORNER; p++) {
        var speed = 9 + Math.random() * 14;
        var spread = (Math.random() - 0.5) * Math.PI * 0.5625; // ±~50°
        var ang = baseAngle + spread;
        particles.push({
          x: corner.x,
          y: corner.y,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          rot: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.35,
          size: 6 + Math.random() * 7,
          color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
          shape: Math.random() < 0.55 ? "rect" : "circle",
          life: 0
        });
      }
    }

    // Schedule the bursts. First fires synchronously so the animation
    // loop sees particles immediately and doesn't exit before the
    // remaining bursts have a chance to spawn theirs.
    var totalBursts = LOOPS * corners.length;
    var firingComplete = false;
    for (var b = 0; b < totalBursts; b++) {
      var corner = corners[b % corners.length];
      var isLast = b === totalBursts - 1;
      if (b === 0) {
        spawnFromCorner(corner);
      } else {
        (function (cor, last) {
          setTimeout(function () {
            spawnFromCorner(cor);
            if (last) firingComplete = true;
          }, b * BURST_INTERVAL_MS);
        })(corner, isLast);
      }
    }

    function tick() {
      ctx.clearRect(0, 0, W, H);
      var alive = 0;
      for (var i = 0; i < particles.length; i++) {
        var pt = particles[i];
        if (pt.life >= MAX_LIFE) continue;
        alive++;
        pt.life++;
        pt.vx *= DRAG;
        pt.vy = pt.vy * DRAG + GRAVITY;
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.rot += pt.rotSpeed;

        var alpha = pt.life > FADE_START
          ? 1 - (pt.life - FADE_START) / (MAX_LIFE - FADE_START)
          : 1;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(pt.x, pt.y);
        ctx.rotate(pt.rot);
        ctx.fillStyle = pt.color;
        if (pt.shape === "rect") {
          ctx.fillRect(-pt.size / 2, -pt.size / 4, pt.size, pt.size / 2);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, pt.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Keep ticking while particles are alive OR while bursts are still
      // pending (between bursts there can briefly be a gap with 0 alive
      // particles right at the start before the second corner fires).
      if (alive > 0 || !firingComplete) {
        requestAnimationFrame(tick);
      } else {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    }

    requestAnimationFrame(tick);
  }

  // ─── /goals Listing — Completed / Incomplete sections ────────────────────

  var goalsListingPending = false;
  // Sections built for the current /goals visit, so the 1 s poll doesn't
  // refetch /goals.json and every /goals/{id}.json each tick when there's
  // nothing to show, a request failed, or React re-rendered our sections away
  // (they're re-inserted from this). Null = not fetched yet this visit.
  var goalsListingGroups = null;    // { active, completed, incomplete, empty }
  var goalsListingRetryAt = 0;      // after a failed fetch, don't retry before this
  var goalsListingVisit = 0;        // bumped on leaving /goals; drops stale fetches
  var goalsListingInjected = false; // we inserted sections / hid native rows
  var GOALS_LISTING_RETRY_MS = 60 * 1000;

  function cleanupGoalsListing() {
    goalsListingGroups = null;
    goalsListingRetryAt = 0;
    goalsListingVisit++;
    // Runs every second on every other page: skip the document-wide scans
    // unless we actually changed this page.
    if (!goalsListingInjected) return;
    goalsListingInjected = false;
    var els = document.querySelectorAll(".rwgps-goals-listing");
    for (var e = 0; e < els.length; e++) els[e].remove();
    var hidden = document.querySelectorAll('[data-rwgps-ext-hidden="your-goals"]');
    for (var h = 0; h < hidden.length; h++) {
      hidden[h].style.display = "";
      hidden[h].removeAttribute("data-rwgps-ext-hidden");
    }
  }

  function hideNativeYourGoals() {
    var hidden = [];

    var anchors = document.querySelectorAll('a[href]');
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var href = a.getAttribute("href") || "";
      if (!/^\/goals\/\d+/.test(href)) continue;
      if (a.closest && a.closest(".rwgps-goals-listing")) continue;
      // Anchor wraps just the title; the row-level card is the ancestor whose
      // parent holds 2+ sibling cards (each with its own /goals/{id} link).
      var card = a;
      while (card.parentElement && card.parentElement !== document.body) {
        var parent = card.parentElement;
        var siblingCards = 0;
        for (var s = 0; s < parent.children.length; s++) {
          var sib = parent.children[s];
          if (sib.querySelector && sib.querySelector('a[href^="/goals/"]')) siblingCards++;
        }
        if (siblingCards >= 2) break;
        card = parent;
      }
      if (card.tagName === "BODY" || card.tagName === "HTML") continue;
      card.setAttribute("data-rwgps-ext-hidden", "your-goals");
      card.style.display = "none";
      hidden.push(card);
    }

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var txt = (node.nodeValue || "").trim();
      if (txt !== "Your Goals" && txt !== "Your goals") continue;
      var heading = node.parentElement;
      if (heading && (!heading.closest || !heading.closest(".rwgps-goals-listing"))) {
        while (heading && heading.tagName && !/^H[1-6]$/.test(heading.tagName) && heading.children.length <= 1) {
          if (heading.parentElement && heading.parentElement.children.length > 1) break;
          heading = heading.parentElement;
        }
        if (heading && heading !== document.body) {
          heading.setAttribute("data-rwgps-ext-hidden", "your-goals");
          heading.style.display = "none";
          hidden.push(heading);
        }
      }
      break;
    }

    return hidden;
  }

  function findSetAGoalContainer() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var node;
    var anyHeadingNode = null;
    while ((node = walker.nextNode())) {
      var txt = (node.nodeValue || "").trim();
      if (txt !== "Set a goal:" && txt !== "Set a goal") continue;
      anyHeadingNode = node.parentElement;
      var cur = node.parentElement;
      while (cur && cur !== document.body) {
        if (cur.querySelector && cur.querySelector('a[href*="/goals/new"]')) {
          return cur;
        }
        cur = cur.parentElement;
      }
    }
    if (anyHeadingNode) {
      console.warn("[Goals] Found 'Set a goal:' heading but no /goals/new link wrapper");
    }
    // Layout-changed fallback: any wrapper containing the four /goals/new cards.
    var newLinks = document.querySelectorAll('a[href*="/goals/new"]');
    if (newLinks.length >= 2) {
      var p = newLinks[0].parentElement;
      while (p && p !== document.body) {
        var allInside = true;
        for (var i = 1; i < newLinks.length; i++) {
          if (!p.contains(newLinks[i])) { allInside = false; break; }
        }
        if (allInside && p.children.length >= newLinks.length) return p;
        p = p.parentElement;
      }
    }
    return null;
  }

  // Date strings from the API are either "YYYY-MM-DD" (treat as end-of-day local)
  // or full ISO timestamps; new Date(s + "T23:59:59") breaks for the ISO form.
  function parseDayEnd(s) {
    if (!s) return null;
    var ymd = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (ymd) return new Date(+ymd[1], +ymd[2] - 1, +ymd[3], 23, 59, 59);
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // Resolves null when both goal-list requests failed (so the caller can retry
  // later instead of treating it as "no goals").
  async function fetchUserGoalDetails() {
    // /goals.json's index requires the api-key header (choose_api in the
    // controller); R.rwgpsFetch sends it. Without it the endpoint 404s.
    var listResponses = await Promise.all([
      window.RE.rwgpsFetch("/goals.json?per_page=200"),
      window.RE.rwgpsFetch("/goals.json?scope=challenges&per_page=200")
    ]);
    if (!listResponses[0] && !listResponses[1]) return null;

    var seen = {};
    var goalList = [];
    for (var p = 0; p < listResponses.length; p++) {
      var arr = (listResponses[p] && (listResponses[p].results || listResponses[p].goals)) || [];
      for (var gi = 0; gi < arr.length; gi++) {
        var g = arr[gi];
        if (!g || g.id == null || seen[g.id]) continue;
        seen[g.id] = true;
        goalList.push(g);
      }
    }

    // The list endpoint doesn't carry per-user progress; only /goals/{id}.json
    // returns { goal, goal_participant } with amount_completed + percent.
    var details = await Promise.all(goalList.map(function (g) {
      return window.RE.rwgpsFetchPlain("/goals/" + g.id + ".json").then(function (d) {
        return { listGoal: g, detail: d };
      });
    }));

    return details.map(function (d) {
      var detailGoal = d.detail && d.detail.goal;
      return {
        goal: detailGoal && detailGoal.id != null ? detailGoal : d.listGoal,
        participant: (d.detail && d.detail.goal_participant) || null
      };
    });
  }

  function goalRowToCard(row) {
    var goal = row.goal;
    if (!goal || goal.id == null || !goal.starts_on || !goal.ends_on) return null;

    var goalParams = goal.goal_params || {};
    var targetMeters = Number(goalParams.max);
    if (!isFinite(targetMeters)) targetMeters = 0;

    var participant = row.participant;
    var current = 0;
    var pct = 0;
    if (participant) {
      current = Number(participant.amount_completed) || 0;
      var partPercent = participant.goal_params && participant.goal_params.percent;
      if (typeof partPercent === "number") {
        pct = partPercent * 100;
      } else if (targetMeters > 0) {
        pct = (current / targetMeters) * 100;
      }
    }

    var endDate = parseDayEnd(goal.ends_on);
    var expired = !!(endDate && endDate < new Date());

    return {
      id: String(goal.id),
      name: goal.name || ("Goal " + goal.id),
      type: goal.goal_type,
      startsOn: goal.starts_on,
      endsOn: goal.ends_on,
      pct: pct,
      current: current,
      target: targetMeters,
      expired: expired,
      image: goal.cover || goal.icon || goal.icon_small || null
    };
  }

  function formatRange(startsOn, endsOn) {
    function parse(s) { return new Date(s + "T00:00:00"); }
    var s = parse(startsOn);
    var e = parse(endsOn);
    var sameYear = s.getFullYear() === e.getFullYear();
    var monthOpts = { month: "short", day: "numeric" };
    var sStr = s.toLocaleDateString(undefined, monthOpts);
    var eStr = e.toLocaleDateString(undefined, sameYear ? monthOpts : { year: "numeric", month: "short", day: "numeric" });
    return sStr + " – " + eStr + (sameYear ? ", " + s.getFullYear() : "");
  }

  function goalTypeIconSvg(type) {
    if (type === "elevation_gain") {
      return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>';
    }
    if (type === "moving_time") {
      return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>';
    }
    // distance / default
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  }

  function formatGoalProgress(card) {
    var metric = window.RE.isMetric();
    if (card.type === "moving_time") {
      var hCur = Math.round(card.current / 3600);
      var hTar = Math.round(card.target / 3600);
      return hCur + " / " + hTar + " h";
    }
    if (card.type === "elevation_gain") {
      var div = metric ? 1 : 0.3048;
      var unit = metric ? "m" : "ft";
      return Math.round(card.current / div).toLocaleString() + " / " + Math.round(card.target / div).toLocaleString() + " " + unit;
    }
    var ddiv = metric ? 1000 : 1609.34;
    var dunit = metric ? "km" : "mi";
    return Math.round(card.current / ddiv).toLocaleString() + " / " + Math.round(card.target / ddiv).toLocaleString() + " " + dunit;
  }

  function renderGoalCard(card) {
    var a = document.createElement("a");
    a.className = "rwgps-goal-listing-card";
    a.href = "/goals/" + card.id;

    var imgWrap = document.createElement("div");
    imgWrap.className = "rwgps-goal-listing-img";
    if (card.image) {
      var img = document.createElement("img");
      img.src = card.image;
      img.alt = "";
      imgWrap.appendChild(img);
    } else {
      imgWrap.classList.add("rwgps-goal-listing-img-icon");
      imgWrap.innerHTML = goalTypeIconSvg(card.type);
    }
    a.appendChild(imgWrap);

    var body = document.createElement("div");
    body.className = "rwgps-goal-listing-body";

    var title = document.createElement("div");
    title.className = "rwgps-goal-listing-title";
    title.textContent = card.name;
    body.appendChild(title);

    var meta = document.createElement("div");
    meta.className = "rwgps-goal-listing-meta";
    meta.textContent = formatRange(card.startsOn, card.endsOn);
    body.appendChild(meta);

    var prog = document.createElement("div");
    prog.className = "rwgps-goal-listing-progress";

    var bar = document.createElement("div");
    bar.className = "rwgps-goal-listing-bar";
    var fill = document.createElement("div");
    fill.className = "rwgps-goal-listing-bar-fill";
    fill.style.width = Math.min(100, Math.max(0, card.pct)) + "%";
    bar.appendChild(fill);
    prog.appendChild(bar);

    var pctEl = document.createElement("div");
    pctEl.className = "rwgps-goal-listing-pct";
    pctEl.textContent = Math.round(card.pct) + "%";
    prog.appendChild(pctEl);

    body.appendChild(prog);

    var amount = document.createElement("div");
    amount.className = "rwgps-goal-listing-amount";
    amount.textContent = formatGoalProgress(card);
    body.appendChild(amount);

    a.appendChild(body);
    return a;
  }

  function renderGoalsSection(label, cards) {
    var section = document.createElement("section");
    section.className = "rwgps-goals-listing-section";

    var heading = document.createElement("h3");
    heading.className = "rwgps-goals-listing-heading";
    heading.textContent = label + " (" + cards.length + ")";
    section.appendChild(heading);

    var grid = document.createElement("div");
    grid.className = "rwgps-goals-listing-grid";
    for (var i = 0; i < cards.length; i++) {
      grid.appendChild(renderGoalCard(cards[i]));
    }
    section.appendChild(grid);
    return section;
  }

  // Sort fetched rows into the listing's sections.
  function groupGoalCards(rows) {
    var allCards = [];
    for (var i = 0; i < rows.length; i++) {
      var c = goalRowToCard(rows[i]);
      if (c) allCards.push(c);
    }

    var active = allCards.filter(function (c) { return !c.expired; });
    var expired = allCards.filter(function (c) { return c.expired; });
    active.sort(function (a, b) { return a.endsOn.localeCompare(b.endsOn); });
    expired.sort(function (a, b) { return b.endsOn.localeCompare(a.endsOn); });

    var completed = expired.filter(function (c) { return c.pct >= 100; });
    var incomplete = expired.filter(function (c) { return c.pct < 100; });

    return {
      active: active,
      completed: completed,
      incomplete: incomplete,
      empty: active.length === 0 && completed.length === 0 && incomplete.length === 0
    };
  }

  function renderGoalsListing(container, groups) {
    hideNativeYourGoals();
    goalsListingInjected = true;

    if (groups.active.length > 0) {
      var activeWrap = document.createElement("div");
      activeWrap.className = "rwgps-goals-listing rwgps-goals-listing-active";
      activeWrap.appendChild(renderGoalsSection("Your Goals", groups.active));
      container.parentNode.insertBefore(activeWrap, container);
    }

    if (groups.completed.length > 0 || groups.incomplete.length > 0) {
      var expiredWrap = document.createElement("div");
      expiredWrap.className = "rwgps-goals-listing";
      if (groups.completed.length > 0) expiredWrap.appendChild(renderGoalsSection("Completed", groups.completed));
      if (groups.incomplete.length > 0) expiredWrap.appendChild(renderGoalsSection("Incomplete", groups.incomplete));
      if (container.nextSibling) {
        container.parentNode.insertBefore(expiredWrap, container.nextSibling);
      } else {
        container.parentNode.appendChild(expiredWrap);
      }
    }
  }

  async function maybeInjectGoalsListing() {
    if (goalsListingPending) return;
    if (document.querySelector(".rwgps-goals-listing")) return;
    var groups = goalsListingGroups;
    if (groups && groups.empty) return; // fetched this visit; nothing to show
    if (!groups && Date.now() < goalsListingRetryAt) return; // recent failure

    var container = findSetAGoalContainer();
    if (!container) return;

    if (!groups) {
      var visit = goalsListingVisit;
      goalsListingPending = true;
      try {
        var rows = await fetchUserGoalDetails();
        if (visit !== goalsListingVisit) return; // left /goals while fetching
        if (!rows) {
          goalsListingRetryAt = Date.now() + GOALS_LISTING_RETRY_MS;
          return;
        }
        groups = goalsListingGroups = groupGoalCards(rows);
      } finally {
        goalsListingPending = false;
      }
      if (location.pathname !== "/goals") return;
      if (groups.empty || document.querySelector(".rwgps-goals-listing")) return;
      // React may have re-rendered the page during the fetch.
      if (!container.isConnected) container = findSetAGoalContainer();
      if (!container) return;
    }

    // First render, or re-insert from cached data after React removed ours.
    renderGoalsListing(container, groups);
  }

})();
