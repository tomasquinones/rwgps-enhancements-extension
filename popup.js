(function () {
  var streaksCheckbox = document.getElementById("streaks");
  var speedColorsCheckbox = document.getElementById("speedColors");
  var travelDirectionCheckbox = document.getElementById("travelDirection");

  // Load saved settings
  browser.storage.local.get({
    streaksEnabled: true,
    speedColorsEnabled: true,
    travelDirectionEnabled: true
  }).then(function (result) {
    streaksCheckbox.checked = result.streaksEnabled;
    speedColorsCheckbox.checked = result.speedColorsEnabled;
    travelDirectionCheckbox.checked = result.travelDirectionEnabled;
  });

  // Save on change
  streaksCheckbox.addEventListener("change", function () {
    browser.storage.local.set({ streaksEnabled: streaksCheckbox.checked });
  });

  speedColorsCheckbox.addEventListener("change", function () {
    browser.storage.local.set({ speedColorsEnabled: speedColorsCheckbox.checked });
  });

  travelDirectionCheckbox.addEventListener("change", function () {
    browser.storage.local.set({ travelDirectionEnabled: travelDirectionCheckbox.checked });
  });
})();
