(function (R) {
  "use strict";

  // ─── Descent Elevation Graph Overlay ───────────────────────────────────

  var descentElevationPollId = null;
  var descentElevationListeners = null;
  var lastCanvasFingerprint = "";

  function renderDescentElevationOverlay(trackPoints, descents) {
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

    var existing = graphContainer.querySelector(".rwgps-descent-elevation-overlay");
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
    var plotWidthPx = plotRightPx - plotLeftPx;

    var layout = R.getGraphLayout();
    var maxDist = trackPoints[trackPoints.length - 1].distance;

    var useProjection = layout && layout.xProjection && layout.xProjection.vScale;
    var xProj = useProjection ? layout.xProjection : null;

    var offsetWidth = origCanvas.offsetWidth || origCanvas.clientWidth || (cw / 2);
    var dpr = cw / offsetWidth;

    var overlay = document.createElement("canvas");
    overlay.className = "rwgps-descent-elevation-overlay";
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

    var ctx = overlay.getContext("2d");
    if (!ctx) return overlay;

    if (maxDist === 0) return overlay;

    var descentRanges = descents.map(function (hill) {
      return {
        startDist: trackPoints[hill.first_i].distance,
        endDist: trackPoints[hill.last_i].distance,
        startEle: trackPoints[hill.first_i].ele,
        endEle: trackPoints[hill.last_i].ele
      };
    });

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
      for (var ci2 = 0; ci2 < descentRanges.length; ci2++) {
        if (dist >= descentRanges[ci2].startDist && dist <= descentRanges[ci2].endDist) {
          inDescent = descentRanges[ci2];
          break;
        }
      }
      if (!inDescent) continue;

      var eleRange = inDescent.endEle - inDescent.startEle;
      var t = 0.5;
      if (eleRange !== 0) {
        while (ptIdx < trackPoints.length - 1 && trackPoints[ptIdx + 1].distance < dist) {
          ptIdx++;
        }
        var ele = trackPoints[ptIdx].ele;
        t = Math.max(0, Math.min(1, (ele - inDescent.startEle) / Math.abs(eleRange)));
      }
      var color = R.hillGradientColor(t, R.DESCENT_COLOR_HIGH, R.DESCENT_COLOR_LOW);

      var bestRunTop = -1, bestRunLen = 0;
      var runTop = -1, runLen = 0;
      for (var cy = 0; cy < ch; cy++) {
        if (isFilledPixel(cx2, cy)) {
          if (runTop < 0) runTop = cy;
          runLen++;
        } else {
          if (runLen > bestRunLen) {
            bestRunTop = runTop;
            bestRunLen = runLen;
          }
          runTop = -1;
          runLen = 0;
        }
      }
      if (runLen > bestRunLen) {
        bestRunTop = runTop;
        bestRunLen = runLen;
      }

      if (bestRunTop >= 0 && bestRunLen > 2) {
        ctx.fillStyle = color;
        ctx.fillRect(cx2, bestRunTop, 1, bestRunLen);
      }
    }

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
      var candidates = document.querySelectorAll('[class*="SampleGraph"]');
      for (var ci = 0; ci < candidates.length; ci++) {
        var c = candidates[ci].querySelector("canvas:not(.rwgps-descent-elevation-overlay)");
        if (c) { lastCanvasFingerprint = R.canvasFingerprint(c); break; }
      }
    }, 400);
  }

  function startDescentElevationSync() {
    stopDescentElevationSync();

    var graphContainer = null;
    var candidates = document.querySelectorAll('[class*="SampleGraph"]');
    for (var ci = 0; ci < candidates.length; ci++) {
      if (candidates[ci].querySelector("canvas")) {
        graphContainer = candidates[ci];
        break;
      }
    }

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

    var origCanvas = graphContainer ? graphContainer.querySelector("canvas:not(.rwgps-descent-elevation-overlay)") : null;
    if (origCanvas) {
      lastCanvasFingerprint = R.canvasFingerprint(origCanvas);
    }
    descentElevationPollId = setInterval(function () {
      if (!R.descentElevationActive) { stopDescentElevationSync(); return; }
      if (!origCanvas || !origCanvas.isConnected) {
        var c2 = document.querySelectorAll('[class*="SampleGraph"]');
        for (var i = 0; i < c2.length; i++) {
          var found = c2[i].querySelector("canvas:not(.rwgps-descent-elevation-overlay)");
          if (found) { origCanvas = found; break; }
        }
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

  R.toggleDescentLabels = function () {
    R.descentLabelsVisible = !R.descentLabelsVisible;
    document.dispatchEvent(new CustomEvent("rwgps-hill-labels-toggle", {
      detail: JSON.stringify({ prefix: "rwgps-descents", visible: R.descentLabelsVisible })
    }));
  };

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
