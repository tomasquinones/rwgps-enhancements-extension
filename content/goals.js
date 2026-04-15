(function () {
  "use strict";

  var goalsLink = null;
  var lastGoalPage = null;

  // Pages that use the sidebar layout
  var SIDEBAR_PATHS = ["/", "/dashboard", "/calendar", "/routes", "/rides", "/collections", "/events", "/analyze", "/activities", "/upload", "/feed", "/more"];

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
    var stats = document.querySelector(".rwgps-goal-stats");
    if (stats) stats.remove();
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
    // Fetch goal data
    var goalData = await rwgpsFetch("/goals/" + goalId + ".json");
    if (!goalData || !goalData.goal) return;

    var goal = goalData.goal;

    // Support distance and elevation_gain goals
    var goalType = goal.goal_type || goal.goalType;
    if (goalType !== "distance" && goalType !== "elevation_gain") return;

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

    // Build a map of date -> total distance for that day
    var dayDistances = {};
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
      var tripValue = trip[tripField] || (tripField === "elevation_gain" ? trip.elevationGain : 0) || 0;
      dayDistances[dayKey] = (dayDistances[dayKey] || 0) + tripValue;
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
    var goalPercent = Math.min(100, (currentDist / targetDist) * 100);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var endDateObj = endsOn ? new Date(endsOn + "T00:00:00") : null;
    var daysRemaining = endDateObj ? Math.max(0, Math.round((endDateObj - today) / (1000 * 60 * 60 * 24))) : 0;
    var distRemaining = Math.max(0, targetDist - currentDist);
    var avgNeeded = daysRemaining > 0 ? distRemaining / daysRemaining : 0;

    // Create stats card
    var statsCard = document.createElement("div");
    statsCard.className = "rwgps-goal-stats";
    statsCard.innerHTML =
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
      '</div>';

    // Insert stats card before the chart
    gpContainer.parentNode.insertBefore(statsCard, gpContainer);

    // Create chart container
    var chartWrapper = document.createElement("div");
    chartWrapper.className = "rwgps-goal-chart";

    var canvas = document.createElement("canvas");
    chartWrapper.appendChild(canvas);

    // Insert chart after stats, before the user's progress card
    gpContainer.parentNode.insertBefore(chartWrapper, gpContainer);

    // Create tooltip element
    var tooltip = document.createElement("div");
    tooltip.className = "rwgps-goal-chart-tooltip";
    chartWrapper.appendChild(tooltip);

    // Create vertical crosshair line
    var crosshair = document.createElement("div");
    crosshair.className = "rwgps-goal-chart-crosshair";
    chartWrapper.appendChild(crosshair);

    // Draw the chart and set up hover
    drawChart(canvas, cumulativeData, totalDays, targetDist, distUnit, startDate, tooltip, crosshair);
  }

  function drawChart(canvas, data, totalDays, targetDist, distUnit, startDate, tooltip, crosshair) {
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

    var maxY = Math.max(targetDist, data.length > 0 ? data[data.length - 1].cumulative : 0) * 1.05;

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
        ctx.fillStyle = "rgba(184, 196, 255, 0.4)";
        ctx.fillRect(bars[i].x - bars[i].w / 2, padding.top + plotH - barH, bars[i].w, barH);
      }
    }

    // Right Y-axis labels (bar scale)
    if (maxBarDist > 0) {
      var barTicks = niceTicksForRange(0, maxBarY, 4);
      ctx.fillStyle = "rgba(92, 119, 255, 0.5)";
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
      ctx.fillStyle = "rgba(92, 119, 255, 0.5)";
      ctx.font = "10px " + uiFont;
      ctx.fillText(totalDays <= 60 ? "daily" : "weekly", 0, 0);
      ctx.restore();
    }

    // Cumulative progress line
    ctx.strokeStyle = "#5c77ff";
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
      ctx.fillStyle = "rgba(92, 119, 255, 0.06)";
      ctx.fill();
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

      var tooltipText;
      if (bar.startDay === bar.endDay) {
        var dateStr = months[dateA.getMonth()] + " " + dateA.getDate() + ", " + dateA.getFullYear();
        tooltipText =
          "<strong>" + dateStr + "</strong><br>" +
          "Day: " + formatNumber(bar.dist) + " " + distUnit + "<br>" +
          "Total: " + formatNumber(bar.cumulative) + " " + distUnit;
      } else {
        var rangeStr = months[dateA.getMonth()] + " " + dateA.getDate() +
          " – " + months[dateB.getMonth()] + " " + dateB.getDate();
        tooltipText =
          "<strong>" + rangeStr + "</strong><br>" +
          "Week: " + formatNumber(bar.dist) + " " + distUnit + "<br>" +
          "Total: " + formatNumber(bar.cumulative) + " " + distUnit;
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
})();
