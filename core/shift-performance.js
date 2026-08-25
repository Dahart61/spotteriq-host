(function (root, factory) {
  "use strict";

  var timezone = typeof module === "object" && module.exports
    ? require("./timezone") : root.SIQ_TIMEZONE;
  var engineHoursReport = typeof module === "object" && module.exports
    ? require("./engine-hours-report") : root.SIQ_ENGINE_HOURS_REPORT;
  var timeline = typeof module === "object" && module.exports
    ? require("./timeline") : root.SIQ_TIMELINE;
  var operationalStates = typeof module === "object" && module.exports
    ? require("./operational-states") : root.SIQ_OPERATIONAL_STATES;
  var api = factory(timezone, engineHoursReport, timeline, operationalStates);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_SHIFT_PERFORMANCE = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  timezone,
  engineHoursReport,
  timeline,
  operationalStates
) {
  "use strict";

  var KPH_TO_MPH = 0.621371;
  var LITERS_TO_GALLONS = 0.264172;
  var MOVING_MPH = 2;
  var ENGINE_RUNNING_RPM = 400;
  // A stored state transition can survive ordinary sampling gaps, but not a
  // genuine historical communication break. This is the one shared boundary
  // used for historical state continuity and parked-meter continuity.
  var HISTORICAL_CONTINUITY_MAX_GAP_HOURS = 25;
  var HISTORICAL_CONTINUITY_MAX_GAP_MS =
    HISTORICAL_CONTINUITY_MAX_GAP_HOURS * 60 * 60 * 1000;
  // Retained as a compatibility alias for existing consumers.
  var PARKED_COMMUNICATION_MAX_GAP_HOURS = HISTORICAL_CONTINUITY_MAX_GAP_HOURS;
  var SHUTDOWN_BOUNDARY_MAX_MINUTES = 10;
  var SHUTDOWN_ASYNC_MAX_SECONDS = 60;
  var SHUTDOWN_RUNNING_TRANSITION_MAX_MINUTES = 2;
  var DEFAULT_REPORT_FRESHNESS_MS = 120000;

  function resolveWindow(selection, nowMs, timeZone) {
    var custom = selection && selection.custom || {};
    if (!custom.startDate || !custom.startTime || !custom.endDate || !custom.endTime) {
      throw new RangeError("Start date and time and end date and time are required");
    }
    var startMs = Date.parse(timezone.resolveLocalDateTime(
      custom.startDate, custom.startTime, timeZone, custom.startDisambiguation || "earlier"
    ).iso);
    var endMs = Date.parse(timezone.resolveLocalDateTime(
      custom.endDate, custom.endTime, timeZone, custom.endDisambiguation || "later"
    ).iso);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new RangeError("End must be after start");
    }
    return {
      preset: "custom",
      startUtc: new Date(startMs).toISOString(),
      endUtc: new Date(endMs).toISOString(),
      timezone: timeZone,
      durationMinutes: (endMs - startMs) / 60000
    };
  }

  function valueOf(record, lower, upper) {
    return record && Object.prototype.hasOwnProperty.call(record, lower)
      ? record[lower] : record && record[upper];
  }

  function recordTime(record) {
    return Date.parse(valueOf(record, "dateTime", "DateTime"));
  }

  function recordData(record) {
    return Number(valueOf(record, "data", "Data"));
  }

  function sorted(records) {
    return (Array.isArray(records) ? records : []).filter(function (record) {
      return Number.isFinite(recordTime(record));
    }).slice().sort(function (left, right) {
      return recordTime(left) - recordTime(right);
    });
  }

  function booleanLevel(value) {
    if (value === true || value === 1 || value === "1"
      || String(value).toUpperCase() === "ON"
      || String(value).toUpperCase() === "HIGH") {
      return true;
    }
    if (value === false || value === 0 || value === "0"
      || String(value).toUpperCase() === "OFF"
      || String(value).toUpperCase() === "LOW") {
      return false;
    }
    return null;
  }

  function recordId(record) {
    var value = valueOf(record, "id", "Id");
    return typeof value === "string" && value.trim() ? value : null;
  }

  function canAssociateStoredMeterWithFinalShutdown(rpm, ignition, startMs) {
    var envelopeMs = SHUTDOWN_BOUNDARY_MAX_MINUTES * 60 * 1000;
    var asyncMs = SHUTDOWN_ASYNC_MAX_SECONDS * 1000;
    var runningTransitionMs = SHUTDOWN_RUNNING_TRANSITION_MAX_MINUTES
      * 60 * 1000;
    var initialRpm = rpm.points[0];
    var initialIgnition = ignition.points[0];
    var requiresShutdown = initialRpm.value >= ENGINE_RUNNING_RPM
      || initialIgnition.value === true;
    if (!requiresShutdown) {
      return { qualified: false, reasonCode: null };
    }

    var rpmZero = initialRpm.value === 0 ? initialRpm
      : rpm.points.find(function (point) {
        return point.time > startMs && point.value === 0;
      });
    var ignitionOff = initialIgnition.value === false ? initialIgnition
      : ignition.points.find(function (point) {
        return point.time > startMs && point.value === false;
      });
    if (!rpmZero || !ignitionOff
      || rpmZero.time - startMs > envelopeMs
      || ignitionOff.time - startMs > envelopeMs) {
      return { qualified: false, reasonCode: "ENGINE_OPERATION_OBSERVED" };
    }

    var laterRunning = rpm.points.some(function (point) {
      return point.time > rpmZero.time && point.value >= ENGINE_RUNNING_RPM;
    });
    var laterIgnitionOn = ignition.points.some(function (point) {
      return point.time > ignitionOff.time && point.value === true;
    });
    if (laterRunning || laterIgnitionOn) {
      return { qualified: false, reasonCode: "ENGINE_OPERATION_OBSERVED" };
    }

    var transition = rpm.points.filter(function (point) {
      return point.time >= startMs && point.time <= rpmZero.time;
    });
    var nonIncreasing = transition.every(function (point, index) {
      return index === 0 || point.value <= transition[index - 1].value;
    });
    var zeroLagMs = rpmZero.time - startMs;
    var firstSubthreshold = transition.find(function (point) {
      return point.time > startMs && point.value < ENGINE_RUNNING_RPM;
    });
    var explicitCoastdown = transition.some(function (point) {
      return point.time > startMs && point.value > 0
        && point.value < ENGINE_RUNNING_RPM;
    });
    var promptIgnitionOff = ignitionOff.time - startMs <= asyncMs;
    // The outer envelope only bounds one proven shutdown. Longer sequences
    // must show prompt sub-threshold coastdown rather than unobserved runtime.
    var continuous = nonIncreasing && (
      initialRpm.value < ENGINE_RUNNING_RPM
      || zeroLagMs <= asyncMs
      || (firstSubthreshold
        && firstSubthreshold.time - startMs <= runningTransitionMs
        && (explicitCoastdown || promptIgnitionOff))
    );
    if (!continuous) {
      return { qualified: false, reasonCode: "ENGINE_OPERATION_OBSERVED" };
    }
    return {
      qualified: true,
      reasonCode: null,
      completedAt: new Date(Math.max(rpmZero.time, ignitionOff.time)).toISOString()
    };
  }

  function zeroEngineOperationEvidence(
    rpmRecords,
    ignitionRecords,
    communicationRecords,
    startUtc,
    endUtc
  ) {
    var startMs = Date.parse(startUtc);
    var endMs = Date.parse(endUtc);
    function fail(reasonCode, contradictory) {
      return {
        trustworthy: false,
        zeroOperation: false,
        shutdownBoundaryQualified: false,
        reasonCode: reasonCode,
        contradictory: contradictory === true,
        startUtc: startUtc,
        endUtc: endUtc
      };
    }
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      return fail("ENGINE_STATE_INTERVAL_INVALID");
    }
    function observations(records, transform) {
      var source = sorted(records).filter(function (record) {
        var time = recordTime(record);
        return time >= startMs && time <= endMs;
      });
      if (!source.length || recordTime(source[0]) !== startMs) {
        return { ok: false, reasonCode: "ENGINE_STATE_COVERAGE_INCOMPLETE" };
      }
      var grouped = new Map();
      for (var index = 0; index < source.length; index += 1) {
        var time = recordTime(source[index]);
        var value = transform(source[index]);
        if (value === null || value === undefined
          || (typeof value === "number" && !Number.isFinite(value))) {
          return { ok: false, reasonCode: "ENGINE_STATE_EVIDENCE_MALFORMED" };
        }
        if (grouped.has(time) && grouped.get(time) !== value) {
          return {
            ok: false,
            reasonCode: "ENGINE_STATE_EVIDENCE_CONFLICT",
            contradictory: true
          };
        }
        grouped.set(time, value);
      }
      return {
        ok: true,
        points: Array.from(grouped.entries()).map(function (entry) {
          return { time: entry[0], value: entry[1] };
        }),
        values: Array.from(grouped.values())
      };
    }
    var rpm = observations(rpmRecords, function (record) {
      var raw = valueOf(record, "data", "Data");
      if (raw === null || raw === "" || typeof raw === "boolean") {
        return null;
      }
      var value = Number(raw);
      return Number.isFinite(value) && value >= 0 ? value : null;
    });
    if (!rpm.ok) {
      return fail(rpm.reasonCode, rpm.contradictory);
    }
    var ignition = observations(ignitionRecords, function (record) {
      return booleanLevel(valueOf(record, "data", "Data"));
    });
    if (!ignition.ok) {
      return fail(ignition.reasonCode, ignition.contradictory);
    }
    var communication = sorted(communicationRecords).filter(function (record) {
      var time = recordTime(record);
      return Boolean(recordId(record)) && time > startMs && time <= endMs;
    });
    if (endMs > startMs && !communication.length) {
      return fail("COMMUNICATION_EVIDENCE_MISSING");
    }
    var communicationPoints = [startMs].concat(communication.map(recordTime));
    communicationPoints.push(endMs);
    var maximumGapMs = HISTORICAL_CONTINUITY_MAX_GAP_MS;
    var excessiveGap = communicationPoints.some(function (time, index) {
      return index > 0 && time - communicationPoints[index - 1] > maximumGapMs;
    });
    if (excessiveGap) {
      return fail("COMMUNICATION_COVERAGE_INCOMPLETE");
    }
    var operationObserved = rpm.values.some(function (value) {
      return value >= ENGINE_RUNNING_RPM;
    }) || ignition.values.some(function (value) { return value === true; });
    var shutdown = canAssociateStoredMeterWithFinalShutdown(
      rpm, ignition, startMs
    );
    var zeroOperation = !operationObserved || shutdown.qualified;
    return {
      trustworthy: true,
      zeroOperation: zeroOperation,
      reasonCode: zeroOperation ? null
        : shutdown.reasonCode || "ENGINE_OPERATION_OBSERVED",
      contradictory: false,
      shutdownBoundaryQualified: shutdown.qualified,
      shutdownCompletedAt: shutdown.completedAt || null,
      startUtc: startUtc,
      endUtc: endUtc,
      communication: {
        source: "LOG_RECORD",
        maximumGapHours: HISTORICAL_CONTINUITY_MAX_GAP_HOURS,
        observationCount: communication.length,
        lastObservedAt: communication.length
          ? new Date(recordTime(communication[communication.length - 1])).toISOString()
          : new Date(startMs).toISOString()
      }
    };
  }

  function speedMph(record) {
    var raw = Number(valueOf(record, "speed", "Speed"));
    if (!Number.isFinite(raw)) {
      raw = recordData(record);
    }
    return Number.isFinite(raw) && raw >= 0 ? raw * KPH_TO_MPH : null;
  }

  function verifiedMoveRecords(fifthWheelRecords, speedRecords) {
    var jaw = sorted(fifthWheelRecords).map(function (record) {
      return { time: recordTime(record), value: booleanLevel(valueOf(record, "data", "Data")) };
    }).filter(function (record) { return record.value !== null; });
    var speeds = sorted(speedRecords).map(function (record) {
      return { time: recordTime(record), mph: speedMph(record) };
    }).filter(function (record) { return record.mph !== null; });
    if (jaw.length < 2 || !speeds.length) {
      return null;
    }
    var moves = [];
    var previous = null;
    var candidate = null;
    jaw.forEach(function (observation) {
      if (observation.value === previous) {
        return;
      }
      if (observation.value === true && previous === false) {
        candidate = { coupledAt: observation.time, moved: false };
      } else if (observation.value === false && previous === true && candidate) {
        var movement = speeds.filter(function (speed) {
          return speed.time >= candidate.coupledAt
            && speed.time <= observation.time
            && speed.mph >= MOVING_MPH;
        });
        candidate.moved = movement.length > 0;
        if (candidate.moved) {
          moves.push({
            couplingTimestamp: new Date(candidate.coupledAt).toISOString(),
            completionTimestamp: new Date(observation.time).toISOString(),
            durationMinutes: (observation.time - candidate.coupledAt) / 60000,
            qualifyingSpeedObservationCount: movement.length,
            peakCoupledSpeedMph: movement.reduce(function (maximum, speed) {
              return Math.max(maximum, speed.mph);
            }, 0),
            movementSpeedThresholdMph: MOVING_MPH
          });
        }
        candidate = null;
      }
      previous = observation.value;
    });
    return moves;
  }

  function countVerifiedMoves(fifthWheelRecords, speedRecords) {
    var records = verifiedMoveRecords(fifthWheelRecords, speedRecords);
    return records === null ? null : records.length;
  }

  function cumulativeDelta(records, multiplier) {
    var values = sorted(records).map(recordData).filter(Number.isFinite);
    if (values.length < 2) {
      return null;
    }
    var delta = (values[values.length - 1] - values[0]) * multiplier;
    return Number.isFinite(delta) && delta >= 0 ? delta : null;
  }

  function lastDriverName(events) {
    return (Array.isArray(events) ? events : []).slice().sort(function (left, right) {
      return Date.parse(left.timestamp) - Date.parse(right.timestamp);
    }).reduce(function (current, event) {
      return event.action === "CLEARED" ? null
        : event.driverDisplayName || current;
    }, null);
  }

  function positive(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function reportCapability(device, options) {
    var configured = device && (device.reportCapability
      || device.operationalCapability || device.capability) || {};
    var facility = options && options.facility || {};
    var communication = facility.communicationFreshness || {};
    return {
      deviceId: device.deviceId,
      // Engine/motion reporting is independent of Fifth Wheel classification.
      // Fifth Wheel metrics continue through their existing verified evidence path.
      jawSensorInstalled: false,
      movementSpeedThresholdMph: Number.isFinite(configured.movementSpeedThresholdMph)
        ? configured.movementSpeedThresholdMph : MOVING_MPH,
      engineOnRpmThreshold: ENGINE_RUNNING_RPM,
      ignitionFreshnessMs: positive(
        configured.ignitionFreshnessMs,
        positive(configured.rpmFreshnessMs, DEFAULT_REPORT_FRESHNESS_MS)
      ),
      rpmFreshnessMs: positive(
        configured.rpmFreshnessMs, DEFAULT_REPORT_FRESHNESS_MS
      ),
      speedFreshnessMs: positive(
        configured.speedFreshnessMs, DEFAULT_REPORT_FRESHNESS_MS
      ),
      communicationFreshnessMs: positive(
        configured.communicationFreshnessMs,
        positive(communication.currentMs, DEFAULT_REPORT_FRESHNESS_MS)
      )
    };
  }

  function storedSamples(records, transform) {
    return sorted(records).filter(function (record) {
      return Boolean(recordId(record));
    }).map(function (record) {
      var value = transform(record);
      return value === null || value === undefined
        || typeof value === "number" && !Number.isFinite(value) ? null : {
          timestamp: new Date(recordTime(record)).toISOString(),
          value: value
        };
    }).filter(Boolean);
  }

  function historicalIgnitionSamples(ignitionRecords, evidenceRecords, continuityMs) {
    var events = storedSamples(ignitionRecords, function (record) {
      return booleanLevel(valueOf(record, "data", "Data"));
    }).map(function (sample) {
      return { timestamp: sample.timestamp, value: sample.value, ignition: true };
    });
    storedSamples(evidenceRecords, function () { return true; }).forEach(function (sample) {
      events.push({ timestamp: sample.timestamp, ignition: false });
    });
    events.sort(function (left, right) {
      return Date.parse(left.timestamp) - Date.parse(right.timestamp)
        || Number(right.ignition) - Number(left.ignition);
    });

    var currentIgnition = null;
    var lastEvidenceMs = null;
    var samples = [];
    events.forEach(function (event) {
      var eventMs = Date.parse(event.timestamp);
      if (lastEvidenceMs !== null && eventMs - lastEvidenceMs > continuityMs) {
        currentIgnition = null;
      }
      if (event.ignition) {
        currentIgnition = event.value;
      }
      if (currentIgnition !== null) {
        samples.push({ timestamp: event.timestamp, value: currentIgnition });
      }
      lastEvidenceMs = eventMs;
    });
    return samples;
  }

  function rpmOnlyIgnitionSamples(rpmRecords, threshold) {
    return storedSamples(rpmRecords, function (record) {
      return recordData(record) >= threshold;
    });
  }

  function buildReportTimeline(device, data, window, options) {
    var logRecords = data && data.speed || [];
    var capability = reportCapability(device, options);
    var storedEvidence = (data && data.rpm || []).concat(logRecords);
    var nativeIgnition = storedSamples(data && data.ignition, function (record) {
      return booleanLevel(valueOf(record, "data", "Data"));
    });
    capability.historicalIgnitionAuthority = nativeIgnition.length > 0;
    return timeline.buildOperationalTimeline({
      capability: capability,
      startUtc: window.startUtc,
      endUtc: window.endUtc,
      compactStates: true,
      telemetry: {
        // Stored native ignition is the historical engine authority. RPM and
        // LogRecord evidence reaffirm its continuity without making fresh RPM
        // mandatory. Assets with no stored ignition transitions use a separate
        // RPM-derived ignition path that still expires with RPM freshness.
        ignitionSamples: capability.historicalIgnitionAuthority
          ? historicalIgnitionSamples(
            data && data.ignition, storedEvidence, HISTORICAL_CONTINUITY_MAX_GAP_MS
          )
          : rpmOnlyIgnitionSamples(data && data.rpm, capability.engineOnRpmThreshold),
        rpmSamples: storedSamples(data && data.rpm, recordData),
        speedSamples: storedSamples(logRecords, speedMph),
        jawSamples: [],
        communicationSamples: storedSamples(
          (data && data.ignition || []).concat(storedEvidence), function () { return true; }
        )
      }
    });
  }

  function activityIntervals(operatingTimeline) {
    var states = operationalStates.STATES;
    var movingStates = new Set([
      states.COUPLED_MOVING, states.BOBTAIL_MOVING, states.ENGINE_ON_MOVING
    ]);
    var stationaryStates = new Set([
      states.COUPLED_IDLE, states.BOBTAIL_IDLE, states.ENGINE_ON_STATIONARY
    ]);
    return (operatingTimeline.intervals || []).map(function (interval) {
      var moving = movingStates.has(interval.state);
      var stationary = stationaryStates.has(interval.state);
      return {
        start: Date.parse(interval.startUtc),
        end: Date.parse(interval.endUtc),
        startUtc: interval.startUtc,
        endUtc: interval.endUtc,
        durationMinutes: interval.durationMs / 60000,
        state: interval.state,
        engineRunning: moving || stationary,
        moving: moving,
        stationary: stationary,
        keyOn: interval.state === states.KEY_ON_ENGINE_NOT_RUNNING,
        engineOff: interval.state === states.ENGINE_OFF,
        unavailable: interval.state === states.UNKNOWN
          || interval.state === states.NOT_COMMUNICATING,
        speedMph: interval.speedMph
      };
    });
  }

  function couplingBuckets(capable, fifthWheelRecords, activity) {
    var result = {
      coupledMinutes: 0,
      uncoupledMinutes: 0,
      coupledMovingMinutes: 0,
      uncoupledMovingMinutes: 0,
      coupledDistanceMiles: 0,
      uncoupledDistanceMiles: 0
    };
    if (!capable) {
      return result;
    }
    var jaw = sorted(fifthWheelRecords).map(function (record) {
      return {
        time: recordTime(record),
        value: booleanLevel(valueOf(record, "data", "Data"))
      };
    }).filter(function (record) { return record.value !== null; });
    var jawIndex = 0;
    var currentJaw = null;
    function add(start, end, interval) {
      if (currentJaw === null || end <= start) {
        return;
      }
      var minutes = (end - start) / 60000;
      var prefix = currentJaw ? "coupled" : "uncoupled";
      result[prefix + "Minutes"] += minutes;
      if (interval.moving) {
        result[prefix + "MovingMinutes"] += minutes;
        if (Number.isFinite(interval.speedMph)) {
          result[prefix + "DistanceMiles"] += interval.speedMph * minutes / 60;
        }
      }
    }
    (activity || []).forEach(function (interval) {
      while (jawIndex < jaw.length && jaw[jawIndex].time <= interval.start) {
        currentJaw = jaw[jawIndex].value;
        jawIndex += 1;
      }
      var cursor = interval.start;
      while (jawIndex < jaw.length && jaw[jawIndex].time < interval.end) {
        add(cursor, jaw[jawIndex].time, interval);
        currentJaw = jaw[jawIndex].value;
        cursor = jaw[jawIndex].time;
        jawIndex += 1;
      }
      add(cursor, interval.end, interval);
    });
    return result;
  }

  function analyzeUnit(device, data, window, options) {
    var capable = device.fifthWheelCapabilityGroupMember === true;
    var operatingTimeline = buildReportTimeline(device, data, window, options);
    var activity = activityIntervals(operatingTimeline);
    var buckets = {
      movingMinutes: 0,
      idleMinutes: 0,
      keyOnMinutes: 0,
      engineOffMinutes: 0,
      stoppedMinutes: 0,
      engineRunningMinutes: 0,
      coupledMinutes: 0,
      uncoupledMinutes: 0,
      coupledMovingMinutes: 0,
      uncoupledMovingMinutes: 0,
      coupledDistanceMiles: 0,
      uncoupledDistanceMiles: 0,
      prolongedInactivityMinutes: 0
    };
    var inactivityRun = 0;
    activity.forEach(function (interval) {
      var durationMinutes = interval.durationMinutes;
      buckets.movingMinutes += interval.moving ? durationMinutes : 0;
      buckets.idleMinutes += interval.stationary ? durationMinutes : 0;
      buckets.engineRunningMinutes += interval.engineRunning ? durationMinutes : 0;
      buckets.keyOnMinutes += interval.keyOn ? durationMinutes : 0;
      buckets.engineOffMinutes += interval.engineOff ? durationMinutes : 0;
      buckets.stoppedMinutes += interval.unavailable ? durationMinutes : 0;
      if (!interval.unavailable && !interval.moving && !interval.engineRunning) {
        inactivityRun += durationMinutes;
        buckets.prolongedInactivityMinutes = Math.max(
          buckets.prolongedInactivityMinutes, inactivityRun
        );
      } else {
        inactivityRun = 0;
      }
    });
    Object.assign(buckets, couplingBuckets(capable, data.fifthWheel, activity));

    var fuelGallons = cumulativeDelta(data.fuel, LITERS_TO_GALLONS);
    var engineHours = engineHoursReport.cumulativeDeltaHours(data.engineHours);
    var averageGph = fuelGallons !== null && engineHours !== null && engineHours > 0
      ? fuelGallons / engineHours : null;
    var allocationSupported = buckets.stoppedMinutes === 0;
    var idleFuelGallons = allocationSupported && averageGph !== null
      ? Math.min(fuelGallons, averageGph * buckets.idleMinutes / 60) : null;
    var productiveFuel = allocationSupported
      && fuelGallons !== null && idleFuelGallons !== null
      ? Math.max(0, fuelGallons - idleFuelGallons) : null;
    var productiveHours = Math.max(
      0, buckets.engineRunningMinutes - buckets.idleMinutes
    ) / 60;
    var speedObservations = sorted(data.speed).map(function (record) {
      return { timestamp: new Date(recordTime(record)).toISOString(), mph: speedMph(record) };
    }).filter(function (observation) { return observation.mph !== null; });
    var peakSpeed = speedObservations.length ? speedObservations.reduce(function (maximum, observation) {
      return observation.mph > maximum.mph ? observation : maximum;
    }) : null;
    var maxSpeedMph = peakSpeed ? peakSpeed.mph : null;
    var classifiedMinutes = Math.max(0, window.durationMinutes - buckets.stoppedMinutes);
    var moveRecords = capable
      ? verifiedMoveRecords(data.fifthWheel, data.speed) : null;
    var moves = moveRecords === null ? null : moveRecords.length;

    var unit = Object.assign({
      deviceId: device.deviceId,
      displayName: device.displayName,
      fifthWheelCapable: capable,
      moveCount: moves,
      moveBasis: capable && moves !== null ? "verified" : "unavailable",
      shiftMinutes: window.durationMinutes,
      classifiedMinutes: classifiedMinutes,
      utilizationPercent: window.durationMinutes > 0
        ? buckets.movingMinutes / window.durationMinutes * 100 : null,
      idlePercent: buckets.engineRunningMinutes > 0
        ? buckets.idleMinutes / buckets.engineRunningMinutes * 100 : null,
      fuelGallons: fuelGallons,
      engineHoursDelta: engineHours,
      idleFuelGallons: idleFuelGallons,
      idleFuelEstimated: idleFuelGallons !== null,
      fuelAllocationSupported: allocationSupported,
      productiveFuelGallons: productiveFuel,
      gallonsPerProductiveHour: productiveFuel !== null && productiveHours > 0
        ? productiveFuel / productiveHours : null,
      maxSpeedMph: maxSpeedMph,
      peakSpeedTimestamp: peakSpeed ? peakSpeed.timestamp : null,
      verifiedMoveRecords: moveRecords,
      coupledAverageMovingSpeedMph: buckets.coupledMovingMinutes > 0
        ? buckets.coupledDistanceMiles / (buckets.coupledMovingMinutes / 60) : null,
      uncoupledAverageMovingSpeedMph: buckets.uncoupledMovingMinutes > 0
        ? buckets.uncoupledDistanceMiles / (buckets.uncoupledMovingMinutes / 60) : null,
      driverDisplayName: lastDriverName(data.driverEvents)
    }, buckets, {
      offMinutes: buckets.keyOnMinutes + buckets.engineOffMinutes,
      unavailableMinutes: buckets.stoppedMinutes
    });
    Object.defineProperty(unit, "operatingTimeline", {
      value: operatingTimeline,
      enumerable: false
    });
    Object.defineProperty(unit, "operatingIntervals", {
      value: activity,
      enumerable: false
    });
    return unit;
  }

  function sum(units, key) {
    return units.reduce(function (total, unit) {
      return total + (Number.isFinite(unit[key]) ? unit[key] : 0);
    }, 0);
  }

  function optionalSum(units, key) {
    var values = units.filter(function (unit) { return Number.isFinite(unit[key]); });
    return values.length ? sum(values, key) : null;
  }

  function facilitySummary(units, window) {
    var source = Array.isArray(units) ? units : [];
    var totalObservable = window.durationMinutes * source.length;
    var verified = source.filter(function (unit) { return unit.moveBasis === "verified"; });
    var coupledMoving = sum(source, "coupledMovingMinutes");
    var uncoupledMoving = sum(source, "uncoupledMovingMinutes");
    var coupledDistance = optionalSum(
      source.filter(function (unit) { return unit.fifthWheelCapable; }),
      "coupledDistanceMiles"
    );
    var uncoupledDistance = optionalSum(
      source.filter(function (unit) { return unit.fifthWheelCapable; }),
      "uncoupledDistanceMiles"
    );
    var engineRunning = sum(source, "engineRunningMinutes");
    var idle = sum(source, "idleMinutes");
    return {
      units: source.length,
      totalMoves: optionalSum(verified, "moveCount"),
      verifiedMoves: optionalSum(verified, "moveCount"),
      utilizationPercent: totalObservable > 0
        ? sum(source, "movingMinutes") / totalObservable * 100 : null,
      engineRunningMinutes: engineRunning,
      movingMinutes: sum(source, "movingMinutes"),
      idleMinutes: idle,
      offMinutes: sum(source, "offMinutes"),
      unavailableMinutes: sum(source, "unavailableMinutes"),
      idlePercent: engineRunning > 0 ? idle / engineRunning * 100 : null,
      fuelGallons: optionalSum(source, "fuelGallons"),
      idleFuelGallons: optionalSum(source, "idleFuelGallons"),
      coupledMinutes: optionalSum(
        source.filter(function (unit) { return unit.fifthWheelCapable; }), "coupledMinutes"
      ),
      uncoupledMinutes: optionalSum(
        source.filter(function (unit) { return unit.fifthWheelCapable; }), "uncoupledMinutes"
      ),
      coupledDistanceMiles: coupledDistance,
      uncoupledDistanceMiles: uncoupledDistance,
      coupledAverageMovingSpeedMph: coupledMoving > 0 && coupledDistance !== null
        ? coupledDistance / (coupledMoving / 60) : null,
      uncoupledAverageMovingSpeedMph: uncoupledMoving > 0 && uncoupledDistance !== null
        ? uncoupledDistance / (uncoupledMoving / 60) : null
    };
  }

  return {
    ENGINE_RUNNING_RPM: ENGINE_RUNNING_RPM,
    HISTORICAL_CONTINUITY_MAX_GAP_HOURS: HISTORICAL_CONTINUITY_MAX_GAP_HOURS,
    HISTORICAL_CONTINUITY_MAX_GAP_MS: HISTORICAL_CONTINUITY_MAX_GAP_MS,
    KPH_TO_MPH: KPH_TO_MPH,
    LITERS_TO_GALLONS: LITERS_TO_GALLONS,
    MOVING_MPH: MOVING_MPH,
    PARKED_COMMUNICATION_MAX_GAP_HOURS: PARKED_COMMUNICATION_MAX_GAP_HOURS,
    DEFAULT_REPORT_FRESHNESS_MS: DEFAULT_REPORT_FRESHNESS_MS,
    activityIntervals: activityIntervals,
    analyzeUnit: analyzeUnit,
    buildReportTimeline: buildReportTimeline,
    continuousIgnitionSamples: historicalIgnitionSamples,
    historicalIgnitionSamples: historicalIgnitionSamples,
    rpmOnlyIgnitionSamples: rpmOnlyIgnitionSamples,
    countVerifiedMoves: countVerifiedMoves,
    cumulativeDelta: cumulativeDelta,
    facilitySummary: facilitySummary,
    reportCapability: reportCapability,
    zeroEngineOperationEvidence: zeroEngineOperationEvidence,
    verifiedMoveRecords: verifiedMoveRecords,
    resolveWindow: resolveWindow
  };
}));
