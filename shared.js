window.RE = {};
(function (R) {
  "use strict";

  // ─── Shared State ───────────────────────────────────────────────────────

  R.speedColorsActive = false;
  R.climbsActive = false;
  R.descentsActive = false;
  R.segmentsActive = false;
  R.climbLabelsVisible = true;
  R.climbElevationActive = false;
  R.descentElevationActive = false;
  R.descentLabelsVisible = true;
  R.segmentLabelsVisible = true;
  R.daylightActive = false;
  R.travelDirectionActive = false;
  R.enhancementsMenuOpen = false;

  R.cachedTrackPoints = null;
  R.cachedSegments = null;
  R.cachedClimbs = null;
  R.cachedDescents = null;
  R.cachedSegmentMatches = null;
  R.cachedDepartedAt = null;
  R.cachedDaylightTimes = null;
  R.cachedUserSummary = null;
  R.daylightStartDate = null;
  R.lastTRoutePage = null;

  // ─── Speed Color Computation ────────────────────────────────────────────

  var NUM_BUCKETS = 20;
  var SLOW_COLOR = { r: 74, g: 0, b: 0 };
  var AVG_COLOR  = { r: 255, g: 0, b: 0 };
  var FAST_COLOR = { r: 255, g: 255, b: 0 };

  function lerp(a, b, t) {
    return Math.round(a + (b - a) * t);
  }
  R.lerp = lerp;

  function colorToHex(r, g, b) {
    return "#" + [r, g, b].map(function (c) { return c.toString(16).padStart(2, "0"); }).join("");
  }
  R.colorToHex = colorToHex;

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
  R.speedToColor = speedToColor;

  function speedToBucket(speed, maxSpeed) {
    if (maxSpeed <= 0) return 0;
    var t = Math.max(0, Math.min(speed, maxSpeed)) / maxSpeed;
    return Math.min(Math.floor(t * NUM_BUCKETS), NUM_BUCKETS - 1);
  }
  R.speedToBucket = speedToBucket;

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
  R.computeSpeedStats = computeSpeedStats;

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
  R.splitBySpeedColor = splitBySpeedColor;

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

  R.findAscents = function (points) {
    return findHills(points, 1);
  };

  R.findDescents = function (points) {
    return findHills(points, -1);
  };

  // ─── Hill Rendering (shared by climbs and descents) ─────────────────────

  R.CLIMB_COLOR_LOW  = { r: 21, g: 101, b: 192 };
  R.CLIMB_COLOR_HIGH = { r: 144, g: 202, b: 249 };
  R.DESCENT_COLOR_HIGH = { r: 165, g: 214, b: 167 };
  R.DESCENT_COLOR_LOW  = { r: 27, g: 94, b: 32 };
  R.SEGMENT_COLORS = [
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
  R.hillGradientColor = hillGradientColor;

  R.buildHillFeatures = function (hills, trackPoints, lowColor, highColor) {
    var features = [];
    for (var i = 0; i < hills.length; i++) {
      var hill = hills[i];
      var startEle = trackPoints[hill.first_i].ele;
      var endEle = trackPoints[hill.last_i].ele;
      var eleRange = endEle - startEle;

      for (var j = hill.first_i; j < hill.last_i; j++) {
        var midEle = (trackPoints[j].ele + trackPoints[j + 1].ele) / 2;
        var t = eleRange !== 0 ? Math.max(0, Math.min(1, (midEle - startEle) / eleRange)) : 0.5;
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
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [trackPoints[hill.first_i].lng, trackPoints[hill.first_i].lat] },
        properties: { markerType: "start", markerColor: hillGradientColor(0, lowColor, highColor) }
      });
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [trackPoints[hill.last_i].lng, trackPoints[hill.last_i].lat] },
        properties: { markerType: "end", markerColor: hillGradientColor(1, lowColor, highColor) }
      });
    }
    return features;
  };

  // ─── Estimated Speed from Grade ─────────────────────────────────────────

  R.getUserSummary = function () {
    document.dispatchEvent(new CustomEvent("rwgps-get-user-summary"));
    var raw = document.documentElement.getAttribute("data-rwgps-user-summary");
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) return parsed;
    } catch (e) {}
    return null;
  };

  function estimatedSpeedFromGrade(grade, userSummary) {
    var clampedGrade = Math.max(-15, Math.min(15, Math.round(grade)));
    var key = clampedGrade.toString();
    if (userSummary && userSummary[key]) {
      return userSummary[key][0];
    }
    var baseSpeed = 25;
    return Math.max(3, baseSpeed - clampedGrade * 1.5);
  }
  R.estimatedSpeedFromGrade = estimatedSpeedFromGrade;

  // ─── Sun Position Algorithm ─────────────────────────────────────────────

  function julianDay(year, month, day, hours) {
    if (month <= 2) { year--; month += 12; }
    var A = Math.floor(year / 100);
    var B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + hours / 24 + B - 1524.5;
  }

  function solarPosition(date, lat, lng) {
    var jd = julianDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
      date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600);
    var n = jd - 2451545.0;
    var L = (280.460 + 0.9856474 * n) % 360;
    if (L < 0) L += 360;
    var g = (357.528 + 0.9856003 * n) % 360;
    if (g < 0) g += 360;
    var gRad = g * Math.PI / 180;
    var eclLong = L + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2 * gRad);
    var obliquity = 23.439 - 0.0000004 * n;
    var oblRad = obliquity * Math.PI / 180;
    var eclRad = eclLong * Math.PI / 180;
    var sinDec = Math.sin(oblRad) * Math.sin(eclRad);
    var dec = Math.asin(sinDec);
    var cosDec = Math.cos(dec);
    var ra = Math.atan2(Math.cos(oblRad) * Math.sin(eclRad), Math.cos(eclRad));
    var gmst = (280.46061837 + 360.98564736629 * n) % 360;
    if (gmst < 0) gmst += 360;
    var lha = (gmst + lng - ra * 180 / Math.PI) % 360;
    if (lha < 0) lha += 360;
    var lhaRad = lha * Math.PI / 180;
    var latRad = lat * Math.PI / 180;
    var sinAlt = Math.sin(latRad) * sinDec + Math.cos(latRad) * cosDec * Math.cos(lhaRad);
    var altitude = Math.asin(sinAlt) * 180 / Math.PI;
    return { altitude: altitude };
  }
  R.solarPosition = solarPosition;

  R.computeTimeAtPoints = function (trackPoints, objectType, startDate, userSummary) {
    var times = [];
    if (objectType === "trip") {
      for (var i = 0; i < trackPoints.length; i++) {
        times.push(new Date(trackPoints[i].time * 1000));
      }
    } else {
      var startMs = startDate.getTime();
      times.push(new Date(startMs));
      for (var j = 1; j < trackPoints.length; j++) {
        var segDist = trackPoints[j].distance - trackPoints[j - 1].distance;
        var grade = trackPoints[j].grade || 0;
        var speedKph = estimatedSpeedFromGrade(grade, userSummary);
        var speedMs = speedKph / 3.6;
        var dt = segDist / speedMs;
        startMs += dt * 1000;
        times.push(new Date(startMs));
      }
    }
    return times;
  };

  // ─── Track Data Fetching ────────────────────────────────────────────────

  function normalizeTrackPoint(raw) {
    return {
      lat: raw.y != null ? raw.y : raw.lat,
      lng: raw.x != null ? raw.x : raw.lng,
      ele: raw.e != null ? raw.e : (raw.ele != null ? raw.ele : 0),
      speed: raw.S != null ? raw.S : (raw.s != null ? raw.s : (raw.speed != null ? raw.speed : 0)),
      distance: 0,
      time: raw.t != null ? raw.t : (raw.time != null ? raw.time : 0),
      grade: raw.grade != null ? raw.grade : 0,
    };
  }

  function haversine(lat1, lng1, lat2, lng2) {
    var Radius = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return Radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  R.haversine = haversine;

  function computeDistanceAndSpeed(points) {
    if (points.length === 0) return points;
    points[0].distance = 0;
    points[0].speed = 0;

    for (var i = 1; i < points.length; i++) {
      var segDist = haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
      points[i].distance = points[i - 1].distance + segDist;

      if (points[i].speed <= 0) {
        var dt = points[i].time - points[i - 1].time;
        if (dt > 0) {
          points[i].speed = segDist / dt;
        } else {
          points[i].speed = points[i - 1].speed || 0;
        }
      }
    }

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

  function computeRouteSpeedFromGrade(points) {
    if (points.length === 0) return points;
    points[0].distance = 0;
    points[0].grade = 0;
    points[0].speed = estimatedSpeedFromGrade(0) / 3.6;

    for (var i = 1; i < points.length; i++) {
      var segDist = haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
      points[i].distance = points[i - 1].distance + segDist;

      if (segDist > 0) {
        var dEle = points[i].ele - points[i - 1].ele;
        points[i].grade = (dEle / segDist) * 100;
      } else {
        points[i].grade = points[i - 1].grade || 0;
      }
    }

    var rawGrades = points.map(function (p) { return p.grade; });
    var win = 5;
    for (var j = 0; j < points.length; j++) {
      var sum = 0, count = 0;
      for (var k = Math.max(0, j - win); k <= Math.min(points.length - 1, j + win); k++) {
        sum += rawGrades[k];
        count++;
      }
      points[j].grade = sum / count;
      points[j].speed = estimatedSpeedFromGrade(points[j].grade) / 3.6;
    }

    return points;
  }

  R.fetchTrackPoints = async function (objectType, objectId) {
    var url = "https://ridewithgps.com/" + objectType + "s/" + objectId + ".json";
    var resp = await fetch(url, {
      credentials: "same-origin",
      headers: {
        "x-rwgps-api-key": "32b6e135",
        "x-rwgps-api-version": "3",
        "Accept": "application/json",
      },
    });
    if (!resp.ok) {
      console.error("[Speed Colors] Fetch failed:", resp.status);
      return [];
    }
    var data = await resp.json();
    var obj = data[objectType] || data;
    var rawPoints = obj.trackPoints || obj.track_points || [];
    var normalized = rawPoints.map(normalizeTrackPoint).filter(function (p) { return p.lat && p.lng; });

    if (objectType === "trip") {
      var da = obj.departedAt || obj.departed_at;
      R.cachedDepartedAt = da ? new Date(da) : null;
    } else {
      R.cachedDepartedAt = null;
    }

    var extras = (data.extras || obj.extras || []);
    var segMatches = extras
      .filter(function (e) { return e.type === "segment_match"; })
      .map(function (e) { return e.segmentMatch || e.segment_match; })
      .filter(Boolean);
    if (objectType === "route" && segMatches.length > 0) {
      R.cachedSegmentMatches = segMatches;
    } else if (objectType === "route") {
      R.cachedSegmentMatches = [];
    }

    if (objectType === "route") {
      computeRouteSpeedFromGrade(normalized);
    } else {
      computeDistanceAndSpeed(normalized);
    }

    return normalized;
  };

  // ─── Page Detection ─────────────────────────────────────────────────────

  R.getPageInfo = function () {
    var tripMatch = location.pathname.match(/^\/trips\/(\d+)/);
    if (tripMatch) return { type: "trip", id: tripMatch[1] };
    var routeEditMatch = location.pathname.match(/^\/routes\/(\d+)\/edit/);
    if (routeEditMatch) return { type: "route", id: routeEditMatch[1] };
    var routeMatch = location.pathname.match(/^\/routes\/(\d+)/);
    if (routeMatch) return { type: "route", id: routeMatch[1] };
    return null;
  };

  R.waitForElement = function (selector, timeout) {
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
  };

  // ─── Graph Helpers ──────────────────────────────────────────────────────

  R.getGraphLayout = function () {
    document.dispatchEvent(new CustomEvent("rwgps-speed-colors-get-layout"));
    var raw = document.documentElement.getAttribute("data-speed-colors-layout");
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  };

  R.retryOverlayRender = function (activeFlag, renderFn, onSuccess) {
    var deadline = Date.now() + 10000;
    function attempt() {
      if (!R[activeFlag]) return;
      try {
        var result = renderFn();
        if (result) {
          if (onSuccess) onSuccess();
          return;
        }
      } catch (e) {}
      if (Date.now() < deadline) {
        setTimeout(attempt, 500);
      }
    }
    setTimeout(attempt, 300);
  };

  R.canvasFingerprint = function (canvas) {
    try {
      var ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return "";
      var w = canvas.width, h = canvas.height;
      if (w === 0 || h === 0) return "";
      var parts = [];
      var cy = Math.floor(h / 2);
      for (var i = 0; i < 5; i++) {
        var cx = Math.floor((w * (i + 1)) / 6);
        var d = ctx.getImageData(cx, cy, 1, 1).data;
        parts.push(d[0] + "," + d[1] + "," + d[2] + "," + d[3]);
      }
      return w + "x" + h + ":" + parts.join("|");
    } catch (e) { return ""; }
  };

})(window.RE);
