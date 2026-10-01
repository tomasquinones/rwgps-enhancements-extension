(function (R) {
  "use strict";

  var SECTION_HEADING = "rwgps extension";
  var QUICK_LAPS_LABEL = "Quick Laps";
  var MENU_MARKER_ATTR = "data-rwgps-extension-more-injected";
  var quickLapsOpenEventName = "rwgps-extension-quick-laps-open";

  var moreMenuObserver = null;

  function isTripPage() {
    var pageInfo = R.getPageInfo();
    return !!(pageInfo && pageInfo.type === "trip");
  }

  function findTripMoreMenus() {
    var pageInfo = R.getPageInfo();
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
    heading.textContent = SECTION_HEADING;

    if (!template) {
      heading.style.cssText = "padding:10px 15px 5px 15px;font-size:12px;font-weight:600;color:#212121;user-select:none;";
    }

    return heading;
  }

  function buildDivider(menu) {
    var templateDivider = menu.querySelector("hr");
    var divider = templateDivider ? templateDivider.cloneNode(true) : document.createElement("hr");
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

    var pageInfo = R.getPageInfo();
    var detail = pageInfo && pageInfo.type === "trip" ? { tripId: pageInfo.id } : {};
    document.dispatchEvent(new CustomEvent(quickLapsOpenEventName, {
      detail: JSON.stringify(detail)
    }));

    closeMoreMenuIfOpen();
  }

  function buildQuickLapsItem(menu) {
    var templateInteractive = menu.querySelector("li a, li button");
    var item = (templateInteractive && templateInteractive.closest("li"))
      ? templateInteractive.closest("li").cloneNode(true)
      : document.createElement("li");

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
  }

  function injectIntoOpenTripMoreMenus() {
    if (!isTripPage()) return;
    var menus = findTripMoreMenus();
    for (var i = 0; i < menus.length; i++) {
      injectIntoTripMoreMenu(menus[i]);
    }
  }

  // Trip pages mutate constantly (graph hover, map markers), so scan for the
  // More menu at most once per animation frame.
  var moreMenuScanFrame = null;

  function startMoreMenuObserver() {
    if (moreMenuObserver) return;
    moreMenuObserver = new MutationObserver(function () {
      if (moreMenuScanFrame) return;
      moreMenuScanFrame = requestAnimationFrame(function () {
        moreMenuScanFrame = null;
        injectIntoOpenTripMoreMenus();
      });
    });
    moreMenuObserver.observe(document.body, { childList: true, subtree: true });
  }

  function stopMoreMenuObserver() {
    if (!moreMenuObserver) return;
    moreMenuObserver.disconnect();
    moreMenuObserver = null;
    if (moreMenuScanFrame) {
      cancelAnimationFrame(moreMenuScanFrame);
      moreMenuScanFrame = null;
    }
  }

  function checkTripPage() {
    if (R.contextInvalidated) return;
    R.safeStorageGet({ quickLapsEnabled: true }).then(function (result) {
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

  setInterval(checkTripPage, 1000);
  checkTripPage();
})(window.RE);
