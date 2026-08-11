(function (root, factory) {
  "use strict";

  var timezone = typeof module === "object" && module.exports
    ? require("../core/timezone") : root.SIQ_TIMEZONE;
  var api = factory(timezone);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_REPORTS_CONTROLLER = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (timezone) {
  "use strict";

  var REPORT_TYPES = Object.freeze([
    "overview", "drivers", "trucks", "moves", "speed"
  ]);

  function createReportsController(options) {
    var view = options.view;
    var performanceController = options.performanceController;
    var context = null;
    var generation = 0;
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

    function contextKey(value) {
      return value && value.facility
        ? value.facility.id + "::" + (value.devices || []).map(function (device) {
          return device.deviceId;
        }).sort().join(",")
        : null;
    }

    function load(selection, force) {
      if (!context || !context.facility) {
        return Promise.resolve(null);
      }
      if (!context.devices || !context.devices.length) {
        view.showError("This facility has no active authorized units.");
        return Promise.resolve(null);
      }
      var candidate = selection || lastSelection;
      if (!candidate) {
        candidate = todaySoFarSelection(now(), context.facility.timezone);
        view.setSelection(candidate);
      }
      lastSelection = candidate;
      var requestGeneration = generation;
      view.showLoading();
      return performanceController.load(candidate, Boolean(force)).then(function (result) {
        if (!result || result.stale || requestGeneration !== generation) {
          if (!result && requestGeneration === generation) {
            view.showError("The report could not be loaded.");
          }
          return result;
        }
        lastResult = result;
        view.render(result, context, selectedReport);
        return result;
      });
    }

    return {
      focus: function (nextContext) {
        if (contextKey(context) !== contextKey(nextContext)) {
          generation += 1;
          lastSelection = null;
          lastResult = null;
          view.clear();
        }
        context = nextContext;
        view.setContext(context);
      },
      clear: function () {
        generation += 1;
        context = null;
        lastSelection = null;
        lastResult = null;
        view.clear();
      },
      load: load,
      open: function () {
        if (lastResult) {
          view.render(lastResult, context, selectedReport);
          return Promise.resolve(lastResult);
        }
        return load(null, false);
      },
      refresh: function () {
        return load(null, true);
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
        if (REPORT_TYPES.indexOf(reportType) === -1) {
          return;
        }
        selectedReport = reportType;
        if (reportType === "moves" || reportType === "speed") {
          selectedEventReport = reportType;
        }
        view.setActiveReport(selectedReport);
        if (lastResult) {
          view.render(lastResult, context, selectedReport);
        }
      },
      snapshot: function () {
        return {
          generation: generation,
          lastSelection: lastSelection,
          selectedReport: selectedReport,
          selectedEventReport: selectedEventReport,
          hasResult: Boolean(lastResult)
        };
      }
    };
  }

  return {
    REPORT_TYPES: REPORT_TYPES,
    createReportsController: createReportsController
  };
}));
