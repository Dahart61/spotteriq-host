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
      source: stored ? "STORED" : "INTERPOLATED"
    };
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
    COUNTER_DECREASED: "The native engine-hours counter decreased in this window."
  });

  function unitReport(device, data, operatingUnit, window) {
    var begin = exactBoundary(data && data.engineHours, window.startUtc);
    var end = exactBoundary(data && data.engineHours, window.endUtc);
    var adjustment = adjustmentEvidence(
      data && data.engineHoursAdjustment,
      window,
      data && data.engineHoursAdjustmentTrustworthy
    );
    var reasonCode = !begin.ok ? begin.reasonCode : !end.ok ? end.reasonCode : null;
    if (!reasonCode && end.rawSeconds < begin.rawSeconds) {
      reasonCode = "COUNTER_DECREASED";
    }
    var hoursUsed = reasonCode ? null : end.hours - begin.hours;
    return {
      deviceId: device.deviceId,
      displayName: device.displayName,
      status: reasonCode ? "REVIEW" : "AVAILABLE",
      reasonCode: reasonCode,
      reason: reasonCode ? REASONS[reasonCode] : null,
      begin: begin.ok ? begin : null,
      end: end.ok ? end : null,
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
        reviewUnits: rows.length - valid.length
      }
    };
  }

  return {
    REASONS: REASONS,
    adjustmentEvidence: adjustmentEvidence,
    build: build,
    cumulativeDeltaHours: cumulativeDeltaHours,
    exactBoundary: exactBoundary,
    secondsToHours: secondsToHours,
    unitReport: unitReport
  };
}));
