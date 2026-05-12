(function (R) {
  "use strict";

  // ─── Wildfire Detection Overlay ────────────────────────────────────────
  // Renders active wildfires from NIFC's WFIGS public ArcGIS REST feeds:
  //   - WFIGS_Interagency_Perimeters → polygon footprints, filtered to
  //     fires not yet declared out and mapped within the last 60 days.
  //     The richer service ("_Current" only carries 97 records vs 7,800+
  //     in the broader Perimeters service).
  //   - WFIGS_Incident_Locations_Current → point locations of every
  //     active incident (catches new / small fires that don't yet have
  //     a mapped perimeter).
  // Both endpoints are CORS-enabled, US-centric, no key required.

  var PERIM_URL = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query";
  var POINTS_URL = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query";

  var PERIM_WHERE = "attr_FireOutDateTime IS NULL AND poly_DateCurrent >= CURRENT_TIMESTAMP - INTERVAL '60' DAY";
  // Exclude prescribed burns (RX) — they're intentional controlled fires
  // and aren't a wildfire-safety concern for cyclists.
  var POINTS_WHERE = "IncidentTypeCategory = 'WF'";

  var wildfireState = {
    cache: {},      // bboxKey -> { perimeters, points }
    lastFetchBbox: null,
    pending: false
  };

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

  function arcgisBboxQuery(base, b, outFields, where) {
    return base
      + "?f=geojson"
      + "&where=" + encodeURIComponent(where || "1=1")
      + "&geometry=" + encodeURIComponent(b.west + "," + b.south + "," + b.east + "," + b.north)
      + "&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326"
      + "&spatialRel=esriSpatialRelIntersects"
      + "&outFields=" + encodeURIComponent(outFields);
  }

  async function fetchJsonSafe(url) {
    try {
      var resp = await fetch(url);
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) { return null; }
  }

  async function fetchPerimeters(b) {
    var url = arcgisBboxQuery(PERIM_URL, b, "poly_IncidentName,poly_GISAcres,attr_IncidentSize,poly_DateCurrent", PERIM_WHERE);
    var json = await fetchJsonSafe(url);
    return json || { type: "FeatureCollection", features: [] };
  }

  async function fetchPoints(b) {
    var url = arcgisBboxQuery(POINTS_URL, b, "IncidentName,IncidentSize,FireCause,IncidentTypeCategory,FireDiscoveryDateTime", POINTS_WHERE);
    var json = await fetchJsonSafe(url);
    return json || { type: "FeatureCollection", features: [] };
  }

  // Convert each incident point with a known size into a circular polygon
  // representing the reported acreage as if the fire were a circle. NIFC
  // only maps real perimeters once a crew has surveyed the fire, so this
  // gives a ballpark "area affected" for the rest. The resulting polygons
  // are rendered with a dashed outline downstream so users can tell them
  // apart from authoritative perimeters.
  var SQM_PER_ACRE = 4046.8564224;
  var EARTH_RADIUS_M = 6371000;
  var CIRCLE_VERTICES = 48;

  function acresToRadiusMeters(acres) {
    return Math.sqrt(acres * SQM_PER_ACRE / Math.PI);
  }

  function circlePolygonGeoJson(lng, lat, radiusMeters) {
    var coords = [];
    var latRad = lat * Math.PI / 180;
    var dLatPerM = (180 / Math.PI) / EARTH_RADIUS_M;
    var dLngPerM = (180 / Math.PI) / (EARTH_RADIUS_M * Math.cos(latRad));
    for (var i = 0; i <= CIRCLE_VERTICES; i++) {
      var theta = (i / CIRCLE_VERTICES) * 2 * Math.PI;
      var dx = radiusMeters * Math.cos(theta);
      var dy = radiusMeters * Math.sin(theta);
      coords.push([lng + dx * dLngPerM, lat + dy * dLatPerM]);
    }
    return { type: "Polygon", coordinates: [coords] };
  }

  function pointsToBufferedAreas(pointsFc) {
    if (!pointsFc || !pointsFc.features) return { type: "FeatureCollection", features: [] };
    var out = [];
    for (var i = 0; i < pointsFc.features.length; i++) {
      var f = pointsFc.features[i];
      if (!f.geometry || f.geometry.type !== "Point") continue;
      var props = f.properties || {};
      var acres = Number(props.IncidentSize);
      if (!acres || acres <= 0) continue;
      var coords = f.geometry.coordinates;
      var radius = acresToRadiusMeters(acres);
      out.push({
        type: "Feature",
        properties: Object.assign({}, props, { _estimated: true }),
        geometry: circlePolygonGeoJson(coords[0], coords[1], radius)
      });
    }
    return { type: "FeatureCollection", features: out };
  }

  async function fetchForBbox(b) {
    var key = bboxKey(b);
    if (wildfireState.cache[key]) return wildfireState.cache[key];
    var results = await Promise.all([fetchPerimeters(b), fetchPoints(b)]);
    var allPoints = results[1];
    var data = {
      perimeters: results[0],
      points: allPoints,                              // dot marker for every incident
      pointBuffers: pointsToBufferedAreas(allPoints)  // polygon for every incident with size
    };
    wildfireState.cache[key] = data;
    return data;
  }

  async function refresh(bbox) {
    if (!R.wildfireActive) return;
    if (wildfireState.pending) return;
    if (wildfireState.lastFetchBbox && bboxContains(wildfireState.lastFetchBbox, bbox)) return;
    wildfireState.pending = true;
    try {
      var fetchBbox = expandBbox(bbox, 0.5);
      var data = await fetchForBbox(fetchBbox);
      if (!R.wildfireActive) return;
      wildfireState.lastFetchBbox = fetchBbox;
      document.dispatchEvent(new CustomEvent("rwgps-wildfire-apply", {
        detail: JSON.stringify(data)
      }));
    } finally {
      wildfireState.pending = false;
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
      if (!R.wildfireActive) return;
      try {
        var bbox = JSON.parse(e.detail);
        refresh(bbox);
      } catch (err) {}
    });
    document.dispatchEvent(new CustomEvent("rwgps-mapviewport-watch"));
  }

  R.enableWildfire = async function () {
    R.wildfireActive = true;
    ensureMoveendListener();
    var view = await getCurrentViewport();
    if (!view || !R.wildfireActive) return;
    refresh(view);
  };

  R.disableWildfire = function () {
    R.wildfireActive = false;
    wildfireState.lastFetchBbox = null;
    document.dispatchEvent(new CustomEvent("rwgps-wildfire-reset"));
  };

  R.toggleWildfire = function () {
    if (R.wildfireActive) R.disableWildfire();
    else R.enableWildfire();
  };

})(window.RE);
