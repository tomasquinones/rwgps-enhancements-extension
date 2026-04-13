(function (R) {
  "use strict";

  // ─── Heatmap Color & Opacity Controls ──────────────────────────────────
  // Injects color pickers and opacity sliders into the native RWGPS
  // heatmap dropdown on all map pages.

  var HEATMAP_IMG_PATTERNS = {
    global: /heatmap\.ridewithgps\.com\/.*global/,
    rides:  /heatmap\.ridewithgps\.com\/.*personal-rides/,
    routes: /heatmap\.ridewithgps\.com\/.*personal-routes/
  };

  var STORAGE_COLOR_KEYS = {
    global: "heatmapGlobalColor",
    rides:  "heatmapRidesColor",
    routes: "heatmapRoutesColor"
  };

  var STORAGE_OPACITY_KEYS = {
    global: "heatmapGlobalOpacity",
    rides:  "heatmapRidesOpacity",
    routes: "heatmapRoutesOpacity"
  };

  var heatmapColorState = {};
  var heatmapOpacityState = {};
  var activeHeatmapPicker = null;
  var lastAppliedSettings = null;

  function closeActiveHeatmapPicker() {
    if (activeHeatmapPicker) {
      activeHeatmapPicker.style.display = "none";
      activeHeatmapPicker = null;
    }
  }

  // ─── Color Picker Helpers (mirrored from menu.js using shared R.* helpers) ─

  function drawSvGradient(canvas, hue) {
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

  // ─── Storage ─────────────���───────────────────────────���────────────────

  function loadHeatmapSettings() {
    var allDefaults = {};
    var kinds = ["global", "rides", "routes"];
    for (var i = 0; i < kinds.length; i++) {
      allDefaults[STORAGE_COLOR_KEYS[kinds[i]]] = R.HEATMAP_COLOR_DEFAULTS[STORAGE_COLOR_KEYS[kinds[i]]];
      allDefaults[STORAGE_OPACITY_KEYS[kinds[i]]] = R.HEATMAP_OPACITY_DEFAULTS[STORAGE_OPACITY_KEYS[kinds[i]]];
    }
    return browser.storage.local.get(allDefaults).then(function (stored) {
      for (var j = 0; j < kinds.length; j++) {
        var ck = STORAGE_COLOR_KEYS[kinds[j]];
        var ok = STORAGE_OPACITY_KEYS[kinds[j]];
        heatmapColorState[kinds[j]] = R.normalizeHex(stored[ck]) || R.HEATMAP_COLOR_DEFAULTS[ck];
        heatmapOpacityState[kinds[j]] = typeof stored[ok] === "number" ? stored[ok] : 100;
      }
    });
  }

  function saveHeatmapColor(kind, color) {
    heatmapColorState[kind] = color;
    var patch = {};
    patch[STORAGE_COLOR_KEYS[kind]] = color;
    browser.storage.local.set(patch);
    dispatchHeatmapApply();
  }

  function saveHeatmapOpacity(kind, value) {
    heatmapOpacityState[kind] = value;
    var patch = {};
    patch[STORAGE_OPACITY_KEYS[kind]] = value;
    browser.storage.local.set(patch);
    dispatchHeatmapApply();
  }

  // ─── Event dispatch to page-bridge.js ─────────────────────────────────

  function dispatchHeatmapApply() {
    var detail = {};
    var kinds = ["global", "rides", "routes"];
    for (var i = 0; i < kinds.length; i++) {
      var kind = kinds[i];
      var targetColor = heatmapColorState[kind] || R.HEATMAP_BASE_COLORS[kind];
      var baseColor = R.HEATMAP_BASE_COLORS[kind];
      var props = R.computeRasterProps(targetColor, baseColor);
      props.opacity = (heatmapOpacityState[kind] != null ? heatmapOpacityState[kind] : 100) / 100;
      detail[kind] = props;
    }
    var settingsStr = JSON.stringify(detail);
    if (settingsStr === lastAppliedSettings) return;
    lastAppliedSettings = settingsStr;
    document.dispatchEvent(new CustomEvent("rwgps-heatmap-colors-apply", {
      detail: settingsStr
    }));
  }

  function dispatchHeatmapRemove() {
    lastAppliedSettings = null;
    document.dispatchEvent(new CustomEvent("rwgps-heatmap-colors-remove"));
  }

  // ─── UI Injection ───────────────────────���────────────────────���────────

  function classifyHeatmapImg(img) {
    var src = (img.src || "") + " " + (img.srcSet || img.getAttribute("srcset") || "");
    // Check rides/routes BEFORE global to avoid false positives
    if (HEATMAP_IMG_PATTERNS.rides.test(src)) return "rides";
    if (HEATMAP_IMG_PATTERNS.routes.test(src)) return "routes";
    if (HEATMAP_IMG_PATTERNS.global.test(src)) return "global";
    return null;
  }

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    // Check the element and its ancestors for display:none or visibility:hidden
    var node = el;
    while (node && node !== document.body) {
      var style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      // Check for collapsed/hidden height (some expandable sections use max-height:0 or height:0)
      if (style.overflow === "hidden" && node !== el) {
        var h = node.getBoundingClientRect().height;
        if (h < 2) return false;
      }
      node = node.parentElement;
    }
    return true;
  }

  function findHeatmapSections() {
    var imgs = document.querySelectorAll('img[src*="heatmap.ridewithgps.com"]');
    var sections = [];
    for (var i = 0; i < imgs.length; i++) {
      var kind = classifyHeatmapImg(imgs[i]);
      if (!kind) continue;
      // Only include sections whose img is actually visible (not collapsed/toggled off)
      if (!isElementVisible(imgs[i])) continue;
      // Walk up to find the expandable container for this heatmap section
      var container = imgs[i].closest('[class*="expandoItem"], [class*="ExpandablePopover"], [role="group"]');
      if (!container) container = imgs[i].parentElement;
      if (!container) continue;
      sections.push({ kind: kind, container: container, img: imgs[i] });
    }
    return sections;
  }

  function createHeatmapColorControl(kind) {
    var panel = document.createElement("div");
    panel.className = "rwgps-ext-heatmap-panel";
    panel.setAttribute("data-rwgps-ext-heatmap", kind);

    var currentColor = heatmapColorState[kind] || R.HEATMAP_BASE_COLORS[kind];
    var currentOpacity = heatmapOpacityState[kind] != null ? heatmapOpacityState[kind] : 100;
    var hsv = R.hexToHsv(currentColor);

    // ─── Color row ───
    var colorRow = document.createElement("div");
    colorRow.className = "rwgps-ext-heatmap-color-row";

    var colorLabel = document.createElement("div");
    colorLabel.className = "rwgps-ext-heatmap-label";
    colorLabel.textContent = "Color";

    var swatch = document.createElement("div");
    swatch.className = "rwgps-ext-heatmap-swatch";
    swatch.style.backgroundColor = currentColor;

    var hex = document.createElement("input");
    hex.type = "text";
    hex.className = "rwgps-ext-heatmap-hex";
    hex.value = currentColor.toUpperCase();
    hex.maxLength = 7;
    hex.spellcheck = false;

    var resetBtn = document.createElement("button");
    resetBtn.className = "rwgps-ext-heatmap-reset";
    resetBtn.title = "Reset to default";
    resetBtn.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>';
    resetBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var defaultColor = R.HEATMAP_BASE_COLORS[kind];
      hsv = R.hexToHsv(defaultColor);
      swatch.style.backgroundColor = defaultColor;
      hex.value = defaultColor.toUpperCase();
      hex.classList.remove("rwgps-ext-heatmap-hex-invalid");
      if (pickerPanel.style.display !== "none") redrawCanvases();
      saveHeatmapColor(kind, defaultColor);
    });

    colorRow.appendChild(colorLabel);
    colorRow.appendChild(resetBtn);
    colorRow.appendChild(swatch);
    colorRow.appendChild(hex);
    panel.appendChild(colorRow);

    // ─── Picker panel (hidden until swatch clicked) ───
    var pickerPanel = document.createElement("div");
    pickerPanel.className = "rwgps-ext-heatmap-picker-panel";
    pickerPanel.style.display = "none";

    var svCanvas = document.createElement("canvas");
    svCanvas.className = "rwgps-ext-heatmap-sv-canvas";

    var hueCanvas = document.createElement("canvas");
    hueCanvas.className = "rwgps-ext-heatmap-hue-canvas";

    pickerPanel.appendChild(svCanvas);
    pickerPanel.appendChild(hueCanvas);
    panel.appendChild(pickerPanel);

    function redrawCanvases() {
      drawSvGradient(svCanvas, hsv.h);
      drawSvIndicator(svCanvas, hsv.s, hsv.v);
      drawHueBar(hueCanvas);
      drawHueIndicator(hueCanvas, hsv.h);
    }

    function applyColor() {
      var color = R.hsvToHex(hsv.h, hsv.s, hsv.v);
      swatch.style.backgroundColor = color;
      hex.value = color.toUpperCase();
      hex.classList.remove("rwgps-ext-heatmap-hex-invalid");
      saveHeatmapColor(kind, color);
    }

    swatch.addEventListener("click", function (e) {
      e.stopPropagation();
      if (pickerPanel.style.display !== "none") {
        pickerPanel.style.display = "none";
        activeHeatmapPicker = null;
      } else {
        closeActiveHeatmapPicker();
        hsv = R.hexToHsv(heatmapColorState[kind] || R.HEATMAP_BASE_COLORS[kind]);
        pickerPanel.style.display = "";
        activeHeatmapPicker = pickerPanel;
        setTimeout(function () {
          var w = pickerPanel.offsetWidth || 160;
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
      hex.classList.toggle("rwgps-ext-heatmap-hex-invalid", !maybe && hex.value.trim() !== "");
    });

    function commitHex() {
      var color = R.normalizeHex(hex.value);
      if (!color) {
        var fallback = heatmapColorState[kind] || R.HEATMAP_BASE_COLORS[kind];
        hex.value = fallback.toUpperCase();
        swatch.style.backgroundColor = fallback;
        hex.classList.remove("rwgps-ext-heatmap-hex-invalid");
        return;
      }
      hex.value = color.toUpperCase();
      swatch.style.backgroundColor = color;
      hex.classList.remove("rwgps-ext-heatmap-hex-invalid");
      hsv = R.hexToHsv(color);
      if (pickerPanel.style.display !== "none") redrawCanvases();
      saveHeatmapColor(kind, color);
    }

    hex.addEventListener("blur", commitHex);
    hex.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      commitHex();
    });

    pickerPanel.addEventListener("click", function (e) { e.stopPropagation(); });
    hex.addEventListener("click", function (e) { e.stopPropagation(); });

    // ─── Opacity row ───
    var opacityRow = document.createElement("div");
    opacityRow.className = "rwgps-ext-heatmap-opacity-row";

    var opacityLabel = document.createElement("div");
    opacityLabel.className = "rwgps-ext-heatmap-label";
    opacityLabel.textContent = "Opacity";

    var slider = document.createElement("input");
    slider.type = "range";
    slider.className = "rwgps-ext-heatmap-opacity-slider";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.value = String(currentOpacity);

    slider.addEventListener("input", function () {
      var val = parseInt(slider.value, 10);
      saveHeatmapOpacity(kind, val);
    });

    opacityRow.appendChild(opacityLabel);
    opacityRow.appendChild(slider);
    panel.appendChild(opacityRow);

    return panel;
  }

  function injectControls() {
    var sections = findHeatmapSections();

    // Build set of currently visible kinds
    var visibleKinds = {};
    for (var i = 0; i < sections.length; i++) {
      visibleKinds[sections[i].kind] = true;
    }

    // Remove controls whose parent heatmap section is no longer visible
    var existing = document.querySelectorAll("[data-rwgps-ext-heatmap]");
    for (var j = 0; j < existing.length; j++) {
      var kind = existing[j].getAttribute("data-rwgps-ext-heatmap");
      if (!visibleKinds[kind]) {
        existing[j].remove();
      }
    }

    // Inject controls into visible sections that don't have them yet
    for (var k = 0; k < sections.length; k++) {
      var section = sections[k];
      if (section.container.querySelector('[data-rwgps-ext-heatmap="' + section.kind + '"]')) continue;
      var control = createHeatmapColorControl(section.kind);
      section.container.appendChild(control);
    }

    // Auto-size the native heatmap popover so it doesn't overlap the elevation profile
    if (sections.length > 0) {
      adjustHeatmapPopoverHeight(sections[0].container);
    }

    // Apply current settings to map
    if (R.heatmapColorsActive) {
      dispatchHeatmapApply();
    }
  }

  function adjustHeatmapPopoverHeight(child) {
    // Walk up from the injected section to find the popover container
    var popover = child.closest('[class*="PopoverMenu"], [class*="popover"], [role="menu"]');
    if (!popover) {
      // Fallback: walk up looking for position:absolute or fixed with scrollable content
      var el = child.parentElement;
      while (el && el !== document.body) {
        var pos = window.getComputedStyle(el).position;
        if (pos === "absolute" || pos === "fixed") { popover = el; break; }
        el = el.parentElement;
      }
    }
    if (!popover) return;

    // Find the map container to get the bottom boundary
    var mapEl = popover.closest('.maplibregl-map, [class*="MapV2"], [class*="mapContainer"]');
    if (!mapEl) {
      mapEl = document.querySelector('.maplibregl-map, [class*="MapV2"], [class*="mapContainer"]');
    }
    var bottomLimit = mapEl ? mapEl.getBoundingClientRect().bottom : window.innerHeight;
    var popoverTop = popover.getBoundingClientRect().top;
    var available = bottomLimit - popoverTop - 16;

    popover.style.maxHeight = Math.max(200, available) + "px";
    popover.style.overflowY = "auto";
  }

  function removeInjectedControls() {
    var panels = document.querySelectorAll("[data-rwgps-ext-heatmap]");
    for (var i = 0; i < panels.length; i++) {
      panels[i].remove();
    }
  }

  // ─── Main polling loop ────────────────────────────────────────────────

  var heatmapCheckRunning = false;

  async function checkHeatmapPage() {
    if (heatmapCheckRunning) return;
    heatmapCheckRunning = true;
    try {
      await checkHeatmapPageInner();
    } finally {
      heatmapCheckRunning = false;
    }
  }

  async function checkHeatmapPageInner() {
    var settings = await browser.storage.local.get({ heatmapColorsEnabled: true });

    if (!settings.heatmapColorsEnabled) {
      if (R.heatmapColorsActive) {
        R.heatmapColorsActive = false;
        removeInjectedControls();
        dispatchHeatmapRemove();
      }
      return;
    }

    // Only proceed if there's a map on the page
    var hasMap = !!document.querySelector(".maplibregl-map");
    if (!hasMap) return;

    // Load settings if not loaded
    if (!heatmapColorState.global) {
      await loadHeatmapSettings();
    }

    R.heatmapColorsActive = true;

    // Check for heatmap sections in the DOM and inject controls
    injectControls();

    // Apply settings (even if dropdown isn't open, in case heatmap layers are on the map)
    dispatchHeatmapApply();
  }

  setInterval(checkHeatmapPage, 1000);
  checkHeatmapPage();

})(window.RE);
