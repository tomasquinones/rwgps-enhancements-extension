(function (R) {
  "use strict";

  // ─── Descent Elevation Graph Overlay ───────────────────────────────────

  var descentElevationPollId = null;
  var descentElevationListeners = null;
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

  function renderDescentElevationOverlay(trackPoints, descents) {
    var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-descent-elevation-overlay") : null;
    var origCanvas = graph ? graph.canvas : null;
    var graphContainer = graph ? graph.container : null;
    if (!origCanvas || !graphContainer) return null;

    var existing = graphContainer.querySelector(".rwgps-descent-elevation-overlay");
    if (existing) existing.remove();

    var cw = origCanvas.width;
    var ch = origCanvas.height;
    if (cw === 0 || ch === 0) return null;

    var maxDist = trackPoints[trackPoints.length - 1].distance;
    if (maxDist === 0) return null;

    var descentRanges = descents.map(function (hill) {
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
      return renderWithPixelScan(trackPoints, origCanvas, graphContainer, pixels, cw, ch, maxDist, descentRanges);
    } else if (tainted) {
      return renderWithProjection(trackPoints, origCanvas, graphContainer, cw, ch, maxDist, descentRanges);
    }
    return null;
  }

  function renderWithPixelScan(trackPoints, origCanvas, graphContainer, pixels, cw, ch, maxDist, descentRanges) {
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

    var overlay = createOverlayCanvas(origCanvas, "rwgps-descent-elevation-overlay");
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

      var inDescent = null;
      for (var di = 0; di < descentRanges.length; di++) {
        if (dist >= descentRanges[di].startDist && dist <= descentRanges[di].endDist) {
          inDescent = descentRanges[di]; break;
        }
      }
      if (!inDescent) continue;

      var eleRange = inDescent.endEle - inDescent.startEle;
      var t = 0.5;
      if (eleRange !== 0) {
        while (ptIdx < trackPoints.length - 1 && trackPoints[ptIdx + 1].distance < dist) { ptIdx++; }
        var ele = trackPoints[ptIdx].ele;
        t = Math.max(0, Math.min(1, (ele - inDescent.startEle) / eleRange));
        if (eleRange < 0) t = 1 - t;
      }
      var color = R.hillGradientColor(t, R.DESCENT_COLOR_HIGH, R.DESCENT_COLOR_LOW);

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

  function renderWithProjection(trackPoints, origCanvas, graphContainer, cw, ch, maxDist, descentRanges) {
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
    var eleRangeTotal = maxEle - minEle;
    if (eleRangeTotal < 1) eleRangeTotal = 1;
    var elePad = eleRangeTotal * 0.05;
    minEle -= elePad;
    maxEle += elePad;

    var overlay = createOverlayCanvas(origCanvas, "rwgps-descent-elevation-overlay");
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

      var inDescent = null;
      for (var di = 0; di < descentRanges.length; di++) {
        if (dist >= descentRanges[di].startDist && dist <= descentRanges[di].endDist) {
          inDescent = descentRanges[di]; break;
        }
      }
      if (!inDescent) continue;

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

      var yTop = Math.round(R.projectElevationToGraphY(ele, layout, dpr, plotTop, plotBottom, minEle, maxEle));
      if (yTop < plotTop) yTop = plotTop;
      if (yTop >= plotBottom) continue;

      var descentEleRange = inDescent.endEle - inDescent.startEle;
      var gradT = 0.5;
      if (descentEleRange !== 0) {
        gradT = Math.max(0, Math.min(1, (ele - inDescent.startEle) / descentEleRange));
        if (descentEleRange < 0) gradT = 1 - gradT;
      }
      var color = R.hillGradientColor(gradT, R.DESCENT_COLOR_HIGH, R.DESCENT_COLOR_LOW);
      ctx.fillStyle = color;
      ctx.fillRect(cx2, yTop, 1, plotBottom - yTop);
    }
    return overlay;
  }

  function scheduleDescentElevationRedraw() {
    if (!R.descentElevationActive || !R.cachedTrackPoints || !R.cachedDescents) return;
    setTimeout(function () {
      if (!R.descentElevationActive || !R.cachedTrackPoints || !R.cachedDescents) return;
      renderDescentElevationOverlay(R.cachedTrackPoints, R.cachedDescents);
      var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-descent-elevation-overlay") : null;
      if (graph && graph.canvas) lastCanvasFingerprint = R.canvasFingerprint(graph.canvas);
    }, 400);
  }

  function startDescentElevationSync() {
    stopDescentElevationSync();

    var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-descent-elevation-overlay") : null;
    var graphContainer = graph ? graph.container : null;

    var onMouseUp = function () { scheduleDescentElevationRedraw(); };
    if (graphContainer) {
      graphContainer.addEventListener("mouseup", onMouseUp);
      graphContainer.addEventListener("pointerup", onMouseUp);
    }
    var bottomPanel = graphContainer ? graphContainer.closest('[class*="BottomPanel"]') || graphContainer.parentElement : null;
    if (bottomPanel) {
      bottomPanel.addEventListener("click", onMouseUp);
    }

    descentElevationListeners = {
      graphContainer: graphContainer,
      bottomPanel: bottomPanel,
      onMouseUp: onMouseUp
    };

    var origCanvas = graph ? graph.canvas : null;
    if (origCanvas) {
      lastCanvasFingerprint = R.canvasFingerprint(origCanvas);
    }
    descentElevationPollId = setInterval(function () {
      if (!R.descentElevationActive) { stopDescentElevationSync(); return; }
      var activeGraph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-descent-elevation-overlay") : null;
      var activeCanvas = activeGraph ? activeGraph.canvas : null;
      if (activeCanvas && activeCanvas !== origCanvas) {
        origCanvas = activeCanvas;
        lastCanvasFingerprint = "";
        scheduleDescentElevationRedraw();
        return;
      }
      if (!origCanvas || !origCanvas.isConnected) {
        var foundGraph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-descent-elevation-overlay") : null;
        if (foundGraph && foundGraph.canvas) origCanvas = foundGraph.canvas;
        if (!origCanvas || !origCanvas.isConnected) return;
        lastCanvasFingerprint = "";
      }
      var fp = R.canvasFingerprint(origCanvas);
      if (fp !== lastCanvasFingerprint) {
        lastCanvasFingerprint = fp;
        scheduleDescentElevationRedraw();
      }
    }, 500);
  }

  function stopDescentElevationSync() {
    if (descentElevationListeners) {
      var l = descentElevationListeners;
      if (l.graphContainer) {
        l.graphContainer.removeEventListener("mouseup", l.onMouseUp);
        l.graphContainer.removeEventListener("pointerup", l.onMouseUp);
      }
      if (l.bottomPanel) {
        l.bottomPanel.removeEventListener("click", l.onMouseUp);
      }
      descentElevationListeners = null;
    }
    if (descentElevationPollId) {
      clearInterval(descentElevationPollId);
      descentElevationPollId = null;
    }
    lastCanvasFingerprint = "";
  }

  function removeDescentElevationOverlay() {
    stopDescentElevationSync();
    var overlay = document.querySelector(".rwgps-descent-elevation-overlay");
    if (overlay) overlay.remove();
  }

  // ─── Descents Pill in Elevation Graph Controls ─────────────────────────

  function insertDescentsPill() {
    if (document.querySelector(".rwgps-descents-pill")) return;

    var sgControls = document.querySelector('[class*="sgControls"]');
    if (!sgControls) return;

    var pillGroup = sgControls.querySelector('[class*="PillGroup"]');
    if (!pillGroup) return;

    var pill = document.createElement("div");
    pill.className = "rwgps-descents-pill" + (R.descentElevationActive ? " rwgps-descents-pill-selected" : "");
    pill.textContent = "Descents";
    pill.addEventListener("click", function () {
      R.toggleDescentElevation();
      pill.classList.toggle("rwgps-descents-pill-selected", R.descentElevationActive);
    });

    pillGroup.appendChild(pill);
  }

  R.removeDescentsPill = function () {
    var pill = document.querySelector(".rwgps-descents-pill");
    if (pill) pill.remove();
  };

  // ─── Descents Toggle ───────────────────────────────────────────────────

  R.toggleDescents = async function () {
    R.descentsActive = !R.descentsActive;
    if (R.descentsActive) {
      await R.enableDescents();
    } else {
      R.disableDescents();
    }
  };

  R.enableDescents = async function () {
    try {
      if (R.loadColorSettings) {
        await R.loadColorSettings();
      }

      var pageInfo = R.getPageInfo();
      if (!pageInfo) { console.warn("[RWGPS Ext] enableDescents: no pageInfo"); return; }

      if (!R.cachedTrackPoints) {
        R.cachedTrackPoints = await R.fetchTrackPoints(pageInfo.type, pageInfo.id);
        if (!R.cachedTrackPoints || R.cachedTrackPoints.length === 0) {
          console.warn("[RWGPS Ext] enableDescents: no track points");
          return;
        }
      }

      console.log("[RWGPS Ext] enableDescents: %d track points", R.cachedTrackPoints.length);

      if (!R.cachedDescents) {
        R.cachedDescents = R.findDescents(R.cachedTrackPoints);
      }

      console.log("[RWGPS Ext] enableDescents: found %d descents", R.cachedDescents.length);
      if (R.cachedDescents.length === 0) return;

      var features = R.buildHillFeatures(R.cachedDescents, R.cachedTrackPoints, R.DESCENT_COLOR_HIGH, R.DESCENT_COLOR_LOW);
      console.log("[RWGPS Ext] enableDescents: dispatching %d features", features.length);
      document.dispatchEvent(new CustomEvent("rwgps-descents-add", {
        detail: JSON.stringify(features)
      }));

      insertDescentsPill();

      R.descentElevationActive = true;
      R.enableDescentElevation();
    } catch (err) {
      console.error("[RWGPS Ext] enableDescents ERROR:", err);
    }
  };

  R.disableDescents = function () {
    document.dispatchEvent(new CustomEvent("rwgps-descents-remove"));
    removeDescentElevationOverlay();
    R.removeDescentsPill();
    R.descentElevationActive = false;
  };

  R.toggleDescentTrack = function () {
    R.descentTrackVisible = !R.descentTrackVisible;
    document.dispatchEvent(new CustomEvent("rwgps-hill-track-toggle", {
      detail: JSON.stringify({ prefix: "rwgps-descents", visible: R.descentTrackVisible })
    }));
  };

  R.toggleDescentLabels = R.toggleDescentTrack;

  R.toggleDescentElevation = function () {
    R.descentElevationActive = !R.descentElevationActive;
    if (R.descentElevationActive) {
      R.enableDescentElevation();
    } else {
      removeDescentElevationOverlay();
    }
    var pill = document.querySelector(".rwgps-descents-pill");
    if (pill) pill.classList.toggle("rwgps-descents-pill-selected", R.descentElevationActive);
  };

  R.enableDescentElevation = function () {
    if (!R.cachedTrackPoints || !R.cachedDescents || R.cachedDescents.length === 0) return;
    R.retryOverlayRender("descentElevationActive", function () {
      return renderDescentElevationOverlay(R.cachedTrackPoints, R.cachedDescents);
    }, function () {
      startDescentElevationSync();
    });
  };

})(window.RE);
