(function (R) {
  "use strict";

  // ─── Adjustable Hill Shading ───────────────────────────────────────────
  // Provides controls to adjust MapLibre hillshade layer paint properties:
  // exaggeration (intensity) and sun angle.

  var HILLSHADE_DEFAULTS = {
    hillshadeExaggeration: 100,
    hillshadeIllumDirection: null
  };

  var DEFAULT_ILLUM_DIRECTION = 335;

  var hillshadeState = null; // loaded settings
  var hillshadeHasLayer = false;

  function loadHillshadeSettings() {
    return browser.storage.local.get(HILLSHADE_DEFAULTS).then(function (stored) {
      hillshadeState = {
        exaggeration: typeof stored.hillshadeExaggeration === "number" ? stored.hillshadeExaggeration : 100,
        illumDirection: typeof stored.hillshadeIllumDirection === "number" ? stored.hillshadeIllumDirection : null
      };
    });
  }

  function saveHillshadeSetting(key, value) {
    var patch = {};
    patch[key] = value;
    browser.storage.local.set(patch);
  }

  function dispatchHillshadeApply() {
    if (!hillshadeState) return;
    var detail = {
      exaggeration: hillshadeState.exaggeration / 100,
      illumDirection: hillshadeState.illumDirection
    };
    document.dispatchEvent(new CustomEvent("rwgps-hillshade-apply", {
      detail: JSON.stringify(detail)
    }));
  }

  function dispatchHillshadeReset() {
    document.dispatchEvent(new CustomEvent("rwgps-hillshade-reset"));
  }

  function checkHillshadeLayer() {
    return new Promise(function (resolve) {
      function onStatus(e) {
        document.removeEventListener("rwgps-hillshade-status", onStatus);
        try {
          var data = JSON.parse(e.detail);
          hillshadeHasLayer = !!data.hasHillshade;
        } catch (err) {
          hillshadeHasLayer = false;
        }
        resolve(hillshadeHasLayer);
      }
      document.addEventListener("rwgps-hillshade-status", onStatus);
      document.dispatchEvent(new CustomEvent("rwgps-hillshade-check"));
      // Timeout fallback
      setTimeout(function () {
        document.removeEventListener("rwgps-hillshade-status", onStatus);
        resolve(hillshadeHasLayer);
      }, 500);
    });
  }

  // ─── Public API ────────────────────────────────────────────────────────

  R.enableHillshade = async function () {
    if (!hillshadeState) await loadHillshadeSettings();
    R.hillshadeActive = true;
    await checkHillshadeLayer();
    if (hillshadeHasLayer) {
      dispatchHillshadeApply();
    }
  };

  R.disableHillshade = function () {
    R.hillshadeActive = false;
    dispatchHillshadeReset();
  };

  R.toggleHillshade = function () {
    if (R.hillshadeActive) {
      R.disableHillshade();
    } else {
      R.enableHillshade();
    }
  };

  // ─── Panel Builder ─────────────────────────────────────────────────────

  R.createHillshadePanel = function (popover) {
    if (!hillshadeHasLayer) return;

    var panel = document.createElement("div");
    panel.className = "rwgps-enhancements-color-panel rwgps-enhancements-hillshade-panel";

    // Intensity slider
    var intensityRow = document.createElement("div");
    intensityRow.className = "rwgps-enhancements-hillshade-slider-row";

    var intensityLabel = document.createElement("div");
    intensityLabel.className = "rwgps-enhancements-color-label";
    intensityLabel.textContent = "Intensity";

    var intensitySlider = document.createElement("input");
    intensitySlider.type = "range";
    intensitySlider.className = "rwgps-enhancements-hillshade-slider";
    intensitySlider.min = "0";
    intensitySlider.max = "500";
    intensitySlider.step = "1";
    intensitySlider.value = String(hillshadeState ? hillshadeState.exaggeration : 100);

    var intensityValue = document.createElement("span");
    intensityValue.className = "rwgps-enhancements-hillshade-value";
    intensityValue.textContent = (hillshadeState ? hillshadeState.exaggeration : 100) + "%";

    var debounceTimer = null;
    intensitySlider.addEventListener("input", function () {
      var val = parseInt(intensitySlider.value, 10);
      intensityValue.textContent = val + "%";
      if (hillshadeState) hillshadeState.exaggeration = val;
      saveHillshadeSetting("hillshadeExaggeration", val);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(dispatchHillshadeApply, 50);
    });

    intensityRow.appendChild(intensityLabel);
    intensityRow.appendChild(intensitySlider);
    intensityRow.appendChild(intensityValue);
    panel.appendChild(intensityRow);

    // Sun Angle slider
    var angleRow = document.createElement("div");
    angleRow.className = "rwgps-enhancements-hillshade-slider-row";

    var angleLabel = document.createElement("div");
    angleLabel.className = "rwgps-enhancements-color-label";
    angleLabel.textContent = "Sun Angle";

    var angleSlider = document.createElement("input");
    angleSlider.type = "range";
    angleSlider.className = "rwgps-enhancements-hillshade-slider";
    angleSlider.min = "0";
    angleSlider.max = "359";
    angleSlider.step = "1";
    var currentAngle = hillshadeState && hillshadeState.illumDirection != null ? hillshadeState.illumDirection : DEFAULT_ILLUM_DIRECTION;
    angleSlider.value = String(currentAngle);

    var angleValue = document.createElement("span");
    angleValue.className = "rwgps-enhancements-hillshade-value";
    angleValue.textContent = currentAngle + "\u00B0";

    var angleDebounce = null;
    angleSlider.addEventListener("input", function () {
      var val = parseInt(angleSlider.value, 10);
      angleValue.textContent = val + "\u00B0";
      if (hillshadeState) hillshadeState.illumDirection = val;
      saveHillshadeSetting("hillshadeIllumDirection", val);
      clearTimeout(angleDebounce);
      angleDebounce = setTimeout(dispatchHillshadeApply, 50);
    });

    angleRow.appendChild(angleLabel);
    angleRow.appendChild(angleSlider);
    angleRow.appendChild(angleValue);
    panel.appendChild(angleRow);

    // Reset button
    var resetRow = document.createElement("div");
    resetRow.style.cssText = "margin-top:6px;text-align:right;";

    var resetBtn = document.createElement("button");
    resetBtn.className = "rwgps-enhancements-color-reset";
    resetBtn.style.cssText = "width:auto;border-radius:3px;padding:2px 8px;font-size:10px;";
    resetBtn.textContent = "Reset";
    resetBtn.title = "Reset hill shading to defaults";
    resetBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      hillshadeState = { exaggeration: 100, illumDirection: null };
      browser.storage.local.set({
        hillshadeExaggeration: 100,
        hillshadeIllumDirection: null
      });
      // Reset to defaults then re-apply with default multiplier (keeps feature active).
      // Delay the re-apply so setStyle() from the reset finishes first.
      dispatchHillshadeReset();
      if (R.hillshadeActive) {
        setTimeout(dispatchHillshadeApply, 100);
      }
      // Re-render the menu to refresh controls
      var menu = document.querySelector(".rwgps-enhancements-menu");
      if (menu) R.updateEnhancementsMenu(menu);
    });

    resetRow.appendChild(resetBtn);
    panel.appendChild(resetRow);

    popover.appendChild(panel);
  };

})(window.RE);
