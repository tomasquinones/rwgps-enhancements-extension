(function () {
  var streaksCheckbox = document.getElementById("streaks");
  var climbsCheckbox = document.getElementById("climbs");
  var daylightCheckbox = document.getElementById("daylight");
  var descentsCheckbox = document.getElementById("descents");
  var segmentsCheckbox = document.getElementById("segments");
  var speedColorsCheckbox = document.getElementById("speedColors");
  var travelDirectionCheckbox = document.getElementById("travelDirection");
  var goalsCheckbox = document.getElementById("goals");

  // Load saved settings
  browser.storage.local.get({
    streaksEnabled: true,
    climbsEnabled: true,
    daylightEnabled: true,
    descentsEnabled: true,
    segmentsEnabled: true,
    speedColorsEnabled: true,
    travelDirectionEnabled: true,
    goalsEnabled: true
  }).then(function (result) {
    streaksCheckbox.checked = result.streaksEnabled;
    climbsCheckbox.checked = result.climbsEnabled;
    daylightCheckbox.checked = result.daylightEnabled;
    descentsCheckbox.checked = result.descentsEnabled;
    segmentsCheckbox.checked = result.segmentsEnabled;
    speedColorsCheckbox.checked = result.speedColorsEnabled;
    travelDirectionCheckbox.checked = result.travelDirectionEnabled;
    goalsCheckbox.checked = result.goalsEnabled;
  });

  // Save on change
  streaksCheckbox.addEventListener("change", function () {
    browser.storage.local.set({ streaksEnabled: streaksCheckbox.checked });
  });

  climbsCheckbox.addEventListener("change", function () {
    browser.storage.local.set({ climbsEnabled: climbsCheckbox.checked });
  });

  daylightCheckbox.addEventListener("change", function () {
    browser.storage.local.set({ daylightEnabled: daylightCheckbox.checked });
  });

  descentsCheckbox.addEventListener("change", function () {
    browser.storage.local.set({ descentsEnabled: descentsCheckbox.checked });
  });

  segmentsCheckbox.addEventListener("change", function () {
    browser.storage.local.set({ segmentsEnabled: segmentsCheckbox.checked });
  });

  speedColorsCheckbox.addEventListener("change", function () {
    browser.storage.local.set({ speedColorsEnabled: speedColorsCheckbox.checked });
  });

  travelDirectionCheckbox.addEventListener("change", function () {
    browser.storage.local.set({ travelDirectionEnabled: travelDirectionCheckbox.checked });
  });

  goalsCheckbox.addEventListener("change", function () {
    browser.storage.local.set({ goalsEnabled: goalsCheckbox.checked });
  });
})();
