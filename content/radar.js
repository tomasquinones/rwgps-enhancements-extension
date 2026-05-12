(function (R) {
  "use strict";

  // ─── RainViewer Weather Radar Overlay ──────────────────────────────────
  // Adds a translucent precipitation-radar layer on top of the map using
  // RainViewer's free public API (no key). Latest "past" frame is shown
  // as a static overlay, refreshed every 5 minutes. Animation across
  // past + nowcast frames is a future enhancement.

  var REFRESH_MS = 5 * 60 * 1000;
  var MANIFEST_URL = "https://api.rainviewer.com/public/weather-maps.json";

  var radarRefreshTimer = null;
  var lastTilePath = null;

  async function fetchManifest() {
    try {
      var resp = await fetch(MANIFEST_URL);
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) { return null; }
  }

  function buildTileUrl(host, framePath) {
    // host = "https://tilecache.rainviewer.com", framePath already starts
    // with "/v2/radar/<id>". 256 = tile size; 2 = rainbow color scheme;
    // 1_1 = smooth + show snow.
    return host + framePath + "/256/{z}/{x}/{y}/2/1_1.png";
  }

  function pickLatestFrame(manifest) {
    if (!manifest || !manifest.host || !manifest.radar || !manifest.radar.past || manifest.radar.past.length === 0) {
      return null;
    }
    var frames = manifest.radar.past;
    var latest = frames[frames.length - 1];
    return { host: manifest.host, path: latest.path };
  }

  async function applyOnce() {
    if (!R.radarActive) return;
    var manifest = await fetchManifest();
    if (!R.radarActive) return;
    var frame = pickLatestFrame(manifest);
    if (!frame) return;
    if (frame.path === lastTilePath) return; // no new data, keep current overlay
    lastTilePath = frame.path;
    var tileUrl = buildTileUrl(frame.host, frame.path);
    document.dispatchEvent(new CustomEvent("rwgps-radar-apply", {
      detail: JSON.stringify({ tiles: [tileUrl], opacity: 0.6 })
    }));
  }

  function startRefreshTimer() {
    if (radarRefreshTimer) return;
    radarRefreshTimer = setInterval(applyOnce, REFRESH_MS);
  }

  function stopRefreshTimer() {
    if (radarRefreshTimer) {
      clearInterval(radarRefreshTimer);
      radarRefreshTimer = null;
    }
  }

  R.enableRadar = async function () {
    R.radarActive = true;
    lastTilePath = null;
    await applyOnce();
    if (R.radarActive) startRefreshTimer();
  };

  R.disableRadar = function () {
    R.radarActive = false;
    stopRefreshTimer();
    lastTilePath = null;
    document.dispatchEvent(new CustomEvent("rwgps-radar-reset"));
  };

  R.toggleRadar = function () {
    if (R.radarActive) R.disableRadar();
    else R.enableRadar();
  };

})(window.RE);
