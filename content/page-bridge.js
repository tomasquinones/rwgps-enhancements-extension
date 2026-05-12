(function () {
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
  var gradeColorFeatures = null;
  var layerWatchdogId = null;
  var heatmapSettings = null; // { global: { hueRotate, saturation, brightnessMin, brightnessMax, opacity }, rides: ..., routes: ... }
  var hillshadeSettings = null; // { exaggeration, shadowColor, highlightColor, accentColor, illumDirection }
  var originalHillshadeProps = null; // cached original paint values
  var windTimeOverride = null;
  var windOriginalTiles = {}; // keyed by sourceId
  var quickLapsLineCoords = null;
  var quickLapsIsDrawing = false;
  var quickLapsStartPoint = null;
  var quickLapsMapClickHandler = null;
  var quickLapsMapMoveHandler = null;
  var quickLapsMarkerPoints = null;
  var quickLapsMarkerEls = [];
  var quickLapsMarkerMoveHandler = null;

  function dispatchQuickLapsEvent(name, payload) {
    document.dispatchEvent(new CustomEvent(name, {
      detail: JSON.stringify(payload || {})
    }));
  }

  function createQuickLapsMarker(color) {
    var el = document.createElement("div");
    el.className = "rwgps-quick-laps-marker";
    el.style.cssText = "position:absolute;z-index:6;pointer-events:none;" +
      "width:10px;height:10px;border-radius:50%;background:" + color + ";" +
      "border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,0.35);transform:translate(-7px,-7px);";
    return el;
  }

  function removeQuickLapsMarkers(map) {
    for (var i = 0; i < quickLapsMarkerEls.length; i++) {
      quickLapsMarkerEls[i].remove();
    }
    quickLapsMarkerEls = [];
    quickLapsMarkerPoints = null;
    if (quickLapsMarkerMoveHandler && map) {
      map.off("move", quickLapsMarkerMoveHandler);
      quickLapsMarkerMoveHandler = null;
    }
  }

  function positionQuickLapsMarkers(map) {
    if (!quickLapsMarkerPoints || quickLapsMarkerEls.length === 0) return;
    for (var i = 0; i < quickLapsMarkerPoints.length; i++) {
      var point = quickLapsMarkerPoints[i];
      var el = quickLapsMarkerEls[i];
      if (!point || !el) continue;
      var px = map.project(point);
      el.style.left = px.x + "px";
      el.style.top = px.y + "px";
    }
  }

  function setQuickLapsMarkers(map, pt0, pt1) {
    var mapContainer = document.querySelector(".maplibregl-map");
    removeQuickLapsMarkers(map);
    if (!map || !mapContainer || !pt0) return;

    quickLapsMarkerPoints = [pt0];
    if (pt1) quickLapsMarkerPoints.push(pt1);

    for (var i = 0; i < quickLapsMarkerPoints.length; i++) {
      var color = i === 0 ? "#ff8f00" : "#ff6f00";
      var marker = createQuickLapsMarker(color);
      mapContainer.appendChild(marker);
      quickLapsMarkerEls.push(marker);
    }

    positionQuickLapsMarkers(map);
    if (!quickLapsMarkerMoveHandler) {
      quickLapsMarkerMoveHandler = function () {
        positionQuickLapsMarkers(map);
      };
      map.on("move", quickLapsMarkerMoveHandler);
    }
  }

  function setQuickLapsCursor(map, enabled) {
    if (!map) return;
    try {
      var canvas = map.getCanvas && map.getCanvas();
      if (!canvas) return;
      canvas.style.cursor = enabled ? "crosshair" : "";
    } catch (e) {}
  }

  function ensureQuickLapsSourceAndLayers(map) {
    if (!map) return;
    var sourceId = "rwgps-quick-laps-line";
    var casingId = "rwgps-quick-laps-line-casing";
    var lineId = "rwgps-quick-laps-line";

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
    }
    if (!map.getLayer(casingId)) {
      map.addLayer({
        id: casingId,
        type: "line",
        source: sourceId,
        paint: { "line-color": "#ffffff", "line-width": 5, "line-opacity": 0.95 }
      });
    }
    if (!map.getLayer(lineId)) {
      map.addLayer({
        id: lineId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#ff6f00",
          "line-width": 3,
          "line-opacity": quickLapsIsDrawing ? 0.75 : 0.95,
          "line-dasharray": quickLapsIsDrawing ? [2, 1.5] : [1, 0]
        }
      });
    }
  }

  function updateQuickLapsLine(map, coords) {
    if (!map || !coords || coords.length < 2) return;
    ensureQuickLapsSourceAndLayers(map);
    var src = map.getSource("rwgps-quick-laps-line");
    if (!src || !src.setData) return;
    src.setData({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [[coords[0].lng, coords[0].lat], [coords[1].lng, coords[1].lat]]
        }
      }]
    });

    try {
      if (map.getLayer("rwgps-quick-laps-line")) {
        map.setPaintProperty("rwgps-quick-laps-line", "line-opacity", quickLapsIsDrawing ? 0.75 : 0.95);
        map.setPaintProperty("rwgps-quick-laps-line", "line-dasharray", quickLapsIsDrawing ? [2, 1.5] : [1, 0]);
      }
    } catch (e) {}
  }

  function removeQuickLapsLine(map) {
    if (!map) return;
    try {
      if (map.getLayer("rwgps-quick-laps-line")) map.removeLayer("rwgps-quick-laps-line");
      if (map.getLayer("rwgps-quick-laps-line-casing")) map.removeLayer("rwgps-quick-laps-line-casing");
      if (map.getSource("rwgps-quick-laps-line")) map.removeSource("rwgps-quick-laps-line");
    } catch (e) {}
  }

  function removeQuickLapsDrawingHandlers(map) {
    if (!map) return;
    if (quickLapsMapClickHandler) {
      map.off("click", quickLapsMapClickHandler);
      quickLapsMapClickHandler = null;
    }
    if (quickLapsMapMoveHandler) {
      map.off("mousemove", quickLapsMapMoveHandler);
      quickLapsMapMoveHandler = null;
    }
  }

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

  function addGradeColorLayers(map, features) {
    try {
      if (map.getLayer("rwgps-grade-line")) map.removeLayer("rwgps-grade-line");
      if (map.getLayer("rwgps-grade-line-casing")) map.removeLayer("rwgps-grade-line-casing");
      if (map.getSource("rwgps-grade-colors")) map.removeSource("rwgps-grade-colors");
    } catch (e) {}

    map.addSource("rwgps-grade-colors", {
      type: "geojson",
      data: { type: "FeatureCollection", features: features }
    });

    map.addLayer({
      id: "rwgps-grade-line-casing",
      type: "line",
      source: "rwgps-grade-colors",
      paint: { "line-color": "#000000", "line-width": 6, "line-opacity": 0.3 }
    });

    map.addLayer({
      id: "rwgps-grade-line",
      type: "line",
      source: "rwgps-grade-colors",
      paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.9 }
    });
  }

  function startLayerWatchdog() {
    if (layerWatchdogId) return;
    layerWatchdogId = setInterval(function () {
      var map = getMap();
      if (!map) return;
      if (!speedColorFeatures && !gradeColorFeatures && !antFeatures && !climbFeatures && !descentFeatures && !segmentFeatures && !quickLapsLineCoords && !heatmapSettings && !windTimeOverride) {
        clearInterval(layerWatchdogId);
        layerWatchdogId = null;
        return;
      }
      try {
        if (speedColorFeatures && !map.getSource("rwgps-speed-colors")) {
          addSpeedColorLayers(map, speedColorFeatures);
          document.documentElement.setAttribute("data-speed-colors-status", "active");
        }
        if (gradeColorFeatures && !map.getSource("rwgps-grade-colors")) {
          addGradeColorLayers(map, gradeColorFeatures);
          document.documentElement.setAttribute("data-grade-colors-status", "active");
        }
        if (antFeatures && !map.getSource("rwgps-travel-direction")) {
          addAntLayers(map, antFeatures);
        }
        if (climbFeatures && !map.getSource("rwgps-climbs")) {
          addHillLayers(map, climbFeatures, "rwgps-climbs");
        }
        if (descentFeatures && !map.getSource("rwgps-descents")) {
          addHillLayers(map, descentFeatures, "rwgps-descents");
        }
        if (segmentFeatures && !map.getSource("rwgps-segments")) {
          addSegmentLayers(map, segmentFeatures);
        }
        if (quickLapsLineCoords && !map.getSource("rwgps-quick-laps-line")) {
          updateQuickLapsLine(map, quickLapsLineCoords);
          if (quickLapsStartPoint) {
            setQuickLapsMarkers(map, quickLapsLineCoords[0], quickLapsLineCoords[1]);
          }
        }
        if (heatmapSettings) {
          applyHeatmapSettings(map, heatmapSettings);
        }
        if (windTimeOverride) {
          applyWindTimeOverride(map, windTimeOverride);
        }
        var allLayers = [
          "rwgps-segments-line-casing", "rwgps-segments-line",
          "rwgps-quick-laps-line-casing", "rwgps-quick-laps-line",
          "rwgps-climbs-line-casing", "rwgps-climbs-line",
          "rwgps-descents-line-casing", "rwgps-descents-line",
          "rwgps-speed-line-casing", "rwgps-speed-line",
          "rwgps-grade-line-casing", "rwgps-grade-line",
          "rwgps-travel-ants-0", "rwgps-travel-ants-1",
          "rwgps-travel-ants-2", "rwgps-travel-ants-3", "rwgps-travel-ants-4"
        ];
        for (var i = 0; i < allLayers.length; i++) {
          if (map.getLayer(allLayers[i])) map.moveLayer(allLayers[i]);
        }
      } catch (e) {}
    }, 500);
  }

  document.addEventListener("rwgps-speed-colors-add", function (e) {
    try {
      speedColorFeatures = JSON.parse(e.detail);
    } catch (err) {
      speedColorFeatures = null;
      document.documentElement.setAttribute("data-speed-colors-status", "error");
      return;
    }

    startLayerWatchdog();

    var map = getMap();
    if (!map) {
      document.documentElement.setAttribute("data-speed-colors-status", "pending-map");
      return;
    }

    try {
      addSpeedColorLayers(map, speedColorFeatures);
      document.documentElement.setAttribute("data-speed-colors-status", "active");
    } catch (err) {
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
    } catch (err) {}
    document.documentElement.setAttribute("data-speed-colors-status", "inactive");
  });

  document.addEventListener("rwgps-grade-colors-add", function (e) {
    try {
      gradeColorFeatures = JSON.parse(e.detail);
    } catch (err) {
      gradeColorFeatures = null;
      document.documentElement.setAttribute("data-grade-colors-status", "error");
      return;
    }

    startLayerWatchdog();

    var map = getMap();
    if (!map) {
      document.documentElement.setAttribute("data-grade-colors-status", "pending-map");
      return;
    }

    try {
      addGradeColorLayers(map, gradeColorFeatures);
      document.documentElement.setAttribute("data-grade-colors-status", "active");
    } catch (err) {
      document.documentElement.setAttribute("data-grade-colors-status", "error");
    }
  });

  document.addEventListener("rwgps-grade-colors-remove", function () {
    gradeColorFeatures = null;
    var map = getMap();
    if (!map) return;
    try {
      if (map.getLayer("rwgps-grade-line")) map.removeLayer("rwgps-grade-line");
      if (map.getLayer("rwgps-grade-line-casing")) map.removeLayer("rwgps-grade-line-casing");
      if (map.getSource("rwgps-grade-colors")) map.removeSource("rwgps-grade-colors");
    } catch (err) {}
    document.documentElement.setAttribute("data-grade-colors-status", "inactive");
  });

  // ─── Travel Direction (marching ants) ───────────────────────────────
  var antAnimationId = null;
  var antTierSteps = [0, 0, 0, 0, 0];
  var antFrameCount = 0;
  var antFeatures = null;

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

  var tierDivisors = [6, 4, 3, 2, 1];

  function addAntLayers(map, features) {
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
        } catch (e) {}
      }
    }
  }

  document.addEventListener("rwgps-travel-direction-add", function (e) {
    try {
      antFeatures = JSON.parse(e.detail);
    } catch (err) {
      antFeatures = null;
      console.error("[Travel Direction] Invalid payload:", err);
      return;
    }

    if (antAnimationId) { cancelAnimationFrame(antAnimationId); antAnimationId = null; }
    antTierSteps = [0, 0, 0, 0, 0];
    antFrameCount = 0;
    startLayerWatchdog();
    animateAnts();

    var map = getMap();
    if (!map) return;
    try {
      addAntLayers(map, antFeatures);
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
    } catch (err) {}
  });

  // ─── Climbs & Descents layers ──────────────────────────────────────
  var climbFeatures = null;
  var descentFeatures = null;
  var hillTrackVisibility = {
    "rwgps-climbs": true,
    "rwgps-descents": true
  };

  // ─── Hill DOM markers (triangles + squares) ────────────────────────
  var hillDomMarkers = {};   // prefix → [{el, lngLat}, ...]
  var hillMoveHandlers = {}; // prefix → handler fn

  function createHillTriangle(color) {
    var el = document.createElement("div");
    el.className = "rwgps-hill-marker rwgps-hill-start";
    el.style.cssText = "position:absolute;z-index:5;cursor:pointer;" +
      "width:0;height:0;border-top:8px solid transparent;border-bottom:8px solid transparent;" +
      "border-left:14px solid " + color + ";" +
      "filter:drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff);" +
      "transform:translate(-5px,-8px);";
    return el;
  }

  function createHillSquare(color) {
    var el = document.createElement("div");
    el.className = "rwgps-hill-marker rwgps-hill-end";
    el.style.cssText = "position:absolute;z-index:5;pointer-events:none;" +
      "width:12px;height:12px;background:" + color + ";" +
      "border:2px solid #fff;border-radius:1px;" +
      "box-shadow:0 0 2px rgba(0,0,0,0.4);" +
      "transform:translate(-8px,-8px);";
    return el;
  }

  function positionHillMarkers(map, prefix) {
    var markers = hillDomMarkers[prefix];
    if (!markers) return;
    for (var i = 0; i < markers.length; i++) {
      var m = markers[i];
      var pt = map.project(m.lngLat);
      m.el.style.left = pt.x + "px";
      m.el.style.top = pt.y + "px";
    }
  }

  // ─── Click sidebar climb/descent to trigger native RWGPS info bubble ──
  function findSidebarSection(label) {
    // Walk every element in the page looking for one whose direct text is exactly
    // "Climbs" or "Descents". RWGPS uses CSS Modules so we can't rely on class names.
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
    var node;
    while ((node = walker.nextNode())) {
      // Check direct child text nodes only (not nested element text)
      var directText = "";
      for (var c = 0; c < node.childNodes.length; c++) {
        if (node.childNodes[c].nodeType === 3) directText += node.childNodes[c].textContent;
      }
      if (directText.trim() === label) return node;
    }
    return null;
  }

  function findHillListItems(sectionEl) {
    // Walk up from the heading to find the nearest ancestor that contains <li> elements.
    // The heading and list items share a common container.
    var ancestor = sectionEl.parentElement;
    for (var depth = 0; depth < 5 && ancestor; depth++) {
      var items = ancestor.querySelectorAll("li");
      if (items.length > 0) return items;
      ancestor = ancestor.parentElement;
    }
    return [];
  }

  function clickSidebarHillEntry(hillIndex, prefix) {
    var sectionLabel = prefix === "rwgps-climbs" ? "Climbs" : "Descents";
    var sectionEl = findSidebarSection(sectionLabel);
    if (!sectionEl) {
      console.warn("[RWGPS Ext] Could not find sidebar section:", sectionLabel);
      return;
    }

    var items = findHillListItems(sectionEl);

    // If not enough items visible, try expanding via "Show All" link
    if (hillIndex >= items.length) {
      var ancestor = sectionEl.parentElement;
      for (var d = 0; d < 5 && ancestor; d++) {
        var links = ancestor.querySelectorAll("a");
        for (var k = 0; k < links.length; k++) {
          var linkText = links[k].textContent;
          if (linkText.indexOf("Show All") !== -1 && linkText.indexOf(sectionLabel) !== -1) {
            links[k].click();
            break;
          }
        }
        ancestor = ancestor.parentElement;
      }
      items = findHillListItems(sectionEl);
    }

    if (hillIndex < items.length) {
      items[hillIndex].click();
    } else {
      console.warn("[RWGPS Ext] Hill index", hillIndex, "out of range, found", items.length, "items in", sectionLabel);
    }
  }

  function setHillTrackVisibility(map, prefix, visible) {
    hillTrackVisibility[prefix] = !!visible;
    var layerVisibility = visible ? "visible" : "none";
    try {
      var lineId = prefix + "-line";
      var casingId = prefix + "-line-casing";
      if (map && map.getLayer(casingId)) map.setLayoutProperty(casingId, "visibility", layerVisibility);
      if (map && map.getLayer(lineId)) map.setLayoutProperty(lineId, "visibility", layerVisibility);
    } catch (e) {}

    var markers = hillDomMarkers[prefix];
    if (!markers) return;
    var display = visible ? "" : "none";
    for (var i = 0; i < markers.length; i++) {
      markers[i].el.style.display = display;
    }
  }

  function addHillLayers(map, features, prefix) {
    removeHillLayers(map, prefix);

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

    // DOM-based markers for start (triangle) and end (square)
    var mapContainer = document.querySelector(".maplibregl-map");
    if (!mapContainer) return;

    var markers = [];
    var pointFeatures = features.filter(function (f) { return f.geometry.type === "Point"; });
    for (var i = 0; i < pointFeatures.length; i++) {
      var feat = pointFeatures[i];
      var props = feat.properties;
      var lngLat = { lng: feat.geometry.coordinates[0], lat: feat.geometry.coordinates[1] };
      var el = props.markerType === "start"
        ? createHillTriangle(props.markerColor)
        : createHillSquare(props.markerColor);

      // Click start marker → click the corresponding sidebar entry to trigger native info bubble
      if (props.markerType === "start" && props.hillIndex != null) {
        (function (hillIdx) {
          el.addEventListener("click", function (e) {
            e.stopPropagation();
            clickSidebarHillEntry(hillIdx, prefix);
          });
        })(props.hillIndex);
      }

      mapContainer.appendChild(el);
      markers.push({ el: el, lngLat: lngLat });
    }

    hillDomMarkers[prefix] = markers;
    positionHillMarkers(map, prefix);

    if (!hillMoveHandlers[prefix]) {
      hillMoveHandlers[prefix] = function () { positionHillMarkers(map, prefix); };
      map.on("move", hillMoveHandlers[prefix]);
    }

    setHillTrackVisibility(map, prefix, hillTrackVisibility[prefix] !== false);
  }

  function removeHillLayers(map, prefix) {
    // Remove DOM markers
    var markers = hillDomMarkers[prefix];
    if (markers) {
      for (var i = 0; i < markers.length; i++) markers[i].el.remove();
      hillDomMarkers[prefix] = null;
    }
    if (hillMoveHandlers[prefix] && map) {
      map.off("move", hillMoveHandlers[prefix]);
      hillMoveHandlers[prefix] = null;
    }
    // Remove map layers
    try {
      if (map && map.getLayer(prefix + "-line")) map.removeLayer(prefix + "-line");
      if (map && map.getLayer(prefix + "-line-casing")) map.removeLayer(prefix + "-line-casing");
      if (map && map.getSource(prefix)) map.removeSource(prefix);
    } catch (e) {}
  }

  document.addEventListener("rwgps-climbs-add", function (e) {
    console.log("[RWGPS Ext] page-bridge received rwgps-climbs-add, detail length:", (e.detail || "").length);
    try {
      climbFeatures = JSON.parse(e.detail);
    } catch (err) {
      climbFeatures = null;
      console.error("[Climbs] Invalid payload:", err);
      return;
    }
    console.log("[RWGPS Ext] page-bridge parsed %d climb features", climbFeatures.length);

    startLayerWatchdog();

    var map = getMap();
    if (!map) { console.warn("[RWGPS Ext] page-bridge climbs-add: no map found"); return; }
    try {
      addHillLayers(map, climbFeatures, "rwgps-climbs");
      console.log("[RWGPS Ext] page-bridge: climb layers added successfully");
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
    console.log("[RWGPS Ext] page-bridge received rwgps-descents-add, detail length:", (e.detail || "").length);
    try {
      descentFeatures = JSON.parse(e.detail);
    } catch (err) {
      descentFeatures = null;
      console.error("[Descents] Invalid payload:", err);
      return;
    }
    console.log("[RWGPS Ext] page-bridge parsed %d descent features", descentFeatures.length);

    startLayerWatchdog();

    var map = getMap();
    if (!map) { console.warn("[RWGPS Ext] page-bridge descents-add: no map found"); return; }
    try {
      addHillLayers(map, descentFeatures, "rwgps-descents");
      console.log("[RWGPS Ext] page-bridge: descent layers added successfully");
    } catch (err) {
      console.error("[Descents] Map error:", err);
    }
  });

  document.addEventListener("rwgps-descents-remove", function () {
    descentFeatures = null;
    var map = getMap();
    if (map) removeHillLayers(map, "rwgps-descents");
  });

  document.addEventListener("rwgps-hill-track-toggle", function (e) {
    try {
      var detail = JSON.parse(e.detail);
      var map = getMap();
      setHillTrackVisibility(map, detail.prefix, !!detail.visible);
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
    var existing = document.querySelectorAll("." + segmentDetailsLinkClass);
    for (var i = 0; i < existing.length; i++) existing[i].remove();
    var attempts = 0;
    var timer = setInterval(function () {
      attempts++;
      if (attempts > 20) { clearInterval(timer); return; }
      var zoomLink = document.querySelector('[class*="Popup"] [class*="zoomLink"]');
      if (!zoomLink) return;
      clearInterval(timer);
      if (zoomLink.parentElement.querySelector("." + segmentDetailsLinkClass)) return;
      var wrapper = document.createElement("div");
      wrapper.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
      zoomLink.parentNode.insertBefore(wrapper, zoomLink);
      wrapper.appendChild(zoomLink);
      var a = document.createElement("a");
      a.className = segmentDetailsLinkClass;
      a.href = "/segments/" + segId;
      a.textContent = "Segment Details";
      a.style.cssText = "color: #fa6400; text-decoration: none; font-size: 13px; padding: 0 10px 10px 0; cursor: pointer;";
      a.addEventListener("mouseenter", function () { a.style.textDecoration = "underline"; });
      a.addEventListener("mouseleave", function () { a.style.textDecoration = "none"; });
      wrapper.appendChild(a);
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

      el.dataset.segmentId = props.segmentId || "";
      el.dataset.label = props.label || "";
      el.dataset.markerColor = props.markerColor || "#333";
      el.dataset.markerType = props.markerType || "";

      if (props.markerType === "start") {
        (function (segId) {
          el.addEventListener("click", function (e) {
            e.stopPropagation();
            segmentMarkerClickTime = Date.now();
            var link = document.querySelector('a[href*="/segments/' + segId + '"]');
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

    positionSegmentMarkers(map);
    if (!segmentMoveHandler) {
      segmentMoveHandler = function () { positionSegmentMarkers(map); };
      map.on("move", segmentMoveHandler);
    }

    if (!segmentMapClickHandler) {
      segmentMapClickHandler = function (e) {
        if (Date.now() - segmentMarkerClickTime < 300) return;
        var closeBtn = document.querySelector('[class*="Popup"] [class*="close"]');
        if (closeBtn) closeBtn.click();
      };
      map.on("click", segmentMapClickHandler);
    }
  }

  function removeSegmentLayers(map) {
    var prefix = "rwgps-segments";
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
    try {
      if (map && map.getLayer(prefix + "-line")) map.removeLayer(prefix + "-line");
      if (map && map.getLayer(prefix + "-line-casing")) map.removeLayer(prefix + "-line-casing");
      if (map && map.getSource(prefix)) map.removeSource(prefix);
    } catch (e) {}
  }

  document.addEventListener("rwgps-segments-add", function (e) {
    try {
      segmentFeatures = JSON.parse(e.detail);
    } catch (err) {
      segmentFeatures = null;
      console.error("[Segments] Invalid payload:", err);
      return;
    }

    startLayerWatchdog();

    var map = getMap();
    if (!map) return;
    try {
      addSegmentLayers(map, segmentFeatures);
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

  // ─── Quick Laps drawing tool ───────────────────────────────────────
  function clearQuickLapsInternal() {
    var map = getMap();
    quickLapsIsDrawing = false;
    quickLapsStartPoint = null;
    quickLapsLineCoords = null;
    if (map) {
      setQuickLapsCursor(map, false);
      removeQuickLapsDrawingHandlers(map);
      removeQuickLapsLine(map);
      removeQuickLapsMarkers(map);
    }
    dispatchQuickLapsEvent("rwgps-quick-laps-line-cleared", {});
  }

  function beginQuickLapsDrawMode() {
    var map = getMap();
    if (!map) {
      dispatchQuickLapsEvent("rwgps-quick-laps-draw-stage", { stage: "map-missing" });
      return;
    }

    quickLapsIsDrawing = true;
    quickLapsStartPoint = null;
    quickLapsLineCoords = null;

    setQuickLapsCursor(map, true);
    removeQuickLapsDrawingHandlers(map);
    removeQuickLapsLine(map);
    removeQuickLapsMarkers(map);
    startLayerWatchdog();

    quickLapsMapClickHandler = function (ev) {
      if (!ev || !ev.lngLat) return;
      var point = { lng: ev.lngLat.lng, lat: ev.lngLat.lat };

      if (!quickLapsStartPoint) {
        quickLapsStartPoint = point;
        quickLapsLineCoords = [quickLapsStartPoint, quickLapsStartPoint];
        updateQuickLapsLine(map, quickLapsLineCoords);
        setQuickLapsMarkers(map, quickLapsStartPoint, null);
        dispatchQuickLapsEvent("rwgps-quick-laps-draw-stage", {
          stage: "start-set",
          pt0: quickLapsStartPoint
        });
        return;
      }

      quickLapsLineCoords = [quickLapsStartPoint, point];
      quickLapsIsDrawing = false;
      setQuickLapsCursor(map, false);
      removeQuickLapsDrawingHandlers(map);
      updateQuickLapsLine(map, quickLapsLineCoords);
      setQuickLapsMarkers(map, quickLapsLineCoords[0], quickLapsLineCoords[1]);
      dispatchQuickLapsEvent("rwgps-quick-laps-line-set", {
        pt0: quickLapsLineCoords[0],
        pt1: quickLapsLineCoords[1]
      });
    };

    quickLapsMapMoveHandler = function (ev) {
      if (!quickLapsIsDrawing || !quickLapsStartPoint || !ev || !ev.lngLat) return;
      quickLapsLineCoords = [
        quickLapsStartPoint,
        { lng: ev.lngLat.lng, lat: ev.lngLat.lat }
      ];
      updateQuickLapsLine(map, quickLapsLineCoords);
    };

    map.on("click", quickLapsMapClickHandler);
    map.on("mousemove", quickLapsMapMoveHandler);
  }

  document.addEventListener("rwgps-quick-laps-draw-start", function () {
    beginQuickLapsDrawMode();
  });

  document.addEventListener("rwgps-quick-laps-clear", function () {
    clearQuickLapsInternal();
  });

  // ─── Graph layout extraction from React fiber ─────────────────────
  function sampleGraphMarkerExists(el) {
    if (!el || !el.querySelector) return false;
    return !!el.querySelector(
      ".sample-graph-render-text, .sg-hover-x-label, .sg-hover-details, .sg-hover-vertical-line, .sg-hover-horizontal-line, .sg-segment-selector-control, .sg-elem"
    );
  }

  function isMapCanvas(el) {
    if (!el) return true;
    if (el.classList && el.classList.contains("maplibregl-canvas")) return true;
    if (el.closest && el.closest(".maplibregl-map, .gm-style, .leaflet-container")) return true;
    return false;
  }

  function listSampleGraphCanvases() {
    var seen = [];
    var out = [];
    function pushCanvas(c) {
      if (!c || !c.isConnected || isMapCanvas(c)) return;
      if (seen.indexOf(c) >= 0) return;
      seen.push(c);
      out.push(c);
    }

    var c1 = document.querySelectorAll("canvas.sample-graph");
    for (var i = 0; i < c1.length; i++) pushCanvas(c1[i]);

    var c2 = document.querySelectorAll('[class*="SampleGraph"] canvas, [class*="sampleGraph"] canvas');
    for (var j = 0; j < c2.length; j++) pushCanvas(c2[j]);

    var all = document.querySelectorAll("canvas");
    for (var k = 0; k < all.length; k++) {
      var c = all[k];
      var p = c.parentElement;
      var pp = p ? p.parentElement : null;
      var ppp = pp ? pp.parentElement : null;
      if (sampleGraphMarkerExists(p) || sampleGraphMarkerExists(pp) || sampleGraphMarkerExists(ppp)) {
        pushCanvas(c);
      }
    }

    return out;
  }

  document.addEventListener("rwgps-speed-colors-get-layout", function () {
    try {
      var canvases = listSampleGraphCanvases();
      for (var ci = 0; ci < canvases.length; ci++) {
        var el = canvases[ci];
        var fiberKey = Object.keys(el).find(function (k) {
          return k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$");
        });
        if (!fiberKey) continue;
        var canvasFiber = el[fiberKey];

        var container = canvasFiber.return;
        var maxUp = 10;
        while (container && maxUp-- > 0) {
          var result = searchSubtreeForLayout(container, 0);
          if (result) { publishLayout(result); return; }
          container = container.return;
        }
      }

      var sgContainers = document.querySelectorAll(
        '[class*="SampleGraph"], [class*="sampleGraph"], .sample-graph-render-text, .sg-elem, .sg-hover-details'
      );
      for (var si = 0; si < sgContainers.length; si++) {
        var sgEl = sgContainers[si];
        var sgKey = Object.keys(sgEl).find(function (k) {
          return k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$");
        });
        if (!sgKey) continue;
        var sgFiber = sgEl[sgKey];
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

  function searchSubtreeForLayout(fiber, depth) {
    if (!fiber || depth > 30) return null;

    var props = fiber.memoizedProps || {};
    if (props.value && typeof props.value === "object" &&
        props.value.xProjection && props.value.plotMargin) {
      return buildLayoutResult(props.value);
    }

    if (fiber.type && fiber.type._context) {
      var ctx = fiber.type._context;
      var cv = ctx._currentValue || ctx._currentValue2;
      if (cv && cv.xProjection && cv.plotMargin) {
        return buildLayoutResult(cv);
      }
    }

    var child = fiber.child;
    while (child) {
      var found = searchSubtreeForLayout(child, depth + 1);
      if (found) return found;
      child = child.sibling;
    }
    return null;
  }

  function buildLayoutResult(v) {
    function extractProj(proj) {
      if (!proj) return null;
      return { pixelOffset: proj.pixelOffset, v0: proj.v0, vScale: proj.vScale, invert: !!proj.invert };
    }
    var yProj = null;
    var hrProj = null;
    if (v.yProjections) {
      var eleP = v.yProjections.ele || v.yProjections[Object.keys(v.yProjections)[0]];
      yProj = extractProj(eleP);
      // Look for heart rate projection under common keys
      var hrP = v.yProjections.hr || v.yProjections.heartRate || v.yProjections.heart_rate || v.yProjections.bpm;
      hrProj = extractProj(hrP);
    }
    return {
      plotMargin: v.plotMargin,
      plotWidth: v.plotWidth,
      plotHeight: v.plotHeight,
      xProjection: v.xProjection ? {
        pixelOffset: v.xProjection.pixelOffset,
        v0: v.xProjection.v0,
        vScale: v.xProjection.vScale
      } : null,
      yProjection: yProj,
      hrProjection: hrProj
    };
  }

  function publishLayout(layout) {
    document.documentElement.setAttribute("data-speed-colors-layout", layout ? JSON.stringify(layout) : "");
  }

  document.addEventListener("rwgps-get-user-summary", function () {
    try {
      var us = window.rwgps && window.rwgps.summary && window.rwgps.summary.user_summary;
      document.documentElement.setAttribute("data-rwgps-user-summary", us ? JSON.stringify(us) : "");
    } catch (e) {
      document.documentElement.setAttribute("data-rwgps-user-summary", "");
    }
  });

  // ─── Heatmap Color & Opacity ────────────────────────────────────────

  function classifyHeatmapKind(text) {
    if (/personal[_-]?rides|trips/i.test(text)) return "rides";
    if (/personal[_-]?routes/i.test(text)) return "routes";
    if (/global/i.test(text)) return "global";
    return null;
  }

  function findHeatmapLayers(map) {
    var style;
    try { style = map.getStyle(); } catch (e) { return []; }
    if (!style || !style.layers || !style.sources) return [];
    var results = [];
    for (var i = 0; i < style.layers.length; i++) {
      var layer = style.layers[i];
      if (layer.type !== "raster") continue;
      var sourceId = layer.source;
      var source = style.sources[sourceId];
      if (!source) continue;

      // Gather all text we can use for classification: tiles, source URL, source ID, layer ID
      var parts = [];
      if (source.tiles && source.tiles.length) parts.push(source.tiles.join(" "));
      if (source.url) parts.push(source.url);
      // Also try the live source object for tiles resolved from TileJSON
      try {
        var liveSource = map.getSource(sourceId);
        if (liveSource && liveSource.tiles && liveSource.tiles.length) parts.push(liveSource.tiles.join(" "));
      } catch (e) {}
      parts.push(sourceId);
      parts.push(layer.id);
      var searchText = parts.join(" ");

      if (searchText.indexOf("heatmap") === -1 && searchText.indexOf("heat") === -1) continue;

      var kind = classifyHeatmapKind(searchText);
      if (!kind) kind = "global"; // fallback for unrecognized heatmap layers
      results.push({ layerId: layer.id, kind: kind });
    }
    return results;
  }

  function applyHeatmapSettings(map, settings) {
    var layers = findHeatmapLayers(map);
    for (var i = 0; i < layers.length; i++) {
      var lyr = layers[i];
      var s = settings[lyr.kind];
      if (!s) continue;
      try {
        map.setPaintProperty(lyr.layerId, "raster-hue-rotate", s.hueRotate || 0);
        map.setPaintProperty(lyr.layerId, "raster-saturation", s.saturation || 0);
        map.setPaintProperty(lyr.layerId, "raster-brightness-min", s.brightnessMin || 0);
        map.setPaintProperty(lyr.layerId, "raster-brightness-max", s.brightnessMax != null ? s.brightnessMax : 1);
        map.setPaintProperty(lyr.layerId, "raster-opacity", s.opacity != null ? s.opacity : 1);
      } catch (e) {}
    }
  }

  function resetHeatmapLayers(map) {
    var layers = findHeatmapLayers(map);
    for (var i = 0; i < layers.length; i++) {
      try {
        map.setPaintProperty(layers[i].layerId, "raster-hue-rotate", 0);
        map.setPaintProperty(layers[i].layerId, "raster-saturation", 0);
        map.setPaintProperty(layers[i].layerId, "raster-brightness-min", 0);
        map.setPaintProperty(layers[i].layerId, "raster-brightness-max", 1);
        map.setPaintProperty(layers[i].layerId, "raster-opacity", 1);
      } catch (e) {}
    }
  }

  document.addEventListener("rwgps-heatmap-colors-apply", function (e) {
    try {
      heatmapSettings = JSON.parse(e.detail);
    } catch (err) {
      return;
    }
    var map = getMap();
    if (map) {
      applyHeatmapSettings(map, heatmapSettings);
    }
    startLayerWatchdog();
  });

  document.addEventListener("rwgps-heatmap-colors-remove", function () {
    heatmapSettings = null;
    var map = getMap();
    if (map) {
      resetHeatmapLayers(map);
    }
  });

  // ─── Hill Shading Controls ────────────────────────────────────────────

  function findHillshadeLayers(map) {
    var style;
    try { style = map.getStyle(); } catch (e) { return []; }
    if (!style || !style.layers) return [];
    var results = [];
    for (var i = 0; i < style.layers.length; i++) {
      if (style.layers[i].type === "hillshade") {
        results.push(style.layers[i].id);
      }
    }
    return results;
  }

  function captureOriginalHillshadeProps(map, layerIds) {
    if (originalHillshadeProps) return;
    originalHillshadeProps = {};
    for (var i = 0; i < layerIds.length; i++) {
      var id = layerIds[i];
      try {
        originalHillshadeProps[id] = {
          exaggeration: map.getPaintProperty(id, "hillshade-exaggeration"),
          shadowColor: map.getPaintProperty(id, "hillshade-shadow-color"),
          highlightColor: map.getPaintProperty(id, "hillshade-highlight-color"),
          accentColor: map.getPaintProperty(id, "hillshade-accent-color"),
          illumDirection: map.getPaintProperty(id, "hillshade-illumination-direction")
        };
      } catch (e) {}
    }
  }

  function scaleExaggeration(original, multiplier) {
    if (typeof original === "number") {
      return Math.min(1, original * multiplier);
    }
    // Handle zoom-dependent stops — convert to MapLibre expression format
    // which persists correctly through zoom/pan re-renders.
    // Legacy { stops: [[z,v], ...] } → ["interpolate", ["linear"], ["zoom"], z1, v1, z2, v2, ...]
    if (original && original.stops) {
      var expr = ["interpolate", ["linear"], ["zoom"]];
      for (var i = 0; i < original.stops.length; i++) {
        expr.push(original.stops[i][0]);
        expr.push(Math.min(1, original.stops[i][1] * multiplier));
      }
      return expr;
    }
    // Already an expression array (e.g., from a previous setPaintProperty)
    if (Array.isArray(original) && original[0] === "interpolate") {
      // Expression format: ["interpolate", ["linear"], ["zoom"], z1, v1, z2, v2, ...]
      var scaled = original.slice(0, 3); // keep ["interpolate", ["linear"], ["zoom"]]
      for (var j = 3; j < original.length; j += 2) {
        scaled.push(original[j]); // zoom level
        scaled.push(Math.min(1, (original[j + 1] || 0) * multiplier)); // scaled value
      }
      return scaled;
    }
    // Fallback: flat value based on peak default
    return Math.min(1, 0.4 * multiplier);
  }

  function applyHillshadeSettings(map, settings) {
    var layerIds = findHillshadeLayers(map);
    if (layerIds.length === 0) return;
    captureOriginalHillshadeProps(map, layerIds);

    for (var i = 0; i < layerIds.length; i++) {
      var id = layerIds[i];
      var orig = originalHillshadeProps[id];
      if (!orig) continue;
      try {
        // Exaggeration multiplier
        var scaledExag = scaleExaggeration(orig.exaggeration, settings.exaggeration);
        map.setPaintProperty(id, "hillshade-exaggeration", scaledExag);

        // Colors — only override if user has set a value
        if (settings.shadowColor) {
          map.setPaintProperty(id, "hillshade-shadow-color", settings.shadowColor);
        }
        if (settings.highlightColor) {
          map.setPaintProperty(id, "hillshade-highlight-color", settings.highlightColor);
        }
        if (settings.accentColor) {
          map.setPaintProperty(id, "hillshade-accent-color", settings.accentColor);
        }
        if (settings.illumDirection != null) {
          map.setPaintProperty(id, "hillshade-illumination-direction", settings.illumDirection);
        }
      } catch (e) {}
    }
  }

  function resetHillshadeLayers(map) {
    detachHillshadeStyleListener(map);
    var layerIds = findHillshadeLayers(map);
    if (originalHillshadeProps) {
      for (var i = 0; i < layerIds.length; i++) {
        var id = layerIds[i];
        var orig = originalHillshadeProps[id];
        if (!orig) continue;
        try {
          map.setPaintProperty(id, "hillshade-exaggeration", orig.exaggeration);
          map.setPaintProperty(id, "hillshade-shadow-color", orig.shadowColor);
          map.setPaintProperty(id, "hillshade-highlight-color", orig.highlightColor);
          map.setPaintProperty(id, "hillshade-accent-color", orig.accentColor);
          map.setPaintProperty(id, "hillshade-illumination-direction", orig.illumDirection);
        } catch (e) {}
      }
    }
    originalHillshadeProps = null;
  }

  var hillshadeStyleListener = null;
  var hillshadeApplyPending = false;

  function attachHillshadeStyleListener(map) {
    if (hillshadeStyleListener) return;
    hillshadeStyleListener = function (e) {
      if (!hillshadeSettings) return;
      // RWGPS calls map.setStyle() on every source/layer change (polyline
      // re-render, overlay toggle, etc.). This replaces the entire style and
      // wipes our setPaintProperty overrides. Re-apply on every style data
      // event, but debounce via requestAnimationFrame so we only run once
      // per render frame and after MapLibre has finished applying the new style.
      if (e.dataType === "style" && !hillshadeApplyPending) {
        hillshadeApplyPending = true;
        requestAnimationFrame(function () {
          hillshadeApplyPending = false;
          if (!hillshadeSettings) return;
          applyHillshadeSettings(map, hillshadeSettings);
        });
      }
    };
    map.on("data", hillshadeStyleListener);
  }

  function detachHillshadeStyleListener(map) {
    if (hillshadeStyleListener && map) {
      try { map.off("data", hillshadeStyleListener); } catch (e) {}
    }
    hillshadeStyleListener = null;
    hillshadeApplyPending = false;
  }

  document.addEventListener("rwgps-hillshade-apply", function (e) {
    try {
      hillshadeSettings = JSON.parse(e.detail);
    } catch (err) {
      return;
    }
    var map = getMap();
    if (map) {
      applyHillshadeSettings(map, hillshadeSettings);
      attachHillshadeStyleListener(map);
    }
  });

  document.addEventListener("rwgps-hillshade-reset", function () {
    hillshadeSettings = null;
    var map = getMap();
    if (map) {
      resetHillshadeLayers(map);
    }
  });

  document.addEventListener("rwgps-hillshade-check", function () {
    var map = getMap();
    var has = false;
    if (map) {
      has = findHillshadeLayers(map).length > 0;
    }
    document.dispatchEvent(new CustomEvent("rwgps-hillshade-status", {
      detail: JSON.stringify({ hasHillshade: has })
    }));
  });

  // ─── Wind Layer Time Override ─────────────────────────────────────────

  function findWindLayers(map) {
    var style;
    try { style = map.getStyle(); } catch (e) { return []; }
    if (!style || !style.layers || !style.sources) return [];
    var results = [];
    for (var i = 0; i < style.layers.length; i++) {
      var layer = style.layers[i];
      if (layer.type !== "raster") continue;
      var sourceId = layer.source;
      var source = style.sources[sourceId];
      if (!source) continue;
      var parts = [];
      if (source.tiles && source.tiles.length) parts.push(source.tiles.join(" "));
      if (source.url) parts.push(source.url);
      try {
        var liveSource = map.getSource(sourceId);
        if (liveSource && liveSource.tiles && liveSource.tiles.length)
          parts.push(liveSource.tiles.join(" "));
      } catch (e) {}
      parts.push(sourceId);
      parts.push(layer.id);
      var searchText = parts.join(" ").toLowerCase();
      if (searchText.indexOf("wind") !== -1) {
        results.push({ layerId: layer.id, sourceId: sourceId });
      }
    }
    return results;
  }

  function applyWindTimeOverride(map, detail) {
    var windLayers = findWindLayers(map);
    for (var i = 0; i < windLayers.length; i++) {
      var wl = windLayers[i];
      try {
        var liveSource = map.getSource(wl.sourceId);
        if (!liveSource) continue;
        // Save original tiles for restoration
        if (!windOriginalTiles[wl.sourceId] && liveSource.tiles) {
          windOriginalTiles[wl.sourceId] = liveSource.tiles.slice();
        }
        if (!liveSource.tiles) continue;
        var origTiles = windOriginalTiles[wl.sourceId] || liveSource.tiles;
        var newTiles = origTiles.map(function (url) {
          // Try common time parameter patterns used by weather tile services
          var replaced = url.replace(/([&?])(time|datetime|dt|t|date)=[^&]*/i, function (match, sep, key) {
            return sep + key + "=" + detail.timestamp;
          });
          if (replaced !== url) return replaced;
          // If no time param found, try appending one
          var sep = url.indexOf("?") === -1 ? "?" : "&";
          return url + sep + "time=" + detail.timestamp;
        });
        liveSource.setTiles(newTiles);
      } catch (e) {}
    }
  }

  function resetWindLayers(map) {
    var windLayers = findWindLayers(map);
    for (var i = 0; i < windLayers.length; i++) {
      var wl = windLayers[i];
      if (windOriginalTiles[wl.sourceId]) {
        try {
          var liveSource = map.getSource(wl.sourceId);
          if (liveSource) liveSource.setTiles(windOriginalTiles[wl.sourceId]);
        } catch (e) {}
      }
    }
    windOriginalTiles = {};
  }

  document.addEventListener("rwgps-weather-wind-apply", function (e) {
    try {
      windTimeOverride = JSON.parse(e.detail);
    } catch (err) { return; }
    var map = getMap();
    if (map) applyWindTimeOverride(map, windTimeOverride);
    startLayerWatchdog();
  });

  document.addEventListener("rwgps-weather-wind-remove", function () {
    windTimeOverride = null;
    var map = getMap();
    if (map) resetWindLayers(map);
  });

  // ─── Planner Route Source Watcher ──────────────────────────────────────

  var plannerWatchActive = false;
  var plannerDebounceTimer = null;
  var plannerLastCoordHash = "";
  var plannerCachedSourceId = null;
  var PLANNER_DEBOUNCE_MS = 1500;

  function extractLineCoords(data) {
    if (!data) return null;
    if (data.type === "FeatureCollection") {
      var longest = null;
      for (var i = 0; i < (data.features || []).length; i++) {
        var c = extractLineCoords(data.features[i]);
        if (c && (!longest || c.length > longest.length)) longest = c;
      }
      return longest;
    }
    if (data.type === "Feature") return extractLineCoords(data.geometry);
    if (data.type === "LineString") return data.coordinates;
    if (data.type === "MultiLineString") {
      var best = [];
      for (var j = 0; j < (data.coordinates || []).length; j++) {
        if (data.coordinates[j].length > best.length) best = data.coordinates[j];
      }
      return best.length > 0 ? best : null;
    }
    return null;
  }

  // Pull the LineString coordinates from a geojson source. We try
  // pre-tiling data accessors first (so we get the full route, not
  // tile-clipped segments). If those don't expose data on the main
  // thread, we fall back to querySourceFeatures and stitch the
  // segments back together via shared endpoints.
  function coordsFromSource(map, id) {
    var src;
    try { src = map.getSource(id); } catch (e) { return null; }
    if (!src) return null;

    // 1. Pre-tiling: try _data, _options.data, serialize().data.
    var datas = [];
    if (src._data) datas.push(src._data);
    if (src._options && src._options.data) datas.push(src._options.data);
    try {
      var spec = src.serialize && src.serialize();
      if (spec && spec.data) datas.push(spec.data);
    } catch (e) {}

    for (var di = 0; di < datas.length; di++) {
      var d = datas[di];
      if (typeof d === "string") continue; // a URL — no good
      var c = extractLineCoords(d);
      if (c && c.length > 1) return c;
    }

    // 2. Fallback: post-tiling query, then stitch segments.
    var feats;
    try { feats = map.querySourceFeatures(id); } catch (e) { return null; }
    if (!feats || feats.length === 0) return null;

    var segments = [];
    for (var i = 0; i < feats.length; i++) {
      var g = feats[i].geometry;
      if (!g) continue;
      if (g.type === "LineString" && g.coordinates && g.coordinates.length > 1) {
        segments.push(g.coordinates);
      } else if (g.type === "MultiLineString" && g.coordinates) {
        for (var j = 0; j < g.coordinates.length; j++) {
          if (g.coordinates[j] && g.coordinates[j].length > 1) segments.push(g.coordinates[j]);
        }
      }
    }
    if (segments.length === 0) return null;
    if (segments.length === 1) return segments[0];
    return stitchSegments(segments);
  }

  // Greedy chain-stitching: pick a segment, then repeatedly extend
  // either end with whichever remaining segment shares its endpoint.
  // Tile-clipped geojson typically duplicates the boundary point, so
  // shared endpoints align exactly. Approximate but recovers the full
  // route length for ET purposes.
  function stitchSegments(segments) {
    function eq(a, b) {
      return a && b && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
    }
    var remaining = segments.slice();
    var chain = remaining.shift().slice();
    var changed = true;
    while (changed && remaining.length > 0) {
      changed = false;
      for (var i = 0; i < remaining.length; i++) {
        var seg = remaining[i];
        var first = seg[0], last = seg[seg.length - 1];
        var chainFirst = chain[0], chainLast = chain[chain.length - 1];
        if (eq(chainLast, first)) {
          for (var k = 1; k < seg.length; k++) chain.push(seg[k]);
          remaining.splice(i, 1); changed = true; break;
        }
        if (eq(chainLast, last)) {
          for (var k2 = seg.length - 2; k2 >= 0; k2--) chain.push(seg[k2]);
          remaining.splice(i, 1); changed = true; break;
        }
        if (eq(chainFirst, last)) {
          for (var k3 = seg.length - 2; k3 >= 0; k3--) chain.unshift(seg[k3]);
          remaining.splice(i, 1); changed = true; break;
        }
        if (eq(chainFirst, first)) {
          for (var k4 = 1; k4 < seg.length; k4++) chain.unshift(seg[k4]);
          remaining.splice(i, 1); changed = true; break;
        }
      }
    }
    return chain;
  }

  function findRouteLineSource(map) {
    var style;
    try { style = map.getStyle(); } catch (e) { return null; }
    if (!style || !style.sources) return null;

    if (plannerCachedSourceId) {
      var cc = coordsFromSource(map, plannerCachedSourceId);
      if (cc && cc.length > 1) return plannerCachedSourceId;
      plannerCachedSourceId = null;
    }

    var bestId = null;
    var bestLen = 0;
    var keys = Object.keys(style.sources);
    for (var i = 0; i < keys.length; i++) {
      var id = keys[i];
      if (id.indexOf("rwgps-") === 0) continue;
      if (style.sources[id].type !== "geojson") continue;
      var coords = coordsFromSource(map, id);
      if (coords && coords.length > bestLen) {
        bestLen = coords.length;
        bestId = id;
      }
    }
    plannerCachedSourceId = bestId;
    return bestId;
  }

  function coordsToHash(coords) {
    if (!coords || coords.length === 0) return "";
    var indices = [0, Math.floor(coords.length / 4), Math.floor(coords.length / 2),
                   Math.floor(coords.length * 3 / 4), coords.length - 1];
    var parts = [];
    for (var i = 0; i < indices.length; i++) {
      var c = coords[indices[i]];
      if (c) parts.push(c[0].toFixed(5) + "," + c[1].toFixed(5));
    }
    return coords.length + ":" + parts.join("|");
  }

  function extractAndPublishRouteData(map) {
    var sourceId = findRouteLineSource(map);
    if (!sourceId) return;

    var coords = coordsFromSource(map, sourceId);
    if (!coords || coords.length < 2) return;

    var hash = coordsToHash(coords);
    if (hash === plannerLastCoordHash) return;
    plannerLastCoordHash = hash;

    var trackPoints = [];
    for (var i = 0; i < coords.length; i++) {
      trackPoints.push({
        lng: coords[i][0],
        lat: coords[i][1],
        ele: coords[i].length > 2 ? coords[i][2] : 0
      });
    }

    document.dispatchEvent(new CustomEvent("rwgps-planner-route-update", {
      detail: JSON.stringify(trackPoints)
    }));
  }

  function startPlannerWatch(map) {
    if (plannerWatchActive) return;
    plannerWatchActive = true;

    // One-shot probe at attach time so we don't have to wait for the
    // first sourcedata event when toggling on after the route was drawn.
    setTimeout(function () { extractAndPublishRouteData(map); }, 100);

    map.on("sourcedata", function (e) {
      if (!plannerWatchActive) return;
      if (e.sourceId && e.sourceId.indexOf("rwgps-") === 0) return;

      clearTimeout(plannerDebounceTimer);
      plannerDebounceTimer = setTimeout(function () {
        extractAndPublishRouteData(map);
      }, PLANNER_DEBOUNCE_MS);
    });
  }

  function stopPlannerWatch() {
    plannerWatchActive = false;
    clearTimeout(plannerDebounceTimer);
    plannerLastCoordHash = "";
    plannerCachedSourceId = null;
  }

  document.addEventListener("rwgps-planner-watch-start", function () {
    var map = getMap();
    if (map) startPlannerWatch(map);
  });

  // On-demand extraction — used when a feature toggles on AFTER the
  // user has already drawn waypoints, so we don't have to wait for the
  // next sourcedata event from MapLibre.
  document.addEventListener("rwgps-planner-route-extract", function () {
    var map = getMap();
    if (!map) return;
    plannerLastCoordHash = ""; // force re-publish
    extractAndPublishRouteData(map);
  });

  document.addEventListener("rwgps-planner-watch-stop", function () {
    stopPlannerWatch();
  });

  // ─── Generic Layer Overlays (Public Lands, Weather Radar, …) ──────────────

  // Each registered overlay declares how to (re)apply itself to the live
  // MapLibre style. After RWGPS rebuilds the style (every source/layer
  // change calls map.setStyle), we re-run apply for every registered
  // overlay so they survive the rebuild — same trick hillshade uses.

  var overlayRegistry = {}; // id -> { apply: function(map), layerIds: [...] }
  var overlayStyleListener = null;
  var overlayApplyPending = false;

  function attachOverlayStyleListener(map) {
    if (overlayStyleListener) return;
    overlayStyleListener = function (e) {
      if (e.dataType !== "style") return;
      if (overlayApplyPending) return;
      overlayApplyPending = true;
      requestAnimationFrame(function () {
        overlayApplyPending = false;
        var ids = Object.keys(overlayRegistry);
        for (var i = 0; i < ids.length; i++) {
          var entry = overlayRegistry[ids[i]];
          if (!entry || typeof entry.apply !== "function") continue;
          try { entry.apply(map); } catch (err) {}
        }
      });
    };
    map.on("data", overlayStyleListener);
  }

  function detachOverlayStyleListenerIfIdle(map) {
    if (Object.keys(overlayRegistry).length > 0) return;
    if (overlayStyleListener && map) {
      try { map.off("data", overlayStyleListener); } catch (e) {}
    }
    overlayStyleListener = null;
    overlayApplyPending = false;
  }

  function findFirstSymbolLayerId(map) {
    var style;
    try { style = map.getStyle(); } catch (e) { return null; }
    if (!style || !style.layers) return null;
    for (var i = 0; i < style.layers.length; i++) {
      if (style.layers[i].type === "symbol") return style.layers[i].id;
    }
    return null;
  }

  function removeOverlay(map, layerIds, sourceId) {
    if (!map) return;
    try {
      for (var i = 0; i < layerIds.length; i++) {
        if (map.getLayer(layerIds[i])) map.removeLayer(layerIds[i]);
      }
      if (sourceId && map.getSource(sourceId)) map.removeSource(sourceId);
    } catch (e) {}
  }

  function applyRasterOverlay(map, id, tiles, opts) {
    opts = opts || {};
    try {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
      var sourceSpec = {
        type: "raster",
        tiles: tiles,
        tileSize: opts.tileSize || 256,
        attribution: opts.attribution || ""
      };
      if (typeof opts.minzoom === "number") sourceSpec.minzoom = opts.minzoom;
      if (typeof opts.maxzoom === "number") sourceSpec.maxzoom = opts.maxzoom;
      map.addSource(id, sourceSpec);
      var beforeId = opts.beforeLayerId || findFirstSymbolLayerId(map);
      var layerSpec = {
        id: id,
        type: "raster",
        source: id,
        paint: {
          "raster-opacity": opts.opacity != null ? opts.opacity : 0.7
        }
      };
      if (beforeId && map.getLayer(beforeId)) {
        map.addLayer(layerSpec, beforeId);
      } else {
        map.addLayer(layerSpec);
      }
    } catch (e) {}
  }

  function applyGeoJsonCircles(map, id, data, opts) {
    opts = opts || {};
    var circleId = id + "-circle";
    try {
      if (map.getLayer(circleId)) map.removeLayer(circleId);
      if (map.getSource(id)) map.removeSource(id);
      map.addSource(id, { type: "geojson", data: data });
      var beforeId = opts.beforeLayerId || findFirstSymbolLayerId(map);
      var spec = {
        id: circleId,
        type: "circle",
        source: id,
        paint: {
          "circle-radius": opts.radius != null ? opts.radius : 6,
          "circle-color": opts.color || "#E53935",
          "circle-stroke-color": opts.strokeColor || "#B71C1C",
          "circle-stroke-width": opts.strokeWidth != null ? opts.strokeWidth : 1.5,
          "circle-opacity": opts.opacity != null ? opts.opacity : 0.85
        }
      };
      if (beforeId && map.getLayer(beforeId)) {
        map.addLayer(spec, beforeId);
      } else {
        map.addLayer(spec);
      }
    } catch (e) {}
  }

  function applyGeoJsonFillLine(map, id, data, opts) {
    opts = opts || {};
    var fillId = id + "-fill";
    var lineId = id + "-line";
    try {
      if (map.getLayer(fillId)) map.removeLayer(fillId);
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getSource(id)) map.removeSource(id);
      map.addSource(id, { type: "geojson", data: data });
      var beforeId = opts.beforeLayerId || findFirstSymbolLayerId(map);
      var fillSpec = {
        id: fillId,
        type: "fill",
        source: id,
        paint: {
          "fill-color": opts.fillColor || ["coalesce", ["get", "_color"], "#888888"],
          "fill-opacity": opts.fillOpacity != null ? opts.fillOpacity : 0.25
        }
      };
      var lineSpec = {
        id: lineId,
        type: "line",
        source: id,
        paint: {
          "line-color": opts.lineColor || ["coalesce", ["get", "_color"], "#444444"],
          "line-width": opts.lineWidth != null ? opts.lineWidth : 1,
          "line-opacity": opts.lineOpacity != null ? opts.lineOpacity : 0.75
        }
      };
      if (opts.lineDasharray) {
        lineSpec.paint["line-dasharray"] = opts.lineDasharray;
      }
      if (beforeId && map.getLayer(beforeId)) {
        map.addLayer(fillSpec, beforeId);
        map.addLayer(lineSpec, beforeId);
      } else {
        map.addLayer(fillSpec);
        map.addLayer(lineSpec);
      }
    } catch (e) {}
  }

  // ─── Public Lands overlay ─────────────────────────────────────────────────

  var publicLandsData = null; // current GeoJSON FeatureCollection
  var publicLandsOpts = { fillOpacity: 0.22, lineOpacity: 0.7, lineWidth: 1 };

  function applyPublicLands(map) {
    if (!publicLandsData) return;
    applyGeoJsonFillLine(map, "rwgps-publiclands", publicLandsData, publicLandsOpts);
  }

  // Style-reload reattach: only re-add if the layer was wiped (style rebuild).
  // Skipping when present is what breaks the strobe loop — MapLibre fires
  // dataType:"style" events for our own addSource/addLayer calls too, so a
  // listener that always re-adds re-triggers itself indefinitely.
  function reattachPublicLands(map) {
    if (!publicLandsData) return;
    if (map.getSource("rwgps-publiclands") && map.getLayer("rwgps-publiclands-fill")) return;
    applyGeoJsonFillLine(map, "rwgps-publiclands", publicLandsData, publicLandsOpts);
  }

  document.addEventListener("rwgps-publiclands-apply", function (e) {
    try {
      publicLandsData = JSON.parse(e.detail);
    } catch (err) {
      publicLandsData = null;
      return;
    }
    overlayRegistry["rwgps-publiclands"] = {
      apply: reattachPublicLands,
      layerIds: ["rwgps-publiclands-fill", "rwgps-publiclands-line"]
    };
    var map = getMap();
    if (!map) return;
    applyPublicLands(map);
    attachOverlayStyleListener(map);
  });

  document.addEventListener("rwgps-publiclands-reset", function () {
    publicLandsData = null;
    delete overlayRegistry["rwgps-publiclands"];
    var map = getMap();
    if (map) {
      removeOverlay(map, ["rwgps-publiclands-fill", "rwgps-publiclands-line"], "rwgps-publiclands");
      detachOverlayStyleListenerIfIdle(map);
    }
  });

  // ─── Weather Radar overlay (RainViewer) ───────────────────────────────────

  var radarTiles = null;
  var radarOpacity = 0.6;

  // RainViewer's public radar tiles return a "Zoom Level Not Supported"
  // placeholder PNG once the requested zoom exceeds their free coverage
  // (~z 8 in practice). Setting maxzoom on the source caps requests at
  // that level; MapLibre overzooms (stretches) the cap tile for higher
  // view zooms — radar gets blurrier as you zoom in but stays valid.
  var RADAR_OPTS = {
    tileSize: 256,
    maxzoom: 6,
    opacity: radarOpacity,
    attribution: "Radar © RainViewer"
  };

  function applyRadar(map) {
    if (!radarTiles) return;
    RADAR_OPTS.opacity = radarOpacity;
    applyRasterOverlay(map, "rwgps-radar", radarTiles, RADAR_OPTS);
  }

  // Idempotent reattach for the style-reload listener; see reattachPublicLands
  // for the explanation of why this can't be the same as applyRadar.
  function reattachRadar(map) {
    if (!radarTiles) return;
    if (map.getSource("rwgps-radar") && map.getLayer("rwgps-radar")) return;
    RADAR_OPTS.opacity = radarOpacity;
    applyRasterOverlay(map, "rwgps-radar", radarTiles, RADAR_OPTS);
  }

  document.addEventListener("rwgps-radar-apply", function (e) {
    var detail;
    try { detail = JSON.parse(e.detail); } catch (err) { return; }
    if (!detail || !detail.tiles) return;
    radarTiles = detail.tiles;
    if (typeof detail.opacity === "number") radarOpacity = detail.opacity;
    overlayRegistry["rwgps-radar"] = {
      apply: reattachRadar,
      layerIds: ["rwgps-radar"]
    };
    var map = getMap();
    if (!map) return;
    applyRadar(map);
    attachOverlayStyleListener(map);
  });

  document.addEventListener("rwgps-radar-reset", function () {
    radarTiles = null;
    delete overlayRegistry["rwgps-radar"];
    var map = getMap();
    if (map) {
      removeOverlay(map, ["rwgps-radar"], "rwgps-radar");
      detachOverlayStyleListenerIfIdle(map);
    }
  });

  // ─── Wildfire overlay (NIFC perimeters + incident locations) ──────────────

  var wildfirePerimeters = null;
  var wildfirePoints = null;
  var wildfirePointBuffers = null;
  var WILDFIRE_FILL_OPTS = {
    fillColor: "#E53935",
    fillOpacity: 0.30,
    lineColor: "#B71C1C",
    lineWidth: 1.5,
    lineOpacity: 0.85
  };
  // Estimated areas (point + reported acreage → circle) get a dashed
  // outline so they're visually distinct from authoritative perimeters.
  // Fill is intentionally close to the perimeter style so the area is
  // clearly visible at any zoom — including small fires, where the
  // circle may only be a handful of pixels wide.
  var WILDFIRE_PBUFFER_OPTS = {
    fillColor: "#E53935",
    fillOpacity: 0.28,
    lineColor: "#B71C1C",
    lineWidth: 2,
    lineOpacity: 0.9,
    lineDasharray: [4, 3]
  };
  var WILDFIRE_POINT_OPTS = {
    color: "#E53935",
    strokeColor: "#B71C1C",
    // Small center marker — the buffered polygon represents area, the
    // dot just confirms the incident location. Kept tiny so it doesn't
    // visually cover the polygon for small fires.
    radius: 3,
    strokeWidth: 1.5,
    opacity: 0.9
  };

  function applyWildfire(map) {
    // Render order matters: estimated areas first (lowest), real perimeters
    // on top of those, dot markers above everything for visibility.
    if (wildfirePointBuffers) {
      applyGeoJsonFillLine(map, "rwgps-wildfire-pbuffer", wildfirePointBuffers, WILDFIRE_PBUFFER_OPTS);
    }
    if (wildfirePerimeters) {
      applyGeoJsonFillLine(map, "rwgps-wildfire-perim", wildfirePerimeters, WILDFIRE_FILL_OPTS);
    }
    if (wildfirePoints) {
      applyGeoJsonCircles(map, "rwgps-wildfire-points", wildfirePoints, WILDFIRE_POINT_OPTS);
    }
  }

  function reattachWildfire(map) {
    if (wildfirePointBuffers
        && !(map.getSource("rwgps-wildfire-pbuffer") && map.getLayer("rwgps-wildfire-pbuffer-fill"))) {
      applyGeoJsonFillLine(map, "rwgps-wildfire-pbuffer", wildfirePointBuffers, WILDFIRE_PBUFFER_OPTS);
    }
    if (wildfirePerimeters
        && !(map.getSource("rwgps-wildfire-perim") && map.getLayer("rwgps-wildfire-perim-fill"))) {
      applyGeoJsonFillLine(map, "rwgps-wildfire-perim", wildfirePerimeters, WILDFIRE_FILL_OPTS);
    }
    if (wildfirePoints
        && !(map.getSource("rwgps-wildfire-points") && map.getLayer("rwgps-wildfire-points-circle"))) {
      applyGeoJsonCircles(map, "rwgps-wildfire-points", wildfirePoints, WILDFIRE_POINT_OPTS);
    }
  }

  // Click-to-inspect popup for wildfire layers.
  var wildfirePopupEl = null;
  var wildfirePopupLngLat = null;
  var wildfirePopupMoveHandler = null;
  var wildfireCanvasEl = null;
  var wildfireCanvasClickHandler = null;
  var wildfireMouseEnterHandlers = {};
  var wildfireMouseLeaveHandlers = {};
  var WILDFIRE_LAYERS = ["rwgps-wildfire-perim-fill", "rwgps-wildfire-pbuffer-fill", "rwgps-wildfire-points-circle"];

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function formatAcres(v) {
    if (v == null || isNaN(v)) return null;
    var n = Number(v);
    if (n < 10) return Math.round(n * 10) / 10 + " ac";
    return Math.round(n).toLocaleString() + " ac";
  }

  function positionWildfirePopup(map) {
    if (!wildfirePopupEl || !wildfirePopupLngLat) return;
    var px = map.project(wildfirePopupLngLat);
    wildfirePopupEl.style.left = px.x + "px";
    wildfirePopupEl.style.top = px.y + "px";
  }

  function removeWildfirePopup(map) {
    if (wildfirePopupEl) {
      wildfirePopupEl.remove();
      wildfirePopupEl = null;
    }
    wildfirePopupLngLat = null;
    if (wildfirePopupMoveHandler && map) {
      map.off("move", wildfirePopupMoveHandler);
      wildfirePopupMoveHandler = null;
    }
  }

  function showWildfirePopup(map, lngLat, props) {
    removeWildfirePopup(map);

    var name = props.poly_IncidentName || props.IncidentName || "Wildfire";
    var sizeRaw = props.attr_IncidentSize != null ? props.attr_IncidentSize : props.IncidentSize;
    var sizeStr = formatAcres(sizeRaw);
    var dateMs = props.poly_DateCurrent || props.FireDiscoveryDateTime;
    var dateStr = "";
    if (dateMs) {
      var d = new Date(dateMs);
      if (!isNaN(d.getTime())) dateStr = d.toLocaleDateString();
    }
    var cause = props.FireCause;
    var dateLabel = props.poly_DateCurrent ? "Updated" : "Discovered";

    var meta = [];
    if (sizeStr) meta.push(sizeStr + (props._estimated ? " (estimated area)" : ""));
    if (dateStr) meta.push(dateLabel + " " + dateStr);

    var html = '<button class="rwgps-wildfire-popup-close" type="button">×</button>' +
      '<div class="rwgps-wildfire-popup-name">' + escapeHtml(name) + '</div>';
    if (meta.length > 0) {
      html += '<div class="rwgps-wildfire-popup-meta">' + escapeHtml(meta.join(" · ")) + '</div>';
    }
    if (cause) {
      html += '<div class="rwgps-wildfire-popup-meta">Cause: ' + escapeHtml(cause) + '</div>';
    }

    var el = document.createElement("div");
    el.className = "rwgps-wildfire-popup";
    el.innerHTML = html;

    var mapContainer = document.querySelector(".maplibregl-map");
    if (!mapContainer) return;
    mapContainer.appendChild(el);

    wildfirePopupEl = el;
    wildfirePopupLngLat = lngLat;
    positionWildfirePopup(map);

    if (!wildfirePopupMoveHandler) {
      wildfirePopupMoveHandler = function () { positionWildfirePopup(map); };
      map.on("move", wildfirePopupMoveHandler);
    }

    el.querySelector(".rwgps-wildfire-popup-close").addEventListener("click", function (ev) {
      ev.stopPropagation();
      removeWildfirePopup(map);
    });
  }

  function attachWildfireInteraction(map) {
    if (wildfireCanvasClickHandler) return;

    var canvas = map.getCanvas();
    if (!canvas) return;

    // DOM-level capture-phase click listener — runs BEFORE MapLibre's own
    // canvas listeners. When the click hits a wildfire feature, we stop
    // propagation so MapLibre never fires its `click` event, which would
    // otherwise trigger the RWGPS planner's add-route-point handler.
    wildfireCanvasEl = canvas;
    wildfireCanvasClickHandler = function (e) {
      var present = [];
      for (var i = 0; i < WILDFIRE_LAYERS.length; i++) {
        if (map.getLayer(WILDFIRE_LAYERS[i])) present.push(WILDFIRE_LAYERS[i]);
      }
      if (present.length === 0) return;

      var rect = canvas.getBoundingClientRect();
      var point = [e.clientX - rect.left, e.clientY - rect.top];
      var features;
      try {
        features = map.queryRenderedFeatures(point, { layers: present });
      } catch (err) { return; }
      if (!features || features.length === 0) return;

      // Hit — swallow the event so the planner doesn't drop a route point.
      e.stopImmediatePropagation();
      e.preventDefault();

      // Prefer point feature if both polygon and point are at click — points
      // tend to have richer attribute data (cause, discovery date).
      var pick = features[0];
      for (var f = 0; f < features.length; f++) {
        if (features[f].layer.id === "rwgps-wildfire-points-circle") {
          pick = features[f];
          break;
        }
      }
      var lngLat = map.unproject(point);
      showWildfirePopup(map, lngLat, pick.properties || {});
    };
    canvas.addEventListener("click", wildfireCanvasClickHandler, true);

    for (var li = 0; li < WILDFIRE_LAYERS.length; li++) {
      (function (layerId) {
        var enter = function () { map.getCanvas().style.cursor = "pointer"; };
        var leave = function () { map.getCanvas().style.cursor = ""; };
        map.on("mouseenter", layerId, enter);
        map.on("mouseleave", layerId, leave);
        wildfireMouseEnterHandlers[layerId] = enter;
        wildfireMouseLeaveHandlers[layerId] = leave;
      })(WILDFIRE_LAYERS[li]);
    }
  }

  function detachWildfireInteraction(map) {
    if (wildfireCanvasClickHandler && wildfireCanvasEl) {
      try { wildfireCanvasEl.removeEventListener("click", wildfireCanvasClickHandler, true); } catch (e) {}
    }
    wildfireCanvasClickHandler = null;
    wildfireCanvasEl = null;
    if (map) {
      for (var layerId in wildfireMouseEnterHandlers) {
        try { map.off("mouseenter", layerId, wildfireMouseEnterHandlers[layerId]); } catch (e) {}
      }
      for (var layerId2 in wildfireMouseLeaveHandlers) {
        try { map.off("mouseleave", layerId2, wildfireMouseLeaveHandlers[layerId2]); } catch (e) {}
      }
    }
    wildfireMouseEnterHandlers = {};
    wildfireMouseLeaveHandlers = {};
    removeWildfirePopup(map);
  }

  document.addEventListener("rwgps-wildfire-apply", function (e) {
    var detail;
    try { detail = JSON.parse(e.detail); } catch (err) { return; }
    wildfirePerimeters = detail.perimeters || null;
    wildfirePoints = detail.points || null;
    wildfirePointBuffers = detail.pointBuffers || null;
    overlayRegistry["rwgps-wildfire"] = {
      apply: reattachWildfire,
      layerIds: [
        "rwgps-wildfire-pbuffer-fill", "rwgps-wildfire-pbuffer-line",
        "rwgps-wildfire-perim-fill", "rwgps-wildfire-perim-line",
        "rwgps-wildfire-points-circle"
      ]
    };
    var map = getMap();
    if (!map) return;
    applyWildfire(map);
    attachOverlayStyleListener(map);
    attachWildfireInteraction(map);
  });

  document.addEventListener("rwgps-wildfire-reset", function () {
    wildfirePerimeters = null;
    wildfirePoints = null;
    wildfirePointBuffers = null;
    delete overlayRegistry["rwgps-wildfire"];
    var map = getMap();
    if (map) {
      detachWildfireInteraction(map);
      removeOverlay(map, ["rwgps-wildfire-pbuffer-fill", "rwgps-wildfire-pbuffer-line"], "rwgps-wildfire-pbuffer");
      removeOverlay(map, ["rwgps-wildfire-perim-fill", "rwgps-wildfire-perim-line"], "rwgps-wildfire-perim");
      removeOverlay(map, ["rwgps-wildfire-points-circle"], "rwgps-wildfire-points");
      detachOverlayStyleListenerIfIdle(map);
    }
  });

  // ─── Map Viewport Bridge ──────────────────────────────────────────────────
  // Content script asks for the current bbox; bridge reports it. Also
  // dispatches a debounced moveend event so layers can refetch on pan.

  function dispatchViewport(map) {
    if (!map) return;
    try {
      var b = map.getBounds();
      document.dispatchEvent(new CustomEvent("rwgps-mapviewport", {
        detail: JSON.stringify({
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth(),
          zoom: map.getZoom()
        })
      }));
    } catch (e) {}
  }

  document.addEventListener("rwgps-mapviewport-get", function () {
    dispatchViewport(getMap());
  });

  var moveendAttached = false;
  var moveendDebounce = null;
  function ensureMoveendBridge(map) {
    if (moveendAttached || !map) return;
    moveendAttached = true;
    map.on("moveend", function () {
      clearTimeout(moveendDebounce);
      moveendDebounce = setTimeout(function () { dispatchViewport(map); }, 250);
    });
  }

  document.addEventListener("rwgps-mapviewport-watch", function () {
    ensureMoveendBridge(getMap());
  });

})();
