(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_REPORTS_VIEW = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var TITLES = Object.freeze({
    overview: "Overview",
    drivers: "Driver Productivity",
    trucks: "Truck Utilization",
    moves: "Trailer Moves",
    speed: "Speed Activity",
    productivity: "Truck Utilization",
    fuel: "Truck Utilization"
  });

  function duration(minutes) {
    if (!Number.isFinite(minutes)) { return "Unavailable"; }
    var rounded = Math.round(minutes);
    return Math.floor(rounded / 60) + "h "
      + String(rounded % 60).padStart(2, "0") + "m";
  }

  function percent(value) {
    return Number.isFinite(value) ? value.toFixed(0) + "%" : "Unavailable";
  }

  function decimal(value) {
    return Number.isFinite(value) ? value.toFixed(2) : "Unavailable";
  }

  function gallons(value, estimated) {
    return Number.isFinite(value)
      ? value.toFixed(1) + " gal" + (estimated ? " est." : "")
      : "Unavailable";
  }

  function speed(value) {
    return Number.isFinite(value) ? value.toFixed(1) + " mph" : "Unavailable";
  }

  function hours(value) {
    return Number.isFinite(value) ? value.toFixed(2) + " hr" : "Unavailable";
  }

  function miles(value) {
    return Number.isFinite(value) ? value.toFixed(1) + " mi" : "Unavailable";
  }

  function timestamp(value, timeZone) {
    if (!value) { return "Unavailable"; }
    return new Date(value).toLocaleString([], {
      timeZone: timeZone,
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", second: "2-digit"
    });
  }

  function windowLabel(window) {
    return timestamp(window.startUtc, window.timezone) + " - "
      + timestamp(window.endUtc, window.timezone);
  }

  function exactWindowLabel(window) {
    return "Exact Start: " + timestamp(window.startUtc, window.timezone)
      + " | Exact End: " + timestamp(window.endUtc, window.timezone);
  }

  function available(value, formatter) {
    return Number.isFinite(value) ? formatter(value) : "";
  }

  function legacyReports(result) {
    var units = result && Array.isArray(result.units) ? result.units : [];
    var trucks = units.map(function (unit) {
      return {
        displayName: unit.displayName,
        engineRunningMinutes: unit.engineRunningMinutes,
        movingMinutes: unit.movingMinutes,
        stationaryMinutes: unit.idleMinutes,
        utilizationPercent: unit.utilizationPercent,
        verifiedMoves: unit.moveCount,
        fuelGallons: unit.fuelGallons,
        idleFuelGallons: unit.idleFuelGallons,
        productiveFuelGallons: unit.productiveFuelGallons,
        engineHoursDelta: unit.engineHoursDelta,
        maxSpeedMph: unit.maxSpeedMph,
        peakSpeedTimestamp: unit.peakSpeedTimestamp,
        driverCount: 0,
        drivers: []
      };
    });
    var moves = [];
    var speedActivity = [];
    units.forEach(function (unit) {
      (unit.verifiedMoveRecords || []).forEach(function (move) {
        moves.push(Object.assign({}, move, {
          deviceDisplayName: unit.displayName,
          driverLabel: "Unattributed"
        }));
      });
      if (unit.peakSpeedTimestamp) {
        speedActivity.push({
          deviceDisplayName: unit.displayName,
          driverLabel: "Unattributed",
          peakSpeedMph: unit.maxSpeedMph,
          peakTimestamp: unit.peakSpeedTimestamp
        });
      }
    });
    return {
      drivers: [],
      trucks: trucks,
      moves: moves,
      speedActivity: speedActivity,
      overview: {
        verifiedMoves: result.summary && result.summary.verifiedMoves,
        activeDrivers: 0,
        trucksUsed: trucks.filter(function (truck) {
          return truck.engineRunningMinutes > 0 || truck.movingMinutes > 0
            || truck.verifiedMoves > 0;
        }).length,
        authorizedTrucks: trucks.length,
        engineRunningMinutes: result.summary && result.summary.engineRunningMinutes,
        movingMinutes: result.summary && result.summary.movingMinutes,
        stationaryMinutes: result.summary && result.summary.idleMinutes,
        utilizationPercent: result.summary && result.summary.utilizationPercent,
        fuelGallons: result.summary && result.summary.fuelGallons,
        idleFuelGallons: result.summary && result.summary.idleFuelGallons,
        peakSpeedMph: trucks.reduce(function (maximum, truck) {
          return Number.isFinite(truck.maxSpeedMph)
            ? maximum === null ? truck.maxSpeedMph : Math.max(maximum, truck.maxSpeedMph)
            : maximum;
        }, null),
        operatingContext: []
      }
    };
  }

  function reportsFor(result) {
    return result && result.reports || legacyReports(result || {});
  }

  function includeColumn(headers, rows, header, values, formatter) {
    if (!(values || []).some(Number.isFinite)) {
      return;
    }
    headers.push(header);
    rows.forEach(function (row, index) {
      row.push(available(values[index], formatter));
    });
  }

  function reportData(result, reportType) {
    var reports = reportsFor(result);
    var timeZone = result.window.timezone;
    if (reportType === "overview") {
      var overview = reports.overview;
      var overviewRows = [];
      [
        ["Verified Trailer Moves", overview.verifiedMoves, String],
        ["Active Drivers", overview.activeDrivers, String],
        ["Trucks Used", overview.trucksUsed, String],
        ["Authorized Trucks", overview.authorizedTrucks, String],
        ["Engine Running", overview.engineRunningMinutes, duration],
        ["Moving", overview.movingMinutes, duration],
        ["Engine Running \u00b7 Stationary", overview.stationaryMinutes, duration],
        ["Utilization", overview.utilizationPercent, percent],
        ["Fuel Used", overview.fuelGallons, function (value) {
          return gallons(value, false);
        }],
        ["Estimated Idle Fuel", overview.idleFuelGallons, function (value) {
          return gallons(value, true);
        }],
        ["Total Distance", overview.totalDistanceMiles, miles],
        ["Peak Observed Speed", overview.peakSpeedMph, speed]
      ].forEach(function (metric) {
        if (Number.isFinite(metric[1])) {
          overviewRows.push([metric[0], metric[2](metric[1])]);
        }
      });
      return { headers: ["Metric", "Value"], rows: overviewRows };
    }
    if (reportType === "drivers") {
      var driverRows = reports.drivers.map(function (driver) {
        return [
          driver.driverLabel,
          duration(driver.assignedMinutes),
          String(driver.verifiedMoves),
          decimal(driver.movesPerAssignedHour),
          duration(driver.engineRunningMinutes),
          duration(driver.movingMinutes),
          duration(driver.stationaryMinutes),
          percent(driver.utilizationPercent),
          speed(driver.maxSpeedMph),
          String(driver.trucksOperated)
        ];
      });
      var driverHeaders = [
        "Driver", "Assigned Time", "Verified Moves", "Moves per Assigned Hour",
        "Engine Running", "Moving", "Engine Running Stationary", "Utilization",
        "Max Observed Speed", "Trucks Operated"
      ];
      includeColumn(driverHeaders, driverRows, "Total Distance",
        reports.drivers.map(function (row) { return row.totalDistanceMiles; }), miles);
      includeColumn(driverHeaders, driverRows, "Trailer Coupled Distance",
        reports.drivers.map(function (row) { return row.coupledDistanceMiles; }), miles);
      includeColumn(driverHeaders, driverRows, "Bobtail Distance",
        reports.drivers.map(function (row) { return row.bobtailDistanceMiles; }), miles);
      includeColumn(driverHeaders, driverRows, "Bobtail Share",
        reports.drivers.map(function (row) { return row.bobtailSharePercent; }), percent);
      return { headers: driverHeaders, rows: driverRows };
    }
    if (reportType === "moves") {
      return {
        headers: ["Time", "Unit", "Driver", "Move Start", "Move Completed", "Duration"],
        rows: reports.moves.map(function (move) {
          return [
            timestamp(move.completionTimestamp, timeZone),
            move.deviceDisplayName,
            move.driverLabel,
            timestamp(move.couplingTimestamp, timeZone),
            timestamp(move.completionTimestamp, timeZone),
            available(move.durationMinutes, duration)
          ];
        })
      };
    }
    if (reportType === "speed") {
      return {
        headers: ["Unit", "Driver", "Peak Speed", "Peak Timestamp"],
        rows: reports.speedActivity.map(function (event) {
          return [
            event.deviceDisplayName,
            event.driverLabel,
            available(event.peakSpeedMph, speed),
            timestamp(event.peakTimestamp, timeZone)
          ];
        })
      };
    }
    var trucks = reports.trucks;
    var truckRows = trucks.map(function (truck) {
      return [
        truck.displayName,
        duration(truck.engineRunningMinutes),
        duration(truck.movingMinutes),
        duration(truck.stationaryMinutes),
        percent(truck.utilizationPercent),
        Number.isFinite(truck.verifiedMoves) ? String(truck.verifiedMoves) : "",
        gallons(truck.fuelGallons, false),
        gallons(truck.idleFuelGallons, true),
        hours(truck.engineHoursDelta),
        speed(truck.maxSpeedMph),
        String(truck.driverCount)
      ];
    });
    var truckHeaders = [
      "Unit", "Engine Running", "Moving", "Engine Running Stationary",
      "Utilization", "Verified Moves", "Fuel Used", "Estimated Idle Fuel",
      "Engine Hours Delta", "Max Observed Speed", "Drivers"
    ];
    includeColumn(truckHeaders, truckRows, "Total Distance",
      trucks.map(function (row) { return row.totalDistanceMiles; }), miles);
    includeColumn(truckHeaders, truckRows, "Trailer Coupled Distance",
      trucks.map(function (row) { return row.coupledDistanceMiles; }), miles);
    includeColumn(truckHeaders, truckRows, "Bobtail Distance",
      trucks.map(function (row) { return row.bobtailDistanceMiles; }), miles);
    return { headers: truckHeaders, rows: truckRows };
  }

  function csvEscape(value) {
    var text = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function csvLine(values) {
    return values.map(csvEscape).join(",");
  }

  function csvDocument(result, context, reportType) {
    var data = reportData(result, reportType);
    var lines = [
      csvLine(["Customer", context.customer.displayName]),
      csvLine(["Facility", context.facility.displayName]),
      csvLine(["Report", TITLES[reportType] + " Report"]),
      csvLine(["Start", timestamp(result.window.startUtc, result.window.timezone)]),
      csvLine(["End", timestamp(result.window.endUtc, result.window.timezone)]),
      csvLine(["Timezone", result.window.timezone]),
      "",
      csvLine(data.headers)
    ];
    data.rows.forEach(function (row) { lines.push(csvLine(row)); });
    return lines.join("\r\n") + "\r\n";
  }

  function filenameToken(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[\u2018\u2019']/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "Report";
  }

  function localDateToken(value, timeZone) {
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date(value));
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year + "-" + values.month + "-" + values.day;
  }

  function reportFilename(result, context, reportType) {
    return [
      "SpotterIQ",
      filenameToken(context.customer.displayName),
      filenameToken(context.facility.displayName),
      filenameToken(TITLES[reportType]),
      localDateToken(result.window.startUtc, result.window.timezone)
    ].join("_") + ".csv";
  }

  function createReportsDomView(document) {
    var controller = null;
    var context = null;
    var windowObject = document.defaultView
      || (typeof globalThis !== "undefined" ? globalThis : null);
    var printing = false;
    var exporting = false;

    function byId(id) { return document.getElementById(id); }
    function element(tag, className, value) {
      var node = document.createElement(tag);
      if (className) { node.className = className; }
      if (value !== undefined) { node.textContent = value; }
      return node;
    }
    function selectedWindow() {
      return { custom: {
        startDate: byId("siq-report-live-start-date").value,
        startTime: byId("siq-report-live-start-time").value,
        endDate: byId("siq-report-live-end-date").value,
        endTime: byId("siq-report-live-end-time").value
      } };
    }
    function setSelection(selection) {
      var custom = selection && selection.custom || {};
      byId("siq-report-live-start-date").value = custom.startDate || "";
      byId("siq-report-live-start-time").value = custom.startTime || "";
      byId("siq-report-live-end-date").value = custom.endDate || "";
      byId("siq-report-live-end-time").value = custom.endTime || "";
    }
    function setContext(nextContext) {
      context = nextContext;
      byId("siq-report-live-customer").textContent = context && context.customer
        ? context.customer.displayName : "Unavailable";
      byId("siq-report-live-facility").textContent = context && context.facility
        ? context.facility.displayName : "Unavailable";
      byId("siq-report-live-timezone").textContent = context && context.facility
        ? context.facility.timezone : "Unavailable";
    }
    function setActionsEnabled(enabled) {
      byId("siq-report-live-print").disabled = !enabled;
      byId("siq-report-live-export-csv").disabled = !enabled;
    }
    function clear() {
      context = null;
      byId("siq-report-live-status").textContent = "";
      byId("siq-report-live-results").hidden = true;
      byId("siq-report-live-summary").replaceChildren();
      byId("siq-report-live-table").replaceChildren();
      ["customer", "facility", "title", "window", "timezone", "generated"]
        .forEach(function (part) {
          byId("siq-report-print-" + part).textContent = "";
        });
      setActionsEnabled(false);
      setContext(null);
    }
    function metric(label, value) {
      var item = element("div", "siq-shift-kpi");
      item.append(
        element("span", "siq-shift-kpi__label", label),
        element("strong", "siq-shift-kpi__value", value)
      );
      return item;
    }
    function table(headers, rows) {
      var wrapper = element("div", "siq-live-report-table-scroll");
      wrapper.tabIndex = 0;
      var node = element("table", "siq-live-report-table");
      var head = element("thead");
      var headRow = element("tr");
      headers.forEach(function (header) {
        var cell = element("th", header.numeric ? "siq-live-report-numeric" : "", header.label);
        cell.scope = "col";
        headRow.appendChild(cell);
      });
      head.appendChild(headRow);
      var body = element("tbody");
      rows.forEach(function (row) {
        var tableRow = element("tr");
        row.forEach(function (value, index) {
          tableRow.appendChild(element(
            "td", headers[index] && headers[index].numeric
              ? "siq-live-report-numeric" : "", value
          ));
        });
        body.appendChild(tableRow);
      });
      node.append(head, body);
      wrapper.appendChild(node);
      return wrapper;
    }
    function detailMetric(label, value) {
      var item = element("div", "siq-report-detail-metric");
      item.append(element("span", "", label), element("strong", "", value));
      return item;
    }
    function detailGroup(label, metrics) {
      var group = element("section", "siq-report-detail-group");
      group.appendChild(element("h4", "", label));
      var grid = element("div", "siq-report-detail-grid");
      metrics.forEach(function (item) {
        if (item[1] !== null) {
          grid.appendChild(detailMetric(item[0], item[1]));
        }
      });
      group.appendChild(grid);
      return group;
    }
    function expandable(records, headers, rowValues, details) {
      var wrapper = element("div", "siq-live-report-table-scroll");
      var node = element("table", "siq-live-report-table siq-live-report-table--expandable");
      var head = element("thead");
      var headRow = element("tr");
      headers.forEach(function (header) {
        var cell = element("th", header.numeric ? "siq-live-report-numeric" : "", header.label);
        cell.scope = "col";
        headRow.appendChild(cell);
      });
      headRow.appendChild(element("th", "", "Details"));
      head.appendChild(headRow);
      var body = element("tbody");
      records.forEach(function (record) {
        var row = element("tr");
        rowValues(record).forEach(function (value, index) {
          row.appendChild(element("td", headers[index].numeric
            ? "siq-live-report-numeric" : "", value));
        });
        var detailsCell = element("td");
        var disclosure = element("details", "siq-report-details");
        disclosure.appendChild(element("summary", "", "View details"));
        disclosure.appendChild(details(record));
        detailsCell.appendChild(disclosure);
        row.appendChild(detailsCell);
        body.appendChild(row);
      });
      node.append(head, body);
      wrapper.appendChild(node);
      return wrapper;
    }
    function empty(message) {
      var state = element("div", "siq-live-report-empty", message);
      state.setAttribute("role", "status");
      return state;
    }
    function renderOverview(reports) {
      var overview = reports.overview;
      var metrics = [];
      [
        ["Verified Trailer Moves", overview.verifiedMoves, String],
        ["Active Drivers", overview.activeDrivers, String],
        ["Trucks Used", overview.trucksUsed, String],
        ["Authorized Trucks", overview.authorizedTrucks, String],
        ["Engine Running", overview.engineRunningMinutes, duration],
        ["Moving", overview.movingMinutes, duration],
        ["Engine Running \u00b7 Stationary", overview.stationaryMinutes, duration],
        ["Utilization", overview.utilizationPercent, percent],
        ["Fuel Used", overview.fuelGallons, function (value) { return gallons(value, false); }],
        ["Estimated Idle Fuel", overview.idleFuelGallons, function (value) { return gallons(value, true); }],
        ["Peak Observed Speed", overview.peakSpeedMph, speed]
      ].forEach(function (item) {
        if (Number.isFinite(item[1])) { metrics.push(metric(item[0], item[2](item[1]))); }
      });
      byId("siq-report-live-summary").replaceChildren.apply(
        byId("siq-report-live-summary"), metrics
      );
      var contextBlock = element("section", "siq-report-operating-context");
      contextBlock.appendChild(element("h3", "siq-section-title", "Operating Context"));
      var entries = overview.operatingContext || [];
      if (!entries.length) {
        contextBlock.appendChild(element("p", "siq-live-report-note",
          "No additional operating context is available for this window."));
      } else {
        var grid = element("div", "siq-report-context-grid");
        entries.forEach(function (entry) {
          var value = entry.valueType === "duration" ? duration(entry.value)
            : entry.valueType === "speed" ? speed(entry.value)
              : entry.valueType === "moves" ? entry.value + " verified moves"
                : String(entry.value);
          grid.appendChild(detailMetric(entry.label, entry.subject + " \u00b7 " + value));
        });
        contextBlock.appendChild(grid);
      }
      return contextBlock;
    }
    function renderDrivers(reports) {
      byId("siq-report-live-summary").replaceChildren(
        metric("Active Drivers", String(reports.drivers.length))
      );
      if (!reports.drivers.length) {
        return empty("No historically attributed drivers in this reporting window.");
      }
      var headers = [
        { label: "Driver" }, { label: "Assigned Time", numeric: true },
        { label: "Verified Moves", numeric: true },
        { label: "Moves / Assigned Hour", numeric: true },
        { label: "Moving", numeric: true },
        { label: "Utilization", numeric: true },
        { label: "Max Observed Speed", numeric: true }
      ];
      return expandable(reports.drivers, headers, function (driver) {
        return [driver.driverLabel, duration(driver.assignedMinutes),
          String(driver.verifiedMoves), decimal(driver.movesPerAssignedHour),
          duration(driver.movingMinutes), percent(driver.utilizationPercent),
          speed(driver.maxSpeedMph)];
      }, function (driver) {
        var content = element("div", "siq-report-detail-sections");
        content.append(
          detailGroup("Productivity", [
            ["Assigned Time", duration(driver.assignedMinutes)],
            ["Verified Moves", String(driver.verifiedMoves)],
            ["Moves / Assigned Hour", decimal(driver.movesPerAssignedHour)],
            ["Moves / Engine-Running Hour", decimal(driver.movesPerEngineRunningHour)],
            ["Moving Time", duration(driver.movingMinutes)],
            ["Utilization", percent(driver.utilizationPercent)]
          ]),
          detailGroup("Work Profile", [
            ["Trucks Operated", String(driver.trucksOperated)],
            ["Total Distance", Number.isFinite(driver.totalDistanceMiles)
              ? miles(driver.totalDistanceMiles) : null],
            ["Trailer Coupled Distance", Number.isFinite(driver.coupledDistanceMiles)
              ? miles(driver.coupledDistanceMiles) : null],
            ["Bobtail Distance", Number.isFinite(driver.bobtailDistanceMiles)
              ? miles(driver.bobtailDistanceMiles) : null]
          ]),
          detailGroup("Efficiency / Operating Time", [
            ["Engine Running", duration(driver.engineRunningMinutes)],
            ["Engine Running \u00b7 Stationary", duration(driver.stationaryMinutes)],
            ["Moving", duration(driver.movingMinutes)]
          ]),
          detailGroup("Operating Activity", [
            ["Max Observed Speed", speed(driver.maxSpeedMph)],
            ["Speed Activity Records", String(driver.speedActivityCount)]
          ])
        );
        if (driver.trucks.length) {
          content.appendChild(element("h4", "siq-report-detail-table-title",
            "Trucks Operated"));
          content.appendChild(table([
            { label: "Unit" }, { label: "Assigned Time", numeric: true },
            { label: "Moving", numeric: true },
            { label: "Verified Moves", numeric: true }
          ], driver.trucks.map(function (truck) {
            return [truck.displayName, duration(truck.assignedMinutes),
              duration(truck.movingMinutes), String(truck.verifiedMoves)];
          })));
        }
        return content;
      });
    }
    function renderTrucks(reports) {
      byId("siq-report-live-summary").replaceChildren(
        metric("Authorized Trucks", String(reports.overview.authorizedTrucks)),
        metric("Trucks Used", String(reports.overview.trucksUsed))
      );
      var headers = [
        { label: "Unit" }, { label: "Engine Running", numeric: true },
        { label: "Moving", numeric: true },
        { label: "Engine Running \u00b7 Stationary", numeric: true },
        { label: "Utilization", numeric: true },
        { label: "Verified Moves", numeric: true },
        { label: "Max Observed Speed", numeric: true },
        { label: "Drivers", numeric: true }
      ];
      return expandable(reports.trucks, headers, function (truck) {
        return [truck.displayName, duration(truck.engineRunningMinutes),
          duration(truck.movingMinutes), duration(truck.stationaryMinutes),
          percent(truck.utilizationPercent), Number.isFinite(truck.verifiedMoves)
            ? String(truck.verifiedMoves) : "Unavailable",
          speed(truck.maxSpeedMph),
          String(truck.driverCount)];
      }, function (truck) {
        var content = element("div", "siq-report-detail-sections");
        content.append(
          detailGroup("Utilization", [
            ["Engine Running", duration(truck.engineRunningMinutes)],
            ["Moving", duration(truck.movingMinutes)],
            ["Engine Running \u00b7 Stationary", duration(truck.stationaryMinutes)],
            ["Off", duration(truck.offMinutes)],
            ["Unavailable", duration(truck.unavailableMinutes)],
            ["Utilization", percent(truck.utilizationPercent)]
          ]),
          detailGroup("Productivity", [
            ["Verified Moves", Number.isFinite(truck.verifiedMoves)
              ? String(truck.verifiedMoves) : "Unavailable"],
            ["Total Distance", Number.isFinite(truck.totalDistanceMiles)
              ? miles(truck.totalDistanceMiles) : null]
          ]),
          detailGroup("Fuel / Engine", [
            ["Fuel Used", gallons(truck.fuelGallons, false)],
            ["Estimated Idle Fuel", gallons(truck.idleFuelGallons, true)],
            ["Productive Fuel", gallons(truck.productiveFuelGallons, false)],
            ["Engine Hours Delta", hours(truck.engineHoursDelta)]
          ]),
          detailGroup("Operating Activity", [
            ["Max Observed Speed", speed(truck.maxSpeedMph)],
            ["Speed Activity Records", String(truck.speedActivityCount)]
          ])
        );
        if (truck.drivers.length) {
          content.appendChild(element("h4", "siq-report-detail-table-title",
            "Drivers"));
          content.appendChild(table([
            { label: "Driver" }, { label: "Assigned Time", numeric: true },
            { label: "Moving", numeric: true },
            { label: "Verified Moves", numeric: true }
          ], truck.drivers.map(function (driver) {
            return [driver.driverLabel, duration(driver.assignedMinutes),
              duration(driver.movingMinutes), String(driver.verifiedMoves)];
          })));
        }
        return content;
      });
    }
    function renderMoves(result, reports) {
      byId("siq-report-live-summary").replaceChildren();
      if (!reports.moves.length) {
        return empty("No verified trailer moves in this reporting window.");
      }
      return table([
        { label: "Time" }, { label: "Unit" }, { label: "Driver" },
        { label: "Move Start" }, { label: "Move Completed" },
        { label: "Duration", numeric: true }
      ], reports.moves.map(function (move) {
        return [timestamp(move.completionTimestamp, result.window.timezone),
          move.deviceDisplayName, move.driverLabel,
          timestamp(move.couplingTimestamp, result.window.timezone),
          timestamp(move.completionTimestamp, result.window.timezone),
          duration(move.durationMinutes)];
      }));
    }
    function renderSpeed(result, reports) {
      var summary = byId("siq-report-live-summary");
      summary.replaceChildren();
      summary.appendChild(element("p", "siq-live-report-note",
        "Observed speed is operating evidence. Without a configured policy, Speed Activity is not classified as a violation."));
      if (!reports.speedActivity.length) {
        return empty("No Speed Activity observations in this reporting window.");
      }
      return table([
        { label: "Unit" }, { label: "Driver" },
        { label: "Peak Speed", numeric: true }, { label: "Peak Timestamp" }
      ], reports.speedActivity.map(function (event) {
        return [event.deviceDisplayName, event.driverLabel,
          speed(event.peakSpeedMph),
          timestamp(event.peakTimestamp, result.window.timezone)];
      }));
    }
    function render(result, nextContext, reportType) {
      context = nextContext;
      var reports = reportsFor(result);
      byId("siq-report-live-status").textContent = "";
      byId("siq-report-live-title").textContent = TITLES[reportType];
      byId("siq-report-live-window-label").textContent = windowLabel(result.window);
      byId("siq-report-print-customer").textContent = context.customer.displayName;
      byId("siq-report-print-facility").textContent = context.facility.displayName;
      byId("siq-report-print-title").textContent = TITLES[reportType] + " Report";
      byId("siq-report-print-window").textContent = exactWindowLabel(result.window);
      byId("siq-report-print-timezone").textContent =
        "Facility timezone: " + result.window.timezone;
      var content = reportType === "overview" ? renderOverview(reports)
        : reportType === "drivers" ? renderDrivers(reports)
          : reportType === "trucks" ? renderTrucks(reports)
            : reportType === "moves" ? renderMoves(result, reports)
              : renderSpeed(result, reports);
      byId("siq-report-live-table").replaceChildren(content);
      byId("siq-report-live-results").hidden = false;
      setActionsEnabled(true);
    }
    function setActiveReport(reportType) {
      var isEvent = reportType === "moves" || reportType === "speed";
      document.querySelectorAll(".siq-report-tabs [data-live-report]")
        .forEach(function (button) {
          var key = button.getAttribute("data-live-report");
          var active = key === reportType || key === "events" && isEvent;
          button.classList.toggle("siq-report-tab--active", active);
          button.setAttribute("aria-selected", String(active));
        });
      var eventTabs = byId("siq-report-event-tabs");
      eventTabs.hidden = !isEvent;
      document.querySelectorAll("[data-live-report-event]").forEach(function (button) {
        var active = button.getAttribute("data-live-report-event") === reportType;
        button.classList.toggle("siq-report-event-tab--active", active);
        button.setAttribute("aria-selected", String(active));
      });
    }
    function bind(nextController) {
      controller = nextController;
      byId("siq-report-live-form").addEventListener("submit", function (event) {
        event.preventDefault();
        controller.load(selectedWindow(), false);
      });
      byId("siq-report-live-refresh").addEventListener("click", function () {
        controller.refresh();
      });
      byId("siq-report-live-print").addEventListener("click", function () {
        controller.printReport();
      });
      byId("siq-report-live-export-csv").addEventListener("click", function () {
        controller.exportCsv();
      });
      document.querySelectorAll("[data-live-report]").forEach(function (button) {
        button.addEventListener("click", function () {
          controller.selectReport(button.getAttribute("data-live-report"));
        });
      });
    }

    return {
      bind: bind,
      clear: clear,
      render: render,
      setActiveReport: setActiveReport,
      setContext: setContext,
      setSelection: setSelection,
      printReport: function (result, nextContext, reportType) {
        if (printing || !windowObject || typeof windowObject.print !== "function") {
          return false;
        }
        printing = true;
        byId("siq-report-print-customer").textContent = nextContext.customer.displayName;
        byId("siq-report-print-facility").textContent = nextContext.facility.displayName;
        byId("siq-report-print-title").textContent = TITLES[reportType] + " Report";
        byId("siq-report-print-window").textContent = exactWindowLabel(result.window);
        byId("siq-report-print-timezone").textContent =
          "Facility timezone: " + result.window.timezone;
        byId("siq-report-print-generated").textContent = "Generated: "
          + timestamp(Date.now(), result.window.timezone)
          + " (" + result.window.timezone + ")";
        try {
          windowObject.print();
          return true;
        } finally {
          printing = false;
        }
      },
      exportCsv: function (result, nextContext, reportType) {
        if (exporting || !windowObject || !windowObject.URL
          || typeof windowObject.URL.createObjectURL !== "function"
          || typeof windowObject.Blob !== "function") {
          return false;
        }
        exporting = true;
        var objectUrl = null;
        try {
          var blob = new windowObject.Blob([
            "\uFEFF", csvDocument(result, nextContext, reportType)
          ], { type: "text/csv;charset=utf-8" });
          objectUrl = windowObject.URL.createObjectURL(blob);
          var link = document.createElement("a");
          link.href = objectUrl;
          link.download = reportFilename(result, nextContext, reportType);
          link.hidden = true;
          byId("siq-module-reports").appendChild(link);
          link.click();
          link.remove();
          return true;
        } finally {
          if (objectUrl) {
            if (typeof windowObject.setTimeout === "function") {
              windowObject.setTimeout(function () {
                windowObject.URL.revokeObjectURL(objectUrl);
              }, 1000);
            } else {
              windowObject.URL.revokeObjectURL(objectUrl);
            }
          }
          exporting = false;
        }
      },
      showError: function (message) {
        byId("siq-report-live-status").textContent = message;
      },
      showLoading: function () {
        byId("siq-report-live-status").textContent = "Loading report...";
      }
    };
  }

  return {
    TITLES: TITLES,
    csvDocument: csvDocument,
    csvEscape: csvEscape,
    createReportsDomView: createReportsDomView,
    reportData: reportData,
    reportFilename: reportFilename
  };
}));
