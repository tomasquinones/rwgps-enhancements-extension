window.RE = {};
(function (R) {
  "use strict";

  // ─── Shared State ───────────────────────────────────────────────────────

  R.speedColorsActive = false;
  R.segmentsActive = false;
  R.daylightActive = false;
  R.weatherActive = false;
  R.weatherTempActive = true;
  R.weatherPrecipActive = true;
  R.weatherCloudActive = true;
  R.weatherWindActive = true;
  R.weatherStripActive = false;
  R.enhancementsMenuOpen = false;
  R.heatmapColorsActive = false;
  R.hrZonesActive = false;
  R.hillshadeActive = false;
  R.trackColorsActive = false;

  R.cachedTrackPoints = null;
  R.cachedSegments = null;
  R.cachedSegmentMatches = null;
  R.cachedDepartedAt = null;
  R.cachedDaylightTimes = null;
  R.cachedWeatherData = null;
  R.cachedWeatherTimes = null;
  R.cachedUserSummary = null;
  R.lastTRoutePage = null;

  // ─── Extension Context Guard ────────────────────────────────────────────
  // On Chromium, reloading/updating the extension invalidates the context for
  // content scripts that are still running. All browser.storage/runtime calls
  // will throw "Extension context invalidated". This flag lets polling loops
  // detect the dead context and stop silently instead of spamming the console.

  R.contextInvalidated = false;

  function markContextInvalidated() {
    if (R.contextInvalidated) return;
    R.contextInvalidated = true;
    console.warn("[RWGPS Ext] Extension context invalidated — stopping all polling.");
  }

  // Chromium clears runtime.id on an orphaned content script; Firefox throws.
  function contextAlive() {
    try { return !!(browser.runtime && browser.runtime.id); } catch (e) { return false; }
  }

  // Settings cache. Several modules poll their settings every second through
  // R.safeStorageGet; serving those reads from memory (kept current by
  // storage.onChanged) avoids a storage round trip per module per second.
  var storageCache = {};       // key -> stored value (undefined = not stored)
  var storageCacheLoaded = {}; // key -> true once fetched

  try {
    browser.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local") return;
      var keys = Object.keys(changes);
      for (var i = 0; i < keys.length; i++) {
        if (storageCacheLoaded[keys[i]]) storageCache[keys[i]] = changes[keys[i]].newValue;
      }
    });
  } catch (e) {}

  // Same contract as browser.storage.local.get(defaults), but resolves null
  // once the extension context is invalidated.
  R.safeStorageGet = function (defaults) {
    if (R.contextInvalidated) return Promise.resolve(null);
    if (!contextAlive()) {
      markContextInvalidated();
      return Promise.resolve(null);
    }
    var keys = Object.keys(defaults);
    function fromCache() {
      var out = {};
      for (var i = 0; i < keys.length; i++) {
        out[keys[i]] = storageCache[keys[i]] !== undefined ? storageCache[keys[i]] : defaults[keys[i]];
      }
      return out;
    }
    var missing = keys.filter(function (k) { return !storageCacheLoaded[k]; });
    if (missing.length === 0) return Promise.resolve(fromCache());
    return browser.storage.local.get(missing).then(function (stored) {
      for (var i = 0; i < missing.length; i++) {
        storageCache[missing[i]] = stored[missing[i]];
        storageCacheLoaded[missing[i]] = true;
      }
      return fromCache();
    }).catch(function (err) {
      if (err && err.message && err.message.indexOf("Extension context invalidated") !== -1) {
        markContextInvalidated();
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
    speedMaxColor: "#fdd835"
  };
  R.SPEED_COLOR_DEFAULTS = COLOR_SETTINGS_DEFAULTS;

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

  // ─── Color Picker Canvas Helpers (Enhancements menu, heatmaps, track colors) ─

  R.drawSvGradient = function (canvas, hue) {
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height;
    var pure = R.hsvToHex(hue, 1, 1);
    var gradH = ctx.createLinearGradient(0, 0, w, 0);
    gradH.addColorStop(0, "#ffffff");
    gradH.addColorStop(1, pure);
    ctx.fillStyle = gradH;
    ctx.fillRect(0, 0, w, h);
    var gradV = ctx.createLinearGradient(0, 0, 0, h);
    gradV.addColorStop(0, "rgba(0,0,0,0)");
    gradV.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = gradV;
    ctx.fillRect(0, 0, w, h);
  };

  R.drawHueBar = function (canvas) {
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height;
    var grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#ff0000");
    grad.addColorStop(1 / 6, "#ffff00");
    grad.addColorStop(2 / 6, "#00ff00");
    grad.addColorStop(3 / 6, "#00ffff");
    grad.addColorStop(4 / 6, "#0000ff");
    grad.addColorStop(5 / 6, "#ff00ff");
    grad.addColorStop(1, "#ff0000");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  };

  R.drawSvIndicator = function (canvas, s, v) {
    var ctx = canvas.getContext("2d");
    var x = s * canvas.width;
    var y = (1 - v) * canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.strokeStyle = v > 0.5 ? "#000" : "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  R.drawHueIndicator = function (canvas, h) {
    var ctx = canvas.getContext("2d");
    var x = (h / 360) * canvas.width;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 3, 0, 6, canvas.height);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
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

  function applyColorSettings(settings) {
    settings = settings || COLOR_SETTINGS_DEFAULTS;

    var speedLow = parseHexColor(settings.speedLowColor, parseHexColor(COLOR_SETTINGS_DEFAULTS.speedLowColor, SLOW_COLOR));
    var speedAvg = parseHexColor(settings.speedAvgColor, parseHexColor(COLOR_SETTINGS_DEFAULTS.speedAvgColor, AVG_COLOR));
    var speedMax = parseHexColor(settings.speedMaxColor, parseHexColor(COLOR_SETTINGS_DEFAULTS.speedMaxColor, FAST_COLOR));

    SLOW_COLOR = speedLow;
    AVG_COLOR = speedAvg;
    FAST_COLOR = speedMax;
  }

  R.loadColorSettings = async function () {
    try {
      applyColorSettings(await browser.storage.local.get(COLOR_SETTINGS_DEFAULTS));
    } catch (e) {
      applyColorSettings(COLOR_SETTINGS_DEFAULTS);
    }
  };

  applyColorSettings(COLOR_SETTINGS_DEFAULTS);

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
  R.speedToColor = speedToColor;

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

  // ─── Segment Colors ─────────────────────────────────────────────────────

  R.SEGMENT_COLORS = [
    "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
    "#42d4f4", "#f032e6", "#bfef45", "#469990", "#9a6324",
    "#dcbeff", "#fabed4"
  ];

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

  // ─── Moon Position & Phase ──────────────────────────────────────────────
  // Low-precision lunar ephemeris (about 1° in altitude), plenty for drawing
  // the moon's height on the elevation graph and naming its phase.

  var RAD = Math.PI / 180;
  var OBLIQUITY = 23.4397 * RAD;

  function daysSinceJ2000(date) {
    return date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  }

  function eclipticToEquatorial(lng, lat) {
    return {
      ra: Math.atan2(Math.sin(lng) * Math.cos(OBLIQUITY) - Math.tan(lat) * Math.sin(OBLIQUITY), Math.cos(lng)),
      dec: Math.asin(Math.sin(lat) * Math.cos(OBLIQUITY) + Math.cos(lat) * Math.sin(OBLIQUITY) * Math.sin(lng))
    };
  }

  function sunEquatorial(d) {
    var M = (357.5291 + 0.98560028 * d) * RAD;
    var C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
    var lng = M + C + 102.9372 * RAD + Math.PI;
    return eclipticToEquatorial(lng, 0);
  }

  function moonEquatorial(d) {
    var L = (218.316 + 13.176396 * d) * RAD;  // mean longitude
    var M = (134.963 + 13.064993 * d) * RAD;  // mean anomaly
    var F = (93.272 + 13.229350 * d) * RAD;   // mean distance from node
    var pos = eclipticToEquatorial(L + 6.289 * RAD * Math.sin(M), 5.128 * RAD * Math.sin(F));
    pos.distKm = 385001 - 20905 * Math.cos(M);
    return pos;
  }

  R.moonPosition = function (date, lat, lng) {
    var d = daysSinceJ2000(date);
    var m = moonEquatorial(d);
    var hourAngle = (280.16 + 360.9856235 * d) * RAD + lng * RAD - m.ra;
    var phi = lat * RAD;
    var sinAlt = Math.sin(phi) * Math.sin(m.dec) + Math.cos(phi) * Math.cos(m.dec) * Math.cos(hourAngle);
    return { altitude: Math.asin(sinAlt) / RAD };
  };

  var MOON_PHASES = [
    { max: 0.03, name: "New Moon", icon: "\uD83C\uDF11" },
    { max: 0.22, name: "Waxing Crescent", icon: "\uD83C\uDF12" },
    { max: 0.28, name: "First Quarter", icon: "\uD83C\uDF13" },
    { max: 0.47, name: "Waxing Gibbous", icon: "\uD83C\uDF14" },
    { max: 0.53, name: "Full Moon", icon: "\uD83C\uDF15" },
    { max: 0.72, name: "Waning Gibbous", icon: "\uD83C\uDF16" },
    { max: 0.78, name: "Last Quarter", icon: "\uD83C\uDF17" },
    { max: 0.97, name: "Waning Crescent", icon: "\uD83C\uDF18" },
    { max: 1.01, name: "New Moon", icon: "\uD83C\uDF11" }
  ];

  // fraction: illuminated share of the disc (0–1). phase: 0 new, 0.25 first
  // quarter, 0.5 full, 0.75 last quarter.
  R.moonIllumination = function (date) {
    var d = daysSinceJ2000(date);
    var s = sunEquatorial(d);
    var m = moonEquatorial(d);
    var sunDistKm = 149598000;
    var elongation = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) +
      Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    var inc = Math.atan2(sunDistKm * Math.sin(elongation), m.distKm - sunDistKm * Math.cos(elongation));
    var angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra),
      Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    var phase = 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI;
    var info = MOON_PHASES[MOON_PHASES.length - 1];
    for (var i = 0; i < MOON_PHASES.length; i++) {
      if (phase < MOON_PHASES[i].max) { info = MOON_PHASES[i]; break; }
    }
    return { fraction: (1 + Math.cos(inc)) / 2, phase: phase, name: info.name, icon: info.icon };
  };

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

  // Several features can ask for the same trip/route at once; share one
  // request per object instead of downloading the JSON for each.
  var trackPointsInflight = {};

  R.fetchTrackPoints = function (objectType, objectId) {
    if (!objectId) return Promise.resolve([]);
    var key = objectType + ":" + objectId;
    if (trackPointsInflight[key]) return trackPointsInflight[key];
    var promise = fetchTrackPointsUncached(objectType, objectId);
    trackPointsInflight[key] = promise;
    function done() { delete trackPointsInflight[key]; }
    promise.then(done, done);
    return promise;
  };

  async function fetchTrackPointsUncached(objectType, objectId) {
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
  }

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
      var wasSpeed = R.speedColorsActive;
      var wasDaylight = R.daylightActive;
      var wasEtSampleTime = R.etSampleTimeActive;

      if (wasSpeed) R.disableSpeedColors();
      if (wasDaylight) R.disableDaylight();
      if (wasEtSampleTime) R.disableEtSampleTime();

      await new Promise(function (resolve) { setTimeout(resolve, 50); });

      if (wasSpeed) { R.speedColorsActive = true; await R.enableSpeedColors(); }
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

  // Each call walks the graph's React tree in page-bridge.js. Hover handlers
  // pass maxAgeMs to reuse a recent result; overlay renders omit it so they
  // always get a fresh layout after the graph is zoomed or resized.
  var graphLayoutCache = null; // { layout, ts }

  R.getGraphLayout = function (maxAgeMs) {
    if (maxAgeMs && graphLayoutCache && (Date.now() - graphLayoutCache.ts) < maxAgeMs) {
      return graphLayoutCache.layout;
    }
    document.dispatchEvent(new CustomEvent("rwgps-speed-colors-get-layout"));
    var raw = document.documentElement.getAttribute("data-speed-colors-layout");
    var layout = null;
    if (raw) {
      try { layout = JSON.parse(raw); } catch (e) { layout = null; }
    }
    graphLayoutCache = { layout: layout, ts: Date.now() };
    return layout;
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
      // One row read instead of five 1x1 reads: each getImageData on a
      // GPU-backed canvas is a synchronous readback.
      var parts = [];
      var row = ctx.getImageData(0, Math.floor(h / 2), w, 1).data;
      for (var i = 0; i < 5; i++) {
        var o = Math.floor((w * (i + 1)) / 6) * 4;
        parts.push(row[o] + "," + row[o + 1] + "," + row[o + 2] + "," + row[o + 3]);
      }
      return w + "x" + h + ":" + parts.join("|");
    } catch (e) { return ""; }
  };

  // Pride-flag rainbow stops; prideColorAt(t) interpolates across them for
  // t in [0,1] (red → orange → yellow → green → blue → purple).
  R.PRIDE_STOPS = [
    [228, 3, 3], [255, 140, 0], [255, 237, 0], [0, 128, 38], [0, 77, 255], [117, 7, 135],
  ];
  R.prideColorAt = function (t) {
    var stops = R.PRIDE_STOPS;
    if (t <= 0) return "rgb(" + stops[0].join(",") + ")";
    if (t >= 1) return "rgb(" + stops[stops.length - 1].join(",") + ")";
    var seg = t * (stops.length - 1);
    var i = Math.floor(seg);
    var f = seg - i;
    var a = stops[i], b = stops[i + 1];
    return "rgb(" +
      Math.round(a[0] + (b[0] - a[0]) * f) + "," +
      Math.round(a[1] + (b[1] - a[1]) * f) + "," +
      Math.round(a[2] + (b[2] - a[2]) * f) + ")";
  };

  // ─── Cumulative progress chart (shared by Goals + Activities Graph) ───────
  //
  // Draws a cumulative line + area with daily (≤60 day) or weekly (>60 day)
  // bars on a secondary axis, plus hover tooltip/crosshair. `targetDist` and
  // `projection` are optional: pass 0/null (the Activities Graph does) to draw
  // a plain ride-total chart with no goal pace line. Goals passes both.
  R.drawCumulativeChart = function (canvas, data, totalDays, targetDist, distUnit, startDate, tooltip, crosshair, projection, palette) {
    var hasTarget = !!(targetDist && targetDist > 0);

    function chartFmt(n) {
      if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
      if (n >= 100) return Math.round(n).toString();
      return n.toFixed(1);
    }
    function chartTicks(min, max, count) {
      var range = max - min;
      if (range <= 0) return [0];
      var rawStep = range / count;
      var magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
      var residual = rawStep / magnitude;
      var niceStep;
      if (residual <= 1.5) niceStep = 1 * magnitude;
      else if (residual <= 3) niceStep = 2 * magnitude;
      else if (residual <= 7) niceStep = 5 * magnitude;
      else niceStep = 10 * magnitude;
      var ticks = [];
      for (var t = 0; t <= max; t += niceStep) {
        ticks.push(Math.round(t * 100) / 100);
      }
      return ticks;
    }

    var dpr = window.devicePixelRatio || 1;
    var containerStyle = window.getComputedStyle(canvas.parentNode);
    var containerPadLeft = parseFloat(containerStyle.paddingLeft) || 0;
    var containerPadRight = parseFloat(containerStyle.paddingRight) || 0;
    var containerWidth = canvas.parentNode.offsetWidth - containerPadLeft - containerPadRight;

    var padding = { top: 20, right: 64, bottom: 50, left: 50 };
    var width = containerWidth;
    var height = Math.min(600, Math.max(300, containerWidth * 0.5));

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    var plotW = width - padding.left - padding.right;
    var plotH = height - padding.top - padding.bottom;

    var lastCumulative = data.length > 0 ? data[data.length - 1].cumulative : 0;
    var projectedEnd = projection ? projection.total : 0;
    var maxY = Math.max(hasTarget ? targetDist : 0, lastCumulative, projectedEnd) * 1.05;
    if (!(maxY > 0)) maxY = 1;

    function expectedAt(dayIndex) {
      if (!hasTarget) return 0;
      if (totalDays <= 1) return targetDist;
      var d = Math.max(0, Math.min(totalDays - 1, dayIndex));
      return targetDist * d / (totalDays - 1);
    }

    var maxBarDist = 0;
    if (totalDays <= 60) {
      for (var i = 0; i < data.length; i++) {
        if (data[i].dayDist > maxBarDist) maxBarDist = data[i].dayDist;
      }
    } else {
      for (var w = 0; w < Math.ceil(data.length / 7); w++) {
        var wd = 0;
        var ws = w * 7, we = Math.min(ws + 7, data.length);
        for (var di = ws; di < we; di++) {
          wd += data[di].dayDist;
        }
        if (wd > maxBarDist) maxBarDist = wd;
      }
    }
    var maxBarY = maxBarDist > 0 ? maxBarDist * 1.15 : 1;

    var slotW = plotW / totalDays;
    function dayX(d) {
      return padding.left + d * slotW + slotW / 2;
    }

    var uiFont = '"aktiv-grotesk", "Aktiv Grotesk", "Open Sans", "Gill Sans MT", Corbel, Arial, sans-serif';

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#dce0e0";
    ctx.lineWidth = 1;
    var yTicks = chartTicks(0, maxY, 5);
    for (var i = 0; i < yTicks.length; i++) {
      var y = padding.top + plotH - (yTicks[i] / maxY) * plotH;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + plotW, y);
      ctx.stroke();
    }

    ctx.fillStyle = "#5b6161";
    ctx.font = "12px " + uiFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (var i = 0; i < yTicks.length; i++) {
      var y = padding.top + plotH - (yTicks[i] / maxY) * plotH;
      ctx.fillText(chartFmt(yTicks[i]), padding.left + plotW + 8, y);
    }

    ctx.save();
    ctx.translate(width - 6, padding.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillStyle = "#6e7575";
    ctx.font = "11px " + uiFont;
    ctx.fillText(distUnit, 0, 0);
    ctx.restore();

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#5b6161";
    ctx.font = "12px " + uiFont;
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var minLabelGap = 50;
    var lastLabelX = -Infinity;
    if (totalDays <= 60) {
      for (var d = 0; d < totalDays; d += 7) {
        var lx = dayX(d);
        if (lx - lastLabelX >= minLabelGap) {
          var date = new Date(startDate);
          date.setDate(date.getDate() + d);
          ctx.fillText(months[date.getMonth()] + " " + date.getDate(), lx, padding.top + plotH + 8);
          lastLabelX = lx;
        }
      }
    } else {
      for (var d = 0; d < totalDays; d++) {
        var date = new Date(startDate);
        date.setDate(date.getDate() + d);
        if (d === 0 || date.getDate() === 1) {
          var lx = dayX(d);
          if (lx - lastLabelX >= minLabelGap) {
            var label = d === 0 ? months[date.getMonth()] + " " + date.getDate() : months[date.getMonth()];
            ctx.fillText(label, lx, padding.top + plotH + 8);
            lastLabelX = lx;
          }
        }
      }
    }
    var endLabelX = dayX(totalDays - 1);
    if (endLabelX - lastLabelX >= minLabelGap) {
      var endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + totalDays - 1);
      ctx.fillText(months[endDate.getMonth()] + " " + endDate.getDate(), endLabelX, padding.top + plotH + 8);
    }

    if (hasTarget) {
      ctx.strokeStyle = "#b7bdbd";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(dayX(0), padding.top + plotH);
      ctx.lineTo(dayX(totalDays - 1), padding.top + plotH - (targetDist / maxY) * plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = "#b7bdbd";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + plotH);
    ctx.lineTo(padding.left + plotW, padding.top + plotH);
    ctx.stroke();

    var bars = [];
    if (totalDays <= 60) {
      var barW = Math.max(2, slotW - 1);
      for (var d = 0; d < totalDays; d++) {
        var entry = d < data.length ? data[d] : null;
        var cx = dayX(d);
        bars.push({
          x: cx, w: barW,
          dist: entry ? entry.dayDist : 0,
          cumulative: entry ? entry.cumulative : null,
          startDay: d, endDay: d, label: "Day",
          future: !entry
        });
      }
    } else {
      var weekSlotW = plotW / Math.ceil(totalDays / 7);
      var barW = Math.max(3, Math.floor(weekSlotW * 0.5));
      var totalWeeks = Math.ceil(totalDays / 7);
      for (var w = 0; w < totalWeeks; w++) {
        var weekStart = w * 7;
        var slotEnd = Math.min(weekStart + 7, totalDays);
        var dataEnd = Math.min(slotEnd, data.length);
        var weekDist = 0;
        var lastDataIdx = -1;
        for (var di = weekStart; di < dataEnd; di++) {
          weekDist += data[di].dayDist;
          lastDataIdx = di;
        }
        var weekCenterDay = weekStart + (slotEnd - weekStart - 1) / 2;
        var cx = dayX(weekCenterDay);
        var futureWeek = lastDataIdx === -1;
        bars.push({
          x: cx, w: barW,
          dist: weekDist,
          cumulative: futureWeek ? null : data[lastDataIdx].cumulative,
          startDay: weekStart,
          endDay: futureWeek ? slotEnd - 1 : lastDataIdx,
          label: "Week",
          future: futureWeek
        });
      }
    }

    for (var i = 0; i < bars.length; i++) {
      if (bars[i].dist > 0) {
        var barH = (bars[i].dist / maxBarY) * plotH;
        ctx.fillStyle = palette.pride
          ? R.prideColorAt(bars.length > 1 ? i / (bars.length - 1) : 0)
          : palette.bar;
        ctx.fillRect(bars[i].x - bars[i].w / 2, padding.top + plotH - barH, bars[i].w, barH);
      }
    }

    if (maxBarDist > 0) {
      var barTicks = chartTicks(0, maxBarY, 4);
      ctx.fillStyle = palette.barAxis;
      ctx.font = "11px " + uiFont;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (var i = 0; i < barTicks.length; i++) {
        var y = padding.top + plotH - (barTicks[i] / maxBarY) * plotH;
        ctx.fillText(chartFmt(barTicks[i]), padding.left - 8, y);
      }
      ctx.save();
      ctx.translate(14, padding.top + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillStyle = palette.barAxis;
      ctx.font = "10px " + uiFont;
      ctx.fillText(totalDays <= 60 ? "daily" : "weekly", 0, 0);
      ctx.restore();
    }

    var lineStroke;
    if (palette.pride) {
      var lineGrad = ctx.createLinearGradient(padding.left, 0, padding.left + plotW, 0);
      var pstops = R.PRIDE_STOPS.length;
      for (var pi = 0; pi < pstops; pi++) {
        lineGrad.addColorStop(pi / (pstops - 1), R.prideColorAt(pi / (pstops - 1)));
      }
      lineStroke = lineGrad;
    } else {
      lineStroke = palette.line;
    }
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (var i = 0; i < data.length; i++) {
      var x = dayX(data[i].day);
      var y = padding.top + plotH - (data[i].cumulative / maxY) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    // White casing underneath keeps the line legible against same-colored bars.
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 5;
    ctx.stroke();
    // Colored line on top.
    ctx.strokeStyle = lineStroke;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    if (data.length > 0) {
      var fillLastX = dayX(data[data.length - 1].day);
      ctx.lineTo(fillLastX, padding.top + plotH);
      ctx.lineTo(dayX(0), padding.top + plotH);
      ctx.closePath();
      ctx.fillStyle = palette.area;
      ctx.fill();
    }

    if (projection && data.length > 0) {
      var lastPt = data[data.length - 1];
      var startX = dayX(lastPt.day);
      var startY = padding.top + plotH - (lastPt.cumulative / maxY) * plotH;
      var endX = dayX(totalDays - 1);
      var endY = padding.top + plotH - (projection.total / maxY) * plotH;

      ctx.strokeStyle = palette.projection;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = palette.projection;
      ctx.beginPath();
      ctx.arc(endX, endY, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = palette.projection;
      ctx.font = "11px " + uiFont;
      ctx.textBaseline = "middle";
      var labelText = chartFmt(projection.total) + " " + distUnit;
      var labelW = ctx.measureText(labelText).width;
      if (endX + labelW + 12 <= padding.left + plotW) {
        ctx.textAlign = "left";
        ctx.fillText(labelText, endX + 8, endY);
      } else {
        ctx.textAlign = "right";
        ctx.fillText(labelText, endX - 8, endY - 10);
      }
    }

    canvas.addEventListener("mousemove", function (e) {
      var rect = canvas.getBoundingClientRect();
      var mouseX = e.clientX - rect.left;
      var mouseY = e.clientY - rect.top;

      var relX = mouseX - padding.left;
      if (relX < 0 || relX > plotW || mouseY < padding.top || mouseY > padding.top + plotH) {
        tooltip.style.display = "none";
        crosshair.style.display = "none";
        return;
      }

      var nearest = 0;
      var nearestDist = Infinity;
      for (var bi = 0; bi < bars.length; bi++) {
        var dd = Math.abs(mouseX - bars[bi].x);
        if (dd < nearestDist) { nearestDist = dd; nearest = bi; }
      }

      var bar = bars[nearest];
      var dateA = new Date(startDate);
      dateA.setDate(dateA.getDate() + bar.startDay);
      var dateB = new Date(startDate);
      dateB.setDate(dateB.getDate() + bar.endDay);

      var expectedHere = expectedAt(bar.endDay);
      var slotDays = bar.endDay - bar.startDay + 1;
      var slotPace = hasTarget && totalDays > 0 ? (targetDist / totalDays) * slotDays : 0;
      var single = bar.startDay === bar.endDay;
      var headStr = single
        ? months[dateA.getMonth()] + " " + dateA.getDate() + ", " + dateA.getFullYear()
        : months[dateA.getMonth()] + " " + dateA.getDate() + " – " + months[dateB.getMonth()] + " " + dateB.getDate();
      var tooltipText = "<strong>" + headStr + "</strong>";
      if (bar.future) {
        if (hasTarget) {
          tooltipText += "<br>Pace: " + chartFmt(slotPace) + " " + distUnit +
            "<br>Expected: " + chartFmt(expectedHere) + " " + distUnit;
        }
      } else {
        tooltipText += "<br>" + (single ? "Day" : (bar.label === "Week" ? "Week" : "Period")) + ": " +
          chartFmt(bar.dist) + " " + distUnit +
          "<br>Total: " + chartFmt(bar.cumulative) + " " + distUnit;
        if (hasTarget) tooltipText += "<br>Expected: " + chartFmt(expectedHere) + " " + distUnit;
      }

      var ptX = bar.x;
      var anchorY = bar.cumulative !== null ? bar.cumulative : expectedHere;
      var ptY = padding.top + plotH - (anchorY / maxY) * plotH;

      var domX = ptX + containerPadLeft;
      var domY = ptY + parseFloat(containerStyle.paddingTop || 0);

      tooltip.innerHTML = tooltipText;
      tooltip.style.display = "block";

      var tooltipW = tooltip.offsetWidth;
      if (domX + tooltipW + 20 > canvas.parentNode.offsetWidth) {
        tooltip.style.left = (domX - tooltipW - 12) + "px";
      } else {
        tooltip.style.left = (domX + 12) + "px";
      }
      tooltip.style.top = (domY - 10) + "px";

      crosshair.style.display = "block";
      crosshair.style.left = domX + "px";
      crosshair.style.top = (padding.top + parseFloat(containerStyle.paddingTop || 0)) + "px";
      crosshair.style.height = plotH + "px";
    });

    canvas.addEventListener("mouseleave", function () {
      tooltip.style.display = "none";
      crosshair.style.display = "none";
    });
  };

  // Per-user trip list, cached. Cookie-only endpoint honors the /users/{id}
  // path (the v3 api-key endpoint ignores it and returns the authenticated
  // user). Returns a bare array of trip objects, stored as-is.
  //
  // opts.since (Date or ms): the caller only needs trips departed on/after
  // this instant, so paging can stop early instead of downloading the whole
  // history. The result then holds every trip departed >= since and may also
  // hold older ones; callers filter by date themselves. Omit for full history.
  //
  // Per user we cache a full-history list and a partial ("since") list
  // separately: a fresh full list satisfies any request, a partial list only a
  // `since` request at or after its own lower bound, never a full-history one.
  var TRIP_LIST_MAX_USERS = 3; // LRU cap; a full history can be large
  var tripListCache = {};    // userId -> { used, full: { ts, trips }, partial: { ts, trips, sinceMs } }
  var tripListInflight = {}; // userId -> { full: Promise, partial: { promise, sinceMs } } (dedupe)
  var tripListUseSeq = 0;
  R.TRIP_LIST_TTL_MS = 60 * 1000;
  // An early stop waits for a trip a full day before `since`, so a departure
  // read in a different timezone than the caller's can't be dropped.
  var TRIP_SINCE_MARGIN_MS = 24 * 60 * 60 * 1000;

  function tripKey(t) {
    if (!t) return null;
    if (t.id != null) return t.id;
    return (t.departed_at || t.departedAt || t.created_at || t.createdAt || "") + "|" + (t.distance || 0);
  }

  function tripDepartedMs(t) {
    var v = t && (t.departed_at || t.departedAt);
    return typeof v === "string" ? Date.parse(v) : NaN;
  }

  // True when `page` is ordered newest-first by departure and its oldest trip
  // departed before sinceMs (minus the margin), so later pages can only be
  // older. If the page isn't newest-first we can't tell, so keep paging.
  function pageReachesBefore(page, sinceMs) {
    var prev = Infinity;
    var oldest = Infinity;
    for (var i = 0; i < page.length; i++) {
      var ms = tripDepartedMs(page[i]);
      if (isNaN(ms)) continue;
      if (ms > prev) return false; // not newest-first
      prev = ms;
      oldest = ms;
    }
    return oldest < sinceMs - TRIP_SINCE_MARGIN_MS;
  }

  // Page through the bare-array endpoint. As of 2026-10 the cookie-only
  // /users/{id}/trips.json (trips_controller#index, api.otherwise branch)
  // ignores paging and returns the whole visible list, unsorted, in one
  // response; the "limit ignored" guard below then stops after one request.
  // The pager stays in case the server starts paging (it once appeared to
  // return only a recent page). We step by offset until a short/empty page. The guards keep this
  // safe even if the server ignores the paging params: page size is detected
  // from the first response (not assumed to equal our requested limit), a page
  // longer than the requested limit is the whole list (limit ignored), and we
  // stop the moment a page repeats its first trip (offset ignored) so we never
  // loop or accumulate duplicates.
  //
  // With sinceMs, stop once a newest-first page reaches before it; the list is
  // then partial. Resolves { trips, complete, ok }; ok is false when a request
  // failed, so the truncated list isn't cached as the rider's history.
  async function fetchAllUserTrips(userId, sinceMs) {
    var LIMIT = 200;
    var MAX_PAGES = 100; // safety cap (~20k trips)
    var all = [];
    var offset = 0;
    var pageSize = null;
    var prevFirstKey = null;
    var complete = true;
    for (var p = 0; p < MAX_PAGES; p++) {
      // Send both paging conventions (offset/limit and page/per_page); offset
      // steps by the actual page length and page by 1, so whichever the server
      // honors, it advances correctly.
      var path = "/users/" + userId + "/trips.json?offset=" + offset +
        "&limit=" + LIMIT + "&page=" + (p + 1) + "&per_page=" + LIMIT;
      var data = await R.rwgpsFetchPlain(path);
      var page = Array.isArray(data) ? data : (data && Array.isArray(data.results) ? data.results : null);
      if (!page) return { trips: all, complete: false, ok: false }; // request failed
      if (!page.length) break;
      var firstKey = tripKey(page[0]);
      if (firstKey != null && firstKey === prevFirstKey) break; // paging ignored
      prevFirstKey = firstKey;
      all = all.concat(page);
      if (page.length > LIMIT) break; // limit ignored: this was the whole list
      if (pageSize == null) pageSize = page.length;
      if (page.length < pageSize) break; // last (short) page
      if (sinceMs != null && pageReachesBefore(page, sinceMs)) { complete = false; break; }
      offset += page.length;
    }
    return { trips: all, complete: complete, ok: true };
  }

  function toSinceMs(since) {
    if (since == null) return null;
    var ms = since instanceof Date ? since.getTime() : Number(since);
    return isFinite(ms) ? ms : null;
  }

  // Mark a user as just used and evict the least-recently-used beyond the cap.
  function touchTripListUser(userId) {
    var entry = tripListCache[userId] ||
      (tripListCache[userId] = { used: 0, full: null, partial: null });
    entry.used = ++tripListUseSeq;
    var ids = Object.keys(tripListCache);
    while (ids.length > TRIP_LIST_MAX_USERS) {
      var lru = ids[0];
      for (var i = 1; i < ids.length; i++) {
        if (tripListCache[ids[i]].used < tripListCache[lru].used) lru = ids[i];
      }
      delete tripListCache[lru];
      ids = Object.keys(tripListCache);
    }
    return entry;
  }

  R.fetchUserTrips = function (userId, opts) {
    opts = opts || {};
    var sinceMs = toSinceMs(opts.since);
    var ttl = opts.ttl != null ? opts.ttl : R.TRIP_LIST_TTL_MS;
    var now = Date.now();
    var entry = touchTripListUser(userId);
    var inflight = tripListInflight[userId] || (tripListInflight[userId] = { full: null, partial: null });

    if (!opts.force) {
      if (entry.full && (now - entry.full.ts) < ttl) return Promise.resolve(entry.full.trips);
      if (sinceMs != null && entry.partial && entry.partial.sinceMs <= sinceMs &&
          (now - entry.partial.ts) < ttl) {
        return Promise.resolve(entry.partial.trips);
      }
      // Join a fetch already running: a full one serves anyone, a partial one
      // only requests within its range.
      if (inflight.full) return inflight.full;
      if (sinceMs != null && inflight.partial && inflight.partial.sinceMs <= sinceMs) {
        return inflight.partial.promise;
      }
    }

    function settle() {
      if (sinceMs == null) {
        if (inflight.full === promise) inflight.full = null;
      } else if (inflight.partial && inflight.partial.promise === promise) {
        inflight.partial = null;
      }
      if (!inflight.full && !inflight.partial && tripListInflight[userId] === inflight) {
        delete tripListInflight[userId];
      }
    }

    var promise = fetchAllUserTrips(userId, sinceMs).then(function (res) {
      settle();
      if (res.ok) {
        var e = touchTripListUser(userId);
        var rec = { ts: Date.now(), trips: res.trips };
        if (res.complete) {
          // A since fetch can still come back complete (short history, or
          // the server sent everything at once); it then serves every request.
          e.full = rec;
          e.partial = null;
        } else {
          rec.sinceMs = sinceMs;
          e.partial = rec;
        }
      }
      return res.trips;
    }, function (err) {
      settle();
      throw err;
    });
    if (sinceMs == null) inflight.full = promise;
    else inflight.partial = { promise: promise, sinceMs: sinceMs };
    return promise;
  };

  R.loadColorSettings();

})(window.RE);
