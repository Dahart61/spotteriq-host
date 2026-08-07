(function (root, factory) {
  "use strict";

  var shifts = typeof module === "object" && module.exports
    ? require("./shifts")
    : root.SIQ_SHIFTS;
  var moves = typeof module === "object" && module.exports
    ? require("./moves")
    : root.SIQ_MOVES;
  var speed = typeof module === "object" && module.exports
    ? require("./speed-events")
    : root.SIQ_SPEED_EVENTS;
  var speedPolicies = typeof module === "object" && module.exports
    ? require("./speed-policies")
    : root.SIQ_SPEED_POLICIES;
  var api = factory(shifts, moves, speed, speedPolicies);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_FACILITY_CONFIG = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  shifts,
  moves,
  speed,
  speedPolicies
) {
  "use strict";

  var SCHEMA_VERSION = 2;
  var RECORD_TYPE = "spotteriq-facility-config";
  var MAX_DETAILS_LENGTH = 10000;
  var CREDENTIAL_KEY_PATTERN = /^(?:user(?:name)?|password|passphrase|api(?:key)?|accessToken|refreshToken|token|session|credentials?|secret|serviceAccount)$/i;
  var RESERVED_KEY_PATTERN = /^geotab/i;

  function finding(path, code, message) {
    return { path: path, code: code, message: message };
  }

  function object(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function text(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function validTimeZone(value) {
    if (!text(value)) {
      return false;
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
      return true;
    } catch (error) {
      return false;
    }
  }

  function scanPropertyNames(value, path, findings) {
    if (!value || typeof value !== "object") {
      return;
    }
    Object.keys(value).forEach(function (key) {
      var childPath = path ? path + "." + key : key;
      if (CREDENTIAL_KEY_PATTERN.test(key.replace(/[-_\s]/g, ""))) {
        findings.push(finding(childPath, "CREDENTIAL_PROPERTY",
          "Credential-like property names are not allowed"));
      }
      if (RESERVED_KEY_PATTERN.test(key)) {
        findings.push(finding(childPath, "RESERVED_PROPERTY",
          "Property names beginning with geotab are reserved"));
      }
      scanPropertyNames(value[key], childPath, findings);
    });
  }

  function engineFindings(target, prefix, result, code) {
    (result && result.errors || []).forEach(function (entry) {
      target.push(finding(prefix + (entry.field ? "." + entry.field : ""),
        code, entry.message || String(entry)));
    });
  }

  function positiveObject(value, path, keys, findings) {
    if (!object(value)) {
      findings.push(finding(path, "REQUIRED_OBJECT", path + " is required"));
      return;
    }
    keys.forEach(function (key) {
      if (!Number.isFinite(value[key]) || value[key] <= 0) {
        findings.push(finding(path + "." + key, "POSITIVE_INTERVAL_REQUIRED",
          key + " must be a positive number"));
      }
    });
  }

  function validateFacilityDetails(details) {
    var findings = [];
    if (!object(details)) {
      return {
        ok: false,
        findings: [finding("", "DETAILS_REQUIRED",
          "AddInData Details must be an object")],
        serializedLength: 0
      };
    }
    var serialized = "";
    try {
      serialized = JSON.stringify(details);
    } catch (error) {
      findings.push(finding("", "DETAILS_NOT_SERIALIZABLE",
        "AddInData Details must be serializable JSON"));
    }
    if (serialized.length > MAX_DETAILS_LENGTH) {
      findings.push(finding("", "DETAILS_TOO_LARGE",
        "Serialized AddInData Details must not exceed 10,000 characters"));
    }
    scanPropertyNames(details, "", findings);
    if (details.schemaVersion === 1) {
      findings.push(finding("schemaVersion", "LEGACY_SCHEMA_VERSION",
        "Schema version 1 is not supported; commission facility and asset-profile version 2 records"));
    } else if (details.schemaVersion !== SCHEMA_VERSION) {
      findings.push(finding("schemaVersion", "UNSUPPORTED_SCHEMA_VERSION",
        "Supported schemaVersion is 2"));
    }
    if (details.recordType !== RECORD_TYPE) {
      findings.push(finding("recordType", "INVALID_RECORD_TYPE",
        "recordType must be " + RECORD_TYPE));
    }
    [
      "customers",
      "facilities",
      "assetEnrollments",
      "enrolledDeviceIds",
      "diagnosticMappings",
      "assets"
    ].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(details, key)) {
        findings.push(finding(key, "EMBEDDED_ASSET_DATA_NOT_ALLOWED",
          "Facility records may not contain asset lists or per-device mappings"));
      }
    });
    if (!object(details.customer) || !text(details.customer.id)
      || !text(details.customer.displayName)) {
      findings.push(finding("customer", "CUSTOMER_IDENTITY_REQUIRED",
        "Customer id and displayName are required"));
    }
    if (!object(details.facility) || !text(details.facility.id)
      || !text(details.facility.displayName)) {
      findings.push(finding("facility", "FACILITY_IDENTITY_REQUIRED",
        "Facility id and displayName are required"));
    }
    if (!object(details.facility) || !text(details.facility.myGeotabGroupId)) {
      findings.push(finding("facility.myGeotabGroupId", "GROUP_ID_REQUIRED",
        "A non-empty MyGeotab group ID is required"));
    }
    if (!object(details.facility) || !validTimeZone(details.facility.timezone)) {
      findings.push(finding("facility.timezone", "INVALID_TIMEZONE",
        "Facility timezone must be a valid IANA timezone"));
    }
    if (details.shiftProfiles !== undefined
      && !Array.isArray(details.shiftProfiles)) {
      findings.push(finding("shiftProfiles", "SHIFT_PROFILES_ARRAY_REQUIRED",
        "shiftProfiles must be an array when supplied"));
    } else if ((details.shiftProfiles || []).length) {
      engineFindings(findings, "shiftProfiles",
        shifts.validateShiftProfiles(details.shiftProfiles),
        "INVALID_SHIFT_CONFIGURATION");
      details.shiftProfiles.forEach(function (profile, index) {
        if (details.facility && profile.facilityId !== details.facility.id) {
          findings.push(finding("shiftProfiles[" + index + "].facilityId",
            "SHIFT_FACILITY_MISMATCH",
            "Shift profile facilityId must match the facility record"));
        }
        if (details.facility && profile.timezone !== details.facility.timezone) {
          findings.push(finding("shiftProfiles[" + index + "].timezone",
            "SHIFT_TIMEZONE_MISMATCH",
            "Shift profile timezone must match the facility timezone"));
        }
      });
    }
    engineFindings(findings, "moveConfiguration",
      moves.validateMoveConfiguration(details.moveConfiguration),
      "INVALID_MOVE_CONFIGURATION");
    var hasSpeedPolicies = Object.prototype.hasOwnProperty.call(
      details, "speedPolicies"
    );
    var hasLegacySpeed = object(details.speedConfiguration);
    if (hasSpeedPolicies && hasLegacySpeed) {
      findings.push(finding("speedPolicies", "AMBIGUOUS_SPEED_POLICY_CONFIGURATION",
        "Use speedPolicies or legacy speedConfiguration, not both"));
    } else if (hasSpeedPolicies) {
      engineFindings(findings, "speedPolicies",
        speedPolicies.validateSpeedPolicies(
          details.speedPolicies,
          details.facility && details.facility.id
        ),
        "INVALID_SPEED_POLICY");
    } else if (hasLegacySpeed) {
      engineFindings(findings, "speedConfiguration",
        speed.validateSpeedConfiguration(details.speedConfiguration),
        "INVALID_SPEED_CONFIGURATION");
    } else if (details.speedConfiguration !== undefined
      && details.speedConfiguration !== null) {
      findings.push(finding("speedConfiguration", "INVALID_SPEED_CONFIGURATION",
        "Legacy speedConfiguration must be an object when supplied"));
    }
    positiveObject(details.communicationFreshness, "communicationFreshness",
      ["currentMs", "delayedMs", "staleMs"], findings);
    if (object(details.communicationFreshness)
      && (details.communicationFreshness.currentMs
          > details.communicationFreshness.delayedMs
        || details.communicationFreshness.delayedMs
          > details.communicationFreshness.staleMs)) {
      findings.push(finding("communicationFreshness",
        "INVALID_FRESHNESS_ORDER",
        "Communication freshness intervals must be ordered current, delayed, stale"));
    }
    positiveObject(details.refreshIntervals, "refreshIntervals", [
      "operationalIntervalMs",
      "fuelDefIntervalMs",
      "engineHoursIntervalMs",
      "overlapWindowMs"
    ], findings);
    if (!object(details.refreshIntervals)
      || !Array.isArray(details.refreshIntervals.backoffMs)
      || !details.refreshIntervals.backoffMs.length
      || details.refreshIntervals.backoffMs.some(function (value) {
        return !Number.isFinite(value) || value <= 0;
      })) {
      findings.push(finding("refreshIntervals.backoffMs",
        "POSITIVE_INTERVAL_REQUIRED",
        "backoffMs must contain positive intervals"));
    }
    if (!object(details.facilityBillingDefaults)
      || !text(details.facilityBillingDefaults.currency)) {
      findings.push(finding("facilityBillingDefaults",
        "FACILITY_BILLING_DEFAULTS_REQUIRED",
        "Facility billing defaults and currency are required"));
    }
    return {
      ok: findings.length === 0,
      findings: findings,
      serializedLength: serialized.length
    };
  }

  function toRuntimeConfiguration(details, options) {
    var normalizedSpeed = speedPolicies.normalizeFacilitySpeedPolicy(
      details,
      options || {}
    );
    var shiftProfiles = Array.isArray(details.shiftProfiles)
      ? details.shiftProfiles : [];
    var facility = Object.assign({}, details.facility, {
      customerId: details.customer.id,
      enrolledDeviceIds: [],
      shiftProfiles: shiftProfiles.map(function (profile) {
        return Object.assign({}, profile);
      }),
      speedPolicies: normalizedSpeed.policies,
      speedPolicyNotices: normalizedSpeed.notices,
      legacySpeedConfiguration: normalizedSpeed.legacySpeedConfiguration,
      moveConfiguration: Object.assign({}, details.moveConfiguration),
      communicationFreshness: Object.assign({}, details.communicationFreshness),
      refresh: Object.assign({}, details.refreshIntervals),
      reportBranding: Object.assign({}, details.reportBranding || {}),
      billingDefaults: Object.assign({}, details.facilityBillingDefaults)
    });
    return {
      customers: [Object.assign({}, details.customer, {
        reportBranding: Object.assign({}, details.reportBranding || {})
      })],
      facilities: [facility],
      assetEnrollments: [],
      assetProfiles: [],
      units: [],
      users: []
    };
  }

  return {
    MAX_DETAILS_LENGTH: MAX_DETAILS_LENGTH,
    RECORD_TYPE: RECORD_TYPE,
    SCHEMA_VERSION: SCHEMA_VERSION,
    toRuntimeConfiguration: toRuntimeConfiguration,
    validateFacilityDetails: validateFacilityDetails
  };
}));
