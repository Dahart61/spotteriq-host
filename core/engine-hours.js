(function (root, factory) {
  "use strict";

  var assignments = typeof module === "object" && module.exports
    ? require("./asset-assignments")
    : root.SIQ_ASSET_ASSIGNMENTS;
  var identity = typeof module === "object" && module.exports
    ? require("./asset-identity")
    : root.SIQ_ASSET_IDENTITY;
  var api = factory(assignments, identity);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_ENGINE_HOURS = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  assignments,
  identity
) {
  "use strict";

  var EXCEPTION_CODES = Object.freeze([
    "MISSING_OPENING_READING",
    "MISSING_CLOSING_READING",
    "READING_OUTSIDE_TOLERANCE",
    "METER_DECREASE",
    "METER_RESET_OR_REPLACEMENT",
    "DEVICE_ASSIGNMENT_GAP",
    "DEVICE_ASSIGNMENT_OVERLAP",
    "FACILITY_ASSIGNMENT_GAP",
    "FACILITY_ASSIGNMENT_OVERLAP",
    "USAGE_WHILE_STANDBY",
    "USAGE_WHILE_OUT_FOR_REPAIR",
    "USAGE_WITHOUT_DEPLOYMENT",
    "DEPLOYMENT_WITHOUT_USAGE",
    "USAGE_BEFORE_LEASE_START",
    "USAGE_AFTER_LEASE_END",
    "GROUP_ASSIGNMENT_MISMATCH",
    "ASSET_NOT_ACCESSIBLE",
    "LARGE_MONTH_OVER_MONTH_VARIANCE",
    "MANUAL_ADJUSTMENT_PENDING",
    "INVALID_COMMERCIAL_TERMS"
  ]);

  function exception(code, message, details) {
    return {
      code: code,
      message: message,
      details: details || null
    };
  }

  function validReading(reading) {
    return reading
      && Number.isFinite(Date.parse(reading.timestamp))
      && Number.isFinite(reading.cumulativeEngineHours)
      && typeof reading.myGeotabDeviceId === "string"
      && reading.myGeotabDeviceId.length > 0;
  }

  function normalizeReadings(readings, profile) {
    return (readings || []).filter(validReading).map(function (reading) {
      var device = identity.resolveDeviceAssignment(profile, reading.timestamp);
      var facility = assignments.resolveAssignment(profile, reading.timestamp);
      return Object.assign({}, reading, {
        assetId: profile.assetId,
        vin: profile.vin || null,
        fleetsourceUnitNumber: profile.fleetsourceUnitNumber,
        customerUnitNumber: identity.resolveCustomerUnitNumber(profile, reading.timestamp),
        operatingFacilityId: facility ? facility.facilityId : null,
        billingFacilityId: facility ? facility.billingFacilityId : null,
        diagnosticSource: reading.diagnosticSource || "MyGeotab engine hours",
        sourceState: reading.sourceState || "raw",
        deviceAssignmentId: device ? device.assignmentId : null
      });
    }).sort(function (left, right) {
      return Date.parse(left.timestamp) - Date.parse(right.timestamp);
    });
  }

  function nearest(readings, boundary, toleranceMs, side) {
    var target = Date.parse(boundary);
    var eligible = readings.filter(function (reading) {
      var value = Date.parse(reading.timestamp);
      return side === "opening"
        ? value >= target && value <= target + toleranceMs
        : value <= target && value >= target - toleranceMs;
    });
    eligible.sort(function (left, right) {
      var leftDistance = Math.abs(Date.parse(left.timestamp) - target);
      var rightDistance = Math.abs(Date.parse(right.timestamp) - target);
      return leftDistance - rightDistance
        || Date.parse(left.timestamp) - Date.parse(right.timestamp);
    });
    return eligible[0] || null;
  }

  function statusExceptions(readings, profile, periodStart, periodEnd) {
    var codes = [];
    var relevant = (profile.facilityAssignments || []).filter(function (assignment) {
      var start = Date.parse(assignment.effectiveFrom);
      var end = assignment.effectiveThrough
        ? Date.parse(assignment.effectiveThrough)
        : Infinity;
      return start < Date.parse(periodEnd) && end > Date.parse(periodStart);
    });
    if (!relevant.length && readings.length > 1) {
      codes.push(exception("FACILITY_ASSIGNMENT_GAP",
        "Engine-hour usage has no active facility assignment."));
      codes.push(exception("USAGE_WITHOUT_DEPLOYMENT",
        "Engine-hour usage occurred without an active deployment."));
    }
    relevant.forEach(function (assignment) {
      if (assignment.operationalStatus === "STANDBY") {
        codes.push(exception("USAGE_WHILE_STANDBY",
          "Engine-hour usage occurred while the asset was marked Standby."));
      }
      if (assignment.operationalStatus === "OUT_FOR_REPAIR"
        || assignment.operationalStatus === "MAJOR_REPAIR") {
        codes.push(exception("USAGE_WHILE_OUT_FOR_REPAIR",
          "Engine-hour usage occurred while the asset was out for repair."));
      }
    });
    return codes;
  }

  function calculateUsage(input) {
    var profile = input.profile;
    var toleranceMs = Number.isFinite(input.boundaryToleranceMs)
      ? input.boundaryToleranceMs
      : 86400000;
    var periodStart = input.periodStart;
    var periodEnd = input.periodEnd;
    var readings = normalizeReadings(input.readings, profile);
    var exceptions = [];
    var opening = nearest(readings, periodStart, toleranceMs, "opening");
    var closing = nearest(readings, periodEnd, toleranceMs, "closing");

    if (!opening) {
      exceptions.push(exception("MISSING_OPENING_READING",
        "No valid opening engine-hour reading is available."));
    }
    if (!closing) {
      exceptions.push(exception("MISSING_CLOSING_READING",
        "No valid closing engine-hour reading is available."));
    }
    if ((!opening || !closing) && readings.length) {
      exceptions.push(exception("READING_OUTSIDE_TOLERANCE",
        "A boundary reading is outside the configured tolerance."));
    }

    var grossUsage = null;
    var segments = [];
    if (opening && closing && Date.parse(opening.timestamp) <= Date.parse(closing.timestamp)) {
      var between = readings.filter(function (reading) {
        return Date.parse(reading.timestamp) >= Date.parse(opening.timestamp)
          && Date.parse(reading.timestamp) <= Date.parse(closing.timestamp);
      });
      var current = null;
      between.forEach(function (reading) {
        if (!current || current.myGeotabDeviceId !== reading.myGeotabDeviceId) {
          current = {
            myGeotabDeviceId: reading.myGeotabDeviceId,
            opening: reading,
            closing: reading
          };
          segments.push(current);
        } else {
          current.closing = reading;
        }
        if (!reading.deviceAssignmentId) {
          exceptions.push(exception("DEVICE_ASSIGNMENT_GAP",
            "Reading is not covered by an effective device assignment.", {
              timestamp: reading.timestamp
            }));
        }
        if (!reading.operatingFacilityId) {
          exceptions.push(exception("FACILITY_ASSIGNMENT_GAP",
            "Reading is not covered by an effective facility assignment.", {
              timestamp: reading.timestamp
            }));
        }
      });
      grossUsage = segments.reduce(function (total, segment) {
        return total + (
          segment.closing.cumulativeEngineHours
          - segment.opening.cumulativeEngineHours
        );
      }, 0);
      if (segments.some(function (segment) {
        return segment.closing.cumulativeEngineHours
          < segment.opening.cumulativeEngineHours;
      })) {
        exceptions.push(exception("METER_DECREASE",
          "A meter segment closes below its opening engine hours."));
      }
      if (segments.length > 1) {
        var continuity = (input.approvedAdjustments || []).some(function (adjustment) {
          return adjustment.approved === true
            && adjustment.type === "METER_CONTINUITY";
        });
        if (!continuity) {
          exceptions.push(exception("METER_RESET_OR_REPLACEMENT",
            "A device or meter change requires an explicit continuity adjustment."));
        }
      }
      exceptions = exceptions.concat(statusExceptions(
        between, profile, periodStart, periodEnd
      ));
    }

    var seen = new Set();
    exceptions = exceptions.filter(function (entry) {
      var key = entry.code + "::" + JSON.stringify(entry.details);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    return {
      assetId: profile.assetId,
      periodStart: periodStart,
      periodEnd: periodEnd,
      openingReading: opening,
      closingReading: closing,
      grossUsage: grossUsage,
      segments: segments,
      rawReadings: readings,
      exceptions: exceptions,
      estimationsUsed: false
    };
  }

  return {
    EXCEPTION_CODES: EXCEPTION_CODES.slice(),
    calculateUsage: calculateUsage,
    normalizeReadings: normalizeReadings
  };
}));
