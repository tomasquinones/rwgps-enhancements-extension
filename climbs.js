(function (R) {
  "use strict";

  // ─── Climb Elevation Graph Overlay ──────────────────────────────────────

  var climbElevationPollId = null;
  var climbElevationListeners = null;
  var lastCanvasFingerprint = "";

  function renderClimbElevationOverlay(trackPoints, climbs) {
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

    var existing = graphContainer.querySelector(".rwgps-climb-elevation-overlay");
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
    overlay.className = "rwgps-climb-elevation-overlay";
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

    var climbRanges = climbs.map(function (hill) {
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

      var inClimb = null;
      for (var ci2 = 0; ci2 < climbRanges.length; ci2++) {
        if (dist >= climbRanges[ci2].startDist && dist <= climbRanges[ci2].endDist) {
          inClimb = climbRanges[ci2];
          break;
        }
      }
      if (!inClimb) continue;

      var eleRange = inClimb.endEle - inClimb.startEle;
      var t = 0.5;
      if (eleRange !== 0) {
        while (ptIdx < trackPoints.length - 1 && trackPoints[ptIdx + 1].distance < dist) {
          ptIdx++;
        }
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
      var candidates = document.querySelectorAll('[class*="SampleGraph"]');
      for (var ci = 0; ci < candidates.length; ci++) {
        var c = candidates[ci].querySelector("canvas:not(.rwgps-climb-elevation-overlay)");
        if (c) { lastCanvasFingerprint = R.canvasFingerprint(c); break; }
      }
    }, 400);
  }

  function startClimbElevationSync() {
    stopClimbElevationSync();

    var graphContainer = null;
    var candidates = document.querySelectorAll('[class*="SampleGraph"]');
    for (var ci = 0; ci < candidates.length; ci++) {
      if (candidates[ci].querySelector("canvas")) {
        graphContainer = candidates[ci];
        break;
      }
    }

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

    var origCanvas = graphContainer ? graphContainer.querySelector("canvas:not(.rwgps-climb-elevation-overlay)") : null;
    if (origCanvas) {
      lastCanvasFingerprint = R.canvasFingerprint(origCanvas);
    }
    climbElevationPollId = setInterval(function () {
      if (!R.climbElevationActive) { stopClimbElevationSync(); return; }
      if (!origCanvas || !origCanvas.isConnected) {
        var c2 = document.querySelectorAll('[class*="SampleGraph"]');
        for (var i = 0; i < c2.length; i++) {
          var found = c2[i].querySelector("canvas:not(.rwgps-climb-elevation-overlay)");
          if (found) { origCanvas = found; break; }
        }
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

  function insertClimbsPill() {
    if (document.querySelector(".rwgps-climbs-pill")) return;

    var sgControls = document.querySelector('[class*="sgControls"]');
    if (!sgControls) return;

    var pillGroup = sgControls.querySelector('[class*="PillGroup"]');
    if (!pillGroup) return;

    var pill = document.createElement("div");
    pill.className = "rwgps-climbs-pill" + (R.climbElevationActive ? " rwgps-climbs-pill-selected" : "");
    pill.textContent = "Climbs";
    pill.addEventListener("click", function () {
      R.toggleClimbElevation();
      pill.classList.toggle("rwgps-climbs-pill-selected", R.climbElevationActive);
    });

    pillGroup.appendChild(pill);
  }

  R.removeClimbsPill = function () {
    var pill = document.querySelector(".rwgps-climbs-pill");
    if (pill) pill.remove();
  };

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

    insertClimbsPill();

    R.climbElevationActive = true;
    R.enableClimbElevation();
  };

  R.disableClimbs = function () {
    document.dispatchEvent(new CustomEvent("rwgps-climbs-remove"));
    removeClimbElevationOverlay();
    R.removeClimbsPill();
    R.climbElevationActive = false;
  };

  R.toggleClimbLabels = function () {
    R.climbLabelsVisible = !R.climbLabelsVisible;
    document.dispatchEvent(new CustomEvent("rwgps-hill-labels-toggle", {
      detail: JSON.stringify({ prefix: "rwgps-climbs", visible: R.climbLabelsVisible })
    }));
  };

  R.toggleClimbElevation = function () {
    R.climbElevationActive = !R.climbElevationActive;
    if (R.climbElevationActive) {
      R.enableClimbElevation();
    } else {
      removeClimbElevationOverlay();
    }
    var pill = document.querySelector(".rwgps-climbs-pill");
    if (pill) pill.classList.toggle("rwgps-climbs-pill-selected", R.climbElevationActive);
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
