(function () {
  "use strict";

  var R = window.RE;
  var API_KEY = "32b6e135";
  var TRIP_CACHE_MAX_AGE = 60 * 60 * 1000; // 1 hour

  var lastCalendarKey = null;
  var calendarSetupDone = false;
  var calendarObserver = null;
  var streakDayNumbers = null; // Map<dateStr, dayNumber>
  var debounceTimer = null;
  var lastMonthHeader = null;

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

  function getCurrentUserId() {
    return document.documentElement.getAttribute("data-rwgps-user-id") || null;
  }

  function rwgpsFetch(path) {
    return fetch("https://ridewithgps.com" + path, {
      credentials: "same-origin",
      headers: {
        "x-rwgps-api-key": API_KEY,
        "x-rwgps-api-version": "3",
        "Accept": "application/json"
      }
    }).then(function (resp) {
      if (!resp.ok) return null;
      return resp.json();
    });
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
        return rwgpsFetch("/trips.json?" + params).then(function (data) {
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
      var dayNum = parseInt(dateLabel.textContent.trim(), 10);
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
          // Month changed — re-discover cells and re-apply highlights
          lastMonthHeader = currentHeader;
          highlightStreak();
        } else {
          // React re-render may have removed highlights
          var existing = document.querySelector(".rwgps-calendar-streak-highlight");
          if (!existing) {
            highlightStreak();
          }
        }
      }, 300);
    });

    calendarObserver.observe(container, { childList: true, subtree: true });
  }

  // ─── Page Check ───────────────────────────────────────────────────

  async function checkPage() {
    var settings = await browser.storage.local.get({ calendarStreakEnabled: true });
    if (!settings.calendarStreakEnabled) {
      cleanup();
      return;
    }

    var isCalendar = location.pathname === "/calendar" || location.pathname.startsWith("/calendar/");
    if (!isCalendar) {
      cleanup();
      return;
    }

    var userId = getCurrentUserId();
    if (!userId) return;

    var pageKey = location.pathname + ":" + userId;

    // Already set up for this page
    if (pageKey === lastCalendarKey && calendarSetupDone) {
      return;
    }

    lastCalendarKey = pageKey;
    calendarSetupDone = true;

    // Wait for the calendar grid to appear
    var calendarGrid = await R.waitForElement("table, [class*='calendar'], [class*='Calendar']", 10000);
    if (!calendarGrid) return;

    // Recheck we're still on the calendar page
    if (!location.pathname.startsWith("/calendar")) return;

    // Compute streak days if not cached
    if (!streakDayNumbers) {
      streakDayNumbers = await computeStreakDays(userId);
    }

    highlightStreak();
    watchForMonthChange(calendarGrid);
  }

  function cleanup() {
    clearHighlights();
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
  }

})();
