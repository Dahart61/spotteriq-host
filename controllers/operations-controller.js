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
  var OPERATIONS_MOVE_REFRESH_INTERVAL_MS = 30000;

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
      pollingEnabled: false,
      timerId: null,
      inFlight: null,
      inFlightGeneration: null,
      moveInFlight: null,
      pendingInitial: false,
      pendingRefresh: false,
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
        engineHours: null,
        moves: null
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
      if (!state.active || !state.visible || state.inFlight
        || !state.pollingEnabled) {
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
        if (canApplyHealth(generation, healthGeneration, deviceId)) {
          logger.error("Engine Health refresh failure", {
            category: error && error.code || "unexpected"
          });
        }
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

    function runMoveRefresh(force, rebuild) {
      if (!state.active || !state.visible || !state.loadedScopeKey
        || !state.pollingEnabled
        || typeof dataSource.refreshMoves !== "function") {
        return Promise.resolve(null);
      }
      if (state.moveInFlight) {
        return state.moveInFlight;
      }
      if (!force && state.laneLastAt.moves !== null
        && clock.now() - state.laneLastAt.moves
          < OPERATIONS_MOVE_REFRESH_INTERVAL_MS) {
        return Promise.resolve(null);
      }
      var generation = state.generation;
      var loadedScopeKey = state.loadedScopeKey;
      var request = Promise.resolve().then(function () {
        return dataSource.refreshMoves(currentRequestContext(), {
          rebuild: rebuild === true
        });
      }).then(function (result) {
        if (!result || !result.ok || !state.active
          || generation !== state.generation
          || loadedScopeKey !== state.loadedScopeKey) {
          return result;
        }
        state.laneLastAt.moves = clock.now();
        view.patchRows(result.viewModels || []);
        return result;
      }).catch(function (error) {
        if (generation === state.generation && state.active) {
          logger.error("Operations move refresh failure", {
            category: runtimeFailureCategory(error)
          });
        }
        return null;
      }).finally(function () {
        if (state.moveInFlight === request) {
          state.moveInFlight = null;
        }
      });
      state.moveInFlight = request;
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
        state.pollingEnabled = result.configuredEmpty !== true
          && (!Array.isArray(result.deviceIds) || result.deviceIds.length > 0);
        view.initializeRows(state.loadedScopeKey, result.viewModels || []);
        if (typeof view.updateContext === "function") {
          view.updateContext(result);
        }
        if (result.configuredEmpty === true
          && typeof view.showConfiguredEmpty === "function") {
          view.showConfiguredEmpty(
            "This configured facility has no active authorized devices."
          );
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

    function finishRequest(request) {
      if (state.inFlight !== request) {
        return;
      }
      state.inFlight = null;
      state.inFlightGeneration = null;
      if (state.pendingInitial && state.active) {
        state.pendingInitial = false;
        state.pendingRefresh = false;
        runInitial();
        return;
      }
      if (state.pendingRefresh && state.active) {
        state.pendingRefresh = false;
        runIncremental(false);
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
            if (!canApply(generation, sequence)) {
              return result;
            }
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
          if (applyResult(result, generation, sequence, true)) {
            logger.info("Operations initial load success", {
              authorizedAssetCount: (result.deviceIds || []).length
            });
            state.failureLevel = 0;
            var now = clock.now();
            state.laneLastAt.operational = now;
            state.laneLastAt.fuelDef = now;
            state.laneLastAt.engineHours = now;
            state.laneLastAt.moves = null;
            runMoveRefresh(true, true);
          }
          return result;
        })
        .catch(function (error) {
          if (generation === state.generation && state.active) {
            var category = runtimeFailureCategory(error);
            logger.error("Operations initial load failure [" + category + "]", {
              category: category
            });
            handleFailure(error, generation);
          }
          return null;
        })
        .finally(function () { finishRequest(request); });
      state.inFlight = request;
      state.inFlightGeneration = generation;
      return request;
    }

    function dueLanes(manual) {
      return ["operational"];
    }

    function runIncremental(manual) {
      if (!state.active || !state.visible || !state.loadedScopeKey
        || !state.pollingEnabled) {
        return Promise.resolve(null);
      }
      if (state.inFlight) {
        if (state.inFlightGeneration !== state.generation) {
          state.pendingRefresh = true;
        }
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
            if (!canApply(generation, sequence)) {
              return result;
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
          if (typeof dataSource.refreshMoves === "function") {
            await runMoveRefresh(manual === true, false);
          }
          if (generation === state.generation && state.active) {
            state.failureLevel = Math.max(0, state.failureLevel - 1);
            logger.info("refresh success", { lanes: lanes.slice() });
          }
          return result;
        })
        .catch(function (error) {
          if (generation === state.generation && state.active) {
            logger.error("refresh failure", {
              category: runtimeFailureCategory(error)
            });
            handleFailure(error, generation);
          }
          return null;
        })
        .finally(function () { finishRequest(request); });
      state.inFlight = request;
      state.inFlightGeneration = generation;
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
        .finally(function () { finishRequest(request); });
      state.inFlight = request;
      state.inFlightGeneration = generation;
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
        state.moveInFlight = null;
        state.healthGeneration += 1;
        state.healthInFlight = null;
        state.healthRequestDeviceId = null;
        state.loadedScopeKey = null;
        state.pollingEnabled = false;
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
      state.pendingRefresh = false;
      clearSchedule();
      if (typeof view.updateFreshness === "function") {
        view.updateFreshness({
          condition: "paused",
          checkedAt: state.lastSuccessAt,
          latestFleetDataAt: state.latestFleetDataAt
        });
      }
    }

    function clearScope() {
      blur();
      state.requestedScopeKey = null;
      state.loadedScopeKey = null;
      state.context = null;
      state.pollingEnabled = false;
      state.moveInFlight = null;
      state.laneLastAt.moves = null;
      if (typeof dataSource.clear === "function") {
        dataSource.clear();
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
        } else if (state.pollingEnabled) {
          return runIncremental(false);
        }
      }
      return Promise.resolve(null);
    }

    return {
      blur: blur,
      clearScope: clearScope,
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
    OPERATIONS_MOVE_REFRESH_INTERVAL_MS: OPERATIONS_MOVE_REFRESH_INTERVAL_MS,
    createOperationsController: createOperationsController
  };
}));
