(function () {
  "use strict";

  var runtimeMode = window.SIQ_MYGEOTAB_CONFIGURATION
    ? window.SIQ_MYGEOTAB_CONFIGURATION.runtimeMode(window.location.search)
    : "live";
  var runtimeProjection = window.SIQ_RUNTIME_DATA_BOUNDARY.project(
    runtimeMode,
    window.SIQ_FIXTURES
  );

  if (!runtimeProjection.fixtureAllowed) {
    var productionShellInitialized = false;

    function productionById(id) {
      return document.getElementById(id);
    }

    function productionElement(tag, className, value) {
      var node = document.createElement(tag);
      if (className) {
        node.className = className;
      }
      if (value !== undefined) {
        node.textContent = value;
      }
      return node;
    }

    function renderHistoricalUnavailable(moduleId, title, note, controlPrefix) {
      var module = productionById(moduleId);
      var heading = productionElement("div", "siq-module-heading");
      var copy = productionElement("div");
      copy.append(
        productionElement("h1", "siq-screen-title", title),
        productionElement("p", "siq-screen-note", note)
      );
      var unavailable = productionElement(
        "section",
        "siq-empty-state siq-historical-empty-state"
      );
      unavailable.setAttribute("role", "status");
      unavailable.append(
        productionElement("strong", "", "Historical Reporting Unavailable"),
        productionElement(
          "span",
          "",
          runtimeProjection.historicalUnavailableMessage
        ),
        productionElement("span", "", "Choose a reporting window when data is available"),
        productionElement("span", "", "Speed Policy Not Configured")
      );
      var shiftControl = productionElement("div", "siq-field siq-field--compact");
      var shiftLabel = productionElement("label", "", "Shift");
      var shiftSelect = productionElement("select");
      var shiftOption = productionElement("option", "", "Not configured");
      shiftSelect.id = "siq-" + controlPrefix + "-shift";
      shiftLabel.setAttribute("for", shiftSelect.id);
      shiftSelect.disabled = true;
      shiftSelect.appendChild(shiftOption);
      shiftControl.append(shiftLabel, shiftSelect);
      unavailable.appendChild(shiftControl);
      heading.appendChild(copy);
      module.replaceChildren(heading, unavailable);
    }

    function renderLivePerformance() {
      var module = productionById("siq-module-performance");
      function identify(node, id) {
        node.id = id;
        return node;
      }
      function field(labelText, id, type, value) {
        var wrapper = productionElement("div", "siq-field");
        var label = productionElement("label", "", labelText);
        label.setAttribute("for", id);
        var control = identify(productionElement(type === "select" ? "select" : "input"), id);
        if (type !== "select") {
          control.type = type;
        }
        if (value) {
          control.value = value;
        }
        wrapper.append(label, control);
        return wrapper;
      }
      function contextValue(label, id) {
        var block = productionElement("div", "siq-timezone-block");
        block.append(
          productionElement("span", "siq-analysis-label", label),
          identify(productionElement("strong", "", "—"), id)
        );
        return block;
      }

      var heading = productionElement("div", "siq-module-heading");
      var headingCopy = productionElement("div");
      headingCopy.append(
        productionElement("h1", "siq-screen-title", "Performance"),
        productionElement(
          "p", "siq-screen-note",
          "Operational and fuel performance for an exact reporting window."
        )
      );
      heading.appendChild(headingCopy);

      var form = identify(
        productionElement("form", "siq-scope-bar siq-performance-scope-bar"),
        "siq-performance-scope-form"
      );
      var actions = productionElement("div", "siq-scope-actions");
      var load = productionElement("button", "siq-button siq-button--primary", "Load Report");
      load.type = "submit";
      var refresh = identify(
        productionElement("button", "siq-button", "Refresh"),
        "siq-performance-refresh"
      );
      refresh.type = "button";
      actions.append(load, refresh);
      var custom = identify(productionElement("div", "siq-custom-range"),
        "siq-performance-custom-range");
      custom.append(
        field("Start Date", "siq-performance-start-date", "date"),
        field("Start Time", "siq-performance-start-time", "time"),
        field("End Date", "siq-performance-end-date", "date"),
        field("End Time", "siq-performance-end-time", "time")
      );
      form.append(
        contextValue("Facility", "siq-performance-facility"),
        contextValue("Timezone", "siq-performance-timezone"),
        actions,
        custom
      );

      var status = identify(productionElement("p", "siq-status-message"),
        "siq-performance-status");
      status.setAttribute("aria-live", "polite");
      var results = identify(productionElement("section", "siq-live-performance-results"),
        "siq-performance-results");
      results.hidden = true;
      var summaryHeading = productionElement("div", "siq-summary-band__heading");
      summaryHeading.append(
        productionElement("span", "siq-context-label", "Facility result"),
        productionElement("h2", "siq-section-title", "Performance Report"),
        identify(productionElement("span", "siq-summary-scope"),
          "siq-performance-window-label")
      );
      var summaryMetrics = identify(productionElement("div", "siq-shift-summary-metrics"),
        "siq-performance-summary-metrics");
      var unitResults = productionElement("section", "siq-shift-unit-results");
      unitResults.setAttribute("aria-label", "Per-unit performance report");
      var unitHead = productionElement("div", "siq-shift-unit-head");
      unitHead.setAttribute("aria-hidden", "true");
      ["Unit", "Completed Moves", "Engine-Running", "Moving", "Idle", "Utilization",
        "Fuel Used", "Idle Fuel", "Max Speed"].forEach(function (label) {
        unitHead.appendChild(productionElement("span", "", label));
      });
      unitResults.append(
        unitHead,
        identify(productionElement("div"), "siq-performance-unit-results")
      );
      results.append(summaryHeading, summaryMetrics, unitResults);
      module.replaceChildren(heading, form, status, results);
    }

    function renderLiveReports() {
      var module = productionById("siq-module-reports");
      function identify(node, id) {
        node.id = id;
        return node;
      }
      function field(labelText, id, type) {
        var wrapper = productionElement("div", "siq-field");
        var label = productionElement("label", "", labelText);
        label.setAttribute("for", id);
        var control = identify(productionElement("input"), id);
        control.type = type;
        wrapper.append(label, control);
        return wrapper;
      }
      function contextValue(label, id) {
        var block = productionElement("div", "siq-timezone-block");
        block.append(
          productionElement("span", "siq-analysis-label", label),
          identify(productionElement("strong", "", "Unavailable"), id)
        );
        return block;
      }

      var heading = productionElement("div", "siq-module-heading");
      var headingCopy = productionElement("div");
      headingCopy.append(
        productionElement("h1", "siq-screen-title", "Reports"),
        productionElement(
          "p", "siq-screen-note",
          "Operational reports for the selected facility and exact reporting window."
        )
      );
      heading.appendChild(headingCopy);

      var form = identify(
        productionElement("form", "siq-scope-bar siq-live-report-command-bar"),
        "siq-report-live-form"
      );
      var context = productionElement("div", "siq-live-report-context");
      context.append(
        contextValue("Customer", "siq-report-live-customer"),
        contextValue("Facility", "siq-report-live-facility"),
        contextValue("Timezone", "siq-report-live-timezone")
      );
      var custom = productionElement("div", "siq-custom-range siq-live-report-range");
      custom.append(
        field("Start Date", "siq-report-live-start-date", "date"),
        field("Start Time", "siq-report-live-start-time", "time"),
        field("End Date", "siq-report-live-end-date", "date"),
        field("End Time", "siq-report-live-end-time", "time")
      );
      var actions = productionElement("div", "siq-scope-actions siq-live-report-actions");
      var load = productionElement("button", "siq-button siq-button--primary", "Load Report");
      load.type = "submit";
      var refresh = identify(
        productionElement("button", "siq-button", "Refresh"),
        "siq-report-live-refresh"
      );
      refresh.type = "button";
      var print = identify(
        productionElement("button", "siq-button", "Print"),
        "siq-report-live-print"
      );
      print.type = "button";
      print.disabled = true;
      var exportCsv = identify(
        productionElement("button", "siq-button", "Export CSV"),
        "siq-report-live-export-csv"
      );
      exportCsv.type = "button";
      exportCsv.disabled = true;
      actions.append(load, refresh, print, exportCsv);
      form.append(context, custom, actions);

      var tabs = productionElement("div", "siq-report-tabs");
      tabs.setAttribute("role", "tablist");
      [
        ["overview", "Overview"],
        ["drivers", "Driver Productivity"],
        ["trucks", "Truck Utilization"],
        ["events", "Events"]
      ].forEach(function (item, index) {
        var button = productionElement(
          "button",
          "siq-report-tab" + (index === 0 ? " siq-report-tab--active" : ""),
          item[1]
        );
        button.type = "button";
        button.setAttribute("role", "tab");
        button.setAttribute("data-live-report", item[0]);
        if (item[0] === "events") {
          button.setAttribute("data-live-report-group", "events");
        }
        button.setAttribute("aria-selected", String(index === 0));
        tabs.appendChild(button);
      });

      var eventTabs = identify(
        productionElement("div", "siq-report-event-tabs"),
        "siq-report-event-tabs"
      );
      eventTabs.hidden = true;
      eventTabs.setAttribute("role", "tablist");
      [["moves", "Trailer Moves"], ["speed", "Speed Activity"]]
        .forEach(function (item, index) {
          var button = productionElement(
            "button",
            "siq-report-event-tab" + (index === 0
              ? " siq-report-event-tab--active" : ""),
            item[1]
          );
          button.type = "button";
          button.setAttribute("role", "tab");
          button.setAttribute("data-live-report", item[0]);
          button.setAttribute("data-live-report-event", item[0]);
          button.setAttribute("aria-selected", String(index === 0));
          eventTabs.appendChild(button);
        });

      var status = identify(
        productionElement("p", "siq-status-message siq-live-report-status"),
        "siq-report-live-status"
      );
      status.setAttribute("aria-live", "polite");
      var results = identify(
        productionElement("section", "siq-live-report-results"),
        "siq-report-live-results"
      );
      results.hidden = true;
      var printHeader = productionElement("header", "siq-report-print-header");
      printHeader.hidden = true;
      printHeader.append(
        productionElement("div", "siq-report-print-brand", "SpotterIQ by Fleetsource"),
        identify(productionElement("div", "siq-report-print-customer"),
          "siq-report-print-customer"),
        identify(productionElement("div", "siq-report-print-facility"),
          "siq-report-print-facility"),
        identify(productionElement("h1", "siq-report-print-title"),
          "siq-report-print-title"),
        identify(productionElement("p", "siq-report-print-window"),
          "siq-report-print-window"),
        identify(productionElement("p", "siq-report-print-meta"),
          "siq-report-print-timezone"),
        identify(productionElement("p", "siq-report-print-meta"),
          "siq-report-print-generated")
      );
      var resultHeading = productionElement("div", "siq-summary-band__heading");
      resultHeading.append(
        productionElement("span", "siq-context-label", "Facility report"),
        identify(productionElement("h2", "siq-section-title", "Overview"),
          "siq-report-live-title"),
        identify(productionElement("span", "siq-summary-scope"),
          "siq-report-live-window-label")
      );
      results.append(
        printHeader,
        resultHeading,
        identify(productionElement("div", "siq-shift-summary-metrics"),
          "siq-report-live-summary"),
        identify(productionElement("div"), "siq-report-live-table")
      );
      module.replaceChildren(heading, form, tabs, eventTabs, status, results);
    }

    function showProductionModule(moduleName) {
      var app = document.querySelector(".siq-app");
      var requested = moduleName === "settings"
        ? "operations" : moduleName;
      app.querySelectorAll("[data-module-panel]").forEach(function (panel) {
        panel.classList.toggle(
          "siq-module--active",
          panel.getAttribute("data-module-panel") === requested
        );
      });
      app.querySelectorAll("[data-module]").forEach(function (button) {
        var active = button.getAttribute("data-module") === requested;
        button.classList.toggle("siq-nav-button--active", active);
        if (active) {
          button.setAttribute("aria-current", "page");
        } else {
          button.removeAttribute("aria-current");
        }
      });
    }

    function toggleProductionTheme() {
      var app = document.querySelector(".siq-app");
      var toggle = productionById("siq-theme-toggle");
      var label = productionById("siq-theme-label");
      var nextTheme = app.getAttribute("data-theme") === "dark" ? "light" : "dark";
      var isLight = nextTheme === "light";
      app.setAttribute("data-theme", nextTheme);
      toggle.setAttribute("aria-pressed", String(isLight));
      toggle.setAttribute(
        "aria-label",
        isLight ? "Switch to dark theme" : "Switch to light theme"
      );
      label.textContent = isLight ? "Light" : "Dark";
    }

    function initializeProductionShell(options) {
      if (productionShellInitialized) {
        return;
      }
      if (options && options.mode
        && String(options.mode).toLowerCase() !== runtimeProjection.mode) {
        throw new Error("Runtime mode changed after the data boundary was created.");
      }
      productionShellInitialized = true;
      var app = document.querySelector(".siq-app");
      app.setAttribute("data-siq-runtime-mode", runtimeProjection.mode);
      app.querySelector(".siq-fixture-preview").hidden = true;
      productionById("siq-simulate-button").hidden = true;
      productionById("siq-settings-button").hidden = true;
      productionById("siq-brand-context").hidden = true;
      productionById("siq-facility-context-bar").hidden = true;
      productionById("siq-facility-context-error").hidden = false;
      productionById("siq-facility-context-error").textContent =
        "Live facility scope is being resolved.";
      productionById("siq-live-label").textContent = "Live data pending";
      productionById("siq-data-age").textContent = "Data age --";
      productionById("siq-last-checked").textContent = "Last Checked --";
      productionById("siq-latest-fleet-data").textContent = "Latest Fleet Data --";
      productionById("siq-operations-title").nextElementSibling.textContent =
        "Current yard status from MyGeotab.";
      renderLivePerformance();
      renderLiveReports();
      app.querySelectorAll("[data-module]").forEach(function (button) {
        button.addEventListener("click", function () {
          showProductionModule(button.getAttribute("data-module"));
        });
      });
      productionById("siq-theme-toggle").addEventListener(
        "click",
        toggleProductionTheme
      );
    }

    window.SIQ_APP = {
      initialize: initializeProductionShell,
      mode: runtimeProjection.mode,
      runtimeProjection: runtimeProjection
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initializeProductionShell);
    } else {
      initializeProductionShell();
    }
    return;
  }

  var fixture = window.SIQ_RUNTIME_DATA_BOUNDARY.fixtureData(
    runtimeProjection,
    "SpotterIQ demo fixture"
  );
  var isLiveMode = false;
  var configuration = fixture.configuration;
  var authorization = window.SIQ_AUTHORIZATION;
  var selectors = window.SIQ_SELECTORS;
  var performanceApi = window.SIQ_PERFORMANCE;
  var selectedUserId = fixture.defaultUserId;
  var selectedCustomerId = "";
  var selectedFacilityId = "";
  var selectedUnitId = null;
  var selectedPerformanceUnitId = null;
  var performanceSort = { key: "attention", direction: "desc" };
  var performanceTrendMetric = "movesPerEngineHour";
  var selectedReportId = fixture.reports[0].id;
  var activeBoardFilter = "all";
  var rowElements = new Map();
  var valueElements = new Map();
  var performanceRowElements = new Map();
  var activeScope = null;
  var authorizedUnits = [];
  var historicalScope = null;
  var historicalUnits = [];
  var appliedScope = copyScope(fixture.scope);
  var appRoot = document.querySelector(".siq-app");

  function copyScope(scope) {
    return {
      dateRange: scope.dateRange,
      shift: scope.shift,
      compare: scope.compare,
      startDate: scope.startDate,
      startTime: scope.startTime,
      endDate: scope.endDate,
      endTime: scope.endTime
    };
  }

  function text(value) {
    if (value === null || value === undefined || value === "") {
      return "--";
    }
    return String(value);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function createEl(tag, className, textValue) {
    var element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    if (textValue !== undefined) {
      element.textContent = text(textValue);
    }
    return element;
  }

  function createOption(value, label) {
    var option = createEl("option", "", label);
    option.value = value;
    return option;
  }

  function populateSelect(select, options, selectedValue) {
    select.replaceChildren();
    options.forEach(function (option) {
      select.appendChild(createOption(option.value, option.label));
    });
    select.value = selectedValue;
  }

  function currentUser() {
    return authorization.getUser(configuration, selectedUserId);
  }

  function currentFacility() {
    return activeScope && activeScope.facility ? activeScope.facility : null;
  }

  function currentCustomer() {
    return activeScope && activeScope.customer ? activeScope.customer : authorization.getCustomer(configuration, selectedCustomerId);
  }

  function currentTimezone() {
    var facility = currentFacility();
    return facility ? facility.timezone : "--";
  }

  function facilityHasShiftSchedule(facility) {
    return selectors.facilityHasShiftSchedule(facility);
  }

  function facilityHasSpeedPolicy(facility) {
    if (!facility) {
      return false;
    }
    if (Array.isArray(facility.speedPolicies)) {
      return facility.speedPolicies.length > 0;
    }
    return Boolean(facility.legacySpeedConfiguration
      || facility.speedConfiguration);
  }

  function applyFacilityFeatureState(units, facility) {
    var speedPolicyConfigured = facilityHasSpeedPolicy(facility);
    (units || []).forEach(function (unit) {
      if (unit.performance) {
        unit.performance.speedPolicyConfigured = speedPolicyConfigured;
      }
    });
  }

  function getDateRange(value) {
    return fixture.dateRanges.find(function (range) {
      return range.value === value;
    }) || fixture.dateRanges[0];
  }

  function getShift(value) {
    return fixture.shifts.find(function (shift) {
      return shift.value === value;
    }) || fixture.shifts[0];
  }

  function getComparison(value) {
    return fixture.comparisons.find(function (comparison) {
      return comparison.value === value;
    }) || fixture.comparisons[0];
  }

  function getReport(reportId) {
    return fixture.reports.find(function (report) {
      return report.id === reportId;
    }) || fixture.reports[0];
  }

  function findAuthorizedUnit(unitId) {
    if (!selectors.canOpenDetailDrawer(activeScope, unitId)) {
      return null;
    }
    return authorizedUnits.find(function (unit) {
      return unit.id === unitId;
    }) || null;
  }

  function findHistoricallyAuthorizedUnit(unitId) {
    if (!selectors.canOpenDetailDrawer(historicalScope, unitId)) {
      return null;
    }
    return historicalUnits.find(function (unit) {
      return unit.id === unitId;
    }) || null;
  }

  function historicalIssueText() {
    return historicalScope && !historicalScope.ok
      ? historicalScope.reason
      : "Historical reporting is not configured for this asset.";
  }

  function parseMinutes(value) {
    var source = String(value || "");
    var hours = /(\d+)h/.exec(source);
    var minutes = /(\d+)m/.exec(source);
    return (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  }

  function parsePercent(value) {
    var parsed = Number(String(value || "0").replace("%", ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function average(values) {
    if (!values.length) {
      return 0;
    }
    return values.reduce(function (total, value) {
      return total + value;
    }, 0) / values.length;
  }

  function formatOneDecimal(value) {
    return value.toFixed(1).replace(".0", "");
  }

  function formatSpeed(unit) {
    return unit.speed === null ? "--" : unit.speed + " mph";
  }

  function formatLevels(unit) {
    return (unit.fuel === null ? "--" : unit.fuel + "%") + " / " + (unit.def === null ? "--" : unit.def + "%");
  }

  function qualityClass(unit) {
    if (!unit.quality) {
      return "siq-quality";
    }
    if (unit.stateKey === "not-communicating") {
      return "siq-quality siq-quality--alert";
    }
    return "siq-quality siq-quality--warn";
  }

  function scopeIssueText() {
    if (!activeScope || activeScope.ok) {
      return "";
    }
    if (activeScope.code === "administrator-selection-required") {
      return "Select an authorized customer and facility to establish scope.";
    }
    if (activeScope.code === "no-authorized-facilities" || activeScope.code === "missing-user") {
      return "No authorized facilities";
    }
    if (activeScope.code === "invalid-facility-configuration") {
      return "Invalid facility configuration";
    }
    if (activeScope.code === "no-accessible-enrolled-assets") {
      return "Facility enrollment contains no accessible devices";
    }
    return activeScope.reason || "No authorized assets";
  }

  function emptyState(title, detail) {
    var block = createEl("div", "siq-empty-state");
    block.append(createEl("strong", "", title), createEl("span", "", detail));
    return block;
  }

  function rowMatchesFilter(unit) {
    var presentation = selectors.operationsPresentation(unit);
    if (activeBoardFilter === "moving") {
      return presentation.stateKey === "coupled-moving"
        || presentation.stateKey === "bobtail-moving"
        || presentation.stateKey === "engine-on-moving";
    }
    if (activeBoardFilter === "review") {
      return Boolean(unit.quality);
    }
    return true;
  }

  function setValue(unitId, key, value, flash) {
    var unitValues = valueElements.get(unitId);
    if (!unitValues || !unitValues[key]) {
      return;
    }
    unitValues[key].textContent = text(value);
    if (flash) {
      unitValues[key].classList.remove("siq-value--changed");
      window.requestAnimationFrame(function () {
        unitValues[key].classList.add("siq-value--changed");
      });
    }
  }

  function updateOperationsSelection() {
    rowElements.forEach(function (row, unitId) {
      var isSelected = unitId === selectedUnitId;
      row.classList.toggle("siq-unit-row--selected", isSelected);
      row.setAttribute("aria-selected", String(isSelected));
      var marker = row.querySelector(".siq-row-selection");
      if (marker) {
        marker.setAttribute("aria-hidden", String(!isSelected));
      }
    });
  }

  function closeOperationsDrawer(message) {
    var drawer = byId("siq-detail-drawer");
    byId("siq-detail-title").textContent = "Select a unit";
    byId("siq-detail-content").replaceChildren(createEl("p", "siq-empty-detail", message || "Choose a row to inspect fixture state and move activity."));
    drawer.classList.remove("siq-detail-drawer--open");
    selectedUnitId = null;
    updateOperationsSelection();
  }

  function renderUnitRow(unit) {
    var presentation = selectors.operationsPresentation(unit);
    var row = createEl("button", "siq-unit-row siq-unit-row--" + presentation.stateKey);
    var values = {};

    row.type = "button";
    row.setAttribute("role", "row");
    row.setAttribute("data-device-id", unit.id);
    row.setAttribute("aria-selected", "false");
    row.setAttribute("aria-label", unit.name + ", " + presentation.state
      + ", driver " + (unit.currentDriverDisplayName || "Unassigned")
      + (unit.quality ? ", " + unit.quality : ""));

    function addCell(key, className, value) {
      var cell = createEl("span", className, value);
      cell.setAttribute("role", "cell");
      row.appendChild(cell);
      values[key] = cell;
    }

    var unitCell = createEl("span", "siq-unit-row__unit");
    var unitName = createEl("strong", "", unit.name);
    unitName.title = unit.name;
    unitCell.title = unit.name;
    unitCell.setAttribute("role", "cell");
    var currentDriver = createEl("span", "siq-unit-row__driver");
    var currentDriverValue = createEl(
      "span",
      "siq-unit-row__driver-value" + (unit.currentDriverDisplayName
        ? "" : " siq-unit-row__driver-value--unassigned"),
      unit.currentDriverDisplayName || "Unassigned"
    );
    currentDriver.append(
      createEl("span", "siq-unit-row__driver-label", "Driver:"),
      currentDriverValue
    );
    unitCell.append(unitName, currentDriver);
    row.appendChild(unitCell);
    values.name = unitName;
    values.currentDriverDisplayName = currentDriverValue;

    addCell("role", "siq-role-cell", unit.roleLabel || "--");
    addCell("status", "siq-status-cell", unit.statusLabel || "--");

    var stateCell = createEl("span", "siq-state-cell");
    var rail = createEl("span", "siq-state-rail");
    var stateText = createEl("span", "siq-state-text", presentation.state);
    var duration = createEl("span", "siq-state-duration", unit.duration);
    stateCell.setAttribute("role", "cell");
    rail.setAttribute("aria-hidden", "true");
    stateCell.append(rail, stateText, duration);
    row.appendChild(stateCell);
    values.state = stateText;
    values.duration = duration;

    addCell("moves", "siq-number-cell", presentation.movesLabel);
    addCell("speed", "siq-number-cell", formatSpeed(unit));
    addCell("fifthWheelStatus", "siq-plain-cell", presentation.fifthWheelStatus);
    addCell("lastMove", "siq-plain-cell", presentation.lastMove);
    addCell("levels", "siq-plain-cell", formatLevels(unit));
    addCell("engineHours", "siq-plain-cell", unit.engineHours + " h");
    addCell("freshness", "siq-plain-cell", unit.freshness);

    var quality = createEl("span", qualityClass(unit));
    quality.textContent = unit.quality || "";
    quality.setAttribute("role", "cell");
    row.appendChild(quality);
    values.quality = quality;

    row.addEventListener("click", function () {
      selectUnit(unit.id);
    });

    rowElements.set(unit.id, row);
    valueElements.set(unit.id, values);
    return row;
  }

  function renderBoard() {
    var body = byId("siq-unit-board-body");
    var fragment = document.createDocumentFragment();
    rowElements.clear();
    valueElements.clear();
    body.replaceChildren();

    if (!authorizedUnits.length) {
      body.appendChild(emptyState("No authorized assets", scopeIssueText() || "No units are available in the effective scope."));
      return;
    }

    authorizedUnits.forEach(function (unit) {
      fragment.appendChild(renderUnitRow(unit));
    });
    body.appendChild(fragment);
    applyBoardFilter();
    updateOperationsSelection();
  }

  function addDetailMetric(container, label, value) {
    var metric = createEl("div", "siq-detail-metric");
    metric.append(createEl("span", "", label), createEl("strong", "", value));
    container.appendChild(metric);
  }

  function createDetailSection(title, items) {
    var section = createEl("section", "siq-detail-section");
    section.appendChild(createEl("h3", "siq-mini-title", title));
    var metrics = createEl("div", "siq-detail-metrics");
    items.forEach(function (item) {
      if (item[1] !== null && item[1] !== undefined && item[1] !== "") {
        addDetailMetric(metrics, item[0], item[1]);
      }
    });
    section.appendChild(metrics);
    return section;
  }

  function createEngineHealthSection(unit) {
    var health = unit && unit.engineHealth || {};
    var available = health.status === "AVAILABLE";
    var section = createDetailSection("Engine Health", [
      ["Check Engine Light", available
        ? health.checkEngineLight || "Unavailable" : "Unavailable"],
      ["Active Engine Faults", available
        && Number.isFinite(health.activeEngineFaults)
        ? health.activeEngineFaults : "Unavailable"],
      ["Pending Engine Faults", available
        && Number.isFinite(health.pendingEngineFaults)
        ? health.pendingEngineFaults : "Unavailable"],
      ["Active Transmission Faults", available
        && Number.isFinite(health.activeTransmissionFaults)
        ? health.activeTransmissionFaults : "Unavailable"],
      ["Pending Transmission Faults", available
        && Number.isFinite(health.pendingTransmissionFaults)
        ? health.pendingTransmissionFaults : "Unavailable"],
      ["Highest Severity", available
        ? health.highestSeverity || "Unavailable" : "Unavailable"],
      ["Last Updated", available
        ? formatTimestamp(health.lastUpdated) : "Unavailable"]
    ]);
    section.classList.add("siq-engine-health");
    var status = !available
      ? "Engine Health Unavailable"
      : health.noActivePowertrainFaults
        ? "No active powertrain faults"
        : "Current qualifying powertrain faults";
    section.insertBefore(
      createEl("p", "siq-engine-health__status", status),
      section.children[1]
    );
    var list = createEl("div", "siq-engine-health__faults");
    if (available && Array.isArray(health.details)) {
      health.details.forEach(function (fault) {
        var code = Number.isFinite(fault.diagnosticCode)
          ? "SPN " + fault.diagnosticCode : "Diagnostic code unavailable";
        var failure = Number.isFinite(fault.failureModeCode)
          ? "FMI " + fault.failureModeCode : "FMI unavailable";
        var row = createEl("article", "siq-engine-health__fault");
        row.append(
          createEl("strong", "siq-engine-health__fault-title",
            (fault.category === "TRANSMISSION" ? "Transmission" : "Engine")
              + " · " + code + " · " + failure),
          createEl("span", "siq-engine-health__fault-description",
            fault.description || "Description unavailable"),
          createEl("span", "siq-engine-health__fault-meta",
            fault.state + " · " + (fault.severity || "Severity unavailable")
              + " · Count " + (Number.isFinite(fault.occurrenceCount)
                ? fault.occurrenceCount : "Unavailable")
              + " · " + formatTimestamp(fault.timestamp))
        );
        list.appendChild(row);
      });
    }
    section.appendChild(list);
    return section;
  }

  function assetBillingProfile(unit) {
    var usage = fixture.monthlyUsageFixture;
    if (!usage || !Array.isArray(usage.profiles)) {
      return null;
    }
    return usage.profiles.find(function (profile) {
      return profile.assetId === unit.assetId;
    }) || null;
  }

  function facilityLabel(facilityId) {
    var facility = configuration.facilities.find(function (entry) {
      return entry.id === facilityId;
    });
    return facility ? facility.displayName : facilityId || null;
  }

  function renderOperationsDetail(unit) {
    var presentation = selectors.operationsPresentation(unit);
    var drawer = byId("siq-detail-drawer");
    var content = byId("siq-detail-content");
    byId("siq-detail-title").textContent = unit.name;
    byId("siq-detail-title").title = unit.name;
    content.replaceChildren();

    var identityBlock = createEl("div", "siq-detail-identity");
    identityBlock.append(
      createEl("strong", "siq-detail-identity__role", unit.roleLabel || "--"),
      createEl("span", "siq-detail-identity__status", unit.statusLabel || "--")
    );

    if (unit.advancedProfileConfigured === false) {
      identityBlock.appendChild(createEl(
        "span",
        "siq-detail-identity__status",
        unit.profileStatus || "Advanced SpotterIQ profile not configured"
      ));
    }

    var profile = assetBillingProfile(unit);
    var assignment = profile && profile.facilityAssignments
      ? profile.facilityAssignments.find(function (entry) {
        return entry.effectiveThrough === null;
      }) || profile.facilityAssignments[profile.facilityAssignments.length - 1]
      : null;
    var commercial = profile ? profile.commercialTerms : null;

    var assignmentItems = [
      ["Current operating facility", unit.currentAssignment || "--"],
      ["Home facility", unit.homeFacility || "--"]
    ];
    if (unit.coveringUnit) {
      assignmentItems.push(["Covered unit", unit.coveringUnit]);
    }
    if (unit.expectedReturn) {
      assignmentItems.push(["Expected return", unit.expectedReturn]);
    }

    var commercialItems = selectors.unitDetailCommercialFields(
      currentUser(),
      {
        advancedProfileConfigured: unit.advancedProfileConfigured,
        commercialConfigurationStatus: unit.commercialConfigurationStatus,
        leaseStart: unit.leaseStart,
        commercialTerms: commercial,
        billingFacility: assignment && assignment.billingFacilityId
          ? facilityLabel(assignment.billingFacilityId) : null
      }
    );

    var operationsItems = [
      ["Current operating state", presentation.state],
      ["State duration", unit.duration],
      ["Fifth Wheel Status", presentation.fifthWheelStatus],
      ["Verified moves", presentation.verifiedMovesLabel],
      ["Current speed", formatSpeed(unit)],
      ["Shift moves", presentation.verifiedMovesLabel],
      ["Last move", presentation.lastMove],
      ["Fuel / DEF", formatLevels(unit)],
      ["Engine hours", unit.engineHours + " h"],
      ["Communication freshness", unit.freshness]
    ];
    var operationalTelemetry = window.SIQ_OPERATIONS_VIEW
      .operationalTelemetryPresentation(unit);
    operationsItems.splice(2, 0,
      ["Ignition", operationalTelemetry.ignition],
      ["Odometer", operationalTelemetry.odometer],
      ["Engine Coolant Temperature", operationalTelemetry.coolant]
    );
    var driver = selectors.driverPresentation(unit);
    operationsItems.push([
      "Current Driver",
      unit.currentDriverDisplayName || "Unassigned"
    ]);
    if (driver.identifiedAt) {
      operationsItems.push(["Identified", formatTimestamp(driver.identifiedAt)]);
    }
    if (unit.billableDeploymentUsage) {
      operationsItems.push(["Billable usage this deployment",
        unit.billableDeploymentUsage]);
    }
    if (unit.lastExercised) {
      operationsItems.push(["Last exercised", unit.lastExercised]);
    }
    if (unit.assignmentReason) {
      assignmentItems.push(["Assignment reason", unit.assignmentReason]);
    }
    if (unit.groupReconciliation
      && unit.groupReconciliation !== "MATCHED"
      && activeScope.user
      && activeScope.user.role === "Fleetsource Administrator") {
      assignmentItems.push(["Group reconciliation", unit.groupReconciliation]);
    }
    if (unit.quality) {
      operationsItems.push(["Attention", unit.quality]);
    }

    var activity = createEl("div", "siq-activity-list");
    activity.appendChild(createEl("h3", "siq-mini-title", "Activity Timeline"));
    (unit.driverTimeline || []).forEach(function (entry) {
      activity.appendChild(createEl(
        "div",
        "siq-activity-item",
        entry.label + " · " + formatTimestamp(entry.timestamp)
      ));
    });
    if (presentation.recentMoves.length) {
      presentation.recentMoves.forEach(function (entry) {
        activity.appendChild(createEl("div", "siq-activity-item", entry));
      });
    } else {
      activity.appendChild(createEl(
        "div",
        "siq-activity-item",
        presentation.fifthWheelAvailable
          ? "No authorized fixture move activity"
          : "Verified move activity unavailable without Fifth Wheel Status capability"
      ));
    }

    var action = createEl("button", "siq-button siq-button--wide", "View Scorecard");
    action.type = "button";
    action.addEventListener("click", function () {
      showModule("performance");
      selectPerformanceUnit(unit.id, true);
    });

    content.append(
      identityBlock,
      createDetailSection("Assignment", assignmentItems)
    );
    if (commercialItems.length) {
      content.appendChild(createDetailSection("Commercial", commercialItems));
    }
    content.append(
      createDetailSection("Operations", operationsItems),
      createEngineHealthSection(unit),
      activity,
      action
    );
    drawer.classList.add("siq-detail-drawer--open");
  }

  function selectUnit(unitId) {
    var unit = findAuthorizedUnit(unitId);
    if (!unit) {
      closeOperationsDrawer("No authorized assets");
      return false;
    }
    selectedUnitId = unitId;
    updateOperationsSelection();
    renderOperationsDetail(unit);
    return true;
  }

  function applyBoardFilter() {
    authorizedUnits.forEach(function (unit) {
      var row = rowElements.get(unit.id);
      if (row) {
        row.hidden = !rowMatchesFilter(unit);
      }
    });
  }

  function updateUnitRow(unit, changedKeys) {
    var presentation = selectors.operationsPresentation(unit);
    if (!findAuthorizedUnit(unit.id)) {
      return;
    }
    setValue(unit.id, "state", presentation.state, changedKeys.state);
    setValue(unit.id, "duration", unit.duration, changedKeys.duration);
    setValue(unit.id, "moves", presentation.movesLabel, changedKeys.moves);
    setValue(unit.id, "speed", formatSpeed(unit), changedKeys.speed);
    setValue(
      unit.id,
      "fifthWheelStatus",
      presentation.fifthWheelStatus,
      changedKeys.fifthWheelStatus
    );
    setValue(unit.id, "lastMove", presentation.lastMove, changedKeys.lastMove);
    setValue(unit.id, "levels", formatLevels(unit), changedKeys.levels);
    setValue(unit.id, "engineHours", unit.engineHours + " h", changedKeys.engineHours);
    setValue(unit.id, "freshness", unit.freshness, changedKeys.freshness);
    setValue(
      unit.id,
      "currentDriverDisplayName",
      unit.currentDriverDisplayName || "Unassigned",
      changedKeys.currentDriverDisplayName
    );
    setValue(unit.id, "quality", unit.quality, changedKeys.quality);

    var row = rowElements.get(unit.id);
    var unitValues = valueElements.get(unit.id);
    if (unitValues && unitValues.currentDriverDisplayName) {
      unitValues.currentDriverDisplayName.classList.toggle(
        "siq-unit-row__driver-value--unassigned",
        !unit.currentDriverDisplayName
      );
    }
    var quality = unitValues ? unitValues.quality : null;
    if (row) {
      row.className = "siq-unit-row siq-unit-row--" + presentation.stateKey;
      row.setAttribute("aria-label", unit.name + ", " + presentation.state
        + ", driver " + (unit.currentDriverDisplayName || "Unassigned")
        + (unit.quality ? ", " + unit.quality : ""));
      if (quality) {
        quality.className = qualityClass(unit);
      }
    }
    updateOperationsSelection();
    applyBoardFilter();
  }

  function simulateTelemetry() {
    var unit = authorizedUnits[0];
    if (!unit) {
      return;
    }

    var fifthWheelAvailable = selectors.operationsPresentation(unit)
      .fifthWheelAvailable;
    if (fifthWheelAvailable) {
      unit.state = unit.state === "Coupled Moving" ? "Coupled Idle" : "Coupled Moving";
      unit.stateKey = unit.state === "Coupled Moving" ? "coupled-moving" : "coupled-idle";
      unit.moves += 1;
      unit.performance.movesPerEngineHour = unit.moves % 2 === 0 ? "3.1" : "3.3";
      unit.fifthWheelStatus = "Trailer Coupled";
      unit.lastMove = "Now";
      unit.moveInProgress = unit.state === "Coupled Moving";
    } else {
      unit.state = unit.state === "Engine On \u2014 Moving"
        ? "Engine On \u2014 Stationary" : "Engine On \u2014 Moving";
      unit.stateKey = unit.state === "Engine On \u2014 Moving"
        ? "engine-on-moving" : "engine-on-stationary";
      unit.fifthWheelStatus = "Fifth Wheel Status Unavailable";
      unit.moveInProgress = false;
    }
    unit.duration = "1m";
    unit.speed = unit.state === "Coupled Moving"
      || unit.state === "Engine On \u2014 Moving" ? 12 : 0;
    unit.freshness = "4s";
    unit.quality = "";
    unit.performance.dataWarnings = [];
    unit.alert = "Simulated telemetry update";
    unit.recentMoves.unshift(fifthWheelAvailable
      ? "Now simulated fixture telemetry"
      : "Now simulated independent telemetry");
    unit.recentMoves = unit.recentMoves.slice(0, 3);

    byId("siq-data-age").textContent = "Data age 4s";
    byId("siq-last-checked").textContent = "Checked just now";
    updateKpis();
    buildSummaryBand();
    updateUnitRow(unit, {
      state: true,
      duration: true,
      moves: true,
      speed: true,
      fifthWheelStatus: true,
      lastMove: true,
      freshness: true,
      quality: true
    });

    if (selectedUnitId === unit.id) {
      renderOperationsDetail(unit);
    }
    updatePerformanceRow(unit);
    if (selectedPerformanceUnitId === unit.id) {
      renderPerformanceDetail(unit);
    }
    updateReportPreview();
  }

  function deriveMetrics(units) {
    var communicating = units.filter(function (unit) {
      return unit.stateKey !== "not-communicating";
    }).length;
    var verifiedMovePresentations = units.map(function (unit) {
      return selectors.operationsPresentation(unit);
    }).filter(function (presentation) {
      return presentation.completedMoves !== null;
    });
    var completedMoves = verifiedMovePresentations.reduce(function (total, presentation) {
      return total + presentation.completedMoves;
    }, 0);
    var moveInProgress = verifiedMovePresentations.filter(function (presentation) {
      return presentation.moveInProgress;
    }).length;
    var utilizationValues = units.map(function (unit) {
      return performanceApi.metricValue(unit, "productiveUtilization");
    }).filter(function (value) {
      return value !== null;
    });
    var movesPerEngineHourValues = units.map(function (unit) {
      return performanceApi.metricValue(unit, "movesPerEngineHour");
    }).filter(function (value) {
      return value !== null;
    });
    var utilization = average(utilizationValues);
    var movesPerEngineHour = average(movesPerEngineHourValues);
    var speedPolicyConfigured = units.some(function (unit) {
      return performanceApi.speedPolicyConfigured(unit);
    });
    var overSpeedMinutes = speedPolicyConfigured
      ? units.reduce(function (total, unit) {
        return total + parseMinutes(unit.overSpeed);
      }, 0) : null;
    var topSpeed = units.reduce(function (max, unit) {
      return Math.max(max, unit.topSpeed || 0);
    }, 0);
    var totalFuel = performanceApi.totalFuelGallons(units);
    var issues = units.filter(function (unit) {
      return Boolean(unit.quality);
    }).length;

    return {
      communicating: communicating,
      total: units.length,
      verifiedMoveUnitCount: verifiedMovePresentations.length,
      completedMoves: completedMoves,
      moveInProgress: moveInProgress,
      utilization: utilization,
      movesPerEngineHour: movesPerEngineHour,
      overSpeedMinutes: overSpeedMinutes,
      topSpeed: topSpeed,
      issues: issues,
      totalFuel: totalFuel,
      hasFuelData: totalFuel !== null
    };
  }

  function updateKpis() {
    var metrics = deriveMetrics(authorizedUnits);
    var presentations = authorizedUnits.map(selectors.operationsPresentation);
    byId("siq-kpi-moving-value").textContent = String(presentations.filter(function (item) {
      return /Moving/.test(item.state);
    }).length);
    byId("siq-kpi-idling-value").textContent = String(presentations.filter(function (item) {
      return /Idle|Stationary/.test(item.state);
    }).length);
    byId("siq-kpi-off-value").textContent = String(presentations.filter(function (item) {
      return /Off/.test(item.state);
    }).length);
    byId("siq-kpi-coupled-value").textContent = String(presentations.filter(function (item) {
      return item.fifthWheelAvailable && /Closed|Coupled/.test(item.fifthWheelStatus);
    }).length);
    byId("siq-kpi-completed-value").textContent = String(metrics.completedMoves);
    byId("siq-kpi-unit-detail").textContent =
      metrics.total + " units in this facility · "
        + metrics.verifiedMoveUnitCount + " verified-capable units";
  }

  function buildSummaryBand() {
    var container = byId("siq-summary-metrics");
    var comparison = getComparison(appliedScope.compare);
    var items = performanceApi.facilitySummary(historicalUnits, comparison.label);

    container.replaceChildren();
    items.forEach(function (metric) {
      var item = createEl("div", "siq-summary-metric");
      var comparisonText = createEl(
        "span",
        "siq-comparison siq-comparison--" + metric.favorability,
        metric.comparison
      );
      item.append(
        createEl("span", "siq-summary-metric__label", metric.label),
        createEl("strong", "siq-summary-metric__value", metric.value),
        comparisonText,
        createEl("span", "siq-summary-metric__qualifier", metric.qualifier)
      );
      container.appendChild(item);
    });

    var summaries = performanceApi.summaryNotices(historicalUnits);
    var notice = byId("siq-summary-data-notice");
    notice.hidden = !summaries.length;
    notice.textContent = summaries.join(" ");
  }

  function performanceTableCell(value, className) {
    return createEl("td", className || "", value);
  }

  function renderPerformanceRankingRow(unit) {
    var row = createEl("tr", "");
    var identityCell = createEl("td", "siq-performance-unit-identity siq-ranking-text");
    var identity = createEl("span", "siq-unit-identity", unit.displayLabel || unit.name);
    var attention = performanceApi.attentionForUnit(unit);
    var attentionCell = createEl(
      "td",
      "siq-attention siq-attention--" + attention.kind + " siq-ranking-text",
      attention.label
    );

    row.setAttribute("data-device-id", unit.id);
    row.setAttribute("aria-selected", "false");
    row.tabIndex = 0;
    row.setAttribute(
      "aria-label",
      (unit.displayLabel || unit.name) + ", " + unit.roleLabel + ", "
        + attention.label + ". Select for unit analysis."
    );
    identityCell.appendChild(identity);
    row.append(
      identityCell,
      performanceTableCell(unit.roleLabel, "siq-ranking-text"),
      performanceTableCell(performanceApi.formatMetric("engineHours", performanceApi.metricValue(unit, "engineHours")), "siq-usage-number"),
      performanceTableCell(performanceApi.formatMetric("completedMoves", performanceApi.metricValue(unit, "completedMoves")), "siq-usage-number"),
      performanceTableCell(performanceApi.formatMetric("movesPerEngineHour", performanceApi.metricValue(unit, "movesPerEngineHour")), "siq-usage-number"),
      performanceTableCell(performanceApi.formatMetric("productiveUtilization", performanceApi.metricValue(unit, "productiveUtilization")), "siq-usage-number"),
      performanceTableCell(performanceApi.formatMetric("idleTime", performanceApi.metricValue(unit, "idleTime")), "siq-usage-number"),
      performanceTableCell(performanceApi.formatMetric("fuelPerMove", performanceApi.metricValue(unit, "fuelPerMove")), "siq-usage-number"),
      performanceTableCell(performanceApi.formatMetric("topSpeed", performanceApi.metricValue(unit, "topSpeed")), "siq-usage-number"),
      performanceTableCell(performanceApi.formatMetric("timeOverLimit", performanceApi.metricValue(unit, "timeOverLimit")), "siq-usage-number"),
      attentionCell
    );
    row.addEventListener("click", function () {
      selectPerformanceUnit(unit.id);
    });
    row.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectPerformanceUnit(unit.id);
      }
    });
    performanceRowElements.set(unit.id, row);
    return row;
  }

  function updatePerformanceSortHeaders() {
    appRoot.querySelectorAll("[data-sort-column]").forEach(function (header) {
      var key = header.getAttribute("data-sort-column");
      if (key === performanceSort.key) {
        header.setAttribute("aria-sort", performanceSort.direction === "asc" ? "ascending" : "descending");
      } else {
        header.removeAttribute("aria-sort");
      }
    });
    var directionLabel = performanceSort.direction === "asc" ? "ascending" : "descending";
    byId("siq-unit-ranking-context").textContent = performanceSort.key === "attention"
      ? "Attention first / Productive Utilization descending"
      : performanceApi.metrics[performanceSort.key]
        ? performanceApi.metrics[performanceSort.key].label + " / " + directionLabel
        : performanceSort.key + " / " + directionLabel;
  }

  function renderPerformanceRanking() {
    var body = byId("siq-performance-score-body");
    var fragment = document.createDocumentFragment();
    performanceRowElements.clear();
    body.replaceChildren();
    byId("siq-scorecard-count").textContent = historicalUnits.length + " historically authorized fixture units";

    if (!historicalUnits.length) {
      var emptyRow = createEl("tr", "");
      var emptyCell = createEl("td", "", historicalIssueText());
      emptyCell.colSpan = 11;
      emptyRow.appendChild(emptyCell);
      body.appendChild(emptyRow);
      return;
    }

    performanceApi.rankUnits(historicalUnits, performanceSort).forEach(function (unit) {
      fragment.appendChild(renderPerformanceRankingRow(unit));
    });
    body.appendChild(fragment);
    updatePerformanceSelection();
    updatePerformanceSortHeaders();
  }

  function updatePerformanceRow(unit) {
    if (!performanceRowElements.has(unit.id)) {
      return;
    }
    renderPerformanceRanking();
  }

  function updatePerformanceSelection() {
    performanceRowElements.forEach(function (row, unitId) {
      var isSelected = unitId === selectedPerformanceUnitId;
      row.classList.toggle("siq-performance-ranking-row--selected", isSelected);
      row.setAttribute("aria-selected", String(isSelected));
    });
  }

  function changePerformanceSort(key) {
    if (performanceSort.key === key) {
      performanceSort.direction = performanceSort.direction === "asc" ? "desc" : "asc";
    } else {
      performanceSort = {
        key: key,
        direction: ["attention", "productiveUtilization", "completedMoves", "movesPerEngineHour"].indexOf(key) !== -1
          ? "desc" : "asc"
      };
    }
    renderPerformanceRanking();
  }

  function createSvgElement(tag, className) {
    var element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (className) {
      element.setAttribute("class", className);
    }
    return element;
  }

  function renderPerformanceDonut(unit) {
    var model = performanceApi.donutModel(unit);
    var chart = byId("siq-performance-donut-chart");
    var legend = byId("siq-performance-donut-legend");
    var summary = byId("siq-performance-donut-summary");
    var svg = createSvgElement("svg", "siq-donut-svg");
    var title = createSvgElement("title");
    var description = createSvgElement("desc");
    var track = createSvgElement("circle", "siq-donut-track");
    var centerValue = createSvgElement("text", "siq-donut-center-value");
    var centerLabel = createSvgElement("text", "siq-donut-center-label");
    var cumulative = 0;

    svg.setAttribute("viewBox", "0 0 220 220");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-labelledby", "siq-donut-svg-title siq-donut-svg-description");
    title.setAttribute("id", "siq-donut-svg-title");
    title.textContent = (unit.displayLabel || unit.name) + " time distribution";
    description.setAttribute("id", "siq-donut-svg-description");
    description.textContent = model.summary;
    track.setAttribute("cx", "110");
    track.setAttribute("cy", "110");
    track.setAttribute("r", "76");
    track.setAttribute("pathLength", "100");
    svg.append(title, description, track);

    model.categories.forEach(function (category) {
      var segment = createSvgElement("circle", "siq-donut-segment siq-donut-segment--" + category.key);
      var pointDescription = createSvgElement("title");
      segment.setAttribute("cx", "110");
      segment.setAttribute("cy", "110");
      segment.setAttribute("r", "76");
      segment.setAttribute("pathLength", "100");
      segment.setAttribute("stroke-dasharray", category.percentage + " " + (100 - category.percentage));
      segment.setAttribute("stroke-dashoffset", String(-cumulative));
      segment.setAttribute("transform", "rotate(-90 110 110)");
      pointDescription.textContent = category.label + ": " + category.duration + ", " + category.percentage + "%";
      segment.appendChild(pointDescription);
      svg.appendChild(segment);
      cumulative += category.percentage;
    });

    centerValue.setAttribute("x", "110");
    centerValue.setAttribute("y", "106");
    centerValue.setAttribute("text-anchor", "middle");
    centerValue.textContent = model.centerValue;
    centerLabel.setAttribute("x", "110");
    centerLabel.setAttribute("y", "126");
    centerLabel.setAttribute("text-anchor", "middle");
    centerLabel.textContent = model.centerLabel;
    svg.append(centerValue, centerLabel);
    chart.replaceChildren(svg);

    legend.replaceChildren();
    model.categories.forEach(function (category) {
      var row = createEl("div", "siq-donut-legend__row");
      row.append(
        createEl("span", "siq-donut-key siq-donut-key--" + category.key),
        createEl("span", "siq-donut-legend__label", category.label),
        createEl("strong", "", category.duration),
        createEl("span", "siq-donut-legend__percent", category.percentage + "%")
      );
      legend.appendChild(row);
    });
    summary.textContent = model.caption + " · " + model.coverageSummary;
  }

  function renderUnitFacilityComparison(unit) {
    var container = byId("siq-unit-facility-comparison");
    var header = createEl("div", "siq-unit-comparison__header");
    header.append(
      createEl("span", "", "Metric"),
      createEl("span", "", "Unit"),
      createEl("span", "", "Facility average"),
      createEl("span", "", "Difference")
    );
    container.replaceChildren(header);
    performanceApi.comparisonRows(unit, historicalUnits).forEach(function (comparison) {
      var row = createEl("div", "siq-unit-comparison__row");
      var selected = createEl("strong", "siq-unit-comparison__selected", comparison.selectedValue);
      var facility = createEl("span", "siq-unit-comparison__facility", "Facility " + comparison.facilityValue);
      var difference = createEl(
        "span",
        "siq-unit-comparison__difference siq-comparison--" + comparison.favorability,
        comparison.difference
      );
      if (!comparison.available) {
        selected.classList.add("siq-value-unavailable");
      }
      row.append(
        createEl("span", "siq-unit-comparison__label", comparison.label),
        selected,
        facility,
        difference
      );
      container.appendChild(row);
    });
  }

  function observationGroup(title, items, kind) {
    var group = createEl("section", "siq-observation-group siq-observation-group--" + kind);
    var list = createEl("ul", "");
    group.appendChild(createEl("h4", "", title));
    if (!items.length) {
      list.appendChild(createEl("li", "", "No findings for this period."));
    } else {
      items.forEach(function (item) {
        list.appendChild(createEl("li", "", item));
      });
    }
    group.appendChild(list);
    return group;
  }

  function renderPerformanceObservations(unit) {
    var container = byId("siq-performance-observations");
    var model = performanceApi.deterministicObservations(unit, historicalUnits);
    container.replaceChildren(
      observationGroup("Operational observations", model.operational, "operational"),
      observationGroup("Data availability", model.availability, "availability"),
      observationGroup("Exceptions requiring review", model.exceptions, "exceptions")
    );
  }

  function trendPath(points, valueKey, xForIndex, yForValue) {
    var commands = [];
    var drawing = false;
    points.forEach(function (point, index) {
      var value = point[valueKey];
      if (value === null) {
        drawing = false;
        return;
      }
      commands.push((drawing ? "L" : "M") + xForIndex(index) + " " + yForValue(value));
      drawing = true;
    });
    return commands.join(" ");
  }

  function configureTrendMetricOptions(unit) {
    var select = byId("siq-performance-trend-metric");
    var firstAvailable = null;
    Array.from(select.options).forEach(function (option) {
      var available = performanceApi.metricValue(unit, option.value) !== null;
      var unavailableReason = performanceApi.metricUnavailableReason(
        unit,
        option.value
      );
      option.disabled = !available;
      option.textContent = performanceApi.trendMetricLabel(option.value, appliedScope.dateRange)
        + (available ? "" : " — " + unavailableReason);
      if (available && !firstAvailable) {
        firstAvailable = option.value;
      }
    });
    if (performanceApi.metricValue(unit, performanceTrendMetric) === null) {
      performanceTrendMetric = firstAvailable || performanceTrendMetric;
    }
    select.value = performanceTrendMetric;
  }

  function renderPerformanceTrend(unit) {
    configureTrendMetricOptions(unit);
    var model = performanceApi.trendSeriesModel(unit, performanceTrendMetric, appliedScope.dateRange);
    var chart = byId("siq-performance-trend-chart");
    var summary = byId("siq-performance-trend-summary");
    byId("siq-performance-trend-title").textContent = model.label + " Trend";
    if (!model.available || !model.points.length) {
      chart.replaceChildren(createEl("p", "siq-empty-detail", model.summary));
      summary.textContent = model.footer;
      return;
    }

    var svg = createSvgElement("svg", "siq-trend-svg");
    var title = createSvgElement("title");
    var description = createSvgElement("desc");
    var plotLeft = 74;
    var plotRight = 730;
    var plotTop = 24;
    var plotBottom = 214;
    var allValues = [];
    model.points.forEach(function (point) {
      if (point.value !== null) {
        allValues.push(point.value);
      }
      if (point.facilityAverage !== null) {
        allValues.push(point.facilityAverage);
      }
    });
    var minValue = Math.min.apply(Math, allValues);
    var maxValue = Math.max.apply(Math, allValues);
    var span = maxValue - minValue;
    var padding = span ? span * 0.15 : Math.max(Math.abs(maxValue) * 0.15, 1);
    minValue = Math.max(0, minValue - padding);
    maxValue += padding;
    var tickModel = performanceApi.trendTickModel(model.key, minValue, maxValue, 5);
    var accessiblePointSummary = performanceApi.trendPointSummary(model, tickModel.precision);
    var xForIndex = function (index) {
      return plotLeft + (model.points.length === 1 ? 0 : index / (model.points.length - 1) * (plotRight - plotLeft));
    };
    var yForValue = function (value) {
      return plotBottom - (value - minValue) / (maxValue - minValue) * (plotBottom - plotTop);
    };

    svg.setAttribute("viewBox", "0 0 760 260");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-labelledby", "siq-trend-svg-title siq-trend-svg-description");
    title.setAttribute("id", "siq-trend-svg-title");
    title.textContent = (unit.displayLabel || unit.name) + " " + model.label + " trend";
    description.setAttribute("id", "siq-trend-svg-description");
    description.textContent = model.summary + " " + accessiblePointSummary + " " + model.footer;
    svg.append(title, description);

    var yAxisTitle = createSvgElement("text", "siq-trend-axis-title");
    yAxisTitle.setAttribute("x", "14");
    yAxisTitle.setAttribute("y", "120");
    yAxisTitle.setAttribute("text-anchor", "middle");
    yAxisTitle.setAttribute("transform", "rotate(-90 14 120)");
    yAxisTitle.textContent = model.yAxisLabel;
    svg.appendChild(yAxisTitle);

    tickModel.ticks.forEach(function (tickRecord) {
      var y = yForValue(tickRecord.value);
      var gridLine = createSvgElement("line", "siq-trend-grid");
      var tick = createSvgElement("text", "siq-trend-axis-label");
      gridLine.setAttribute("x1", String(plotLeft));
      gridLine.setAttribute("x2", String(plotRight));
      gridLine.setAttribute("y1", String(y));
      gridLine.setAttribute("y2", String(y));
      tick.setAttribute("x", String(plotLeft - 8));
      tick.setAttribute("y", String(y + 3));
      tick.setAttribute("text-anchor", "end");
      tick.textContent = tickRecord.label;
      svg.append(gridLine, tick);
    });

    model.points.forEach(function (point, index) {
      var label = createSvgElement("text", "siq-trend-axis-label");
      label.setAttribute("x", String(xForIndex(index)));
      label.setAttribute("y", "240");
      label.setAttribute("text-anchor", "middle");
      label.textContent = point.label;
      svg.appendChild(label);
    });

    var facilityPath = createSvgElement("path", "siq-trend-line siq-trend-line--facility");
    facilityPath.setAttribute("d", trendPath(model.points, "facilityAverage", xForIndex, yForValue));
    svg.appendChild(facilityPath);
    var unitPath = createSvgElement("path", "siq-trend-line siq-trend-line--unit");
    unitPath.setAttribute("d", trendPath(model.points, "value", xForIndex, yForValue));
    svg.appendChild(unitPath);

    model.points.forEach(function (point, index) {
      if (point.value === null) {
        var gap = createSvgElement("text", "siq-trend-gap");
        gap.setAttribute("x", String(xForIndex(index)));
        gap.setAttribute("y", String((plotTop + plotBottom) / 2));
        gap.setAttribute("text-anchor", "middle");
        gap.textContent = "No data";
        svg.appendChild(gap);
        return;
      }
      var marker = createSvgElement("circle", "siq-trend-point");
      var pointTitle = createSvgElement("title");
      marker.setAttribute("cx", String(xForIndex(index)));
      marker.setAttribute("cy", String(yForValue(point.value)));
      marker.setAttribute("r", "4");
      pointTitle.textContent = point.label + " " + model.label + ": "
        + performanceApi.formatTrendValue(model.key, point.value, tickModel.precision)
        + (point.facilityAverage === null
          ? ""
          : "; facility " + performanceApi.formatTrendValue(
            model.key,
            point.facilityAverage,
            tickModel.precision
          ));
      marker.appendChild(pointTitle);
      svg.appendChild(marker);
    });

    var unitLegend = createSvgElement("text", "siq-trend-legend siq-trend-legend--unit");
    var facilityLegend = createSvgElement("text", "siq-trend-legend");
    unitLegend.setAttribute("x", "590");
    unitLegend.setAttribute("y", "16");
    unitLegend.textContent = "Unit";
    facilityLegend.setAttribute("x", "682");
    facilityLegend.setAttribute("y", "16");
    facilityLegend.textContent = "Facility";
    svg.append(unitLegend, facilityLegend);
    chart.replaceChildren(svg);
    summary.textContent = model.summary + " " + model.footer;
  }

  function capabilityGroup(label, items, kind) {
    var group = createEl("div", "siq-capability-group siq-capability-group--" + kind);
    var values = createEl("div", "siq-capability-group__values");
    group.appendChild(createEl("span", "siq-capability-group__label", label));
    items.forEach(function (item) {
      values.appendChild(createEl("span", "siq-capability-chip", item));
    });
    group.appendChild(values);
    return group;
  }

  function renderCapabilitySummary(unit) {
    var container = byId("siq-performance-detail-availability");
    var model = performanceApi.capabilitySummaryModel(unit);
    container.setAttribute("aria-label", model.summary);
    container.replaceChildren(capabilityGroup("Available", model.available, "available"));
    if (model.hardwareUnavailable.length) {
      container.appendChild(capabilityGroup(
        "Hardware Capability Unavailable",
        model.hardwareUnavailable,
        "unavailable"
      ));
    }
    if (model.policyNotConfigured.length) {
      container.appendChild(capabilityGroup(
        "Policy Not Configured",
        model.policyNotConfigured,
        "policy"
      ));
    }
  }

  function renderPerformanceDetail(unit) {
    if (!unit) {
      return;
    }
    var facility = currentFacility();
    byId("siq-performance-detail-title").textContent = unit.displayLabel || unit.name;
    byId("siq-performance-detail-scope").textContent =
      unit.roleLabel + " · " + unit.statusLabel + " · "
      + (facility ? facility.displayName : "No facility") + " · "
      + getDateRange(appliedScope.dateRange).label
      + (facilityHasShiftSchedule(facility)
        ? " · " + getShift(appliedScope.shift).label : "");
    renderCapabilitySummary(unit);
    renderPerformanceDonut(unit);
    renderUnitFacilityComparison(unit);
    renderPerformanceObservations(unit);
    renderPerformanceTrend(unit);
  }

  function clearPerformanceDetail(message) {
    selectedPerformanceUnitId = null;
    byId("siq-performance-detail-title").textContent = "Select a unit";
    byId("siq-performance-detail-scope").textContent = message || "No authorized assets";
    byId("siq-performance-detail-availability").replaceChildren();
    byId("siq-performance-donut-chart").replaceChildren();
    byId("siq-performance-donut-legend").replaceChildren();
    byId("siq-performance-donut-summary").textContent = "";
    byId("siq-unit-facility-comparison").replaceChildren();
    byId("siq-performance-observations").replaceChildren();
    byId("siq-performance-trend-chart").replaceChildren(
      createEl("p", "siq-empty-detail", message || "No authorized assets")
    );
    byId("siq-performance-trend-summary").textContent = "";
    updatePerformanceSelection();
  }

  function selectPerformanceUnit(unitId) {
    var unit = findHistoricallyAuthorizedUnit(unitId);
    if (!unit) {
      clearPerformanceDetail(historicalIssueText());
      return false;
    }
    selectedPerformanceUnitId = unitId;
    updatePerformanceSelection();
    renderPerformanceDetail(unit);
    return true;
  }

  function scopeLabel(scope) {
    return getDateRange(scope.dateRange).label
      + (facilityHasShiftSchedule(currentFacility())
        ? " / " + getShift(scope.shift).label : "");
  }

  function facilityScopeLabel() {
    var customer = currentCustomer();
    var facility = currentFacility();
    return (customer ? customer.displayName : "No customer selected") + " / " + (facility ? facility.displayName : "No facility selected");
  }

  function shiftDetail(shiftValue) {
    if (!facilityHasShiftSchedule(currentFacility())) {
      return "Preset reporting window active";
    }
    var shift = getShift(shiftValue);
    if (shift.overnight) {
      return shift.hours + " / Crosses midnight / Belongs to start date";
    }
    if (shift.value === "all-activity") {
      return "No shift filtering within the selected period";
    }
    if (shift.value === "all-defined") {
      return "Uses each configured fixture shift occurrence in the period";
    }
    return shift.hours + " / Filters activity within the selected period";
  }

  function toggleCustomRange(prefix) {
    var select = byId("siq-" + prefix + "-date-range");
    var custom = byId("siq-" + prefix + "-custom-range");
    custom.hidden = select.value !== "custom";
  }

  function readPerformanceScope() {
    return {
      dateRange: byId("siq-performance-date-range").value,
      shift: byId("siq-performance-shift").value,
      compare: byId("siq-performance-compare").value,
      startDate: byId("siq-performance-start-date").value,
      startTime: byId("siq-performance-start-time").value,
      endDate: byId("siq-performance-end-date").value,
      endTime: byId("siq-performance-end-time").value
    };
  }

  function setScopeControls(prefix, scope) {
    byId("siq-" + prefix + "-date-range").value = scope.dateRange;
    byId("siq-" + prefix + "-shift").value = scope.shift;
    byId("siq-" + prefix + "-start-date").value = scope.startDate;
    byId("siq-" + prefix + "-start-time").value = scope.startTime;
    byId("siq-" + prefix + "-end-date").value = scope.endDate;
    byId("siq-" + prefix + "-end-time").value = scope.endTime;
    toggleCustomRange(prefix);
    byId("siq-" + prefix + "-shift-detail").textContent = shiftDetail(scope.shift);
  }

  function updateAppliedScopeLabels() {
    var label = scopeLabel(appliedScope);
    var shift = getShift(appliedScope.shift);
    var summaryBand = byId("siq-performance-summary-band");

    summaryBand.hidden = !activeScope.ok;
    if (!activeScope.ok) {
      byId("siq-performance-scope-label").textContent = scopeIssueText();
      byId("siq-unit-ranking-context").textContent = scopeIssueText();
      byId("siq-shift-summary-title").textContent = "Facility Performance Summary";
      return;
    }

    byId("siq-performance-scope-label").textContent = facilityScopeLabel() + " / " + label;
    byId("siq-shift-summary-title").textContent = "Facility Performance Summary";
    updatePerformanceSortHeaders();
    buildSummaryBand();
    if (selectedPerformanceUnitId) {
      renderPerformanceDetail(findAuthorizedUnit(selectedPerformanceUnitId));
    }
  }

  function applyPerformanceScope(event) {
    event.preventDefault();
    appliedScope = readPerformanceScope();
    refreshHistoricalScope();
    setScopeControls("report", appliedScope);
    byId("siq-report-comparison").value = appliedScope.compare;
    updateAppliedScopeLabels();
    updateReportPreview();
    byId("siq-performance-status").textContent = historicalScope.ok
      ? "Assignment-windowed fixture scope applied."
      : historicalIssueText();
  }

  function resetPerformanceScope(event) {
    event.preventDefault();
    appliedScope = copyScope(fixture.scope);
    refreshHistoricalScope();
    syncShiftControlsForFacility();
    setScopeControls("performance", appliedScope);
    byId("siq-performance-compare").value = appliedScope.compare;
    setScopeControls("report", appliedScope);
    byId("siq-report-comparison").value = appliedScope.compare;
    updateAppliedScopeLabels();
    updateReportPreview();
    byId("siq-performance-status").textContent = "Fixture scope reset.";
  }

  function renderReportSelector() {
    populateSelect(
      byId("siq-report-selector"),
      fixture.reports.map(function (report) {
        return { value: report.id, label: report.name };
      }),
      selectedReportId
    );
  }

  function renderFormatChoices(report) {
    var select = byId("siq-report-format");
    var currentValue = select.value;
    var selectedValue = report.formats.indexOf(currentValue) !== -1
      ? currentValue : report.formats[0];
    populateSelect(
      select,
      report.formats.map(function (format) {
        return { value: format, label: format };
      }),
      selectedValue
    );
    select.disabled = !activeScope.ok;
  }

  function setReportStatus(message) {
    var status = byId("siq-report-status");
    status.textContent = message || "";
    status.hidden = !message;
  }

  function formatTimestamp(value) {
    var instant = Date.parse(value);
    if (!Number.isFinite(instant)) {
      return "--";
    }
    return new Date(instant).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short"
    });
  }

  function reportAvailability(report) {
    var facility = currentFacility();
    if (report.requiresShift && !facilityHasShiftSchedule(facility)) {
      return {
        available: false,
        message: "Shift-based report unavailable — a shift schedule is required."
      };
    }
    return {
      available: true,
      message: report.speedCompliance && !facilityHasSpeedPolicy(facility)
        ? "Speed Policy Not Configured — speed-compliance fields are unavailable for this period."
        : ""
    };
  }

  function selectReport(reportId) {
    selectedReportId = reportId;
    var report = getReport(reportId);
    byId("siq-report-selector").value = report.id;
    byId("siq-report-description").textContent = report.description;
    renderFormatChoices(report);
    byId("siq-report-comparison-wrap").hidden = !report.comparison;
    byId("siq-preview-comparison-row").hidden = !report.comparison;
    var availability = reportAvailability(report);
    setReportStatus(historicalScope && historicalScope.ok
      ? availability.message : historicalIssueText());
    byId("siq-generate-report").disabled = !historicalScope || !historicalScope.ok
      || !availability.available;
    updateReportPreview();
  }

  function renderUnitChoices() {
    var fieldset = byId("siq-report-unit-choices");
    fieldset.replaceChildren(createEl("legend", "", "Selected fixture units"));
    if (!historicalUnits.length) {
      fieldset.appendChild(createEl("span", "siq-choice-note", historicalIssueText()));
      return;
    }
    historicalUnits.forEach(function (unit) {
      var label = createEl("label", "");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "authorizedUnit";
      checkbox.value = unit.id;
      checkbox.checked = true;
      checkbox.disabled = !historicalScope || !historicalScope.ok;
      checkbox.addEventListener("change", updateReportPreview);
      label.append(checkbox, document.createTextNode(" " + unit.name));
      fieldset.appendChild(label);
    });
  }

  function selectedReportUnitIds() {
    var mode = byId("siq-report-unit-mode").value;
    var requestedIds;
    if (mode === "all") {
      requestedIds = historicalScope && historicalScope.ok
        ? historicalScope.deviceIds.slice() : [];
    } else {
      requestedIds = Array.from(appRoot.querySelectorAll('input[name="authorizedUnit"]:checked')).map(function (checkbox) {
        return checkbox.value;
      });
    }
    return authorization.intersectReportUnitIds(historicalScope, requestedIds);
  }

  function selectedReportUnits() {
    var ids = selectedReportUnitIds();
    return ids.map(function (deviceId) {
      return findHistoricallyAuthorizedUnit(deviceId);
    }).filter(Boolean).map(function (unit) {
      return unit.name;
    });
  }

  function reportScopeValues() {
    var dateRangeValue = byId("siq-report-date-range").value;
    var range = getDateRange(dateRangeValue);
    var shift = getShift(byId("siq-report-shift").value);
    var isCustom = dateRangeValue === "custom";
    return {
      range: range,
      shift: shift,
      start: isCustom
        ? byId("siq-report-start-date").value + " " + byId("siq-report-start-time").value
        : range.start,
      end: isCustom
        ? byId("siq-report-end-date").value + " " + byId("siq-report-end-time").value
        : range.end,
      units: selectedReportUnits(),
      format: byId("siq-report-format").value || "--",
      comparison: getComparison(byId("siq-report-comparison").value).label
    };
  }

  function updateReportPreview() {
    var values = reportScopeValues();
    var report = getReport(selectedReportId);
    var customer = activeScope.ok ? activeScope.customer : null;
    var facility = activeScope.ok ? activeScope.facility : null;
    byId("siq-preview-customer").textContent = customer ? customer.displayName : "--";
    byId("siq-preview-facility").textContent = facility ? facility.displayName : "--";
    byId("siq-preview-timezone").textContent = currentTimezone();
    byId("siq-preview-start").textContent = activeScope.ok ? values.start || "--" : "--";
    byId("siq-preview-end").textContent = activeScope.ok ? values.end || "--" : "--";
    var shiftConfigured = facilityHasShiftSchedule(facility);
    byId("siq-preview-shift-hours").textContent = activeScope.ok
      ? (shiftConfigured ? values.shift.hours : "Selected reporting window")
      : "--";
    byId("siq-preview-overnight").textContent = activeScope.ok
      ? (shiftConfigured && values.shift.overnight
        ? "Yes - belongs to the date it starts" : "No")
      : "--";
    byId("siq-preview-units").textContent = values.units.length ? values.units.join(", ") : "No authorized assets";
    byId("siq-preview-format").textContent = values.format;
    byId("siq-preview-comparison").textContent = activeScope.ok ? values.comparison : "--";
    byId("siq-report-scope-summary").textContent = [
      customer ? customer.displayName : "No customer selected",
      facility ? facility.displayName : "No facility selected",
      activeScope.ok ? values.range.label : "--",
      activeScope.ok
        ? (shiftConfigured ? values.shift.label : "Date Range")
        : "--",
      values.units.length + " Authorized "
        + (values.units.length === 1 ? "Unit" : "Units"),
      currentTimezone()
    ].join(" \u00b7 ");
    renderReportPreview(report);
  }

  function renderReportPreview(report) {
    var container = byId("siq-report-preview");
    container.replaceChildren();
    if (!historicalScope || !historicalScope.ok) {
      container.appendChild(emptyState(
        "Historical reporting unavailable",
        historicalIssueText()
      ));
      return;
    }
    var availability = reportAvailability(report);
    if (!availability.available) {
      container.appendChild(emptyState(
        "Shift-based report unavailable",
        "A shift schedule is required. Date-range reports remain available."
      ));
      return;
    }
    if (availability.message) {
      container.appendChild(createEl(
        "p",
        "siq-summary-notice",
        availability.message
      ));
    }
    if (report.id !== "monthly-usage-summary") {
      var placeholderHeading = createEl("div", "siq-report-preview-heading");
      placeholderHeading.append(
        createEl("span", "siq-context-label", "Report preview"),
        createEl("h2", "siq-section-title", report.name),
        createEl("p", "siq-screen-note", report.description)
      );
      var placeholder = createEl("div", "siq-report-placeholder");
      placeholder.append(
        createEl("strong", "", report.name + " preview"),
        createEl(
          "span",
          "",
          "Fixture calculations for this report are not active yet."
        )
      );
      container.append(placeholderHeading, placeholder);
      return;
    }
    if (!window.SIQ_USAGE_BILLING || !fixture.monthlyUsageFixture) {
      container.appendChild(createEl("p", "siq-screen-note",
        "Monthly usage preview is unavailable."));
      return;
    }
    var scopedUsageFixture = selectors.scopedMonthlyUsageFixture(
      fixture.monthlyUsageFixture,
      historicalScope,
      selectedReportUnitIds()
    );
    var summary = window.SIQ_USAGE_BILLING.summarize(scopedUsageFixture);
    var isInternal = currentUser()
      && currentUser().role === "Fleetsource Administrator";
    var statement = window.SIQ_USAGE_BILLING.customerStatement(summary, {
      showRates: isInternal
    });
    var heading = createEl("div", "siq-report-preview-heading");
    heading.append(
      createEl("span", "siq-context-label", "Report preview"),
      createEl("h2", "siq-section-title", "Customer Usage Statement Preview"),
      createEl(
        "p",
        "siq-screen-note",
        "Monthly Usage Summary for the selected fixture scope."
      )
    );
    container.appendChild(heading);

    var scroll = createEl("div", "siq-monthly-usage-scroll");
    var table = createEl(
      "div",
      "siq-monthly-usage-table"
        + (isInternal ? " siq-monthly-usage-table--internal" : "")
    );
    table.setAttribute("role", "table");
    table.setAttribute("aria-label", "Customer Usage Statement");
    var header = createEl("div", "siq-monthly-usage-row siq-monthly-usage-row--head");
    header.setAttribute("role", "row");
    var columns = [
      "Unit",
      "Role",
      "Lease Start",
      "Beginning Hours",
      "Ending Hours",
      "Gross Usage",
      "Adjustments",
      "Billable Hours",
      "Exceptions"
    ];
    if (isInternal) {
      columns.push("Rate Code", "Rate", "Calculated Charge");
    }
    columns.forEach(function (label, index) {
      var cell = createEl(
        "strong",
        index >= 3 && index <= 7 ? "siq-usage-number" : "",
        label
      );
      cell.setAttribute("role", "columnheader");
      header.appendChild(cell);
    });
    table.appendChild(header);

    function formatHours(value, unavailableLabel) {
      return value === null || value === undefined
        ? unavailableLabel : Number(value).toFixed(1) + " hr";
    }

    function formatAdjustment(value) {
      var amount = Number(value) || 0;
      if (amount < 0) {
        return amount.toFixed(1) + " hr (reduces gross usage)";
      }
      if (amount > 0) {
        return "+" + amount.toFixed(1) + " hr (adds to gross usage)";
      }
      return "0.0 hr";
    }

    statement.rows.forEach(function (row, rowIndex) {
      var sourceRow = summary.rows[rowIndex];
      var line = createEl("div", "siq-monthly-usage-row");
      line.setAttribute("role", "row");
      var values = [
        {
          className: "siq-usage-unit",
          value: row.customerUnitNumber
            ? row.customerUnitNumber + " / " + row.fleetsourceUnitNumber
            : row.fleetsourceUnitNumber
        },
        {
          className: "siq-usage-role",
          value: window.SIQ_ASSET_IDENTITY
            && window.SIQ_ASSET_IDENTITY.ASSET_ROLES[row.assetRole]
            ? window.SIQ_ASSET_IDENTITY.ASSET_ROLES[row.assetRole]
            : row.assetRole.replace(/_/g, " ")
        },
        {
          className: "",
          value: sourceRow && sourceRow.leaseStart
            ? sourceRow.leaseStart.slice(0, 10) : "--"
        },
        {
          className: "siq-usage-number",
          value: formatHours(row.beginningEngineHours, "Exception")
        },
        {
          className: "siq-usage-number",
          value: formatHours(row.endingEngineHours, "Exception")
        },
        {
          className: "siq-usage-number",
          value: formatHours(row.grossEngineHourUsage, "--")
        },
        {
          className: "siq-usage-number siq-usage-adjustment",
          value: formatAdjustment(row.adjustments)
        },
        {
          className: "siq-usage-number",
          value: formatHours(row.finalBillableHours, "Review")
        },
        {
          className: "siq-usage-exceptions",
          value: row.notes.length ? row.notes.join("; ") : "None"
        }
      ];
      if (isInternal) {
        values.push(
          { className: "", value: row.rateCode || "--" },
          {
            className: "siq-usage-number",
            value: Number.isFinite(row.hourlyRate)
              ? "$" + row.hourlyRate.toFixed(2) + " / hr" : "--"
          },
          {
            className: "siq-usage-number",
            value: Number.isFinite(row.calculatedCharge)
              ? "$" + row.calculatedCharge.toFixed(2) : "--"
          }
        );
      }
      values.forEach(function (item) {
        var cell = createEl("span", item.className, item.value);
        cell.setAttribute("role", "cell");
        line.appendChild(cell);
      });
      table.appendChild(line);
    });

    var totalValues = [
      "Totals",
      summary.totals.assetCount + " units",
      "",
      "",
      "",
      summary.totals.totalGrossHours.toFixed(1) + " hr",
      formatAdjustment(summary.totals.totalAdjustments),
      summary.totals.totalBillableHours.toFixed(1) + " hr",
      summary.totals.exceptionCount + " units with exceptions"
    ];
    if (isInternal) {
      var hasCalculatedCharges = statement.rows.some(function (row) {
        return Number.isFinite(row.calculatedCharge);
      });
      totalValues.push(
        "",
        "",
        hasCalculatedCharges
          ? "$" + summary.totals.totalCalculatedCharges.toFixed(2) : "--"
      );
    }
    var totals = createEl(
      "div",
      "siq-monthly-usage-row siq-monthly-usage-row--totals"
    );
    totals.setAttribute("role", "row");
    totalValues.forEach(function (value, index) {
      var cell = createEl(
        "strong",
        index >= 3 && index <= 7 ? "siq-usage-number" : "",
        value
      );
      cell.setAttribute("role", "cell");
      totals.appendChild(cell);
    });
    table.appendChild(totals);
    scroll.appendChild(table);
    container.appendChild(scroll);
    container.appendChild(createEl(
      "p",
      "siq-screen-note siq-usage-access-note",
      isInternal
        ? "Internal fixture access: rate columns are visible when configured."
        : "Rates and charges are hidden for this customer fixture role."
    ));
  }

  function toggleReportUnitChoices() {
    var selectedMode = byId("siq-report-unit-mode").value;
    byId("siq-report-unit-choices").hidden = selectedMode !== "selected";
    updateReportPreview();
  }

  function showModule(moduleName) {
    var user = currentUser();
    var requestedModule = moduleName === "settings" && !selectors.canShowSettings(user) ? "operations" : moduleName;
    appRoot.querySelectorAll("[data-module-panel]").forEach(function (panel) {
      panel.classList.toggle("siq-module--active", panel.getAttribute("data-module-panel") === requestedModule);
    });
    appRoot.querySelectorAll("[data-module]").forEach(function (button) {
      var isActive = button.getAttribute("data-module") === requestedModule;
      button.classList.toggle("siq-nav-button--active", isActive);
      if (isActive) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });
  }

  function toggleTheme() {
    var toggle = byId("siq-theme-toggle");
    var label = byId("siq-theme-label");
    var nextTheme = appRoot.getAttribute("data-theme") === "dark" ? "light" : "dark";
    var isLight = nextTheme === "light";
    appRoot.setAttribute("data-theme", nextTheme);
    toggle.setAttribute("aria-pressed", String(isLight));
    toggle.setAttribute("aria-label", isLight ? "Switch to dark theme" : "Switch to light theme");
    label.textContent = isLight ? "Light" : "Dark";
  }

  function initializeControls() {
    ["performance", "report"].forEach(function (prefix) {
      populateSelect(byId("siq-" + prefix + "-date-range"), fixture.dateRanges, appliedScope.dateRange);
      populateSelect(byId("siq-" + prefix + "-shift"), fixture.shifts, appliedScope.shift);
    });
    populateSelect(byId("siq-performance-compare"), fixture.comparisons, appliedScope.compare);
    populateSelect(byId("siq-report-comparison"), fixture.comparisons, appliedScope.compare);
    setScopeControls("performance", appliedScope);
    setScopeControls("report", appliedScope);
  }

  function syncShiftControlsForFacility() {
    var state = selectors.shiftControlState(
      currentFacility(),
      fixture.shifts,
      appliedScope.shift
    );
    appliedScope.shift = state.value;
    ["performance", "report"].forEach(function (prefix) {
      populateSelect(
        byId("siq-" + prefix + "-shift"),
        state.options,
        state.value
      );
    });
  }

  function setDisabledForScope() {
    var blocked = !activeScope.ok;
    var historicalBlocked = !historicalScope || !historicalScope.ok;
    byId("siq-simulate-button").disabled = blocked;
    byId("siq-performance-export").disabled = historicalBlocked;
    byId("siq-generate-report").disabled = historicalBlocked;
    appRoot.querySelectorAll("[data-board-filter]").forEach(function (button) {
      button.disabled = blocked;
    });
    byId("siq-report-form").querySelectorAll("input, select").forEach(function (control) {
      control.disabled = historicalBlocked;
    });
    if (!historicalBlocked) {
      byId("siq-report-form").querySelectorAll("input, select").forEach(function (control) {
        control.disabled = false;
      });
      renderFormatChoices(getReport(selectedReportId));
      renderUnitChoices();
    }
    var shiftConfigured = activeScope.ok
      && facilityHasShiftSchedule(currentFacility());
    byId("siq-performance-shift").disabled = !shiftConfigured;
    byId("siq-report-shift").disabled = !shiftConfigured;
    byId("siq-performance-shift-detail").textContent = shiftConfigured
      ? shiftDetail(appliedScope.shift) : "Use a date range or preset window";
    byId("siq-report-shift-detail").textContent = shiftConfigured
      ? shiftDetail(appliedScope.shift) : "Date-range reports remain available";
    var availability = reportAvailability(getReport(selectedReportId));
    byId("siq-generate-report").disabled = historicalBlocked
      || !availability.available;
  }

  function populateAuthorizationControls() {
    populateSelect(byId("siq-user-selector"), configuration.users.map(function (user) {
      return {
        value: user.id,
        label: user.displayName
      };
    }), selectedUserId);
    updateScopeSelectors();
  }

  function refreshHistoricalScope() {
    if (!activeScope || !activeScope.ok) {
      historicalScope = {
        ok: false,
        reason: activeScope && activeScope.reason
          || "Historical reporting is not configured for this asset.",
        deviceIds: [],
        units: [],
        entitlements: []
      };
      historicalUnits = [];
      return;
    }
    var startUtc = appliedScope.startDate + "T" + appliedScope.startTime + ":00Z";
    var endUtc = appliedScope.endDate + "T" + appliedScope.endTime + ":00Z";
    historicalScope = authorization.getHistoricalAssetScope(configuration, {
      userId: selectedUserId,
      customerId: selectedCustomerId,
      facilityId: selectedFacilityId,
      startUtc: startUtc,
      endUtc: endUtc
    });
    historicalUnits = historicalScope.ok ? historicalScope.units : [];
    applyFacilityFeatureState(historicalUnits, activeScope.facility);
  }

  function updateScopeSelectors() {
    var user = currentUser();
    var authorizedFacilities = authorization.authorizedFacilitiesForUser(configuration, user);
    var customerWrap = byId("siq-customer-selector-wrap");
    var facilityWrap = byId("siq-facility-selector-wrap");
    var previewFacilityWrap = byId("siq-preview-facility-wrap");
    var previewFacilityName = byId("siq-preview-facility-name");
    var customerSelect = byId("siq-customer-selector");
    var facilitySelect = byId("siq-facility-selector");
    var isAdmin = authorization.isFleetsourceAdministrator(user);
    var isViewer = Boolean(user && user.role === "Customer Viewer");
    var facilityOptions = [];

    customerWrap.hidden = !isAdmin;
    if (isAdmin) {
      populateSelect(customerSelect, [{ value: "", label: "Select customer" }].concat(selectors.labelOptions(selectors.authorizedCustomersForUser(configuration, user))), selectedCustomerId);
    }

    facilityWrap.hidden = isAdmin
      ? false
      : !selectors.shouldShowFacilitySelector(user, authorizedFacilities, selectedCustomerId);
    if (isAdmin) {
      facilityOptions = selectedCustomerId
        ? selectors.facilitiesForCustomer(configuration, user, selectedCustomerId)
        : [];
      populateSelect(facilitySelect, [{ value: "", label: "Select facility" }].concat(selectors.labelOptions(facilityOptions)), selectedFacilityId);
      facilitySelect.disabled = !selectedCustomerId || !facilityOptions.length;
      facilitySelect.setAttribute("aria-disabled", String(facilitySelect.disabled));
    } else if (!facilityWrap.hidden) {
      populateSelect(facilitySelect, selectors.labelOptions(authorizedFacilities), selectedFacilityId);
      facilitySelect.disabled = false;
      facilitySelect.setAttribute("aria-disabled", "false");
    }

    previewFacilityWrap.hidden = !(isViewer && authorizedFacilities.length === 1);
    previewFacilityName.textContent = previewFacilityWrap.hidden ? "" : authorizedFacilities[0].displayName;
  }

  function updateShellContext() {
    var user = currentUser();
    var validScope = Boolean(activeScope && activeScope.ok);
    var customer = validScope ? activeScope.customer : null;
    var facility = validScope ? activeScope.facility : null;
    var shift = getShift(appliedScope.shift);
    var brandContext = byId("siq-brand-context");
    var facilityContext = byId("siq-facility-context-bar");
    var facilityContextError = byId("siq-facility-context-error");

    brandContext.hidden = !validScope;
    facilityContext.hidden = !validScope;
    facilityContextError.hidden = validScope;
    facilityContextError.textContent = validScope ? "" : scopeIssueText();

    byId("siq-brand-customer-name").textContent = customer ? customer.displayName : "";
    byId("siq-brand-facility-name").textContent = facility ? facility.displayName : "";
    byId("siq-customer-name").textContent = customer ? customer.displayName : "";
    byId("siq-facility-name").textContent = facility ? facility.displayName : "";
    var shiftConfigured = validScope && facilityHasShiftSchedule(facility);
    byId("siq-shift-label").textContent = validScope
      ? (shiftConfigured ? shift.label : "Selected Window")
      : "";
    byId("siq-shift-range").textContent = validScope
      ? (shiftConfigured ? shift.hours : "Date-range analysis available")
      : "";
    byId("siq-context-timezone").textContent = validScope ? facility.timezone : "";
    byId("siq-authorized-unit-count").textContent = validScope ? String(authorizedUnits.length) : "";
    byId("siq-kpi-strip").hidden = !validScope;
    byId("siq-data-age").textContent = validScope ? fixture.freshness.age : "Data age --";
    byId("siq-last-checked").textContent = validScope ? fixture.freshness.checked : scopeIssueText();
    byId("siq-latest-fleet-data").textContent = validScope
      ? "Latest Fleet Data 14:16"
      : "Latest Fleet Data --";
    byId("siq-performance-timezone").textContent = validScope ? facility.timezone : "--";
    byId("siq-settings-button").hidden = !selectors.canShowSettings(user);
    byId("siq-performance-status").classList.toggle("siq-status-message--blocked", !validScope);
    byId("siq-report-status").classList.toggle("siq-status-message--blocked", !validScope);
  }

  function refreshAuthorizedScope() {
    activeScope = authorization.getEffectiveAssetScope(configuration, {
      userId: selectedUserId,
      customerId: selectedCustomerId,
      facilityId: selectedFacilityId
    });
    authorizedUnits = activeScope.ok ? activeScope.units : [];
    applyFacilityFeatureState(authorizedUnits, activeScope.facility);
    refreshHistoricalScope();
    syncShiftControlsForFacility();

    if (!isLiveMode && !authorization.isDeviceAuthorized(activeScope, selectedUnitId)) {
      selectedUnitId = null;
      closeOperationsDrawer(scopeIssueText() || "Choose a row to inspect fixture state and move activity.");
    }
    if (!authorization.isDeviceAuthorized(historicalScope, selectedPerformanceUnitId)) {
      selectedPerformanceUnitId = null;
    }

    updateScopeSelectors();
    updateShellContext();
    if (!isLiveMode) {
      updateKpis();
      renderBoard();
    }
    buildSummaryBand();
    renderPerformanceRanking();
    renderUnitChoices();
    setDisabledForScope();
    updateAppliedScopeLabels();
    updateReportPreview();

    if (activeScope.ok && authorizedUnits.length) {
      if (!isLiveMode && !selectedUnitId) {
        selectUnit(authorizedUnits[0].id);
      }
      if (!selectedPerformanceUnitId && historicalUnits.length) {
        selectPerformanceUnit(historicalUnits[0].id);
      }
      byId("siq-performance-status").textContent = "";
      setReportStatus(reportAvailability(
        getReport(selectedReportId)
      ).message);
    } else {
      clearPerformanceDetail(scopeIssueText());
      byId("siq-performance-status").textContent = scopeIssueText();
      setReportStatus(scopeIssueText());
    }
  }

  function wireEvents() {
    appRoot.querySelectorAll("[data-module]").forEach(function (button) {
      button.addEventListener("click", function () {
        showModule(button.getAttribute("data-module"));
      });
    });
    if (!isLiveMode) {
      appRoot.querySelectorAll("[data-board-filter]").forEach(function (button) {
        button.addEventListener("click", function () {
          activeBoardFilter = button.getAttribute("data-board-filter");
          appRoot.querySelectorAll("[data-board-filter]").forEach(function (filterButton) {
            var isActive = filterButton === button;
            filterButton.classList.toggle("siq-filter-button--active", isActive);
            filterButton.setAttribute("aria-pressed", String(isActive));
          });
          applyBoardFilter();
        });
      });
    }

    byId("siq-user-selector").addEventListener("change", function () {
      selectedUserId = this.value;
      var selection = selectors.initialSelectionForUser(configuration, currentUser());
      selectedCustomerId = selection.customerId;
      selectedFacilityId = selection.facilityId;
      showModule("operations");
      refreshAuthorizedScope();
    });
    byId("siq-customer-selector").addEventListener("change", function () {
      selectedCustomerId = this.value;
      selectedFacilityId = "";
      selectedUnitId = null;
      selectedPerformanceUnitId = null;
      byId("siq-facility-selector").disabled = true;
      populateSelect(byId("siq-facility-selector"), [{ value: "", label: "Select facility" }], "");
      refreshAuthorizedScope();
    });
    byId("siq-facility-selector").addEventListener("change", function () {
      selectedFacilityId = this.value;
      refreshAuthorizedScope();
    });
    byId("siq-theme-toggle").addEventListener("click", toggleTheme);
    if (!isLiveMode) {
      byId("siq-simulate-button").addEventListener("click", simulateTelemetry);
      byId("siq-refresh-button").addEventListener("click", function () {
        byId("siq-data-age").textContent = activeScope.ok ? fixture.freshness.age : "Data age --";
        byId("siq-last-checked").textContent = activeScope.ok ? fixture.freshness.checked : scopeIssueText();
      });
      byId("siq-drawer-close").addEventListener("click", function () {
        closeOperationsDrawer();
      });
    }

    byId("siq-performance-date-range").addEventListener("change", function () {
      toggleCustomRange("performance");
    });
    byId("siq-performance-shift").addEventListener("change", function () {
      byId("siq-performance-shift-detail").textContent = shiftDetail(this.value);
    });
    byId("siq-performance-scope-form").addEventListener("submit", applyPerformanceScope);
    byId("siq-performance-scope-form").addEventListener("reset", resetPerformanceScope);
    byId("siq-performance-export").addEventListener("click", function () {
      byId("siq-performance-status").textContent = "Performance export is deferred in this visual foundation.";
    });
    appRoot.querySelectorAll("[data-performance-sort]").forEach(function (button) {
      button.addEventListener("click", function () {
        changePerformanceSort(button.getAttribute("data-performance-sort"));
      });
    });
    byId("siq-performance-trend-metric").addEventListener("change", function () {
      performanceTrendMetric = this.value;
      var unit = findAuthorizedUnit(selectedPerformanceUnitId);
      if (unit) {
        renderPerformanceTrend(unit);
      }
    });

    byId("siq-report-selector").addEventListener("change", function () {
      selectReport(this.value);
    });
    byId("siq-report-date-range").addEventListener("change", function () {
      toggleCustomRange("report");
      updateReportPreview();
    });
    byId("siq-report-shift").addEventListener("change", function () {
      byId("siq-report-shift-detail").textContent = shiftDetail(this.value);
      updateReportPreview();
    });
    byId("siq-report-format").addEventListener("change", updateReportPreview);
    byId("siq-report-comparison").addEventListener("change", updateReportPreview);
    byId("siq-report-form").addEventListener("input", updateReportPreview);
    byId("siq-report-unit-mode").addEventListener(
      "change",
      toggleReportUnitChoices
    );
    byId("siq-generate-report").addEventListener("click", function () {
      var availability = reportAvailability(getReport(selectedReportId));
      if (!availability.available) {
        setReportStatus(availability.message);
        return;
      }
      setReportStatus(selectedReportId === "monthly-usage-summary"
        ? "Fixture preview refreshed. Production persistence and downloads remain deferred."
        : "Report generation is deferred in this visual foundation.");
      updateReportPreview();
    });
  }

  function initializeContext() {
    var selection = selectors.initialSelectionForUser(configuration, currentUser());
    selectedCustomerId = selection.customerId;
    selectedFacilityId = selection.facilityId;
  }

  var shellInitialized = false;

  function initialize() {
    if (shellInitialized) {
      return;
    }
    shellInitialized = true;
    initializeContext();
    initializeControls();
    populateAuthorizationControls();
    renderReportSelector();
    wireEvents();
    refreshAuthorizedScope();
    selectReport(selectedReportId);
    if (isLiveMode) {
      appRoot.querySelector(".siq-fixture-preview").hidden = true;
      byId("siq-simulate-button").hidden = true;
      byId("siq-brand-context").hidden = true;
      byId("siq-facility-context-bar").hidden = true;
      byId("siq-facility-context-error").hidden = false;
      byId("siq-facility-context-error").textContent = "Live facility scope is being resolved.";
      byId("siq-live-label").textContent = "Live data pending";
      byId("siq-data-age").textContent = "Data age --";
      byId("siq-last-checked").textContent = "Last Checked --";
    }
  }

  window.SIQ_APP = {
    initialize: initialize,
    mode: runtimeMode
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
}());
