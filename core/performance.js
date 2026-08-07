(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_PERFORMANCE = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var UNAVAILABLE = "Unavailable";
  var METRICS = {
    completedMoves: {
      label: "Completed Moves",
      direction: "higher",
      aggregation: "sum",
      decimals: 0
    },
    movesPerEngineHour: {
      label: "Moves / Engine Hour",
      direction: "higher",
      aggregation: "average",
      decimals: 1
    },
    productiveUtilization: {
      label: "Productive Utilization",
      direction: "higher",
      aggregation: "average",
      decimals: 1,
      suffix: "%"
    },
    fuelPerMove: {
      label: "Fuel / Move",
      direction: "lower",
      aggregation: "average",
      decimals: 1,
      suffix: " gal"
    },
    engineHours: {
      label: "Total Engine Hours",
      direction: "neutral",
      aggregation: "sum",
      decimals: 1,
      suffix: "h"
    },
    idleTime: {
      label: "Idle Time",
      direction: "lower",
      aggregation: "sum",
      duration: true
    },
    timeOverLimit: {
      label: "Time Over Speed Limit",
      direction: "lower",
      aggregation: "sum",
      duration: true
    },
    topSpeed: {
      label: "Top Speed",
      direction: "neutral",
      aggregation: "max",
      decimals: 0,
      suffix: " mph"
    }
  };

  var SUMMARY_KEYS = [
    "completedMoves",
    "movesPerEngineHour",
    "productiveUtilization",
    "fuelPerMove",
    "engineHours",
    "idleTime",
    "timeOverLimit"
  ];

  var COMPARISON_KEYS = [
    "movesPerEngineHour",
    "productiveUtilization",
    "fuelPerMove",
    "idleTime",
    "timeOverLimit",
    "completedMoves"
  ];

  var TREND_KEYS = [
    "movesPerEngineHour",
    "productiveUtilization",
    "fuelPerMove",
    "idleTime",
    "timeOverLimit",
    "engineHours"
  ];

  function finiteNumber(value) {
    if (value === null || value === undefined || value === "" || value === "--" || value === UNAVAILABLE) {
      return null;
    }
    var parsed = Number(String(value).replace(/[^0-9.+-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseGallons(value) {
    return finiteNumber(value);
  }

  function parsePercent(value) {
    return finiteNumber(value);
  }

  function parseDurationMinutes(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (!value || value === "--" || value === UNAVAILABLE) {
      return null;
    }
    var source = String(value);
    var hours = /(\d+(?:\.\d+)?)h/.exec(source);
    var minutes = /(\d+(?:\.\d+)?)m/.exec(source);
    if (!hours && !minutes) {
      return null;
    }
    return (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  }

  function formatNumber(value, decimals) {
    return Number(value).toFixed(decimals).replace(/\.0$/, "");
  }

  function formatDuration(minutes) {
    if (!Number.isFinite(minutes)) {
      return UNAVAILABLE;
    }
    var rounded = Math.round(minutes);
    var hours = Math.floor(rounded / 60);
    var remainder = rounded % 60;
    if (hours && remainder) {
      return hours + "h " + remainder + "m";
    }
    if (hours) {
      return hours + "h";
    }
    return remainder + "m";
  }

  function formatObservedDuration(minutes) {
    if (!Number.isFinite(minutes)) {
      return UNAVAILABLE;
    }
    var rounded = Math.round(minutes);
    var hours = Math.floor(rounded / 60);
    var remainder = rounded % 60;
    if (hours) {
      return hours + "h " + String(remainder).padStart(2, "0") + "m";
    }
    return remainder + "m";
  }

  function formatMetric(metricKey, value) {
    var definition = METRICS[metricKey];
    if (!definition || value === null || value === undefined || !Number.isFinite(Number(value))) {
      return UNAVAILABLE;
    }
    if (definition.duration) {
      return formatDuration(Number(value));
    }
    return formatNumber(Number(value), definition.decimals || 0) + (definition.suffix || "");
  }

  function performanceCapabilities(unit) {
    var declared = unit && unit.performance && unit.performance.capabilities
      ? unit.performance.capabilities
      : {};
    var verifiedMoves = declared.verifiedMoves !== false
      && unit
      && unit.verifiedMovesLabel !== "Verified Moves Unavailable";
    return {
      fifthWheelStatus: declared.fifthWheelStatus !== false && verifiedMoves,
      verifiedMoves: verifiedMoves,
      engineHours: declared.engineHours !== false,
      fuel: declared.fuel !== false,
      speed: declared.speed !== false
    };
  }

  function speedPolicyConfigured(unit) {
    return !(unit && unit.performance
      && unit.performance.speedPolicyConfigured === false);
  }

  function metricUnavailableReason(unit, metricKey) {
    var capabilities = performanceCapabilities(unit);
    if ((metricKey === "timeOverLimit") && !speedPolicyConfigured(unit)) {
      return "Policy Not Configured";
    }
    if ((metricKey === "timeOverLimit" || metricKey === "topSpeed")
      && !capabilities.speed) {
      return "Hardware Capability Unavailable";
    }
    if (metricValue(unit, metricKey) === null) {
      return "Insufficient Data";
    }
    return null;
  }

  function metricValue(unit, metricKey) {
    if (!unit || !unit.performance) {
      return null;
    }
    var capabilities = performanceCapabilities(unit);
    var record = unit.performance;
    if (metricKey === "completedMoves") {
      return capabilities.verifiedMoves ? finiteNumber(unit.moves) : null;
    }
    if (metricKey === "movesPerEngineHour") {
      return capabilities.verifiedMoves && capabilities.engineHours
        ? finiteNumber(record.movesPerEngineHour)
        : null;
    }
    if (metricKey === "productiveUtilization") {
      return parsePercent(record.productiveUtilization);
    }
    if (metricKey === "fuelPerMove") {
      return capabilities.verifiedMoves && capabilities.fuel
        ? parseGallons(record.fuelPerMove)
        : null;
    }
    if (metricKey === "engineHours") {
      if (!capabilities.engineHours) {
        return null;
      }
      var engineMinutes = parseDurationMinutes(record.engineHours);
      return engineMinutes === null ? null : engineMinutes / 60;
    }
    if (metricKey === "idleTime") {
      if (Number.isFinite(record.idleMinutes)) {
        return record.idleMinutes;
      }
      var coupledIdle = parseDurationMinutes(record.coupledIdle);
      var uncoupledIdle = parseDurationMinutes(record.bobtailIdle);
      return coupledIdle === null && uncoupledIdle === null
        ? null
        : (coupledIdle || 0) + (uncoupledIdle || 0);
    }
    if (metricKey === "timeOverLimit") {
      return capabilities.speed && speedPolicyConfigured(unit)
        ? parseDurationMinutes(unit.overSpeed) : null;
    }
    if (metricKey === "topSpeed") {
      return capabilities.speed ? finiteNumber(unit.topSpeed) : null;
    }
    return null;
  }

  function priorMetricValue(unit, metricKey) {
    if (!unit || !unit.performance || !unit.performance.priorMetrics) {
      return null;
    }
    if (metricValue(unit, metricKey) === null) {
      return null;
    }
    return finiteNumber(unit.performance.priorMetrics[metricKey]);
  }

  function aggregate(values, aggregation) {
    if (!values.length) {
      return null;
    }
    if (aggregation === "sum") {
      return values.reduce(function (total, value) {
        return total + value;
      }, 0);
    }
    if (aggregation === "max") {
      return Math.max.apply(Math, values);
    }
    return values.reduce(function (total, value) {
      return total + value;
    }, 0) / values.length;
  }

  function capabilityAwareAverage(units, metricKey) {
    var values = (units || []).map(function (unit) {
      return metricValue(unit, metricKey);
    }).filter(function (value) {
      return value !== null;
    });
    return values.length
      ? values.reduce(function (total, value) {
        return total + value;
      }, 0) / values.length
      : null;
  }

  function aggregateMetric(units, metricKey, usePrior) {
    var definition = METRICS[metricKey];
    if (!definition) {
      return { value: null, availableCount: 0, totalCount: (units || []).length };
    }
    var values = (units || []).map(function (unit) {
      return usePrior ? priorMetricValue(unit, metricKey) : metricValue(unit, metricKey);
    }).filter(function (value) {
      return value !== null;
    });
    return {
      value: aggregate(values, definition.aggregation),
      availableCount: values.length,
      totalCount: (units || []).length
    };
  }

  function metricFavorability(metricKey, difference) {
    var definition = METRICS[metricKey];
    if (!definition || !Number.isFinite(difference) || difference === 0 || definition.direction === "neutral") {
      return "neutral";
    }
    if (definition.direction === "higher") {
      return difference > 0 ? "favorable" : "unfavorable";
    }
    return difference < 0 ? "favorable" : "unfavorable";
  }

  function deltaMagnitude(metricKey, difference) {
    var magnitude = Math.abs(difference);
    if (metricKey === "productiveUtilization") {
      return formatNumber(magnitude, 1) + " points";
    }
    if (metricKey === "fuelPerMove") {
      return formatNumber(magnitude, 1) + " gal";
    }
    if (metricKey === "idleTime" || metricKey === "timeOverLimit") {
      return Math.round(magnitude) + (Math.round(magnitude) === 1 ? " minute" : " minutes");
    }
    if (metricKey === "engineHours") {
      return formatNumber(magnitude, 1) + (magnitude === 1 ? " hour" : " hours");
    }
    return formatNumber(magnitude, METRICS[metricKey] ? METRICS[metricKey].decimals || 0 : 1);
  }

  function formatComparisonDelta(metricKey, current, prior, comparisonLabel) {
    if (current === null || prior === null || comparisonLabel === "No Comparison") {
      return {
        text: "No prior comparison",
        difference: null,
        favorability: "neutral"
      };
    }
    var difference = current - prior;
    if (Math.abs(difference) < 0.0001) {
      return {
        text: "No change vs " + String(comparisonLabel || "prior period").toLowerCase(),
        difference: 0,
        favorability: "neutral"
      };
    }
    return {
      text: deltaMagnitude(metricKey, difference)
        + (difference > 0 ? " higher" : " lower")
        + " vs " + String(comparisonLabel || "prior period").toLowerCase(),
      difference: difference,
      favorability: metricFavorability(metricKey, difference)
    };
  }

  function metricQualifier(metricKey, aggregateRecord, delta) {
    if (aggregateRecord.availableCount === 0) {
      return UNAVAILABLE;
    }
    if (metricKey === "completedMoves") {
      return aggregateRecord.availableCount + " verified-capable "
        + (aggregateRecord.availableCount === 1 ? "unit" : "units");
    }
    if (aggregateRecord.availableCount < aggregateRecord.totalCount) {
      return "Partial availability · " + aggregateRecord.availableCount
        + " of " + aggregateRecord.totalCount + " units";
    }
    if ((metricKey === "idleTime" || metricKey === "timeOverLimit")
        && delta.favorability === "unfavorable") {
      return "Needs review";
    }
    return "All authorized units";
  }

  function facilitySummary(units, comparisonLabel) {
    return SUMMARY_KEYS.map(function (metricKey) {
      var current = aggregateMetric(units, metricKey, false);
      var prior = aggregateMetric(units, metricKey, true);
      var delta = formatComparisonDelta(metricKey, current.value, prior.value, comparisonLabel);
      var record = {
        key: metricKey,
        label: METRICS[metricKey].label,
        value: formatMetric(metricKey, current.value),
        numericValue: current.value,
        comparison: delta.text,
        favorability: delta.favorability,
        qualifier: metricQualifier(metricKey, current, delta),
        availableCount: current.availableCount,
        totalCount: current.totalCount
      };
      if (metricKey === "timeOverLimit" && (units || []).length
        && units.every(function (unit) {
          return !speedPolicyConfigured(unit);
        })) {
        record.qualifier = "Speed Policy Not Configured";
        record.comparison = "Time Over Speed Limit Unavailable";
        record.favorability = "neutral";
      }
      return record;
    });
  }

  function attentionForUnit(unit) {
    var idleMinutes = metricValue(unit, "idleTime");
    var overLimit = metricValue(unit, "timeOverLimit");
    var capabilities = performanceCapabilities(unit);
    if (speedPolicyConfigured(unit)
      && overLimit !== null && overLimit > 0) {
      return { label: "Speed Review", priority: 5, kind: "review" };
    }
    if (idleMinutes !== null && idleMinutes >= 60) {
      return { label: "High Idle", priority: 4, kind: "review" };
    }
    if (unit.groupReconciliation && unit.groupReconciliation !== "MATCHED") {
      return { label: "Assignment Review", priority: 3, kind: "review" };
    }
    if (!capabilities.fifthWheelStatus) {
      return { label: "Fifth Wheel Status Unavailable", priority: 2, kind: "availability" };
    }
    if (metricValue(unit, "fuelPerMove") === null) {
      return { label: "Partial Fuel Data", priority: 1, kind: "availability" };
    }
    return { label: "None", priority: 0, kind: "none" };
  }

  function compareNullable(left, right, direction) {
    if (left === null && right === null) {
      return 0;
    }
    if (left === null) {
      return 1;
    }
    if (right === null) {
      return -1;
    }
    if (left === right) {
      return 0;
    }
    var comparison = left < right ? -1 : 1;
    return direction === "desc" ? -comparison : comparison;
  }

  function rankingValue(unit, key) {
    if (key === "unit") {
      return unit.displayLabel || unit.name || "";
    }
    if (key === "role") {
      return unit.roleLabel || "";
    }
    if (key === "attention") {
      return attentionForUnit(unit).priority;
    }
    return metricValue(unit, key);
  }

  function rankUnits(units, sort) {
    var requested = sort || {};
    var key = requested.key || "attention";
    var direction = requested.direction || (key === "attention" ? "desc" : "asc");
    return (units || []).map(function (unit, index) {
      return { unit: unit, index: index };
    }).sort(function (leftRecord, rightRecord) {
      var left = rankingValue(leftRecord.unit, key);
      var right = rankingValue(rightRecord.unit, key);
      var primary;
      if (typeof left === "string" || typeof right === "string") {
        primary = String(left).localeCompare(String(right));
        if (direction === "desc") {
          primary *= -1;
        }
      } else {
        primary = compareNullable(left, right, direction);
      }
      if (primary !== 0) {
        return primary;
      }
      if (key === "attention") {
        var productive = compareNullable(
          metricValue(leftRecord.unit, "productiveUtilization"),
          metricValue(rightRecord.unit, "productiveUtilization"),
          "desc"
        );
        if (productive !== 0) {
          return productive;
        }
      }
      return leftRecord.index - rightRecord.index;
    }).map(function (record) {
      return record.unit;
    });
  }

  function distributionValue(source, key) {
    var value = source && source[key];
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function donutModel(unit) {
    var capabilities = performanceCapabilities(unit);
    var source = unit && unit.performance ? unit.performance.distributionMinutes || {} : {};
    var categories;
    if (capabilities.fifthWheelStatus) {
      categories = [
        { key: "coupled-moving", label: "Trailer Coupled — Moving", minutes: distributionValue(source, "coupledMoving") },
        { key: "uncoupled-moving", label: "Trailer Uncoupled — Moving", minutes: distributionValue(source, "uncoupledMoving") },
        { key: "coupled-idle", label: "Trailer Coupled — Idle", minutes: distributionValue(source, "coupledIdle") },
        { key: "uncoupled-idle", label: "Trailer Uncoupled — Idle", minutes: distributionValue(source, "uncoupledIdle") },
        { key: "off", label: "Off", minutes: distributionValue(source, "off") },
        { key: "unavailable", label: "Data Unavailable", minutes: distributionValue(source, "unavailable") }
      ];
    } else {
      categories = [
        { key: "moving", label: "Moving", minutes: distributionValue(source, "moving") },
        { key: "idle", label: "Idle", minutes: distributionValue(source, "idle") },
        { key: "off", label: "Off", minutes: distributionValue(source, "off") },
        { key: "unavailable", label: "Data Unavailable", minutes: distributionValue(source, "unavailable") }
      ];
    }
    categories = categories.filter(function (category) {
      return category.minutes > 0;
    });
    var totalMinutes = categories.reduce(function (total, category) {
      return total + category.minutes;
    }, 0);
    var engineMinutes = categories.filter(function (category) {
      return category.key !== "off" && category.key !== "unavailable";
    }).reduce(function (total, category) {
      return total + category.minutes;
    }, 0);
    categories = categories.map(function (category) {
      var rawPercentage = totalMinutes ? category.minutes / totalMinutes * 100 : 0;
      return Object.assign({}, category, {
        duration: formatDuration(category.minutes),
        percentage: Math.floor(rawPercentage),
        percentageRemainder: rawPercentage - Math.floor(rawPercentage)
      });
    });
    var unallocatedPercentage = 100 - categories.reduce(function (total, category) {
      return total + category.percentage;
    }, 0);
    categories.map(function (category, index) {
      return {
        index: index,
        remainder: category.percentageRemainder
      };
    }).sort(function (left, right) {
      return right.remainder - left.remainder || left.index - right.index;
    }).slice(0, unallocatedPercentage).forEach(function (record) {
      categories[record.index].percentage += 1;
    });
    categories = categories.map(function (category) {
      var cleanCategory = Object.assign({}, category);
      delete cleanCategory.percentageRemainder;
      return cleanCategory;
    });
    var unavailableMinutes = categories.filter(function (category) {
      return category.key === "unavailable";
    }).reduce(function (total, category) {
      return total + category.minutes;
    }, 0);
    var categorySummary = categories.map(function (category) {
      return category.label + " " + category.duration + " " + category.percentage + "%";
    }).join("; ");
    var centerValue = formatDuration(engineMinutes);
    var observedPeriodValue = formatObservedDuration(totalMinutes);
    var coverageSummary = unavailableMinutes
      ? "Partial telemetry coverage · " + formatDuration(unavailableMinutes) + " data unavailable"
      : "No unavailable telemetry time";
    return {
      detailed: capabilities.fifthWheelStatus,
      categories: categories,
      totalMinutes: totalMinutes,
      engineMinutes: engineMinutes,
      unavailableMinutes: unavailableMinutes,
      centerValue: centerValue,
      centerLabel: "Engine Run Time",
      observedPeriodValue: observedPeriodValue,
      caption: "Engine run time: " + centerValue + " · Observed period: " + observedPeriodValue,
      coverageSummary: coverageSummary,
      categorySummary: categorySummary,
      summary: "Engine Run Time is " + centerValue + " and equals Moving + Idle. "
        + "The slices represent the full observed-period distribution of " + observedPeriodValue + ". "
        + coverageSummary + ". " + categorySummary + "."
    };
  }

  function capabilitySummaryModel(unit) {
    var capabilities = performanceCapabilities(unit);
    var available = [];
    var unavailable = [];
    var policyNotConfigured = [];

    [
      { label: "Engine Hours", supported: capabilities.engineHours },
      { label: "Fuel", supported: capabilities.fuel },
      { label: "Speed", supported: capabilities.speed },
      { label: "Fifth Wheel Status", supported: capabilities.fifthWheelStatus },
      { label: "Verified Moves", supported: capabilities.verifiedMoves }
    ].forEach(function (capability) {
      (capability.supported ? available : unavailable).push(capability.label);
    });
    if (capabilities.speed && !speedPolicyConfigured(unit)) {
      policyNotConfigured.push("Time Over Speed Limit");
    }

    return {
      available: available,
      unavailable: unavailable,
      hardwareUnavailable: unavailable,
      policyNotConfigured: policyNotConfigured,
      summary: "Available: " + (available.length ? available.join(", ") : "None") + "."
        + (unavailable.length
          ? " Hardware Capability Unavailable: " + unavailable.join(", ") + "." : "")
        + (policyNotConfigured.length
          ? " Policy Not Configured: " + policyNotConfigured.join(", ") + "." : "")
    };
  }

  function comparisonRows(unit, units) {
    return COMPARISON_KEYS.map(function (metricKey) {
      var selected = metricValue(unit, metricKey);
      var facility = capabilityAwareAverage(units, metricKey);
      var difference = selected === null || facility === null ? null : selected - facility;
      return {
        key: metricKey,
        label: METRICS[metricKey].label,
        selectedValue: formatMetric(metricKey, selected),
        facilityValue: formatMetric(metricKey, facility),
        difference: difference === null
          ? "Excluded from this comparison"
          : (Math.abs(difference) < 0.0001
            ? "Matches facility"
            : deltaMagnitude(metricKey, difference) + (difference > 0 ? " higher" : " lower")),
        favorability: difference === null ? "neutral" : metricFavorability(metricKey, difference),
        available: selected !== null
      };
    });
  }

  function relabelTrendPoint(point, index, dateRange) {
    if (dateRange === "today" || dateRange === "yesterday") {
      return point.label;
    }
    if (dateRange === "custom") {
      return point.customLabel || ("Range " + (index + 1));
    }
    return point.dayLabel || ("Day " + (index + 1));
  }

  function trendAggregationLabel(dateRange) {
    if (dateRange === "today" || dateRange === "yesterday") {
      return "Hour";
    }
    if (dateRange === "last-7"
        || dateRange === "last-30"
        || dateRange === "this-week"
        || dateRange === "last-week") {
      return "Day";
    }
    return "Period";
  }

  function trendMetricLabel(metricKey, dateRange) {
    if (metricKey === "engineHours") {
      return "Engine Hours per " + trendAggregationLabel(dateRange);
    }
    return METRICS[metricKey] ? METRICS[metricKey].label : "";
  }

  function isTrendDurationMetric(metricKey) {
    return metricKey === "idleTime" || metricKey === "timeOverLimit";
  }

  function formatTrendDuration(minutes, minutePrecision) {
    if (!Number.isFinite(minutes)) {
      return UNAVAILABLE;
    }
    var precision = Number.isInteger(minutePrecision)
      ? Math.max(0, Math.min(minutePrecision, 4))
      : 1;
    var roundedMinutes = Number(Math.abs(minutes).toFixed(precision));
    var secondPrecision = Math.max(0, precision - 1);
    var totalSeconds = Number((roundedMinutes * 60).toFixed(secondPrecision));
    var hours = Math.floor(totalSeconds / 3600);
    var remainingSeconds = totalSeconds - hours * 3600;
    var wholeMinutes = Math.floor(remainingSeconds / 60);
    var seconds = remainingSeconds - wholeMinutes * 60;
    var secondsText = seconds.toFixed(secondPrecision).padStart(secondPrecision ? 3 + secondPrecision : 2, "0");
    var prefix = minutes < 0 ? "-" : "";

    if (hours) {
      return prefix + hours + "h " + String(wholeMinutes).padStart(2, "0") + "m"
        + (seconds ? " " + secondsText + "s" : "");
    }
    return prefix + wholeMinutes + "m " + secondsText + "s";
  }

  function formatTrendValue(metricKey, value, precision) {
    if (!Number.isFinite(value)) {
      return UNAVAILABLE;
    }
    if (isTrendDurationMetric(metricKey)) {
      return formatTrendDuration(value, precision);
    }
    var decimals = Number.isInteger(precision)
      ? precision
      : (METRICS[metricKey] ? METRICS[metricKey].decimals || 0 : 1);
    var formatted = Number(value).toFixed(decimals);
    if (metricKey === "productiveUtilization") {
      return formatted + "%";
    }
    if (metricKey === "fuelPerMove") {
      return formatted + " gal";
    }
    if (metricKey === "engineHours") {
      return formatted + "h";
    }
    return formatted;
  }

  function trendTickModel(metricKey, minValue, maxValue, count) {
    var tickCount = Number.isInteger(count) && count > 1 ? count : 5;
    var span = maxValue - minValue;
    var step = span / (tickCount - 1);
    var precision = isTrendDurationMetric(metricKey)
      ? 1
      : (METRICS[metricKey] ? METRICS[metricKey].decimals || 0 : 1);
    if (metricKey === "engineHours" && step < 0.1) {
      precision = Math.max(precision, 2);
    }
    var values = Array.from({ length: tickCount }, function (_, index) {
      return minValue + step * index;
    });
    var labels = values.map(function (value) {
      return formatTrendValue(metricKey, value, precision);
    });
    if (isTrendDurationMetric(metricKey)) {
      var visibleLabels = new Set();
      return {
        precision: precision,
        ticks: values.reduce(function (ticks, value, index) {
          if (!visibleLabels.has(labels[index])) {
            visibleLabels.add(labels[index]);
            ticks.push({
              value: value,
              label: labels[index]
            });
          }
          return ticks;
        }, [])
      };
    }
    while (new Set(labels).size !== labels.length && precision < 4) {
      precision += 1;
      labels = values.map(function (value) {
        return formatTrendValue(metricKey, value, precision);
      });
    }
    return {
      precision: precision,
      ticks: values.map(function (value, index) {
        return {
          value: value,
          label: labels[index]
        };
      })
    };
  }

  function trendPointSummary(model, precision) {
    if (!model || !model.available || !Array.isArray(model.points)) {
      return model && model.summary ? model.summary : "";
    }
    return model.label + " point values: " + model.points.map(function (point) {
      if (point.value === null) {
        return point.label + ": selected unit data unavailable";
      }
      return point.label + ": selected unit " + formatTrendValue(model.key, point.value, precision)
        + (point.facilityAverage === null
          ? ""
          : "; facility average " + formatTrendValue(model.key, point.facilityAverage, precision));
    }).join(". ") + ".";
  }

  function trendSeriesModel(unit, metricKey, dateRange) {
    var record = unit && unit.performance && unit.performance.trends
      ? unit.performance.trends[metricKey]
      : null;
    var supported = TREND_KEYS.indexOf(metricKey) !== -1
      && metricValue(unit, metricKey) !== null
      && Array.isArray(record);
    var label = trendMetricLabel(metricKey, dateRange);
    var aggregation = trendAggregationLabel(dateRange);
    if (!supported) {
      return {
        key: metricKey,
        label: label,
        aggregation: aggregation,
        yAxisLabel: label,
        available: false,
        points: [],
        unit: METRICS[metricKey] && METRICS[metricKey].duration
          ? "minutes" : (METRICS[metricKey] ? METRICS[metricKey].suffix || "" : ""),
        footer: label + " is unavailable for this unit.",
        summary: label + " is unavailable for this unit."
      };
    }
    var points = record.map(function (point, index) {
      return {
        label: relabelTrendPoint(point, index, dateRange),
        value: Number.isFinite(point.value) ? point.value : null,
        facilityAverage: Number.isFinite(point.facilityAverage) ? point.facilityAverage : null
      };
    });
    var availablePoints = points.filter(function (point) {
      return point.value !== null;
    });
    var missingCount = points.length - availablePoints.length;
    return {
      key: metricKey,
      label: label,
      aggregation: aggregation,
      yAxisLabel: label,
      available: true,
      points: points,
      unit: METRICS[metricKey].duration ? "minutes" : METRICS[metricKey].suffix || "",
      footer: metricKey === "engineHours"
        ? label + " shows engine run hours recorded within each " + aggregation.toLowerCase()
          + "; it is not a cumulative lifetime total."
        : "Each point represents one " + aggregation.toLowerCase() + " in the selected reporting range.",
      summary: label + " has " + availablePoints.length + " available " + aggregation.toLowerCase() + " points"
        + (missingCount ? " and " + missingCount + " missing-data gap" + (missingCount === 1 ? "" : "s") : "")
        + ". The facility-average comparison is shown where available."
    };
  }

  function deterministicObservations(unit, units) {
    var operational = [];
    var availability = [];
    var exceptions = [];
    var utilization = metricValue(unit, "productiveUtilization");
    var facilityUtilization = capabilityAwareAverage(units, "productiveUtilization");
    var movesPerHour = metricValue(unit, "movesPerEngineHour");
    var sameRoleValues = (units || []).filter(function (candidate) {
      return candidate.roleLabel === unit.roleLabel;
    }).map(function (candidate) {
      return metricValue(candidate, "movesPerEngineHour");
    }).filter(function (value) {
      return value !== null;
    });
    var capabilities = performanceCapabilities(unit);

    if (movesPerHour !== null
        && sameRoleValues.length >= 2
        && movesPerHour === Math.max.apply(Math, sameRoleValues)) {
      operational.push("Highest moves per engine hour among " + String(unit.roleLabel || "comparable units").toLowerCase() + "s.");
    }
    if (utilization !== null && facilityUtilization !== null) {
      var utilizationDifference = utilization - facilityUtilization;
      operational.push("Productive utilization was " + deltaMagnitude("productiveUtilization", utilizationDifference)
        + (utilizationDifference >= 0 ? " above" : " below") + " the facility average.");
    }
    if (metricValue(unit, "timeOverLimit") === 0) {
      operational.push("No time was recorded over the configured speed limit.");
    }
    if (unit.moveInProgress) {
      operational.push("One move continued beyond the reporting boundary.");
    }
    if (unit.roleLabel === "Onsite Spare") {
      operational.push("The unit was assigned as an onsite spare during this period.");
    }

    if (!capabilities.fifthWheelStatus) {
      availability.push("Fifth Wheel Status is unavailable; verified move metrics are not available.");
    }
    if (!capabilities.fuel || parseGallons(unit.performance.fuelPerMove) === null) {
      availability.push("Fuel data was unavailable for part or all of the selected period.");
    }
    if (!capabilities.engineHours) {
      availability.push("Engine Hours are unavailable; rate metrics that require engine time are excluded.");
    }
    if (capabilities.speed && !speedPolicyConfigured(unit)) {
      availability.push("Speed Policy Not Configured; Time Over Speed Limit Unavailable.");
    }
    dataWarningsForUnit(unit).forEach(function (warning) {
      if (availability.indexOf(warning.message) === -1
          && warning.code !== "fifth-wheel-status-unavailable"
          && warning.code !== "fuel-unavailable") {
        availability.push(warning.message);
      }
    });

    var overLimit = metricValue(unit, "timeOverLimit");
    var idleMinutes = metricValue(unit, "idleTime");
    if (overLimit !== null && overLimit > 0) {
      exceptions.push(formatDuration(overLimit) + " was recorded over the configured speed limit.");
    }
    if (idleMinutes !== null && idleMinutes >= 60) {
      exceptions.push("Idle time reached " + formatDuration(idleMinutes) + " and requires review.");
    }
    if (unit.groupReconciliation && unit.groupReconciliation !== "MATCHED") {
      exceptions.push("The current assignment and facility group require reconciliation.");
    }
    if (!exceptions.length) {
      exceptions.push("No exceptions require review for this period.");
    }

    return {
      operational: operational,
      availability: availability,
      exceptions: exceptions
    };
  }

  function totalFuelGallons(units) {
    var values = (units || []).map(function (unit) {
      return parseGallons(unit.performance.fuelConsumed);
    }).filter(function (value) {
      return value !== null;
    });

    if (!values.length) {
      return null;
    }
    return values.reduce(function (total, value) {
      return total + value;
    }, 0);
  }

  function dataWarningsForUnit(unit) {
    if (!unit || !unit.performance || !Array.isArray(unit.performance.dataWarnings)) {
      return [];
    }
    return unit.performance.dataWarnings;
  }

  function primaryDataWarning(unit) {
    return dataWarningsForUnit(unit)[0] || null;
  }

  function summaryNotices(units) {
    var notices = [];
    (units || []).forEach(function (unit) {
      dataWarningsForUnit(unit).forEach(function (warning) {
        if (warning.summary && notices.indexOf(warning.summary) === -1) {
          notices.push(warning.summary);
        }
      });
    });
    return notices;
  }

  return {
    UNAVAILABLE: UNAVAILABLE,
    metrics: METRICS,
    summaryKeys: SUMMARY_KEYS,
    comparisonKeys: COMPARISON_KEYS,
    trendKeys: TREND_KEYS,
    parseGallons: parseGallons,
    parseDurationMinutes: parseDurationMinutes,
    formatDuration: formatDuration,
    formatObservedDuration: formatObservedDuration,
    formatMetric: formatMetric,
    performanceCapabilities: performanceCapabilities,
    speedPolicyConfigured: speedPolicyConfigured,
    metricUnavailableReason: metricUnavailableReason,
    metricValue: metricValue,
    metricFavorability: metricFavorability,
    formatComparisonDelta: formatComparisonDelta,
    capabilityAwareAverage: capabilityAwareAverage,
    facilitySummary: facilitySummary,
    attentionForUnit: attentionForUnit,
    rankUnits: rankUnits,
    donutModel: donutModel,
    capabilitySummaryModel: capabilitySummaryModel,
    comparisonRows: comparisonRows,
    trendAggregationLabel: trendAggregationLabel,
    trendMetricLabel: trendMetricLabel,
    formatTrendDuration: formatTrendDuration,
    formatTrendValue: formatTrendValue,
    trendTickModel: trendTickModel,
    trendPointSummary: trendPointSummary,
    trendSeriesModel: trendSeriesModel,
    deterministicObservations: deterministicObservations,
    totalFuelGallons: totalFuelGallons,
    dataWarningsForUnit: dataWarningsForUnit,
    primaryDataWarning: primaryDataWarning,
    summaryNotices: summaryNotices
  };
}));
