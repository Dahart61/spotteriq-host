(function (root, factory) {
  "use strict";

  var diagnosticChannels = typeof module === "object" && module.exports
    ? require("./diagnostic-channels")
    : root.SIQ_DIAGNOSTIC_CHANNELS;
  var api = factory(diagnosticChannels);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_ASSET_IDENTITY = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  diagnosticChannels
) {
  "use strict";

  var ASSET_ROLES = Object.freeze({
    CONTRACT_FLEET_UNIT: "Contract Fleet Unit",
    ONSITE_SPARE: "Onsite Spare",
    REGIONAL_LOANER: "Regional Loaner",
    RENTAL: "Rental",
    RETIRED: "Retired"
  });
  var OPERATIONAL_STATUSES = Object.freeze({
    ACTIVE: "Active",
    STANDBY: "Standby",
    LOANER_IN_SERVICE: "In Service",
    OUT_FOR_REPAIR: "Out for Repair",
    MAJOR_REPAIR: "Major Repair",
    IN_TRANSIT: "In Transit",
    TEMPORARILY_UNAVAILABLE: "Temporarily Unavailable",
    RETIRED: "Retired"
  });
  var BILLING_MODES = Object.freeze([
    "ENGINE_HOURS",
    "FIXED_MONTHLY",
    "RENTAL_ENGINE_HOURS",
    "NON_BILLABLE",
    "MANUAL_REVIEW"
  ]);
  var CAPABILITY_KEYS = Object.freeze([
    "rpm",
    "speed",
    "fuelUsed",
    "fuelLevel",
    "defLevel",
    "engineHours",
    "fifthWheelStatus",
    "faults",
    "whipAroundLinked",
    "fullbayLinked"
  ]);
  var OPTIONAL_CAPABILITY_KEYS = Object.freeze([
    "driverIdentification",
    "powertrainFaultMonitoring",
    "ignition",
    "odometer",
    "engineCoolantTemperature"
  ]);
  var COMMERCIAL_CONFIGURATION_STATUSES = Object.freeze({
    CONFIGURED: "CONFIGURED",
    NOT_CONFIGURED: "NOT_CONFIGURED"
  });
  function finding(path, code, message) {
    return { path: path, code: code, message: message };
  }

  function text(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function validTimestamp(value) {
    return text(value) && Number.isFinite(Date.parse(value));
  }

  function intervalsOverlap(left, right, fromKey, throughKey) {
    var leftStart = Date.parse(left[fromKey]);
    var rightStart = Date.parse(right[fromKey]);
    var leftEnd = left[throughKey] ? Date.parse(left[throughKey]) : Infinity;
    var rightEnd = right[throughKey] ? Date.parse(right[throughKey]) : Infinity;
    return leftStart < rightEnd && rightStart < leftEnd;
  }

  function validateEffectiveHistory(records, options) {
    var findings = [];
    var list = Array.isArray(records) ? records : [];
    var fromKey = options.fromKey;
    var throughKey = options.throughKey;
    list.forEach(function (record, index) {
      var path = options.path + "[" + index + "]";
      if (!record || !validTimestamp(record[fromKey])) {
        findings.push(finding(path + "." + fromKey, "INVALID_EFFECTIVE_DATE",
          fromKey + " must be an ISO timestamp"));
      }
      if (record && record[throughKey] !== null && record[throughKey] !== undefined
        && !validTimestamp(record[throughKey])) {
        findings.push(finding(path + "." + throughKey, "INVALID_EFFECTIVE_DATE",
          throughKey + " must be null or an ISO timestamp"));
      }
      if (record && validTimestamp(record[fromKey]) && validTimestamp(record[throughKey])
        && Date.parse(record[fromKey]) >= Date.parse(record[throughKey])) {
        findings.push(finding(path, "INVALID_EFFECTIVE_RANGE",
          "Effective range must have positive duration"));
      }
    });
    for (var left = 0; left < list.length; left += 1) {
      for (var right = left + 1; right < list.length; right += 1) {
        if (validTimestamp(list[left] && list[left][fromKey])
          && validTimestamp(list[right] && list[right][fromKey])
          && intervalsOverlap(list[left], list[right], fromKey, throughKey)) {
          findings.push(finding(options.path, options.overlapCode,
            options.overlapMessage));
        }
      }
    }
    return findings;
  }

  function resolveEffective(records, timestamp, fromKey, throughKey) {
    var instant = Date.parse(timestamp);
    if (!Number.isFinite(instant)) {
      return null;
    }
    var matches = (records || []).filter(function (record) {
      var start = Date.parse(record[fromKey]);
      var end = record[throughKey] ? Date.parse(record[throughKey]) : Infinity;
      return start <= instant && instant < end;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function validateCapabilities(profile, mappings, findings) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      findings.push(finding("capabilities", "CAPABILITY_PROFILE_REQUIRED",
        "An explicit capability profile is required"));
      return;
    }
    CAPABILITY_KEYS.forEach(function (key) {
      if (typeof profile[key] !== "boolean") {
        findings.push(finding("capabilities." + key, "CAPABILITY_FLAG_REQUIRED",
          key + " must be true or false"));
      }
    });
    OPTIONAL_CAPABILITY_KEYS.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(profile, key)
        && typeof profile[key] !== "boolean") {
        findings.push(finding("capabilities." + key, "INVALID_CAPABILITY_FLAG",
          key + " must be true or false when provided"));
      }
    });
    var mappingValidation = diagnosticChannels.validateMappings(
      mappings,
      profile,
      { pathPrefix: "diagnosticMappings" }
    );
    mappingValidation.findings.forEach(function (entry) {
      findings.push(entry);
    });
  }

  function validateOperationalThresholds(profile, findings) {
    var capabilities = profile && profile.capabilities || {};
    if (capabilities.ignition !== true) {
      return;
    }
    var value = profile.operationalThresholds
      && profile.operationalThresholds.ignitionFreshnessMs;
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      findings.push(finding("operationalThresholds.ignitionFreshnessMs",
        "INVALID_IGNITION_FRESHNESS",
        "Enabled ignition requires a positive finite integer ignitionFreshnessMs"));
    }
  }

  function validateCommercialTerms(terms, capabilities, findings) {
    if (terms === null || terms === undefined) {
      return;
    }
    if (typeof terms !== "object" || Array.isArray(terms)) {
      findings.push(finding("commercialTerms", "INVALID_COMMERCIAL_TERMS",
        "Commercial terms must be an object when provided"));
      return;
    }
    if (terms.billingMode === null || terms.billingMode === undefined
      || terms.billingMode === "" || terms.billingMode === "NOT_CONFIGURED") {
      return;
    }
    if (BILLING_MODES.indexOf(terms.billingMode) === -1) {
      findings.push(finding("commercialTerms.billingMode", "INVALID_COMMERCIAL_TERMS",
        "A supported billing mode is required"));
      return;
    }
    var requiresLease = ["ENGINE_HOURS", "FIXED_MONTHLY", "RENTAL_ENGINE_HOURS"]
      .indexOf(terms.billingMode) !== -1;
    if (requiresLease && !validTimestamp(terms.leaseStartDate)) {
      findings.push(finding("commercialTerms.leaseStartDate", "LEASE_START_REQUIRED",
        "Lease start is required for this billing mode"));
    }
    if (requiresLease && !validTimestamp(terms.billingStartDate)) {
      findings.push(finding("commercialTerms.billingStartDate", "BILLING_START_REQUIRED",
        "Billing start is required for this billing mode"));
    }
    if (["ENGINE_HOURS", "RENTAL_ENGINE_HOURS"].indexOf(terms.billingMode) !== -1
      && (!capabilities || capabilities.engineHours !== true)) {
      findings.push(finding("capabilities.engineHours",
        "ENGINE_HOURS_CAPABILITY_REQUIRED",
        "Engine-hour billing requires engineHours support"));
    }
    [
      ["leaseStartDate", "leaseEndDate"],
      ["billingStartDate", "billingEndDate"]
    ].forEach(function (pair) {
      if (validTimestamp(terms[pair[0]]) && validTimestamp(terms[pair[1]])
        && Date.parse(terms[pair[0]]) >= Date.parse(terms[pair[1]])) {
        findings.push(finding("commercialTerms", "INVALID_COMMERCIAL_TERMS",
          pair[1] + " must be after " + pair[0]));
      }
    });
  }

  function commercialConfigurationStatus(profile) {
    var terms = profile && profile.commercialTerms;
    return terms && typeof terms === "object" && !Array.isArray(terms)
      && BILLING_MODES.indexOf(terms.billingMode) !== -1
      ? COMMERCIAL_CONFIGURATION_STATUSES.CONFIGURED
      : COMMERCIAL_CONFIGURATION_STATUSES.NOT_CONFIGURED;
  }

  function validateFaultConfiguration(profile, findings) {
    var capabilities = profile && profile.capabilities || {};
    if (capabilities.powertrainFaultMonitoring !== true) {
      return;
    }
    var configuration = profile.faultConfiguration;
    if (!configuration || typeof configuration !== "object"
      || Array.isArray(configuration)) {
      findings.push(finding("faultConfiguration", "FAULT_CONFIGURATION_REQUIRED",
        "Powertrain fault monitoring requires exact controller configuration"));
      return;
    }
    var engine = configuration.engineControllerIds;
    var transmission = configuration.transmissionControllerIds;
    [
      ["engineControllerIds", engine],
      ["transmissionControllerIds", transmission]
    ].forEach(function (entry) {
      if (!Array.isArray(entry[1])) {
        findings.push(finding("faultConfiguration." + entry[0],
          "CONTROLLER_ALLOWLIST_REQUIRED",
          entry[0] + " must be an array of exact MyGeotab Controller IDs"));
        return;
      }
      var seen = new Set();
      entry[1].forEach(function (controllerId, index) {
        if (!text(controllerId)
          || controllerId !== controllerId.trim()) {
          findings.push(finding("faultConfiguration." + entry[0]
            + "[" + index + "]", "INVALID_CONTROLLER_ID",
          "Controller IDs must be exact nonempty strings without surrounding whitespace"));
        } else if (seen.has(controllerId)) {
          findings.push(finding("faultConfiguration." + entry[0],
            "DUPLICATE_CONTROLLER_ID",
            "Controller IDs must not be duplicated"));
        }
        seen.add(controllerId);
      });
    });
    if (Array.isArray(engine) && Array.isArray(transmission)) {
      if (engine.length + transmission.length === 0) {
        findings.push(finding("faultConfiguration", "QUALIFYING_CONTROLLER_REQUIRED",
          "At least one engine or transmission Controller ID is required"));
      }
      var transmissionIds = new Set(transmission);
      if (engine.some(function (controllerId) {
        return transmissionIds.has(controllerId);
      })) {
        findings.push(finding("faultConfiguration", "CONTROLLER_CATEGORY_OVERLAP",
          "A Controller ID cannot be both engine and transmission"));
      }
    }
  }

  function validateAssetProfile(profile) {
    var findings = [];
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      return { ok: false, findings: [finding("", "ASSET_PROFILE_REQUIRED",
        "Asset profile must be an object")] };
    }
    if (!text(profile.assetId)) {
      findings.push(finding("assetId", "ASSET_ID_REQUIRED",
        "Stable SpotterIQ asset ID is required"));
    }
    if (!text(profile.customerId)) {
      findings.push(finding("customerId", "CUSTOMER_ID_REQUIRED",
        "Customer ID is required"));
    }
    if (profile.roadVehicle !== false && !text(profile.vin)) {
      findings.push(finding("vin", "VIN_REQUIRED", "VIN is required for road vehicles"));
    }
    if (!text(profile.fleetsourceUnitNumber)) {
      findings.push(finding("fleetsourceUnitNumber", "FLEETSOURCE_UNIT_NUMBER_REQUIRED",
        "Fleetsource unit number is required"));
    }
    if (!Object.prototype.hasOwnProperty.call(ASSET_ROLES, profile.role)) {
      findings.push(finding("role", "INVALID_ASSET_ROLE",
        "Asset role must be a supported universal role"));
    }
    if (profile.role === "SPECIAL_PROJECT" || profile.role === "Special Project") {
      findings.push(finding("role", "INVALID_ASSET_ROLE",
        "Special Project is an assignment reason, not an asset role"));
    }
    validateCapabilities(profile.capabilities, profile.diagnosticMappings, findings);
    validateOperationalThresholds(profile, findings);
    validateCommercialTerms(profile.commercialTerms, profile.capabilities, findings);
    validateFaultConfiguration(profile, findings);
    findings = findings.concat(validateEffectiveHistory(
      profile.customerUnitNumberHistory || [],
      {
        path: "customerUnitNumberHistory",
        fromKey: "effectiveFrom",
        throughKey: "effectiveThrough",
        overlapCode: "CUSTOMER_UNIT_ASSIGNMENT_OVERLAP",
        overlapMessage: "Customer unit-number assignments may not overlap"
      }
    ));
    (profile.customerUnitNumberHistory || []).forEach(function (record, index) {
      if (!text(record && record.value)) {
        findings.push(finding("customerUnitNumberHistory[" + index + "].value",
          "CUSTOMER_UNIT_NUMBER_REQUIRED", "History value is required"));
      }
      if (!text(record && record.reason)) {
        findings.push(finding("customerUnitNumberHistory[" + index + "].reason",
          "CUSTOMER_UNIT_NUMBER_REASON_REQUIRED",
          "A reason is required for every customer unit-number assignment"));
      }
    });
    findings = findings.concat(validateEffectiveHistory(
      profile.deviceAssignments || [],
      {
        path: "deviceAssignments",
        fromKey: "installedAt",
        throughKey: "removedAt",
        overlapCode: "DEVICE_ASSIGNMENT_OVERLAP",
        overlapMessage: "Device assignments for one asset may not overlap"
      }
    ));
    (profile.deviceAssignments || []).forEach(function (assignment, index) {
      if (!text(assignment && assignment.assignmentId)
        || !text(assignment && assignment.myGeotabDeviceId)
        || !text(assignment && assignment.installationReason)
        || !text(assignment && assignment.diagnosticProfileVersion)) {
        findings.push(finding("deviceAssignments[" + index + "]",
          "INVALID_DEVICE_ASSIGNMENT",
          "Assignment ID, device ID, installation reason, and diagnostic profile version are required"));
      }
      if (assignment && assignment.assetId !== profile.assetId) {
        findings.push(finding("deviceAssignments[" + index + "].assetId",
          "DEVICE_ASSIGNMENT_ASSET_MISMATCH",
          "Device assignment assetId must match the physical asset"));
      }
    });
    return { ok: findings.length === 0, findings: findings };
  }

  function validateAssetProfiles(profiles) {
    var findings = [];
    var list = Array.isArray(profiles) ? profiles : [];
    var ids = new Map();
    var vins = new Map();
    var unitNumbers = new Map();
    var activeDevices = new Map();
    list.forEach(function (profile, index) {
      var result = validateAssetProfile(profile);
      result.findings.forEach(function (entry) {
        findings.push(finding("assets[" + index + "]" + (entry.path ? "." + entry.path : ""),
          entry.code, entry.message));
      });
      [
        [ids, profile && profile.assetId, "DUPLICATE_ASSET_ID"],
        [vins, profile && profile.vin, "DUPLICATE_VIN"],
        [unitNumbers,
          profile && profile.customerId + "::" + profile.fleetsourceUnitNumber,
          "DUPLICATE_FLEETSOURCE_UNIT_NUMBER"]
      ].forEach(function (item) {
        if (!text(item[1])) {
          return;
        }
        if (item[0].has(item[1])) {
          findings.push(finding("assets[" + index + "]", item[2],
            "Asset identity must be unique within fleet scope"));
        }
        item[0].set(item[1], index);
      });
      (profile && profile.deviceAssignments || []).filter(function (assignment) {
        return assignment.removedAt === null || assignment.removedAt === undefined;
      }).forEach(function (assignment) {
        if (activeDevices.has(assignment.myGeotabDeviceId)) {
          findings.push(finding("assets[" + index + "].deviceAssignments",
            "DEVICE_ASSIGNED_TO_MULTIPLE_ASSETS",
            "One MyGeotab device may have only one active physical asset assignment"));
        }
        activeDevices.set(assignment.myGeotabDeviceId, profile.assetId);
      });
    });
    for (var leftProfile = 0; leftProfile < list.length; leftProfile += 1) {
      for (var rightProfile = leftProfile + 1;
        rightProfile < list.length; rightProfile += 1) {
        var leftAsset = list[leftProfile];
        var rightAsset = list[rightProfile];
        if (!text(leftAsset && leftAsset.customerId)
          || !rightAsset
          || leftAsset.customerId !== rightAsset.customerId) {
          continue;
        }
        (leftAsset.customerUnitNumberHistory || []).forEach(function (leftLabel) {
          (rightAsset.customerUnitNumberHistory || []).forEach(function (rightLabel) {
            if (!text(leftLabel && leftLabel.value)
              || !rightLabel
              || leftLabel.value !== rightLabel.value
              || !validTimestamp(leftLabel.effectiveFrom)
              || !validTimestamp(rightLabel.effectiveFrom)
              || (leftLabel.effectiveThrough !== null
                && leftLabel.effectiveThrough !== undefined
                && !validTimestamp(leftLabel.effectiveThrough))
              || (rightLabel.effectiveThrough !== null
                && rightLabel.effectiveThrough !== undefined
                && !validTimestamp(rightLabel.effectiveThrough))) {
              return;
            }
            if (intervalsOverlap(leftLabel, rightLabel,
              "effectiveFrom", "effectiveThrough")) {
              findings.push(finding(
                "assets[" + rightProfile + "].customerUnitNumberHistory",
                "CUSTOMER_UNIT_NUMBER_CROSS_ASSET_OVERLAP",
                "One customer unit number may not identify two physical assets during overlapping effective periods"
              ));
            }
          });
        });
      }
    }
    return { ok: findings.length === 0, findings: findings };
  }

  function resolveCustomerUnitNumber(profile, timestamp) {
    var record = resolveEffective(profile && profile.customerUnitNumberHistory,
      timestamp, "effectiveFrom", "effectiveThrough");
    return record ? record.value : null;
  }

  function resolveDeviceAssignment(profile, timestamp) {
    return resolveEffective(profile && profile.deviceAssignments,
      timestamp, "installedAt", "removedAt");
  }

  function displayLabel(profile, timestamp) {
    var customerUnit = resolveCustomerUnitNumber(profile, timestamp);
    return customerUnit
      ? customerUnit + " / " + profile.fleetsourceUnitNumber
      : profile.fleetsourceUnitNumber;
  }

  function capabilityValue(profile, key, value) {
    return profile && profile.capabilities && profile.capabilities[key] === true
      ? value
      : "Unavailable";
  }

  function normalizeCapabilities(profile) {
    var capabilities = Object.assign({}, profile && profile.capabilities || {});
    OPTIONAL_CAPABILITY_KEYS.forEach(function (key) {
      capabilities[key] = capabilities[key] === true;
    });
    return capabilities;
  }

  return {
    ASSET_ROLES: ASSET_ROLES,
    BILLING_MODES: BILLING_MODES.slice(),
    CAPABILITY_KEYS: CAPABILITY_KEYS.slice(),
    COMMERCIAL_CONFIGURATION_STATUSES: COMMERCIAL_CONFIGURATION_STATUSES,
    OPTIONAL_CAPABILITY_KEYS: OPTIONAL_CAPABILITY_KEYS.slice(),
    OPERATIONAL_STATUSES: OPERATIONAL_STATUSES,
    capabilityValue: capabilityValue,
    commercialConfigurationStatus: commercialConfigurationStatus,
    displayLabel: displayLabel,
    normalizeCapabilities: normalizeCapabilities,
    resolveCustomerUnitNumber: resolveCustomerUnitNumber,
    resolveDeviceAssignment: resolveDeviceAssignment,
    resolveEffective: resolveEffective,
    validateAssetProfile: validateAssetProfile,
    validateAssetProfiles: validateAssetProfiles,
    validateEffectiveHistory: validateEffectiveHistory,
    validateFaultConfiguration: validateFaultConfiguration
  };
}));
