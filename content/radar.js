(function (R) {
  "use strict";

  // ─── RainViewer Weather Radar Overlay ──────────────────────────────────
  // Adds a translucent precipitation-radar layer on top of the map using
  // RainViewer's free public API (no key), refreshed every 5 minutes. By
  // default the latest frame is shown; with Animate on, the past frames
  // (about 2 hours at 10-minute steps) loop. RainViewer's free API no longer
  // publishes nowcast (future) frames.

  var REFRESH_MS = 5 * 60 * 1000;
  var MANIFEST_URL = "https://api.rainviewer.com/public/weather-maps.json";

  var radarRefreshTimer = null;
  var lastAppliedKey = null;

  R.radarAnimate = false;

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

  function frameLabel(frame) {
    return new Date(frame.time * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  async function applyOnce() {
    if (!R.radarActive) return;
    var manifest = await fetchManifest();
    if (!R.radarActive) return;
    if (!manifest || !manifest.host || !manifest.radar || !manifest.radar.past || manifest.radar.past.length === 0) {
      return;
    }
    var past = manifest.radar.past;
    var frames = R.radarAnimate ? past : past.slice(-1);
    var key = (R.radarAnimate ? "anim:" : "static:") + past[past.length - 1].path;
    if (key === lastAppliedKey) return; // no new data, keep current overlay
    lastAppliedKey = key;
    document.dispatchEvent(new CustomEvent("rwgps-radar-apply", {
      detail: JSON.stringify({
        frames: frames.map(function (f) {
          return { tiles: [buildTileUrl(manifest.host, f.path)], label: frameLabel(f) };
        }),
        opacity: 0.6,
        animate: R.radarAnimate
      })
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
    lastAppliedKey = null;
    await applyOnce();
    if (R.radarActive) startRefreshTimer();
  };

  R.disableRadar = function () {
    R.radarActive = false;
    stopRefreshTimer();
    lastAppliedKey = null;
    document.dispatchEvent(new CustomEvent("rwgps-radar-reset"));
  };

  R.toggleRadar = function () {
    if (R.radarActive) R.disableRadar();
    else R.enableRadar();
  };

  R.toggleRadarAnimation = function () {
    R.radarAnimate = !R.radarAnimate;
    lastAppliedKey = null;
    if (R.radarActive) applyOnce();
  };

})(window.RE);
