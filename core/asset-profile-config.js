(function (root, factory) {
  "use strict";

  var identity = typeof module === "object" && module.exports
    ? require("./asset-identity")
    : root.SIQ_ASSET_IDENTITY;
  var assignments = typeof module === "object" && module.exports
    ? require("./asset-assignments")
    : root.SIQ_ASSET_ASSIGNMENTS;
  var api = factory(identity, assignments);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_ASSET_PROFILE_CONFIG = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  identity,
  assignments
) {
  "use strict";

  var SCHEMA_VERSION = 2;
  var RECORD_TYPE = "spotteriq-asset-profile";
  var MAX_DETAILS_LENGTH = 10000;
  var FORBIDDEN_KEY = /^(?:user(?:name)?|password|passphrase|api(?:key)?|accessToken|refreshToken|token|session|credentials?|secret|serviceAccount)$/i;

  function finding(path, code, message) {
    return { path: path, code: code, message: message };
  }

  function scan(value, path, findings) {
    if (!value || typeof value !== "object") {
      return;
    }
    Object.keys(value).forEach(function (key) {
      var child = path ? path + "." + key : key;
      if (FORBIDDEN_KEY.test(key.replace(/[-_\s]/g, ""))) {
        findings.push(finding(child, "CREDENTIAL_PROPERTY",
          "Credential-like property names are not allowed"));
      }
      scan(value[key], child, findings);
    });
  }

  function validateAssetDetails(details) {
    var findings = [];
    if (!details || typeof details !== "object" || Array.isArray(details)) {
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
    scan(details, "", findings);
    if (details.schemaVersion !== SCHEMA_VERSION) {
      findings.push(finding("schemaVersion", "UNSUPPORTED_SCHEMA_VERSION",
        "Supported schemaVersion is 2"));
    }
    if (details.recordType !== RECORD_TYPE) {
      findings.push(finding("recordType", "INVALID_RECORD_TYPE",
        "recordType must be " + RECORD_TYPE));
    }
    var profile = details.asset;
    var identityResult = identity.validateAssetProfile(profile);
    identityResult.findings.forEach(function (entry) {
      findings.push(finding("asset" + (entry.path ? "." + entry.path : ""),
        entry.code, entry.message));
    });
    var assignmentResult = assignments.validateAssignments(profile);
    assignmentResult.findings.forEach(function (entry) {
      findings.push(finding("asset" + (entry.path ? "." + entry.path : ""),
        entry.code, entry.message));
    });
    return {
      ok: findings.length === 0,
      findings: findings,
      serializedLength: serialized.length
    };
  }

  function toRuntimeAsset(details, timestamp) {
    var profile = Object.assign({}, details.asset);
    var capabilities = identity.normalizeCapabilities(profile);
    var commercialStatus = identity.commercialConfigurationStatus(profile);
    var commercialTerms = profile.commercialTerms
      && typeof profile.commercialTerms === "object"
      ? profile.commercialTerms : null;
    var device = identity.resolveDeviceAssignment(profile, timestamp);
    var assignment = assignments.resolveAssignment(profile, timestamp);
    var customerUnit = identity.resolveCustomerUnitNumber(profile, timestamp);
    return {
      profile: profile,
      enrollment: device ? {
        assetId: profile.assetId,
        deviceId: device.myGeotabDeviceId,
        facilityId: assignment ? assignment.facilityId : null,
        displayName: identity.displayLabel(profile, timestamp),
        fleetsourceUnitNumber: profile.fleetsourceUnitNumber,
        customerUnitNumber: customerUnit,
        role: profile.role,
        roleLabel: identity.ASSET_ROLES[profile.role],
        operationalStatus: assignment ? assignment.operationalStatus : null,
        statusLabel: assignment
          ? identity.OPERATIONAL_STATUSES[assignment.operationalStatus] : null,
        currentAssignment: assignment,
        homeFacilityId: profile.homeFacilityId,
        leaseStart: commercialStatus === "CONFIGURED"
          && commercialTerms.leaseStartDate || null,
        commercialConfigurationStatus: commercialStatus,
        driverIdentificationEnabled: capabilities.driverIdentification,
        powertrainFaultMonitoringEnabled:
          capabilities.powertrainFaultMonitoring,
        faultConfiguration: capabilities.powertrainFaultMonitoring
          ? Object.assign({}, profile.faultConfiguration || {}, {
            engineControllerIds: (profile.faultConfiguration
              && profile.faultConfiguration.engineControllerIds || []).slice(),
            transmissionControllerIds: (profile.faultConfiguration
              && profile.faultConfiguration.transmissionControllerIds || []).slice()
          }) : null,
        capability: Object.assign({}, profile.operationalThresholds || {}, {
          fifthWheelStatusSupported: capabilities.fifthWheelStatus,
          driverIdentificationSupported: capabilities.driverIdentification,
          powertrainFaultMonitoringSupported:
            capabilities.powertrainFaultMonitoring
        }),
        capabilities: Object.assign({}, capabilities),
        diagnosticMappings: Object.assign({}, profile.diagnosticMappings)
      } : null,
      unit: device ? {
        id: device.myGeotabDeviceId,
        assetId: profile.assetId,
        vin: profile.vin,
        fleetsourceUnitNumber: profile.fleetsourceUnitNumber,
        customerUnitNumber: customerUnit,
        name: identity.displayLabel(profile, timestamp),
        role: profile.role,
        roleLabel: identity.ASSET_ROLES[profile.role],
        operationalStatus: assignment ? assignment.operationalStatus : null,
        statusLabel: assignment
          ? identity.OPERATIONAL_STATUSES[assignment.operationalStatus] : null,
        currentAssignment: assignment,
        homeFacilityId: profile.homeFacilityId,
        leaseStart: commercialStatus === "CONFIGURED"
          && commercialTerms.leaseStartDate || null,
        commercialConfigurationStatus: commercialStatus,
        capabilities: capabilities,
        driverIdentificationEnabled: capabilities.driverIdentification,
        externalReferences: Object.assign({}, profile.externalReferences || {})
      } : null
    };
  }

  return {
    MAX_DETAILS_LENGTH: MAX_DETAILS_LENGTH,
    RECORD_TYPE: RECORD_TYPE,
    SCHEMA_VERSION: SCHEMA_VERSION,
    toRuntimeAsset: toRuntimeAsset,
    validateAssetDetails: validateAssetDetails
  };
}));
