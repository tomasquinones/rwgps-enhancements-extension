(function (R) {
  "use strict";

  // ─── Travel Direction (marching ants) ───────────────────────────────────

  function assignSpeedTiers(segments, maxSpeed) {
    return segments.map(function (seg) {
      var totalSpeed = 0;
      for (var i = 0; i < seg.points.length; i++) {
        totalSpeed += seg.points[i].speed || 0;
      }
      var avgSpeed = seg.points.length > 0 ? totalSpeed / seg.points.length : 0;
      var bucket = R.speedToBucket(avgSpeed, maxSpeed);
      var tier = Math.min(4, Math.floor(bucket / 4));
      return {
        points: seg.points,
        speedTier: tier
      };
    });
  }

  R.toggleTravelDirection = async function () {
    R.travelDirectionActive = !R.travelDirectionActive;

    if (R.travelDirectionActive) {
      await R.enableTravelDirection();
    } else {
      R.disableTravelDirection();
    }
  };

  R.enableTravelDirection = async function () {
    var pageInfo = R.getPageInfo();
    if (!pageInfo) return;

    if (!R.cachedTrackPoints) {
      R.cachedTrackPoints = await R.fetchTrackPoints(pageInfo.type, pageInfo.id);
      if (!R.cachedTrackPoints || R.cachedTrackPoints.length === 0) return;
    }

    if (!R.cachedSegments) {
      R.cachedSegments = R.splitBySpeedColor(R.cachedTrackPoints);
    }

    var stats = R.computeSpeedStats(R.cachedTrackPoints);
    var tieredSegments = assignSpeedTiers(R.cachedSegments, stats.maxSpeed);

    var features = tieredSegments.map(function (seg) {
      return {
        type: "Feature",
        properties: { speedTier: seg.speedTier },
        geometry: {
          type: "LineString",
          coordinates: seg.points.map(function (p) { return [p.lng, p.lat]; })
        }
      };
    });

    document.dispatchEvent(new CustomEvent("rwgps-travel-direction-add", {
      detail: JSON.stringify(features)
    }));
  };

  R.disableTravelDirection = function () {
    document.dispatchEvent(new CustomEvent("rwgps-travel-direction-remove"));
  };

})(window.RE);
