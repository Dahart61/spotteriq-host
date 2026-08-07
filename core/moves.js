(function (root, factory) {
  "use strict";

  var telemetry = typeof module === "object" && module.exports
    ? require("./telemetry")
    : root.SIQ_TELEMETRY;
  var stateMachine = typeof module === "object" && module.exports
    ? require("./move-state-machine")
    : root.SIQ_MOVE_STATE_MACHINE;
  var api = factory(telemetry, stateMachine);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_MOVES = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (telemetry, stateMachine) {
  "use strict";

  var COUPLING_STATES = Object.freeze({
    COUPLED: "COUPLED",
    UNCOUPLED: "UNCOUPLED",
    UNKNOWN: "UNKNOWN"
  });

  var MOVE_STATUSES = Object.freeze({
    COUPLING_DETECTED: "COUPLING_DETECTED",
    MOVE_IN_PROGRESS: "MOVE_IN_PROGRESS",
    COMPLETED_MOVE: "COMPLETED_MOVE",
    COUPLED_WITHOUT_MEANINGFUL_MOVEMENT: "COUPLED_WITHOUT_MEANINGFUL_MOVEMENT",
    INCOMPLETE_MOVE: "INCOMPLETE_MOVE",
    INTERRUPTED_MOVE: "INTERRUPTED_MOVE"
  });

  var REPORTING_BOUNDARY_POLICIES = Object.freeze({
    PRESERVE_PHYSICAL_MOVE: "PRESERVE_PHYSICAL_MOVE"
  });

  var MISSING_DATA_POLICIES = Object.freeze({
    FAIL_CLOSED: "FAIL_CLOSED",
    RETAIN_IN_PROGRESS: "RETAIN_IN_PROGRESS"
  });

  var MAXIMUM_DURATION_POLICIES = Object.freeze({
    KEEP_STATUS: "KEEP_STATUS",
    MARK_INCOMPLETE: "MARK_INCOMPLETE",
    REVIEW_REQUIRED: "REVIEW_REQUIRED"
  });

  function MoveInputError(code, message, details) {
    this.name = "MoveInputError";
    this.code = code;
    this.message = message;
    this.details = details || {};
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MoveInputError);
    }
  }
  MoveInputError.prototype = Object.create(Error.prototype);
  MoveInputError.prototype.constructor = MoveInputError;

  function validationError(field, code, message) {
    return { field: field, code: code, message: message };
  }

  function validateMoveConfiguration(configuration) {
    var errors = [];
    if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
      return {
        ok: false,
        errors: [validationError("", "INVALID_CONFIGURATION", "Move configuration is required")]
      };
    }

    if (typeof configuration.movementSpeedThresholdMph !== "number"
      || !Number.isFinite(configuration.movementSpeedThresholdMph)
      || configuration.movementSpeedThresholdMph < 0) {
      errors.push(validationError(
        "movementSpeedThresholdMph",
        "INVALID_THRESHOLD",
        "movementSpeedThresholdMph must be a non-negative finite number"
      ));
    }
    if (typeof configuration.minimumMovementDurationMs !== "number"
      || !Number.isFinite(configuration.minimumMovementDurationMs)
      || configuration.minimumMovementDurationMs <= 0) {
      errors.push(validationError(
        "minimumMovementDurationMs",
        "INVALID_DURATION",
        "minimumMovementDurationMs must be a positive finite number"
      ));
    }
    if (configuration.minimumMovementDistanceMiles !== undefined
      && (typeof configuration.minimumMovementDistanceMiles !== "number"
        || !Number.isFinite(configuration.minimumMovementDistanceMiles)
        || configuration.minimumMovementDistanceMiles <= 0)) {
      errors.push(validationError(
        "minimumMovementDistanceMiles",
        "INVALID_DISTANCE",
        "minimumMovementDistanceMiles must be a positive finite number when supplied"
      ));
    }
    if (typeof configuration.maximumReasonableMoveDurationMs !== "number"
      || !Number.isFinite(configuration.maximumReasonableMoveDurationMs)
      || configuration.maximumReasonableMoveDurationMs <= 0) {
      errors.push(validationError(
        "maximumReasonableMoveDurationMs",
        "INVALID_DURATION",
        "maximumReasonableMoveDurationMs must be a positive finite number"
      ));
    }
    if (!Object.values(REPORTING_BOUNDARY_POLICIES)
      .includes(configuration.reportingBoundaryPolicy)) {
      errors.push(validationError(
        "reportingBoundaryPolicy",
        "INVALID_POLICY",
        "reportingBoundaryPolicy must explicitly preserve the physical move"
      ));
    }
    if (!Object.values(MISSING_DATA_POLICIES).includes(configuration.missingDataPolicy)) {
      errors.push(validationError(
        "missingDataPolicy",
        "INVALID_POLICY",
        "missingDataPolicy is required and must be supported"
      ));
    }
    if (!Object.values(MAXIMUM_DURATION_POLICIES)
      .includes(configuration.maximumDurationPolicy)) {
      errors.push(validationError(
        "maximumDurationPolicy",
        "INVALID_POLICY",
        "maximumDurationPolicy is required and must be supported"
      ));
    }
    return { ok: errors.length === 0, errors: errors };
  }

  function assertValidMoveConfiguration(configuration) {
    var result = validateMoveConfiguration(configuration);
    if (!result.ok) {
      var error = new MoveInputError(
        "INVALID_MOVE_CONFIGURATION",
        result.errors.map(function (item) {
          return item.message;
        }).join("; "),
        { validationErrors: result.errors }
      );
      error.validationErrors = result.errors;
      throw error;
    }
    return Object.assign({}, configuration);
  }

  function initialMoveConfiguration(overrides) {
    var source = overrides || {};
    if (source.useInitialMovementSpeedDefault !== true) {
      throw new MoveInputError(
        "DEFAULT_NOT_REQUESTED",
        "The initial movement speed default requires useInitialMovementSpeedDefault: true"
      );
    }
    return Object.assign({}, source, {
      movementSpeedThresholdMph: source.movementSpeedThresholdMph === undefined
        ? 2
        : source.movementSpeedThresholdMph
    });
  }

  function normalizeCouplingSamples(samples) {
    if (samples === undefined || samples === null) {
      return [];
    }
    if (!Array.isArray(samples)) {
      throw new MoveInputError(
        "INVALID_COUPLING_SAMPLES",
        "Coupling samples must be an array"
      );
    }
    var byTimestamp = new Map();
    samples.forEach(function (sample, index) {
      if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
        throw new MoveInputError(
          "INVALID_COUPLING_SAMPLE",
          "Coupling sample at index " + index + " must be an object"
        );
      }
      var timestampMs = telemetry.exactMilliseconds(
        sample.timestamp,
        "coupling sample timestamp"
      );
      if (!Object.values(COUPLING_STATES).includes(sample.state)) {
        throw new MoveInputError(
          "INVALID_COUPLING_STATE",
          "Coupling state must be COUPLED, UNCOUPLED, or UNKNOWN",
          { state: sample.state, index: index }
        );
      }
      var key = String(timestampMs);
      if (byTimestamp.has(key) && byTimestamp.get(key).state !== sample.state) {
        throw new MoveInputError(
          "CONFLICTING_COUPLING_SAMPLE",
          "Conflicting coupling states at " + new Date(timestampMs).toISOString(),
          {
            timestamp: new Date(timestampMs).toISOString(),
            states: [byTimestamp.get(key).state, sample.state]
          }
        );
      }
      byTimestamp.set(key, {
        timestamp: new Date(timestampMs).toISOString(),
        state: sample.state
      });
    });
    return Array.from(byTimestamp.values()).sort(function (left, right) {
      return Date.parse(left.timestamp) - Date.parse(right.timestamp);
    });
  }

  function normalizeBoundarySeed(seed, startMs) {
    if (seed === undefined || seed === null) {
      return null;
    }
    if (!seed || typeof seed !== "object" || Array.isArray(seed)
      || !Object.values(COUPLING_STATES).includes(seed.state)) {
      throw new MoveInputError(
        "INVALID_MOVE_BOUNDARY_SEED",
        "Boundary seed must include a normalized coupling state"
      );
    }
    if (seed.timestamp !== undefined
      && telemetry.exactMilliseconds(seed.timestamp, "move boundary seed timestamp") > startMs) {
      throw new MoveInputError(
        "INVALID_MOVE_BOUNDARY_SEED",
        "Move boundary seed may not be later than startUtc"
      );
    }
    ["qualifyingMovementDurationMs", "qualifyingDistanceMiles"].forEach(function (field) {
      if (seed[field] !== undefined
        && (typeof seed[field] !== "number"
          || !Number.isFinite(seed[field])
          || seed[field] < 0)) {
        throw new MoveInputError(
          "INVALID_MOVE_BOUNDARY_SEED",
          field + " must be a non-negative finite number"
        );
      }
    });
    var movementStartTimestamp = null;
    if (seed.movementStartTimestamp !== undefined
      && seed.movementStartTimestamp !== null) {
      var movementStartMs = telemetry.exactMilliseconds(
        seed.movementStartTimestamp,
        "move boundary seed movementStartTimestamp"
      );
      if (movementStartMs > startMs) {
        throw new MoveInputError(
          "INVALID_MOVE_BOUNDARY_SEED",
          "Boundary seed movementStartTimestamp may not be later than startUtc"
        );
      }
      movementStartTimestamp = new Date(movementStartMs).toISOString();
    }
    return {
      state: seed.state,
      timestamp: seed.timestamp
        ? new Date(Date.parse(seed.timestamp)).toISOString()
        : new Date(startMs).toISOString(),
      moveId: typeof seed.moveId === "string" && seed.moveId ? seed.moveId : null,
      movementStartTimestamp: movementStartTimestamp,
      qualifyingMovementDurationMs: seed.qualifyingMovementDurationMs || 0,
      qualifyingDistanceMiles: seed.qualifyingDistanceMiles || 0,
      affectedByUnknownData: Boolean(seed.affectedByUnknownData),
      affectedByCommunicationGap: Boolean(seed.affectedByCommunicationGap)
    };
  }

  function timelineIntervals(input) {
    var intervals = Array.isArray(input)
      ? input
      : input && Array.isArray(input.intervals) ? input.intervals : null;
    if (!intervals) {
      throw new MoveInputError(
        "INVALID_OPERATIONAL_TIMELINE",
        "Continuous operational-state timeline intervals are required"
      );
    }
    return intervals.map(function (interval, index) {
      if (!interval || typeof interval !== "object") {
        throw new MoveInputError(
          "INVALID_OPERATIONAL_INTERVAL",
          "Operational interval at index " + index + " must be an object"
        );
      }
      var startMs = telemetry.exactMilliseconds(
        interval.startUtc,
        "operational interval startUtc"
      );
      var endMs = telemetry.exactMilliseconds(
        interval.endUtc,
        "operational interval endUtc"
      );
      if (endMs <= startMs) {
        throw new MoveInputError(
          "INVALID_OPERATIONAL_INTERVAL",
          "Operational interval endUtc must be after startUtc"
        );
      }
      return Object.assign({}, interval, {
        startUtc: new Date(startMs).toISOString(),
        endUtc: new Date(endMs).toISOString(),
        durationMs: endMs - startMs
      });
    }).sort(function (left, right) {
      return Date.parse(left.startUtc) - Date.parse(right.startUtc);
    });
  }

  function assertContinuousTimeline(intervals, startMs, endMs, deviceId) {
    if (!intervals.length) {
      throw new MoveInputError(
        "INCOMPLETE_OPERATIONAL_TIMELINE",
        "Operational timeline must cover the reporting interval continuously"
      );
    }
    var cursor = startMs;
    intervals.forEach(function (interval) {
      var intervalStart = Date.parse(interval.startUtc);
      var intervalEnd = Date.parse(interval.endUtc);
      if (interval.deviceId !== undefined && interval.deviceId !== deviceId) {
        throw new MoveInputError(
          "TIMELINE_DEVICE_MISMATCH",
          "Operational timeline deviceId must match the move request"
        );
      }
      if (intervalEnd <= startMs || intervalStart >= endMs) {
        return;
      }
      var clippedStart = Math.max(intervalStart, startMs);
      var clippedEnd = Math.min(intervalEnd, endMs);
      if (clippedStart !== cursor) {
        throw new MoveInputError(
          clippedStart < cursor
            ? "OVERLAPPING_OPERATIONAL_TIMELINE"
            : "INCOMPLETE_OPERATIONAL_TIMELINE",
          "Operational timeline must have no overlaps or gaps"
        );
      }
      cursor = clippedEnd;
    });
    if (cursor !== endMs) {
      throw new MoveInputError(
        "INCOMPLETE_OPERATIONAL_TIMELINE",
        "Operational timeline must cover the reporting interval continuously"
      );
    }
    return intervals;
  }

  function normalizeDistanceIntervals(intervals) {
    if (intervals === undefined || intervals === null) {
      return [];
    }
    if (!Array.isArray(intervals)) {
      throw new MoveInputError(
        "INVALID_DISTANCE_INTERVALS",
        "Movement-distance intervals must be an array"
      );
    }
    var normalized = intervals.map(function (interval, index) {
      if (!interval || typeof interval !== "object") {
        throw new MoveInputError(
          "INVALID_DISTANCE_INTERVAL",
          "Movement-distance interval at index " + index + " must be an object"
        );
      }
      var startMs = telemetry.exactMilliseconds(interval.startUtc, "distance interval startUtc");
      var endMs = telemetry.exactMilliseconds(interval.endUtc, "distance interval endUtc");
      if (endMs <= startMs || typeof interval.distanceMiles !== "number"
        || !Number.isFinite(interval.distanceMiles) || interval.distanceMiles < 0) {
        throw new MoveInputError(
          "INVALID_DISTANCE_INTERVAL",
          "Distance intervals require positive elapsed time and non-negative finite miles"
        );
      }
      return {
        startUtc: new Date(startMs).toISOString(),
        endUtc: new Date(endMs).toISOString(),
        distanceMiles: interval.distanceMiles
      };
    }).sort(function (left, right) {
      return Date.parse(left.startUtc) - Date.parse(right.startUtc);
    });
    for (var index = 1; index < normalized.length; index += 1) {
      if (Date.parse(normalized[index].startUtc) < Date.parse(normalized[index - 1].endUtc)) {
        throw new MoveInputError(
          "OVERLAPPING_DISTANCE_INTERVALS",
          "Movement-distance intervals may not overlap"
        );
      }
    }
    return normalized;
  }

  function findingFromCode(code, moveId) {
    return {
      code: code,
      category: "trailer-move",
      severity: "warning",
      moveId: moveId,
      affectedMetrics: ["verified trailer-move count"],
      message: stateMachine.findingMessage(code)
    };
  }

  function processTrailerMoves(request) {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new MoveInputError("INVALID_MOVE_REQUEST", "Move request is required");
    }
    if (typeof request.deviceId !== "string" || !request.deviceId.trim()) {
      throw new MoveInputError("INVALID_DEVICE_ID", "deviceId is required");
    }
    if (typeof request.fifthWheelStatusAvailable !== "boolean") {
      throw new MoveInputError(
        "INVALID_CAPABILITY",
        "fifthWheelStatusAvailable must be boolean"
      );
    }
    var configuration = assertValidMoveConfiguration(request.configuration);
    var startMs = telemetry.exactMilliseconds(request.startUtc, "move reporting startUtc");
    var endMs = telemetry.exactMilliseconds(request.endUtc, "move reporting endUtc");
    if (endMs <= startMs) {
      throw new MoveInputError(
        "INVALID_REPORTING_INTERVAL",
        "Move reporting endUtc must be after startUtc"
      );
    }

    if (!request.fifthWheelStatusAvailable) {
      var capabilityFinding = {
        code: "FIFTH_WHEEL_STATUS_UNAVAILABLE",
        category: "capability",
        severity: "warning",
        moveId: null,
        affectedMetrics: ["verified trailer-move count"],
        message: "Fifth Wheel Status Unavailable — verified trailer-move counts are not available for this unit."
      };
      return {
        deviceId: request.deviceId,
        startUtc: new Date(startMs).toISOString(),
        endUtc: new Date(endMs).toISOString(),
        capability: {
          fifthWheelStatusAvailable: false,
          verifiedTrailerMovesAvailable: false
        },
        normalizedCouplingSamples: [],
        moves: [],
        findings: [capabilityFinding]
      };
    }

    var couplingSamples = normalizeCouplingSamples(request.couplingSamples);
    var intervals = timelineIntervals(request.timeline);
    assertContinuousTimeline(intervals, startMs, endMs, request.deviceId);
    var boundarySeed = normalizeBoundarySeed(request.boundarySeed, startMs);
    var distanceIntervals = normalizeDistanceIntervals(request.distanceIntervals);
    var moves = stateMachine.processMoveState({
      deviceId: request.deviceId,
      configuration: configuration,
      couplingSamples: couplingSamples,
      timelineIntervals: intervals,
      distanceIntervals: distanceIntervals,
      boundarySeed: boundarySeed,
      reportingStartMs: startMs,
      reportingEndMs: endMs,
      statuses: MOVE_STATUSES
    });
    var findings = moves.flatMap(function (move) {
      return move.findingCodes.map(function (code) {
        return findingFromCode(code, move.moveId);
      });
    });

    if (!couplingSamples.length && !boundarySeed) {
      findings.push({
        code: "FIFTH_WHEEL_STATUS_UNAVAILABLE",
        category: "data-availability",
        severity: "warning",
        moveId: null,
        affectedMetrics: ["verified trailer-move count"],
        message: "Fifth Wheel Status Unavailable — verified trailer-move activity could not be determined for this interval."
      });
    }
    if (couplingSamples.some(function (sample) {
      return sample.state === COUPLING_STATES.UNKNOWN
        && Date.parse(sample.timestamp) >= startMs
        && Date.parse(sample.timestamp) < endMs;
    }) && !findings.some(function (finding) {
      return finding.code === "FIFTH_WHEEL_STATUS_GAP";
    })) {
      findings.push(findingFromCode("FIFTH_WHEEL_STATUS_GAP", null));
    }

    return {
      deviceId: request.deviceId,
      startUtc: new Date(startMs).toISOString(),
      endUtc: new Date(endMs).toISOString(),
      capability: {
        fifthWheelStatusAvailable: true,
        verifiedTrailerMovesAvailable: true
      },
      normalizedCouplingSamples: couplingSamples,
      moves: moves,
      findings: findings
    };
  }

  return {
    COUPLING_STATES: COUPLING_STATES,
    MAXIMUM_DURATION_POLICIES: MAXIMUM_DURATION_POLICIES,
    MISSING_DATA_POLICIES: MISSING_DATA_POLICIES,
    MOVE_STATUSES: MOVE_STATUSES,
    MoveInputError: MoveInputError,
    REPORTING_BOUNDARY_POLICIES: REPORTING_BOUNDARY_POLICIES,
    assertValidMoveConfiguration: assertValidMoveConfiguration,
    initialMoveConfiguration: initialMoveConfiguration,
    normalizeCouplingSamples: normalizeCouplingSamples,
    normalizeDistanceIntervals: normalizeDistanceIntervals,
    processTrailerMoves: processTrailerMoves,
    validateMoveConfiguration: validateMoveConfiguration
  };
}));
