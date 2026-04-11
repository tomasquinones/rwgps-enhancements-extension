(function (R) {
  "use strict";

  // ─── Speed Color Elevation Graph Overlay ────────────────────────────────
  var speedElevationPollId = null;
  var speedLastCanvasFingerprint = "";

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
    var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-speed-elevation-overlay") : null;
    var origCanvas = graph ? graph.canvas : null;
    var graphContainer = graph ? graph.container : null;
    if (!origCanvas || !graphContainer) return null;

    var existing = graphContainer.querySelector(".rwgps-speed-elevation-overlay");
    if (existing) existing.remove();

    var cw = origCanvas.width;
    var ch = origCanvas.height;
    if (cw === 0 || ch === 0) return null;

    var maxDist = trackPoints[trackPoints.length - 1].distance;
    if (maxDist === 0) return null;

    // Try pixel-scanning approach first
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

    var overlay = createOverlayCanvas(origCanvas, "rwgps-speed-elevation-overlay");
    var ctx = overlay.getContext("2d");
    if (!ctx) return overlay;

    var stats = R.computeSpeedStats(trackPoints);
    var ptIdx = 0;
    ctx.globalAlpha = 0.6;

    for (var cx2 = plotLeftPx; cx2 <= plotRightPx; cx2++) {
      var dist = ((cx2 - plotLeftPx) / plotWidthPx) * maxDist;
      while (ptIdx < trackPoints.length - 1 && trackPoints[ptIdx + 1].distance < dist) {
        ptIdx++;
      }
      var speed = trackPoints[ptIdx].speed || 0;
      var color = R.speedToColor(speed, stats.avgSpeed, stats.maxSpeed);

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

    // Estimate plot rect from typical RWGPS graph padding if layout unavailable
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
    // Add a small padding to elevation range so the fill doesn't touch edges
    var eleRange = maxEle - minEle;
    if (eleRange < 1) eleRange = 1;
    var elePad = eleRange * 0.05;
    minEle -= elePad;
    maxEle += elePad;

    var overlay = createOverlayCanvas(origCanvas, "rwgps-speed-elevation-overlay");
    var ctx = overlay.getContext("2d");
    if (!ctx) return overlay;

    var stats = R.computeSpeedStats(trackPoints);
    ctx.globalAlpha = 0.6;

    var plotLeft = plotRect.left;
    var plotRight = plotRect.right;
    var plotTop = plotRect.top;
    var plotBottom = plotRect.bottom;
    var plotWidth = plotRight - plotLeft;
    var plotHeight = plotBottom - plotTop;

    // Draw column by column: for each x pixel, find the elevation at that distance,
    // and fill from the elevation y down to the plot bottom
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
      // Interpolate elevation between ptIdx and ptIdx+1
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

      var speed = trackPoints[ptIdx].speed || 0;
      var color = R.speedToColor(speed, stats.avgSpeed, stats.maxSpeed);
      ctx.fillStyle = color;
      ctx.fillRect(cx2, yTop, 1, plotBottom - yTop);
    }
    return overlay;
  }

  function removeElevationOverlay() {
    var overlay = document.querySelector(".rwgps-speed-elevation-overlay");
    if (overlay) overlay.remove();
  }

  function scheduleSpeedElevationRedraw() {
    if (!R.speedColorsActive || !R.cachedTrackPoints) return;
    setTimeout(function () {
      if (!R.speedColorsActive || !R.cachedTrackPoints) return;
      colorElevationGraph(R.cachedTrackPoints);
      var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-speed-elevation-overlay") : null;
      if (graph && graph.canvas) speedLastCanvasFingerprint = R.canvasFingerprint(graph.canvas);
    }, 300);
  }

  function stopSpeedElevationSync() {
    if (speedElevationPollId) {
      clearInterval(speedElevationPollId);
      speedElevationPollId = null;
    }
    speedLastCanvasFingerprint = "";
  }

  function startSpeedElevationSync() {
    stopSpeedElevationSync();

    var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-speed-elevation-overlay") : null;
    var origCanvas = graph ? graph.canvas : null;
    if (origCanvas) speedLastCanvasFingerprint = R.canvasFingerprint(origCanvas);

    speedElevationPollId = setInterval(function () {
      if (!R.speedColorsActive) {
        stopSpeedElevationSync();
        return;
      }

      var activeGraph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas("rwgps-speed-elevation-overlay") : null;
      var activeCanvas = activeGraph ? activeGraph.canvas : null;
      if (!activeCanvas) return;

      if (activeCanvas !== origCanvas) {
        origCanvas = activeCanvas;
        speedLastCanvasFingerprint = "";
        scheduleSpeedElevationRedraw();
        return;
      }

      var fp = R.canvasFingerprint(activeCanvas);
      if (fp !== speedLastCanvasFingerprint) {
        speedLastCanvasFingerprint = fp;
        scheduleSpeedElevationRedraw();
      }
    }, 500);
  }

  // ─── Speed Colors Toggle ────────────────────────────────────────────────

  R.toggleSpeedColors = async function () {
    R.speedColorsActive = !R.speedColorsActive;

    if (R.speedColorsActive) {
      await R.enableSpeedColors();
    } else {
      R.disableSpeedColors();
    }
  };

  R.enableSpeedColors = async function () {
    if (R.loadColorSettings) {
      await R.loadColorSettings();
    }

    var pageInfo = R.getPageInfo();
    if (!pageInfo) return;

    if (!R.cachedTrackPoints) {
      R.cachedTrackPoints = await R.fetchTrackPoints(pageInfo.type, pageInfo.id);
      if (!R.cachedTrackPoints || R.cachedTrackPoints.length === 0) return;
    }

    R.cachedSegments = R.splitBySpeedColor(R.cachedTrackPoints);

    var features = R.cachedSegments.map(function (seg) {
      return {
        type: "Feature",
        properties: { color: seg.color },
        geometry: {
          type: "LineString",
          coordinates: seg.points.map(function (p) { return [p.lng, p.lat]; })
        }
      };
    });

    document.dispatchEvent(new CustomEvent("rwgps-speed-colors-add", {
      detail: JSON.stringify(features)
    }));

    R.retryOverlayRender("speedColorsActive", function () {
      return colorElevationGraph(R.cachedTrackPoints);
    }, function () {
      startSpeedElevationSync();
    });
  };

  R.disableSpeedColors = function () {
    stopSpeedElevationSync();
    document.dispatchEvent(new CustomEvent("rwgps-speed-colors-remove"));
    removeElevationOverlay();
  };

})(window.RE);
