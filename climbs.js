(function (R) {
  "use strict";

  // ─── Climb Elevation Graph Overlay ──────────────────────────────────────

  var climbElevationPollId = null;
  var climbElevationListeners = null;
  var lastCanvasFingerprint = "";

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

    var maxDist = trackPoints[trackPoints.length - 1].distance;
    if (maxDist === 0) return null;

    var climbRanges = climbs.map(function (hill) {
      return {
        startDist: trackPoints[hill.first_i].distance,
        endDist: trackPoints[hill.last_i].distance,
        startEle: trackPoints[hill.first_i].ele,
        endEle: trackPoints[hill.last_i].ele
      };
    });

    var tainted = false;
    var origCtx = origCanvas.getContext("2d", { willReadFrequently: true });
    var pixels = null;
    if (origCtx) {
      try {
        var imageData = origCtx.getImageData(0, 0, cw, ch);
        pixels = imageData.data;
      } catch (e) {
        tainted = true;
      }
    }

    if (pixels) {
      return renderWithPixelScan(trackPoints, origCanvas, graphContainer, pixels, cw, ch, maxDist, climbRanges);
    } else if (tainted) {
      return renderWithProjection(trackPoints, origCanvas, graphContainer, cw, ch, maxDist, climbRanges);
    }
    return null;
  }

  function renderWithPixelScan(trackPoints, origCanvas, graphContainer, pixels, cw, ch, maxDist, climbRanges) {
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
    if (fillRight <= fillLeft || fillBottom <= fillTop) return null;

    var plotLeftPx = fillLeft;
    var plotRightPx = fillRight;
    var plotWidthPx = plotRightPx - plotLeftPx;

    var layout = R.getGraphLayout();
    var useProjection = layout && layout.xProjection && layout.xProjection.vScale;
    var xProj = useProjection ? layout.xProjection : null;
    var offsetWidth = origCanvas.offsetWidth || origCanvas.clientWidth || (cw / 2);
    var dpr = cw / offsetWidth;

    var overlay = createOverlayCanvas(origCanvas, "rwgps-climb-elevation-overlay");
    var ctx = overlay.getContext("2d");
    if (!ctx) return overlay;

    ctx.globalAlpha = 0.6;
    var ptIdx = 0;

    for (var cx2 = plotLeftPx; cx2 <= plotRightPx; cx2++) {
      var dist;
      if (xProj) {
        var cssPx = cx2 / dpr;
        dist = xProj.v0 + (cssPx - xProj.pixelOffset) / xProj.vScale;
      } else {
        dist = ((cx2 - plotLeftPx) / plotWidthPx) * maxDist;
      }

      var inClimb = null;
      for (var ci2 = 0; ci2 < climbRanges.length; ci2++) {
        if (dist >= climbRanges[ci2].startDist && dist <= climbRanges[ci2].endDist) {
          inClimb = climbRanges[ci2]; break;
        }
      }
      if (!inClimb) continue;

      var eleRange = inClimb.endEle - inClimb.startEle;
      var t = 0.5;
      if (eleRange !== 0) {
        while (ptIdx < trackPoints.length - 1 && trackPoints[ptIdx + 1].distance < dist) { ptIdx++; }
        var ele = trackPoints[ptIdx].ele;
        t = Math.max(0, Math.min(1, (ele - inClimb.startEle) / eleRange));
      }
      var color = R.hillGradientColor(t, R.CLIMB_COLOR_LOW, R.CLIMB_COLOR_HIGH);

      var bestRunTop = -1, bestRunLen = 0;
      var runTop = -1, runLen = 0;
      for (var cy = 0; cy < ch; cy++) {
        if (isFilledPixel(cx2, cy)) {
          if (runTop < 0) runTop = cy;
          runLen++;
        } else {
          if (runLen > bestRunLen) { bestRunTop = runTop; bestRunLen = runLen; }
          runTop = -1; runLen = 0;
        }
      }
      if (runLen > bestRunLen) { bestRunTop = runTop; bestRunLen = runLen; }

      if (bestRunTop >= 0 && bestRunLen > 2) {
        ctx.fillStyle = color;
        ctx.fillRect(cx2, bestRunTop, 1, bestRunLen);
      }
    }
    return overlay;
  }

  function renderWithProjection(trackPoints, origCanvas, graphContainer, cw, ch, maxDist, climbRanges) {
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

    var overlay = createOverlayCanvas(origCanvas, "rwgps-climb-elevation-overlay");
    var ctx = overlay.getContext("2d");
    if (!ctx) return overlay;

    ctx.globalAlpha = 0.6;
    var plotLeft = plotRect.left;
    var plotRight = plotRect.right;
    var plotTop = plotRect.top;
    var plotBottom = plotRect.bottom;
    var plotWidth = plotRight - plotLeft;
    var plotHeight = plotBottom - plotTop;
    var ptIdx = 0;

    for (var cx2 = plotLeft; cx2 <= plotRight; cx2++) {
      var dist;
      if (layout && layout.xProjection && layout.xProjection.vScale) {
        var cssPx = cx2 / dpr;
        dist = layout.xProjection.v0 + (cssPx - layout.xProjection.pixelOffset) / layout.xProjection.vScale;
      } else {
        dist = ((cx2 - plotLeft) / plotWidth) * maxDist;
      }
      if (dist < 0 || dist > maxDist) continue;

      var inClimb = null;
      for (var ci2 = 0; ci2 < climbRanges.length; ci2++) {
        if (dist >= climbRanges[ci2].startDist && dist <= climbRanges[ci2].endDist) {
          inClimb = climbRanges[ci2]; break;
        }
      }
      if (!inClimb) continue;

      while (ptIdx < trackPoints.length - 1 && trackPoints[ptIdx + 1].distance < dist) { ptIdx++; }
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

      var eleT = (ele - minEle) / (maxEle - minEle);
      var yTop = Math.round(plotBottom - eleT * plotHeight);
      if (yTop < plotTop) yTop = plotTop;
      if (yTop >= plotBottom) continue;

      var climbEleRange = inClimb.endEle - inClimb.startEle;
      var gradT = 0.5;
      if (climbEleRange !== 0) {
        gradT = Math.max(0, Math.min(1, (ele - inClimb.startEle) / climbEleRange));
      }
      var color = R.hillGradientColor(gradT, R.CLIMB_COLOR_LOW, R.CLIMB_COLOR_HIGH);
      ctx.fillStyle = color;
      ctx.fillRect(cx2, yTop, 1, plotBottom - yTop);
    }
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
