(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_HISTORICAL_ENTITLEMENT = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function milliseconds(value, label) {
    if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
      throw new RangeError((label || "timestamp") + " must be an exact ISO timestamp with a timezone");
    }
    var result = Date.parse(value);
    if (!Number.isFinite(result)) {
      throw new RangeError((label || "timestamp") + " must be an exact ISO timestamp with a timezone");
    }
    return result;
  }

  function iso(value) {
    return new Date(value).toISOString();
  }

  function bounds(record, startKey, endKey) {
    return {
      start: milliseconds(record[startKey], startKey),
      end: record[endKey] ? milliseconds(record[endKey], endKey) : Infinity
    };
  }

  function intersect(leftStart, leftEnd, rightStart, rightEnd) {
    var start = Math.max(leftStart, rightStart);
    var end = Math.min(leftEnd, rightEnd);
    return start < end ? { start: start, end: end } : null;
  }

  function assignmentWindows(configuration, profile, request, user) {
    var start = milliseconds(request.startUtc, "startUtc");
    var end = milliseconds(request.endUtc, "endUtc");
    if (end <= start) {
      throw new RangeError("endUtc must be after startUtc");
    }
    var lifecycleMode = request.lifecycleMode === true;
    var lifecycleAuthorized = lifecycleMode
      && user && user.role === "Fleetsource Administrator"
      && user.canAdministerSpotterIQ === true;
    if (lifecycleMode && !lifecycleAuthorized) {
      return [];
    }

    var facilityById = new Map((configuration.facilities || []).map(function (facility) {
      return [facility.id, facility];
    }));
    var authorizedFacilityIds = new Set(user && user.authorizedFacilityIds || []);
    var accessibleDeviceIds = new Set(user && user.accessibleDeviceIds || []);
    var windows = [];

    (profile && profile.facilityAssignments || []).forEach(function (assignment) {
      var facility = facilityById.get(assignment.facilityId);
      if (!facility || !authorizedFacilityIds.has(facility.id)) {
        return;
      }
      if (!lifecycleMode && (
        facility.customerId !== request.customerId
        || (request.facilityId && facility.id !== request.facilityId)
      )) {
        return;
      }
      var assignmentBounds = bounds(assignment, "effectiveFrom", "effectiveThrough");
      var requestedAssignment = intersect(start, end, assignmentBounds.start, assignmentBounds.end);
      if (!requestedAssignment) {
        return;
      }

      (profile.deviceAssignments || []).forEach(function (deviceAssignment) {
        if (!accessibleDeviceIds.has(deviceAssignment.myGeotabDeviceId)) {
          return;
        }
        var deviceBounds = bounds(deviceAssignment, "installedAt", "removedAt");
        var entitled = intersect(
          requestedAssignment.start,
          requestedAssignment.end,
          deviceBounds.start,
          deviceBounds.end
        );
        if (!entitled) {
          return;
        }
        windows.push({
          assetId: profile.assetId,
          deviceId: deviceAssignment.myGeotabDeviceId,
          customerId: facility.customerId,
          facilityId: facility.id,
          assignmentId: assignment.assignmentId,
          deviceAssignmentId: deviceAssignment.assignmentId,
          startUtc: iso(entitled.start),
          endUtc: iso(entitled.end)
        });
      });
    });

    return windows.sort(function (left, right) {
      return Date.parse(left.startUtc) - Date.parse(right.startUtc)
        || left.facilityId.localeCompare(right.facilityId);
    });
  }

  function pointIsEntitled(timestamp, windows) {
    var instant = milliseconds(timestamp, "activity timestamp");
    return (windows || []).some(function (window) {
      return Date.parse(window.startUtc) <= instant && instant < Date.parse(window.endUtc);
    });
  }

  function clipPointRecords(records, windows, timestampKey) {
    var key = timestampKey || "timestamp";
    return (records || []).filter(function (record) {
      return record && pointIsEntitled(record[key], windows);
    }).map(function (record) {
      return Object.assign({}, record);
    });
  }

  function clipIntervals(records, windows, startKey, endKey) {
    var from = startKey || "startUtc";
    var through = endKey || "endUtc";
    var clipped = [];
    (records || []).forEach(function (record) {
      var original = bounds(record, from, through);
      (windows || []).forEach(function (window) {
        var entitled = intersect(
          original.start,
          original.end,
          Date.parse(window.startUtc),
          Date.parse(window.endUtc)
        );
        if (!entitled) {
          return;
        }
        var item = Object.assign({}, record);
        item[from] = iso(entitled.start);
        item[through] = iso(entitled.end);
        item.entitlement = {
          customerId: window.customerId,
          facilityId: window.facilityId,
          assignmentId: window.assignmentId
        };
        item.clippedAtEntitlementBoundary = entitled.start !== original.start
          || entitled.end !== original.end;
        clipped.push(item);
      });
    });
    return clipped.sort(function (left, right) {
      return Date.parse(left[from]) - Date.parse(right[from]);
    });
  }

  function clipMoves(moves, windows) {
    var result = [];
    (moves || []).forEach(function (move) {
      var originalStart = milliseconds(move.startUtc, "move startUtc");
      var originalEnd = milliseconds(move.endUtc, "move endUtc");
      var originalDuration = originalEnd - originalStart;
      (windows || []).forEach(function (window) {
        var attributed = intersect(
          originalStart,
          originalEnd,
          Date.parse(window.startUtc),
          Date.parse(window.endUtc)
        );
        if (!attributed) {
          return;
        }
        var attributedDuration = attributed.end - attributed.start;
        result.push(Object.assign({}, move, {
          startUtc: iso(attributed.start),
          endUtc: iso(attributed.end),
          entitlement: {
            customerId: window.customerId,
            facilityId: window.facilityId,
            assignmentId: window.assignmentId
          },
          clippedAtEntitlementBoundary: attributed.start !== originalStart
            || attributed.end !== originalEnd,
          attributionFraction: originalDuration > 0
            ? attributedDuration / originalDuration : 0,
          fullyAttributed: attributed.start === originalStart
            && attributed.end === originalEnd
        }));
      });
    });
    return result.sort(function (left, right) {
      return Date.parse(left.startUtc) - Date.parse(right.startUtc);
    });
  }

  return {
    assignmentWindows: assignmentWindows,
    clipIntervals: clipIntervals,
    clipMoves: clipMoves,
    clipPointRecords: clipPointRecords,
    pointIsEntitled: pointIsEntitled
  };
}));
