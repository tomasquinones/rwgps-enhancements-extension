(function () {
  "use strict";

  var API_KEY = "ak17s7k3";

  var goalsLink = null;
  var lastGoalPage = null;

  // Pages that use the sidebar layout
  var SIDEBAR_PATHS = ["/", "/dashboard", "/calendar", "/routes", "/rides", "/collections", "/events", "/analyze", "/activities", "/upload", "/feed", "/more"];

  setInterval(checkPage, 1000);
  checkPage();

  async function checkPage() {
    var settings = await browser.storage.local.get({ goalsEnabled: true });
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
  }

  function rwgpsFetch(path) {
    return fetch("https://ridewithgps.com" + path, {
      credentials: "same-origin",
      headers: {
        "x-rwgps-api-key": API_KEY,
        "x-rwgps-api-version": "3",
        "Accept": "application/json",
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

    // Only for distance goals (handle both camelCase and snake_case)
    var goalType = goal.goal_type || goal.goalType;
    if (goalType !== "distance") return;

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
    allTrips = allTrips.filter(function (t) { return !t.is_excluded; });

    // Check we're still on the same goal page
    if (lastGoalPage !== goalId) return;

    // Determine unit preference from page context (check for "km" in the trailer text)
    var isMetric = false;
    if (participant.goal_params && participant.goal_params.trailer) {
      isMetric = participant.goal_params.trailer.toLowerCase().indexOf("km") !== -1;
    }
    var distDivisor = isMetric ? 1000 : 1609.34;
    var distUnit = isMetric ? "km" : "mi";
    var targetDist = targetMeters / distDivisor;

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
      var tripDate = new Date(departedAt);
      var dayKey = tripDate.getFullYear() + "-" +
        String(tripDate.getMonth() + 1).padStart(2, "0") + "-" +
        String(tripDate.getDate()).padStart(2, "0");
      dayDistances[dayKey] = (dayDistances[dayKey] || 0) + (trip.distance || 0);
    }

    // Build cumulative data points
    var cumulativeData = [];
    var cumulative = 0;
    for (var d = 0; d < totalDays; d++) {
      var date = new Date(startDate);
      date.setDate(date.getDate() + d);
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

    // Create chart container
    var chartWrapper = document.createElement("div");
    chartWrapper.className = "rwgps-goal-chart";

    var canvas = document.createElement("canvas");
    chartWrapper.appendChild(canvas);

    // Insert just before the user's progress card container
    gpContainer.parentNode.insertBefore(chartWrapper, gpContainer);

    // Draw the chart
    drawChart(canvas, cumulativeData, totalDays, targetDist, distUnit, startDate);
  }

  function drawChart(canvas, data, totalDays, targetDist, distUnit, startDate) {
    var dpr = window.devicePixelRatio || 1;
    var containerWidth = canvas.parentNode.offsetWidth;

    // Chart dimensions
    var padding = { top: 20, right: 20, bottom: 50, left: 60 };
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

    // Background
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = "#eee";
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
    ctx.fillStyle = "#666";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
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
    ctx.fillStyle = "#999";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(distUnit, 0, 0);
    ctx.restore();

    // X axis labels — show month labels
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#666";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var lastLabel = -Infinity;
    for (var d = 0; d < totalDays; d++) {
      var date = new Date(startDate);
      date.setDate(date.getDate() + d);
      // Label on the 1st of each month, or the start date
      if (d === 0 || date.getDate() === 1) {
        var x = padding.left + (d / (totalDays - 1 || 1)) * plotW;
        if (x - lastLabel > 40) {
          ctx.fillText(months[date.getMonth()] + " " + date.getDate(), x, padding.top + plotH + 8);
          lastLabel = x;
        }
      }
    }
    // Always label the end date
    var endX = padding.left + plotW;
    if (endX - lastLabel > 40) {
      var endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + totalDays - 1);
      ctx.fillText(months[endDate.getMonth()] + " " + endDate.getDate(), endX, padding.top + plotH + 8);
    }

    // Target pace line (dashed)
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top + plotH);
    ctx.lineTo(padding.left + plotW, padding.top + plotH - (targetDist / maxY) * plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Target label
    ctx.fillStyle = "#999";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    var targetY = padding.top + plotH - (targetDist / maxY) * plotH;
    ctx.fillText("Goal: " + formatNumber(targetDist) + " " + distUnit, padding.left + plotW, targetY - 4);

    // Daily bars (subtle)
    for (var i = 0; i < data.length; i++) {
      if (data[i].dayDist > 0) {
        var barX = padding.left + (data[i].day / (totalDays - 1 || 1)) * plotW;
        var barH = (data[i].dayDist / maxY) * plotH;
        var barW = Math.max(2, plotW / totalDays - 1);
        ctx.fillStyle = "rgba(105, 130, 255, 0.2)";
        ctx.fillRect(barX - barW / 2, padding.top + plotH - barH, barW, barH);
      }
    }

    // Cumulative progress line
    ctx.strokeStyle = "#6982ff";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (var i = 0; i < data.length; i++) {
      var x = padding.left + (data[i].day / (totalDays - 1 || 1)) * plotW;
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
      var lastX = padding.left + (data[data.length - 1].day / (totalDays - 1 || 1)) * plotW;
      ctx.lineTo(lastX, padding.top + plotH);
      ctx.lineTo(padding.left, padding.top + plotH);
      ctx.closePath();
      ctx.fillStyle = "rgba(105, 130, 255, 0.08)";
      ctx.fill();
    }

    // Axes
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + plotH);
    ctx.lineTo(padding.left + plotW, padding.top + plotH);
    ctx.stroke();
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
