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
      var signature = event.action + "::" + (event.driverId || "");
      if (signaturesByInstant.has(key)
        && signaturesByInstant.get(key) !== signature) {
        conflicts.add(key);
      } else {
        signaturesByInstant.set(key, signature);
      }
    });
    return ordered.filter(function (event) {
      return !conflicts.has(event.deviceId + "::" + event.timestamp);
    });
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
    attributeTelemetry: attributeTelemetry,
    attributionIntervals: attributionIntervals,
    clipDriverSessions: clipDriverSessions,
    currentDriver: currentDriver,
    currentDriverContext: currentDriverContext,
    normalizedEvents: normalizedEvents,
    timelineEntries: timelineEntries
  };
}));
