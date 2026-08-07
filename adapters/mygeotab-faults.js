(function (root, factory) {
  "use strict";

  var client = typeof module === "object" && module.exports
    ? require("./mygeotab-client")
    : root.SIQ_MYGEOTAB_CLIENT;
  var faults = typeof module === "object" && module.exports
    ? require("../core/powertrain-faults")
    : root.SIQ_POWERTRAIN_FAULTS;
  var api = factory(client, faults);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_MYGEOTAB_FAULTS = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  client,
  faults
) {
  "use strict";

  function referenceId(value) {
    if (typeof value === "string") {
      return value;
    }
    return value && (value.id || value.Id) || null;
  }

  function property(record, lower, upper) {
    if (!record || typeof record !== "object") {
      return undefined;
    }
    return Object.prototype.hasOwnProperty.call(record, lower)
      ? record[lower] : record[upper];
  }

  function mergeCache(cache, records) {
    (Array.isArray(records) ? records : []).forEach(function (record) {
      var id = referenceId(record);
      if (id) {
        cache.set(id, record);
      }
    });
  }

  function cached(cache, ids) {
    return ids.map(function (id) {
      return cache.get(id);
    }).filter(Boolean);
  }

  function missing(cache, ids) {
    return ids.filter(function (id) {
      return !cache.has(id);
    });
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function createFaultDataAdapter() {
    var diagnosticCache = new Map();
    var controllerCache = new Map();

    async function getExactMetadata(api, typeName, ids, cache) {
      var required = missing(cache, unique(ids));
      if (!required.length) {
        return cached(cache, unique(ids));
      }
      var records = await client.call(api, "Get", {
        typeName: typeName,
        search: { ids: required },
        resultsLimit: required.length
      });
      if (!Array.isArray(records)) {
        return [];
      }
      var requiredIds = new Set(required);
      mergeCache(cache, records.filter(function (record) {
        return requiredIds.has(referenceId(record));
      }));
      return cached(cache, unique(ids));
    }

    async function fetchSelected(input) {
      if (!input || input.powertrainFaultMonitoringEnabled !== true) {
        return faults.unavailable("CAPABILITY_DISABLED");
      }
      var authorized = new Set(input.authorizedDeviceIds || []);
      if (!input.deviceId || !authorized.has(input.deviceId)
        || input.profileConfigured === false) {
        return faults.unavailable("DEVICE_NOT_AUTHORIZED_OR_PROFILED");
      }
      var configuration = input.faultConfiguration;
      if (!configuration || !Array.isArray(configuration.engineControllerIds)
        || !Array.isArray(configuration.transmissionControllerIds)) {
        return faults.unavailable("FAULT_CONFIGURATION_INVALID");
      }
      var nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
      var lookbackMs = Number.isFinite(input.lookbackMs)
        ? input.lookbackMs : faults.DEFAULT_LOOKBACK_MS;
      var fromDate = new Date(nowMs - lookbackMs).toISOString();
      var toDate = new Date(nowMs).toISOString();
      try {
        var records = await client.call(input.api, "Get", {
          typeName: "FaultData",
          search: {
            deviceSearch: { id: input.deviceId },
            fromDate: fromDate,
            toDate: toDate
          },
          resultsLimit: 5000,
          sort: { sortBy: "date", sortDirection: "asc" }
        });
        if (!Array.isArray(records)) {
          return faults.unavailable("MALFORMED_FAULT_DATA_RESPONSE");
        }
        if (records.length === 5000) {
          return faults.unavailable("FAULT_DATA_RESULT_LIMIT_REACHED");
        }
        var selectedRecords = records.filter(function (record) {
          return referenceId(property(record, "device", "Device"))
            === input.deviceId;
        });
        var controllerIds = unique(
          configuration.engineControllerIds.concat(
            configuration.transmissionControllerIds
          )
        );
        var allowedControllerIds = new Set(controllerIds);
        var diagnosticIds = unique(selectedRecords.filter(function (record) {
          var controllerId = referenceId(
            property(record, "controller", "Controller")
          );
          return !controllerId || allowedControllerIds.has(controllerId);
        }).map(function (record) {
          return referenceId(property(record, "diagnostic", "Diagnostic"));
        }));
        var metadata = await Promise.all([
          getExactMetadata(input.api, "Diagnostic", diagnosticIds,
            diagnosticCache),
          getExactMetadata(input.api, "Controller", controllerIds,
            controllerCache)
        ]);
        return faults.reconstruct({
          records: records,
          diagnostics: metadata[0],
          controllers: metadata[1],
          configuration: configuration,
          deviceId: input.deviceId,
          authorizedDeviceIds: Array.from(authorized),
          fetchedAt: toDate,
          nowMs: nowMs,
          freshnessMs: input.freshnessMs
        });
      } catch (error) {
        return faults.unavailable("FAULT_DATA_REQUEST_FAILED");
      }
    }

    return {
      fetchSelected: fetchSelected,
      snapshot: function () {
        return {
          diagnosticIds: Array.from(diagnosticCache.keys()),
          controllerIds: Array.from(controllerCache.keys())
        };
      }
    };
  }

  return {
    createFaultDataAdapter: createFaultDataAdapter
  };
}));
