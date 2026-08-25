(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_OPERATIONAL_STATES = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STATES = Object.freeze({
    COUPLED_MOVING: "COUPLED_MOVING",
    BOBTAIL_MOVING: "BOBTAIL_MOVING",
    COUPLED_IDLE: "COUPLED_IDLE",
    BOBTAIL_IDLE: "BOBTAIL_IDLE",
    ENGINE_ON_MOVING: "ENGINE_ON_MOVING",
    ENGINE_ON_STATIONARY: "ENGINE_ON_STATIONARY",
    KEY_ON_ENGINE_NOT_RUNNING: "KEY_ON_ENGINE_NOT_RUNNING",
    ENGINE_OFF: "ENGINE_OFF",
    UNKNOWN: "UNKNOWN",
    NOT_COMMUNICATING: "NOT_COMMUNICATING"
  });

  var COMMUNICATION_CONDITIONS = Object.freeze({
    CURRENT: "CURRENT",
    STALE: "STALE",
    NOT_COMMUNICATING: "NOT_COMMUNICATING",
    UNKNOWN: "UNKNOWN"
  });

  function unavailableReason(signal, status) {
    return signal.toUpperCase() + "_" + status;
  }

  function classifyOperationalState(capability, signals) {
    var communication = signals.communication;
    if (communication.condition === COMMUNICATION_CONDITIONS.NOT_COMMUNICATING) {
      return {
        state: STATES.NOT_COMMUNICATING,
        reason: "Fresh communication evidence explicitly reports that the asset is not communicating",
        reasonCode: "EXPLICIT_NOT_COMMUNICATING"
      };
    }
    if (communication.condition === COMMUNICATION_CONDITIONS.STALE) {
      return {
        state: STATES.UNKNOWN,
        reason: "Communication evidence expired, so operating state cannot be carried forward",
        reasonCode: "COMMUNICATION_STALE"
      };
    }

    if (!signals.ignition.fresh) {
      return {
        state: STATES.UNKNOWN,
        reason: "Fresh ignition is unavailable; missing ignition is not treated as off",
        reasonCode: unavailableReason("ignition", signals.ignition.status)
      };
    }

    var historicalIgnitionAuthority = capability.historicalIgnitionAuthority === true;
    var rpmRunning = signals.rpm.fresh
      && signals.rpm.value >= capability.engineOnRpmThreshold;
    if (signals.ignition.value === false && rpmRunning) {
      return {
        state: STATES.UNKNOWN,
        reason: "Conflicting ignition and RPM evidence: ignition is off while RPM meets the engine-running threshold",
        reasonCode: "IGNITION_RPM_CONFLICT"
      };
    }
    if (historicalIgnitionAuthority) {
      if (signals.ignition.value === false) {
        return {
          state: STATES.ENGINE_OFF,
          reason: "Stored historical ignition is off",
          reasonCode: "HISTORICAL_IGNITION_OFF"
        };
      }
      if (signals.rpm.fresh && !rpmRunning) {
        return {
          state: STATES.KEY_ON_ENGINE_NOT_RUNNING,
          reason: "Stored historical ignition is on, but fresh RPM establishes an engine-stop condition",
          reasonCode: "HISTORICAL_IGNITION_ON_RPM_STOP"
        };
      }
    } else {
      if (!signals.rpm.fresh) {
        return {
          state: STATES.UNKNOWN,
          reason: "Fresh RPM is unavailable; missing RPM is not treated as engine off",
          reasonCode: unavailableReason("rpm", signals.rpm.status)
        };
      }
      if (signals.ignition.value === true && !rpmRunning) {
        return {
          state: STATES.KEY_ON_ENGINE_NOT_RUNNING,
          reason: "Ignition is on, but fresh RPM is below the configured engine-running threshold",
          reasonCode: "IGNITION_ON_RPM_BELOW_ENGINE_RUNNING_THRESHOLD"
        };
      }
      if (signals.ignition.value === false && !rpmRunning) {
        return {
          state: STATES.ENGINE_OFF,
          reason: "Ignition is off and fresh RPM is below the configured engine-running threshold",
          reasonCode: "IGNITION_OFF_RPM_BELOW_ENGINE_RUNNING_THRESHOLD"
        };
      }
    }

    if (!signals.speed.fresh) {
      return {
        state: STATES.UNKNOWN,
        reason: "Fresh speed is unavailable; missing speed is not treated as zero",
        reasonCode: unavailableReason("speed", signals.speed.status)
      };
    }

    var moving = signals.speed.value > capability.movementSpeedThresholdMph;
    if (!capability.jawSensorInstalled) {
      return {
        state: moving ? STATES.ENGINE_ON_MOVING : STATES.ENGINE_ON_STATIONARY,
        reason: historicalIgnitionAuthority
          ? moving
            ? "Stored historical ignition proves Engine Running, and speed is above the movement threshold"
            : "Stored historical ignition proves Engine Running, and speed is at or below the movement threshold"
          : moving
            ? "Fresh Ignition and RPM prove Engine Running, and speed is above the movement threshold"
            : "Fresh Ignition and RPM prove Engine Running, and speed is at or below the movement threshold",
        reasonCode: moving ? "NO_JAW_ENGINE_ON_MOVING" : "NO_JAW_ENGINE_ON_STATIONARY"
      };
    }

    if (!signals.jaw.fresh) {
      return {
        state: STATES.UNKNOWN,
        reason: "Fresh Fifth Wheel Status is unavailable; missing data is not treated as uncoupled",
        reasonCode: unavailableReason("jaw", signals.jaw.status)
      };
    }

    if (moving && signals.jaw.value) {
      return {
        state: STATES.COUPLED_MOVING,
        reason: "Engine Running is proven, speed is moving, and Fifth Wheel Status is coupled",
        reasonCode: "ENGINE_ON_MOVING_JAW_LOCKED"
      };
    }
    if (moving && !signals.jaw.value) {
      return {
        state: STATES.BOBTAIL_MOVING,
        reason: "Engine Running is proven, speed is moving, and Fifth Wheel Status is uncoupled",
        reasonCode: "ENGINE_ON_MOVING_JAW_UNLOCKED"
      };
    }
    if (signals.jaw.value) {
      return {
        state: STATES.COUPLED_IDLE,
        reason: "Engine Running is proven, speed is stationary, and Fifth Wheel Status is coupled",
        reasonCode: "ENGINE_ON_STATIONARY_JAW_LOCKED"
      };
    }
    return {
      state: STATES.BOBTAIL_IDLE,
      reason: "Engine Running is proven, speed is stationary, and Fifth Wheel Status is uncoupled",
      reasonCode: "ENGINE_ON_STATIONARY_JAW_UNLOCKED"
    };
  }

  return {
    COMMUNICATION_CONDITIONS: COMMUNICATION_CONDITIONS,
    STATES: STATES,
    classifyOperationalState: classifyOperationalState
  };
}));
