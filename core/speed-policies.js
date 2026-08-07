(function (root, factory) {
  "use strict";

  var speedEvents = typeof module === "object" && module.exports
    ? require("./speed-events")
    : root.SIQ_SPEED_EVENTS;
  var api = factory(speedEvents);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_SPEED_POLICIES = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (speedEvents) {
  "use strict";

  var LEGACY_NOTICE_CODE = "LEGACY_SPEED_POLICY_EFFECTIVE_FROM_REQUIRED";

  function error(field, code, message) {
    return { field: field, code: code, message: message };
  }

  function object(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function text(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function exactMilliseconds(value) {
    if (!text(value) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
      return null;
    }
    var milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }

  function toSpeedConfiguration(policy) {
    return {
      speedLimitMph: policy.speedLimitMph,
      severeSpeedThresholdMph:
        policy.severeSpeedThresholdMph === undefined
          ? null : policy.severeSpeedThresholdMph,
      minimumReportableEventDurationMs:
        policy.minimumReportableEventDurationMs,
      eventCloseGraceMs: policy.eventCloseGraceMs,
      missingDataPolicy: policy.missingDataPolicy,
      topSpeedMinimumSampleDurationMs:
        policy.topSpeedMinimumSampleDurationMs
    };
  }

  function validateSpeedPolicy(policy, expectedFacilityId) {
    var errors = [];
    if (!object(policy)) {
      return {
        ok: false,
        errors: [error("", "INVALID_SPEED_POLICY",
          "Speed policy must be an object")]
      };
    }
    if (!text(policy.id)) {
      errors.push(error("id", "SPEED_POLICY_ID_REQUIRED",
        "Speed policy id is required"));
    }
    if (!text(policy.facilityId)) {
      errors.push(error("facilityId", "SPEED_POLICY_FACILITY_REQUIRED",
        "Speed policy facilityId is required"));
    } else if (expectedFacilityId && policy.facilityId !== expectedFacilityId) {
      errors.push(error("facilityId", "SPEED_POLICY_FACILITY_MISMATCH",
        "Speed policy facilityId must match the facility record"));
    }
    var fromMs = exactMilliseconds(policy.effectiveFrom);
    var throughMs = policy.effectiveThrough === null
      || policy.effectiveThrough === undefined
      ? Infinity : exactMilliseconds(policy.effectiveThrough);
    if (fromMs === null) {
      errors.push(error("effectiveFrom", "SPEED_POLICY_EFFECTIVE_FROM_REQUIRED",
        "effectiveFrom must be an exact timestamp with a UTC offset"));
    }
    if (throughMs === null) {
      errors.push(error("effectiveThrough", "INVALID_SPEED_POLICY_EFFECTIVE_THROUGH",
        "effectiveThrough must be null or an exact timestamp with a UTC offset"));
    } else if (fromMs !== null && throughMs <= fromMs) {
      errors.push(error("effectiveThrough", "INVALID_SPEED_POLICY_RANGE",
        "effectiveThrough must be after effectiveFrom"));
    }
    var engineResult = speedEvents.validateSpeedConfiguration(
      toSpeedConfiguration(policy)
    );
    (engineResult.errors || []).forEach(function (entry) {
      errors.push(error(entry.field, entry.code, entry.message));
    });
    ["reason", "notes"].forEach(function (key) {
      if (policy[key] !== undefined && policy[key] !== null
        && typeof policy[key] !== "string") {
        errors.push(error(key, "INVALID_SPEED_POLICY_TEXT",
          key + " must be text when supplied"));
      }
    });
    return { ok: errors.length === 0, errors: errors };
  }

  function validateSpeedPolicies(policies, expectedFacilityId) {
    if (!Array.isArray(policies)) {
      return {
        ok: false,
        errors: [error("", "SPEED_POLICIES_ARRAY_REQUIRED",
          "speedPolicies must be an array when supplied")]
      };
    }
    var errors = [];
    var validRanges = [];
    var ids = new Set();
    policies.forEach(function (policy, index) {
      var result = validateSpeedPolicy(policy, expectedFacilityId);
      (result.errors || []).forEach(function (entry) {
        errors.push(error(
          "[" + index + "]" + (entry.field ? "." + entry.field : ""),
          entry.code,
          entry.message
        ));
      });
      if (object(policy) && text(policy.id)) {
        if (ids.has(policy.id)) {
          errors.push(error("[" + index + "].id", "DUPLICATE_SPEED_POLICY_ID",
            "Speed policy IDs must be unique"));
        }
        ids.add(policy.id);
      }
      var fromMs = object(policy) ? exactMilliseconds(policy.effectiveFrom) : null;
      var throughMs = object(policy)
        && (policy.effectiveThrough === null
          || policy.effectiveThrough === undefined)
        ? Infinity
        : object(policy) ? exactMilliseconds(policy.effectiveThrough) : null;
      if (fromMs !== null && throughMs !== null && throughMs > fromMs
        && text(policy.facilityId)) {
        validRanges.push({
          index: index,
          facilityId: policy.facilityId,
          fromMs: fromMs,
          throughMs: throughMs
        });
      }
    });
    validRanges.sort(function (left, right) {
      return left.facilityId.localeCompare(right.facilityId)
        || left.fromMs - right.fromMs
        || left.throughMs - right.throughMs
        || left.index - right.index;
    });
    validRanges.forEach(function (range, index) {
      var prior = validRanges[index - 1];
      if (prior && prior.facilityId === range.facilityId
        && range.fromMs < prior.throughMs) {
        errors.push(error("[" + range.index + "]", "OVERLAPPING_SPEED_POLICIES",
          "Speed policies for one facility may not overlap"));
      }
    });
    return { ok: errors.length === 0, errors: errors };
  }

  function policyAt(policies, facilityId, instant) {
    var timestampMs = instant instanceof Date
      ? instant.getTime() : typeof instant === "number" ? instant : Date.parse(instant);
    if (!Number.isFinite(timestampMs)) {
      throw new TypeError("An exact policy selection timestamp is required");
    }
    var matches = (Array.isArray(policies) ? policies : []).filter(function (policy) {
      var fromMs = exactMilliseconds(policy && policy.effectiveFrom);
      var throughMs = policy && policy.effectiveThrough !== null
        && policy.effectiveThrough !== undefined
        ? exactMilliseconds(policy.effectiveThrough) : Infinity;
      return (!facilityId || policy.facilityId === facilityId)
        && fromMs !== null
        && throughMs !== null
        && fromMs <= timestampMs
        && timestampMs < throughMs;
    }).sort(function (left, right) {
      return Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom)
        || left.id.localeCompare(right.id);
    });
    return matches[0] || null;
  }

  function policyWindows(policies, facilityId, start, end) {
    var startMs = start instanceof Date ? start.getTime() : Date.parse(start);
    var endMs = end instanceof Date ? end.getTime() : Date.parse(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new RangeError("A valid speed-policy analysis range is required");
    }
    var boundaries = [startMs, endMs];
    (Array.isArray(policies) ? policies : []).forEach(function (policy) {
      if (facilityId && policy.facilityId !== facilityId) {
        return;
      }
      var fromMs = exactMilliseconds(policy.effectiveFrom);
      var throughMs = policy.effectiveThrough === null
        || policy.effectiveThrough === undefined
        ? Infinity : exactMilliseconds(policy.effectiveThrough);
      if (fromMs !== null && fromMs > startMs && fromMs < endMs) {
        boundaries.push(fromMs);
      }
      if (throughMs !== null && throughMs > startMs && throughMs < endMs) {
        boundaries.push(throughMs);
      }
    });
    boundaries = Array.from(new Set(boundaries)).sort(function (a, b) {
      return a - b;
    });
    return boundaries.slice(0, -1).map(function (windowStart, index) {
      var windowEnd = boundaries[index + 1];
      var policy = policyAt(policies, facilityId, windowStart);
      return {
        startUtc: new Date(windowStart).toISOString(),
        endUtc: new Date(windowEnd).toISOString(),
        policy: policy,
        policyConfigured: Boolean(policy)
      };
    });
  }

  function clipSpeedEvidence(request, startUtc, endUtc) {
    var startMs = Date.parse(startUtc);
    var endMs = Date.parse(endUtc);
    if (Array.isArray(request.speedIntervals)) {
      return {
        speedIntervals: request.speedIntervals.map(function (interval) {
          var intervalStart = Date.parse(interval.startUtc);
          var intervalEnd = Date.parse(interval.endUtc);
          var clippedStart = Math.max(startMs, intervalStart);
          var clippedEnd = Math.min(endMs, intervalEnd);
          if (clippedEnd <= clippedStart) {
            return null;
          }
          var copy = Object.assign({}, interval, {
            startUtc: new Date(clippedStart).toISOString(),
            endUtc: new Date(clippedEnd).toISOString()
          });
          if (copy.timestamp !== undefined
            && (Date.parse(copy.timestamp) < clippedStart
              || Date.parse(copy.timestamp) >= clippedEnd)) {
            copy.timestamp = copy.startUtc;
          }
          return copy;
        }).filter(Boolean)
      };
    }
    return {
      speedSamples: (Array.isArray(request.speedSamples)
        ? request.speedSamples : []).map(function (sample) {
        var sampleStart = Date.parse(sample.timestamp);
        var sampleEnd = sample.endUtc !== undefined
          ? Date.parse(sample.endUtc)
          : sample.durationMs !== undefined
            ? sampleStart + sample.durationMs : sampleStart;
        if (sampleEnd === sampleStart) {
          return sampleStart >= startMs && sampleStart < endMs
            ? Object.assign({}, sample) : null;
        }
        var clippedStart = Math.max(startMs, sampleStart);
        var clippedEnd = Math.min(endMs, sampleEnd);
        if (clippedEnd <= clippedStart) {
          return null;
        }
        var copy = Object.assign({}, sample, {
          timestamp: new Date(clippedStart).toISOString(),
          endUtc: new Date(clippedEnd).toISOString()
        });
        delete copy.durationMs;
        return copy;
      }).filter(Boolean)
    };
  }

  function independentTopSpeed(request) {
    var startMs = Date.parse(request.startUtc);
    var endMs = Date.parse(request.endUtc);
    var observations = [];
    (request.speedIntervals || []).forEach(function (interval) {
      var intervalStart = Date.parse(interval.startUtc);
      var intervalEnd = Date.parse(interval.endUtc);
      if (interval.valid !== false && interval.stale !== true
        && Number.isFinite(interval.speedMph)
        && intervalEnd > startMs && intervalStart < endMs) {
        observations.push({
          speedMph: interval.speedMph,
          timestamp: interval.timestamp || new Date(
            Math.max(startMs, intervalStart)
          ).toISOString()
        });
      }
    });
    (request.speedSamples || []).forEach(function (sample) {
      var timestampMs = Date.parse(sample.timestamp);
      if (sample.valid !== false && sample.stale !== true
        && Number.isFinite(sample.speedMph)
        && timestampMs >= startMs && timestampMs < endMs) {
        observations.push({
          speedMph: sample.speedMph,
          timestamp: sample.timestamp
        });
      }
    });
    observations.sort(function (left, right) {
      return right.speedMph - left.speedMph
        || Date.parse(left.timestamp) - Date.parse(right.timestamp);
    });
    return observations.length ? {
      available: true,
      topSpeedMph: observations[0].speedMph,
      topSpeedTimestamp: observations[0].timestamp
    } : {
      available: false,
      topSpeedMph: null,
      topSpeedTimestamp: null
    };
  }

  function analyzeSpeedByPolicies(request, policies, facilityId) {
    if (!object(request)) {
      throw new TypeError("A speed analysis request is required");
    }
    var validation = validateSpeedPolicies(policies || [], facilityId);
    if (!validation.ok) {
      throw new RangeError(validation.errors.map(function (entry) {
        return entry.message;
      }).join("; "));
    }
    var windows = policyWindows(
      policies || [],
      facilityId,
      request.startUtc,
      request.endUtc
    ).map(function (window) {
      if (!window.policy) {
        return Object.assign({}, window, {
          analysis: null,
          findings: [{
            code: "SPEED_POLICY_NOT_CONFIGURED",
            category: "policy-availability",
            severity: "information",
            affectedMetrics: [
              "Time Over Speed Limit",
              "Speed-Limit Events",
              "Severe-Speed Events"
            ],
            message: "Speed Policy Not Configured — Time Over Speed Limit Unavailable."
          }]
        });
      }
      var evidence = clipSpeedEvidence(
        request,
        window.startUtc,
        window.endUtc
      );
      var analysis = speedEvents.analyzeSpeedEvents(Object.assign(
        {},
        request,
        evidence,
        {
          startUtc: window.startUtc,
          endUtc: window.endUtc,
          configuration: toSpeedConfiguration(window.policy)
        }
      ));
      return Object.assign({}, window, {
        analysis: analysis,
        findings: analysis.findings
      });
    });
    return {
      deviceId: request.deviceId,
      facilityId: facilityId,
      startUtc: request.startUtc,
      endUtc: request.endUtc,
      topSpeed: independentTopSpeed(request),
      windows: windows,
      complianceAvailable: windows.some(function (window) {
        return window.policyConfigured;
      })
    };
  }

  function legacyPolicy(configuration, facilityId, effectiveFrom) {
    return Object.assign({
      id: text(configuration.policyId)
        ? configuration.policyId : "legacy-speed-configuration",
      facilityId: facilityId,
      effectiveFrom: effectiveFrom,
      effectiveThrough: configuration.effectiveThrough || null,
      reason: configuration.reason || "Schema version 2 compatibility"
    }, toSpeedConfiguration(configuration), {
      sourceRepresentation: "speedConfiguration"
    });
  }

  function normalizeFacilitySpeedPolicy(details, options) {
    var facilityId = details && details.facility && details.facility.id;
    var hasPolicies = Object.prototype.hasOwnProperty.call(
      details || {}, "speedPolicies"
    );
    var hasLegacy = object(details && details.speedConfiguration);
    var notices = [];
    if (hasPolicies) {
      return {
        policies: Array.isArray(details.speedPolicies)
          ? details.speedPolicies.map(function (policy) {
            return Object.assign({}, policy);
          }) : [],
        legacySpeedConfiguration: null,
        notices: notices
      };
    }
    if (!hasLegacy) {
      return {
        policies: [],
        legacySpeedConfiguration: null,
        notices: notices
      };
    }
    var trustedFrom = exactMilliseconds(details.speedConfiguration.effectiveFrom)
      !== null ? details.speedConfiguration.effectiveFrom : null;
    var activationTimestamp = options && options.activationTimestamp;
    var activationMs = exactMilliseconds(activationTimestamp);
    var effectiveFrom = trustedFrom || (
      activationMs === null ? null : new Date(activationMs).toISOString()
    );
    if (!trustedFrom) {
      notices.push({
        code: LEGACY_NOTICE_CODE,
        message: "Legacy speedConfiguration has no historical effectiveFrom; "
          + "it is limited to current and future processing until commissioned "
          + "as an effective-dated speed policy."
      });
    }
    return {
      policies: effectiveFrom
        ? [legacyPolicy(details.speedConfiguration, facilityId, effectiveFrom)]
        : [],
      legacySpeedConfiguration: Object.assign({}, details.speedConfiguration),
      notices: notices
    };
  }

  return {
    LEGACY_NOTICE_CODE: LEGACY_NOTICE_CODE,
    analyzeSpeedByPolicies: analyzeSpeedByPolicies,
    independentTopSpeed: independentTopSpeed,
    normalizeFacilitySpeedPolicy: normalizeFacilitySpeedPolicy,
    policyAt: policyAt,
    policyWindows: policyWindows,
    toSpeedConfiguration: toSpeedConfiguration,
    validateSpeedPolicies: validateSpeedPolicies,
    validateSpeedPolicy: validateSpeedPolicy
  };
}));
