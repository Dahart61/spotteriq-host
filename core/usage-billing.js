(function (root, factory) {
  "use strict";

  var engineHours = typeof module === "object" && module.exports
    ? require("./engine-hours")
    : root.SIQ_ENGINE_HOURS;
  var assignments = typeof module === "object" && module.exports
    ? require("./asset-assignments")
    : root.SIQ_ASSET_ASSIGNMENTS;
  var identity = typeof module === "object" && module.exports
    ? require("./asset-identity")
    : root.SIQ_ASSET_IDENTITY;
  var api = factory(engineHours, assignments, identity);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_USAGE_BILLING = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  engineHours,
  assignments,
  identity
) {
  "use strict";

  var CLOSE_STATES = Object.freeze([
    "OPEN",
    "DRAFT_RECONCILIATION",
    "FLEETSOURCE_REVIEWED",
    "CUSTOMER_STATEMENT_ISSUED",
    "FINALIZED",
    "REOPENED"
  ]);

  function exception(code, message) {
    return { code: code, message: message, details: null };
  }

  function latestStart(values) {
    return new Date(Math.max.apply(null, values.map(Date.parse))).toISOString();
  }

  function earliestEnd(values) {
    return new Date(Math.min.apply(null, values.map(Date.parse))).toISOString();
  }

  function billingWindow(terms, periodStart, periodEnd) {
    var exceptions = [];
    var starts = [periodStart];
    var ends = [periodEnd];
    if (!terms || typeof terms !== "object") {
      return {
        ok: false,
        start: periodStart,
        end: periodEnd,
        exceptions: [exception("INVALID_COMMERCIAL_TERMS",
          "Commercial terms are missing.")]
      };
    }
    if (terms.leaseStartDate) {
      starts.push(terms.leaseStartDate);
    }
    if (terms.billingStartDate) {
      starts.push(terms.billingStartDate);
    }
    if (terms.leaseEndDate) {
      ends.push(terms.leaseEndDate);
    }
    if (terms.billingEndDate) {
      ends.push(terms.billingEndDate);
    }
    var start = latestStart(starts);
    var end = earliestEnd(ends);
    if (Date.parse(start) >= Date.parse(end)) {
      exceptions.push(exception("INVALID_COMMERCIAL_TERMS",
        "Lease and billing dates do not overlap the billing period."));
    }
    if (terms.leaseStartDate && Date.parse(periodStart) < Date.parse(terms.leaseStartDate)) {
      exceptions.push(exception("USAGE_BEFORE_LEASE_START",
        "Usage before lease start is excluded from billing."));
    }
    if (terms.leaseEndDate && Date.parse(periodEnd) > Date.parse(terms.leaseEndDate)) {
      exceptions.push(exception("USAGE_AFTER_LEASE_END",
        "Usage after lease end is excluded from billing."));
    }
    return {
      ok: exceptions.every(function (entry) {
        return entry.code !== "INVALID_COMMERCIAL_TERMS";
      }),
      start: start,
      end: end,
      partial: start !== periodStart || end !== periodEnd,
      exceptions: exceptions
    };
  }

  function validateAdjustments(adjustments) {
    var exceptions = [];
    (adjustments || []).forEach(function (adjustment) {
      if (!Number.isFinite(adjustment.hours) || !adjustment.reason) {
        exceptions.push(exception("MANUAL_ADJUSTMENT_PENDING",
          "Every adjustment requires finite hours and a reason."));
      } else if (adjustment.approved !== true) {
        exceptions.push(exception("MANUAL_ADJUSTMENT_PENDING",
          "Manual adjustment requires approval."));
      }
    });
    return exceptions;
  }

  function calculateAssetUsage(input) {
    var profile = input.profile;
    if (identity.commercialConfigurationStatus(profile) !== "CONFIGURED") {
      return {
        assetId: profile.assetId,
        customerUnitNumber: identity.resolveCustomerUnitNumber(
          profile, input.periodStart
        ),
        fleetsourceUnitNumber: profile.fleetsourceUnitNumber,
        vin: profile.vin || null,
        assetRole: profile.role,
        commercialConfigurationStatus: "NOT_CONFIGURED",
        leaseStart: null,
        billingPeriod: null,
        operatingFacility: null,
        billingFacility: null,
        beginningEngineHours: null,
        beginningReadingTimestamp: null,
        endingEngineHours: null,
        endingReadingTimestamp: null,
        grossEngineHourUsage: null,
        adjustments: [],
        adjustmentHours: null,
        adjustmentReasons: [],
        finalBillableHours: null,
        rateCode: null,
        hourlyRate: null,
        calculatedCharge: null,
        assignmentChangesDuringPeriod: [],
        exceptionFlags: [exception(
          "COMMERCIAL_CONFIGURATION_NOT_CONFIGURED",
          "Commercial and billing reporting is unavailable for this asset."
        )],
        reviewStatus: "UNAVAILABLE",
        rawReadings: [],
        deviceSegments: [],
        estimationsUsed: false
      };
    }
    var terms = profile.commercialTerms;
    var window = billingWindow(terms, input.periodStart, input.periodEnd);
    var meter = engineHours.calculateUsage({
      profile: profile,
      readings: input.readings,
      periodStart: window.start,
      periodEnd: window.end,
      boundaryToleranceMs: input.boundaryToleranceMs,
      approvedAdjustments: input.adjustments
    });
    var exceptions = window.exceptions.concat(meter.exceptions)
      .concat(validateAdjustments(input.adjustments));
    var approved = (input.adjustments || []).filter(function (adjustment) {
      return adjustment.approved === true
        && Number.isFinite(adjustment.hours)
        && Boolean(adjustment.reason);
    });
    var adjustmentHours = approved.reduce(function (total, adjustment) {
      return total + adjustment.hours;
    }, 0);
    var billable = meter.grossUsage;
    if (billable !== null && billable >= 0) {
      billable += adjustmentHours;
      if (Number.isFinite(terms.minimumBillableHours)) {
        billable = Math.max(billable, terms.minimumBillableHours);
      }
      if (Number.isFinite(terms.maximumBillableHours)) {
        billable = Math.min(billable, terms.maximumBillableHours);
      }
      if (terms.billingMode === "NON_BILLABLE") {
        billable = 0;
      }
    } else {
      billable = null;
    }
    if (exceptions.some(function (entry) {
      return [
        "MISSING_OPENING_READING",
        "MISSING_CLOSING_READING",
        "METER_DECREASE",
        "METER_RESET_OR_REPLACEMENT",
        "INVALID_COMMERCIAL_TERMS"
      ].indexOf(entry.code) !== -1;
    })) {
      billable = null;
    }
    var currentAssignment = assignments.resolveAssignment(profile, window.end);
    return {
      assetId: profile.assetId,
      customerUnitNumber: identity.resolveCustomerUnitNumber(profile, window.start),
      fleetsourceUnitNumber: profile.fleetsourceUnitNumber,
      vin: profile.vin || null,
      assetRole: profile.role,
      commercialConfigurationStatus: "CONFIGURED",
      leaseStart: terms.leaseStartDate || null,
      billingPeriod: { start: window.start, end: window.end, partial: window.partial },
      operatingFacility: currentAssignment ? currentAssignment.facilityId : null,
      billingFacility: currentAssignment ? currentAssignment.billingFacilityId : null,
      beginningEngineHours: meter.openingReading
        ? meter.openingReading.cumulativeEngineHours : null,
      beginningReadingTimestamp: meter.openingReading
        ? meter.openingReading.timestamp : null,
      endingEngineHours: meter.closingReading
        ? meter.closingReading.cumulativeEngineHours : null,
      endingReadingTimestamp: meter.closingReading
        ? meter.closingReading.timestamp : null,
      grossEngineHourUsage: meter.grossUsage,
      adjustments: approved.map(function (entry) { return Object.assign({}, entry); }),
      adjustmentHours: adjustmentHours,
      adjustmentReasons: approved.map(function (entry) { return entry.reason; }),
      finalBillableHours: billable,
      rateCode: terms.rateCode || null,
      hourlyRate: Number.isFinite(terms.engineHourRate) ? terms.engineHourRate : null,
      calculatedCharge: billable !== null && Number.isFinite(terms.engineHourRate)
        ? billable * terms.engineHourRate : null,
      assignmentChangesDuringPeriod: assignments.assignmentChanges(
        profile, window.start, window.end
      ),
      exceptionFlags: exceptions,
      reviewStatus: exceptions.length ? "REVIEW_REQUIRED" : "READY",
      rawReadings: meter.rawReadings,
      deviceSegments: meter.segments,
      estimationsUsed: false
    };
  }

  function summarize(input) {
    var readingsByAsset = input.readingsByAsset || {};
    var adjustmentsByAsset = input.adjustmentsByAsset || {};
    var rows = (input.profiles || []).map(function (profile) {
      return calculateAssetUsage({
        profile: profile,
        readings: readingsByAsset[profile.assetId] || [],
        adjustments: adjustmentsByAsset[profile.assetId] || [],
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        boundaryToleranceMs: input.boundaryToleranceMs
      });
    });
    function sum(key) {
      return rows.reduce(function (total, row) {
        return total + (Number.isFinite(row[key]) ? row[key] : 0);
      }, 0);
    }
    return {
      state: input.state || "OPEN",
      version: input.version || 1,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      rows: rows,
      totals: {
        totalGrossHours: sum("grossEngineHourUsage"),
        totalAdjustments: sum("adjustmentHours"),
        totalBillableHours: sum("finalBillableHours"),
        totalCalculatedCharges: sum("calculatedCharge"),
        assetCount: rows.length,
        exceptionCount: rows.filter(function (row) {
          return row.exceptionFlags.length > 0;
        }).length,
        onsiteSpareBillableHours: rows.filter(function (row) {
          return row.assetRole === "ONSITE_SPARE";
        }).reduce(function (total, row) {
          return total + (Number.isFinite(row.finalBillableHours)
            ? row.finalBillableHours : 0);
        }, 0),
        rentalBillableHours: rows.filter(function (row) {
          return row.assetRole === "RENTAL";
        }).reduce(function (total, row) {
          return total + (Number.isFinite(row.finalBillableHours)
            ? row.finalBillableHours : 0);
        }, 0)
      }
    };
  }

  function customerStatement(summary, options) {
    var showRates = options && options.showRates === true;
    return {
      view: "CUSTOMER_USAGE_STATEMENT",
      periodStart: summary.periodStart,
      periodEnd: summary.periodEnd,
      rows: summary.rows.map(function (row) {
        var result = {
          customerUnitNumber: row.customerUnitNumber,
          fleetsourceUnitNumber: row.fleetsourceUnitNumber,
          assetRole: row.assetRole,
          leaseStart: row.billingPeriod && row.billingPeriod.partial
            ? row.leaseStart : null,
          beginningEngineHours: row.beginningEngineHours,
          endingEngineHours: row.endingEngineHours,
          grossEngineHourUsage: row.grossEngineHourUsage,
          adjustments: row.adjustmentHours,
          finalBillableHours: row.finalBillableHours,
          notes: row.exceptionFlags.map(function (entry) { return entry.message; })
        };
        if (showRates) {
          result.rateCode = row.rateCode;
          result.hourlyRate = row.hourlyRate;
          result.calculatedCharge = row.calculatedCharge;
        }
        return result;
      }),
      totals: Object.assign({}, summary.totals)
    };
  }

  function fleetsourceReconciliation(summary) {
    return {
      view: "FLEETSOURCE_BILLING_RECONCILIATION",
      state: summary.state,
      version: summary.version,
      periodStart: summary.periodStart,
      periodEnd: summary.periodEnd,
      rows: summary.rows.map(function (row) {
        return Object.assign({}, row, {
          invoiceAccountingReference: null,
          priorPeriodComparison: null,
          approvalState: row.reviewStatus
        });
      }),
      totals: Object.assign({}, summary.totals)
    };
  }

  function transition(summary, nextState, metadata) {
    if (CLOSE_STATES.indexOf(nextState) === -1) {
      throw new RangeError("Unsupported monthly close state");
    }
    if (summary.state === "FINALIZED") {
      throw new Error("Finalized summaries are immutable; reopen first");
    }
    var result = Object.assign({}, summary, {
      state: nextState,
      reviewedBy: metadata && metadata.reviewedBy || summary.reviewedBy || null,
      reviewedAt: metadata && metadata.reviewedAt || summary.reviewedAt || null
    });
    return nextState === "FINALIZED" ? deepFreeze(result) : result;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
      return value;
    }
    Object.keys(value).forEach(function (key) {
      deepFreeze(value[key]);
    });
    return Object.freeze(value);
  }

  function reopen(summary, reason, metadata) {
    if (summary.state !== "FINALIZED") {
      throw new Error("Only a finalized summary may be reopened");
    }
    if (!reason || !String(reason).trim()) {
      throw new Error("Reopening requires a reason");
    }
    return Object.assign({}, summary, {
      state: "REOPENED",
      version: (summary.version || 1) + 1,
      reopenedFromVersion: summary.version || 1,
      reopenReason: reason,
      reopenedBy: metadata && metadata.reopenedBy || null,
      reopenedAt: metadata && metadata.reopenedAt || null
    });
  }

  return {
    CLOSE_STATES: CLOSE_STATES.slice(),
    billingWindow: billingWindow,
    calculateAssetUsage: calculateAssetUsage,
    customerStatement: customerStatement,
    fleetsourceReconciliation: fleetsourceReconciliation,
    reopen: reopen,
    summarize: summarize,
    transition: transition,
    validateAdjustments: validateAdjustments
  };
}));
