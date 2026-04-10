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

  var cachedUserSummary = null;

  function getUserSummary() {
    document.dispatchEvent(new CustomEvent("rwgps-get-user-summary"));
    var raw = document.documentElement.getAttribute("data-rwgps-user-summary");
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) return parsed;
    } catch (e) {}
    return null;
  }

  function estimatedSpeedFromGrade(grade, userSummary) {
    var clampedGrade = Math.max(-15, Math.min(15, Math.round(grade)));
    var key = clampedGrade.toString();
    if (userSummary && userSummary[key]) {
      return userSummary[key][0]; // speedKph
    }
    var baseSpeed = 25; // kph on flat
    return Math.max(3, baseSpeed - clampedGrade * 1.5);
  }

  // ─── Sun Position Algorithm ──────────────────────────────────────────────
  // Simplified solar position calculator (no dependencies)

  function julianDay(year, month, day, hours) {
    // Convert date + fractional hours (UTC) to Julian Day Number
    if (month <= 2) { year--; month += 12; }
    var A = Math.floor(year / 100);
    var B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + hours / 24 + B - 1524.5;
  }

  function solarPosition(date, lat, lng) {
    // Returns { altitude } in degrees for a given Date and lat/lng
    var jd = julianDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
      date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600);
    var n = jd - 2451545.0; // days since J2000.0
    var L = (280.460 + 0.9856474 * n) % 360; // mean longitude
    if (L < 0) L += 360;
    var g = (357.528 + 0.9856003 * n) % 360; // mean anomaly
    if (g < 0) g += 360;
    var gRad = g * Math.PI / 180;
    var eclLong = L + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2 * gRad); // ecliptic longitude
    var obliquity = 23.439 - 0.0000004 * n; // obliquity of ecliptic
    var oblRad = obliquity * Math.PI / 180;
    var eclRad = eclLong * Math.PI / 180;
    var sinDec = Math.sin(oblRad) * Math.sin(eclRad);
    var dec = Math.asin(sinDec); // solar declination (radians)
    var cosDec = Math.cos(dec);
    // Right ascension (for equation of time)
    var ra = Math.atan2(Math.cos(oblRad) * Math.sin(eclRad), Math.cos(eclRad));
    // Greenwich mean sidereal time
    var gmst = (280.46061837 + 360.98564736629 * n) % 360;
    if (gmst < 0) gmst += 360;
    // Local hour angle
    var lha = (gmst + lng - ra * 180 / Math.PI) % 360;
    if (lha < 0) lha += 360;
    var lhaRad = lha * Math.PI / 180;
    var latRad = lat * Math.PI / 180;
    var sinAlt = Math.sin(latRad) * sinDec + Math.cos(latRad) * cosDec * Math.cos(lhaRad);
    var altitude = Math.asin(sinAlt) * 180 / Math.PI;
    return { altitude: altitude };
  }

  // Compute estimated Date at each track point
  function computeTimeAtPoints(trackPoints, objectType, startDate, userSummary) {
    var times = [];
    if (objectType === "trip") {
      // Trips have timestamps — convert epoch seconds to Date
      for (var i = 0; i < trackPoints.length; i++) {
        times.push(new Date(trackPoints[i].time * 1000));
      }
    } else {
      // Routes — accumulate time from grade-based speed starting from startDate
      // Uses the user's speed-by-grade profile when available for accurate estimates
      var startMs = startDate.getTime();
      times.push(new Date(startMs));
      for (var j = 1; j < trackPoints.length; j++) {
        var segDist = trackPoints[j].distance - trackPoints[j - 1].distance;
        var grade = trackPoints[j].grade || 0;
        var speedKph = estimatedSpeedFromGrade(grade, userSummary);
        var speedMs = speedKph / 3.6; // m/s
        var dt = segDist / speedMs; // seconds
        startMs += dt * 1000;
        times.push(new Date(startMs));
      }
    }
    return times;
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

    // Store departed_at for trips (used by Daylight feature)
    if (objectType === "trip") {
      var da = obj.departedAt || obj.departed_at;
      cachedDepartedAt = da ? new Date(da) : null;
    } else {
      cachedDepartedAt = null;
    }

    // Extract segment matches from extras (routes)
    var extras = (data.extras || obj.extras || []);
    var segMatches = extras
      .filter(function (e) { return e.type === "segment_match"; })
      .map(function (e) { return e.segmentMatch || e.segment_match; })
      .filter(Boolean);
    if (objectType === "route" && segMatches.length > 0) {
      cachedSegmentMatches = segMatches;
      console.log("[Segments] Found", segMatches.length, "segment matches");
    } else if (objectType === "route") {
      cachedSegmentMatches = [];
    }

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
          if (!speedColorFeatures && !antFeatures && !climbFeatures && !descentFeatures && !segmentFeatures) {
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
            if (segmentFeatures && !map.getSource("rwgps-segments")) {
              console.log("[Segments] Watchdog: re-adding segment layers");
              addSegmentLayers(map, segmentFeatures);
            }
            // Raise all custom layers to top
            var allLayers = [
              "rwgps-segments-line-casing", "rwgps-segments-line",
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

      // ─── Segments layers ────────────────────────────────────────────────
      var segmentFeatures = null;
      var segmentDomMarkers = [];
      var segmentTooltipEl = null;
      var segmentLabelsEnabled = true;
      var segmentMoveHandler = null;
      var segmentMapClickHandler = null;
      var segmentMarkerClickTime = 0;
      var segmentDetailsLinkClass = "rwgps-segment-details-link";

      function getOrCreateSegmentTooltip() {
        if (segmentTooltipEl && segmentTooltipEl.isConnected) return segmentTooltipEl;
        segmentTooltipEl = document.createElement("div");
        segmentTooltipEl.className = "rwgps-segment-tooltip";
        segmentTooltipEl.style.cssText = "display:none;position:absolute;z-index:10;pointer-events:none;" +
          "padding:4px 8px;background:#fff;border-radius:4px;" +
          "box-shadow:0 1px 4px rgba(0,0,0,0.25);font-size:12px;font-weight:500;" +
          "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;white-space:nowrap;";
        var mapContainer = document.querySelector(".maplibregl-map");
        if (mapContainer) mapContainer.appendChild(segmentTooltipEl);
        return segmentTooltipEl;
      }

      function injectSegmentDetailsLink(segId) {
        console.log("[Segments] injectSegmentDetailsLink called for segId:", segId);
        // Remove any existing injected link
        var existing = document.querySelectorAll("." + segmentDetailsLinkClass);
        for (var i = 0; i < existing.length; i++) existing[i].remove();
        // Poll for the popup's zoom link to appear, then inject next to it
        var attempts = 0;
        var timer = setInterval(function () {
          attempts++;
          if (attempts > 20) { clearInterval(timer); return; } // give up after ~2s
          var zoomLink = document.querySelector('[class*="Popup"] [class*="zoomLink"]');
          if (!zoomLink) return;
          clearInterval(timer);
          // Don't add if already present
          if (zoomLink.parentElement.querySelector("." + segmentDetailsLinkClass)) return;
          var a = document.createElement("a");
          a.className = segmentDetailsLinkClass;
          a.href = "/segments/" + segId;
          a.textContent = "Segment Details";
          a.style.cssText = "color: #fa6400; text-decoration: none; font-size: 13px; padding: 0 10px 10px 0; float: right; cursor: pointer;";
          a.addEventListener("mouseenter", function () { a.style.textDecoration = "underline"; });
          a.addEventListener("mouseleave", function () { a.style.textDecoration = "none"; });
          zoomLink.parentElement.appendChild(a);
        }, 100);
      }

      function createTriangleMarker(color) {
        var el = document.createElement("div");
        el.className = "rwgps-seg-marker rwgps-seg-start";
        el.style.cssText = "position:absolute;z-index:5;cursor:pointer;pointer-events:auto;" +
          "width:0;height:0;border-top:8px solid transparent;border-bottom:8px solid transparent;" +
          "border-left:14px solid " + color + ";" +
          "filter:drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff);" +
          "transform:translate(-5px,-8px);";
        return el;
      }

      function createSquareMarker(color) {
        var el = document.createElement("div");
        el.className = "rwgps-seg-marker rwgps-seg-end";
        el.style.cssText = "position:absolute;z-index:5;cursor:pointer;pointer-events:auto;" +
          "width:12px;height:12px;background:" + color + ";" +
          "border:2px solid #fff;border-radius:1px;" +
          "box-shadow:0 0 2px rgba(0,0,0,0.4);" +
          "transform:translate(-8px,-8px);";
        return el;
      }

      function positionSegmentMarkers(map) {
        for (var i = 0; i < segmentDomMarkers.length; i++) {
          var m = segmentDomMarkers[i];
          var pt = map.project(m.lngLat);
          m.el.style.left = pt.x + "px";
          m.el.style.top = pt.y + "px";
        }
      }

      function addSegmentLayers(map, features) {
        var prefix = "rwgps-segments";
        removeSegmentLayers(map);

        // Filter to line features only for the GeoJSON source
        var lineFeatures = features.filter(function (f) { return f.geometry.type === "LineString"; });

        map.addSource(prefix, {
          type: "geojson",
          data: { type: "FeatureCollection", features: lineFeatures }
        });

        map.addLayer({
          id: prefix + "-line-casing",
          type: "line",
          source: prefix,
          paint: { "line-color": "#000000", "line-width": 6, "line-opacity": 0.3 }
        });

        map.addLayer({
          id: prefix + "-line",
          type: "line",
          source: prefix,
          paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.9 }
        });

        // DOM-based markers for triangle (start) and square (end)
        var mapContainer = document.querySelector(".maplibregl-map");
        if (!mapContainer) return;

        var pointFeatures = features.filter(function (f) { return f.geometry.type === "Point"; });
        for (var i = 0; i < pointFeatures.length; i++) {
          var feat = pointFeatures[i];
          var props = feat.properties;
          var lngLat = { lng: feat.geometry.coordinates[0], lat: feat.geometry.coordinates[1] };
          var el = props.markerType === "start"
            ? createTriangleMarker(props.markerColor)
            : createSquareMarker(props.markerColor);

          // Store data on the element for event handling
          el.dataset.segmentId = props.segmentId || "";
          el.dataset.label = props.label || "";
          el.dataset.markerColor = props.markerColor || "#333";
          el.dataset.markerType = props.markerType || "";

          // Click on start marker → trigger sidebar selection + inject details link
          if (props.markerType === "start") {
            (function (segId) {
              el.addEventListener("click", function (e) {
                e.stopPropagation();
                segmentMarkerClickTime = Date.now();
                var link = document.querySelector('a[href*="/segments/' + segId + '"]');
                // If not found, expand the "Show All" segments list and retry
                if (!link) {
                  var expandLink = document.querySelector('[class*="expandlink"] a');
                  if (expandLink) expandLink.click();
                  link = document.querySelector('a[href*="/segments/' + segId + '"]');
                }
                if (link) {
                  var li = link.closest("li") || link.parentElement;
                  if (li) { li.click(); } else { link.click(); }
                }
                injectSegmentDetailsLink(segId);
              });
            })(props.segmentId);
          }

          // Hover tooltip
          el.addEventListener("mouseenter", function () {
            if (!segmentLabelsEnabled) return;
            var label = this.dataset.label;
            var color = this.dataset.markerColor;
            var type = this.dataset.markerType;
            if (!label) return;
            var text = type === "end" ? label + " (end)" : label;
            var tooltip = getOrCreateSegmentTooltip();
            tooltip.textContent = text;
            tooltip.style.color = color;
            var rect = this.getBoundingClientRect();
            var containerRect = mapContainer.getBoundingClientRect();
            tooltip.style.left = (rect.left - containerRect.left + rect.width / 2) + "px";
            tooltip.style.top = (rect.top - containerRect.top - 24) + "px";
            tooltip.style.transform = "translateX(-50%)";
            tooltip.style.display = "block";
          });
          el.addEventListener("mouseleave", function () {
            var tooltip = getOrCreateSegmentTooltip();
            tooltip.style.display = "none";
          });

          mapContainer.appendChild(el);
          segmentDomMarkers.push({ el: el, lngLat: lngLat });
        }

        // Position markers and keep them synced on map move
        positionSegmentMarkers(map);
        if (!segmentMoveHandler) {
          segmentMoveHandler = function () { positionSegmentMarkers(map); };
          map.on("move", segmentMoveHandler);
        }

        // Click anywhere on map to dismiss segment popup
        if (!segmentMapClickHandler) {
          segmentMapClickHandler = function (e) {
            // Don't dismiss if a segment marker was just clicked (within 300ms)
            if (Date.now() - segmentMarkerClickTime < 300) return;
            // Find and click the popup close button if visible
            var closeBtn = document.querySelector('[class*="Popup"] [class*="close"]');
            if (closeBtn) closeBtn.click();
          };
          map.on("click", segmentMapClickHandler);
        }
      }

      function removeSegmentLayers(map) {
        var prefix = "rwgps-segments";
        // Remove DOM markers
        for (var i = 0; i < segmentDomMarkers.length; i++) {
          segmentDomMarkers[i].el.remove();
        }
        segmentDomMarkers = [];
        if (segmentTooltipEl) { segmentTooltipEl.remove(); segmentTooltipEl = null; }
        if (segmentMoveHandler && map) {
          map.off("move", segmentMoveHandler);
          segmentMoveHandler = null;
        }
        if (segmentMapClickHandler && map) {
          map.off("click", segmentMapClickHandler);
          segmentMapClickHandler = null;
        }
        // Remove map layers
        try {
          if (map && map.getLayer(prefix + "-line")) map.removeLayer(prefix + "-line");
          if (map && map.getLayer(prefix + "-line-casing")) map.removeLayer(prefix + "-line-casing");
          if (map && map.getSource(prefix)) map.removeSource(prefix);
        } catch (e) {}
      }

      document.addEventListener("rwgps-segments-add", function (e) {
        var map = getMap();
        if (!map) return;
        try {
          segmentFeatures = JSON.parse(e.detail);
          addSegmentLayers(map, segmentFeatures);
          startLayerWatchdog();
          console.log("[Segments] Layers added");
        } catch (err) {
          console.error("[Segments] Map error:", err);
        }
      });

      document.addEventListener("rwgps-segments-remove", function () {
        segmentFeatures = null;
        var map = getMap();
        if (map) removeSegmentLayers(map);
      });

      document.addEventListener("rwgps-segment-labels-toggle", function (e) {
        try {
          var detail = JSON.parse(e.detail);
          segmentLabelsEnabled = detail.visible;
          if (!segmentLabelsEnabled && segmentTooltipEl) {
            segmentTooltipEl.style.display = "none";
          }
        } catch (err) {}
      });

      // Extract graph layout from React fiber for accurate elevation overlay.
      // The GraphContext.Provider is a SIBLING of the canvas in the fiber tree
      // (not an ancestor), so we must walk DOWN from the container to find it.
      document.addEventListener("rwgps-speed-colors-get-layout", function () {
        try {
          // Strategy 1: Find canvas fiber, go to container parent, walk subtree
          // to find the GraphContext.Provider (has memoizedProps.value.xProjection)
          var canvases = document.querySelectorAll('[class*="SampleGraph"] canvas');
          for (var ci = 0; ci < canvases.length; ci++) {
            var el = canvases[ci];
            var fiberKey = Object.keys(el).find(function (k) {
              return k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$");
            });
            if (!fiberKey) continue;
            var canvasFiber = el[fiberKey];

            // Walk UP to find the ReactiveSampleGraph component (a few levels up)
            var container = canvasFiber.return;
            var maxUp = 10;
            while (container && maxUp-- > 0) {
              // Search the entire subtree of this ancestor for the Provider
              var result = searchSubtreeForLayout(container, 0);
              if (result) { publishLayout(result); return; }
              container = container.return;
            }
          }

          // Strategy 2: Find any Context with _currentValue that has xProjection
          // Provider fibers have type._context with a _currentValue property
          var sgContainers = document.querySelectorAll('[class*="SampleGraph"]');
          for (var si = 0; si < sgContainers.length; si++) {
            var sgEl = sgContainers[si];
            var sgKey = Object.keys(sgEl).find(function (k) {
              return k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$");
            });
            if (!sgKey) continue;
            var sgFiber = sgEl[sgKey];
            // Walk up from the SampleGraph container, check _context._currentValue
            var f = sgFiber;
            var maxUp2 = 20;
            while (f && maxUp2-- > 0) {
              if (f.type && f.type._context) {
                var ctx2 = f.type._context;
                var cv = ctx2._currentValue || ctx2._currentValue2;
                if (cv && cv.xProjection && cv.plotMargin) {
                  publishLayout(buildLayoutResult(cv));
                  return;
                }
              }
              f = f.return;
            }
          }

          publishLayout(null);
        } catch (err) {
          publishLayout(null);
        }
      });

      // BFS/DFS walk of fiber subtree to find Provider with xProjection
      function searchSubtreeForLayout(fiber, depth) {
        if (!fiber || depth > 30) return null;

        // Check if this fiber is a Context.Provider with xProjection
        var props = fiber.memoizedProps || {};
        if (props.value && typeof props.value === "object" &&
            props.value.xProjection && props.value.plotMargin) {
          return buildLayoutResult(props.value);
        }

        // Check _context._currentValue (React stores current context value here)
        if (fiber.type && fiber.type._context) {
          var ctx = fiber.type._context;
          var cv = ctx._currentValue || ctx._currentValue2;
          if (cv && cv.xProjection && cv.plotMargin) {
            return buildLayoutResult(cv);
          }
        }

        // Recurse into children
        var child = fiber.child;
        while (child) {
          var found = searchSubtreeForLayout(child, depth + 1);
          if (found) return found;
          child = child.sibling;
        }
        return null;
      }

      function buildLayoutResult(v) {
        return {
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
        };
      }

      function publishLayout(layout) {
        document.documentElement.setAttribute("data-speed-colors-layout", layout ? JSON.stringify(layout) : "");
      }

      // Extract the user's speed-by-grade profile for estimated time
      document.addEventListener("rwgps-get-user-summary", function () {
        try {
          var us = window.rwgps && window.rwgps.summary && window.rwgps.summary.user_summary;
          document.documentElement.setAttribute("data-rwgps-user-summary", us ? JSON.stringify(us) : "");
        } catch (e) {
          document.documentElement.setAttribute("data-rwgps-user-summary", "");
        }
      });
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

  // ─── Climb Elevation Graph Overlay ──────────────────────────────────────

  var climbElevationPollId = null;
  var climbElevationListeners = null;
  var lastCanvasFingerprint = "";

  function getGraphLayout() {
    // Request layout extraction from page bridge
    document.dispatchEvent(new CustomEvent("rwgps-speed-colors-get-layout"));
    var raw = document.documentElement.getAttribute("data-speed-colors-layout");
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

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

    // Remove existing climb overlay
    var existing = graphContainer.querySelector(".rwgps-climb-elevation-overlay");
    if (existing) existing.remove();

    var origCtx = origCanvas.getContext("2d", { willReadFrequently: true });
    if (!origCtx) return null;

    var cw = origCanvas.width;
    var ch = origCanvas.height;
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

    // Detect plot area bounds via pixel scan
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

    // Get the graph layout from React fiber for accurate distance mapping
    var layout = getGraphLayout();
    var maxDist = trackPoints[trackPoints.length - 1].distance;

    // Determine distance-to-pixel mapping
    // If we have xProjection from the fiber, use it (handles selections/zooms)
    // Otherwise fall back to simple linear mapping over full distance
    var useProjection = layout && layout.xProjection && layout.xProjection.vScale;
    var xProj = useProjection ? layout.xProjection : null;

    // DPR: canvas pixels may differ from CSS pixels
    var offsetWidth = origCanvas.offsetWidth || origCanvas.clientWidth || (cw / 2);
    var dpr = cw / offsetWidth;

    if (xProj) {
      console.log("[Climbs Elevation] Using xProjection: v0=" + xProj.v0.toFixed(0) +
        " vScale=" + xProj.vScale.toFixed(4) + " pixelOffset=" + xProj.pixelOffset.toFixed(1) +
        " dpr=" + dpr.toFixed(2) +
        " visibleRange=" + xProj.v0.toFixed(0) + "-" + (xProj.v0 + layout.plotWidth / xProj.vScale).toFixed(0) + "m");
    } else {
      console.log("[Climbs Elevation] No xProjection, using full distance: 0-" + maxDist.toFixed(0) + "m" +
        (layout ? " (layout found but no xProjection)" : " (no layout)"));
    }

    // Create overlay canvas
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

    // Pre-compute climb distance ranges
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
      // Map canvas pixel x → distance using xProjection if available
      var dist;
      if (xProj) {
        // xProjection maps CSS pixels: pixel = pixelOffset + (value - v0) * vScale
        // Invert: value = v0 + (pixel - pixelOffset) / vScale
        var cssPx = cx2 / dpr;
        dist = xProj.v0 + (cssPx - xProj.pixelOffset) / xProj.vScale;
      } else {
        dist = ((cx2 - plotLeftPx) / plotWidthPx) * maxDist;
      }

      // Find which climb this distance falls in (if any)
      var inClimb = null;
      for (var ci2 = 0; ci2 < climbRanges.length; ci2++) {
        if (dist >= climbRanges[ci2].startDist && dist <= climbRanges[ci2].endDist) {
          inClimb = climbRanges[ci2];
          break;
        }
      }
      if (!inClimb) continue;

      // Compute gradient t based on elevation progress through the climb
      var eleRange = inClimb.endEle - inClimb.startEle;
      var t = 0.5;
      if (eleRange !== 0) {
        while (ptIdx < trackPoints.length - 1 && trackPoints[ptIdx + 1].distance < dist) {
          ptIdx++;
        }
        var ele = trackPoints[ptIdx].ele;
        t = Math.max(0, Math.min(1, (ele - inClimb.startEle) / eleRange));
      }
      var color = hillGradientColor(t, CLIMB_COLOR_LOW, CLIMB_COLOR_HIGH);

      // Scan column for elevation fill
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

  // Fingerprint: sample a few pixels from the original canvas to detect redraws
  function canvasFingerprint(canvas) {
    try {
      var ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return "";
      var w = canvas.width, h = canvas.height;
      if (w === 0 || h === 0) return "";
      // Sample 5 points along the horizontal center
      var parts = [];
      var cy = Math.floor(h / 2);
      for (var i = 0; i < 5; i++) {
        var cx = Math.floor((w * (i + 1)) / 6);
        var d = ctx.getImageData(cx, cy, 1, 1).data;
        parts.push(d[0] + "," + d[1] + "," + d[2] + "," + d[3]);
      }
      return w + "x" + h + ":" + parts.join("|");
    } catch (e) { return ""; }
  }

  function scheduleClimbElevationRedraw() {
    if (!climbElevationActive || !cachedTrackPoints || !cachedClimbs) return;
    // Wait for React to finish redrawing the canvas after the view change
    setTimeout(function () {
      if (!climbElevationActive || !cachedTrackPoints || !cachedClimbs) return;
      renderClimbElevationOverlay(cachedTrackPoints, cachedClimbs);
      // Update fingerprint after our re-render
      var candidates = document.querySelectorAll('[class*="SampleGraph"]');
      for (var ci = 0; ci < candidates.length; ci++) {
        var c = candidates[ci].querySelector("canvas:not(.rwgps-climb-elevation-overlay)");
        if (c) { lastCanvasFingerprint = canvasFingerprint(c); break; }
      }
    }, 400);
  }

  function startClimbElevationSync() {
    stopClimbElevationSync();

    // Find the graph container for mouse event listeners
    var graphContainer = null;
    var candidates = document.querySelectorAll('[class*="SampleGraph"]');
    for (var ci = 0; ci < candidates.length; ci++) {
      if (candidates[ci].querySelector("canvas")) {
        graphContainer = candidates[ci];
        break;
      }
    }

    // Mouse event listener: re-render after any mouse interaction on the graph
    // (selections, clicks on "clear", etc.)
    var onMouseUp = function () { scheduleClimbElevationRedraw(); };
    if (graphContainer) {
      graphContainer.addEventListener("mouseup", onMouseUp);
      graphContainer.addEventListener("pointerup", onMouseUp);
    }
    // Also catch clicks on clear/reset buttons outside the graph
    var bottomPanel = graphContainer ? graphContainer.closest('[class*="BottomPanel"]') || graphContainer.parentElement : null;
    if (bottomPanel) {
      bottomPanel.addEventListener("click", onMouseUp);
    }

    climbElevationListeners = {
      graphContainer: graphContainer,
      bottomPanel: bottomPanel,
      onMouseUp: onMouseUp
    };

    // Also poll canvas fingerprint as backup (catches programmatic changes, resize, etc.)
    var origCanvas = graphContainer ? graphContainer.querySelector("canvas:not(.rwgps-climb-elevation-overlay)") : null;
    if (origCanvas) {
      lastCanvasFingerprint = canvasFingerprint(origCanvas);
    }
    climbElevationPollId = setInterval(function () {
      if (!climbElevationActive) { stopClimbElevationSync(); return; }
      if (!origCanvas || !origCanvas.isConnected) return;
      var fp = canvasFingerprint(origCanvas);
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

  // ─── Climbs Pill in Elevation Graph Controls ──────────────────────────

  function insertClimbsPill() {
    if (document.querySelector(".rwgps-climbs-pill")) return;

    // Find the sgControls bar containing the metric pills
    var sgControls = document.querySelector('[class*="sgControls"]');
    if (!sgControls) return;

    // Find the PillGroup inside it
    var pillGroup = sgControls.querySelector('[class*="PillGroup"]');
    if (!pillGroup) return;

    // Create our Climbs pill matching the native style
    var pill = document.createElement("div");
    pill.className = "rwgps-climbs-pill";
    pill.textContent = "Climbs";
    pill.addEventListener("click", function () {
      toggleClimbElevation();
      pill.classList.toggle("rwgps-climbs-pill-selected", climbElevationActive);
    });

    pillGroup.appendChild(pill);
  }

  function removeClimbsPill() {
    var pill = document.querySelector(".rwgps-climbs-pill");
    if (pill) pill.remove();
  }

  // ─── Daylight Overlay on Elevation Graph ──────────────────────────────

  var DAYLIGHT_COLOR = "rgba(255, 193, 7, 0.25)";   // warm yellow
  var TWILIGHT_COLOR = "rgba(255, 152, 0, 0.2)";    // orange
  var NIGHT_COLOR    = "rgba(13, 71, 161, 0.2)";    // dark blue

  function renderDaylightOverlay(trackPoints, timeAtPoints) {
    var origCanvas = null;
    var graphContainer = null;
    var candidates = document.querySelectorAll('[class*="SampleGraph"]');
    for (var ci = 0; ci < candidates.length; ci++) {
      var c = candidates[ci].querySelector("canvas:not(.rwgps-daylight-overlay):not(.rwgps-climb-elevation-overlay)");
      if (c) { origCanvas = c; graphContainer = candidates[ci]; break; }
    }
    if (!origCanvas || !graphContainer) return null;

    // Remove existing daylight overlay
    var existing = graphContainer.querySelector(".rwgps-daylight-overlay");
    if (existing) existing.remove();

    var cw = origCanvas.width;
    var ch = origCanvas.height;

    var layout = getGraphLayout();
    var maxDist = trackPoints[trackPoints.length - 1].distance;

    var offsetWidth = origCanvas.offsetWidth || origCanvas.clientWidth || (cw / 2);
    var dpr = cw / offsetWidth;

    // Determine plot bounds from React fiber layout (avoids getImageData SecurityError)
    var plotLeftPx, plotRightPx, plotTopPx, plotBottomPx;
    if (layout && layout.plotMargin) {
      plotLeftPx = Math.round(layout.plotMargin.left * dpr);
      plotTopPx = Math.round(layout.plotMargin.top * dpr);
      plotRightPx = Math.round((layout.plotMargin.left + (layout.plotWidth || (offsetWidth - layout.plotMargin.left - layout.plotMargin.right))) * dpr);
      plotBottomPx = Math.round((layout.plotMargin.top + (layout.plotHeight || (origCanvas.offsetHeight - layout.plotMargin.top - layout.plotMargin.bottom))) * dpr);
    } else {
      // Fallback: try pixel scanning, wrapped in try/catch for SecurityError
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
        // SecurityError from getImageData in content script context —
        // use conservative defaults based on canvas dimensions
        console.warn("[Daylight] Cannot read canvas pixels (SecurityError), using estimated bounds");
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

    // Create overlay canvas
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

    // Clip to plot area so nothing bleeds into axis labels
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeftPx, plotTopPx, plotWidthPx, plotHeightPx);
    ctx.clip();

    // Altitude range for mapping: -30° to +90°
    var ALT_MIN = -30;
    var ALT_MAX = 90;
    var ALT_RANGE = ALT_MAX - ALT_MIN; // 120

    function altToY(alt) {
      var clamped = Math.max(ALT_MIN, Math.min(ALT_MAX, alt));
      // Higher altitude = higher on screen (lower y)
      var t = (clamped - ALT_MIN) / ALT_RANGE; // 0 = bottom, 1 = top
      return plotBottomPx - t * plotHeightPx;
    }

    var horizonY = altToY(0);

    // Pre-compute sun altitudes for each canvas column
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

      // Find nearest track point
      while (ptIdx < trackPoints.length - 1 && trackPoints[ptIdx + 1].distance < dist) {
        ptIdx++;
      }
      // Interpolate between ptIdx and ptIdx+1
      var pi = Math.min(ptIdx, trackPoints.length - 1);
      var tp = trackPoints[pi];
      var time = timeAtPoints[pi];

      if (!time || isNaN(time.getTime())) {
        altitudes.push({ alt: 0, cx: cx });
        continue;
      }

      var sun = solarPosition(time, tp.lat, tp.lng);
      altitudes.push({ alt: sun.altitude, cx: cx });
    }

    // Draw shaded bands (column by column)
    for (var ai = 0; ai < altitudes.length; ai++) {
      var alt = altitudes[ai].alt;
      var x = altitudes[ai].cx;
      var curveY = altToY(alt);

      if (alt > 0) {
        // Daylight: shade from horizon to curve (above horizon)
        ctx.fillStyle = DAYLIGHT_COLOR;
        ctx.fillRect(x, curveY, 1, horizonY - curveY);
      } else if (alt > -6) {
        // Civil twilight
        ctx.fillStyle = TWILIGHT_COLOR;
        ctx.fillRect(x, horizonY, 1, curveY - horizonY);
      } else {
        // Night
        ctx.fillStyle = NIGHT_COLOR;
        ctx.fillRect(x, horizonY, 1, curveY - horizonY);
      }
    }

    // Draw horizon line (dashed)
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(100, 100, 100, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotLeftPx, horizonY);
    ctx.lineTo(plotRightPx, horizonY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw sun altitude curve
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    // Draw in segments colored by sun state
    for (var si = 0; si < altitudes.length - 1; si++) {
      var a1 = altitudes[si];
      var a2 = altitudes[si + 1];
      var avgAlt = (a1.alt + a2.alt) / 2;
      if (avgAlt > 10) {
        ctx.strokeStyle = "#ffc107"; // amber
      } else if (avgAlt > 0) {
        ctx.strokeStyle = "#ff9800"; // orange
      } else {
        ctx.strokeStyle = "#1565c0"; // blue
      }
      ctx.beginPath();
      ctx.moveTo(a1.cx, altToY(a1.alt));
      ctx.lineTo(a2.cx, altToY(a2.alt));
      ctx.stroke();
    }

    ctx.restore(); // remove clip
    return overlay;
  }

  function scheduleDaylightRedraw() {
    if (!daylightActive || !cachedTrackPoints || !cachedDaylightTimes) return;
    setTimeout(function () {
      if (!daylightActive || !cachedTrackPoints || !cachedDaylightTimes) return;
      renderDaylightOverlay(cachedTrackPoints, cachedDaylightTimes);
      var candidates = document.querySelectorAll('[class*="SampleGraph"]');
      for (var ci = 0; ci < candidates.length; ci++) {
        var c = candidates[ci].querySelector("canvas:not(.rwgps-daylight-overlay):not(.rwgps-climb-elevation-overlay)");
        if (c) { lastDaylightFingerprint = canvasFingerprint(c); break; }
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

    var origCanvas = graphContainer ? graphContainer.querySelector("canvas:not(.rwgps-daylight-overlay):not(.rwgps-climb-elevation-overlay)") : null;
    if (origCanvas) {
      lastDaylightFingerprint = canvasFingerprint(origCanvas);
    }
    daylightPollId = setInterval(function () {
      if (!daylightActive) { stopDaylightSync(); return; }
      if (!origCanvas || !origCanvas.isConnected) return;
      var fp = canvasFingerprint(origCanvas);
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
    // Remove any existing modal
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

    // Date input
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

    // Time input
    var timeLabel = document.createElement("label");
    timeLabel.textContent = "Start Time";
    var timeInput = document.createElement("input");
    timeInput.type = "time";
    timeInput.value = "08:00";
    timeLabel.appendChild(timeInput);
    modal.appendChild(timeLabel);

    // Buttons
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

    // Close on backdrop click
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

  // ─── UI Toggle ─────────────────────────────────────────────────────────

  var speedColorsActive = false;
  var climbsActive = false;
  var descentsActive = false;
  var segmentsActive = false;
  var climbLabelsVisible = true;
  var climbElevationActive = false;
  var descentLabelsVisible = true;
  var segmentLabelsVisible = true;
  var daylightActive = false;
  var cachedTrackPoints = null;
  var cachedSegments = null;
  var cachedClimbs = null;
  var cachedDescents = null;
  var cachedSegmentMatches = null;
  var cachedDepartedAt = null;
  var cachedDaylightTimes = null;
  var daylightStartDate = null;
  var daylightPollId = null;
  var daylightListeners = null;
  var lastDaylightFingerprint = "";
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
        subs: [
          { label: "Labels", active: climbLabelsVisible, toggle: function () { toggleClimbLabels(); } },
          { label: "Elevation", active: climbElevationActive, toggle: function () { toggleClimbElevation(); } }
        ] },
      { label: "Descents", active: descentsActive, toggle: function () { toggleDescents(); },
        subs: [
          { label: "Labels", active: descentLabelsVisible, toggle: function () { toggleDescentLabels(); } }
        ] },
      { label: "Daylight", active: daylightActive, toggle: function () { toggleDaylight(); } },
      { label: "Speed Colors", active: speedColorsActive, toggle: function () { toggleSpeedColors(); } },
      { label: "Travel Direction", active: travelDirectionActive, toggle: function () { toggleTravelDirection(); } }
    ];
    var pageInfo = getPageInfo();
    if (pageInfo && pageInfo.type === "route") {
      items.push({ label: "Segments", active: segmentsActive, toggle: function () { toggleSegments(); },
        subs: [
          { label: "Labels", active: segmentLabelsVisible, toggle: function () { toggleSegmentLabels(); } }
        ] });
    }
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

        // Sub-toggles (indented, only shown when parent is active)
        if (item.subs && item.active) {
          for (var si = 0; si < item.subs.length; si++) {
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
            })(item.subs[si]);
          }
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

  // Distinct colors for segment overlays
  var SEGMENT_COLORS = [
    "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
    "#42d4f4", "#f032e6", "#bfef45", "#469990", "#9a6324",
    "#dcbeff", "#fabed4"
  ];

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

  function buildSegmentFeatures(segmentMatches, trackPoints) {
    var features = [];
    for (var i = 0; i < segmentMatches.length; i++) {
      var sm = segmentMatches[i];
      var color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
      var startIdx = sm.startIndex != null ? sm.startIndex : sm.start_index;
      var endIdx = sm.endIndex != null ? sm.endIndex : sm.end_index;
      var segId = sm.segmentId != null ? sm.segmentId : sm.segment_id;
      var title = sm.segmentTitle || sm.segment_title || ("Segment " + segId);

      if (startIdx == null || endIdx == null) continue;
      if (startIdx >= trackPoints.length || endIdx >= trackPoints.length) continue;

      // Line feature — full segment extent
      var coords = [];
      for (var j = startIdx; j <= endIdx; j++) {
        coords.push([trackPoints[j].lng, trackPoints[j].lat]);
      }
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { color: color }
      });

      // Start marker (triangle)
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [trackPoints[startIdx].lng, trackPoints[startIdx].lat] },
        properties: { markerType: "start", markerColor: color, label: title, segmentId: segId }
      });

      // End marker (square)
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [trackPoints[endIdx].lng, trackPoints[endIdx].lat] },
        properties: { markerType: "end", markerColor: color, label: title, segmentId: segId }
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

    // Insert Climbs pill in elevation graph controls
    insertClimbsPill();

    // If elevation overlay was already active, re-enable it
    if (climbElevationActive) {
      enableClimbElevation();
    }
  }

  function disableClimbs() {
    document.dispatchEvent(new CustomEvent("rwgps-climbs-remove"));
    removeClimbElevationOverlay();
    removeClimbsPill();
    climbElevationActive = false;
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

  function toggleClimbElevation() {
    climbElevationActive = !climbElevationActive;
    if (climbElevationActive) {
      enableClimbElevation();
    } else {
      removeClimbElevationOverlay();
    }
    // Update pill state if it exists
    var pill = document.querySelector(".rwgps-climbs-pill");
    if (pill) pill.classList.toggle("rwgps-climbs-pill-selected", climbElevationActive);
  }

  function enableClimbElevation() {
    if (!cachedTrackPoints || !cachedClimbs || cachedClimbs.length === 0) return;
    setTimeout(function () {
      var overlay = colorClimbsOnElevation(cachedTrackPoints, cachedClimbs);
      if (!overlay) {
        setTimeout(function () {
          colorClimbsOnElevation(cachedTrackPoints, cachedClimbs);
        }, 1000);
      }
    }, 300);
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

  // ─── Segments Toggle ─────────────────────────────────────────────────

  async function toggleSegments() {
    segmentsActive = !segmentsActive;
    if (segmentsActive) {
      await enableSegments();
    } else {
      disableSegments();
    }
  }

  async function enableSegments() {
    var pageInfo = getPageInfo();
    if (!pageInfo || pageInfo.type !== "route") return;

    if (!cachedTrackPoints) {
      cachedTrackPoints = await fetchTrackPoints(pageInfo.type, pageInfo.id);
      if (!cachedTrackPoints || cachedTrackPoints.length === 0) return;
    }

    if (!cachedSegmentMatches || cachedSegmentMatches.length === 0) {
      console.log("[Segments] No segment matches found for this route");
      return;
    }

    var features = buildSegmentFeatures(cachedSegmentMatches, cachedTrackPoints);
    document.dispatchEvent(new CustomEvent("rwgps-segments-add", {
      detail: JSON.stringify(features)
    }));
  }

  function disableSegments() {
    document.dispatchEvent(new CustomEvent("rwgps-segments-remove"));
  }

  function toggleSegmentLabels() {
    segmentLabelsVisible = !segmentLabelsVisible;
    document.dispatchEvent(new CustomEvent("rwgps-segment-labels-toggle", {
      detail: JSON.stringify({ visible: segmentLabelsVisible })
    }));
  }

  // ─── Daylight Toggle ──────────────────────────────────────────────────

  async function toggleDaylight() {
    daylightActive = !daylightActive;
    if (daylightActive) {
      await enableDaylight();
    } else {
      disableDaylight();
    }
  }

  async function enableDaylight() {
    var pageInfo = getPageInfo();
    if (!pageInfo) return;

    if (!cachedTrackPoints) {
      cachedTrackPoints = await fetchTrackPoints(pageInfo.type, pageInfo.id);
      if (!cachedTrackPoints || cachedTrackPoints.length === 0) return;
    }

    if (pageInfo.type === "trip") {
      // Trips have timestamps — compute immediately
      cachedDaylightTimes = computeTimeAtPoints(cachedTrackPoints, "trip", null);
      // Validate: check first timestamp is reasonable
      if (!cachedDaylightTimes[0] || isNaN(cachedDaylightTimes[0].getTime()) ||
          cachedDaylightTimes[0].getFullYear() < 2000) {
        console.warn("[Daylight] Trip timestamps appear invalid, using departedAt fallback");
        if (cachedDepartedAt) {
          cachedDaylightTimes = computeTimeAtPoints(cachedTrackPoints, "route", cachedDepartedAt, getUserSummary());
        }
      }
      renderDaylightOverlay(cachedTrackPoints, cachedDaylightTimes);
      startDaylightSync();
    } else {
      // Routes — fetch user's speed profile for accurate time estimates
      cachedUserSummary = getUserSummary();
      // Routes — show modal to pick start date/time
      showDaylightModal(function (startDate) {
        daylightStartDate = startDate;
        cachedDaylightTimes = computeTimeAtPoints(cachedTrackPoints, "route", startDate, cachedUserSummary);
        renderDaylightOverlay(cachedTrackPoints, cachedDaylightTimes);
        startDaylightSync();
      }, function () {
        // Cancelled
        daylightActive = false;
        var menu = document.querySelector(".rwgps-enhancements-menu");
        if (menu) updateEnhancementsMenu(menu);
      });
    }
  }

  function disableDaylight() {
    removeDaylightOverlay();
    closeDaylightModal();
    cachedDaylightTimes = null;
    daylightStartDate = null;
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
    disableDaylight();
    disableSegments();
    speedColorsActive = false;
    travelDirectionActive = false;
    climbsActive = false;
    descentsActive = false;
    segmentsActive = false;
    climbLabelsVisible = true;
    climbElevationActive = false;
    descentLabelsVisible = true;
    segmentLabelsVisible = true;
    daylightActive = false;
    enhancementsMenuOpen = false;
    removeClimbsPill();
    var menu = document.querySelector(".rwgps-enhancements-menu");
    if (menu) menu.remove();
    cachedTrackPoints = null;
    cachedSegments = null;
    cachedClimbs = null;
    cachedDescents = null;
    cachedSegmentMatches = null;
    cachedDepartedAt = null;
    cachedDaylightTimes = null;
    daylightStartDate = null;
    lastTRoutePage = null;
  }

  async function checkTRoutePage() {
    var settings = await browser.storage.local.get({
      speedColorsEnabled: true,
      travelDirectionEnabled: true,
      climbsEnabled: true,
      descentsEnabled: true,
      daylightEnabled: true,
      segmentsEnabled: true
    });

    var anyEnabled = settings.speedColorsEnabled || settings.travelDirectionEnabled || settings.climbsEnabled || settings.descentsEnabled || settings.daylightEnabled || settings.segmentsEnabled;

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
    if (!settings.daylightEnabled && daylightActive) {
      disableDaylight();
      daylightActive = false;
    }
    if (!settings.segmentsEnabled && segmentsActive) {
      disableSegments();
      segmentsActive = false;
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
      if (daylightActive) disableDaylight();
      if (segmentsActive) disableSegments();
      cachedTrackPoints = null;
      cachedSegments = null;
      cachedClimbs = null;
      cachedDescents = null;
      cachedSegmentMatches = null;
      cachedDepartedAt = null;
      cachedDaylightTimes = null;
      daylightStartDate = null;
      speedColorsActive = false;
      travelDirectionActive = false;
      climbsActive = false;
      descentsActive = false;
      segmentsActive = false;
      climbLabelsVisible = true;
      climbElevationActive = false;
      descentLabelsVisible = true;
      segmentLabelsVisible = true;
      daylightActive = false;
      enhancementsMenuOpen = false;
      removeClimbsPill();
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
