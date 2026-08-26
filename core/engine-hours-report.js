(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_ENGINE_HOURS_REPORT = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function rawValue(record, lower, upper) {
    return record && Object.prototype.hasOwnProperty.call(record, lower)
      ? record[lower] : record && record[upper];
  }

  function recordTime(record) {
    return Date.parse(rawValue(record, "dateTime", "DateTime"));
  }

  function recordData(record) {
    var value = rawValue(record, "data", "Data");
    return value === null || value === "" || typeof value === "boolean"
      ? NaN : Number(value);
  }

  function recordId(record) {
    var value = rawValue(record, "id", "Id");
    return typeof value === "string" && value.trim() ? value : null;
  }

  function secondsToHours(value) {
    if (value === null || value === "" || typeof value === "boolean") {
      return null;
    }
    var seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds / 3600 : null;
  }

  function sorted(records) {
    return (Array.isArray(records) ? records : []).filter(function (record) {
      return Number.isFinite(recordTime(record));
    }).slice().sort(function (left, right) {
      return recordTime(left) - recordTime(right);
    });
  }

  function cumulativeDeltaHours(records) {
    var values = sorted(records).map(recordData).filter(Number.isFinite);
    if (values.length < 2) {
      return null;
    }
    var begin = secondsToHours(values[0]);
    var end = secondsToHours(values[values.length - 1]);
    var delta = begin !== null && end !== null ? end - begin : null;
    return Number.isFinite(delta) && delta >= 0 ? delta : null;
  }

  function exactBoundary(records, exactUtc) {
    var expected = Date.parse(exactUtc);
    var matches = sorted(records).filter(function (record) {
      return recordTime(record) === expected;
    });
    if (!matches.length) {
      return { ok: false, reasonCode: "BOUNDARY_MISSING" };
    }
    var values = matches.map(recordData);
    if (!values.every(function (value) {
      return Number.isFinite(value) && value >= 0;
    })) {
      return { ok: false, reasonCode: "BOUNDARY_MALFORMED" };
    }
    if (values.some(function (value) { return value !== values[0]; })) {
      return { ok: false, reasonCode: "BOUNDARY_CONFLICT" };
    }
    var stored = matches.some(function (record) { return Boolean(recordId(record)); });
    return {
      ok: true,
      timestamp: new Date(expected).toISOString(),
      rawSeconds: values[0],
      hours: secondsToHours(values[0]),
      source: stored ? "STORED" : "INTERPOLATED",
      provenance: "NATIVE_BOUNDARY"
    };
  }

  function calculatedBoundary(records, exactUtc) {
    var expected = Date.parse(exactUtc);
    var candidates = Array.isArray(records) ? records : [];
    if (!candidates.length) {
      return { ok: false, reasonCode: "BOUNDARY_MISSING" };
    }
    if (candidates.length !== 1) {
      return { ok: false, reasonCode: "BOUNDARY_CONFLICT" };
    }
    var record = candidates[0];
    if (recordTime(record) !== expected) {
      return { ok: false, reasonCode: "BOUNDARY_MISSING" };
    }
    var value = recordData(record);
    var hours = secondsToHours(value);
    if (!Number.isFinite(value) || value < 0 || hours === null) {
      return { ok: false, reasonCode: "BOUNDARY_MALFORMED" };
    }
    return {
      ok: true,
      timestamp: new Date(expected).toISOString(),
      rawSeconds: value,
      hours: hours,
      source: "CALCULATED",
      provenance: "MYGEOTAB_CALCULATED_ENGINE_HOURS"
    };
  }

  function latestStoredReading(data, endUtc) {
    var end = Date.parse(endUtc);
    var supplemental = data && data.engineHoursCarryForward
      && data.engineHoursCarryForward.latestStoredMeter;
    var candidates = (data && data.engineHours || []).concat(
      supplemental ? [supplemental] : []
    ).filter(function (record) {
      var time = recordTime(record);
      return Boolean(recordId(record)) && Number.isFinite(time) && time <= end
        && secondsToHours(recordData(record)) !== null;
    }).sort(function (left, right) {
      return recordTime(right) - recordTime(left);
    });
    if (!candidates.length) {
      return null;
    }
    return {
      timestamp: new Date(recordTime(candidates[0])).toISOString(),
      rawSeconds: recordData(candidates[0]),
      hours: secondsToHours(recordData(candidates[0])),
      source: "STORED",
      provenance: "STORED_READING"
    };
  }

  function meterHistoryAmbiguous(records, beginUtc, endUtc) {
    var start = Date.parse(beginUtc);
    var end = Date.parse(endUtc);
    var values = sorted(records).filter(function (record) {
      var time = recordTime(record);
      return Boolean(recordId(record)) && time >= start && time <= end
        && secondsToHours(recordData(record)) !== null;
    }).map(recordData);
    return values.some(function (value, index) {
      return index > 0 && value < values[index - 1];
    });
  }

  function adjustmentEvidence(records, window, trustworthy) {
    if (trustworthy === false) {
      return {
        trustworthy: false,
        count: null,
        semantics: "UNAVAILABLE",
        records: []
      };
    }
    var start = Date.parse(window.startUtc);
    var end = Date.parse(window.endUtc);
    var stored = sorted(records).filter(function (record) {
      var instant = recordTime(record);
      return instant >= start && instant <= end && Boolean(recordId(record));
    });
    return {
      trustworthy: true,
      count: stored.length,
      semantics: "DETECTION_ONLY",
      records: stored.map(function (record) {
        return {
          timestamp: new Date(recordTime(record)).toISOString(),
          source: "STORED"
        };
      })
    };
  }

  var REASONS = Object.freeze({
    BOUNDARY_MISSING: "An exact native boundary value was not returned.",
    BOUNDARY_MALFORMED: "An exact native boundary value was malformed.",
    BOUNDARY_CONFLICT: "Conflicting native values were returned at one boundary.",
    COUNTER_DECREASED: "The native engine-hours counter decreased in this window.",
    ENDING_METER_NOT_ESTABLISHED: "Unable to establish the ending meter.",
    ENGINE_OPERATION_OBSERVED: "Unable to establish the ending meter because later engine operation was observed.",
    ENGINE_STATE_COVERAGE_INCOMPLETE: "Unable to establish the ending meter because complete engine-state evidence was not available.",
    ENGINE_STATE_EVIDENCE_MALFORMED: "Unable to establish the ending meter because engine-state evidence was invalid.",
    ENGINE_STATE_EVIDENCE_CONFLICT: "Unable to establish the ending meter because engine-state evidence conflicted.",
    COMMUNICATION_EVIDENCE_MISSING: "Unable to establish the ending meter because later device communication was not observed.",
    COMMUNICATION_COVERAGE_INCOMPLETE: "Unable to establish the ending meter because parked-device communication had an excessive gap.",
    METER_ADJUSTMENT_AMBIGUITY: "Unable to establish the ending meter because a later meter adjustment was detected.",
    METER_HISTORY_AMBIGUITY: "Unable to establish the ending meter because the stored meter history was ambiguous."
  });

  var REVIEW_REASONS = Object.freeze([
    "BOUNDARY_MALFORMED",
    "BOUNDARY_CONFLICT",
    "COUNTER_DECREASED",
    "ENGINE_STATE_EVIDENCE_MALFORMED",
    "ENGINE_STATE_EVIDENCE_CONFLICT",
    "METER_ADJUSTMENT_AMBIGUITY",
    "METER_HISTORY_AMBIGUITY"
  ]);

  function carriedEnd(begin, data, adjustment, window) {
    var latest = latestStoredReading(data, window.endUtc);
    if (!latest) {
      return { ok: false, reasonCode: "ENDING_METER_NOT_ESTABLISHED" };
    }
    var evidence = data && data.engineHoursCarryForward
      && data.engineHoursCarryForward.operationEvidence;
    if (!evidence || evidence.startUtc !== latest.timestamp
      || evidence.endUtc !== window.endUtc) {
      return { ok: false, reasonCode: "ENGINE_STATE_COVERAGE_INCOMPLETE" };
    }
    if (!evidence.trustworthy || evidence.contradictory) {
      return {
        ok: false,
        reasonCode: evidence.reasonCode || "ENGINE_STATE_COVERAGE_INCOMPLETE"
      };
    }
    if (!evidence.zeroOperation) {
      return { ok: false, reasonCode: evidence.reasonCode || "ENGINE_OPERATION_OBSERVED" };
    }
    if (adjustment.trustworthy && sorted(data && data.engineHoursAdjustment).some(function (record) {
      var time = recordTime(record);
      return Boolean(recordId(record)) && time >= Date.parse(latest.timestamp)
        && time <= Date.parse(window.endUtc);
    })) {
      return { ok: false, reasonCode: "METER_ADJUSTMENT_AMBIGUITY" };
    }
    if (meterHistoryAmbiguous(
      data && data.engineHours, window.startUtc, latest.timestamp
    )) {
      return { ok: false, reasonCode: "METER_HISTORY_AMBIGUITY" };
    }
    if (latest.rawSeconds < begin.rawSeconds) {
      return { ok: false, reasonCode: "COUNTER_DECREASED" };
    }
    return {
      ok: true,
      timestamp: window.endUtc,
      recordedAt: latest.timestamp,
      rawSeconds: latest.rawSeconds,
      hours: latest.hours,
      source: "CARRIED_FORWARD",
      provenance: evidence.shutdownBoundaryQualified
        ? "CARRIED_FORWARD_FINAL_SHUTDOWN"
        : "CARRIED_FORWARD_NO_ENGINE_OPERATION",
      storedReading: latest,
      evidence: evidence
    };
  }

  function unitReport(device, data, operatingUnit, window) {
    var begin = exactBoundary(data && data.engineHours, window.startUtc);
    var end = exactBoundary(data && data.engineHours, window.endUtc);
    var adjustment = adjustmentEvidence(
      data && data.engineHoursAdjustment,
      window,
      data && data.engineHoursAdjustmentTrustworthy
    );
    if (begin.ok && !end.ok && end.reasonCode === "BOUNDARY_MISSING") {
      end = carriedEnd(begin, data, adjustment, window);
    }
    var reasonCode = !begin.ok ? begin.reasonCode : !end.ok ? end.reasonCode : null;
    if (!reasonCode && end.rawSeconds < begin.rawSeconds) {
      reasonCode = "COUNTER_DECREASED";
    }
    var hoursUsed = reasonCode ? null : end.hours - begin.hours;
    return {
      deviceId: device.deviceId,
      displayName: device.displayName,
      status: !reasonCode ? "AVAILABLE"
        : REVIEW_REASONS.indexOf(reasonCode) !== -1 ? "REVIEW_REQUIRED" : "UNAVAILABLE",
      reasonCode: reasonCode,
      reason: reasonCode ? REASONS[reasonCode] : null,
      begin: begin.ok ? begin : null,
      end: end.ok ? end : null,
      beginProvenance: begin.ok ? begin.provenance : "UNAVAILABLE",
      endProvenance: end.ok ? end.provenance : "UNAVAILABLE",
      hoursUsed: Number.isFinite(hoursUsed) && hoursUsed >= 0 ? hoursUsed : null,
      engineRunningMinutes: operatingUnit
        && Number.isFinite(operatingUnit.engineRunningMinutes)
        ? operatingUnit.engineRunningMinutes : null,
      adjustment: adjustment
    };
  }

  function build(devices, byDevice, units, window) {
    var operatingByDevice = new Map((units || []).map(function (unit) {
      return [unit.deviceId, unit];
    }));
    var rows = (devices || []).map(function (device) {
      return unitReport(
        device,
        byDevice.get(device.deviceId) || {},
        operatingByDevice.get(device.deviceId),
        window
      );
    }).sort(function (left, right) {
      return left.displayName.localeCompare(right.displayName);
    });
    var valid = rows.filter(function (row) { return Number.isFinite(row.hoursUsed); });
    var unavailable = rows.filter(function (row) { return row.status === "UNAVAILABLE"; });
    var review = rows.filter(function (row) { return row.status === "REVIEW_REQUIRED"; });
    return {
      definitionVersion: 1,
      diagnosticId: "DiagnosticEngineHoursId",
      adjustmentDiagnosticId: "DiagnosticEngineHoursAdjustmentId",
      adjustmentSemantics: "Detection only; no adjustment amount is inferred.",
      rows: rows,
      summary: {
        totalUnits: rows.length,
        reportingUnits: valid.length,
        validHoursTotal: valid.length ? valid.reduce(function (total, row) {
          return total + row.hoursUsed;
        }, 0) : null,
        adjustmentCount: rows.every(function (row) {
          return row.adjustment.trustworthy;
        }) ? rows.reduce(function (total, row) {
            return total + row.adjustment.count;
          }, 0) : null,
        unavailableUnits: unavailable.length,
        reviewUnits: review.length
      }
    };
  }

  function calculatedUnitReport(device, data, window) {
    var begin = calculatedBoundary(
      data && data.calculatedEngineHoursBegin, window.startUtc
    );
    var end = calculatedBoundary(
      data && data.calculatedEngineHoursEnd, window.endUtc
    );
    var reasonCode = !begin.ok ? begin.reasonCode : !end.ok ? end.reasonCode : null;
    if (!reasonCode && end.rawSeconds < begin.rawSeconds) {
      reasonCode = "COUNTER_DECREASED";
    }
    var hoursUsed = reasonCode ? null : end.hours - begin.hours;
    return {
      deviceId: device.deviceId,
      displayName: device.displayName,
      status: !reasonCode ? "AVAILABLE"
        : REVIEW_REASONS.indexOf(reasonCode) !== -1 ? "REVIEW_REQUIRED" : "UNAVAILABLE",
      reasonCode: reasonCode,
      reason: reasonCode ? REASONS[reasonCode] : null,
      begin: begin.ok ? begin : null,
      end: end.ok ? end : null,
      hoursUsed: Number.isFinite(hoursUsed) && hoursUsed >= 0 ? hoursUsed : null,
      meterSource: "MyGeotab Calculated Engine Hours"
    };
  }

  function buildCalculated(devices, byDevice, window) {
    var rows = (devices || []).map(function (device) {
      return calculatedUnitReport(
        device, byDevice.get(device.deviceId) || {}, window
      );
    }).sort(function (left, right) {
      return left.displayName.localeCompare(right.displayName);
    });
    var valid = rows.filter(function (row) { return Number.isFinite(row.hoursUsed); });
    var review = rows.filter(function (row) { return row.status === "REVIEW_REQUIRED"; });
    return {
      definitionVersion: 2,
      meterAuthority: "MYGEOTAB_CALCULATED_ENGINE_HOURS",
      rows: rows,
      summary: {
        totalUnits: rows.length,
        reportingUnits: valid.length,
        notReportedUnits: rows.length - valid.length,
        validHoursTotal: valid.length ? valid.reduce(function (total, row) {
          return total + row.hoursUsed;
        }, 0) : null,
        unavailableUnits: rows.length - valid.length - review.length,
        reviewUnits: review.length
      }
    };
  }

  return {
    REASONS: REASONS,
    adjustmentEvidence: adjustmentEvidence,
    build: build,
    buildCalculated: buildCalculated,
    calculatedBoundary: calculatedBoundary,
    calculatedUnitReport: calculatedUnitReport,
    cumulativeDeltaHours: cumulativeDeltaHours,
    exactBoundary: exactBoundary,
    latestStoredReading: latestStoredReading,
    secondsToHours: secondsToHours,
    unitReport: unitReport
  };
}));
