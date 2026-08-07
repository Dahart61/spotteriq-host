(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_POWERTRAIN_FAULTS = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
  var DEFAULT_FRESHNESS_MS = 15 * 60 * 1000;
  var DEFAULT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  var CURRENT_STATES = Object.freeze(["Active", "Pending"]);
  var CLEARING_STATES = Object.freeze(["Cleared", "Inactive", "None"]);
  var SEVERITY_ORDER = Object.freeze({
    NONE: 0,
    LOW: 1,
    INFO: 1,
    INFORMATION: 1,
    WARNING: 2,
    MEDIUM: 3,
    MODERATE: 3,
    HIGH: 4,
    SEVERE: 5,
    CRITICAL: 6
  });

  function property(record, lower, upper) {
    if (!record || typeof record !== "object") {
      return undefined;
    }
    if (Object.prototype.hasOwnProperty.call(record, lower)) {
      return record[lower];
    }
    return record[upper];
  }

  function referenceId(value) {
    if (typeof value === "string") {
      return value;
    }
    return value && (value.id || value.Id) || null;
  }

  function returnedLabel(value) {
    if (typeof value === "string") {
      return value;
    }
    return value && (value.name || value.Name || value.id || value.Id) || null;
  }

  function canonicalState(value) {
    var label = returnedLabel(value);
    var compact = String(label || "").replace(/[^a-z]/gi, "").toLowerCase();
    if (!compact) {
      return null;
    }
    if (compact.indexOf("inactive") !== -1) {
      return "Inactive";
    }
    if (compact.indexOf("active") !== -1) {
      return "Active";
    }
    if (compact.indexOf("pending") !== -1) {
      return "Pending";
    }
    if (compact.indexOf("cleared") !== -1
      || compact.indexOf("clear") !== -1) {
      return "Cleared";
    }
    if (compact.indexOf("none") !== -1
      || compact.indexOf("notindicated") !== -1) {
      return "None";
    }
    return null;
  }

  function faultStates(record) {
    var primary = property(record, "faultStates", "FaultStates");
    var source = Array.isArray(primary) && primary.length
      ? primary : [property(record, "faultState", "FaultState")];
    var returned = source.filter(function (value) {
      return value !== null && value !== undefined;
    }).map(returnedLabel);
    var normalized = source.map(canonicalState).filter(Boolean);
    if (!returned.length || normalized.length !== returned.length) {
      return null;
    }
    return {
      returned: Array.from(new Set(returned)),
      normalized: Array.from(new Set(normalized))
    };
  }

  function metadataMap(records) {
    return new Map((Array.isArray(records) ? records : []).map(function (record) {
      return [referenceId(record), record];
    }).filter(function (entry) {
      return Boolean(entry[0]);
    }));
  }

  function categoryFor(controllerId, configuration) {
    var engine = new Set(configuration.engineControllerIds || []);
    var transmission = new Set(configuration.transmissionControllerIds || []);
    if (engine.has(controllerId)) {
      return "ENGINE";
    }
    if (transmission.has(controllerId)) {
      return "TRANSMISSION";
    }
    return null;
  }

  function diagnosticType(diagnostic) {
    return property(diagnostic, "diagnosticType", "DiagnosticType") || null;
  }

  function isGoFault(diagnostic) {
    return String(diagnosticType(diagnostic) || "").toLowerCase() === "gofault";
  }

  function explicitLamp(record) {
    var malfunction = property(record, "malfunctionLamp", "MalfunctionLamp");
    var lampState = property(record, "faultLampState", "FaultLampState");
    var normalizedLamp = String(returnedLabel(lampState) || "").toLowerCase();
    var on = malfunction === true
      || normalizedLamp.indexOf("malfunction") !== -1;
    var off = malfunction === false || normalizedLamp.indexOf("none") !== -1;
    if (on === off) {
      return null;
    }
    return on ? "On" : "Off";
  }

  function timestampOf(record) {
    var timestamp = property(record, "dateTime", "DateTime");
    return typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))
      ? timestamp : null;
  }

  function finiteNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeEvent(record, context) {
    var deviceId = referenceId(property(record, "device", "Device"));
    if (!deviceId) {
      return { malformed: true };
    }
    if (!context.authorizedDeviceIds.has(deviceId)) {
      return { excluded: true };
    }
    var recordControllerId = referenceId(property(record, "controller", "Controller"));
    if (!recordControllerId) {
      return { malformed: true };
    }
    if (!categoryFor(recordControllerId, context.configuration)) {
      return { excluded: true };
    }
    var diagnosticId = referenceId(property(record, "diagnostic", "Diagnostic"));
    var diagnostic = context.diagnostics.get(diagnosticId);
    if (!diagnosticId || !diagnostic) {
      return { malformed: true };
    }
    if (isGoFault(diagnostic)) {
      return { excluded: true };
    }
    if (!diagnosticType(diagnostic)) {
      return { malformed: true };
    }
    var diagnosticControllerId = referenceId(
      property(diagnostic, "controller", "Controller")
    );
    if (diagnosticControllerId
      && diagnosticControllerId !== "ControllerNoneId"
      && recordControllerId !== diagnosticControllerId) {
      return { malformed: true };
    }
    var controllerId = recordControllerId;
    var category = categoryFor(controllerId, context.configuration);
    if (!category) {
      return { excluded: true };
    }
    if (!context.controllers.has(controllerId)) {
      return { malformed: true };
    }
    var states = faultStates(record);
    var timestamp = timestampOf(record);
    if (!states || !timestamp) {
      return { malformed: true };
    }
    var failureMode = property(record, "failureMode", "FailureMode") || null;
    var failureModeId = referenceId(failureMode);
    var failureModeCode = finiteNumber(property(failureMode, "code", "Code"));
    var sourceAddress = finiteNumber(
      property(record, "sourceAddress", "SourceAddress")
    );
    var signature = [
      controllerId,
      diagnosticId,
      failureModeId || failureModeCode || "NoFailureModeId",
      sourceAddress === null ? "NoSourceAddress" : sourceAddress
    ].join("|");
    var severity = property(record, "severity", "Severity") || null;
    return {
      event: {
        id: referenceId(record),
        signature: signature,
        deviceId: deviceId,
        controllerId: controllerId,
        category: category,
        diagnosticId: diagnosticId,
        diagnosticCode: finiteNumber(property(diagnostic, "code", "Code")),
        diagnosticName: property(diagnostic, "name", "Name") || null,
        diagnosticType: diagnosticType(diagnostic),
        failureModeId: failureModeId,
        failureModeCode: failureModeCode,
        failureModeName: property(failureMode, "name", "Name") || null,
        sourceAddress: sourceAddress,
        returnedStates: states.returned,
        states: states.normalized,
        lamp: explicitLamp(record),
        severity: severity ? String(severity) : null,
        occurrenceCount: finiteNumber(property(record, "count", "Count")),
        description: property(record, "faultDescription", "FaultDescription")
          || property(diagnostic, "name", "Name") || null,
        recommendation: property(record, "recommendation", "Recommendation")
          || null,
        timestamp: timestamp
      }
    };
  }

  function latestBySignature(events) {
    var latest = new Map();
    events.forEach(function (event) {
      var current = latest.get(event.signature);
      var newer = !current
        || Date.parse(event.timestamp) > Date.parse(current.timestamp)
        || Date.parse(event.timestamp) === Date.parse(current.timestamp)
          && String(event.id || "") > String(current.id || "");
      if (newer) {
        latest.set(event.signature, event);
      }
    });
    return Array.from(latest.values());
  }

  function currentDetails(events) {
    var details = [];
    latestBySignature(events).forEach(function (event) {
      if (event.states.some(function (state) {
        return CLEARING_STATES.indexOf(state) !== -1;
      })) {
        return;
      }
      CURRENT_STATES.forEach(function (state) {
        if (event.states.indexOf(state) !== -1) {
          details.push(Object.assign({}, event, { state: state }));
        }
      });
    });
    return details.sort(function (left, right) {
      return Date.parse(right.timestamp) - Date.parse(left.timestamp)
        || left.signature.localeCompare(right.signature)
        || left.state.localeCompare(right.state);
    });
  }

  function checkEngineLight(events, nowMs, freshnessMs) {
    var evidence = events.filter(function (event) {
      return event.category === "ENGINE" && event.lamp
        && nowMs - Date.parse(event.timestamp) <= freshnessMs;
    }).sort(function (left, right) {
      return Date.parse(right.timestamp) - Date.parse(left.timestamp);
    });
    if (!evidence.length) {
      return "Unavailable";
    }
    var newestTimestamp = evidence[0].timestamp;
    var values = new Set(evidence.filter(function (event) {
      return event.timestamp === newestTimestamp;
    }).map(function (event) {
      return event.lamp;
    }));
    return values.size === 1 ? Array.from(values)[0] : "Unavailable";
  }

  function highestSeverity(details) {
    if (!details.length) {
      return "None";
    }
    var values = details.map(function (detail) {
      return detail.severity;
    }).filter(Boolean);
    if (!values.length) {
      return "Unavailable";
    }
    return values.reduce(function (highest, value) {
      var highestRank = SEVERITY_ORDER[String(highest).toUpperCase()] || 0;
      var valueRank = SEVERITY_ORDER[String(value).toUpperCase()] || 0;
      return valueRank > highestRank ? value : highest;
    });
  }

  function unavailable(reason) {
    return {
      status: "UNAVAILABLE",
      reason: reason || "FAULT_DATA_UNAVAILABLE",
      checkEngineLight: "Unavailable",
      activeEngineFaults: null,
      pendingEngineFaults: null,
      activeTransmissionFaults: null,
      pendingTransmissionFaults: null,
      highestSeverity: "Unavailable",
      lastUpdated: null,
      noActivePowertrainFaults: false,
      details: []
    };
  }

  function reconstruct(input) {
    if (!input || !Array.isArray(input.records)
      || !input.configuration || !input.deviceId) {
      return unavailable("MALFORMED_FAULT_DATA");
    }
    var nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
    var freshnessMs = Number.isFinite(input.freshnessMs)
      ? input.freshnessMs : DEFAULT_FRESHNESS_MS;
    var fetchedAt = input.fetchedAt || new Date(nowMs).toISOString();
    if (!Number.isFinite(Date.parse(fetchedAt))
      || nowMs - Date.parse(fetchedAt) > freshnessMs) {
      return unavailable("STALE_FAULT_DATA");
    }
    var context = {
      authorizedDeviceIds: new Set(input.authorizedDeviceIds || [input.deviceId]),
      configuration: input.configuration,
      diagnostics: metadataMap(input.diagnostics),
      controllers: metadataMap(input.controllers)
    };
    var events = [];
    var malformed = false;
    input.records.forEach(function (record) {
      var result = normalizeEvent(record, context);
      if (result && result.event) {
        events.push(result.event);
      } else if (result && result.malformed) {
        malformed = true;
      }
    });
    if (malformed) {
      return unavailable("MALFORMED_OR_UNCLASSIFIED_FAULT_DATA");
    }
    var details = currentDetails(events);
    function count(category, state) {
      return details.filter(function (detail) {
        return detail.category === category && detail.state === state;
      }).length;
    }
    return {
      status: "AVAILABLE",
      reason: null,
      checkEngineLight: checkEngineLight(events, nowMs, freshnessMs),
      activeEngineFaults: count("ENGINE", "Active"),
      pendingEngineFaults: count("ENGINE", "Pending"),
      activeTransmissionFaults: count("TRANSMISSION", "Active"),
      pendingTransmissionFaults: count("TRANSMISSION", "Pending"),
      highestSeverity: highestSeverity(details),
      lastUpdated: fetchedAt,
      noActivePowertrainFaults: details.length === 0,
      details: details
    };
  }

  return {
    DEFAULT_FRESHNESS_MS: DEFAULT_FRESHNESS_MS,
    DEFAULT_LOOKBACK_MS: DEFAULT_LOOKBACK_MS,
    DEFAULT_REFRESH_INTERVAL_MS: DEFAULT_REFRESH_INTERVAL_MS,
    reconstruct: reconstruct,
    unavailable: unavailable
  };
}));
