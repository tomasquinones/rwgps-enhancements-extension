(function (R) {
  "use strict";

  // ─── Public Lands Overlay ───────────────────────────────────────────────
  // Renders public-lands polygons on planner / route / trip maps. In US
  // viewports, fetches the Esri Living Atlas "USA Federal Lands" layer —
  // one CORS-enabled, no-key endpoint that covers BLM, Forest Service,
  // NPS, USFWS, DoD, and Bureau of Reclamation in a single query. Outside
  // the US, falls back to OpenStreetMap protected-area ways via Overpass.

  var publicLandsState = {
    cache: {},      // bboxKey -> GeoJSON FeatureCollection
    lastFetchBbox: null,
    pending: false
  };

  var US_REGIONS = [
    { south: 24, west: -125, north: 50, east: -66 }, // CONUS
    { south: 51, west: -180, north: 72, east: -130 }, // Alaska
    { south: 18, west: -161, north: 23, east: -154 }  // Hawaii
  ];

  var COLORS = {
    BLM:    "#DAA520", // goldenrod
    USFS:   "#2E7D32", // forest green
    NPS:    "#6D4C41", // brown (NPS arrowhead earth)
    USFWS:  "#00838F", // teal (wildlife / water)
    OTHER:  "#607D8B", // slate (DoD, BoR, other federal)
    OSM:    "#7B1FA2"  // purple (non-US protected)
  };

  // Maps the Esri Living Atlas `Agency` field to one of the buckets above.
  var AGENCY_TO_CATEGORY = {
    "Bureau of Land Management":  { color: COLORS.BLM,   category: "BLM" },
    "Forest Service":             { color: COLORS.USFS,  category: "USFS" },
    "National Park Service":      { color: COLORS.NPS,   category: "NPS" },
    "Fish and Wildlife Service":  { color: COLORS.USFWS, category: "USFWS" },
    "Department of Defense":      { color: COLORS.OTHER, category: "DOD" },
    "Bureau of Reclamation":      { color: COLORS.OTHER, category: "BOR" }
  };

  var LEGEND_ROWS = [
    { color: COLORS.BLM,   label: "Bureau of Land Management" },
    { color: COLORS.USFS,  label: "U.S. Forest Service" },
    { color: COLORS.NPS,   label: "National Park Service" },
    { color: COLORS.USFWS, label: "U.S. Fish & Wildlife" },
    { color: COLORS.OTHER, label: "DoD / Reclamation" },
    { color: COLORS.OSM,   label: "Other Protected (OSM)" }
  ];

  function isInUS(lat, lng) {
    for (var i = 0; i < US_REGIONS.length; i++) {
      var r = US_REGIONS[i];
      if (lat >= r.south && lat <= r.north && lng >= r.west && lng <= r.east) return true;
    }
    return false;
  }

  function bboxKey(b) {
    function q(v) { return Math.round(v * 2) / 2; }
    return q(b.west) + "," + q(b.south) + "," + q(b.east) + "," + q(b.north);
  }

  function bboxContains(outer, inner) {
    return outer.west <= inner.west && outer.south <= inner.south
        && outer.east >= inner.east && outer.north >= inner.north;
  }

  function expandBbox(b, factor) {
    var dlat = (b.north - b.south) * factor;
    var dlng = (b.east - b.west) * factor;
    return {
      west: b.west - dlng, south: b.south - dlat,
      east: b.east + dlng, north: b.north + dlat
    };
  }

  async function fetchJsonSafe(url) {
    try {
      var resp = await fetch(url);
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) { return null; }
  }

  function tagFederalFeatures(geojson) {
    if (!geojson || !geojson.features) return { type: "FeatureCollection", features: [] };
    for (var i = 0; i < geojson.features.length; i++) {
      var f = geojson.features[i];
      f.properties = f.properties || {};
      var agency = f.properties.Agency;
      var bucket = AGENCY_TO_CATEGORY[agency] || { color: COLORS.OTHER, category: "OTHER" };
      f.properties._color = bucket.color;
      f.properties._category = bucket.category;
      f.properties._name = f.properties.unit_name || agency || bucket.category;
    }
    return geojson;
  }

  async function fetchFederalLands(b) {
    // Esri Living Atlas "USA Federal Lands": single endpoint covering
    // BLM, USFS, NPS, USFWS, DoD, and Bureau of Reclamation. CORS-
    // enabled, no key required.
    var url = "https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/USA_Federal_Lands/FeatureServer/0/query"
      + "?f=geojson&where=1%3D1"
      + "&geometry=" + encodeURIComponent(b.west + "," + b.south + "," + b.east + "," + b.north)
      + "&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326"
      + "&spatialRel=esriSpatialRelIntersects"
      + "&outFields=" + encodeURIComponent("Agency,unit_name");
    return tagFederalFeatures(await fetchJsonSafe(url));
  }

  function overpassToGeoJson(osm) {
    var features = [];
    if (!osm || !osm.elements) return { type: "FeatureCollection", features: features };
    for (var i = 0; i < osm.elements.length; i++) {
      var el = osm.elements[i];
      if (el.type !== "way" || !el.geometry || el.geometry.length < 4) continue;
      var coords = [];
      for (var j = 0; j < el.geometry.length; j++) {
        coords.push([el.geometry[j].lon, el.geometry[j].lat]);
      }
      var first = coords[0], last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
      var name = (el.tags && (el.tags.name || el.tags["name:en"])) || "Protected area";
      features.push({
        type: "Feature",
        properties: { _color: COLORS.OSM, _category: "OSM", _name: name },
        geometry: { type: "Polygon", coordinates: [coords] }
      });
    }
    return { type: "FeatureCollection", features: features };
  }

  async function fetchOverpass(b) {
    // bbox for Overpass: south,west,north,east
    var bb = b.south + "," + b.west + "," + b.north + "," + b.east;
    var query = "[out:json][timeout:25];"
      + '(way["boundary"="protected_area"](' + bb + ');'
      + 'way["boundary"="national_park"](' + bb + '););'
      + "out geom;";
    var url = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query);
    var json = await fetchJsonSafe(url);
    return overpassToGeoJson(json);
  }

  async function fetchForBbox(b) {
    var key = bboxKey(b);
    if (publicLandsState.cache[key]) return publicLandsState.cache[key];
    var centerLat = (b.south + b.north) / 2;
    var centerLng = (b.west + b.east) / 2;
    var data;
    if (isInUS(centerLat, centerLng)) {
      data = await fetchFederalLands(b);
    } else {
      data = await fetchOverpass(b) || { type: "FeatureCollection", features: [] };
    }
    publicLandsState.cache[key] = data;
    return data;
  }

  async function refresh(bbox) {
    if (!R.publicLandsActive) return;
    if (publicLandsState.pending) return;
    if (publicLandsState.lastFetchBbox && bboxContains(publicLandsState.lastFetchBbox, bbox)) return;
    publicLandsState.pending = true;
    try {
      var fetchBbox = expandBbox(bbox, 0.5);
      var data = await fetchForBbox(fetchBbox);
      if (!R.publicLandsActive) return;
      publicLandsState.lastFetchBbox = fetchBbox;
      document.dispatchEvent(new CustomEvent("rwgps-publiclands-apply", {
        detail: JSON.stringify(data)
      }));
    } finally {
      publicLandsState.pending = false;
    }
  }

  function getCurrentViewport() {
    return new Promise(function (resolve) {
      function onView(e) {
        document.removeEventListener("rwgps-mapviewport", onView);
        try { resolve(JSON.parse(e.detail)); } catch (err) { resolve(null); }
      }
      document.addEventListener("rwgps-mapviewport", onView);
      document.dispatchEvent(new CustomEvent("rwgps-mapviewport-get"));
      setTimeout(function () {
        document.removeEventListener("rwgps-mapviewport", onView);
        resolve(null);
      }, 1000);
    });
  }

  var moveendAttached = false;
  function ensureMoveendListener() {
    if (moveendAttached) return;
    moveendAttached = true;
    document.addEventListener("rwgps-mapviewport", function (e) {
      if (!R.publicLandsActive) return;
      try {
        var bbox = JSON.parse(e.detail);
        refresh(bbox);
      } catch (err) {}
    });
    document.dispatchEvent(new CustomEvent("rwgps-mapviewport-watch"));
  }

  function ensureLegend() {
    if (document.querySelector(".rwgps-publiclands-legend")) return;
    var legend = document.createElement("div");
    legend.className = "rwgps-publiclands-legend";

    var title = document.createElement("div");
    title.className = "rwgps-publiclands-legend-title";
    title.textContent = "Public Lands";
    legend.appendChild(title);

    for (var i = 0; i < LEGEND_ROWS.length; i++) {
      var row = document.createElement("div");
      row.className = "rwgps-publiclands-legend-row";
      var swatch = document.createElement("span");
      swatch.className = "rwgps-publiclands-legend-swatch";
      swatch.style.backgroundColor = LEGEND_ROWS[i].color;
      var label = document.createElement("span");
      label.textContent = LEGEND_ROWS[i].label;
      row.appendChild(swatch);
      row.appendChild(label);
      legend.appendChild(row);
    }

    // RWGPS Cycle legend lives inside the maplibre bottom-right control
    // stack. Prepending puts ours visually above the existing legend.
    var anchor = document.querySelector(".maplibregl-ctrl-bottom-right");
    if (anchor) {
      anchor.insertBefore(legend, anchor.firstChild);
    } else {
      var mapEl = document.querySelector(".maplibregl-map");
      if (mapEl && mapEl.parentElement) {
        legend.classList.add("rwgps-publiclands-legend-floating");
        mapEl.parentElement.appendChild(legend);
      } else {
        document.body.appendChild(legend);
      }
    }
  }

  function removeLegend() {
    var existing = document.querySelector(".rwgps-publiclands-legend");
    if (existing) existing.remove();
  }

  R.enablePublicLands = async function () {
    R.publicLandsActive = true;
    ensureMoveendListener();
    ensureLegend();
    var view = await getCurrentViewport();
    if (!view || !R.publicLandsActive) return;
    refresh(view);
  };

  R.disablePublicLands = function () {
    R.publicLandsActive = false;
    publicLandsState.lastFetchBbox = null;
    removeLegend();
    document.dispatchEvent(new CustomEvent("rwgps-publiclands-reset"));
  };

  R.togglePublicLands = function () {
    if (R.publicLandsActive) R.disablePublicLands();
    else R.enablePublicLands();
  };

})(window.RE);
