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
  var REPORT_STATE_LOOKBACK_MS = 120000;
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

  function latestStoredEngineHoursCall(deviceId, endUtc) {
    return ["Get", {
      typeName: "StatusData",
      search: {
        deviceSearch: { id: deviceId },
        diagnosticSearch: { id: DIAGNOSTICS.engineHours },
        toDate: endUtc
      },
      resultsLimit: 100,
      sort: {
        sortBy: "date",
        sortDirection: "desc"
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

  function authorizedRecords(records, deviceId) {
    return (records || []).filter(function (record) {
      var device = rawValue(record, "device", "Device");
      var recordDeviceId = device && rawValue(device, "id", "Id");
      return !recordDeviceId || recordDeviceId === deviceId;
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
    var stateStartUtc = new Date(
      Date.parse(window.startUtc) - REPORT_STATE_LOOKBACK_MS
    ).toISOString();
    (devices || []).forEach(function (device) {
      ["rpm", "ignition"]
        .forEach(function (source) {
        specs.push({
          deviceId: device.deviceId,
          source: source,
          startUtc: stateStartUtc,
          endUtc: window.endUtc,
          call: statusDataCall(
            device.deviceId, DIAGNOSTICS[source], stateStartUtc, window.endUtc
          )
        });
        });
      ["fuel", "engineHours", "engineHoursAdjustment"].forEach(function (source) {
        specs.push({
          deviceId: device.deviceId,
          source: source,
          startUtc: window.startUtc,
          endUtc: window.endUtc,
          call: statusDataCall(
            device.deviceId, DIAGNOSTICS[source], window.startUtc, window.endUtc
          )
        });
      });
      if (device.fifthWheelCapabilityGroupMember === true) {
        specs.push({
          deviceId: device.deviceId,
          source: "fifthWheel",
          startUtc: stateStartUtc,
          endUtc: window.endUtc,
          call: statusDataCall(
            device.deviceId, DIAGNOSTICS.fifthWheel, stateStartUtc, window.endUtc
          )
        });
      }
      specs.push({
        deviceId: device.deviceId,
        source: "speed",
        startUtc: stateStartUtc,
        endUtc: window.endUtc,
        call: logRecordCall(device.deviceId, stateStartUtc, window.endUtc)
      });
    });
    return specs;
  }

  function exactValid(records, exactUtc) {
    var expected = Date.parse(exactUtc);
    var matches = (records || []).filter(function (record) {
      return Date.parse(rawValue(record, "dateTime", "DateTime")) === expected;
    });
    if (!matches.length) {
      return false;
    }
    var values = matches.map(function (record) {
      var raw = rawValue(record, "data", "Data");
      return raw === null || raw === "" || typeof raw === "boolean" ? NaN : Number(raw);
    });
    return values.every(function (value) {
      return Number.isFinite(value) && value >= 0 && value === values[0];
    });
  }

  function latestStored(records, endUtc) {
    var end = Date.parse(endUtc);
    return (records || []).filter(function (record) {
      var id = rawValue(record, "id", "Id");
      var time = Date.parse(rawValue(record, "dateTime", "DateTime"));
      var raw = rawValue(record, "data", "Data");
      var value = raw === null || raw === "" || typeof raw === "boolean" ? NaN : Number(raw);
      return typeof id === "string" && id.trim() && Number.isFinite(time)
        && time <= end && Number.isFinite(value) && value >= 0;
    }).sort(function (left, right) {
      return Date.parse(rawValue(right, "dateTime", "DateTime"))
        - Date.parse(rawValue(left, "dateTime", "DateTime"));
    })[0] || null;
  }

  async function hydrateEngineHoursCarryForward(api, devices, byDevice, window) {
    var candidates = (devices || []).filter(function (device) {
      var records = byDevice.get(device.deviceId).engineHours;
      return exactValid(records, window.startUtc) && !exactValid(records, window.endUtc);
    });
    var missingLatest = candidates.filter(function (device) {
      return !latestStored(byDevice.get(device.deviceId).engineHours, window.endUtc);
    });
    if (missingLatest.length) {
      try {
        var latestBatches = await client.safeMultiCall(api, missingLatest.map(function (device) {
          return latestStoredEngineHoursCall(device.deviceId, window.endUtc);
        }));
        missingLatest.forEach(function (device, index) {
          var record = latestStored(
            authorizedRecords(latestBatches[index], device.deviceId), window.endUtc
          );
          if (record) {
            byDevice.get(device.deviceId).engineHoursCarryForward = {
              latestStoredMeter: record,
              operationEvidence: null
            };
          }
        });
      } catch (error) {
        // Carry-forward is optional and must fail closed without suppressing the report.
      }
    }
    candidates.forEach(function (device) {
      var data = byDevice.get(device.deviceId);
      if (!data.engineHoursCarryForward) {
        var record = latestStored(data.engineHours, window.endUtc);
        if (record) {
          data.engineHoursCarryForward = {
            latestStoredMeter: record,
            operationEvidence: null
          };
        }
      }
    });
    var evidenced = candidates.filter(function (device) {
      return Boolean(byDevice.get(device.deviceId).engineHoursCarryForward);
    });
    if (!evidenced.length) {
      return;
    }
    var stateSpecs = [];
    evidenced.forEach(function (device) {
      var record = byDevice.get(device.deviceId).engineHoursCarryForward.latestStoredMeter;
      var startUtc = new Date(Date.parse(rawValue(record, "dateTime", "DateTime"))).toISOString();
      ["rpm", "ignition", "communication"].forEach(function (source) {
        stateSpecs.push({
          deviceId: device.deviceId,
          source: source,
          startUtc: startUtc,
          call: source === "communication"
            ? logRecordCall(device.deviceId, startUtc, window.endUtc)
            : statusDataCall(device.deviceId, DIAGNOSTICS[source], startUtc, window.endUtc)
        });
      });
    });
    try {
      var stateBatches = await client.safeMultiCall(api, stateSpecs.map(function (spec) {
        return spec.call;
      }));
      var complete = await Promise.all(stateBatches.map(function (batch, index) {
        return fetchComplete(
          api, stateSpecs[index].call, stateSpecs[index].startUtc,
          window.endUtc, batch || [], 0
        );
      }));
      evidenced.forEach(function (device) {
        var specs = stateSpecs.map(function (spec, index) {
          return {
            spec: spec,
            records: authorizedRecords(complete[index], spec.deviceId)
          };
        }).filter(function (entry) {
          return entry.spec.deviceId === device.deviceId;
        });
        var rpm = specs.find(function (entry) { return entry.spec.source === "rpm"; });
        var ignition = specs.find(function (entry) { return entry.spec.source === "ignition"; });
        var communication = specs.find(function (entry) {
          return entry.spec.source === "communication";
        });
        var carry = byDevice.get(device.deviceId).engineHoursCarryForward;
        carry.operationEvidence = shiftPerformance.zeroEngineOperationEvidence(
          rpm ? rpm.records : [], ignition ? ignition.records : [],
          communication ? communication.records : [],
          rpm ? rpm.spec.startUtc : null, window.endUtc
        );
      });
    } catch (error) {
      // Missing or incomplete evidence leaves carry-forward unavailable.
    }
    try {
      var adjustmentCalls = evidenced.map(function (device) {
        var record = byDevice.get(device.deviceId).engineHoursCarryForward.latestStoredMeter;
        var startUtc = new Date(Date.parse(rawValue(record, "dateTime", "DateTime"))).toISOString();
        return statusDataCall(
          device.deviceId, DIAGNOSTICS.engineHoursAdjustment, startUtc, window.endUtc
        );
      });
      var adjustmentBatches = await withTimeout(
        client.multiCall(api, adjustmentCalls), ADJUSTMENT_TIMEOUT_MS
      );
      evidenced.forEach(function (device, index) {
        var data = byDevice.get(device.deviceId);
        data.engineHoursAdjustment = dedupe(
          data.engineHoursAdjustment.concat(
            authorizedRecords(adjustmentBatches[index], device.deviceId)
          )
        );
      });
    } catch (error) {
      evidenced.forEach(function (device) {
        byDevice.get(device.deviceId).engineHoursAdjustmentTrustworthy = false;
      });
    }
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
        requiredSpecs[index].startUtc,
        requiredSpecs[index].endUtc,
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
          adjustmentSpecs[index].startUtc,
          adjustmentSpecs[index].endUtc,
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
      byDevice.get(spec.deviceId)[spec.source] = dedupe(
        authorizedRecords(complete[index], spec.deviceId)
      );
    });
    adjustmentSpecs.forEach(function (spec, index) {
      byDevice.get(spec.deviceId)[spec.source] = dedupe(
        authorizedRecords(adjustmentComplete[index], spec.deviceId)
      );
    });

    await hydrateEngineHoursCarryForward(api, devices, byDevice, window);

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
      return shiftPerformance.analyzeUnit(
        device, byDevice.get(device.deviceId), window, options
      );
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
          startUtc: spec.startUtc,
          endUtc: spec.endUtc
        };
      })
    };
  }

  return {
    ADJUSTMENT_TIMEOUT_MS: ADJUSTMENT_TIMEOUT_MS,
    DIAGNOSTICS: DIAGNOSTICS,
    RESULT_LIMIT: RESULT_LIMIT,
    REPORT_STATE_LOOKBACK_MS: REPORT_STATE_LOOKBACK_MS,
    authorizedRecords: authorizedRecords,
    dedupe: dedupe,
    fetchComplete: fetchComplete,
    fetchShift: fetchShift,
    hydrateEngineHoursCarryForward: hydrateEngineHoursCarryForward,
    latestStoredEngineHoursCall: latestStoredEngineHoursCall,
    logRecordCall: logRecordCall,
    querySpecs: querySpecs,
    statusDataCall: statusDataCall,
    withTimeout: withTimeout
  };
}));
