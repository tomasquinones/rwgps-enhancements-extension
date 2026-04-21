(function (R) {
  "use strict";

  // ─── Grade Color Elevation Graph Overlay ────────────────────────────────
  var gradeElevationPollId = null;
  var gradeLastCanvasFingerprint = "";
  var OVERLAY_CLASS = "rwgps-grade-elevation-overlay";

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
      ";pointer-events:none;z-index:1;";
    var canvasParent = origCanvas.parentElement;
    var parentPos = window.getComputedStyle(canvasParent);
    if (parentPos.position === "static") canvasParent.style.position = "relative";
    canvasParent.appendChild(overlay);
    return overlay;
  }

  function colorElevationGraph(trackPoints) {
    var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas(OVERLAY_CLASS) : null;
    var origCanvas = graph ? graph.canvas : null;
    var graphContainer = graph ? graph.container : null;
    if (!origCanvas || !graphContainer) return null;

    var existing = graphContainer.querySelector("." + OVERLAY_CLASS);
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
        var imageData = origCtx.getImageData(0, 0, cw, ch);
        pixels = imageData.data;
      } catch (e) {
        tainted = true;
      }
    }

    if (pixels) {
      return renderWithPixelScan(trackPoints, origCanvas, graphContainer, pixels, cw, ch, maxDist);
    } else if (tainted) {
      return renderWithProjection(trackPoints, origCanvas, graphContainer, cw, ch, maxDist);
    }
    return null;
  }

  function renderWithPixelScan(trackPoints, origCanvas, graphContainer, pixels, cw, ch, maxDist) {
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

    var overlay = createOverlayCanvas(origCanvas, OVERLAY_CLASS);
    var ctx = overlay.getContext("2d");
    if (!ctx) return overlay;

    var ptIdx = 0;
    ctx.globalAlpha = 0.6;

    for (var cx2 = plotLeftPx; cx2 <= plotRightPx; cx2++) {
      var dist = ((cx2 - plotLeftPx) / plotWidthPx) * maxDist;
      while (ptIdx < trackPoints.length - 1 && trackPoints[ptIdx + 1].distance < dist) {
        ptIdx++;
      }
      var grade = trackPoints[ptIdx].grade || 0;
      var color = R.gradeToColor(grade);

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

  function renderWithProjection(trackPoints, origCanvas, graphContainer, cw, ch, maxDist) {
    var offsetWidth = origCanvas.offsetWidth || origCanvas.clientWidth || (cw / 2);
    var dpr = cw / offsetWidth;
    var layout = R.getGraphLayout();
    var plotRect = R.getGraphPlotRect ? R.getGraphPlotRect(layout, cw, ch, dpr) : null;

    if (!plotRect) {
      var padLeft = Math.round(45 * dpr);
      var padRight = Math.round(10 * dpr);
      var padTop = Math.round(10 * dpr);
      var padBottom = Math.round(25 * dpr);
      plotRect = {
        left: padLeft,
        right: cw - padRight,
        top: padTop,
        bottom: ch - padBottom
      };
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

    var overlay = createOverlayCanvas(origCanvas, OVERLAY_CLASS);
    var ctx = overlay.getContext("2d");
    if (!ctx) return overlay;

    ctx.globalAlpha = 0.6;

    var plotLeft = plotRect.left;
    var plotRight = plotRect.right;
    var plotTop = plotRect.top;
    var plotBottom = plotRect.bottom;
    var plotWidth = plotRight - plotLeft;

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

      while (ptIdx < trackPoints.length - 1 && trackPoints[ptIdx + 1].distance < dist) {
        ptIdx++;
      }
      var ele;
      if (ptIdx < trackPoints.length - 1) {
        var d0 = trackPoints[ptIdx].distance;
        var d1 = trackPoints[ptIdx + 1].distance;
        var segLen = d1 - d0;
        if (segLen > 0) {
          var t = (dist - d0) / segLen;
          ele = trackPoints[ptIdx].ele + t * (trackPoints[ptIdx + 1].ele - trackPoints[ptIdx].ele);
        } else {
          ele = trackPoints[ptIdx].ele;
        }
      } else {
        ele = trackPoints[ptIdx].ele;
      }

      var yTop = Math.round(R.projectElevationToGraphY(ele, layout, dpr, plotTop, plotBottom, minEle, maxEle));
      if (yTop < plotTop) yTop = plotTop;
      if (yTop >= plotBottom) continue;

      var grade = trackPoints[ptIdx].grade || 0;
      var color = R.gradeToColor(grade);
      ctx.fillStyle = color;
      ctx.fillRect(cx2, yTop, 1, plotBottom - yTop);
    }
    return overlay;
  }

  function removeElevationOverlay() {
    var overlay = document.querySelector("." + OVERLAY_CLASS);
    if (overlay) overlay.remove();
  }

  function scheduleGradeElevationRedraw() {
    if (!R.gradeColorsActive || !R.cachedTrackPoints) return;
    setTimeout(function () {
      if (!R.gradeColorsActive || !R.cachedTrackPoints) return;
      colorElevationGraph(R.cachedTrackPoints);
      var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas(OVERLAY_CLASS) : null;
      if (graph && graph.canvas) gradeLastCanvasFingerprint = R.canvasFingerprint(graph.canvas);
    }, 300);
  }

  function stopGradeElevationSync() {
    if (gradeElevationPollId) {
      clearInterval(gradeElevationPollId);
      gradeElevationPollId = null;
    }
    gradeLastCanvasFingerprint = "";
  }

  function startGradeElevationSync() {
    stopGradeElevationSync();

    var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas(OVERLAY_CLASS) : null;
    var origCanvas = graph ? graph.canvas : null;
    if (origCanvas) gradeLastCanvasFingerprint = R.canvasFingerprint(origCanvas);

    gradeElevationPollId = setInterval(function () {
      if (!R.gradeColorsActive) {
        stopGradeElevationSync();
        return;
      }

      var activeGraph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas(OVERLAY_CLASS) : null;
      var activeCanvas = activeGraph ? activeGraph.canvas : null;
      if (!activeCanvas) return;

      if (activeCanvas !== origCanvas) {
        origCanvas = activeCanvas;
        gradeLastCanvasFingerprint = "";
        scheduleGradeElevationRedraw();
        return;
      }

      var fp = R.canvasFingerprint(activeCanvas);
      if (fp !== gradeLastCanvasFingerprint) {
        gradeLastCanvasFingerprint = fp;
        scheduleGradeElevationRedraw();
      }
    }, 500);
  }

  // ─── Grade Colors Toggle ────────────────────────────────────────────────

  R.toggleGradeColors = async function () {
    R.gradeColorsActive = !R.gradeColorsActive;

    if (R.gradeColorsActive) {
      await R.enableGradeColors();
    } else {
      R.disableGradeColors();
    }
  };

  R.enableGradeColors = async function () {
    var pageInfo = R.getPageInfo();
    if (!pageInfo) return;

    if (!R.cachedTrackPoints) {
      R.cachedTrackPoints = await R.fetchTrackPoints(pageInfo.type, pageInfo.id);
      if (!R.cachedTrackPoints || R.cachedTrackPoints.length === 0) return;
    }

    R.ensureGradeComputed(R.cachedTrackPoints);

    var segments = R.splitByGradeColor(R.cachedTrackPoints);

    var features = segments.map(function (seg) {
      return {
        type: "Feature",
        properties: { color: seg.color },
        geometry: {
          type: "LineString",
          coordinates: seg.points.map(function (p) { return [p.lng, p.lat]; })
        }
      };
    });

    document.dispatchEvent(new CustomEvent("rwgps-grade-colors-add", {
      detail: JSON.stringify(features)
    }));

    R.retryOverlayRender("gradeColorsActive", function () {
      return colorElevationGraph(R.cachedTrackPoints);
    }, function () {
      startGradeElevationSync();
    });
  };

  R.disableGradeColors = function () {
    stopGradeElevationSync();
    document.dispatchEvent(new CustomEvent("rwgps-grade-colors-remove"));
    removeElevationOverlay();
  };

})(window.RE);
