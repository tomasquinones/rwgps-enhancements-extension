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
  var layerWatchdogId = null;
  var heatmapSettings = null; // { global: { hueRotate, saturation, brightnessMin, brightnessMax, opacity }, rides: ..., routes: ... }
  var hillshadeSettings = null; // { exaggeration, illumDirection }
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

  // Our line layers, bottom to top. The watchdog keeps them above RWGPS's own.
  var OUR_LINE_LAYERS = [
    "rwgps-segments-line-casing", "rwgps-segments-line",
    "rwgps-quick-laps-line-casing", "rwgps-quick-laps-line",
    "rwgps-speed-line-casing", "rwgps-speed-line"
  ];

  // The watchdog only does work after the map style changes (RWGPS rebuilds
  // the style on most source/layer changes, which wipes our layers and paint
  // overrides). Every step below is idempotent, so a pass that finds nothing
  // to fix makes no style changes and the watchdog goes idle again.
  var layerWatchdogDirty = true;
  var layerWatchdogMap = null;
  function onWatchdogMapData(e) {
    if (e.dataType === "style") layerWatchdogDirty = true;
    else if (e.dataType === "source" && e.sourceDataType) layerWatchdogDirty = true;
  }

  function detachWatchdogListener() {
    if (layerWatchdogMap) {
      try { layerWatchdogMap.off("data", onWatchdogMapData); } catch (e) {}
      layerWatchdogMap = null;
    }
  }

  function ourLayersOnTop(style) {
    if (!style || !style.layers) return true;
    var order = style.layers.map(function (l) { return l.id; });
    var present = OUR_LINE_LAYERS.filter(function (id) { return order.indexOf(id) !== -1; });
    var tail = order.slice(order.length - present.length);
    for (var i = 0; i < present.length; i++) {
      if (tail[i] !== present[i]) return false;
    }
    return true;
  }

  function startLayerWatchdog() {
    layerWatchdogDirty = true;
    if (layerWatchdogId) return;
    layerWatchdogId = setInterval(function () {
      var map = getMap();
      if (!map) return;
      if (!speedColorFeatures && !segmentFeatures && !quickLapsLineCoords && !heatmapSettings && !windTimeOverride) {
        clearInterval(layerWatchdogId);
        layerWatchdogId = null;
        detachWatchdogListener();
        return;
      }
      if (map !== layerWatchdogMap) {
        detachWatchdogListener();
        map.on("data", onWatchdogMapData);
        layerWatchdogMap = map;
        layerWatchdogDirty = true;
      }
      if (!layerWatchdogDirty) return;
      layerWatchdogDirty = false;
      try {
        if (speedColorFeatures && !map.getSource("rwgps-speed-colors")) {
          addSpeedColorLayers(map, speedColorFeatures);
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
        var style = map.getStyle();
        if (heatmapSettings) {
          applyHeatmapSettings(map, heatmapSettings, style);
        }
        if (windTimeOverride) {
          applyWindTimeOverride(map, windTimeOverride, style);
        }
        if (!ourLayersOnTop(style)) {
          for (var i = 0; i < OUR_LINE_LAYERS.length; i++) {
            if (map.getLayer(OUR_LINE_LAYERS[i])) map.moveLayer(OUR_LINE_LAYERS[i]);
          }
        }
      } catch (e) {}
    }, 500);
  }

  document.addEventListener("rwgps-speed-colors-add", function (e) {
    try {
      speedColorFeatures = JSON.parse(e.detail);
    } catch (err) {
      speedColorFeatures = null;
      return;
    }

    startLayerWatchdog();

    var map = getMap();
    if (!map) return;
    try {
      addSpeedColorLayers(map, speedColorFeatures);
    } catch (err) {}
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
  });

  // ─── Segments layers ────────────────────────────────────────────────
  var segmentFeatures = null;
  var segmentDomMarkers = [];
  var segmentTooltipEl = null;
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

  function findHeatmapLayers(map, style) {
    if (!style) {
      try { style = map.getStyle(); } catch (e) { return []; }
    }
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

  var HEATMAP_PAINT_PROPS = ["raster-hue-rotate", "raster-saturation", "raster-brightness-min", "raster-brightness-max", "raster-opacity"];
  var originalHeatmapProps = {}; // layerId -> { prop: native value }

  // setPaintProperty always triggers a style update + repaint, even for an
  // unchanged value, so only call it when the value actually differs.
  function setPaintIfChanged(map, layerId, prop, value) {
    var current;
    try { current = map.getPaintProperty(layerId, prop); } catch (e) {}
    if (current === value) return;
    map.setPaintProperty(layerId, prop, value);
  }

  function applyHeatmapSettings(map, settings, style) {
    var layers = findHeatmapLayers(map, style);
    for (var i = 0; i < layers.length; i++) {
      var lyr = layers[i];
      var s = settings[lyr.kind];
      if (!s) continue;
      try {
        if (!originalHeatmapProps[lyr.layerId]) {
          var orig = {};
          for (var p = 0; p < HEATMAP_PAINT_PROPS.length; p++) {
            orig[HEATMAP_PAINT_PROPS[p]] = map.getPaintProperty(lyr.layerId, HEATMAP_PAINT_PROPS[p]);
          }
          originalHeatmapProps[lyr.layerId] = orig;
        }
        setPaintIfChanged(map, lyr.layerId, "raster-hue-rotate", s.hueRotate || 0);
        setPaintIfChanged(map, lyr.layerId, "raster-saturation", s.saturation || 0);
        setPaintIfChanged(map, lyr.layerId, "raster-brightness-min", s.brightnessMin || 0);
        setPaintIfChanged(map, lyr.layerId, "raster-brightness-max", s.brightnessMax != null ? s.brightnessMax : 1);
        setPaintIfChanged(map, lyr.layerId, "raster-opacity", s.opacity != null ? s.opacity : 1);
      } catch (e) {}
    }
  }

  // Restore RWGPS's own paint values (e.g. its 0.9 global heatmap opacity)
  // rather than hard-coded defaults.
  function resetHeatmapLayers(map) {
    var layers = findHeatmapLayers(map);
    for (var i = 0; i < layers.length; i++) {
      var orig = originalHeatmapProps[layers[i].layerId];
      if (!orig) continue;
      for (var p = 0; p < HEATMAP_PAINT_PROPS.length; p++) {
        try { map.setPaintProperty(layers[i].layerId, HEATMAP_PAINT_PROPS[p], orig[HEATMAP_PAINT_PROPS[p]]); } catch (e) {}
      }
    }
    originalHeatmapProps = {};
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

  // ─── Map-bound "data" listeners ────────────────────────────────────────
  // SPA navigation replaces the MapLibre map. A listener left on the old map
  // never re-applies anything on the new one, so each re-apply listener
  // remembers which map it is on: attach() moves it to a new map, and
  // detach() works even when no map is on the page.

  function createMapDataListener(onData) {
    var boundMap = null;
    var handler = null;
    return {
      attach: function (map) {
        if (boundMap === map) return;
        this.detach();
        boundMap = map;
        handler = function (e) { onData(map, e); };
        map.on("data", handler);
      },
      detach: function () {
        if (boundMap && handler) {
          try { boundMap.off("data", handler); } catch (e) {}
        }
        boundMap = null;
        handler = null;
      },
      map: function () { return boundMap; }
    };
  }

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
        if (settings.illumDirection != null) {
          map.setPaintProperty(id, "hillshade-illumination-direction", settings.illumDirection);
        }
      } catch (e) {}
    }
  }

  function resetHillshadeLayers(map) {
    detachHillshadeStyleListener();
    var layerIds = findHillshadeLayers(map);
    if (originalHillshadeProps) {
      for (var i = 0; i < layerIds.length; i++) {
        var id = layerIds[i];
        var orig = originalHillshadeProps[id];
        if (!orig) continue;
        try {
          map.setPaintProperty(id, "hillshade-exaggeration", orig.exaggeration);
          map.setPaintProperty(id, "hillshade-illumination-direction", orig.illumDirection);
        } catch (e) {}
      }
    }
    originalHillshadeProps = null;
  }

  var hillshadeApplyPending = false;

  var hillshadeStyleListener = createMapDataListener(function (map, e) {
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
  });

  function detachHillshadeStyleListener() {
    hillshadeStyleListener.detach();
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
      // Native values captured on a previous page's map don't apply here.
      if (hillshadeStyleListener.map() && hillshadeStyleListener.map() !== map) originalHillshadeProps = null;
      applyHillshadeSettings(map, hillshadeSettings);
      hillshadeStyleListener.attach(map);
    }
  });

  document.addEventListener("rwgps-hillshade-reset", function () {
    hillshadeSettings = null;
    var map = getMap();
    if (map) {
      resetHillshadeLayers(map);
    }
    detachHillshadeStyleListener();
    originalHillshadeProps = null;
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

  // ─── Track Colors (native polyline recolor) ───────────────────────────

  var trackColorSettings = null; // { color, opacity, widthScale }
  var originalTrackProps = null; // { layerId: { color, opacity, width, gapWidth } }
  var trackColorApplyPending = false;

  function findNativeTrackLineLayers(map) {
    var sourceId = findRouteLineSource(map);
    if (!sourceId) return [];
    var style;
    try { style = map.getStyle(); } catch (e) { return []; }
    if (!style || !style.layers) return [];
    var ids = [];
    for (var i = 0; i < style.layers.length; i++) {
      var layer = style.layers[i];
      if (layer.type !== "line") continue;
      if (layer.source !== sourceId) continue;
      if (layer.id.indexOf("rwgps-") === 0) continue; // never touch our own layers
      ids.push(layer.id);
    }
    return ids;
  }

  // Captures each native layer the first time we see it (surface/unpaved
  // layers can appear after the main track line).
  function captureOriginalTrackProps(map, layerIds) {
    if (!originalTrackProps) originalTrackProps = {};
    for (var i = 0; i < layerIds.length; i++) {
      var id = layerIds[i];
      if (originalTrackProps[id]) continue;
      try {
        originalTrackProps[id] = {
          color: map.getPaintProperty(id, "line-color"),
          opacity: map.getPaintProperty(id, "line-opacity"),
          width: map.getPaintProperty(id, "line-width"),
          gapWidth: map.getPaintProperty(id, "line-gap-width")
        };
      } catch (e) {}
    }
  }

  // Multiplies a line-width value by factor. RWGPS widths are zoom
  // interpolations with data-driven stops (["get", "weight"] ± 1); zoom
  // expressions must stay top-level, so scale each stop's output instead of
  // wrapping the whole expression.
  function scaleWidthOutput(v, factor) {
    return typeof v === "number" ? v * factor : ["*", v, factor];
  }

  function scaleWidthValue(value, factor) {
    if (value == null) return null;
    if (typeof value === "number") return value * factor;
    if (value.stops) {
      var fromStops = ["interpolate", ["linear"], ["zoom"]];
      for (var s = 0; s < value.stops.length; s++) {
        fromStops.push(value.stops[s][0], value.stops[s][1] * factor);
      }
      return fromStops;
    }
    if (!Array.isArray(value)) return value;
    if (value[0] === "interpolate") {
      var interp = value.slice(0, 3);
      for (var i = 3; i < value.length; i += 2) {
        interp.push(value[i], scaleWidthOutput(value[i + 1], factor));
      }
      return interp;
    }
    if (value[0] === "step") {
      var step = [value[0], value[1], scaleWidthOutput(value[2], factor)];
      for (var j = 3; j < value.length; j += 2) {
        step.push(value[j], scaleWidthOutput(value[j + 1], factor));
      }
      return step;
    }
    if (JSON.stringify(value).indexOf('"zoom"') === -1) return ["*", value, factor];
    return value;
  }

  function applyTrackWidth(map, id, orig, factor) {
    // Casing layers draw their outline around a gap the size of the track;
    // widen the gap and keep the outline itself thin.
    var prop = orig.gapWidth != null ? "line-gap-width" : "line-width";
    var original = prop === "line-gap-width" ? orig.gapWidth : orig.width;
    var target = factor === 1 ? original : scaleWidthValue(original == null ? 1 : original, factor);
    map.setPaintProperty(id, prop, target);
  }

  function applyTrackColorSettings(map, settings) {
    var layerIds = findNativeTrackLineLayers(map);
    if (layerIds.length === 0) return;
    captureOriginalTrackProps(map, layerIds);
    var factor = typeof settings.widthScale === "number" && settings.widthScale > 0 ? settings.widthScale : 1;
    for (var i = 0; i < layerIds.length; i++) {
      var id = layerIds[i];
      try {
        if (settings.color) {
          map.setPaintProperty(id, "line-color", settings.color);
        }
        if (settings.opacity != null) {
          map.setPaintProperty(id, "line-opacity", settings.opacity);
        }
        if (originalTrackProps[id]) applyTrackWidth(map, id, originalTrackProps[id], factor);
      } catch (e) {}
    }
  }

  function resetTrackColorLayers(map) {
    detachTrackColorStyleListener();
    if (originalTrackProps) {
      var ids = Object.keys(originalTrackProps);
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var orig = originalTrackProps[id];
        if (!orig) continue;
        try {
          if (map.getLayer(id)) {
            map.setPaintProperty(id, "line-color", orig.color);
            map.setPaintProperty(id, "line-opacity", orig.opacity);
            map.setPaintProperty(id, "line-width", orig.width);
            map.setPaintProperty(id, "line-gap-width", orig.gapWidth);
          }
        } catch (e) {}
      }
    }
    originalTrackProps = null;
  }

  var trackColorStyleListener = createMapDataListener(function (map, e) {
    if (!trackColorSettings) return;
    // RWGPS calls map.setStyle() on every source/layer change, which wipes
    // our setPaintProperty overrides. Re-apply on each style data event,
    // debounced to once per render frame.
    if (e.dataType === "style" && !trackColorApplyPending) {
      trackColorApplyPending = true;
      requestAnimationFrame(function () {
        trackColorApplyPending = false;
        if (!trackColorSettings) return;
        applyTrackColorSettings(map, trackColorSettings);
      });
    }
  });

  function detachTrackColorStyleListener() {
    trackColorStyleListener.detach();
    trackColorApplyPending = false;
  }

  document.addEventListener("rwgps-track-colors-apply", function (e) {
    try {
      trackColorSettings = JSON.parse(e.detail);
    } catch (err) {
      return;
    }
    var map = getMap();
    if (map) {
      // Native values captured on a previous page's map don't apply here.
      if (trackColorStyleListener.map() && trackColorStyleListener.map() !== map) originalTrackProps = null;
      applyTrackColorSettings(map, trackColorSettings);
      trackColorStyleListener.attach(map);
    }
  });

  document.addEventListener("rwgps-track-colors-remove", function () {
    trackColorSettings = null;
    var map = getMap();
    if (map) {
      resetTrackColorLayers(map);
    }
    detachTrackColorStyleListener();
    originalTrackProps = null;
  });

  // ─── Wind Layer Time Override ─────────────────────────────────────────

  function findWindLayers(map, style) {
    if (!style) {
      try { style = map.getStyle(); } catch (e) { return []; }
    }
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

  function applyWindTimeOverride(map, detail, style) {
    var windLayers = findWindLayers(map, style);
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
        // setTiles reloads every tile of the source; skip when already set.
        if (newTiles.join(" ") === liveSource.tiles.join(" ")) continue;
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

  var plannerWatchMap = null;

  function onPlannerSourceData(e) {
    if (!plannerWatchActive) return;
    if (e.sourceId && e.sourceId.indexOf("rwgps-") === 0) return;
    var map = plannerWatchMap;
    clearTimeout(plannerDebounceTimer);
    plannerDebounceTimer = setTimeout(function () {
      extractAndPublishRouteData(map);
    }, PLANNER_DEBOUNCE_MS);
  }

  function startPlannerWatch(map) {
    if (plannerWatchActive && plannerWatchMap === map) return;
    if (plannerWatchActive) stopPlannerWatch(); // a new map after SPA navigation
    plannerWatchActive = true;
    plannerWatchMap = map;

    // One-shot probe at attach time so we don't have to wait for the
    // first sourcedata event when toggling on after the route was drawn.
    setTimeout(function () { extractAndPublishRouteData(map); }, 100);

    map.on("sourcedata", onPlannerSourceData);
  }

  function stopPlannerWatch() {
    plannerWatchActive = false;
    if (plannerWatchMap) {
      try { plannerWatchMap.off("sourcedata", onPlannerSourceData); } catch (e) {}
      plannerWatchMap = null;
    }
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

  var overlayRegistry = {}; // id -> { apply: function(map) }
  var overlayApplyPending = false;

  var overlayStyleListener = createMapDataListener(function (map, e) {
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
  });

  function attachOverlayStyleListener(map) {
    overlayStyleListener.attach(map);
  }

  function detachOverlayStyleListenerIfIdle() {
    if (Object.keys(overlayRegistry).length > 0) return;
    overlayStyleListener.detach();
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
      if (typeof opts.maxzoom === "number") sourceSpec.maxzoom = opts.maxzoom;
      map.addSource(id, sourceSpec);
      var beforeId = findFirstSymbolLayerId(map);
      var layerSpec = {
        id: id,
        type: "raster",
        source: id,
        paint: {
          "raster-opacity": opts.opacity != null ? opts.opacity : 0.7
        }
      };
      if (opts.instant) {
        // Frame switches (radar animation) should be immediate, not faded.
        layerSpec.paint["raster-fade-duration"] = 0;
        layerSpec.paint["raster-opacity-transition"] = { duration: 0, delay: 0 };
      }
      if (beforeId && map.getLayer(beforeId)) {
        map.addLayer(layerSpec, beforeId);
      } else {
        map.addLayer(layerSpec);
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
      var beforeId = findFirstSymbolLayerId(map);
      var fillSpec = {
        id: fillId,
        type: "fill",
        source: id,
        paint: {
          "fill-color": ["coalesce", ["get", "_color"], "#888888"],
          "fill-opacity": opts.fillOpacity != null ? opts.fillOpacity : 0.25
        }
      };
      var lineSpec = {
        id: lineId,
        type: "line",
        source: id,
        paint: {
          "line-color": ["coalesce", ["get", "_color"], "#444444"],
          "line-width": opts.lineWidth != null ? opts.lineWidth : 1,
          "line-opacity": opts.lineOpacity != null ? opts.lineOpacity : 0.75
        }
      };
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
      apply: reattachPublicLands
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
    }
    detachOverlayStyleListenerIfIdle();
  });

  // ─── Weather Radar overlay (RainViewer) ───────────────────────────────────
  // One raster layer per radar frame. A static radar has a single frame; an
  // animated one keeps every frame loaded (opacity 0 when hidden, so tiles
  // stay cached) and steps the visible frame on a timer.

  var radarFrames = null; // [{ tiles: [url], label }]
  var radarOpacity = 0.6;
  var radarFrameIndex = 0;
  var radarAnimTimer = null;
  var radarHoldTicks = 0;
  var radarLabelEl = null;
  var RADAR_FRAME_MS = 600;
  var RADAR_NEWEST_HOLD_TICKS = 3; // pause on the newest frame before looping
  var RADAR_MAX_FRAMES = 24;

  // RainViewer's public radar tiles return a "Zoom Level Not Supported"
  // placeholder PNG once the requested zoom exceeds their free coverage
  // (~z 8 in practice). Setting maxzoom on the source caps requests at
  // that level; MapLibre overzooms (stretches) the cap tile for higher
  // view zooms — radar gets blurrier as you zoom in but stays valid.
  var RADAR_OPTS = {
    tileSize: 256,
    maxzoom: 6,
    opacity: radarOpacity,
    instant: true,
    attribution: "Radar © RainViewer"
  };

  function radarLayerId(i) {
    return "rwgps-radar-" + i;
  }

  function removeRadarLayers(map) {
    for (var i = 0; i < RADAR_MAX_FRAMES; i++) {
      removeOverlay(map, [radarLayerId(i)], radarLayerId(i));
    }
  }

  function updateRadarLabel(map) {
    if (!radarFrames || !map) return;
    if (!radarLabelEl || !radarLabelEl.isConnected) {
      radarLabelEl = document.createElement("div");
      radarLabelEl.className = "rwgps-radar-time";
      map.getContainer().appendChild(radarLabelEl);
    }
    var frame = radarFrames[radarFrameIndex];
    var text = "Radar " + (frame && frame.label ? frame.label : "");
    if (radarFrames.length > 1) text += "  (" + (radarFrameIndex + 1) + "/" + radarFrames.length + ")";
    radarLabelEl.textContent = text;
  }

  function removeRadarLabel() {
    if (radarLabelEl) radarLabelEl.remove();
    radarLabelEl = null;
  }

  function applyRadar(map) {
    if (!radarFrames) return;
    for (var i = 0; i < radarFrames.length; i++) {
      RADAR_OPTS.opacity = i === radarFrameIndex ? radarOpacity : 0;
      applyRasterOverlay(map, radarLayerId(i), radarFrames[i].tiles, RADAR_OPTS);
    }
    updateRadarLabel(map);
  }

  // Idempotent reattach for the style-reload listener; see reattachPublicLands
  // for the explanation of why this can't be the same as applyRadar.
  function reattachRadar(map) {
    if (!radarFrames) return;
    for (var i = 0; i < radarFrames.length; i++) {
      if (!map.getSource(radarLayerId(i)) || !map.getLayer(radarLayerId(i))) {
        applyRadar(map);
        return;
      }
    }
  }

  function stepRadarFrame() {
    if (document.hidden || !radarFrames || radarFrames.length < 2) return;
    var map = getMap();
    if (!map) return;
    if (radarFrameIndex === radarFrames.length - 1 && radarHoldTicks < RADAR_NEWEST_HOLD_TICKS) {
      radarHoldTicks++;
      return;
    }
    radarHoldTicks = 0;
    var prev = radarFrameIndex;
    radarFrameIndex = (radarFrameIndex + 1) % radarFrames.length;
    try {
      if (map.getLayer(radarLayerId(radarFrameIndex))) {
        map.setPaintProperty(radarLayerId(radarFrameIndex), "raster-opacity", radarOpacity);
      }
      if (map.getLayer(radarLayerId(prev))) {
        map.setPaintProperty(radarLayerId(prev), "raster-opacity", 0);
      }
    } catch (e) {}
    updateRadarLabel(map);
  }

  function stopRadarAnimation() {
    if (radarAnimTimer) {
      clearInterval(radarAnimTimer);
      radarAnimTimer = null;
    }
  }

  document.addEventListener("rwgps-radar-apply", function (e) {
    var detail;
    try { detail = JSON.parse(e.detail); } catch (err) { return; }
    if (!detail || !detail.frames || !detail.frames.length) return;
    stopRadarAnimation();
    var map = getMap();
    if (map) removeRadarLayers(map);
    radarFrames = detail.frames.slice(-RADAR_MAX_FRAMES);
    if (typeof detail.opacity === "number") radarOpacity = detail.opacity;
    radarFrameIndex = radarFrames.length - 1; // start on the newest frame
    radarHoldTicks = 0;
    overlayRegistry["rwgps-radar"] = {
      apply: reattachRadar
    };
    if (!map) return;
    applyRadar(map);
    attachOverlayStyleListener(map);
    if (detail.animate && radarFrames.length > 1) {
      radarAnimTimer = setInterval(stepRadarFrame, RADAR_FRAME_MS);
    }
  });

  document.addEventListener("rwgps-radar-reset", function () {
    stopRadarAnimation();
    radarFrames = null;
    removeRadarLabel();
    delete overlayRegistry["rwgps-radar"];
    var map = getMap();
    if (map) removeRadarLayers(map);
    detachOverlayStyleListenerIfIdle();
  });

  // ─── Temperature chips (DOM labels) ───────────────────────────────────────
  // Positioned with transforms on every map move, like MapLibre's own markers.

  var temperatureChips = []; // { el, lngLat }
  var temperatureMap = null;

  function positionTemperatureChips() {
    var map = temperatureMap;
    if (!map) return;
    for (var i = 0; i < temperatureChips.length; i++) {
      var chip = temperatureChips[i];
      var pt = map.project(chip.lngLat);
      chip.el.style.transform = "translate(" + pt.x.toFixed(1) + "px," + pt.y.toFixed(1) + "px) translate(-50%,-50%)";
    }
  }

  function clearTemperatureChips() {
    for (var i = 0; i < temperatureChips.length; i++) temperatureChips[i].el.remove();
    temperatureChips = [];
    if (temperatureMap) {
      try { temperatureMap.off("move", positionTemperatureChips); } catch (e) {}
      temperatureMap = null;
    }
  }

  document.addEventListener("rwgps-temperature-apply", function (e) {
    var detail;
    try { detail = JSON.parse(e.detail); } catch (err) { return; }
    clearTemperatureChips();
    var map = getMap();
    if (!map || !detail || !detail.chips || !detail.chips.length) return;
    var container = map.getCanvasContainer();
    for (var i = 0; i < detail.chips.length; i++) {
      var c = detail.chips[i];
      var el = document.createElement("div");
      el.className = "rwgps-temperature-chip";
      el.textContent = c.text;
      el.style.background = c.bg;
      el.style.color = c.fg;
      container.appendChild(el);
      temperatureChips.push({ el: el, lngLat: { lng: c.lng, lat: c.lat } });
    }
    temperatureMap = map;
    map.on("move", positionTemperatureChips);
    positionTemperatureChips();
  });

  document.addEventListener("rwgps-temperature-reset", clearTemperatureChips);

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

  // Keyed by map instance: SPA navigation to another map page creates a new
  // map, which needs its own listener.
  var moveendMap = null;
  var moveendDebounce = null;
  function onMoveend() {
    var map = moveendMap;
    clearTimeout(moveendDebounce);
    moveendDebounce = setTimeout(function () { dispatchViewport(map); }, 250);
  }

  function ensureMoveendBridge(map) {
    if (!map || map === moveendMap) return;
    if (moveendMap) {
      try { moveendMap.off("moveend", onMoveend); } catch (e) {}
    }
    moveendMap = map;
    map.on("moveend", onMoveend);
  }

  document.addEventListener("rwgps-mapviewport-watch", function () {
    ensureMoveendBridge(getMap());
  });

})();
