(function () {
  "use strict";

  // ─── Page Context Bridge ───────────────────────────────────────────────
  // Injected into the page to access the maplibre Map instance via React fiber

  var script = document.createElement("script");
  script.src = browser.runtime.getURL("content/page-bridge.js");
  document.documentElement.appendChild(script);
  script.remove();

})();
