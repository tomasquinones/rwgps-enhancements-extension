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

  // ─── Hill Finder (ported from lib/insights/hill_finder.js) ──────────────

  var MIN_ABS_GRADE_FOR_HILL = 0.03;
  var MIN_DIST_TO_SAVE = 800;
  var MIN_DIST_TO_CONSIDER = 300;

  function buildSplitObject(firstI, lastI, deltaE) {
    return { first_i: firstI, last_i: lastI, delta_e: deltaE };
  }

  function hillFinderState(points, sign) {
    return {
      points: points,
      sign: sign,
      i: 0,
      firstI: 0,
      peakI: 0,
      antiPeakI: 0,
      adjusting: false
    };
  }

  function hfReset(hf) {
    if (hf.adjusting) {
      hf.adjusting = false;
    } else {
      hf.firstI = hf.peakI = hf.antiPeakI = hf.i;
    }
  }

  function hfExpand(hf) {
    if (!Number.isFinite(hf.points[hf.i].ele)) return;

    var points = hf.points, sign = hf.sign, i = hf.i, firstI = hf.firstI, peakI = hf.peakI, antiPeakI = hf.antiPeakI;
    var pt = points[i];
    var first = points[firstI];
    var eleDelta = sign * (pt.ele - first.ele);

    if (eleDelta <= 0) {
      hfReset(hf);
      return;
    }

    var peak = points[peakI];
    var distance = Math.abs(pt.distance - first.distance);
    var distToPeak = Math.abs(peak.distance - first.distance);
    var avgGrade = eleDelta / distance;
    var avgGradeToPeak = eleDelta / distToPeak;

    if (distance > MIN_DIST_TO_CONSIDER && avgGrade < MIN_ABS_GRADE_FOR_HILL) {
      if (distToPeak > 0 && avgGradeToPeak > MIN_ABS_GRADE_FOR_HILL) {
        var hill = hfSubmitHill(hf);
        if (hill) return hill;
      } else {
        hfReset(hf);
        return;
      }
    }

    var antiPeak = points[antiPeakI];
    var peakToNewPeakGrade = (sign * (pt.ele - peak.ele)) / Math.abs(pt.distance - peak.distance);
    if (
      sign * pt.ele > sign * peak.ele &&
      Math.abs(peak.ele - antiPeak.ele) / 2 < Math.abs(pt.ele - peak.ele) &&
      peakToNewPeakGrade > 0.01
    ) {
      hf.peakI = i;
      hf.antiPeakI = i;
    } else if (sign * pt.ele < sign * antiPeak.ele) {
      hf.antiPeakI = i;
    }
  }

  function hfAdjust(hf) {
    var hillFirstI = hf.firstI;
    var hillLastI = hf.peakI;
    var updatedHillFirstI = hillFirstI;
    var updatedHillLastI = hillLastI;

    do {
      hillFirstI = updatedHillFirstI;
      hillLastI = updatedHillLastI;

      hf.sign = -hf.sign;
      hf.i = hillFirstI;
      hfReset(hf);
      hf.firstI = hillLastI;
      hf.adjusting = true;
      while (hf.adjusting && --hf.i >= 0) {
        hfExpand(hf);
      }
      hf.adjusting = false;
      updatedHillFirstI = hf.peakI;

      hf.sign = -hf.sign;
      hf.i = hillLastI;
      hfReset(hf);
      hf.firstI = updatedHillFirstI;
      hf.adjusting = true;
      while (hf.adjusting && ++hf.i < hf.points.length) {
        hfExpand(hf);
      }
      hf.adjusting = false;
      updatedHillLastI = hf.peakI;
    } while (updatedHillFirstI < hillFirstI || updatedHillLastI > hillLastI);

    hf.i = hf.peakI = hillLastI;
  }

  function hfSubmitHill(hf) {
    if (hf.firstI === hf.peakI) return;
    if (hf.adjusting) {
      hf.adjusting = false;
      return;
    }

    hfAdjust(hf);

    var points = hf.points, sign = hf.sign, firstI = hf.firstI, peakI = hf.peakI;
    hfReset(hf);

    var distance = points[peakI].distance - points[firstI].distance;
    var deltaE = points[peakI].ele - points[firstI].ele;
    var avgGrade = (sign * deltaE) / distance;

    if (distance > MIN_DIST_TO_SAVE && avgGrade > MIN_ABS_GRADE_FOR_HILL) {
      return buildSplitObject(firstI, peakI, deltaE);
    }
  }

  function findAllHills(hf) {
    hfReset(hf);
    var hills = [];
    hf.i = hf.points.findIndex(function (p) { return Number.isFinite(p.ele); });
    if (hf.i === -1) return [];
    hfReset(hf);
    while (++hf.i < hf.points.length) {
      var hill = hfExpand(hf);
      if (hill) hills.push(hill);
    }
    var hill = hfSubmitHill(hf);
    if (hill) hills.push(hill);
    return hills;
  }

  function testAntiPeakForMergeWithGap(hf, leftHill, rightHill) {
    var points = hf.points, sign = hf.sign;
    var peak = points[leftHill.last_i].ele;
    var antiPeak = peak;
    for (var i = leftHill.last_i; i < rightHill.first_i; i++) {
      if (sign * points[i].ele < antiPeak) {
        antiPeak = points[i].ele;
      }
    }
    return Math.abs(peak - antiPeak) / 2 < Math.abs(points[rightHill.last_i].ele - peak);
  }

  function mergeAndExpandHills(hf, leftHill, rightHill) {
    if (leftHill.last_i >= rightHill.last_i) return leftHill;
    hf.i = rightHill.last_i;
    hfReset(hf);
    hf.firstI = leftHill.first_i;
    hfAdjust(hf);
    var deltaE = hf.points[hf.peakI].ele - hf.points[hf.firstI].ele;
    return buildSplitObject(hf.firstI, hf.peakI, deltaE);
  }

  function mergeHills(hf, hills) {
    var lastHill;
    var updatedHills = hills;
    do {
      hills = updatedHills;
      lastHill = null;
      updatedHills = [];
      hills = hills.sort(function (a, b) { return a.first_i - b.first_i; });
      hills.forEach(function (hill) {
        if (!lastHill) {
          lastHill = hill;
          return;
        }
        if (lastHill.last_i < hill.first_i) {
          var distSeparating = hf.points[hill.first_i].distance - hf.points[lastHill.last_i].distance;
          var distance = hf.points[hill.last_i].distance - hf.points[lastHill.first_i].distance;
          var eleDelta = hf.sign * (hf.points[hill.last_i].ele - hf.points[lastHill.first_i].ele);
          var avgGrade = eleDelta / distance;
          if (
            distSeparating < MIN_DIST_TO_SAVE &&
            avgGrade > MIN_ABS_GRADE_FOR_HILL &&
            testAntiPeakForMergeWithGap(hf, lastHill, hill)
          ) {
            lastHill = mergeAndExpandHills(hf, lastHill, hill);
          } else {
            updatedHills.push(lastHill);
            lastHill = hill;
          }
        } else {
          lastHill = mergeAndExpandHills(hf, lastHill, hill);
        }
      });
      if (lastHill) {
        updatedHills.push(lastHill);
      }
    } while (hills.length > updatedHills.length);
    return hills;
  }

  function findHills(points, sign) {
    var hf = hillFinderState(points, sign);
    return mergeHills(hf, findAllHills(hf));
  }

  function findAscents(points) {
    return findHills(points, 1);
  }

  function findDescents(points) {
    return findHills(points, -1);
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
        if (mapInstance) {
          try {
            var canvas = mapInstance.getCanvas();
            if (canvas && canvas.isConnected) return mapInstance;
          } catch (e) {}
        }
        mapInstance = findMaplibreMap();
        return mapInstance;
      }

      // ─── Layer management ──────────────────────────────────────────────
      var speedColorFeatures = null;
      var layerWatchdogId = null;

      function addSpeedColorLayers(map, features) {
        try {
          if (map.getLayer("rwgps-speed-line")) map.removeLayer("rwgps-speed-line");
          if (map.getLayer("rwgps-speed-line-casing")) map.removeLayer("rwgps-speed-line-casing");
          if (map.getSource("rwgps-speed-colors")) map.removeSource("rwgps-speed-colors");
        } catch (e) {}

        map.addSource("rwgps-speed-colors", {
          type: "geojson",
          data: { type: "FeatureCollection", features: features }
        });

        map.addLayer({
          id: "rwgps-speed-line-casing",
          type: "line",
          source: "rwgps-speed-colors",
          paint: { "line-color": "#000000", "line-width": 6, "line-opacity": 0.3 }
        });

        map.addLayer({
          id: "rwgps-speed-line",
          type: "line",
          source: "rwgps-speed-colors",
          paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.9 }
        });
      }

      // Watchdog: re-adds missing layers and keeps them on top.
      // Runs every 500ms while any feature is active.
      function startLayerWatchdog() {
        if (layerWatchdogId) return;
        layerWatchdogId = setInterval(function () {
          var map = getMap();
          if (!map) return;
          if (!speedColorFeatures && !antFeatures && !climbFeatures && !descentFeatures) {
            clearInterval(layerWatchdogId);
            layerWatchdogId = null;
            return;
          }
          try {
            // Re-add speed color layers if missing
            if (speedColorFeatures && !map.getSource("rwgps-speed-colors")) {
              console.log("[Speed Colors] Watchdog: re-adding speed color layers");
              addSpeedColorLayers(map, speedColorFeatures);
            }
            // Re-add ant layers if missing (also handled by animation loop)
            if (antFeatures && !map.getSource("rwgps-travel-direction")) {
              console.log("[Travel Direction] Watchdog: re-adding ant layers");
              addAntLayers(map, antFeatures);
            }
            // Re-add climb/descent layers if missing
            if (climbFeatures && !map.getSource("rwgps-climbs")) {
              console.log("[Climbs] Watchdog: re-adding climb layers");
              addHillLayers(map, climbFeatures, "rwgps-climbs");
            }
            if (descentFeatures && !map.getSource("rwgps-descents")) {
              console.log("[Descents] Watchdog: re-adding descent layers");
              addHillLayers(map, descentFeatures, "rwgps-descents");
            }
            // Raise all custom layers to top (z-order: hill casings/lines, speed colors, ants, hill markers/labels)
            var allLayers = [
              "rwgps-climbs-line-casing", "rwgps-climbs-line",
              "rwgps-descents-line-casing", "rwgps-descents-line",
              "rwgps-speed-line-casing", "rwgps-speed-line",
              "rwgps-travel-ants-0", "rwgps-travel-ants-1",
              "rwgps-travel-ants-2", "rwgps-travel-ants-3", "rwgps-travel-ants-4",
              "rwgps-climbs-markers", "rwgps-climbs-labels",
              "rwgps-descents-markers", "rwgps-descents-labels"
            ];
            for (var i = 0; i < allLayers.length; i++) {
              if (map.getLayer(allLayers[i])) map.moveLayer(allLayers[i]);
            }
          } catch (e) {}
        }, 500);
      }

      document.addEventListener("rwgps-speed-colors-add", function (e) {
        var map = getMap();
        if (!map) {
          document.documentElement.setAttribute("data-speed-colors-status", "no-map");
          console.error("[Speed Colors] No map instance found");
          return;
        }
        try {
          speedColorFeatures = JSON.parse(e.detail);
          addSpeedColorLayers(map, speedColorFeatures);
          startLayerWatchdog();
          document.documentElement.setAttribute("data-speed-colors-status", "active");
          console.log("[Speed Colors] Layers added, watchdog started");
        } catch (err) {
          console.error("[Speed Colors] Map error:", err);
          document.documentElement.setAttribute("data-speed-colors-status", "error");
        }
      });

      document.addEventListener("rwgps-speed-colors-remove", function () {
        speedColorFeatures = null;
        var map = getMap();
        if (!map) return;
        try {
          if (map.getLayer("rwgps-speed-line")) map.removeLayer("rwgps-speed-line");
          if (map.getLayer("rwgps-speed-line-casing")) map.removeLayer("rwgps-speed-line-casing");
          if (map.getSource("rwgps-speed-colors")) map.removeSource("rwgps-speed-colors");
        } catch (err) { /* ignore */ }
        document.documentElement.setAttribute("data-speed-colors-status", "inactive");
      });

      // ─── Travel Direction (marching ants) ───────────────────────────────
      var antAnimationId = null;
      var antTierSteps = [0, 0, 0, 0, 0];
      var antFrameCount = 0;
      var antFeatures = null; // cached for re-adding after style changes

      // Dash-array cycle: shift a [2, 4] pattern (period 6) in 12 substeps.
      // Maplibre dash arrays alternate [dash, gap, dash, gap...].
      // To simulate offset, we split the pattern at the offset point.
      var dashSteps = (function () {
        var dash = 2, gap = 4, period = dash + gap, steps = 12;
        var result = [];
        for (var i = 0; i < steps; i++) {
          var offset = (i / steps) * period;
          if (offset < 0.001) {
            result.push([dash, gap]);
          } else if (offset < dash) {
            result.push([dash - offset, gap, offset, 0.001]);
          } else {
            var gapOffset = offset - dash;
            result.push([0.001, gap - gapOffset, dash, gapOffset > 0.001 ? gapOffset : 0.001]);
          }
        }
        return result;
      })();

      // Tier divisors: tier 0 = slowest, tier 4 = fastest
      var tierDivisors = [6, 4, 3, 2, 1];

      function addAntLayers(map, features) {
        // Remove existing first
        for (var i = 0; i < 5; i++) {
          var lid = "rwgps-travel-ants-" + i;
          try { if (map.getLayer(lid)) map.removeLayer(lid); } catch (e) {}
        }
        try { if (map.getSource("rwgps-travel-direction")) map.removeSource("rwgps-travel-direction"); } catch (e) {}

        map.addSource("rwgps-travel-direction", {
          type: "geojson",
          data: { type: "FeatureCollection", features: features }
        });

        for (var t = 0; t < 5; t++) {
          map.addLayer({
            id: "rwgps-travel-ants-" + t,
            type: "line",
            source: "rwgps-travel-direction",
            filter: ["==", ["get", "speedTier"], t],
            paint: {
              "line-color": "#ffffff",
              "line-width": 2,
              "line-opacity": 0.7,
              "line-dasharray": dashSteps[0]
            }
          });
        }
      }

      function animateAnts() {
        antAnimationId = requestAnimationFrame(animateAnts);
        if (document.hidden) return;
        if (!antFeatures) return;

        antFrameCount++;
        if (antFrameCount % 3 !== 0) return;

        var map = getMap();
        if (!map) return;

        // If layers disappeared (style reload on zoom), re-add them
        if (!map.getLayer("rwgps-travel-ants-0")) {
          try {
            addAntLayers(map, antFeatures);
          } catch (e) { return; }
        }

        for (var tier = 0; tier < 5; tier++) {
          if (antFrameCount % (tierDivisors[tier] * 3) === 0) {
            antTierSteps[tier] = (antTierSteps[tier] - 1 + dashSteps.length) % dashSteps.length;
            var layerId = "rwgps-travel-ants-" + tier;
            try {
              if (map.getLayer(layerId)) {
                map.setPaintProperty(layerId, "line-dasharray", dashSteps[antTierSteps[tier]]);
              }
            } catch (e) { /* ignore */ }
          }
        }
      }

      document.addEventListener("rwgps-travel-direction-add", function (e) {
        var map = getMap();
        if (!map) return;
        try {
          if (antAnimationId) { cancelAnimationFrame(antAnimationId); antAnimationId = null; }

          antFeatures = JSON.parse(e.detail);
          addAntLayers(map, antFeatures);
          startLayerWatchdog();

          // Reset and start animation
          antTierSteps = [0, 0, 0, 0, 0];
          antFrameCount = 0;
          animateAnts();
        } catch (err) {
          console.error("[Travel Direction] Map error:", err);
        }
      });

      document.addEventListener("rwgps-travel-direction-remove", function () {
        if (antAnimationId) { cancelAnimationFrame(antAnimationId); antAnimationId = null; }
        antFeatures = null;
        var map = getMap();
        if (!map) return;
        try {
          for (var i = 0; i < 5; i++) {
            var lid = "rwgps-travel-ants-" + i;
            if (map.getLayer(lid)) map.removeLayer(lid);
          }
          if (map.getSource("rwgps-travel-direction")) map.removeSource("rwgps-travel-direction");
        } catch (err) { /* ignore */ }
      });

      // ─── Climbs & Descents layers ──────────────────────────────────────
      var climbFeatures = null;
      var descentFeatures = null;

      function addHillLayers(map, features, prefix) {
        var lineCasingId = prefix + "-line-casing";
        var lineId = prefix + "-line";
        var markersId = prefix + "-markers";
        var labelsId = prefix + "-labels";
        try {
          if (map.getLayer(labelsId)) map.removeLayer(labelsId);
          if (map.getLayer(markersId)) map.removeLayer(markersId);
          if (map.getLayer(lineId)) map.removeLayer(lineId);
          if (map.getLayer(lineCasingId)) map.removeLayer(lineCasingId);
          if (map.getSource(prefix)) map.removeSource(prefix);
        } catch (e) {}

        map.addSource(prefix, {
          type: "geojson",
          data: { type: "FeatureCollection", features: features }
        });

        map.addLayer({
          id: lineCasingId,
          type: "line",
          source: prefix,
          filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": "#000000", "line-width": 6, "line-opacity": 0.3 }
        });

        map.addLayer({
          id: lineId,
          type: "line",
          source: prefix,
          filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.9 }
        });

        map.addLayer({
          id: markersId,
          type: "circle",
          source: prefix,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 6,
            "circle-color": ["get", "markerColor"],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2
          }
        });

        map.addLayer({
          id: labelsId,
          type: "symbol",
          source: prefix,
          filter: ["==", ["geometry-type"], "Point"],
          layout: {
            "text-field": ["get", "label"],
            "text-size": 11,
            "text-offset": [0, 1.8],
            "text-anchor": "top",
            "text-allow-overlap": true
          },
          paint: {
            "text-color": ["get", "markerColor"],
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.5
          }
        });
      }

      function removeHillLayers(map, prefix) {
        try {
          if (map.getLayer(prefix + "-labels")) map.removeLayer(prefix + "-labels");
          if (map.getLayer(prefix + "-markers")) map.removeLayer(prefix + "-markers");
          if (map.getLayer(prefix + "-line")) map.removeLayer(prefix + "-line");
          if (map.getLayer(prefix + "-line-casing")) map.removeLayer(prefix + "-line-casing");
          if (map.getSource(prefix)) map.removeSource(prefix);
        } catch (e) {}
      }

      document.addEventListener("rwgps-climbs-add", function (e) {
        var map = getMap();
        if (!map) return;
        try {
          climbFeatures = JSON.parse(e.detail);
          addHillLayers(map, climbFeatures, "rwgps-climbs");
          startLayerWatchdog();
          console.log("[Climbs] Layers added");
        } catch (err) {
          console.error("[Climbs] Map error:", err);
        }
      });

      document.addEventListener("rwgps-climbs-remove", function () {
        climbFeatures = null;
        var map = getMap();
        if (map) removeHillLayers(map, "rwgps-climbs");
      });

      document.addEventListener("rwgps-descents-add", function (e) {
        var map = getMap();
        if (!map) return;
        try {
          descentFeatures = JSON.parse(e.detail);
          addHillLayers(map, descentFeatures, "rwgps-descents");
          startLayerWatchdog();
          console.log("[Descents] Layers added");
        } catch (err) {
          console.error("[Descents] Map error:", err);
        }
      });

      document.addEventListener("rwgps-descents-remove", function () {
        descentFeatures = null;
        var map = getMap();
        if (map) removeHillLayers(map, "rwgps-descents");
      });

      document.addEventListener("rwgps-hill-labels-toggle", function (e) {
        var map = getMap();
        if (!map) return;
        try {
          var detail = JSON.parse(e.detail);
          var vis = detail.visible ? "visible" : "none";
          var markersId = detail.prefix + "-markers";
          var labelsId = detail.prefix + "-labels";
          if (map.getLayer(markersId)) map.setLayoutProperty(markersId, "visibility", vis);
          if (map.getLayer(labelsId)) map.setLayoutProperty(labelsId, "visibility", vis);
        } catch (err) {}
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
  var climbsActive = false;
  var descentsActive = false;
  var climbLabelsVisible = true;
  var descentLabelsVisible = true;
  var cachedTrackPoints = null;
  var cachedSegments = null;
  var cachedClimbs = null;
  var cachedDescents = null;
  var lastTRoutePage = null;

  // ─── Enhancements Dropdown ───────────────────────────────────────────

  var enhancementsMenuOpen = false;

  function createEnhancementsDropdown() {
    var container = document.createElement("div");
    container.className = "rwgps-enhancements-menu";

    // Button
    var btn = document.createElement("button");
    btn.className = "rwgps-enhancements-btn";
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' +
      ' Enhancements ' +
      '<svg class="rwgps-enhancements-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      enhancementsMenuOpen = !enhancementsMenuOpen;
      updateEnhancementsMenu(container);
    });
    container.appendChild(btn);

    // Popover
    var popover = document.createElement("div");
    popover.className = "rwgps-enhancements-popover";
    popover.style.display = "none";
    container.appendChild(popover);

    // Close on outside click
    document.addEventListener("click", function (e) {
      if (enhancementsMenuOpen && !container.contains(e.target)) {
        enhancementsMenuOpen = false;
        updateEnhancementsMenu(container);
      }
    });

    return container;
  }

  function updateEnhancementsMenu(container) {
    var btn = container.querySelector(".rwgps-enhancements-btn");
    var popover = container.querySelector(".rwgps-enhancements-popover");
    var chevron = btn.querySelector(".rwgps-enhancements-chevron");

    btn.classList.toggle("rwgps-enhancements-btn-active", enhancementsMenuOpen);
    popover.style.display = enhancementsMenuOpen ? "" : "none";
    chevron.style.transform = enhancementsMenuOpen ? "rotate(180deg)" : "";

    if (!enhancementsMenuOpen) return;

    // Rebuild menu items (alphabetical order)
    popover.innerHTML = "";
    var items = [
      { label: "Climbs", active: climbsActive, toggle: function () { toggleClimbs(); },
        sub: { label: "Labels", active: climbLabelsVisible, toggle: function () { toggleClimbLabels(); }, parentActive: climbsActive } },
      { label: "Descents", active: descentsActive, toggle: function () { toggleDescents(); },
        sub: { label: "Labels", active: descentLabelsVisible, toggle: function () { toggleDescentLabels(); }, parentActive: descentsActive } },
      { label: "Speed Colors", active: speedColorsActive, toggle: function () { toggleSpeedColors(); } },
      { label: "Travel Direction", active: travelDirectionActive, toggle: function () { toggleTravelDirection(); } }
    ];
    items.sort(function (a, b) { return a.label.localeCompare(b.label); });

    for (var i = 0; i < items.length; i++) {
      (function (item) {
        var row = document.createElement("div");
        row.className = "rwgps-enhancements-item";

        var label = document.createElement("span");
        label.textContent = item.label;

        var sw = document.createElement("div");
        sw.className = "rwgps-enhancements-switch" + (item.active ? " rwgps-enhancements-switch-checked" : "");
        sw.addEventListener("click", function (e) {
          e.stopPropagation();
          item.toggle();
          setTimeout(function () {
            updateEnhancementsMenu(container);
          }, 50);
        });

        row.appendChild(label);
        row.appendChild(sw);
        popover.appendChild(row);

        // Sub-toggle (indented, only shown when parent is active)
        if (item.sub && item.sub.parentActive) {
          (function (sub) {
            var subRow = document.createElement("div");
            subRow.className = "rwgps-enhancements-item rwgps-enhancements-sub-item";

            var subLabel = document.createElement("span");
            subLabel.textContent = sub.label;

            var subSw = document.createElement("div");
            subSw.className = "rwgps-enhancements-switch" + (sub.active ? " rwgps-enhancements-switch-checked" : "");
            subSw.addEventListener("click", function (e) {
              e.stopPropagation();
              sub.toggle();
              setTimeout(function () {
                updateEnhancementsMenu(container);
              }, 50);
            });

            subRow.appendChild(subLabel);
            subRow.appendChild(subSw);
            popover.appendChild(subRow);
          })(item.sub);
        }
      })(items[i]);
    }
  }

  function insertEnhancementsDropdown() {
    var existing = document.querySelector(".rwgps-enhancements-menu");
    if (existing) return;

    var dropdown = createEnhancementsDropdown();

    var rightControls = document.querySelector('[class*="rightControls"]');
    if (rightControls) {
      rightControls.appendChild(dropdown);
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
        dropdown.classList.add("rwgps-enhancements-menu-floating");
        parent.appendChild(dropdown);
      }
    }
  }

  async function toggleSpeedColors() {
    speedColorsActive = !speedColorsActive;
    console.log("[Speed Colors] Toggle:", speedColorsActive);

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

  // ─── Travel Direction (marching ants) ───────────────────────────────────

  var travelDirectionActive = false;

  function assignSpeedTiers(segments, maxSpeed) {
    return segments.map(function (seg) {
      // Use the average speed of the segment's points to determine tier
      var totalSpeed = 0;
      for (var i = 0; i < seg.points.length; i++) {
        totalSpeed += seg.points[i].speed || 0;
      }
      var avgSpeed = seg.points.length > 0 ? totalSpeed / seg.points.length : 0;
      var bucket = speedToBucket(avgSpeed, maxSpeed);
      var tier = Math.min(4, Math.floor(bucket / 4));
      return {
        points: seg.points,
        speedTier: tier
      };
    });
  }

  async function toggleTravelDirection() {
    travelDirectionActive = !travelDirectionActive;

    if (travelDirectionActive) {
      await enableTravelDirection();
    } else {
      disableTravelDirection();
    }
  }

  async function enableTravelDirection() {
    var pageInfo = getPageInfo();
    if (!pageInfo) return;

    // Fetch track data if not cached (shared with speed colors)
    if (!cachedTrackPoints) {
      cachedTrackPoints = await fetchTrackPoints(pageInfo.type, pageInfo.id);
      if (!cachedTrackPoints || cachedTrackPoints.length === 0) return;
    }

    // Compute segments if not cached (shared with speed colors)
    if (!cachedSegments) {
      cachedSegments = splitBySpeedColor(cachedTrackPoints);
    }

    var stats = computeSpeedStats(cachedTrackPoints);
    var tieredSegments = assignSpeedTiers(cachedSegments, stats.maxSpeed);

    var features = tieredSegments.map(function (seg) {
      return {
        type: "Feature",
        properties: { speedTier: seg.speedTier },
        geometry: {
          type: "LineString",
          coordinates: seg.points.map(function (p) { return [p.lng, p.lat]; })
        }
      };
    });

    console.log("[Travel Direction] Sending", features.length, "features to map");
    document.dispatchEvent(new CustomEvent("rwgps-travel-direction-add", {
      detail: JSON.stringify(features)
    }));
  }

  function disableTravelDirection() {
    document.dispatchEvent(new CustomEvent("rwgps-travel-direction-remove"));
  }

  // ─── Climbs ─────────────────────────────────────────────────────────────

  // Gradient colors for climbs: dark blue (bottom) → light blue (top)
  var CLIMB_COLOR_LOW  = { r: 21, g: 101, b: 192 };  // #1565c0
  var CLIMB_COLOR_HIGH = { r: 144, g: 202, b: 249 }; // #90caf9

  // Gradient colors for descents: light green (top) → dark green (bottom)
  var DESCENT_COLOR_HIGH = { r: 165, g: 214, b: 167 }; // #a5d6a7
  var DESCENT_COLOR_LOW  = { r: 27, g: 94, b: 32 };    // #1b5e20

  function hillGradientColor(t, lowColor, highColor) {
    return colorToHex(
      lerp(lowColor.r, highColor.r, t),
      lerp(lowColor.g, highColor.g, t),
      lerp(lowColor.b, highColor.b, t)
    );
  }

  function buildHillFeatures(hills, trackPoints, lowColor, highColor) {
    var features = [];
    for (var i = 0; i < hills.length; i++) {
      var hill = hills[i];
      var startEle = trackPoints[hill.first_i].ele;
      var endEle = trackPoints[hill.last_i].ele;
      var eleRange = endEle - startEle;

      // Split into per-point-pair segments with gradient color
      for (var j = hill.first_i; j < hill.last_i; j++) {
        var midEle = (trackPoints[j].ele + trackPoints[j + 1].ele) / 2;
        var t = eleRange !== 0 ? Math.max(0, Math.min(1, (midEle - startEle) / eleRange)) : 0.5;
        // For descents, eleRange is negative — flip t so low color is at the bottom
        if (eleRange < 0) t = 1 - t;
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [trackPoints[j].lng, trackPoints[j].lat],
              [trackPoints[j + 1].lng, trackPoints[j + 1].lat]
            ]
          },
          properties: { color: hillGradientColor(t, lowColor, highColor) }
        });
      }
      // Start marker
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [trackPoints[hill.first_i].lng, trackPoints[hill.first_i].lat] },
        properties: { label: "Start Segment", markerColor: hillGradientColor(0, lowColor, highColor) }
      });
      // End marker
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [trackPoints[hill.last_i].lng, trackPoints[hill.last_i].lat] },
        properties: { label: "End Segment", markerColor: hillGradientColor(1, lowColor, highColor) }
      });
    }
    return features;
  }

  async function toggleClimbs() {
    climbsActive = !climbsActive;
    if (climbsActive) {
      await enableClimbs();
    } else {
      disableClimbs();
    }
  }

  async function enableClimbs() {
    var pageInfo = getPageInfo();
    if (!pageInfo) return;

    if (!cachedTrackPoints) {
      cachedTrackPoints = await fetchTrackPoints(pageInfo.type, pageInfo.id);
      if (!cachedTrackPoints || cachedTrackPoints.length === 0) return;
    }

    if (!cachedClimbs) {
      cachedClimbs = findAscents(cachedTrackPoints);
      console.log("[Climbs] Found", cachedClimbs.length, "climbs");
    }

    if (cachedClimbs.length === 0) return;

    var features = buildHillFeatures(cachedClimbs, cachedTrackPoints, CLIMB_COLOR_LOW, CLIMB_COLOR_HIGH);
    document.dispatchEvent(new CustomEvent("rwgps-climbs-add", {
      detail: JSON.stringify(features)
    }));
  }

  function disableClimbs() {
    document.dispatchEvent(new CustomEvent("rwgps-climbs-remove"));
  }

  function toggleClimbLabels() {
    climbLabelsVisible = !climbLabelsVisible;
    document.dispatchEvent(new CustomEvent("rwgps-hill-labels-toggle", {
      detail: JSON.stringify({ prefix: "rwgps-climbs", visible: climbLabelsVisible })
    }));
  }

  function toggleDescentLabels() {
    descentLabelsVisible = !descentLabelsVisible;
    document.dispatchEvent(new CustomEvent("rwgps-hill-labels-toggle", {
      detail: JSON.stringify({ prefix: "rwgps-descents", visible: descentLabelsVisible })
    }));
  }

  async function toggleDescents() {
    descentsActive = !descentsActive;
    if (descentsActive) {
      await enableDescents();
    } else {
      disableDescents();
    }
  }

  async function enableDescents() {
    var pageInfo = getPageInfo();
    if (!pageInfo) return;

    if (!cachedTrackPoints) {
      cachedTrackPoints = await fetchTrackPoints(pageInfo.type, pageInfo.id);
      if (!cachedTrackPoints || cachedTrackPoints.length === 0) return;
    }

    if (!cachedDescents) {
      cachedDescents = findDescents(cachedTrackPoints);
      console.log("[Descents] Found", cachedDescents.length, "descents");
    }

    if (cachedDescents.length === 0) return;

    var features = buildHillFeatures(cachedDescents, cachedTrackPoints, DESCENT_COLOR_HIGH, DESCENT_COLOR_LOW);
    document.dispatchEvent(new CustomEvent("rwgps-descents-add", {
      detail: JSON.stringify(features)
    }));
  }

  function disableDescents() {
    document.dispatchEvent(new CustomEvent("rwgps-descents-remove"));
  }

  // ─── Page Detection ────────────────────────────────────────────────────

  function getPageInfo() {
    var tripMatch = location.pathname.match(/^\/trips\/(\d+)/);
    if (tripMatch) return { type: "trip", id: tripMatch[1] };
    var routeEditMatch = location.pathname.match(/^\/routes\/(\d+)\/edit/);
    if (routeEditMatch) return { type: "route", id: routeEditMatch[1] };
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

  function cleanupAllFeatures() {
    disableSpeedColors();
    disableTravelDirection();
    disableClimbs();
    disableDescents();
    speedColorsActive = false;
    travelDirectionActive = false;
    climbsActive = false;
    descentsActive = false;
    climbLabelsVisible = true;
    descentLabelsVisible = true;
    enhancementsMenuOpen = false;
    var menu = document.querySelector(".rwgps-enhancements-menu");
    if (menu) menu.remove();
    cachedTrackPoints = null;
    cachedSegments = null;
    cachedClimbs = null;
    cachedDescents = null;
    lastTRoutePage = null;
  }

  async function checkTRoutePage() {
    var settings = await browser.storage.local.get({
      speedColorsEnabled: true,
      travelDirectionEnabled: true,
      climbsEnabled: true,
      descentsEnabled: true
    });

    var anyEnabled = settings.speedColorsEnabled || settings.travelDirectionEnabled || settings.climbsEnabled || settings.descentsEnabled;

    // Handle features disabled via popup
    if (!settings.speedColorsEnabled && speedColorsActive) {
      disableSpeedColors();
      speedColorsActive = false;
    }
    if (!settings.travelDirectionEnabled && travelDirectionActive) {
      disableTravelDirection();
      travelDirectionActive = false;
    }
    if (!settings.climbsEnabled && climbsActive) {
      disableClimbs();
      climbsActive = false;
    }
    if (!settings.descentsEnabled && descentsActive) {
      disableDescents();
      descentsActive = false;
    }

    if (!anyEnabled) {
      if (lastTRoutePage) cleanupAllFeatures();
      return;
    }

    var pageInfo = getPageInfo();
    var pageKey = pageInfo ? pageInfo.type + ":" + pageInfo.id : null;

    if (!pageInfo) {
      if (lastTRoutePage) cleanupAllFeatures();
      return;
    }

    var hasMenu = !!document.querySelector(".rwgps-enhancements-menu");

    if (pageKey === lastTRoutePage && hasMenu) {
      return; // already set up
    }

    // New trip/route page — clean up old features before setting up new ones
    if (pageKey !== lastTRoutePage) {
      if (speedColorsActive) disableSpeedColors();
      if (travelDirectionActive) disableTravelDirection();
      if (climbsActive) disableClimbs();
      if (descentsActive) disableDescents();
      cachedTrackPoints = null;
      cachedSegments = null;
      cachedClimbs = null;
      cachedDescents = null;
      speedColorsActive = false;
      travelDirectionActive = false;
      climbsActive = false;
      descentsActive = false;
      climbLabelsVisible = true;
      descentLabelsVisible = true;
      enhancementsMenuOpen = false;
    }
    lastTRoutePage = pageKey;

    // Wait for any map container to render
    var mapEl = await waitForElement('.maplibregl-map, .gm-style, [class*="MapV2"], [class*="mapContainer"]', 10000);
    console.log("[Speed Colors] Map element found:", mapEl ? mapEl.className : "none");

    // Re-check we're still on the same page
    var recheck = getPageInfo();
    if (!recheck || (recheck.type + ":" + recheck.id) !== pageKey) return;

    insertEnhancementsDropdown();
  }

  // Poll for page changes (SPA navigation)
  setInterval(checkTRoutePage, 1000);
  checkTRoutePage();

})();
