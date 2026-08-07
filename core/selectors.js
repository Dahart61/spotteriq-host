(function (root, factory) {
  "use strict";

  var configurationApi = root.SIQ_CONFIGURATION;
  var authorizationApi = root.SIQ_AUTHORIZATION;
  var historicalApi = root.SIQ_HISTORICAL_ENTITLEMENT;
  if (!configurationApi && typeof require === "function") {
    configurationApi = require("./configuration");
  }
  if (!authorizationApi && typeof require === "function") {
    authorizationApi = require("./authorization");
  }
  if (!historicalApi && typeof require === "function") {
    historicalApi = require("./historical-entitlement");
  }

  var api = factory(configurationApi, authorizationApi, historicalApi);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_SELECTORS = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  configurationApi,
  authorizationApi,
  historicalEntitlement
) {
  "use strict";

  var ROLES = configurationApi.ROLES;

  function labelOptions(records) {
    return records.map(function (record) {
      return {
        value: record.id,
        label: record.displayName
      };
    });
  }

  function authorizedCustomersForUser(configuration, user) {
    var customerIds = new Set(authorizationApi.authorizedFacilitiesForUser(configuration, user).map(function (facility) {
      return facility.customerId;
    }));

    return configuration.customers.filter(function (customer) {
      return customerIds.has(customer.id);
    });
  }

  function facilitiesForCustomer(configuration, user, customerId) {
    return authorizationApi.authorizedFacilitiesForUser(configuration, user).filter(function (facility) {
      return facility.customerId === customerId;
    });
  }

  function initialSelectionForUser(configuration, user) {
    if (!user) {
      return {
        customerId: "",
        facilityId: ""
      };
    }

    if (user.role === ROLES.FLEETSOURCE_ADMINISTRATOR) {
      return {
        customerId: "",
        facilityId: ""
      };
    }

    var facilities = authorizationApi.authorizedFacilitiesForUser(configuration, user);
    if (!facilities.length) {
      return {
        customerId: user.customerId || "",
        facilityId: ""
      };
    }

    return {
      customerId: facilities[0].customerId,
      facilityId: facilities[0].id
    };
  }

  function shouldShowFacilitySelector(user, authorizedFacilities, selectedCustomerId) {
    if (!user) {
      return false;
    }
    if (user.role === ROLES.CUSTOMER_MANAGER) {
      return authorizedFacilities.length > 1;
    }
    if (user.role === ROLES.FLEETSOURCE_ADMINISTRATOR) {
      return Boolean(selectedCustomerId);
    }
    return false;
  }

  function canShowSettings(user) {
    return authorizationApi.isFleetsourceAdministrator(user);
  }

  function canOpenDetailDrawer(scope, deviceId) {
    return authorizationApi.isDeviceAuthorized(scope, deviceId);
  }

  function unitDetailCommercialFields(user, detail) {
    if (!user || user.role !== ROLES.FLEETSOURCE_ADMINISTRATOR
      || !detail || detail.advancedProfileConfigured === false) {
      return [];
    }
    var terms = detail.commercialTerms || {};
    if (detail.commercialConfigurationStatus === "NOT_CONFIGURED"
      || !terms.billingMode || terms.billingMode === "NOT_CONFIGURED") {
      return [];
    }

    function firstPresent() {
      for (var index = 0; index < arguments.length; index += 1) {
        var value = arguments[index];
        if (value !== null && value !== undefined && value !== "") {
          return value;
        }
      }
      return null;
    }

    function dateOnly(value) {
      return typeof value === "string"
        && /^\d{4}-\d{2}-\d{2}T/.test(value)
        ? value.slice(0, 10) : value;
    }

    return [
      ["Lease Start", dateOnly(firstPresent(terms.leaseStartDate, detail.leaseStart))],
      ["Lease End", dateOnly(terms.leaseEndDate)],
      ["Billing Start", dateOnly(terms.billingStartDate)],
      ["Billing End", dateOnly(terms.billingEndDate)],
      ["Billing Mode", terms.billingMode],
      ["Rate Code", terms.rateCode],
      ["Engine-hour rate", terms.engineHourRate],
      ["Calculated charges", detail.calculatedCharge],
      ["Included billable hours", terms.includedHours],
      ["Minimum billable hours", terms.minimumBillableHours],
      ["Maximum billable hours", terms.maximumBillableHours],
      ["Contract reference", terms.customerContractReference],
      ["Purchase-order reference", terms.customerPurchaseOrderReference],
      ["Billing facility", detail.billingFacility],
      ["Internal commercial notes", firstPresent(
        terms.internalCommercialNotes,
        terms.commercialNotes,
        detail.internalCommercialNotes
      )]
    ].filter(function (field) {
      return field[1] !== null && field[1] !== undefined && field[1] !== "";
    });
  }

  function operationsPresentation(unit) {
    var declared = unit && unit.performance && unit.performance.capabilities
      ? unit.performance.capabilities : {};
    var verifiedMovesAvailable = declared.verifiedMoves !== false
      && unit && unit.verifiedMovesLabel !== "Verified Moves Unavailable";
    var fifthWheelAvailable = declared.fifthWheelStatus !== false
      && verifiedMovesAvailable;
    var state = unit && unit.state || "Unknown";
    var stateKey = unit && unit.stateKey || "unknown-stale";

    if (!fifthWheelAvailable) {
      if (state === "Coupled Moving" || state === "Bobtail Moving") {
        state = "Engine On \u2014 Moving";
        stateKey = "engine-on-moving";
      } else if (state === "Coupled Idle" || state === "Bobtail Idle") {
        state = "Engine On \u2014 Stationary";
        stateKey = "engine-on-stationary";
      }
    }

    return {
      state: state,
      stateKey: stateKey,
      fifthWheelAvailable: fifthWheelAvailable,
      fifthWheelStatus: fifthWheelAvailable
        ? unit.fifthWheelStatus : "Fifth Wheel Status Unavailable",
      completedMoves: verifiedMovesAvailable && Number.isFinite(unit.moves)
        ? unit.moves : null,
      moveInProgress: verifiedMovesAvailable
        ? Boolean(unit.moveInProgress) : false,
      movesLabel: verifiedMovesAvailable
        ? String(unit.moves) + (unit.moveInProgress ? " + MIP" : "")
        : "Verified Moves Unavailable",
      verifiedMovesLabel: verifiedMovesAvailable
        ? (unit.verifiedMovesLabel || String(unit.moves))
        : "Verified Moves Unavailable",
      lastMove: verifiedMovesAvailable ? unit.lastMove : "Unavailable",
      recentMoves: verifiedMovesAvailable && Array.isArray(unit.recentMoves)
        ? unit.recentMoves : []
    };
  }

  function driverPresentation(unit) {
    var status = unit && unit.driverIdentificationStatus || "UNAVAILABLE";
    if (status === "IDENTIFIED") {
      return {
        status: status,
        current: unit.currentDriverDisplayName || "Identified driver",
        identifiedAt: unit.driverIdentifiedAt || null,
        label: unit.driverAttributionLabel || "Identified driver"
      };
    }
    if (status === "UNATTRIBUTED") {
      return {
        status: status,
        current: "Unattributed",
        identifiedAt: null,
        label: "Unattributed"
      };
    }
    if (status === "UNVERIFIED") {
      return {
        status: status,
        current: "Unverified",
        identifiedAt: null,
        label: "Driver Identification Unverified"
      };
    }
    return {
      status: "UNAVAILABLE",
      current: "Unavailable",
      identifiedAt: null,
      label: "Driver Identification Unavailable"
    };
  }

  function facilityHasShiftSchedule(facility) {
    if (!facility) {
      return false;
    }
    if (Array.isArray(facility.shiftProfiles)) {
      return facility.shiftProfiles.length > 0;
    }
    return Array.isArray(facility.shiftProfileIds)
      && facility.shiftProfileIds.length > 0;
  }

  function shiftControlState(facility, shifts, selectedValue) {
    var options = Array.isArray(shifts) ? shifts : [];
    if (!facilityHasShiftSchedule(facility)) {
      return {
        configured: false,
        options: [{ value: "all-activity", label: "Not configured" }],
        value: "all-activity"
      };
    }
    var selectedExists = options.some(function (option) {
      return option.value === selectedValue;
    });
    return {
      configured: true,
      options: options,
      value: selectedExists
        ? selectedValue : (options[0] ? options[0].value : "")
    };
  }

  function scopedMonthlyUsageFixture(usageFixture, scope, requestedDeviceIds) {
    var source = usageFixture || {};
    var allowedDeviceIds = authorizationApi.intersectReportUnitIds(
      scope,
      requestedDeviceIds
    );
    var allowedDeviceIdSet = new Set(allowedDeviceIds);
    var allowedAssetIds = new Set((scope && scope.units || []).filter(function (unit) {
      return allowedDeviceIdSet.has(unit.id);
    }).map(function (unit) {
      return unit.assetId;
    }).filter(Boolean));

    function scopedObject(records, clipPoints) {
      var result = {};
      Object.keys(records || {}).forEach(function (assetId) {
        if (allowedAssetIds.has(assetId)) {
          var windows = (scope.entitlements || []).filter(function (window) {
            return window.assetId === assetId;
          });
          result[assetId] = clipPoints
            ? historicalEntitlement.clipPointRecords(records[assetId], windows)
            : records[assetId];
        }
      });
      return result;
    }

    return Object.assign({}, source, {
      profiles: (source.profiles || []).filter(function (profile) {
        return allowedAssetIds.has(profile.assetId);
      }),
      readingsByAsset: scopedObject(source.readingsByAsset, true),
      adjustmentsByAsset: scopedObject(source.adjustmentsByAsset, false)
    });
  }

  return {
    labelOptions: labelOptions,
    authorizedCustomersForUser: authorizedCustomersForUser,
    facilitiesForCustomer: facilitiesForCustomer,
    initialSelectionForUser: initialSelectionForUser,
    shouldShowFacilitySelector: shouldShowFacilitySelector,
    canShowSettings: canShowSettings,
    canOpenDetailDrawer: canOpenDetailDrawer,
    unitDetailCommercialFields: unitDetailCommercialFields,
    operationsPresentation: operationsPresentation,
    driverPresentation: driverPresentation,
    facilityHasShiftSchedule: facilityHasShiftSchedule,
    shiftControlState: shiftControlState,
    scopedMonthlyUsageFixture: scopedMonthlyUsageFixture
  };
}));
