(function (R) {
  "use strict";

  // ─── Track Colors ──────────────────────────────────────────────────────
  // Recolors the native RWGPS polyline track on trip and route pages, with a
  // color picker and opacity slider (mirrors the heatmap color controls).
  // The actual paint-property overrides happen in page-bridge.js, which finds
  // the native track line layers and re-applies on every map style refresh.

  var DEFAULT_TRACK_COLOR = "#1e88e5";
  var DEFAULT_TRACK_OPACITY = 100;

  var TRACK_DEFAULTS = {
    trackColor: DEFAULT_TRACK_COLOR,
    trackOpacity: DEFAULT_TRACK_OPACITY
  };

  var trackState = null; // { color, opacity }
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
        opacity: typeof stored.trackOpacity === "number" ? stored.trackOpacity : DEFAULT_TRACK_OPACITY
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
      opacity: (trackState.opacity != null ? trackState.opacity : 100) / 100
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

  // ─── Color Picker Helpers (mirrored from menu.js / heatmaps.js) ─────────

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

  // ─── Panel Builder ─────────────────────────────────────────────────────

  R.createTrackColorsPanel = function (popover) {
    if (!trackState) {
      // Settings not loaded yet; render with defaults so the UI is usable.
      trackState = { color: DEFAULT_TRACK_COLOR, opacity: DEFAULT_TRACK_OPACITY };
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
      drawSvGradient(svCanvas, hsv.h);
      drawSvIndicator(svCanvas, hsv.s, hsv.v);
      drawHueBar(hueCanvas);
      drawHueIndicator(hueCanvas, hsv.h);
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

    popover.appendChild(panel);
  };

})(window.RE);
