(function (R) {
  "use strict";

  // ─── Climb Elevation Graph Overlay ──────────────────────────────────────

  var climbElevationPollId = null;
  var climbElevationListeners = null;
  var lastCanvasFingerprint = "";

  function renderClimbElevationOverlay(trackPoints, climbs) {
    var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-climb-elevation-overlay") : null;
    var origCanvas = graph ? graph.canvas : null;
    var graphContainer = graph ? graph.container : null;
    if (!origCanvas || !graphContainer) return null;

    var existing = graphContainer.querySelector(".rwgps-climb-elevation-overlay");
    if (existing) existing.remove();

    var cw = origCanvas.width;
    var ch = origCanvas.height;
    if (cw === 0 || ch === 0) return null;
    var offsetWidth = origCanvas.offsetWidth || origCanvas.clientWidth || cw;
    var dpr = cw / offsetWidth;
    var layout = R.getGraphLayout();
    var plotRect = R.getGraphPlotRect ? R.getGraphPlotRect(layout, cw, ch, dpr) : null;

    if (!plotRect) {
      var origCtx = origCanvas.getContext("2d", { willReadFrequently: true });
      if (!origCtx) return null;
      var imageData;
      try { imageData = origCtx.getImageData(0, 0, cw, ch); } catch (e) { return null; }
      var pixels = imageData.data;
      function isFilledPixel(px, py) {
        var idx = (py * cw + px) * 4;
        var a = pixels[idx + 3];
        if (a < 30) return false;
        var r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
        if (r > 240 && g > 240 && b > 240) return false;
        return true;
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
      if (fillRight > fillLeft && fillBottom > fillTop) {
        plotRect = { left: fillLeft, right: fillRight, top: fillTop, bottom: fillBottom };
      }
    }

    if (!plotRect) {
      plotRect = { left: 0, right: cw - 1, top: 0, bottom: ch - 1 };
    }

    var plotLeftPx = plotRect.left;
    var plotRightPx = plotRect.right;
    var plotTopPx = plotRect.top;
    var plotBottomPx = plotRect.bottom;

    var overlay = document.createElement("canvas");
    overlay.className = "rwgps-climb-elevation-overlay";
    overlay.width = cw;
    overlay.height = ch;
    var cssWidth = origCanvas.style.width || (origCanvas.offsetWidth + "px");
    var cssHeight = origCanvas.style.height || (origCanvas.offsetHeight + "px");
    overlay.style.cssText = "position:absolute;top:0;left:0;width:" +
      cssWidth + ";height:" + cssHeight +
      ";pointer-events:none;z-index:51;";

    var canvasParent = origCanvas.parentElement;
    var parentPos = window.getComputedStyle(canvasParent);
    if (parentPos.position === "static") canvasParent.style.position = "relative";
    canvasParent.appendChild(overlay);

    var ctx = overlay.getContext("2d");
    if (!ctx) return overlay;

    var maxDist = trackPoints[trackPoints.length - 1].distance;
    if (maxDist === 0) return overlay;

    var minEle = Infinity;
    var maxEle = -Infinity;
    for (var i = 0; i < trackPoints.length; i++) {
      var ele = trackPoints[i].ele;
      if (!Number.isFinite(ele)) continue;
      if (ele < minEle) minEle = ele;
      if (ele > maxEle) maxEle = ele;
    }
    if (!Number.isFinite(minEle) || !Number.isFinite(maxEle)) {
      minEle = 0;
      maxEle = 1;
    }

    var inkProfile = R.buildGraphInkProfile ? R.buildGraphInkProfile(origCanvas, plotRect) : null;
    var projectionLayout = R.pickGraphProjectionLayout
      ? R.pickGraphProjectionLayout(trackPoints, layout, dpr, plotLeftPx, plotRightPx, plotTopPx, plotBottomPx, maxDist, minEle, maxEle)
      : layout;

    var segColors = new Array(Math.max(0, trackPoints.length - 1));
    for (var hi = 0; hi < climbs.length; hi++) {
      var hill = climbs[hi];
      var startEle = trackPoints[hill.first_i].ele;
      var endEle = trackPoints[hill.last_i].ele;
      var eleRange = endEle - startEle;
      for (var si = hill.first_i; si < hill.last_i; si++) {
        var midEle = (trackPoints[si].ele + trackPoints[si + 1].ele) / 2;
        var t = eleRange !== 0 ? Math.max(0, Math.min(1, (midEle - startEle) / eleRange)) : 0.5;
        if (eleRange < 0) t = 1 - t;
        segColors[si] = R.hillGradientColor(t, R.CLIMB_COLOR_LOW, R.CLIMB_COLOR_HIGH);
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeftPx, plotTopPx, Math.max(1, plotRightPx - plotLeftPx), Math.max(1, plotBottomPx - plotTopPx));
    ctx.clip();
    ctx.globalAlpha = 0.9;

    if (inkProfile && inkProfile.coverage >= 0.12) {
      var totalSegs = Math.max(1, trackPoints.length - 1);
      var span = Math.max(1, inkProfile.right - inkProfile.left);
      for (var x = inkProfile.left; x <= inkProfile.right; x++) {
        var y = inkProfile.yByX[x - inkProfile.left];
        if (!Number.isFinite(y)) continue;
        var pct = (x - inkProfile.left) / span;
        var segIdx = Math.max(0, Math.min(totalSegs - 1, Math.floor(pct * totalSegs)));
        var color = segColors[segIdx];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x, Math.max(plotTopPx, y - 1), 1, 4);
      }
      ctx.restore();
      return overlay;
    }

    ctx.lineWidth = 3;
    ctx.lineCap = "round";

    for (var s = 1; s < trackPoints.length; s++) {
      var segColor = segColors[s - 1];
      if (!segColor) continue;
      var p0 = trackPoints[s - 1];
      var p1 = trackPoints[s];
      var x0 = R.projectDistanceToGraphX(p0.distance, projectionLayout, dpr, plotLeftPx, plotRightPx, maxDist);
      var x1 = R.projectDistanceToGraphX(p1.distance, projectionLayout, dpr, plotLeftPx, plotRightPx, maxDist);
      var y0 = R.projectElevationToGraphY(p0.ele, projectionLayout, dpr, plotTopPx, plotBottomPx, minEle, maxEle);
      var y1 = R.projectElevationToGraphY(p1.ele, projectionLayout, dpr, plotTopPx, plotBottomPx, minEle, maxEle);
      if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(y0) || !Number.isFinite(y1)) continue;
      ctx.strokeStyle = segColor;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.restore();

    return overlay;
  }

  function colorClimbsOnElevation(trackPoints, climbs) {
    var overlay = renderClimbElevationOverlay(trackPoints, climbs);
    startClimbElevationSync();
    return overlay;
  }

  function scheduleClimbElevationRedraw() {
    if (!R.climbElevationActive || !R.cachedTrackPoints || !R.cachedClimbs) return;
    setTimeout(function () {
      if (!R.climbElevationActive || !R.cachedTrackPoints || !R.cachedClimbs) return;
      renderClimbElevationOverlay(R.cachedTrackPoints, R.cachedClimbs);
      var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-climb-elevation-overlay") : null;
      if (graph && graph.canvas) lastCanvasFingerprint = R.canvasFingerprint(graph.canvas);
    }, 400);
  }

  function startClimbElevationSync() {
    stopClimbElevationSync();

    var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-climb-elevation-overlay") : null;
    var graphContainer = graph ? graph.container : null;

    var onMouseUp = function () { scheduleClimbElevationRedraw(); };
    if (graphContainer) {
      graphContainer.addEventListener("mouseup", onMouseUp);
      graphContainer.addEventListener("pointerup", onMouseUp);
    }
    var bottomPanel = graphContainer ? graphContainer.closest('[class*="BottomPanel"]') || graphContainer.parentElement : null;
    if (bottomPanel) {
      bottomPanel.addEventListener("click", onMouseUp);
    }

    climbElevationListeners = {
      graphContainer: graphContainer,
      bottomPanel: bottomPanel,
      onMouseUp: onMouseUp
    };

    var origCanvas = graph ? graph.canvas : null;
    if (origCanvas) {
      lastCanvasFingerprint = R.canvasFingerprint(origCanvas);
    }
    climbElevationPollId = setInterval(function () {
      if (!R.climbElevationActive) { stopClimbElevationSync(); return; }
      var activeGraph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-climb-elevation-overlay") : null;
      var activeCanvas = activeGraph ? activeGraph.canvas : null;
      if (activeCanvas && activeCanvas !== origCanvas) {
        origCanvas = activeCanvas;
        lastCanvasFingerprint = "";
        scheduleClimbElevationRedraw();
        return;
      }
      if (!origCanvas || !origCanvas.isConnected) {
        var foundGraph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-climb-elevation-overlay") : null;
        if (foundGraph && foundGraph.canvas) origCanvas = foundGraph.canvas;
        if (!origCanvas || !origCanvas.isConnected) return;
        lastCanvasFingerprint = "";
      }
      var fp = R.canvasFingerprint(origCanvas);
      if (fp !== lastCanvasFingerprint) {
        lastCanvasFingerprint = fp;
        scheduleClimbElevationRedraw();
      }
    }, 500);
  }

  function stopClimbElevationSync() {
    if (climbElevationListeners) {
      var l = climbElevationListeners;
      if (l.graphContainer) {
        l.graphContainer.removeEventListener("mouseup", l.onMouseUp);
        l.graphContainer.removeEventListener("pointerup", l.onMouseUp);
      }
      if (l.bottomPanel) {
        l.bottomPanel.removeEventListener("click", l.onMouseUp);
      }
      climbElevationListeners = null;
    }
    if (climbElevationPollId) {
      clearInterval(climbElevationPollId);
      climbElevationPollId = null;
    }
    lastCanvasFingerprint = "";
  }

  function removeClimbElevationOverlay() {
    stopClimbElevationSync();
    var overlay = document.querySelector(".rwgps-climb-elevation-overlay");
    if (overlay) overlay.remove();
  }

  // ─── Climbs Pill in Elevation Graph Controls ────────────────────────────
  // Removed intentionally to reduce UI confusion.
  R.removeClimbsPill = function () {};

  // ─── Climbs Toggle ──────────────────────────────────────────────────────

  R.toggleClimbs = async function () {
    R.climbsActive = !R.climbsActive;
    if (R.climbsActive) {
      await R.enableClimbs();
    } else {
      R.disableClimbs();
    }
  };

  R.enableClimbs = async function () {
    if (R.loadColorSettings) {
      await R.loadColorSettings();
    }

    var pageInfo = R.getPageInfo();
    if (!pageInfo) return;

    if (!R.cachedTrackPoints) {
      R.cachedTrackPoints = await R.fetchTrackPoints(pageInfo.type, pageInfo.id);
      if (!R.cachedTrackPoints || R.cachedTrackPoints.length === 0) return;
    }

    if (!R.cachedClimbs) {
      R.cachedClimbs = R.findAscents(R.cachedTrackPoints);
    }

    if (R.cachedClimbs.length === 0) return;

    var features = R.buildHillFeatures(R.cachedClimbs, R.cachedTrackPoints, R.CLIMB_COLOR_LOW, R.CLIMB_COLOR_HIGH);
    document.dispatchEvent(new CustomEvent("rwgps-climbs-add", {
      detail: JSON.stringify(features)
    }));

    R.climbElevationActive = true;
    R.enableClimbElevation();
  };

  R.disableClimbs = function () {
    document.dispatchEvent(new CustomEvent("rwgps-climbs-remove"));
    removeClimbElevationOverlay();
    R.removeClimbsPill();
    R.climbElevationActive = false;
  };

  R.toggleClimbTrack = function () {
    R.climbTrackVisible = !R.climbTrackVisible;
    document.dispatchEvent(new CustomEvent("rwgps-hill-track-toggle", {
      detail: JSON.stringify({ prefix: "rwgps-climbs", visible: R.climbTrackVisible })
    }));
  };

  // Backward-compatible alias
  R.toggleClimbLabels = R.toggleClimbTrack;

  R.toggleClimbElevation = function () {
    R.climbElevationActive = !R.climbElevationActive;
    if (R.climbElevationActive) {
      R.enableClimbElevation();
    } else {
      removeClimbElevationOverlay();
    }
  };

  R.enableClimbElevation = function () {
    if (!R.cachedTrackPoints || !R.cachedClimbs || R.cachedClimbs.length === 0) return;
    R.retryOverlayRender("climbElevationActive", function () {
      return renderClimbElevationOverlay(R.cachedTrackPoints, R.cachedClimbs);
    }, function () {
      startClimbElevationSync();
    });
  };

})(window.RE);
