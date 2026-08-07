(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_DIAGNOSTIC_CHANNELS = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CHANNELS = Object.freeze({
    RPM: "rpm",
    SPEED: "speed",
    IGNITION: "ignition",
    FIFTH_WHEEL_STATUS: "fifthWheelStatus",
    FUEL_USED: "fuelUsed",
    FUEL_LEVEL: "fuelLevel",
    DEF_LEVEL: "defLevel",
    ENGINE_HOURS: "engineHours",
    ODOMETER: "odometer",
    ENGINE_COOLANT_TEMPERATURE: "engineCoolantTemperature",
    FAULTS: "faults"
  });

  var DEFINITIONS = Object.freeze({
    rpm: Object.freeze({ capabilityKey: "rpm", units: ["rpm"] }),
    speed: Object.freeze({
      capabilityKey: "speed",
      units: ["kph", "mph"],
      nativeSource: "DeviceStatusInfo"
    }),
    ignition: Object.freeze({
      capabilityKey: "ignition",
      units: ["state", "boolean"],
      optionalProfileCapability: true
    }),
    fifthWheelStatus: Object.freeze({
      capabilityKey: "fifthWheelStatus",
      units: ["boolean"],
      coupledPolarity: true
    }),
    fuelUsed: Object.freeze({ capabilityKey: "fuelUsed", units: ["liters"] }),
    fuelLevel: Object.freeze({
      capabilityKey: "fuelLevel",
      units: ["percent", "fraction"]
    }),
    defLevel: Object.freeze({
      capabilityKey: "defLevel",
      units: ["percent", "fraction"]
    }),
    engineHours: Object.freeze({
      capabilityKey: "engineHours",
      units: ["seconds", "hours"]
    }),
    odometer: Object.freeze({
      capabilityKey: "odometer",
      units: ["meters", "miles"],
      optionalProfileCapability: true
    }),
    engineCoolantTemperature: Object.freeze({
      capabilityKey: "engineCoolantTemperature",
      units: ["celsius", "fahrenheit"],
      optionalProfileCapability: true
    }),
    faults: Object.freeze({
      capabilityKey: "faults",
      units: [],
      nativeSource: "FaultData"
    })
  });

  function finding(path, code, message) {
    return { path: path, code: code, message: message };
  }

  function text(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function validateMapping(channel, mapping, path) {
    var definition = DEFINITIONS[channel];
    var findings = [];
    if (!definition) {
      return [finding(path, "UNSUPPORTED_DIAGNOSTIC_CHANNEL",
        "Unsupported diagnostic channel: " + channel)];
    }
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      return [finding(path, "INVALID_DIAGNOSTIC_MAPPING",
        channel + " mapping must be an object")];
    }
    var usesNativeSource = definition.nativeSource
      && mapping.source === definition.nativeSource;
    if (definition.nativeSource && mapping.source
      && mapping.source !== definition.nativeSource) {
      findings.push(finding(path + ".source", "INVALID_DIAGNOSTIC_SOURCE",
        channel + " source must be " + definition.nativeSource));
    }
    if (!usesNativeSource && !text(mapping.diagnosticId)) {
      findings.push(finding(path + ".diagnosticId", "DIAGNOSTIC_ID_REQUIRED",
        channel + " diagnosticId is required"));
    }
    if (!usesNativeSource && definition.units.indexOf(mapping.unit) === -1) {
      findings.push(finding(path + ".unit", "INVALID_DIAGNOSTIC_UNIT",
        channel + " unit must be one of: " + definition.units.join(", ")));
    }
    if (usesNativeSource && channel !== CHANNELS.FAULTS
      && definition.units.indexOf(mapping.unit) === -1) {
      findings.push(finding(path + ".unit", "INVALID_DIAGNOSTIC_UNIT",
        channel + " unit must be one of: " + definition.units.join(", ")));
    }
    if (definition.coupledPolarity
      && ["HIGH", "LOW"].indexOf(mapping.coupledWhen) === -1) {
      findings.push(finding(path + ".coupledWhen", "INVALID_COUPLED_POLARITY",
        "Fifth Wheel Status coupledWhen must be HIGH or LOW"));
    }
    return findings;
  }

  function validateMappings(mappings, capabilities, options) {
    var values = mappings && typeof mappings === "object" && !Array.isArray(mappings)
      ? mappings : {};
    var capabilityValues = capabilities && typeof capabilities === "object"
      && !Array.isArray(capabilities) ? capabilities : null;
    var settings = options || {};
    var pathPrefix = settings.pathPrefix || "diagnosticMappings";
    var findings = [];

    Object.keys(values).forEach(function (channel) {
      findings = findings.concat(validateMapping(
        channel,
        values[channel],
        pathPrefix + "." + channel
      ));
    });

    if (capabilityValues) {
      Object.keys(DEFINITIONS).forEach(function (channel) {
        var definition = DEFINITIONS[channel];
        var enabled = capabilityValues[definition.capabilityKey] === true;
        if (enabled && !values[channel]) {
          findings.push(finding(pathPrefix + "." + channel,
            "MISSING_SUPPORTED_CAPABILITY_MAPPING",
            channel + " is enabled and requires a source mapping"));
        }
        if (!enabled && values[channel] && definition.optionalProfileCapability) {
          findings.push(finding(pathPrefix + "." + channel,
            "DISABLED_CAPABILITY_MAPPING",
            channel + " mapping is not allowed while its capability is disabled"));
        }
      });
    }
    return { ok: findings.length === 0, findings: findings };
  }

  function channelEnabled(enrollment, channel) {
    var definition = DEFINITIONS[channel];
    var mappings = enrollment && enrollment.diagnosticMappings || {};
    if (!definition || !mappings[channel]) {
      return false;
    }
    var capabilities = enrollment && enrollment.capabilities;
    if (!capabilities || typeof capabilities !== "object") {
      return true;
    }
    return capabilities[definition.capabilityKey] === true;
  }

  return {
    CHANNELS: CHANNELS,
    DEFINITIONS: DEFINITIONS,
    channelEnabled: channelEnabled,
    validateMapping: validateMapping,
    validateMappings: validateMappings
  };
}));
