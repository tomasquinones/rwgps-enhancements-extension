(function (R) {
  "use strict";

  // ─── Speed Color Elevation Graph Overlay ────────────────────────────────
  var speedElevationPollId = null;
  var speedLastCanvasFingerprint = "";

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
    overlay.className = "rwgps-speed-elevation-overlay";
    overlay.width = cw;
    overlay.height = ch;
    var cssWidth = origCanvas.style.width || (origCanvas.offsetWidth + "px");
    var cssHeight = origCanvas.style.height || (origCanvas.offsetHeight + "px");
    overlay.style.cssText = "position:absolute;top:0;left:0;width:" +
      cssWidth + ";height:" + cssHeight +
      ";pointer-events:none;z-index:50;";

    var canvasParent = origCanvas.parentElement;
    var parentPos = window.getComputedStyle(canvasParent);
    if (parentPos.position === "static") canvasParent.style.position = "relative";
    canvasParent.appendChild(overlay);

    var ctx = overlay.getContext("2d");
    if (!ctx) return overlay;

    var maxDist = trackPoints[trackPoints.length - 1].distance;
    if (maxDist === 0) return overlay;

    var stats = R.computeSpeedStats(trackPoints);

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
        var p0i = trackPoints[segIdx];
        var p1i = trackPoints[Math.min(trackPoints.length - 1, segIdx + 1)];
        var speed = ((p0i.speed || 0) + (p1i.speed || 0)) / 2;
        ctx.fillStyle = R.speedToColor(speed, stats.avgSpeed, stats.maxSpeed);
        ctx.fillRect(x, Math.max(plotTopPx, y - 1), 1, 4);
      }
      ctx.restore();
      return overlay;
    }

    ctx.lineWidth = 3;
    ctx.lineCap = "round";

    for (var si = 1; si < trackPoints.length; si++) {
      var p0 = trackPoints[si - 1];
      var p1 = trackPoints[si];
      var x0 = R.projectDistanceToGraphX(p0.distance, projectionLayout, dpr, plotLeftPx, plotRightPx, maxDist);
      var x1 = R.projectDistanceToGraphX(p1.distance, projectionLayout, dpr, plotLeftPx, plotRightPx, maxDist);
      var y0 = R.projectElevationToGraphY(p0.ele, projectionLayout, dpr, plotTopPx, plotBottomPx, minEle, maxEle);
      var y1 = R.projectElevationToGraphY(p1.ele, projectionLayout, dpr, plotTopPx, plotBottomPx, minEle, maxEle);
      if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(y0) || !Number.isFinite(y1)) continue;

      var speed = ((p0.speed || 0) + (p1.speed || 0)) / 2;
      ctx.strokeStyle = R.speedToColor(speed, stats.avgSpeed, stats.maxSpeed);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.restore();

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
