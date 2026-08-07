(function (root, factory) {
  "use strict";

  var telemetry = typeof module === "object" && module.exports
    ? require("./telemetry")
    : root.SIQ_TELEMETRY;
  var moves = typeof module === "object" && module.exports
    ? require("./moves")
    : root.SIQ_MOVES;
  var api = factory(telemetry, moves);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_MOVE_SUMMARIES = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (telemetry, moves) {
  "use strict";

  var STATUSES = moves.MOVE_STATUSES;

  function completedCredit(move) {
    return move.status === STATUSES.COMPLETED_MOVE
      && (!move.reportingAttribution
        || move.reportingAttribution.completedMoveCredit !== false);
  }

  function summarizeMoves(records) {
    if (!Array.isArray(records)) {
      throw new TypeError("Move records must be an array");
    }
    var creditedCompleted = records.filter(completedCredit);
    var knownDurations = creditedCompleted.filter(function (move) {
      return move.couplingTimestamp && move.completionTimestamp;
    }).map(function (move) {
      return Date.parse(move.completionTimestamp) - Date.parse(move.couplingTimestamp);
    });
    return {
      completedMoveCount: creditedCompleted.length,
      moveInProgressCount: records.filter(function (move) {
        return move.status === STATUSES.MOVE_IN_PROGRESS;
      }).length,
      carryoverMovesCompleted: creditedCompleted.filter(function (move) {
        return move.carriedIntoInterval;
      }).length,
      movesCarriedOut: records.filter(function (move) {
        return move.carriedOutOfInterval;
      }).length,
      coupledWithoutMeaningfulMovementCount: records.filter(function (move) {
        return move.status === STATUSES.COUPLED_WITHOUT_MEANINGFUL_MOVEMENT;
      }).length,
      incompleteMoveCount: records.filter(function (move) {
        return move.status === STATUSES.INCOMPLETE_MOVE;
      }).length,
      interruptedMoveCount: records.filter(function (move) {
        return move.status === STATUSES.INTERRUPTED_MOVE;
      }).length,
      averageCompletedMoveDurationMs: knownDurations.length
        ? knownDurations.reduce(function (total, duration) {
          return total + duration;
        }, 0) / knownDurations.length
        : null,
      qualifyingMovementDurationMs: records.reduce(function (total, move) {
        if (move.reportingAttribution
          && Number.isFinite(move.reportingAttribution.qualifyingMovementDurationMs)) {
          return total + move.reportingAttribution.qualifyingMovementDurationMs;
        }
        return total + move.qualifyingMovementDurationMs;
      }, 0)
    };
  }

  function normalizeOccurrences(occurrences) {
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
        var error = new RangeError(
          "Overlapping shift occurrences cannot receive deterministic move credit"
        );
        error.code = "OVERLAPPING_SHIFT_OCCURRENCES";
        error.conflictingOccurrenceIds = [
          ordered[index - 1].occurrence.occurrenceId,
          ordered[index].occurrence.occurrenceId
        ];
        throw error;
      }
    }
    return ordered;
  }

  function movementDurationInOccurrence(move, start, end) {
    return (move.qualifyingMovementIntervals || []).reduce(function (total, interval) {
      var overlapStart = Math.max(Date.parse(interval.startUtc), start);
      var overlapEnd = Math.min(Date.parse(interval.endUtc), end);
      return total + Math.max(0, overlapEnd - overlapStart);
    }, 0);
  }

  function attributeMoveToShiftOccurrences(move, occurrences) {
    if (!move || typeof move !== "object") {
      throw new TypeError("Move record is required");
    }
    var ordered = normalizeOccurrences(occurrences);
    var completionMs = move.completionTimestamp
      ? telemetry.exactMilliseconds(move.completionTimestamp, "move completionTimestamp")
      : null;
    var completionMatch = completionMs === null ? null : ordered.find(function (item) {
      return completionMs >= item.start && completionMs < item.end;
    });
    var contextual = ordered.filter(function (item) {
      if (completionMs !== null && completionMs >= item.start && completionMs < item.end) {
        return true;
      }
      return (move.qualifyingMovementIntervals || []).some(function (interval) {
        return Date.parse(interval.startUtc) < item.end
          && Date.parse(interval.endUtc) > item.start;
      });
    }).map(function (item) {
      var coupledStart = move.coupledIntervalStart
        ? Date.parse(move.coupledIntervalStart)
        : null;
      var coupledEnd = move.coupledIntervalEnd
        ? Date.parse(move.coupledIntervalEnd)
        : null;
      return {
        occurrenceId: item.occurrence.occurrenceId,
        shiftProfileId: item.occurrence.shiftProfileId,
        completedMoveCredit: completionMatch === item,
        carriedIn: coupledStart === null
          ? move.carriedIntoInterval
          : coupledStart < item.start,
        carriedOut: coupledEnd === null || coupledEnd >= item.end,
        qualifyingMovementDurationMs: movementDurationInOccurrence(
          move,
          item.start,
          item.end
        )
      };
    });
    return Object.assign({}, move, {
      shiftAttribution: {
        completionOccurrenceId: completionMatch
          ? completionMatch.occurrence.occurrenceId
          : null,
        unassignedCompletion: completionMs !== null && !completionMatch,
        occurrences: contextual
      }
    });
  }

  function attributeMovesToShiftOccurrences(records, occurrences) {
    if (!Array.isArray(records)) {
      throw new TypeError("Move records must be an array");
    }
    normalizeOccurrences(occurrences);
    return records.map(function (move) {
      return attributeMoveToShiftOccurrences(move, occurrences);
    });
  }

  return {
    attributeMoveToShiftOccurrences: attributeMoveToShiftOccurrences,
    attributeMovesToShiftOccurrences: attributeMovesToShiftOccurrences,
    summarizeMoves: summarizeMoves
  };
}));
