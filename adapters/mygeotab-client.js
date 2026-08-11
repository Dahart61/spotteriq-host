(function (root, factory) {
  "use strict";

  var normalization = typeof module === "object" && module.exports
    ? require("./mygeotab-normalization")
    : root.SIQ_MYGEOTAB_NORMALIZATION;
  var diagnosticChannels = typeof module === "object" && module.exports
    ? require("../core/diagnostic-channels")
    : root.SIQ_DIAGNOSTIC_CHANNELS;
  var api = factory(normalization, diagnosticChannels);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_MYGEOTAB_CLIENT = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  normalization,
  diagnosticChannels
) {
  "use strict";

  var FIFTH_WHEEL_CAPABILITY_GROUP_NAME = "Fifth Wheel Sensor Equipped";

  function call(api, method, params) {
    return new Promise(function (resolve, reject) {
      if (!api || typeof api.call !== "function") {
        reject(new TypeError("An injected MyGeotab api.call function is required"));
        return;
      }
      api.call(method, params, resolve, reject);
    });
  }

  function multiCall(api, calls) {
    return new Promise(function (resolve, reject) {
      if (!api || typeof api.multiCall !== "function") {
        reject(new TypeError("MyGeotab api.multiCall is unavailable"));
        return;
      }
      api.multiCall(calls, resolve, reject);
    });
  }

  async function safeMultiCall(api, calls) {
    if (!calls.length) {
      return [];
    }
    try {
      return await multiCall(api, calls);
    } catch (error) {
      var results = [];
      for (var index = 0; index < calls.length; index += 1) {
        results.push(await call(api, calls[index][0], calls[index][1]));
      }
      return results;
    }
  }

  function getSession(api) {
    return new Promise(function (resolve, reject) {
      if (!api || typeof api.getSession !== "function") {
        reject(new TypeError("The signed-in MyGeotab session is unavailable"));
        return;
      }
      var settled = false;
      function succeed(value) {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      }
      function fail(error) {
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
      try {
        var result = api.getSession(succeed, fail);
        if (result && typeof result.then === "function") {
          result.then(succeed, fail);
        } else if (result && typeof result === "object") {
          succeed(result);
        }
      } catch (error) {
        fail(error);
      }
    });
  }

  function deviceGet(search) {
    return ["Get", {
      typeName: "Device",
      search: search,
      resultsLimit: 5000
    }];
  }

  function groupGet() {
    return ["Get", {
      typeName: "Group",
      resultsLimit: 5000,
      propertySelector: {
        fields: ["id", "name", "parent"],
        isIncluded: true
      }
    }];
  }

  function exactNamedGroup(groups, name) {
    var matches = (Array.isArray(groups) ? groups : []).filter(function (group) {
      return group && (group.name || group.Name) === name
        && normalization.referenceId(group.id || group.Id);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  async function resolveAuthorizedDevices(api, facility, selectedGroupIds) {
    if (!facility || !facility.myGeotabGroupId) {
      return [];
    }

    var facilityResults = await safeMultiCall(api, [deviceGet({
      groups: [{ id: facility.myGeotabGroupId }]
    })]);
    var facilityRecords = facilityResults[0] || [];
    var facilityDevices = (facilityRecords || []).map(function (record) {
      var device = normalization.normalizeDevice(record);
      return device ? Object.assign({}, device, {
        inConfiguredFacilityGroup: true,
        fifthWheelCapabilityGroupMember: false,
        fifthWheelCapabilityGroupId: null,
        fifthWheelCapabilityGroupName: FIFTH_WHEEL_CAPABILITY_GROUP_NAME
      }) : null;
    }).filter(Boolean);

    var capabilityGroup = null;
    try {
      var groupResults = await safeMultiCall(api, [groupGet()]);
      var groups = groupResults[0] || [];
      capabilityGroup = exactNamedGroup(
        groups,
        FIFTH_WHEEL_CAPABILITY_GROUP_NAME
      );
    } catch (error) {
      capabilityGroup = null;
    }
    if (!capabilityGroup) {
      return facilityDevices;
    }

    var capabilityGroupId = normalization.referenceId(
      capabilityGroup.id || capabilityGroup.Id
    );
    var capableIds = new Set();
    try {
      var capableResults = await safeMultiCall(api, [deviceGet({
        groups: [{ id: capabilityGroupId }]
      })]);
      var capableRecords = capableResults[0] || [];
      (capableRecords || []).forEach(function (record) {
        var deviceId = normalization.referenceId(record && (record.id || record.Id));
        if (deviceId) {
          capableIds.add(deviceId);
        }
      });
    } catch (error) {
      capableIds.clear();
    }
    facilityDevices.forEach(function (device) {
      device.fifthWheelCapabilityGroupMember = capableIds.has(device.deviceId);
      device.fifthWheelCapabilityGroupId = capabilityGroupId;
    });
    return facilityDevices;
  }

  function statusDataCall(deviceId, diagnosticId, fromDate, toDate) {
    return ["Get", {
      typeName: "StatusData",
      search: {
        deviceSearch: { id: deviceId },
        diagnosticSearch: { id: diagnosticId },
        fromDate: fromDate,
        toDate: toDate
      },
      resultsLimit: 50000
    }];
  }

  function diagnosticCalls(enrollments, channels, fromDate, toDate) {
    var calls = [];
    (enrollments || []).forEach(function (enrollment) {
      var mappings = enrollment.diagnosticMappings || {};
      (channels || []).forEach(function (channel) {
        var mapping = mappings[channel];
        if (mapping && mapping.diagnosticId
          && diagnosticChannels.channelEnabled(enrollment, channel)) {
          calls.push(statusDataCall(
            enrollment.deviceId,
            mapping.diagnosticId,
            fromDate,
            toDate
          ));
        }
      });
    });
    return calls;
  }

  async function getStatusData(api, enrollments, channels, fromDate, toDate) {
    var calls = diagnosticCalls(enrollments, channels, fromDate, toDate);
    var batches = await safeMultiCall(api, calls);
    return batches.reduce(function (all, batch) {
      return all.concat(batch || []);
    }, []);
  }

  function deviceStatusInfoCall(deviceId, diagnosticIds) {
    var search = { deviceSearch: { id: deviceId } };
    if (diagnosticIds && diagnosticIds.length) {
      search.diagnostics = diagnosticIds.slice(0, 200).map(function (id) {
        return { id: id };
      });
    }
    return ["Get", {
      typeName: "DeviceStatusInfo",
      search: search,
      resultsLimit: 5000
    }];
  }

  async function getDeviceStatusInfo(api, deviceIds, diagnosticIds) {
    var uniqueDeviceIds = Array.from(new Set(
      (Array.isArray(deviceIds) ? deviceIds : []).filter(function (id) {
        return typeof id === "string" && id.trim();
      })
    ));
    if (!uniqueDeviceIds.length) {
      return [];
    }
    var batches = await safeMultiCall(api, uniqueDeviceIds.map(function (deviceId) {
      return deviceStatusInfoCall(deviceId, diagnosticIds);
    }));
    return batches.reduce(function (all, batch) {
      return all.concat(batch || []);
    }, []);
  }

  function currentDriverUserCall(driverId) {
    return ["Get", {
      typeName: "User",
      search: { id: driverId },
      propertySelector: {
        fields: ["id", "firstName", "lastName", "isDriver"],
        isIncluded: true
      },
      resultsLimit: 1
    }];
  }

  async function getCurrentDriverUsers(api, driverIds) {
    var uniqueDriverIds = Array.from(new Set(
      (Array.isArray(driverIds) ? driverIds : []).filter(function (id) {
        return typeof id === "string" && id.trim();
      })
    ));
    if (!uniqueDriverIds.length) {
      return [];
    }
    var calls = uniqueDriverIds.map(currentDriverUserCall);
    var batches;
    try {
      batches = await multiCall(api, calls);
    } catch (error) {
      batches = await Promise.all(calls.map(function (request) {
        return call(api, request[0], request[1]).catch(function () { return []; });
      }));
    }
    return uniqueDriverIds.map(function (driverId, index) {
      return {
        driverId: driverId,
        record: (batches[index] || [])[0] || null
      };
    });
  }

  return {
    FIFTH_WHEEL_CAPABILITY_GROUP_NAME: FIFTH_WHEEL_CAPABILITY_GROUP_NAME,
    call: call,
    currentDriverUserCall: currentDriverUserCall,
    deviceStatusInfoCall: deviceStatusInfoCall,
    diagnosticCalls: diagnosticCalls,
    getCurrentDriverUsers: getCurrentDriverUsers,
    getDeviceStatusInfo: getDeviceStatusInfo,
    getSession: getSession,
    groupGet: groupGet,
    getStatusData: getStatusData,
    multiCall: multiCall,
    resolveAuthorizedDevices: resolveAuthorizedDevices,
    safeMultiCall: safeMultiCall,
    statusDataCall: statusDataCall
  };
}));
