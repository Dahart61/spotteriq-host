(function (root, factory) {
  "use strict";

  var driverAttribution = typeof module === "object" && module.exports
    ? require("./driver-attribution") : root.SIQ_DRIVER_ATTRIBUTION;
  var engineHoursReport = typeof module === "object" && module.exports
    ? require("./engine-hours-report") : root.SIQ_ENGINE_HOURS_REPORT;
  var api = factory(driverAttribution, engineHoursReport);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_MANAGEMENT_REPORTS = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  driverAttribution,
  engineHoursReport
) {
  "use strict";

  var KPH_TO_MPH = 0.621371;

  function rawValue(record, lower, upper) {
    return record && Object.prototype.hasOwnProperty.call(record, lower)
      ? record[lower] : record && record[upper];
  }

  function recordTime(record) {
    return Date.parse(rawValue(record, "dateTime", "DateTime"));
  }

  function recordData(record) {
    return Number(rawValue(record, "data", "Data"));
  }

  function speedMph(record) {
    var value = Number(rawValue(record, "speed", "Speed"));
    if (!Number.isFinite(value)) {
      value = recordData(record);
    }
    return Number.isFinite(value) && value >= 0 ? value * KPH_TO_MPH : null;
  }

  function sorted(records) {
    return (Array.isArray(records) ? records : []).filter(function (record) {
      return Number.isFinite(recordTime(record));
    }).slice().sort(function (left, right) {
      return recordTime(left) - recordTime(right);
    });
  }

  function sum(rows, key) {
    return (rows || []).reduce(function (total, row) {
      return total + (Number.isFinite(row[key]) ? row[key] : 0);
    }, 0);
  }

  function optionalSum(rows, key) {
    var supported = (rows || []).filter(function (row) {
      return Number.isFinite(row[key]);
    });
    return supported.length ? sum(supported, key) : null;
  }

  function driverLabel(interval) {
    return interval && interval.driverId
      ? interval.driverDisplayName || "Identified driver" : "Unattributed";
  }

  function timelineFor(device, data, window) {
    return driverAttribution.attributionIntervals(
      data && data.driverEvents || [],
      Object.assign({}, window, { deviceId: device.deviceId })
    ).map(function (segment) {
      return Object.assign({}, segment, {
        deviceId: device.deviceId,
        unitDisplayName: device.displayName,
        driverLabel: driverLabel(segment),
        durationMinutes: (Date.parse(segment.endUtc)
          - Date.parse(segment.startUtc)) / 60000
      });
    });
  }

  function intervalAt(segments, timestamp) {
    var instant = Date.parse(timestamp);
    if (!Number.isFinite(instant)) {
      return null;
    }
    var exact = (segments || []).find(function (segment) {
      return Date.parse(segment.startUtc) <= instant
        && instant < Date.parse(segment.endUtc);
    });
    if (exact) {
      return exact;
    }
    var last = segments && segments[segments.length - 1];
    return last && instant === Date.parse(last.endUtc) ? last : null;
  }

  function activityIntervals(unit) {
    if (!unit || !Array.isArray(unit.operatingIntervals)) {
      throw new TypeError("Canonical operating intervals are required");
    }
    return unit.operatingIntervals.map(function (interval) {
      return {
        start: interval.start,
        end: interval.end,
        engineRunning: interval.engineRunning,
        moving: interval.moving,
        unavailable: interval.unavailable === true
      };
    });
  }

  function attributedActivity(activity, driverSegments) {
    var result = [];
    (activity || []).forEach(function (vehicle) {
      (driverSegments || []).forEach(function (driver) {
        var start = Math.max(vehicle.start, Date.parse(driver.startUtc));
        var end = Math.min(vehicle.end, Date.parse(driver.endUtc));
        if (start < end) {
          result.push({
            start: start,
            end: end,
            durationMinutes: (end - start) / 60000,
            engineRunning: vehicle.engineRunning,
            moving: vehicle.moving,
            driverId: driver.driverId,
            driverDisplayName: driver.driverDisplayName,
            driverLabel: driver.driverLabel
          });
        }
      });
    });
    return result;
  }

  function driverAccumulator(segment) {
    return {
      driverId: segment.driverId,
      driverDisplayName: segment.driverDisplayName,
      driverLabel: segment.driverLabel,
      assignedMinutes: 0,
      engineRunningMinutes: 0,
      movingMinutes: 0,
      stationaryMinutes: 0,
      verifiedMoves: 0,
      maxSpeedMph: null,
      speedActivityCount: 0,
      trucks: new Map()
    };
  }

  function truckAccumulator(device, unit, segments) {
    var drivers = new Map();
    segments.filter(function (segment) {
      return Boolean(segment.driverId) && segment.durationMinutes > 0;
    }).forEach(function (segment) {
      if (!drivers.has(segment.driverId)) {
        drivers.set(segment.driverId, {
          driverId: segment.driverId,
          driverDisplayName: segment.driverDisplayName,
          driverLabel: segment.driverLabel,
          assignedMinutes: 0,
          engineRunningMinutes: 0,
          movingMinutes: 0,
          stationaryMinutes: 0,
          verifiedMoves: 0,
          maxSpeedMph: null
        });
      }
      drivers.get(segment.driverId).assignedMinutes += segment.durationMinutes;
    });
    return {
      deviceId: device.deviceId,
      displayName: device.displayName,
      fifthWheelCapable: unit.fifthWheelCapable,
      engineRunningMinutes: unit.engineRunningMinutes,
      movingMinutes: unit.movingMinutes,
      stationaryMinutes: unit.idleMinutes,
      offMinutes: unit.offMinutes,
      unavailableMinutes: unit.unavailableMinutes,
      utilizationPercent: unit.engineRunningMinutes > 0
        ? unit.movingMinutes / unit.engineRunningMinutes * 100 : null,
      verifiedMoves: unit.moveCount,
      fuelGallons: unit.fuelGallons,
      idleFuelGallons: unit.idleFuelGallons,
      productiveFuelGallons: unit.productiveFuelGallons,
      engineHoursDelta: unit.engineHoursDelta,
      maxSpeedMph: unit.maxSpeedMph,
      peakSpeedTimestamp: unit.peakSpeedTimestamp,
      speedActivityCount: Number.isFinite(unit.maxSpeedMph) ? 1 : 0,
      totalDistanceMiles: null,
      coupledDistanceMiles: null,
      bobtailDistanceMiles: null,
      driverCount: drivers.size,
      drivers: drivers
    };
  }

  function addDriverTruck(driver, truck, attributed) {
    if (!driver.trucks.has(truck.deviceId)) {
      driver.trucks.set(truck.deviceId, {
        displayName: truck.displayName,
        assignedMinutes: 0,
        engineRunningMinutes: 0,
        movingMinutes: 0,
        stationaryMinutes: 0,
        verifiedMoves: 0,
        maxSpeedMph: null,
        totalDistanceMiles: null
      });
    }
    var detail = driver.trucks.get(truck.deviceId);
    attributed.filter(function (item) {
      return item.driverId === driver.driverId;
    }).forEach(function (item) {
      detail.engineRunningMinutes += item.engineRunning ? item.durationMinutes : 0;
      detail.movingMinutes += item.moving ? item.durationMinutes : 0;
      detail.stationaryMinutes += item.engineRunning && !item.moving
        ? item.durationMinutes : 0;
    });
  }

  function finalizeDriver(driver) {
    var trucks = Array.from(driver.trucks.values()).sort(function (left, right) {
      return left.displayName.localeCompare(right.displayName);
    });
    return {
      driverDisplayName: driver.driverDisplayName,
      driverLabel: driver.driverLabel,
      assignedMinutes: driver.assignedMinutes,
      engineRunningMinutes: driver.engineRunningMinutes,
      movingMinutes: driver.movingMinutes,
      stationaryMinutes: driver.stationaryMinutes,
      utilizationPercent: driver.engineRunningMinutes > 0
        ? driver.movingMinutes / driver.engineRunningMinutes * 100 : null,
      verifiedMoves: driver.verifiedMoves,
      movesPerAssignedHour: driver.assignedMinutes > 0
        ? driver.verifiedMoves / (driver.assignedMinutes / 60) : null,
      movesPerEngineRunningHour: driver.engineRunningMinutes > 0
        ? driver.verifiedMoves / (driver.engineRunningMinutes / 60) : null,
      maxSpeedMph: driver.maxSpeedMph,
      speedActivityCount: driver.speedActivityCount,
      totalDistanceMiles: null,
      coupledDistanceMiles: null,
      bobtailDistanceMiles: null,
      bobtailSharePercent: null,
      averageCoupledMoveDistanceMiles: null,
      trucksOperated: trucks.length,
      trucks: trucks
    };
  }

  function finalizeTruck(truck) {
    var drivers = Array.from(truck.drivers.values()).map(function (driver) {
      return {
        driverDisplayName: driver.driverDisplayName,
        driverLabel: driver.driverLabel,
        assignedMinutes: driver.assignedMinutes,
        engineRunningMinutes: driver.engineRunningMinutes,
        movingMinutes: driver.movingMinutes,
        stationaryMinutes: driver.stationaryMinutes,
        verifiedMoves: driver.verifiedMoves,
        maxSpeedMph: driver.maxSpeedMph,
        totalDistanceMiles: null
      };
    }).sort(function (left, right) {
      return left.driverLabel.localeCompare(right.driverLabel);
    });
    return Object.assign({}, truck, {
      drivers: drivers,
      driverCount: drivers.length,
      averageCoupledMoveDistanceMiles: null,
      bobtailSharePercent: null
    });
  }

  function operatingContext(trucks) {
    var entries = [];
    var stationary = trucks.filter(function (truck) {
      return Number.isFinite(truck.stationaryMinutes);
    }).slice().sort(function (left, right) {
      return right.stationaryMinutes - left.stationaryMinutes
        || left.displayName.localeCompare(right.displayName);
    })[0];
    if (stationary && stationary.stationaryMinutes > 0) {
      entries.push({
        label: "Longest Engine Running \u00b7 Stationary",
        subject: stationary.displayName,
        value: stationary.stationaryMinutes,
        valueType: "duration"
      });
    }
    var peak = trucks.filter(function (truck) {
      return Number.isFinite(truck.maxSpeedMph);
    }).slice().sort(function (left, right) {
      return right.maxSpeedMph - left.maxSpeedMph
        || left.displayName.localeCompare(right.displayName);
    })[0];
    if (peak) {
      entries.push({
        label: "Peak Observed Speed",
        subject: peak.displayName,
        value: peak.maxSpeedMph,
        valueType: "speed"
      });
    }
    var active = trucks.slice().sort(function (left, right) {
      var leftMoves = Number.isFinite(left.verifiedMoves) ? left.verifiedMoves : -1;
      var rightMoves = Number.isFinite(right.verifiedMoves) ? right.verifiedMoves : -1;
      return rightMoves - leftMoves || right.movingMinutes - left.movingMinutes
        || left.displayName.localeCompare(right.displayName);
    })[0];
    if (active && (active.movingMinutes > 0 || active.verifiedMoves > 0)) {
      entries.push({
        label: "Most Active Truck",
        subject: active.displayName,
        value: Number.isFinite(active.verifiedMoves)
          ? active.verifiedMoves : active.movingMinutes,
        valueType: Number.isFinite(active.verifiedMoves) ? "moves" : "duration"
      });
    }
    return entries;
  }

  function build(devices, byDevice, units, window) {
    var unitByDevice = new Map((units || []).map(function (unit) {
      return [unit.deviceId, unit];
    }));
    var drivers = new Map();
    var trucks = [];
    var moveEvents = [];
    var speedEvents = [];
    var attributionSegments = [];

    (devices || []).forEach(function (device) {
      var data = byDevice.get(device.deviceId) || {};
      var unit = unitByDevice.get(device.deviceId);
      if (!unit) {
        return;
      }
      var segments = timelineFor(device, data, window);
      var attributed = attributedActivity(activityIntervals(unit), segments);
      var truck = truckAccumulator(device, unit, segments);
      attributionSegments = attributionSegments.concat(segments);

      segments.filter(function (segment) {
        return Boolean(segment.driverId) && segment.durationMinutes > 0;
      }).forEach(function (segment) {
        if (!drivers.has(segment.driverId)) {
          drivers.set(segment.driverId, driverAccumulator(segment));
        }
        drivers.get(segment.driverId).assignedMinutes += segment.durationMinutes;
      });
      drivers.forEach(function (driver) {
        if (segments.some(function (segment) {
          return segment.driverId === driver.driverId;
        })) {
          addDriverTruck(driver, truck, attributed);
          driver.trucks.get(truck.deviceId).assignedMinutes = segments.filter(function (segment) {
            return segment.driverId === driver.driverId;
          }).reduce(function (total, segment) {
            return total + segment.durationMinutes;
          }, 0);
        }
      });

      attributed.forEach(function (item) {
        if (!item.driverId || !drivers.has(item.driverId)) {
          return;
        }
        var driver = drivers.get(item.driverId);
        driver.engineRunningMinutes += item.engineRunning ? item.durationMinutes : 0;
        driver.movingMinutes += item.moving ? item.durationMinutes : 0;
        driver.stationaryMinutes += item.engineRunning && !item.moving
          ? item.durationMinutes : 0;
        var truckDriver = truck.drivers.get(item.driverId);
        truckDriver.engineRunningMinutes += item.engineRunning ? item.durationMinutes : 0;
        truckDriver.movingMinutes += item.moving ? item.durationMinutes : 0;
        truckDriver.stationaryMinutes += item.engineRunning && !item.moving
          ? item.durationMinutes : 0;
      });

      (unit.verifiedMoveRecords || []).forEach(function (move) {
        var segment = intervalAt(segments, move.completionTimestamp);
        var driverId = segment && segment.driverId || null;
        if (driverId && drivers.has(driverId)) {
          drivers.get(driverId).verifiedMoves += 1;
          drivers.get(driverId).trucks.get(device.deviceId).verifiedMoves += 1;
          truck.drivers.get(driverId).verifiedMoves += 1;
        }
        moveEvents.push(Object.assign({}, move, {
          deviceDisplayName: device.displayName,
          driverDisplayName: segment && segment.driverDisplayName || null,
          driverLabel: driverLabel(segment),
          coupledDistanceMiles: null,
          bobtailRepositionDistanceMiles: null
        }));
      });

      sorted(data.speed).forEach(function (record) {
        var mph = speedMph(record);
        var instant = recordTime(record);
        if (!Number.isFinite(mph) || instant < Date.parse(window.startUtc)
          || instant >= Date.parse(window.endUtc)) {
          return;
        }
        var segment = intervalAt(segments, new Date(instant).toISOString());
        if (segment && segment.driverId && drivers.has(segment.driverId)) {
          var driver = drivers.get(segment.driverId);
          driver.maxSpeedMph = driver.maxSpeedMph === null
            ? mph : Math.max(driver.maxSpeedMph, mph);
          var driverTruck = driver.trucks.get(device.deviceId);
          driverTruck.maxSpeedMph = driverTruck.maxSpeedMph === null
            ? mph : Math.max(driverTruck.maxSpeedMph, mph);
          var truckDriver = truck.drivers.get(segment.driverId);
          truckDriver.maxSpeedMph = truckDriver.maxSpeedMph === null
            ? mph : Math.max(truckDriver.maxSpeedMph, mph);
        }
      });

      if (unit.peakSpeedTimestamp) {
        var peakSegment = intervalAt(segments, unit.peakSpeedTimestamp);
        if (peakSegment && peakSegment.driverId && drivers.has(peakSegment.driverId)) {
          drivers.get(peakSegment.driverId).speedActivityCount += 1;
        }
        speedEvents.push({
          deviceDisplayName: device.displayName,
          driverDisplayName: peakSegment && peakSegment.driverDisplayName || null,
          driverLabel: driverLabel(peakSegment),
          peakSpeedMph: unit.maxSpeedMph,
          peakTimestamp: unit.peakSpeedTimestamp
        });
      }
      trucks.push(finalizeTruck(truck));
    });

    var finalizedDrivers = Array.from(drivers.values()).map(finalizeDriver)
      .sort(function (left, right) {
        return left.driverLabel.localeCompare(right.driverLabel);
      });
    trucks.sort(function (left, right) {
      return left.displayName.localeCompare(right.displayName);
    });
    moveEvents.sort(function (left, right) {
      return Date.parse(left.completionTimestamp) - Date.parse(right.completionTimestamp)
        || left.deviceDisplayName.localeCompare(right.deviceDisplayName);
    });
    speedEvents.sort(function (left, right) {
      return Date.parse(left.peakTimestamp) - Date.parse(right.peakTimestamp)
        || left.deviceDisplayName.localeCompare(right.deviceDisplayName);
    });

    var engineRunning = sum(trucks, "engineRunningMinutes");
    var moving = sum(trucks, "movingMinutes");
    var usedTrucks = trucks.filter(function (truck) {
      return truck.engineRunningMinutes > 0 || truck.movingMinutes > 0
        || Number.isFinite(truck.verifiedMoves) && truck.verifiedMoves > 0;
    }).length;
    return {
      definitionVersion: 1,
      attributionSegments: attributionSegments,
      drivers: finalizedDrivers,
      trucks: trucks,
      moves: moveEvents,
      speedActivity: speedEvents,
      engineHours: engineHoursReport.build(devices, byDevice, units, window),
      distanceStatus: "UNAVAILABLE_NO_TRUSTED_BOUNDED_DISTANCE_SOURCE",
      overview: {
        verifiedMoves: optionalSum(trucks.filter(function (truck) {
          return Number.isFinite(truck.verifiedMoves);
        }), "verifiedMoves"),
        activeDrivers: finalizedDrivers.length,
        trucksUsed: usedTrucks,
        authorizedTrucks: trucks.length,
        engineRunningMinutes: engineRunning,
        movingMinutes: moving,
        stationaryMinutes: sum(trucks, "stationaryMinutes"),
        utilizationPercent: engineRunning > 0 ? moving / engineRunning * 100 : null,
        fuelGallons: optionalSum(trucks, "fuelGallons"),
        idleFuelGallons: optionalSum(trucks, "idleFuelGallons"),
        totalDistanceMiles: null,
        peakSpeedMph: trucks.reduce(function (maximum, truck) {
          return Number.isFinite(truck.maxSpeedMph)
            ? maximum === null ? truck.maxSpeedMph : Math.max(maximum, truck.maxSpeedMph)
            : maximum;
        }, null),
        operatingContext: operatingContext(trucks),
        trucksUsedDefinition: "Engine running, movement, or a verified move in the exact window"
      }
    };
  }

  return {
    build: build,
    activityIntervals: activityIntervals,
    attributedActivity: attributedActivity,
    intervalAt: intervalAt,
    timelineFor: timelineFor
  };
}));
