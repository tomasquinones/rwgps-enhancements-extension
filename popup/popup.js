(function () {
  "use strict";

  var STORAGE_DEFAULTS = {
    streaksEnabled: true,
    climbsEnabled: true,
    daylightEnabled: true,
    descentsEnabled: true,
    segmentsEnabled: true,
    speedColorsEnabled: true,
    travelDirectionEnabled: true,
    goalsEnabled: true
  };

  var streaksCheckbox = document.getElementById("streaks");
  var climbsCheckbox = document.getElementById("climbs");
  var daylightCheckbox = document.getElementById("daylight");
  var descentsCheckbox = document.getElementById("descents");
  var segmentsCheckbox = document.getElementById("segments");
  var speedColorsCheckbox = document.getElementById("speedColors");
  var travelDirectionCheckbox = document.getElementById("travelDirection");
  var goalsCheckbox = document.getElementById("goals");
  var CHECKBOX_CONFIG = [
    { storageKey: "streaksEnabled", el: streaksCheckbox },
    { storageKey: "climbsEnabled", el: climbsCheckbox },
    { storageKey: "daylightEnabled", el: daylightCheckbox },
    { storageKey: "descentsEnabled", el: descentsCheckbox },
    { storageKey: "segmentsEnabled", el: segmentsCheckbox },
    { storageKey: "speedColorsEnabled", el: speedColorsCheckbox },
    { storageKey: "travelDirectionEnabled", el: travelDirectionCheckbox },
    { storageKey: "goalsEnabled", el: goalsCheckbox }
  ];

  // Load saved settings
  browser.storage.local.get(STORAGE_DEFAULTS).then(function (result) {
    for (var ci = 0; ci < CHECKBOX_CONFIG.length; ci++) {
      var ccfg = CHECKBOX_CONFIG[ci];
      if (!ccfg.el) continue;
      ccfg.el.checked = !!result[ccfg.storageKey];
    }
  });

  // Save on change
  for (var k = 0; k < CHECKBOX_CONFIG.length; k++) {
    (function (cfg) {
      if (!cfg.el) return;
      cfg.el.addEventListener("change", function () {
        var patch = {};
        patch[cfg.storageKey] = cfg.el.checked;
        browser.storage.local.set(patch);
      });
    })(CHECKBOX_CONFIG[k]);
  }
})();
