(function (root, factory) {
  "use strict";

  var operationalStates = typeof module === "object" && module.exports
    ? require("./operational-states")
    : root.SIQ_OPERATIONAL_STATES;
  var api = factory(operationalStates);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_MOVE_STATE_MACHINE = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (operationalStates) {
  "use strict";

  var STATES = operationalStates.STATES;

  function iso(milliseconds) {
    return new Date(milliseconds).toISOString();
  }

  function unique(values) {
    return Array.from(new Set(values));
  }

  function fnv1a(value) {
    var hash = 2166136261;
    for (var index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function deterministicMoveId(deviceId, anchor) {
    return "move-" + fnv1a(deviceId + "|" + anchor);
  }

  function overlap(start, end, otherStart, otherEnd) {
    var clippedStart = Math.max(start, otherStart);
    var clippedEnd = Math.min(end, otherEnd);
    return clippedStart < clippedEnd
      ? { start: clippedStart, end: clippedEnd, durationMs: clippedEnd - clippedStart }
      : null;
  }

  function qualifyingMovement(candidate, context, effectiveEndMs) {
    var segments = [];
    context.timelineIntervals.forEach(function (interval) {
      if (interval.state !== STATES.COUPLED_MOVING
        || typeof interval.speedMph !== "number"
        || !Number.isFinite(interval.speedMph)
        || interval.speedMph <= context.configuration.movementSpeedThresholdMph) {
        return;
      }
      var clipped = overlap(
        Date.parse(interval.startUtc),
        Date.parse(interval.endUtc),
        candidate.effectiveStartMs,
        effectiveEndMs
      );
      if (clipped) {
        segments.push({
          startUtc: iso(clipped.start),
          endUtc: iso(clipped.end),
          durationMs: clipped.durationMs,
          speedMph: interval.speedMph
        });
      }
    });
    return segments;
  }

  function qualifyingDistance(candidate, context, effectiveEndMs) {
    var total = 0;
    var evidenceAvailable = false;
    context.distanceIntervals.forEach(function (interval) {
      var intervalStart = Date.parse(interval.startUtc);
      var intervalEnd = Date.parse(interval.endUtc);
      var clipped = overlap(
        intervalStart,
        intervalEnd,
        candidate.effectiveStartMs,
        effectiveEndMs
      );
      if (!clipped) {
        return;
      }
      evidenceAvailable = true;
      total += interval.distanceMiles * (clipped.durationMs / (intervalEnd - intervalStart));
    });
    return {
      evidenceAvailable: evidenceAvailable,
      distanceMiles: evidenceAvailable ? total : null
    };
  }

  function findingMessage(code) {
    var messages = {
      MOVE_START_BEFORE_WINDOW:
        "Carryover Trailer Move — the coupled period began before this reporting interval.",
      COUPLING_TIME_UNKNOWN:
        "Partial Data — the true Trailer Coupled time was not available.",
      MOVEMENT_NOT_CONFIRMED:
        "Movement Not Confirmed — meaningful movement while the trailer was coupled was not verified.",
      TRAILER_RELEASE_NOT_OBSERVED:
        "Trailer Released transition not observed — this trailer move remains open.",
      FIFTH_WHEEL_STATUS_GAP:
        "Fifth Wheel Status Unavailable — trailer release could not be confirmed.",
      COMMUNICATION_GAP_DURING_MOVE:
        "Communication Gap — the trailer move could not be verified as completed.",
      MOVE_COMPLETION_TIME_UNKNOWN:
        "Partial Data — movement occurred while the trailer was coupled, but the release time was unavailable.",
      MOVE_EXCEEDS_MAX_DURATION:
        "Extended Coupled Period — this trailer move remained open longer than the configured review threshold.",
      INCONSISTENT_STATE_SEQUENCE:
        "Inconsistent Operational State — timeline evidence conflicted with the authoritative Fifth Wheel Status.",
      REQUIRED_DISTANCE_UNAVAILABLE:
        "Required Distance Unavailable — the configured movement-distance requirement could not be verified."
    };
    return messages[code];
  }

  function addCandidateFinding(candidate, code) {
    if (findingMessage(code)) {
      candidate.findingCodes.push(code);
    }
  }

  function inspectTimelineConditions(candidate, context, effectiveEndMs) {
    context.timelineIntervals.forEach(function (interval) {
      var clipped = overlap(
        Date.parse(interval.startUtc),
        Date.parse(interval.endUtc),
        candidate.effectiveStartMs,
        effectiveEndMs
      );
      if (!clipped) {
        return;
      }
      if (interval.state === STATES.UNKNOWN) {
        candidate.affectedByUnknownData = true;
      }
      if (interval.state === STATES.NOT_COMMUNICATING
        || interval.communicationCondition === "NOT_COMMUNICATING"
        || interval.communicationCondition === "STALE") {
        candidate.affectedByCommunicationGap = true;
        addCandidateFinding(candidate, "COMMUNICATION_GAP_DURING_MOVE");
      }
      if (interval.state === STATES.BOBTAIL_MOVING
        || interval.state === STATES.BOBTAIL_IDLE) {
        candidate.affectedByUnknownData = true;
        addCandidateFinding(candidate, "INCONSISTENT_STATE_SEQUENCE");
      }
    });
  }

  function reportingMovementDuration(segments, startMs, endMs) {
    return segments.reduce(function (total, segment) {
      var clipped = overlap(
        Date.parse(segment.startUtc),
        Date.parse(segment.endUtc),
        startMs,
        endMs
      );
      return total + (clipped ? clipped.durationMs : 0);
    }, 0);
  }

  function completeCandidate(candidate, context, options) {
    var effectiveEndMs = options.effectiveEndMs;
    var movementSegments = qualifyingMovement(candidate, context, effectiveEndMs);
    var observedMovementDurationMs = movementSegments.reduce(function (total, segment) {
      return total + segment.durationMs;
    }, 0);
    var qualifyingMovementDurationMs = candidate.seedQualifyingMovementDurationMs
      + observedMovementDurationMs;
    var distance = qualifyingDistance(candidate, context, effectiveEndMs);
    var configuredDistance = context.configuration.minimumMovementDistanceMiles;
    var durationQualified = qualifyingMovementDurationMs
      >= context.configuration.minimumMovementDurationMs;
    var distanceQualified = configuredDistance === undefined
      || (distance.evidenceAvailable
        && candidate.seedQualifyingDistanceMiles + distance.distanceMiles >= configuredDistance);

    inspectTimelineConditions(candidate, context, effectiveEndMs);

    if (configuredDistance !== undefined && !distance.evidenceAvailable
      && candidate.seedQualifyingDistanceMiles === 0) {
      addCandidateFinding(candidate, "REQUIRED_DISTANCE_UNAVAILABLE");
    }

    var meaningfulMovement = durationQualified && distanceQualified;
    var status;
    if (options.completionTimeUnknown) {
      status = context.statuses.INTERRUPTED_MOVE;
      addCandidateFinding(candidate, "MOVE_COMPLETION_TIME_UNKNOWN");
      addCandidateFinding(candidate, "FIFTH_WHEEL_STATUS_GAP");
    } else if (options.releaseTimestampMs !== null) {
      if (meaningfulMovement) {
        status = context.statuses.COMPLETED_MOVE;
      } else if (configuredDistance !== undefined && !distance.evidenceAvailable) {
        status = context.statuses.INCOMPLETE_MOVE;
      } else {
        status = context.statuses.COUPLED_WITHOUT_MEANINGFUL_MOVEMENT;
        addCandidateFinding(candidate, "MOVEMENT_NOT_CONFIRMED");
      }
    } else if (meaningfulMovement) {
      status = context.statuses.MOVE_IN_PROGRESS;
      addCandidateFinding(candidate, "TRAILER_RELEASE_NOT_OBSERVED");
      if (context.configuration.missingDataPolicy === "FAIL_CLOSED"
        && (candidate.affectedByCommunicationGap || candidate.fifthWheelStatusGap)) {
        status = context.statuses.INTERRUPTED_MOVE;
      }
    } else if (configuredDistance !== undefined && !distance.evidenceAvailable) {
      status = context.statuses.INCOMPLETE_MOVE;
      addCandidateFinding(candidate, "TRAILER_RELEASE_NOT_OBSERVED");
    } else {
      status = context.statuses.COUPLING_DETECTED;
      addCandidateFinding(candidate, "MOVEMENT_NOT_CONFIRMED");
      addCandidateFinding(candidate, "TRAILER_RELEASE_NOT_OBSERVED");
    }

    var durationStartMs = candidate.couplingTimestampMs === null
      ? candidate.effectiveStartMs
      : candidate.couplingTimestampMs;
    var elapsedDurationMs = effectiveEndMs - durationStartMs;
    var exceedsMaximum = elapsedDurationMs
      > context.configuration.maximumReasonableMoveDurationMs;
    var reviewRequired = false;
    if (exceedsMaximum) {
      addCandidateFinding(candidate, "MOVE_EXCEEDS_MAX_DURATION");
      if (context.configuration.maximumDurationPolicy === "MARK_INCOMPLETE") {
        status = context.statuses.INCOMPLETE_MOVE;
      } else if (context.configuration.maximumDurationPolicy === "REVIEW_REQUIRED") {
        reviewRequired = true;
      }
    }

    if (candidate.carriedIntoInterval) {
      addCandidateFinding(candidate, "MOVE_START_BEFORE_WINDOW");
    }
    if (candidate.couplingTimestampMs === null) {
      addCandidateFinding(candidate, "COUPLING_TIME_UNKNOWN");
    }

    var completionTimestamp = options.releaseTimestampMs === null
      ? null
      : iso(options.releaseTimestampMs);
    var completionInInterval = status === context.statuses.COMPLETED_MOVE
      && options.releaseTimestampMs >= context.reportingStartMs
      && options.releaseTimestampMs < context.reportingEndMs;
    var carriedOut = options.releaseTimestampMs === null
      && !options.completionTimeUnknown;
    var moveId = candidate.moveId || deterministicMoveId(
      context.deviceId,
      candidate.couplingTimestampMs === null
        ? candidate.anchor
        : String(candidate.couplingTimestampMs)
    );
    var findingCodes = unique(candidate.findingCodes);

    return {
      moveId: moveId,
      deviceId: context.deviceId,
      status: status,
      couplingTimestamp: candidate.couplingTimestampMs === null
        ? null
        : iso(candidate.couplingTimestampMs),
      movementStartTimestamp: candidate.movementStartTimestamp
        || (movementSegments.length ? movementSegments[0].startUtc : null),
      completionTimestamp: completionTimestamp,
      coupledIntervalStart: candidate.couplingTimestampMs === null
        ? null
        : iso(candidate.couplingTimestampMs),
      coupledIntervalEnd: completionTimestamp,
      qualifyingMovementDurationMs: qualifyingMovementDurationMs,
      qualifyingMovementIntervals: movementSegments,
      qualifyingDistanceMiles: configuredDistance === undefined
        ? null
        : (distance.evidenceAvailable
          ? candidate.seedQualifyingDistanceMiles + distance.distanceMiles
          : null),
      meaningfulMovementConfirmed: meaningfulMovement,
      reportingAttribution: {
        policy: context.configuration.reportingBoundaryPolicy,
        startUtc: iso(context.reportingStartMs),
        endUtc: iso(context.reportingEndMs),
        activityInReportingInterval: candidate.effectiveStartMs < context.reportingEndMs
          && effectiveEndMs > context.reportingStartMs,
        completedMoveCredit: completionInInterval,
        qualifyingMovementDurationMs: reportingMovementDuration(
          movementSegments,
          context.reportingStartMs,
          context.reportingEndMs
        )
      },
      startedBeforeReportingInterval: candidate.carriedIntoInterval,
      completedAfterReportingInterval: options.releaseTimestampMs !== null
        && options.releaseTimestampMs >= context.reportingEndMs,
      carriedIntoInterval: candidate.carriedIntoInterval,
      carriedOutOfInterval: carriedOut,
      affectedByUnknownData: candidate.affectedByUnknownData
        || candidate.fifthWheelStatusGap,
      affectedByCommunicationGap: candidate.affectedByCommunicationGap,
      reviewRequired: reviewRequired,
      findingCodes: findingCodes,
      sourceBoundaryReferences: {
        couplingSampleTimestamp: candidate.couplingTimestampMs === null
          ? null
          : iso(candidate.couplingTimestampMs),
        releaseSampleTimestamp: completionTimestamp
      }
    };
  }

  function newCandidate(context, options) {
    var couplingTimestampMs = options.couplingTimestampMs;
    return {
      couplingTimestampMs: couplingTimestampMs,
      effectiveStartMs: couplingTimestampMs === null
        ? context.reportingStartMs
        : Math.max(couplingTimestampMs, context.reportingStartMs),
      carriedIntoInterval: options.carriedIntoInterval,
      anchor: options.anchor,
      moveId: options.moveId || null,
      movementStartTimestamp: options.movementStartTimestamp || null,
      seedQualifyingMovementDurationMs: options.qualifyingMovementDurationMs || 0,
      seedQualifyingDistanceMiles: options.qualifyingDistanceMiles || 0,
      affectedByUnknownData: Boolean(options.affectedByUnknownData),
      affectedByCommunicationGap: Boolean(options.affectedByCommunicationGap),
      fifthWheelStatusGap: false,
      findingCodes: []
    };
  }

  function priorCouplingTransition(samples, startMs) {
    var priorKnown = null;
    var transition = null;
    var interrupted = false;
    samples.forEach(function (sample) {
      var timestampMs = Date.parse(sample.timestamp);
      if (timestampMs > startMs) {
        return;
      }
      if (sample.state === "UNKNOWN") {
        interrupted = true;
        priorKnown = "UNKNOWN";
        return;
      }
      if (sample.state === "COUPLED" && priorKnown === "UNCOUPLED" && !interrupted) {
        transition = timestampMs;
      }
      if (sample.state === "UNCOUPLED") {
        transition = null;
      }
      priorKnown = sample.state;
      interrupted = false;
    });
    return transition;
  }

  function processMoveState(context) {
    var samples = context.couplingSamples;
    var exactStartSample = samples.find(function (sample) {
      return Date.parse(sample.timestamp) === context.reportingStartMs;
    });
    var latestAtOrBefore = null;
    samples.forEach(function (sample) {
      if (Date.parse(sample.timestamp) <= context.reportingStartMs) {
        latestAtOrBefore = sample;
      }
    });

    var initial = exactStartSample || latestAtOrBefore || context.boundarySeed || null;
    var currentState = initial ? initial.state : "UNKNOWN";
    var candidate = null;
    var moves = [];

    if (currentState === "COUPLED") {
      var transition = exactStartSample && priorCouplingTransition(samples, context.reportingStartMs)
        === context.reportingStartMs
        ? context.reportingStartMs
        : priorCouplingTransition(samples, context.reportingStartMs);
      var carriedInto = transition === null || transition < context.reportingStartMs;
      candidate = newCandidate(context, {
        couplingTimestampMs: carriedInto ? transition : context.reportingStartMs,
        carriedIntoInterval: carriedInto,
        anchor: initial.timestamp || iso(context.reportingStartMs),
        moveId: exactStartSample ? null : initial.moveId,
        movementStartTimestamp: exactStartSample ? null : initial.movementStartTimestamp,
        qualifyingMovementDurationMs: exactStartSample
          ? 0
          : initial.qualifyingMovementDurationMs,
        qualifyingDistanceMiles: exactStartSample
          ? 0
          : initial.qualifyingDistanceMiles,
        affectedByUnknownData: exactStartSample ? false : initial.affectedByUnknownData,
        affectedByCommunicationGap: exactStartSample
          ? false
          : initial.affectedByCommunicationGap
      });
    }

    samples.forEach(function (sample) {
      var timestampMs = Date.parse(sample.timestamp);
      if (timestampMs <= context.reportingStartMs || timestampMs >= context.reportingEndMs) {
        return;
      }
      if (sample.state === currentState) {
        return;
      }

      if (sample.state === "UNKNOWN") {
        if (candidate) {
          candidate.fifthWheelStatusGap = true;
          candidate.affectedByUnknownData = true;
          addCandidateFinding(candidate, "FIFTH_WHEEL_STATUS_GAP");
        }
        currentState = "UNKNOWN";
        return;
      }

      if (sample.state === "COUPLED") {
        if (currentState === "UNCOUPLED") {
          candidate = newCandidate(context, {
            couplingTimestampMs: timestampMs,
            carriedIntoInterval: false,
            anchor: sample.timestamp
          });
        }
        currentState = "COUPLED";
        return;
      }

      if (sample.state === "UNCOUPLED") {
        if (candidate && currentState === "COUPLED") {
          moves.push(completeCandidate(candidate, context, {
            effectiveEndMs: timestampMs,
            releaseTimestampMs: timestampMs,
            completionTimeUnknown: false
          }));
        } else if (candidate && currentState === "UNKNOWN") {
          moves.push(completeCandidate(candidate, context, {
            effectiveEndMs: timestampMs,
            releaseTimestampMs: null,
            completionTimeUnknown: true
          }));
        }
        candidate = null;
        currentState = "UNCOUPLED";
      }
    });

    if (candidate) {
      moves.push(completeCandidate(candidate, context, {
        effectiveEndMs: context.reportingEndMs,
        releaseTimestampMs: null,
        completionTimeUnknown: false
      }));
    }

    return moves;
  }

  return {
    deterministicMoveId: deterministicMoveId,
    findingMessage: findingMessage,
    processMoveState: processMoveState
  };
}));
