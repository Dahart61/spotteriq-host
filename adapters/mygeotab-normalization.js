(function (root, factory) {
  "use strict";

  var diagnosticChannels = typeof module === "object" && module.exports
    ? require("../core/diagnostic-channels")
    : root.SIQ_DIAGNOSTIC_CHANNELS;
  var api = factory(diagnosticChannels);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_MYGEOTAB_NORMALIZATION = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  diagnosticChannels
) {
  "use strict";

  var KPH_TO_MPH = 0.621371192237334;
  var METERS_TO_MILES = 0.000621371192237334;
  var MIN_COOLANT_CELSIUS = -273.15;
  var MAX_COOLANT_CELSIUS = 500;
  var CHANNELS = diagnosticChannels.CHANNELS;
  var FIFTH_WHEEL_STATES = Object.freeze({
    COUPLED: "COUPLED",
    UNCOUPLED: "UNCOUPLED",
    UNKNOWN: "UNKNOWN"
  });

  function referenceId(value) {
    if (typeof value === "string") {
      return value;
    }
    return value && typeof (value.id || value.Id) === "string"
      ? (value.id || value.Id) : null;
  }

  function currentDriverId(value) {
    var id = referenceId(value);
    if (typeof id !== "string" || !id.trim()
      || /^UnknownDriver(?:Id)?$/i.test(id.trim())) {
      return null;
    }
    return id.trim();
  }

  function normalizeCurrentDriverIdentity(record, expectedId) {
    var id = referenceId(record && (record.id || record.Id));
    var isDriver = record && Object.prototype.hasOwnProperty.call(record, "isDriver")
      ? record.isDriver : record && record.IsDriver;
    var firstName = record && Object.prototype.hasOwnProperty.call(record, "firstName")
      ? record.firstName : record && record.FirstName;
    var lastName = record && Object.prototype.hasOwnProperty.call(record, "lastName")
      ? record.lastName : record && record.LastName;
    if (!expectedId || id !== expectedId || isDriver !== true
      || typeof firstName !== "string" || !firstName.trim()
      || typeof lastName !== "string" || !lastName.trim()) {
      return null;
    }
    return {
      displayName: firstName.trim() + " " + lastName.trim()
    };
  }

  function finiteNumber(value) {
    var numeric = typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : value;
    return Number.isFinite(numeric) ? numeric : null;
  }

  function exactIso(value) {
    if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
      return null;
    }
    var milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
  }

  function normalizedBooleanLevel(value) {
    if (value === true || value === 1) {
      return "HIGH";
    }
    if (value === false || value === 0) {
      return "LOW";
    }
    var label = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (label === "TRUE" || label === "ON" || label === "HIGH" || label === "1") {
      return "HIGH";
    }
    if (label === "FALSE" || label === "OFF" || label === "LOW" || label === "0") {
      return "LOW";
    }
    return null;
  }

  function normalizeFifthWheelStatus(value, coupledWhen) {
    var level = normalizedBooleanLevel(value);
    var polarity = typeof coupledWhen === "string" ? coupledWhen.toUpperCase() : "";
    if (!level || (polarity !== "HIGH" && polarity !== "LOW")) {
      return FIFTH_WHEEL_STATES.UNKNOWN;
    }
    return level === polarity
      ? FIFTH_WHEEL_STATES.COUPLED
      : FIFTH_WHEEL_STATES.UNCOUPLED;
  }

  function normalizePercent(value, unit) {
    var numeric = finiteNumber(value);
    if (numeric === null) {
      return null;
    }
    var normalized = unit === "fraction" ? numeric * 100 : numeric;
    return normalized >= 0 && normalized <= 100 ? normalized : null;
  }

  function normalizeChannelValue(channel, value, mapping) {
    var numeric;
    if (channel === CHANNELS.FIFTH_WHEEL_STATUS) {
      return normalizeFifthWheelStatus(value, mapping.coupledWhen);
    }
    if (channel === CHANNELS.IGNITION) {
      var level = normalizedBooleanLevel(value);
      return level === "HIGH" ? true : level === "LOW" ? false : null;
    }
    numeric = finiteNumber(value);
    if (numeric === null) {
      return null;
    }
    if (channel === CHANNELS.RPM) {
      return numeric >= 0 ? numeric : null;
    }
    if (channel === CHANNELS.SPEED) {
      if (numeric < 0) {
        return null;
      }
      return mapping.unit === "mph" ? numeric : numeric * KPH_TO_MPH;
    }
    if (channel === CHANNELS.FUEL_USED) {
      return numeric >= 0 ? numeric : null;
    }
    if (channel === CHANNELS.FUEL_LEVEL || channel === CHANNELS.DEF_LEVEL) {
      return normalizePercent(numeric, mapping.unit);
    }
    if (channel === CHANNELS.ENGINE_HOURS) {
      if (numeric < 0) {
        return null;
      }
      return mapping.unit === "hours" ? numeric : numeric / 3600;
    }
    if (channel === CHANNELS.ODOMETER) {
      if (numeric < 0) {
        return null;
      }
      return mapping.unit === "miles" ? numeric : numeric * METERS_TO_MILES;
    }
    if (channel === CHANNELS.ENGINE_COOLANT_TEMPERATURE) {
      var celsius = mapping.unit === "fahrenheit"
        ? (numeric - 32) * 5 / 9 : numeric;
      return celsius >= MIN_COOLANT_CELSIUS && celsius <= MAX_COOLANT_CELSIUS
        ? celsius : null;
    }
    return null;
  }

  function durationMilliseconds(value) {
    if (typeof value !== "string") {
      return null;
    }
    var match = value.trim().match(/^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
    if (!match) {
      return null;
    }
    var days = Number(match[1] || 0);
    var hours = Number(match[2]);
    var minutes = Number(match[3]);
    var seconds = Number(match[4]);
    if (![days, hours, minutes, seconds].every(Number.isFinite)
      || hours > 23 || minutes > 59 || seconds >= 60) {
      return null;
    }
    return Math.round((days * 86400 + hours * 3600 + minutes * 60 + seconds) * 1000);
  }

  function latestStatusData(record) {
    var value = record && (record.statusData || record.StatusData);
    if (!value || typeof value !== "object") {
      return [];
    }
    var values = Array.isArray(value) ? value : Object.keys(value).map(function (key) {
      var item = value[key];
      if (!item || typeof item !== "object") {
        return null;
      }
      if (item.diagnostic || item.Diagnostic) {
        return item;
      }
      return Object.assign({}, item, { diagnostic: { id: key } });
    });
    return values.map(function (item) {
      if (!item || typeof item !== "object") {
        return null;
      }
      var diagnosticId = referenceId(item.diagnostic || item.Diagnostic);
      var timestamp = exactIso(item.dateTime || item.DateTime);
      var data = Object.prototype.hasOwnProperty.call(item, "data")
        ? item.data : item.Data;
      if (!diagnosticId || !timestamp
        || !["boolean", "number", "string"].includes(typeof data)) {
        return null;
      }
      return {
        diagnosticId: diagnosticId,
        timestamp: timestamp,
        value: data
      };
    }).filter(Boolean);
  }

  function mappingsForEnrollment(enrollment) {
    var source = enrollment && enrollment.diagnosticMappings;
    if (!source || typeof source !== "object") {
      return [];
    }
    return Object.keys(source).map(function (channel) {
      var mapping = source[channel];
      if (!diagnosticChannels.DEFINITIONS[channel]
        || !diagnosticChannels.channelEnabled(enrollment, channel)) {
        return null;
      }
      if (!mapping || typeof mapping.diagnosticId !== "string" || !mapping.diagnosticId) {
        return null;
      }
      return {
        channel: channel,
        diagnosticId: mapping.diagnosticId,
        unit: mapping.unit || null,
        coupledWhen: mapping.coupledWhen || null
      };
    }).filter(Boolean);
  }

  function normalizeStatusData(record, enrollment) {
    if (!record || typeof record !== "object" || !enrollment) {
      return null;
    }
    var deviceId = referenceId(record.device || record.Device);
    var diagnosticId = referenceId(record.diagnostic || record.Diagnostic);
    var timestamp = exactIso(record.dateTime || record.DateTime);
    if (!deviceId || deviceId !== enrollment.deviceId || !diagnosticId || !timestamp) {
      return null;
    }
    var mapping = mappingsForEnrollment(enrollment).find(function (candidate) {
      return candidate.diagnosticId === diagnosticId;
    });
    if (!mapping) {
      return null;
    }
    var rawValue = Object.prototype.hasOwnProperty.call(record, "data")
      ? record.data
      : record.Data;
    var value = normalizeChannelValue(mapping.channel, rawValue, mapping);
    if (value === null || value === undefined) {
      return null;
    }
    return {
      deviceId: deviceId,
      channel: mapping.channel,
      timestamp: timestamp,
      value: value,
      sourceId: typeof record.id === "string" ? record.id : (
        typeof record.Id === "string" ? record.Id : null
      )
    };
  }

  function normalizeDevice(record) {
    if (!record || typeof record !== "object") {
      return null;
    }
    var id = referenceId(record.id || record.Id);
    if (!id) {
      return null;
    }
    return {
      deviceId: id,
      displayName: typeof (record.name || record.Name) === "string"
        ? (record.name || record.Name)
        : id
    };
  }

  function normalizeDeviceStatusInfo(record, allowedDeviceIds) {
    if (!record || typeof record !== "object") {
      return null;
    }
    var deviceId = referenceId(record.device || record.Device);
    if (!deviceId || (allowedDeviceIds && !allowedDeviceIds.has(deviceId))) {
      return null;
    }
    var timestamp = exactIso(record.dateTime || record.DateTime);
    var speedKph = finiteNumber(
      Object.prototype.hasOwnProperty.call(record, "speed") ? record.speed : record.Speed
    );
    var communicating = Object.prototype.hasOwnProperty.call(record, "isDeviceCommunicating")
      ? record.isDeviceCommunicating
      : record.IsDeviceCommunicating;
    var latitude = finiteNumber(
      Object.prototype.hasOwnProperty.call(record, "latitude")
        ? record.latitude : record.Latitude
    );
    var longitude = finiteNumber(
      Object.prototype.hasOwnProperty.call(record, "longitude")
        ? record.longitude : record.Longitude
    );
    var bearing = finiteNumber(
      Object.prototype.hasOwnProperty.call(record, "bearing")
        ? record.bearing : record.Bearing
    );
    var driving = Object.prototype.hasOwnProperty.call(record, "isDriving")
      ? record.isDriving : record.IsDriving;
    var currentStateDuration = Object.prototype.hasOwnProperty.call(
      record, "currentStateDuration"
    ) ? record.currentStateDuration : record.CurrentStateDuration;
    var driver = Object.prototype.hasOwnProperty.call(record, "driver")
      ? record.driver : record.Driver;
    return {
      deviceId: deviceId,
      timestamp: timestamp,
      currentSpeedMph: speedKph !== null && speedKph >= 0 ? speedKph * KPH_TO_MPH : null,
      isCommunicating: typeof communicating === "boolean" ? communicating : null,
      isDriving: typeof driving === "boolean" ? driving : null,
      currentStateDurationMs: durationMilliseconds(currentStateDuration),
      currentDriverId: currentDriverId(driver),
      currentDriverDisplayName: null,
      latestDiagnostics: latestStatusData(record),
      location: latitude !== null && longitude !== null ? {
        latitude: latitude,
        longitude: longitude,
        bearing: bearing
      } : null
    };
  }

  function dedupeNormalizedRecords(records) {
    var seen = new Set();
    return (records || []).filter(function (record) {
      if (!record || !record.deviceId || !record.channel || !record.timestamp) {
        return false;
      }
      var key = [
        record.deviceId,
        record.channel,
        record.timestamp,
        typeof record.value === "object" ? JSON.stringify(record.value) : String(record.value)
      ].join("::");
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    }).sort(function (left, right) {
      return Date.parse(left.timestamp) - Date.parse(right.timestamp)
        || left.deviceId.localeCompare(right.deviceId)
        || left.channel.localeCompare(right.channel);
    });
  }

  function normalizeStatusDataBatch(records, enrollments, allowedDeviceIds) {
    var enrollmentByDeviceId = new Map((enrollments || []).map(function (enrollment) {
      return [enrollment.deviceId, enrollment];
    }));
    return dedupeNormalizedRecords((records || []).map(function (record) {
      var deviceId = referenceId(record && (record.device || record.Device));
      if (!deviceId || (allowedDeviceIds && !allowedDeviceIds.has(deviceId))) {
        return null;
      }
      return normalizeStatusData(record, enrollmentByDeviceId.get(deviceId));
    }).filter(Boolean));
  }

  return {
    CHANNELS: CHANNELS,
    FIFTH_WHEEL_STATES: FIFTH_WHEEL_STATES,
    KPH_TO_MPH: KPH_TO_MPH,
    MAX_COOLANT_CELSIUS: MAX_COOLANT_CELSIUS,
    METERS_TO_MILES: METERS_TO_MILES,
    MIN_COOLANT_CELSIUS: MIN_COOLANT_CELSIUS,
    dedupeNormalizedRecords: dedupeNormalizedRecords,
    exactIso: exactIso,
    mappingsForEnrollment: mappingsForEnrollment,
    normalizeChannelValue: normalizeChannelValue,
    normalizeCurrentDriverIdentity: normalizeCurrentDriverIdentity,
    normalizeDevice: normalizeDevice,
    normalizeDeviceStatusInfo: normalizeDeviceStatusInfo,
    durationMilliseconds: durationMilliseconds,
    latestStatusData: latestStatusData,
    normalizeFifthWheelStatus: normalizeFifthWheelStatus,
    normalizeStatusData: normalizeStatusData,
    normalizeStatusDataBatch: normalizeStatusDataBatch,
    referenceId: referenceId
  };
}));
