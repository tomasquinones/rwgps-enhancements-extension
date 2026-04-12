(function (R) {
  "use strict";

  var TOOL_EVENT_OPEN = "rwgps-extension-quick-laps-open";
  var TOOL_EVENT_LINE_SET = "rwgps-quick-laps-line-set";
  var TOOL_EVENT_LINE_CLEARED = "rwgps-quick-laps-line-cleared";
  var TOOL_EVENT_DRAW_STAGE = "rwgps-quick-laps-draw-stage";
  var TOOL_EVENT_DRAW_START = "rwgps-quick-laps-draw-start";
  var TOOL_EVENT_CLEAR = "rwgps-quick-laps-clear";

  var TOOL_PANEL_CLASS = "rwgps-quick-laps-panel";
  var DEBUG = true;

  var toolPanel = null;
  var lastTripPageKey = null;
  var lineEndpoints = null;
  var lastLaps = [];

  function log(level, message, extra) {
    if (!DEBUG || !window.console) return;
    var prefix = "[RWGPS Extension][Quick Laps Tool] ";
    if (level === "warn" && console.warn) {
      if (typeof extra !== "undefined") console.warn(prefix + message, extra);
      else console.warn(prefix + message);
      return;
    }
    if (level === "error" && console.error) {
      if (typeof extra !== "undefined") console.error(prefix + message, extra);
      else console.error(prefix + message);
      return;
    }
    if (console.info) {
      if (typeof extra !== "undefined") console.info(prefix + message, extra);
      else console.info(prefix + message);
    }
  }

  function getTripPageInfo() {
    if (!R.getPageInfo) return null;
    var pageInfo = R.getPageInfo();
    if (!pageInfo || pageInfo.type !== "trip") return null;
    return pageInfo;
  }

  function clearChildNodes(el) {
    if (!el) return;
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "--";
    var total = Math.round(seconds);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return m + ":" + String(s).padStart(2, "0");
  }

  function formatDistanceMeters(meters) {
    if (!Number.isFinite(meters) || meters < 0) return "--";
    var miles = meters / 1609.34;
    return miles.toFixed(2) + " mi";
  }

  function formatElevationMeters(meters) {
    if (!Number.isFinite(meters)) return "--";
    var feet = meters / 0.3048;
    return Math.round(feet) + " ft";
  }

  function createPanel() {
    var panel = document.createElement("div");
    panel.className = TOOL_PANEL_CLASS;
    panel.style.display = "none";

    var header = document.createElement("div");
    header.className = "rwgps-quick-laps-header";

    var title = document.createElement("div");
    title.className = "rwgps-quick-laps-title";
    title.textContent = "Quick Laps";

    var closeBtn = document.createElement("button");
    closeBtn.className = "rwgps-quick-laps-close";
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.title = "Close Quick Laps";
    closeBtn.addEventListener("click", function () {
      hidePanel();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    var status = document.createElement("div");
    status.className = "rwgps-quick-laps-status";
    status.textContent = "Click Draw Finish Line, then click two points on the map.";

    var actions = document.createElement("div");
    actions.className = "rwgps-quick-laps-actions";

    var drawBtn = document.createElement("button");
    drawBtn.className = "rwgps-quick-laps-btn";
    drawBtn.type = "button";
    drawBtn.textContent = "Draw Finish Line";
    drawBtn.addEventListener("click", function () {
      startDrawMode();
    });

    var clearBtn = document.createElement("button");
    clearBtn.className = "rwgps-quick-laps-btn rwgps-quick-laps-btn-secondary";
    clearBtn.type = "button";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", function () {
      clearQuickLaps();
    });

    actions.appendChild(drawBtn);
    actions.appendChild(clearBtn);

    var body = document.createElement("div");
    body.className = "rwgps-quick-laps-body";

    var list = document.createElement("div");
    list.className = "rwgps-quick-laps-list";
    body.appendChild(list);

    panel.appendChild(header);
    panel.appendChild(status);
    panel.appendChild(actions);
    panel.appendChild(body);
    document.body.appendChild(panel);

    return panel;
  }

  function ensurePanel() {
    if (toolPanel && toolPanel.isConnected) return toolPanel;
    toolPanel = createPanel();
    return toolPanel;
  }

  function showPanel() {
    var panel = ensurePanel();
    panel.style.display = "";
  }

  function hidePanel() {
    if (toolPanel && toolPanel.isConnected) {
      toolPanel.style.display = "none";
    }
  }

  function setStatus(text) {
    var panel = ensurePanel();
    var el = panel.querySelector(".rwgps-quick-laps-status");
    if (!el) return;
    el.textContent = text;
  }

  function renderLaps(laps) {
    var panel = ensurePanel();
    var list = panel.querySelector(".rwgps-quick-laps-list");
    if (!list) return;
    clearChildNodes(list);

    if (!laps || laps.length === 0) {
      var empty = document.createElement("div");
      empty.className = "rwgps-quick-laps-empty";
      empty.textContent = "No laps detected yet.";
      list.appendChild(empty);
      return;
    }

    for (var i = 0; i < laps.length; i++) {
      var lap = laps[i];
      var row = document.createElement("div");
      row.className = "rwgps-quick-laps-row";

      var line1 = document.createElement("div");
      line1.className = "rwgps-quick-laps-row-main";
      line1.textContent = "Lap " + lap.lapNumber + " - " + formatDuration(lap.durationSec);

      var line2 = document.createElement("div");
      line2.className = "rwgps-quick-laps-row-sub";
      line2.textContent =
        formatDistanceMeters(lap.distanceMeters) +
        " • +" + formatElevationMeters(lap.eleGainMeters) +
        " / -" + formatElevationMeters(lap.eleLossMeters);

      row.appendChild(line1);
      row.appendChild(line2);
      list.appendChild(row);
    }
  }

  function cross2d(ax, ay, bx, by) {
    return ax * by - ay * bx;
  }

  function segmentIntersection(segA0, segA1, segB0, segB1) {
    var rX = segA1.lng - segA0.lng;
    var rY = segA1.lat - segA0.lat;
    var sX = segB1.lng - segB0.lng;
    var sY = segB1.lat - segB0.lat;
    var denom = cross2d(rX, rY, sX, sY);

    if (Math.abs(denom) < 1e-12) return null;

    var qpX = segB0.lng - segA0.lng;
    var qpY = segB0.lat - segA0.lat;
    var t = cross2d(qpX, qpY, sX, sY) / denom;
    var u = cross2d(qpX, qpY, rX, rY) / denom;

    if (t < 0 || t > 1 || u < 0 || u > 1) return null;

    return {
      t: t,
      u: u,
      lng: segA0.lng + rX * t,
      lat: segA0.lat + rY * t
    };
  }

  function interpolate(a, b, t) {
    return a + (b - a) * t;
  }

  function detectCrossings(trackPoints, pt0, pt1) {
    var crossings = [];
    if (!trackPoints || trackPoints.length < 2) return crossings;

    for (var i = 0; i < trackPoints.length - 1; i++) {
      var p0 = trackPoints[i];
      var p1 = trackPoints[i + 1];
      var hit = segmentIntersection(
        { lng: p0.lng, lat: p0.lat },
        { lng: p1.lng, lat: p1.lat },
        pt0,
        pt1
      );
      if (!hit) continue;

      crossings.push({
        i: i,
        t: hit.t,
        trackPos: i + hit.t,
        distance: interpolate(p0.distance || 0, p1.distance || 0, hit.t),
        time: interpolate(p0.time || 0, p1.time || 0, hit.t),
        ele: interpolate(p0.ele || 0, p1.ele || 0, hit.t),
        lng: hit.lng,
        lat: hit.lat
      });
    }

    crossings.sort(function (a, b) { return a.trackPos - b.trackPos; });

    var deduped = [];
    for (var ci = 0; ci < crossings.length; ci++) {
      var c = crossings[ci];
      var prev = deduped.length ? deduped[deduped.length - 1] : null;
      if (prev && Math.abs(prev.trackPos - c.trackPos) < 0.001) continue;
      deduped.push(c);
    }

    return deduped;
  }

  function computeElevationChangeBetween(trackPoints, startCrossing, endCrossing) {
    var prevEle = startCrossing.ele;
    var gain = 0;
    var loss = 0;

    var startIndex = Math.floor(startCrossing.trackPos) + 1;
    var endIndex = Math.floor(endCrossing.trackPos);

    for (var i = startIndex; i <= endIndex; i++) {
      var p = trackPoints[i];
      if (!p) continue;
      var delta = (p.ele || 0) - prevEle;
      if (delta > 0) gain += delta;
      else loss += -delta;
      prevEle = p.ele || 0;
    }

    var finalDelta = endCrossing.ele - prevEle;
    if (finalDelta > 0) gain += finalDelta;
    else loss += -finalDelta;

    return {
      gain: gain,
      loss: loss
    };
  }

  function buildLapsFromCrossings(trackPoints, crossings) {
    var laps = [];
    if (!crossings || crossings.length < 2) return laps;

    for (var i = 1; i < crossings.length; i++) {
      var start = crossings[i - 1];
      var end = crossings[i];
      if ((end.trackPos - start.trackPos) < 0.001) continue;

      var elev = computeElevationChangeBetween(trackPoints, start, end);
      var duration = end.time - start.time;
      var distance = end.distance - start.distance;

      laps.push({
        lapNumber: laps.length + 1,
        startIndex: Math.floor(start.trackPos),
        endIndex: Math.ceil(end.trackPos),
        durationSec: duration > 0 ? duration : 0,
        distanceMeters: distance > 0 ? distance : 0,
        eleGainMeters: elev.gain,
        eleLossMeters: elev.loss
      });
    }

    laps.sort(function (a, b) {
      return (a.durationSec || Infinity) - (b.durationSec || Infinity);
    });
    for (var li = 0; li < laps.length; li++) {
      laps[li].rank = li + 1;
    }

    laps.sort(function (a, b) {
      return a.lapNumber - b.lapNumber;
    });

    return laps;
  }

  async function getTripTrackPoints(tripId) {
    if (!tripId) return [];
    var pageInfo = getTripPageInfo();
    if (R.cachedTrackPoints && pageInfo && String(pageInfo.id) === String(tripId)) {
      return R.cachedTrackPoints;
    }

    if (!R.fetchTrackPoints) return [];
    var points = await R.fetchTrackPoints("trip", tripId);
    if (points && points.length > 0) {
      R.cachedTrackPoints = points;
      return points;
    }
    return [];
  }

  async function calculateAndRenderLaps(endpoints) {
    var tripInfo = getTripPageInfo();
    if (!tripInfo) return;

    var points = await getTripTrackPoints(tripInfo.id);
    if (!points || points.length < 2) {
      setStatus("Unable to load track points for this trip.");
      renderLaps([]);
      return;
    }

    var crossings = detectCrossings(points, endpoints.pt0, endpoints.pt1);
    log("info", "Crossings detected", { count: crossings.length });
    if (crossings.length < 2) {
      setStatus("Finish line drawn. Not enough crossings to build laps.");
      renderLaps([]);
      lastLaps = [];
      return;
    }

    var laps = buildLapsFromCrossings(points, crossings);
    lastLaps = laps;
    setStatus("Detected " + laps.length + " lap" + (laps.length === 1 ? "" : "s") + ".");
    renderLaps(laps);
  }

  function startDrawMode() {
    setStatus("Click first finish-line point on the map.");
    document.dispatchEvent(new CustomEvent(TOOL_EVENT_DRAW_START));
    log("info", "Requested draw mode start");
  }

  function clearQuickLaps() {
    lineEndpoints = null;
    lastLaps = [];
    setStatus("Cleared. Click Draw Finish Line to start again.");
    renderLaps([]);
    document.dispatchEvent(new CustomEvent(TOOL_EVENT_CLEAR));
    log("info", "Requested quick laps clear");
  }

  async function openQuickLapsTool(detail) {
    var tripInfo = getTripPageInfo();
    if (!tripInfo) return;
    showPanel();
    log("info", "Opening quick laps tool", detail || {});

    if (lineEndpoints) {
      await calculateAndRenderLaps(lineEndpoints);
      return;
    }
    startDrawMode();
  }

  function onLineSet(e) {
    var payload = null;
    try {
      payload = e && e.detail ? JSON.parse(e.detail) : null;
    } catch (err) {
      payload = null;
    }
    if (!payload || !payload.pt0 || !payload.pt1) return;

    lineEndpoints = {
      pt0: payload.pt0,
      pt1: payload.pt1
    };
    setStatus("Finish line set. Calculating laps...");
    log("info", "Received finish line endpoints", lineEndpoints);
    calculateAndRenderLaps(lineEndpoints);
  }

  function onLineCleared() {
    lineEndpoints = null;
    lastLaps = [];
    setStatus("Finish line cleared.");
    renderLaps([]);
    log("info", "Received line cleared from page bridge");
  }

  function onDrawStage(e) {
    var payload = null;
    try {
      payload = e && e.detail ? JSON.parse(e.detail) : null;
    } catch (err) {
      payload = null;
    }
    if (!payload || !payload.stage) return;
    if (payload.stage === "start-set") {
      setStatus("Click second finish-line point to complete the line.");
    } else if (payload.stage === "map-missing") {
      setStatus("Map not available yet. Try again in a second.");
    }
  }

  function resetForPageChange() {
    lineEndpoints = null;
    lastLaps = [];
    if (toolPanel && toolPanel.isConnected) {
      hidePanel();
      renderLaps([]);
      setStatus("Click Draw Finish Line, then click two points on the map.");
    }
    document.dispatchEvent(new CustomEvent(TOOL_EVENT_CLEAR));
  }

  function monitorTripPage() {
    var info = getTripPageInfo();
    var pageKey = info ? ("trip:" + info.id) : null;
    if (!pageKey && lastTripPageKey) {
      resetForPageChange();
      lastTripPageKey = null;
      return;
    }
    if (pageKey && lastTripPageKey && pageKey !== lastTripPageKey) {
      resetForPageChange();
    }
    lastTripPageKey = pageKey;
  }

  R.openQuickLapsTool = openQuickLapsTool;
  R.clearQuickLapsTool = clearQuickLaps;

  document.addEventListener(TOOL_EVENT_OPEN, function (e) {
    var detail = null;
    try {
      detail = e && e.detail ? JSON.parse(e.detail) : null;
    } catch (err) {
      detail = null;
    }
    openQuickLapsTool(detail);
  });
  document.addEventListener(TOOL_EVENT_LINE_SET, onLineSet);
  document.addEventListener(TOOL_EVENT_LINE_CLEARED, onLineCleared);
  document.addEventListener(TOOL_EVENT_DRAW_STAGE, onDrawStage);

  setInterval(monitorTripPage, 1000);
})(window.RE);
