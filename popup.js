(function () {
  var streaksCheckbox = document.getElementById("streaks");
  var climbsCheckbox = document.getElementById("climbs");
  var descentsCheckbox = document.getElementById("descents");
  var speedColorsCheckbox = document.getElementById("speedColors");
  var travelDirectionCheckbox = document.getElementById("travelDirection");
  var goalsCheckbox = document.getElementById("goals");

  // Load saved settings
  browser.storage.local.get({
    streaksEnabled: true,
    climbsEnabled: true,
    descentsEnabled: true,
    speedColorsEnabled: true,
    travelDirectionEnabled: true,
    goalsEnabled: true
  }).then(function (result) {
    streaksCheckbox.checked = result.streaksEnabled;
    climbsCheckbox.checked = result.climbsEnabled;
    descentsCheckbox.checked = result.descentsEnabled;
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

  descentsCheckbox.addEventListener("change", function () {
    browser.storage.local.set({ descentsEnabled: descentsCheckbox.checked });
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
