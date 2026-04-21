if (typeof browser === "undefined") { window.browser = chrome; }
(function () {
  "use strict";

  var STORAGE_DEFAULTS = {
    streaksEnabled: true,
    statsChartsEnabled: true,
    calendarStreakEnabled: true,
    climbsEnabled: true,
    daylightEnabled: true,
    descentsEnabled: true,
    segmentsEnabled: true,
    speedColorsEnabled: true,
    gradeColorsEnabled: true,
    travelDirectionEnabled: true,
    goalsEnabled: true,
    quickLapsEnabled: true,
    heatmapColorsEnabled: true,
    weatherEnabled: true,
    hrZonesEnabled: true,
    hillshadeEnabled: true
  };

  var GROUP_STORAGE_KEY = "popupGroupState";

  var CHECKBOX_CONFIG = [
    { storageKey: "streaksEnabled", el: document.getElementById("streaks") },
    { storageKey: "statsChartsEnabled", el: document.getElementById("statsCharts") },
    { storageKey: "calendarStreakEnabled", el: document.getElementById("calendarStreak") },
    { storageKey: "climbsEnabled", el: document.getElementById("climbs") },
    { storageKey: "daylightEnabled", el: document.getElementById("daylight") },
    { storageKey: "descentsEnabled", el: document.getElementById("descents") },
    { storageKey: "segmentsEnabled", el: document.getElementById("segments") },
    { storageKey: "speedColorsEnabled", el: document.getElementById("speedColors") },
    { storageKey: "gradeColorsEnabled", el: document.getElementById("gradeColors") },
    { storageKey: "travelDirectionEnabled", el: document.getElementById("travelDirection") },
    { storageKey: "goalsEnabled", el: document.getElementById("goals") },
    { storageKey: "quickLapsEnabled", el: document.getElementById("quickLaps") },
    { storageKey: "heatmapColorsEnabled", el: document.getElementById("heatmapColors") },
    { storageKey: "weatherEnabled", el: document.getElementById("weather") },
    { storageKey: "hrZonesEnabled", el: document.getElementById("hrZones") },
    { storageKey: "hillshadeEnabled", el: document.getElementById("hillshade") }
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

  // Collapsible groups
  var groups = document.querySelectorAll(".group");
  var defaultGroupState = {};
  for (var g = 0; g < groups.length; g++) {
    defaultGroupState[groups[g].getAttribute("data-group")] = "collapsed";
  }

  browser.storage.local.get({ popupGroupState: defaultGroupState }).then(function (result) {
    var state = result.popupGroupState || defaultGroupState;
    for (var gi = 0; gi < groups.length; gi++) {
      var groupName = groups[gi].getAttribute("data-group");
      if (state[groupName] === "collapsed") {
        groups[gi].classList.add("collapsed");
      }
    }
  });

  for (var h = 0; h < groups.length; h++) {
    (function (group) {
      var header = group.querySelector(".group-header");
      if (!header) return;
      header.addEventListener("click", function () {
        group.classList.toggle("collapsed");
        // Save group state
        var state = {};
        for (var si = 0; si < groups.length; si++) {
          state[groups[si].getAttribute("data-group")] =
            groups[si].classList.contains("collapsed") ? "collapsed" : "expanded";
        }
        var patch = {};
        patch[GROUP_STORAGE_KEY] = state;
        browser.storage.local.set(patch);
      });
    })(groups[h]);
  }

  // mailto links don't work natively in extension popups — open via tabs API
  var emailLink = document.querySelector(".email-icon");
  if (emailLink) {
    emailLink.addEventListener("click", function (e) {
      e.preventDefault();
      browser.tabs.create({ url: emailLink.href });
    });
  }
})();
