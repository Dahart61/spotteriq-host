(function (root, factory) {
  "use strict";

  var client = typeof module === "object" && module.exports
    ? require("./mygeotab-client")
    : root.SIQ_MYGEOTAB_CLIENT;
  var normalization = typeof module === "object" && module.exports
    ? require("./mygeotab-normalization")
    : root.SIQ_MYGEOTAB_NORMALIZATION;
  var diagnostics = typeof module === "object" && module.exports
    ? require("./mygeotab-diagnostics")
    : root.SIQ_MYGEOTAB_DIAGNOSTICS;
  var timezone = typeof module === "object" && module.exports
    ? require("../core/timezone")
    : root.SIQ_TIMEZONE;
  var shifts = typeof module === "object" && module.exports
    ? require("../core/shifts")
    : root.SIQ_SHIFTS;
  var shiftPerformance = typeof module === "object" && module.exports
    ? require("../core/shift-performance")
    : root.SIQ_SHIFT_PERFORMANCE;
  var timeline = typeof module === "object" && module.exports
    ? require("../core/timeline")
    : root.SIQ_TIMELINE;
  var moves = typeof module === "object" && module.exports
    ? require("../core/moves")
    : root.SIQ_MOVES;
  var moveSummaries = typeof module === "object" && module.exports
    ? require("../core/move-summaries")
    : root.SIQ_MOVE_SUMMARIES;
  var driverEvents = typeof module === "object" && module.exports
    ? require("./mygeotab-driver-events")
    : root.SIQ_MYGEOTAB_DRIVER_EVENTS;
  var driverAttribution = typeof module === "object" && module.exports
    ? require("../core/driver-attribution")
    : root.SIQ_DRIVER_ATTRIBUTION;
  var mygeotabFaults = typeof module === "object" && module.exports
    ? require("./mygeotab-faults")
    : root.SIQ_MYGEOTAB_FAULTS;
  var powertrainFaults = typeof module === "object" && module.exports
    ? require("../core/powertrain-faults")
    : root.SIQ_POWERTRAIN_FAULTS;
  var api = factory(client, normalization, diagnostics, timezone, shifts,
    shiftPerformance, timeline,
    moves, moveSummaries, driverEvents, driverAttribution, mygeotabFaults,
    powertrainFaults);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_MYGEOTAB_OPERATIONS = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  client,
  normalization,
  diagnostics,
  timezone,
  shifts,
  shiftPerformance,
  timeline,
  moves,
  moveSummaries,
  driverEvents,
  driverAttribution,
  mygeotabFaults,
  powertrainFaults
) {
  "use strict";

  var OPERATIONAL_CHANNELS = [
    normalization.CHANNELS.IGNITION,
    normalization.CHANNELS.RPM,
    normalization.CHANNELS.SPEED,
    normalization.CHANNELS.FIFTH_WHEEL_STATUS
  ];
  var FUEL_DEF_CHANNELS = [
    normalization.CHANNELS.FUEL_USED,
    normalization.CHANNELS.FUEL_LEVEL,
    normalization.CHANNELS.DEF_LEVEL,
    normalization.CHANNELS.ENGINE_COOLANT_TEMPERATURE
  ];
  var ENGINE_HOURS_CHANNELS = [
    normalization.CHANNELS.ENGINE_HOURS,
    normalization.CHANNELS.ODOMETER
  ];
  var CURRENT_DIAGNOSTIC_IDS = Object.freeze({
    ignition: "DiagnosticIgnitionId",
    rpm: "DiagnosticEngineSpeedId",
    trailerCoupled: "DiagnosticAux1Id",
    fuelLevel: "DiagnosticFuelLevelId",
    defLevel: "DiagnosticDieselExhaustFluidId",
    engineHours: "DiagnosticEngineHoursId"
  });
  var DEFAULT_ENGINE_ON_RPM_THRESHOLD = 400;
  var DEFAULT_MOVEMENT_THRESHOLD_MPH = 2;
  var DEFAULT_SIGNAL_FRESHNESS_MS = 120000;
  var SPOTTERIQ_COMMUNICATION_RETENTION_MS = 72 * 60 * 60 * 1000;
  var OPERATIONS_MOVE_RESULT_LIMIT = 50000;
  var OPERATIONS_MOVE_DIAGNOSTIC_ID = "DiagnosticAux1Id";
  var STATE_LABELS = Object.freeze({
    COUPLED_MOVING: "Coupled Moving",
    BOBTAIL_MOVING: "Bobtail Moving",
    COUPLED_IDLE: "Coupled Idle",
    BOBTAIL_IDLE: "Bobtail Idle",
    ENGINE_OFF: "Engine Off",
    ENGINE_ON_MOVING: "Engine On — Moving",
    ENGINE_ON_STATIONARY: "Engine On — Stationary",
    KEY_ON_ENGINE_NOT_RUNNING: "Key On — Engine Not Running",
    MOVING: "Moving",
    IDLING: "Engine Running · Stationary",
    OFF: "Engine Off",
    KEY_ON: "Key On",
    STOPPED: "Stopped",
    UNAVAILABLE: "Unavailable",
    UNKNOWN: "Unknown",
    NOT_COMMUNICATING: "Not Communicating"
  });
  var FIFTH_WHEEL_LABELS = Object.freeze({
    COUPLED: "Trailer Coupled",
    UNCOUPLED: "Trailer Uncoupled",
    UNKNOWN: "Fifth Wheel Status Unavailable"
  });

  function localDateAt(instant, timeZone) {
    var parts = timezone.zonedParts(instant, timeZone);
    return [
      String(parts.year).padStart(4, "0"),
      String(parts.month).padStart(2, "0"),
      String(parts.day).padStart(2, "0")
    ].join("-");
  }

  function currentShiftRange(facility, instant) {
    var nowMs = instant instanceof Date ? instant.getTime() : Number(instant);
    if (!Number.isFinite(nowMs)) {
      nowMs = Date.now();
    }
    var profiles = Array.isArray(facility.shiftProfiles)
      ? facility.shiftProfiles : [];
    var localDate = localDateAt(nowMs, facility.timezone);
    var priorDate = timezone.addLocalDays(localDate, -1);
    var occurrences = profiles.length ? shifts.generateShiftOccurrences(
      profiles,
      priorDate,
      localDate
    ) : [];
    var occurrence = occurrences.find(function (candidate) {
      return Date.parse(candidate.startUtc) <= nowMs && nowMs < Date.parse(candidate.endUtc);
    });
    if (!occurrence) {
      var lookbackMs = facility.communicationFreshness
        && facility.communicationFreshness.staleMs;
      if (!Number.isFinite(lookbackMs) || lookbackMs <= 0) {
        throw new RangeError("Communication freshness is required for current telemetry");
      }
      return {
        occurrence: null,
        shiftStatus: profiles.length
          ? "NO_CONFIGURED_SHIFT" : "SHIFT_SCHEDULE_NOT_CONFIGURED",
        startUtc: new Date(nowMs - lookbackMs).toISOString(),
        endUtc: new Date(nowMs).toISOString()
      };
    }
    return {
      occurrence: occurrence,
      shiftStatus: "CONFIGURED_SHIFT",
      startUtc: occurrence.startUtc,
      endUtc: new Date(nowMs).toISOString()
    };
  }

  function enrollmentMap(configuration, facility, devices) {
    return new Map((devices || []).map(function (device) {
      return [device.deviceId, {
        deviceId: device.deviceId,
        facilityId: facility.id,
        displayName: device.displayName,
        profileConfigured: false,
        liveOperationsNative: true,
        fifthWheelCapabilityGroupMember:
          device.fifthWheelCapabilityGroupMember === true,
        fifthWheelCapabilityGroupId:
          device.fifthWheelCapabilityGroupId || null,
        fifthWheelCapabilityGroupName:
          device.fifthWheelCapabilityGroupName
            || client.FIFTH_WHEEL_CAPABILITY_GROUP_NAME,
        driverIdentificationEnabled: true,
        capability: {},
        capabilities: {},
        diagnosticMappings: {}
      }];
    }));
  }

  function maximumTimestamp(records, fallback) {
    return (records || []).reduce(function (latest, record) {
      return Date.parse(record.timestamp) > Date.parse(latest) ? record.timestamp : latest;
    }, fallback);
  }

  function latestRecord(records, channel) {
    var matching = (records || []).filter(function (record) {
      return record.channel === channel;
    });
    return matching.length ? matching[matching.length - 1] : null;
  }

  function operationsMoveWindow(facility, instant) {
    var nowMs = instant instanceof Date ? instant.getTime() : Number(instant);
    if (!Number.isFinite(nowMs)) {
      nowMs = Date.now();
    }
    var localDate = localDateAt(nowMs, facility.timezone);
    return {
      dayKey: [facility.customerId || "customer", facility.id, localDate].join("::"),
      localDate: localDate,
      timezone: facility.timezone,
      startUtc: timezone.resolveLocalDateTime(
        localDate, "00:00", facility.timezone, "earlier"
      ).iso,
      endUtc: new Date(nowMs).toISOString()
    };
  }

  function rawValue(record, lower, upper) {
    return record && Object.prototype.hasOwnProperty.call(record, lower)
      ? record[lower] : record && record[upper];
  }

  function moveRecordKey(record) {
    var id = rawValue(record, "id", "Id");
    return id || [
      rawValue(record, "dateTime", "DateTime"),
      rawValue(record, "data", "Data"),
      rawValue(record, "speed", "Speed")
    ].join("::");
  }

  function mergeMoveRecords(existing, incoming) {
    var records = new Map();
    (existing || []).concat(incoming || []).forEach(function (record) {
      var timestamp = rawValue(record, "dateTime", "DateTime");
      if (Number.isFinite(Date.parse(timestamp))) {
        records.set(moveRecordKey(record), record);
      }
    });
    return Array.from(records.values()).sort(function (left, right) {
      return Date.parse(rawValue(left, "dateTime", "DateTime"))
        - Date.parse(rawValue(right, "dateTime", "DateTime"));
    });
  }

  function operationsMoveStatusCall(deviceId, fromDate, toDate) {
    return ["Get", {
      typeName: "StatusData",
      search: {
        deviceSearch: { id: deviceId },
        diagnosticSearch: { id: OPERATIONS_MOVE_DIAGNOSTIC_ID },
        fromDate: fromDate,
        toDate: toDate
      },
      resultsLimit: OPERATIONS_MOVE_RESULT_LIMIT,
      sort: { sortBy: "date", sortDirection: "asc" }
    }];
  }

  function operationsMoveLogCall(deviceId, fromDate, toDate) {
    return ["Get", {
      typeName: "LogRecord",
      search: {
        deviceSearch: { id: deviceId },
        fromDate: fromDate,
        toDate: toDate
      },
      resultsLimit: OPERATIONS_MOVE_RESULT_LIMIT,
      sort: { sortBy: "date", sortDirection: "asc" }
    }];
  }

  function moveCallWithRange(call, fromDate, toDate) {
    var copy = JSON.parse(JSON.stringify(call));
    copy[1].search.fromDate = fromDate;
    copy[1].search.toDate = toDate;
    return copy;
  }

  async function fetchCompleteMoveRecords(api, call, fromDate, toDate, depth) {
    var records = await client.call(api, call[0], call[1]);
    if (!Array.isArray(records) || records.length < OPERATIONS_MOVE_RESULT_LIMIT) {
      return Array.isArray(records) ? records : [];
    }
    var startMs = Date.parse(fromDate);
    var endMs = Date.parse(toDate);
    if (depth >= 16 || endMs - startMs <= 1000) {
      var error = new Error("Operations move-history result limit reached");
      error.code = "OPERATIONS_MOVE_RESULT_LIMIT";
      throw error;
    }
    var midpoint = new Date(startMs + Math.floor((endMs - startMs) / 2))
      .toISOString();
    var halves = await Promise.all([
      fetchCompleteMoveRecords(
        api, moveCallWithRange(call, fromDate, midpoint), fromDate, midpoint, depth + 1
      ),
      fetchCompleteMoveRecords(
        api, moveCallWithRange(call, midpoint, toDate), midpoint, toDate, depth + 1
      )
    ]);
    return mergeMoveRecords(halves[0], halves[1]);
  }

  function authorizedMoveRecords(records, deviceId) {
    return (records || []).filter(function (record) {
      var device = rawValue(record, "device", "Device");
      var recordDeviceId = device && rawValue(device, "id", "Id");
      return !recordDeviceId || recordDeviceId === deviceId;
    });
  }

  function freshRecord(record, nowMs, freshnessMs) {
    if (!record || !Number.isFinite(freshnessMs) || freshnessMs <= 0) {
      return null;
    }
    var timestamp = Date.parse(record.timestamp);
    return Number.isFinite(timestamp) && nowMs >= timestamp
      && nowMs - timestamp < freshnessMs ? record : null;
  }

  function unique(values) {
    return Array.from(new Set((values || []).filter(Boolean)));
  }

  function currentDiagnosticIds(enrollments) {
    var configured = enrollments || [];
    var confirmedFifthWheel = configured.filter(fifthWheelConfigured);
    var nativeIds = [
      CURRENT_DIAGNOSTIC_IDS.ignition,
      CURRENT_DIAGNOSTIC_IDS.rpm,
      CURRENT_DIAGNOSTIC_IDS.fuelLevel,
      CURRENT_DIAGNOSTIC_IDS.defLevel,
      CURRENT_DIAGNOSTIC_IDS.engineHours
    ];
    if (confirmedFifthWheel.length) {
      nativeIds.push(CURRENT_DIAGNOSTIC_IDS.trailerCoupled);
    }
    return unique(nativeIds.concat(
      diagnostics.diagnosticIds(configured, OPERATIONAL_CHANNELS.filter(function (channel) {
        return channel !== normalization.CHANNELS.FIFTH_WHEEL_STATUS;
      })),
      diagnostics.diagnosticIds(
        confirmedFifthWheel,
        [normalization.CHANNELS.FIFTH_WHEEL_STATUS]
      )
    ));
  }

  function latestDiagnostic(statusInfo, diagnosticIds) {
    var allowed = new Set((diagnosticIds || []).filter(Boolean));
    return (statusInfo && statusInfo.latestDiagnostics || []).reduce(function (latest, item) {
      if (!allowed.has(item.diagnosticId)) {
        return latest;
      }
      return !latest || Date.parse(item.timestamp) > Date.parse(latest.timestamp)
        ? item : latest;
    }, null);
  }

  function booleanLevel(value) {
    if (value === true || value === 1 || value === "1"
      || String(value).toUpperCase() === "ON") {
      return true;
    }
    if (value === false || value === 0 || value === "0"
      || String(value).toUpperCase() === "OFF") {
      return false;
    }
    return null;
  }

  function signalFreshness(enrollment, key) {
    var configured = enrollment && enrollment.capability || {};
    var value = configured[key];
    return Number.isFinite(value) && value > 0
      ? value : DEFAULT_SIGNAL_FRESHNESS_MS;
  }

  function statusSignal(statusInfo, diagnosticIds, nowMs, freshnessMs, transform) {
    var record = latestDiagnostic(statusInfo, diagnosticIds);
    if (!record) {
      return { available: false, fresh: false, timestamp: null, value: null };
    }
    var value = transform(record.value);
    var timestamp = Date.parse(record.timestamp);
    return {
      available: value !== null,
      fresh: value !== null && Number.isFinite(timestamp)
        && nowMs >= timestamp && nowMs - timestamp < freshnessMs,
      timestamp: record.timestamp,
      value: value
    };
  }

  function mappedDiagnosticId(enrollment, channel) {
    return enrollment && enrollment.diagnosticMappings
      && enrollment.diagnosticMappings[channel]
      && enrollment.diagnosticMappings[channel].diagnosticId;
  }

  function currentOperationalPresentation(statusInfo, enrollment, facility, nowMs,
    retainedState) {
    var ignition = statusSignal(statusInfo, unique([
      CURRENT_DIAGNOSTIC_IDS.ignition,
      mappedDiagnosticId(enrollment, normalization.CHANNELS.IGNITION)
    ]), nowMs, signalFreshness(enrollment, "ignitionFreshnessMs"), booleanLevel);
    var rpm = statusSignal(statusInfo, unique([
      CURRENT_DIAGNOSTIC_IDS.rpm,
      mappedDiagnosticId(enrollment, normalization.CHANNELS.RPM)
    ]), nowMs, signalFreshness(enrollment, "rpmFreshnessMs"), function (value) {
      var numeric = Number(value);
      return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
    });
    var statusTimestamp = statusInfo && statusInfo.timestamp;
    var statusAgeMs = statusTimestamp && Number.isFinite(Date.parse(statusTimestamp))
      ? nowMs - Date.parse(statusTimestamp) : Infinity;
    var speed = {
      available: Boolean(statusInfo && Number.isFinite(statusInfo.currentSpeedMph)),
      fresh: Boolean(statusInfo && Number.isFinite(statusInfo.currentSpeedMph)
        && statusAgeMs >= 0 && statusAgeMs < DEFAULT_SIGNAL_FRESHNESS_MS),
      timestamp: statusTimestamp || null,
      value: statusInfo && Number.isFinite(statusInfo.currentSpeedMph)
        ? statusInfo.currentSpeedMph : null
    };
    var driving = {
      available: Boolean(statusInfo && typeof statusInfo.isDriving === "boolean"),
      fresh: Boolean(statusInfo && typeof statusInfo.isDriving === "boolean"
        && statusAgeMs >= 0 && statusAgeMs < DEFAULT_SIGNAL_FRESHNESS_MS),
      timestamp: statusTimestamp || null,
      value: statusInfo && typeof statusInfo.isDriving === "boolean"
        ? statusInfo.isDriving : null
    };
    var communicationKnown = statusInfo
      && typeof statusInfo.isCommunicating === "boolean";
    var communicationWithinRetention = communicationKnown
      && statusAgeMs >= 0
      && statusAgeMs < SPOTTERIQ_COMMUNICATION_RETENTION_MS;
    var communicating = communicationWithinRetention
      && statusInfo.isCommunicating === true;
    var recentlyNonCommunicating = communicationWithinRetention
      && statusInfo.isCommunicating === false;

    function signalAgeMs(signal) {
      var timestamp = Date.parse(signal && signal.timestamp);
      return Number.isFinite(timestamp) && nowMs >= timestamp
        ? nowMs - timestamp : Infinity;
    }

    function retainedSignalIsTrusted(signal) {
      if (!signal || !signal.available || !communicationWithinRetention) {
        return false;
      }
      if (communicating) {
        return Number.isFinite(signalAgeMs(signal));
      }
      return recentlyNonCommunicating
        && signalAgeMs(signal) < SPOTTERIQ_COMMUNICATION_RETENTION_MS;
    }

    function retainedIsTrusted() {
      var retainedAt = retainedState && Date.parse(retainedState.evidenceAt);
      if (!retainedState || ["IDLING", "OFF"].indexOf(retainedState.state) === -1
        || !communicationWithinRetention || !Number.isFinite(retainedAt)
        || nowMs < retainedAt) {
        return false;
      }
      return communicating || nowMs - retainedAt < SPOTTERIQ_COMMUNICATION_RETENTION_MS;
    }

    function evidenceAt(signals, fallback) {
      return maximumTimestamp((signals || []).filter(Boolean), fallback || statusTimestamp);
    }

    function result(state, confirmedAt) {
      var durationMs = state === "MOVING"
        && driving.fresh && driving.value === true
        ? statusInfo.currentStateDurationMs : null;
      return {
        state: state,
        label: STATE_LABELS[state],
        delayed: false,
        evidenceAt: confirmedAt || null,
        durationMs: durationMs,
        startedAt: Number.isFinite(durationMs) && statusTimestamp
          ? new Date(Date.parse(statusTimestamp) - durationMs).toISOString() : null,
        engineRunning: state === "IDLING" ? true
          : state === "OFF" ? false
            : state === "MOVING" && rpm.fresh
              ? rpm.value >= DEFAULT_ENGINE_ON_RPM_THRESHOLD : null,
        ignitionOn: ignition.value,
        rpm: rpm.value
      };
    }

    if (communicationKnown && !communicationWithinRetention) {
      return result("UNAVAILABLE", null);
    }

    var freshMoving = statusInfo && statusInfo.isCommunicating !== false && (speed.fresh
      ? speed.value >= DEFAULT_MOVEMENT_THRESHOLD_MPH
      : driving.fresh && driving.value === true);
    var freshStationary = speed.fresh
      ? speed.value < DEFAULT_MOVEMENT_THRESHOLD_MPH
      : driving.fresh && driving.value === false;
    var freshRpmRunning = rpm.fresh && rpm.value >= DEFAULT_ENGINE_ON_RPM_THRESHOLD;
    if (freshMoving) {
      return result("MOVING", evidenceAt([
        speed.fresh ? speed : null,
        !speed.fresh && driving.fresh ? driving : null
      ]));
    }
    if (freshStationary) {
      if (freshRpmRunning) {
        return result("IDLING", evidenceAt([speed, rpm]));
      }
      if (ignition.fresh && ignition.value === false) {
        return result("OFF", evidenceAt([speed, ignition, rpm.fresh ? rpm : null]));
      }
      if (retainedSignalIsTrusted(rpm)
        && rpm.value >= DEFAULT_ENGINE_ON_RPM_THRESHOLD) {
        return result("IDLING", evidenceAt([speed, rpm]));
      }
      if (retainedSignalIsTrusted(ignition) && ignition.value === false
        && (!retainedSignalIsTrusted(rpm)
          || rpm.value < DEFAULT_ENGINE_ON_RPM_THRESHOLD)) {
        return result("OFF", evidenceAt([speed, ignition, rpm]));
      }
      if (retainedSignalIsTrusted(rpm)
        && rpm.value < DEFAULT_ENGINE_ON_RPM_THRESHOLD) {
        return result("OFF", evidenceAt([speed, rpm]));
      }
      if (retainedIsTrusted() && retainedState.state === "IDLING" && !rpm.fresh) {
        return result("IDLING", retainedState.evidenceAt);
      }
      if (rpm.fresh && rpm.value < DEFAULT_ENGINE_ON_RPM_THRESHOLD) {
        return result("OFF", evidenceAt([speed, rpm, ignition.fresh ? ignition : null]));
      }
      if (retainedIsTrusted()
        && ["IDLING", "OFF"].indexOf(retainedState.state) !== -1) {
        return result(retainedState.state, retainedState.evidenceAt);
      }
      return result("UNAVAILABLE", null);
    }
    if (ignition.fresh && ignition.value === false && !freshRpmRunning) {
      return result("OFF", evidenceAt([ignition, rpm.fresh ? rpm : null]));
    }
    if (ignition.fresh && ignition.value === true && rpm.fresh && !freshRpmRunning
      && (!retainedIsTrusted() || retainedState.state !== "IDLING")) {
      return result("OFF", evidenceAt([ignition, rpm]));
    }

    var trustedStationary = retainedSignalIsTrusted(speed)
      ? speed.value < DEFAULT_MOVEMENT_THRESHOLD_MPH
      : retainedSignalIsTrusted(driving) && driving.value === false;
    if (trustedStationary && retainedSignalIsTrusted(rpm)
      && rpm.value >= DEFAULT_ENGINE_ON_RPM_THRESHOLD) {
      return result("IDLING", evidenceAt([speed, rpm]));
    }
    if (retainedSignalIsTrusted(ignition) && ignition.value === false
      && (!retainedSignalIsTrusted(rpm)
        || rpm.value < DEFAULT_ENGINE_ON_RPM_THRESHOLD)) {
      return result("OFF", evidenceAt([speed, ignition]));
    }
    if (trustedStationary && retainedSignalIsTrusted(rpm)
      && rpm.value < DEFAULT_ENGINE_ON_RPM_THRESHOLD) {
      return result("OFF", evidenceAt([speed, rpm]));
    }
    if (retainedIsTrusted()) {
      return result(retainedState.state, retainedState.evidenceAt);
    }
    return {
      state: "UNAVAILABLE",
      label: STATE_LABELS.UNAVAILABLE,
      delayed: false,
      evidenceAt: null,
      durationMs: null,
      startedAt: null,
      engineRunning: null,
      ignitionOn: ignition.value,
      rpm: rpm.value
    };
  }

  function trailerPresentation(statusInfo, enrollment, nowMs) {
    if (!fifthWheelConfigured(enrollment)) {
      return {
        supported: false,
        state: normalization.FIFTH_WHEEL_STATES.UNKNOWN,
        label: null,
        timestamp: null,
        delayed: false
      };
    }
    var mappedId = mappedDiagnosticId(
      enrollment, normalization.CHANNELS.FIFTH_WHEEL_STATUS
    );
    var record = latestDiagnostic(statusInfo, unique([
      CURRENT_DIAGNOSTIC_IDS.trailerCoupled,
      mappedId
    ]));
    if (!record) {
      return {
        supported: true,
        state: normalization.FIFTH_WHEEL_STATES.UNKNOWN,
        label: null,
        timestamp: null,
        delayed: false
      };
    }
    var state;
    if (record.diagnosticId === CURRENT_DIAGNOSTIC_IDS.trailerCoupled) {
      var level = booleanLevel(record.value);
      state = level === null ? normalization.FIFTH_WHEEL_STATES.UNKNOWN
        : level ? normalization.FIFTH_WHEEL_STATES.COUPLED
          : normalization.FIFTH_WHEEL_STATES.UNCOUPLED;
    } else {
      var mapping = enrollment && enrollment.diagnosticMappings
        && enrollment.diagnosticMappings[normalization.CHANNELS.FIFTH_WHEEL_STATUS];
      state = normalization.normalizeFifthWheelStatus(
        record.value, mapping && mapping.coupledWhen
      );
    }
    if (state === normalization.FIFTH_WHEEL_STATES.UNKNOWN) {
      return {
        supported: true,
        state: state,
        label: null,
        timestamp: record.timestamp,
        delayed: false
      };
    }
    var freshnessMs = signalFreshness(enrollment, "fifthWheelStatusFreshnessMs");
    var timestampMs = Date.parse(record.timestamp);
    if (!Number.isFinite(timestampMs) || nowMs < timestampMs
      || nowMs - timestampMs >= freshnessMs) {
      return {
        supported: true,
        state: normalization.FIFTH_WHEEL_STATES.UNKNOWN,
        label: null,
        timestamp: record.timestamp,
        delayed: false
      };
    }
    return {
      supported: true,
      state: state,
      label: FIFTH_WHEEL_LABELS[state],
      timestamp: record.timestamp,
      delayed: false
    };
  }

  function operatingModePresentation(current, trailer, capable) {
    var base = current && STATE_LABELS[current.state]
      ? STATE_LABELS[current.state] : STATE_LABELS.UNAVAILABLE;
    return base;
  }

  function operatingModeQualifier(trailer, capable) {
    if (!capable || !trailer
      || trailer.state === normalization.FIFTH_WHEEL_STATES.UNKNOWN) {
      return null;
    }
    return trailer.state === normalization.FIFTH_WHEEL_STATES.COUPLED
      ? "w/ Trailer" : "Bobtail";
  }

  function fifthWheelConfigured(enrollment) {
    if (enrollment && enrollment.liveOperationsNative === true) {
      return enrollment.fifthWheelCapabilityGroupMember === true;
    }
    return Boolean(enrollment
      && enrollment.capabilities
      && enrollment.capabilities.fifthWheelStatus === true
      && diagnostics.channelEnabled(
        enrollment,
        normalization.CHANNELS.FIFTH_WHEEL_STATUS
      ));
  }

  function currentMetric(statusInfo, diagnosticId, channel, unit) {
    var record = latestDiagnostic(statusInfo, [diagnosticId]);
    if (!record) {
      return { value: null, rawValue: null, timestamp: null };
    }
    var value = normalization.normalizeChannelValue(channel, record.value, {
      unit: unit
    });
    return {
      value: value,
      rawValue: value === null ? null : record.value,
      timestamp: value === null ? null : record.timestamp
    };
  }

  function engineRunningValue(state) {
    if ([
      "COUPLED_MOVING",
      "BOBTAIL_MOVING",
      "COUPLED_IDLE",
      "BOBTAIL_IDLE",
      "ENGINE_ON_MOVING",
      "ENGINE_ON_STATIONARY"
    ].indexOf(state) !== -1) {
      return true;
    }
    if (state === "KEY_ON_ENGINE_NOT_RUNNING" || state === "ENGINE_OFF") {
      return false;
    }
    return null;
  }

  function mergeRecords(existing, incoming) {
    return normalization.dedupeNormalizedRecords((existing || []).concat(incoming || []));
  }

  function sourceTelemetry(records, statusInfo, enrollment) {
    var ignition = records.filter(function (record) {
      return record.channel === normalization.CHANNELS.IGNITION;
    }).map(function (record) {
      return { timestamp: record.timestamp, value: record.value };
    });
    var rpm = records.filter(function (record) {
      return record.channel === normalization.CHANNELS.RPM;
    }).map(function (record) {
      return { timestamp: record.timestamp, value: record.value };
    });
    var speed = records.filter(function (record) {
      return record.channel === normalization.CHANNELS.SPEED;
    }).map(function (record) {
      return { timestamp: record.timestamp, value: record.value };
    });
    if (statusInfo && statusInfo.timestamp && statusInfo.currentSpeedMph !== null) {
      speed.push({ timestamp: statusInfo.timestamp, value: statusInfo.currentSpeedMph });
    }
    var coupling = fifthWheelConfigured(enrollment)
      ? records.filter(function (record) {
        return record.channel === normalization.CHANNELS.FIFTH_WHEEL_STATUS;
      }) : [];
    var communication = statusInfo && statusInfo.timestamp
      && typeof statusInfo.isCommunicating === "boolean"
      ? [{ timestamp: statusInfo.timestamp, value: statusInfo.isCommunicating }]
      : [];
    return {
      ignitionSamples: ignition,
      rpmSamples: rpm,
      speedSamples: speed,
      jawSamples: coupling.filter(function (record) {
        return record.value !== normalization.FIFTH_WHEEL_STATES.UNKNOWN;
      }).map(function (record) {
        return {
          timestamp: record.timestamp,
          value: record.value === normalization.FIFTH_WHEEL_STATES.COUPLED
        };
      }),
      communicationSamples: communication,
      couplingSamples: coupling.map(function (record) {
        return { timestamp: record.timestamp, state: record.value };
      })
    };
  }

  function capabilityFor(enrollment, facility) {
    var configured = enrollment.capability || {};
    var communication = facility.communicationFreshness;
    var hasFifthWheel = fifthWheelConfigured(enrollment);
    var ignitionFreshnessMs = Number.isFinite(configured.ignitionFreshnessMs)
      && configured.ignitionFreshnessMs > 0
      ? configured.ignitionFreshnessMs : configured.rpmFreshnessMs;
    return {
      deviceId: enrollment.deviceId,
      jawSensorInstalled: hasFifthWheel,
      movementSpeedThresholdMph: Number.isFinite(configured.movementSpeedThresholdMph)
        ? configured.movementSpeedThresholdMph
        : facility.moveConfiguration.movementSpeedThresholdMph,
      engineOnRpmThreshold: configured.engineOnRpmThreshold,
      ignitionFreshnessMs: ignitionFreshnessMs,
      rpmFreshnessMs: configured.rpmFreshnessMs,
      speedFreshnessMs: configured.speedFreshnessMs,
      jawFreshnessMs: hasFifthWheel
        ? configured.fifthWheelStatusFreshnessMs : undefined,
      communicationFreshnessMs: communication.currentMs
    };
  }

  function communicationPresentation(statusInfo, facility, nowMs) {
    if (!statusInfo || !statusInfo.timestamp) {
      return { condition: "UNKNOWN", label: "Unknown", ageMs: null };
    }
    var ageMs = Math.max(0, nowMs - Date.parse(statusInfo.timestamp));
    if (statusInfo.isCommunicating === false) {
      if (ageMs >= SPOTTERIQ_COMMUNICATION_RETENTION_MS) {
        return {
          condition: "OFFLINE_72_HOURS",
          label: "Offline 72+ Hours",
          ageMs: ageMs
        };
      }
      return {
        condition: "NOT_COMMUNICATING",
        label: "Not Communicating",
        ageMs: ageMs
      };
    }
    var freshness = facility.communicationFreshness;
    if (ageMs <= freshness.currentMs) {
      return { condition: "CURRENT", label: "Live", ageMs: ageMs };
    }
    if (ageMs <= freshness.delayedMs) {
      return { condition: "DELAYED", label: "Delayed", ageMs: ageMs };
    }
    return { condition: "STALE", label: "Aged", ageMs: ageMs };
  }

  function warningFor(timelineResult, moveResult, communication) {
    if (communication.condition === "NOT_COMMUNICATING"
      || communication.condition === "OFFLINE_72_HOURS") {
      return {
        code: "NOT_COMMUNICATING",
        message: communication.label,
        affectedMetrics: ["current operations"]
      };
    }
    if (communication.condition === "STALE" || communication.condition === "DELAYED") {
      return {
        code: "TELEMETRY_" + communication.condition,
        message: "Latest Fleet Data is " + communication.label.toLowerCase(),
        affectedMetrics: ["current operations"]
      };
    }
    var finding = (timelineResult.findings || []).concat(moveResult.findings || [])[0];
    return finding ? {
      code: finding.code,
      message: finding.message,
      affectedMetrics: (finding.affectedMetrics || []).slice()
    } : { code: null, message: null, affectedMetrics: [] };
  }

  function unprofiledViewModel(device, enrollment, facility, range, records,
    statusInfo, nowMs, driverContext, retainedState, moveState) {
    var communication = communicationPresentation(statusInfo, facility, nowMs);
    var current = currentOperationalPresentation(
      statusInfo, enrollment, facility, nowMs, retainedState
    );
    var trailer = trailerPresentation(statusInfo, enrollment, nowMs);
    var currentSpeed = statusInfo && statusInfo.currentSpeedMph !== null
      ? statusInfo.currentSpeedMph : null;
    var fuelLevel = currentMetric(
      statusInfo,
      CURRENT_DIAGNOSTIC_IDS.fuelLevel,
      normalization.CHANNELS.FUEL_LEVEL,
      "percent"
    );
    var defLevel = currentMetric(
      statusInfo,
      CURRENT_DIAGNOSTIC_IDS.defLevel,
      normalization.CHANNELS.DEF_LEVEL,
      "percent"
    );
    var engineHours = currentMetric(
      statusInfo,
      CURRENT_DIAGNOSTIC_IDS.engineHours,
      normalization.CHANNELS.ENGINE_HOURS,
      "seconds"
    );
    var warningCode = current.delayed ? "LAST_KNOWN_STATE_DELAYED"
      : current.state === "UNAVAILABLE" ? "CURRENT_STATE_UNAVAILABLE"
        : ["DELAYED", "STALE", "NOT_COMMUNICATING", "OFFLINE_72_HOURS"]
          .indexOf(communication.condition) !== -1
          ? "TELEMETRY_" + communication.condition : null;
    var moveProjection = fifthWheelConfigured(enrollment) && moveState
      && moveState.available === true ? {
        completedMoves: moveState.completedMoves,
        verifiedMovesLabel: String(moveState.completedMoves),
        moveInProgress: moveState.moveInProgress === true,
        lastCompletedMoveAt: moveState.lastCompletedMoveAt || null
      } : {
        completedMoves: null,
        verifiedMovesLabel: fifthWheelConfigured(enrollment)
          ? null : "Verified Moves Unavailable",
        moveInProgress: false,
        lastCompletedMoveAt: null
      };
    return Object.assign({
      deviceId: device.deviceId,
      displayName: device.displayName,
      nativeDisplayName: device.displayName,
      assetId: null,
      fleetsourceUnitNumber: null,
      customerUnitNumber: null,
      assetRole: null,
      assetRoleLabel: null,
      operationalStatus: null,
      operationalStatusLabel: null,
      currentAssignment: null,
      homeFacilityId: null,
      leaseStart: null,
      commercialConfigurationStatus: "NOT_CONFIGURED",
      advancedProfileConfigured: false,
      profileStatus: null,
      groupReconciliation: null,
      operationalState: current.state,
      operationalStateLabel: operatingModePresentation(
        current, trailer, trailer.supported
      ),
      operationalStateQualifierLabel: operatingModeQualifier(
        trailer, trailer.supported
      ),
      operationalStateDelayed: current.delayed,
      operationalStateEvidenceAt: current.evidenceAt,
      engineRunning: current.engineRunning,
      engineRpm: current.rpm,
      stateStartedAt: current.startedAt,
      stateDurationMs: current.durationMs,
      currentSpeedMph: currentSpeed,
      location: statusInfo && statusInfo.location || null,
      fifthWheelStatus: trailer.state,
      fifthWheelStatusLabel: trailer.label,
      trailerStateAt: trailer.timestamp,
      trailerStateDelayed: trailer.delayed,
      trailerStateSupported: trailer.supported,
      completedMoves: moveProjection.completedMoves,
      verifiedMovesLabel: moveProjection.verifiedMovesLabel,
      moveInProgress: moveProjection.moveInProgress,
      lastCompletedMoveAt: moveProjection.lastCompletedMoveAt,
      fuelLevelPercent: fuelLevel.value,
      fuelLevelAt: fuelLevel.timestamp,
      fuelLevelRaw: fuelLevel.rawValue,
      defLevelPercent: defLevel.value,
      defLevelAt: defLevel.timestamp,
      defLevelRaw: defLevel.rawValue,
      engineHours: engineHours.value,
      engineHoursAt: engineHours.timestamp,
      engineHoursRawSeconds: engineHours.rawValue,
      ignitionOn: current.ignitionOn,
      odometerMiles: null,
      engineCoolantTemperatureCelsius: null,
      lastCommunicationAt: statusInfo ? statusInfo.timestamp : null,
      latestTelemetryAt: maximumTimestamp(
        records,
        statusInfo && statusInfo.timestamp ? statusInfo.timestamp : range.startUtc
      ),
      communicationCondition: communication.condition,
      communicationConditionLabel: communication.label,
      warningCode: warningCode,
      warningMessage: null,
      engineHealth: powertrainFaults.unavailable("CAPABILITY_DISABLED"),
      affectedMetrics: []
    }, currentDriverProjection(statusInfo));
  }

  function driverEnabled(enrollment) {
    return Boolean(enrollment && (
      enrollment.driverIdentificationEnabled === true
      || enrollment.capability
        && enrollment.capability.driverIdentificationSupported === true
    ));
  }

  function driverWindow(enrollment, endUtc, fallbackStartUtc) {
    var assignment = enrollment && enrollment.currentAssignment;
    var start = normalization.exactIso(assignment && assignment.effectiveFrom)
      || normalization.exactIso(fallbackStartUtc);
    var requestedEnd = normalization.exactIso(endUtc);
    var assignmentEnd = normalization.exactIso(
      assignment && assignment.effectiveThrough
    );
    var end = assignmentEnd && Date.parse(assignmentEnd) < Date.parse(requestedEnd)
      ? assignmentEnd : requestedEnd;
    if (!driverEnabled(enrollment) || !start || !end
      || Date.parse(end) <= Date.parse(start)) {
      return null;
    }
    return {
      deviceId: enrollment.deviceId,
      startUtc: start,
      endUtc: end
    };
  }

  function driverProjection(enrollment, events, status, nowUtc, fallbackStartUtc) {
    if (!driverEnabled(enrollment)) {
      return {
        driverIdentificationEnabled: false,
        driverIdentificationStatus: "UNAVAILABLE",
        currentDriverDisplayName: null,
        driverIdentifiedAt: null,
        driverAttributionLabel: "Driver Identification Unavailable",
        driverTimeline: []
      };
    }
    var window = driverWindow(enrollment, nowUtc, fallbackStartUtc);
    if (!window || status === "UNVERIFIED") {
      return {
        driverIdentificationEnabled: true,
        driverIdentificationStatus: "UNVERIFIED",
        currentDriverDisplayName: null,
        driverIdentifiedAt: null,
        driverAttributionLabel: "Driver Identification Unverified",
        driverTimeline: []
      };
    }
    var current = driverAttribution.currentDriverContext(
      events,
      window,
      new Date(Date.parse(window.endUtc) - 1).toISOString()
    );
    var identified = Boolean(current && current.driverId);
    return {
      driverIdentificationEnabled: true,
      driverIdentificationStatus: identified ? "IDENTIFIED" : "UNATTRIBUTED",
      currentDriverDisplayName: identified
        ? (current.driverDisplayName || "Identified driver") : null,
      driverIdentifiedAt: identified ? current.identifiedAt : null,
      driverAttributionLabel: identified
        ? (current.driverDisplayName || "Identified driver") : "Unattributed",
      driverIdentityWarning: identified && !current.driverDisplayName
        ? "Driver display identity unavailable" : null,
      driverTimeline: driverAttribution.timelineEntries(events, window)
    };
  }

  function currentDriverProjection(statusInfo) {
    var displayName = statusInfo && statusInfo.currentDriverDisplayName;
    var identified = typeof displayName === "string" && displayName.trim();
    return {
      driverIdentificationEnabled: true,
      driverIdentificationStatus: identified ? "IDENTIFIED" : "UNATTRIBUTED",
      currentDriverDisplayName: identified ? displayName.trim() : null,
      driverIdentifiedAt: null,
      driverAttributionLabel: identified ? displayName.trim() : "Unassigned",
      driverIdentityWarning: null,
      driverTimeline: []
    };
  }

  function buildViewModel(device, enrollment, facility, range, records, statusInfo,
    nowMs, driverContext, engineHealth, retainedState, moveState) {
    if (enrollment && enrollment.liveOperationsNative === true) {
      return unprofiledViewModel(
        device, enrollment, facility, range, records, statusInfo, nowMs,
        driverContext, retainedState, moveState
      );
    }
    if (!enrollment || enrollment.profileConfigured === false) {
      return unprofiledViewModel(
        device, enrollment, facility, range, records, statusInfo, nowMs,
        driverContext, retainedState, moveState
      );
    }
    var hasFifthWheel = fifthWheelConfigured(enrollment);
    var engineTelemetry = sourceTelemetry(records, statusInfo, enrollment);
    var timelineResult = timeline.buildOperationalTimeline({
      startUtc: range.startUtc,
      endUtc: range.endUtc,
      capability: capabilityFor(enrollment, facility),
      telemetry: {
        ignitionSamples: engineTelemetry.ignitionSamples,
        rpmSamples: engineTelemetry.rpmSamples,
        speedSamples: engineTelemetry.speedSamples,
        jawSamples: engineTelemetry.jawSamples,
        communicationSamples: engineTelemetry.communicationSamples
      }
    });
    var currentInterval = timelineResult.intervals[timelineResult.intervals.length - 1];
    var moveResult;
    var movePrerequisitesValid = true;
    try {
      moveResult = moves.processTrailerMoves({
        deviceId: device.deviceId,
        startUtc: range.startUtc,
        endUtc: range.endUtc,
        fifthWheelStatusAvailable: hasFifthWheel,
        configuration: facility.moveConfiguration,
        couplingSamples: engineTelemetry.couplingSamples,
        timeline: timelineResult
      });
    } catch (error) {
      movePrerequisitesValid = false;
      moveResult = {
        moves: [],
        findings: [{
          code: error.code || "MOVE_CONFIGURATION_INVALID",
          message: "Verified trailer-move activity is unavailable",
          affectedMetrics: ["verified trailer-move count"]
        }]
      };
    }
    var summary = moveSummaries.summarizeMoves(moveResult.moves);
    var currentCoupling = latestRecord(records, normalization.CHANNELS.FIFTH_WHEEL_STATUS);
    var fuelLevel = latestRecord(records, normalization.CHANNELS.FUEL_LEVEL);
    var defLevel = latestRecord(records, normalization.CHANNELS.DEF_LEVEL);
    var engineHours = latestRecord(records, normalization.CHANNELS.ENGINE_HOURS);
    var capability = capabilityFor(enrollment, facility);
    var ignition = freshRecord(
      latestRecord(records, normalization.CHANNELS.IGNITION),
      nowMs,
      capability.ignitionFreshnessMs
    );
    var odometer = freshRecord(
      latestRecord(records, normalization.CHANNELS.ODOMETER),
      nowMs,
      facility.communicationFreshness.staleMs
    );
    var coolant = freshRecord(
      latestRecord(records, normalization.CHANNELS.ENGINE_COOLANT_TEMPERATURE),
      nowMs,
      facility.communicationFreshness.staleMs
    );
    var latestTelemetryAt = maximumTimestamp(
      records,
      statusInfo && statusInfo.timestamp ? statusInfo.timestamp : range.startUtc
    );
    var communication = communicationPresentation(statusInfo, facility, nowMs);
    var warning = warningFor(timelineResult, moveResult, communication);
    var completed = moveResult.moves.filter(function (move) {
      return move.status === moves.MOVE_STATUSES.COMPLETED_MOVE;
    });
    var lastCompleted = completed.reduce(function (latest, move) {
      if (!move.completionTimestamp) {
        return latest;
      }
      return !latest || Date.parse(move.completionTimestamp) > Date.parse(latest)
        ? move.completionTimestamp
        : latest;
    }, null);
    var speedRecord = latestRecord(records, normalization.CHANNELS.SPEED);
    var currentSpeed = statusInfo && statusInfo.currentSpeedMph !== null
      ? statusInfo.currentSpeedMph
      : (speedRecord ? speedRecord.value : null);
    var current = currentOperationalPresentation(
      statusInfo, enrollment, facility, nowMs, retainedState
    );
    var trailer = trailerPresentation(statusInfo, enrollment, nowMs);
    if (hasFifthWheel && !trailer.supported && currentCoupling
      && currentCoupling.value !== normalization.FIFTH_WHEEL_STATES.UNKNOWN) {
      var trailerDelayed = nowMs - Date.parse(currentCoupling.timestamp)
        >= capability.fifthWheelStatusFreshnessMs;
      trailer = {
        supported: true,
        state: currentCoupling.value,
        label: FIFTH_WHEEL_LABELS[currentCoupling.value],
        timestamp: currentCoupling.timestamp,
        delayed: false
      };
    }
    var state = current.state;
    var verifiedMovesAvailable = hasFifthWheel && movePrerequisitesValid;

    return Object.assign({
      deviceId: device.deviceId,
      displayName: enrollment.displayName || device.displayName,
      nativeDisplayName: device.displayName,
      assetId: enrollment.assetId || null,
      fleetsourceUnitNumber: enrollment.fleetsourceUnitNumber || null,
      customerUnitNumber: enrollment.customerUnitNumber || null,
      assetRole: enrollment.role || null,
      assetRoleLabel: enrollment.roleLabel || null,
      operationalStatus: enrollment.operationalStatus || null,
      operationalStatusLabel: enrollment.statusLabel || null,
      currentAssignment: enrollment.currentAssignment || null,
      homeFacilityId: enrollment.homeFacilityId || null,
      leaseStart: enrollment.leaseStart || null,
      commercialConfigurationStatus:
        enrollment.commercialConfigurationStatus || "NOT_CONFIGURED",
      advancedProfileConfigured: true,
      profileStatus: "Advanced SpotterIQ profile configured",
      groupReconciliation: device.inConfiguredFacilityGroup === false
        ? {
          state: "ASSIGNED_NOT_IN_GROUP",
          severity: "warning",
          message: "SpotterIQ assignment is active, but facility group membership does not match."
        }
        : enrollment.groupReconciliation || null,
      operationalState: state,
      operationalStateLabel: operatingModePresentation(
        current, trailer, hasFifthWheel
      ),
      operationalStateQualifierLabel: operatingModeQualifier(
        trailer, hasFifthWheel
      ),
      operationalStateEvidenceAt: current.evidenceAt,
      engineRunning: current.engineRunning,
      engineRpm: current.rpm,
      stateStartedAt: current.startedAt,
      stateDurationMs: current.durationMs,
      currentSpeedMph: currentSpeed,
      location: statusInfo && statusInfo.location || null,
      fifthWheelStatus: trailer.supported ? trailer.state
        : normalization.FIFTH_WHEEL_STATES.UNKNOWN,
      fifthWheelStatusLabel: trailer.supported ? trailer.label : null,
      trailerStateAt: trailer.timestamp,
      trailerStateDelayed: trailer.delayed,
      trailerStateSupported: hasFifthWheel,
      completedMoves: verifiedMovesAvailable
        ? summary.completedMoveCount : null,
      verifiedMovesLabel: verifiedMovesAvailable
        ? String(summary.completedMoveCount) : "Verified Moves Unavailable",
      moveInProgress: verifiedMovesAvailable && summary.moveInProgressCount > 0,
      lastCompletedMoveAt: verifiedMovesAvailable ? lastCompleted : null,
      fuelLevelPercent: fuelLevel ? fuelLevel.value : null,
      defLevelPercent: defLevel ? defLevel.value : null,
      engineHours: engineHours ? engineHours.value : null,
      ignitionOn: current.ignitionOn,
      odometerMiles: odometer ? odometer.value : null,
      engineCoolantTemperatureCelsius: coolant ? coolant.value : null,
      lastCommunicationAt: statusInfo ? statusInfo.timestamp : null,
      latestTelemetryAt: latestTelemetryAt,
      communicationCondition: communication.condition,
      communicationConditionLabel: communication.label,
      warningCode: warning.code,
      warningMessage: warning.message,
      affectedMetrics: warning.affectedMetrics,
      engineHealth: engineHealth || powertrainFaults.unavailable(
        enrollment.powertrainFaultMonitoringEnabled === true
          ? "FAULT_DATA_NOT_LOADED" : "CAPABILITY_DISABLED"
      )
    }, currentDriverProjection(statusInfo));
  }

  function createOperationsDataSource(configuration) {
    var faultDataAdapter = mygeotabFaults.createFaultDataAdapter();
    var cache = {
      scopeKey: null,
      facility: null,
      devices: [],
      enrollments: new Map(),
      range: null,
      recordsByDevice: new Map(),
      statusByDevice: new Map(),
      driverEventsByDevice: new Map(),
      driverIdentities: new Map(),
      driverStatusByDevice: new Map(),
      driverCursors: new Map(),
      lastOperationalStateByDevice: new Map(),
      engineHealthByDevice: new Map(),
      moveStateByDevice: new Map(),
      moveDayKey: null,
      moveWindow: null,
      moveLoadMetrics: null,
      cursors: {}
    };

    function scopeKey(context) {
      var selection = context.selection;
      return [
        selection && selection.customer && selection.customer.id
          || selection && selection.facility && selection.facility.customerId
          || "blocked",
        selection && selection.facility && selection.facility.id || "blocked"
      ].join("::");
    }

    function authorizedEnrollments() {
      return cache.devices.map(function (device) {
        return cache.enrollments.get(device.deviceId);
      }).filter(Boolean);
    }

    function normalizeAndMerge(rawRecords) {
      var allowed = new Set(cache.devices.map(function (device) {
        return device.deviceId;
      }));
      var normalized = normalization.normalizeStatusDataBatch(
        rawRecords,
        authorizedEnrollments(),
        allowed
      );
      normalized.forEach(function (record) {
        cache.recordsByDevice.set(
          record.deviceId,
          mergeRecords(cache.recordsByDevice.get(record.deviceId), [record])
        );
        var current = cache.cursors[record.channel] || cache.range.startUtc;
        if (Date.parse(record.timestamp) > Date.parse(current)) {
          cache.cursors[record.channel] = record.timestamp;
        }
      });
      return normalized;
    }

    async function normalizeStatuses(api, rawStatuses) {
      var allowed = new Set(cache.devices.map(function (device) {
        return device.deviceId;
      }));
      var normalized = (rawStatuses || []).map(function (raw) {
        var status = normalization.normalizeDeviceStatusInfo(raw, allowed);
        return status;
      }).filter(Boolean);
      var driverIds = normalized.map(function (status) {
        return status.currentDriverId;
      }).filter(Boolean);
      var identities = await client.getCurrentDriverUsers(api, driverIds);
      var displayNames = new Map();
      identities.forEach(function (result) {
        var identity = normalization.normalizeCurrentDriverIdentity(
          result.record, result.driverId
        );
        if (identity) {
          displayNames.set(result.driverId, identity.displayName);
        }
      });
      cache.devices.forEach(function (device) {
        var existing = cache.statusByDevice.get(device.deviceId);
        if (existing) {
          cache.statusByDevice.set(device.deviceId, Object.assign({}, existing, {
            currentDriverId: null,
            currentDriverDisplayName: null
          }));
        }
      });
      normalized.forEach(function (status) {
        status.currentDriverDisplayName = status.currentDriverId
          ? displayNames.get(status.currentDriverId) || null : null;
        var existing = cache.statusByDevice.get(status.deviceId);
        if (!existing || !existing.timestamp || (
          status.timestamp && Date.parse(status.timestamp) >= Date.parse(existing.timestamp)
        )) {
          cache.statusByDevice.set(status.deviceId, status);
        } else {
          cache.statusByDevice.set(status.deviceId, Object.assign({}, existing, {
            currentDriverId: status.currentDriverId,
            currentDriverDisplayName: status.currentDriverDisplayName
          }));
        }
      });
      return normalized;
    }

    function viewModels(nowMs) {
      cache.range.endUtc = new Date(nowMs).toISOString();
      var today = operationsMoveWindow(cache.facility, nowMs);
      if (cache.moveDayKey && cache.moveDayKey !== today.dayKey) {
        resetMoveState(today);
      }
      return cache.devices.map(function (device) {
        var model = buildViewModel(
          device,
          cache.enrollments.get(device.deviceId),
          cache.facility,
          cache.range,
          cache.recordsByDevice.get(device.deviceId) || [],
          cache.statusByDevice.get(device.deviceId) || null,
          nowMs,
          {
            events: cache.driverEventsByDevice.get(device.deviceId) || [],
            status: cache.driverStatusByDevice.get(device.deviceId) || "CURRENT"
          },
          cache.engineHealthByDevice.get(device.deviceId) || null,
          cache.lastOperationalStateByDevice.get(device.deviceId) || null,
          cache.moveStateByDevice.get(device.deviceId) || null
        );
        if (model.operationalState !== "UNAVAILABLE"
          && model.operationalStateEvidenceAt) {
          cache.lastOperationalStateByDevice.set(device.deviceId, {
            state: model.operationalState,
            evidenceAt: model.operationalStateEvidenceAt
          });
        }
        return model;
      });
    }

    function capableDevices() {
      return cache.devices.filter(function (device) {
        return device.fifthWheelCapabilityGroupMember === true;
      });
    }

    function resetMoveState(window) {
      cache.moveDayKey = window.dayKey;
      cache.moveWindow = window;
      cache.moveStateByDevice = new Map();
      capableDevices().forEach(function (device) {
        cache.moveStateByDevice.set(device.deviceId, {
          available: false,
          auxRecords: [],
          speedRecords: [],
          completedMoves: null,
          moveInProgress: false,
          lastCompletedMoveAt: null,
          cursorUtc: window.startUtc,
          dayKey: window.dayKey
        });
      });
    }

    async function refreshMoves(context, options) {
      if (!cache.facility || !cache.devices.length) {
        return { ok: true, scopeKey: cache.scopeKey, viewModels: [] };
      }
      var nowMs = context.nowMs || Date.now();
      var window = operationsMoveWindow(cache.facility, nowMs);
      var rebuild = options && options.rebuild === true;
      if (rebuild || cache.moveDayKey !== window.dayKey) {
        resetMoveState(window);
      } else {
        cache.moveWindow = window;
      }
      var requestScopeKey = cache.scopeKey;
      var overlapMs = cache.facility.refresh
        && Number.isFinite(cache.facility.refresh.overlapWindowMs)
        ? cache.facility.refresh.overlapWindowMs : 15000;
      var devices = capableDevices();
      var queryCount = 0;
      var results = await Promise.all(devices.map(async function (device) {
        var current = cache.moveStateByDevice.get(device.deviceId);
        var cursor = rebuild ? window.startUtc : current.cursorUtc || window.startUtc;
        var fromMs = Math.max(
          Date.parse(window.startUtc), Date.parse(cursor) - overlapMs
        );
        var fromDate = new Date(fromMs).toISOString();
        queryCount += 2;
        try {
          var batches = await Promise.all([
            fetchCompleteMoveRecords(
              context.api,
              operationsMoveStatusCall(device.deviceId, fromDate, window.endUtc),
              fromDate,
              window.endUtc,
              0
            ),
            fetchCompleteMoveRecords(
              context.api,
              operationsMoveLogCall(device.deviceId, fromDate, window.endUtc),
              fromDate,
              window.endUtc,
              0
            )
          ]);
          return {
            deviceId: device.deviceId,
            auxRecords: authorizedMoveRecords(batches[0], device.deviceId),
            speedRecords: authorizedMoveRecords(batches[1], device.deviceId),
            cursorUtc: window.endUtc
          };
        } catch (error) {
          return { deviceId: device.deviceId, error: error };
        }
      }));
      if (cache.scopeKey !== requestScopeKey || cache.moveDayKey !== window.dayKey) {
        return { ok: false, stale: true, scopeKey: requestScopeKey };
      }
      var failures = 0;
      results.forEach(function (result) {
        var state = cache.moveStateByDevice.get(result.deviceId);
        if (!state || result.error) {
          failures += 1;
          return;
        }
        state.auxRecords = mergeMoveRecords(state.auxRecords, result.auxRecords);
        state.speedRecords = mergeMoveRecords(state.speedRecords, result.speedRecords);
        state.cursorUtc = result.cursorUtc;
        var completed = shiftPerformance.verifiedMoveRecords(
          state.auxRecords, state.speedRecords
        );
        state.available = Array.isArray(completed);
        state.completedMoves = state.available ? completed.length : null;
        state.lastCompletedMoveAt = state.available && completed.length
          ? completed[completed.length - 1].completionTimestamp : null;
        state.moveInProgress = false;
      });
      cache.moveLoadMetrics = {
        capableDeviceCount: devices.length,
        queryCount: queryCount,
        failureCount: failures,
        fromUtc: window.startUtc,
        toUtc: window.endUtc
      };
      return {
        ok: true,
        scopeKey: cache.scopeKey,
        moveWindow: window,
        moveLoadMetrics: Object.assign({}, cache.moveLoadMetrics),
        viewModels: viewModels(nowMs)
      };
    }

    function initialDriverRequests(endUtc) {
      return authorizedEnrollments().map(function (enrollment) {
        var window = driverWindow(enrollment, endUtc, cache.range.startUtc);
        return window ? {
          deviceId: window.deviceId,
          fromDate: window.startUtc,
          toDate: window.endUtc
        } : null;
      }).filter(Boolean);
    }

    function refreshDriverRequests(endUtc) {
      return authorizedEnrollments().map(function (enrollment) {
        var window = driverWindow(enrollment, endUtc, cache.range.startUtc);
        if (!window) {
          return null;
        }
        var cursor = cache.driverCursors.get(window.deviceId) || window.startUtc;
        var overlapStart = new Date(
          Date.parse(cursor) - cache.facility.refresh.overlapWindowMs
        ).toISOString();
        return {
          deviceId: window.deviceId,
          fromDate: Date.parse(overlapStart) > Date.parse(window.startUtc)
            ? overlapStart : window.startUtc,
          toDate: window.endUtc
        };
      }).filter(function (request) {
        return request && Date.parse(request.toDate) > Date.parse(request.fromDate);
      });
    }

    async function loadDriverEvents(api, requests) {
      if (!requests.length) {
        return;
      }
      try {
        var result = await driverEvents.fetchAuthorizedDriverEvents(
          api, requests, cache.driverIdentities
        );
        cache.driverIdentities = result.identities;
        requests.forEach(function (request) {
          var merged = driverEvents.dedupeEvents(
            (cache.driverEventsByDevice.get(request.deviceId) || []).concat(
              result.events.filter(function (event) {
                return event.deviceId === request.deviceId;
              })
            )
          );
          cache.driverEventsByDevice.set(request.deviceId, merged);
          cache.driverStatusByDevice.set(request.deviceId, "CURRENT");
          cache.driverCursors.set(request.deviceId, request.toDate);
        });
      } catch (error) {
        requests.forEach(function (request) {
          cache.driverStatusByDevice.set(request.deviceId, "UNVERIFIED");
        });
      }
    }

    async function initialLoad(context) {
      if (!context.selection || !context.selection.ok) {
        return {
          ok: false,
          reason: context.selection && context.selection.reason || "No authorized assets",
          code: context.selection && context.selection.code || "no-authorized-assets",
          viewModels: []
        };
      }
      var facility = context.selection.facility;
      var devices;
      try {
        devices = await client.resolveAuthorizedDevices(
          context.api,
          facility,
          context.selectedGroupIds
        );
      } catch (error) {
        var deviceQueryError = new Error("Authorized device query failed");
        deviceQueryError.code = "AUTHORIZED_DEVICE_QUERY_FAILED";
        deviceQueryError.cause = error;
        throw deviceQueryError;
      }
      if (!devices.length) {
        cache.scopeKey = scopeKey(context) + "::configured-empty";
        cache.facility = facility;
        cache.devices = [];
        cache.enrollments = new Map();
        cache.recordsByDevice = new Map();
        cache.statusByDevice = new Map();
        cache.moveStateByDevice = new Map();
        cache.moveDayKey = null;
        cache.moveWindow = null;
        cache.moveLoadMetrics = null;
        return {
          ok: true,
          code: "configured-empty-facility",
          configuredEmpty: true,
          scopeKey: cache.scopeKey,
          customer: context.selection.customer,
          facility: facility,
          shiftOccurrence: null,
          shiftStatus: "CONFIGURED_EMPTY_FACILITY",
          deviceIds: [],
          devices: [],
          viewModels: [],
          latestFleetDataAt: null
        };
      }
      var deviceIds;
      var enrollments;
      var nowMs;
      var range;
      var diagnosticIds;
      try {
        deviceIds = devices.map(function (device) {
          return device.deviceId;
        });
        enrollments = enrollmentMap(configuration, facility, devices);
        nowMs = context.nowMs || Date.now();
        range = currentShiftRange(facility, nowMs);
        diagnosticIds = currentDiagnosticIds(Array.from(enrollments.values()));
      } catch (error) {
        var preflightError = new Error("Operations preflight failed");
        preflightError.code = "OPERATIONS_PREFLIGHT_FAILED";
        preflightError.cause = error;
        throw preflightError;
      }
      var currentStatuses;
      try {
        currentStatuses = await client.getDeviceStatusInfo(
          context.api,
          deviceIds,
          diagnosticIds
        );
      } catch (error) {
        var currentStateError = new Error("Current state query failed");
        currentStateError.code = "CURRENT_STATE_QUERY_FAILED";
        currentStateError.cause = error;
        throw currentStateError;
      }
      if (!Array.isArray(currentStatuses) || !currentStatuses.length) {
        var emptyError = new Error("MyGeotab returned no current status for the authorized facility");
        emptyError.code = "EMPTY_CURRENT_STATE_RESPONSE";
        throw emptyError;
      }

      cache.scopeKey = scopeKey(context) + "::" + deviceIds.join(",");
      cache.facility = facility;
      cache.devices = devices;
      cache.enrollments = enrollments;
      cache.range = range;
      cache.recordsByDevice = new Map();
      cache.statusByDevice = new Map();
      cache.driverEventsByDevice = new Map();
      cache.driverIdentities = new Map();
      cache.driverStatusByDevice = new Map();
      cache.driverCursors = new Map();
      cache.lastOperationalStateByDevice = new Map();
      cache.engineHealthByDevice = new Map();
      cache.moveStateByDevice = new Map();
      cache.moveDayKey = null;
      cache.moveWindow = null;
      cache.moveLoadMetrics = null;
      cache.cursors = {};
      resetMoveState(operationsMoveWindow(facility, nowMs));
      try {
        await normalizeStatuses(context.api, currentStatuses);
      } catch (error) {
        var normalizationError = new Error("Current state normalization failed");
        normalizationError.code = "CURRENT_STATE_NORMALIZATION_FAILED";
        normalizationError.cause = error;
        throw normalizationError;
      }
      try {
        return {
          ok: true,
          scopeKey: cache.scopeKey,
          customer: context.selection.customer,
          facility: facility,
          shiftOccurrence: range.occurrence,
          shiftStatus: range.shiftStatus,
          deviceIds: deviceIds,
          devices: devices.map(function (device) {
            return {
              deviceId: device.deviceId,
              displayName: device.displayName,
              fifthWheelCapabilityGroupMember:
                device.fifthWheelCapabilityGroupMember === true
            };
          }),
          viewModels: viewModels(nowMs),
          latestFleetDataAt: maximumTimestamp(
            Array.from(cache.recordsByDevice.values()).flat(),
            maximumTimestamp(
              Array.from(cache.statusByDevice.values()).map(function (status) {
                return { timestamp: status.timestamp };
              }).filter(function (status) {
                return status.timestamp;
              }),
              range.startUtc
            )
          )
        };
      } catch (error) {
        var projectionError = new Error("Current view model projection failed");
        projectionError.code = "CURRENT_VIEW_MODEL_FAILED";
        projectionError.cause = error;
        throw projectionError;
      }
    }

    async function checkScope(context) {
      if (!context.selection || !context.selection.ok || !cache.facility) {
        return { changed: true };
      }
      var devices = await client.resolveAuthorizedDevices(
        context.api,
        context.selection.facility,
        context.selectedGroupIds
      );
      var nextIds = devices.map(function (device) {
        return device.deviceId;
      });
      var currentIds = cache.devices.map(function (device) {
        return device.deviceId;
      });
      return {
        changed: nextIds.length !== currentIds.length
          || nextIds.some(function (deviceId, index) {
            return deviceId !== currentIds[index];
          })
      };
    }

    function fromDateForChannels(channels) {
      var earliest = channels.reduce(function (value, channel) {
        var cursor = cache.cursors[channel] || cache.range.endUtc;
        return !value || Date.parse(cursor) < Date.parse(value) ? cursor : value;
      }, null);
      return new Date(
        Date.parse(earliest) - cache.facility.refresh.overlapWindowMs
      ).toISOString();
    }

    async function refreshChannels(context, channels, includeStatus) {
      var nowMs = context.nowMs || Date.now();
      var toDate = new Date(nowMs).toISOString();
      var activeRange = currentShiftRange(cache.facility, nowMs);
      var activeOccurrenceId = activeRange.occurrence
        ? activeRange.occurrence.occurrenceId : null;
      var cachedOccurrenceId = cache.range.occurrence
        ? cache.range.occurrence.occurrenceId : null;
      if (activeOccurrenceId !== cachedOccurrenceId) {
        return {
          ok: true,
          requiresInitialReload: true,
          scopeKey: cache.scopeKey,
          viewModels: []
        };
      }
      var enrollments = authorizedEnrollments();
      var promises = [
        client.getStatusData(
          context.api,
          enrollments,
          channels,
          fromDateForChannels(channels),
          toDate
        )
      ];
      if (includeStatus) {
        promises.push(client.getDeviceStatusInfo(
          context.api,
          cache.devices.map(function (device) {
            return device.deviceId;
          }),
          diagnostics.diagnosticIds(enrollments, channels)
        ));
      }
      var results = await Promise.all(promises);
      normalizeAndMerge(results[0]);
      if (includeStatus) {
        await normalizeStatuses(context.api, results[1]);
      }
      return {
        ok: true,
        scopeKey: cache.scopeKey,
        viewModels: viewModels(nowMs),
        latestFleetDataAt: maximumTimestamp(
          Array.from(cache.recordsByDevice.values()).flat(),
          cache.range.startUtc
        )
      };
    }

    async function refreshCurrentOperational(context) {
      var nowMs = context.nowMs || Date.now();
      var enrollments = authorizedEnrollments();
      var rawStatuses = await client.getDeviceStatusInfo(
        context.api,
        cache.devices.map(function (device) { return device.deviceId; }),
        currentDiagnosticIds(enrollments)
      );
      if (!Array.isArray(rawStatuses) || !rawStatuses.length) {
        var error = new Error("MyGeotab returned no current status for the authorized facility");
        error.code = "EMPTY_CURRENT_STATE_RESPONSE";
        throw error;
      }
      await normalizeStatuses(context.api, rawStatuses);
      cache.range.endUtc = new Date(nowMs).toISOString();
      return {
        ok: true,
        scopeKey: cache.scopeKey,
        viewModels: viewModels(nowMs),
        latestFleetDataAt: maximumTimestamp(
          Array.from(cache.statusByDevice.values()).map(function (status) {
            return { timestamp: status.timestamp };
          }).filter(function (status) { return status.timestamp; }),
          cache.range.startUtc
        )
      };
    }

    async function refreshEngineHealth(context, deviceId) {
      var device = cache.devices.find(function (candidate) {
        return candidate.deviceId === deviceId;
      });
      var enrollment = cache.enrollments.get(deviceId);
      var requestScopeKey = cache.scopeKey;
      var enabled = Boolean(enrollment && (
        enrollment.powertrainFaultMonitoringEnabled === true
        || enrollment.capability
          && enrollment.capability.powertrainFaultMonitoringSupported === true
      ));
      var health;
      if (!device || !enrollment) {
        health = powertrainFaults.unavailable(
          "DEVICE_NOT_AUTHORIZED_OR_PROFILED"
        );
      } else if (enrollment.liveOperationsNative === true) {
        health = powertrainFaults.unavailable("CAPABILITY_DISABLED");
      } else if (enrollment.profileConfigured === false) {
        health = powertrainFaults.unavailable(
          "DEVICE_NOT_AUTHORIZED_OR_PROFILED"
        );
      } else if (!enabled) {
        health = powertrainFaults.unavailable("CAPABILITY_DISABLED");
      } else {
        health = await faultDataAdapter.fetchSelected({
          api: context.api,
          deviceId: deviceId,
          authorizedDeviceIds: cache.devices.map(function (candidate) {
            return candidate.deviceId;
          }),
          profileConfigured: enrollment.profileConfigured !== false,
          powertrainFaultMonitoringEnabled: true,
          faultConfiguration: enrollment.faultConfiguration,
          nowMs: context.nowMs || Date.now(),
          freshnessMs: powertrainFaults.DEFAULT_FRESHNESS_MS,
          lookbackMs: powertrainFaults.DEFAULT_LOOKBACK_MS
        });
      }
      if (cache.scopeKey !== requestScopeKey) {
        return { ok: false, stale: true, deviceId: deviceId };
      }
      cache.engineHealthByDevice.set(deviceId, health);
      var models = viewModels(context.nowMs || Date.now());
      return {
        ok: true,
        scopeKey: cache.scopeKey,
        deviceId: deviceId,
        engineHealth: health,
        viewModel: models.find(function (model) {
          return model.deviceId === deviceId;
        }) || null
      };
    }

    return {
      scopeKey: scopeKey,
      checkScope: checkScope,
      initialLoad: initialLoad,
      refreshMoves: refreshMoves,
      refreshOperational: refreshCurrentOperational,
      refreshFuelDef: function (context) {
        return refreshChannels(context, FUEL_DEF_CHANNELS, false);
      },
      refreshEngineHours: function (context) {
        return refreshChannels(context, ENGINE_HOURS_CHANNELS, false);
      },
      refreshEngineHealth: refreshEngineHealth,
      clear: function () {
        cache.scopeKey = null;
        cache.facility = null;
        cache.devices = [];
        cache.enrollments = new Map();
        cache.range = null;
        cache.recordsByDevice = new Map();
        cache.statusByDevice = new Map();
        cache.driverEventsByDevice = new Map();
        cache.driverIdentities = new Map();
        cache.driverStatusByDevice = new Map();
        cache.driverCursors = new Map();
        cache.lastOperationalStateByDevice = new Map();
        cache.engineHealthByDevice = new Map();
        cache.moveStateByDevice = new Map();
        cache.moveDayKey = null;
        cache.moveWindow = null;
        cache.moveLoadMetrics = null;
        cache.cursors = {};
      },
      snapshot: function () {
        return cache;
      }
    };
  }

  return {
    CURRENT_DIAGNOSTIC_IDS: CURRENT_DIAGNOSTIC_IDS,
    ENGINE_HOURS_CHANNELS: ENGINE_HOURS_CHANNELS,
    FIFTH_WHEEL_LABELS: FIFTH_WHEEL_LABELS,
    FUEL_DEF_CHANNELS: FUEL_DEF_CHANNELS,
    OPERATIONAL_CHANNELS: OPERATIONAL_CHANNELS,
    SPOTTERIQ_COMMUNICATION_RETENTION_MS: SPOTTERIQ_COMMUNICATION_RETENTION_MS,
    STATE_LABELS: STATE_LABELS,
    buildViewModel: buildViewModel,
    communicationPresentation: communicationPresentation,
    currentOperationalPresentation: currentOperationalPresentation,
    createOperationsDataSource: createOperationsDataSource,
    currentShiftRange: currentShiftRange,
    trailerPresentation: trailerPresentation,
    driverEnabled: driverEnabled,
    currentDriverProjection: currentDriverProjection,
    driverProjection: driverProjection,
    driverWindow: driverWindow,
    engineRunningValue: engineRunningValue,
    fifthWheelConfigured: fifthWheelConfigured,
    operatingModePresentation: operatingModePresentation,
    operatingModeQualifier: operatingModeQualifier,
    mergeRecords: mergeRecords,
    mergeMoveRecords: mergeMoveRecords,
    operationsMoveWindow: operationsMoveWindow,
    sourceTelemetry: sourceTelemetry
  };
}));
