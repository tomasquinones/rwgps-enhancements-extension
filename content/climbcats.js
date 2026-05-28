(function (R) {
  "use strict";

  // ─── Tour de France Climb Categories ──────────────────────────────────
  //
  // Categorizes detected ascents using a scoring formula common in pro
  // cycling: score = length_km × (avg_gradient%)². A climb must meet both
  // the score threshold and minimum elevation gain for its category.

  var CATEGORIES = [
    { label: "HC",    color: "#6A1B9A", minScore: 160, minGain: 1000 },
    { label: "Cat 1", color: "#C62828", minScore: 80,  minGain: 500 },
    { label: "Cat 2", color: "#E65100", minScore: 32,  minGain: 200 },
    { label: "Cat 3", color: "#F9A825", minScore: 16,  minGain: 100 },
    { label: "Cat 4", color: "#2E7D32", minScore: 8,   minGain: 50 },
  ];

  var pollId = null;
  var listeners = null;
  var lastFingerprint = "";
  var tooltipCanvas = null;
  var tooltipMoveHandler = null;
  var tooltipObserver = null;
  var lastHoverClimb = null;
  var cachedCatClimbs = null;

  // ─── Categorization ────────────────────────────────────────────────────

  function categorizeClimb(trackPoints, hill) {
    var startPt = trackPoints[hill.first_i];
    var endPt = trackPoints[hill.last_i];
    var elevGain = endPt.ele - startPt.ele;
    if (elevGain < 50) return null;

    var distMeters = endPt.distance - startPt.distance;
    if (distMeters <= 0) return null;

    var avgGradient = (elevGain / distMeters) * 100;
    var lengthKm = distMeters / 1000;
    var score = lengthKm * avgGradient * avgGradient;

    for (var i = 0; i < CATEGORIES.length; i++) {
      if (score >= CATEGORIES[i].minScore && elevGain >= CATEGORIES[i].minGain) {
        return {
          category: CATEGORIES[i],
          score: score,
          elevGain: elevGain,
          distMeters: distMeters,
          avgGradient: avgGradient,
          startDist: startPt.distance,
          endDist: endPt.distance,
        };
      }
    }
    return null;
  }

  function buildCategorizedClimbs(trackPoints, ascents) {
    var results = [];
    for (var i = 0; i < ascents.length; i++) {
      var cat = categorizeClimb(trackPoints, ascents[i]);
      if (cat) results.push(cat);
    }
    return results;
  }

  function findClimbAtDist(dist, catClimbs) {
    for (var i = 0; i < catClimbs.length; i++) {
      if (dist >= catClimbs[i].startDist && dist <= catClimbs[i].endDist) {
        return catClimbs[i];
      }
    }
    return null;
  }

  // ─── Elevation Graph Overlay ──────────────────────────────────────────

  function createOverlayCanvas(origCanvas, className) {
    var cw = origCanvas.width;
    var ch = origCanvas.height;
    var overlay = document.createElement("canvas");
    overlay.className = className;
    overlay.width = cw;
    overlay.height = ch;
    var cssWidth = origCanvas.style.width || (origCanvas.offsetWidth + "px");
    var cssHeight = origCanvas.style.height || (origCanvas.offsetHeight + "px");
    overlay.style.cssText = "position:absolute;top:0;left:0;width:" +
      cssWidth + ";height:" + cssHeight +
      ";pointer-events:none;z-index:2;";
    var canvasParent = origCanvas.parentElement;
    var parentPos = window.getComputedStyle(canvasParent);
    if (parentPos.position === "static") canvasParent.style.position = "relative";
    canvasParent.appendChild(overlay);
    return overlay;
  }

  function renderOverlay(trackPoints, catClimbs) {
    var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-climbcat-overlay") : null;
    var origCanvas = graph ? graph.canvas : null;
    var graphContainer = graph ? graph.container : null;
    if (!origCanvas || !graphContainer) return null;

    var existing = graphContainer.querySelector(".rwgps-climbcat-overlay");
    if (existing) existing.remove();

    var cw = origCanvas.width;
    var ch = origCanvas.height;
    if (cw === 0 || ch === 0) return null;

    var maxDist = trackPoints[trackPoints.length - 1].distance;
    if (maxDist === 0) return null;

    var tainted = false;
    var origCtx = origCanvas.getContext("2d", { willReadFrequently: true });
    var pixels = null;
    if (origCtx) {
      try {
        pixels = origCtx.getImageData(0, 0, cw, ch).data;
      } catch (e) {
        tainted = true;
      }
    }

    if (pixels) {
      return pixelScanRender(trackPoints, origCanvas, graphContainer, pixels, cw, ch, maxDist, catClimbs);
    } else if (tainted) {
      return projectionRender(trackPoints, origCanvas, graphContainer, cw, ch, maxDist, catClimbs);
    }
    return null;
  }

  function pixelScanRender(trackPoints, origCanvas, graphContainer, pixels, cw, ch, maxDist, catClimbs) {
    function isFilledPixel(px, py) {
      var idx = (py * cw + px) * 4;
      var a = pixels[idx + 3];
      if (a < 30) return false;
      var r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
      return !(r > 240 && g > 240 && b > 240);
    }

    var fillTop = ch, fillBottom = 0, fillLeft = cw, fillRight = 0;
    for (var sy = 0; sy < ch; sy += 2) {
      for (var sx = 0; sx < cw; sx += 2) {
        if (isFilledPixel(sx, sy)) {
          if (sy < fillTop) fillTop = sy;
          if (sy > fillBottom) fillBottom = sy;
          if (sx < fillLeft) fillLeft = sx;
          if (sx > fillRight) fillRight = sx;
        }
      }
    }
    if (fillRight <= fillLeft || fillBottom <= fillTop) return null;

    var plotLeftPx = fillLeft;
    var plotRightPx = fillRight;
    var plotWidthPx = plotRightPx - plotLeftPx;

    var layout = R.getGraphLayout();
    var xProj = layout && layout.xProjection && layout.xProjection.vScale ? layout.xProjection : null;
    var offsetWidth = origCanvas.offsetWidth || origCanvas.clientWidth || (cw / 2);
    var dpr = cw / offsetWidth;

    var overlay = createOverlayCanvas(origCanvas, "rwgps-climbcat-overlay");
    var ctx = overlay.getContext("2d");
    if (!ctx) return overlay;

    ctx.globalAlpha = 0.55;

    for (var cx = plotLeftPx; cx <= plotRightPx; cx++) {
      var dist;
      if (xProj) {
        dist = xProj.v0 + (cx / dpr - xProj.pixelOffset) / xProj.vScale;
      } else {
        dist = ((cx - plotLeftPx) / plotWidthPx) * maxDist;
      }

      var climb = findClimbAtDist(dist, catClimbs);
      if (!climb) continue;

      var bestRunTop = -1, bestRunLen = 0;
      var runTop = -1, runLen = 0;
      for (var cy = 0; cy < ch; cy++) {
        if (isFilledPixel(cx, cy)) {
          if (runTop < 0) runTop = cy;
          runLen++;
        } else {
          if (runLen > bestRunLen) { bestRunTop = runTop; bestRunLen = runLen; }
          runTop = -1; runLen = 0;
        }
      }
      if (runLen > bestRunLen) { bestRunTop = runTop; bestRunLen = runLen; }

      if (bestRunTop >= 0 && bestRunLen > 2) {
        ctx.fillStyle = climb.category.color;
        ctx.fillRect(cx, bestRunTop, 1, bestRunLen);
      }
    }
    return overlay;
  }

  function projectionRender(trackPoints, origCanvas, graphContainer, cw, ch, maxDist, catClimbs) {
    var offsetWidth = origCanvas.offsetWidth || origCanvas.clientWidth || (cw / 2);
    var dpr = cw / offsetWidth;
    var layout = R.getGraphLayout();
    var plotRect = R.getGraphPlotRect ? R.getGraphPlotRect(layout, cw, ch, dpr) : null;

    if (!plotRect) {
      var padLeft = Math.round(45 * dpr);
      var padRight = Math.round(10 * dpr);
      var padTop = Math.round(10 * dpr);
      var padBottom = Math.round(25 * dpr);
      plotRect = { left: padLeft, right: cw - padRight, top: padTop, bottom: ch - padBottom };
    }
    if (plotRect.right <= plotRect.left || plotRect.bottom <= plotRect.top) return null;

    var minEle = Infinity, maxEle = -Infinity;
    for (var i = 0; i < trackPoints.length; i++) {
      if (trackPoints[i].ele < minEle) minEle = trackPoints[i].ele;
      if (trackPoints[i].ele > maxEle) maxEle = trackPoints[i].ele;
    }
    if (!Number.isFinite(minEle) || !Number.isFinite(maxEle)) return null;
    var eleRange = maxEle - minEle;
    if (eleRange < 1) eleRange = 1;
    var elePad = eleRange * 0.05;
    minEle -= elePad;
    maxEle += elePad;

    var overlay = createOverlayCanvas(origCanvas, "rwgps-climbcat-overlay");
    var ctx = overlay.getContext("2d");
    if (!ctx) return overlay;

    ctx.globalAlpha = 0.55;
    var plotLeft = plotRect.left;
    var plotRight = plotRect.right;
    var plotTop = plotRect.top;
    var plotBottom = plotRect.bottom;
    var plotWidth = plotRight - plotLeft;
    var ptIdx = 0;

    for (var cx = plotLeft; cx <= plotRight; cx++) {
      var dist;
      if (layout && layout.xProjection && layout.xProjection.vScale) {
        dist = layout.xProjection.v0 + (cx / dpr - layout.xProjection.pixelOffset) / layout.xProjection.vScale;
      } else {
        dist = ((cx - plotLeft) / plotWidth) * maxDist;
      }
      if (dist < 0 || dist > maxDist) continue;

      var climb = findClimbAtDist(dist, catClimbs);
      if (!climb) continue;

      while (ptIdx < trackPoints.length - 1 && trackPoints[ptIdx + 1].distance < dist) ptIdx++;
      var ele;
      if (ptIdx < trackPoints.length - 1) {
        var d0 = trackPoints[ptIdx].distance;
        var d1 = trackPoints[ptIdx + 1].distance;
        var segLen = d1 - d0;
        if (segLen > 0) {
          var tt = (dist - d0) / segLen;
          ele = trackPoints[ptIdx].ele + tt * (trackPoints[ptIdx + 1].ele - trackPoints[ptIdx].ele);
        } else {
          ele = trackPoints[ptIdx].ele;
        }
      } else {
        ele = trackPoints[ptIdx].ele;
      }

      var yTop = Math.round(R.projectElevationToGraphY(ele, layout, dpr, plotTop, plotBottom, minEle, maxEle));
      if (yTop < plotTop) yTop = plotTop;
      if (yTop >= plotBottom) continue;

      ctx.fillStyle = climb.category.color;
      ctx.fillRect(cx, yTop, 1, plotBottom - yTop);
    }
    return overlay;
  }

  // ─── Overlay Sync ─────────────────────────────────────────────────────

  function scheduleRedraw() {
    if (!R.climbCatsActive || !R.cachedTrackPoints || !cachedCatClimbs) return;
    setTimeout(function () {
      if (!R.climbCatsActive || !R.cachedTrackPoints || !cachedCatClimbs) return;
      renderOverlay(R.cachedTrackPoints, cachedCatClimbs);
      var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-climbcat-overlay") : null;
      if (graph && graph.canvas) lastFingerprint = R.canvasFingerprint(graph.canvas);
    }, 400);
  }

  function startSync() {
    stopSync();
    var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-climbcat-overlay") : null;
    var graphContainer = graph ? graph.container : null;
    var onMouseUp = function () { scheduleRedraw(); };
    if (graphContainer) {
      graphContainer.addEventListener("mouseup", onMouseUp);
      graphContainer.addEventListener("pointerup", onMouseUp);
    }
    var bottomPanel = graphContainer
      ? graphContainer.closest('[class*="BottomPanel"]') || graphContainer.parentElement
      : null;
    if (bottomPanel) bottomPanel.addEventListener("click", onMouseUp);

    listeners = { graphContainer: graphContainer, bottomPanel: bottomPanel, onMouseUp: onMouseUp };

    var origCanvas = graph ? graph.canvas : null;
    if (origCanvas) lastFingerprint = R.canvasFingerprint(origCanvas);

    pollId = setInterval(function () {
      if (!R.climbCatsActive) { stopSync(); return; }
      var g = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-climbcat-overlay") : null;
      var ac = g ? g.canvas : null;
      if (ac && ac !== origCanvas) {
        origCanvas = ac;
        lastFingerprint = "";
        scheduleRedraw();
        return;
      }
      if (!origCanvas || !origCanvas.isConnected) {
        var fg = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-climbcat-overlay") : null;
        if (fg && fg.canvas) origCanvas = fg.canvas;
        if (!origCanvas || !origCanvas.isConnected) return;
        lastFingerprint = "";
      }
      var fp = R.canvasFingerprint(origCanvas);
      if (fp !== lastFingerprint) {
        lastFingerprint = fp;
        scheduleRedraw();
      }
    }, 500);
  }

  function stopSync() {
    if (listeners) {
      if (listeners.graphContainer) {
        listeners.graphContainer.removeEventListener("mouseup", listeners.onMouseUp);
        listeners.graphContainer.removeEventListener("pointerup", listeners.onMouseUp);
      }
      if (listeners.bottomPanel) listeners.bottomPanel.removeEventListener("click", listeners.onMouseUp);
      listeners = null;
    }
    if (pollId) { clearInterval(pollId); pollId = null; }
    lastFingerprint = "";
  }

  function removeOverlay() {
    stopSync();
    var el = document.querySelector(".rwgps-climbcat-overlay");
    if (el) el.remove();
  }

  // ─── Hover Tooltip ────────────────────────────────────────────────────

  function findHoverDetailsEl(root) {
    var scope = root || document;
    return scope.querySelector(".sg-hover-details")
        || scope.querySelector('[class*="sgMetricsDisplay"]');
  }

  function injectCatLabel(climb) {
    var details = findHoverDetailsEl();
    if (!details) return;
    var line = details.querySelector(".rwgps-climbcat-label");
    if (!line) {
      line = document.createElement("div");
      line.className = "rwgps-climbcat-label";
      details.appendChild(line);
    }
    var isMetric = R.isMetric && R.isMetric();
    var gain = isMetric
      ? Math.round(climb.elevGain) + " m"
      : Math.round(climb.elevGain / 0.3048).toLocaleString() + " ft";
    var dist = isMetric
      ? (climb.distMeters / 1000).toFixed(1) + " km"
      : (climb.distMeters / 1609.34).toFixed(1) + " mi";
    var text = climb.category.label +
      " — " + climb.avgGradient.toFixed(1) + "%" +
      " · " + dist +
      " · " + gain;
    line.style.color = climb.category.color;
    if (line.textContent !== text) line.textContent = text;
    lastHoverClimb = climb;
  }

  function removeCatLabel() {
    var line = document.querySelector(".rwgps-climbcat-label");
    if (line) line.remove();
    lastHoverClimb = null;
  }

  function fallbackXProjection(canvas) {
    if (!canvas || !R.cachedTrackPoints || R.cachedTrackPoints.length < 2) return null;
    var maxDist = R.cachedTrackPoints[R.cachedTrackPoints.length - 1].distance;
    if (!maxDist || maxDist <= 0) return null;
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return null;
    return { pixelOffset: 0, v0: 0, vScale: rect.width / maxDist };
  }

  function startTooltip() {
    stopTooltip();
    if (!cachedCatClimbs || cachedCatClimbs.length === 0) return;

    var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-climbcat-overlay") : null;
    var canvas = graph ? graph.canvas : null;
    if (!canvas) return;
    tooltipCanvas = canvas;

    tooltipMoveHandler = function (e) {
      var rect = canvas.getBoundingClientRect();
      var cssX = e.clientX - rect.left;
      if (cssX < 0 || cssX > rect.width) return;

      var layout = R.getGraphLayout && R.getGraphLayout();
      var xProj = layout && layout.xProjection;
      if (!xProj || !xProj.vScale) {
        xProj = fallbackXProjection(canvas);
        if (!xProj) return;
      }
      var distance = (cssX - xProj.pixelOffset) / xProj.vScale + xProj.v0;
      var climb = findClimbAtDist(distance, cachedCatClimbs);
      if (climb) {
        injectCatLabel(climb);
      } else {
        removeCatLabel();
      }
    };
    canvas.addEventListener("mousemove", tooltipMoveHandler);
    var parent = canvas.parentElement;
    if (parent) parent.addEventListener("mousemove", tooltipMoveHandler);

    var bottomPanel = canvas.closest('[class*="BottomPanel"]') || canvas.parentElement || document.body;
    tooltipObserver = new MutationObserver(function () {
      if (!R.climbCatsActive || !lastHoverClimb) return;
      var details = findHoverDetailsEl(bottomPanel) || findHoverDetailsEl();
      if (!details || details.querySelector(".rwgps-climbcat-label")) return;
      injectCatLabel(lastHoverClimb);
    });
    tooltipObserver.observe(bottomPanel, { childList: true, subtree: true });
  }

  function stopTooltip() {
    if (tooltipMoveHandler && tooltipCanvas) {
      tooltipCanvas.removeEventListener("mousemove", tooltipMoveHandler);
      var parent = tooltipCanvas.parentElement;
      if (parent) parent.removeEventListener("mousemove", tooltipMoveHandler);
    }
    tooltipMoveHandler = null;
    tooltipCanvas = null;
    if (tooltipObserver) { tooltipObserver.disconnect(); tooltipObserver = null; }
    lastHoverClimb = null;
    removeCatLabel();
  }

  // ─── Toggle ───────────────────────────────────────────────────────────

  R.toggleClimbCats = async function () {
    R.climbCatsActive = !R.climbCatsActive;
    if (R.climbCatsActive) {
      await R.enableClimbCats();
    } else {
      R.disableClimbCats();
    }
  };

  R.enableClimbCats = async function () {
    try {
      var pageInfo = R.getPageInfo();
      if (!pageInfo) return;

      if (!R.cachedTrackPoints) {
        R.cachedTrackPoints = await R.fetchTrackPoints(pageInfo.type, pageInfo.id);
        if (!R.cachedTrackPoints || R.cachedTrackPoints.length === 0) return;
      }

      if (!R.cachedClimbs) {
        R.cachedClimbs = R.findAscents(R.cachedTrackPoints);
      }

      cachedCatClimbs = buildCategorizedClimbs(R.cachedTrackPoints, R.cachedClimbs);
      if (cachedCatClimbs.length === 0) return;

      R.retryOverlayRender("climbCatsActive", function () {
        return renderOverlay(R.cachedTrackPoints, cachedCatClimbs);
      }, function () {
        startSync();
        startTooltip();
      });
    } catch (err) {
      console.error("[RWGPS Ext] enableClimbCats ERROR:", err);
    }
  };

  R.disableClimbCats = function () {
    removeOverlay();
    stopTooltip();
    cachedCatClimbs = null;
  };

})(window.RE);
