(function () {
  "use strict";

  // ─── Speed Color Computation (ported from lib/speedColors.ts) ──────────

  const NUM_BUCKETS = 20;
  const SLOW_COLOR = { r: 74, g: 0, b: 0 };    // #4A0000 dark red
  const AVG_COLOR  = { r: 255, g: 0, b: 0 };    // #FF0000 red
  const FAST_COLOR = { r: 255, g: 255, b: 0 };   // #FFFF00 yellow

  function lerp(a, b, t) {
    return Math.round(a + (b - a) * t);
  }

  function colorToHex(r, g, b) {
    return "#" + [r, g, b].map(function (c) { return c.toString(16).padStart(2, "0"); }).join("");
  }

  function speedToColor(speed, avgSpeed, maxSpeed) {
    if (avgSpeed <= 0 || maxSpeed <= 0) return colorToHex(AVG_COLOR.r, AVG_COLOR.g, AVG_COLOR.b);
    var clamped = Math.max(0, Math.min(speed, maxSpeed));
    if (clamped <= avgSpeed) {
      var t = clamped / avgSpeed;
      return colorToHex(lerp(SLOW_COLOR.r, AVG_COLOR.r, t), lerp(SLOW_COLOR.g, AVG_COLOR.g, t), lerp(SLOW_COLOR.b, AVG_COLOR.b, t));
    }
    var t2 = (clamped - avgSpeed) / (maxSpeed - avgSpeed);
    return colorToHex(lerp(AVG_COLOR.r, FAST_COLOR.r, t2), lerp(AVG_COLOR.g, FAST_COLOR.g, t2), lerp(AVG_COLOR.b, FAST_COLOR.b, t2));
  }

  function speedToBucket(speed, maxSpeed) {
    if (maxSpeed <= 0) return 0;
    var t = Math.max(0, Math.min(speed, maxSpeed)) / maxSpeed;
    return Math.min(Math.floor(t * NUM_BUCKETS), NUM_BUCKETS - 1);
  }

  function buildBucketColors(avgSpeed, maxSpeed) {
    var colors = [];
    for (var i = 0; i < NUM_BUCKETS; i++) {
      colors.push(speedToColor((i / (NUM_BUCKETS - 1)) * maxSpeed, avgSpeed, maxSpeed));
    }
    return colors;
  }

  function computeSpeedStats(points) {
    var totalSpeed = 0, maxSpeed = 0, count = 0;
    for (var i = 0; i < points.length; i++) {
      var s = points[i].speed || 0;
      if (s > 0) { totalSpeed += s; count++; }
      if (s > maxSpeed) maxSpeed = s;
    }
    return { avgSpeed: count > 0 ? totalSpeed / count : 0, maxSpeed: maxSpeed };
  }

  function splitBySpeedColor(points) {
    if (points.length === 0) return [];
    var stats = computeSpeedStats(points);
    if (stats.maxSpeed <= 0) {
      return [{ points: points, color: colorToHex(AVG_COLOR.r, AVG_COLOR.g, AVG_COLOR.b) }];
    }
    var bucketColors = buildBucketColors(stats.avgSpeed, stats.maxSpeed);
    var segments = [];
    var currentBucket = speedToBucket(points[0].speed || 0, stats.maxSpeed);
    var currentSeg = [points[0]];
    for (var i = 1; i < points.length; i++) {
      var bucket = speedToBucket(points[i].speed || 0, stats.maxSpeed);
      if (bucket !== currentBucket) {
        segments.push({ points: currentSeg, color: bucketColors[currentBucket] });
        currentSeg = [points[i - 1], points[i]];
        currentBucket = bucket;
      } else {
        currentSeg.push(points[i]);
      }
    }
    if (currentSeg.length > 0) segments.push({ points: currentSeg, color: bucketColors[currentBucket] });
    return segments;
  }

  // ─── Estimated Speed from Grade ─────────────────────────────────────────
  // Fallback model matching RWGPS: ~25 kph on flat, slower uphill, faster downhill

  function estimatedSpeedFromGrade(grade) {
    var clampedGrade = Math.max(-15, Math.min(15, Math.round(grade)));
    var baseSpeed = 25; // kph on flat
    return Math.max(3, baseSpeed - clampedGrade * 1.5);
  }

  // ─── Track Data Fetching ───────────────────────────────────────────────

  function normalizeTrackPoint(raw) {
    return {
      lat: raw.y != null ? raw.y : raw.lat,
      lng: raw.x != null ? raw.x : raw.lng,
      ele: raw.e != null ? raw.e : (raw.ele != null ? raw.ele : 0),
      speed: raw.S != null ? raw.S : (raw.s != null ? raw.s : (raw.speed != null ? raw.speed : 0)),
      distance: 0, // will be computed
      time: raw.t != null ? raw.t : (raw.time != null ? raw.time : 0),
      grade: raw.grade != null ? raw.grade : 0,
    };
  }

  // Haversine distance in meters between two lat/lng points
  function haversine(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Compute cumulative distance and speed from lat/lng/time (for trips)
  function computeDistanceAndSpeed(points) {
    if (points.length === 0) return points;
    points[0].distance = 0;
    points[0].speed = 0;

    // First pass: compute cumulative distance and raw speed
    for (var i = 1; i < points.length; i++) {
      var segDist = haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
      points[i].distance = points[i - 1].distance + segDist;

      if (points[i].speed <= 0) {
        var dt = points[i].time - points[i - 1].time;
        if (dt > 0) {
          points[i].speed = segDist / dt; // m/s
        } else {
          points[i].speed = points[i - 1].speed || 0;
        }
      }
    }

    // Second pass: smooth speed with a 5-point moving average
    var rawSpeeds = points.map(function (p) { return p.speed; });
    var win = 5;
    for (var j = 0; j < points.length; j++) {
      var sum = 0, count = 0;
      for (var k = Math.max(0, j - win); k <= Math.min(points.length - 1, j + win); k++) {
        sum += rawSpeeds[k];
        count++;
      }
      points[j].speed = sum / count;
    }

    return points;
  }

  // Compute distance, grade, and estimated speed for routes (no timestamps)
  function computeRouteSpeedFromGrade(points) {
    if (points.length === 0) return points;
    points[0].distance = 0;
    points[0].grade = 0;
    points[0].speed = estimatedSpeedFromGrade(0) / 3.6; // kph → m/s

    for (var i = 1; i < points.length; i++) {
      var segDist = haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
      points[i].distance = points[i - 1].distance + segDist;

      // Compute grade from elevation change over distance
      if (segDist > 0) {
        var dEle = points[i].ele - points[i - 1].ele;
        points[i].grade = (dEle / segDist) * 100; // percent
      } else {
        points[i].grade = points[i - 1].grade || 0;
      }
    }

    // Smooth grade with a 5-point moving average to reduce GPS noise
    var rawGrades = points.map(function (p) { return p.grade; });
    var win = 5;
    for (var j = 0; j < points.length; j++) {
      var sum = 0, count = 0;
      for (var k = Math.max(0, j - win); k <= Math.min(points.length - 1, j + win); k++) {
        sum += rawGrades[k];
        count++;
      }
      points[j].grade = sum / count;
      // Convert estimated speed from kph to m/s for consistency
      points[j].speed = estimatedSpeedFromGrade(points[j].grade) / 3.6;
    }

    return points;
  }

  async function fetchTrackPoints(objectType, objectId) {
    var url = "https://ridewithgps.com/" + objectType + "s/" + objectId + ".json";
    console.log("[Speed Colors] Fetching:", url);
    var resp = await fetch(url, {
      credentials: "same-origin",
      headers: {
        "x-rwgps-api-key": "ak17s7k3",
        "x-rwgps-api-version": "3",
        "Accept": "application/json",
      },
    });
    if (!resp.ok) {
      console.error("[Speed Colors] Fetch failed:", resp.status);
      return [];
    }
    var data = await resp.json();
    // Response may be { trip: {...} } or the trip object directly
    var obj = data[objectType] || data;
    var rawPoints = obj.trackPoints || obj.track_points || [];
    console.log("[Speed Colors] Raw points count:", rawPoints.length);
    if (rawPoints.length > 0) {
      console.log("[Speed Colors] Raw point keys:", Object.keys(rawPoints[0]));
    }
    var normalized = rawPoints.map(normalizeTrackPoint).filter(function (p) { return p.lat && p.lng; });

    // Routes have no timestamps — estimate speed from grade
    // Trips have timestamps — compute speed from distance/time
    if (objectType === "route") {
      computeRouteSpeedFromGrade(normalized);
      console.log("[Speed Colors] Route mode: estimated speed from grade");
    } else {
      computeDistanceAndSpeed(normalized);
    }

    var speedStats = computeSpeedStats(normalized);
    console.log("[Speed Colors] Speed stats - avg:", speedStats.avgSpeed.toFixed(2), "m/s, max:", speedStats.maxSpeed.toFixed(2), "m/s");
    console.log("[Speed Colors] Total distance:", (normalized.length > 0 ? normalized[normalized.length - 1].distance : 0).toFixed(0), "m");

    return normalized;
  }

  // ─── Page Context Bridge ───────────────────────────────────────────────
  // Injected into the page to access the maplibre Map instance via React fiber

  function injectPageBridge() {
    var script = document.createElement("script");
    script.textContent = '(' + function () {
      var mapInstance = null;

      function findMaplibreMap() {
        var container = document.querySelector(".maplibregl-map");
        if (!container) return null;
        var fiberKey = Object.keys(container).find(function (k) {
          return k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$");
        });
        if (!fiberKey) return null;
        var fiber = container[fiberKey];
        while (fiber) {
          var inst = fiber.stateNode;
          if (inst && inst._map && typeof inst._map.addSource === "function") {
            return inst._map;
          }
          fiber = fiber.return;
        }
        return null;
      }

      function getMap() {
        if (mapInstance && mapInstance.getCanvas()) return mapInstance;
        mapInstance = findMaplibreMap();
        return mapInstance;
      }

      document.addEventListener("rwgps-speed-colors-add", function (e) {
        var map = getMap();
        if (!map) {
          document.documentElement.setAttribute("data-speed-colors-status", "no-map");
          return;
        }
        try {
          // Remove existing layers first
          if (map.getLayer("rwgps-speed-line")) map.removeLayer("rwgps-speed-line");
          if (map.getLayer("rwgps-speed-line-casing")) map.removeLayer("rwgps-speed-line-casing");
          if (map.getSource("rwgps-speed-colors")) map.removeSource("rwgps-speed-colors");

          var features = JSON.parse(e.detail);

          map.addSource("rwgps-speed-colors", {
            type: "geojson",
            data: { type: "FeatureCollection", features: features }
          });

          // Casing (outline) layer for contrast
          map.addLayer({
            id: "rwgps-speed-line-casing",
            type: "line",
            source: "rwgps-speed-colors",
            paint: {
              "line-color": "#000000",
              "line-width": 6,
              "line-opacity": 0.3
            }
          });

          // Color layer on top
          map.addLayer({
            id: "rwgps-speed-line",
            type: "line",
            source: "rwgps-speed-colors",
            paint: {
              "line-color": ["get", "color"],
              "line-width": 4,
              "line-opacity": 0.9
            }
          });

          document.documentElement.setAttribute("data-speed-colors-status", "active");
        } catch (err) {
          console.error("Speed colors map error:", err);
          document.documentElement.setAttribute("data-speed-colors-status", "error");
        }
      });

      document.addEventListener("rwgps-speed-colors-remove", function () {
        var map = getMap();
        if (!map) return;
        try {
          if (map.getLayer("rwgps-speed-line")) map.removeLayer("rwgps-speed-line");
          if (map.getLayer("rwgps-speed-line-casing")) map.removeLayer("rwgps-speed-line-casing");
          if (map.getSource("rwgps-speed-colors")) map.removeSource("rwgps-speed-colors");
        } catch (err) { /* ignore */ }
        document.documentElement.setAttribute("data-speed-colors-status", "inactive");
      });

      // Extract graph layout from React fiber for accurate elevation overlay
      document.addEventListener("rwgps-speed-colors-get-layout", function () {
        try {
          var graphContainer = document.querySelector('[class*="SampleGraph"]');
          if (!graphContainer) { publishLayout(null); return; }
          var inner = graphContainer.firstElementChild;
          if (!inner) { publishLayout(null); return; }
          var fiberKey = Object.keys(inner).find(function (k) {
            return k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$");
          });
          if (!fiberKey) { publishLayout(null); return; }
          var fiber = inner[fiberKey];
          // Walk up fibers looking for GraphContext provider value
          while (fiber) {
            // Check memoizedProps for layout data
            var props = fiber.memoizedProps || fiber.pendingProps || {};
            if (props.value && props.value.plotMargin && props.value.plotWidth != null) {
              var v = props.value;
              publishLayout({
                plotMargin: v.plotMargin,
                plotWidth: v.plotWidth,
                plotHeight: v.plotHeight,
                xProjection: v.xProjection ? {
                  pixelOffset: v.xProjection.pixelOffset,
                  v0: v.xProjection.v0,
                  vScale: v.xProjection.vScale
                } : null,
                yProjection: (function() {
                  if (!v.yProjections) return null;
                  var eleProj = v.yProjections.ele || v.yProjections[Object.keys(v.yProjections)[0]];
                  if (!eleProj) return null;
                  return { pixelOffset: eleProj.pixelOffset, v0: eleProj.v0, vScale: eleProj.vScale, invert: !!eleProj.invert };
                })()
              });
              return;
            }
            fiber = fiber.return;
          }
          publishLayout(null);
        } catch (err) {
          console.error("[Speed Colors] Layout extraction error:", err);
          publishLayout(null);
        }
      });

      function publishLayout(layout) {
        document.documentElement.setAttribute("data-speed-colors-layout", layout ? JSON.stringify(layout) : "");
      }
    } + ')();';
    document.documentElement.appendChild(script);
    script.remove();
  }

  injectPageBridge();

  // ─── Elevation Graph Overlay ───────────────────────────────────────────

  function colorElevationGraph(trackPoints) {
    // Find the canvas inside any SampleGraph container
    // On route pages, MultiSampleGraph wraps multiple SampleGraph containers
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
    if (!origCanvas || !graphContainer) {
      console.log("[Speed Colors] Elevation: no canvas found in SampleGraph containers, candidates:", candidates.length);
      return null;
    }
    console.log("[Speed Colors] Elevation: found canvas", origCanvas.width, "x", origCanvas.height,
      "in container class:", graphContainer.className.substring(0, 60));

    // Remove existing overlay
    var existing = graphContainer.querySelector(".rwgps-speed-elevation-overlay");
    if (existing) existing.remove();

    // Read the original canvas to detect the actual plot area boundaries
    var origCtx = origCanvas.getContext("2d", { willReadFrequently: true });
    if (!origCtx) return null;

    var cw = origCanvas.width;
    var ch = origCanvas.height;
    var imageData = origCtx.getImageData(0, 0, cw, ch);
    var pixels = imageData.data;

    // Helper: check if pixel at (px, py) is non-transparent and non-white
    function isFilledPixel(px, py) {
      var idx = (py * cw + px) * 4;
      var a = pixels[idx + 3];
      if (a < 30) return false; // transparent
      var r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
      if (r > 240 && g > 240 && b > 240) return false; // white/near-white
      return true;
    }

    // Find the fill region by scanning for colored pixels
    // The elevation fill is the large colored area — find its bounding box
    var fillTop = ch, fillBottom = 0, fillLeft = cw, fillRight = 0;
    // Sample every 2nd pixel for speed
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

    // The plot area is bounded by the fill region
    // Refine: the bottom of the plot is the x-axis line, which is at fillBottom
    // The left edge is where the y-axis ends
    var plotLeftPx = fillLeft;
    var plotRightPx = fillRight;
    var plotBottomPx = fillBottom;

    // Find the actual top of the elevation fill (not axis labels)
    // by scanning down from the top at the center x
    var centerX = Math.floor((plotLeftPx + plotRightPx) / 2);
    var plotTopPx = fillTop;

    console.log("[Speed Colors] Detected plot area (canvas px):",
      "left:", plotLeftPx, "right:", plotRightPx, "top:", plotTopPx, "bottom:", plotBottomPx);

    // Now create the overlay canvas — must match the original canvas exactly
    var overlay = document.createElement("canvas");
    overlay.className = "rwgps-speed-elevation-overlay";
    overlay.width = cw;
    overlay.height = ch;
    // Use computed size as fallback if no inline style
    var cssWidth = origCanvas.style.width || (origCanvas.offsetWidth + "px");
    var cssHeight = origCanvas.style.height || (origCanvas.offsetHeight + "px");
    overlay.style.cssText = "position:absolute;top:0;left:0;width:" +
      cssWidth + ";height:" + cssHeight +
      ";pointer-events:none;z-index:1;";

    // Place overlay in the same parent as the canvas, positioned over it
    var canvasParent = origCanvas.parentElement;
    var parentPos = window.getComputedStyle(canvasParent);
    if (parentPos.position === "static") canvasParent.style.position = "relative";
    canvasParent.appendChild(overlay);

    var ctx = overlay.getContext("2d");
    if (!ctx) return overlay;

    // Work in canvas pixel coordinates (no DPR transform needed — we match the original canvas)
    var plotWidthPx = plotRightPx - plotLeftPx;

    // Map track data to canvas pixel x positions
    var maxDist = trackPoints[trackPoints.length - 1].distance;
    if (maxDist === 0) return overlay;

    // For each column in the plot area, find where the original fill exists
    // and paint speed color there
    var stats = computeSpeedStats(trackPoints);
    var ptIdx = 0;

    ctx.globalAlpha = 0.6;

    // Draw column by column for pixel-perfect alignment
    for (var cx2 = plotLeftPx; cx2 <= plotRightPx; cx2++) {
      // Map canvas x to distance
      var dist = ((cx2 - plotLeftPx) / plotWidthPx) * maxDist;

      // Find the track point closest to this distance
      while (ptIdx < trackPoints.length - 1 && trackPoints[ptIdx + 1].distance < dist) {
        ptIdx++;
      }
      var speed = trackPoints[ptIdx].speed || 0;
      var color = speedToColor(speed, stats.avgSpeed, stats.maxSpeed);

      // Scan this column on the original canvas to find the largest
      // contiguous filled run (the elevation fill), ignoring thin features
      // like axis lines or grid lines
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
      // Check final run
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

  // ─── UI Toggle ─────────────────────────────────────────────────────────

  var speedColorsActive = false;
  var cachedTrackPoints = null;
  var cachedSegments = null;
  var lastTRoutePage = null;

  function createToggleButton() {
    var existing = document.querySelector(".rwgps-speed-toggle");
    if (existing) return existing;

    var btn = document.createElement("button");
    btn.className = "rwgps-speed-toggle";
    btn.title = "Toggle speed colors";
    btn.innerHTML = '<span class="rwgps-speed-toggle-icon">\u{1F308}</span> Speed Colors';
    btn.addEventListener("click", function () { toggleSpeedColors(); });
    return btn;
  }

  function insertToggle() {
    var existing = document.querySelector(".rwgps-speed-toggle");
    if (existing) return;

    var btn = createToggleButton();

    // Find the rightControls container (flex-direction: row-reverse, so appending = leftmost)
    var rightControls = document.querySelector('[class*="rightControls"]');
    if (rightControls) {
      rightControls.appendChild(btn);
      console.log("[Speed Colors] Toggle inserted into rightControls");
      return;
    }

    // Fallback: float over the map
    var mapContainer =
      document.querySelector(".maplibregl-map") ||
      document.querySelector(".gm-style") ||
      document.querySelector('[class*="MapV2"]');
    if (mapContainer) {
      var parent = mapContainer.closest('[class*="MapV2"]') || mapContainer.parentElement;
      if (parent) {
        btn.classList.add("rwgps-speed-toggle-floating");
        parent.appendChild(btn);
        console.log("[Speed Colors] Toggle inserted (floating fallback)");
      }
    }
  }

  async function toggleSpeedColors() {
    speedColorsActive = !speedColorsActive;

    var btn = document.querySelector(".rwgps-speed-toggle");
    if (btn) {
      btn.classList.toggle("rwgps-speed-toggle-active", speedColorsActive);
    }

    if (speedColorsActive) {
      await enableSpeedColors();
    } else {
      disableSpeedColors();
    }
  }

  async function enableSpeedColors() {
    var pageInfo = getPageInfo();
    if (!pageInfo) return;

    // Fetch track data if not cached
    if (!cachedTrackPoints) {
      console.log("[Speed Colors] Fetching track points for", pageInfo.type, pageInfo.id);
      cachedTrackPoints = await fetchTrackPoints(pageInfo.type, pageInfo.id);
      console.log("[Speed Colors] Got", cachedTrackPoints.length, "track points");
      if (cachedTrackPoints.length > 0) {
        console.log("[Speed Colors] Sample point:", JSON.stringify(cachedTrackPoints[0]));
      }
    }
    if (!cachedTrackPoints || cachedTrackPoints.length === 0) {
      console.warn("[Speed Colors] No track points found");
      return;
    }

    // Compute segments
    if (!cachedSegments) {
      cachedSegments = splitBySpeedColor(cachedTrackPoints);
      console.log("[Speed Colors] Split into", cachedSegments.length, "segments");
    }

    // Send to map
    var features = cachedSegments.map(function (seg) {
      return {
        type: "Feature",
        properties: { color: seg.color },
        geometry: {
          type: "LineString",
          coordinates: seg.points.map(function (p) { return [p.lng, p.lat]; })
        }
      };
    });

    console.log("[Speed Colors] Sending", features.length, "features to map");
    document.dispatchEvent(new CustomEvent("rwgps-speed-colors-add", {
      detail: JSON.stringify(features)
    }));

    // Check result
    setTimeout(function () {
      var status = document.documentElement.getAttribute("data-speed-colors-status");
      console.log("[Speed Colors] Map status:", status);
    }, 500);

    // Color elevation graph — slight delay to ensure canvas has rendered
    setTimeout(function () {
      var overlay = colorElevationGraph(cachedTrackPoints);
      console.log("[Speed Colors] Elevation overlay:", overlay ? "created" : "failed");
      // Retry once if canvas wasn't ready
      if (!overlay) {
        setTimeout(function () {
          var retry = colorElevationGraph(cachedTrackPoints);
          console.log("[Speed Colors] Elevation overlay retry:", retry ? "created" : "failed");
        }, 1000);
      }
    }, 300);
  }

  function disableSpeedColors() {
    document.dispatchEvent(new CustomEvent("rwgps-speed-colors-remove"));
    removeElevationOverlay();
  }

  // ─── Page Detection ────────────────────────────────────────────────────

  function getPageInfo() {
    var tripMatch = location.pathname.match(/^\/trips\/(\d+)/);
    if (tripMatch) return { type: "trip", id: tripMatch[1] };
    var routeMatch = location.pathname.match(/^\/routes\/(\d+)/);
    if (routeMatch) return { type: "route", id: routeMatch[1] };
    return null;
  }

  function waitForElement(selector, timeout) {
    return new Promise(function (resolve) {
      var el = document.querySelector(selector);
      if (el) return resolve(el);
      var obs = new MutationObserver(function () {
        var el = document.querySelector(selector);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(function () { obs.disconnect(); resolve(null); }, timeout);
    });
  }

  async function checkTRoutePage() {
    // Skip if speed colors feature is disabled
    var settings = await browser.storage.local.get({ speedColorsEnabled: true });
    if (!settings.speedColorsEnabled) {
      if (lastTRoutePage) {
        disableSpeedColors();
        speedColorsActive = false;
        var btn = document.querySelector(".rwgps-speed-toggle");
        if (btn) btn.remove();
        cachedTrackPoints = null;
        cachedSegments = null;
        lastTRoutePage = null;
      }
      return;
    }

    var pageInfo = getPageInfo();
    var pageKey = pageInfo ? pageInfo.type + ":" + pageInfo.id : null;

    if (!pageInfo) {
      if (lastTRoutePage) {
        // Left a trip/route page
        disableSpeedColors();
        speedColorsActive = false;
        var btn = document.querySelector(".rwgps-speed-toggle");
        if (btn) btn.remove();
        cachedTrackPoints = null;
        cachedSegments = null;
        lastTRoutePage = null;
      }
      return;
    }

    if (pageKey === lastTRoutePage && document.querySelector(".rwgps-speed-toggle")) {
      return; // already set up
    }

    // New trip/route page
    if (pageKey !== lastTRoutePage) {
      cachedTrackPoints = null;
      cachedSegments = null;
      speedColorsActive = false;
    }
    lastTRoutePage = pageKey;

    // Wait for any map container to render
    var mapEl = await waitForElement('.maplibregl-map, .gm-style, [class*="MapV2"], [class*="mapContainer"]', 10000);
    console.log("[Speed Colors] Map element found:", mapEl ? mapEl.className : "none");

    // Re-check we're still on the same page
    var recheck = getPageInfo();
    if (!recheck || (recheck.type + ":" + recheck.id) !== pageKey) return;

    insertToggle();
  }

  // Poll for page changes (SPA navigation)
  setInterval(checkTRoutePage, 1000);
  checkTRoutePage();

})();
