(function (root, factory) {
  "use strict";

  var telemetry = typeof module === "object" && module.exports
    ? require("./telemetry")
    : root.SIQ_TELEMETRY;
  var operationalStates = typeof module === "object" && module.exports
    ? require("./operational-states")
    : root.SIQ_OPERATIONAL_STATES;
  var intervalEngine = typeof module === "object" && module.exports
    ? require("./intervals")
    : root.SIQ_INTERVALS;
  var api = factory(telemetry, operationalStates, intervalEngine);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_TIMELINE = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  telemetry,
  operationalStates,
  intervalEngine
) {
  "use strict";

  var STATES = operationalStates.STATES;
  var COMMUNICATION_CONDITIONS = operationalStates.COMMUNICATION_CONDITIONS;

  function latestBefore(samples, boundaryMilliseconds) {
    var result = null;
    samples.forEach(function (sample) {
      var milliseconds = Date.parse(sample.timestamp);
      if (milliseconds < boundaryMilliseconds) {
        result = sample;
      }
    });
    return result;
  }

  function recordsForChannel(channel, samples, seed, startMilliseconds) {
    var records = [];
    if (seed) {
      records.push({
        effectiveTimestampMs: startMilliseconds,
        sourceTimestampMs: Date.parse(seed.timestamp),
        value: seed.value,
        priority: 0
      });
    } else {
      var prior = latestBefore(samples, startMilliseconds);
      if (prior) {
        records.push({
          effectiveTimestampMs: Date.parse(prior.timestamp),
          sourceTimestampMs: Date.parse(prior.timestamp),
          value: prior.value,
          priority: 1
        });
      }
    }

    samples.forEach(function (sample) {
      var milliseconds = Date.parse(sample.timestamp);
      if (milliseconds >= startMilliseconds) {
        records.push({
          effectiveTimestampMs: milliseconds,
          sourceTimestampMs: milliseconds,
          value: sample.value,
          priority: 1
        });
      }
    });
    return records.sort(function (left, right) {
      return left.effectiveTimestampMs - right.effectiveTimestampMs
        || left.priority - right.priority;
    });
  }

  function effectiveSignal(records, atMilliseconds, freshnessMilliseconds) {
    var effective = null;
    records.forEach(function (record) {
      if (record.effectiveTimestampMs <= atMilliseconds) {
        effective = record;
      }
    });
    if (!effective) {
      return {
        value: null,
        fresh: false,
        status: "MISSING",
        sourceTimestamp: null
      };
    }

    var fresh = atMilliseconds < effective.sourceTimestampMs + freshnessMilliseconds;
    return {
      value: fresh ? effective.value : null,
      fresh: fresh,
      status: fresh ? "FRESH" : "STALE",
      sourceTimestamp: new Date(effective.sourceTimestampMs).toISOString()
    };
  }

  function communicationSignal(records, atMilliseconds, freshnessMilliseconds) {
    var signal = effectiveSignal(records, atMilliseconds, freshnessMilliseconds);
    if (signal.status === "MISSING") {
      return Object.assign(signal, { condition: COMMUNICATION_CONDITIONS.UNKNOWN });
    }
    if (!signal.fresh) {
      return Object.assign(signal, { condition: COMMUNICATION_CONDITIONS.STALE });
    }
    return Object.assign(signal, {
      condition: signal.value
        ? COMMUNICATION_CONDITIONS.CURRENT
        : COMMUNICATION_CONDITIONS.NOT_COMMUNICATING
    });
  }

  function buildBoundaries(channelRecords, capability, startMilliseconds, endMilliseconds) {
    var boundaries = new Set([startMilliseconds, endMilliseconds]);
    Object.keys(channelRecords).forEach(function (channel) {
      var freshnessField = telemetry.CHANNELS[channel].capabilityFreshnessName;
      var freshnessMilliseconds = capability[freshnessField];
      channelRecords[channel].forEach(function (record) {
        if (record.effectiveTimestampMs >= startMilliseconds
          && record.effectiveTimestampMs < endMilliseconds) {
          boundaries.add(record.effectiveTimestampMs);
        }
        var expiration = record.sourceTimestampMs + freshnessMilliseconds;
        if (expiration > startMilliseconds && expiration < endMilliseconds) {
          boundaries.add(expiration);
        }
      });
    });
    return Array.from(boundaries).sort(function (left, right) {
      return left - right;
    });
  }

  function signalSnapshot(channelRecords, capability, atMilliseconds) {
    var ignition = effectiveSignal(
      channelRecords.ignition,
      atMilliseconds,
      capability.ignitionFreshnessMs
    );
    var rpm = effectiveSignal(
      channelRecords.rpm,
      atMilliseconds,
      capability.rpmFreshnessMs
    );
    var speed = effectiveSignal(
      channelRecords.speed,
      atMilliseconds,
      capability.speedFreshnessMs
    );
    var jaw = capability.jawSensorInstalled
      ? effectiveSignal(channelRecords.jaw, atMilliseconds, capability.jawFreshnessMs)
      : {
        value: null,
        fresh: false,
        status: "NOT_APPLICABLE",
        sourceTimestamp: null
      };
    var communication = communicationSignal(
      channelRecords.communication,
      atMilliseconds,
      capability.communicationFreshnessMs
    );
    return {
      ignition: ignition,
      rpm: rpm,
      speed: speed,
      jaw: jaw,
      communication: communication
    };
  }

  function intervalFromClassification(
    capability,
    startMilliseconds,
    endMilliseconds,
    signals,
    classification
  ) {
    return {
      deviceId: capability.deviceId,
      startUtc: new Date(startMilliseconds).toISOString(),
      endUtc: new Date(endMilliseconds).toISOString(),
      durationMs: endMilliseconds - startMilliseconds,
      state: classification.state,
      reason: classification.reason,
      reasonCode: classification.reasonCode || null,
      ignitionOn: signals.ignition.fresh ? signals.ignition.value : null,
      rpm: signals.rpm.fresh ? signals.rpm.value : null,
      speedMph: signals.speed.fresh ? signals.speed.value : null,
      jawLocked: signals.jaw.fresh ? signals.jaw.value : null,
      availability: {
        ignition: signals.ignition.status,
        rpm: signals.rpm.status,
        speed: signals.speed.status,
        jaw: signals.jaw.status,
        communication: signals.communication.condition
      },
      freshness: {
        ignition: signals.ignition.fresh,
        rpm: signals.rpm.fresh,
        speed: signals.speed.fresh,
        jaw: signals.jaw.fresh,
        communication: signals.communication.fresh
      },
      communicationCondition: signals.communication.condition,
      sourceTimestamps: {
        ignition: signals.ignition.sourceTimestamp,
        rpm: signals.rpm.sourceTimestamp,
        speed: signals.speed.sourceTimestamp,
        jaw: signals.jaw.sourceTimestamp,
        communication: signals.communication.sourceTimestamp
      }
    };
  }

  function intervalSignature(interval) {
    return JSON.stringify({
      state: interval.state,
      reason: interval.reason,
      reasonCode: interval.reasonCode,
      ignitionOn: interval.ignitionOn,
      rpm: interval.rpm,
      speedMph: interval.speedMph,
      jawLocked: interval.jawLocked,
      availability: interval.availability,
      freshness: interval.freshness,
      communicationCondition: interval.communicationCondition
    });
  }

  function mergeAdjacentIntervals(intervals) {
    var merged = [];
    (intervals || []).forEach(function (interval) {
      if (interval.durationMs <= 0) {
        return;
      }
      var prior = merged[merged.length - 1];
      if (prior
        && prior.endUtc === interval.startUtc
        && intervalSignature(prior) === intervalSignature(interval)) {
        prior.endUtc = interval.endUtc;
        prior.durationMs += interval.durationMs;
        Object.keys(prior.sourceTimestamps).forEach(function (channel) {
          if (prior.sourceTimestamps[channel] !== interval.sourceTimestamps[channel]) {
            prior.sourceTimestamps[channel] = null;
          }
        });
      } else {
        merged.push(Object.assign({}, interval));
      }
    });
    return merged;
  }

  function formatDuration(durationMs) {
    var totalMinutes = durationMs / 60000;
    if (Number.isInteger(totalMinutes)) {
      return totalMinutes + (totalMinutes === 1 ? " minute" : " minutes");
    }
    var totalSeconds = durationMs / 1000;
    return totalSeconds + (totalSeconds === 1 ? " second" : " seconds");
  }

  function findingDefinitions(interval) {
    var definitions = [];
    if (interval.state === STATES.NOT_COMMUNICATING
      || interval.reasonCode === "COMMUNICATION_STALE") {
      definitions.push({
        code: "COMMUNICATION_GAP",
        affectedMetrics: ["operational-state classification", "engine-on duration"],
        messagePrefix: "Communication Gap — current operating state could not be determined for "
      });
    }
    if (interval.availability.ignition === "MISSING"
      || interval.availability.ignition === "STALE") {
      definitions.push({
        code: "IGNITION_UNAVAILABLE",
        affectedMetrics: ["engine state", "engine-on duration", "operational-state classification"],
        messagePrefix: "Partial Data — ignition was unavailable for "
      });
    }
    if (interval.availability.rpm === "MISSING" || interval.availability.rpm === "STALE") {
      definitions.push({
        code: "RPM_UNAVAILABLE",
        affectedMetrics: ["engine state", "engine-on duration", "operational-state classification"],
        messagePrefix: "Partial Data — RPM was unavailable for "
      });
    }
    if (interval.availability.speed === "MISSING" || interval.availability.speed === "STALE") {
      definitions.push({
        code: "SPEED_UNAVAILABLE",
        affectedMetrics: ["moving duration", "stationary duration", "operational-state classification"],
        messagePrefix: "Partial Data — speed was unavailable for "
      });
    }
    if (interval.availability.jaw === "MISSING" || interval.availability.jaw === "STALE") {
      definitions.push({
        code: "JAW_UNAVAILABLE",
        affectedMetrics: ["move classification", "bobtail metrics", "coupled metrics"],
        messagePrefix: "Partial Data — Fifth Wheel Status was unavailable for "
      });
    }
    return definitions;
  }

  function findingMessage(definition, durationMs) {
    var suffix = definition.code === "JAW_UNAVAILABLE"
      ? ". Move and bobtail metrics may be incomplete."
      : ".";
    return definition.messagePrefix + formatDuration(durationMs) + suffix;
  }

  function buildAvailabilityFindings(intervals) {
    var findingsByCode = new Map();
    (intervals || []).forEach(function (interval) {
      findingDefinitions(interval).forEach(function (definition) {
        if (!findingsByCode.has(definition.code)) {
          findingsByCode.set(definition.code, []);
        }
        var codeFindings = findingsByCode.get(definition.code);
        var prior = codeFindings[codeFindings.length - 1];
        if (prior && prior.endUtc === interval.startUtc) {
          prior.endUtc = interval.endUtc;
          prior.durationMs += interval.durationMs;
          prior.message = findingMessage(definition, prior.durationMs);
        } else {
          codeFindings.push({
            code: definition.code,
            category: "data-availability",
            severity: "warning",
            startUtc: interval.startUtc,
            endUtc: interval.endUtc,
            durationMs: interval.durationMs,
            affectedMetrics: definition.affectedMetrics.slice(),
            message: findingMessage(definition, interval.durationMs)
          });
        }
      });
    });
    return Array.from(findingsByCode.values()).flat().sort(function (left, right) {
      return Date.parse(left.startUtc) - Date.parse(right.startUtc)
        || left.code.localeCompare(right.code);
    });
  }

  function buildOperationalTimeline(request) {
    if (!request || typeof request !== "object") {
      throw new telemetry.TimelineInputError(
        "INVALID_TIMELINE_REQUEST",
        "Timeline request is required"
      );
    }
    var capability = telemetry.assertValidAssetCapability(request.capability);
    var startMilliseconds = telemetry.exactMilliseconds(request.startUtc, "timeline startUtc");
    var endMilliseconds = telemetry.exactMilliseconds(request.endUtc, "timeline endUtc");
    if (endMilliseconds <= startMilliseconds) {
      throw new telemetry.TimelineInputError(
        "INVALID_TIMELINE_RANGE",
        "Timeline endUtc must be after startUtc"
      );
    }

    var normalized = telemetry.normalizeTelemetry(request.telemetry);
    var seed = telemetry.normalizeBoundarySeed(request.boundarySeed, request.startUtc);
    var channelRecords = {};
    Object.keys(telemetry.CHANNELS).forEach(function (channel) {
      var inputName = telemetry.CHANNELS[channel].inputName;
      channelRecords[channel] = recordsForChannel(
        channel,
        normalized[inputName],
        seed[channel],
        startMilliseconds
      );
    });
    var boundaries = buildBoundaries(
      channelRecords,
      capability,
      startMilliseconds,
      endMilliseconds
    );
    var rawIntervals = [];
    for (var index = 0; index < boundaries.length - 1; index += 1) {
      var intervalStart = boundaries[index];
      var intervalEnd = boundaries[index + 1];
      if (intervalEnd <= intervalStart) {
        continue;
      }
      var signals = signalSnapshot(channelRecords, capability, intervalStart);
      var classification = operationalStates.classifyOperationalState(capability, signals);
      rawIntervals.push(intervalFromClassification(
        capability,
        intervalStart,
        intervalEnd,
        signals,
        classification
      ));
    }
    var intervals = mergeAdjacentIntervals(rawIntervals);
    return {
      deviceId: capability.deviceId,
      startUtc: new Date(startMilliseconds).toISOString(),
      endUtc: new Date(endMilliseconds).toISOString(),
      durationMs: endMilliseconds - startMilliseconds,
      intervals: intervals,
      findings: buildAvailabilityFindings(intervals)
    };
  }

  function timelineIntervals(timelineOrIntervals) {
    if (Array.isArray(timelineOrIntervals)) {
      return timelineOrIntervals;
    }
    if (timelineOrIntervals && Array.isArray(timelineOrIntervals.intervals)) {
      return timelineOrIntervals.intervals;
    }
    throw new TypeError("Timeline intervals are required");
  }

  function summarizeTimeline(timelineOrIntervals) {
    var durationByState = {};
    Object.keys(STATES).forEach(function (key) {
      durationByState[STATES[key]] = 0;
    });
    timelineIntervals(timelineOrIntervals).forEach(function (interval) {
      if (durationByState[interval.state] === undefined) {
        throw new RangeError("Unknown operational state: " + interval.state);
      }
      durationByState[interval.state] += interval.durationMs;
    });

    var moving = durationByState[STATES.COUPLED_MOVING]
      + durationByState[STATES.BOBTAIL_MOVING]
      + durationByState[STATES.ENGINE_ON_MOVING];
    var stationary = durationByState[STATES.COUPLED_IDLE]
      + durationByState[STATES.BOBTAIL_IDLE]
      + durationByState[STATES.ENGINE_ON_STATIONARY];
    return {
      durationByState: durationByState,
      totalDurationMs: Object.values(durationByState).reduce(function (total, value) {
        return total + value;
      }, 0),
      engineOnDurationMs: moving + stationary,
      totalEngineOnDurationMs: moving + stationary,
      movingDurationMs: moving,
      totalMovingDurationMs: moving,
      stationaryDurationMs: stationary,
      idleDurationMs: stationary,
      totalStationaryDurationMs: stationary,
      coupledMovingDurationMs: durationByState[STATES.COUPLED_MOVING],
      bobtailMovingDurationMs: durationByState[STATES.BOBTAIL_MOVING],
      coupledIdleDurationMs: durationByState[STATES.COUPLED_IDLE],
      bobtailIdleDurationMs: durationByState[STATES.BOBTAIL_IDLE],
      engineOffDurationMs: durationByState[STATES.ENGINE_OFF],
      unknownDurationMs: durationByState[STATES.UNKNOWN],
      notCommunicatingDurationMs: durationByState[STATES.NOT_COMMUNICATING]
    };
  }

  function clipTimeline(timelineOrIntervals, startUtc, endUtc) {
    var startMilliseconds = telemetry.exactMilliseconds(startUtc, "clip startUtc");
    var endMilliseconds = telemetry.exactMilliseconds(endUtc, "clip endUtc");
    if (endMilliseconds <= startMilliseconds) {
      throw new RangeError("Clip endUtc must be after startUtc");
    }
    return timelineIntervals(timelineOrIntervals).map(function (interval) {
      var start = Math.max(Date.parse(interval.startUtc), startMilliseconds);
      var end = Math.min(Date.parse(interval.endUtc), endMilliseconds);
      if (start >= end) {
        return null;
      }
      return Object.assign({}, interval, {
        startUtc: new Date(start).toISOString(),
        endUtc: new Date(end).toISOString(),
        durationMs: end - start
      });
    }).filter(Boolean);
  }

  function intersectTimelineWithOccurrence(timelineOrIntervals, occurrence) {
    if (!occurrence || !occurrence.startUtc || !occurrence.endUtc) {
      throw new TypeError("Shift occurrence with exact boundaries is required");
    }
    return clipTimeline(
      timelineOrIntervals,
      occurrence.startUtc,
      occurrence.endUtc
    ).map(function (interval) {
      return Object.assign({}, interval, {
        occurrenceId: occurrence.occurrenceId,
        shiftProfileId: occurrence.shiftProfileId,
        occurrenceDate: occurrence.occurrenceDate
      });
    });
  }

  function assertNonOverlappingOccurrences(occurrences) {
    if (!Array.isArray(occurrences)) {
      throw new TypeError("Shift occurrences must be an array");
    }
    var ordered = occurrences.map(function (occurrence) {
      if (!occurrence || typeof occurrence !== "object") {
        throw new TypeError("Each shift occurrence must be an object");
      }
      var start = telemetry.exactMilliseconds(
        occurrence.startUtc,
        "shift occurrence startUtc"
      );
      var end = telemetry.exactMilliseconds(
        occurrence.endUtc,
        "shift occurrence endUtc"
      );
      if (end <= start) {
        throw new RangeError("Shift occurrence endUtc must be after startUtc");
      }
      return { occurrence: occurrence, start: start, end: end };
    }).sort(function (left, right) {
      return left.start - right.start || left.end - right.end;
    });
    for (var index = 1; index < ordered.length; index += 1) {
      if (ordered[index].start < ordered[index - 1].end) {
        var error = new RangeError("Shift occurrences overlap and cannot be intersected safely");
        error.code = "OVERLAPPING_REPORTING_INTERVALS";
        error.conflictingOccurrenceIds = [
          ordered[index - 1].occurrence.occurrenceId,
          ordered[index].occurrence.occurrenceId
        ];
        throw error;
      }
    }
    return ordered.map(function (item) {
      return item.occurrence;
    });
  }

  function intersectTimelineWithOccurrences(timelineOrIntervals, occurrences) {
    return assertNonOverlappingOccurrences(occurrences).flatMap(function (occurrence) {
      return intersectTimelineWithOccurrence(timelineOrIntervals, occurrence);
    });
  }

  function timelineForUnassignedTime(timelineOrIntervals, occurrences, startUtc, endUtc) {
    assertNonOverlappingOccurrences(occurrences);
    var gaps = intervalEngine.unassignedIntervalsForExactRange(
      occurrences,
      startUtc,
      endUtc
    );
    return gaps.flatMap(function (gap) {
      return clipTimeline(timelineOrIntervals, gap.startUtc, gap.endUtc).map(function (interval) {
        return Object.assign({}, interval, { unassigned: true });
      });
    });
  }

  return {
    buildAvailabilityFindings: buildAvailabilityFindings,
    buildOperationalTimeline: buildOperationalTimeline,
    clipTimeline: clipTimeline,
    intersectTimelineWithOccurrence: intersectTimelineWithOccurrence,
    intersectTimelineWithOccurrences: intersectTimelineWithOccurrences,
    mergeAdjacentIntervals: mergeAdjacentIntervals,
    summarizeTimeline: summarizeTimeline,
    timelineForUnassignedTime: timelineForUnassignedTime
  };
}));
