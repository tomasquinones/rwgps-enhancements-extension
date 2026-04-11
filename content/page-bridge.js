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
        if (speedColorFeatures && !map.getSource("rwgps-speed-colors")) {
          addSpeedColorLayers(map, speedColorFeatures);
          document.documentElement.setAttribute("data-speed-colors-status", "active");
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
        var allLayers = [
          "rwgps-segments-line-casing", "rwgps-segments-line",
          "rwgps-climbs-line-casing", "rwgps-climbs-line",
          "rwgps-descents-line-casing", "rwgps-descents-line",
          "rwgps-speed-line-casing", "rwgps-speed-line",
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
    el.style.cssText = "position:absolute;z-index:5;pointer-events:none;" +
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
    try {
      climbFeatures = JSON.parse(e.detail);
    } catch (err) {
      climbFeatures = null;
      console.error("[Climbs] Invalid payload:", err);
      return;
    }

    startLayerWatchdog();

    var map = getMap();
    if (!map) return;
    try {
      addHillLayers(map, climbFeatures, "rwgps-climbs");
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
    try {
      descentFeatures = JSON.parse(e.detail);
    } catch (err) {
      descentFeatures = null;
      console.error("[Descents] Invalid payload:", err);
      return;
    }

    startLayerWatchdog();

    var map = getMap();
    if (!map) return;
    try {
      addHillLayers(map, descentFeatures, "rwgps-descents");
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

  document.addEventListener("rwgps-get-user-summary", function () {
    try {
      var us = window.rwgps && window.rwgps.summary && window.rwgps.summary.user_summary;
      document.documentElement.setAttribute("data-rwgps-user-summary", us ? JSON.stringify(us) : "");
    } catch (e) {
      document.documentElement.setAttribute("data-rwgps-user-summary", "");
    }
  });
})();
