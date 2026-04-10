(function () {
  "use strict";

  const API_KEY = "ak17s7k3";
  const API_VERSION = 3;

  let lastUserId = null;
  let lastPage = null;

  // Inject a script into the page context to expose rwgps globals to the content script
  const bridge = document.createElement("script");
  bridge.textContent = `
    (function() {
      function publish() {
        var user = (window.rwgps && window.rwgps.config && window.rwgps.config.currentUser) || {};
        document.documentElement.setAttribute("data-rwgps-user-id", user.id || "");
        document.documentElement.setAttribute("data-rwgps-metric", user.metric_units ? "1" : "0");
      }
      publish();
      // Re-publish periodically in case the user data loads after initial page render
      var interval = setInterval(function() {
        publish();
        if (document.documentElement.getAttribute("data-rwgps-user-id")) {
          clearInterval(interval);
        }
      }, 500);
    })();
  `;
  document.documentElement.appendChild(bridge);
  bridge.remove();

  // Check for eligible pages on interval (reliable for SPA navigation)
  setInterval(checkPage, 1000);
  checkPage();

  async function checkPage() {
    // Skip if streaks feature is disabled
    var settings = await browser.storage.local.get({ streaksEnabled: true });
    if (!settings.streaksEnabled) {
      cleanup();
      lastPage = null;
      return;
    }
    const profileMatch = location.pathname.match(/^\/users\/(\d+)/);
    const isDashboard = location.pathname === "/" || location.pathname === "/dashboard";
    const userId = profileMatch ? profileMatch[1] : isDashboard ? getCurrentUserId() : null;
    const pageKey = userId ? location.pathname + ":" + userId : null;

    // Clean up if we've left an eligible page
    if (!userId) {
      lastUserId = null;
      lastPage = null;
      cleanup();
      return;
    }

    // Already set up for this page
    if (pageKey === lastPage && document.querySelector(".rwgps-streak-tab")) {
      return;
    }

    // Wait for the Stats card tab bar to render
    const tabBar = await waitForElement('[class*="headingFilter"]', 10000);
    if (!tabBar) return;

    // Re-check URL hasn't changed while we waited
    const recheck = location.pathname.match(/^\/users\/(\d+)/);
    const recheckDash = location.pathname === "/" || location.pathname === "/dashboard";
    if (!recheck && !recheckDash) return;

    lastUserId = userId;
    lastPage = pageKey;

    cleanup();
    injectStreakTab(tabBar, userId);
  }

  function getCurrentUserId() {
    const id = document.documentElement.getAttribute("data-rwgps-user-id");
    return id || null;
  }

  function isMetricUnits() {
    return document.documentElement.getAttribute("data-rwgps-metric") === "1";
  }

  function cleanup() {
    const tab = document.querySelector(".rwgps-streak-tab");
    if (tab) tab.remove();
    const panel = document.querySelector(".rwgps-streak-panel");
    if (panel) panel.remove();
  }

  function waitForElement(selector, timeout) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        obs.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  function injectStreakTab(tabBar, userId) {
    // Check if the app already has a Streak tab (in case the feature ships natively)
    const existingTabs = tabBar.querySelectorAll("a");
    for (const t of existingTabs) {
      if (t.textContent.trim().toLowerCase() === "streak") return;
    }

    // Clone the style from an existing tab
    const existingTab = tabBar.querySelector("a");
    if (!existingTab) return;

    const streakTab = document.createElement("a");
    streakTab.className = existingTab.className + " rwgps-streak-tab";
    streakTab.textContent = "Streak";
    streakTab.href = "#";
    streakTab.addEventListener("click", (e) => {
      e.preventDefault();
      activateStreakTab(tabBar, userId);
    });

    tabBar.appendChild(streakTab);

    // Listen for clicks on other tabs to deactivate streak
    existingTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        deactivateStreakTab(tabBar);
      });
    });
  }

  function activateStreakTab(tabBar, userId) {
    const statsCard = tabBar.closest('[class*="Card"], [class*="card"]');
    if (!statsCard) return;

    // Remove selected state from all tabs
    const allTabs = tabBar.querySelectorAll("a");
    allTabs.forEach((tab) => {
      // Remove the selected class (CSS modules - find and remove class containing "selected")
      const classes = [...tab.classList];
      const selectedClass = classes.find((c) => c.includes("selected"));
      if (selectedClass) tab.classList.remove(selectedClass);
    });

    // Add selected state to streak tab
    const streakTab = tabBar.querySelector(".rwgps-streak-tab");
    if (streakTab) {
      // Find the selected class name from the module styles
      const selectedClassName = findSelectedClassName(tabBar);
      if (selectedClassName) {
        streakTab.classList.add(selectedClassName);
      }
      streakTab.classList.add("rwgps-streak-tab-selected");
    }

    // Hide the existing stats content (pager + metrics)
    const pager = statsCard.querySelector('[class*="pager"]');
    const metrics = statsCard.querySelector('[class*="AtAGlance"]');
    if (pager) pager.style.display = "none";
    if (metrics) metrics.style.display = "none";

    // Remove any existing streak panel
    const oldPanel = statsCard.querySelector(".rwgps-streak-panel");
    if (oldPanel) oldPanel.remove();

    // Create streak panel
    const panel = document.createElement("div");
    panel.className = "rwgps-streak-panel";

    // Header (matches pager area)
    const header = document.createElement("div");
    header.className = "rwgps-streak-header";
    header.textContent = "Streak";
    panel.appendChild(header);

    // Metrics grid (loading state)
    const grid = document.createElement("div");
    grid.className = "rwgps-streak-grid";
    grid.innerHTML =
      '<div class="rwgps-streak-metric"><div class="rwgps-streak-value rwgps-streak-spinner"></div><div class="rwgps-streak-metric-label">Day Streak</div></div>' +
      '<div class="rwgps-streak-metric"><div class="rwgps-streak-value rwgps-streak-spinner"></div><div class="rwgps-streak-metric-label">Streak Miles</div></div>' +
      '<div class="rwgps-streak-metric"><div class="rwgps-streak-value rwgps-streak-spinner"></div><div class="rwgps-streak-metric-label">Longest Activity of Streak</div></div>' +
      '<div class="rwgps-streak-metric"><div class="rwgps-streak-value rwgps-streak-spinner"></div><div class="rwgps-streak-metric-label">Active Hours</div></div>' +
      '<div class="rwgps-streak-metric"><div class="rwgps-streak-value rwgps-streak-spinner"></div><div class="rwgps-streak-metric-label">Feet of Elevation Gained</div></div>' +
      '<div class="rwgps-streak-metric"><div class="rwgps-streak-value rwgps-streak-spinner"></div><div class="rwgps-streak-metric-label">Calories Burned</div></div>';
    panel.appendChild(grid);

    // Insert panel before tab bar
    tabBar.parentNode.insertBefore(panel, tabBar);

    // Fetch and calculate streak data
    calculateStreakData(userId).then((data) => {
      if (!document.querySelector(".rwgps-streak-panel")) return; // tab was deactivated
      populateStreakMetrics(grid, data);
    });
  }

  function deactivateStreakTab(tabBar) {
    const statsCard = tabBar.closest('[class*="Card"], [class*="card"]');
    if (!statsCard) return;

    // Remove streak panel
    const panel = statsCard.querySelector(".rwgps-streak-panel");
    if (panel) panel.remove();

    // Show the original stats content
    const pager = statsCard.querySelector('[class*="pager"]');
    const metrics = statsCard.querySelector('[class*="AtAGlance"]');
    if (pager) pager.style.display = "";
    if (metrics) metrics.style.display = "";

    // Remove selected from streak tab
    const streakTab = tabBar.querySelector(".rwgps-streak-tab");
    if (streakTab) {
      const selectedClassName = findSelectedClassName(tabBar);
      if (selectedClassName) streakTab.classList.remove(selectedClassName);
      streakTab.classList.remove("rwgps-streak-tab-selected");
    }
  }

  function findSelectedClassName(tabBar) {
    // Look through all tabs for any class containing "selected"
    const allTabs = tabBar.querySelectorAll("a");
    for (const tab of allTabs) {
      for (const cls of tab.classList) {
        if (cls.includes("selected")) return cls;
      }
    }
    return null;
  }

  function populateStreakMetrics(grid, data) {
    const metric = isMetricUnits();
    const distUnit = metric ? "Kilometers" : "Miles";
    const elevUnit = metric ? "Meters" : "Feet";
    const distDivisor = metric ? 1000 : 1609.34;
    const elevDivisor = metric ? 1 : 0.3048;

    const streakDist = (data.streakDistance / distDivisor).toFixed(1);
    const longestDist = (data.longestActivity / distDivisor).toFixed(1);
    const elevGain = Math.round(data.totalElevationGain / elevDivisor).toLocaleString("en-US");
    const hours = Math.floor(data.totalTime / 3600);
    const mins = Math.floor((data.totalTime % 3600) / 60);
    const activeTime = hours > 0 ? hours + ":" + String(mins).padStart(2, "0") : "0:" + String(mins).padStart(2, "0");
    const calories = data.totalCalories ? data.totalCalories.toLocaleString("en-US") : "0";

    const metrics = grid.querySelectorAll(".rwgps-streak-metric");
    setMetric(metrics[0], data.currentStreak.toLocaleString("en-US"), "Day Streak");
    setMetric(metrics[1], streakDist, "Streak " + distUnit);
    setMetric(metrics[2], longestDist, "Longest Activity of Streak");
    setMetric(metrics[3], activeTime, "Active Hours");
    setMetric(metrics[4], elevGain, elevUnit + " of Elevation Gained");
    setMetric(metrics[5], calories, "Calories Burned");
  }

  function setMetric(el, value, label) {
    const valueEl = el.querySelector(".rwgps-streak-value");
    const labelEl = el.querySelector(".rwgps-streak-metric-label");
    valueEl.classList.remove("rwgps-streak-spinner");
    valueEl.textContent = value;
    labelEl.textContent = label;
  }

  // --- Data fetching ---

  async function fetchTrips(userId, departedAtMin, departedAtMax) {
    const params = new URLSearchParams({
      user_id: userId,
      apikey: API_KEY,
      version: String(API_VERSION),
      departed_at_min: departedAtMin,
      departed_at_max: departedAtMax,
      per_page: "200",
    });
    const url = `https://ridewithgps.com/trips.json?${params}`;
    const resp = await fetch(url, { credentials: "same-origin" });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : data.results || [];
  }

  function toDateString(dateInput) {
    const d = new Date(dateInput);
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function prevDay(dateStr) {
    const d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() - 1);
    return toDateString(d);
  }

  function subtractDays(dateStr, n) {
    const d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() - n);
    return toDateString(d);
  }

  async function rwgpsFetch(path) {
    const resp = await fetch("https://ridewithgps.com" + path, {
      credentials: "same-origin",
      headers: {
        "x-rwgps-api-key": API_KEY,
        "x-rwgps-api-version": "3",
        "Accept": "application/json",
      },
    });
    if (!resp.ok) return null;
    return resp.json();
  }

  async function calculateStreakData(userId) {
    const today = toDateString(new Date());
    const tomorrow = subtractDays(today, -1);

    // Fetch all trips from the past year, paginating like the app does
    const oneYearAgo = subtractDays(today, 365);
    const allTrips = [];
    let page = 0;

    while (true) {
      const params = new URLSearchParams({
        user_id: userId,
        departed_at_min: oneYearAgo,
        departed_at_max: tomorrow,
        per_page: "200",
        page: String(page),
      });
      const data = await rwgpsFetch("/trips.json?" + params);
      if (!data) break;
      const trips = data.results || [];
      allTrips.push(...trips);
      const totalCount = data.results_count || data.total_count || 0;
      if (allTrips.length >= totalCount || trips.length < 200) break;
      page++;
    }

    // Build day map (handle both camelCase and snake_case keys)
    const dayMap = new Map();
    for (const trip of allTrips) {
      const dateField = trip.departedAt || trip.departed_at || trip.createdAt || trip.created_at;
      if (!dateField) continue;
      const day = toDateString(dateField);
      if (!dayMap.has(day)) dayMap.set(day, []);
      dayMap.get(day).push(trip);
    }

    if (dayMap.size === 0) {
      return { currentStreak: 0, streakDistance: 0, longestActivity: 0, totalTime: 0, totalElevationGain: 0, totalCalories: 0 };
    }

    // Calculate streak
    const startOffset = dayMap.has(today) ? 0 : 1;
    let currentStreak = 0;
    const streakDays = new Set();

    for (let i = startOffset; ; i++) {
      const day = subtractDays(today, i);
      if (dayMap.has(day)) {
        currentStreak++;
        streakDays.add(day);
      } else {
        break;
      }
    }

    // Aggregate metrics for streak days
    let streakDistance = 0;
    let longestActivity = 0;
    let totalTime = 0;
    let totalElevationGain = 0;
    let totalCalories = 0;

    for (const trip of allTrips) {
      const dateField = trip.departedAt || trip.departed_at || trip.createdAt || trip.created_at;
      if (!dateField) continue;
      const day = toDateString(dateField);
      if (!streakDays.has(day)) continue;

      const dist = trip.distance || 0;
      streakDistance += dist;
      if (dist > longestActivity) longestActivity = dist;
      totalTime += trip.movingTime || trip.moving_time || 0;
      totalElevationGain += trip.elevationGain || trip.elevation_gain || 0;
      totalCalories += trip.calories || 0;
    }

    return { currentStreak, streakDistance, longestActivity, totalTime, totalElevationGain, totalCalories };
  }
})();
