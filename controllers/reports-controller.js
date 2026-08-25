(function (root, factory) {
  "use strict";

  var shiftPerformance = typeof module === "object" && module.exports
    ? require("../core/shift-performance") : root.SIQ_SHIFT_PERFORMANCE;
  var reportsAdapter = typeof module === "object" && module.exports
    ? require("../adapters/mygeotab-performance") : root.SIQ_MYGEOTAB_PERFORMANCE;
  var timezone = typeof module === "object" && module.exports
    ? require("../core/timezone") : root.SIQ_TIMEZONE;
  var api = factory(shiftPerformance, reportsAdapter, timezone);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_REPORTS_CONTROLLER = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  shiftPerformance,
  reportsAdapter,
  timezone
) {
  "use strict";

  var REPORT_TYPES = Object.freeze([
    "overview", "drivers", "trucks", "engineHours", "moves", "speed"
  ]);
  var MAX_GENERAL_REPORT_MS = 7 * 24 * 60 * 60 * 1000;
  var LARGE_RANGE_MESSAGE =
    "This report covers a large amount of operating data. Please select a reporting period of 7 days or less.";
  var LOAD_ERROR_MESSAGE =
    "Report could not be completed. Try a shorter reporting period.";

  function monthSelection(nowMs, timeZone, previous) {
    var parts = timezone.zonedParts(nowMs, timeZone, false);
    var first = new Date(Date.UTC(parts.year, parts.month - 1, 1));
    var start = new Date(first.getTime());
    if (previous) {
      start.setUTCMonth(start.getUTCMonth() - 1);
    }
    function localDate(date) {
      return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0")
        + "-" + String(date.getUTCDate()).padStart(2, "0");
    }
    return { custom: {
      startDate: localDate(start),
      startTime: "00:00",
      endDate: previous ? localDate(first)
        : parts.year + "-" + String(parts.month).padStart(2, "0")
          + "-" + String(parts.day).padStart(2, "0"),
      endTime: previous ? "00:00"
        : String(parts.hour).padStart(2, "0") + ":" + String(parts.minute).padStart(2, "0")
    } };
  }

  function createReportsController(options) {
    var view = options.view;
    var dataSource = options.dataSource || reportsAdapter;
    var legacyPerformanceController = options.performanceController || null;
    var context = null;
    var generation = 0;
    var inFlight = null;
    var inFlightKey = null;
    var cache = new Map();
    var lastSelection = null;
    var lastResult = null;
    var selectedReport = "overview";
    var selectedEventReport = "moves";
    var now = typeof options.now === "function" ? options.now : Date.now;

    function pad2(value) {
      return String(value).padStart(2, "0");
    }

    function todaySoFarSelection(nowMs, timeZone) {
      var parts = timezone.zonedParts(nowMs, timeZone, false);
      var localDate = parts.year + "-" + pad2(parts.month) + "-" + pad2(parts.day);
      return {
        custom: {
          startDate: localDate,
          startTime: "00:00",
          endDate: localDate,
          endTime: pad2(parts.hour) + ":" + pad2(parts.minute)
        }
      };
    }

    function deviceKey(devices) {
      return (devices || []).map(function (device) {
        return device.deviceId;
      }).sort().join(",");
    }

    function contextKey(value) {
      return value && value.facility
        ? value.facility.id + "::" + deviceKey(value.devices) : null;
    }

    function resultKey(window, reportType) {
      return [
        context.facility.id,
        deviceKey(context.devices),
        reportType,
        window.startUtc,
        window.endUtc
      ].join("::");
    }

    function setReady(message) {
      if (typeof view.showReady === "function") {
        view.showReady(message);
      }
    }

    function invalidate(clearResult) {
      generation += 1;
      inFlight = null;
      inFlightKey = null;
      if (clearResult) {
        lastResult = null;
        setReady("Choose a reporting window, then select Load Report.");
      } else if (typeof view.setLoading === "function") {
        view.setLoading(false);
      }
    }

    function resolveSelection(selection) {
      return shiftPerformance.resolveWindow(
        selection, now(), context.facility.timezone
      );
    }

    function renderCachedSelection() {
      if (!context || !lastSelection) {
        return null;
      }
      try {
        var cached = cache.get(resultKey(resolveSelection(lastSelection), selectedReport));
        if (cached) {
          lastResult = cached;
          view.render(cached, context, selectedReport);
          return cached;
        }
      } catch (error) {
        return null;
      }
      return null;
    }

    function load(selection, force) {
      if (!context || !context.facility
        || !context.api && !legacyPerformanceController) {
        return Promise.resolve(null);
      }
      if (!context.devices || !context.devices.length) {
        view.showError("This facility has no active authorized units.");
        return Promise.resolve(null);
      }
      var candidate = selection || lastSelection;
      if (!candidate) {
        view.showError("Choose a start and end date and time, then load the report.");
        return Promise.resolve(null);
      }
      var window;
      try {
        window = resolveSelection(candidate);
      } catch (error) {
        view.showError(error.message);
        return Promise.resolve(null);
      }
      if (selectedReport !== "engineHours"
        && Date.parse(window.endUtc) - Date.parse(window.startUtc) > MAX_GENERAL_REPORT_MS) {
        view.showError(LARGE_RANGE_MESSAGE);
        return Promise.resolve(null);
      }
      var key = resultKey(window, selectedReport);
      if (inFlight && inFlightKey === key) {
        return inFlight;
      }
      lastSelection = candidate;
      if (!force && cache.has(key)) {
        lastResult = cache.get(key);
        view.render(lastResult, context, selectedReport);
        return Promise.resolve(lastResult);
      }
      var requestGeneration = ++generation;
      var reportType = selectedReport;
      inFlightKey = key;
      view.showLoading();
      if (typeof view.setLoading === "function") {
        view.setLoading(true);
      }
      var requestOptions = {
          facility: context.facility,
          reportType: reportType,
          maxConcurrency: 3,
          isStale: function () { return requestGeneration !== generation; },
          onProgress: function () {
            if (requestGeneration === generation
              && typeof view.showProgress === "function") {
              view.showProgress("Loading report data...");
            }
          }
        };
      var sourceRequest = legacyPerformanceController
        ? legacyPerformanceController.load(candidate, Boolean(force))
        : dataSource.fetchShift(
          context.api, context.devices, window, requestOptions
        );
      var request = sourceRequest.then(function (result) {
        if (!result || requestGeneration !== generation) {
          return result ? Object.assign({}, result, { stale: true }) : null;
        }
        cache.set(key, result);
        lastResult = result;
        view.render(result, context, reportType);
        return result;
      }).catch(function (error) {
        if (requestGeneration === generation
          && (!error || error.code !== "REPORT_REQUEST_STALE")) {
          view.showError(LOAD_ERROR_MESSAGE);
        }
        return null;
      }).finally(function () {
        if (inFlight === request) {
          inFlight = null;
          inFlightKey = null;
          if (typeof view.setLoading === "function") {
            view.setLoading(false);
          }
        }
      });
      inFlight = request;
      return request;
    }

    return {
      focus: function (nextContext) {
        if (contextKey(context) !== contextKey(nextContext)) {
          invalidate(true);
          cache.clear();
          lastSelection = null;
          if (typeof view.clear === "function") {
            view.clear();
          }
        }
        context = nextContext;
        view.setContext(context);
        if (context && context.facility && !lastSelection) {
          lastSelection = todaySoFarSelection(now(), context.facility.timezone);
          view.setSelection(lastSelection);
        }
      },
      clear: function () {
        invalidate(true);
        context = null;
        lastSelection = null;
        cache.clear();
        if (typeof view.clear === "function") {
          view.clear();
        }
      },
      close: function () {
        invalidate(false);
      },
      invalidateSelection: function () {
        invalidate(true);
        lastSelection = null;
      },
      load: load,
      open: function () {
        if (!context || !context.facility) {
          return Promise.resolve(null);
        }
        var cached = renderCachedSelection();
        if (!cached) {
          setReady("Choose a reporting window, then select Load Report.");
        }
        return Promise.resolve(cached);
      },
      refresh: function () {
        return load(null, true);
      },
      currentMonth: function () {
        if (!context || !context.facility) {
          return Promise.resolve(null);
        }
        var selection = monthSelection(now(), context.facility.timezone, false);
        view.setSelection(selection);
        return load(selection, false);
      },
      previousMonth: function () {
        if (!context || !context.facility) {
          return Promise.resolve(null);
        }
        var selection = monthSelection(now(), context.facility.timezone, true);
        view.setSelection(selection);
        return load(selection, false);
      },
      printReport: function () {
        if (!lastResult || !context) {
          return false;
        }
        return view.printReport(lastResult, context, selectedReport);
      },
      exportCsv: function () {
        if (!lastResult || !context) {
          return false;
        }
        return view.exportCsv(lastResult, context, selectedReport);
      },
      selectReport: function (reportType) {
        if (reportType === "events") {
          reportType = selectedEventReport;
        }
        if (REPORT_TYPES.indexOf(reportType) === -1 || reportType === selectedReport) {
          return;
        }
        invalidate(true);
        selectedReport = reportType;
        if (reportType === "moves" || reportType === "speed") {
          selectedEventReport = reportType;
        }
        view.setActiveReport(selectedReport);
        renderCachedSelection();
      },
      snapshot: function () {
        return {
          generation: generation,
          inFlight: Boolean(inFlight),
          inFlightKey: inFlightKey,
          cacheSize: cache.size,
          lastSelection: lastSelection,
          selectedReport: selectedReport,
          selectedEventReport: selectedEventReport,
          hasResult: Boolean(lastResult)
        };
      }
    };
  }

  return {
    LARGE_RANGE_MESSAGE: LARGE_RANGE_MESSAGE,
    MAX_GENERAL_REPORT_MS: MAX_GENERAL_REPORT_MS,
    REPORT_TYPES: REPORT_TYPES,
    createReportsController: createReportsController,
    monthSelection: monthSelection
  };
}));
