(function (R) {
  "use strict";

  // ─── Temperature Map Layer ─────────────────────────────────────────────
  // Labels the map with the current air temperature at a grid of points,
  // from Open-Meteo's free forecast API (no key; one request per refresh
  // covers every point). Points sit on a fixed lat/lng lattice per zoom
  // level, so panning reuses values already fetched. The chips themselves
  // are DOM elements positioned by page-bridge.js.

  var API_URL = "https://api.open-meteo.com/v1/forecast";
  var CACHE_TTL_MS = 15 * 60 * 1000;
  var CACHE_MAX_ENTRIES = 500;
  var MIN_ZOOM = 4;
  var TARGET_COLUMNS = 5;
  var MAX_POINTS = 40;

  // Celsius stops for the chip background.
  var TEMP_STOPS = [
    [-20, [106, 27, 154]],
    [-10, [57, 73, 171]],
    [0, [30, 136, 229]],
    [8, [0, 172, 193]],
    [15, [67, 160, 71]],
    [21, [253, 216, 53]],
    [27, [251, 140, 0]],
    [33, [229, 57, 53]],
    [40, [183, 28, 28]]
  ];

  var cache = {}; // "lat,lng" -> { ts, celsius }
  var viewListenerAttached = false;
  var refreshTimer = null;
  var refreshSeq = 0;
  var lastView = null;
  var lastUpdated = null;

  function normalizeLng(lng) {
    return ((lng + 540) % 360) - 180;
  }

  // Power-of-two degree spacing keeps the lattice stable while panning and
  // gives roughly TARGET_COLUMNS points across the view.
  function latticePoints(view) {
    var span = Math.max(0.02, view.east - view.west);
    var step = Math.pow(2, Math.round(Math.log(span / TARGET_COLUMNS) / Math.LN2));
    var points = [];
    var lat0 = Math.floor(view.south / step) * step + step / 2;
    var lng0 = Math.floor(view.west / step) * step + step / 2;
    for (var lat = lat0; lat < view.north; lat += step) {
      if (lat < view.south || Math.abs(lat) > 85) continue;
      for (var lng = lng0; lng < view.east; lng += step) {
        if (lng < view.west) continue;
        points.push({ lat: +lat.toFixed(4), lng: +lng.toFixed(4) });
      }
    }
    if (points.length <= MAX_POINTS) return points;
    var thinned = [];
    var every = points.length / MAX_POINTS;
    for (var i = 0; i < MAX_POINTS; i++) thinned.push(points[Math.floor(i * every)]);
    return thinned;
  }

  function cacheKey(p) {
    return p.lat.toFixed(4) + "," + normalizeLng(p.lng).toFixed(4);
  }

  function rememberTemp(key, celsius) {
    var keys = Object.keys(cache);
    if (keys.length >= CACHE_MAX_ENTRIES) delete cache[keys[0]];
    cache[key] = { ts: Date.now(), celsius: celsius };
  }

  // Always fetch Celsius so cached values serve both unit preferences.
  async function fetchTemperatures(points) {
    var url = API_URL +
      "?latitude=" + points.map(function (p) { return p.lat.toFixed(4); }).join(",") +
      "&longitude=" + points.map(function (p) { return normalizeLng(p.lng).toFixed(4); }).join(",") +
      "&current=temperature_2m";
    try {
      var resp = await fetch(url);
      if (!resp.ok) return null;
      var data = await resp.json();
      var list = Array.isArray(data) ? data : [data];
      return list.map(function (d) {
        return d && d.current && typeof d.current.temperature_2m === "number" ? d.current.temperature_2m : null;
      });
    } catch (e) {
      return null;
    }
  }

  function colorForCelsius(c) {
    if (c <= TEMP_STOPS[0][0]) return TEMP_STOPS[0][1];
    for (var i = 1; i < TEMP_STOPS.length; i++) {
      if (c <= TEMP_STOPS[i][0]) {
        var a = TEMP_STOPS[i - 1], b = TEMP_STOPS[i];
        var t = (c - a[0]) / (b[0] - a[0]);
        return [0, 1, 2].map(function (k) { return Math.round(a[1][k] + (b[1][k] - a[1][k]) * t); });
      }
    }
    return TEMP_STOPS[TEMP_STOPS.length - 1][1];
  }

  function chipFor(point, celsius, metric) {
    var rgb = colorForCelsius(celsius);
    var luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    var value = metric ? celsius : celsius * 9 / 5 + 32;
    return {
      lat: point.lat,
      lng: point.lng,
      text: Math.round(value) + "°",
      bg: "rgb(" + rgb.join(",") + ")",
      fg: luminance > 0.6 ? "#1b2828" : "#ffffff"
    };
  }

  async function refresh(view) {
    if (!R.temperatureActive || !view) return;
    lastView = view;
    var seq = ++refreshSeq;
    var zoomedOut = typeof view.zoom === "number" && view.zoom < MIN_ZOOM;
    updateLegend(zoomedOut);
    if (zoomedOut) {
      document.dispatchEvent(new CustomEvent("rwgps-temperature-apply", { detail: JSON.stringify({ chips: [] }) }));
      return;
    }

    var points = latticePoints(view);
    var now = Date.now();
    var missing = points.filter(function (p) {
      var hit = cache[cacheKey(p)];
      return !hit || (now - hit.ts) > CACHE_TTL_MS;
    });
    if (missing.length > 0) {
      var temps = await fetchTemperatures(missing);
      if (!R.temperatureActive) return;
      if (temps) {
        for (var i = 0; i < missing.length; i++) {
          if (temps[i] != null) rememberTemp(cacheKey(missing[i]), temps[i]);
        }
        lastUpdated = new Date();
      }
    }
    if (seq !== refreshSeq || !R.temperatureActive) return; // a newer view superseded this one

    var metric = R.isMetric();
    var chips = [];
    for (var j = 0; j < points.length; j++) {
      var hit = cache[cacheKey(points[j])];
      if (hit) chips.push(chipFor(points[j], hit.celsius, metric));
    }
    updateLegend(false);
    document.dispatchEvent(new CustomEvent("rwgps-temperature-apply", { detail: JSON.stringify({ chips: chips }) }));
  }

  function ensureViewListener() {
    if (!viewListenerAttached) {
      viewListenerAttached = true;
      document.addEventListener("rwgps-mapviewport", function (e) {
        if (!R.temperatureActive) return;
        try { refresh(JSON.parse(e.detail)); } catch (err) {}
      });
    }
    // Every enable: after SPA navigation the page has a new map instance.
    document.dispatchEvent(new CustomEvent("rwgps-mapviewport-watch"));
  }

  // ─── Legend ────────────────────────────────────────────────────────────

  function ensureLegend() {
    if (document.querySelector(".rwgps-temperature-legend")) return;
    var legend = document.createElement("div");
    legend.className = "rwgps-temperature-legend";

    var title = document.createElement("div");
    title.className = "rwgps-temperature-legend-title";
    legend.appendChild(title);

    var bar = document.createElement("div");
    bar.className = "rwgps-temperature-legend-bar";
    bar.style.background = "linear-gradient(90deg," + TEMP_STOPS.map(function (s) {
      return "rgb(" + s[1].join(",") + ")";
    }).join(",") + ")";
    legend.appendChild(bar);

    var scale = document.createElement("div");
    scale.className = "rwgps-temperature-legend-scale";
    legend.appendChild(scale);

    var note = document.createElement("div");
    note.className = "rwgps-temperature-legend-note";
    legend.appendChild(note);

    var anchor = document.querySelector(".maplibregl-ctrl-bottom-right");
    if (anchor) {
      anchor.insertBefore(legend, anchor.firstChild);
    } else {
      var mapEl = document.querySelector(".maplibregl-map");
      legend.classList.add("rwgps-temperature-legend-floating");
      (mapEl && mapEl.parentElement ? mapEl.parentElement : document.body).appendChild(legend);
    }
    updateLegend(false);
  }

  function updateLegend(zoomedOut) {
    var legend = document.querySelector(".rwgps-temperature-legend");
    if (!legend) return;
    var metric = R.isMetric();
    var lo = TEMP_STOPS[0][0], hi = TEMP_STOPS[TEMP_STOPS.length - 1][0];
    legend.querySelector(".rwgps-temperature-legend-title").textContent =
      "Air Temperature (°" + (metric ? "C" : "F") + ")";
    legend.querySelector(".rwgps-temperature-legend-scale").innerHTML =
      "<span>" + Math.round(metric ? lo : lo * 9 / 5 + 32) + "°</span>" +
      "<span>" + Math.round(metric ? hi : hi * 9 / 5 + 32) + "°</span>";
    var note = zoomedOut ? "Zoom in to load" : "Open-Meteo" + (lastUpdated
      ? " · " + lastUpdated.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      : "");
    legend.querySelector(".rwgps-temperature-legend-note").textContent = note;
  }

  function removeLegend() {
    var legend = document.querySelector(".rwgps-temperature-legend");
    if (legend) legend.remove();
  }

  // ─── Public API ────────────────────────────────────────────────────────

  R.enableTemperature = function () {
    R.temperatureActive = true;
    ensureViewListener();
    ensureLegend();
    if (!refreshTimer) {
      // "Current" conditions go stale; re-check the last view periodically.
      refreshTimer = setInterval(function () {
        if (R.temperatureActive && !document.hidden && lastView) refresh(lastView);
      }, CACHE_TTL_MS);
    }
    // The viewport listener above refreshes when page-bridge replies.
    document.dispatchEvent(new CustomEvent("rwgps-mapviewport-get"));
  };

  R.disableTemperature = function () {
    R.temperatureActive = false;
    refreshSeq++;
    lastView = null;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    removeLegend();
    document.dispatchEvent(new CustomEvent("rwgps-temperature-reset"));
  };

  R.toggleTemperature = function () {
    if (R.temperatureActive) R.disableTemperature();
    else R.enableTemperature();
  };

})(window.RE);
