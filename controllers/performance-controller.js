(function (root, factory) {
  "use strict";

  var shiftPerformance = typeof module === "object" && module.exports
    ? require("../core/shift-performance") : root.SIQ_SHIFT_PERFORMANCE;
  var performanceAdapter = typeof module === "object" && module.exports
    ? require("../adapters/mygeotab-performance") : root.SIQ_MYGEOTAB_PERFORMANCE;
  var timezone = typeof module === "object" && module.exports
    ? require("../core/timezone") : root.SIQ_TIMEZONE;
  var api = factory(shiftPerformance, performanceAdapter, timezone);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_PERFORMANCE_CONTROLLER = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  shiftPerformance,
  performanceAdapter,
  timezone
) {
  "use strict";

  function createPerformanceController(options) {
    var view = options.view;
    var context = null;
    var generation = 0;
    var inFlight = null;
    var inFlightKey = null;
    var inFlightSelectionKey = null;
    var cache = new Map();
    var lastSelection = null;
    var now = typeof options.now === "function" ? options.now : Date.now;
    var onApplied = typeof options.onApplied === "function"
      ? options.onApplied : function () {};

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

    function cacheKey(window) {
      return [
        context.facility.id,
        deviceKey(context.devices),
        window.startUtc,
        window.endUtc
      ].join("::");
    }

    function load(selection, force) {
      if (!context || !context.api || !context.facility || !context.devices.length) {
        return Promise.resolve(null);
      }
      var candidateSelection = selection || lastSelection;
      if (!candidateSelection) {
        view.showError("Choose a start and end date and time, then load the report");
        return Promise.resolve(null);
      }
      var selectionKey = [
        context.facility.id,
        deviceKey(context.devices),
        JSON.stringify(candidateSelection)
      ].join("::");
      if (inFlight && inFlightSelectionKey === selectionKey) {
        return inFlight;
      }
      var window;
      try {
        window = shiftPerformance.resolveWindow(
          candidateSelection, now(), context.facility.timezone
        );
      } catch (error) {
        view.showError(error.message);
        return Promise.resolve(null);
      }
      lastSelection = candidateSelection;
      var key = cacheKey(window);
      if (!force && cache.has(key)) {
        view.render(cache.get(key), context);
        onApplied(cache.get(key));
        return Promise.resolve(cache.get(key));
      }
      if (inFlight && inFlightKey === key) {
        return inFlight;
      }
      var requestGeneration = ++generation;
      inFlightKey = key;
      inFlightSelectionKey = selectionKey;
      view.showLoading(window, context);
      var request = performanceAdapter.fetchShift(
        context.api, context.devices, window
      ).then(function (result) {
        if (requestGeneration !== generation) {
          return Object.assign({}, result, { stale: true });
        }
        cache.set(key, result);
        view.render(result, context);
        onApplied(result);
        return result;
      }).catch(function (error) {
        if (requestGeneration === generation) {
          view.showError(error && error.message
            ? error.message : "The report could not be loaded");
        }
        return null;
      }).finally(function () {
        if (inFlight === request) {
          inFlight = null;
          inFlightKey = null;
          inFlightSelectionKey = null;
        }
      });
      inFlight = request;
      return request;
    }

    return {
      focus: function (nextContext) {
        var nextKey = nextContext && nextContext.facility
          ? nextContext.facility.id + "::" + deviceKey(nextContext.devices) : null;
        var priorKey = context && context.facility
          ? context.facility.id + "::" + deviceKey(context.devices) : null;
        context = nextContext;
        if (nextKey !== priorKey) {
          generation += 1;
          inFlight = null;
          inFlightKey = null;
          inFlightSelectionKey = null;
          cache.clear();
        }
        view.setContext(context);
      },
      load: load,
      open: function () {
        if (!context || !context.facility) {
          return Promise.resolve(null);
        }
        if (!lastSelection) {
          var initialSelection = todaySoFarSelection(
            now(), context.facility.timezone
          );
          if (typeof view.setSelection === "function") {
            view.setSelection(initialSelection);
          }
          return load(initialSelection, false);
        }
        return Promise.resolve(null);
      },
      refresh: function () { return load(null, true); },
      snapshot: function () {
        return {
          generation: generation,
          inFlight: Boolean(inFlight),
          inFlightKey: inFlightKey,
          cacheSize: cache.size,
          lastSelection: lastSelection
        };
      }
    };
  }

  return { createPerformanceController: createPerformanceController };
}));
