(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_TELEMETRY = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CHANNELS = Object.freeze({
    ignition: {
      inputName: "ignitionSamples",
      capabilityFreshnessName: "ignitionFreshnessMs",
      type: "boolean"
    },
    rpm: {
      inputName: "rpmSamples",
      capabilityFreshnessName: "rpmFreshnessMs",
      type: "number"
    },
    speed: {
      inputName: "speedSamples",
      capabilityFreshnessName: "speedFreshnessMs",
      type: "number"
    },
    jaw: {
      inputName: "jawSamples",
      capabilityFreshnessName: "jawFreshnessMs",
      type: "boolean"
    },
    communication: {
      inputName: "communicationSamples",
      capabilityFreshnessName: "communicationFreshnessMs",
      type: "boolean"
    }
  });

  function TimelineInputError(code, message, details) {
    this.name = "TimelineInputError";
    this.code = code;
    this.message = message;
    this.details = details || {};
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TimelineInputError);
    }
  }
  TimelineInputError.prototype = Object.create(Error.prototype);
  TimelineInputError.prototype.constructor = TimelineInputError;

  function exactMilliseconds(value, label) {
    if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
      throw new TimelineInputError(
        "INVALID_TIMESTAMP",
        (label || "timestamp") + " must include Z or an explicit UTC offset",
        { value: value }
      );
    }
    var milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) {
      throw new TimelineInputError(
        "INVALID_TIMESTAMP",
        "Invalid " + (label || "timestamp") + ": " + value,
        { value: value }
      );
    }
    return milliseconds;
  }

  function validateChannelValue(channel, value) {
    var definition = CHANNELS[channel];
    if (!definition) {
      throw new TimelineInputError("INVALID_CHANNEL", "Unknown telemetry channel: " + channel);
    }
    if (definition.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new TimelineInputError(
        "INVALID_SAMPLE_VALUE",
        channel + " sample value must be a finite number",
        { channel: channel, value: value }
      );
    }
    if (definition.type === "boolean" && typeof value !== "boolean") {
      throw new TimelineInputError(
        "INVALID_SAMPLE_VALUE",
        channel + " sample value must be boolean",
        { channel: channel, value: value }
      );
    }
    return value;
  }

  function valuesEqual(left, right) {
    return left === right || (left === 0 && right === 0);
  }

  function normalizeSamples(samples, channel) {
    if (!CHANNELS[channel]) {
      throw new TimelineInputError("INVALID_CHANNEL", "Unknown telemetry channel: " + channel);
    }
    if (samples === undefined || samples === null) {
      return [];
    }
    if (!Array.isArray(samples)) {
      throw new TimelineInputError(
        "INVALID_SAMPLES",
        CHANNELS[channel].inputName + " must be an array",
        { channel: channel }
      );
    }

    var byTimestamp = new Map();
    samples.forEach(function (sample, index) {
      if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
        throw new TimelineInputError(
          "INVALID_SAMPLE",
          channel + " sample at index " + index + " must be an object",
          { channel: channel, index: index }
        );
      }
      var milliseconds = exactMilliseconds(sample.timestamp, channel + " sample timestamp");
      var value = validateChannelValue(channel, sample.value);
      var key = String(milliseconds);
      if (byTimestamp.has(key) && !valuesEqual(byTimestamp.get(key).value, value)) {
        throw new TimelineInputError(
          "CONFLICTING_SAMPLE",
          "Conflicting " + channel + " values at " + new Date(milliseconds).toISOString(),
          {
            channel: channel,
            timestamp: new Date(milliseconds).toISOString(),
            values: [byTimestamp.get(key).value, value]
          }
        );
      }
      byTimestamp.set(key, {
        timestamp: new Date(milliseconds).toISOString(),
        timestampMs: milliseconds,
        value: value
      });
    });

    return Array.from(byTimestamp.values()).sort(function (left, right) {
      return left.timestampMs - right.timestampMs;
    }).map(function (sample) {
      return {
        timestamp: sample.timestamp,
        value: sample.value
      };
    });
  }

  function normalizeTelemetry(input) {
    var source = input || {};
    var result = {};
    Object.keys(CHANNELS).forEach(function (channel) {
      var definition = CHANNELS[channel];
      result[definition.inputName] = normalizeSamples(source[definition.inputName], channel);
    });
    return result;
  }

  function validateAssetCapability(capability) {
    var errors = [];
    if (!capability || typeof capability !== "object" || Array.isArray(capability)) {
      return {
        ok: false,
        errors: [{ field: "", code: "INVALID_CAPABILITY", message: "Asset capability is required" }]
      };
    }

    if (typeof capability.deviceId !== "string" || !capability.deviceId.trim()) {
      errors.push({ field: "deviceId", code: "REQUIRED", message: "deviceId is required" });
    }
    if (typeof capability.jawSensorInstalled !== "boolean") {
      errors.push({
        field: "jawSensorInstalled",
        code: "INVALID_BOOLEAN",
        message: "jawSensorInstalled must be boolean"
      });
    }
    ["movementSpeedThresholdMph", "engineOnRpmThreshold"].forEach(function (field) {
      if (typeof capability[field] !== "number"
        || !Number.isFinite(capability[field])
        || capability[field] < 0) {
        errors.push({
          field: field,
          code: "INVALID_THRESHOLD",
          message: field + " must be a non-negative finite number"
        });
      }
    });
    Object.keys(CHANNELS).forEach(function (channel) {
      var field = CHANNELS[channel].capabilityFreshnessName;
      if (channel === "jaw"
        && capability.jawSensorInstalled === false) {
        return;
      }
      if (typeof capability[field] !== "number"
        || !Number.isFinite(capability[field])
        || capability[field] <= 0) {
        errors.push({
          field: field,
          code: "INVALID_FRESHNESS",
          message: field + " must be a positive finite number"
        });
      }
    });

    return { ok: errors.length === 0, errors: errors };
  }

  function assertValidAssetCapability(capability) {
    var result = validateAssetCapability(capability);
    if (!result.ok) {
      var error = new TimelineInputError(
        "INVALID_CAPABILITY",
        result.errors.map(function (item) {
          return item.message;
        }).join("; "),
        { validationErrors: result.errors }
      );
      error.validationErrors = result.errors;
      throw error;
    }
    return capability;
  }

  function defaultAssetCapability(overrides) {
    var source = overrides || {};
    if (!source.useInitialThresholdDefaults) {
      throw new TimelineInputError(
        "DEFAULTS_NOT_REQUESTED",
        "Initial movement and RPM defaults require useInitialThresholdDefaults: true"
      );
    }
    return Object.assign({}, source, {
      movementSpeedThresholdMph: source.movementSpeedThresholdMph === undefined
        ? 2
        : source.movementSpeedThresholdMph,
      engineOnRpmThreshold: source.engineOnRpmThreshold === undefined
        ? 400
        : source.engineOnRpmThreshold
    });
  }

  function normalizeBoundarySeed(seed, startUtc) {
    var startMilliseconds = exactMilliseconds(startUtc, "timeline startUtc");
    var source = seed || {};
    var result = {};

    Object.keys(source).forEach(function (channel) {
      if (!CHANNELS[channel]) {
        throw new TimelineInputError(
          "INVALID_BOUNDARY_SEED",
          "Unknown boundary seed channel: " + channel
        );
      }
    });

    Object.keys(CHANNELS).forEach(function (channel) {
      if (source[channel] === undefined) {
        return;
      }
      var supplied = source[channel];
      var value;
      var timestamp = startUtc;
      if (supplied && typeof supplied === "object" && !Array.isArray(supplied)) {
        value = supplied.value;
        if (supplied.timestamp !== undefined) {
          timestamp = supplied.timestamp;
        }
      } else {
        value = supplied;
      }
      validateChannelValue(channel, value);
      var timestampMilliseconds = exactMilliseconds(timestamp, channel + " boundary seed timestamp");
      if (timestampMilliseconds > startMilliseconds) {
        throw new TimelineInputError(
          "INVALID_BOUNDARY_SEED",
          channel + " boundary seed may not be later than startUtc",
          { channel: channel, timestamp: timestamp }
        );
      }
      result[channel] = {
        value: value,
        timestamp: new Date(timestampMilliseconds).toISOString()
      };
    });
    return result;
  }

  return {
    CHANNELS: CHANNELS,
    TimelineInputError: TimelineInputError,
    assertValidAssetCapability: assertValidAssetCapability,
    defaultAssetCapability: defaultAssetCapability,
    exactMilliseconds: exactMilliseconds,
    normalizeBoundarySeed: normalizeBoundarySeed,
    normalizeSamples: normalizeSamples,
    normalizeTelemetry: normalizeTelemetry,
    validateAssetCapability: validateAssetCapability,
    validateChannelValue: validateChannelValue
  };
}));
