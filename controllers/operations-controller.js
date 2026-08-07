(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_OPERATIONS_CONTROLLER = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var ENGINE_HEALTH_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  var ACTIVE_OPERATIONS_REFRESH_INTERVAL_MS = 5000;

  function defaultClock() {
    return {
      now: function () { return Date.now(); },
      setTimeout: function (callback, delay) { return setTimeout(callback, delay); },
      clearTimeout: function (id) { clearTimeout(id); }
    };
  }

  function runtimeFailureCategory(error) {
    if (error && error.code) {
      return error.code;
    }
    var name = String(error && error.name || "").toUpperCase();
    var message = String(error && error.message || "");
    var missingProperty = message.match(
      /Cannot read properties of (?:undefined|null) \(reading '([A-Za-z0-9_]+)'\)/
    );
    if (missingProperty) {
      return "MISSING_PROPERTY_" + missingProperty[1].toUpperCase();
    }
    if (/is not a function/.test(message)) {
      return "MISSING_FUNCTION";
    }
    return name === "TYPEERROR" ? "TYPE_ERROR"
      : name === "RANGEERROR" ? "RANGE_ERROR"
        : name === "ERROR" ? "RUNTIME_ERROR"
          : "UNEXPECTED_RUNTIME_FAILURE";
  }

  function createOperationsController(options) {
    var dataSource = options.dataSource;
    var view = options.view;
    var clock = options.clock || defaultClock();
    var logger = options.logger || {
      info: function () {},
      error: function () {}
    };
    var onStatus = typeof options.onStatus === "function"
      ? options.onStatus
      : function () {};
    var state = {
      active: false,
      visible: true,
      generation: 0,
      sequence: 0,
      appliedSequence: 0,
      context: null,
      requestedScopeKey: null,
      loadedScopeKey: null,
      timerId: null,
      inFlight: null,
      pendingInitial: false,
      selectedDeviceId: null,
      healthGeneration: 0,
      healthInFlight: null,
      healthRequestDeviceId: null,
      lastHealthAt: null,
      failureLevel: 0,
      lastSuccessAt: null,
      latestFleetDataAt: null,
      laneLastAt: {
        operational: null,
        fuelDef: null,
        engineHours: null
      }
    };

    function refreshConfig() {
      var facility = state.context
        && state.context.selection
        && state.context.selection.facility;
      return facility && facility.refresh ? facility.refresh : {
        operationalIntervalMs: 30000,
        fuelDefIntervalMs: 180000,
        engineHoursIntervalMs: 300000,
        overlapWindowMs: 15000,
        backoffMs: [60000, 120000, 300000]
      };
    }

    function clearSchedule() {
      if (state.timerId !== null) {
        clock.clearTimeout(state.timerId);
        state.timerId = null;
      }
    }

    function nextDelay() {
      var config = refreshConfig();
      if (!state.failureLevel) {
        return Math.min(
          config.operationalIntervalMs,
          ACTIVE_OPERATIONS_REFRESH_INTERVAL_MS
        );
      }
      return config.backoffMs[Math.min(
        state.failureLevel - 1,
        config.backoffMs.length - 1
      )];
    }

    function schedule() {
      clearSchedule();
      if (!state.active || !state.visible || state.inFlight) {
        return;
      }
      state.timerId = clock.setTimeout(function () {
        state.timerId = null;
        runIncremental(false);
      }, nextDelay());
    }

    function currentRequestContext() {
      return Object.assign({}, state.context, { nowMs: clock.now() });
    }

    function canApply(generation, sequence) {
      return state.active
        && generation === state.generation
        && sequence >= state.appliedSequence;
    }

    function canApplyHealth(generation, healthGeneration, deviceId) {
      return state.active
        && generation === state.generation
        && healthGeneration === state.healthGeneration
        && deviceId === state.selectedDeviceId;
    }

    function runEngineHealth(force) {
      if (!state.active || !state.visible || !state.loadedScopeKey
        || !state.selectedDeviceId
        || typeof dataSource.refreshEngineHealth !== "function") {
        return Promise.resolve(null);
      }
      if (state.healthInFlight
        && state.healthRequestDeviceId === state.selectedDeviceId) {
        return state.healthInFlight;
      }
      if (!force && state.lastHealthAt !== null
        && clock.now() - state.lastHealthAt < ENGINE_HEALTH_REFRESH_INTERVAL_MS) {
        return Promise.resolve(null);
      }
      var generation = state.generation;
      var healthGeneration = state.healthGeneration;
      var deviceId = state.selectedDeviceId;
      var request = Promise.resolve().then(function () {
        return dataSource.refreshEngineHealth(currentRequestContext(), deviceId);
      }).then(function (result) {
        if (!result || !result.ok
          || !canApplyHealth(generation, healthGeneration, deviceId)) {
          return result;
        }
        state.lastHealthAt = clock.now();
        if (result.viewModel && typeof view.patchEngineHealth === "function") {
          view.patchEngineHealth(deviceId, result.viewModel);
        }
        return result;
      }).catch(function (error) {
        logger.error("Engine Health refresh failure", {
          category: error && error.code || "unexpected"
        });
        return null;
      }).finally(function () {
        if (state.healthInFlight === request) {
          state.healthInFlight = null;
          state.healthRequestDeviceId = null;
        }
      });
      state.healthInFlight = request;
      state.healthRequestDeviceId = deviceId;
      return request;
    }

    function applyResult(result, generation, sequence, initial) {
      if (!canApply(generation, sequence)) {
        return false;
      }
      state.appliedSequence = sequence;
      state.lastSuccessAt = clock.now();
      state.latestFleetDataAt = result.latestFleetDataAt || state.latestFleetDataAt;
      if (initial) {
        state.loadedScopeKey = result.scopeKey || state.requestedScopeKey;
        view.initializeRows(state.loadedScopeKey, result.viewModels || []);
        if (typeof view.updateContext === "function") {
          view.updateContext(result);
        }
      } else {
        view.patchRows(result.viewModels || []);
      }
      if (typeof view.updateFreshness === "function") {
        view.updateFreshness({
          condition: "success",
          checkedAt: state.lastSuccessAt,
          latestFleetDataAt: state.latestFleetDataAt
        });
      }
      onStatus(initial ? "Initial load successful" : "Refresh successful");
      return true;
    }

    function handleFailure(error, generation) {
      if (generation !== state.generation || !state.active) {
        return;
      }
      state.failureLevel = Math.min(
        state.failureLevel + 1,
        refreshConfig().backoffMs.length
      );
      if (typeof view.showFailure === "function") {
        view.showFailure({
          message: "Refresh unavailable",
          error: error,
          checkedAt: clock.now(),
          latestFleetDataAt: state.latestFleetDataAt
        });
      }
      onStatus("failure");
    }

    function finishRequest() {
      state.inFlight = null;
      if (state.pendingInitial && state.active) {
        state.pendingInitial = false;
        runInitial();
        return;
      }
      schedule();
    }

    function runInitial() {
      if (!state.active || !state.visible) {
        return Promise.resolve(null);
      }
      if (state.inFlight) {
        state.pendingInitial = true;
        return state.inFlight;
      }
      var generation = state.generation;
      var sequence = ++state.sequence;
      if (typeof view.showInitialLoading === "function") {
        view.showInitialLoading();
      }
      logger.info("Operations initial load start");
      onStatus("Initial load running");
      var request = Promise.resolve()
        .then(function () {
          return dataSource.initialLoad(currentRequestContext());
        })
        .then(function (result) {
          if (!result.ok) {
            var resultCategory = result.code || "no-authorized-assets";
            logger.error("Operations initial load failure [" + resultCategory + "]", {
              category: resultCategory
            });
            onStatus("Initial load failed");
            if (canApply(generation, sequence) && typeof view.showEmpty === "function") {
              view.showEmpty(result.reason || "No authorized assets");
            }
            return result;
          }
          applyResult(result, generation, sequence, true);
          logger.info("Operations initial load success", {
            authorizedAssetCount: (result.deviceIds || []).length
          });
          state.failureLevel = 0;
          var now = clock.now();
          state.laneLastAt.operational = now;
          state.laneLastAt.fuelDef = now;
          state.laneLastAt.engineHours = now;
          return result;
        })
        .catch(function (error) {
          var category = runtimeFailureCategory(error);
          logger.error("Operations initial load failure [" + category + "]", {
            category: category
          });
          handleFailure(error, generation);
          return null;
        })
        .finally(finishRequest);
      state.inFlight = request;
      return request;
    }

    function dueLanes(manual) {
      return ["operational"];
    }

    function runIncremental(manual) {
      if (!state.active || !state.visible || !state.loadedScopeKey) {
        return Promise.resolve(null);
      }
      if (state.inFlight) {
        return state.inFlight;
      }
      clearSchedule();
      var generation = state.generation;
      var sequence = ++state.sequence;
      var lanes = dueLanes(manual);
      var context = currentRequestContext();
      logger.info("refresh start", { lanes: lanes.slice() });
      onStatus("Refresh running");
      var request = Promise.resolve()
        .then(async function () {
          var result = null;
          for (var index = 0; index < lanes.length; index += 1) {
            var lane = lanes[index];
            if (lane === "operational") {
              result = await dataSource.refreshOperational(context);
            } else if (lane === "fuelDef") {
              result = await dataSource.refreshFuelDef(context);
            } else {
              result = await dataSource.refreshEngineHours(context);
            }
            if (result && result.requiresInitialReload) {
              state.loadedScopeKey = null;
              state.pendingInitial = true;
              break;
            }
            if (result && result.ok) {
              applyResult(result, generation, sequence, false);
              state.laneLastAt[lane] = clock.now();
            }
          }
          state.failureLevel = Math.max(0, state.failureLevel - 1);
          logger.info("refresh success", { lanes: lanes.slice() });
          return result;
        })
        .catch(function (error) {
          logger.error("refresh failure", {
            category: runtimeFailureCategory(error)
          });
          handleFailure(error, generation);
          return null;
        })
        .finally(finishRequest);
      state.inFlight = request;
      return request;
    }

    function runScopeCheck() {
      if (!state.active || !state.visible || state.inFlight
        || typeof dataSource.checkScope !== "function") {
        schedule();
        return Promise.resolve(null);
      }
      clearSchedule();
      var generation = state.generation;
      var request = Promise.resolve()
        .then(function () {
          return dataSource.checkScope(currentRequestContext());
        })
        .then(function (result) {
          if (generation === state.generation && result && result.changed) {
            state.loadedScopeKey = null;
            state.pendingInitial = true;
          }
          return result;
        })
        .catch(function (error) {
          handleFailure(error, generation);
          return null;
        })
        .finally(finishRequest);
      state.inFlight = request;
      return request;
    }

    function focus(context) {
      state.active = true;
      state.context = context;
      var nextScopeKey = dataSource.scopeKey(context);
      var scopeChanged = nextScopeKey !== state.requestedScopeKey;
      state.requestedScopeKey = nextScopeKey;
      if (scopeChanged || !state.loadedScopeKey) {
        state.generation += 1;
        state.healthGeneration += 1;
        state.healthInFlight = null;
        state.healthRequestDeviceId = null;
        state.loadedScopeKey = null;
        clearSchedule();
        return runInitial();
      }
      return runIncremental(false);
    }

    function blur() {
      state.active = false;
      state.generation += 1;
      state.healthGeneration += 1;
      state.healthInFlight = null;
      state.healthRequestDeviceId = null;
      state.pendingInitial = false;
      clearSchedule();
      if (typeof view.updateFreshness === "function") {
        view.updateFreshness({
          condition: "paused",
          checkedAt: state.lastSuccessAt,
          latestFleetDataAt: state.latestFleetDataAt
        });
      }
    }

    function setVisible(visible) {
      state.visible = Boolean(visible);
      if (!state.visible) {
        clearSchedule();
        return Promise.resolve(null);
      } else if (state.active) {
        if (!state.loadedScopeKey) {
          return runInitial();
        } else {
          return runIncremental(false);
        }
      }
      return Promise.resolve(null);
    }

    return {
      blur: blur,
      focus: focus,
      reloadScope: function () {
        state.generation += 1;
        state.loadedScopeKey = null;
        clearSchedule();
        if (state.inFlight) {
          state.pendingInitial = true;
          return state.inFlight;
        }
        return runInitial();
      },
      refreshNow: function () {
        return state.inFlight || runIncremental(true);
      },
      selectDevice: function (deviceId) {
        var normalized = deviceId || null;
        if (normalized !== state.selectedDeviceId) {
          state.selectedDeviceId = normalized;
          state.healthGeneration += 1;
          state.lastHealthAt = null;
        }
        return normalized ? runEngineHealth(true) : Promise.resolve(null);
      },
      setVisible: setVisible,
      snapshot: function () {
        return Object.assign({}, state, {
          laneLastAt: Object.assign({}, state.laneLastAt)
        });
      }
    };
  }

  return {
    ACTIVE_OPERATIONS_REFRESH_INTERVAL_MS: ACTIVE_OPERATIONS_REFRESH_INTERVAL_MS,
    ENGINE_HEALTH_REFRESH_INTERVAL_MS: ENGINE_HEALTH_REFRESH_INTERVAL_MS,
    createOperationsController: createOperationsController
  };
}));
