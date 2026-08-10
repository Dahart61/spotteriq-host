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
    productivity: "Productivity",
    moves: "Trailer Moves",
    fuel: "Fuel & Engine Use",
    speed: "Speed Activity"
  });

  function createReportsDomView(document) {
    var controller = null;
    var context = null;

    function byId(id) { return document.getElementById(id); }
    function element(tag, className, value) {
      var node = document.createElement(tag);
      if (className) { node.className = className; }
      if (value !== undefined) { node.textContent = value; }
      return node;
    }
    function duration(minutes) {
      if (!Number.isFinite(minutes)) { return "Unavailable"; }
      var rounded = Math.round(minutes);
      return Math.floor(rounded / 60) + "h "
        + String(rounded % 60).padStart(2, "0") + "m";
    }
    function percent(value) {
      return Number.isFinite(value) ? value.toFixed(0) + "%" : "Unavailable";
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
    function selectedWindow() {
      return {
        custom: {
          startDate: byId("siq-report-live-start-date").value,
          startTime: byId("siq-report-live-start-time").value,
          endDate: byId("siq-report-live-end-date").value,
          endTime: byId("siq-report-live-end-time").value
        }
      };
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
    function clear() {
      context = null;
      byId("siq-report-live-status").textContent = "";
      byId("siq-report-live-results").hidden = true;
      byId("siq-report-live-summary").replaceChildren();
      byId("siq-report-live-table").replaceChildren();
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
            "td",
            headers[index] && headers[index].numeric ? "siq-live-report-numeric" : "",
            value
          ));
        });
        body.appendChild(tableRow);
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
    function sortedUnits(result) {
      return result.units.slice().sort(function (left, right) {
        return left.displayName.localeCompare(right.displayName);
      });
    }
    function renderProductivity(result) {
      var summary = result.summary;
      byId("siq-report-live-summary").replaceChildren(
        metric("Engine Running", duration(summary.engineRunningMinutes)),
        metric("Moving", duration(summary.movingMinutes)),
        metric("Idle / Stationary", duration(summary.idleMinutes)),
        metric("Utilization", percent(summary.utilizationPercent)),
        metric("Completed Moves", summary.verifiedMoves === null
          ? "Unavailable" : String(summary.verifiedMoves))
      );
      return table([
        { label: "Unit" },
        { label: "Engine Running", numeric: true },
        { label: "Moving", numeric: true },
        { label: "Idle / Stationary", numeric: true },
        { label: "Utilization", numeric: true },
        { label: "Max Speed", numeric: true },
        { label: "Completed Moves", numeric: true }
      ], sortedUnits(result).map(function (unit) {
        return [
          unit.displayName,
          duration(unit.engineRunningMinutes),
          duration(unit.movingMinutes),
          duration(unit.idleMinutes),
          percent(unit.utilizationPercent),
          speed(unit.maxSpeedMph),
          unit.moveCount === null ? "Unavailable" : String(unit.moveCount)
        ];
      }));
    }
    function renderMoves(result) {
      byId("siq-report-live-summary").replaceChildren();
      var rows = [];
      sortedUnits(result).forEach(function (unit) {
        (unit.verifiedMoveRecords || []).forEach(function (move) {
          rows.push([
            unit.displayName,
            timestamp(move.couplingTimestamp, result.window.timezone),
            timestamp(move.completionTimestamp, result.window.timezone),
            duration(move.durationMinutes),
            move.qualifyingSpeedObservationCount + " observation"
              + (move.qualifyingSpeedObservationCount === 1 ? "" : "s")
              + " at/above " + move.movementSpeedThresholdMph.toFixed(1)
              + " mph; peak " + move.peakCoupledSpeedMph.toFixed(1) + " mph"
          ]);
        });
      });
      if (!rows.length) {
        return empty("No verified trailer moves in this reporting window.");
      }
      return table([
        { label: "Unit" },
        { label: "Move Start" },
        { label: "Completion / Uncouple" },
        { label: "Duration", numeric: true },
        { label: "Coupled Movement Evidence" }
      ], rows);
    }
    function renderFuel(result) {
      byId("siq-report-live-summary").replaceChildren(
        metric("Engine Running", duration(result.summary.engineRunningMinutes)),
        metric("Fuel Used", gallons(result.summary.fuelGallons, false)),
        metric("Estimated Idle Fuel", gallons(result.summary.idleFuelGallons, true))
      );
      return table([
        { label: "Unit" },
        { label: "Engine Running", numeric: true },
        { label: "Fuel Used", numeric: true },
        { label: "Estimated Idle Fuel", numeric: true },
        { label: "Productive Fuel", numeric: true },
        { label: "Engine Hours Delta", numeric: true }
      ], sortedUnits(result).map(function (unit) {
        return [
          unit.displayName,
          duration(unit.engineRunningMinutes),
          gallons(unit.fuelGallons, false),
          gallons(unit.idleFuelGallons, true),
          gallons(unit.productiveFuelGallons, false),
          hours(unit.engineHoursDelta)
        ];
      }));
    }
    function hasSpeedPolicy(facility) {
      return Boolean(facility && (
        Array.isArray(facility.speedPolicies) && facility.speedPolicies.length
        || facility.legacySpeedConfiguration
        || facility.speedConfiguration
      ));
    }
    function renderSpeed(result) {
      var summary = byId("siq-report-live-summary");
      summary.replaceChildren();
      if (!hasSpeedPolicy(context && context.facility)) {
        summary.appendChild(element(
          "p", "siq-live-report-note",
          "No speed policy is configured. Peak observations are shown as Speed Activity, not violations."
        ));
      }
      return table([
        { label: "Unit" },
        { label: "Peak Speed", numeric: true },
        { label: "Peak Timestamp" }
      ], sortedUnits(result).map(function (unit) {
        return [
          unit.displayName,
          speed(unit.maxSpeedMph),
          timestamp(unit.peakSpeedTimestamp, result.window.timezone)
        ];
      }));
    }
    function render(result, nextContext, reportType) {
      context = nextContext;
      byId("siq-report-live-status").textContent = "";
      byId("siq-report-live-title").textContent = TITLES[reportType];
      byId("siq-report-live-window-label").textContent = windowLabel(result.window);
      var content;
      if (reportType === "moves") {
        content = renderMoves(result);
      } else if (reportType === "fuel") {
        content = renderFuel(result);
      } else if (reportType === "speed") {
        content = renderSpeed(result);
      } else {
        content = renderProductivity(result);
      }
      byId("siq-report-live-table").replaceChildren(content);
      byId("siq-report-live-results").hidden = false;
    }
    function setActiveReport(reportType) {
      document.querySelectorAll("[data-live-report]").forEach(function (button) {
        var active = button.getAttribute("data-live-report") === reportType;
        button.classList.toggle("siq-report-tab--active", active);
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
    createReportsDomView: createReportsDomView
  };
}));
