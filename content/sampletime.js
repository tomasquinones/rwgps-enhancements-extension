(function (R) {
  "use strict";

  // ─── Sample Time / ET Sample Time Tooltips ──────────────────────────────
  // Two related features that add a time line to RWGPS's native
  // elevation-graph hover tooltip (.sg-hover-details):
  //   - Sample Time (trips): the recorded local time at the sample,
  //     HH:MM:SS, locale-aware.
  //   - ET Sample Time (routes): estimated elapsed time from the start
  //     ("ET h:mm") computed from the user's grade-vs-speed profile.
  // They are page-type exclusive and share the canvas/tooltip plumbing.

  var sampleTimeCanvas = null;
  var sampleTimeMoveHandler = null;
  var sampleTimeObserver = null;
  var sampleTimeLastStr = null;

  function findTripGraphCanvas() {
    // Prefer the shared, well-tested finder (handles trip / route /
    // planner via React-fiber heuristics). Fall back to a narrower
    // selector for older code paths that pre-date that helper.
    if (typeof R.findSampleGraphCanvas === "function") {
      var found = R.findSampleGraphCanvas();
      if (found && found.canvas) return found.canvas;
    }
    var candidates = document.querySelectorAll('[class*="SampleGraph"], [class*="sampleGraph"]');
    for (var ci = 0; ci < candidates.length; ci++) {
      var c = candidates[ci].querySelector("canvas:not(.rwgps-daylight-overlay):not(.rwgps-climb-elevation-overlay):not(.rwgps-descent-elevation-overlay):not(.rwgps-weather-overlay)");
      if (c) return c;
    }
    return null;
  }

  function findHoverDetailsEl(root) {
    // Trip/route pages: .sg-hover-details (legacy stylesheet).
    // Planner pages: [class*="sgMetricsDisplay"] (CSS modules).
    var scope = root || document;
    return scope.querySelector(".sg-hover-details")
        || scope.querySelector('[class*="sgMetricsDisplay"]');
  }

  function nearestTrackPointIndex(distance) {
    var points = R.cachedTrackPoints;
    if (!points || points.length === 0) return -1;
    var lo = 0, hi = points.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (points[mid].distance < distance) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(points[lo - 1].distance - distance) < Math.abs(points[lo].distance - distance)) {
      return lo - 1;
    }
    return lo;
  }

  function formatLocalTime(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return null;
    if (date.getFullYear() < 2000) return null;
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }

  function formatElapsedTime(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return null;
    var totalSec = Math.floor(date.getTime() / 1000);
    if (totalSec < 0) return null;
    var hours = Math.floor(totalSec / 3600);
    var minutes = Math.floor((totalSec % 3600) / 60);
    return "ET " + hours + ":" + (minutes < 10 ? "0" : "") + minutes;
  }

  function injectTimeIntoTooltip(timeStr) {
    var details = findHoverDetailsEl();
    if (!details) return;
    var line = details.querySelector(".rwgps-sample-time-label");
    if (!line) {
      line = document.createElement("div");
      line.className = "rwgps-sample-time-label";
      details.appendChild(line);
    }
    if (line.textContent !== timeStr) line.textContent = timeStr;
  }

  function getTimes() {
    // For trip Sample Time, reuse Daylight's cache when both are active
    // to avoid double work — both produce absolute clock times. ET
    // Sample Time on routes wants ELAPSED time so it keeps its own.
    if (!R.etSampleTimeActive && R.cachedDaylightTimes && R.cachedDaylightTimes.length > 0) {
      return R.cachedDaylightTimes;
    }
    return R.cachedSampleTimes || null;
  }

  // Best-effort xProjection when getGraphLayout (React fiber traversal)
  // returns nothing — happens on the planner's InteractiveSampleGraph,
  // whose React state isn't structured the same way as the trip's
  // SampleGraph. Assumes the plot fills the canvas width with no
  // horizontal padding; close enough for ET-at-cursor purposes.
  function fallbackXProjection(canvas) {
    if (!canvas || !R.cachedTrackPoints || R.cachedTrackPoints.length < 2) return null;
    var maxDist = R.cachedTrackPoints[R.cachedTrackPoints.length - 1].distance;
    if (!maxDist || maxDist <= 0) return null;
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return null;
    return { pixelOffset: 0, v0: 0, vScale: rect.width / maxDist };
  }

  function updateTooltipFromCursor(cssX) {
    var times = getTimes();
    if (!times || times.length === 0) return;
    var layout = R.getGraphLayout && R.getGraphLayout();
    var xProj = layout && layout.xProjection;
    if (!xProj || !xProj.vScale) {
      xProj = fallbackXProjection(sampleTimeCanvas);
      if (!xProj) return;
    }
    var distance = (cssX - xProj.pixelOffset) / xProj.vScale + xProj.v0;
    var idx = nearestTrackPointIndex(distance);
    if (idx < 0 || idx >= times.length) return;
    var timeStr = R.etSampleTimeActive
      ? formatElapsedTime(times[idx])
      : formatLocalTime(times[idx]);
    if (!timeStr) return;
    sampleTimeLastStr = timeStr;
    injectTimeIntoTooltip(timeStr);
  }

  function startSampleTimeTooltip() {
    stopSampleTimeTooltip();

    var canvas = findTripGraphCanvas();
    if (!canvas) return;
    sampleTimeCanvas = canvas;

    sampleTimeMoveHandler = function (e) {
      var rect = canvas.getBoundingClientRect();
      var cssX = e.clientX - rect.left;
      if (cssX < 0 || cssX > rect.width) return;
      updateTooltipFromCursor(cssX);
    };
    canvas.addEventListener("mousemove", sampleTimeMoveHandler);
    var parent = canvas.parentElement;
    if (parent) parent.addEventListener("mousemove", sampleTimeMoveHandler);

    var bottomPanel = canvas.closest('[class*="BottomPanel"]') || canvas.parentElement || document.body;
    sampleTimeObserver = new MutationObserver(function () {
      if ((!R.sampleTimeActive && !R.etSampleTimeActive) || !sampleTimeLastStr) return;
      var details = findHoverDetailsEl(bottomPanel) || findHoverDetailsEl();
      if (!details) return;
      if (details.querySelector(".rwgps-sample-time-label")) return;
      injectTimeIntoTooltip(sampleTimeLastStr);
    });
    sampleTimeObserver.observe(bottomPanel, { childList: true, subtree: true });
  }

  function stopSampleTimeTooltip() {
    if (sampleTimeMoveHandler && sampleTimeCanvas) {
      sampleTimeCanvas.removeEventListener("mousemove", sampleTimeMoveHandler);
      var parent = sampleTimeCanvas.parentElement;
      if (parent) parent.removeEventListener("mousemove", sampleTimeMoveHandler);
    }
    sampleTimeMoveHandler = null;
    sampleTimeCanvas = null;
    if (sampleTimeObserver) {
      sampleTimeObserver.disconnect();
      sampleTimeObserver = null;
    }
    sampleTimeLastStr = null;
    var line = document.querySelector(".rwgps-sample-time-label");
    if (line) line.remove();
  }

  // ─── Toggle ─────────────────────────────────────────────────────────────

  R.toggleSampleTime = async function () {
    R.sampleTimeActive = !R.sampleTimeActive;
    if (R.sampleTimeActive) {
      await R.enableSampleTime();
    } else {
      R.disableSampleTime();
    }
  };

  R.enableSampleTime = async function () {
    var pageInfo = R.getPageInfo();
    if (!pageInfo || pageInfo.type !== "trip") return;

    if (!R.cachedTrackPoints) {
      R.cachedTrackPoints = await R.fetchTrackPoints(pageInfo.type, pageInfo.id);
      if (!R.cachedTrackPoints || R.cachedTrackPoints.length === 0) return;
    }

    if (!R.cachedSampleTimes || R.cachedSampleTimes.length !== R.cachedTrackPoints.length) {
      R.cachedSampleTimes = R.computeTimeAtPoints(R.cachedTrackPoints, "trip", null);
      if (!R.cachedSampleTimes[0] || isNaN(R.cachedSampleTimes[0].getTime()) ||
          R.cachedSampleTimes[0].getFullYear() < 2000) {
        if (R.cachedDepartedAt) {
          R.cachedSampleTimes = R.computeTimeAtPoints(R.cachedTrackPoints, "route", R.cachedDepartedAt, R.getUserSummary());
        }
      }
    }

    R.retryOverlayRender("sampleTimeActive", function () {
      return findTripGraphCanvas();
    }, function () {
      startSampleTimeTooltip();
    });
  };

  R.disableSampleTime = function () {
    stopSampleTimeTooltip();
    R.cachedSampleTimes = null;
  };

  R.toggleEtSampleTime = async function () {
    R.etSampleTimeActive = !R.etSampleTimeActive;
    if (R.etSampleTimeActive) {
      await R.enableEtSampleTime();
    } else {
      R.disableEtSampleTime();
    }
  };

  R.enableEtSampleTime = async function () {
    var pageInfo = R.getPageInfo();
    if (!pageInfo || pageInfo.type !== "route") return;

    if (!R.cachedTrackPoints || R.cachedTrackPoints.length < 2) {
      if (pageInfo.id) {
        R.cachedTrackPoints = await R.fetchTrackPoints(pageInfo.type, pageInfo.id);
      } else if (pageInfo.isPlanner) {
        // No route id yet (creating new) — ask page-bridge to extract
        // the current in-planner route from the map. Give the extract
        // event time to flow through the bridge → planner-route-update
        // → cachedTrackPoints chain.
        document.dispatchEvent(new CustomEvent("rwgps-planner-route-extract"));
        await new Promise(function (r) { setTimeout(r, 150); });
      }
      if (!R.cachedTrackPoints || R.cachedTrackPoints.length < 2) return;
    }

    if (!R.cachedSampleTimes || R.cachedSampleTimes.length !== R.cachedTrackPoints.length) {
      R.cachedSampleTimes = R.computeTimeAtPoints(R.cachedTrackPoints, "route", new Date(0), R.getUserSummary());
    }

    R.retryOverlayRender("etSampleTimeActive", function () {
      return findTripGraphCanvas();
    }, function () {
      startSampleTimeTooltip();
    });
  };

  R.disableEtSampleTime = function () {
    stopSampleTimeTooltip();
    R.cachedSampleTimes = null;
  };

})(window.RE);
