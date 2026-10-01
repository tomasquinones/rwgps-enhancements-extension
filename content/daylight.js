(function (R) {
  "use strict";

  // ─── Daylight Overlay on Elevation Graph ────────────────────────────────

  var DAYLIGHT_COLOR = "rgba(255, 193, 7, 0.25)";
  var TWILIGHT_COLOR = "rgba(255, 152, 0, 0.2)";
  var NIGHT_COLOR    = "rgba(13, 71, 161, 0.2)";
  var MOON_COLOR     = "rgba(84, 110, 122, 0.9)";

  // Sunrise/sunset: the sun's upper limb on the horizon, including refraction.
  var SUN_EVENT_ALT = -0.833;

  var daylightPollId = null;
  var daylightListeners = null;
  var lastDaylightFingerprint = "";

  function renderDaylightOverlay(trackPoints, timeAtPoints) {
    var origCanvas = null;
    var graphContainer = null;
    var candidates = document.querySelectorAll('[class*="SampleGraph"]');
    for (var ci = 0; ci < candidates.length; ci++) {
      var c = candidates[ci].querySelector("canvas:not(.rwgps-daylight-overlay):not(.rwgps-weather-overlay)");
      if (c) { origCanvas = c; graphContainer = candidates[ci]; break; }
    }
    if (!origCanvas || !graphContainer) return null;

    var existing = graphContainer.querySelector(".rwgps-daylight-overlay");
    if (existing) existing.remove();

    var cw = origCanvas.width;
    var ch = origCanvas.height;

    var layout = R.getGraphLayout();
    var maxDist = trackPoints[trackPoints.length - 1].distance;

    var offsetWidth = origCanvas.offsetWidth || origCanvas.clientWidth || (cw / 2);
    var dpr = cw / offsetWidth;

    var plotLeftPx, plotRightPx, plotTopPx, plotBottomPx;
    if (layout && layout.plotMargin) {
      plotLeftPx = Math.round(layout.plotMargin.left * dpr);
      plotTopPx = Math.round(layout.plotMargin.top * dpr);
      plotRightPx = Math.round((layout.plotMargin.left + (layout.plotWidth || (offsetWidth - layout.plotMargin.left - layout.plotMargin.right))) * dpr);
      plotBottomPx = Math.round((layout.plotMargin.top + (layout.plotHeight || (origCanvas.offsetHeight - layout.plotMargin.top - layout.plotMargin.bottom))) * dpr);
    } else {
      try {
        var origCtx = origCanvas.getContext("2d", { willReadFrequently: true });
        if (!origCtx) return null;
        var imageData = origCtx.getImageData(0, 0, cw, ch);
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

        plotLeftPx = fillLeft;
        var minRunForPlot = Math.max(10, (fillBottom - fillTop) * 0.15);
        for (var lx = fillLeft; lx < fillRight; lx++) {
          var bestRun = 0, run = 0;
          for (var ly = fillTop; ly <= fillBottom; ly++) {
            if (isFilledPixel(lx, ly)) { run++; } else { if (run > bestRun) bestRun = run; run = 0; }
          }
          if (run > bestRun) bestRun = run;
          if (bestRun >= minRunForPlot) { plotLeftPx = lx; break; }
        }
        plotRightPx = fillRight;
        plotTopPx = fillTop;
        plotBottomPx = fillBottom;
      } catch (secErr) {
        plotLeftPx = Math.round(cw * 0.06);
        plotTopPx = Math.round(ch * 0.05);
        plotRightPx = Math.round(cw * 0.98);
        plotBottomPx = Math.round(ch * 0.85);
      }
    }

    var plotWidthPx = plotRightPx - plotLeftPx;
    var plotHeightPx = plotBottomPx - plotTopPx;

    var useProjection = layout && layout.xProjection && layout.xProjection.vScale;
    var xProj = useProjection ? layout.xProjection : null;

    var overlay = document.createElement("canvas");
    overlay.className = "rwgps-daylight-overlay";
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
    if (!ctx || maxDist === 0) return overlay;

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeftPx, plotTopPx, plotWidthPx, plotHeightPx);
    ctx.clip();

    var ALT_MIN = -30;
    var ALT_MAX = 90;
    var ALT_RANGE = ALT_MAX - ALT_MIN;

    function altToY(alt) {
      var clamped = Math.max(ALT_MIN, Math.min(ALT_MAX, alt));
      var t = (clamped - ALT_MIN) / ALT_RANGE;
      return plotBottomPx - t * plotHeightPx;
    }

    var horizonY = altToY(0);

    var ptIdx = 0;
    var altitudes = [];
    for (var cx = plotLeftPx; cx <= plotRightPx; cx++) {
      var dist;
      if (xProj) {
        var cssPx = cx / dpr;
        dist = xProj.v0 + (cssPx - xProj.pixelOffset) / xProj.vScale;
      } else {
        dist = ((cx - plotLeftPx) / plotWidthPx) * maxDist;
      }

      while (ptIdx < trackPoints.length - 1 && trackPoints[ptIdx + 1].distance < dist) {
        ptIdx++;
      }
      var pi = Math.min(ptIdx, trackPoints.length - 1);
      var tp = trackPoints[pi];
      var time = timeAtPoints[pi];

      if (!time || isNaN(time.getTime())) {
        altitudes.push({ alt: 0, cx: cx, time: null });
        continue;
      }

      var sun = R.solarPosition(time, tp.lat, tp.lng);
      altitudes.push({ alt: sun.altitude, cx: cx, time: time, lat: tp.lat, lng: tp.lng });
    }

    for (var ai = 0; ai < altitudes.length; ai++) {
      var alt = altitudes[ai].alt;
      var x = altitudes[ai].cx;
      var curveY = altToY(alt);

      if (alt > 0) {
        ctx.fillStyle = DAYLIGHT_COLOR;
        ctx.fillRect(x, curveY, 1, horizonY - curveY);
      } else if (alt > -6) {
        ctx.fillStyle = TWILIGHT_COLOR;
        ctx.fillRect(x, horizonY, 1, curveY - horizonY);
      } else {
        ctx.fillStyle = NIGHT_COLOR;
        ctx.fillRect(x, horizonY, 1, curveY - horizonY);
      }
    }

    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(100, 100, 100, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotLeftPx, horizonY);
    ctx.lineTo(plotRightPx, horizonY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    for (var si = 0; si < altitudes.length - 1; si++) {
      var a1 = altitudes[si];
      var a2 = altitudes[si + 1];
      var avgAlt = (a1.alt + a2.alt) / 2;
      if (avgAlt > 10) {
        ctx.strokeStyle = "#ffc107";
      } else if (avgAlt > 0) {
        ctx.strokeStyle = "#ff9800";
      } else {
        ctx.strokeStyle = "#1565c0";
      }
      ctx.beginPath();
      ctx.moveTo(a1.cx, altToY(a1.alt));
      ctx.lineTo(a2.cx, altToY(a2.alt));
      ctx.stroke();
    }

    drawCelestialDetails(ctx, altitudes, altToY, plotLeftPx, plotRightPx, plotTopPx, plotBottomPx, dpr);

    ctx.restore();
    return overlay;
  }

  // ─── Sunrise/Sunset Markers + Moon ──────────────────────────────────────
  // Marks where the ride crosses sunrise or sunset (with the clock time at
  // that point), and for rides with night portions draws the moon's
  // altitude while the sun is down plus its phase and illumination.

  function formatClock(date) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function findSunEvents(altitudes) {
    var events = [];
    for (var i = 1; i < altitudes.length; i++) {
      var a0 = altitudes[i - 1], a1 = altitudes[i];
      if (!a0.time || !a1.time) continue;
      var wasUp = a0.alt > SUN_EVENT_ALT;
      var isUp = a1.alt > SUN_EVENT_ALT;
      if (wasUp === isUp) continue;
      var f = (SUN_EVENT_ALT - a0.alt) / (a1.alt - a0.alt);
      events.push({
        cx: a0.cx + f * (a1.cx - a0.cx),
        rising: isUp,
        time: new Date(a0.time.getTime() + f * (a1.time.getTime() - a0.time.getTime()))
      });
    }
    return events;
  }

  // Draws a text chip, trying successive rows below `top` until it doesn't
  // overlap an earlier chip. Returns false if no row had room.
  function placeLabel(ctx, text, anchorX, align, top, plotLeftPx, plotRightPx, dpr, placed) {
    ctx.font = Math.round(11 * dpr) + "px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    var padX = 4 * dpr;
    var h = 16 * dpr;
    var w = ctx.measureText(text).width + padX * 2;
    var left = align === "right" ? anchorX - w : anchorX;
    left = Math.max(plotLeftPx, Math.min(left, plotRightPx - w));
    for (var row = 0; row < 2; row++) {
      var y = top + row * (h + 2 * dpr);
      var clash = false;
      for (var i = 0; i < placed.length; i++) {
        var p = placed[i];
        if (left < p.right && left + w > p.left && y < p.bottom && y + h > p.top) { clash = true; break; }
      }
      if (clash) continue;
      ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
      ctx.fillRect(left, y, w, h);
      ctx.fillStyle = "#37474f";
      ctx.textBaseline = "middle";
      ctx.fillText(text, left + padX, y + h / 2);
      placed.push({ left: left, right: left + w, top: y, bottom: y + h });
      return true;
    }
    return false;
  }

  function drawCelestialDetails(ctx, altitudes, altToY, plotLeftPx, plotRightPx, plotTopPx, plotBottomPx, dpr) {
    var labelTop = plotTopPx + 2 * dpr;
    var placed = [];
    var night = altitudes.filter(function (a) { return a.time && a.alt <= SUN_EVENT_ALT; });

    if (night.length > 0) {
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.strokeStyle = MOON_COLOR;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      var drawing = false;
      for (var i = 0; i < altitudes.length; i++) {
        var a = altitudes[i];
        if (!a.time || a.alt > SUN_EVENT_ALT) { drawing = false; continue; }
        var moonAlt = R.moonPosition(a.time, a.lat, a.lng).altitude;
        if (moonAlt <= 0) { drawing = false; continue; }
        if (drawing) ctx.lineTo(a.cx, altToY(moonAlt));
        else { ctx.moveTo(a.cx, altToY(moonAlt)); drawing = true; }
      }
      ctx.stroke();
      ctx.setLineDash([]);

      var moon = R.moonIllumination(night[Math.floor(night.length / 2)].time);
      placeLabel(ctx, moon.icon + " " + Math.round(moon.fraction * 100) + "% " + moon.name,
        plotRightPx - 2 * dpr, "right", labelTop, plotLeftPx, plotRightPx, dpr, placed);
    }

    var events = findSunEvents(altitudes);
    for (var e = 0; e < events.length; e++) {
      var ev = events[e];
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.strokeStyle = "rgba(230, 81, 0, 0.8)";
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(ev.cx, plotTopPx);
      ctx.lineTo(ev.cx, plotBottomPx);
      ctx.stroke();
      ctx.setLineDash([]);
      var text = (ev.rising ? "Sunrise " : "Sunset ") + formatClock(ev.time);
      var rightSide = ev.cx < (plotLeftPx + plotRightPx) / 2;
      placeLabel(ctx, text, rightSide ? ev.cx + 3 * dpr : ev.cx - 3 * dpr, rightSide ? "left" : "right",
        labelTop, plotLeftPx, plotRightPx, dpr, placed);
    }
  }

  function scheduleDaylightRedraw() {
    if (!R.daylightActive || !R.cachedTrackPoints || !R.cachedDaylightTimes) return;
    setTimeout(function () {
      if (!R.daylightActive || !R.cachedTrackPoints || !R.cachedDaylightTimes) return;
      renderDaylightOverlay(R.cachedTrackPoints, R.cachedDaylightTimes);
      var candidates = document.querySelectorAll('[class*="SampleGraph"]');
      for (var ci = 0; ci < candidates.length; ci++) {
        var c = candidates[ci].querySelector("canvas:not(.rwgps-daylight-overlay):not(.rwgps-weather-overlay)");
        if (c) { lastDaylightFingerprint = R.canvasFingerprint(c); break; }
      }
    }, 400);
  }

  function startDaylightSync() {
    stopDaylightSync();

    var graphContainer = null;
    var candidates = document.querySelectorAll('[class*="SampleGraph"]');
    for (var ci = 0; ci < candidates.length; ci++) {
      if (candidates[ci].querySelector("canvas")) { graphContainer = candidates[ci]; break; }
    }

    var onMouseUp = function () { scheduleDaylightRedraw(); };
    if (graphContainer) {
      graphContainer.addEventListener("mouseup", onMouseUp);
      graphContainer.addEventListener("pointerup", onMouseUp);
    }
    var bottomPanel = graphContainer ? graphContainer.closest('[class*="BottomPanel"]') || graphContainer.parentElement : null;
    if (bottomPanel) {
      bottomPanel.addEventListener("click", onMouseUp);
    }

    daylightListeners = { graphContainer: graphContainer, bottomPanel: bottomPanel, onMouseUp: onMouseUp };

    var origCanvas = graphContainer ? graphContainer.querySelector("canvas:not(.rwgps-daylight-overlay):not(.rwgps-weather-overlay)") : null;
    if (origCanvas) {
      lastDaylightFingerprint = R.canvasFingerprint(origCanvas);
    }
    daylightPollId = setInterval(function () {
      if (!R.daylightActive) { stopDaylightSync(); return; }
      if (document.hidden) return;
      if (!origCanvas || !origCanvas.isConnected) {
        var c2 = document.querySelectorAll('[class*="SampleGraph"]');
        for (var i = 0; i < c2.length; i++) {
          var found = c2[i].querySelector("canvas:not(.rwgps-daylight-overlay):not(.rwgps-weather-overlay)");
          if (found) { origCanvas = found; break; }
        }
        if (!origCanvas || !origCanvas.isConnected) return;
        lastDaylightFingerprint = "";
      }
      var fp = R.canvasFingerprint(origCanvas);
      if (fp !== lastDaylightFingerprint) {
        lastDaylightFingerprint = fp;
        scheduleDaylightRedraw();
      }
    }, 500);
  }

  function stopDaylightSync() {
    if (daylightListeners) {
      var l = daylightListeners;
      if (l.graphContainer) {
        l.graphContainer.removeEventListener("mouseup", l.onMouseUp);
        l.graphContainer.removeEventListener("pointerup", l.onMouseUp);
      }
      if (l.bottomPanel) {
        l.bottomPanel.removeEventListener("click", l.onMouseUp);
      }
      daylightListeners = null;
    }
    if (daylightPollId) {
      clearInterval(daylightPollId);
      daylightPollId = null;
    }
    lastDaylightFingerprint = "";
  }

  function removeDaylightOverlay() {
    stopDaylightSync();
    var overlay = document.querySelector(".rwgps-daylight-overlay");
    if (overlay) overlay.remove();
  }

  // ─── Daylight Modal (date/time picker for routes) ───────────────────────

  function showDaylightModal(onApply, onCancel) {
    var existing = document.querySelector(".rwgps-daylight-modal-backdrop");
    if (existing) existing.remove();

    var backdrop = document.createElement("div");
    backdrop.className = "rwgps-daylight-modal-backdrop";

    var modal = document.createElement("div");
    modal.className = "rwgps-daylight-modal";

    var title = document.createElement("h3");
    title.textContent = "Daylight — Choose Start Time";
    modal.appendChild(title);

    var desc = document.createElement("p");
    desc.className = "rwgps-daylight-modal-desc";
    desc.textContent = "Select when you plan to start this route to see daylight availability along your ride.";
    modal.appendChild(desc);

    var dateLabel = document.createElement("label");
    dateLabel.textContent = "Date";
    var dateInput = document.createElement("input");
    dateInput.type = "date";
    var today = new Date();
    dateInput.value = today.getFullYear() + "-" +
      String(today.getMonth() + 1).padStart(2, "0") + "-" +
      String(today.getDate()).padStart(2, "0");
    dateLabel.appendChild(dateInput);
    modal.appendChild(dateLabel);

    var timeLabel = document.createElement("label");
    timeLabel.textContent = "Start Time";
    var timeInput = document.createElement("input");
    timeInput.type = "time";
    timeInput.value = "08:00";
    timeLabel.appendChild(timeInput);
    modal.appendChild(timeLabel);

    var btnRow = document.createElement("div");
    btnRow.className = "rwgps-daylight-modal-buttons";

    var cancelBtn = document.createElement("button");
    cancelBtn.className = "rwgps-daylight-modal-btn rwgps-daylight-modal-btn-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", function () {
      backdrop.remove();
      if (onCancel) onCancel();
    });

    var applyBtn = document.createElement("button");
    applyBtn.className = "rwgps-daylight-modal-btn rwgps-daylight-modal-btn-primary";
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", function () {
      var parts = dateInput.value.split("-");
      var timeParts = timeInput.value.split(":");
      var startDate = new Date(
        parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10),
        parseInt(timeParts[0], 10), parseInt(timeParts[1], 10)
      );
      backdrop.remove();
      if (onApply) onApply(startDate);
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(applyBtn);
    modal.appendChild(btnRow);

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) {
        backdrop.remove();
        if (onCancel) onCancel();
      }
    });

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  function closeDaylightModal() {
    var backdrop = document.querySelector(".rwgps-daylight-modal-backdrop");
    if (backdrop) backdrop.remove();
  }

  // ─── Daylight Toggle ────────────────────────────────────────────────────

  R.toggleDaylight = async function () {
    R.daylightActive = !R.daylightActive;
    if (R.daylightActive) {
      await R.enableDaylight();
    } else {
      R.disableDaylight();
    }
  };

  R.enableDaylight = async function () {
    var pageInfo = R.getPageInfo();
    if (!pageInfo) return;

    if (!R.cachedTrackPoints) {
      R.cachedTrackPoints = await R.fetchTrackPoints(pageInfo.type, pageInfo.id);
      if (!R.cachedTrackPoints || R.cachedTrackPoints.length === 0) return;
    }

    if (pageInfo.type === "trip") {
      R.cachedDaylightTimes = R.computeTimeAtPoints(R.cachedTrackPoints, "trip", null);
      if (!R.cachedDaylightTimes[0] || isNaN(R.cachedDaylightTimes[0].getTime()) ||
          R.cachedDaylightTimes[0].getFullYear() < 2000) {
        if (R.cachedDepartedAt) {
          R.cachedDaylightTimes = R.computeTimeAtPoints(R.cachedTrackPoints, "route", R.cachedDepartedAt, R.getUserSummary());
        }
      }
      R.retryOverlayRender("daylightActive", function () {
        return renderDaylightOverlay(R.cachedTrackPoints, R.cachedDaylightTimes);
      }, function () {
        startDaylightSync();
      });
    } else {
      R.cachedUserSummary = R.getUserSummary();
      showDaylightModal(function (startDate) {
        R.cachedDaylightTimes = R.computeTimeAtPoints(R.cachedTrackPoints, "route", startDate, R.cachedUserSummary);
        R.retryOverlayRender("daylightActive", function () {
          return renderDaylightOverlay(R.cachedTrackPoints, R.cachedDaylightTimes);
        }, function () {
          startDaylightSync();
        });
      }, function () {
        R.daylightActive = false;
        var menu = document.querySelector(".rwgps-enhancements-menu");
        if (menu) R.updateEnhancementsMenu(menu);
      });
    }
  };

  R.disableDaylight = function () {
    removeDaylightOverlay();
    closeDaylightModal();
    R.cachedDaylightTimes = null;
  };

})(window.RE);
