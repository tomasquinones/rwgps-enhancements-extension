(function (R) {
  "use strict";

  var SECTION_HEADING = "rwgps extension";
  var QUICK_LAPS_LABEL = "Quick Laps";
  var MENU_MARKER_ATTR = "data-rwgps-extension-more-injected";
  var HEADING_MARKER_ATTR = "data-rwgps-extension-more-heading";
  var DIVIDER_MARKER_ATTR = "data-rwgps-extension-more-divider";
  var ITEM_MARKER_ATTR = "data-rwgps-extension-more-item";
  var quickLapsOpenEventName = "rwgps-extension-quick-laps-open";
  var DEBUG_LOGGING = true;

  var moreMenuObserver = null;
  var tripMorePagePollId = null;
  var injectionLogCount = 0;

  function debugLog(level, message, extra) {
    if (!DEBUG_LOGGING || !window.console) return;
    var prefix = "[RWGPS Extension][Quick Laps] ";
    if (level === "warn" && console.warn) {
      if (typeof extra !== "undefined") console.warn(prefix + message, extra);
      else console.warn(prefix + message);
      return;
    }
    if (level === "error" && console.error) {
      if (typeof extra !== "undefined") console.error(prefix + message, extra);
      else console.error(prefix + message);
      return;
    }
    if (console.info) {
      if (typeof extra !== "undefined") console.info(prefix + message, extra);
      else console.info(prefix + message);
    }
  }

  function showDebugToast(message) {
    var existing = document.querySelector(".rwgps-extension-debug-toast");
    if (existing) existing.remove();

    var toast = document.createElement("div");
    toast.className = "rwgps-extension-debug-toast";
    toast.textContent = message;
    toast.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;" +
      "padding:8px 10px;background:#212121;color:#fff;border-radius:4px;" +
      "font-size:12px;font-weight:500;line-height:1.3;box-shadow:0 2px 8px rgba(0,0,0,0.25);";
    document.body.appendChild(toast);

    setTimeout(function () {
      if (toast && toast.isConnected) toast.remove();
    }, 1800);
  }

  function isTripPage() {
    if (!R.getPageInfo) return false;
    var pageInfo = R.getPageInfo();
    return !!(pageInfo && pageInfo.type === "trip");
  }

  function findTripMoreMenus() {
    var pageInfo = R.getPageInfo ? R.getPageInfo() : null;
    var tripId = pageInfo && pageInfo.type === "trip" ? String(pageInfo.id) : "";
    var menus = document.querySelectorAll("ul");
    var matches = [];

    for (var i = 0; i < menus.length; i++) {
      var menu = menus[i];
      if (!menu || !menu.isConnected) continue;
      if (menu.hasAttribute(MENU_MARKER_ATTR)) continue;
      var className = typeof menu.className === "string" ? menu.className : "";
      if (className.indexOf("PopoverMenu") < 0 && className.indexOf("popover") < 0) continue;
      if (!menu.querySelector("li")) continue;

      var text = (menu.textContent || "").toLowerCase();
      var hasExport = text.indexOf("export as file") >= 0;
      var hasPlannerText = text.indexOf("open in route planner") >= 0 || text.indexOf("open copy in route planner") >= 0;
      var hasTripPrint = tripId ? text.indexOf("print map") >= 0 : false;
      var hasPlannerHref = !!menu.querySelector('a[href*="/routes/new?importType=trip"]');
      var hasTripPrintHref = tripId ? !!menu.querySelector('a[href*="/trips/' + tripId + '/print"]') : false;
      var hasMoreMenuShape = hasExport || hasPlannerText || hasTripPrint || hasPlannerHref || hasTripPrintHref;
      if (!hasMoreMenuShape) continue;

      matches.push(menu);
    }

    return matches;
  }

  function buildHeading(menu) {
    var template = null;
    var headings = menu.querySelectorAll("li");
    for (var i = 0; i < headings.length; i++) {
      var t = (headings[i].textContent || "").trim().toLowerCase();
      if (t === "private actions") {
        template = headings[i];
        break;
      }
    }

    var heading = template ? template.cloneNode(true) : document.createElement("li");
    heading.setAttribute(HEADING_MARKER_ATTR, "1");
    heading.textContent = SECTION_HEADING;

    if (!template) {
      heading.style.cssText = "padding:10px 15px 5px 15px;font-size:12px;font-weight:600;color:#212121;user-select:none;";
    }

    return heading;
  }

  function buildDivider(menu) {
    var templateDivider = menu.querySelector("hr");
    var divider = templateDivider ? templateDivider.cloneNode(true) : document.createElement("hr");
    divider.setAttribute(DIVIDER_MARKER_ATTR, "1");
    if (!templateDivider) {
      divider.style.cssText = "border:0;border-top:1px solid #e0e0e0;margin:4px 0;";
    }
    return divider;
  }

  function closeMoreMenuIfOpen() {
    var buttons = document.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      var label = (b.textContent || "").trim().toLowerCase();
      if (label.indexOf("more") !== 0) continue;
      b.click();
      return;
    }
  }

  function onQuickLapsClick(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    var pageInfo = R.getPageInfo ? R.getPageInfo() : null;
    var detail = pageInfo && pageInfo.type === "trip" ? { tripId: pageInfo.id } : {};
    document.documentElement.setAttribute("data-rwgps-quick-laps-last-click", new Date().toISOString());
    debugLog("info", "Quick Laps clicked from More menu", detail);

    document.dispatchEvent(new CustomEvent(quickLapsOpenEventName, {
      detail: JSON.stringify(detail)
    }));
    debugLog("info", "Dispatched quick laps event", quickLapsOpenEventName);

    if (typeof R.openQuickLapsTool !== "function") {
      debugLog("warn", "No Quick Laps handler registered yet (R.openQuickLapsTool missing).");
      showDebugToast("Quick Laps click received. No handler registered yet.");
    } else {
      debugLog("info", "Quick Laps handler present; waiting for event-driven open");
    }

    closeMoreMenuIfOpen();
  }

  function buildQuickLapsItem(menu) {
    var templateInteractive = menu.querySelector("li a, li button");
    var item = (templateInteractive && templateInteractive.closest("li"))
      ? templateInteractive.closest("li").cloneNode(true)
      : document.createElement("li");

    item.setAttribute(ITEM_MARKER_ATTR, "quick-laps");

    var interactive = item.querySelector("a,button,[role='menuitem']");
    if (!interactive) {
      interactive = document.createElement("button");
      item.textContent = "";
      item.appendChild(interactive);
    }

    var tagName = interactive.tagName.toLowerCase();
    if (tagName === "a") {
      interactive.removeAttribute("href");
      interactive.setAttribute("role", "menuitem");
      interactive.tabIndex = 0;
    } else if (tagName === "button") {
      interactive.type = "button";
    }

    interactive.textContent = QUICK_LAPS_LABEL;
    interactive.addEventListener("click", onQuickLapsClick);
    interactive.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") {
        onQuickLapsClick(ev);
      }
    });

    if (!interactive.className) {
      interactive.style.cssText = "display:block;width:100%;padding:6px 15px;border:none;background:transparent;text-align:left;font-size:12px;font-weight:500;color:#424242;cursor:pointer;";
    }

    return item;
  }

  function injectIntoTripMoreMenu(menu) {
    if (!menu || menu.hasAttribute(MENU_MARKER_ATTR)) return;

    menu.appendChild(buildDivider(menu));
    menu.appendChild(buildHeading(menu));
    menu.appendChild(buildQuickLapsItem(menu));
    menu.setAttribute(MENU_MARKER_ATTR, "1");

    injectionLogCount++;
    if (injectionLogCount <= 5) {
      debugLog("info", "Injected Quick Laps into Trip More menu", { count: injectionLogCount });
    }
  }

  function injectIntoOpenTripMoreMenus() {
    if (!isTripPage()) return;
    var menus = findTripMoreMenus();
    for (var i = 0; i < menus.length; i++) {
      injectIntoTripMoreMenu(menus[i]);
    }
  }

  function startMoreMenuObserver() {
    if (moreMenuObserver) return;
    moreMenuObserver = new MutationObserver(function () {
      injectIntoOpenTripMoreMenus();
    });
    moreMenuObserver.observe(document.body, { childList: true, subtree: true });
  }

  function stopMoreMenuObserver() {
    if (!moreMenuObserver) return;
    moreMenuObserver.disconnect();
    moreMenuObserver = null;
  }

  function checkTripPage() {
    var R = window.RE;
    if (R && R.contextInvalidated) return;
    (R && R.safeStorageGet ? R.safeStorageGet({ quickLapsEnabled: true }) : browser.storage.local.get({ quickLapsEnabled: true })).then(function (result) {
      if (!result) return;
      if (!result.quickLapsEnabled) {
        stopMoreMenuObserver();
        return;
      }
      if (isTripPage()) {
        startMoreMenuObserver();
        injectIntoOpenTripMoreMenus();
        return;
      }
      stopMoreMenuObserver();
    });
  }

  tripMorePagePollId = setInterval(checkTripPage, 1000);
  checkTripPage();

  document.addEventListener(quickLapsOpenEventName, function (e) {
    debugLog("info", "Observed quick laps event listener hit", e ? e.detail : null);
  });

  R.cleanupTripMoreTools = function () {
    if (tripMorePagePollId) {
      clearInterval(tripMorePagePollId);
      tripMorePagePollId = null;
    }
    stopMoreMenuObserver();
  };
})(window.RE);
