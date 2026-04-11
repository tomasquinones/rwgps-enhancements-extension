(function (R) {
  "use strict";

  // ─── Speed Color Elevation Graph Overlay ────────────────────────────────

  function colorElevationGraph(trackPoints) {
    var origCanvas = null;
    var graphContainer = null;
    var candidates = document.querySelectorAll('[class*="SampleGraph"]');
    for (var ci = 0; ci < candidates.length; ci++) {
      var c = candidates[ci].querySelector("canvas");
      if (c) {
        origCanvas = c;
        graphContainer = candidates[ci];
        break;
      }
    }
    if (!origCanvas || !graphContainer) return null;

    var existing = graphContainer.querySelector(".rwgps-speed-elevation-overlay");
    if (existing) existing.remove();

    var origCtx = origCanvas.getContext("2d", { willReadFrequently: true });
    if (!origCtx) return null;

    var cw = origCanvas.width;
    var ch = origCanvas.height;
    if (cw === 0 || ch === 0) return null;
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

    if (fillRight <= fillLeft || fillBottom <= fillTop) return null;

    var plotLeftPx = fillLeft;
    var plotRightPx = fillRight;
    var plotBottomPx = fillBottom;

    var centerX = Math.floor((plotLeftPx + plotRightPx) / 2);
    var plotTopPx = fillTop;

    var overlay = document.createElement("canvas");
    overlay.className = "rwgps-speed-elevation-overlay";
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

    var ctx = overlay.getContext("2d");
    if (!ctx) return overlay;

    var plotWidthPx = plotRightPx - plotLeftPx;

    var maxDist = trackPoints[trackPoints.length - 1].distance;
    if (maxDist === 0) return overlay;

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

      var bestRunTop = -1, bestRunBottom = -1, bestRunLen = 0;
      var runTop = -1, runLen = 0;
      for (var cy = 0; cy < ch; cy++) {
        if (isFilledPixel(cx2, cy)) {
          if (runTop < 0) runTop = cy;
          runLen++;
        } else {
          if (runLen > bestRunLen) {
            bestRunTop = runTop;
            bestRunBottom = cy - 1;
            bestRunLen = runLen;
          }
          runTop = -1;
          runLen = 0;
        }
      }
      if (runLen > bestRunLen) {
        bestRunTop = runTop;
        bestRunBottom = ch - 1;
        bestRunLen = runLen;
      }

      if (bestRunTop >= 0 && bestRunLen > 2) {
        ctx.fillStyle = color;
        ctx.fillRect(cx2, bestRunTop, 1, bestRunLen);
      }
    }

    return overlay;
  }

  function removeElevationOverlay() {
    var overlay = document.querySelector(".rwgps-speed-elevation-overlay");
    if (overlay) overlay.remove();
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
    var pageInfo = R.getPageInfo();
    if (!pageInfo) return;

    if (!R.cachedTrackPoints) {
      R.cachedTrackPoints = await R.fetchTrackPoints(pageInfo.type, pageInfo.id);
      if (!R.cachedTrackPoints || R.cachedTrackPoints.length === 0) return;
    }

    if (!R.cachedSegments) {
      R.cachedSegments = R.splitBySpeedColor(R.cachedTrackPoints);
    }

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
    });
  };

  R.disableSpeedColors = function () {
    document.dispatchEvent(new CustomEvent("rwgps-speed-colors-remove"));
    removeElevationOverlay();
  };

})(window.RE);
