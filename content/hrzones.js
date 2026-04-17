(function (R) {
  "use strict";

  // ─── Heart Rate Zone Overlay on Elevation Graph ─────────────────────────

  var ZONE_COLORS = [
    "#4caf50", // Zone 1 – green
    "#8bc34a", // Zone 2 – light green
    "#ffeb3b", // Zone 3 – yellow
    "#ff9800", // Zone 4 – orange
    "#f44336"  // Zone 5 – red
  ];

  // Zone thresholds as percentage of max HR (upper bound for each zone)
  var ZONE_THRESHOLDS = [0.60, 0.70, 0.80, 0.90, 1.00];

  var hrZonePollId = null;
  var hrZoneListeners = null;
  var lastCanvasFingerprint = "";
  var OVERLAY_CLASS = "rwgps-hr-zone-overlay";

  function classifyZone(hr, maxHr) {
    if (maxHr <= 0 || hr <= 0) return -1;
    var pct = hr / maxHr;
    for (var i = 0; i < ZONE_THRESHOLDS.length; i++) {
      if (pct <= ZONE_THRESHOLDS[i]) return i;
    }
    return 4; // zone 5 for anything above 100%
  }

  function buildZoneSegments(trackPoints, maxHr) {
    // Build contiguous segments where consecutive points are in the same zone
    var segments = []; // { zone, startDist, endDist }
    var currentZone = -1;
    var segStart = 0;

    for (var i = 0; i < trackPoints.length; i++) {
      var z = classifyZone(trackPoints[i].hr, maxHr);
      if (z !== currentZone) {
        if (currentZone >= 0 && i > 0) {
          segments.push({
            zone: currentZone,
            startDist: trackPoints[segStart].distance,
            endDist: trackPoints[i - 1].distance
          });
        }
        currentZone = z;
        segStart = i;
      }
    }
    // Close last segment
    if (currentZone >= 0 && trackPoints.length > 0) {
      segments.push({
        zone: currentZone,
        startDist: trackPoints[segStart].distance,
        endDist: trackPoints[trackPoints.length - 1].distance
      });
    }
    return segments;
  }

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
      ";pointer-events:none;z-index:3;";
    var canvasParent = origCanvas.parentElement;
    var parentPos = window.getComputedStyle(canvasParent);
    if (parentPos.position === "static") canvasParent.style.position = "relative";
    canvasParent.appendChild(overlay);
    return overlay;
  }

  function getPlotBounds(origCanvas) {
    var cw = origCanvas.width;
    var ch = origCanvas.height;
    var offsetWidth = origCanvas.offsetWidth || origCanvas.clientWidth || (cw / 2);
    var dpr = cw / offsetWidth;

    // Try pixel scanning first to find the actual ink bounds
    var origCtx = origCanvas.getContext("2d", { willReadFrequently: true });
    if (origCtx) {
      try {
        var imageData = origCtx.getImageData(0, 0, cw, ch);
        var pixels = imageData.data;
        var fillTop = ch, fillBottom = 0, fillLeft = cw, fillRight = 0;
        for (var sy = 0; sy < ch; sy += 2) {
          for (var sx = 0; sx < cw; sx += 2) {
            var idx = (sy * cw + sx) * 4;
            var a = pixels[idx + 3];
            if (a < 30) continue;
            var r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
            if (r > 240 && g > 240 && b > 240) continue;
            if (sy < fillTop) fillTop = sy;
            if (sy > fillBottom) fillBottom = sy;
            if (sx < fillLeft) fillLeft = sx;
            if (sx > fillRight) fillRight = sx;
          }
        }
        if (fillRight > fillLeft && fillBottom > fillTop) {
          return { left: fillLeft, right: fillRight, top: fillTop, bottom: fillBottom, dpr: dpr };
        }
      } catch (e) {
        // tainted canvas, fall through to projection
      }
    }

    // Fallback: use graph layout projection
    var layout = R.getGraphLayout();
    var plotRect = R.getGraphPlotRect ? R.getGraphPlotRect(layout, cw, ch, dpr) : null;
    if (plotRect && plotRect.right > plotRect.left && plotRect.bottom > plotRect.top) {
      return { left: plotRect.left, right: plotRect.right, top: plotRect.top, bottom: plotRect.bottom, dpr: dpr };
    }

    // Last resort: estimated margins
    var padLeft = Math.round(45 * dpr);
    var padRight = Math.round(10 * dpr);
    var padTop = Math.round(10 * dpr);
    var padBottom = Math.round(25 * dpr);
    return { left: padLeft, right: cw - padRight, top: padTop, bottom: ch - padBottom, dpr: dpr };
  }

  function distToX(dist, maxDist, plotLeft, plotRight, layout, dpr) {
    if (layout && layout.xProjection && layout.xProjection.vScale) {
      var xProj = layout.xProjection;
      var cssPx = (dist - xProj.v0) * xProj.vScale + xProj.pixelOffset;
      return cssPx * dpr;
    }
    var plotWidth = plotRight - plotLeft;
    return plotLeft + (dist / maxDist) * plotWidth;
  }

  function renderHrZoneOverlay(trackPoints) {
    var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas(OVERLAY_CLASS) : null;
    var origCanvas = graph ? graph.canvas : null;
    var graphContainer = graph ? graph.container : null;
    if (!origCanvas || !graphContainer) return null;

    var existing = graphContainer.querySelector("." + OVERLAY_CLASS);
    if (existing) existing.remove();

    var cw = origCanvas.width;
    var ch = origCanvas.height;
    if (cw === 0 || ch === 0) return null;

    // Find min/max HR in data
    var maxHr = 0;
    var minHr = Infinity;
    var hasHr = false;
    for (var i = 0; i < trackPoints.length; i++) {
      if (trackPoints[i].hr > 0) {
        hasHr = true;
        if (trackPoints[i].hr > maxHr) maxHr = trackPoints[i].hr;
        if (trackPoints[i].hr < minHr) minHr = trackPoints[i].hr;
      }
    }
    if (!hasHr || maxHr <= 0) return null;
    if (minHr === Infinity) minHr = 0;

    var maxDist = trackPoints[trackPoints.length - 1].distance;
    if (maxDist === 0) return null;

    var segments = buildZoneSegments(trackPoints, maxHr);
    if (segments.length === 0) return null;

    var bounds = getPlotBounds(origCanvas);
    if (!bounds || bounds.right <= bounds.left || bounds.bottom <= bounds.top) return null;

    var layout = R.getGraphLayout();
    var overlay = createOverlayCanvas(origCanvas, OVERLAY_CLASS);
    var ctx = overlay.getContext("2d");
    if (!ctx) return overlay;

    var plotHeight = bounds.bottom - bounds.top;
    var dpr = bounds.dpr || 1;

    // Zone HR boundaries: each zone spans from its lower threshold to upper threshold
    // Zone 1: 0–60%, Zone 2: 60–70%, Zone 3: 70–80%, Zone 4: 80–90%, Zone 5: 90–100%
    var ZONE_LOWER = [0, 0.60, 0.70, 0.80, 0.90];

    // Map HR value to Y pixel using the graph's HR projection if available
    // The graph's Y-axis for HR spans from a padded min to padded max of the data,
    // not from 0. Add ~10% padding to match RWGPS graph axis padding.
    var hrProj = layout && layout.hrProjection;
    var hrRange = maxHr - minHr;
    var hrPad = Math.max(5, hrRange * 0.10);
    var axisMinHr = minHr - hrPad;
    var axisMaxHr = maxHr + hrPad;
    function hrToY(hr) {
      if (hrProj && Number.isFinite(hrProj.vScale) && hrProj.vScale !== 0 &&
          Number.isFinite(hrProj.v0) && Number.isFinite(hrProj.pixelOffset)) {
        var delta = (hr - hrProj.v0) * hrProj.vScale;
        var yCss = hrProj.invert ? (hrProj.pixelOffset - delta) : (hrProj.pixelOffset + delta);
        return yCss * dpr;
      }
      // Fallback: linear mapping matching the graph's visible HR axis range
      var t = axisMaxHr > axisMinHr ? (hr - axisMinHr) / (axisMaxHr - axisMinHr) : 0.5;
      return bounds.bottom - t * plotHeight;
    }

    var minBarHeight = Math.max(2, Math.round(3 * dpr));

    ctx.globalAlpha = 0.85;

    for (var si = 0; si < segments.length; si++) {
      var seg = segments[si];
      if (seg.zone < 0) continue;

      var x1 = distToX(seg.startDist, maxDist, bounds.left, bounds.right, layout, bounds.dpr);
      var x2 = distToX(seg.endDist, maxDist, bounds.left, bounds.right, layout, bounds.dpr);

      var w = x2 - x1;
      if (w < minBarHeight) {
        var center = (x1 + x2) / 2;
        x1 = center - minBarHeight / 2;
        x2 = center + minBarHeight / 2;
        w = minBarHeight;
      }

      // Bar spans the HR range for this zone, clamped to visible plot area
      var zoneLowerHr = Math.max(ZONE_LOWER[seg.zone] * maxHr, axisMinHr);
      var zoneUpperHr = Math.min(ZONE_THRESHOLDS[seg.zone] * maxHr, axisMaxHr);
      var yTop = Math.max(hrToY(zoneUpperHr), bounds.top);
      var yBottom = Math.min(hrToY(zoneLowerHr), bounds.bottom);
      var barH = Math.max(minBarHeight, yBottom - yTop);

      ctx.fillStyle = ZONE_COLORS[seg.zone];
      ctx.fillRect(x1, yTop, w, barH);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1 * dpr;
      ctx.strokeRect(x1, yTop, w, barH);
    }

    return overlay;
  }

  // ─── Sync / Polling ─────────────────────────────────────────────────────

  function scheduleHrZoneRedraw() {
    if (!R.hrZonesActive || !R.cachedTrackPoints) return;
    setTimeout(function () {
      if (!R.hrZonesActive || !R.cachedTrackPoints) return;
      renderHrZoneOverlay(R.cachedTrackPoints);
      var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas(OVERLAY_CLASS) : null;
      if (graph && graph.canvas) lastCanvasFingerprint = R.canvasFingerprint(graph.canvas);
    }, 400);
  }

  function startHrZoneSync() {
    stopHrZoneSync();

    var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas(OVERLAY_CLASS) : null;
    var graphContainer = graph ? graph.container : null;

    var onMouseUp = function () { scheduleHrZoneRedraw(); };
    if (graphContainer) {
      graphContainer.addEventListener("mouseup", onMouseUp);
      graphContainer.addEventListener("pointerup", onMouseUp);
    }
    var bottomPanel = graphContainer ? graphContainer.closest('[class*="BottomPanel"]') || graphContainer.parentElement : null;
    if (bottomPanel) {
      bottomPanel.addEventListener("click", onMouseUp);
    }

    hrZoneListeners = {
      graphContainer: graphContainer,
      bottomPanel: bottomPanel,
      onMouseUp: onMouseUp
    };

    var origCanvas = graph ? graph.canvas : null;
    if (origCanvas) {
      lastCanvasFingerprint = R.canvasFingerprint(origCanvas);
    }
    hrZonePollId = setInterval(function () {
      if (!R.hrZonesActive) { stopHrZoneSync(); return; }
      var activeGraph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas(OVERLAY_CLASS) : null;
      var activeCanvas = activeGraph ? activeGraph.canvas : null;
      if (activeCanvas && activeCanvas !== origCanvas) {
        origCanvas = activeCanvas;
        lastCanvasFingerprint = "";
        scheduleHrZoneRedraw();
        return;
      }
      if (!origCanvas || !origCanvas.isConnected) {
        var foundGraph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas(OVERLAY_CLASS) : null;
        if (foundGraph && foundGraph.canvas) origCanvas = foundGraph.canvas;
        if (!origCanvas || !origCanvas.isConnected) return;
        lastCanvasFingerprint = "";
      }
      var fp = R.canvasFingerprint(origCanvas);
      if (fp !== lastCanvasFingerprint) {
        lastCanvasFingerprint = fp;
        scheduleHrZoneRedraw();
      }
    }, 500);
  }

  function stopHrZoneSync() {
    if (hrZoneListeners) {
      var l = hrZoneListeners;
      if (l.graphContainer) {
        l.graphContainer.removeEventListener("mouseup", l.onMouseUp);
        l.graphContainer.removeEventListener("pointerup", l.onMouseUp);
      }
      if (l.bottomPanel) {
        l.bottomPanel.removeEventListener("click", l.onMouseUp);
      }
      hrZoneListeners = null;
    }
    if (hrZonePollId) {
      clearInterval(hrZonePollId);
      hrZonePollId = null;
    }
    lastCanvasFingerprint = "";
  }

  function removeHrZoneOverlay() {
    stopHrZoneSync();
    var overlay = document.querySelector("." + OVERLAY_CLASS);
    if (overlay) overlay.remove();
  }

  // ─── Tooltip Zone Injection ──────────────────────────────────────────────

  var tooltipObserver = null;
  var cachedMaxHr = 0;

  var ZONE_LABELS = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"];
  var ZONE_LABEL_COLORS = [
    "#3d8b40", // Zone 1 – darker green for readability
    "#6b9e00", // Zone 2 – darker light green
    "#d6a800", // Zone 3 – darker yellow
    "#e67e00", // Zone 4 – darker orange
    "#d32f2f"  // Zone 5 – darker red
  ];

  function injectZoneIntoTooltip(detailsEl) {
    if (!detailsEl || cachedMaxHr <= 0) return;

    // Remove any previously injected zone line
    var existing = detailsEl.querySelector(".rwgps-hr-zone-label");
    if (existing) existing.remove();

    // Parse HR value from tooltip text – look for a number followed by "bpm"
    var text = detailsEl.textContent || "";
    var hrMatch = text.match(/(\d+)\s*bpm/i);
    if (!hrMatch) return;

    var hr = parseInt(hrMatch[1], 10);
    if (hr <= 0) return;

    var zone = classifyZone(hr, cachedMaxHr);
    if (zone < 0) return;

    // Find the element that contains the bpm text to insert after it
    var children = detailsEl.querySelectorAll("*");
    var bpmParent = null;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      // Only check leaf-level text nodes
      if (child.children && child.children.length === 0 && /\d+\s*bpm/i.test(child.textContent)) {
        bpmParent = child;
      }
    }

    var zoneLine = document.createElement("div");
    zoneLine.className = "rwgps-hr-zone-label";
    zoneLine.style.cssText = "color:" + ZONE_LABEL_COLORS[zone] + ";font-weight:600;";
    zoneLine.textContent = ZONE_LABELS[zone];

    if (bpmParent && bpmParent.parentElement === detailsEl) {
      // Insert right after the bpm line
      if (bpmParent.nextSibling) {
        detailsEl.insertBefore(zoneLine, bpmParent.nextSibling);
      } else {
        detailsEl.appendChild(zoneLine);
      }
    } else {
      detailsEl.appendChild(zoneLine);
    }
  }

  function startTooltipObserver() {
    stopTooltipObserver();

    // Compute max HR for zone classification
    if (R.cachedTrackPoints) {
      cachedMaxHr = 0;
      for (var i = 0; i < R.cachedTrackPoints.length; i++) {
        if (R.cachedTrackPoints[i].hr > cachedMaxHr) cachedMaxHr = R.cachedTrackPoints[i].hr;
      }
    }
    if (cachedMaxHr <= 0) return;

    var graph = R.findSampleGraphCanvas ? R.findSampleGraphCanvas(OVERLAY_CLASS) : null;
    var graphContainer = graph ? graph.container : null;
    // Widen the observation target to catch the hover details element
    var observeTarget = graphContainer ?
      (graphContainer.closest('[class*="BottomPanel"]') || graphContainer.parentElement || graphContainer) :
      document.body;

    tooltipObserver = new MutationObserver(function (mutations) {
      if (!R.hrZonesActive) return;
      // Check if any mutation touches the hover details
      var detailsEl = observeTarget.querySelector(".sg-hover-details");
      if (!detailsEl) return;
      // Only inject if we haven't already (or content changed)
      var existingLabel = detailsEl.querySelector(".rwgps-hr-zone-label");
      if (existingLabel) {
        // Verify it's still correct by checking if bpm text changed
        var text = detailsEl.textContent || "";
        var hrMatch = text.match(/(\d+)\s*bpm/i);
        if (hrMatch) {
          var hr = parseInt(hrMatch[1], 10);
          var zone = classifyZone(hr, cachedMaxHr);
          if (zone >= 0 && existingLabel.textContent === ZONE_LABELS[zone]) return;
        }
      }
      injectZoneIntoTooltip(detailsEl);
    });

    tooltipObserver.observe(observeTarget, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function stopTooltipObserver() {
    if (tooltipObserver) {
      tooltipObserver.disconnect();
      tooltipObserver = null;
    }
    cachedMaxHr = 0;
    // Clean up any injected labels
    var labels = document.querySelectorAll(".rwgps-hr-zone-label");
    for (var i = 0; i < labels.length; i++) labels[i].remove();
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  R.toggleHrZones = async function () {
    R.hrZonesActive = !R.hrZonesActive;
    if (R.hrZonesActive) {
      await R.enableHrZones();
    } else {
      R.disableHrZones();
    }
  };

  R.enableHrZones = async function () {
    try {
      var pageInfo = R.getPageInfo();
      if (!pageInfo || pageInfo.type !== "trip") {
        console.warn("[RWGPS Ext] enableHrZones: only works on trip pages");
        return;
      }

      if (!R.cachedTrackPoints) {
        R.cachedTrackPoints = await R.fetchTrackPoints(pageInfo.type, pageInfo.id);
        if (!R.cachedTrackPoints || R.cachedTrackPoints.length === 0) {
          console.warn("[RWGPS Ext] enableHrZones: no track points");
          return;
        }
      }

      // Check if any HR data exists
      var hasHr = false;
      for (var i = 0; i < R.cachedTrackPoints.length; i++) {
        if (R.cachedTrackPoints[i].hr > 0) { hasHr = true; break; }
      }
      if (!hasHr) {
        console.warn("[RWGPS Ext] enableHrZones: no heart rate data in this activity");
        return;
      }

      R.retryOverlayRender("hrZonesActive", function () {
        return renderHrZoneOverlay(R.cachedTrackPoints);
      }, function () {
        startHrZoneSync();
        startTooltipObserver();
      });
    } catch (err) {
      console.error("[RWGPS Ext] enableHrZones ERROR:", err);
    }
  };

  R.disableHrZones = function () {
    removeHrZoneOverlay();
    stopTooltipObserver();
  };

})(window.RE);
