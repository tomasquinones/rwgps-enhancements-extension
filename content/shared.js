window.RE = {};
(function (R) {
  "use strict";

  // ─── Shared State ───────────────────────────────────────────────────────

  R.speedColorsActive = false;
  R.gradeColorsActive = false;
  R.climbsActive = false;
  R.descentsActive = false;
  R.segmentsActive = false;
  R.climbTrackVisible = true;
  R.descentTrackVisible = true;
  R.climbElevationActive = false;
  R.descentElevationActive = false;
  R.segmentLabelsVisible = false;
  R.daylightActive = false;
  R.weatherActive = false;
  R.weatherTempActive = true;
  R.weatherPrecipActive = true;
  R.weatherCloudActive = true;
  R.weatherWindActive = true;
  R.weatherStripActive = false;
  R.travelDirectionActive = false;
  R.enhancementsMenuOpen = false;
  R.heatmapColorsActive = false;
  R.hrZonesActive = false;
  R.hillshadeActive = false;

  R.cachedTrackPoints = null;
  R.cachedSegments = null;
  R.cachedClimbs = null;
  R.cachedDescents = null;
  R.cachedSegmentMatches = null;
  R.cachedDepartedAt = null;
  R.cachedDaylightTimes = null;
  R.cachedWeatherData = null;
  R.cachedWeatherTimes = null;
  R.cachedUserSummary = null;
  R.daylightStartDate = null;
  R.weatherStartDate = null;
  R.lastTRoutePage = null;

  // ─── Extension Context Guard ────────────────────────────────────────────
  // On Chromium, reloading/updating the extension invalidates the context for
  // content scripts that are still running. All browser.storage/runtime calls
  // will throw "Extension context invalidated". This flag lets polling loops
  // detect the dead context and stop silently instead of spamming the console.

  R.contextInvalidated = false;

  R.safeStorageGet = function (defaults) {
    if (R.contextInvalidated) return Promise.resolve(null);
    return browser.storage.local.get(defaults).catch(function (err) {
      if (err && err.message && err.message.indexOf("Extension context invalidated") !== -1) {
        R.contextInvalidated = true;
        console.warn("[RWGPS Ext] Extension context invalidated — stopping all polling.");
        return null;
      }
      throw err;
    });
  };

  // ─── Page Globals (published by content/page-user.js) ───────────────────

  R.RWGPS_API_KEY = "32b6e135";
  R.RWGPS_API_VERSION = 3;

  R.isMetric = function () {
    return document.documentElement.getAttribute("data-rwgps-metric") === "1";
  };

  R.getCurrentUserId = function () {
    return document.documentElement.getAttribute("data-rwgps-user-id") || null;
  };

  // Sends api-key + v3 headers — for endpoints that go through choose_api
  // (e.g. /goals.json index, /trips.json) and return ApiV3-shaped responses.
  R.rwgpsFetch = function (path) {
    return fetch("https://ridewithgps.com" + path, {
      credentials: "same-origin",
      headers: {
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "x-rwgps-api-key": R.RWGPS_API_KEY,
        "x-rwgps-api-version": String(R.RWGPS_API_VERSION)
      }
    }).then(function (r) {
      return r.ok ? r.json() : null;
    }).catch(function () {
      return null;
    });
  };

  // Cookie-only — for endpoints whose api.otherwise branch returns a
  // different (legacy) shape than the v3 serializer. Notably /goals/{id}.json
  // returns { goal, goal_participant } here vs flat goal fields under v3.
  R.rwgpsFetchPlain = function (path) {
    return fetch("https://ridewithgps.com" + path, {
      credentials: "same-origin",
      headers: {
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest"
      }
    }).then(function (r) {
      return r.ok ? r.json() : null;
    }).catch(function () {
      return null;
    });
  };

  // ─── Speed Color Computation ────────────────────────────────────────────

  var NUM_BUCKETS = 20;
  var COLOR_SETTINGS_DEFAULTS = {
    speedLowColor: "#4a0000",
    speedAvgColor: "#b71c1c",
    speedMaxColor: "#fdd835",
    climbsLowColor: "#0d47a1",
    climbsHighColor: "#64b5f6",
    descentsLowColor: "#1b5e20",
    descentsHighColor: "#66bb6a"
  };
  var COLOR_SETTINGS_STORAGE_DEFAULTS = {
    speedLowColor: COLOR_SETTINGS_DEFAULTS.speedLowColor,
    speedAvgColor: COLOR_SETTINGS_DEFAULTS.speedAvgColor,
    speedMaxColor: COLOR_SETTINGS_DEFAULTS.speedMaxColor,
    climbsLowColor: COLOR_SETTINGS_DEFAULTS.climbsLowColor,
    climbsHighColor: COLOR_SETTINGS_DEFAULTS.climbsHighColor,
    descentsLowColor: COLOR_SETTINGS_DEFAULTS.descentsLowColor,
    descentsHighColor: COLOR_SETTINGS_DEFAULTS.descentsHighColor,
    speedBelowAvgColor: null,
    climbsColor: null,
    descentsColor: null
  };

  // ─── Heatmap Color Constants ──────────────────────────────────────────

  R.HEATMAP_BASE_COLORS = {
    global: "#ec2c4a",
    rides: "#6e26e3",
    routes: "#386139"
  };

  R.HEATMAP_COLOR_DEFAULTS = {
    heatmapGlobalColor: "#ec2c4a",
    heatmapRidesColor: "#6e26e3",
    heatmapRoutesColor: "#386139"
  };

  R.HEATMAP_OPACITY_DEFAULTS = {
    heatmapGlobalOpacity: 100,
    heatmapRidesOpacity: 100,
    heatmapRoutesOpacity: 100
  };

  // ─── Shared HSV Conversion Helpers ──────────────────────────────────────

  R.hexToHsv = function (hex) {
    var r = parseInt(hex.slice(1, 3), 16) / 255;
    var g = parseInt(hex.slice(3, 5), 16) / 255;
    var b = parseInt(hex.slice(5, 7), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    var h = 0, s = max === 0 ? 0 : d / max, v = max;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      else if (max === g) h = ((b - r) / d + 2) * 60;
      else h = ((r - g) / d + 4) * 60;
    }
    return { h: h, s: s, v: v };
  };

  R.hsvToHex = function (h, s, v) {
    var c = v * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = v - c;
    var r, g, b;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  };

  R.normalizeHex = function (value) {
    if (!value || typeof value !== "string") return null;
    var hex = value.trim().toLowerCase();
    if (!hex) return null;
    if (hex[0] !== "#") hex = "#" + hex;
    if (/^#[0-9a-f]{3}$/.test(hex)) {
      return "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    if (!/^#[0-9a-f]{6}$/.test(hex)) return null;
    return hex;
  };

  R.computeRasterProps = function (targetHex, baseHex) {
    var target = R.hexToHsv(targetHex);
    var base = R.hexToHsv(baseHex);
    var hueRotate = target.h - base.h;
    if (hueRotate < 0) hueRotate += 360;
    var satDiff = target.s - base.s;
    var brightRatio = base.v > 0 ? target.v / base.v : 1;
    var brightnessMax = Math.min(1, Math.max(0, brightRatio));
    return { hueRotate: hueRotate, saturation: satDiff, brightnessMin: 0, brightnessMax: brightnessMax };
  };

  // ─── Speed Color Computation ────────────────────────────────────────────

  var SLOW_COLOR = { r: 74, g: 0, b: 0 };
  var AVG_COLOR  = { r: 255, g: 0, b: 0 };
  var FAST_COLOR = { r: 255, g: 255, b: 0 };
  var HILL_LIGHTEN_AMOUNT = 0.55;

  function clampChannel(v) {
    return Math.max(0, Math.min(255, Math.round(v)));
  }

  function parseHexColor(hex, fallback) {
    if (typeof hex !== "string") return fallback;
    var v = hex.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) return fallback;
    return {
      r: parseInt(v.slice(1, 3), 16),
      g: parseInt(v.slice(3, 5), 16),
      b: parseInt(v.slice(5, 7), 16)
    };
  }

  function liftTowardsWhite(color, amount) {
    return {
      r: clampChannel(color.r + (255 - color.r) * amount),
      g: clampChannel(color.g + (255 - color.g) * amount),
      b: clampChannel(color.b + (255 - color.b) * amount)
    };
  }

  function applyColorSettings(settings) {
    settings = settings || COLOR_SETTINGS_DEFAULTS;

    var speedLow = parseHexColor(settings.speedLowColor || settings.speedBelowAvgColor, parseHexColor(COLOR_SETTINGS_DEFAULTS.speedLowColor, SLOW_COLOR));
    var speedAvg = parseHexColor(settings.speedAvgColor, parseHexColor(COLOR_SETTINGS_DEFAULTS.speedAvgColor, AVG_COLOR));
    var speedMax = parseHexColor(settings.speedMaxColor, parseHexColor(COLOR_SETTINGS_DEFAULTS.speedMaxColor, FAST_COLOR));
    var climbLow = parseHexColor(settings.climbsLowColor || settings.climbsColor, parseHexColor(COLOR_SETTINGS_DEFAULTS.climbsLowColor, { r: 21, g: 101, b: 192 }));
    var climbHigh = parseHexColor(settings.climbsHighColor, liftTowardsWhite(climbLow, HILL_LIGHTEN_AMOUNT));
    var descentLow = parseHexColor(settings.descentsLowColor || settings.descentsColor, parseHexColor(COLOR_SETTINGS_DEFAULTS.descentsLowColor, { r: 27, g: 94, b: 32 }));
    var descentHigh = parseHexColor(settings.descentsHighColor, liftTowardsWhite(descentLow, HILL_LIGHTEN_AMOUNT));

    SLOW_COLOR = speedLow;
    AVG_COLOR = speedAvg;
    FAST_COLOR = speedMax;
    R.CLIMB_COLOR_LOW = climbLow;
    R.CLIMB_COLOR_HIGH = climbHigh;
    R.DESCENT_COLOR_LOW = descentLow;
    R.DESCENT_COLOR_HIGH = descentHigh;
  }
  R.applyColorSettings = applyColorSettings;

  R.loadColorSettings = async function () {
    if (typeof browser === "undefined" || !browser.storage || !browser.storage.local) {
      applyColorSettings(COLOR_SETTINGS_DEFAULTS);
      return COLOR_SETTINGS_DEFAULTS;
    }
    try {
      var stored = await browser.storage.local.get(null);
      stored = stored || {};
      applyColorSettings(stored);
      return Object.assign({}, COLOR_SETTINGS_STORAGE_DEFAULTS, stored);
    } catch (e) {
      applyColorSettings(COLOR_SETTINGS_DEFAULTS);
      return COLOR_SETTINGS_DEFAULTS;
    }
  };

  applyColorSettings(COLOR_SETTINGS_DEFAULTS);

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

  // ─── Grade Color Computation (Signed Palette) ───────────────────────────
  // Anchors: descent → blue, flat → green, climb → red
  // Saturates at ±GRADE_SATURATE_PCT; beyond that the color stays at the extreme.

  var GRADE_DESCENT_COLOR = { r: 25, g: 118, b: 210 };
  var GRADE_FLAT_COLOR    = { r: 76, g: 175, b: 80 };
  var GRADE_CLIMB_COLOR   = { r: 229, g: 57, b: 53 };
  var GRADE_SATURATE_PCT = 10;
  var GRADE_BUCKET_PCT = 0.5;

  function gradeToColor(grade) {
    var g = Math.max(-GRADE_SATURATE_PCT, Math.min(GRADE_SATURATE_PCT, grade));
    if (g >= 0) {
      var t = g / GRADE_SATURATE_PCT;
      return colorToHex(
        lerp(GRADE_FLAT_COLOR.r, GRADE_CLIMB_COLOR.r, t),
        lerp(GRADE_FLAT_COLOR.g, GRADE_CLIMB_COLOR.g, t),
        lerp(GRADE_FLAT_COLOR.b, GRADE_CLIMB_COLOR.b, t)
      );
    }
    var t2 = (-g) / GRADE_SATURATE_PCT;
    return colorToHex(
      lerp(GRADE_FLAT_COLOR.r, GRADE_DESCENT_COLOR.r, t2),
      lerp(GRADE_FLAT_COLOR.g, GRADE_DESCENT_COLOR.g, t2),
      lerp(GRADE_FLAT_COLOR.b, GRADE_DESCENT_COLOR.b, t2)
    );
  }
  R.gradeToColor = gradeToColor;

  function gradeBucket(grade) {
    var g = Math.max(-GRADE_SATURATE_PCT, Math.min(GRADE_SATURATE_PCT, grade));
    return Math.round(g / GRADE_BUCKET_PCT);
  }

  R.ensureGradeComputed = function (points) {
    if (!points || points.length < 2) return points;
    var hasGrade = false;
    for (var i = 1; i < points.length; i++) {
      if (points[i].grade) { hasGrade = true; break; }
    }
    if (hasGrade) return points;
    points[0].grade = 0;
    for (var j = 1; j < points.length; j++) {
      var segDist = points[j].distance - points[j - 1].distance;
      if (segDist > 0) {
        var dEle = points[j].ele - points[j - 1].ele;
        points[j].grade = (dEle / segDist) * 100;
      } else {
        points[j].grade = points[j - 1].grade || 0;
      }
    }
    var rawGrades = points.map(function (p) { return p.grade; });
    var win = 5;
    for (var k = 0; k < points.length; k++) {
      var sum = 0, count = 0;
      for (var m = Math.max(0, k - win); m <= Math.min(points.length - 1, k + win); m++) {
        sum += rawGrades[m];
        count++;
      }
      points[k].grade = sum / count;
    }
    return points;
  };

  function splitByGradeColor(points) {
    if (!points || points.length === 0) return [];
    var segments = [];
    var currentBucket = gradeBucket(points[0].grade || 0);
    var currentSeg = [points[0]];
    for (var i = 1; i < points.length; i++) {
      var bucket = gradeBucket(points[i].grade || 0);
      if (bucket !== currentBucket) {
        segments.push({ points: currentSeg, color: gradeToColor(currentBucket * GRADE_BUCKET_PCT) });
        currentSeg = [points[i - 1], points[i]];
        currentBucket = bucket;
      } else {
        currentSeg.push(points[i]);
      }
    }
    if (currentSeg.length > 0) {
      segments.push({ points: currentSeg, color: gradeToColor(currentBucket * GRADE_BUCKET_PCT) });
    }
    return segments;
  }
  R.splitByGradeColor = splitByGradeColor;

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
        properties: { markerType: "start", markerColor: hillGradientColor(0, lowColor, highColor), hillIndex: i }
      });
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [trackPoints[hill.last_i].lng, trackPoints[hill.last_i].lat] },
        properties: { markerType: "end", markerColor: hillGradientColor(1, lowColor, highColor), hillIndex: i }
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
      hr: raw.h != null ? raw.h : (raw.hr != null ? raw.hr : (raw.heartRate != null ? raw.heartRate : (raw.heart_rate != null ? raw.heart_rate : 0))),
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
    if (!objectId) return [];
    var url = "https://ridewithgps.com/" + objectType + "s/" + objectId + ".json";
    var resp = await fetch(url, {
      credentials: "same-origin",
      headers: {
        "x-rwgps-api-key": R.RWGPS_API_KEY,
        "x-rwgps-api-version": String(R.RWGPS_API_VERSION),
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
    if (segMatches.length > 0) {
      R.cachedSegmentMatches = segMatches;
    } else {
      R.cachedSegmentMatches = [];
    }

    if (objectType === "route") {
      computeRouteSpeedFromGrade(normalized);
    } else {
      computeDistanceAndSpeed(normalized);
    }

    return normalized;
  };

  // ─── Planner Live Route Updates ──────────────────────────────────────────

  R.plannerRefreshInProgress = false;

  document.addEventListener("rwgps-planner-route-update", function (e) {
    if (R.plannerRefreshInProgress) return;

    try {
      var rawPoints = JSON.parse(e.detail);
      if (!rawPoints || rawPoints.length < 2) return;

      var normalized = rawPoints.map(function (p) {
        return {
          lat: p.lat, lng: p.lng,
          ele: p.ele || 0,
          speed: 0, distance: 0, time: 0, grade: 0, hr: 0
        };
      }).filter(function (p) { return p.lat && p.lng; });

      if (normalized.length < 2) return;

      computeRouteSpeedFromGrade(normalized);

      R.cachedTrackPoints = normalized;
      R.cachedClimbs = null;
      R.cachedDescents = null;
      R.cachedSegments = null;
      R.cachedSegmentMatches = null;
      R.cachedDaylightTimes = null;
      R.cachedSampleTimes = null;
      R.cachedWeatherData = null;
      R.cachedWeatherTimes = null;

      R.refreshActivePlannerFeatures();
    } catch (err) {
      console.error("[RWGPS Ext] planner route update error:", err);
    }
  });

  R.refreshActivePlannerFeatures = async function () {
    if (R.plannerRefreshInProgress) return;
    R.plannerRefreshInProgress = true;

    try {
      var wasClimbs = R.climbsActive;
      var wasDescents = R.descentsActive;
      var wasSpeed = R.speedColorsActive;
      var wasGrade = R.gradeColorsActive;
      var wasTravel = R.travelDirectionActive;
      var wasDaylight = R.daylightActive;
      var wasEtSampleTime = R.etSampleTimeActive;

      if (wasClimbs) R.disableClimbs();
      if (wasDescents) R.disableDescents();
      if (wasSpeed) R.disableSpeedColors();
      if (wasGrade) R.disableGradeColors();
      if (wasTravel) R.disableTravelDirection();
      if (wasDaylight) R.disableDaylight();
      if (wasEtSampleTime) R.disableEtSampleTime();

      await new Promise(function (resolve) { setTimeout(resolve, 50); });

      if (wasClimbs) { R.climbsActive = true; await R.enableClimbs(); }
      if (wasDescents) { R.descentsActive = true; await R.enableDescents(); }
      if (wasSpeed) { R.speedColorsActive = true; await R.enableSpeedColors(); }
      if (wasGrade) { R.gradeColorsActive = true; await R.enableGradeColors(); }
      if (wasTravel) { R.travelDirectionActive = true; await R.enableTravelDirection(); }
      if (wasDaylight) { R.daylightActive = true; await R.enableDaylight(); }
      if (wasEtSampleTime) { R.etSampleTimeActive = true; await R.enableEtSampleTime(); }
    } catch (err) {
      console.error("[RWGPS Ext] planner feature refresh error:", err);
    } finally {
      R.plannerRefreshInProgress = false;
    }
  };

  // ─── Page Detection ─────────────────────────────────────────────────────

  R.getPageInfo = function () {
    var tripMatch = location.pathname.match(/^\/trips\/(\d+)/);
    if (tripMatch) return { type: "trip", id: tripMatch[1] };
    var routeEditMatch = location.pathname.match(/^\/routes\/(\d+)\/edit/);
    if (routeEditMatch) return { type: "route", id: routeEditMatch[1], isPlanner: true };
    if (location.pathname === "/routes/new" || location.pathname === "/route_planner") {
      return { type: "route", id: null, isPlanner: true };
    }
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

  function toFiniteNumber(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  R.getGraphPlotRect = function (layout, cw, ch, dpr) {
    if (!layout || !layout.plotMargin) return null;
    var margin = layout.plotMargin || {};
    var leftCss = toFiniteNumber(margin.left);
    if (leftCss == null) leftCss = toFiniteNumber(margin.l);
    if (leftCss == null) leftCss = 0;
    var topCss = toFiniteNumber(margin.top);
    if (topCss == null) topCss = toFiniteNumber(margin.t);
    if (topCss == null) topCss = 0;
    var plotWidthCss = toFiniteNumber(layout.plotWidth);
    var plotHeightCss = toFiniteNumber(layout.plotHeight);
    if (plotWidthCss == null || plotHeightCss == null || plotWidthCss <= 0 || plotHeightCss <= 0) return null;

    var left = clamp(Math.round(leftCss * dpr), 0, Math.max(0, cw - 1));
    var top = clamp(Math.round(topCss * dpr), 0, Math.max(0, ch - 1));
    var right = clamp(Math.round((leftCss + plotWidthCss) * dpr), 0, Math.max(0, cw - 1));
    var bottom = clamp(Math.round((topCss + plotHeightCss) * dpr), 0, Math.max(0, ch - 1));
    if (right <= left || bottom <= top) return null;
    return { left: left, right: right, top: top, bottom: bottom };
  };

  R.projectDistanceToGraphX = function (dist, layout, dpr, plotLeftPx, plotRightPx, maxDist) {
    var xp = layout && layout.xProjection;
    if (xp && Number.isFinite(xp.vScale) && xp.vScale !== 0 && Number.isFinite(xp.v0) && Number.isFinite(xp.pixelOffset)) {
      return ((dist - xp.v0) * xp.vScale + xp.pixelOffset) * dpr;
    }
    if (!Number.isFinite(maxDist) || maxDist <= 0) return plotLeftPx;
    return plotLeftPx + (dist / maxDist) * (plotRightPx - plotLeftPx);
  };

  R.projectElevationToGraphY = function (ele, layout, dpr, plotTopPx, plotBottomPx, minEle, maxEle) {
    var yp = layout && layout.yProjection;
    if (yp && Number.isFinite(yp.vScale) && yp.vScale !== 0 && Number.isFinite(yp.v0) && Number.isFinite(yp.pixelOffset)) {
      var delta = (ele - yp.v0) * yp.vScale;
      var yCss = yp.invert ? (yp.pixelOffset - delta) : (yp.pixelOffset + delta);
      return yCss * dpr;
    }
    if (!Number.isFinite(minEle) || !Number.isFinite(maxEle) || maxEle <= minEle) {
      return (plotTopPx + plotBottomPx) / 2;
    }
    var t = (ele - minEle) / (maxEle - minEle);
    return plotBottomPx - t * (plotBottomPx - plotTopPx);
  };

  R.pickGraphProjectionLayout = function (trackPoints, layout, dpr, plotLeftPx, plotRightPx, plotTopPx, plotBottomPx, maxDist, minEle, maxEle) {
    if (!layout || !trackPoints || trackPoints.length < 2) return null;

    var sampleStep = Math.max(1, Math.floor(trackPoints.length / 30));
    var total = 0;
    var inBounds = 0;
    var finite = 0;
    var minAllowedX = plotLeftPx - 3;
    var maxAllowedX = plotRightPx + 3;
    var minAllowedY = plotTopPx - 3;
    var maxAllowedY = plotBottomPx + 3;

    for (var i = 0; i < trackPoints.length; i += sampleStep) {
      var p = trackPoints[i];
      if (!p) continue;
      var x = R.projectDistanceToGraphX(p.distance, layout, dpr, plotLeftPx, plotRightPx, maxDist);
      var y = R.projectElevationToGraphY(p.ele, layout, dpr, plotTopPx, plotBottomPx, minEle, maxEle);
      total++;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      finite++;
      if (x >= minAllowedX && x <= maxAllowedX && y >= minAllowedY && y <= maxAllowedY) {
        inBounds++;
      }
    }

    if (total < 4 || finite < Math.max(3, Math.floor(total * 0.5))) {
      return null;
    }

    // If projected points mostly sit outside plot bounds, projection is likely stale/wrong.
    if (inBounds < Math.max(2, Math.floor(finite * 0.6))) {
      return null;
    }

    // Guard against collapsed/edge-locked Y projections that draw as a thin top/bottom artifact.
    var plotHeight = Math.max(1, plotBottomPx - plotTopPx);
    var yAtMinEle = R.projectElevationToGraphY(minEle, layout, dpr, plotTopPx, plotBottomPx, minEle, maxEle);
    var yAtMaxEle = R.projectElevationToGraphY(maxEle, layout, dpr, plotTopPx, plotBottomPx, minEle, maxEle);
    if (!Number.isFinite(yAtMinEle) || !Number.isFinite(yAtMaxEle)) {
      return null;
    }
    var projectedYSpan = Math.abs(yAtMaxEle - yAtMinEle);
    var projectedYLow = Math.min(yAtMinEle, yAtMaxEle);
    var projectedYHigh = Math.max(yAtMinEle, yAtMaxEle);
    if (projectedYSpan < Math.max(4, plotHeight * 0.08)) {
      return null;
    }
    if (projectedYHigh < (plotTopPx - plotHeight * 0.2) || projectedYLow > (plotBottomPx + plotHeight * 0.2)) {
      return null;
    }
    return layout;
  };

  R.findSampleGraphCanvas = function (excludeOverlayClass) {
    function isOurOverlay(c) {
      if (!c) return true;
      if (excludeOverlayClass && c.classList.contains(excludeOverlayClass)) return true;
      var cn = typeof c.className === "string" ? c.className : "";
      return (cn.indexOf("rwgps-") >= 0 && cn.indexOf("overlay") >= 0);
    }
    function isMapCanvas(c) {
      if (c.classList && c.classList.contains("maplibregl-canvas")) return true;
      return !!(c.closest && c.closest(".maplibregl-map, .gm-style, .leaflet-container"));
    }
    function findContainer(c) {
      return c.closest('[class*="SampleGraph"], [class*="sampleGraph"], [class*="BottomPanel"]') || c.parentElement;
    }
    function firstValidCanvas(root) {
      var canvases = root.querySelectorAll("canvas");
      for (var j = 0; j < canvases.length; j++) {
        if (!isOurOverlay(canvases[j]) && !isMapCanvas(canvases[j])) {
          return canvases[j];
        }
      }
      return null;
    }

    // 1. Inside a SampleGraph container (proven working approach)
    var sgContainers = document.querySelectorAll('[class*="SampleGraph"], [class*="sampleGraph"]');
    for (var ci = 0; ci < sgContainers.length; ci++) {
      var c = firstValidCanvas(sgContainers[ci]);
      if (c) return { canvas: c, container: sgContainers[ci] };
    }

    // 2. Inside a BottomPanel or Elevation/Profile container (some route pages differ)
    var altContainers = document.querySelectorAll('[class*="BottomPanel"], [class*="bottomPanel"], [class*="Elevation"], [class*="Profile"]');
    for (var ai = 0; ai < altContainers.length; ai++) {
      var ac = firstValidCanvas(altContainers[ai]);
      if (ac) return { canvas: ac, container: findContainer(ac) };
    }

    // 3. Any canvas near graph marker siblings
    var markerSel = ".sample-graph-render-text, .sg-hover-x-label, .sg-hover-details, .sg-hover-vertical-line, .sg-hover-horizontal-line, .sg-segment-selector-control, .sg-elem";
    var allCanvases = document.querySelectorAll("canvas");
    for (var k = 0; k < allCanvases.length; k++) {
      var cv = allCanvases[k];
      if (isOurOverlay(cv) || isMapCanvas(cv)) continue;
      var p = cv.parentElement;
      var pp = p ? p.parentElement : null;
      var ppp = pp ? pp.parentElement : null;
      var hasMarker = (p && p.querySelector && p.querySelector(markerSel)) ||
                      (pp && pp.querySelector && pp.querySelector(markerSel)) ||
                      (ppp && ppp.querySelector && ppp.querySelector(markerSel));
      if (hasMarker) return { canvas: cv, container: findContainer(cv) };
    }

    return null;
  };

  R.buildGraphInkProfile = function (canvas, plotRect) {
    if (!canvas) return null;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    var canvasW = canvas.width || 0;
    var canvasH = canvas.height || 0;
    if (canvasW <= 2 || canvasH <= 2) return null;

    function normalizeRect(rect, fallbackRect) {
      var base = rect || fallbackRect;
      var l = Math.max(0, Math.floor(base.left));
      var r = Math.min(canvasW - 1, Math.floor(base.right));
      var t = Math.max(0, Math.floor(base.top));
      var b = Math.min(canvasH - 1, Math.floor(base.bottom));
      if (r <= l || b <= t) return null;
      return { left: l, right: r, top: t, bottom: b };
    }

    function loadImageData(rect) {
      var w = rect.right - rect.left + 1;
      var h = rect.bottom - rect.top + 1;
      if (w <= 2 || h <= 2) return null;
      try {
        var imageData = ctx.getImageData(rect.left, rect.top, w, h);
        return { rect: rect, data: imageData.data, width: w, height: h };
      } catch (e) {
        return null;
      }
    }

    function detectInkBounds(img) {
      var w = img.width;
      var h = img.height;
      var data = img.data;
      var left = w, right = -1, top = h, bottom = -1;

      function idx(x, y) {
        return (y * w + x) * 4;
      }
      function isInkAt(x, y) {
        var di = idx(x, y);
        var a = data[di + 3];
        if (a < 20) return false;
        var r = data[di], g = data[di + 1], b = data[di + 2];
        if (r > 245 && g > 245 && b > 245) return false;
        return true;
      }

      for (var y = 0; y < h; y += 2) {
        for (var x = 0; x < w; x += 2) {
          if (!isInkAt(x, y)) continue;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }

      if (right <= left || bottom <= top) return null;
      return {
        left: img.rect.left + left,
        right: img.rect.left + right,
        top: img.rect.top + top,
        bottom: img.rect.top + bottom
      };
    }

    var fullRect = { left: 0, right: canvasW - 1, top: 0, bottom: canvasH - 1 };
    var candidateRect = normalizeRect(plotRect, fullRect);
    if (!candidateRect) candidateRect = fullRect;

    var candidateImg = loadImageData(candidateRect);
    if (!candidateImg) return null;

    var inkRect = detectInkBounds(candidateImg);
    if (!inkRect) {
      var fullImg = candidateRect === fullRect ? candidateImg : loadImageData(fullRect);
      if (!fullImg) return null;
      inkRect = detectInkBounds(fullImg);
      if (!inkRect) return null;
      candidateRect = fullRect;
      candidateImg = fullImg;
    } else {
      var candW = candidateRect.right - candidateRect.left + 1;
      var candH = candidateRect.bottom - candidateRect.top + 1;
      var inkW = inkRect.right - inkRect.left + 1;
      var inkH = inkRect.bottom - inkRect.top + 1;
      var tinyInk = (inkW < Math.max(16, candW * 0.15)) || (inkH < Math.max(12, candH * 0.12));
      if (tinyInk && !(candidateRect.left === 0 && candidateRect.top === 0 &&
                       candidateRect.right === canvasW - 1 && candidateRect.bottom === canvasH - 1)) {
        var fullImg2 = loadImageData(fullRect);
        if (!fullImg2) return null;
        var fullInk = detectInkBounds(fullImg2);
        if (fullInk) {
          candidateRect = fullRect;
          candidateImg = fullImg2;
          inkRect = fullInk;
        }
      }
    }

    var finalRect = normalizeRect(inkRect, fullRect);
    if (!finalRect) return null;

    var finalImg = loadImageData(finalRect);
    if (!finalImg) return null;
    var left = finalRect.left;
    var right = finalRect.right;
    var top = finalRect.top;
    var bottom = finalRect.bottom;
    var width = finalImg.width;
    var height = finalImg.height;
    var data = finalImg.data;

    function pxIndex(x, y) {
      return (y * width + x) * 4;
    }
    function isInk(x, y) {
      var idx = pxIndex(x, y);
      var a = data[idx + 3];
      if (a < 20) return false;
      var r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (r > 245 && g > 245 && b > 245) return false;
      return true;
    }
    function darkness(x, y) {
      var idx = pxIndex(x, y);
      var r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
      var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return (255 - lum) * (a / 255);
    }

    var yByX = new Array(width);
    var found = 0;

    for (var x = 0; x < width; x++) {
      var chosenY = null;
      var bestRunTop = -1;
      var bestRunLen = 0;
      var runTop = -1;
      var runLen = 0;

      for (var y = 0; y < height; y++) {
        if (!isInk(x, y)) continue;
        if (runTop < 0) runTop = y;
        runLen++;
        if (y < height - 1 && isInk(x, y + 1)) continue;
        if (runLen > bestRunLen) {
          bestRunLen = runLen;
          bestRunTop = runTop;
        }
        runTop = -1;
        runLen = 0;
      }

      if (bestRunTop >= 0) {
        chosenY = bestRunTop;
      } else {
        var bestScore = 0;
        var bestY = null;
        for (var y2 = 0; y2 < height; y2++) {
          if (!isInk(x, y2)) continue;
          var score = darkness(x, y2);
          if (score > bestScore) {
            bestScore = score;
            bestY = y2;
          }
        }
        chosenY = bestY;
      }

      if (chosenY != null) {
        yByX[x] = top + chosenY;
        found++;
      } else {
        yByX[x] = null;
      }
    }

    if (found < Math.max(8, Math.floor(width * 0.08))) {
      return null;
    }

    var prev = null;
    for (var i = 0; i < width; i++) {
      if (yByX[i] != null) prev = yByX[i];
      else if (prev != null) yByX[i] = prev;
    }
    var next = null;
    for (var j = width - 1; j >= 0; j--) {
      if (yByX[j] != null) next = yByX[j];
      else if (next != null) yByX[j] = next;
    }

    for (var m = 2; m < width - 2; m++) {
      if (yByX[m] == null) continue;
      var neighbors = [yByX[m - 2], yByX[m - 1], yByX[m + 1], yByX[m + 2]].filter(function (v) { return v != null; });
      if (neighbors.length < 2) continue;
      neighbors.sort(function (a, b) { return a - b; });
      var median = neighbors[Math.floor(neighbors.length / 2)];
      if (Math.abs(yByX[m] - median) > 28) {
        yByX[m] = median;
      }
    }

    return {
      left: left,
      right: right,
      top: top,
      bottom: bottom,
      yByX: yByX,
      coverage: found / width
    };
  };

  R.retryOverlayRender = function (activeFlag, renderFn, onSuccess) {
    var attempts = 0;
    var maxAttempts = 240; // ~2 minutes at 500ms
    function attempt() {
      if (!R[activeFlag]) return;
      attempts++;
      try {
        var result = renderFn();
        if (result) {
          if (onSuccess) onSuccess();
          return;
        }
      } catch (e) {}
      if (attempts < maxAttempts) {
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

  // ─── Goal List (shared by calendar & goals features) ────────────────────

  R.goalsCache = null;
  var GOALS_CACHE_TTL_MS = 30 * 60 * 1000;

  R.goalHue = function (id) {
    var n = parseInt(id, 10);
    if (!isNaN(n)) return (n * 137) % 360;
    var h = 0, s = String(id);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return ((h % 360) + 360) % 360;
  };

  function compactNumber(n) {
    if (!isFinite(n)) return "0";
    if (n >= 10000) return Math.round(n / 1000) + "k";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    if (n >= 100) return String(Math.round(n));
    if (n >= 10) return n.toFixed(0);
    return n.toFixed(1).replace(/\.0$/, "");
  }

  R.formatCompactDistance = function (meters, isMetric) {
    var divisor = isMetric ? 1000 : 1609.34;
    var unit = isMetric ? "km" : "mi";
    return compactNumber((meters || 0) / divisor) + " " + unit;
  };

  R.formatCompactElevation = function (meters, isMetric) {
    var divisor = isMetric ? 1 : 0.3048;
    var unit = isMetric ? "m" : "ft";
    return compactNumber((meters || 0) / divisor) + " " + unit;
  };

  function collectIdsFromText(text, out) {
    var re = /\/goals\/(\d+)(?!\d)/g;
    var m;
    while ((m = re.exec(text)) !== null) out[m[1]] = true;
  }

  function participantIsMetric(participant, goalType) {
    if (!participant) return false;
    var params = participant.goal_params || participant.goalParams || {};
    var trailer = (params.trailer || "").toLowerCase();
    if (!trailer) return false;
    if (goalType === "elevation_gain") return trailer.indexOf("meter") !== -1 || trailer === "m";
    return trailer.indexOf("km") !== -1;
  }

  function normalizeGoals(detailList) {
    var out = [];
    for (var i = 0; i < detailList.length; i++) {
      var data = detailList[i];
      if (!data) continue;
      var goal = data.goal || data;
      var participant = data.goal_participant || data.goalParticipant || null;

      var type = goal.goal_type || goal.goalType;
      if (type !== "distance" && type !== "elevation_gain") continue;

      var startsOn = goal.starts_on || goal.startsOn;
      if (!startsOn) continue;
      var endsOn = goal.ends_on || goal.endsOn;

      var params = goal.goal_params || goal.goalParams || {};
      var targetMeters = params.max;
      if (!targetMeters) continue;

      var goalId = goal.id != null ? String(goal.id) : null;
      if (!goalId) continue;

      out.push({
        id: goalId,
        name: goal.name || ("Goal " + goalId),
        startKey: String(startsOn).substring(0, 10),
        endKey: endsOn ? String(endsOn).substring(0, 10) : null,
        type: type,
        targetMeters: Number(targetMeters),
        isMetric: participantIsMetric(participant, type),
        hue: R.goalHue(goalId)
      });
    }
    return out;
  }

  async function collectGoalIds(userId) {
    var ids = {};

    var participations = await R.rwgpsFetchPlain("/users/" + userId + "/goals.json");
    var results = participations && (participations.results || participations.goal_participations);
    if (Array.isArray(results)) {
      for (var i = 0; i < results.length; i++) {
        var p = results[i];
        if (p && p.goal && p.goal.id != null) ids[String(p.goal.id)] = true;
      }
    }

    try {
      var resp = await fetch("https://ridewithgps.com/goals", { credentials: "same-origin" });
      if (resp.ok) {
        var html = await resp.text();
        collectIdsFromText(html, ids);
      }
    } catch (e) { /* ignore scrape failure */ }

    return Object.keys(ids);
  }

  R.probeGoalEndpoint = function (path) {
    return fetch("https://ridewithgps.com" + path, {
      credentials: "same-origin",
      headers: {
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest"
      }
    }).then(function (r) {
      console.log("[RWGPS Ext] probe " + path + " → " + r.status);
      return r.text().then(function (t) {
        console.log("[RWGPS Ext] probe body (first 500 chars):", t.slice(0, 500));
        try { return JSON.parse(t); } catch (e) { return t; }
      });
    });
  };

  R.clearGoalsCache = function () {
    R.goalsCache = null;
    console.log("[RWGPS Ext] goals cache cleared");
  };

  R.getUserGoals = async function (userId) {
    if (!userId) return [];
    var now = Date.now();
    if (R.goalsCache && R.goalsCache.userId === userId && (now - R.goalsCache.ts) < GOALS_CACHE_TTL_MS) {
      console.log("[RWGPS Ext] getUserGoals cache hit (" + R.goalsCache.goals.length + " goals)");
      return R.goalsCache.goals;
    }
    var goals = [];
    try {
      var ids = await collectGoalIds(userId);
      console.log("[RWGPS Ext] collected " + ids.length + " goal id candidate(s)", ids);
      var details = await Promise.all(ids.map(function (id) {
        return R.rwgpsFetchPlain("/goals/" + id + ".json");
      }));
      var valid = details.filter(Boolean);
      goals = normalizeGoals(valid);
      console.log("[RWGPS Ext] getUserGoals normalized " + goals.length + " of " + valid.length + " fetched goal detail(s)", goals);
    } catch (e) {
      console.warn("[RWGPS Ext] getUserGoals error", e);
      goals = [];
    }
    R.goalsCache = { userId: userId, ts: now, goals: goals };
    return goals;
  };

  R.loadColorSettings();

})(window.RE);
