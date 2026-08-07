(function (root, factory) {
  "use strict";

  var telemetry = typeof module === "object" && module.exports
    ? require("./telemetry")
    : root.SIQ_TELEMETRY;
  var operationalStates = typeof module === "object" && module.exports
    ? require("./operational-states")
    : root.SIQ_OPERATIONAL_STATES;
  var api = factory(telemetry, operationalStates);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_SPEED_EVENTS = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  telemetry,
  operationalStates
) {
  "use strict";

  var STATES = operationalStates.STATES;
  var MOVING_STATES = Object.freeze([
    STATES.COUPLED_MOVING,
    STATES.BOBTAIL_MOVING,
    STATES.ENGINE_ON_MOVING
  ]);
  var MISSING_DATA_POLICIES = Object.freeze({
    INTERRUPT_EVENT: "INTERRUPT_EVENT",
    BRIDGE_WITHIN_GRACE: "BRIDGE_WITHIN_GRACE"
  });
  var COUPLING_CONTEXTS = Object.freeze({
    COUPLED: "COUPLED",
    UNCOUPLED: "UNCOUPLED",
    NO_SENSOR: "NO_SENSOR",
    UNKNOWN: "UNKNOWN"
  });

  function SpeedInputError(code, message, details) {
    this.name = "SpeedInputError";
    this.code = code;
    this.message = message;
    this.details = details || {};
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SpeedInputError);
    }
  }
  SpeedInputError.prototype = Object.create(Error.prototype);
  SpeedInputError.prototype.constructor = SpeedInputError;

  function validationError(field, code, message) {
    return { field: field, code: code, message: message };
  }

  function nonNegativeFinite(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }

  function validateSpeedConfiguration(configuration) {
    var errors = [];
    if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
      return {
        ok: false,
        errors: [validationError(
          "",
          "INVALID_CONFIGURATION",
          "Facility speed configuration is required"
        )]
      };
    }
    if (typeof configuration.speedLimitMph !== "number"
      || !Number.isFinite(configuration.speedLimitMph)
      || configuration.speedLimitMph <= 0) {
      errors.push(validationError(
        "speedLimitMph",
        "INVALID_SPEED_LIMIT",
        "speedLimitMph must be a positive finite number"
      ));
    }
    if (configuration.severeSpeedThresholdMph !== undefined
      && configuration.severeSpeedThresholdMph !== null
      && (typeof configuration.severeSpeedThresholdMph !== "number"
        || !Number.isFinite(configuration.severeSpeedThresholdMph)
        || configuration.severeSpeedThresholdMph <= configuration.speedLimitMph)) {
      errors.push(validationError(
        "severeSpeedThresholdMph",
        "INVALID_SEVERE_THRESHOLD",
        "severeSpeedThresholdMph must be greater than speedLimitMph"
      ));
    }
    if (!nonNegativeFinite(configuration.minimumReportableEventDurationMs)) {
      errors.push(validationError(
        "minimumReportableEventDurationMs",
        "INVALID_MINIMUM_DURATION",
        "minimumReportableEventDurationMs must be a non-negative finite number"
      ));
    }
    if (!nonNegativeFinite(configuration.eventCloseGraceMs)) {
      errors.push(validationError(
        "eventCloseGraceMs",
        "INVALID_CLOSE_GRACE",
        "eventCloseGraceMs must be a non-negative finite number"
      ));
    }
    if (configuration.topSpeedMinimumSampleDurationMs !== undefined
      && !nonNegativeFinite(configuration.topSpeedMinimumSampleDurationMs)) {
      errors.push(validationError(
        "topSpeedMinimumSampleDurationMs",
        "INVALID_TOP_SPEED_MINIMUM_DURATION",
        "topSpeedMinimumSampleDurationMs must be a non-negative finite number when supplied"
      ));
    }
    if (!Object.values(MISSING_DATA_POLICIES).includes(configuration.missingDataPolicy)) {
      errors.push(validationError(
        "missingDataPolicy",
        "INVALID_MISSING_DATA_POLICY",
        "missingDataPolicy is required and must be supported"
      ));
    }
    return { ok: errors.length === 0, errors: errors };
  }

  function assertValidSpeedConfiguration(configuration) {
    var result = validateSpeedConfiguration(configuration);
    if (!result.ok) {
      var error = new SpeedInputError(
        "INVALID_SPEED_CONFIGURATION",
        result.errors.map(function (item) {
          return item.message;
        }).join("; "),
        { validationErrors: result.errors }
      );
      error.validationErrors = result.errors;
      throw error;
    }
    return Object.assign({}, configuration, {
      severeSpeedThresholdMph:
        configuration.severeSpeedThresholdMph === undefined
          ? null : configuration.severeSpeedThresholdMph,
      topSpeedMinimumSampleDurationMs:
        configuration.topSpeedMinimumSampleDurationMs === undefined
          ? 0
          : configuration.topSpeedMinimumSampleDurationMs
    });
  }

  function iso(milliseconds) {
    return new Date(milliseconds).toISOString();
  }

  function exactMilliseconds(value, label) {
    return telemetry.exactMilliseconds(value, label);
  }

  function normalizeTimeline(input, deviceId) {
    var source = Array.isArray(input)
      ? input
      : input && Array.isArray(input.intervals) ? input.intervals : null;
    if (!source) {
      throw new SpeedInputError(
        "INVALID_OPERATIONAL_TIMELINE",
        "Continuous operational-state timeline intervals are required"
      );
    }
    var normalized = source.map(function (interval, index) {
      if (!interval || typeof interval !== "object" || Array.isArray(interval)) {
        throw new SpeedInputError(
          "INVALID_OPERATIONAL_INTERVAL",
          "Operational interval at index " + index + " must be an object"
        );
      }
      var startMs = exactMilliseconds(interval.startUtc, "operational interval startUtc");
      var endMs = exactMilliseconds(interval.endUtc, "operational interval endUtc");
      if (endMs <= startMs || !Object.values(STATES).includes(interval.state)) {
        throw new SpeedInputError(
          "INVALID_OPERATIONAL_INTERVAL",
          "Operational intervals require positive elapsed time and a known state"
        );
      }
      if (interval.deviceId !== undefined && interval.deviceId !== deviceId) {
        throw new SpeedInputError(
          "TIMELINE_DEVICE_MISMATCH",
          "Operational timeline deviceId must match the speed request"
        );
      }
      return Object.assign({}, interval, {
        startUtc: iso(startMs),
        endUtc: iso(endMs),
        durationMs: endMs - startMs
      });
    }).sort(function (left, right) {
      return Date.parse(left.startUtc) - Date.parse(right.startUtc)
        || Date.parse(left.endUtc) - Date.parse(right.endUtc);
    });
    for (var index = 1; index < normalized.length; index += 1) {
      if (Date.parse(normalized[index].startUtc)
        < Date.parse(normalized[index - 1].endUtc)) {
        throw new SpeedInputError(
          "OVERLAPPING_OPERATIONAL_TIMELINE",
          "Operational timeline intervals may not overlap"
        );
      }
    }
    return normalized;
  }

  function evidenceValidity(record) {
    var valid = record.valid !== false
      && record.stale !== true
      && typeof record.speedMph === "number"
      && Number.isFinite(record.speedMph)
      && record.speedMph >= 0;
    return {
      valid: valid,
      stale: record.stale === true,
      communicationGap: record.communicationGap === true
        || record.availability === "NOT_COMMUNICATING"
    };
  }

  function normalizeIntervalEvidence(interval, index, deviceId) {
    if (!interval || typeof interval !== "object" || Array.isArray(interval)) {
      throw new SpeedInputError(
        "INVALID_SPEED_INTERVAL",
        "Speed interval at index " + index + " must be an object"
      );
    }
    var startMs = exactMilliseconds(interval.startUtc, "speed interval startUtc");
    var endMs = exactMilliseconds(interval.endUtc, "speed interval endUtc");
    if (endMs <= startMs) {
      throw new SpeedInputError(
        "INVALID_SPEED_INTERVAL",
        "Speed interval endUtc must be after startUtc"
      );
    }
    if (interval.deviceId !== undefined && interval.deviceId !== deviceId) {
      throw new SpeedInputError(
        "SPEED_EVIDENCE_DEVICE_MISMATCH",
        "Speed evidence deviceId must match the speed request"
      );
    }
    var validity = evidenceValidity(interval);
    if (interval.valid !== false && interval.stale !== true
      && (!Number.isFinite(interval.speedMph) || interval.speedMph < 0)) {
      throw new SpeedInputError(
        "INVALID_SPEED_VALUE",
        "Valid speed evidence requires a non-negative finite speedMph"
      );
    }
    var observationMs = interval.timestamp === undefined
      ? startMs
      : exactMilliseconds(interval.timestamp, "speed interval timestamp");
    if (observationMs < startMs || observationMs >= endMs) {
      throw new SpeedInputError(
        "INVALID_SPEED_TIMESTAMP",
        "Speed interval timestamp must be inside its half-open interval"
      );
    }
    return {
      startMs: startMs,
      endMs: endMs,
      durationMs: endMs - startMs,
      observationMs: observationMs,
      speedMph: validity.valid ? interval.speedMph : null,
      valid: validity.valid,
      stale: validity.stale,
      communicationGap: validity.communicationGap,
      sourceReference: interval.sourceReference === undefined
        ? null
        : interval.sourceReference
    };
  }

  function normalizeSampleEvidence(sample, index, deviceId) {
    if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
      throw new SpeedInputError(
        "INVALID_SPEED_SAMPLE",
        "Speed sample at index " + index + " must be an object"
      );
    }
    if (sample.deviceId !== undefined && sample.deviceId !== deviceId) {
      throw new SpeedInputError(
        "SPEED_EVIDENCE_DEVICE_MISMATCH",
        "Speed evidence deviceId must match the speed request"
      );
    }
    var timestampMs = exactMilliseconds(sample.timestamp, "speed sample timestamp");
    var endMs = timestampMs;
    if (sample.endUtc !== undefined) {
      endMs = exactMilliseconds(sample.endUtc, "speed sample endUtc");
    } else if (sample.durationMs !== undefined) {
      if (!nonNegativeFinite(sample.durationMs)) {
        throw new SpeedInputError(
          "INVALID_SPEED_SAMPLE_DURATION",
          "Speed sample durationMs must be a non-negative finite number"
        );
      }
      endMs = timestampMs + sample.durationMs;
    }
    if (endMs < timestampMs) {
      throw new SpeedInputError(
        "INVALID_SPEED_SAMPLE_DURATION",
        "Speed sample end must not precede its timestamp"
      );
    }
    var validity = evidenceValidity(sample);
    if (sample.valid !== false && sample.stale !== true
      && (!Number.isFinite(sample.speedMph) || sample.speedMph < 0)) {
      throw new SpeedInputError(
        "INVALID_SPEED_VALUE",
        "Valid speed evidence requires a non-negative finite speedMph"
      );
    }
    return {
      startMs: timestampMs,
      endMs: endMs,
      durationMs: endMs - timestampMs,
      observationMs: timestampMs,
      speedMph: validity.valid ? sample.speedMph : null,
      valid: validity.valid,
      stale: validity.stale,
      communicationGap: validity.communicationGap,
      sourceReference: sample.sourceReference === undefined
        ? null
        : sample.sourceReference
    };
  }

  function evidenceSignature(item) {
    return JSON.stringify([
      item.startMs,
      item.endMs,
      item.observationMs,
      item.speedMph,
      item.valid,
      item.stale,
      item.communicationGap,
      item.sourceReference
    ]);
  }

  function normalizeSpeedEvidence(request, deviceId) {
    var hasIntervals = request.speedIntervals !== undefined;
    var hasSamples = request.speedSamples !== undefined;
    if (hasIntervals && hasSamples) {
      throw new SpeedInputError(
        "AMBIGUOUS_SPEED_EVIDENCE",
        "Provide speedIntervals or speedSamples, not both"
      );
    }
    var source = hasIntervals ? request.speedIntervals : request.speedSamples;
    if (source === undefined || source === null) {
      source = [];
    }
    if (!Array.isArray(source)) {
      throw new SpeedInputError(
        "INVALID_SPEED_EVIDENCE",
        "Normalized speed evidence must be an array"
      );
    }
    var normalized = source.map(function (item, index) {
      return hasIntervals
        ? normalizeIntervalEvidence(item, index, deviceId)
        : normalizeSampleEvidence(item, index, deviceId);
    }).sort(function (left, right) {
      return left.startMs - right.startMs
        || left.endMs - right.endMs
        || left.observationMs - right.observationMs
        || (left.speedMph || 0) - (right.speedMph || 0);
    });

    var deduplicated = [];
    normalized.forEach(function (item) {
      var prior = deduplicated[deduplicated.length - 1];
      if (prior && evidenceSignature(prior) === evidenceSignature(item)) {
        return;
      }
      if (prior && item.durationMs > 0 && prior.durationMs > 0
        && item.startMs < prior.endMs) {
        throw new SpeedInputError(
          "OVERLAPPING_SPEED_EVIDENCE",
          "Normalized speed intervals may not overlap"
        );
      }
      if (prior && item.observationMs === prior.observationMs
        && (item.speedMph !== prior.speedMph || item.valid !== prior.valid)) {
        throw new SpeedInputError(
          "CONFLICTING_SPEED_EVIDENCE",
          "Conflicting speed evidence exists at " + iso(item.observationMs)
        );
      }
      deduplicated.push(item);
    });
    return deduplicated;
  }

  function overlap(start, end, otherStart, otherEnd) {
    var overlapStart = Math.max(start, otherStart);
    var overlapEnd = Math.min(end, otherEnd);
    return overlapStart < overlapEnd
      ? { startMs: overlapStart, endMs: overlapEnd, durationMs: overlapEnd - overlapStart }
      : null;
  }

  function timelineStateAt(timeline, instantMs) {
    for (var index = 0; index < timeline.length; index += 1) {
      var interval = timeline[index];
      if (Date.parse(interval.startUtc) <= instantMs
        && instantMs < Date.parse(interval.endUtc)) {
        return interval.state;
      }
    }
    return STATES.UNKNOWN;
  }

  function communicationGapInRange(timeline, startMs, endMs) {
    return timeline.some(function (interval) {
      var stateSuggestsGap = interval.state === STATES.NOT_COMMUNICATING
        || interval.reasonCode === "COMMUNICATION_STALE"
        || interval.communicationCondition === "NOT_COMMUNICATING"
        || interval.communicationCondition === "STALE";
      return stateSuggestsGap && overlap(
        startMs,
        endMs,
        Date.parse(interval.startUtc),
        Date.parse(interval.endUtc)
      );
    });
  }

  function couplingContextForState(state) {
    if (state === STATES.COUPLED_MOVING) {
      return COUPLING_CONTEXTS.COUPLED;
    }
    if (state === STATES.BOBTAIL_MOVING) {
      return COUPLING_CONTEXTS.UNCOUPLED;
    }
    if (state === STATES.ENGINE_ON_MOVING) {
      return COUPLING_CONTEXTS.NO_SENSOR;
    }
    return COUPLING_CONTEXTS.UNKNOWN;
  }

  function splitByTimeline(segment, timeline) {
    var pieces = [];
    var intersections = timeline.map(function (interval) {
      var clipped = overlap(
        segment.startMs,
        segment.endMs,
        Date.parse(interval.startUtc),
        Date.parse(interval.endUtc)
      );
      return clipped
        ? { intersection: clipped, interval: interval }
        : null;
    }).filter(Boolean).sort(function (left, right) {
      return left.intersection.startMs - right.intersection.startMs;
    });
    var cursor = segment.startMs;
    intersections.forEach(function (item) {
      if (cursor < item.intersection.startMs) {
        pieces.push(Object.assign({}, segment, {
          startMs: cursor,
          endMs: item.intersection.startMs,
          durationMs: item.intersection.startMs - cursor,
          sampleDurationMs: segment.durationMs,
          state: STATES.UNKNOWN,
          couplingContext: COUPLING_CONTEXTS.UNKNOWN,
          contextCoverageIncomplete: true
        }));
      }
      pieces.push(Object.assign({}, segment, item.intersection, {
        sampleDurationMs: segment.durationMs,
        state: item.interval.state,
        couplingContext: couplingContextForState(item.interval.state)
      }));
      cursor = item.intersection.endMs;
    });
    if (cursor < segment.endMs) {
      pieces.push(Object.assign({}, segment, {
        startMs: cursor,
        endMs: segment.endMs,
        durationMs: segment.endMs - cursor,
        sampleDurationMs: segment.durationMs,
        state: STATES.UNKNOWN,
        couplingContext: COUPLING_CONTEXTS.UNKNOWN,
        contextCoverageIncomplete: true
      }));
    }
    return pieces;
  }

  function eventObservationDuration(observation) {
    return observation.sampleDurationMs === undefined
      ? observation.durationMs
      : observation.sampleDurationMs;
  }

  function eligibleObservation(observation, startMs, endMs, minimumDurationMs) {
    return observation.valid
      && observation.observationMs >= startMs
      && observation.observationMs < endMs
      && eventObservationDuration(observation) >= minimumDurationMs;
  }

  function completeEvidenceSequence(evidence, scanStartMs, scanEndMs, timeline) {
    var intervals = evidence.filter(function (item) {
      return item.durationMs > 0 && item.endMs > scanStartMs && item.startMs < scanEndMs;
    });
    var sequence = [];
    var cursor = scanStartMs;
    intervals.forEach(function (item) {
      var startMs = Math.max(item.startMs, scanStartMs);
      var endMs = Math.min(item.endMs, scanEndMs);
      if (cursor < startMs) {
        sequence.push({
          startMs: cursor,
          endMs: startMs,
          durationMs: startMs - cursor,
          valid: false,
          stale: false,
          communicationGap: communicationGapInRange(timeline, cursor, startMs),
          uncovered: true,
          speedMph: null,
          observationMs: cursor,
          sourceReference: null
        });
      }
      sequence.push(Object.assign({}, item, {
        startMs: startMs,
        endMs: endMs,
        durationMs: endMs - startMs
      }));
      cursor = endMs;
    });
    if (cursor < scanEndMs) {
      sequence.push({
        startMs: cursor,
        endMs: scanEndMs,
        durationMs: scanEndMs - cursor,
        valid: false,
        stale: false,
        communicationGap: communicationGapInRange(timeline, cursor, scanEndMs),
        uncovered: true,
        speedMph: null,
        observationMs: cursor,
        sourceReference: null
      });
    }
    return sequence;
  }

  function fnv1a(value) {
    var hash = 2166136261;
    for (var index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function deterministicEventId(deviceId, startMs) {
    return "speed-" + fnv1a(deviceId + "|" + iso(startMs));
  }

  function unique(values) {
    return Array.from(new Set(values));
  }

  function bestObservation(observations, startMs, endMs, minimumDurationMs) {
    return observations.filter(function (observation) {
      return eligibleObservation(
        observation,
        startMs,
        endMs,
        minimumDurationMs
      );
    }).sort(function (left, right) {
      return right.speedMph - left.speedMph
        || left.observationMs - right.observationMs
        || String(left.sourceReference || "").localeCompare(
          String(right.sourceReference || "")
        );
    })[0] || null;
  }

  function eventObservations(event) {
    var seen = new Set();
    return event.overLimitSegments.map(function (segment) {
      var key = [
        segment.observationMs,
        segment.speedMph,
        segment.sourceReference
      ].join("|");
      if (seen.has(key)) {
        return null;
      }
      seen.add(key);
      return segment;
    }).filter(Boolean);
  }

  function severeSegments(overLimitSegments, severeThresholdMph) {
    var segments = [];
    overLimitSegments.forEach(function (segment) {
      if (segment.speedMph <= severeThresholdMph) {
        return;
      }
      var prior = segments[segments.length - 1];
      if (prior && prior.endMs === segment.startMs) {
        prior.endMs = segment.endMs;
        prior.endUtc = iso(segment.endMs);
        prior.durationMs += segment.durationMs;
        if (segment.speedMph > prior.topSpeedMph
          || (segment.speedMph === prior.topSpeedMph
            && segment.observationMs < prior.topSpeedTimestampMs)) {
          prior.topSpeedMph = segment.speedMph;
          prior.topSpeedTimestampMs = segment.observationMs;
          prior.topSpeedTimestamp = iso(segment.observationMs);
        }
      } else {
        segments.push({
          startMs: segment.startMs,
          endMs: segment.endMs,
          startUtc: iso(segment.startMs),
          endUtc: iso(segment.endMs),
          durationMs: segment.durationMs,
          topSpeedMph: segment.speedMph,
          topSpeedTimestampMs: segment.observationMs,
          topSpeedTimestamp: iso(segment.observationMs)
        });
      }
    });
    return segments;
  }

  function operationalBreakdown(segments) {
    var breakdown = {};
    Object.values(STATES).forEach(function (state) {
      breakdown[state] = 0;
    });
    segments.forEach(function (segment) {
      breakdown[segment.state] += segment.durationMs;
    });
    return breakdown;
  }

  function contextDurations(segments) {
    var result = {
      coupledDurationMs: 0,
      uncoupledDurationMs: 0,
      noSensorDurationMs: 0,
      unknownCouplingDurationMs: 0
    };
    segments.forEach(function (segment) {
      if (segment.couplingContext === COUPLING_CONTEXTS.COUPLED) {
        result.coupledDurationMs += segment.durationMs;
      } else if (segment.couplingContext === COUPLING_CONTEXTS.UNCOUPLED) {
        result.uncoupledDurationMs += segment.durationMs;
      } else if (segment.couplingContext === COUPLING_CONTEXTS.NO_SENSOR) {
        result.noSensorDurationMs += segment.durationMs;
      } else {
        result.unknownCouplingDurationMs += segment.durationMs;
      }
    });
    return result;
  }

  function findingMessage(code) {
    var messages = {
      SPEED_DATA_UNAVAILABLE:
        "Speed Data Unavailable \u2014 top speed and time over the facility limit could not be calculated for this period.",
      SPEED_DATA_GAP:
        "Speed Data Unavailable \u2014 top speed and time over the facility limit could not be calculated for part of this period.",
      COMMUNICATION_GAP_DURING_SPEED_EVENT:
        "Communication Gap \u2014 the end of this speeding event could not be verified.",
      SPEED_EVENT_END_UNKNOWN:
        "Speeding Event End Unavailable \u2014 the last verified over-limit time is retained, but the physical event end could not be verified.",
      MOVING_TIME_UNAVAILABLE:
        "Moving Time Unavailable \u2014 percentage of moving time over the facility limit could not be calculated.",
      PARTIAL_SPEED_EVENT:
        "Partial Speeding Event \u2014 only verified over-limit time is included."
    };
    return messages[code] || "Speed Data Unavailable \u2014 calculation is incomplete.";
  }

  function eventFinding(code, eventId) {
    return {
      code: code,
      category: "speed-analytics",
      severity: "warning",
      eventId: eventId,
      affectedMetrics: [
        "Time Over Speed Limit",
        "Speeding Event"
      ],
      message: findingMessage(code)
    };
  }

  function buildEventRecord(candidate, context, physicalEndKnown) {
    var overLimitSegments = candidate.overLimitSegments;
    var observations = eventObservations(candidate);
    var top = bestObservation(
      observations,
      -Infinity,
      Infinity,
      context.configuration.topSpeedMinimumSampleDurationMs
    );
    var durationMs = overLimitSegments.reduce(function (total, segment) {
      return total + segment.durationMs;
    }, 0);
    var severe = context.configuration.severeSpeedThresholdMph === null
      ? [] : severeSegments(
        overLimitSegments,
        context.configuration.severeSpeedThresholdMph
      );
    var severeDurationMs = severe.reduce(function (total, segment) {
      return total + segment.durationMs;
    }, 0);
    var contexts = contextDurations(overLimitSegments);
    var eventId = deterministicEventId(context.deviceId, candidate.startMs);
    var findingCodes = candidate.findingCodes.slice();
    if (!physicalEndKnown) {
      findingCodes.push("SPEED_EVENT_END_UNKNOWN", "PARTIAL_SPEED_EVENT");
    }
    if (candidate.affectedByCommunicationGap) {
      findingCodes.push("COMMUNICATION_GAP_DURING_SPEED_EVENT");
    }
    findingCodes = unique(findingCodes);
    return {
      eventId: eventId,
      deviceId: context.deviceId,
      startUtc: iso(candidate.startMs),
      endUtc: iso(candidate.lastVerifiedEndMs),
      durationMs: durationMs,
      topSpeedMph: top ? top.speedMph : null,
      topSpeedTimestamp: top ? iso(top.observationMs) : null,
      speedLimitMph: context.configuration.speedLimitMph,
      maximumExceedanceMph: top
        ? top.speedMph - context.configuration.speedLimitMph
        : null,
      severeThresholdExceeded: severeDurationMs > 0,
      severeDurationMs: severeDurationMs,
      severeEventCount: severe.length,
      operationalStateBreakdown: operationalBreakdown(overLimitSegments),
      coupledDurationMs: contexts.coupledDurationMs,
      uncoupledDurationMs: contexts.uncoupledDurationMs,
      noSensorDurationMs: contexts.noSensorDurationMs,
      unknownCouplingDurationMs: contexts.unknownCouplingDurationMs,
      reportable:
        durationMs >= context.configuration.minimumReportableEventDurationMs,
      physicalEndKnown: physicalEndKnown,
      affectedByUnknownData: candidate.affectedByUnknownData || !physicalEndKnown,
      affectedByCommunicationGap: candidate.affectedByCommunicationGap,
      findingCodes: findingCodes,
      findings: findingCodes.map(function (code) {
        return eventFinding(code, eventId);
      }),
      overLimitSegments: overLimitSegments.map(function (segment) {
        return {
          startUtc: iso(segment.startMs),
          endUtc: iso(segment.endMs),
          durationMs: segment.durationMs,
          sampleDurationMs: eventObservationDuration(segment),
          speedMph: segment.speedMph,
          observationTimestamp: iso(segment.observationMs),
          operationalState: segment.state,
          trailerCouplingContext: segment.couplingContext,
          sourceReference: segment.sourceReference
        };
      }),
      severeSegments: severe.map(function (segment) {
        return {
          startUtc: segment.startUtc,
          endUtc: segment.endUtc,
          durationMs: segment.durationMs,
          topSpeedMph: segment.topSpeedMph,
          topSpeedTimestamp: segment.topSpeedTimestamp
        };
      }),
      reportingAttribution: null
    };
  }

  function buildPhysicalEvents(sequence, context) {
    var events = [];
    var current = null;
    var pendingBreak = null;

    function open(segment) {
      current = {
        startMs: segment.startMs,
        lastVerifiedEndMs: segment.endMs,
        overLimitSegments: [],
        affectedByUnknownData: false,
        affectedByCommunicationGap: false,
        findingCodes: []
      };
      pendingBreak = null;
    }

    function finalize(physicalEndKnown) {
      if (current) {
        events.push(buildEventRecord(current, context, physicalEndKnown));
      }
      current = null;
      pendingBreak = null;
    }

    function addAbove(segment) {
      splitByTimeline(segment, context.timeline).forEach(function (piece) {
        current.overLimitSegments.push(piece);
      });
      current.lastVerifiedEndMs = segment.endMs;
    }

    function beginOrExtendBreak(segment, kind) {
      if (!pendingBreak) {
        pendingBreak = {
          startMs: segment.startMs,
          endMs: segment.endMs,
          hasGap: kind === "gap"
        };
      } else {
        pendingBreak.endMs = segment.endMs;
        pendingBreak.hasGap = pendingBreak.hasGap || kind === "gap";
      }
      if (kind === "gap") {
        current.affectedByUnknownData = true;
        current.affectedByCommunicationGap =
          current.affectedByCommunicationGap
          || segment.communicationGap
          || communicationGapInRange(context.timeline, segment.startMs, segment.endMs);
        current.findingCodes.push("SPEED_DATA_GAP", "PARTIAL_SPEED_EVENT");
      }
    }

    sequence.forEach(function (segment) {
      var above = segment.valid
        && segment.speedMph > context.configuration.speedLimitMph;
      if (above) {
        if (!current) {
          open(segment);
        } else if (pendingBreak) {
          var breakDuration = pendingBreak.endMs - pendingBreak.startMs;
          var bridges = breakDuration < context.configuration.eventCloseGraceMs
            && (!pendingBreak.hasGap
              || context.configuration.missingDataPolicy
                === MISSING_DATA_POLICIES.BRIDGE_WITHIN_GRACE);
          if (!bridges) {
            finalize(!pendingBreak.hasGap);
            open(segment);
          } else {
            pendingBreak = null;
          }
        }
        addAbove(segment);
        return;
      }
      if (!current) {
        return;
      }
      if (!segment.valid) {
        beginOrExtendBreak(segment, "gap");
        if (context.configuration.missingDataPolicy
          === MISSING_DATA_POLICIES.INTERRUPT_EVENT
          || pendingBreak.endMs - pendingBreak.startMs
            >= context.configuration.eventCloseGraceMs) {
          finalize(false);
        }
        return;
      }
      beginOrExtendBreak(segment, "below");
      if (pendingBreak.endMs - pendingBreak.startMs
        >= context.configuration.eventCloseGraceMs) {
        finalize(!pendingBreak.hasGap);
      }
    });
    if (current) {
      var known = Boolean(pendingBreak)
        && !pendingBreak.hasGap
        && pendingBreak.endMs - pendingBreak.startMs
          >= context.configuration.eventCloseGraceMs;
      finalize(known);
    }
    return events;
  }

  function segmentOverlapDuration(segments, startMs, endMs) {
    return segments.reduce(function (total, segment) {
      var intersection = overlap(
        Date.parse(segment.startUtc),
        Date.parse(segment.endUtc),
        startMs,
        endMs
      );
      return total + (intersection ? intersection.durationMs : 0);
    }, 0);
  }

  function segmentContextDurations(segments, startMs, endMs) {
    var result = {
      coupledDurationMs: 0,
      uncoupledDurationMs: 0,
      noSensorDurationMs: 0,
      unknownCouplingDurationMs: 0
    };
    segments.forEach(function (segment) {
      var intersection = overlap(
        Date.parse(segment.startUtc),
        Date.parse(segment.endUtc),
        startMs,
        endMs
      );
      if (!intersection) {
        return;
      }
      if (segment.trailerCouplingContext === COUPLING_CONTEXTS.COUPLED) {
        result.coupledDurationMs += intersection.durationMs;
      } else if (segment.trailerCouplingContext === COUPLING_CONTEXTS.UNCOUPLED) {
        result.uncoupledDurationMs += intersection.durationMs;
      } else if (segment.trailerCouplingContext === COUPLING_CONTEXTS.NO_SENSOR) {
        result.noSensorDurationMs += intersection.durationMs;
      } else {
        result.unknownCouplingDurationMs += intersection.durationMs;
      }
    });
    return result;
  }

  function eventTopInRange(event, startMs, endMs) {
    var observations = event.overLimitSegments.map(function (segment) {
      return {
        valid: true,
        observationMs: Date.parse(segment.observationTimestamp),
        durationMs: segment.durationMs,
        speedMph: segment.speedMph,
        sourceReference: segment.sourceReference,
        state: segment.operationalState,
        couplingContext: segment.trailerCouplingContext
      };
    });
    return bestObservation(observations, startMs, endMs, 0);
  }

  function attachReportingAttribution(event, reportingStartMs, reportingEndMs) {
    var durationMs = segmentOverlapDuration(
      event.overLimitSegments,
      reportingStartMs,
      reportingEndMs
    );
    var severeDurationMs = segmentOverlapDuration(
      event.severeSegments,
      reportingStartMs,
      reportingEndMs
    );
    var top = eventTopInRange(event, reportingStartMs, reportingEndMs);
    var contexts = segmentContextDurations(
      event.overLimitSegments,
      reportingStartMs,
      reportingEndMs
    );
    var eventStartMs = Date.parse(event.startUtc);
    var eventEndMs = Date.parse(event.endUtc);
    return Object.assign({}, event, {
      reportingAttribution: {
        startUtc: iso(reportingStartMs),
        endUtc: iso(reportingEndMs),
        eventStartCredit:
          eventStartMs >= reportingStartMs && eventStartMs < reportingEndMs,
        carriedIn: eventStartMs < reportingStartMs && durationMs > 0,
        carriedOut: durationMs > 0
          && (eventEndMs > reportingEndMs
            || (!event.physicalEndKnown && eventEndMs >= reportingEndMs)),
        overLimitDurationMs: durationMs,
        severeDurationMs: severeDurationMs,
        topSpeedMph: top ? top.speedMph : null,
        topSpeedTimestamp: top ? iso(top.observationMs) : null,
        coupledDurationMs: contexts.coupledDurationMs,
        uncoupledDurationMs: contexts.uncoupledDurationMs,
        noSensorDurationMs: contexts.noSensorDurationMs,
        unknownCouplingDurationMs: contexts.unknownCouplingDurationMs
      }
    });
  }

  function validEvidenceCoverage(evidence, startMs, endMs) {
    return evidence.filter(function (item) {
      return item.valid && item.durationMs > 0;
    }).reduce(function (total, item) {
      var intersection = overlap(item.startMs, item.endMs, startMs, endMs);
      return total + (intersection ? intersection.durationMs : 0);
    }, 0);
  }

  function totalValidMovingTime(evidence, timeline, startMs, endMs) {
    return evidence.filter(function (item) {
      return item.valid && item.durationMs > 0;
    }).reduce(function (total, item) {
      return total + timeline.reduce(function (subtotal, interval) {
        if (!MOVING_STATES.includes(interval.state)) {
          return subtotal;
        }
        var intersection = overlap(
          Math.max(item.startMs, startMs),
          Math.min(item.endMs, endMs),
          Date.parse(interval.startUtc),
          Date.parse(interval.endUtc)
        );
        return subtotal + (intersection ? intersection.durationMs : 0);
      }, 0);
    }, 0);
  }

  function topSpeedResult(evidence, timeline, configuration, startMs, endMs) {
    var top = bestObservation(
      evidence,
      startMs,
      endMs,
      configuration.topSpeedMinimumSampleDurationMs
    );
    if (!top) {
      return {
        available: false,
        topSpeedMph: null,
        topSpeedTimestamp: null,
        operationalState: null,
        trailerCouplingContext: COUPLING_CONTEXTS.UNKNOWN,
        sourceReference: null
      };
    }
    var state = timelineStateAt(timeline, top.observationMs);
    return {
      available: true,
      topSpeedMph: top.speedMph,
      topSpeedTimestamp: iso(top.observationMs),
      operationalState: state,
      trailerCouplingContext: couplingContextForState(state),
      sourceReference: top.sourceReference
    };
  }

  function analysisFinding(code, deviceId, durationMs) {
    return {
      code: code,
      category: "speed-analytics",
      severity: "warning",
      deviceId: deviceId,
      durationMs: durationMs === undefined ? null : durationMs,
      affectedMetrics: code === "MOVING_TIME_UNAVAILABLE"
        ? ["Percentage of Moving Time Over Speed Limit"]
        : ["Top Speed", "Time Over Speed Limit"],
      message: findingMessage(code)
    };
  }

  function analyzeSpeedEvents(request) {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new SpeedInputError("INVALID_SPEED_REQUEST", "Speed request is required");
    }
    if (typeof request.deviceId !== "string" || !request.deviceId.trim()) {
      throw new SpeedInputError("INVALID_DEVICE_ID", "deviceId is required");
    }
    var configuration = assertValidSpeedConfiguration(request.configuration);
    var reportingStartMs = exactMilliseconds(
      request.startUtc,
      "speed reporting startUtc"
    );
    var reportingEndMs = exactMilliseconds(
      request.endUtc,
      "speed reporting endUtc"
    );
    if (reportingEndMs <= reportingStartMs) {
      throw new SpeedInputError(
        "INVALID_REPORTING_INTERVAL",
        "Speed reporting endUtc must be after startUtc"
      );
    }
    var timeline = normalizeTimeline(request.timeline, request.deviceId);
    var evidence = normalizeSpeedEvidence(request, request.deviceId);
    var positiveEvidence = evidence.filter(function (item) {
      return item.durationMs > 0;
    });
    var scanStartMs = positiveEvidence.length
      ? Math.min(reportingStartMs, positiveEvidence[0].startMs)
      : reportingStartMs;
    var scanEndMs = positiveEvidence.length
      ? Math.max(reportingEndMs, positiveEvidence[positiveEvidence.length - 1].endMs)
      : reportingEndMs;
    var sequence = completeEvidenceSequence(
      evidence,
      scanStartMs,
      scanEndMs,
      timeline
    );
    var physicalEvents = buildPhysicalEvents(sequence, {
      deviceId: request.deviceId,
      configuration: configuration,
      timeline: timeline
    }).map(function (event) {
      return attachReportingAttribution(event, reportingStartMs, reportingEndMs);
    }).filter(function (event) {
      return event.reportingAttribution.overLimitDurationMs > 0;
    });

    var validCoverageMs = validEvidenceCoverage(
      evidence,
      reportingStartMs,
      reportingEndMs
    );
    var reportingDurationMs = reportingEndMs - reportingStartMs;
    var missingSpeedDurationMs = reportingDurationMs - validCoverageMs;
    var validMovingTimeMs = totalValidMovingTime(
      evidence,
      timeline,
      reportingStartMs,
      reportingEndMs
    );
    var topSpeed = topSpeedResult(
      evidence,
      timeline,
      configuration,
      reportingStartMs,
      reportingEndMs
    );
    var findings = [];
    if (!topSpeed.available && validCoverageMs === 0) {
      findings.push(analysisFinding(
        "SPEED_DATA_UNAVAILABLE",
        request.deviceId,
        reportingDurationMs
      ));
    } else if (missingSpeedDurationMs > 0) {
      findings.push(analysisFinding(
        "SPEED_DATA_GAP",
        request.deviceId,
        missingSpeedDurationMs
      ));
    }
    if (validMovingTimeMs === 0) {
      findings.push(analysisFinding("MOVING_TIME_UNAVAILABLE", request.deviceId));
    }
    physicalEvents.forEach(function (event) {
      findings = findings.concat(event.findings);
    });

    return {
      deviceId: request.deviceId,
      startUtc: iso(reportingStartMs),
      endUtc: iso(reportingEndMs),
      configuration: configuration,
      topSpeed: topSpeed,
      speedDataCoverage: {
        reportingDurationMs: reportingDurationMs,
        validSpeedDurationMs: validCoverageMs,
        missingSpeedDurationMs: missingSpeedDurationMs,
        complete: missingSpeedDurationMs === 0
      },
      totalValidMovingTimeMs: validMovingTimeMs,
      speedObservations: evidence.filter(function (item) {
        return item.valid
          && item.observationMs >= reportingStartMs
          && item.observationMs < reportingEndMs;
      }).map(function (item) {
        var state = timelineStateAt(timeline, item.observationMs);
        return {
          timestamp: iso(item.observationMs),
          speedMph: item.speedMph,
          sampleDurationMs: item.durationMs,
          operationalState: state,
          trailerCouplingContext: couplingContextForState(state),
          sourceReference: item.sourceReference
        };
      }),
      events: physicalEvents,
      findings: findings,
      missingDataPolicy: configuration.missingDataPolicy,
      eventCountPolicy: "EVENT_START_CREDIT"
    };
  }

  return {
    COUPLING_CONTEXTS: COUPLING_CONTEXTS,
    MISSING_DATA_POLICIES: MISSING_DATA_POLICIES,
    MOVING_STATES: MOVING_STATES,
    SpeedInputError: SpeedInputError,
    analyzeSpeedEvents: analyzeSpeedEvents,
    assertValidSpeedConfiguration: assertValidSpeedConfiguration,
    deterministicEventId: deterministicEventId,
    findingMessage: findingMessage,
    validateSpeedConfiguration: validateSpeedConfiguration
  };
}));
