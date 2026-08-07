(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_GROUP_RECONCILIATION = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STATES = Object.freeze({
    MATCHED: "MATCHED",
    ASSIGNED_NOT_IN_GROUP: "ASSIGNED_NOT_IN_GROUP",
    IN_GROUP_NOT_ASSIGNED: "IN_GROUP_NOT_ASSIGNED",
    UNCONFIGURED_IN_GROUP: "UNCONFIGURED_IN_GROUP",
    PROFILE_WITHOUT_ACTIVE_ASSIGNMENT: "PROFILE_WITHOUT_ACTIVE_ASSIGNMENT",
    ASSIGNED_DEVICE_NOT_ACCESSIBLE: "ASSIGNED_DEVICE_NOT_ACCESSIBLE",
    DEVICE_ASSIGNMENT_MISMATCH: "DEVICE_ASSIGNMENT_MISMATCH"
  });

  function reconcileAsset(input) {
    if (!input.profile) {
      return {
        state: STATES.UNCONFIGURED_IN_GROUP,
        severity: "warning",
        operational: true,
        message: "Advanced SpotterIQ profile not configured"
      };
    }
    if (!input.operatingAssignment) {
      return {
        state: input.inFacilityGroup
          ? STATES.IN_GROUP_NOT_ASSIGNED
          : STATES.PROFILE_WITHOUT_ACTIVE_ASSIGNMENT,
        severity: "warning",
        operational: Boolean(input.inFacilityGroup && input.apiAccessible),
        message: "Advanced SpotterIQ profile has no active historical assignment."
      };
    }
    if (!input.deviceAssignment
      || input.deviceAssignment.myGeotabDeviceId !== input.currentDeviceId) {
      return {
        state: STATES.DEVICE_ASSIGNMENT_MISMATCH,
        severity: "error",
        operational: false,
        message: "Current telemetry device does not match the active asset assignment."
      };
    }
    if (!input.apiAccessible) {
      return {
        state: STATES.ASSIGNED_DEVICE_NOT_ACCESSIBLE,
        severity: "error",
        operational: false,
        message: "Live telemetry is unavailable because the assigned device is not accessible."
      };
    }
    if (!input.inFacilityGroup) {
      return {
        state: STATES.ASSIGNED_NOT_IN_GROUP,
        severity: "warning",
        operational: true,
        message: "SpotterIQ assignment is active, but facility group membership does not match."
      };
    }
    return {
      state: STATES.MATCHED,
      severity: "none",
      operational: true,
      message: ""
    };
  }

  function reconcileGroupDevices(profiles, groupDeviceIds, timestamp) {
    var configured = new Set();
    (profiles || []).forEach(function (profile) {
      (profile.deviceAssignments || []).forEach(function (assignment) {
        var start = Date.parse(assignment.installedAt);
        var end = assignment.removedAt ? Date.parse(assignment.removedAt) : Infinity;
        var instant = Date.parse(timestamp);
        if (start <= instant && instant < end) {
          configured.add(assignment.myGeotabDeviceId);
        }
      });
    });
    return (groupDeviceIds || []).filter(function (deviceId) {
      return !configured.has(deviceId);
    }).map(function (deviceId) {
      return {
        deviceId: deviceId,
        state: STATES.UNCONFIGURED_IN_GROUP,
        severity: "warning",
        operational: true,
        message: "Advanced SpotterIQ profile not configured"
      };
    });
  }

  return {
    STATES: STATES,
    reconcileAsset: reconcileAsset,
    reconcileGroupDevices: reconcileGroupDevices
  };
}));
