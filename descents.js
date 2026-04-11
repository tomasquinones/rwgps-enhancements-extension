(function (R) {
  "use strict";

  // ─── Descent Elevation Graph Overlay ───────────────────────────────────

  var descentElevationPollId = null;
  var descentElevationListeners = null;
  var lastCanvasFingerprint = "";

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
    overlay.className = "rwgps-descent-elevation-overlay";
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
    for (var hi = 0; hi < descents.length; hi++) {
      var hill = descents[hi];
      var startEle = trackPoints[hill.first_i].ele;
      var endEle = trackPoints[hill.last_i].ele;
      var eleRange = endEle - startEle;
      for (var si = hill.first_i; si < hill.last_i; si++) {
        var midEle = (trackPoints[si].ele + trackPoints[si + 1].ele) / 2;
        var t = eleRange !== 0 ? Math.max(0, Math.min(1, (midEle - startEle) / eleRange)) : 0.5;
        if (eleRange < 0) t = 1 - t;
        segColors[si] = R.hillGradientColor(t, R.DESCENT_COLOR_HIGH, R.DESCENT_COLOR_LOW);
      }
    }

    function distAtCanvasX(x) {
      var xp = projectionLayout && projectionLayout.xProjection;
      if (xp && Number.isFinite(xp.vScale) && xp.vScale !== 0 && Number.isFinite(xp.v0) && Number.isFinite(xp.pixelOffset)) {
        var cssPx = x / dpr;
        return xp.v0 + ((cssPx - xp.pixelOffset) / xp.vScale);
      }
      if (plotRightPx <= plotLeftPx) return 0;
      return ((x - plotLeftPx) / (plotRightPx - plotLeftPx)) * maxDist;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeftPx, plotTopPx, Math.max(1, plotRightPx - plotLeftPx), Math.max(1, plotBottomPx - plotTopPx));
    ctx.clip();
    ctx.globalAlpha = 0.9;

    if (inkProfile && inkProfile.coverage >= 0.12) {
      var descentRanges = descents.map(function (hill) {
        return {
          startDist: trackPoints[hill.first_i].distance,
          endDist: trackPoints[hill.last_i].distance,
          startEle: trackPoints[hill.first_i].ele,
          endEle: trackPoints[hill.last_i].ele
        };
      });
      var hillIdx = 0;
      var ptIdx = 0;
      for (var x = inkProfile.left; x <= inkProfile.right; x++) {
        var y = inkProfile.yByX[x - inkProfile.left];
        if (!Number.isFinite(y)) continue;
        var dist = Math.max(0, Math.min(maxDist, distAtCanvasX(x)));
        while (hillIdx < descentRanges.length && dist > descentRanges[hillIdx].endDist) hillIdx++;
        if (hillIdx >= descentRanges.length) break;
        var hr = descentRanges[hillIdx];
        if (dist < hr.startDist || dist > hr.endDist) continue;

        while (ptIdx < trackPoints.length - 1 && trackPoints[ptIdx + 1].distance < dist) {
          ptIdx++;
        }
        var ele = trackPoints[ptIdx].ele;
        var eleRange = hr.endEle - hr.startEle;
        var t = eleRange !== 0 ? Math.max(0, Math.min(1, (ele - hr.startEle) / eleRange)) : 0.5;
        if (eleRange < 0) t = 1 - t;

        ctx.fillStyle = R.hillGradientColor(t, R.DESCENT_COLOR_HIGH, R.DESCENT_COLOR_LOW);
        ctx.fillRect(x, Math.max(plotTopPx, y - 1), 1, 3);
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

  function colorDescentsOnElevation(trackPoints, descents) {
    var overlay = renderDescentElevationOverlay(trackPoints, descents);
    startDescentElevationSync();
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
    if (R.loadColorSettings) {
      await R.loadColorSettings();
    }

    var pageInfo = R.getPageInfo();
    if (!pageInfo) return;

    if (!R.cachedTrackPoints) {
      R.cachedTrackPoints = await R.fetchTrackPoints(pageInfo.type, pageInfo.id);
      if (!R.cachedTrackPoints || R.cachedTrackPoints.length === 0) return;
    }

    if (!R.cachedDescents) {
      R.cachedDescents = R.findDescents(R.cachedTrackPoints);
    }

    if (R.cachedDescents.length === 0) return;

    var features = R.buildHillFeatures(R.cachedDescents, R.cachedTrackPoints, R.DESCENT_COLOR_HIGH, R.DESCENT_COLOR_LOW);
    document.dispatchEvent(new CustomEvent("rwgps-descents-add", {
      detail: JSON.stringify(features)
    }));

    insertDescentsPill();

    R.descentElevationActive = true;
    R.enableDescentElevation();
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

  // Backward-compatible alias
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
