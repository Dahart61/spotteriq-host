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
  var RESULT_LIMIT = 50000;
  var TRIP_RESULT_LIMIT = 25000;
  var DRIVER_CHUNK_MS = 7 * 24 * 60 * 60 * 1000;

  function assertCurrent(options) {
    if (options && typeof options.isStale === "function" && options.isStale()) {
      var error = new Error("The report request was superseded");
      error.code = "REPORT_REQUEST_STALE";
      throw error;
    }
  }

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
        includeOverlappedChanges: true
      },
      resultsLimit: RESULT_LIMIT,
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

  function tripCall(request) {
    var range = exactRange(request);
    return ["Get", {
      typeName: "Trip",
      search: { deviceSearch: { id: range.deviceId }, fromDate: range.fromDate,
        toDate: range.toDate, includeOverlappedTrips: true },
      resultsLimit: TRIP_RESULT_LIMIT,
      sort: { sortBy: "start", sortDirection: "asc" },
      propertySelector: { fields: ["id", "device", "driver", "start", "nextTripStart"], isIncluded: true }
    }];
  }

  function nativeTripScope(record, deviceId) {
    var actualDevice = normalization.referenceId(rawValue(record, "device", "Device"));
    var driverId = normalization.referenceId(rawValue(record, "driver", "Driver"));
    var startUtc = normalization.exactIso(rawValue(record, "start", "Start"));
    var endUtc = normalization.exactIso(rawValue(record, "nextTripStart", "NextTripStart"));
    if (actualDevice !== deviceId || !driverId || isUnknownDriverId(driverId)
      || !startUtc || !endUtc || Date.parse(endUtc) <= Date.parse(startUtc)
      || endUtc.slice(0, 4) === "9999") { return null; }
    return { deviceId: actualDevice, driverId: driverId, startUtc: startUtc, endUtc: endUtc };
  }

  async function resolveTripScopes(api, events, requests, options) {
    var required = requests.filter(function (range) {
      return events.some(function (event) {
        return event.deviceId === range.deviceId && event.sourceType === "TripDriver"
          && event.action === "ASSIGNED";
      });
    }).map(function (range) {
      var start = Date.parse(range.fromDate);
      events.forEach(function (event) {
        var instant = Date.parse(event.timestamp);
        if (event.deviceId === range.deviceId && event.sourceType === "TripDriver"
          && instant >= Date.parse(options && options.sessionHistoryStartUtc)) {
          start = Math.min(start, instant);
        }
      });
      return Object.assign({}, range, { fromDate: new Date(start).toISOString() });
    });
    if (!required.length) { return events; }
    var batches;
    try {
      batches = await fetchRangesBounded(api, chunkRanges(required), options || {}, true);
    } catch (error) {
      if (error && error.code === "REPORT_REQUEST_STALE") { throw error; }
      // Failure affects TripDriver attribution only, never vehicle activity.
      return events;
    }
    var scopes = [];
    var incomplete = new Set();
    var ranges = chunkRanges(required);
    batches.forEach(function (batch, index) {
      (batch || []).forEach(function (record) {
        var scope = nativeTripScope(record, ranges[index].deviceId);
        if (!scope) { incomplete.add(ranges[index].deviceId); }
        if (scope && !scopes.some(function (prior) {
          return prior.deviceId === scope.deviceId && prior.driverId === scope.driverId
            && prior.startUtc === scope.startUtc && prior.endUtc === scope.endUtc;
        })) { scopes.push(scope); }
      });
    });
    return events.map(function (event) {
      if (event.sourceType !== "TripDriver" || event.action !== "ASSIGNED") { return event; }
      var instant = Date.parse(event.timestamp);
      var deviceScopes = scopes.filter(function (scope) { return scope.deviceId === event.deviceId; });
      var candidates = deviceScopes.filter(function (scope) {
        return Date.parse(scope.startUtc) <= instant && instant < Date.parse(scope.endUtc);
      });
      var requested = required.find(function (range) { return range.deviceId === event.deviceId; });
      if (!candidates.length && !incomplete.has(event.deviceId)
        && requested && instant >= Date.parse(requested.fromDate)) {
        var next = deviceScopes.filter(function (scope) { return Date.parse(scope.startUtc) >= instant; })
          .sort(function (a, b) { return Date.parse(a.startUtc) - Date.parse(b.startUtc); })[0];
        candidates = next ? deviceScopes.filter(function (scope) { return scope.startUtc === next.startUtc; }) : [];
      }
      return Object.assign({}, event, { tripScope: candidates.length === 1
        && candidates[0].driverId === event.driverId ? candidates[0] : null });
    });
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
      overlapSeed: false,
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

  function chunkRanges(ranges) {
    var result = [];
    (ranges || []).forEach(function (range) {
      var start = Date.parse(range.fromDate);
      var end = Date.parse(range.toDate);
      for (var cursor = start; cursor < end; cursor += DRIVER_CHUNK_MS) {
        result.push({
          deviceId: range.deviceId,
          fromDate: new Date(cursor).toISOString(),
          toDate: new Date(Math.min(end, cursor + DRIVER_CHUNK_MS)).toISOString()
        });
      }
    });
    return result;
  }

  async function fetchRangeComplete(api, range, options, depth, trips) {
    assertCurrent(options);
    var request = trips ? tripCall(range) : driverChangeCall(range);
    if (options && options.stats) { options.stats.apiCalls += 1; }
    var batch = await client.call(api, request[0], request[1]);
    assertCurrent(options);
    if (options && options.stats) {
      options.stats.maxRecordsPerCall = Math.max(
        options.stats.maxRecordsPerCall, batch.length
      );
    }
    if (batch.length < (trips ? TRIP_RESULT_LIMIT : RESULT_LIMIT)) {
      return batch;
    }
    var start = Date.parse(range.fromDate);
    var end = Date.parse(range.toDate);
    if (depth >= 16 || end - start <= 1000) {
      var error = new Error("Driver history result limit reached after bounded chunking");
      error.code = "DRIVER_RESULT_LIMIT";
      throw error;
    }
    var midpoint = new Date(start + Math.floor((end - start) / 2)).toISOString();
    var left = await fetchRangeComplete(api, {
      deviceId: range.deviceId, fromDate: range.fromDate, toDate: midpoint
    }, options, depth + 1, trips);
    var right = await fetchRangeComplete(api, {
      deviceId: range.deviceId, fromDate: midpoint, toDate: range.toDate
    }, options, depth + 1, trips);
    return left.concat(right);
  }

  async function fetchRangesBounded(api, ranges, options, trips) {
    var batches = new Array(ranges.length);
    var next = 0;
    async function worker() {
      while (next < ranges.length) {
        assertCurrent(options);
        var index = next;
        next += 1;
        batches[index] = await fetchRangeComplete(api, ranges[index], options, 0, trips);
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
      }
    }
    var concurrency = Math.min(
      options.maxConcurrency || 3, Math.max(1, ranges.length)
    );
    var workers = [];
    for (var index = 0; index < concurrency; index += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return batches;
  }

  async function fetchAuthorizedDriverEvents(api, requests, priorIdentities, options) {
    var ranges = (requests || []).map(exactRange);
    if (!ranges.length) {
      return {
        ok: true,
        events: [],
        findings: [],
        identities: new Map(priorIdentities || [])
      };
    }
    if (options && options.reportType) {
      ranges = chunkRanges(ranges);
    }
    var batches = options && options.reportType
      ? await fetchRangesBounded(api, ranges, options)
      : await client.safeMultiCall(api, ranges.map(driverChangeCall));
    assertCurrent(options);
    var findings = [];
    var events = [];
    batches.forEach(function (batch, index) {
      var range = ranges[index];
      var allowedDeviceIds = new Set([range.deviceId]);
      var preceding = [];
      (batch || []).forEach(function (record) {
        var normalized = normalizeDriverChange(record, allowedDeviceIds);
        var instant = normalized && Date.parse(normalized.timestamp);
        if (normalized && instant < Date.parse(range.fromDate)) {
          if (!preceding.length
            || Date.parse(preceding[0].timestamp) < instant) {
            preceding = [normalized];
          } else if (Date.parse(preceding[0].timestamp) === instant) {
            preceding.push(normalized);
          }
        } else if (normalized && Date.parse(range.fromDate) <= instant
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
      preceding.forEach(function (event) {
        events.push(Object.assign({}, event, { overlapSeed: true }));
      });
    });
    events = dedupeEvents(events);
    if (options && options.includeTripScopes) {
      events = await resolveTripScopes(api, events, (requests || []).map(exactRange), options);
    }
    var identities = await resolveIdentities(api, events, priorIdentities);
    assertCurrent(options);
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
    DRIVER_CHUNK_MS: DRIVER_CHUNK_MS,
    RESULT_LIMIT: RESULT_LIMIT,
    TRIP_RESULT_LIMIT: TRIP_RESULT_LIMIT,
    tripCall: tripCall,
    nativeTripScope: nativeTripScope,
    resolveTripScopes: resolveTripScopes,
    SOURCE: SOURCE,
    dedupeEvents: dedupeEvents,
    driverChangeCall: driverChangeCall,
    fetchRangeComplete: fetchRangeComplete,
    fetchAuthorizedDriverEvents: fetchAuthorizedDriverEvents,
    isUnknownDriverId: isUnknownDriverId,
    normalizeDriverChange: normalizeDriverChange,
    normalizeIdentity: normalizeIdentity,
    userCall: userCall
  };
}));
