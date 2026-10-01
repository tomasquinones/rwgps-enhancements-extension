if (typeof browser === "undefined") { window.browser = chrome; }
(function () {
  "use strict";

  let lastPage = null;
  // The tab-bar wait in checkPageInner can take up to 10 s; without this guard
  // every 1 s tick would stack another document-wide MutationObserver.
  let checkPageRunning = false;
  // What the current page's Stats-card wiring acts on: { tabBar, userId,
  // charts }. Null when no page is set up. Tab click handlers read it (see
  // onTabUpdateChart) instead of closing over a page's user id.
  let statsWiring = null;
  let wiredStreakTab = null; // the Streak tab we injected, if any

  // Inject a script into the page context to expose rwgps globals to the content script
  const bridge = document.createElement("script");
  bridge.src = browser.runtime.getURL("content/page-user.js");
  document.documentElement.appendChild(bridge);
  bridge.remove();

  // Check for eligible pages on interval (reliable for SPA navigation). The
  // first check is deferred a task so shared.js (loaded after this file) has
  // defined window.RE.
  setInterval(checkPage, 1000);
  setTimeout(checkPage, 0);

  async function checkPage() {
    if (!window.RE) return;
    if (checkPageRunning) return;
    checkPageRunning = true;
    try {
      await checkPageInner();
    } finally {
      checkPageRunning = false;
    }
  }

  // The Stats card lives on the dashboard and on a profile's root page
  // (/users/:id) — not on /users/:id/<anything>. Returns { userId, pageKey }
  // or null.
  function statsPageTarget() {
    const profileMatch = location.pathname.match(/^\/users\/(\d+)\/?$/);
    const isDashboard = location.pathname === "/" || location.pathname === "/dashboard";
    const userId = profileMatch ? profileMatch[1] : isDashboard ? window.RE.getCurrentUserId() : null;
    return userId ? { userId: userId, pageKey: location.pathname + ":" + userId } : null;
  }

  async function checkPageInner() {
    var R = window.RE; // checkPage only runs once shared.js has defined it
    if (R.contextInvalidated) return;
    var settings = await R.safeStorageGet({ streaksEnabled: true, statsChartsEnabled: true });
    if (!settings) return;
    var streaksOn = !!settings.streaksEnabled;
    var chartsOn = !!settings.statsChartsEnabled;

    // Skip if both features are disabled
    if (!streaksOn && !chartsOn) {
      cleanup();
      lastPage = null;
      return;
    }
    const target = statsPageTarget();

    // Clean up if we've left an eligible page
    if (!target) {
      lastPage = null;
      cleanup();
      return;
    }
    const userId = target.userId;
    const pageKey = target.pageKey;

    // Already set up for this page: the tab bar we wired (and our Streak tab,
    // if we added one) is still mounted. Keying on the tab bar rather than on
    // our chart means a page with no chart to draw isn't re-wired every tick.
    if (pageKey === lastPage && statsWiring && statsWiring.tabBar.isConnected &&
        (!wiredStreakTab || wiredStreakTab.isConnected)) {
      return;
    }

    // Wait for the Stats card tab bar to render
    const tabBar = await window.RE.waitForElement('[class*="headingFilter"]', 10000);
    if (!tabBar) return;

    // Re-check the page hasn't changed while we waited (including a move to
    // a different profile, which would leave userId stale).
    const after = statsPageTarget();
    if (!after || after.pageKey !== pageKey) return;

    lastPage = pageKey;

    cleanup();
    const wiring = statsWiring = { tabBar: tabBar, userId: userId, charts: chartsOn };
    if (streaksOn) {
      wiredStreakTab = injectStreakTab(tabBar, userId);
    }
    if (chartsOn) {
      // Load the saved bar palette before the first render.
      loadStatsPalette().then(function () {
        if (statsWiring === wiring) wireChartToTabs(tabBar, userId);
      });
    }
    // Eddington Number on the Career tab — independent of charts/streak wiring
    // (we only reach here when at least one stats enhancement is enabled).
    wireEddingtonToTabs(tabBar, userId);
  }

  function cleanup() {
    statsWiring = null;
    wiredStreakTab = null;
    const tab = document.querySelector(".rwgps-streak-tab");
    if (tab) tab.remove();
    const panel = document.querySelector(".rwgps-streak-panel");
    if (panel) panel.remove();
    removeBarChart();
    stopChartPagerObserver();
    removeEddingtonStat();
    stopEddingtonObserver();
  }

  // True while (tabBar, userId) is still the page we're wired to — async work
  // checks this so a slow fetch can't paint one user's data onto another
  // user's profile after SPA navigation.
  function isCurrentStats(tabBar, userId) {
    return !!statsWiring && statsWiring.tabBar === tabBar && statsWiring.userId === userId;
  }

  // Tab click handlers. They're stable function references, so wiring the same
  // tab again (React can keep the tab bar across SPA navigation) never stacks
  // duplicates — addEventListener ignores an identical listener — and they act
  // on statsWiring, i.e. the current page's user, never a previous page's.
  function wiringForTab(tab) {
    return statsWiring && statsWiring.tabBar.contains(tab) ? statsWiring : null;
  }

  function onTabDeactivateStreak(e) {
    const w = wiringForTab(e.currentTarget);
    if (w) deactivateStreakTab(w.tabBar);
  }

  function onTabUpdateChart(e) {
    const w = wiringForTab(e.currentTarget);
    if (!w || !w.charts) return;
    const clickedTab = e.currentTarget.textContent.trim().toLowerCase();
    // Small delay for tab switch animation / class updates
    setTimeout(() => updateChart(w.tabBar, w.userId, clickedTab), 200);
  }

  function onTabEddington(e) {
    const w = wiringForTab(e.currentTarget);
    if (!w) return;
    const clicked = e.currentTarget.textContent.trim().toLowerCase();
    if (clicked === "career") {
      setTimeout(() => injectEddingtonStat(w.tabBar, w.userId), 250);
    } else {
      removeEddingtonStat();
    }
  }

  // Returns the Streak tab it added, or null if it added none.
  function injectStreakTab(tabBar, userId) {
    // Check if the app already has a Streak tab (in case the feature ships natively)
    const existingTabs = tabBar.querySelectorAll("a");
    for (const t of existingTabs) {
      if (t.textContent.trim().toLowerCase() === "streak") return null;
    }

    // Clone the style from an existing tab
    const existingTab = tabBar.querySelector("a");
    if (!existingTab) return null;

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
      tab.addEventListener("click", onTabDeactivateStreak);
    });

    // (The bar chart is wired by checkPageInner when stats charts are enabled.)
    return streakTab;
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
    const metric = window.RE.isMetric();
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

  function subtractDays(dateStr, n) {
    const d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() - n);
    return toDateString(d);
  }


  // Day map (handles both camelCase and snake_case keys) and the current
  // streak walked back from today/yesterday. `gapDay` is the first day without
  // a trip, where the walk stopped.
  function findStreak(allTrips, today) {
    const dayMap = new Map();
    for (const trip of allTrips) {
      const dateField = trip.departedAt || trip.departed_at || trip.createdAt || trip.created_at;
      if (!dateField) continue;
      const day = toDateString(dateField);
      if (!dayMap.has(day)) dayMap.set(day, []);
      dayMap.get(day).push(trip);
    }

    const startOffset = dayMap.has(today) ? 0 : 1;
    const streakDays = new Set();
    let i = startOffset;
    for (; ; i++) {
      const day = subtractDays(today, i);
      if (!dayMap.has(day)) break;
      streakDays.add(day);
    }
    return { dayMap, streakDays, gapDay: subtractDays(today, i) };
  }

  async function calculateStreakData(userId) {
    const today = toDateString(new Date());
    const oneYearAgo = subtractDays(today, 365);

    // Use shared fetch with caching. Only the last year is fetched — enough
    // for nearly every streak. If the walk ran off the start of that window
    // the streak may go back further, so recount from the full history.
    let allTrips = await fetchTripsForRange(userId, oneYearAgo, today);
    let streak = findStreak(allTrips, today);
    if (streak.gapDay < oneYearAgo) {
      allTrips = await fetchTripsForRange(userId, null, today);
      streak = findStreak(allTrips, today);
    }

    if (streak.dayMap.size === 0) {
      return { currentStreak: 0, streakDistance: 0, longestActivity: 0, totalTime: 0, totalElevationGain: 0, totalCalories: 0 };
    }

    const currentStreak = streak.streakDays.size;
    const streakDays = streak.streakDays;

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

  const TODAY_CACHE_TTL_MS = 60 * 1000; // refresh today-inclusive ranges every minute
  let chartPagerObserver = null;
  let lastChartPagerText = "";

  // Bar-chart color schemes. "pride" cycles the rainbow (see prideColors);
  // warm/cool are solid fills mirroring the Goals chart palettes.
  const STATS_PALETTES = {
    warm: { bar: "#f56200", swatch: "#f56200" },
    cool: { bar: "#5c77ff", swatch: "#5c77ff" },
    pride: { bar: null, swatch: "linear-gradient(90deg,#E40303,#FF8C00,#FFED00,#008026,#004DFF,#750787)" },
  };
  let statsPaletteKey = "pride"; // default; overwritten from storage at startup
  let lastStatsCtx = null; // { statsCard, barData, activeTab } for re-render on palette change

  function loadStatsPalette() {
    return browser.storage.local.get({ statsChartPalette: "pride" }).then(function (s) {
      statsPaletteKey = STATS_PALETTES[s.statsChartPalette] ? s.statsChartPalette : "pride";
      return statsPaletteKey;
    });
  }

  // Per-bar colors for the active palette. Pride spreads the full rainbow
  // across n bars; warm/cool return a uniform solid fill.
  function statsBarColors(n) {
    if (statsPaletteKey === "pride") return prideColors(n);
    const solid = (STATS_PALETTES[statsPaletteKey] || STATS_PALETTES.warm).bar;
    const out = [];
    for (let i = 0; i < n; i++) out.push(solid);
    return out;
  }

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

  // v2: key bumped when pagination landed so pre-fix truncated lists are
  // ignored instead of being served stale for up to TRIP_CACHE_MAX_AGE.
  // `range.min` is the earliest date the stored list is known to cover (null =
  // full history; entries saved before `since` fetches say "2000-01-01").
  async function loadTripCache(userId) {
    try {
      const key = "tripCacheV2_" + userId;
      const stored = await browser.storage.local.get(key);
      const entry = stored[key];
      if (!entry) return null;
      const age = Date.now() - (entry.ts || 0);
      if (age > TRIP_CACHE_MAX_AGE) return null;
      return { trips: entry.trips || [], range: entry.range || null, ts: entry.ts || 0 };
    } catch (e) { return null; }
  }

  let tripCachePruned = false;

  async function saveTripCache(userId, trips, range) {
    try {
      const key = "tripCacheV2_" + userId;
      // Store only the fields we need to keep size small
      const slim = trips.map((t) => ({
        name: t.name || t.title || "",
        departedAt: t.departedAt || t.departed_at || t.createdAt || t.created_at,
        distance: t.distance || 0,
        movingTime: t.movingTime || t.moving_time || 0,
        elevationGain: t.elevationGain || t.elevation_gain || 0,
        calories: t.calories || 0,
      }));
      await browser.storage.local.set({ [key]: { trips: slim, range, ts: Date.now() } });
      if (!tripCachePruned) {
        tripCachePruned = true;
        await pruneTripCaches();
      }
    } catch (e) {
      // Storage full or other error — ignore silently
    }
  }

  // Once per page load, on the first save: drop legacy v1 `tripCache_*` keys
  // (nothing reads them now; they may hold pre-pagination truncated lists) and
  // expired `tripCacheV2_*` entries so other users' lists don't pile up.
  async function pruneTripCaches() {
    const all = await browser.storage.local.get(null);
    const now = Date.now();
    const stale = Object.keys(all).filter((k) => {
      if (k.indexOf("tripCache_") === 0) return true;
      if (k.indexOf("tripCacheV2_") === 0) {
        return !all[k] || now - (all[k].ts || 0) > TRIP_CACHE_MAX_AGE;
      }
      return false;
    });
    if (stale.length) await browser.storage.local.remove(stale);
  }

  // A stored list serves a request starting at startStr (null = full history)
  // only if it reaches back at least that far.
  function storedCoversRange(range, startStr) {
    if (!range) return false;
    if (range.min == null) return true;
    return !!startStr && range.min <= startStr;
  }

  // Returns every trip for `userId` departed on/after startStr (startStr null
  // = full history). The list may also hold older trips; callers filter by
  // date range themselves (see aggregateBarsForTab / calculateStreakData).
  //
  // The network fetch + in-memory caching live in the shared helper
  // window.RE.fetchUserTrips (cookie-only `/users/{id}/trips.json`, since the
  // v3 api-key endpoint always returns the authenticated user); passing
  // `since` lets it stop paging at startStr instead of downloading the whole
  // history. On top of that we keep a persistent (1h) storage cache for
  // past-only ranges so the chart survives reloads without re-fetching.
  async function fetchTripsForRange(userId, startStr, endStr) {
    const todayStr = toDateString(new Date());
    const rangeIncludesToday = !endStr || endStr >= todayStr;

    // Past-only ranges: a reload-surviving persistent cache.
    if (!rangeIncludesToday) {
      const stored = await loadTripCache(userId);
      if (stored && stored.trips && storedCoversRange(stored.range, startStr)) return stored.trips;
    }

    // Shared fetcher owns the in-memory cache; trust it briefly for
    // today-inclusive ranges so newly logged rides eventually appear.
    const trips = await window.RE.fetchUserTrips(userId, {
      ttl: rangeIncludesToday ? TODAY_CACHE_TTL_MS : TRIP_CACHE_MAX_AGE,
      since: startStr ? new Date(startStr + "T00:00:00") : null, // local midnight
    });

    // Skip empty lists: nothing worth persisting, and a fetch whose first
    // request failed also comes back empty.
    if (!rangeIncludesToday && trips.length) {
      saveTripCache(userId, trips, { min: startStr || null, max: todayStr });
    }
    return trips;
  }

  function tripDistance(trip) {
    return trip.distance || 0;
  }

  function tripDate(trip) {
    const dateField = trip.departedAt || trip.departed_at || trip.createdAt || trip.created_at;
    return dateField ? toDateString(dateField) : null;
  }

  function aggregateBarsForTab(trips, activeTab, startStr, endStr) {
    const metric = window.RE.isMetric();
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

  // Pride-flag rainbow: interpolate across the six classic pride colors so
  // each bar gets a distinct hue flowing red → orange → yellow → green →
  // blue → purple. Used to color the June month view.
  const PRIDE_STOPS = [
    [228, 3, 3],    // red    #E40303
    [255, 140, 0],  // orange #FF8C00
    [255, 237, 0],  // yellow #FFED00
    [0, 128, 38],   // green  #008026
    [0, 77, 255],   // blue   #004DFF
    [117, 7, 135],  // purple #750787
  ];

  function prideColor(t) {
    // t in [0, 1] across the full rainbow
    if (t <= 0) return rgbStr(PRIDE_STOPS[0]);
    if (t >= 1) return rgbStr(PRIDE_STOPS[PRIDE_STOPS.length - 1]);
    const seg = t * (PRIDE_STOPS.length - 1);
    const i = Math.floor(seg);
    const f = seg - i;
    const a = PRIDE_STOPS[i];
    const b = PRIDE_STOPS[i + 1];
    return rgbStr([
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f),
    ]);
  }

  function rgbStr(c) { return "rgb(" + c[0] + ", " + c[1] + ", " + c[2] + ")"; }

  function prideColors(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(prideColor(n > 1 ? i / (n - 1) : 0));
    return out;
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

    const colors = statsBarColors(labels.length);

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
      const pct = maxValue > 0 ? (val / maxValue) * 100 : 0;
      bar.className = "rwgps-stats-bar" + (val === 0 ? " rwgps-stats-bar-empty" : "");
      bar.style.height = val > 0 ? Math.max(2, pct) + "%" : "2px";
      if (val > 0 && colors[i]) bar.style.background = colors[i];

      const label = document.createElement("div");
      label.className = "rwgps-stats-bar-label";
      label.textContent = labels[i];

      col.appendChild(bar);
      col.appendChild(label);
      chart.appendChild(col);
    }

    // Gear icon — switch between warm / cool / Pride color schemes. It lives in
    // the card's top-right corner (not the chart), so re-render it there with
    // dedup. Skipped during the loading skeleton so it doesn't flash early.
    if (!barData.loading) {
      lastStatsCtx = { statsCard, barData, activeTab };
      const oldGear = statsCard.querySelector(".rwgps-stats-chart-settings");
      if (oldGear) oldGear.remove();
      // The gear is absolutely positioned relative to the card.
      if (getComputedStyle(statsCard).position === "static") {
        statsCard.style.position = "relative";
      }
      statsCard.appendChild(buildStatsChartSettings());
    }

    // Insert just above the tab bar (between metrics and tabs)
    const tabBar = statsCard.querySelector('[class*="headingFilter"]');
    if (tabBar) {
      tabBar.parentNode.insertBefore(chart, tabBar);
    }
  }

  function buildStatsChartSettings() {
    const settings = document.createElement("div");
    settings.className = "rwgps-stats-chart-settings";
    settings.setAttribute("tabindex", "0");
    settings.setAttribute("role", "button");
    settings.setAttribute("aria-label", "Chart colors");
    const OPTIONS = [
      { key: "warm", label: "Warm" },
      { key: "cool", label: "Cool" },
      { key: "pride", label: "Pride" },
    ];
    let menu =
      '<svg class="rwgps-stats-chart-settings-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
        '<path fill="currentColor" d="M19.14 12.94c.04-.3.06-.62.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61L4.89 11.06c-.04.3-.06.62-.06.94s.02.64.06.94L2.86 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/>' +
      '</svg>' +
      '<div class="rwgps-stats-chart-settings-content" role="menu">' +
        '<div class="rwgps-stats-chart-settings-title">Chart colors</div>';
    for (const opt of OPTIONS) {
      menu +=
        '<button class="rwgps-stats-chart-settings-option" type="button" data-palette="' + opt.key + '" role="menuitemradio">' +
          '<span class="rwgps-stats-chart-settings-swatch" style="background:' + STATS_PALETTES[opt.key].swatch + '"></span>' +
          opt.label +
        '</button>';
    }
    menu += '</div>';
    settings.innerHTML = menu;

    function setActiveOption(key) {
      const opts = settings.querySelectorAll(".rwgps-stats-chart-settings-option");
      for (let i = 0; i < opts.length; i++) {
        const active = opts[i].getAttribute("data-palette") === key;
        opts[i].setAttribute("data-active", active ? "true" : "false");
        opts[i].setAttribute("aria-checked", active ? "true" : "false");
      }
    }
    setActiveOption(statsPaletteKey);

    // Don't let hovering the gear drive the chart's bar tooltip.
    settings.addEventListener("mousemove", function (e) { e.stopPropagation(); });

    settings.addEventListener("click", function (e) {
      if (e.target.closest(".rwgps-stats-chart-settings-option")) return;
      e.stopPropagation();
      settings.classList.toggle("rwgps-stats-chart-settings-open");
    });
    settings.addEventListener("keydown", function (e) {
      if ((e.key === "Enter" || e.key === " ") && e.target === settings) {
        e.preventDefault();
        settings.classList.toggle("rwgps-stats-chart-settings-open");
      } else if (e.key === "Escape") {
        settings.classList.remove("rwgps-stats-chart-settings-open");
      }
    });

    const optionEls = settings.querySelectorAll(".rwgps-stats-chart-settings-option");
    for (let i = 0; i < optionEls.length; i++) {
      optionEls[i].addEventListener("click", function (e) {
        e.stopPropagation();
        const newKey = this.getAttribute("data-palette");
        settings.classList.remove("rwgps-stats-chart-settings-open");
        if (newKey === statsPaletteKey) return;
        statsPaletteKey = newKey;
        browser.storage.local.set({ statsChartPalette: newKey });
        if (lastStatsCtx) {
          renderBarChart(lastStatsCtx.statsCard, lastStatsCtx.barData, lastStatsCtx.activeTab);
        }
      });
    }

    // Outside clicks close the menu. One document listener for the module,
    // added on first use: a per-render listener only unhooked itself on the
    // next click, so re-renders without clicks piled them up.
    if (!buildStatsChartSettings._docBound) {
      buildStatsChartSettings._docBound = true;
      document.addEventListener("click", function (e) {
        document.querySelectorAll(".rwgps-stats-chart-settings-open").forEach(function (el) {
          if (!el.contains(e.target)) el.classList.remove("rwgps-stats-chart-settings-open");
        });
      });
    }

    return settings;
  }

  function removeBarChart() {
    const chart = document.querySelector(".rwgps-stats-chart");
    if (chart) chart.remove();
    const gear = document.querySelector(".rwgps-stats-chart-settings");
    if (gear) gear.remove();
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
    if (!isCurrentStats(tabBar, userId)) return; // page changed meanwhile

    const range = parsePagerDateRange(statsCard, activeTab);
    if (!range) { removeBarChart(); return; }

    // Show loading skeleton immediately for slow fetches (Career)
    renderBarChartLoading(statsCard, activeTab, range);

    const trips = await fetchTripsForRange(userId, range.start, range.end);
    if (gen !== chartGeneration) return; // superseded
    if (!isCurrentStats(tabBar, userId)) return; // navigated away while fetching

    const barData = aggregateBarsForTab(trips, activeTab, range.start, range.end);
    renderBarChart(statsCard, barData, activeTab);
  }

  function renderBarChartLoading(statsCard, activeTab, range) {
    // Build placeholder labels so the user sees the axis immediately
    const metric = window.RE.isMetric();
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
      loading: true,
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

  // ─── Eddington Number (Career tab) ──────────────────────────────────────
  //
  // The Eddington number E is the largest integer such that you have ridden
  // at least E units (miles, or km for metric users) on at least E separate
  // days. It advances exponentially slowly: raising it from 70 to 71 needs
  // another day of 71+ — anything shorter no longer counts. Arthur Eddington's
  // own number was 84.

  let eddingtonObserver = null;
  // Array of tile specs { value, label, title, detail } — cached for re-attach.
  // Holds the Eddington (Distance) and Eddington (Elevation) tiles.
  let eddingtonState = null;

  function computeEddington(dailyDistances) {
    // E = max i such that the i-th largest daily distance is >= i.
    const sorted = dailyDistances.slice().sort((a, b) => b - a);
    let e = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] >= i + 1) e = i + 1;
      else break;
    }
    return e;
  }

  // Survival count N(d): how many days had a total distance >= d. `sortedDesc`
  // is the per-day totals sorted descending, so a binary search finds the first
  // entry below d — its index equals the count of qualifying days.
  function countAtLeast(sortedDesc, d) {
    let lo = 0, hi = sortedDesc.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedDesc[mid] >= d) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // Round milestone distances for the E(N) survival table.
  const EDD_MILES_THRESH = [10, 20, 30, 50, 75, 100, 125, 150, 200, 250, 300];
  const EDD_KM_THRESH = [20, 30, 50, 80, 100, 120, 150, 200, 250, 300];
  // Round milestone elevation gains (per day) for the elevation E(N) table.
  const EDD_FT_THRESH = [500, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000];
  const EDD_M_THRESH = [150, 300, 500, 750, 1000, 1500, 2000, 2500, 3000];

  // Build the "depth" detail behind the headline Eddington number: progress to
  // the next E, how far above the line you sit at E, and the survival counts at
  // a set of milestone values (with the E row marked). `thresholds` is the
  // milestone list and `unitShort` the display unit (mi/km/ft/m).
  function eddingtonDetail(values, thresholds, unitShort) {
    const sorted = values.slice().sort((a, b) => b - a);
    const E = computeEddington(sorted);
    const depthDays = E > 0 ? countAtLeast(sorted, E) : 0;        // N(E)
    const nextNeeded = Math.max(0, (E + 1) - countAtLeast(sorted, E + 1));
    const depthRatio = E > 0 ? depthDays / E : 0;
    const surplus = E > 0 ? depthDays - E : 0;

    const rows = [];
    thresholds.forEach((d) => {
      const days = countAtLeast(sorted, d);
      if (days > 0) rows.push({ dist: d, days, isE: d === E });
    });
    if (E > 0 && !rows.some((r) => r.dist === E)) {
      rows.push({ dist: E, days: depthDays, isE: true });
    }
    rows.sort((a, b) => a.dist - b.dist);

    return {
      E, depthDays, depthRatio, surplus, nextNeeded, rows,
      unitShort: unitShort,
    };
  }

  function findStatTileContainer(atAGlance) {
    // Descend through single-child wrappers to the element that directly holds
    // the repeated stat tiles, so we append our tile as their sibling.
    let node = atAGlance;
    while (
      node.children.length === 1 &&
      node.firstElementChild &&
      node.firstElementChild.children.length > 1
    ) {
      node = node.firstElementChild;
    }
    return node;
  }

  function fillEddingtonTile(tile, value, label) {
    // Rewrite a cloned native tile's text in place. The big number is the
    // leaf with the largest font; the label is the longest remaining leaf.
    // Must run after the tile is in the DOM so getComputedStyle is reliable.
    const leaves = Array.from(tile.querySelectorAll("*")).filter(
      (el) => el.children.length === 0 && el.textContent.trim().length > 0
    );
    if (leaves.length < 1) return false;
    leaves.sort(
      (a, b) =>
        parseFloat(getComputedStyle(b).fontSize || 0) -
        parseFloat(getComputedStyle(a).fontSize || 0)
    );
    leaves[0].textContent = value;
    const rest = leaves.slice(1);
    if (rest.length) {
      rest.sort((a, b) => b.textContent.trim().length - a.textContent.trim().length);
      rest[0].textContent = label;
      for (let i = 1; i < rest.length; i++) rest[i].textContent = "";
    } else {
      const lbl = document.createElement("div");
      lbl.className = "rwgps-streak-metric-label";
      lbl.textContent = label;
      leaves[0].parentElement.appendChild(lbl);
    }
    return true;
  }

  function removeEddingtonStat() {
    document.querySelectorAll(".rwgps-eddington-stat").forEach((t) => t.remove());
    // Restore the native 3-column grid on any container we widened.
    document.querySelectorAll(".rwgps-edd-4col").forEach((c) =>
      c.classList.remove("rwgps-edd-4col")
    );
  }

  // Match a Career grid tile by a substring of its label text.
  function findTileByText(container, needle) {
    for (const child of container.children) {
      if (child.textContent.toLowerCase().includes(needle)) return child;
    }
    return null;
  }

  // Build one Eddington tile from a spec, cloning a native tile for styling and
  // inserting it after `refNode` (or appending if refNode is null).
  function buildEddingtonTile(container, template, spec, refNode) {
    let tile;
    if (template) {
      tile = template.cloneNode(true); // inherit native tile styling
    } else {
      tile = document.createElement("div");
      tile.className = "rwgps-streak-metric";
    }
    tile.classList.add("rwgps-eddington-stat");
    tile.title = spec.title;
    if (refNode && refNode.nextSibling) container.insertBefore(tile, refNode.nextSibling);
    else container.appendChild(tile);

    const filled = template && fillEddingtonTile(tile, spec.value, spec.label);
    if (!filled) {
      tile.innerHTML =
        '<div class="rwgps-streak-value">' + spec.value + "</div>" +
        '<div class="rwgps-streak-metric-label">' + spec.label + "</div>";
    }
    // Append the depth popover AFTER the text fill (fillEddingtonTile rewrites
    // the tile's text leaves and would otherwise clobber the popover's text).
    if (spec.detail) makeTilePopover(tile, spec.detail);
    return tile;
  }

  function attachEddingtonTile(statsCard) {
    if (!eddingtonState || !eddingtonState.length) return;
    const atAGlance = statsCard.querySelector('[class*="AtAGlance"]');
    if (!atAGlance) return;
    const container = findStatTileContainer(atAGlance);
    removeEddingtonStat();

    const natives = Array.from(container.children);
    if (natives.length === 0) return;

    // Compress the native 3-column grid to 4 columns so the tiles wrap into rows
    // of four. With 6 native tiles + 2 Eddington tiles that's two full rows.
    container.classList.add("rwgps-edd-4col");

    // Place each Eddington tile at the end of its row in the 4-column grid:
    // Distance after "Activities" (row 1), Elevation after "Photos Taken"
    // (row 2). Fall back to grid ends if those tiles can't be matched.
    const template = findTileByText(container, "photo") || natives[natives.length - 1];
    const afterActivities = findTileByText(container, "activit") || natives[2] || natives[natives.length - 1];
    const afterPhotos = findTileByText(container, "photo") || natives[natives.length - 1];
    const anchors = [afterActivities, afterPhotos];
    eddingtonState.forEach((spec, i) => {
      buildEddingtonTile(container, template, spec, anchors[i] || null);
    });
  }

  // Build the depth-detail popover: progress to next E, depth factor, and the
  // E(N) survival table (distance -> days) with the E row highlighted.
  function buildEddingtonPopover(detail) {
    const u = detail.unitShort;
    const pop = document.createElement("div");
    pop.className = "rwgps-eddington-popover";

    const head = document.createElement("div");
    head.className = "rwgps-eddington-pop-head";
    head.textContent = (detail.metricLabel ? detail.metricLabel + " — " : "") +
      "Eddington " + detail.E;
    pop.appendChild(head);

    if (detail.E > 0) {
      const next = document.createElement("div");
      next.className = "rwgps-eddington-pop-line";
      next.textContent = detail.nextNeeded > 0
        ? "Next: " + detail.nextNeeded + " more ≥ " + (detail.E + 1) + " " + u +
          (detail.nextNeeded === 1 ? " day" : " days") + " → " + (detail.E + 1)
        : "Ready to tick over to " + (detail.E + 1) + " — go ride!";
      pop.appendChild(next);

      const depth = document.createElement("div");
      depth.className = "rwgps-eddington-pop-line";
      depth.textContent = "Depth: " + detail.depthRatio.toFixed(1) + "× (+" +
        detail.surplus.toLocaleString() + " days past E)";
      pop.appendChild(depth);
    }

    if (detail.rows.length) {
      const table = document.createElement("div");
      table.className = "rwgps-eddington-pop-table";
      detail.rows.forEach((r) => {
        const row = document.createElement("div");
        row.className = "rwgps-eddington-pop-row" + (r.isE ? " rwgps-eddington-row-e" : "");
        const dist = document.createElement("span");
        dist.className = "rwgps-eddington-pop-dist";
        dist.textContent = r.dist + " " + u + (r.isE ? "  ← E" : "");
        const days = document.createElement("span");
        days.className = "rwgps-eddington-pop-days";
        days.textContent = r.days.toLocaleString() + (r.days === 1 ? " day" : " days");
        row.appendChild(dist);
        row.appendChild(days);
        table.appendChild(row);
      });
      pop.appendChild(table);
    }
    return pop;
  }

  // Hover/focus opens the popover; a click pins it open until an outside click
  // or Escape. The popover stays a child of the tile (so it's removed with the
  // tile on re-render) but uses position:fixed with viewport-clamped coords so
  // no ancestor overflow clips it. The tile is made focusable for keyboard use.
  function makeTilePopover(tile, detail) {
    tile.setAttribute("tabindex", "0");
    tile.setAttribute("role", "button");
    tile.setAttribute("aria-label", "Eddington number details");
    tile.removeAttribute("title"); // the popover replaces the native tooltip

    const pop = buildEddingtonPopover(detail);
    pop.addEventListener("click", (e) => e.stopPropagation());
    tile.appendChild(pop);

    function position() {
      const r = tile.getBoundingClientRect();
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let left = r.left + r.width / 2 - pw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
      let top = r.bottom + 6;
      if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
      pop.style.left = Math.round(left) + "px";
      pop.style.top = Math.round(top) + "px";
    }
    function show() { pop.classList.add("rwgps-eddington-pop-visible"); position(); }
    function hide() { pop.classList.remove("rwgps-eddington-pop-visible"); }
    const pinned = () => tile.classList.contains("rwgps-eddington-pinned");

    tile.addEventListener("mouseenter", () => { if (!pinned()) show(); });
    tile.addEventListener("mouseleave", () => { if (!pinned()) hide(); });
    tile.addEventListener("focus", show);
    tile.addEventListener("blur", () => { tile.classList.remove("rwgps-eddington-pinned"); hide(); });
    tile.addEventListener("click", (e) => {
      e.stopPropagation();
      const willPin = !pinned();
      tile.classList.toggle("rwgps-eddington-pinned", willPin);
      if (willPin) show(); else hide();
    });

    if (!makeTilePopover._docBound) {
      makeTilePopover._docBound = true;
      const closeAll = () => {
        document.querySelectorAll(".rwgps-eddington-pinned")
          .forEach((t) => t.classList.remove("rwgps-eddington-pinned"));
        document.querySelectorAll(".rwgps-eddington-pop-visible")
          .forEach((p) => p.classList.remove("rwgps-eddington-pop-visible"));
      };
      document.addEventListener("click", closeAll);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
    }
  }

  async function injectEddingtonStat(tabBar, userId) {
    const statsCard = tabBar.closest('[class*="Card"], [class*="card"]');
    if (!statsCard) return;
    if (detectActiveTab(tabBar) !== "career") { removeEddingtonStat(); return; }

    const metric = window.RE.isMetric();
    const distDivisor = metric ? 1000 : 1609.34;
    const eleDivisor = metric ? 1 : 3.28084;
    const distUnitWord = metric ? "km" : "miles";
    const eleUnitWord = metric ? "meters" : "feet";
    const distUnitShort = metric ? "km" : "mi";
    const eleUnitShort = metric ? "m" : "ft";

    const today = toDateString(new Date());
    const trips = await fetchTripsForRange(userId, null, today); // full history
    // Navigated to another page/profile while fetching: don't paint this
    // user's numbers onto it (or overwrite the newer page's state).
    if (!isCurrentStats(tabBar, userId)) return;

    // Sum each day's distance and elevation gain (in display units), then take
    // the Eddington of the per-day totals — matching "E units on E days".
    const dayDist = new Map();
    const dayEle = new Map();
    for (const trip of trips) {
      const day = tripDate(trip);
      if (!day) continue;
      dayDist.set(day, (dayDist.get(day) || 0) + tripDistance(trip) / distDivisor);
      const ele = (trip.elevationGain || trip.elevation_gain || 0) / eleDivisor;
      dayEle.set(day, (dayEle.get(day) || 0) + ele);
    }

    const distDetail = eddingtonDetail(
      Array.from(dayDist.values()),
      metric ? EDD_KM_THRESH : EDD_MILES_THRESH,
      distUnitShort
    );
    distDetail.metricLabel = "Distance";
    const eleDetail = eddingtonDetail(
      Array.from(dayEle.values()),
      metric ? EDD_M_THRESH : EDD_FT_THRESH,
      eleUnitShort
    );
    eleDetail.metricLabel = "Elevation";

    eddingtonState = [
      {
        value: String(distDetail.E),
        label: "Eddington (Distance)",
        title:
          "The largest number E such that you've ridden at least E " +
          distUnitWord +
          " on at least E separate days. Arthur Eddington's own number was 84.",
        detail: distDetail,
      },
      {
        value: String(eleDetail.E),
        label: "Eddington (Elevation)",
        title:
          "The largest number E such that you've climbed at least E " +
          eleUnitWord +
          " on at least E separate days.",
        detail: eleDetail,
      },
    ];

    if (detectActiveTab(tabBar) !== "career") { removeEddingtonStat(); return; }
    attachEddingtonTile(statsCard);
  }

  function startEddingtonObserver(tabBar) {
    stopEddingtonObserver();
    const statsCard = tabBar.closest('[class*="Card"], [class*="card"]');
    if (!statsCard) return;
    // React re-renders the native stats grid (e.g. when the Career tab paints
    // its numbers). Re-attach our tile if it's wiped while Career is active.
    eddingtonObserver = new MutationObserver(() => {
      if (!eddingtonState) return;
      if (detectActiveTab(tabBar) !== "career") return;
      if (document.querySelector(".rwgps-eddington-stat")) return;
      attachEddingtonTile(statsCard);
    });
    eddingtonObserver.observe(statsCard, { childList: true, subtree: true });
  }

  function stopEddingtonObserver() {
    if (eddingtonObserver) { eddingtonObserver.disconnect(); eddingtonObserver = null; }
    eddingtonState = null;
  }

  function wireEddingtonToTabs(tabBar, userId) {
    // Stable handler: re-wiring a tab is a no-op (see onTabEddington).
    tabBar.querySelectorAll("a").forEach((tab) => {
      tab.addEventListener("click", onTabEddington);
    });
    startEddingtonObserver(tabBar);
    // Career may already be the active tab (e.g. returning via SPA nav).
    if (detectActiveTab(tabBar) === "career") {
      setTimeout(() => injectEddingtonStat(tabBar, userId), 250);
    }
  }

  function wireChartToTabs(tabBar, userId) {
    // Listen for clicks on all tabs (including streak). Stable handler, so
    // re-wiring a tab is a no-op (see onTabUpdateChart).
    tabBar.querySelectorAll("a").forEach((tab) => {
      tab.addEventListener("click", onTabUpdateChart);
    });

    // Start pager observer for arrow navigation
    startChartPagerObserver(tabBar, userId);

    // Initial chart render
    updateChart(tabBar, userId);
  }
})();
