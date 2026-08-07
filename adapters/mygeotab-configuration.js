(function (root, factory) {
  "use strict";

  var diagnostics = typeof module === "object" && module.exports
    ? require("./mygeotab-diagnostics")
    : root.SIQ_MYGEOTAB_DIAGNOSTICS;
  var speedPolicies = typeof module === "object" && module.exports
    ? require("../core/speed-policies")
    : root.SIQ_SPEED_POLICIES;
  var api = factory(diagnostics, speedPolicies);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_MYGEOTAB_CONFIGURATION = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  diagnostics,
  speedPolicies
) {
  "use strict";

  var MODES = Object.freeze({
    FIXTURE: "fixture",
    LOCAL: "local",
    LIVE: "live"
  });
  var ROLES = Object.freeze({
    CUSTOMER_VIEWER: "Customer Viewer",
    CUSTOMER_MANAGER: "Customer Manager",
    FLEETSOURCE_ADMINISTRATOR: "Fleetsource Administrator"
  });

  function runtimeMode(search) {
    var query = typeof search === "string" ? search : "";
    var match = /(?:^|[?&])siqMode=(fixture|local|live)(?:&|$)/i.exec(query);
    if (!match) {
      return MODES.LIVE;
    }
    return match[1].toLowerCase();
  }

  function validateRefresh(refresh) {
    var values = refresh || {};
    var positive = [
      "operationalIntervalMs",
      "fuelDefIntervalMs",
      "engineHoursIntervalMs",
      "overlapWindowMs"
    ];
    return positive.every(function (key) {
      return Number.isFinite(values[key]) && values[key] > 0;
    }) && Array.isArray(values.backoffMs)
      && values.backoffMs.length > 0
      && values.backoffMs.every(function (value) {
        return Number.isFinite(value) && value > 0;
      });
  }

  function uniqueValues(values) {
    return new Set(values).size === values.length;
  }

  function validTimeZone(value) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
      return typeof value === "string" && value.indexOf("/") !== -1;
    } catch (error) {
      return false;
    }
  }

  function validateFacility(facility, configuration) {
    var errors = [];
    if (!facility || !facility.id || !facility.customerId || !facility.displayName) {
      errors.push("Facility identity is incomplete");
    }
    if (!facility || !facility.myGeotabGroupId || !facility.timezone) {
      errors.push("Facility MyGeotab group and timezone are required");
    }
    if (!Array.isArray(facility && facility.shiftProfiles)) {
      errors.push("Facility shiftProfiles must be an array");
    } else if (facility.shiftProfiles.length) {
      facility.shiftProfiles.forEach(function (profile) {
        if (!profile || !profile.id || profile.facilityId !== facility.id
          || profile.timezone !== facility.timezone
          || !/^\d{2}:\d{2}$/.test(profile.startLocalTime || "")
          || !/^\d{2}:\d{2}$/.test(profile.endLocalTime || "")
          || !Array.isArray(profile.activeWeekdays)
          || !profile.activeWeekdays.length
          || !profile.effectiveFrom) {
          errors.push("Facility shift profile configuration is invalid");
        }
      });
    }
    if (facility && !validTimeZone(facility.timezone)) {
      errors.push("Facility timezone must be an IANA timezone");
    }
    if (!facility || !facility.moveConfiguration
      || !facility.communicationFreshness) {
      errors.push("Facility move and communication configuration is required");
    }
    if (facility && facility.communicationFreshness) {
      var freshness = facility.communicationFreshness;
      if (![freshness.currentMs, freshness.delayedMs, freshness.staleMs].every(function (value) {
        return Number.isFinite(value) && value > 0;
      }) || freshness.currentMs > freshness.delayedMs
        || freshness.delayedMs > freshness.staleMs) {
        errors.push("Facility communication freshness configuration is invalid");
      }
    }
    if (facility && facility.moveConfiguration) {
      ["movementSpeedThresholdMph", "minimumMovementDurationMs"].forEach(function (key) {
        if (!Number.isFinite(facility.moveConfiguration[key])
          || facility.moveConfiguration[key] < 0) {
          errors.push("Facility move configuration is invalid");
        }
      });
      if (!Number.isFinite(facility.moveConfiguration.maximumReasonableMoveDurationMs)
        || facility.moveConfiguration.maximumReasonableMoveDurationMs <= 0
        || !facility.moveConfiguration.reportingBoundaryPolicy
        || !facility.moveConfiguration.missingDataPolicy
        || !facility.moveConfiguration.maximumDurationPolicy) {
        errors.push("Facility move configuration is invalid");
      }
    }
    if (!Array.isArray(facility && facility.speedPolicies)) {
      errors.push("Facility speedPolicies must be an array");
    } else {
      var policyValidation = speedPolicies.validateSpeedPolicies(
        facility.speedPolicies,
        facility.id
      );
      if (!policyValidation.ok) {
        errors.push("Facility speed policy configuration is invalid");
      }
    }
    if (!validateRefresh(facility && facility.refresh)) {
      errors.push("Facility refresh configuration is invalid");
    }
    var enrollmentByDeviceId = new Map((configuration.assetEnrollments || []).filter(function (item) {
      return item.facilityId === (facility && facility.id);
    }).map(function (item) {
      return [item.deviceId, item];
    }));
    Array.from(enrollmentByDeviceId.values()).forEach(function (enrollment) {
      var result = diagnostics.validateDiagnosticMappings(enrollment);
      errors = errors.concat(result.errors);
      var capability = enrollment.capability || {};
      [
        enrollment.driverIdentificationEnabled,
        capability.driverIdentificationSupported
      ].forEach(function (value) {
        if (value !== undefined && typeof value !== "boolean") {
          errors.push("Driver Identification capability configuration is invalid");
        }
      });
      [
        "movementSpeedThresholdMph",
        "engineOnRpmThreshold",
        "rpmFreshnessMs",
        "speedFreshnessMs"
      ].forEach(function (key) {
        if (!Number.isFinite(capability[key]) || capability[key] < 0
          || (/FreshnessMs$/.test(key) && capability[key] === 0)) {
          errors.push("Device capability configuration is invalid");
        }
      });
      if (enrollment.diagnosticMappings.fifthWheelStatus
        && (!Number.isFinite(capability.fifthWheelStatusFreshnessMs)
          || capability.fifthWheelStatusFreshnessMs <= 0)) {
        errors.push("Device Fifth Wheel Status freshness configuration is invalid");
      }
      if (diagnostics.channelEnabled(enrollment, "ignition")
        && (!Number.isFinite(capability.ignitionFreshnessMs)
          || capability.ignitionFreshnessMs <= 0
          || !Number.isInteger(capability.ignitionFreshnessMs))) {
        errors.push("Device ignition freshness configuration is invalid");
      }
    });
    return errors;
  }

  function validateProductionConfiguration(configuration) {
    var errors = [];
    if (!configuration || typeof configuration !== "object") {
      return { ok: false, errors: ["No production facility is configured"] };
    }
    ["customers", "facilities", "assetEnrollments", "users"].forEach(function (key) {
      if (!Array.isArray(configuration[key])) {
        errors.push(key + " must be an array");
      }
    });
    if (errors.length) {
      return { ok: false, errors: errors };
    }
    if (!configuration.customers.length || !configuration.facilities.length) {
      errors.push("No production facility is configured");
    }
    if (!configuration.users.length) {
      errors.push("No signed-in user mapping is configured");
    }
    configuration.facilities.forEach(function (facility) {
      errors = errors.concat(validateFacility(facility, configuration));
    });
    ["customers", "facilities"].forEach(function (key) {
      var ids = configuration[key].map(function (record) {
        return record && record.id;
      });
      if (ids.some(function (id) { return !id; }) || !uniqueValues(ids)) {
        errors.push(key + " IDs must be present and unique");
      }
    });
    var enrollmentKeys = configuration.assetEnrollments.map(function (record) {
      return record && record.facilityId + "::" + record.deviceId;
    });
    if (!uniqueValues(enrollmentKeys)) {
      errors.push("Asset enrollment device IDs must be unique per facility");
    }
    var userNames = configuration.users.map(function (user) {
      return String(user && user.myGeotabUserName || "").trim().toLowerCase();
    });
    if (userNames.some(function (name) { return !name; }) || !uniqueValues(userNames)) {
      errors.push("Signed-in user mappings must be present and unique");
    }
    return { ok: errors.length === 0, errors: errors };
  }

  function groupIdsFromState(state) {
    function normalize(value) {
      return (Array.isArray(value) ? value : []).map(function (group) {
        return typeof group === "string" ? group : (group && group.id);
      }).filter(Boolean);
    }
    if (!state) {
      return Promise.resolve([]);
    }
    if (typeof state.getGroupFilter === "function") {
      try {
        var result = state.getGroupFilter();
        return result && typeof result.then === "function"
          ? result.then(normalize)
          : Promise.resolve(normalize(result));
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return Promise.resolve(normalize(state.groupFilter || state.groups));
  }

  function signedInName(session) {
    return String(
      session && (
        session.userName
        || session.username
        || session.credentials && session.credentials.userName
      ) || ""
    ).trim().toLowerCase();
  }

  function resolveConfiguredUser(configuration, session) {
    var name = signedInName(session);
    if (!name) {
      return null;
    }
    return configuration.users.find(function (user) {
      return String(user.myGeotabUserName || "").trim().toLowerCase() === name;
    }) || null;
  }

  function resolveFacilitySelection(configuration, user, selectedGroupIds, explicitSelection) {
    if (!user) {
      return { ok: false, reason: "No authorized facilities", code: "missing-user" };
    }
    var allowed = new Set(user.authorizedFacilityIds || []);
    var facilities = configuration.facilities.filter(function (facility) {
      return allowed.has(facility.id)
        && (user.role === ROLES.FLEETSOURCE_ADMINISTRATOR
          || facility.customerId === user.customerId);
    });
    var selectedGroups = new Set(selectedGroupIds || []);
    var selected = facilities.filter(function (facility) {
      return selectedGroups.has(facility.myGeotabGroupId);
    });
    var isAdmin = user.role === ROLES.FLEETSOURCE_ADMINISTRATOR
      && user.canAdministerSpotterIQ === true;
    var facility = null;

    if (isAdmin) {
      var requestedCustomerId = explicitSelection && explicitSelection.customerId;
      var requestedFacilityId = explicitSelection && explicitSelection.facilityId;
      if (!requestedCustomerId || !requestedFacilityId) {
        return {
          ok: false,
          reason: "Select an authorized customer and facility",
          code: "administrator-selection-required"
        };
      }
      facility = selected.find(function (candidate) {
        return candidate.id === requestedFacilityId
          && candidate.customerId === requestedCustomerId;
      }) || null;
      if (!facility) {
        return {
          ok: false,
          reason: "No authorized assets",
          code: "administrator-selection-invalid"
        };
      }
    } else if (facilities.length === 1) {
      facility = facilities[0];
    } else if (selected.length === 1) {
      facility = selected[0];
    } else {
      return {
        ok: false,
        reason: "No authorized facilities",
        code: "facility-selection-required"
      };
    }

    var customer = configuration.customers.find(function (candidate) {
      return candidate.id === facility.customerId;
    });
    if (!customer) {
      return {
        ok: false,
        reason: "Invalid facility configuration",
        code: "invalid-configuration"
      };
    }
    return {
      ok: true,
      code: "configured-facility",
      customer: customer,
      facility: facility,
      user: user,
      selectedGroupIds: (selectedGroupIds || []).slice()
    };
  }

  function deploymentConfiguration(host) {
    var candidate = host && host.SIQ_DEPLOYMENT_CONFIG;
    var validation = validateProductionConfiguration(candidate);
    return {
      ok: validation.ok,
      configuration: validation.ok ? candidate : null,
      errors: validation.errors
    };
  }

  return {
    MODES: MODES,
    ROLES: ROLES,
    deploymentConfiguration: deploymentConfiguration,
    groupIdsFromState: groupIdsFromState,
    resolveConfiguredUser: resolveConfiguredUser,
    resolveFacilitySelection: resolveFacilitySelection,
    runtimeMode: runtimeMode,
    signedInName: signedInName,
    validateProductionConfiguration: validateProductionConfiguration
  };
}));
