(function (root, factory) {
  "use strict";

  var timezone = typeof module === "object" && module.exports
    ? require("./timezone") : root.SIQ_TIMEZONE;
  var api = factory(timezone);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_SHIFT_PERFORMANCE = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (timezone) {
  "use strict";

  var KPH_TO_MPH = 0.621371;
  var LITERS_TO_GALLONS = 0.264172;
  var MOVING_MPH = 2;
  var ENGINE_RUNNING_RPM = 400;

  function resolveWindow(selection, nowMs, timeZone) {
    var custom = selection && selection.custom || {};
    if (!custom.startDate || !custom.startTime || !custom.endDate || !custom.endTime) {
      throw new RangeError("Start date and time and end date and time are required");
    }
    var startMs = Date.parse(timezone.resolveLocalDateTime(
      custom.startDate, custom.startTime, timeZone, custom.startDisambiguation || "earlier"
    ).iso);
    var endMs = Date.parse(timezone.resolveLocalDateTime(
      custom.endDate, custom.endTime, timeZone, custom.endDisambiguation || "later"
    ).iso);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new RangeError("End must be after start");
    }
    return {
      preset: "custom",
      startUtc: new Date(startMs).toISOString(),
      endUtc: new Date(endMs).toISOString(),
      timezone: timeZone,
      durationMinutes: (endMs - startMs) / 60000
    };
  }

  function valueOf(record, lower, upper) {
    return record && Object.prototype.hasOwnProperty.call(record, lower)
      ? record[lower] : record && record[upper];
  }

  function recordTime(record) {
    return Date.parse(valueOf(record, "dateTime", "DateTime"));
  }

  function recordData(record) {
    return Number(valueOf(record, "data", "Data"));
  }

  function sorted(records) {
    return (Array.isArray(records) ? records : []).filter(function (record) {
      return Number.isFinite(recordTime(record));
    }).slice().sort(function (left, right) {
      return recordTime(left) - recordTime(right);
    });
  }

  function booleanLevel(value) {
    if (value === true || value === 1 || value === "1"
      || String(value).toUpperCase() === "ON"
      || String(value).toUpperCase() === "HIGH") {
      return true;
    }
    if (value === false || value === 0 || value === "0"
      || String(value).toUpperCase() === "OFF"
      || String(value).toUpperCase() === "LOW") {
      return false;
    }
    return null;
  }

  function speedMph(record) {
    var raw = Number(valueOf(record, "speed", "Speed"));
    if (!Number.isFinite(raw)) {
      raw = recordData(record);
    }
    return Number.isFinite(raw) && raw >= 0 ? raw * KPH_TO_MPH : null;
  }

  function countVerifiedMoves(fifthWheelRecords, speedRecords) {
    var jaw = sorted(fifthWheelRecords).map(function (record) {
      return { time: recordTime(record), value: booleanLevel(valueOf(record, "data", "Data")) };
    }).filter(function (record) { return record.value !== null; });
    var speeds = sorted(speedRecords).map(function (record) {
      return { time: recordTime(record), mph: speedMph(record) };
    }).filter(function (record) { return record.mph !== null; });
    if (jaw.length < 2 || !speeds.length) {
      return null;
    }
    var moves = 0;
    var previous = null;
    var candidate = null;
    jaw.forEach(function (observation) {
      if (observation.value === previous) {
        return;
      }
      if (observation.value === true && previous === false) {
        candidate = { coupledAt: observation.time, moved: false };
      } else if (observation.value === false && previous === true && candidate) {
        candidate.moved = speeds.some(function (speed) {
          return speed.time >= candidate.coupledAt
            && speed.time <= observation.time
            && speed.mph >= MOVING_MPH;
        });
        if (candidate.moved) {
          moves += 1;
        }
        candidate = null;
      }
      previous = observation.value;
    });
    return moves;
  }

  function cumulativeDelta(records, multiplier) {
    var values = sorted(records).map(recordData).filter(Number.isFinite);
    if (values.length < 2) {
      return null;
    }
    var delta = (values[values.length - 1] - values[0]) * multiplier;
    return Number.isFinite(delta) && delta >= 0 ? delta : null;
  }

  function lastDriverName(events) {
    return (Array.isArray(events) ? events : []).slice().sort(function (left, right) {
      return Date.parse(left.timestamp) - Date.parse(right.timestamp);
    }).reduce(function (current, event) {
      return event.action === "CLEARED" ? null
        : event.driverDisplayName || current;
    }, null);
  }

  function analyzeUnit(device, data, window) {
    var startMs = Date.parse(window.startUtc);
    var endMs = Date.parse(window.endUtc);
    var capable = device.fifthWheelCapabilityGroupMember === true;
    var events = [];
    function add(records, type, transform) {
      sorted(records).forEach(function (record) {
        var time = recordTime(record);
        if (time < startMs || time > endMs) {
          return;
        }
        var value = transform(record);
        if (value !== null && value !== undefined) {
          events.push({ time: time, type: type, value: value });
        }
      });
    }
    add(data.rpm, "rpm", recordData);
    add(data.speed, "speed", speedMph);
    add(data.ignition, "ignition", function (record) {
      return booleanLevel(valueOf(record, "data", "Data"));
    });
    if (capable) {
      add(data.fifthWheel, "fifthWheel", function (record) {
        return booleanLevel(valueOf(record, "data", "Data"));
      });
    }
    events.sort(function (left, right) {
      return left.time - right.time || left.type.localeCompare(right.type);
    });

    var current = { rpm: null, speed: null, ignition: null, fifthWheel: null };
    var buckets = {
      movingMinutes: 0,
      idleMinutes: 0,
      keyOnMinutes: 0,
      engineOffMinutes: 0,
      stoppedMinutes: 0,
      engineRunningMinutes: 0,
      coupledMinutes: 0,
      uncoupledMinutes: 0,
      coupledMovingMinutes: 0,
      uncoupledMovingMinutes: 0,
      coupledDistanceMiles: 0,
      uncoupledDistanceMiles: 0,
      prolongedInactivityMinutes: 0
    };
    var inactivityRun = 0;
    function classifyInterval(durationMinutes) {
      if (durationMinutes <= 0) {
        return;
      }
      var moving = current.speed !== null && current.speed >= MOVING_MPH;
      var engineRunning = current.rpm !== null && current.rpm >= ENGINE_RUNNING_RPM;
      if (moving) {
        buckets.movingMinutes += durationMinutes;
      } else if (engineRunning) {
        buckets.idleMinutes += durationMinutes;
      } else if (current.ignition === true) {
        buckets.keyOnMinutes += durationMinutes;
      } else if (current.ignition === false) {
        buckets.engineOffMinutes += durationMinutes;
      } else {
        buckets.stoppedMinutes += durationMinutes;
      }
      if (engineRunning) {
        buckets.engineRunningMinutes += durationMinutes;
      }
      if (!moving && !engineRunning) {
        inactivityRun += durationMinutes;
        buckets.prolongedInactivityMinutes = Math.max(
          buckets.prolongedInactivityMinutes, inactivityRun
        );
      } else {
        inactivityRun = 0;
      }
      if (capable && current.fifthWheel !== null) {
        var durationHours = durationMinutes / 60;
        var distance = moving && current.speed !== null
          ? current.speed * durationHours : 0;
        if (current.fifthWheel) {
          buckets.coupledMinutes += durationMinutes;
          if (moving) {
            buckets.coupledMovingMinutes += durationMinutes;
            buckets.coupledDistanceMiles += distance;
          }
        } else {
          buckets.uncoupledMinutes += durationMinutes;
          if (moving) {
            buckets.uncoupledMovingMinutes += durationMinutes;
            buckets.uncoupledDistanceMiles += distance;
          }
        }
      }
    }

    var previousTime = startMs;
    events.forEach(function (event) {
      classifyInterval((event.time - previousTime) / 60000);
      current[event.type] = event.value;
      previousTime = event.time;
    });
    classifyInterval((endMs - previousTime) / 60000);

    var fuelGallons = cumulativeDelta(data.fuel, LITERS_TO_GALLONS);
    var engineHours = cumulativeDelta(data.engineHours, 1 / 3600);
    var averageGph = fuelGallons !== null && engineHours !== null && engineHours > 0
      ? fuelGallons / engineHours : null;
    var idleFuelGallons = averageGph !== null
      ? Math.min(fuelGallons, averageGph * buckets.idleMinutes / 60) : null;
    var productiveFuel = fuelGallons !== null && idleFuelGallons !== null
      ? Math.max(0, fuelGallons - idleFuelGallons) : null;
    var productiveHours = Math.max(
      0, buckets.engineRunningMinutes - buckets.idleMinutes
    ) / 60;
    var speedObservations = sorted(data.speed);
    var maxSpeedMph = speedObservations.length ? speedObservations.reduce(function (maximum, record) {
      var mph = speedMph(record);
      return mph === null ? maximum : Math.max(maximum, mph);
    }, 0) : null;
    var classifiedMinutes = buckets.movingMinutes + buckets.idleMinutes
      + buckets.keyOnMinutes + buckets.engineOffMinutes + buckets.stoppedMinutes;
    var moves = capable ? countVerifiedMoves(data.fifthWheel, data.speed) : null;

    return Object.assign({
      deviceId: device.deviceId,
      displayName: device.displayName,
      fifthWheelCapable: capable,
      moveCount: moves,
      moveBasis: capable && moves !== null ? "verified" : "unavailable",
      shiftMinutes: window.durationMinutes,
      classifiedMinutes: classifiedMinutes,
      utilizationPercent: window.durationMinutes > 0
        ? buckets.movingMinutes / window.durationMinutes * 100 : null,
      idlePercent: buckets.engineRunningMinutes > 0
        ? buckets.idleMinutes / buckets.engineRunningMinutes * 100 : null,
      fuelGallons: fuelGallons,
      idleFuelGallons: idleFuelGallons,
      idleFuelEstimated: idleFuelGallons !== null,
      productiveFuelGallons: productiveFuel,
      gallonsPerProductiveHour: productiveFuel !== null && productiveHours > 0
        ? productiveFuel / productiveHours : null,
      maxSpeedMph: maxSpeedMph,
      coupledAverageMovingSpeedMph: buckets.coupledMovingMinutes > 0
        ? buckets.coupledDistanceMiles / (buckets.coupledMovingMinutes / 60) : null,
      uncoupledAverageMovingSpeedMph: buckets.uncoupledMovingMinutes > 0
        ? buckets.uncoupledDistanceMiles / (buckets.uncoupledMovingMinutes / 60) : null,
      driverDisplayName: lastDriverName(data.driverEvents)
    }, buckets, {
      offMinutes: buckets.keyOnMinutes + buckets.engineOffMinutes,
      unavailableMinutes: buckets.stoppedMinutes
    });
  }

  function sum(units, key) {
    return units.reduce(function (total, unit) {
      return total + (Number.isFinite(unit[key]) ? unit[key] : 0);
    }, 0);
  }

  function optionalSum(units, key) {
    var values = units.filter(function (unit) { return Number.isFinite(unit[key]); });
    return values.length ? sum(values, key) : null;
  }

  function facilitySummary(units, window) {
    var source = Array.isArray(units) ? units : [];
    var totalObservable = window.durationMinutes * source.length;
    var verified = source.filter(function (unit) { return unit.moveBasis === "verified"; });
    var coupledMoving = sum(source, "coupledMovingMinutes");
    var uncoupledMoving = sum(source, "uncoupledMovingMinutes");
    var coupledDistance = optionalSum(
      source.filter(function (unit) { return unit.fifthWheelCapable; }),
      "coupledDistanceMiles"
    );
    var uncoupledDistance = optionalSum(
      source.filter(function (unit) { return unit.fifthWheelCapable; }),
      "uncoupledDistanceMiles"
    );
    var engineRunning = sum(source, "engineRunningMinutes");
    var idle = sum(source, "idleMinutes");
    return {
      units: source.length,
      totalMoves: optionalSum(verified, "moveCount"),
      verifiedMoves: optionalSum(verified, "moveCount"),
      utilizationPercent: totalObservable > 0
        ? sum(source, "movingMinutes") / totalObservable * 100 : null,
      engineRunningMinutes: engineRunning,
      movingMinutes: sum(source, "movingMinutes"),
      idleMinutes: idle,
      offMinutes: sum(source, "offMinutes"),
      unavailableMinutes: sum(source, "unavailableMinutes"),
      idlePercent: engineRunning > 0 ? idle / engineRunning * 100 : null,
      fuelGallons: optionalSum(source, "fuelGallons"),
      idleFuelGallons: optionalSum(source, "idleFuelGallons"),
      coupledMinutes: optionalSum(
        source.filter(function (unit) { return unit.fifthWheelCapable; }), "coupledMinutes"
      ),
      uncoupledMinutes: optionalSum(
        source.filter(function (unit) { return unit.fifthWheelCapable; }), "uncoupledMinutes"
      ),
      coupledDistanceMiles: coupledDistance,
      uncoupledDistanceMiles: uncoupledDistance,
      coupledAverageMovingSpeedMph: coupledMoving > 0 && coupledDistance !== null
        ? coupledDistance / (coupledMoving / 60) : null,
      uncoupledAverageMovingSpeedMph: uncoupledMoving > 0 && uncoupledDistance !== null
        ? uncoupledDistance / (uncoupledMoving / 60) : null
    };
  }

  return {
    ENGINE_RUNNING_RPM: ENGINE_RUNNING_RPM,
    KPH_TO_MPH: KPH_TO_MPH,
    LITERS_TO_GALLONS: LITERS_TO_GALLONS,
    MOVING_MPH: MOVING_MPH,
    analyzeUnit: analyzeUnit,
    countVerifiedMoves: countVerifiedMoves,
    cumulativeDelta: cumulativeDelta,
    facilitySummary: facilitySummary,
    resolveWindow: resolveWindow
  };
}));
