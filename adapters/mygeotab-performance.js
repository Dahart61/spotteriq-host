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
  var engineHoursReport = typeof module === "object" && module.exports
    ? require("../core/engine-hours-report") : root.SIQ_ENGINE_HOURS_REPORT;
  var api = factory(
    client, shiftPerformance, driverEvents, managementReports, engineHoursReport
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_MYGEOTAB_PERFORMANCE = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  client,
  shiftPerformance,
  driverEvents,
  managementReports,
  engineHoursReport
) {
  "use strict";

  var RESULT_LIMIT = 50000;
  var ADJUSTMENT_TIMEOUT_MS = 8000;
  var DEFAULT_REPORT_CONCURRENCY = 3;
  var HIGH_FREQUENCY_CHUNK_MS = 24 * 60 * 60 * 1000;
  var REPORT_STATE_LOOKBACK_MS = 120000;
  var REPORT_HISTORY_LOOKBACK_MS =
    shiftPerformance.HISTORICAL_CONTINUITY_MAX_GAP_MS;
  var DIAGNOSTICS = Object.freeze({
    rpm: "DiagnosticEngineSpeedId",
    ignition: "DiagnosticIgnitionId",
    fifthWheel: "DiagnosticAux1Id",
    fuel: "DiagnosticTotalFuelUsedId",
    engineHours: "DiagnosticEngineHoursId",
    engineHoursAdjustment: "DiagnosticEngineHoursAdjustmentId"
  });
  var REPORT_SOURCE_PLANS = Object.freeze({
    overview: Object.freeze([
      "rpm", "ignition", "fuel", "engineHours",
      "fifthWheel", "speed", "driverEvents"
    ]),
    drivers: Object.freeze([
      "rpm", "ignition", "fifthWheel", "speed", "driverEvents"
    ]),
    trucks: Object.freeze([
      "rpm", "ignition", "fuel", "engineHours",
      "fifthWheel", "speed", "driverEvents"
    ]),
    engineHours: Object.freeze([
      "calculatedEngineHours"
    ]),
    moves: Object.freeze(["fifthWheel", "speed", "driverEvents"]),
    speed: Object.freeze(["speed", "driverEvents"])
  });

  function staleError() {
    var error = new Error("The report request was superseded");
    error.code = "REPORT_REQUEST_STALE";
    return error;
  }

  function assertCurrent(options) {
    if (options && typeof options.isStale === "function" && options.isStale()) {
      throw staleError();
    }
  }

  function yieldToBrowser() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

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

  function calculatedEngineHoursPointCall(deviceId, exactUtc) {
    return ["Get", {
      typeName: "StatusData",
      search: {
        deviceSearch: { id: deviceId },
        diagnosticSearch: { id: DIAGNOSTICS.engineHoursAdjustment },
        fromDate: exactUtc,
        toDate: exactUtc
      },
      resultsLimit: RESULT_LIMIT
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
        var error = new Error("Engine-hours meter query timed out");
        error.code = "ENGINE_HOURS_QUERY_TIMEOUT";
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

  async function fetchComplete(api, call, startUtc, endUtc, initialBatch, depth, options) {
    assertCurrent(options);
    if (!Array.isArray(initialBatch) && options && options.stats) {
      options.stats.apiCalls += 1;
    }
    var batch = Array.isArray(initialBatch)
      ? initialBatch : await client.call(api, call[0], call[1]);
    assertCurrent(options);
    if (options && options.stats) {
      options.stats.maxRecordsPerCall = Math.max(
        options.stats.maxRecordsPerCall, batch.length
      );
    }
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
      api, withRange(call, startUtc, midpoint), startUtc, midpoint, null, depth + 1,
      options
    );
    var right = await fetchComplete(
      api, withRange(call, midpoint, endUtc), midpoint, endUtc, null, depth + 1,
      options
    );
    return dedupe(left.concat(right));
  }

  function querySpecs(devices, window, reportType) {
    var specs = [];
    var sources = reportType && REPORT_SOURCE_PLANS[reportType]
      ? REPORT_SOURCE_PLANS[reportType] : null;
    if (reportType === "engineHours") {
      (devices || []).forEach(function (device) {
        [
          { source: "calculatedEngineHoursBegin", exactUtc: window.startUtc },
          { source: "calculatedEngineHoursEnd", exactUtc: window.endUtc }
        ].forEach(function (boundary) {
          specs.push({
            deviceId: device.deviceId,
            source: boundary.source,
            startUtc: boundary.exactUtc,
            endUtc: boundary.exactUtc,
            call: calculatedEngineHoursPointCall(device.deviceId, boundary.exactUtc)
          });
        });
      });
      return specs;
    }
    function required(source) {
      return !sources || sources.indexOf(source) !== -1;
    }
    var stateStartUtc = new Date(
      Date.parse(window.startUtc) - REPORT_STATE_LOOKBACK_MS
    ).toISOString();
    var historyStartUtc = new Date(
      Date.parse(window.startUtc) - REPORT_HISTORY_LOOKBACK_MS
    ).toISOString();
    (devices || []).forEach(function (device) {
      ["rpm", "ignition"].filter(required)
        .forEach(function (source) {
        specs.push({
          deviceId: device.deviceId,
          source: source,
          startUtc: historyStartUtc,
          endUtc: window.endUtc,
          call: statusDataCall(
            device.deviceId, DIAGNOSTICS[source], historyStartUtc, window.endUtc
          )
        });
        });
      ["fuel", "engineHours", "engineHoursAdjustment"].filter(required)
        .forEach(function (source) {
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
      if (required("fifthWheel") && device.fifthWheelCapabilityGroupMember === true) {
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
      if (required("speed")) {
        specs.push({
          deviceId: device.deviceId,
          source: "speed",
          startUtc: historyStartUtc,
          endUtc: window.endUtc,
          call: logRecordCall(device.deviceId, historyStartUtc, window.endUtc)
        });
      }
    });
    return specs;
  }

  function boundedChunks(spec) {
    if (["rpm", "ignition", "speed", "fifthWheel", "communication"]
      .indexOf(spec.source) === -1) {
      return [{ startUtc: spec.startUtc, endUtc: spec.endUtc, call: spec.call }];
    }
    var start = Date.parse(spec.startUtc);
    var end = Date.parse(spec.endUtc);
    var chunks = [];
    for (var cursor = start; cursor < end; cursor += HIGH_FREQUENCY_CHUNK_MS) {
      var chunkEnd = Math.min(end, cursor + HIGH_FREQUENCY_CHUNK_MS);
      var from = new Date(cursor).toISOString();
      var to = new Date(chunkEnd).toISOString();
      chunks.push({
        startUtc: from,
        endUtc: to,
        call: withRange(spec.call, from, to)
      });
    }
    return chunks;
  }

  async function mapBounded(items, concurrency, worker, options) {
    var results = new Array(items.length);
    var nextIndex = 0;
    async function run() {
      while (nextIndex < items.length) {
        assertCurrent(options);
        var index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index], index);
        if (options && typeof options.onProgress === "function") {
          options.onProgress(index + 1, items.length);
        }
        await yieldToBrowser();
      }
    }
    var workers = [];
    var count = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
    for (var index = 0; index < count; index += 1) {
      workers.push(run());
    }
    await Promise.all(workers);
    return results;
  }

  async function fetchSpecsBounded(api, specs, options) {
    var tasks = [];
    specs.forEach(function (spec, specIndex) {
      boundedChunks(spec).forEach(function (chunk) {
        tasks.push({ specIndex: specIndex, chunk: chunk });
      });
    });
    var records = specs.map(function () { return []; });
    var concurrency = options && Number.isFinite(options.maxConcurrency)
      ? options.maxConcurrency : DEFAULT_REPORT_CONCURRENCY;
    await mapBounded(tasks, concurrency, async function (task) {
      var chunkRecords = await fetchComplete(
        api,
        task.chunk.call,
        task.chunk.startUtc,
        task.chunk.endUtc,
        null,
        0,
        options
      );
      records[task.specIndex] = records[task.specIndex].concat(chunkRecords);
      if (options && options.stats) {
        options.stats.maxRawCollection = Math.max(
          options.stats.maxRawCollection, records[task.specIndex].length
        );
      }
    }, options);
    return records.map(dedupe);
  }

  async function fetchCalculatedEngineHours(api, devices, window, options) {
    options = options || {};
    var specs = querySpecs(devices, window, "engineHours");
    var timeoutMs = options && Number.isFinite(options.meterTimeoutMs)
      && options.meterTimeoutMs > 0 ? options.meterTimeoutMs : ADJUSTMENT_TIMEOUT_MS;
    var complete = await mapBounded(
      specs,
      options.maxConcurrency || DEFAULT_REPORT_CONCURRENCY,
      async function (spec) {
        assertCurrent(options);
        if (options.stats) { options.stats.apiCalls += 1; }
        try {
          var records = await withTimeout(
            client.call(api, spec.call[0], spec.call[1]), timeoutMs
          );
          assertCurrent(options);
          if (options.stats) {
            options.stats.maxRecordsPerCall = Math.max(
              options.stats.maxRecordsPerCall, records.length
            );
            options.stats.maxRawCollection = Math.max(
              options.stats.maxRawCollection, records.length
            );
          }
          return authorizedRecords(records, spec.deviceId);
        } catch (error) {
          if (error && error.code === "REPORT_REQUEST_STALE") { throw error; }
          return [];
        }
      },
      options
    );
    var byDevice = new Map((devices || []).map(function (device) {
      return [device.deviceId, {
        calculatedEngineHoursBegin: [],
        calculatedEngineHoursEnd: []
      }];
    }));
    specs.forEach(function (spec, index) {
      byDevice.get(spec.deviceId)[spec.source] = complete[index];
    });
    assertCurrent(options);
    var report = engineHoursReport.buildCalculated(devices, byDevice, window);
    return {
      ok: true,
      window: window,
      units: [],
      summary: {},
      reports: { engineHours: report },
      loadMetrics: Object.assign({}, options.stats),
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

  async function hydrateEngineHoursCarryForward(api, devices, byDevice, window, options) {
    assertCurrent(options);
    var candidates = (devices || []).filter(function (device) {
      var records = byDevice.get(device.deviceId).engineHours;
      return exactValid(records, window.startUtc) && !exactValid(records, window.endUtc);
    });
    var missingLatest = candidates.filter(function (device) {
      return !latestStored(byDevice.get(device.deviceId).engineHours, window.endUtc);
    });
    if (missingLatest.length) {
      try {
        var latestBatches = options && options.reportType
          ? await mapBounded(
            missingLatest,
            options.maxConcurrency || DEFAULT_REPORT_CONCURRENCY,
            function (device) {
              assertCurrent(options);
              if (options.stats) { options.stats.apiCalls += 1; }
              var call = latestStoredEngineHoursCall(device.deviceId, window.endUtc);
              return client.call(api, call[0], call[1]);
            },
            options
          )
          : await client.safeMultiCall(api, missingLatest.map(function (device) {
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
        if (error && error.code === "REPORT_REQUEST_STALE") { throw error; }
        // Carry-forward is optional and must fail closed without suppressing the report.
      }
    }
    assertCurrent(options);
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
      var complete;
      if (options && options.reportType) {
        complete = await fetchSpecsBounded(api, stateSpecs.map(function (spec) {
          return Object.assign({}, spec, { endUtc: window.endUtc });
        }), options);
      } else {
        var stateBatches = await client.safeMultiCall(api, stateSpecs.map(function (spec) {
          return spec.call;
        }));
        complete = await Promise.all(stateBatches.map(function (batch, index) {
          return fetchComplete(
            api, stateSpecs[index].call, stateSpecs[index].startUtc,
            window.endUtc, batch || [], 0
          );
        }));
      }
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
      if (error && error.code === "REPORT_REQUEST_STALE") { throw error; }
      // Missing or incomplete evidence leaves carry-forward unavailable.
    }
    assertCurrent(options);
    var reportSources = options && options.reportType
      && REPORT_SOURCE_PLANS[options.reportType];
    if (reportSources && reportSources.indexOf("engineHoursAdjustment") === -1) {
      // The live database does not expose this optional diagnostic. Report loads
      // fail closed as "Not available" instead of making rejected API calls.
      return;
    }
    try {
      var adjustmentCalls = evidenced.map(function (device) {
        var record = byDevice.get(device.deviceId).engineHoursCarryForward.latestStoredMeter;
        var startUtc = new Date(Date.parse(rawValue(record, "dateTime", "DateTime"))).toISOString();
        return statusDataCall(
          device.deviceId, DIAGNOSTICS.engineHoursAdjustment, startUtc, window.endUtc
        );
      });
      var adjustmentBatches = options && options.reportType
        ? await mapBounded(
          adjustmentCalls,
          options.maxConcurrency || DEFAULT_REPORT_CONCURRENCY,
          function (call) {
            assertCurrent(options);
            if (options.stats) { options.stats.apiCalls += 1; }
            return withTimeout(
              client.call(api, call[0], call[1]), ADJUSTMENT_TIMEOUT_MS
            );
          },
          options
        )
        : await withTimeout(
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
      if (error && error.code === "REPORT_REQUEST_STALE") { throw error; }
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
    var reportType = options && options.reportType;
    var sourcePlan = reportType && REPORT_SOURCE_PLANS[reportType];
    if (reportType && !sourcePlan) {
      throw new RangeError("Unsupported report type");
    }
    if (reportType) {
      options.stats = {
        apiCalls: 0,
        maxConcurrency: options.maxConcurrency || DEFAULT_REPORT_CONCURRENCY,
        maxRecordsPerCall: 0,
        maxRawCollection: 0
      };
    }
    assertCurrent(options);
    if (reportType === "engineHours") {
      return fetchCalculatedEngineHours(api, devices, window, options);
    }
    var specs = querySpecs(devices, window, reportType);
    var requiredSpecs = specs.filter(function (spec) {
      return spec.source !== "engineHoursAdjustment";
    });
    var adjustmentSpecs = specs.filter(function (spec) {
      return spec.source === "engineHoursAdjustment";
    });
    var complete;
    if (reportType) {
      complete = await fetchSpecsBounded(api, requiredSpecs, options);
    } else {
      var batches = await client.safeMultiCall(api, requiredSpecs.map(function (spec) {
        return spec.call;
      }));
      complete = await Promise.all(batches.map(function (batch, index) {
        return fetchComplete(
          api,
          requiredSpecs[index].call,
          requiredSpecs[index].startUtc,
          requiredSpecs[index].endUtc,
          batch || [],
          0
        );
      }));
    }
    var adjustmentComplete = adjustmentSpecs.map(function () { return []; });
    var adjustmentTrustworthy = adjustmentSpecs.length > 0;
    try {
      if (reportType) {
        adjustmentComplete = await mapBounded(
          adjustmentSpecs,
          options.maxConcurrency || DEFAULT_REPORT_CONCURRENCY,
          function (spec) {
            return withTimeout(fetchComplete(
              api,
              spec.call,
              spec.startUtc,
              spec.endUtc,
              null,
              0,
              options
            ), adjustmentTimeoutMs);
          },
          options
        );
      } else {
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
      }
    } catch (error) {
      if (error && error.code === "REPORT_REQUEST_STALE") { throw error; }
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

    await hydrateEngineHoursCarryForward(api, devices, byDevice, window, options);

    assertCurrent(options);
    var driverResult = { events: [] };
    if (!sourcePlan || sourcePlan.indexOf("driverEvents") !== -1) {
      try {
        driverResult = await driverEvents.fetchAuthorizedDriverEvents(
          api,
          (devices || []).map(function (device) {
            return {
              deviceId: device.deviceId,
              fromDate: window.startUtc,
              toDate: window.endUtc
            };
          }),
          null,
          options
        );
      } catch (error) {
        if (error && error.code === "REPORT_REQUEST_STALE") {
          throw error;
        }
        driverResult = { events: [] };
      }
    }
    (driverResult.events || []).forEach(function (event) {
      if (byDevice.has(event.deviceId)) {
        byDevice.get(event.deviceId).driverEvents.push(event);
      }
    });
    var units = [];
    for (var deviceIndex = 0; deviceIndex < (devices || []).length; deviceIndex += 1) {
      assertCurrent(options);
      var device = devices[deviceIndex];
      units.push(shiftPerformance.analyzeUnit(
        device, byDevice.get(device.deviceId), window, options
      ));
      if (reportType) {
        await yieldToBrowser();
      }
    }
    assertCurrent(options);
    var reports = managementReports.build(devices, byDevice, units, window);
    return {
      ok: true,
      window: window,
      units: units,
      summary: shiftPerformance.facilitySummary(units, window),
      reports: reports,
      loadMetrics: reportType ? Object.assign({}, options.stats) : null,
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
    DEFAULT_REPORT_CONCURRENCY: DEFAULT_REPORT_CONCURRENCY,
    DIAGNOSTICS: DIAGNOSTICS,
    HIGH_FREQUENCY_CHUNK_MS: HIGH_FREQUENCY_CHUNK_MS,
    REPORT_SOURCE_PLANS: REPORT_SOURCE_PLANS,
    RESULT_LIMIT: RESULT_LIMIT,
    REPORT_HISTORY_LOOKBACK_MS: REPORT_HISTORY_LOOKBACK_MS,
    REPORT_STATE_LOOKBACK_MS: REPORT_STATE_LOOKBACK_MS,
    authorizedRecords: authorizedRecords,
    calculatedEngineHoursPointCall: calculatedEngineHoursPointCall,
    dedupe: dedupe,
    fetchSpecsBounded: fetchSpecsBounded,
    fetchComplete: fetchComplete,
    fetchCalculatedEngineHours: fetchCalculatedEngineHours,
    fetchShift: fetchShift,
    hydrateEngineHoursCarryForward: hydrateEngineHoursCarryForward,
    latestStoredEngineHoursCall: latestStoredEngineHoursCall,
    logRecordCall: logRecordCall,
    querySpecs: querySpecs,
    statusDataCall: statusDataCall,
    withTimeout: withTimeout
  };
}));
