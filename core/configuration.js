(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_CONFIGURATION = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var ROLES = {
    CUSTOMER_VIEWER: "Customer Viewer",
    CUSTOMER_MANAGER: "Customer Manager",
    FLEETSOURCE_ADMINISTRATOR: "Fleetsource Administrator"
  };

  /*
   * Fixture configuration schema:
   *
   * Customer:
   * - id, displayName, optional reportBranding
   *
   * Facility:
   * - id, customerId, displayName, myGeotabGroupId, timezone,
   *   optional profile-derived enrolledDeviceIds, optional shiftProfileIds and effective-dated
   *   speedPolicies, moveThresholds,
   *   communicationFreshnessThresholds, optional reportBranding overrides
   *
   * Shift profile:
   * - id, facilityId, name, timezone, startLocalTime, endLocalTime,
   *   activeWeekdays, effectiveFrom, optional effectiveThrough,
   *   reportingEnabled, optional displayOrder and boundary disambiguation
   *
   * Optional asset-profile enrichment (never a current-visibility gate):
   * - deviceId, facilityId, displayName, jawSensorInstalled, jawDiagnosticId,
   *   lockedValue, unlockedValue, rpmDiagnosticId, speedSource,
   *   fuelUsedDiagnosticId, fuelLevelDiagnosticId, defDiagnosticId,
   *   engineHoursDiagnosticId, commissionedAt, lastVerifiedAt
   *
   * User fixture:
   * - id, role, accessibleDeviceIds, authorizedFacilityIds,
   *   canAdministerSpotterIQ, optional customerId for customer users
   */

  function idsAreUnique(records) {
    var seen = new Set();
    return records.every(function (record) {
      if (!record || !record.id || seen.has(record.id)) {
        return false;
      }
      seen.add(record.id);
      return true;
    });
  }

  function requiredArraysExist(configuration) {
    return Boolean(configuration)
      && Array.isArray(configuration.customers)
      && Array.isArray(configuration.facilities)
      && Array.isArray(configuration.assetEnrollments)
      && (!Object.prototype.hasOwnProperty.call(configuration, "assetProfiles")
        || Array.isArray(configuration.assetProfiles))
      && Array.isArray(configuration.shiftProfiles)
      && Array.isArray(configuration.users)
      && Array.isArray(configuration.myGeotabGroups)
      && Array.isArray(configuration.units);
  }

  function validateConfiguration(configuration) {
    if (!requiredArraysExist(configuration)) {
      return {
        ok: false,
        reason: "Invalid facility configuration"
      };
    }

    var unique = [
      configuration.customers,
      configuration.facilities,
      configuration.shiftProfiles,
      configuration.assetEnrollments.map(function (enrollment) {
        return { id: enrollment.facilityId + "::" + enrollment.deviceId };
      }),
      configuration.users,
      configuration.myGeotabGroups,
      configuration.units,
      (configuration.assetProfiles || []).map(function (profile) {
        return { id: profile.assetId };
      })
    ].every(idsAreUnique);

    if (!unique) {
      return {
        ok: false,
        reason: "Invalid facility configuration"
      };
    }

    return {
      ok: true,
      reason: ""
    };
  }

  return {
    ROLES: ROLES,
    validateConfiguration: validateConfiguration
  };
}));
