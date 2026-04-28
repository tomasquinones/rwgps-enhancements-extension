(function (R) {
  "use strict";

  // ─── Sample Time Tooltip ────────────────────────────────────────────────
  // Adds a local-time line (HH:MM:SS, locale-aware) to RWGPS's native
  // elevation-graph hover tooltip (.sg-hover-details) on trip pages.
  // Independent of the Daylight feature.

  var sampleTimeCanvas = null;
  var sampleTimeMoveHandler = null;
  var sampleTimeObserver = null;
  var sampleTimeLastStr = null;

  function findTripGraphCanvas() {
    var candidates = document.querySelectorAll('[class*="SampleGraph"]');
    for (var ci = 0; ci < candidates.length; ci++) {
      var c = candidates[ci].querySelector("canvas:not(.rwgps-daylight-overlay):not(.rwgps-climb-elevation-overlay):not(.rwgps-descent-elevation-overlay):not(.rwgps-weather-overlay)");
      if (c) return c;
    }
    return null;
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

  function injectTimeIntoTooltip(timeStr) {
    var details = document.querySelector(".sg-hover-details");
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
    // Reuse Daylight's cache when both are active to avoid double work.
    if (R.cachedDaylightTimes && R.cachedDaylightTimes.length > 0) return R.cachedDaylightTimes;
    return R.cachedSampleTimes || null;
  }

  function updateTooltipFromCursor(cssX) {
    var times = getTimes();
    if (!times || times.length === 0) return;
    var layout = R.getGraphLayout && R.getGraphLayout();
    var xProj = layout && layout.xProjection;
    if (!xProj || !xProj.vScale) return;
    var distance = (cssX - xProj.pixelOffset) / xProj.vScale + xProj.v0;
    var idx = nearestTrackPointIndex(distance);
    if (idx < 0 || idx >= times.length) return;
    var timeStr = formatLocalTime(times[idx]);
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
      if (!R.sampleTimeActive || !sampleTimeLastStr) return;
      var details = bottomPanel.querySelector(".sg-hover-details");
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

})(window.RE);
