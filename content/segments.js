(function (R) {
  "use strict";

  // ─── Segments ───────────────────────────────────────────────────────────

  function buildSegmentFeatures(segmentMatches, trackPoints) {
    var features = [];
    for (var i = 0; i < segmentMatches.length; i++) {
      var sm = segmentMatches[i];
      var color = R.SEGMENT_COLORS[i % R.SEGMENT_COLORS.length];
      var startIdx = sm.startIndex != null ? sm.startIndex : sm.start_index;
      var endIdx = sm.endIndex != null ? sm.endIndex : sm.end_index;
      var segId = sm.segmentId != null ? sm.segmentId : sm.segment_id;
      var title = sm.segmentTitle || sm.segment_title || ("Segment " + segId);

      if (startIdx == null || endIdx == null) continue;
      if (startIdx >= trackPoints.length || endIdx >= trackPoints.length) continue;

      var coords = [];
      for (var j = startIdx; j <= endIdx; j++) {
        coords.push([trackPoints[j].lng, trackPoints[j].lat]);
      }
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { color: color }
      });

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [trackPoints[startIdx].lng, trackPoints[startIdx].lat] },
        properties: { markerType: "start", markerColor: color, label: title, segmentId: segId }
      });

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [trackPoints[endIdx].lng, trackPoints[endIdx].lat] },
        properties: { markerType: "end", markerColor: color, label: title, segmentId: segId }
      });
    }
    return features;
  }

  R.toggleSegments = async function () {
    R.segmentsActive = !R.segmentsActive;
    if (R.segmentsActive) {
      await R.enableSegments();
    } else {
      R.disableSegments();
    }
  };

  R.enableSegments = async function () {
    var pageInfo = R.getPageInfo();
    if (!pageInfo) return;

    if (!R.cachedTrackPoints) {
      R.cachedTrackPoints = await R.fetchTrackPoints(pageInfo.type, pageInfo.id);
      if (!R.cachedTrackPoints || R.cachedTrackPoints.length === 0) return;
    }

    if (!R.cachedSegmentMatches || R.cachedSegmentMatches.length === 0) {
      return;
    }

    var features = buildSegmentFeatures(R.cachedSegmentMatches, R.cachedTrackPoints);
    document.dispatchEvent(new CustomEvent("rwgps-segments-add", {
      detail: JSON.stringify(features)
    }));
  };

  R.disableSegments = function () {
    document.dispatchEvent(new CustomEvent("rwgps-segments-remove"));
  };

  R.toggleSegmentLabels = function () {
    R.segmentLabelsVisible = !R.segmentLabelsVisible;
    document.dispatchEvent(new CustomEvent("rwgps-segment-labels-toggle", {
      detail: JSON.stringify({ visible: R.segmentLabelsVisible })
    }));
  };

})(window.RE);
