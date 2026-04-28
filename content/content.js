if (typeof browser === "undefined") { window.browser = chrome; }
(function () {
  "use strict";

  const API_KEY = "32b6e135";
  const API_VERSION = 3;

  let lastUserId = null;
  let lastPage = null;

  // Inject a script into the page context to expose rwgps globals to the content script
  const bridge = document.createElement("script");
  bridge.src = browser.runtime.getURL("content/page-user.js");
  document.documentElement.appendChild(bridge);
  bridge.remove();

  // Check for eligible pages on interval (reliable for SPA navigation)
  setInterval(checkPage, 1000);
  checkPage();

  async function checkPage() {
    var R = window.RE;
    if (R && R.contextInvalidated) return;
    var settings = R && R.safeStorageGet
      ? await R.safeStorageGet({ streaksEnabled: true, statsChartsEnabled: true })
      : await browser.storage.local.get({ streaksEnabled: true, statsChartsEnabled: true });
    if (!settings) return;
    var streaksOn = !!settings.streaksEnabled;
    var chartsOn = !!settings.statsChartsEnabled;

    // Skip if both features are disabled
    if (!streaksOn && !chartsOn) {
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
    if (pageKey === lastPage && document.querySelector(".rwgps-streak-tab, .rwgps-stats-chart")) {
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
    if (streaksOn) {
      injectStreakTab(tabBar, userId);
    }
    if (chartsOn && !streaksOn) {
      // Wire charts without injecting streak tab
      wireChartToTabs(tabBar, userId);
    }
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
    removeBarChart();
    stopChartPagerObserver();
    cachedTrips = null;
    cachedTripsRange = null;
    cachedTripsTimestamp = 0;
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

    // Wire up bar chart for all tabs (if stats charts enabled)
    browser.storage.local.get({ statsChartsEnabled: true }).then(function (s) {
      if (s.statsChartsEnabled) wireChartToTabs(tabBar, userId);
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
    const oneYearAgo = subtractDays(today, 365);

    // Use shared fetch with caching
    const allTrips = await fetchTripsForRange(userId, oneYearAgo, today);

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

  // ─── Stats Bar Chart ──────────────────────────────────────────────────

  let cachedTrips = null;
  let cachedTripsRange = null; // { min, max }
  let cachedTripsTimestamp = 0;
  const TODAY_CACHE_TTL_MS = 60 * 1000; // refresh today-inclusive ranges every minute
  let chartPagerObserver = null;
  let lastChartPagerText = "";

  function detectActiveTab(tabBar) {
    const allTabs = tabBar.querySelectorAll("a");
    for (const tab of allTabs) {
      const isSelected = [...tab.classList].some((c) => c.includes("selected")) ||
        tab.classList.contains("rwgps-streak-tab-selected");
      if (isSelected) {
        const text = tab.textContent.trim().toLowerCase();
        if (text === "week" || text === "month" || text === "year" || text === "career" || text === "streak") {
          return text;
        }
      }
    }
    return "week"; // fallback
  }

  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function parsePagerDateRange(statsCard, activeTab) {
    const today = new Date();
    const todayStr = toDateString(today);

    if (activeTab === "streak") {
      return { start: subtractDays(todayStr, 31), end: todayStr };
    }

    if (activeTab === "career") {
      return { start: null, end: todayStr };
    }

    const pager = statsCard.querySelector('[class*="pager"]');
    if (!pager) { console.log("[Chart] No pager found"); return null; }
    const text = pager.textContent.trim();
    console.log("[Chart] Pager text:", JSON.stringify(text));

    if (activeTab === "week") {
      // Formats: "April 6-12", "April 6 - 12", "Apr 6 - Apr 12", "Dec 30-Jan 5", etc.
      // Try "Month D-D" (same month, compact)
      const sameMonthMatch = text.match(/^([A-Za-z]+)\s+(\d+)\s*[-–—]\s*(\d+)(?:,?\s*(\d{4}))?$/);
      if (sameMonthMatch) {
        const monthStr = sameMonthMatch[1];
        const startDay = parseInt(sameMonthMatch[2], 10);
        const endDay = parseInt(sameMonthMatch[3], 10);
        const year = sameMonthMatch[4] ? parseInt(sameMonthMatch[4], 10) : today.getFullYear();
        let monthIdx = MONTH_NAMES.indexOf(monthStr);
        if (monthIdx < 0) monthIdx = MONTH_ABBR.indexOf(monthStr);
        if (monthIdx >= 0) {
          const startDate = new Date(year, monthIdx, startDay);
          const endDate = new Date(year, monthIdx, endDay);
          return { start: toDateString(startDate), end: toDateString(endDate) };
        }
      }
      // Try "Month D - Month D" (cross-month)
      const crossMatch = text.match(/^([A-Za-z]+)\s+(\d+)(?:,?\s*(\d{4}))?\s*[-–—]\s*([A-Za-z]+)\s+(\d+)(?:,?\s*(\d{4}))?$/);
      if (crossMatch) {
        const startDate = parseShortDate(crossMatch[1] + " " + crossMatch[2] + (crossMatch[3] ? ", " + crossMatch[3] : ""), today);
        const endDate = parseShortDate(crossMatch[4] + " " + crossMatch[5] + (crossMatch[6] ? ", " + crossMatch[6] : ""), today);
        if (startDate && endDate) {
          return { start: toDateString(startDate), end: toDateString(endDate) };
        }
      }
      return null;
    }

    if (activeTab === "month") {
      // Format: "April" or "April 2024"
      const parts = text.split(/\s+/);
      const monthIdx = MONTH_NAMES.indexOf(parts[0]);
      if (monthIdx < 0) return null;
      const year = parts[1] ? parseInt(parts[1], 10) : today.getFullYear();
      const start = new Date(year, monthIdx, 1);
      const end = new Date(year, monthIdx + 1, 0); // last day of month
      return { start: toDateString(start), end: toDateString(end) };
    }

    if (activeTab === "year") {
      // Format: "2024"
      const year = parseInt(text, 10);
      if (isNaN(year)) return null;
      return { start: year + "-01-01", end: year + "-12-31" };
    }

    return null;
  }

  function parseShortDate(str, refDate) {
    // Parse "Apr 7", "Apr 7, 2024", "December 30"
    const match = str.match(/^([A-Za-z]+)\s+(\d+)(?:,?\s*(\d{4}))?$/);
    if (!match) return null;
    const monthStr = match[1];
    const day = parseInt(match[2], 10);
    const year = match[3] ? parseInt(match[3], 10) : refDate.getFullYear();
    let monthIdx = MONTH_ABBR.indexOf(monthStr);
    if (monthIdx < 0) monthIdx = MONTH_NAMES.indexOf(monthStr);
    if (monthIdx < 0) return null;
    return new Date(year, monthIdx, day);
  }

  const TRIP_CACHE_MAX_AGE = 60 * 60 * 1000; // 1 hour

  async function loadTripCache(userId) {
    try {
      const key = "tripCache_" + userId;
      const stored = await browser.storage.local.get(key);
      const entry = stored[key];
      if (!entry) return null;
      const age = Date.now() - (entry.ts || 0);
      if (age > TRIP_CACHE_MAX_AGE) return null;
      return { trips: entry.trips || [], range: entry.range || null };
    } catch (e) { return null; }
  }

  async function saveTripCache(userId, trips, range) {
    try {
      const key = "tripCache_" + userId;
      // Store only the fields we need to keep size small
      const slim = trips.map((t) => ({
        departedAt: t.departedAt || t.departed_at || t.createdAt || t.created_at,
        distance: t.distance || 0,
        movingTime: t.movingTime || t.moving_time || 0,
        elevationGain: t.elevationGain || t.elevation_gain || 0,
        calories: t.calories || 0,
      }));
      await browser.storage.local.set({ [key]: { trips: slim, range, ts: Date.now() } });
    } catch (e) {
      // Storage full or other error — ignore silently
    }
  }

  async function fetchTripsForRange(userId, startStr, endStr) {
    const minDate = startStr || "2000-01-01";
    const todayStr = toDateString(new Date());

    // Pad the API window so it covers all of "today" regardless of the
    // user's timezone. RWGPS interprets departed_at_max as an exclusive
    // UTC midnight, so a +1 day pad missed late-evening rides for users
    // in negative UTC offsets (e.g. 9pm PDT = 04:00 UTC next day).
    let maxDate;
    if (endStr >= todayStr) {
      maxDate = subtractDays(todayStr, -2);
    } else {
      maxDate = subtractDays(endStr, -1);
    }

    // Ranges that include today may have new activity — skip persistent cache
    var rangIncludesToday = maxDate >= todayStr;

    // Check in-memory cache first. For today-inclusive ranges, only trust
    // the cache for a short window — otherwise rides logged after the page
    // was first loaded never show up until navigation.
    if (cachedTrips && cachedTripsRange) {
      var fresh = !rangIncludesToday || (Date.now() - cachedTripsTimestamp) < TODAY_CACHE_TTL_MS;
      if (fresh && cachedTripsRange.min <= minDate && cachedTripsRange.max >= maxDate) {
        return cachedTrips;
      }
    }

    // Check persistent storage cache (skip if range includes today)
    if (!rangIncludesToday) {
      const stored = await loadTripCache(userId);
      if (stored && stored.range) {
        if (stored.range.min <= minDate && stored.range.max >= maxDate) {
          cachedTrips = stored.trips;
          cachedTripsRange = stored.range;
          cachedTripsTimestamp = stored.ts || Date.now();
          return stored.trips;
        }
      }
    }

    // Fetch from API
    const allTrips = [];
    let page = 0;

    while (true) {
      const params = new URLSearchParams({
        user_id: userId,
        departed_at_min: minDate,
        departed_at_max: maxDate,
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

    // Update both in-memory and persistent cache
    const range = { min: minDate, max: maxDate };
    cachedTrips = allTrips;
    cachedTripsRange = range;
    cachedTripsTimestamp = Date.now();
    saveTripCache(userId, allTrips, range);

    return allTrips;
  }

  function tripDistance(trip) {
    return trip.distance || 0;
  }

  function tripDate(trip) {
    const dateField = trip.departedAt || trip.departed_at || trip.createdAt || trip.created_at;
    return dateField ? toDateString(dateField) : null;
  }

  function aggregateBarsForTab(trips, activeTab, startStr, endStr) {
    const metric = isMetricUnits();
    const distDivisor = metric ? 1000 : 1609.34;
    const eleDivisor = metric ? 1 : 3.28084;
    const unit = metric ? "km" : "mi";
    const eleUnit = metric ? "m" : "ft";

    // Build day map with distance, time, and elevation
    const dayMap = new Map();
    for (const trip of trips) {
      const day = tripDate(trip);
      if (!day) continue;
      if (startStr && day < startStr) continue;
      if (endStr && day > endStr) continue;
      if (!dayMap.has(day)) dayMap.set(day, { dist: 0, time: 0, ele: 0 });
      const entry = dayMap.get(day);
      entry.dist += tripDistance(trip);
      entry.time += (trip.movingTime || trip.moving_time || 0);
      entry.ele += (trip.elevationGain || trip.elevation_gain || 0);
    }

    function emptyBar() { return { dist: 0, time: 0, ele: 0 }; }
    function dayEntry(ds) { return dayMap.get(ds) || emptyBar(); }

    let labels = [];
    let bars = []; // { dist, time, ele } in display units

    if (activeTab === "week") {
      const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];
      const start = new Date(startStr + "T12:00:00");
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const e = dayEntry(toDateString(d));
        labels.push(dayLabels[d.getDay()]);
        bars.push({ dist: e.dist / distDivisor, time: e.time, ele: e.ele * eleDivisor });
      }
    } else if (activeTab === "month") {
      const start = new Date(startStr + "T12:00:00");
      const end = new Date(endStr + "T12:00:00");
      const daysInMonth = end.getDate();
      for (let i = 1; i <= daysInMonth; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), i);
        const e = dayEntry(toDateString(d));
        labels.push((i === 1 || i % 5 === 0 || i === daysInMonth) ? String(i) : "");
        bars.push({ dist: e.dist / distDivisor, time: e.time, ele: e.ele * eleDivisor });
      }
    } else if (activeTab === "year") {
      const year = parseInt(startStr, 10);
      const weekMap = new Map();
      for (const [day, entry] of dayMap) {
        const d = new Date(day + "T12:00:00");
        if (d.getFullYear() !== year) continue;
        const jan1 = new Date(year, 0, 1);
        const weekNum = Math.floor((d - jan1) / (7 * 86400000));
        if (!weekMap.has(weekNum)) weekMap.set(weekNum, emptyBar());
        const w = weekMap.get(weekNum);
        w.dist += entry.dist; w.time += entry.time; w.ele += entry.ele;
      }
      for (let w = 0; w < 52; w++) {
        const weekStart = new Date(year, 0, 1 + w * 7);
        const prevWeekStart = w > 0 ? new Date(year, 0, 1 + (w - 1) * 7) : null;
        const showLabel = !prevWeekStart || weekStart.getMonth() !== prevWeekStart.getMonth();
        labels.push(showLabel ? MONTH_ABBR[weekStart.getMonth()] : "");
        const we = weekMap.get(w) || emptyBar();
        bars.push({ dist: we.dist / distDivisor, time: we.time, ele: we.ele * eleDivisor });
      }
    } else if (activeTab === "career") {
      const yearMap = new Map();
      let minYear = new Date().getFullYear(), maxYear = 0;
      for (const [day, entry] of dayMap) {
        const y = parseInt(day.substring(0, 4), 10);
        if (!yearMap.has(y)) yearMap.set(y, emptyBar());
        const ye = yearMap.get(y);
        ye.dist += entry.dist; ye.time += entry.time; ye.ele += entry.ele;
        if (y < minYear) minYear = y;
        if (y > maxYear) maxYear = y;
      }
      if (maxYear === 0) { minYear = new Date().getFullYear(); maxYear = minYear; }
      for (let y = minYear; y <= maxYear; y++) {
        labels.push(String(y));
        const ye = yearMap.get(y) || emptyBar();
        bars.push({ dist: ye.dist / distDivisor, time: ye.time, ele: ye.ele * eleDivisor });
      }
    } else if (activeTab === "streak") {
      // Show only the current streak: 2+ consecutive days including yesterday/today
      const today = toDateString(new Date());
      const startOffset = dayMap.has(today) ? 0 : 1;
      let streakLen = 0;
      for (let i = startOffset; ; i++) {
        if (dayMap.has(subtractDays(today, i))) { streakLen++; } else { break; }
      }
      if (streakLen < 2) {
        // No active streak — show nothing
      } else {
        var maxBars = Math.min(streakLen, 30);
        for (let i = maxBars - 1; i >= 0; i--) {
          const day = subtractDays(today, i + startOffset);
          const d = new Date(day + "T12:00:00");
          const dayNum = d.getDate();
          const showLabel = i === maxBars - 1 || i === 0 || (maxBars - 1 - i) % 5 === 0;
          labels.push(showLabel ? String(dayNum) : "");
          const e = dayEntry(day);
          bars.push({ dist: e.dist / distDivisor, time: e.time, ele: e.ele * eleDivisor });
        }
      }
    }

    const values = bars.map(b => b.dist);
    const maxValue = values.length > 0 ? Math.max(...values) : 0;
    return { labels, values, bars, maxValue, unit, eleUnit };
  }

  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return "0m";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return h + "h " + m + "m";
    return m + "m";
  }

  function renderBarChart(statsCard, barData, activeTab) {
    // Remove existing chart
    const existing = statsCard.querySelector(".rwgps-stats-chart");
    if (existing) existing.remove();

    const { labels, values, bars, maxValue, unit, eleUnit } = barData;
    if (labels.length === 0) return;

    const chart = document.createElement("div");
    chart.className = "rwgps-stats-chart" + (activeTab === "week" ? " rwgps-stats-chart-week" : "");

    // Shared tooltip element
    const tip = document.createElement("div");
    tip.className = "rwgps-stats-tooltip";
    chart.appendChild(tip);
    var tipActiveIdx = -1;
    var tipHideTimer = null;

    function positionTip(hitIdx) {
      const bi = bars ? bars[hitIdx] : null;
      const dist = bi ? bi.dist : values[hitIdx];
      if (dist <= 0 && (!bi || bi.time <= 0)) { tip.style.display = "none"; tipActiveIdx = -1; return; }
      tipActiveIdx = hitIdx;
      let html = "<strong>" + dist.toFixed(1) + " " + unit + "</strong>";
      if (bi && bi.time > 0) html += "<br>" + formatDuration(bi.time);
      if (bi && bi.ele > 0) html += "<br>" + Math.round(bi.ele).toLocaleString() + " " + eleUnit + " elev";
      tip.innerHTML = html;
      tip.style.display = "block";
      const cols = chart.querySelectorAll(".rwgps-stats-bar-col");
      const col = cols[hitIdx];
      if (!col) return;
      const chartRect = chart.getBoundingClientRect();
      const colRect = col.getBoundingClientRect();
      const colCenter = colRect.left + colRect.width / 2 - chartRect.left;
      const barEl = col.querySelector(".rwgps-stats-bar");
      const barTop = barEl ? barEl.getBoundingClientRect().top - chartRect.top : 0;
      tip.style.left = colCenter + "px";
      tip.style.top = (barTop - 4) + "px";
    }

    // Find the nearest column to a given clientX within the chart.
    function nearestColIdx(clientX) {
      const cols = chart.querySelectorAll(".rwgps-stats-bar-col");
      if (!cols.length) return -1;
      var bestIdx = -1, bestDist = Infinity;
      for (var ci = 0; ci < cols.length; ci++) {
        var r = cols[ci].getBoundingClientRect();
        var center = (r.left + r.right) / 2;
        var d = Math.abs(clientX - center);
        if (d < bestDist) { bestDist = d; bestIdx = ci; }
      }
      return bestIdx;
    }

    // Use mousemove on the chart to find which column the cursor is over.
    chart.addEventListener("mousemove", function (e) {
      if (tipHideTimer) { clearTimeout(tipHideTimer); tipHideTimer = null; }
      var hitIdx = nearestColIdx(e.clientX);
      if (hitIdx === -1) { tip.style.display = "none"; tipActiveIdx = -1; return; }
      if (hitIdx === tipActiveIdx) return;
      positionTip(hitIdx);
    });

    // Hide on mouseleave — use debounce and verify with :hover to guard
    // against spurious leaves caused by React layout shifts.
    chart.addEventListener("mouseleave", function () {
      if (tipHideTimer) clearTimeout(tipHideTimer);
      tipHideTimer = setTimeout(function () {
        tipHideTimer = null;
        if (chart.isConnected && chart.matches(":hover")) return;
        tip.style.display = "none";
        tipActiveIdx = -1;
      }, 250);
    });

    for (let i = 0; i < labels.length; i++) {
      const col = document.createElement("div");
      col.className = "rwgps-stats-bar-col";

      const bar = document.createElement("div");
      const val = values[i];
      const b = bars ? bars[i] : null;
      const pct = maxValue > 0 ? (val / maxValue) * 100 : 0;
      bar.className = "rwgps-stats-bar" + (val === 0 ? " rwgps-stats-bar-empty" : "");
      bar.style.height = val > 0 ? Math.max(2, pct) + "%" : "2px";

      const label = document.createElement("div");
      label.className = "rwgps-stats-bar-label";
      label.textContent = labels[i];

      col.appendChild(bar);
      col.appendChild(label);
      chart.appendChild(col);
    }

    // Insert just above the tab bar (between metrics and tabs)
    const tabBar = statsCard.querySelector('[class*="headingFilter"]');
    if (tabBar) {
      tabBar.parentNode.insertBefore(chart, tabBar);
    }
  }

  function removeBarChart() {
    const chart = document.querySelector(".rwgps-stats-chart");
    if (chart) chart.remove();
  }

  let chartGeneration = 0;

  async function updateChart(tabBar, userId, tabOverride) {
    const gen = ++chartGeneration;

    const statsCard = tabBar.closest('[class*="Card"], [class*="card"]');
    if (!statsCard) return;

    const activeTab = tabOverride || detectActiveTab(tabBar);

    // Small delay for React to update the pager text after a tab click
    await new Promise((r) => setTimeout(r, 150));
    if (gen !== chartGeneration) return; // superseded by newer update

    const range = parsePagerDateRange(statsCard, activeTab);
    if (!range) { removeBarChart(); return; }

    // Show loading skeleton immediately for slow fetches (Career)
    renderBarChartLoading(statsCard, activeTab, range);

    const trips = await fetchTripsForRange(userId, range.start, range.end);
    if (gen !== chartGeneration) return; // superseded

    const barData = aggregateBarsForTab(trips, activeTab, range.start, range.end);
    renderBarChart(statsCard, barData, activeTab);
  }

  function renderBarChartLoading(statsCard, activeTab, range) {
    // Build placeholder labels so the user sees the axis immediately
    const metric = isMetricUnits();
    const unit = metric ? "km" : "mi";
    let labels = [];

    if (activeTab === "week") {
      labels = ["S", "M", "T", "W", "T", "F", "S"];
    } else if (activeTab === "month") {
      const end = new Date(range.end + "T12:00:00");
      const days = end.getDate();
      for (let i = 1; i <= days; i++) {
        labels.push((i === 1 || i % 5 === 0 || i === days) ? String(i) : "");
      }
    } else if (activeTab === "year") {
      for (let w = 0; w < 52; w++) {
        const year = parseInt(range.start, 10);
        const weekStart = new Date(year, 0, 1 + w * 7);
        const prevWeekStart = w > 0 ? new Date(year, 0, 1 + (w - 1) * 7) : null;
        const showLabel = !prevWeekStart || weekStart.getMonth() !== prevWeekStart.getMonth();
        labels.push(showLabel ? MONTH_ABBR[weekStart.getMonth()] : "");
      }
    } else if (activeTab === "career") {
      // Estimate year range — show current year back to ~2007 as placeholder
      const thisYear = new Date().getFullYear();
      for (let y = thisYear - 18; y <= thisYear; y++) {
        labels.push(String(y));
      }
    } else if (activeTab === "streak") {
      // Placeholder — actual streak length unknown until data loads
      for (let i = 0; i < 7; i++) {
        labels.push("");
      }
    }

    // Render empty bars with a spinner overlay
    const barData = {
      labels,
      values: labels.map(() => 0),
      bars: labels.map(() => ({ dist: 0, time: 0, ele: 0 })),
      maxValue: 0,
      unit,
      eleUnit: metric ? "m" : "ft",
    };
    renderBarChart(statsCard, barData, activeTab);

    // Add a spinner on top
    const chart = statsCard.querySelector(".rwgps-stats-chart");
    if (chart) {
      const spinner = document.createElement("div");
      spinner.className = "rwgps-stats-chart-loading";
      spinner.innerHTML = '<div class="rwgps-streak-spinner"></div>';
      chart.appendChild(spinner);
    }
  }

  function startChartPagerObserver(tabBar, userId) {
    stopChartPagerObserver();
    const statsCard = tabBar.closest('[class*="Card"], [class*="card"]');
    if (!statsCard) return;

    const pager = statsCard.querySelector('[class*="pager"]');
    if (!pager) return;

    lastChartPagerText = pager.textContent.trim();

    chartPagerObserver = new MutationObserver(() => {
      const newText = pager.textContent.trim();
      if (newText !== lastChartPagerText) {
        lastChartPagerText = newText;
        updateChart(tabBar, userId);
      }
    });
    chartPagerObserver.observe(pager, { childList: true, subtree: true, characterData: true });
  }

  function stopChartPagerObserver() {
    if (chartPagerObserver) {
      chartPagerObserver.disconnect();
      chartPagerObserver = null;
    }
    lastChartPagerText = "";
  }

  function wireChartToTabs(tabBar, userId) {
    // Listen for clicks on all tabs (including streak)
    const allTabs = tabBar.querySelectorAll("a");
    allTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const clickedTab = tab.textContent.trim().toLowerCase();
        // Small delay for tab switch animation / class updates
        setTimeout(() => updateChart(tabBar, userId, clickedTab), 200);
      });
    });

    // Start pager observer for arrow navigation
    startChartPagerObserver(tabBar, userId);

    // Initial chart render
    updateChart(tabBar, userId);
  }
})();
