(function (root, factory) {
  "use strict";

  var configApi = root.SIQ_CONFIGURATION;
  var historicalApi = root.SIQ_HISTORICAL_ENTITLEMENT;
  if (!configApi && typeof require === "function") {
    configApi = require("./configuration");
  }
  if (!historicalApi && typeof require === "function") {
    historicalApi = require("./historical-entitlement");
  }

  var api = factory(configApi, historicalApi);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_AUTHORIZATION = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  configurationApi,
  historicalEntitlement
) {
  "use strict";

  var ROLES = configurationApi.ROLES;
  var UNPROFILED_MESSAGE = "Advanced SpotterIQ profile not configured";
  var HISTORICAL_UNAVAILABLE = "Historical reporting is not configured for this asset.";

  function emptyScope(reason, code, extras) {
    var scope = {
      ok: false,
      code: code || "no-authorized-assets",
      reason: reason || "No authorized assets",
      customer: null,
      facility: null,
      deviceIds: [],
      units: [],
      enrollments: [],
      entitlements: []
    };
    Object.keys(extras || {}).forEach(function (key) {
      scope[key] = extras[key];
    });
    return scope;
  }

  function getById(records, id) {
    return (records || []).find(function (record) {
      return record.id === id;
    }) || null;
  }

  function getUser(configuration, userId) {
    return getById(configuration.users, userId);
  }

  function getCustomer(configuration, customerId) {
    return getById(configuration.customers, customerId);
  }

  function getFacility(configuration, facilityId) {
    return getById(configuration.facilities, facilityId);
  }

  function getFacilityGroup(configuration, facility) {
    if (!facility || !facility.myGeotabGroupId) {
      return null;
    }
    return getById(configuration.myGeotabGroups, facility.myGeotabGroupId);
  }

  function isCustomerUser(user) {
    return Boolean(user) && (
      user.role === ROLES.CUSTOMER_VIEWER
      || user.role === ROLES.CUSTOMER_MANAGER
    );
  }

  function isFleetsourceAdministrator(user) {
    return Boolean(user)
      && user.role === ROLES.FLEETSOURCE_ADMINISTRATOR
      && user.canAdministerSpotterIQ === true;
  }

  function authorizedFacilitiesForUser(configuration, user) {
    if (!user) {
      return [];
    }
    var authorizedIds = new Set(user.authorizedFacilityIds || []);
    var facilities = (configuration.facilities || []).filter(function (facility) {
      return authorizedIds.has(facility.id);
    });
    if (isCustomerUser(user)) {
      facilities = facilities.filter(function (facility) {
        return facility.customerId === user.customerId;
      });
    }
    return facilities;
  }

  function assertRequestedScope(configuration, user, customerId, facilityId) {
    var customer = getCustomer(configuration, customerId);
    var facility = getFacility(configuration, facilityId);
    var authorizedFacilities = authorizedFacilitiesForUser(configuration, user);
    var authorizedFacilityIds = new Set(authorizedFacilities.map(function (record) {
      return record.id;
    }));
    if (!customer) {
      return emptyScope("No authorized facilities", "no-authorized-facilities", {
        authorizedFacilities: authorizedFacilities
      });
    }
    if (!facility) {
      return emptyScope("No authorized assets", "missing-facility", {
        customer: customer,
        authorizedFacilities: authorizedFacilities
      });
    }
    if (facility.customerId !== customer.id) {
      return emptyScope("No authorized assets", "customer-facility-mismatch", {
        customer: customer,
        authorizedFacilities: authorizedFacilities
      });
    }
    if (!authorizedFacilityIds.has(facility.id)) {
      return emptyScope("No authorized assets", "unauthorized-facility", {
        customer: customer,
        facility: facility,
        authorizedFacilities: authorizedFacilities
      });
    }
    return {
      ok: true,
      customer: customer,
      facility: facility,
      authorizedFacilities: authorizedFacilities
    };
  }

  function supportedUser(configuration, request) {
    var user = getUser(configuration, request && request.userId);
    if (!user) {
      return emptyScope("No authorized facilities", "missing-user");
    }
    if (!isFleetsourceAdministrator(user) && !isCustomerUser(user)) {
      return emptyScope("No authorized facilities", "unsupported-role", { user: user });
    }
    return { ok: true, user: user };
  }

  function profileForDevice(configuration, deviceId, enrollment) {
    if (enrollment && enrollment.assetId) {
      return (configuration.assetProfiles || []).find(function (profile) {
        return profile.assetId === enrollment.assetId;
      }) || null;
    }
    return (configuration.assetProfiles || []).find(function (profile) {
      return (profile.deviceAssignments || []).some(function (assignment) {
        return assignment.myGeotabDeviceId === deviceId;
      });
    }) || null;
  }

  function currentUnit(configuration, deviceId, enrollment) {
    var source = (configuration.units || []).find(function (unit) {
      return unit.id === deviceId;
    }) || { id: deviceId, name: deviceId };
    var unit = Object.assign({}, source);
    var configured = Boolean(enrollment || profileForDevice(configuration, deviceId, enrollment));
    unit.advancedProfileConfigured = configured;
    unit.profileStatus = configured
      ? "Advanced SpotterIQ profile configured" : UNPROFILED_MESSAGE;
    if (configured) {
      return unit;
    }

    unit.assetId = null;
    unit.customerUnitNumber = null;
    unit.fleetsourceUnitNumber = null;
    unit.role = null;
    unit.roleLabel = "Not configured";
    unit.operationalStatus = null;
    unit.statusLabel = "Not configured";
    unit.currentAssignment = null;
    unit.assignmentReason = null;
    unit.homeFacilityId = null;
    unit.leaseStart = null;
    unit.commercialTerms = null;
    unit.groupReconciliation = "UNCONFIGURED_IN_GROUP";
    unit.fifthWheelStatus = "Fifth Wheel Status Unavailable";
    unit.moves = null;
    unit.moveInProgress = false;
    unit.lastMove = "Unavailable";
    unit.recentMoves = [];
    unit.verifiedMovesLabel = "Verified Moves Unavailable";
    unit.quality = "Profile not configured";
    unit.alert = UNPROFILED_MESSAGE;
    unit.performance = Object.assign({}, unit.performance || {}, {
      capabilities: Object.assign({}, unit.performance && unit.performance.capabilities || {}, {
        fifthWheelStatus: false,
        verifiedMoves: false,
        historicalReporting: false,
        driverAttribution: false,
        driverIdentification: false
      })
    });
    unit.driverIdentificationEnabled = false;
    unit.driverIdentificationStatus = "UNAVAILABLE";
    unit.currentDriverDisplayName = null;
    unit.driverIdentifiedAt = null;
    unit.driverAttributionLabel = "Driver Identification Unavailable";
    unit.driverTimeline = [];
    return unit;
  }

  function getEffectiveAssetScope(configuration, request) {
    var validation = configurationApi.validateConfiguration(configuration);
    if (!validation.ok) {
      return emptyScope(validation.reason, "invalid-configuration");
    }
    var supported = supportedUser(configuration, request);
    if (!supported.ok) {
      return supported;
    }
    var user = supported.user;
    if (isFleetsourceAdministrator(user) && (!request.customerId || !request.facilityId)) {
      return emptyScope("No authorized assets", "administrator-selection-required", {
        user: user,
        authorizedFacilities: authorizedFacilitiesForUser(configuration, user)
      });
    }
    var asserted = assertRequestedScope(
      configuration, user, request.customerId, request.facilityId
    );
    if (!asserted.ok) {
      asserted.user = user;
      return asserted;
    }
    var group = getFacilityGroup(configuration, asserted.facility);
    if (!group || !Array.isArray(group.deviceIds)) {
      return emptyScope("Invalid facility configuration", "invalid-facility-configuration", {
        user: user,
        customer: asserted.customer,
        facility: asserted.facility,
        authorizedFacilities: asserted.authorizedFacilities
      });
    }

    var accessibleIds = new Set(user.accessibleDeviceIds || []);
    var enrollmentByDeviceId = new Map((configuration.assetEnrollments || []).map(function (item) {
      return [item.deviceId, item];
    }));
    var deviceIds = group.deviceIds.filter(function (deviceId) {
      return accessibleIds.has(deviceId);
    });
    var units = deviceIds.map(function (deviceId) {
      return currentUnit(configuration, deviceId, enrollmentByDeviceId.get(deviceId));
    });
    if (!units.length) {
      return emptyScope("No authorized assets", "no-accessible-facility-group-devices", {
        user: user,
        customer: asserted.customer,
        facility: asserted.facility,
        authorizedFacilities: asserted.authorizedFacilities
      });
    }
    return {
      ok: true,
      code: "authorized-current-devices",
      reason: "",
      user: user,
      customer: asserted.customer,
      facility: asserted.facility,
      authorizedFacilities: asserted.authorizedFacilities,
      deviceIds: deviceIds,
      units: units,
      enrollments: deviceIds.map(function (deviceId) {
        return enrollmentByDeviceId.get(deviceId) || null;
      }),
      entitlements: []
    };
  }

  function getHistoricalAssetScope(configuration, request) {
    var validation = configurationApi.validateConfiguration(configuration);
    if (!validation.ok) {
      return emptyScope(validation.reason, "invalid-configuration");
    }
    var supported = supportedUser(configuration, request);
    if (!supported.ok) {
      return supported;
    }
    var user = supported.user;
    var lifecycleMode = request && request.lifecycleMode === true;
    var asserted = null;
    if (!lifecycleMode) {
      if (isCustomerUser(user)
        && user.role === ROLES.CUSTOMER_MANAGER
        && request.customerId === user.customerId
        && !request.facilityId) {
        asserted = {
          ok: true,
          customer: getCustomer(configuration, request.customerId),
          facility: null,
          authorizedFacilities: authorizedFacilitiesForUser(configuration, user)
        };
        if (!asserted.customer) {
          asserted = emptyScope(
            "No authorized facilities", "no-authorized-facilities"
          );
        }
      } else {
        asserted = assertRequestedScope(
          configuration, user, request.customerId, request.facilityId
        );
      }
      if (!asserted.ok) {
        asserted.user = user;
        return asserted;
      }
    } else if (!isFleetsourceAdministrator(user)) {
      return emptyScope("No authorized facilities", "lifecycle-access-denied", {
        user: user
      });
    }

    var unitByAssetId = new Map((configuration.units || []).filter(function (unit) {
      return unit.assetId;
    }).map(function (unit) {
      return [unit.assetId, unit];
    }));
    var unitByDeviceId = new Map((configuration.units || []).map(function (unit) {
      return [unit.id, unit];
    }));
    var entitlements = [];
    var units = [];
    var deviceIds = [];

    (configuration.assetProfiles || []).forEach(function (profile) {
      var windows = historicalEntitlement.assignmentWindows(
        configuration, profile, request, user
      );
      if (!windows.length) {
        return;
      }
      windows.forEach(function (window) {
        entitlements.push(window);
        if (deviceIds.indexOf(window.deviceId) === -1) {
          deviceIds.push(window.deviceId);
          var source = unitByAssetId.get(profile.assetId)
            || unitByDeviceId.get(window.deviceId)
            || { id: window.deviceId, name: window.deviceId, assetId: profile.assetId };
          units.push(Object.assign({}, source, {
            advancedProfileConfigured: true,
            profileStatus: "Advanced SpotterIQ profile configured"
          }));
        }
      });
    });
    if (!entitlements.length) {
      return emptyScope(HISTORICAL_UNAVAILABLE,
        "historical-reporting-not-configured", {
          user: user,
          customer: asserted && asserted.customer || null,
          facility: asserted && asserted.facility || null,
          authorizedFacilities: authorizedFacilitiesForUser(configuration, user)
        });
    }
    return {
      ok: true,
      code: lifecycleMode ? "authorized-lifecycle-history" : "authorized-assignment-history",
      reason: "",
      user: user,
      customer: asserted && asserted.customer || null,
      facility: asserted && asserted.facility || null,
      authorizedFacilities: authorizedFacilitiesForUser(configuration, user),
      deviceIds: deviceIds,
      units: units,
      enrollments: [],
      entitlements: entitlements,
      lifecycleMode: lifecycleMode
    };
  }

  function isDeviceAuthorized(scope, deviceId) {
    return Boolean(scope && scope.ok && scope.deviceIds.indexOf(deviceId) !== -1);
  }

  function intersectReportUnitIds(scope, requestedDeviceIds) {
    if (!scope || !scope.ok) {
      return [];
    }
    var allowed = new Set(scope.deviceIds);
    return (requestedDeviceIds || []).filter(function (deviceId) {
      return allowed.has(deviceId);
    });
  }

  function entitlementWindowsForDevice(scope, deviceId) {
    return (scope && scope.entitlements || []).filter(function (window) {
      return window.deviceId === deviceId;
    });
  }

  return {
    HISTORICAL_UNAVAILABLE: HISTORICAL_UNAVAILABLE,
    UNPROFILED_MESSAGE: UNPROFILED_MESSAGE,
    authorizedFacilitiesForUser: authorizedFacilitiesForUser,
    entitlementWindowsForDevice: entitlementWindowsForDevice,
    getCustomer: getCustomer,
    getEffectiveAssetScope: getEffectiveAssetScope,
    getFacility: getFacility,
    getHistoricalAssetScope: getHistoricalAssetScope,
    getUser: getUser,
    intersectReportUnitIds: intersectReportUnitIds,
    isCustomerUser: isCustomerUser,
    isDeviceAuthorized: isDeviceAuthorized,
    isFleetsourceAdministrator: isFleetsourceAdministrator
  };
}));
