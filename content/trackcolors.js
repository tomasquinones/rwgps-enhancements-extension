(function (R) {
  "use strict";

  // ─── Track Colors ──────────────────────────────────────────────────────
  // Recolors the native RWGPS polyline track on trip and route pages, with a
  // color picker, opacity slider, and line width slider (an accessibility aid
  // for riders who need a thicker line).
  // The actual paint-property overrides happen in page-bridge.js, which finds
  // the native track line layers and re-applies on every map style refresh.

  var DEFAULT_TRACK_COLOR = "#1e88e5";
  var DEFAULT_TRACK_OPACITY = 100;
  var DEFAULT_TRACK_WIDTH = 100; // percent of the native width

  var TRACK_DEFAULTS = {
    trackColor: DEFAULT_TRACK_COLOR,
    trackOpacity: DEFAULT_TRACK_OPACITY,
    trackWidth: DEFAULT_TRACK_WIDTH
  };

  var trackState = null; // { color, opacity, width }
  var activeTrackPicker = null;

  function closeActiveTrackPicker() {
    if (activeTrackPicker) {
      activeTrackPicker.style.display = "none";
      activeTrackPicker = null;
    }
  }

  function loadTrackSettings() {
    return browser.storage.local.get(TRACK_DEFAULTS).then(function (stored) {
      trackState = {
        color: R.normalizeHex(stored.trackColor) || DEFAULT_TRACK_COLOR,
        opacity: typeof stored.trackOpacity === "number" ? stored.trackOpacity : DEFAULT_TRACK_OPACITY,
        width: typeof stored.trackWidth === "number" ? stored.trackWidth : DEFAULT_TRACK_WIDTH
      };
    });
  }

  function saveTrackSetting(key, value) {
    var patch = {};
    patch[key] = value;
    browser.storage.local.set(patch);
  }

  // ─── Event dispatch to page-bridge.js ─────────────────────────────────

  function dispatchTrackApply() {
    if (!trackState) return;
    var detail = {
      color: trackState.color,
      opacity: (trackState.opacity != null ? trackState.opacity : 100) / 100,
      widthScale: (trackState.width != null ? trackState.width : DEFAULT_TRACK_WIDTH) / 100
    };
    document.dispatchEvent(new CustomEvent("rwgps-track-colors-apply", {
      detail: JSON.stringify(detail)
    }));
  }

  function dispatchTrackRemove() {
    document.dispatchEvent(new CustomEvent("rwgps-track-colors-remove"));
  }

  // ─── Public API ────────────────────────────────────────────────────────

  R.enableTrackColors = async function () {
    if (!trackState) await loadTrackSettings();
    R.trackColorsActive = true;
    dispatchTrackApply();
  };

  R.disableTrackColors = function () {
    R.trackColorsActive = false;
    dispatchTrackRemove();
  };

  R.toggleTrackColors = function () {
    if (R.trackColorsActive) {
      R.disableTrackColors();
    } else {
      R.enableTrackColors();
    }
  };

  // ─── Panel Builder ─────────────────────────────────────────────────────

  R.createTrackColorsPanel = function (popover) {
    if (!trackState) {
      // Settings not loaded yet; render with defaults so the UI is usable.
      trackState = { color: DEFAULT_TRACK_COLOR, opacity: DEFAULT_TRACK_OPACITY, width: DEFAULT_TRACK_WIDTH };
      loadTrackSettings().then(function () {
        var menu = document.querySelector(".rwgps-enhancements-menu");
        if (menu && R.enhancementsMenuOpen) R.updateEnhancementsMenu(menu);
      });
    }

    var panel = document.createElement("div");
    panel.className = "rwgps-enhancements-color-panel";

    var currentColor = trackState.color || DEFAULT_TRACK_COLOR;
    var currentOpacity = trackState.opacity != null ? trackState.opacity : DEFAULT_TRACK_OPACITY;
    var hsv = R.hexToHsv(currentColor);

    // ─── Color row ───
    var row = document.createElement("div");
    row.className = "rwgps-enhancements-color-row";

    var rowLabel = document.createElement("div");
    rowLabel.className = "rwgps-enhancements-color-label";
    rowLabel.textContent = "Color";

    var control = document.createElement("div");
    control.className = "rwgps-enhancements-color-control";

    var swatch = document.createElement("div");
    swatch.className = "rwgps-enhancements-color-swatch";
    swatch.style.backgroundColor = currentColor;

    var hex = document.createElement("input");
    hex.type = "text";
    hex.className = "rwgps-enhancements-color-hex";
    hex.value = currentColor.toUpperCase();
    hex.maxLength = 7;
    hex.spellcheck = false;

    var resetBtn = document.createElement("button");
    resetBtn.className = "rwgps-enhancements-color-reset";
    resetBtn.title = "Reset to default";
    resetBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>';

    var pickerPanel = document.createElement("div");
    pickerPanel.className = "rwgps-enhancements-picker-panel";
    pickerPanel.style.display = "none";

    var svCanvas = document.createElement("canvas");
    svCanvas.className = "rwgps-enhancements-sv-canvas";

    var hueCanvas = document.createElement("canvas");
    hueCanvas.className = "rwgps-enhancements-hue-canvas";

    pickerPanel.appendChild(svCanvas);
    pickerPanel.appendChild(hueCanvas);

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
      trackState.color = color;
      saveTrackSetting("trackColor", color);
      dispatchTrackApply();
    }

    resetBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      hsv = R.hexToHsv(DEFAULT_TRACK_COLOR);
      swatch.style.backgroundColor = DEFAULT_TRACK_COLOR;
      hex.value = DEFAULT_TRACK_COLOR.toUpperCase();
      hex.classList.remove("rwgps-enhancements-color-hex-invalid");
      trackState.color = DEFAULT_TRACK_COLOR;
      saveTrackSetting("trackColor", DEFAULT_TRACK_COLOR);
      if (pickerPanel.style.display !== "none") redrawCanvases();
      dispatchTrackApply();
    });

    swatch.addEventListener("click", function (e) {
      e.stopPropagation();
      if (pickerPanel.style.display !== "none") {
        pickerPanel.style.display = "none";
        activeTrackPicker = null;
      } else {
        closeActiveTrackPicker();
        hsv = R.hexToHsv(trackState.color || DEFAULT_TRACK_COLOR);
        pickerPanel.style.display = "";
        activeTrackPicker = pickerPanel;
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
      hex.classList.toggle("rwgps-enhancements-color-hex-invalid", !maybe && hex.value.trim() !== "");
    });

    function commitHex() {
      var color = R.normalizeHex(hex.value);
      if (!color) {
        var fallback = trackState.color || DEFAULT_TRACK_COLOR;
        hex.value = fallback.toUpperCase();
        swatch.style.backgroundColor = fallback;
        hex.classList.remove("rwgps-enhancements-color-hex-invalid");
        return;
      }
      hex.value = color.toUpperCase();
      swatch.style.backgroundColor = color;
      hex.classList.remove("rwgps-enhancements-color-hex-invalid");
      hsv = R.hexToHsv(color);
      trackState.color = color;
      saveTrackSetting("trackColor", color);
      if (pickerPanel.style.display !== "none") redrawCanvases();
      dispatchTrackApply();
    }

    hex.addEventListener("blur", commitHex);
    hex.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      commitHex();
    });

    pickerPanel.addEventListener("click", function (e) { e.stopPropagation(); });
    hex.addEventListener("click", function (e) { e.stopPropagation(); });

    control.appendChild(resetBtn);
    control.appendChild(swatch);
    control.appendChild(hex);
    row.appendChild(rowLabel);
    row.appendChild(control);
    panel.appendChild(row);
    panel.appendChild(pickerPanel);

    // ─── Opacity row ───
    var opacityRow = document.createElement("div");
    opacityRow.className = "rwgps-enhancements-hillshade-slider-row";

    var opacityLabel = document.createElement("div");
    opacityLabel.className = "rwgps-enhancements-color-label";
    opacityLabel.textContent = "Opacity";

    var slider = document.createElement("input");
    slider.type = "range";
    slider.className = "rwgps-enhancements-hillshade-slider";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.value = String(currentOpacity);

    var opacityValue = document.createElement("span");
    opacityValue.className = "rwgps-enhancements-hillshade-value";
    opacityValue.textContent = currentOpacity + "%";

    var opacityDebounce = null;
    slider.addEventListener("input", function () {
      var val = parseInt(slider.value, 10);
      opacityValue.textContent = val + "%";
      trackState.opacity = val;
      saveTrackSetting("trackOpacity", val);
      clearTimeout(opacityDebounce);
      opacityDebounce = setTimeout(dispatchTrackApply, 50);
    });
    slider.addEventListener("click", function (e) { e.stopPropagation(); });

    opacityRow.appendChild(opacityLabel);
    opacityRow.appendChild(slider);
    opacityRow.appendChild(opacityValue);
    panel.appendChild(opacityRow);

    // ─── Width row ───
    var currentWidth = trackState.width != null ? trackState.width : DEFAULT_TRACK_WIDTH;

    var widthRow = document.createElement("div");
    widthRow.className = "rwgps-enhancements-hillshade-slider-row";

    var widthLabel = document.createElement("div");
    widthLabel.className = "rwgps-enhancements-color-label";
    widthLabel.textContent = "Width";

    var widthSlider = document.createElement("input");
    widthSlider.type = "range";
    widthSlider.className = "rwgps-enhancements-hillshade-slider";
    widthSlider.min = "50";
    widthSlider.max = "400";
    widthSlider.step = "10";
    widthSlider.value = String(currentWidth);
    widthSlider.setAttribute("aria-label", "Track line width");

    var widthValue = document.createElement("span");
    widthValue.className = "rwgps-enhancements-hillshade-value";
    widthValue.textContent = currentWidth + "%";

    var widthDebounce = null;
    widthSlider.addEventListener("input", function () {
      var val = parseInt(widthSlider.value, 10);
      widthValue.textContent = val + "%";
      trackState.width = val;
      saveTrackSetting("trackWidth", val);
      clearTimeout(widthDebounce);
      widthDebounce = setTimeout(dispatchTrackApply, 50);
    });
    widthSlider.addEventListener("click", function (e) { e.stopPropagation(); });

    widthRow.appendChild(widthLabel);
    widthRow.appendChild(widthSlider);
    widthRow.appendChild(widthValue);
    panel.appendChild(widthRow);

    popover.appendChild(panel);
  };

})(window.RE);
