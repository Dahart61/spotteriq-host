(function (root, factory) {
  "use strict";

  var identity = typeof module === "object" && module.exports
    ? require("../core/addin-identity")
    : root.SIQ_ADDIN_IDENTITY;
  var facilityConfig = typeof module === "object" && module.exports
    ? require("../core/facility-config")
    : root.SIQ_FACILITY_CONFIG;
  var assetConfig = typeof module === "object" && module.exports
    ? require("../core/asset-profile-config")
    : root.SIQ_ASSET_PROFILE_CONFIG;
  var assetIdentity = typeof module === "object" && module.exports
    ? require("../core/asset-identity")
    : root.SIQ_ASSET_IDENTITY;
  var assetAssignments = typeof module === "object" && module.exports
    ? require("../core/asset-assignments")
    : root.SIQ_ASSET_ASSIGNMENTS;
  var reconciliation = typeof module === "object" && module.exports
    ? require("../core/group-reconciliation")
    : root.SIQ_GROUP_RECONCILIATION;
  var api = factory(
    identity,
    facilityConfig,
    assetConfig,
    assetIdentity,
    assetAssignments,
    reconciliation
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_ADDIN_DATA_CONFIG = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  addinIdentity,
  facilityConfig,
  assetConfig,
  assetIdentity,
  assetAssignments,
  reconciliation
) {
  "use strict";

  var ROLES = Object.freeze({
    CUSTOMER_VIEWER: "Customer Viewer",
    CUSTOMER_MANAGER: "Customer Manager",
    FLEETSOURCE_ADMINISTRATOR: "Fleetsource Administrator"
  });
  var AUTHORITY_RECORD_TYPE = "spotteriq-fleetsource-authority";
  var AUTHORITY_ID = "fleetsource-cross-customer-selection";
  var CROSS_CUSTOMER_SELECTION = "cross-customer-facility-selection";

  function apiCall(api, method, params) {
    return new Promise(function (resolve, reject) {
      if (!api || typeof api.call !== "function") {
        reject(new TypeError("The signed-in MyGeotab API is unavailable"));
        return;
      }
      api.call(method, params, resolve, reject);
    });
  }

  function referenceId(value) {
    return typeof value === "string" ? value : value && (value.id || value.Id);
  }

  function normalizeGroups(groups) {
    return (Array.isArray(groups) ? groups : []).map(referenceId).filter(Boolean);
  }

  function stateResult(code, message, extras) {
    return Object.assign({
      ok: false,
      code: code,
      message: message,
      records: [],
      authorizedRecords: [],
      findings: [],
      reconciliationFindings: [],
      configuration: null,
      selection: null,
      selectionOptions: null,
      authority: null
    }, extras || {});
  }

  function accessDenied(error) {
    var value = String(error
      && (error.code || error.name || error.message) || "").toLowerCase();
    return /access|denied|permission|security|clearance|unauthoriz/.test(value);
  }

  function detailsFrom(record) {
    if (!record) {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(record, "details")) {
      return record.details;
    }
    if (Object.prototype.hasOwnProperty.call(record, "Details")) {
      return record.Details;
    }
    return null;
  }

  function validateRecord(record) {
    var details = detailsFrom(record);
    if (!details) {
      return {
        ok: false,
        kind: "unknown",
        record: record,
        entityId: record && (record.id || record.Id) || null,
        findings: [{
          path: "details",
          code: "DETAILS_REQUIRED",
          message: "AddInData Details is required; legacy Data is not supported"
        }]
      };
    }
    var kind = details.recordType === facilityConfig.RECORD_TYPE
      ? "facility"
      : details.recordType === assetConfig.RECORD_TYPE
        ? "asset"
        : details.recordType === AUTHORITY_RECORD_TYPE
          ? "authority"
        : "unknown";
    var validation = kind === "facility"
      ? facilityConfig.validateFacilityDetails(details)
      : kind === "asset"
        ? assetConfig.validateAssetDetails(details)
        : kind === "authority"
          ? validateAuthorityDetails(details)
        : {
          ok: false,
          findings: [{
            path: "recordType",
            code: "INVALID_RECORD_TYPE",
            message: "Unknown SpotterIQ AddInData record type"
          }]
        };
    var groupIds = normalizeGroups(record.groups || record.Groups || []);
    var findings = validation.findings.slice();
    if (!groupIds.length) {
      findings.push({
        path: "groups",
        code: "GROUP_ASSOCIATION_REQUIRED",
        message: "AddInData must retain MyGeotab group security"
      });
    }
    if (kind === "facility" && details.facility
      && (groupIds.length !== 1
        || groupIds[0] !== details.facility.myGeotabGroupId)) {
      findings.push({
        path: "groups",
        code: "GROUP_SCOPE_MISMATCH",
        message: "Facility record Groups must contain only its configured facility group"
      });
    }
    if (kind === "authority" && details.authority
      && (groupIds.length !== 1
        || groupIds[0] !== details.authority.myGeotabGroupId)) {
      findings.push({
        path: "groups",
        code: "AUTHORITY_GROUP_SCOPE_MISMATCH",
        message: "Authority record Groups must contain only its dedicated Company Group"
      });
    }
    return {
      ok: validation.ok && findings.length === 0,
      kind: kind,
      record: {
        id: record.id || record.Id || null,
        groups: record.groups || record.Groups || [],
        details: details
      },
      entityId: record.id || record.Id || null,
      facilityId: kind === "facility" && details.facility
        ? details.facility.id : null,
      customerId: kind === "facility" && details.customer
        ? details.customer.id
        : kind === "asset" && details.asset
          ? details.asset.customerId : null,
      assetId: kind === "asset" && details.asset
        ? details.asset.assetId : null,
      groupIds: groupIds,
      findings: findings
    };
  }

  function validateAuthorityDetails(details) {
    var findings = [];
    var authority = details && details.authority;
    var capabilities = authority && authority.capabilities;
    if (!details || details.schemaVersion !== 2) {
      findings.push({
        path: "schemaVersion",
        code: "INVALID_AUTHORITY_SCHEMA_VERSION",
        message: "Authority schemaVersion must be 2"
      });
    }
    if (!authority || authority.id !== AUTHORITY_ID) {
      findings.push({
        path: "authority.id",
        code: "INVALID_AUTHORITY_ID",
        message: "Authority id is not recognized"
      });
    }
    if (!authority || typeof authority.myGeotabGroupId !== "string"
      || !authority.myGeotabGroupId) {
      findings.push({
        path: "authority.myGeotabGroupId",
        code: "AUTHORITY_GROUP_REQUIRED",
        message: "Authority requires its dedicated MyGeotab Company Group id"
      });
    }
    if (!Array.isArray(capabilities)
      || capabilities.length !== 1
      || capabilities[0] !== CROSS_CUSTOMER_SELECTION) {
      findings.push({
        path: "authority.capabilities",
        code: "INVALID_AUTHORITY_CAPABILITIES",
        message: "Authority may grant only cross-customer facility selection"
      });
    }
    if (authority && (authority.canCommissionSpotterIQ === true
      || authority.canWriteAddInData === true)) {
      findings.push({
        path: "authority",
        code: "COMMISSIONING_AUTHORITY_NOT_ALLOWED",
        message: "Cross-customer selection authority cannot grant AddInData write access"
      });
    }
    return { ok: findings.length === 0, findings: findings };
  }

  function duplicates(records, key) {
    var seen = new Set();
    return records.filter(function (record) {
      var value = record[key];
      if (!value || seen.has(value)) {
        return Boolean(value);
      }
      seen.add(value);
      return false;
    });
  }

  function explicitSelection(context) {
    var selection = context && context.explicitSelection || {};
    return {
      customerId: selection.customerId || null,
      facilityId: selection.facilityId || null
    };
  }

  function selectionOptions(records, selected, authority) {
    var customers = [];
    records.forEach(function (record) {
      if (!customers.some(function (customer) {
        return customer.id === record.customerId;
      })) {
        customers.push({
          id: record.customerId,
          displayName: record.record.details.customer.displayName
        });
      }
    });
    return {
      customers: customers,
      facilities: records.map(function (record) {
        return {
          id: record.facilityId,
          customerId: record.customerId,
          displayName: record.record.details.facility.displayName,
          myGeotabGroupId: record.record.details.facility.myGeotabGroupId
        };
      }),
      selectedCustomerId: selected.customerId,
      selectedFacilityId: selected.facilityId,
      showCustomerSelector: authority.canSelectAcrossCustomers === true,
      showFacilitySelector: authority.canSelectAcrossCustomers === true
        || records.length > 1
    };
  }

  function selectFacility(records, context, authority) {
    var selected = explicitSelection(context);
    var options = selectionOptions(records, selected, authority);
    if (authority.canSelectAcrossCustomers === true) {
      if (!selected.customerId || !selected.facilityId) {
        return stateResult("administrator-selection-required",
          "Select an authorized customer and facility.", {
            authorizedRecords: records,
            selectionOptions: options,
            authority: authority
          });
      }
    }
    if (selected.facilityId) {
      var match = records.find(function (record) {
        return record.facilityId === selected.facilityId
          && (!selected.customerId || record.customerId === selected.customerId);
      });
      return match
        ? { ok: true, selected: match, authorized: records }
        : stateResult("invalid-facility-selection",
          "No authorized customer and facility match the selection.", {
            authorizedRecords: records,
            selectionOptions: options,
            authority: authority
          });
    }
    if (records.length === 1) {
      return { ok: true, selected: records[0], authorized: records };
    }
    if (context && context.applyActiveGroupFilter === true
      && Array.isArray(context.activeGroupIds)
      && context.activeGroupIds.length) {
      var active = new Set(context.activeGroupIds);
      var activeMatches = records.filter(function (record) {
        return record.groupIds.some(function (groupId) {
          return active.has(groupId);
        });
      });
      if (activeMatches.length === 1) {
        return { ok: true, selected: activeMatches[0], authorized: records };
      }
    }
    return stateResult("facility-selection-required",
      "Select an authorized facility.", {
        authorizedRecords: records,
        selectionOptions: options,
        authority: authority
      });
  }

  function mergeRuntimeConfigurations(facilityRecords, assetRecords, context) {
    var timestamp = context && context.timestamp || new Date().toISOString();
    var combined = {
      customers: [],
      facilities: [],
      assetEnrollments: [],
      assetProfiles: [],
      users: [],
      units: [],
      reconciliationFindings: []
    };
    facilityRecords.forEach(function (validated) {
      var runtime = facilityConfig.toRuntimeConfiguration(
        validated.record.details,
        { activationTimestamp: timestamp }
      );
      runtime.customers.forEach(function (customer) {
        if (!combined.customers.some(function (item) {
          return item.id === customer.id;
        })) {
          combined.customers.push(customer);
        }
      });
      combined.facilities = combined.facilities.concat(runtime.facilities);
    });
    var facilityById = new Map(combined.facilities.map(function (facility) {
      return [facility.id, facility];
    }));
    var accessibleValues = context && (
      context.accessibleDeviceIds
      || context.userContext && context.userContext.accessibleDeviceIds
    );
    var accessible = Array.isArray(accessibleValues)
      ? new Set(accessibleValues) : null;
    var groupDevicesByFacility = context && context.groupDeviceIdsByFacility || {};

    assetRecords.forEach(function (validated) {
      var profile = validated.record.details.asset;
      var currentDevice = assetIdentity.resolveDeviceAssignment(profile, timestamp);
      var currentAssignment = assetAssignments.resolveAssignment(profile, timestamp);
      if (!currentDevice || !currentAssignment
        || !facilityById.has(currentAssignment.facilityId)) {
        return;
      }
      var groupDevices = groupDevicesByFacility[currentAssignment.facilityId];
      var inGroup = !Array.isArray(groupDevices)
        || groupDevices.indexOf(currentDevice.myGeotabDeviceId) !== -1;
      var apiAccessible = !accessible
        || accessible.has(currentDevice.myGeotabDeviceId);
      var reconciled = reconciliation.reconcileAsset({
        profile: profile,
        operatingAssignment: currentAssignment,
        deviceAssignment: currentDevice,
        currentDeviceId: currentDevice.myGeotabDeviceId,
        apiAccessible: apiAccessible,
        inFacilityGroup: inGroup
      });
      combined.reconciliationFindings.push({
        assetId: profile.assetId,
        facilityId: currentAssignment.facilityId,
        state: reconciled.state,
        severity: reconciled.severity,
        message: reconciled.message
      });
      if (!apiAccessible) {
        return;
      }
      var converted = assetConfig.toRuntimeAsset(
        validated.record.details, timestamp
      );
      converted.unit.groupReconciliation = reconciled;
      converted.enrollment.groupReconciliation = reconciled;
      combined.assetProfiles.push(profile);
      combined.assetEnrollments.push(converted.enrollment);
      combined.units.push(converted.unit);
      var facility = facilityById.get(currentAssignment.facilityId);
      facility.enrolledDeviceIds.push(currentDevice.myGeotabDeviceId);
    });
    return combined;
  }

  async function loadFacilityConfiguration(context) {
    var records;
    try {
      records = await apiCall(context && context.api, "Get", {
        typeName: "AddInData",
        search: { addInId: addinIdentity.SPOTTERIQ_V4_ADDIN_ID },
        resultsLimit: 5000
      });
    } catch (error) {
      return stateResult(
        accessDenied(error)
          ? "addin-data-access-denied" : "addin-data-query-failed",
        accessDenied(error)
          ? "SpotterIQ configuration access is not available."
          : "SpotterIQ configuration could not be loaded.",
        {
          errorCategory: accessDenied(error)
            ? "access-denied" : "query-failed"
        }
      );
    }
    records = Array.isArray(records) ? records : [];
    if (!records.length) {
      return stateResult("not-configured",
        "SpotterIQ is not configured for this facility.", {
          records: records
        });
    }
    var validated = records.map(validateRecord);
    var invalid = validated.filter(function (record) { return !record.ok; });
    var validFacilities = validated.filter(function (record) {
      return record.ok && record.kind === "facility";
    });
    var validAssets = validated.filter(function (record) {
      return record.ok && record.kind === "asset";
    });
    var validAuthorities = validated.filter(function (record) {
      return record.ok && record.kind === "authority";
    });
    if (invalid.some(function (record) {
      return record.findings.some(function (entry) {
        return entry.code === "LEGACY_SCHEMA_VERSION";
      });
    })) {
      return stateResult("legacy-schema-version",
        "SpotterIQ schema version 1 requires version 2 commissioning.", {
          records: records,
          findings: invalid,
          errorCategory: "validation"
        });
    }
    if (duplicates(validFacilities, "facilityId").length) {
      return stateResult("duplicate-facility-configuration",
        "Duplicate SpotterIQ facility configuration", {
          records: records,
          findings: invalid.concat(duplicates(validFacilities, "facilityId"))
        });
    }
    if (duplicates(validAssets, "assetId").length) {
      return stateResult("duplicate-asset-profile",
        "Duplicate SpotterIQ asset profile", {
          records: records,
          findings: invalid.concat(duplicates(validAssets, "assetId"))
      });
    }
    if (validAuthorities.length > 1) {
      return stateResult("duplicate-authority-record",
        "SpotterIQ Fleetsource authority is ambiguous.", {
          records: records,
          findings: invalid.concat(validAuthorities),
          errorCategory: "validation"
        });
    }
    var aggregateAssets = assetIdentity.validateAssetProfiles(
      validAssets.map(function (record) {
        return record.record.details.asset;
      })
    );
    if (!aggregateAssets.ok) {
      return stateResult("ambiguous-asset-configuration",
        "SpotterIQ asset identities or assignments conflict.", {
          records: records,
          findings: invalid.concat(aggregateAssets.findings),
          errorCategory: "validation"
        });
    }
    var authorityRecord = validAuthorities[0] || null;
    var authority = authorityRecord ? {
      role: ROLES.FLEETSOURCE_ADMINISTRATOR,
      canSelectAcrossCustomers: true,
      canCommissionSpotterIQ: false,
      recordId: authorityRecord.entityId,
      myGeotabGroupId:
        authorityRecord.record.details.authority.myGeotabGroupId
    } : {
      role: ROLES.CUSTOMER_VIEWER,
      canSelectAcrossCustomers: false,
      canCommissionSpotterIQ: false,
      recordId: null,
      myGeotabGroupId: null
    };
    var facilities = validFacilities.slice();
    if (!facilities.length) {
      return stateResult(
        invalid.length ? "invalid-facility-configuration" : "not-configured",
        invalid.length
          ? "SpotterIQ facility configuration requires commissioning."
          : "SpotterIQ is not configured for this facility.",
        {
          records: records,
          findings: invalid,
          errorCategory: invalid.length ? "validation" : null
        }
      );
    }
    var customerIdsForUser = new Set(facilities.map(function (record) {
      return record.customerId;
    }));
    if (!authority.canSelectAcrossCustomers && customerIdsForUser.size > 1) {
      return stateResult("cross-customer-authority-required",
        "SpotterIQ customer scope is ambiguous.", {
          records: records,
          findings: invalid,
          errorCategory: "authorization",
          authority: authority
        });
    }
    var selected = selectFacility(facilities, context || {}, authority);
    if (!selected.ok) {
      selected.records = records;
      selected.findings = invalid;
      return selected;
    }
    var facilityIds = new Set(selected.authorized.map(function (record) {
      return record.facilityId;
    }));
    var customerIds = new Set(selected.authorized.map(function (record) {
      return record.customerId;
    }));
    var customerAssets = validAssets.filter(function (record) {
      if (!customerIds.has(record.customerId)) {
        return false;
      }
      var profile = record.record.details.asset;
      var current = assetAssignments.resolveAssignment(profile,
        context.timestamp || new Date().toISOString());
      return current && facilityIds.has(current.facilityId);
    });
    var runtime = mergeRuntimeConfigurations(
      selected.authorized, customerAssets, context || {}
    );
    var selectedDetails = selected.selected.record.details;
    return {
      ok: true,
      code: "configured-facility",
      message: "",
      records: records,
      authorizedRecords: selected.authorized.concat(customerAssets),
      findings: invalid,
      reconciliationFindings: runtime.reconciliationFindings,
      configuration: runtime,
      selectionOptions: selectionOptions(
        selected.authorized,
        {
          customerId: selected.selected.customerId,
          facilityId: selected.selected.facilityId
        },
        authority
      ),
      authority: authority,
      selection: {
        ok: true,
        customer: runtime.customers.find(function (item) {
          return item.id === selectedDetails.customer.id;
        }),
        facility: runtime.facilities.find(function (item) {
          return item.id === selectedDetails.facility.id;
        }),
        user: Object.assign({}, context && context.userContext || {}, authority)
      },
      selectedRecord: selected.selected,
      errorCategory: invalid.length ? "validation" : null
    };
  }

  return {
    AUTHORITY_ID: AUTHORITY_ID,
    AUTHORITY_RECORD_TYPE: AUTHORITY_RECORD_TYPE,
    CROSS_CUSTOMER_SELECTION: CROSS_CUSTOMER_SELECTION,
    ROLES: ROLES,
    loadFacilityConfiguration: loadFacilityConfiguration,
    mergeRuntimeConfigurations: mergeRuntimeConfigurations,
    validateRecord: validateRecord
  };
}));
