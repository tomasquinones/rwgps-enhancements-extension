(function (R) {
  "use strict";

  // ─── Color Control Helpers ──────────────────────────────────────────────

  var COLOR_DEFAULTS = {
    speedLowColor: "#4a0000",
    speedAvgColor: "#b71c1c",
    speedMaxColor: "#fdd835",
    climbsLowColor: "#0d47a1",
    climbsHighColor: "#64b5f6",
    descentsLowColor: "#1b5e20",
    descentsHighColor: "#66bb6a"
  };

  var menuColorState = {};
  var activePickerPanel = null;

  function closeActivePicker() {
    if (activePickerPanel) {
      activePickerPanel.style.display = "none";
      activePickerPanel = null;
    }
  }

  function hexToHsv(hex) {
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
  }

  function hsvToHex(h, s, v) {
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
  }

  function drawSvGradient(canvas, hue) {
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height;
    var pure = hsvToHex(hue, 1, 1);
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
  }

  function drawHueBar(canvas) {
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
  }

  function drawSvIndicator(canvas, s, v) {
    var ctx = canvas.getContext("2d");
    var x = s * canvas.width;
    var y = (1 - v) * canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.strokeStyle = v > 0.5 ? "#000" : "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawHueIndicator(canvas, h) {
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
  }

  function normalizeHex(value) {
    if (!value || typeof value !== "string") return null;
    var hex = value.trim().toLowerCase();
    if (!hex) return null;
    if (hex[0] !== "#") hex = "#" + hex;
    if (/^#[0-9a-f]{3}$/.test(hex)) {
      return "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    if (!/^#[0-9a-f]{6}$/.test(hex)) return null;
    return hex;
  }

  function loadMenuColors() {
    return browser.storage.local.get(null).then(function (stored) {
      stored = stored || {};
      var keys = Object.keys(COLOR_DEFAULTS);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        menuColorState[k] = normalizeHex(stored[k]) || COLOR_DEFAULTS[k];
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
    var hsv = hexToHsv(currentColor);

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
      drawSvGradient(svCanvas, hsv.h);
      drawSvIndicator(svCanvas, hsv.s, hsv.v);
      drawHueBar(hueCanvas);
      drawHueIndicator(hueCanvas, hsv.h);
    }

    function applyColor() {
      var color = hsvToHex(hsv.h, hsv.s, hsv.v);
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
        hsv = hexToHsv(menuColorState[storageKey] || COLOR_DEFAULTS[storageKey]);
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
      var maybe = normalizeHex(hex.value);
      hex.classList.toggle("rwgps-enhancements-color-hex-invalid", !maybe && hex.value.trim() !== "");
    });

    function commitHex() {
      var color = normalizeHex(hex.value);
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
      hsv = hexToHsv(color);
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
      hsv = hexToHsv(defaultColor);
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
    gradeColorsActive: false,
    travelDirectionActive: false,
    climbsActive: false,
    descentsActive: false,
    segmentsActive: false,
    climbTrackVisible: true,
    climbElevationActive: false,
    descentTrackVisible: true,
    descentElevationActive: false,
    segmentLabelsVisible: false,
    weatherActive: false,
    hrZonesActive: false,
    hillshadeActive: false,
    sampleTimeActive: true,
    etSampleTimeActive: true
  };

  function snapshotCarryoverState() {
    featureCarryoverState.speedColorsActive = !!R.speedColorsActive;
    featureCarryoverState.gradeColorsActive = !!R.gradeColorsActive;
    featureCarryoverState.travelDirectionActive = !!R.travelDirectionActive;
    featureCarryoverState.climbsActive = !!R.climbsActive;
    featureCarryoverState.descentsActive = !!R.descentsActive;
    featureCarryoverState.segmentsActive = !!R.segmentsActive;
    featureCarryoverState.climbTrackVisible = R.climbTrackVisible !== false;
    featureCarryoverState.climbElevationActive = !!R.climbElevationActive;
    featureCarryoverState.descentTrackVisible = R.descentTrackVisible !== false;
    featureCarryoverState.descentElevationActive = !!R.descentElevationActive;
    featureCarryoverState.segmentLabelsVisible = false;
    featureCarryoverState.weatherActive = !!R.weatherActive;
    featureCarryoverState.hrZonesActive = !!R.hrZonesActive;
    featureCarryoverState.hillshadeActive = !!R.hillshadeActive;
    featureCarryoverState.sampleTimeActive = !!R.sampleTimeActive;
    featureCarryoverState.etSampleTimeActive = !!R.etSampleTimeActive;
  }

  function applyCarryoverStateToFlags() {
    R.speedColorsActive = !!featureCarryoverState.speedColorsActive;
    R.gradeColorsActive = !!featureCarryoverState.gradeColorsActive;
    R.travelDirectionActive = !!featureCarryoverState.travelDirectionActive;
    R.climbsActive = !!featureCarryoverState.climbsActive;
    R.descentsActive = !!featureCarryoverState.descentsActive;
    R.segmentsActive = !!featureCarryoverState.segmentsActive;
    R.climbTrackVisible = featureCarryoverState.climbTrackVisible !== false;
    R.climbElevationActive = !!featureCarryoverState.climbElevationActive;
    R.descentTrackVisible = featureCarryoverState.descentTrackVisible !== false;
    R.descentElevationActive = !!featureCarryoverState.descentElevationActive;
    R.segmentLabelsVisible = false;
    R.weatherActive = !!featureCarryoverState.weatherActive;
    R.hrZonesActive = !!featureCarryoverState.hrZonesActive;
    R.hillshadeActive = !!featureCarryoverState.hillshadeActive;
    R.sampleTimeActive = !!featureCarryoverState.sampleTimeActive;
    R.etSampleTimeActive = !!featureCarryoverState.etSampleTimeActive;
  }

  async function restoreCarryoverFeatures(settings, pageInfo) {
    if (!pageInfo) return;

    if (settings.speedColorsEnabled && featureCarryoverState.speedColorsActive) {
      R.speedColorsActive = true;
      await R.enableSpeedColors();
    } else {
      R.speedColorsActive = false;
    }

    if (settings.gradeColorsEnabled && featureCarryoverState.gradeColorsActive) {
      R.gradeColorsActive = true;
      await R.enableGradeColors();
    } else {
      R.gradeColorsActive = false;
    }

    if (settings.travelDirectionEnabled && featureCarryoverState.travelDirectionActive) {
      R.travelDirectionActive = true;
      await R.enableTravelDirection();
    } else {
      R.travelDirectionActive = false;
    }

    if (settings.climbsEnabled && featureCarryoverState.climbsActive) {
      R.climbsActive = true;
      await R.enableClimbs();
      if (R.climbTrackVisible !== featureCarryoverState.climbTrackVisible) {
        R.toggleClimbTrack();
      }
      if (R.climbElevationActive !== featureCarryoverState.climbElevationActive) {
        R.toggleClimbElevation();
      }
    } else {
      R.climbsActive = false;
    }

    if (settings.descentsEnabled && featureCarryoverState.descentsActive) {
      R.descentsActive = true;
      await R.enableDescents();
      if (R.descentTrackVisible !== featureCarryoverState.descentTrackVisible) {
        R.toggleDescentTrack();
      }
      if (R.descentElevationActive !== featureCarryoverState.descentElevationActive) {
        R.toggleDescentElevation();
      }
    } else {
      R.descentsActive = false;
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

    document.addEventListener("click", function (e) {
      if (R.enhancementsMenuOpen && !container.contains(e.target)) {
        R.enhancementsMenuOpen = false;
        R.updateEnhancementsMenu(container);
      }
    });

    return container;
  }

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
        { label: "Climbs", active: R.climbsActive, toggle: function () { R.toggleClimbs(); },
          subs: [
            { label: "Track", active: R.climbTrackVisible, toggle: function () { R.toggleClimbTrack(); } },
            { label: "Elevation", active: R.climbElevationActive, toggle: function () { R.toggleClimbElevation(); } }
          ],
          colorControls: [
            { label: "Dark", storageKey: "climbsLowColor" },
            { label: "Light", storageKey: "climbsHighColor" }
          ] },
        { label: "Descents", active: R.descentsActive, toggle: function () { R.toggleDescents(); },
          subs: [
            { label: "Track", active: R.descentTrackVisible, toggle: function () { R.toggleDescentTrack(); } },
            { label: "Elevation", active: R.descentElevationActive, toggle: function () { R.toggleDescentElevation(); } }
          ],
          colorControls: [
            { label: "Dark", storageKey: "descentsLowColor" },
            { label: "Light", storageKey: "descentsHighColor" }
          ] },
        { label: "Daylight", active: R.daylightActive, toggle: function () { R.toggleDaylight(); } },
        { label: "Speed Colors", active: R.speedColorsActive, toggle: function () { R.toggleSpeedColors(); },
          colorControls: [
            { label: "Lowest", storageKey: "speedLowColor" },
            { label: "Average", storageKey: "speedAvgColor" },
            { label: "Max", storageKey: "speedMaxColor" }
          ] },
        { label: "Travel Direction", active: R.travelDirectionActive, toggle: function () { R.toggleTravelDirection(); } },
        { label: pageInfo && pageInfo.type === "trip" ? "Weather History" : "Weather Prediction", active: R.weatherActive, toggle: function () { R.toggleWeather(); } }
      );
      if (pageInfo && (pageInfo.type === "route" || pageInfo.type === "trip")) {
        items.push({ label: "Segments", active: R.segmentsActive, toggle: function () { R.toggleSegments(); } });
      }
      if (pageInfo && pageInfo.type === "trip") {
        items.push({ label: "HR Zones", active: R.hrZonesActive, toggle: function () { R.toggleHrZones(); } });
        items.push({ label: "Sample Time", active: R.sampleTimeActive, toggle: function () { R.toggleSampleTime(); } });
      }
      if (pageInfo && pageInfo.type === "route") {
        items.push({ label: "ET Sample Time", active: R.etSampleTimeActive, toggle: function () { R.toggleEtSampleTime(); } });
      }
    }
    if (pageInfo) {
      items.push({ label: "Grade Colors", active: R.gradeColorsActive, toggle: function () { R.toggleGradeColors(); } });
    }
    items.push({ label: "Hill Shading", active: R.hillshadeActive, toggle: function () { R.toggleHillshade(); }, hillshadePanel: true });
    items.sort(function (a, b) { return a.label.localeCompare(b.label); });

    for (var i = 0; i < items.length; i++) {
      (function (item) {
        var row = document.createElement("div");
        row.className = "rwgps-enhancements-item";

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

        if (item.subs && item.active) {
          for (var si = 0; si < item.subs.length; si++) {
            (function (sub) {
              var subRow = document.createElement("div");
              subRow.className = "rwgps-enhancements-item rwgps-enhancements-sub-item";

              var subLabel = document.createElement("span");
              subLabel.textContent = sub.label;

              var subSw = document.createElement("div");
              subSw.className = "rwgps-enhancements-switch" + (sub.active ? " rwgps-enhancements-switch-checked" : "");
              subSw.addEventListener("click", function (e) {
                e.stopPropagation();
                sub.toggle();
                setTimeout(function () {
                  snapshotCarryoverState();
                  R.updateEnhancementsMenu(container);
                }, 50);
              });

              subRow.appendChild(subLabel);
              subRow.appendChild(subSw);
              popover.appendChild(subRow);
            })(item.subs[si]);
          }
        }

        if (item.colorControls && item.active) {
          createColorPanel(item.colorControls, popover);
        }
        if (item.hillshadePanel && item.active) {
          R.createHillshadePanel(popover);
        }
      })(items[i]);
    }
  };

  function insertEnhancementsDropdown() {
    var existing = document.querySelector(".rwgps-enhancements-menu");
    if (existing) return;

    var dropdown = createEnhancementsDropdown();

    var rightControls = document.querySelector('[class*="rightControls"]');
    if (rightControls) {
      rightControls.appendChild(dropdown);
      return;
    }

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

  // ─── Page Lifecycle ─────────────────────────────────────────────────────

  function resetHillTrackVisibility() {
    document.dispatchEvent(new CustomEvent("rwgps-hill-track-toggle", {
      detail: JSON.stringify({ prefix: "rwgps-climbs", visible: true })
    }));
    document.dispatchEvent(new CustomEvent("rwgps-hill-track-toggle", {
      detail: JSON.stringify({ prefix: "rwgps-descents", visible: true })
    }));
  }

  function cleanupAllFeatures() {
    document.dispatchEvent(new CustomEvent("rwgps-planner-watch-stop"));
    snapshotCarryoverState();
    R.disableSpeedColors();
    R.disableGradeColors();
    R.disableTravelDirection();
    R.disableClimbs();
    R.disableDescents();
    R.disableDaylight();
    R.disableWeather();
    R.disableSegments();
    R.disableHrZones();
    R.disableHillshade();
    R.disableSampleTime();
    R.disableEtSampleTime();
    applyCarryoverStateToFlags();
    resetHillTrackVisibility();
    R.daylightActive = false;
    R.weatherActive = false;
    R.hrZonesActive = false;
    R.hillshadeActive = false;
    R.enhancementsMenuOpen = false;
    R.removeClimbsPill();
    R.removeDescentsPill();
    var menu = document.querySelector(".rwgps-enhancements-menu");
    if (menu) menu.remove();
    R.cachedTrackPoints = null;
    R.cachedSegments = null;
    R.cachedClimbs = null;
    R.cachedDescents = null;
    R.cachedSegmentMatches = null;
    R.cachedDepartedAt = null;
    R.cachedDaylightTimes = null;
    R.cachedWeatherData = null;
    R.cachedWeatherTimes = null;
    R.daylightStartDate = null;
    R.weatherStartDate = null;
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
      gradeColorsEnabled: true,
      travelDirectionEnabled: true,
      climbsEnabled: true,
      descentsEnabled: true,
      daylightEnabled: true,
      segmentsEnabled: true,
      weatherEnabled: true,
      hrZonesEnabled: true,
      hillshadeEnabled: true,
      sampleTimeEnabled: true,
      etSampleTimeEnabled: true
    });
    if (!settings) return;

    var anyEnabled = settings.speedColorsEnabled || settings.gradeColorsEnabled || settings.travelDirectionEnabled || settings.climbsEnabled || settings.descentsEnabled || settings.daylightEnabled || settings.segmentsEnabled || settings.weatherEnabled || settings.hrZonesEnabled || settings.hillshadeEnabled || settings.sampleTimeEnabled || settings.etSampleTimeEnabled;

    if (!settings.speedColorsEnabled && R.speedColorsActive) {
      R.disableSpeedColors();
      R.speedColorsActive = false;
      featureCarryoverState.speedColorsActive = false;
    }
    if (!settings.gradeColorsEnabled && R.gradeColorsActive) {
      R.disableGradeColors();
      R.gradeColorsActive = false;
      featureCarryoverState.gradeColorsActive = false;
    }
    if (!settings.travelDirectionEnabled && R.travelDirectionActive) {
      R.disableTravelDirection();
      R.travelDirectionActive = false;
      featureCarryoverState.travelDirectionActive = false;
    }
    if (!settings.climbsEnabled && R.climbsActive) {
      R.disableClimbs();
      R.climbsActive = false;
      featureCarryoverState.climbsActive = false;
    }
    if (!settings.descentsEnabled && R.descentsActive) {
      R.disableDescents();
      R.descentsActive = false;
      featureCarryoverState.descentsActive = false;
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

    if (pageKey !== R.lastTRoutePage) {
      if (R.lastTRoutePage) snapshotCarryoverState();
      if (R.speedColorsActive) R.disableSpeedColors();
      if (R.gradeColorsActive) R.disableGradeColors();
      if (R.travelDirectionActive) R.disableTravelDirection();
      if (R.climbsActive) R.disableClimbs();
      if (R.descentsActive) R.disableDescents();
      if (R.daylightActive) R.disableDaylight();
      if (R.weatherActive) R.disableWeather();
      if (R.segmentsActive) R.disableSegments();
      if (R.hrZonesActive) R.disableHrZones();
      if (R.hillshadeActive) R.disableHillshade();
      if (R.sampleTimeActive) R.disableSampleTime();
      if (R.etSampleTimeActive) R.disableEtSampleTime();
      R.cachedTrackPoints = null;
      R.cachedSegments = null;
      R.cachedClimbs = null;
      R.cachedDescents = null;
      R.cachedSegmentMatches = null;
      R.cachedDepartedAt = null;
      R.cachedDaylightTimes = null;
      R.cachedWeatherData = null;
      R.cachedWeatherTimes = null;
      R.daylightStartDate = null;
      R.weatherStartDate = null;
      document.documentElement.removeAttribute("data-speed-colors-layout");
      applyCarryoverStateToFlags();
      resetHillTrackVisibility();
      R.daylightActive = false;
      R.weatherActive = false;
      R.enhancementsMenuOpen = false;
      R.removeClimbsPill();
      R.removeDescentsPill();
    }
    R.lastTRoutePage = pageKey;

    var mapEl = await R.waitForElement('.maplibregl-map, .gm-style, [class*="MapV2"], [class*="mapContainer"]', 10000);

    var recheck = R.getPageInfo();
    if (!recheck || (recheck.type + ":" + recheck.id) !== pageKey) return;

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
