(function (R) {
  "use strict";

  // ─── Enhancements Dropdown ──────────────────────────────────────────────

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

    popover.innerHTML = "";
    var items = [
      { label: "Climbs", active: R.climbsActive, toggle: function () { R.toggleClimbs(); },
        subs: [
          { label: "Markers", active: R.climbLabelsVisible, toggle: function () { R.toggleClimbLabels(); } },
          { label: "Elevation", active: R.climbElevationActive, toggle: function () { R.toggleClimbElevation(); } }
        ] },
      { label: "Descents", active: R.descentsActive, toggle: function () { R.toggleDescents(); },
        subs: [
          { label: "Markers", active: R.descentLabelsVisible, toggle: function () { R.toggleDescentLabels(); } },
          { label: "Elevation", active: R.descentElevationActive, toggle: function () { R.toggleDescentElevation(); } }
        ] },
      { label: "Daylight", active: R.daylightActive, toggle: function () { R.toggleDaylight(); } },
      { label: "Speed Colors", active: R.speedColorsActive, toggle: function () { R.toggleSpeedColors(); } },
      { label: "Travel Direction", active: R.travelDirectionActive, toggle: function () { R.toggleTravelDirection(); } }
    ];
    var pageInfo = R.getPageInfo();
    if (pageInfo && pageInfo.type === "route") {
      items.push({ label: "Segments", active: R.segmentsActive, toggle: function () { R.toggleSegments(); },
        subs: [
          { label: "Labels", active: R.segmentLabelsVisible, toggle: function () { R.toggleSegmentLabels(); } }
        ] });
    }
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
                  R.updateEnhancementsMenu(container);
                }, 50);
              });

              subRow.appendChild(subLabel);
              subRow.appendChild(subSw);
              popover.appendChild(subRow);
            })(item.subs[si]);
          }
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
      document.querySelector('[class*="MapV2"]');
    if (mapContainer) {
      var parent = mapContainer.closest('[class*="MapV2"]') || mapContainer.parentElement;
      if (parent) {
        dropdown.classList.add("rwgps-enhancements-menu-floating");
        parent.appendChild(dropdown);
      }
    }
  }

  // ─── Page Lifecycle ─────────────────────────────────────────────────────

  function cleanupAllFeatures() {
    R.disableSpeedColors();
    R.disableTravelDirection();
    R.disableClimbs();
    R.disableDescents();
    R.disableDaylight();
    R.disableSegments();
    R.speedColorsActive = false;
    R.travelDirectionActive = false;
    R.climbsActive = false;
    R.descentsActive = false;
    R.segmentsActive = false;
    R.climbLabelsVisible = true;
    R.climbElevationActive = false;
    R.descentElevationActive = false;
    R.descentLabelsVisible = true;
    R.segmentLabelsVisible = true;
    R.daylightActive = false;
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
    R.daylightStartDate = null;
    R.lastTRoutePage = null;
  }

  async function checkTRoutePage() {
    var settings = await browser.storage.local.get({
      speedColorsEnabled: true,
      travelDirectionEnabled: true,
      climbsEnabled: true,
      descentsEnabled: true,
      daylightEnabled: true,
      segmentsEnabled: true
    });

    var anyEnabled = settings.speedColorsEnabled || settings.travelDirectionEnabled || settings.climbsEnabled || settings.descentsEnabled || settings.daylightEnabled || settings.segmentsEnabled;

    if (!settings.speedColorsEnabled && R.speedColorsActive) {
      R.disableSpeedColors();
      R.speedColorsActive = false;
    }
    if (!settings.travelDirectionEnabled && R.travelDirectionActive) {
      R.disableTravelDirection();
      R.travelDirectionActive = false;
    }
    if (!settings.climbsEnabled && R.climbsActive) {
      R.disableClimbs();
      R.climbsActive = false;
    }
    if (!settings.descentsEnabled && R.descentsActive) {
      R.disableDescents();
      R.descentsActive = false;
    }
    if (!settings.daylightEnabled && R.daylightActive) {
      R.disableDaylight();
      R.daylightActive = false;
    }
    if (!settings.segmentsEnabled && R.segmentsActive) {
      R.disableSegments();
      R.segmentsActive = false;
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
      if (R.speedColorsActive) R.disableSpeedColors();
      if (R.travelDirectionActive) R.disableTravelDirection();
      if (R.climbsActive) R.disableClimbs();
      if (R.descentsActive) R.disableDescents();
      if (R.daylightActive) R.disableDaylight();
      if (R.segmentsActive) R.disableSegments();
      R.cachedTrackPoints = null;
      R.cachedSegments = null;
      R.cachedClimbs = null;
      R.cachedDescents = null;
      R.cachedSegmentMatches = null;
      R.cachedDepartedAt = null;
      R.cachedDaylightTimes = null;
      R.daylightStartDate = null;
      R.speedColorsActive = false;
      R.travelDirectionActive = false;
      R.climbsActive = false;
      R.descentsActive = false;
      R.segmentsActive = false;
      R.climbLabelsVisible = true;
      R.climbElevationActive = false;
      R.descentElevationActive = false;
      R.descentLabelsVisible = true;
      R.segmentLabelsVisible = true;
      R.daylightActive = false;
      R.enhancementsMenuOpen = false;
      R.removeClimbsPill();
      R.removeDescentsPill();
    }
    R.lastTRoutePage = pageKey;

    var mapEl = await R.waitForElement('.maplibregl-map, .gm-style, [class*="MapV2"], [class*="mapContainer"]', 10000);

    var recheck = R.getPageInfo();
    if (!recheck || (recheck.type + ":" + recheck.id) !== pageKey) return;

    insertEnhancementsDropdown();
  }

  // Poll for page changes (SPA navigation)
  setInterval(checkTRoutePage, 1000);
  checkTRoutePage();

})(window.RE);
