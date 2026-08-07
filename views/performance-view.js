(function (root, factory) {
  "use strict";

  var shiftPerformance = typeof module === "object" && module.exports
    ? require("../core/shift-performance") : root.SIQ_SHIFT_PERFORMANCE;
  var api = factory(shiftPerformance);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_PERFORMANCE_VIEW = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (shiftPerformance) {
  "use strict";

  function createPerformanceDomView(document) {
    var controller = null;
    var context = null;

    function byId(id) { return document.getElementById(id); }
    function element(tag, className, value) {
      var node = document.createElement(tag);
      if (className) { node.className = className; }
      if (value !== undefined) { node.textContent = value; }
      return node;
    }
    function dash(value) {
      return value === null || value === undefined || !Number.isFinite(value)
        ? "—" : value;
    }
    function duration(minutes) {
      if (!Number.isFinite(minutes)) { return "—"; }
      var rounded = Math.round(minutes);
      return Math.floor(rounded / 60) + "h " + String(rounded % 60).padStart(2, "0") + "m";
    }
    function percent(value) {
      return Number.isFinite(value) ? value.toFixed(0) + "%" : "—";
    }
    function gallons(value) {
      return Number.isFinite(value) ? value.toFixed(1) + " gal" : "—";
    }
    function speed(value) {
      return Number.isFinite(value) ? value.toFixed(1) + " mph" : "—";
    }
    function distance(value) {
      return Number.isFinite(value) ? value.toFixed(1) + " mi" : "—";
    }
    function windowLabel(window) {
      return new Date(window.startUtc).toLocaleString([], {
        timeZone: window.timezone, month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit"
      }) + " – " + new Date(window.endUtc).toLocaleString([], {
        timeZone: window.timezone, month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit"
      });
    }

    function selectedWindow() {
      return {
        custom: {
          startDate: byId("siq-performance-start-date").value,
          startTime: byId("siq-performance-start-time").value,
          endDate: byId("siq-performance-end-date").value,
          endTime: byId("siq-performance-end-time").value
        }
      };
    }

    function setContext(nextContext) {
      context = nextContext;
      if (!context) { return; }
      byId("siq-performance-timezone").textContent = context.facility.timezone;
      byId("siq-performance-facility").textContent = context.facility.displayName;
    }

    function setSelection(selection) {
      var custom = selection && selection.custom || {};
      byId("siq-performance-start-date").value = custom.startDate || "";
      byId("siq-performance-start-time").value = custom.startTime || "";
      byId("siq-performance-end-date").value = custom.endDate || "";
      byId("siq-performance-end-time").value = custom.endTime || "";
    }

    function metric(label, value, detail) {
      var item = element("div", "siq-shift-kpi");
      item.append(
        element("span", "siq-shift-kpi__label", label),
        element("strong", "siq-shift-kpi__value", value)
      );
      if (detail) { item.appendChild(element("span", "siq-shift-kpi__detail", detail)); }
      return item;
    }

    function renderSummary(result) {
      var summary = result.summary;
      var container = byId("siq-performance-summary-metrics");
      container.replaceChildren(
        metric("Completed Moves", summary.verifiedMoves === null
          ? "—" : String(summary.verifiedMoves)),
        metric("Utilization", percent(summary.utilizationPercent)),
        metric("Engine-Running", duration(summary.engineRunningMinutes)),
        metric("Idle", duration(summary.idleMinutes), percent(summary.idlePercent)),
        metric("Fuel Used", gallons(summary.fuelGallons)),
        metric("Idle Fuel", gallons(summary.idleFuelGallons),
          summary.idleFuelGallons === null ? "" : "estimated")
      );
      if (summary.coupledMinutes !== null) {
        container.append(
          metric("Coupled Time", duration(summary.coupledMinutes)),
          metric("Uncoupled Time", duration(summary.uncoupledMinutes)),
          metric("Coupled Distance", distance(summary.coupledDistanceMiles)),
          metric("Uncoupled Distance", distance(summary.uncoupledDistanceMiles))
        );
      }
    }

    function cell(label, value, className) {
      var node = element("span", "siq-shift-cell " + (className || ""), value);
      node.setAttribute("data-label", label);
      return node;
    }

    function unitRow(unit) {
      var row = element("article", "siq-shift-unit-row");
      var identity = element("span", "siq-shift-cell siq-shift-unit-name");
      identity.setAttribute("data-label", "Unit");
      identity.appendChild(element("strong", "", unit.displayName));
      if (unit.driverDisplayName) {
        identity.appendChild(element("small", "", unit.driverDisplayName));
      }
      var moves = element("span", "siq-shift-cell");
      moves.setAttribute("data-label", "Moves");
      moves.append(element("strong", "", unit.moveCount === null ? "—" : String(unit.moveCount)));
      row.append(
        identity,
        moves,
        cell("Engine-Running", duration(unit.engineRunningMinutes)),
        cell("Moving", duration(unit.movingMinutes)),
        cell("Idle", duration(unit.idleMinutes) + " / " + percent(unit.idlePercent)),
        cell("Utilization", percent(unit.utilizationPercent)),
        cell("Fuel Used", gallons(unit.fuelGallons)),
        cell("Idle Fuel", unit.idleFuelGallons === null
          ? "—" : gallons(unit.idleFuelGallons) + " est."),
        cell("Max Speed", speed(unit.maxSpeedMph))
      );
      var detail = element("details", "siq-shift-unit-detail");
      detail.appendChild(element("summary", "", "Report details"));
      var metrics = element("div", "siq-shift-unit-detail__metrics");
      metrics.append(
        metric("Off", duration(unit.offMinutes)),
        metric("Unavailable", duration(unit.unavailableMinutes)),
        metric("Productive Fuel", gallons(unit.productiveFuelGallons)),
        metric("Gallons / Productive Hour", dash(
          Number.isFinite(unit.gallonsPerProductiveHour)
            ? unit.gallonsPerProductiveHour.toFixed(2) : null
        )),
        metric("Longest Inactivity", duration(unit.prolongedInactivityMinutes))
      );
      if (unit.fifthWheelCapable) {
        metrics.append(
          metric("Trailer Coupled", duration(unit.coupledMinutes)),
          metric("Trailer Uncoupled", duration(unit.uncoupledMinutes)),
          metric("Coupled Distance", distance(unit.coupledDistanceMiles)),
          metric("Uncoupled Distance", distance(unit.uncoupledDistanceMiles)),
          metric("Avg Coupled Moving Speed", speed(unit.coupledAverageMovingSpeedMph)),
          metric("Avg Uncoupled Moving Speed", speed(unit.uncoupledAverageMovingSpeedMph))
        );
      }
      detail.appendChild(metrics);
      row.appendChild(detail);
      return row;
    }

    function render(result) {
      byId("siq-performance-status").textContent = "";
      byId("siq-performance-window-label").textContent = windowLabel(result.window);
      renderSummary(result);
      var list = byId("siq-performance-unit-results");
      list.replaceChildren();
      result.units.slice().sort(function (left, right) {
        return left.displayName.localeCompare(right.displayName);
      }).forEach(function (unit) {
        list.appendChild(unitRow(unit));
      });
      byId("siq-performance-results").hidden = false;
    }

    function bind(nextController) {
      controller = nextController;
      byId("siq-performance-scope-form").addEventListener("submit", function (event) {
        event.preventDefault();
        controller.load(selectedWindow(), false);
      });
      byId("siq-performance-refresh").addEventListener("click", function () {
        controller.refresh();
      });
    }

    return {
      bind: bind,
      render: render,
      setContext: setContext,
      setSelection: setSelection,
      showError: function (message) {
        byId("siq-performance-status").textContent = message;
      },
      showLoading: function (window) {
        byId("siq-performance-status").textContent = "Loading report…";
        byId("siq-performance-window-label").textContent = windowLabel(window);
      }
    };
  }

  return { createPerformanceDomView: createPerformanceDomView };
}));
