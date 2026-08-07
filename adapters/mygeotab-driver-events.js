(function (root, factory) {
  "use strict";

  var client = typeof module === "object" && module.exports
    ? require("./mygeotab-client")
    : root.SIQ_MYGEOTAB_CLIENT;
  var normalization = typeof module === "object" && module.exports
    ? require("./mygeotab-normalization")
    : root.SIQ_MYGEOTAB_NORMALIZATION;
  var api = factory(client, normalization);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_MYGEOTAB_DRIVER_EVENTS = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  client,
  normalization
) {
  "use strict";

  var ASSIGNMENT_TYPES = Object.freeze([
    "Driver",
    "DriverKey",
    "DriverVehicleChange",
    "TripDriver"
  ]);
  var CLEAR_TYPES = Object.freeze(["ResetDriver"]);
  var SOURCE = "MyGeotab DriverChange";

  function finding(code, message, sourceEventId) {
    return {
      code: code,
      message: message,
      sourceEventId: sourceEventId || null
    };
  }

  function text(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function rawValue(record, lower, upper) {
    return record && Object.prototype.hasOwnProperty.call(record, lower)
      ? record[lower] : record && record[upper];
  }

  function isUnknownDriverId(driverId) {
    return text(driverId) && /^UnknownDriver(?:Id)?$/i.test(driverId.trim());
  }

  function exactRange(request) {
    var fromDate = normalization.exactIso(request && request.fromDate);
    var toDate = normalization.exactIso(request && request.toDate);
    if (!request || !text(request.deviceId) || !fromDate || !toDate
      || Date.parse(toDate) <= Date.parse(fromDate)) {
      throw new RangeError(
        "DriverChange requests require one device and an exact positive date range"
      );
    }
    return {
      deviceId: request.deviceId,
      fromDate: fromDate,
      toDate: toDate
    };
  }

  function driverChangeCall(request) {
    var range = exactRange(request);
    return ["Get", {
      typeName: "DriverChange",
      search: {
        deviceSearch: { id: range.deviceId },
        fromDate: range.fromDate,
        toDate: range.toDate,
        includeOverlappedChanges: false
      },
      resultsLimit: 50000,
      sort: {
        sortBy: "date",
        sortDirection: "asc"
      }
    }];
  }

  function userCall(driverId) {
    if (!text(driverId) || isUnknownDriverId(driverId)) {
      throw new RangeError("A concrete referenced driver ID is required");
    }
    return ["Get", {
      typeName: "User",
      search: { id: driverId },
      resultsLimit: 1,
      propertySelector: {
        fields: ["id", "firstName", "lastName"],
        isIncluded: true
      }
    }];
  }

  function normalizeDriverChange(record, allowedDeviceIds) {
    if (!record || typeof record !== "object") {
      return null;
    }
    var id = rawValue(record, "id", "Id");
    var deviceId = normalization.referenceId(rawValue(record, "device", "Device"));
    var timestamp = normalization.exactIso(rawValue(record, "dateTime", "DateTime"));
    var sourceType = rawValue(record, "type", "Type");
    var driverId = normalization.referenceId(rawValue(record, "driver", "Driver"));
    if (!text(id) || !text(deviceId) || !timestamp || !text(sourceType)
      || allowedDeviceIds && !allowedDeviceIds.has(deviceId)) {
      return null;
    }
    var action = null;
    if (CLEAR_TYPES.indexOf(sourceType) !== -1) {
      action = "CLEARED";
      driverId = null;
    } else if (ASSIGNMENT_TYPES.indexOf(sourceType) !== -1) {
      if (isUnknownDriverId(driverId)) {
        action = "CLEARED";
        driverId = null;
      } else if (text(driverId)) {
        action = "ASSIGNED";
      }
    }
    if (!action) {
      return null;
    }
    return {
      id: id,
      deviceId: deviceId,
      timestamp: timestamp,
      action: action,
      driverId: driverId,
      driverDisplayName: null,
      source: SOURCE,
      sourceType: sourceType,
      warningState: "NONE"
    };
  }

  function normalizeIdentity(record, expectedId) {
    var id = normalization.referenceId(record && (record.id || record.Id));
    if (!id || id !== expectedId) {
      return null;
    }
    var firstName = rawValue(record, "firstName", "FirstName");
    var lastName = rawValue(record, "lastName", "LastName");
    var displayName = [firstName, lastName].filter(text).map(function (value) {
      return value.trim();
    }).join(" ");
    return {
      id: id,
      displayName: displayName || null
    };
  }

  function dedupeEvents(events) {
    var byId = new Map();
    (events || []).forEach(function (event) {
      if (!event || !event.id) {
        return;
      }
      if (!byId.has(event.id)) {
        byId.set(event.id, event);
      }
    });
    return Array.from(byId.values()).sort(function (left, right) {
      return Date.parse(left.timestamp) - Date.parse(right.timestamp)
        || left.deviceId.localeCompare(right.deviceId)
        || left.id.localeCompare(right.id);
    });
  }

  async function resolveIdentities(api, events, priorIdentities) {
    var identities = new Map(priorIdentities || []);
    var requiredIds = Array.from(new Set((events || []).map(function (event) {
      return event.action === "ASSIGNED" ? event.driverId : null;
    }).filter(function (driverId) {
      return text(driverId) && !identities.has(driverId);
    })));
    if (requiredIds.length) {
      try {
        var batches = await client.safeMultiCall(
          api,
          requiredIds.map(userCall)
        );
        requiredIds.forEach(function (driverId, index) {
          identities.set(
            driverId,
            normalizeIdentity((batches[index] || [])[0], driverId)
              || { id: driverId, displayName: null }
          );
        });
      } catch (error) {
        requiredIds.forEach(function (driverId) {
          identities.set(driverId, { id: driverId, displayName: null });
        });
      }
    }
    return identities;
  }

  async function fetchAuthorizedDriverEvents(api, requests, priorIdentities) {
    var ranges = (requests || []).map(exactRange);
    if (!ranges.length) {
      return {
        ok: true,
        events: [],
        findings: [],
        identities: new Map(priorIdentities || [])
      };
    }
    var batches = await client.safeMultiCall(
      api,
      ranges.map(driverChangeCall)
    );
    var findings = [];
    var events = [];
    batches.forEach(function (batch, index) {
      var range = ranges[index];
      var allowedDeviceIds = new Set([range.deviceId]);
      (batch || []).forEach(function (record) {
        var normalized = normalizeDriverChange(record, allowedDeviceIds);
        var instant = normalized && Date.parse(normalized.timestamp);
        if (normalized
          && Date.parse(range.fromDate) <= instant
          && instant < Date.parse(range.toDate)) {
          events.push(normalized);
        } else {
          findings.push(finding(
            "DRIVER_CHANGE_DISCARDED",
            "A malformed, ambiguous, or unauthorized DriverChange was discarded",
            rawValue(record, "id", "Id")
          ));
        }
      });
    });
    events = dedupeEvents(events);
    var identities = await resolveIdentities(api, events, priorIdentities);
    events = events.map(function (event) {
      if (!event.driverId) {
        return event;
      }
      var identity = identities.get(event.driverId);
      return Object.assign({}, event, {
        driverDisplayName: identity && identity.displayName || null,
        warningState: identity && identity.displayName
          ? "NONE" : "IDENTITY_UNRESOLVED"
      });
    });
    return {
      ok: true,
      events: events,
      findings: findings,
      identities: identities
    };
  }

  return {
    ASSIGNMENT_TYPES: ASSIGNMENT_TYPES.slice(),
    CLEAR_TYPES: CLEAR_TYPES.slice(),
    SOURCE: SOURCE,
    dedupeEvents: dedupeEvents,
    driverChangeCall: driverChangeCall,
    fetchAuthorizedDriverEvents: fetchAuthorizedDriverEvents,
    isUnknownDriverId: isUnknownDriverId,
    normalizeDriverChange: normalizeDriverChange,
    normalizeIdentity: normalizeIdentity,
    userCall: userCall
  };
}));
