(function (root, factory) {
  "use strict";

  var client = typeof module === "object" && module.exports
    ? require("./mygeotab-client") : root.SIQ_MYGEOTAB_CLIENT;
  var shiftPerformance = typeof module === "object" && module.exports
    ? require("../core/shift-performance") : root.SIQ_SHIFT_PERFORMANCE;
  var driverEvents = typeof module === "object" && module.exports
    ? require("./mygeotab-driver-events") : root.SIQ_MYGEOTAB_DRIVER_EVENTS;
  var managementReports = typeof module === "object" && module.exports
    ? require("../core/management-reports") : root.SIQ_MANAGEMENT_REPORTS;
  var api = factory(client, shiftPerformance, driverEvents, managementReports);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_MYGEOTAB_PERFORMANCE = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  client,
  shiftPerformance,
  driverEvents,
  managementReports
) {
  "use strict";

  var RESULT_LIMIT = 50000;
  var ADJUSTMENT_TIMEOUT_MS = 8000;
  var DIAGNOSTICS = Object.freeze({
    rpm: "DiagnosticEngineSpeedId",
    ignition: "DiagnosticIgnitionId",
    fifthWheel: "DiagnosticAux1Id",
    fuel: "DiagnosticTotalFuelUsedId",
    engineHours: "DiagnosticEngineHoursId",
    engineHoursAdjustment: "DiagnosticEngineHoursAdjustmentId"
  });

  function statusDataCall(deviceId, diagnosticId, startUtc, endUtc) {
    return ["Get", {
      typeName: "StatusData",
      search: {
        deviceSearch: { id: deviceId },
        diagnosticSearch: { id: diagnosticId },
        fromDate: startUtc,
        toDate: endUtc
      },
      resultsLimit: RESULT_LIMIT,
      sort: {
        sortBy: "date",
        sortDirection: "asc"
      }
    }];
  }

  function logRecordCall(deviceId, startUtc, endUtc) {
    return ["Get", {
      typeName: "LogRecord",
      search: {
        deviceSearch: { id: deviceId },
        fromDate: startUtc,
        toDate: endUtc
      },
      resultsLimit: RESULT_LIMIT,
      sort: {
        sortBy: "date",
        sortDirection: "asc"
      }
    }];
  }

  function rawValue(record, lower, upper) {
    return record && Object.prototype.hasOwnProperty.call(record, lower)
      ? record[lower] : record && record[upper];
  }

  function dedupe(records) {
    var byKey = new Map();
    (records || []).forEach(function (record) {
      var id = rawValue(record, "id", "Id");
      var time = rawValue(record, "dateTime", "DateTime");
      var data = rawValue(record, "data", "Data");
      var speed = rawValue(record, "speed", "Speed");
      var key = id || [time, data, speed].join("::");
      if (!byKey.has(key)) {
        byKey.set(key, record);
      }
    });
    return Array.from(byKey.values()).sort(function (left, right) {
      return Date.parse(rawValue(left, "dateTime", "DateTime"))
        - Date.parse(rawValue(right, "dateTime", "DateTime"));
    });
  }

  function withRange(call, startUtc, endUtc) {
    var copy = JSON.parse(JSON.stringify(call));
    copy[1].search.fromDate = startUtc;
    copy[1].search.toDate = endUtc;
    return copy;
  }

  function withTimeout(promise, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        var error = new Error("Optional engine-hours adjustment query timed out");
        error.code = "ENGINE_HOURS_ADJUSTMENT_TIMEOUT";
        reject(error);
      }, timeoutMs);
      promise.then(function (value) {
        clearTimeout(timer);
        resolve(value);
      }, function (error) {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  async function fetchComplete(api, call, startUtc, endUtc, initialBatch, depth) {
    var batch = Array.isArray(initialBatch)
      ? initialBatch : await client.call(api, call[0], call[1]);
    if (batch.length < RESULT_LIMIT) {
      return batch;
    }
    var startMs = Date.parse(startUtc);
    var endMs = Date.parse(endUtc);
    if (depth >= 16 || endMs - startMs <= 1000) {
      var error = new Error("Historical result limit reached after bounded chunking");
      error.code = "SHIFT_RESULT_LIMIT";
      throw error;
    }
    var midpointMs = startMs + Math.floor((endMs - startMs) / 2);
    var midpoint = new Date(midpointMs).toISOString();
    var left = await fetchComplete(
      api, withRange(call, startUtc, midpoint), startUtc, midpoint, null, depth + 1
    );
    var right = await fetchComplete(
      api, withRange(call, midpoint, endUtc), midpoint, endUtc, null, depth + 1
    );
    return dedupe(left.concat(right));
  }

  function querySpecs(devices, window) {
    var specs = [];
    (devices || []).forEach(function (device) {
      ["rpm", "ignition", "fuel", "engineHours", "engineHoursAdjustment"]
        .forEach(function (source) {
        specs.push({
          deviceId: device.deviceId,
          source: source,
          call: statusDataCall(
            device.deviceId, DIAGNOSTICS[source], window.startUtc, window.endUtc
          )
        });
        });
      if (device.fifthWheelCapabilityGroupMember === true) {
        specs.push({
          deviceId: device.deviceId,
          source: "fifthWheel",
          call: statusDataCall(
            device.deviceId, DIAGNOSTICS.fifthWheel, window.startUtc, window.endUtc
          )
        });
      }
      specs.push({
        deviceId: device.deviceId,
        source: "speed",
        call: logRecordCall(device.deviceId, window.startUtc, window.endUtc)
      });
    });
    return specs;
  }

  async function fetchShift(api, devices, window, options) {
    var adjustmentTimeoutMs = options
      && Number.isFinite(options.adjustmentTimeoutMs)
      && options.adjustmentTimeoutMs > 0
      ? options.adjustmentTimeoutMs : ADJUSTMENT_TIMEOUT_MS;
    var specs = querySpecs(devices, window);
    var requiredSpecs = specs.filter(function (spec) {
      return spec.source !== "engineHoursAdjustment";
    });
    var adjustmentSpecs = specs.filter(function (spec) {
      return spec.source === "engineHoursAdjustment";
    });
    var batches = await client.safeMultiCall(api, requiredSpecs.map(function (spec) {
      return spec.call;
    }));
    var complete = await Promise.all(batches.map(function (batch, index) {
      return fetchComplete(
        api,
        requiredSpecs[index].call,
        window.startUtc,
        window.endUtc,
        batch || [],
        0
      );
    }));
    var adjustmentComplete = adjustmentSpecs.map(function () { return []; });
    var adjustmentTrustworthy = adjustmentSpecs.length > 0;
    try {
      var adjustmentBatches = await withTimeout(
        client.multiCall(api, adjustmentSpecs.map(function (spec) {
          return spec.call;
        })),
        adjustmentTimeoutMs
      );
      adjustmentComplete = await Promise.all(adjustmentBatches.map(function (batch, index) {
        return fetchComplete(
          api,
          adjustmentSpecs[index].call,
          window.startUtc,
          window.endUtc,
          batch || [],
          0
        );
      }));
    } catch (error) {
      adjustmentTrustworthy = false;
    }
    var byDevice = new Map((devices || []).map(function (device) {
      return [device.deviceId, {
        rpm: [], ignition: [], fuel: [], engineHours: [], engineHoursAdjustment: [],
        engineHoursAdjustmentTrustworthy: adjustmentTrustworthy,
        fifthWheel: [],
        speed: [], driverEvents: []
      }];
    }));
    requiredSpecs.forEach(function (spec, index) {
      byDevice.get(spec.deviceId)[spec.source] = dedupe(complete[index]);
    });
    adjustmentSpecs.forEach(function (spec, index) {
      byDevice.get(spec.deviceId)[spec.source] = dedupe(adjustmentComplete[index]);
    });

    var driverResult;
    try {
      driverResult = await driverEvents.fetchAuthorizedDriverEvents(
        api,
        (devices || []).map(function (device) {
          return {
            deviceId: device.deviceId,
            fromDate: window.startUtc,
            toDate: window.endUtc
          };
        })
      );
    } catch (error) {
      driverResult = { events: [] };
    }
    (driverResult.events || []).forEach(function (event) {
      if (byDevice.has(event.deviceId)) {
        byDevice.get(event.deviceId).driverEvents.push(event);
      }
    });
    var units = (devices || []).map(function (device) {
      return shiftPerformance.analyzeUnit(device, byDevice.get(device.deviceId), window);
    });
    var reports = managementReports.build(devices, byDevice, units, window);
    return {
      ok: true,
      window: window,
      units: units,
      summary: shiftPerformance.facilitySummary(units, window),
      reports: reports,
      requests: specs.map(function (spec) {
        return {
          typeName: spec.call[1].typeName,
          deviceId: spec.deviceId,
          source: spec.source,
          startUtc: window.startUtc,
          endUtc: window.endUtc
        };
      })
    };
  }

  return {
    ADJUSTMENT_TIMEOUT_MS: ADJUSTMENT_TIMEOUT_MS,
    DIAGNOSTICS: DIAGNOSTICS,
    RESULT_LIMIT: RESULT_LIMIT,
    dedupe: dedupe,
    fetchComplete: fetchComplete,
    fetchShift: fetchShift,
    logRecordCall: logRecordCall,
    querySpecs: querySpecs,
    statusDataCall: statusDataCall,
    withTimeout: withTimeout
  };
}));
