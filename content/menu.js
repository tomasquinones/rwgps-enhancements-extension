(function (R) {
  "use strict";

  // ─── Color Control Helpers ──────────────────────────────────────────────

  var COLOR_DEFAULTS = R.SPEED_COLOR_DEFAULTS;

  var menuColorState = {};
  var activePickerPanel = null;

  function closeActivePicker() {
    if (activePickerPanel) {
      activePickerPanel.style.display = "none";
      activePickerPanel = null;
    }
  }

  function loadMenuColors() {
    return browser.storage.local.get(COLOR_DEFAULTS).then(function (stored) {
      stored = stored || {};
      var keys = Object.keys(COLOR_DEFAULTS);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        menuColorState[k] = R.normalizeHex(stored[k]) || COLOR_DEFAULTS[k];
      }
    });
  }

  function saveMenuColor(storageKey, color) {
    var patch = {};
    patch[storageKey] = color;
    browser.storage.local.set(patch);
    menuColorState[storageKey] = color;
  }

  function createColorRow(label, storageKey, container) {
    var wrapper = document.createElement("div");

    var row = document.createElement("div");
    row.className = "rwgps-enhancements-color-row";

    var rowLabel = document.createElement("div");
    rowLabel.className = "rwgps-enhancements-color-label";
    rowLabel.textContent = label;

    var control = document.createElement("div");
    control.className = "rwgps-enhancements-color-control";

    var currentColor = menuColorState[storageKey] || COLOR_DEFAULTS[storageKey];
    var hsv = R.hexToHsv(currentColor);

    var swatch = document.createElement("div");
    swatch.className = "rwgps-enhancements-color-swatch";
    swatch.style.backgroundColor = currentColor;

    var hex = document.createElement("input");
    hex.type = "text";
    hex.className = "rwgps-enhancements-color-hex";
    hex.value = currentColor.toUpperCase();
    hex.maxLength = 7;
    hex.spellcheck = false;

    var panel = document.createElement("div");
    panel.className = "rwgps-enhancements-picker-panel";
    panel.style.display = "none";

    var svCanvas = document.createElement("canvas");
    svCanvas.className = "rwgps-enhancements-sv-canvas";

    var hueCanvas = document.createElement("canvas");
    hueCanvas.className = "rwgps-enhancements-hue-canvas";

    panel.appendChild(svCanvas);
    panel.appendChild(hueCanvas);

    function redrawCanvases() {
      R.drawSvGradient(svCanvas, hsv.h);
      R.drawSvIndicator(svCanvas, hsv.s, hsv.v);
      R.drawHueBar(hueCanvas);
      R.drawHueIndicator(hueCanvas, hsv.h);
    }

    function applyColor() {
      var color = R.hsvToHex(hsv.h, hsv.s, hsv.v);
      swatch.style.backgroundColor = color;
      hex.value = color.toUpperCase();
      hex.classList.remove("rwgps-enhancements-color-hex-invalid");
      saveMenuColor(storageKey, color);
    }

    swatch.addEventListener("click", function (e) {
      e.stopPropagation();
      if (panel.style.display !== "none") {
        panel.style.display = "none";
        activePickerPanel = null;
      } else {
        closeActivePicker();
        hsv = R.hexToHsv(menuColorState[storageKey] || COLOR_DEFAULTS[storageKey]);
        panel.style.display = "";
        activePickerPanel = panel;
        setTimeout(function () {
          var w = panel.offsetWidth || 160;
          svCanvas.width = w;
          svCanvas.height = Math.round(w * 0.6);
          hueCanvas.width = w;
          hueCanvas.height = 14;
          redrawCanvases();
        }, 0);
      }
    });

    function handleSv(e) {
      var rect = svCanvas.getBoundingClientRect();
      var x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      var y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
      hsv.s = x / rect.width;
      hsv.v = 1 - y / rect.height;
      redrawCanvases();
      applyColor();
    }

    svCanvas.addEventListener("mousedown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      handleSv(e);
      function onMove(e2) { handleSv(e2); }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    function handleHue(e) {
      var rect = hueCanvas.getBoundingClientRect();
      var x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      hsv.h = (x / rect.width) * 360;
      redrawCanvases();
      applyColor();
    }

    hueCanvas.addEventListener("mousedown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      handleHue(e);
      function onMove(e2) { handleHue(e2); }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    hex.addEventListener("input", function () {
      var maybe = R.normalizeHex(hex.value);
      hex.classList.toggle("rwgps-enhancements-color-hex-invalid", !maybe && hex.value.trim() !== "");
    });

    function commitHex() {
      var color = R.normalizeHex(hex.value);
      if (!color) {
        var fallback = menuColorState[storageKey] || COLOR_DEFAULTS[storageKey];
        hex.value = fallback.toUpperCase();
        swatch.style.backgroundColor = fallback;
        hex.classList.remove("rwgps-enhancements-color-hex-invalid");
        return;
      }
      hex.value = color.toUpperCase();
      swatch.style.backgroundColor = color;
      hex.classList.remove("rwgps-enhancements-color-hex-invalid");
      saveMenuColor(storageKey, color);
      hsv = R.hexToHsv(color);
      if (panel.style.display !== "none") redrawCanvases();
    }

    hex.addEventListener("blur", commitHex);
    hex.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      commitHex();
    });

    panel.addEventListener("click", function (e) { e.stopPropagation(); });
    hex.addEventListener("click", function (e) { e.stopPropagation(); });

    var resetBtn = document.createElement("button");
    resetBtn.className = "rwgps-enhancements-color-reset";
    resetBtn.title = "Reset to default";
    resetBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>';
    resetBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var defaultColor = COLOR_DEFAULTS[storageKey];
      hsv = R.hexToHsv(defaultColor);
      swatch.style.backgroundColor = defaultColor;
      hex.value = defaultColor.toUpperCase();
      hex.classList.remove("rwgps-enhancements-color-hex-invalid");
      saveMenuColor(storageKey, defaultColor);
      if (panel.style.display !== "none") redrawCanvases();
    });

    control.appendChild(resetBtn);
    control.appendChild(swatch);
    control.appendChild(hex);
    row.appendChild(rowLabel);
    row.appendChild(control);
    wrapper.appendChild(row);
    wrapper.appendChild(panel);
    container.appendChild(wrapper);
  }

  function createColorPanel(colorControls, popover) {
    var panel = document.createElement("div");
    panel.className = "rwgps-enhancements-color-panel";
    for (var i = 0; i < colorControls.length; i++) {
      createColorRow(colorControls[i].label, colorControls[i].storageKey, panel);
    }
    popover.appendChild(panel);
  }

  // ─── Enhancements Dropdown ──────────────────────────────────────────────
  var featureCarryoverState = {
    speedColorsActive: false,
    trackColorsActive: false,
    segmentsActive: false,
    weatherActive: false,
    hrZonesActive: false,
    hillshadeActive: false,
    sampleTimeActive: true,
    etSampleTimeActive: true,
    publicLandsActive: false,
    radarActive: false,
    temperatureActive: false
  };

  function snapshotCarryoverState() {
    featureCarryoverState.speedColorsActive = !!R.speedColorsActive;
    featureCarryoverState.trackColorsActive = !!R.trackColorsActive;
    featureCarryoverState.segmentsActive = !!R.segmentsActive;
    featureCarryoverState.weatherActive = !!R.weatherActive;
    featureCarryoverState.hrZonesActive = !!R.hrZonesActive;
    featureCarryoverState.hillshadeActive = !!R.hillshadeActive;
    // Sample Time exists only on trips and ET Sample Time only on routes, so
    // keep each one's remembered state while on the other page type (a route
    // visit used to switch the default-on Sample Time off for the next trip).
    var snapshotType = (R.lastTRoutePage || "").split(":")[0];
    if (snapshotType === "trip") featureCarryoverState.sampleTimeActive = !!R.sampleTimeActive;
    if (snapshotType === "route") featureCarryoverState.etSampleTimeActive = !!R.etSampleTimeActive;
    featureCarryoverState.publicLandsActive = !!R.publicLandsActive;
    featureCarryoverState.radarActive = !!R.radarActive;
    featureCarryoverState.temperatureActive = !!R.temperatureActive;
  }

  function applyCarryoverStateToFlags() {
    R.speedColorsActive = !!featureCarryoverState.speedColorsActive;
    R.trackColorsActive = !!featureCarryoverState.trackColorsActive;
    R.segmentsActive = !!featureCarryoverState.segmentsActive;
    R.weatherActive = !!featureCarryoverState.weatherActive;
    R.hrZonesActive = !!featureCarryoverState.hrZonesActive;
    R.hillshadeActive = !!featureCarryoverState.hillshadeActive;
    R.sampleTimeActive = !!featureCarryoverState.sampleTimeActive;
    R.etSampleTimeActive = !!featureCarryoverState.etSampleTimeActive;
    R.publicLandsActive = !!featureCarryoverState.publicLandsActive;
    R.radarActive = !!featureCarryoverState.radarActive;
    R.temperatureActive = !!featureCarryoverState.temperatureActive;
  }

  async function restoreCarryoverFeatures(settings, pageInfo) {
    if (!pageInfo) return;

    if (settings.speedColorsEnabled && featureCarryoverState.speedColorsActive) {
      R.speedColorsActive = true;
      await R.enableSpeedColors();
    } else {
      R.speedColorsActive = false;
    }

    if ((pageInfo.type === "route" || pageInfo.type === "trip") && settings.trackColorsEnabled && featureCarryoverState.trackColorsActive) {
      R.trackColorsActive = true;
      await R.enableTrackColors();
    } else {
      R.trackColorsActive = false;
    }

    if ((pageInfo.type === "route" || pageInfo.type === "trip") && settings.segmentsEnabled && featureCarryoverState.segmentsActive) {
      R.segmentsActive = true;
      await R.enableSegments();
    } else {
      R.segmentsActive = false;
    }

    if (settings.weatherEnabled && featureCarryoverState.weatherActive) {
      R.weatherActive = true;
      await R.enableWeather();
    } else {
      R.weatherActive = false;
    }

    if (settings.hrZonesEnabled && featureCarryoverState.hrZonesActive) {
      R.hrZonesActive = true;
      await R.enableHrZones();
    } else {
      R.hrZonesActive = false;
    }

    if (pageInfo.type === "trip" && settings.sampleTimeEnabled && featureCarryoverState.sampleTimeActive) {
      R.sampleTimeActive = true;
      await R.enableSampleTime();
    } else {
      R.sampleTimeActive = false;
    }

    if (pageInfo.type === "route" && settings.etSampleTimeEnabled && featureCarryoverState.etSampleTimeActive) {
      R.etSampleTimeActive = true;
      await R.enableEtSampleTime();
    } else {
      R.etSampleTimeActive = false;
    }

    if (settings.hillshadeEnabled && featureCarryoverState.hillshadeActive) {
      R.hillshadeActive = true;
      await R.enableHillshade();
    } else {
      R.hillshadeActive = false;
    }

    if (settings.publicLandsEnabled && featureCarryoverState.publicLandsActive) {
      R.publicLandsActive = true;
      await R.enablePublicLands();
    } else {
      R.publicLandsActive = false;
    }

    if (settings.radarEnabled && featureCarryoverState.radarActive) {
      R.radarActive = true;
      await R.enableRadar();
    } else {
      R.radarActive = false;
    }

    if (settings.temperatureEnabled && featureCarryoverState.temperatureActive) {
      R.temperatureActive = true;
      await R.enableTemperature();
    } else {
      R.temperatureActive = false;
    }
  }

  function createEnhancementsDropdown() {
    var container = document.createElement("div");
    container.className = "rwgps-enhancements-menu";

    var btn = document.createElement("button");
    btn.className = "rwgps-enhancements-btn";
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' +
      ' Enhancements ' +
      '<svg class="rwgps-enhancements-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      R.enhancementsMenuOpen = !R.enhancementsMenuOpen;
      R.updateEnhancementsMenu(container);
    });
    container.appendChild(btn);

    var popover = document.createElement("div");
    popover.className = "rwgps-enhancements-popover";
    popover.style.display = "none";
    container.appendChild(popover);

    return container;
  }

  // One outside-click handler for whichever dropdown is current (a listener
  // per created dropdown would pile up across SPA navigations).
  document.addEventListener("click", function (e) {
    if (!R.enhancementsMenuOpen) return;
    var container = document.querySelector(".rwgps-enhancements-menu");
    if (!container || container.contains(e.target)) return;
    R.enhancementsMenuOpen = false;
    R.updateEnhancementsMenu(container);
  });

  R.updateEnhancementsMenu = function (container) {
    var btn = container.querySelector(".rwgps-enhancements-btn");
    var popover = container.querySelector(".rwgps-enhancements-popover");
    var chevron = btn.querySelector(".rwgps-enhancements-chevron");

    btn.classList.toggle("rwgps-enhancements-btn-active", R.enhancementsMenuOpen);
    popover.style.display = R.enhancementsMenuOpen ? "" : "none";
    chevron.style.transform = R.enhancementsMenuOpen ? "rotate(180deg)" : "";

    if (!R.enhancementsMenuOpen) return;

    // Compute max-height so popover stays within the map area
    var btnRect = btn.getBoundingClientRect();
    var mapEl = btn.closest('.maplibregl-map, [class*="MapV2"], [class*="mapContainer"]') ||
                container.closest('.maplibregl-map, [class*="MapV2"], [class*="mapContainer"]');
    var bottomLimit = mapEl ? mapEl.getBoundingClientRect().bottom : window.innerHeight;
    var available = bottomLimit - btnRect.bottom - 16; // 16px margin
    popover.style.maxHeight = Math.max(200, available) + "px";

    popover.innerHTML = "";
    var pageInfo = R.getPageInfo();
    var isPlanner = pageInfo && pageInfo.isPlanner;

    var items = [];
    if (!isPlanner) {
      items.push(
        { label: "Daylight", active: R.daylightActive, toggle: function () { R.toggleDaylight(); } },
        { label: "Speed Colors", active: R.speedColorsActive, toggle: function () { R.toggleSpeedColors(); },
          colorControls: [
            { label: "Lowest", storageKey: "speedLowColor" },
            { label: "Average", storageKey: "speedAvgColor" },
            { label: "Max", storageKey: "speedMaxColor" }
          ] },
        { label: pageInfo && pageInfo.type === "trip" ? "Weather History" : "Weather Prediction",
          active: R.weatherActive,
          toggle: function () { R.toggleWeather(); },
          subs: [
            { label: "Temperature", active: R.weatherTempActive, toggle: function () { R.toggleWeatherSub("temp"); } },
            { label: "Precipitation", active: R.weatherPrecipActive, toggle: function () { R.toggleWeatherSub("precip"); } },
            { label: "Cloud Cover", active: R.weatherCloudActive, toggle: function () { R.toggleWeatherSub("cloud"); } },
            { label: "Wind", active: R.weatherWindActive, toggle: function () { R.toggleWeatherSub("wind"); } },
            { label: "Summary Strip", active: R.weatherStripActive, toggle: function () { R.toggleWeatherSub("strip"); } }
          ] }
      );
      if (pageInfo && (pageInfo.type === "route" || pageInfo.type === "trip")) {
        items.push({ label: "Segments", active: R.segmentsActive, toggle: function () { R.toggleSegments(); } });
        items.push({ label: "Track Colors", active: R.trackColorsActive, toggle: function () { R.toggleTrackColors(); }, trackColorsPanel: true });
      }
      if (pageInfo && pageInfo.type === "trip") {
        items.push({ label: "HR Zones", active: R.hrZonesActive, toggle: function () { R.toggleHrZones(); } });
        items.push({ label: "Sample Time", active: R.sampleTimeActive, toggle: function () { R.toggleSampleTime(); } });
      }
    }
    if (pageInfo && pageInfo.type === "route") {
      items.push({ label: "ET Sample Time", active: R.etSampleTimeActive, toggle: function () { R.toggleEtSampleTime(); } });
    }
    items.push({ label: "Hill Shading", active: R.hillshadeActive, toggle: function () { R.toggleHillshade(); }, hillshadePanel: true });
    items.sort(function (a, b) { return a.label.localeCompare(b.label); });

    var layerItems = [];
    if (pageInfo) {
      layerItems.push({ label: "Public Lands", active: R.publicLandsActive, toggle: function () { R.togglePublicLands(); } });
      layerItems.push({ label: "Weather Radar", active: R.radarActive, toggle: function () { R.toggleRadar(); },
        subs: [
          { label: "Animate (last 2 hours)", active: R.radarAnimate, toggle: function () { R.toggleRadarAnimation(); } }
        ] });
      layerItems.push({ label: "Temperature", active: R.temperatureActive, toggle: function () { R.toggleTemperature(); } });
    }
    layerItems.sort(function (a, b) { return a.label.localeCompare(b.label); });

    function addSwitchRow(item, className) {
      var row = document.createElement("div");
      row.className = className;

      var label = document.createElement("span");
      label.textContent = item.label;

      var sw = document.createElement("div");
      sw.className = "rwgps-enhancements-switch" + (item.active ? " rwgps-enhancements-switch-checked" : "");
      sw.addEventListener("click", function (e) {
        e.stopPropagation();
        item.toggle();
        setTimeout(function () {
          snapshotCarryoverState();
          R.updateEnhancementsMenu(container);
        }, 50);
      });

      row.appendChild(label);
      row.appendChild(sw);
      popover.appendChild(row);
    }

    function addItem(item) {
      addSwitchRow(item, "rwgps-enhancements-item");
      if (!item.active) return;
      if (item.subs) {
        for (var si = 0; si < item.subs.length; si++) {
          addSwitchRow(item.subs[si], "rwgps-enhancements-item rwgps-enhancements-sub-item");
        }
      }
      if (item.colorControls) createColorPanel(item.colorControls, popover);
      if (item.hillshadePanel) R.createHillshadePanel(popover);
      if (item.trackColorsPanel) R.createTrackColorsPanel(popover);
    }

    for (var i = 0; i < items.length; i++) addItem(items[i]);

    if (layerItems.length > 0) {
      var sectionHeader = document.createElement("div");
      sectionHeader.className = "rwgps-enhancements-section-header";
      sectionHeader.textContent = "Layers";
      popover.appendChild(sectionHeader);
      for (var li = 0; li < layerItems.length; li++) addItem(layerItems[li]);
    }
  };

  // Find the RWGPS "Layers" dropdown's row-level wrapper. Collect every
  // visible "Layers" text node near the top of the page, then for each one
  // walk up until a sibling contains a known peer-dropdown label ("Heatmaps",
  // "Settings", "RWGPS Cycle"). That guarantees we land on the Layers
  // wrapper at the row level, not on something nested inside another popover.
  function findLayersRowItem() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var candidates = [];
    var node;
    while ((node = walker.nextNode())) {
      var txt = (node.nodeValue || "").trim();
      if (txt !== "Layers") continue;
      var el = node.parentElement;
      if (!el) continue;
      var elRect = el.getBoundingClientRect();
      if (elRect.top > 200 || elRect.width === 0 || elRect.height === 0) continue;
      candidates.push(el);
    }
    var peer = /\b(Heatmaps|Settings|RWGPS Cycle)\b/;
    for (var k = 0; k < candidates.length; k++) {
      var cur = candidates[k];
      while (cur.parentElement) {
        var siblings = cur.parentElement.children;
        for (var j = 0; j < siblings.length; j++) {
          var sib = siblings[j];
          if (sib === cur) continue;
          if (peer.test(sib.textContent || "")) {
            return cur;
          }
        }
        cur = cur.parentElement;
      }
    }
    return null;
  }

  function placeEnhancementsFloating(dropdown) {
    var mapContainer =
      document.querySelector(".maplibregl-map") ||
      document.querySelector(".gm-style") ||
      document.querySelector('[class*="MapV2"]') ||
      document.querySelector('[class*="mapContainer"]');
    if (mapContainer) {
      var parent = mapContainer.closest('[class*="MapV2"], [class*="mapContainer"]') || mapContainer.parentElement || mapContainer;
      dropdown.classList.add("rwgps-enhancements-menu-floating");
      parent.appendChild(dropdown);
    }
  }

  var dropdownPlacementPending = false;

  function insertEnhancementsDropdown() {
    var existing = document.querySelector(".rwgps-enhancements-menu");
    if (existing || dropdownPlacementPending) return;

    var dropdown = createEnhancementsDropdown();

    // Only use the rightControls row on the planner. On routes/trips that
    // selector matches the basemap-dropdown row and the button gets clipped
    // behind the "RWGPS Cycle" dropdown.
    var pageInfo = R.getPageInfo && R.getPageInfo();
    var isPlanner = pageInfo && pageInfo.isPlanner;
    if (isPlanner) {
      var rightControls = document.querySelector('[class*="rightControls"]');
      if (rightControls) {
        rightControls.appendChild(dropdown);
        return;
      }
      placeEnhancementsFloating(dropdown);
      return;
    }

    // Routes/trips: insert inline just before the Layers dropdown. The
    // controls row is React-rendered and may appear slightly after the map,
    // so retry for a few seconds before falling back to floating.
    var attempts = 0;
    var tryInline = function () {
      attempts++;
      if (document.body.contains(dropdown)) return true;
      var layersItem = findLayersRowItem();
      if (layersItem && layersItem.parentNode) {
        dropdown.classList.add("rwgps-enhancements-menu-inline");
        // The controls row uses flex-direction: row-reverse, so inserting
        // AFTER the Layers wrapper in DOM order places us visually to its left.
        layersItem.parentNode.insertBefore(dropdown, layersItem.nextSibling);
        return true;
      }
      return false;
    };
    if (tryInline()) return;
    dropdownPlacementPending = true;
    var iv = setInterval(function () {
      if (tryInline() || attempts >= 20) {
        clearInterval(iv);
        dropdownPlacementPending = false;
        if (!document.body.contains(dropdown)) {
          placeEnhancementsFloating(dropdown);
        }
      }
    }, 200);
  }

  // ─── Page Lifecycle ─────────────────────────────────────────────────────

  function cleanupAllFeatures() {
    document.dispatchEvent(new CustomEvent("rwgps-planner-watch-stop"));
    snapshotCarryoverState();
    R.disableSpeedColors();
    R.disableTrackColors();
    R.disableDaylight();
    R.disableWeather();
    R.disableSegments();
    R.disableHrZones();
    R.disableHillshade();
    R.disableSampleTime();
    R.disableEtSampleTime();
    R.disablePublicLands();
    R.disableRadar();
    R.disableTemperature();
    applyCarryoverStateToFlags();
    R.daylightActive = false;
    R.weatherActive = false;
    R.hrZonesActive = false;
    R.hillshadeActive = false;
    R.enhancementsMenuOpen = false;
    var menu = document.querySelector(".rwgps-enhancements-menu");
    if (menu) menu.remove();
    R.cachedTrackPoints = null;
    R.cachedSegments = null;
    R.cachedSegmentMatches = null;
    R.cachedDepartedAt = null;
    R.cachedDaylightTimes = null;
    R.cachedWeatherData = null;
    R.cachedWeatherTimes = null;
    R.lastTRoutePage = null;
    document.documentElement.removeAttribute("data-speed-colors-layout");
  }

  var checkTRoutePageRunning = false;

  async function checkTRoutePage() {
    if (checkTRoutePageRunning) return;
    checkTRoutePageRunning = true;
    try {
      await checkTRoutePageInner();
    } finally {
      checkTRoutePageRunning = false;
    }
  }

  async function checkTRoutePageInner() {
    if (R.contextInvalidated) return;
    var settings = await R.safeStorageGet({
      speedColorsEnabled: true,
      trackColorsEnabled: true,
      daylightEnabled: true,
      segmentsEnabled: true,
      weatherEnabled: true,
      hrZonesEnabled: true,
      hillshadeEnabled: true,
      sampleTimeEnabled: true,
      etSampleTimeEnabled: true,
      publicLandsEnabled: true,
      radarEnabled: true,
      temperatureEnabled: true
    });
    if (!settings) return;

    var anyEnabled = settings.speedColorsEnabled || settings.trackColorsEnabled || settings.daylightEnabled || settings.segmentsEnabled || settings.weatherEnabled || settings.hrZonesEnabled || settings.hillshadeEnabled || settings.sampleTimeEnabled || settings.etSampleTimeEnabled || settings.publicLandsEnabled || settings.radarEnabled || settings.temperatureEnabled;

    if (!settings.speedColorsEnabled && R.speedColorsActive) {
      R.disableSpeedColors();
      R.speedColorsActive = false;
      featureCarryoverState.speedColorsActive = false;
    }
    if (!settings.trackColorsEnabled && R.trackColorsActive) {
      R.disableTrackColors();
      R.trackColorsActive = false;
      featureCarryoverState.trackColorsActive = false;
    }
    if (!settings.daylightEnabled && R.daylightActive) {
      R.disableDaylight();
      R.daylightActive = false;
    }
    if (!settings.segmentsEnabled && R.segmentsActive) {
      R.disableSegments();
      R.segmentsActive = false;
      featureCarryoverState.segmentsActive = false;
    }
    if (!settings.weatherEnabled && R.weatherActive) {
      R.disableWeather();
      R.weatherActive = false;
      featureCarryoverState.weatherActive = false;
    }
    if (!settings.hrZonesEnabled && R.hrZonesActive) {
      R.disableHrZones();
      R.hrZonesActive = false;
      featureCarryoverState.hrZonesActive = false;
    }
    if (!settings.hillshadeEnabled && R.hillshadeActive) {
      R.disableHillshade();
      R.hillshadeActive = false;
      featureCarryoverState.hillshadeActive = false;
    }
    if (!settings.sampleTimeEnabled && R.sampleTimeActive) {
      R.disableSampleTime();
      R.sampleTimeActive = false;
      featureCarryoverState.sampleTimeActive = false;
    }
    if (!settings.etSampleTimeEnabled && R.etSampleTimeActive) {
      R.disableEtSampleTime();
      R.etSampleTimeActive = false;
      featureCarryoverState.etSampleTimeActive = false;
    }
    if (!settings.publicLandsEnabled && R.publicLandsActive) {
      R.disablePublicLands();
      R.publicLandsActive = false;
      featureCarryoverState.publicLandsActive = false;
    }
    if (!settings.radarEnabled && R.radarActive) {
      R.disableRadar();
      R.radarActive = false;
      featureCarryoverState.radarActive = false;
    }
    if (!settings.temperatureEnabled && R.temperatureActive) {
      R.disableTemperature();
      R.temperatureActive = false;
      featureCarryoverState.temperatureActive = false;
    }

    if (!anyEnabled) {
      if (R.lastTRoutePage) cleanupAllFeatures();
      return;
    }

    var pageInfo = R.getPageInfo();
    var pageKey = pageInfo ? pageInfo.type + ":" + pageInfo.id : null;
    if (!pageInfo) {
      if (R.lastTRoutePage) cleanupAllFeatures();
      return;
    }

    var hasMenu = !!document.querySelector(".rwgps-enhancements-menu");
    if (pageKey === R.lastTRoutePage && hasMenu) {
      return;
    }
    if (pageKey === R.lastTRoutePage) {
      // Same page; React re-rendered the controls row and dropped our button.
      // Put it back without re-running every active feature.
      insertEnhancementsDropdown();
      var reinserted = document.querySelector(".rwgps-enhancements-menu");
      if (reinserted) R.updateEnhancementsMenu(reinserted);
      return;
    }

    if (pageKey !== R.lastTRoutePage) {
      if (R.lastTRoutePage) snapshotCarryoverState();
      if (R.speedColorsActive) R.disableSpeedColors();
      if (R.trackColorsActive) R.disableTrackColors();
      if (R.daylightActive) R.disableDaylight();
      if (R.weatherActive) R.disableWeather();
      if (R.segmentsActive) R.disableSegments();
      if (R.hrZonesActive) R.disableHrZones();
      if (R.hillshadeActive) R.disableHillshade();
      if (R.sampleTimeActive) R.disableSampleTime();
      if (R.etSampleTimeActive) R.disableEtSampleTime();
      if (R.publicLandsActive) R.disablePublicLands();
      if (R.radarActive) R.disableRadar();
      if (R.temperatureActive) R.disableTemperature();
      R.cachedTrackPoints = null;
      R.cachedSegments = null;
      R.cachedSegmentMatches = null;
      R.cachedDepartedAt = null;
      R.cachedDaylightTimes = null;
      R.cachedWeatherData = null;
      R.cachedWeatherTimes = null;
      document.documentElement.removeAttribute("data-speed-colors-layout");
      applyCarryoverStateToFlags();
      R.daylightActive = false;
      R.weatherActive = false;
      R.enhancementsMenuOpen = false;
    }
    R.lastTRoutePage = pageKey;

    await R.waitForElement('.maplibregl-map, .gm-style, [class*="MapV2"], [class*="mapContainer"]', 10000);

    var recheck = R.getPageInfo();
    if (!recheck || (recheck.type + ":" + recheck.id) !== pageKey) {
      // Navigated away mid-wait; forget this page so coming back to it runs
      // the full restore instead of the menu-only re-insert.
      R.lastTRoutePage = null;
      return;
    }

    insertEnhancementsDropdown();
    if (recheck.isPlanner) {
      document.dispatchEvent(new CustomEvent("rwgps-planner-watch-start"));
    }
    try {
      await loadMenuColors();
      await restoreCarryoverFeatures(settings, recheck);
    } catch (err) {
      console.error("[Enhancements] Restore failed:", err);
    }
    var menu = document.querySelector(".rwgps-enhancements-menu");
    if (menu) R.updateEnhancementsMenu(menu);
  }

  // Poll for page changes (SPA navigation)
  setInterval(checkTRoutePage, 1000);
  checkTRoutePage();

})(window.RE);
