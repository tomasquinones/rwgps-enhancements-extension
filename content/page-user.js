(function() {
  function publish() {
    var user = (window.rwgps && window.rwgps.config && window.rwgps.config.currentUser) || {};
    document.documentElement.setAttribute("data-rwgps-user-id", user.id || "");
    document.documentElement.setAttribute("data-rwgps-metric", user.metric_units ? "1" : "0");
  }
  publish();
  // Re-publish periodically in case the user data loads after initial page render
  var interval = setInterval(function() {
    publish();
    if (document.documentElement.getAttribute("data-rwgps-user-id")) {
      clearInterval(interval);
    }
  }, 500);
})();
