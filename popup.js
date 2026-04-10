(function () {
  var streaksCheckbox = document.getElementById("streaks");
  var speedColorsCheckbox = document.getElementById("speedColors");

  // Load saved settings
  browser.storage.local.get({ streaksEnabled: true, speedColorsEnabled: true }).then(function (result) {
    streaksCheckbox.checked = result.streaksEnabled;
    speedColorsCheckbox.checked = result.speedColorsEnabled;
  });

  // Save on change
  streaksCheckbox.addEventListener("change", function () {
    browser.storage.local.set({ streaksEnabled: streaksCheckbox.checked });
  });

  speedColorsCheckbox.addEventListener("change", function () {
    browser.storage.local.set({ speedColorsEnabled: speedColorsCheckbox.checked });
  });
})();
