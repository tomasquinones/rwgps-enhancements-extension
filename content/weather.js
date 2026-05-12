(function (R) {
  "use strict";

  // ─── Weather Overlay on Elevation Graph ─────────────────────────────────

  var CLOUD_COLOR_BASE = [80, 80, 100];
  var RAIN_COLOR_BASE  = [20, 80, 220];

  var weatherPollId = null;
  var weatherListeners = null;
  var lastWeatherFingerprint = "";
  var weatherApiCache = {};

  // ─── Open-Meteo API ─────────────────────────────────────────────────────

  function formatDate(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function isHistoricalDate(d) {
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var check = new Date(d.getTime());
    check.setHours(0, 0, 0, 0);
    return check < now;
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function fetchOpenMeteo(lat, lng, startDate, endDate, historical, metric) {
    var cacheKey = lat.toFixed(2) + "," + lng.toFixed(2) + "," + formatDate(startDate) + "," + (historical ? "h" : "f") + "," + (metric ? "m" : "i");
    if (weatherApiCache[cacheKey]) return weatherApiCache[cacheKey];

    var base = historical
      ? "https://archive-api.open-meteo.com/v1/archive"
      : "https://api.open-meteo.com/v1/forecast";
    var hourly = historical
      ? "temperature_2m,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m"
      : "temperature_2m,cloud_cover,precipitation_probability,wind_speed_10m,wind_direction_10m";

    var unitParams = metric
      ? ""
      : "&temperature_unit=fahrenheit&wind_speed_unit=mph";

    var url = base +
      "?latitude=" + lat.toFixed(4) +
      "&longitude=" + lng.toFixed(4) +
      "&hourly=" + hourly +
      "&start_date=" + formatDate(startDate) +
      "&end_date=" + formatDate(endDate) +
      "&timezone=auto" +
      unitParams;

    try {
      var resp = await fetch(url);
      if (!resp.ok) {
        console.warn("[Weather] API error:", resp.status, url);
        return null;
      }
      var data = await resp.json();
      weatherApiCache[cacheKey] = data;
      return data;
    } catch (err) {
      console.warn("[Weather] Fetch failed:", err);
      return null;
    }
  }

  function interpolateHourly(hourlyData, hourlyTimes, time, field) {
    var targetMs = time.getTime();
    var idx = 0;
    for (var i = 0; i < hourlyTimes.length - 1; i++) {
      if (new Date(hourlyTimes[i + 1]).getTime() > targetMs) { idx = i; break; }
      idx = i;
    }
    var t0 = new Date(hourlyTimes[idx]).getTime();
    var t1 = idx + 1 < hourlyTimes.length ? new Date(hourlyTimes[idx + 1]).getTime() : t0 + 3600000;
    var v0 = hourlyData[field][idx];
    var v1 = idx + 1 < hourlyData[field].length ? hourlyData[field][idx + 1] : v0;
    if (v0 == null) return v1;
    if (v1 == null) return v0;
    var t = t1 > t0 ? (targetMs - t0) / (t1 - t0) : 0;
    t = Math.max(0, Math.min(1, t));
    return v0 + (v1 - v0) * t;
  }

  async function fetchWeatherForRoute(trackPoints, timeAtPoints) {
    if (!timeAtPoints || timeAtPoints.length === 0) return [];

    var metric = R.isMetric();
    var startTime = timeAtPoints[0];
    var endTime = timeAtPoints[timeAtPoints.length - 1];
    var durationMs = endTime.getTime() - startTime.getTime();
    var durationHours = durationMs / 3600000;
    var blockMinutes = durationHours < 3 ? 30 : 60;
    var blockMs = blockMinutes * 60 * 1000;

    var historical = isHistoricalDate(endTime);
    var startDate = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate());
    var endDate = new Date(endTime.getFullYear(), endTime.getMonth(), endTime.getDate());

    // Build time block boundaries
    var blockTimes = [];
    var t = startTime.getTime();
    while (t <= endTime.getTime()) {
      blockTimes.push(new Date(t));
      t += blockMs;
    }
    if (blockTimes[blockTimes.length - 1].getTime() < endTime.getTime()) {
      blockTimes.push(endTime);
    }

    // For each block boundary, find the track point and its lat/lng
    var samplePoints = [];
    var ptIdx = 0;
    for (var bi = 0; bi < blockTimes.length; bi++) {
      var blockTime = blockTimes[bi].getTime();
      while (ptIdx < timeAtPoints.length - 1 && timeAtPoints[ptIdx + 1].getTime() < blockTime) {
        ptIdx++;
      }
      var tp = trackPoints[Math.min(ptIdx, trackPoints.length - 1)];
      samplePoints.push({ lat: tp.lat, lng: tp.lng, time: blockTimes[bi], dist: tp.distance });
    }

    // Deduplicate nearby coordinates
    var uniqueCoords = [];
    var coordMap = [];
    for (var si = 0; si < samplePoints.length; si++) {
      var sp = samplePoints[si];
      var found = -1;
      for (var ui = 0; ui < uniqueCoords.length; ui++) {
        if (Math.abs(sp.lat - uniqueCoords[ui].lat) < 0.05 &&
            Math.abs(sp.lng - uniqueCoords[ui].lng) < 0.05) {
          found = ui;
          break;
        }
      }
      if (found === -1) {
        uniqueCoords.push({ lat: sp.lat, lng: sp.lng });
        coordMap.push(uniqueCoords.length - 1);
      } else {
        coordMap.push(found);
      }
    }

    // Fetch weather for each unique coordinate
    var apiResults = [];
    for (var ci = 0; ci < uniqueCoords.length; ci++) {
      var coord = uniqueCoords[ci];
      var result = await fetchOpenMeteo(coord.lat, coord.lng, startDate, endDate, historical, metric);
      apiResults.push(result);
      if (ci < uniqueCoords.length - 1) await sleep(100);
    }

    // Build weather blocks
    var blocks = [];
    for (var bk = 0; bk < blockTimes.length - 1; bk++) {
      var midTime = new Date((blockTimes[bk].getTime() + blockTimes[bk + 1].getTime()) / 2);
      var apiIdx = coordMap[bk];
      var apiData = apiResults[apiIdx];
      if (!apiData || !apiData.hourly || !apiData.hourly.time) {
        blocks.push({
          startDist: samplePoints[bk].dist,
          endDist: samplePoints[bk + 1].dist,
          startTime: samplePoints[bk].time,
          endTime: samplePoints[bk + 1].time,
          temperature: null,
          cloudCover: 0,
          precipChance: 0,
          windSpeed: 0,
          windDir: 0
        });
        continue;
      }

      var hourly = apiData.hourly;
      var temperature = hourly.temperature_2m
        ? interpolateHourly(hourly, hourly.time, midTime, "temperature_2m")
        : null;
      var cloudCover = interpolateHourly(hourly, hourly.time, midTime, "cloud_cover") || 0;
      var precipChance;
      if (historical) {
        var precip = interpolateHourly(hourly, hourly.time, midTime, "precipitation") || 0;
        precipChance = Math.min(100, precip * 20);
      } else {
        precipChance = interpolateHourly(hourly, hourly.time, midTime, "precipitation_probability") || 0;
      }
      var windSpeed = interpolateHourly(hourly, hourly.time, midTime, "wind_speed_10m") || 0;
      var windDir = interpolateHourly(hourly, hourly.time, midTime, "wind_direction_10m") || 0;

      blocks.push({
        startDist: samplePoints[bk].dist,
        endDist: samplePoints[bk + 1].dist,
        startTime: samplePoints[bk].time,
        endTime: samplePoints[bk + 1].time,
        temperature: temperature,
        cloudCover: cloudCover,
        precipChance: precipChance,
        windSpeed: windSpeed,
        windDir: windDir
      });
    }

    return blocks;
  }

  // ─── Overlay Rendering ──────────────────────────────────────────────────

  var OVERLAY_EXCLUDE = "canvas:not(.rwgps-weather-overlay):not(.rwgps-daylight-overlay):not(.rwgps-climb-elevation-overlay):not(.rwgps-descent-elevation-overlay)";

  function renderWeatherOverlay(trackPoints, weatherBlocks) {
    var origCanvas = null;
    var graphContainer = null;
    var candidates = document.querySelectorAll('[class*="SampleGraph"]');
    for (var ci = 0; ci < candidates.length; ci++) {
      var c = candidates[ci].querySelector(OVERLAY_EXCLUDE);
      if (c) { origCanvas = c; graphContainer = candidates[ci]; break; }
    }
    if (!origCanvas || !graphContainer) return null;

    var existing = graphContainer.querySelector(".rwgps-weather-overlay");
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
    overlay.className = "rwgps-weather-overlay";
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

    var ctx = overlay.getContext("2d");
    if (!ctx || maxDist === 0 || weatherBlocks.length === 0) return overlay;

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeftPx, plotTopPx, plotWidthPx, plotHeightPx);
    ctx.clip();

    function distToX(dist) {
      if (xProj) {
        var cssPx = xProj.pixelOffset + (dist - xProj.v0) * xProj.vScale;
        return cssPx * dpr;
      }
      return plotLeftPx + (dist / maxDist) * plotWidthPx;
    }

    var drawCloud = R.weatherCloudActive !== false;
    var drawPrecip = R.weatherPrecipActive !== false;
    var drawTemp = R.weatherTempActive !== false;
    var drawWind = R.weatherWindActive !== false;
    var drawStrip = !!R.weatherStripActive;

    for (var bi = 0; bi < weatherBlocks.length; bi++) {
      var block = weatherBlocks[bi];
      var x0 = Math.round(distToX(block.startDist));
      var x1 = Math.round(distToX(block.endDist));
      if (x1 <= x0) continue;
      var bx = x0 + (bi > 0 ? 1 : 0);
      var bw = x1 - bx;
      if (bw <= 0) continue;

      if (drawCloud && block.cloudCover > 0) {
        var cloudH = (block.cloudCover / 100) * plotHeightPx * 0.5;
        var cloudOpacity = 0.06 + (block.cloudCover / 100) * 0.18;
        ctx.fillStyle = "rgba(" + CLOUD_COLOR_BASE.join(",") + "," + cloudOpacity + ")";
        ctx.fillRect(bx, plotTopPx, bw, cloudH);
      }

      if (drawPrecip && block.precipChance > 0) {
        var rainH = (block.precipChance / 100) * plotHeightPx * 0.45;
        var rainOpacity = 0.08 + (block.precipChance / 100) * 0.22;
        ctx.fillStyle = "rgba(" + RAIN_COLOR_BASE.join(",") + "," + rainOpacity + ")";
        ctx.fillRect(bx, plotBottomPx - rainH, bw, rainH);
      }
    }

    if (drawTemp) {
      drawTemperatureLine(ctx, weatherBlocks, distToX, plotTopPx, plotBottomPx, plotHeightPx, dpr);
    }

    // Draw block boundary lines (only meaningful when fills are visible)
    if (drawCloud || drawPrecip) {
      ctx.strokeStyle = "rgba(100, 100, 100, 0.12)";
      ctx.lineWidth = 1;
      for (var li = 1; li < weatherBlocks.length; li++) {
        var lx = Math.round(distToX(weatherBlocks[li].startDist));
        ctx.beginPath();
        ctx.moveTo(lx, plotTopPx);
        ctx.lineTo(lx, plotBottomPx);
        ctx.stroke();
      }
    }

    ctx.restore();

    if (drawWind) {
      drawWindArrowsOnGraph(ctx, weatherBlocks, distToX, plotTopPx, plotLeftPx, plotRightPx, dpr);
    }

    if (drawStrip) {
      renderWeatherStrip(graphContainer, weatherBlocks, distToX, dpr, plotLeftPx);
    } else {
      var oldStrip = document.querySelector(".rwgps-weather-strip");
      if (oldStrip) oldStrip.remove();
    }

    return overlay;
  }

  // ─── Temperature Line ────────────────────────────────────────────────────

  function drawTemperatureLine(ctx, blocks, distToX, plotTopPx, plotBottomPx, plotHeightPx, dpr) {
    var pts = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.temperature == null) continue;
      pts.push({ dist: (b.startDist + b.endDist) / 2, temp: b.temperature, block: b });
    }
    if (pts.length < 2) return;

    var minT = Infinity, maxT = -Infinity;
    for (var p = 0; p < pts.length; p++) {
      if (pts[p].temp < minT) minT = pts[p].temp;
      if (pts[p].temp > maxT) maxT = pts[p].temp;
    }
    var range = maxT - minT;
    if (range < 5) range = 5; // floor so a flat day still has visible variation

    // Use the middle 60% of plot height; leaves room for cloud (top) and rain (bottom).
    var bandTop = plotTopPx + plotHeightPx * 0.18;
    var bandBottom = plotBottomPx - plotHeightPx * 0.22;
    var bandHeight = bandBottom - bandTop;

    function tempToY(t) {
      return bandBottom - ((t - minT) / range) * bandHeight;
    }

    ctx.save();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = "rgba(232, 96, 32, 0.95)"; // warm orange
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    for (var k = 0; k < pts.length; k++) {
      var x = distToX(pts[k].dist);
      var y = tempToY(pts[k].temp);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Endpoint labels (min/max temps) so the line is interpretable without the strip
    var metricUnit = R.isMetric() ? "°C" : "°F";
    ctx.fillStyle = "rgba(180, 70, 20, 0.9)";
    ctx.font = (10 * dpr) + "px aktiv-grotesk, 'Open Sans', Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(Math.round(maxT) + metricUnit, distToX(pts[0].dist) + 4 * dpr, tempToY(maxT) - 2 * dpr);
    ctx.textAlign = "right";
    ctx.fillText(Math.round(minT) + metricUnit, distToX(pts[pts.length - 1].dist) - 4 * dpr, tempToY(minT) + 12 * dpr);
    ctx.restore();
  }

  // ─── Wind Arrows along the top of the graph ──────────────────────────────

  function drawWindArrowsOnGraph(ctx, blocks, distToX, plotTopPx, plotLeftPx, plotRightPx, dpr) {
    if (!blocks || blocks.length === 0) return;
    var arrowSize = 9 * dpr;
    var rowY = plotTopPx + 2 * dpr;
    var minSpacingPx = 36 * dpr;
    var lastDrawnX = -Infinity;

    ctx.save();
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var midDist = (b.startDist + b.endDist) / 2;
      var x = distToX(midDist);
      if (x < plotLeftPx + arrowSize || x > plotRightPx - arrowSize) continue;
      if (x - lastDrawnX < minSpacingPx) continue;
      lastDrawnX = x;

      // windDir is the direction the wind comes FROM; rotate +180 so the
      // arrow points the way the wind is blowing TOWARD.
      var rot = ((b.windDir + 180) % 360) * Math.PI / 180;
      ctx.save();
      ctx.translate(x, rowY + arrowSize / 2);
      ctx.rotate(rot);
      ctx.fillStyle = "rgba(70, 80, 96, 0.85)";
      ctx.beginPath();
      ctx.moveTo(0, -arrowSize / 2);
      ctx.lineTo(arrowSize * 0.42, arrowSize * 0.42);
      ctx.lineTo(0, arrowSize * 0.18);
      ctx.lineTo(-arrowSize * 0.42, arrowSize * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ─── Weather Strip (per-block summary above the graph) ─────────────────

  function buildWindArrowSvg(windDir) {
    // windDir is the direction the wind comes FROM (meteorological convention).
    // Arrow points UP at 0deg; rotating by windDir + 180 makes it point in the
    // direction the wind is BLOWING TOWARD.
    var rot = ((windDir + 180) % 360);
    return '<svg class="rwgps-weather-strip-wind-arrow" width="11" height="11" viewBox="0 0 10 10" style="transform:rotate(' + rot + 'deg);">' +
      '<path d="M5 1 L8.4 8.5 L5 6.6 L1.6 8.5 Z" fill="currentColor"/>' +
      '</svg>';
  }

  function formatBlockTime(date, includeAmPm) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return "";
    var opts = { hour: "numeric", minute: "2-digit" };
    var out = date.toLocaleTimeString(undefined, opts);
    if (!includeAmPm) {
      // Strip trailing " AM"/" PM" for narrow cells
      out = out.replace(/\s?(AM|PM)$/i, "");
    }
    return out;
  }

  function renderWeatherStrip(graphContainer, weatherBlocks, distToX, dpr, plotLeftPx) {
    var existing = document.querySelector(".rwgps-weather-strip");
    if (existing) existing.remove();
    var existingLegend = graphContainer.querySelector("#rwgps-weather-legend");
    if (existingLegend) existingLegend.remove();

    if (!weatherBlocks || weatherBlocks.length === 0) return;

    var metric = R.isMetric();
    var windUnit = metric ? "km/h" : "mph";

    var strip = document.createElement("div");
    strip.className = "rwgps-weather-strip";

    for (var bi = 0; bi < weatherBlocks.length; bi++) {
      var block = weatherBlocks[bi];
      var leftCss = distToX(block.startDist) / dpr;
      var rightCss = distToX(block.endDist) / dpr;
      var widthCss = rightCss - leftCss;
      if (widthCss < 1) continue;

      var cell = document.createElement("div");
      cell.className = "rwgps-weather-strip-cell";
      cell.style.left = leftCss + "px";
      cell.style.width = widthCss + "px";

      var narrow = widthCss < 70;
      var wide = widthCss >= 110;
      var tempStr = block.temperature != null ? Math.round(block.temperature) + "°" : "—";
      var windHtml = buildWindArrowSvg(block.windDir) +
        '<span>' + Math.round(block.windSpeed) + (narrow ? '' : ' ' + windUnit) + '</span>';

      var startStr = formatBlockTime(block.startTime, !narrow);
      var timeText = wide && block.endTime
        ? startStr + '–' + formatBlockTime(block.endTime, true)
        : startStr;
      var timeTitle = "";
      if (block.startTime && block.endTime) {
        timeTitle = formatBlockTime(block.startTime, true) + ' – ' + formatBlockTime(block.endTime, true);
      } else if (block.startTime) {
        timeTitle = formatBlockTime(block.startTime, true);
      }

      var html =
        '<div class="rwgps-weather-strip-time"' + (timeTitle ? ' title="' + timeTitle + '"' : '') + '>' + timeText + '</div>' +
        '<div class="rwgps-weather-strip-main">' +
          '<span class="rwgps-weather-strip-temp">' + tempStr + '</span>' +
          '<span class="rwgps-weather-strip-wind">' + windHtml + '</span>' +
        '</div>' +
        '<div class="rwgps-weather-strip-conds">' +
          '<span class="rwgps-weather-strip-cloud" title="Cloud cover">' +
            '<svg width="13" height="9" viewBox="0 0 13 9" aria-hidden="true"><path d="M3.2 8.2 C1.4 8.2 0.8 6.8 1.2 5.6 C1.6 4.4 2.8 4.0 3.6 4.2 C3.6 2.6 5.0 1.4 6.6 1.4 C8.0 1.4 9.2 2.4 9.4 3.6 C10.6 3.4 11.8 4.4 11.8 5.8 C11.8 7.2 10.8 8.2 9.4 8.2 Z" fill="currentColor"/></svg>' +
            Math.round(block.cloudCover) + '%' +
          '</span>' +
          '<span class="rwgps-weather-strip-rain" title="Rain chance">' +
            '<svg width="8" height="11" viewBox="0 0 8 11" aria-hidden="true"><path d="M4 0.5 C1.5 4 0.5 6 0.5 7.5 C0.5 9.4 2 10.5 4 10.5 C6 10.5 7.5 9.4 7.5 7.5 C7.5 6 6.5 4 4 0.5 Z" fill="currentColor"/></svg>' +
            Math.round(block.precipChance) + '%' +
          '</span>' +
        '</div>';
      cell.innerHTML = html;
      strip.appendChild(cell);
    }

    graphContainer.parentNode.insertBefore(strip, graphContainer);
  }

  // ─── Sync & Redraw ──────────────────────────────────────────────────────

  function scheduleWeatherRedraw() {
    if (!R.weatherActive || !R.cachedTrackPoints || !R.cachedWeatherData) return;
    setTimeout(function () {
      if (!R.weatherActive || !R.cachedTrackPoints || !R.cachedWeatherData) return;
      renderWeatherOverlay(R.cachedTrackPoints, R.cachedWeatherData);
      var candidates = document.querySelectorAll('[class*="SampleGraph"]');
      for (var ci = 0; ci < candidates.length; ci++) {
        var c = candidates[ci].querySelector(OVERLAY_EXCLUDE);
        if (c) { lastWeatherFingerprint = R.canvasFingerprint(c); break; }
      }
    }, 400);
  }

  function startWeatherSync() {
    stopWeatherSync();

    var graphContainer = null;
    var candidates = document.querySelectorAll('[class*="SampleGraph"]');
    for (var ci = 0; ci < candidates.length; ci++) {
      if (candidates[ci].querySelector("canvas")) { graphContainer = candidates[ci]; break; }
    }

    var onMouseUp = function () { scheduleWeatherRedraw(); };
    if (graphContainer) {
      graphContainer.addEventListener("mouseup", onMouseUp);
      graphContainer.addEventListener("pointerup", onMouseUp);
    }
    var bottomPanel = graphContainer ? graphContainer.closest('[class*="BottomPanel"]') || graphContainer.parentElement : null;
    if (bottomPanel) {
      bottomPanel.addEventListener("click", onMouseUp);
    }

    weatherListeners = { graphContainer: graphContainer, bottomPanel: bottomPanel, onMouseUp: onMouseUp };

    var origCanvas = graphContainer ? graphContainer.querySelector(OVERLAY_EXCLUDE) : null;
    if (origCanvas) {
      lastWeatherFingerprint = R.canvasFingerprint(origCanvas);
    }
    weatherPollId = setInterval(function () {
      if (!R.weatherActive) { stopWeatherSync(); return; }
      if (!origCanvas || !origCanvas.isConnected) {
        var c2 = document.querySelectorAll('[class*="SampleGraph"]');
        for (var i = 0; i < c2.length; i++) {
          var found = c2[i].querySelector(OVERLAY_EXCLUDE);
          if (found) { origCanvas = found; break; }
        }
        if (!origCanvas || !origCanvas.isConnected) return;
        lastWeatherFingerprint = "";
      }
      var fp = R.canvasFingerprint(origCanvas);
      if (fp !== lastWeatherFingerprint) {
        lastWeatherFingerprint = fp;
        scheduleWeatherRedraw();
      }
    }, 500);
  }

  function stopWeatherSync() {
    if (weatherListeners) {
      var l = weatherListeners;
      if (l.graphContainer) {
        l.graphContainer.removeEventListener("mouseup", l.onMouseUp);
        l.graphContainer.removeEventListener("pointerup", l.onMouseUp);
      }
      if (l.bottomPanel) {
        l.bottomPanel.removeEventListener("click", l.onMouseUp);
      }
      weatherListeners = null;
    }
    if (weatherPollId) {
      clearInterval(weatherPollId);
      weatherPollId = null;
    }
    lastWeatherFingerprint = "";
  }

  function removeWeatherOverlay() {
    stopWeatherSync();
    var overlay = document.querySelector(".rwgps-weather-overlay");
    if (overlay) overlay.remove();
    var strip = document.querySelector(".rwgps-weather-strip");
    if (strip) strip.remove();
    var legend = document.getElementById("rwgps-weather-legend");
    if (legend) legend.remove();
  }

  // ─── Weather Modal (date/time picker for routes) ────────────────────────

  function showWeatherModal(onApply, onCancel) {
    var existing = document.querySelector(".rwgps-weather-modal-backdrop");
    if (existing) existing.remove();

    var backdrop = document.createElement("div");
    backdrop.className = "rwgps-weather-modal-backdrop";

    var modal = document.createElement("div");
    modal.className = "rwgps-daylight-modal";

    var title = document.createElement("h3");
    title.textContent = "Weather Prediction \u2014 Choose Start Time";
    modal.appendChild(title);

    var desc = document.createElement("p");
    desc.className = "rwgps-daylight-modal-desc";
    desc.textContent = "Select when you plan to ride this route to see weather conditions along your ride.";
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

  function closeWeatherModal() {
    var backdrop = document.querySelector(".rwgps-weather-modal-backdrop");
    if (backdrop) backdrop.remove();
  }

  // ─── Wind Layer Integration ─────────────────────────────────────────────

  function applyWindLayer(weatherBlocks, times) {
    if (!weatherBlocks || weatherBlocks.length === 0 || !times || times.length === 0) return;
    var midTime = new Date((times[0].getTime() + times[times.length - 1].getTime()) / 2);
    document.dispatchEvent(new CustomEvent("rwgps-weather-wind-apply", {
      detail: JSON.stringify({ timestamp: midTime.toISOString() })
    }));
  }

  function removeWindLayer() {
    document.dispatchEvent(new CustomEvent("rwgps-weather-wind-remove"));
  }

  // ─── Weather Toggle ─────────────────────────────────────────────────────

  R.toggleWeather = async function () {
    R.weatherActive = !R.weatherActive;
    if (R.weatherActive) {
      await R.enableWeather();
    } else {
      R.disableWeather();
    }
  };

  R.toggleWeatherSub = function (which) {
    switch (which) {
      case "temp":   R.weatherTempActive   = !R.weatherTempActive;   break;
      case "precip": R.weatherPrecipActive = !R.weatherPrecipActive; break;
      case "cloud":  R.weatherCloudActive  = !R.weatherCloudActive;  break;
      case "wind":   R.weatherWindActive   = !R.weatherWindActive;   break;
      case "strip":  R.weatherStripActive  = !R.weatherStripActive;  break;
      default: return;
    }
    if (which === "wind") {
      if (R.weatherActive && R.weatherWindActive && R.cachedWeatherData && R.cachedWeatherTimes) {
        applyWindLayer(R.cachedWeatherData, R.cachedWeatherTimes);
      } else {
        removeWindLayer();
      }
    }
    if (R.weatherActive && R.cachedTrackPoints && R.cachedWeatherData) {
      renderWeatherOverlay(R.cachedTrackPoints, R.cachedWeatherData);
    }
  };

  // ─── Hover Tooltip Integration ──────────────────────────────────────────

  var weatherHoverCanvas = null;
  var weatherHoverHandler = null;
  var weatherHoverObserver = null;
  var weatherHoverLastStr = null;

  function findWeatherGraphCanvas() {
    if (typeof R.findSampleGraphCanvas === "function") {
      var found = R.findSampleGraphCanvas();
      if (found && found.canvas) return found.canvas;
    }
    var candidates = document.querySelectorAll('[class*="SampleGraph"], [class*="sampleGraph"]');
    for (var ci = 0; ci < candidates.length; ci++) {
      var c = candidates[ci].querySelector(OVERLAY_EXCLUDE);
      if (c) return c;
    }
    return null;
  }

  function findWeatherHoverEl(root) {
    var scope = root || document;
    return scope.querySelector(".sg-hover-details") || scope.querySelector('[class*="sgMetricsDisplay"]');
  }

  function nearestBlockForDistance(dist) {
    if (!R.cachedWeatherData) return null;
    for (var i = 0; i < R.cachedWeatherData.length; i++) {
      var b = R.cachedWeatherData[i];
      if (dist >= b.startDist && dist <= b.endDist) return b;
    }
    var first = R.cachedWeatherData[0];
    var last = R.cachedWeatherData[R.cachedWeatherData.length - 1];
    if (dist < first.startDist) return first;
    if (dist > last.endDist) return last;
    return null;
  }

  function compassFromDeg(deg) {
    var dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.round(((deg % 360) / 45)) % 8];
  }

  function buildWeatherTooltipString(block) {
    if (!block) return null;
    var parts = [];
    var unit = R.isMetric() ? "°C" : "°F";
    var windUnit = R.isMetric() ? "km/h" : "mph";
    if (R.weatherTempActive && block.temperature != null) {
      parts.push("T " + Math.round(block.temperature) + unit);
    }
    if (R.weatherCloudActive) {
      parts.push("☁ " + Math.round(block.cloudCover || 0) + "%");
    }
    if (R.weatherPrecipActive) {
      parts.push("💧 " + Math.round(block.precipChance || 0) + "%");
    }
    if (R.weatherWindActive) {
      parts.push(compassFromDeg(block.windDir || 0) + " " + Math.round(block.windSpeed || 0) + " " + windUnit);
    }
    return parts.length ? parts.join("  ·  ") : null;
  }

  function injectWeatherIntoTooltip(str) {
    var details = findWeatherHoverEl();
    if (!details) return;
    var line = details.querySelector(".rwgps-weather-hover-label");
    if (!line) {
      line = document.createElement("div");
      line.className = "rwgps-weather-hover-label";
      details.appendChild(line);
    }
    if (line.textContent !== str) line.textContent = str;
  }

  function startWeatherHover() {
    stopWeatherHover();
    var canvas = findWeatherGraphCanvas();
    if (!canvas) return;
    weatherHoverCanvas = canvas;

    weatherHoverHandler = function (e) {
      if (!R.weatherActive || !R.cachedTrackPoints || !R.cachedWeatherData) return;
      var rect = canvas.getBoundingClientRect();
      var cssX = e.clientX - rect.left;
      if (cssX < 0 || cssX > rect.width) return;
      var layout = R.getGraphLayout && R.getGraphLayout();
      var xProj = layout && layout.xProjection;
      if (!xProj || !xProj.vScale) {
        var maxDist = R.cachedTrackPoints[R.cachedTrackPoints.length - 1].distance;
        if (!maxDist) return;
        xProj = { pixelOffset: 0, v0: 0, vScale: rect.width / maxDist };
      }
      var distance = (cssX - xProj.pixelOffset) / xProj.vScale + xProj.v0;
      var block = nearestBlockForDistance(distance);
      var str = buildWeatherTooltipString(block);
      if (!str) return;
      weatherHoverLastStr = str;
      injectWeatherIntoTooltip(str);
    };
    canvas.addEventListener("mousemove", weatherHoverHandler);
    var parent = canvas.parentElement;
    if (parent) parent.addEventListener("mousemove", weatherHoverHandler);

    var bottomPanel = canvas.closest('[class*="BottomPanel"]') || canvas.parentElement || document.body;
    weatherHoverObserver = new MutationObserver(function () {
      if (!R.weatherActive || !weatherHoverLastStr) return;
      var details = findWeatherHoverEl(bottomPanel) || findWeatherHoverEl();
      if (!details) return;
      if (details.querySelector(".rwgps-weather-hover-label")) return;
      injectWeatherIntoTooltip(weatherHoverLastStr);
    });
    weatherHoverObserver.observe(bottomPanel, { childList: true, subtree: true });
  }

  function stopWeatherHover() {
    if (weatherHoverHandler && weatherHoverCanvas) {
      weatherHoverCanvas.removeEventListener("mousemove", weatherHoverHandler);
      var parent = weatherHoverCanvas.parentElement;
      if (parent) parent.removeEventListener("mousemove", weatherHoverHandler);
    }
    weatherHoverHandler = null;
    weatherHoverCanvas = null;
    if (weatherHoverObserver) {
      weatherHoverObserver.disconnect();
      weatherHoverObserver = null;
    }
    weatherHoverLastStr = null;
    var line = document.querySelector(".rwgps-weather-hover-label");
    if (line) line.remove();
  }

  R.enableWeather = async function () {
    var pageInfo = R.getPageInfo();
    if (!pageInfo) return;

    if (!R.cachedTrackPoints) {
      R.cachedTrackPoints = await R.fetchTrackPoints(pageInfo.type, pageInfo.id);
      if (!R.cachedTrackPoints || R.cachedTrackPoints.length === 0) return;
    }

    if (pageInfo.type === "trip") {
      var times = R.computeTimeAtPoints(R.cachedTrackPoints, "trip", null);
      R.cachedWeatherTimes = times;
      if (!times[0] || isNaN(times[0].getTime()) || times[0].getFullYear() < 2000) {
        if (R.cachedDepartedAt) {
          times = R.computeTimeAtPoints(R.cachedTrackPoints, "route", R.cachedDepartedAt, R.getUserSummary());
          R.cachedWeatherTimes = times;
        }
      }
      var weatherBlocks = await fetchWeatherForRoute(R.cachedTrackPoints, times);
      R.cachedWeatherData = weatherBlocks;
      if (R.weatherWindActive) applyWindLayer(weatherBlocks, times);
      R.retryOverlayRender("weatherActive", function () {
        return renderWeatherOverlay(R.cachedTrackPoints, weatherBlocks);
      }, function () {
        startWeatherSync();
        startWeatherHover();
      });
    } else {
      R.cachedUserSummary = R.getUserSummary();
      showWeatherModal(function (startDate) {
        R.weatherStartDate = startDate;
        var times = R.computeTimeAtPoints(R.cachedTrackPoints, "route", startDate, R.cachedUserSummary);
        R.cachedWeatherTimes = times;
        fetchWeatherForRoute(R.cachedTrackPoints, times).then(function (weatherBlocks) {
          R.cachedWeatherData = weatherBlocks;
          applyWindLayer(weatherBlocks, times);
          R.retryOverlayRender("weatherActive", function () {
            return renderWeatherOverlay(R.cachedTrackPoints, weatherBlocks);
          }, function () {
            startWeatherSync();
          });
        });
      }, function () {
        R.weatherActive = false;
        var menu = document.querySelector(".rwgps-enhancements-menu");
        if (menu) R.updateEnhancementsMenu(menu);
      });
    }
  };

  R.disableWeather = function () {
    stopWeatherHover();
    removeWeatherOverlay();
    closeWeatherModal();
    removeWindLayer();
    R.cachedWeatherData = null;
    R.cachedWeatherTimes = null;
    R.weatherStartDate = null;
  };

})(window.RE);
