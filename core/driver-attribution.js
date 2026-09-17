(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_DRIVER_ATTRIBUTION = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var ACTIONS = Object.freeze({
    ASSIGNED: "ASSIGNED",
    CLEARED: "CLEARED"
  });
  var ENGINE_OFF_TIMEOUT_MS = 120000;

  function exactMilliseconds(value, label) {
    if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
      throw new RangeError((label || "Driver timestamp")
        + " must include Z or an explicit UTC offset");
    }
    var milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) {
      throw new RangeError((label || "Driver timestamp") + " must be valid");
    }
    return milliseconds;
  }

  function windowRange(window) {
    var start = exactMilliseconds(window && window.startUtc, "Driver window start");
    var end = exactMilliseconds(window && window.endUtc, "Driver window end");
    if (end <= start) {
      throw new RangeError("A valid assignment entitlement window is required");
    }
    return { start: start, end: end };
  }

  function canonicalAction(event) {
    if (event && (event.action === ACTIONS.ASSIGNED
      || event.action === ACTIONS.CLEARED)) {
      return event.action;
    }
    if (event && ["identify", "login"].indexOf(event.type) !== -1) {
      return ACTIONS.ASSIGNED;
    }
    if (event && event.type === "logout") {
      return ACTIONS.CLEARED;
    }
    return null;
  }

  function canonicalEvent(event, window) {
    var action = canonicalAction(event);
    var timestamp;
    try {
      timestamp = exactMilliseconds(event && event.timestamp);
    } catch (error) {
      return null;
    }
    if (!action || action === ACTIONS.ASSIGNED
      && (typeof event.driverId !== "string" || !event.driverId.trim())
      || window && window.deviceId && event.deviceId
        && event.deviceId !== window.deviceId) {
      return null;
    }
    return {
      id: typeof event.id === "string" && event.id
        ? event.id : [event.deviceId || "device", event.timestamp, action,
          event.driverId || "none"].join("::"),
      deviceId: event.deviceId || window && window.deviceId || null,
      timestamp: new Date(timestamp).toISOString(),
      action: action,
      driverId: action === ACTIONS.ASSIGNED ? event.driverId : null,
      driverDisplayName: action === ACTIONS.ASSIGNED
        && typeof event.driverDisplayName === "string"
        && event.driverDisplayName.trim()
        ? event.driverDisplayName.trim() : null,
      source: event.source || null,
      sourceType: event.sourceType || null,
      tripScope: event.tripScope || null,
      overlapSeed: event.overlapSeed === true,
      warningState: event.warningState || "NONE"
    };
  }

  function normalizedEvents(events, window) {
    var range = windowRange(window);
    var byId = new Map();
    (events || []).forEach(function (event) {
      var normalized = canonicalEvent(event, window);
      if (!normalized) {
        return;
      }
      var instant = Date.parse(normalized.timestamp);
      if (instant >= range.end
        || instant < range.start && !normalized.overlapSeed
        || byId.has(normalized.id)) {
        return;
      }
      byId.set(normalized.id, normalized);
    });
    var ordered = Array.from(byId.values()).sort(function (left, right) {
      return Date.parse(left.timestamp) - Date.parse(right.timestamp)
        || left.id.localeCompare(right.id);
    });
    var conflicts = new Set();
    var signaturesByInstant = new Map();
    ordered.forEach(function (event) {
      var key = event.deviceId + "::" + event.timestamp;
      var signature = event.action + "::" + (event.driverId || "")
        + "::" + (event.sourceType === "TripDriver" ? "trip" : "continuous");
      if (signaturesByInstant.has(key)
        && signaturesByInstant.get(key) !== signature) {
        conflicts.add(key);
      } else {
        signaturesByInstant.set(key, signature);
      }
    });
    var cleared = new Set();
    return ordered.map(function (event) {
      var key = event.deviceId + "::" + event.timestamp;
      if (!conflicts.has(key)) { return event; }
      if (cleared.has(key)) { return null; }
      cleared.add(key);
      return Object.assign({}, event, {
        action: ACTIONS.CLEARED, driverId: null, driverDisplayName: null,
        warningState: "DRIVER_CONFLICT", tripScope: null
      });
    }).filter(Boolean);
  }

  function interval(start, end, state) {
    return {
      startUtc: new Date(start).toISOString(),
      endUtc: new Date(end).toISOString(),
      driverId: state.driverId,
      driverDisplayName: state.driverDisplayName,
      label: state.driverId ? "Identified" : "Unattributed",
      identifiedAt: state.identifiedAt,
      sourceEventId: state.sourceEventId,
      source: state.source,
      warningState: state.warningState
    };
  }

  function attributionIntervals(events, window) {
    var range = windowRange(window);
    var relevant = normalizedEvents(events, window);
    var result = [];
    var cursor = range.start;
    var state = {
      driverId: null,
      driverDisplayName: null,
      identifiedAt: null,
      sourceEventId: null,
      source: null,
      warningState: "NONE"
    };

    relevant.filter(function (event) {
      return event.overlapSeed && Date.parse(event.timestamp) < range.start;
    }).forEach(function (event) {
      if (event.action === ACTIONS.CLEARED) {
        state = {
          driverId: null,
          driverDisplayName: null,
          identifiedAt: null,
          sourceEventId: event.id,
          source: event.source,
          warningState: event.warningState
        };
      } else {
        state = {
          driverId: event.driverId,
          driverDisplayName: event.driverDisplayName,
          identifiedAt: event.timestamp,
          sourceEventId: event.id,
          source: event.source,
          warningState: event.warningState
        };
      }
    });

    relevant.filter(function (event) {
      return Date.parse(event.timestamp) >= range.start;
    }).forEach(function (event) {
      var instant = Date.parse(event.timestamp);
      if (instant > cursor) {
        result.push(interval(cursor, instant, state));
      }
      if (event.action === ACTIONS.CLEARED) {
        state = {
          driverId: null,
          driverDisplayName: null,
          identifiedAt: null,
          sourceEventId: event.id,
          source: event.source,
          warningState: event.warningState
        };
      } else {
        state = {
          driverId: event.driverId,
          driverDisplayName: event.driverDisplayName,
          identifiedAt: event.timestamp,
          sourceEventId: event.id,
          source: event.source,
          warningState: event.warningState
        };
      }
      cursor = instant;
    });
    if (cursor < range.end) {
      result.push(interval(cursor, range.end, state));
    }
    return result;
  }

  // Session reconstruction consumes the canonical operating timeline. Missing
  // coverage is a continuity failure, never a fabricated Engine Off interval.
  // An overlap seed is usable only when its entire session can be replayed.
  function sessionIntervals(events, window, operatingIntervals) {
    var range = windowRange(window);
    var operating = (operatingIntervals || []).filter(function (item) {
      return Number.isFinite(item.start) && Number.isFinite(item.end)
        && item.start < item.end && item.start < range.end;
    }).slice().sort(function (left, right) { return left.start - right.start; });
    var start = Math.min(range.start, operating.length ? operating[0].start : range.start);
    var relevant = normalizedEvents(events, Object.assign({}, window, {
      startUtc: new Date(start).toISOString()
    })).filter(function (event) { return Date.parse(event.timestamp) >= start; });
    var eventIndex = 0;
    var operatingIndex = 0;
    var cursor = start;
    var active = null;
    var offSince = null;
    var reason = "AUTHENTICATION_NOT_ESTABLISHED";
    var result = [];

    function clear(code) { active = null; reason = code; }
    function assign(event) {
      if (event.action === ACTIONS.CLEARED) {
        clear(event.warningState === "DRIVER_CONFLICT" ? "DRIVER_CONFLICT" : "NATIVE_CLEAR");
        return;
      }
      var tripStart = null;
      var tripEnd = null;
      if (event.sourceType === "TripDriver") {
        var scope = event.tripScope;
        try {
          tripStart = exactMilliseconds(scope && scope.startUtc);
          tripEnd = exactMilliseconds(scope && scope.endUtc);
        } catch (error) { clear("TRIP_SCOPE_UNAVAILABLE"); return; }
        if (!scope || scope.deviceId !== window.deviceId || scope.driverId !== event.driverId
          || tripEnd <= Math.max(tripStart, cursor)) {
          clear("TRIP_SCOPE_UNAVAILABLE"); return;
        }
      }
      active = { event: event, activeFrom: Math.max(cursor, tripStart || cursor), end: tripEnd };
      reason = "NONE";
      if (offSince !== null) { offSince = cursor; }
    }

    while (cursor < range.end) {
      while (operatingIndex < operating.length && operating[operatingIndex].end <= cursor) {
        operatingIndex += 1;
      }
      var operatingAt = operating[operatingIndex];
      var covered = operatingAt && operatingAt.start <= cursor;
      var unknown = !covered || operatingAt.unavailable === true
        || !(operatingAt.engineRunning === true || operatingAt.engineOff === true
          || operatingAt.keyOn === true);
      if (!unknown && operatingAt.engineOff === true) {
        if (offSince === null) { offSince = cursor; }
      } else { offSince = null; }
      while (eventIndex < relevant.length && Date.parse(relevant[eventIndex].timestamp) <= cursor) {
        assign(relevant[eventIndex]);
        eventIndex += 1;
      }
      if (unknown) { clear("CONTINUITY_UNPROVEN"); }
      if (active && active.end !== null && cursor >= active.end) { clear("TRIP_ENDED"); }
      // If an off run ends at exactly 120 seconds, the running state above
      // cancels this timer. Longer runs end attribution at the tolerance edge.
      if (active && offSince !== null && cursor >= offSince + ENGINE_OFF_TIMEOUT_MS) {
        clear("ENGINE_OFF_TIMEOUT");
      }
      var next = range.end;
      if (operatingAt) { next = Math.min(next, covered ? operatingAt.end : operatingAt.start); }
      if (eventIndex < relevant.length) { next = Math.min(next, Date.parse(relevant[eventIndex].timestamp)); }
      if (active) {
        if (active.end !== null) { next = Math.min(next, active.end); }
        if (active.activeFrom > cursor) { next = Math.min(next, active.activeFrom); }
        if (offSince !== null) { next = Math.min(next, offSince + ENGINE_OFF_TIMEOUT_MS); }
      }
      var event = active && cursor >= active.activeFrom ? active.event : null;
      var clippedStart = Math.max(cursor, range.start);
      if (next > clippedStart) {
        var part = {
          startUtc: new Date(clippedStart).toISOString(), endUtc: new Date(next).toISOString(),
          driverId: event ? event.driverId : null,
          driverDisplayName: event ? event.driverDisplayName : null,
          label: event ? "Identified" : "Unattributed",
          identifiedAt: event ? event.timestamp : null,
          sourceEventId: event ? event.id : null, source: event ? event.source : null,
          sourceType: event ? event.sourceType : null,
          warningState: event ? event.warningState : reason,
          attributionReason: event ? "NONE" : active ? "TRIP_NOT_STARTED" : reason
        };
        var previous = result[result.length - 1];
        if (previous && previous.endUtc === part.startUtc && previous.driverId === part.driverId
          && previous.sourceEventId === part.sourceEventId
          && previous.attributionReason === part.attributionReason) {
          previous.endUtc = part.endUtc;
        } else { result.push(part); }
      }
      cursor = next;
    }
    return result;
  }

  function unionMinutes(segments) {
    var ordered = (segments || []).map(function (segment) {
      return { start: Date.parse(segment.startUtc), end: Date.parse(segment.endUtc) };
    }).filter(function (part) { return part.start < part.end; })
      .sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    var total = 0;
    var end = -Infinity;
    ordered.forEach(function (part) {
      total += Math.max(0, part.end - Math.max(part.start, end));
      end = Math.max(end, part.end);
    });
    return total / 60000;
  }

  // Sweep by driver and distinct device. Sequential truck changes are ordinary
  // sessions; only the portions with two or more active trucks are ambiguous.
  function resolveConcurrency(segments) {
    var byDriver = new Map();
    (segments || []).filter(function (part) { return part.driverId; }).forEach(function (part) {
      if (!byDriver.has(part.driverId)) { byDriver.set(part.driverId, []); }
      byDriver.get(part.driverId).push(part);
    });
    var overlaps = new Map();
    byDriver.forEach(function (parts, driverId) {
      var boundaries = [];
      parts.forEach(function (part) {
        boundaries.push({ time: Date.parse(part.startUtc), deviceId: part.deviceId, delta: 1 });
        boundaries.push({ time: Date.parse(part.endUtc), deviceId: part.deviceId, delta: -1 });
      });
      boundaries.sort(function (a, b) { return a.time - b.time; });
      var devices = new Map();
      var ambiguous = [];
      var index = 0;
      while (index < boundaries.length) {
        var time = boundaries[index].time;
        while (index < boundaries.length && boundaries[index].time === time) {
          var boundary = boundaries[index++];
          var count = (devices.get(boundary.deviceId) || 0) + boundary.delta;
          if (count) { devices.set(boundary.deviceId, count); } else { devices.delete(boundary.deviceId); }
        }
        if (devices.size > 1 && index < boundaries.length) {
          ambiguous.push({ startUtc: new Date(time).toISOString(),
            endUtc: new Date(boundaries[index].time).toISOString() });
        }
      }
      overlaps.set(driverId, ambiguous);
    });
    var attributed = [];
    (segments || []).forEach(function (part) {
      var start = Date.parse(part.startUtc);
      var end = Date.parse(part.endUtc);
      var conflicts = (overlaps.get(part.driverId) || []).filter(function (item) {
        return Date.parse(item.startUtc) < end && Date.parse(item.endUtc) > start;
      });
      var cuts = new Set([start, end]);
      conflicts.forEach(function (item) {
        cuts.add(Math.max(start, Date.parse(item.startUtc)));
        cuts.add(Math.min(end, Date.parse(item.endUtc)));
      });
      var points = Array.from(cuts).sort(function (a, b) { return a - b; });
      points.slice(0, -1).forEach(function (point, index) {
        var ambiguous = conflicts.some(function (item) {
          return Date.parse(item.startUtc) <= point && point < Date.parse(item.endUtc);
        });
        attributed.push(Object.assign({}, part, {
          startUtc: new Date(point).toISOString(), endUtc: new Date(points[index + 1]).toISOString(),
          durationMinutes: (points[index + 1] - point) / 60000
        }, ambiguous ? {
          driverId: null, driverDisplayName: null, driverLabel: "Unattributed", label: "Unattributed",
          attributionReason: "CONCURRENT_ASSIGNMENTS", warningState: "CONCURRENT_ASSIGNMENTS"
        } : {}));
      });
    });
    return { segments: attributed, overlaps: overlaps };
  }

  function currentDriverContext(events, window, timestamp) {
    var instant;
    try {
      instant = exactMilliseconds(timestamp, "Current-driver timestamp");
    } catch (error) {
      return null;
    }
    var intervalAtInstant = attributionIntervals(events, window).find(function (candidate) {
      return Date.parse(candidate.startUtc) <= instant
        && instant < Date.parse(candidate.endUtc);
    });
    return intervalAtInstant || null;
  }

  function currentDriver(events, window, timestamp) {
    var current = currentDriverContext(events, window, timestamp);
    return current && current.driverId ? current.driverId : null;
  }

  function attributeTelemetry(records, intervals) {
    return (records || []).map(function (record) {
      var instant;
      try {
        instant = exactMilliseconds(record && record.timestamp);
      } catch (error) {
        return null;
      }
      var attribution = (intervals || []).find(function (candidate) {
        return Date.parse(candidate.startUtc) <= instant
          && instant < Date.parse(candidate.endUtc);
      });
      if (!attribution) {
        return null;
      }
      return Object.assign({}, record, {
        driverId: attribution.driverId,
        driverDisplayName: attribution.driverDisplayName,
        driverAttribution: attribution.driverId ? "IDENTIFIED" : "UNATTRIBUTED"
      });
    }).filter(Boolean);
  }

  function clipDriverSessions(sessions, events, window) {
    var range = windowRange(window);
    var attribution = attributionIntervals(events, window);
    var result = [];
    (sessions || []).forEach(function (session) {
      var sessionStart;
      var sessionEnd;
      try {
        sessionStart = exactMilliseconds(session && session.startUtc);
        sessionEnd = exactMilliseconds(session && session.endUtc);
      } catch (error) {
        return;
      }
      attribution.forEach(function (driverInterval) {
        var start = Math.max(
          range.start, sessionStart, Date.parse(driverInterval.startUtc)
        );
        var end = Math.min(
          range.end, sessionEnd, Date.parse(driverInterval.endUtc)
        );
        if (start >= end) {
          return;
        }
        result.push({
          sessionId: session.id || null,
          startUtc: new Date(start).toISOString(),
          endUtc: new Date(end).toISOString(),
          driverId: driverInterval.driverId,
          driverDisplayName: driverInterval.driverDisplayName,
          label: driverInterval.driverId ? "Identified" : "Unattributed",
          sourceEventId: driverInterval.sourceEventId
        });
      });
    });
    return result;
  }

  function timelineEntries(events, window) {
    return normalizedEvents(events, window).map(function (event) {
      var identified = event.action === ACTIONS.ASSIGNED;
      var displayName = event.driverDisplayName || "Identified driver";
      return {
        id: event.id,
        deviceId: event.deviceId,
        timestamp: event.timestamp,
        kind: identified ? "DRIVER_IDENTIFIED" : "DRIVER_CLEARED",
        label: identified
          ? "Driver identified: " + displayName : "Driver cleared",
        driverDisplayName: identified ? event.driverDisplayName : null,
        source: event.source,
        warningState: event.warningState
      };
    });
  }

  return {
    ACTIONS: ACTIONS,
    ENGINE_OFF_TIMEOUT_MS: ENGINE_OFF_TIMEOUT_MS,
    sessionIntervals: sessionIntervals,
    unionMinutes: unionMinutes,
    resolveConcurrency: resolveConcurrency,
    attributeTelemetry: attributeTelemetry,
    attributionIntervals: attributionIntervals,
    clipDriverSessions: clipDriverSessions,
    currentDriver: currentDriver,
    currentDriverContext: currentDriverContext,
    normalizedEvents: normalizedEvents,
    timelineEntries: timelineEntries
  };
}));
