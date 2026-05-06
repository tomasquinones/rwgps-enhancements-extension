(function () {
  "use strict";

  var goalsLink = null;
  var lastGoalPage = null;

  // Pages that use the sidebar layout
  var SIDEBAR_PATHS = ["/", "/dashboard", "/calendar", "/routes", "/rides", "/collections", "/events", "/analyze", "/activities", "/upload", "/feed", "/more"];

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
  };

  setInterval(checkPage, 1000);
  checkPage();

  async function checkPage() {
    var R = window.RE;
    if (R && R.contextInvalidated) return;
    var settings = R && R.safeStorageGet
      ? await R.safeStorageGet({ goalsEnabled: true })
      : await browser.storage.local.get({ goalsEnabled: true });
    if (!settings) return;
    if (!settings.goalsEnabled) {
      cleanup();
      cleanupChart();
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
      }
    } else {
      if (lastGoalPage) {
        cleanupChart();
        lastGoalPage = null;
      }
    }

    // /goals listing page: append Completed / Incomplete sections
    if (location.pathname === "/goals") {
      maybeInjectGoalsListing();
    } else {
      cleanupGoalsListing();
    }

    var isSidebarPage = SIDEBAR_PATHS.some(function (p) {
      return p === "/" ? location.pathname === "/" : location.pathname.startsWith(p);
    });

    if (!isSidebarPage) {
      cleanup();
      return;
    }

    // Already injected and still in DOM
    if (goalsLink && document.contains(goalsLink)) {
      updateActiveState();
      return;
    }

    var nav = await waitForElement("#side-nav-links", 10000);
    if (!nav) return;

    injectGoalsLink(nav);
  }

  function cleanup() {
    if (goalsLink && goalsLink.parentNode) {
      goalsLink.parentNode.removeChild(goalsLink);
    }
    goalsLink = null;
  }

  function waitForElement(selector, timeout) {
    return new Promise(function (resolve) {
      var el = document.querySelector(selector);
      if (el) return resolve(el);

      var obs = new MutationObserver(function () {
        var el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });

      setTimeout(function () {
        obs.disconnect();
        resolve(null);
      }, timeout);
    });
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
    var chart = document.querySelector(".rwgps-goal-chart");
    if (chart) chart.remove();
    var stats = document.querySelectorAll(".rwgps-goal-stats");
    for (var i = 0; i < stats.length; i++) stats[i].remove();
  }

  function rwgpsFetch(path) {
    return fetch("https://ridewithgps.com" + path, {
      credentials: "same-origin",
      headers: {
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    }).then(function (resp) {
      if (!resp.ok) return null;
      return resp.json();
    });
  }

  async function injectGoalChart(goalId) {
    // Read color-palette preference (default: warm)
    var R = window.RE;
    var paletteSettings = R && R.safeStorageGet
      ? await R.safeStorageGet({ goalsChartPalette: "warm" })
      : await browser.storage.local.get({ goalsChartPalette: "warm" });
    var paletteKey = paletteSettings && paletteSettings.goalsChartPalette === "cool" ? "cool" : "warm";
    var palette = COLOR_PALETTES[paletteKey];

    // Fetch goal data
    var goalData = await rwgpsFetch("/goals/" + goalId + ".json");
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
      var tripData = await rwgpsFetch(
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
    var progressCard = await waitForElement('[class*="gpCardContainer"] [class*="GoalParticipantCard"]', 15000);
    if (!progressCard || lastGoalPage !== goalId) return;

    var gpContainer = progressCard.closest('[class*="gpCardContainer"]');
    if (!gpContainer) return;

    // Don't inject twice
    if (document.querySelector(".rwgps-goal-chart")) return;

    // Calculate stats
    var currentDist = cumulativeData.length > 0 ? cumulativeData[cumulativeData.length - 1].cumulative : 0;
    var goalPercent = (currentDist / targetDist) * 100;

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
        '<div class="rwgps-goal-stat-value">' + goalPercent.toFixed(1) + '%</div>' +
        '<div class="rwgps-goal-stat-label">Complete</div>' +
      '</div>' +
      '<div class="rwgps-goal-stat">' +
        '<div class="rwgps-goal-stat-value">' + formatNumber(avgNeeded) + ' ' + distUnit + '</div>' +
        '<div class="rwgps-goal-stat-label">Avg per day needed</div>' +
      '</div>' +
      '<div class="rwgps-goal-stat">' +
        '<div class="rwgps-goal-stat-value">' + formatNumber(distRemaining) + ' ' + distUnit + '</div>' +
        '<div class="rwgps-goal-stat-label">Remaining</div>' +
      '</div>' +
      '<div class="rwgps-goal-stat">' +
        '<div class="rwgps-goal-stat-value">' + daysRemaining + '</div>' +
        '<div class="rwgps-goal-stat-label">Days left</div>' +
      '</div>' +
      '<div class="rwgps-goal-stat">' +
        '<div class="rwgps-goal-stat-value">' + formatNumber(Math.abs(paceDelta)) + ' ' + distUnit + '</div>' +
        '<div class="rwgps-goal-stat-label">' + paceLabel + '</div>' +
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
        if (newKey !== paletteKey) {
          paletteKey = newKey;
          var newPalette = COLOR_PALETTES[newKey];
          browser.storage.local.set({ goalsChartPalette: newKey });
          setActiveOption(newKey);
          var projectedEl = statsCard.querySelector(".rwgps-goal-stat-projected");
          if (projectedEl) projectedEl.style.color = newPalette.projection;
          // Replace the canvas to drop old listeners, then redraw
          var newCanvas = document.createElement("canvas");
          chartWrapper.replaceChild(newCanvas, canvas);
          canvas = newCanvas;
          drawChart(canvas, cumulativeData, totalDays, targetDist, distUnit, startDate, tooltip, crosshair, chartProjection, newPalette);
        }
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
  }

  function drawChart(canvas, data, totalDays, targetDist, distUnit, startDate, tooltip, crosshair, projection, palette) {
    var dpr = window.devicePixelRatio || 1;
    var containerStyle = window.getComputedStyle(canvas.parentNode);
    var containerPadLeft = parseFloat(containerStyle.paddingLeft) || 0;
    var containerPadRight = parseFloat(containerStyle.paddingRight) || 0;
    var containerWidth = canvas.parentNode.offsetWidth - containerPadLeft - containerPadRight;

    // Chart dimensions
    var padding = { top: 20, right: 55, bottom: 50, left: 60 };
    var width = containerWidth;
    var height = Math.min(600, Math.max(300, containerWidth * 0.5));

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    var plotW = width - padding.left - padding.right;
    var plotH = height - padding.top - padding.bottom;

    var lastCumulative = data.length > 0 ? data[data.length - 1].cumulative : 0;
    var projectedEnd = projection ? projection.total : 0;
    var maxY = Math.max(targetDist, lastCumulative, projectedEnd) * 1.05;

    function expectedAt(dayIndex) {
      if (totalDays <= 1) return targetDist;
      var d = Math.max(0, Math.min(totalDays - 1, dayIndex));
      return targetDist * d / (totalDays - 1);
    }

    // Secondary Y scale for bars (daily/weekly distance)
    var maxBarDist = 0;
    if (totalDays <= 60) {
      for (var i = 0; i < data.length; i++) {
        if (data[i].dayDist > maxBarDist) maxBarDist = data[i].dayDist;
      }
    } else {
      for (var w = 0; w < Math.ceil(data.length / 7); w++) {
        var wd = 0;
        var ws = w * 7, we = Math.min(ws + 7, data.length);
        for (var di = ws; di < we; di++) {
          wd += data[di].dayDist;
        }
        if (wd > maxBarDist) maxBarDist = wd;
      }
    }
    var maxBarY = maxBarDist > 0 ? maxBarDist * 1.15 : 1;

    // Unified slot-based x coordinate system: each day gets an equal-width slot.
    // dayX(d) returns the center x of that day's slot.
    var slotW = plotW / totalDays;
    function dayX(d) {
      return padding.left + d * slotW + slotW / 2;
    }

    // RWGPS style guide font
    var uiFont = '"aktiv-grotesk", "Aktiv Grotesk", "Open Sans", "Gill Sans MT", Corbel, Arial, sans-serif';

    // Background
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = "#dce0e0";
    ctx.lineWidth = 1;
    var yTicks = niceTicksForRange(0, maxY, 5);
    for (var i = 0; i < yTicks.length; i++) {
      var y = padding.top + plotH - (yTicks[i] / maxY) * plotH;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + plotW, y);
      ctx.stroke();
    }

    // Y axis labels
    ctx.fillStyle = "#5b6161";
    ctx.font = "12px " + uiFont;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (var i = 0; i < yTicks.length; i++) {
      var y = padding.top + plotH - (yTicks[i] / maxY) * plotH;
      ctx.fillText(formatNumber(yTicks[i]), padding.left - 8, y);
    }

    // Y axis title
    ctx.save();
    ctx.translate(14, padding.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillStyle = "#6e7575";
    ctx.font = "11px " + uiFont;
    ctx.fillText(distUnit, 0, 0);
    ctx.restore();

    // X axis labels — adaptive spacing based on goal duration
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#5b6161";
    ctx.font = "12px " + uiFont;
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var minLabelGap = 50;
    var lastLabelX = -Infinity;
    if (totalDays <= 60) {
      // Short goals: label every 7 days
      for (var d = 0; d < totalDays; d += 7) {
        var lx = dayX(d);
        if (lx - lastLabelX >= minLabelGap) {
          var date = new Date(startDate);
          date.setDate(date.getDate() + d);
          ctx.fillText(months[date.getMonth()] + " " + date.getDate(), lx, padding.top + plotH + 8);
          lastLabelX = lx;
        }
      }
    } else {
      // Long goals: label on the 1st of each month
      for (var d = 0; d < totalDays; d++) {
        var date = new Date(startDate);
        date.setDate(date.getDate() + d);
        if (d === 0 || date.getDate() === 1) {
          var lx = dayX(d);
          if (lx - lastLabelX >= minLabelGap) {
            var label = d === 0 ? months[date.getMonth()] + " " + date.getDate() : months[date.getMonth()];
            ctx.fillText(label, lx, padding.top + plotH + 8);
            lastLabelX = lx;
          }
        }
      }
    }
    // Always label the last day if there's room
    var endLabelX = dayX(totalDays - 1);
    if (endLabelX - lastLabelX >= minLabelGap) {
      var endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + totalDays - 1);
      ctx.fillText(months[endDate.getMonth()] + " " + endDate.getDate(), endLabelX, padding.top + plotH + 8);
    }

    // Target pace line (dashed) — from day 0 center to last day center
    ctx.strokeStyle = "#b7bdbd";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(dayX(0), padding.top + plotH);
    ctx.lineTo(dayX(totalDays - 1), padding.top + plotH - (targetDist / maxY) * plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Target label
    ctx.fillStyle = "#6e7575";
    ctx.font = "11px " + uiFont;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    var targetY = padding.top + plotH - (targetDist / maxY) * plotH;
    ctx.fillText("Goal: " + formatNumber(targetDist) + " " + distUnit, dayX(totalDays - 1), targetY - 4);

    // Axes (drawn first so bars and line render on top)
    ctx.strokeStyle = "#b7bdbd";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + plotH);
    ctx.lineTo(padding.left + plotW, padding.top + plotH);
    ctx.stroke();

    // Pre-compute bar data for drawing AND hover
    var bars = [];
    if (totalDays <= 60) {
      var barW = Math.max(2, slotW - 1);
      for (var i = 0; i < data.length; i++) {
        var cx = dayX(data[i].day);
        bars.push({ x: cx, w: barW, dist: data[i].dayDist, cumulative: data[i].cumulative,
          startDay: data[i].day, endDay: data[i].day, label: "Day" });
      }
    } else {
      var weekSlotW = plotW / Math.ceil(totalDays / 7);
      var barW = Math.max(3, Math.floor(weekSlotW * 0.5));
      var totalWeeks = Math.ceil(data.length / 7);
      for (var w = 0; w < totalWeeks; w++) {
        var weekDist = 0;
        var weekStart = w * 7;
        var weekEnd = Math.min(weekStart + 7, data.length);
        for (var di = weekStart; di < weekEnd; di++) {
          weekDist += data[di].dayDist;
        }
        var weekCenterDay = weekStart + (weekEnd - weekStart - 1) / 2;
        var cx = dayX(weekCenterDay);
        bars.push({ x: cx, w: barW, dist: weekDist, cumulative: data[weekEnd - 1].cumulative,
          startDay: weekStart, endDay: weekEnd - 1, label: "Week" });
      }
    }

    // Draw bars
    for (var i = 0; i < bars.length; i++) {
      if (bars[i].dist > 0) {
        var barH = (bars[i].dist / maxBarY) * plotH;
        ctx.fillStyle = palette.bar;
        ctx.fillRect(bars[i].x - bars[i].w / 2, padding.top + plotH - barH, bars[i].w, barH);
      }
    }

    // Right Y-axis labels (bar scale)
    if (maxBarDist > 0) {
      var barTicks = niceTicksForRange(0, maxBarY, 4);
      ctx.fillStyle = palette.barAxis;
      ctx.font = "11px " + uiFont;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (var i = 0; i < barTicks.length; i++) {
        var y = padding.top + plotH - (barTicks[i] / maxBarY) * plotH;
        ctx.fillText(formatNumber(barTicks[i]), padding.left + plotW + 8, y);
      }
      // Right axis title
      ctx.save();
      ctx.translate(width - 6, padding.top + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillStyle = palette.barAxis;
      ctx.font = "10px " + uiFont;
      ctx.fillText(totalDays <= 60 ? "daily" : "weekly", 0, 0);
      ctx.restore();
    }

    // Cumulative progress line
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (var i = 0; i < data.length; i++) {
      var x = dayX(data[i].day);
      var y = padding.top + plotH - (data[i].cumulative / maxY) * plotH;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Fill area under the curve
    if (data.length > 0) {
      var fillLastX = dayX(data[data.length - 1].day);
      ctx.lineTo(fillLastX, padding.top + plotH);
      ctx.lineTo(dayX(0), padding.top + plotH);
      ctx.closePath();
      ctx.fillStyle = palette.area;
      ctx.fill();
    }

    // Current-pace projection line — from last data point to period end
    if (projection && data.length > 0) {
      var lastPt = data[data.length - 1];
      var startX = dayX(lastPt.day);
      var startY = padding.top + plotH - (lastPt.cumulative / maxY) * plotH;
      var endX = dayX(totalDays - 1);
      var endY = padding.top + plotH - (projection.total / maxY) * plotH;

      ctx.strokeStyle = palette.projection;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Endpoint marker
      ctx.fillStyle = palette.projection;
      ctx.beginPath();
      ctx.arc(endX, endY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Endpoint label
      ctx.fillStyle = palette.projection;
      ctx.font = "11px " + uiFont;
      ctx.textBaseline = "middle";
      var labelText = formatNumber(projection.total) + " " + distUnit;
      var labelW = ctx.measureText(labelText).width;
      if (endX + labelW + 12 <= padding.left + plotW) {
        ctx.textAlign = "left";
        ctx.fillText(labelText, endX + 8, endY);
      } else {
        ctx.textAlign = "right";
        ctx.fillText(labelText, endX - 8, endY - 10);
      }
    }

    // --- Tooltip hover (snap to nearest bar) ---
    canvas.addEventListener("mousemove", function (e) {
      var rect = canvas.getBoundingClientRect();
      var mouseX = e.clientX - rect.left;
      var mouseY = e.clientY - rect.top;

      var relX = mouseX - padding.left;
      if (relX < 0 || relX > plotW || mouseY < padding.top || mouseY > padding.top + plotH) {
        tooltip.style.display = "none";
        crosshair.style.display = "none";
        return;
      }

      // Find nearest bar by x position
      var nearest = 0;
      var nearestDist = Infinity;
      for (var bi = 0; bi < bars.length; bi++) {
        var d = Math.abs(mouseX - bars[bi].x);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = bi;
        }
      }

      var bar = bars[nearest];
      var dateA = new Date(startDate);
      dateA.setDate(dateA.getDate() + bar.startDay);
      var dateB = new Date(startDate);
      dateB.setDate(dateB.getDate() + bar.endDay);

      var expectedHere = expectedAt(bar.endDay);
      var tooltipText;
      if (bar.startDay === bar.endDay) {
        var dateStr = months[dateA.getMonth()] + " " + dateA.getDate() + ", " + dateA.getFullYear();
        tooltipText =
          "<strong>" + dateStr + "</strong><br>" +
          "Day: " + formatNumber(bar.dist) + " " + distUnit + "<br>" +
          "Total: " + formatNumber(bar.cumulative) + " " + distUnit + "<br>" +
          "Expected: " + formatNumber(expectedHere) + " " + distUnit;
      } else {
        var rangeStr = months[dateA.getMonth()] + " " + dateA.getDate() +
          " – " + months[dateB.getMonth()] + " " + dateB.getDate();
        tooltipText =
          "<strong>" + rangeStr + "</strong><br>" +
          "Week: " + formatNumber(bar.dist) + " " + distUnit + "<br>" +
          "Total: " + formatNumber(bar.cumulative) + " " + distUnit + "<br>" +
          "Expected: " + formatNumber(expectedHere) + " " + distUnit;
      }

      var ptX = bar.x;
      var ptY = padding.top + plotH - (bar.cumulative / maxY) * plotH;

      // Offset for container padding (canvas is inside padded wrapper)
      var domX = ptX + containerPadLeft;
      var domY = ptY + parseFloat(containerStyle.paddingTop || 0);

      tooltip.innerHTML = tooltipText;
      tooltip.style.display = "block";

      var tooltipW = tooltip.offsetWidth;
      if (domX + tooltipW + 20 > canvas.parentNode.offsetWidth) {
        tooltip.style.left = (domX - tooltipW - 12) + "px";
      } else {
        tooltip.style.left = (domX + 12) + "px";
      }
      tooltip.style.top = (domY - 10) + "px";

      // Crosshair centered on the bar
      crosshair.style.display = "block";
      crosshair.style.left = domX + "px";
      crosshair.style.top = (padding.top + parseFloat(containerStyle.paddingTop || 0)) + "px";
      crosshair.style.height = plotH + "px";
    });

    canvas.addEventListener("mouseleave", function () {
      tooltip.style.display = "none";
      crosshair.style.display = "none";
    });
  }

  function niceTicksForRange(min, max, count) {
    var range = max - min;
    if (range <= 0) return [0];
    var rawStep = range / count;
    var magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    var residual = rawStep / magnitude;
    var niceStep;
    if (residual <= 1.5) niceStep = 1 * magnitude;
    else if (residual <= 3) niceStep = 2 * magnitude;
    else if (residual <= 7) niceStep = 5 * magnitude;
    else niceStep = 10 * magnitude;

    var ticks = [];
    for (var t = 0; t <= max; t += niceStep) {
      ticks.push(Math.round(t * 100) / 100);
    }
    return ticks;
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

  var goalsListingInjected = false;
  var goalsListingPending = false;

  function cleanupGoalsListing() {
    var el = document.querySelector(".rwgps-goals-listing");
    if (el) el.remove();
    var hidden = document.querySelectorAll('[data-rwgps-ext-hidden="your-goals"]');
    for (var h = 0; h < hidden.length; h++) {
      hidden[h].style.display = "";
      hidden[h].removeAttribute("data-rwgps-ext-hidden");
    }
    goalsListingInjected = false;
  }

  function hideNativeYourGoals() {
    // Hide every native goal-progress card and the "Your Goals" heading,
    // without touching the surrounding /goals page wrapper (which also
    // contains the Set-a-goal cards we want to keep).
    var hidden = [];

    var anchors = document.querySelectorAll('a[href]');
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var href = a.getAttribute("href") || "";
      if (!/^\/goals\/\d+/.test(href)) continue;
      if (a.closest && a.closest(".rwgps-goals-listing")) continue;
      // Walk up to the row-level card. The anchor wraps just the title; the
      // card div is its parent (icon + title + progress + rank as siblings).
      // Climb until we hit an ancestor whose PARENT has multiple sibling
      // cards (each containing a /goals/{id} link). That ancestor IS the card.
      var card = a;
      while (card.parentElement && card.parentElement !== document.body) {
        var parent = card.parentElement;
        var siblingCards = 0;
        for (var s = 0; s < parent.children.length; s++) {
          var sib = parent.children[s];
          if (sib.querySelector && sib.querySelector('a[href^="/goals/"]')) siblingCards++;
        }
        if (siblingCards >= 2) break; // current card is at row level
        card = parent;
      }
      if (card.tagName === "BODY" || card.tagName === "HTML") continue;
      card.setAttribute("data-rwgps-ext-hidden", "your-goals");
      card.style.display = "none";
      hidden.push(card);
    }

    // Hide the "Your Goals" heading element.
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var txt = (node.nodeValue || "").trim();
      if (txt !== "Your Goals" && txt !== "Your goals") continue;
      var heading = node.parentElement;
      if (heading && (!heading.closest || !heading.closest(".rwgps-goals-listing"))) {
        // Walk up to the heading element if the text is wrapped in a span.
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
    // Walk text nodes looking for "Set a goal:". Walk up from the matching
    // node until we find an ancestor that also contains a /goals/new link —
    // that's the wrapper holding both the heading and the card row.
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
    // Fallback: any wrapper containing all four /goals/new links
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

  function getCurrentUserId() {
    return document.documentElement.getAttribute("data-rwgps-user-id") || null;
  }

  function isMetric() {
    return document.documentElement.getAttribute("data-rwgps-metric") === "1";
  }

  async function fetchUserGoalDetails() {
    // 1) /goals.json (and ?scope=challenges) — full list of goals the user
    //    participates in, with starts_on / ends_on / goal_type / goal_params.max
    //    / icon. Requires apikey + version=3 (choose_api in the controller).
    // 2) /goals/{id}.json per goal in parallel — returns { goal, goal_participant }
    //    for the current user, which has amount_completed and goal_params.percent.
    var common = "apikey=32b6e135&version=3&per_page=200";
    var listResponses = await Promise.all([
      rwgpsFetch("/goals.json?" + common),
      rwgpsFetch("/goals.json?scope=challenges&" + common)
    ]);

    var seen = {};
    var goalList = [];
    for (var p = 0; p < listResponses.length; p++) {
      var data = listResponses[p];
      if (!data) continue;
      var arr = data.results || data.goals || [];
      for (var gi = 0; gi < arr.length; gi++) {
        var g = arr[gi];
        if (!g || g.id == null) continue;
        var key = String(g.id);
        if (seen[key]) continue;
        seen[key] = true;
        goalList.push(g);
      }
    }
    // Fetch /goals/{id}.json in parallel — each returns { goal, goal_participant }
    var details = await Promise.all(goalList.map(function (g) {
      return rwgpsFetch("/goals/" + g.id + ".json").then(function (d) {
        return d ? { listGoal: g, detail: d } : { listGoal: g, detail: null };
      });
    }));

    var rows = [];
    for (var di = 0; di < details.length; di++) {
      var d = details[di];
      var detailGoal = d.detail && (d.detail.goal || d.detail);
      var goal = detailGoal && detailGoal.id != null ? detailGoal : d.listGoal;
      var participant = d.detail && (d.detail.goal_participant || d.detail.goalParticipant) || null;
      rows.push({ goal: goal, participant: participant });
    }
    return rows;
  }

  function goalRowToCard(row) {
    var goal = row.goal;
    if (!goal || goal.id == null) return null;

    var type = goal.goal_type || goal.goalType;
    var startsOn = goal.starts_on || goal.startsOn;
    var endsOn = goal.ends_on || goal.endsOn;
    if (!startsOn || !endsOn) return null;

    var goalParams = goal.goal_params || goal.goalParams || {};
    var targetMeters = Number(goalParams.max != null ? goalParams.max : goalParams.target_amount);
    if (!targetMeters || !isFinite(targetMeters)) targetMeters = 0;

    var participant = row.participant;
    var current = 0;
    var pct = 0;
    if (participant) {
      current = Number(participant.amount_completed != null ? participant.amount_completed : (participant.amountCompleted || 0));
      var partParams = participant.goal_params || participant.goalParams || {};
      if (typeof partParams.percent === "number") {
        pct = partParams.percent * 100;
      } else if (targetMeters > 0) {
        pct = (current / targetMeters) * 100;
      }
    } else if (targetMeters > 0) {
      pct = 0;
    }

    function parseDayEnd(s) {
      // Accept either "YYYY-MM-DD" or full ISO; treat date-only as end-of-day local.
      if (!s) return null;
      var ymd = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (ymd) return new Date(+ymd[1], +ymd[2] - 1, +ymd[3], 23, 59, 59);
      var d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }
    var endDate = parseDayEnd(endsOn);
    var now = new Date();
    var expired = !!(endDate && endDate < now);

    var image = goal.cover || goal.icon || goal.icon_small || null;

    return {
      id: String(goal.id),
      name: goal.name || ("Goal " + goal.id),
      type: type,
      startsOn: startsOn,
      endsOn: endsOn,
      pct: pct,
      current: current,
      target: targetMeters,
      expired: expired,
      image: image
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
    var metric = isMetric();
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

  async function maybeInjectGoalsListing() {
    if (goalsListingInjected || goalsListingPending) return;
    if (document.querySelector(".rwgps-goals-listing")) {
      goalsListingInjected = true;
      return;
    }

    var container = findSetAGoalContainer();
    if (!container) return;

    goalsListingPending = true;
    try {
      var rows = await fetchUserGoalDetails();
      if (location.pathname !== "/goals") return;

      var allCards = [];
      for (var i = 0; i < rows.length; i++) {
        var c = goalRowToCard(rows[i]);
        if (c) allCards.push(c);
      }
      goalsListingInjected = true;

      var active = allCards.filter(function (c) { return !c.expired; });
      var expired = allCards.filter(function (c) { return c.expired; });
      active.sort(function (a, b) { return a.endsOn.localeCompare(b.endsOn); });
      expired.sort(function (a, b) { return b.endsOn.localeCompare(a.endsOn); });

      var completed = expired.filter(function (c) { return c.pct >= 100; });
      var incomplete = expired.filter(function (c) { return c.pct < 100; });

      if (active.length === 0 && completed.length === 0 && incomplete.length === 0) return;

      // Hide the native Your Goals heading + progress rows, then inject our
      // own active grid in the same spot (above the Set-a-goal row).
      hideNativeYourGoals();

      if (active.length > 0) {
        var activeWrap = document.createElement("div");
        activeWrap.className = "rwgps-goals-listing rwgps-goals-listing-active";
        activeWrap.appendChild(renderGoalsSection("Your Goals", active));
        // Insert just before the Set-a-goal container so our active grid lands
        // where the native Your Goals section used to be.
        container.parentNode.insertBefore(activeWrap, container);
      }

      if (completed.length > 0 || incomplete.length > 0) {
        var expiredWrap = document.createElement("div");
        expiredWrap.className = "rwgps-goals-listing";
        if (completed.length > 0) expiredWrap.appendChild(renderGoalsSection("Completed", completed));
        if (incomplete.length > 0) expiredWrap.appendChild(renderGoalsSection("Incomplete", incomplete));
        if (container.nextSibling) {
          container.parentNode.insertBefore(expiredWrap, container.nextSibling);
        } else {
          container.parentNode.appendChild(expiredWrap);
        }
      }
    } finally {
      goalsListingPending = false;
    }
  }

})();
