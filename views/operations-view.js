(function (root, factory) {
  "use strict";

  var selectors = root.SIQ_SELECTORS;
  if (!selectors && typeof require === "function") {
    selectors = require("../core/selectors");
  }
  var api = factory(selectors);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_OPERATIONS_VIEW = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (selectors) {
  "use strict";

  var PATCH_FIELDS = [
    "displayName",
    "nativeDisplayName",
    "operationalState",
    "operationalStateLabel",
    "operationalStateQualifierLabel",
    "completedMoves",
    "stateStartedAt",
    "stateDurationMs",
    "currentSpeedMph",
    "engineRpm",
    "fifthWheelStatus",
    "fifthWheelStatusLabel",
    "trailerStateAt",
    "trailerStateDelayed",
    "trailerStateSupported",
    "ignitionOn",
    "lastCommunicationAt",
    "latestTelemetryAt",
    "communicationCondition",
    "communicationConditionLabel",
    "fuelLevelPercent",
    "fuelLevelAt",
    "defLevelPercent",
    "defLevelAt",
    "engineHours",
    "engineHoursAt",
    "currentDriverDisplayName",
    "driverIdentifiedAt",
    "warningCode",
    "warningMessage",
    "engineHealth"
  ];

  function operationalTelemetryPresentation(model) {
    var value = model || {};
    var ignition = value.ignitionOn === true
      ? "On" : value.ignitionOn === false ? "Off" : "Unavailable";
    var odometer = Number.isFinite(value.odometerMiles)
      ? value.odometerMiles.toFixed(1).replace(/\.0$/, "") + " mi"
      : "Unavailable";
    var fahrenheit = Number.isFinite(value.engineCoolantTemperatureCelsius)
      ? value.engineCoolantTemperatureCelsius * 9 / 5 + 32 : null;
    var coolant = Number.isFinite(fahrenheit)
      ? fahrenheit.toFixed(1).replace(/\.0$/, "") + " °F"
      : "Unavailable";
    return {
      ignition: ignition,
      odometer: odometer,
      coolant: coolant
    };
  }

  function valuesEqual(left, right) {
    if (Array.isArray(left) || Array.isArray(right)) {
      return JSON.stringify(left || []) === JSON.stringify(right || []);
    }
    return Object.is(left, right);
  }

  function operationsSummaryModel(models, facility) {
    var source = Array.isArray(models) ? models : [];
    return {
      moving: source.filter(function (model) {
        return model.operationalState === "MOVING";
      }).length,
      idling: source.filter(function (model) {
        return model.operationalState === "IDLING";
      }).length,
      off: source.filter(function (model) {
        return model.operationalState === "OFF";
      }).length,
      withTrailer: source.filter(function (model) {
        return model.operationalStateQualifierLabel === "w/ Trailer";
      }).length,
      completedMoves: source.reduce(function (total, model) {
        return total + (Number.isFinite(model.completedMoves) ? model.completedMoves : 0);
      }, 0),
      authorizedUnits: source.length,
      dataIssues: source.filter(function (model) {
        return Boolean(model.warningCode);
      }).length
    };
  }

  function createPersistentRowRegistry(callbacks) {
    var rows = new Map();
    var models = new Map();
    var scopeKey = null;
    var order = [];

    function initialize(nextScopeKey, nextModels) {
      var ids = (nextModels || []).map(function (model) {
        return model.deviceId;
      });
      var sameMembership = nextScopeKey === scopeKey
        && ids.length === order.length
        && ids.every(function (id, index) {
          return id === order[index];
        });
      if (sameMembership) {
        patch(nextModels);
        return false;
      }
      rows.clear();
      models.clear();
      scopeKey = nextScopeKey;
      order = ids.slice();
      callbacks.reset();
      nextModels.forEach(function (model) {
        var row = callbacks.create(model);
        rows.set(model.deviceId, row);
        models.set(model.deviceId, Object.assign({}, model));
      });
      callbacks.commit(order.map(function (id) {
        return rows.get(id);
      }));
      return true;
    }

    function patch(nextModels) {
      var mutations = 0;
      (nextModels || []).forEach(function (next) {
        var row = rows.get(next.deviceId);
        var previous = models.get(next.deviceId);
        if (!row || !previous) {
          return;
        }
        PATCH_FIELDS.forEach(function (field) {
          if (!valuesEqual(previous[field], next[field])) {
            callbacks.patch(row, field, next[field], next, previous);
            mutations += 1;
          }
        });
        models.set(next.deviceId, Object.assign({}, next));
      });
      if (typeof callbacks.afterPatch === "function") {
        callbacks.afterPatch(nextModels || [], mutations);
      }
      return mutations;
    }

    return {
      initialize: initialize,
      patch: patch,
      has: function (deviceId) { return rows.has(deviceId); },
      model: function (deviceId) { return models.get(deviceId) || null; },
      models: function () {
        return order.map(function (id) {
          return models.get(id);
        }).filter(Boolean);
      },
      order: function () { return order.slice(); },
      scopeKey: function () { return scopeKey; }
    };
  }

  function createOperationsDomView(document, options) {
    var win = options && options.window
      ? options.window
      : (document.defaultView || {});
    var appRoot = document.querySelector(".siq-app");
    var body = document.getElementById("siq-unit-board-body");
    var selectedDeviceId = null;
    var detailRefs = null;
    var activeFilter = "all";
    var bound = false;
    var controller = null;
    var domRows = new Map();
    var currentFacility = null;
    var currentUserContext = options && options.userContext || null;
    var reportByDevice = new Map();
    var appliedReportWindow = null;
    var clearedScopeSequence = 0;
    var onSelectionChange = options
      && typeof options.onSelectionChange === "function"
      ? options.onSelectionChange : function () {};
    var onCustomerScopeChange = options
      && typeof options.onCustomerScopeChange === "function"
      ? options.onCustomerScopeChange : function () {};
    var onFacilityScopeChange = options
      && typeof options.onFacilityScopeChange === "function"
      ? options.onFacilityScopeChange : function () {};

    function byId(id) {
      return document.getElementById(id);
    }

    function element(tag, className, value) {
      var node = document.createElement(tag);
      if (className) {
        node.className = className;
      }
      if (value !== undefined) {
        node.textContent = value === null ? "--" : String(value);
      }
      return node;
    }

    function formatDuration(milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) {
        return "--";
      }
      var minutes = Math.floor(milliseconds / 60000);
      if (minutes < 60) {
        return minutes + "m";
      }
      var hours = Math.floor(minutes / 60);
      return hours + "h " + (minutes % 60) + "m";
    }

    function formatNumber(value, suffix, decimals) {
      if (!Number.isFinite(value)) {
        return "--";
      }
      return value.toFixed(decimals).replace(/\.0$/, "") + suffix;
    }

    function formatTimestamp(value) {
      if (!value || !Number.isFinite(Date.parse(value))) {
        return "--";
      }
      return new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    function formatRelativeTimestamp(value) {
      var timestamp = Date.parse(value);
      if (!Number.isFinite(timestamp)) {
        return "—";
      }
      var ageSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
      if (ageSeconds < 60) {
        return ageSeconds + "s ago";
      }
      var ageMinutes = Math.floor(ageSeconds / 60);
      if (ageMinutes < 60) {
        return ageMinutes + "m ago";
      }
      var ageHours = Math.floor(ageMinutes / 60);
      return ageHours < 24 ? ageHours + "h ago"
        : Math.floor(ageHours / 24) + "d ago";
    }

    function stateKey(model) {
      return String(model.operationalState || "UNKNOWN").toLowerCase().replace(/_/g, "-");
    }

    function identityTitle(model) {
      var primary = String(model.displayName || "");
      var nativeName = String(model.nativeDisplayName || "");
      return nativeName && nativeName !== primary
        ? primary + "\nNative MyGeotab name: " + nativeName
        : primary;
    }

    function updateIdentity(refs, model) {
      var primary = String(model.displayName || "");
      var nativeName = String(model.nativeDisplayName || "");
      refs.displayName.textContent = primary;
      refs.nativeDisplayName.textContent = nativeName;
      refs.nativeDisplayName.hidden = !nativeName || nativeName === primary;
      refs.displayName.title = identityTitle(model);
      refs.unitCell.title = identityTitle(model);
    }

    function rowMatches(model) {
      if (activeFilter === "moving") {
        return model.operationalState === "MOVING";
      }
      if (activeFilter === "idling") {
        return model.operationalState === "IDLING";
      }
      if (activeFilter === "off") {
        return model.operationalState === "OFF";
      }
      if (activeFilter === "coupled") {
        return model.fifthWheelStatus === "COUPLED";
      }
      return true;
    }

    function flash(node) {
      if (!node || !node.classList) {
        return;
      }
      node.classList.remove("siq-value--changed");
      var animate = typeof win.requestAnimationFrame === "function"
        ? win.requestAnimationFrame.bind(win)
        : function (callback) { callback(); };
      animate(function () {
        node.classList.add("siq-value--changed");
      });
      if (typeof win.setTimeout === "function") {
        win.setTimeout(function () {
          node.classList.remove("siq-value--changed");
        }, 1300);
      }
    }

    function createCell(row, refs, key, className, value) {
      var cell = element("span", className, value);
      cell.setAttribute("role", "cell");
      row.appendChild(cell);
      refs[key] = cell;
    }

    function updateReportCell(refs, model) {
      refs.lastCommunicationAt.textContent = formatRelativeTimestamp(
        model.lastCommunicationAt
      );
      refs.reportDot.className = "siq-freshness-dot siq-freshness-dot--"
        + String(model.communicationCondition || "unknown").toLowerCase();
      refs.communicationConditionLabel.textContent = "";
      refs.communicationConditionLabel.hidden = true;
    }

    function secondaryMetric(refs, key, label) {
      var metric = element("span", "siq-secondary-metric");
      metric.append(element("span", "siq-secondary-metric__label", label));
      refs[key] = element("strong", "", "--");
      metric.appendChild(refs[key]);
      return metric;
    }

    function updateSecondaryMetrics(refs, model) {
      refs.fuelLevelPercent.textContent = formatNumber(
        model.fuelLevelPercent, "%", 0
      );
      refs.defLevelPercent.textContent = formatNumber(
        model.defLevelPercent, "%", 0
      );
      refs.engineHours.textContent = formatNumber(model.engineHours, " h", 1);
      refs.currentDriverDisplayName.textContent = model.currentDriverDisplayName || "";
      refs.driverMetric.hidden = !model.currentDriverDisplayName;
      var health = model.engineHealth;
      var activeFaults = health && health.status === "AVAILABLE"
        ? (health.activeEngineFaults || 0) + (health.activeTransmissionFaults || 0)
        : null;
      refs.faultIndicator.hidden = activeFaults === null;
      refs.faultIndicator.className = "siq-fault-indicator"
        + (activeFaults > 0 ? " siq-fault-indicator--active"
          : activeFaults === 0 ? " siq-fault-indicator--clear" : "");
      refs.faultIndicator.title = activeFaults > 0
        ? "Active powertrain fault" : activeFaults === 0
          ? "Powertrain fault check completed" : "";
      refs.faultIndicator.setAttribute("aria-label", refs.faultIndicator.title);
    }

    function updateStatePresentation(refs, model) {
      refs.operationalStatePrimaryLabel.textContent = model.operationalStateLabel;
      refs.operationalStateQualifierLabel.textContent =
        model.operationalStateQualifierLabel || "";
      refs.operationalStateQualifierLabel.hidden =
        !model.operationalStateQualifierLabel;
    }

    function createRow(model) {
      var row = element("button", "siq-unit-row siq-unit-row--" + stateKey(model));
      var refs = { row: row };
      row.type = "button";
      row.setAttribute("role", "row");
      row.setAttribute("data-device-id", model.deviceId);
      row.setAttribute("aria-selected", "false");

      var unitCell = element("span", "siq-unit-row__unit");
      var unitLine = element("span", "siq-unit-row__unit-line");
      refs.unitCell = unitCell;
      refs.displayName = element("strong", "", model.displayName);
      unitLine.appendChild(refs.displayName);
      unitCell.appendChild(unitLine);
      refs.nativeDisplayName = element(
        "span",
        "siq-unit-row__native-name",
        model.nativeDisplayName
      );
      unitCell.appendChild(refs.nativeDisplayName);
      updateIdentity(refs, model);
      unitCell.setAttribute("role", "cell");
      row.appendChild(unitCell);

      var stateCell = element("span", "siq-state-cell");
      var rail = element("span", "siq-state-rail");
      rail.setAttribute("aria-hidden", "true");
      refs.operationalStateLabel = element("span", "siq-state-text");
      refs.operationalStatePrimaryLabel = element(
        "strong", "siq-state-text__primary", ""
      );
      refs.operationalStateQualifierLabel = element(
        "span", "siq-state-text__qualifier", ""
      );
      refs.operationalStateLabel.append(
        refs.operationalStatePrimaryLabel,
        refs.operationalStateQualifierLabel
      );
      updateStatePresentation(refs, model);
      refs.stateDurationMs = element("span", "siq-state-duration",
        Number.isFinite(model.stateDurationMs) ? formatDuration(model.stateDurationMs) : "");
      stateCell.append(rail, refs.operationalStateLabel, refs.stateDurationMs);
      stateCell.setAttribute("role", "cell");
      row.appendChild(stateCell);

      createCell(row, refs, "completedMoves", "siq-moves-cell",
        Number.isFinite(model.completedMoves) ? String(model.completedMoves) : "—");
      createCell(row, refs, "currentSpeedMph", "siq-number-cell",
        formatNumber(model.currentSpeedMph, " mph", 1));
      var reportCell = element("span", "siq-report-cell");
      reportCell.setAttribute("role", "cell");
      refs.reportDot = element("span", "siq-freshness-dot");
      refs.reportDot.setAttribute("aria-hidden", "true");
      refs.lastCommunicationAt = element("strong", "", "");
      refs.communicationConditionLabel = element("small", "", "");
      reportCell.append(
        refs.reportDot,
        refs.lastCommunicationAt,
        refs.communicationConditionLabel
      );
      row.appendChild(reportCell);
      updateReportCell(refs, model);

      var secondary = element("span", "siq-unit-row__secondary");
      secondary.setAttribute("role", "cell");
      secondary.append(
        secondaryMetric(refs, "fuelLevelPercent", "Fuel"),
        secondaryMetric(refs, "defLevelPercent", "DEF"),
        secondaryMetric(refs, "engineHours", "Engine Hours"),
        refs.faultIndicator = element("span", "siq-fault-indicator"),
        refs.driverMetric = secondaryMetric(
          refs, "currentDriverDisplayName", "Driver"
        )
      );
      row.appendChild(secondary);
      updateSecondaryMetrics(refs, model);

      row.addEventListener("click", function () {
        select(model.deviceId);
      });
      updateRowAccessibility(refs, model);
      domRows.set(model.deviceId, refs);
      return refs;
    }

    function updateRowAccessibility(refs, model) {
      refs.row.setAttribute(
        "aria-label",
        model.displayName + ", " + model.operationalStateLabel
          + (model.operationalStateQualifierLabel
            ? ", " + model.operationalStateQualifierLabel : "")
          + (model.warningMessage ? ", " + model.warningMessage : "")
      );
    }

    function patchRow(refs, field, value, model) {
      var target = refs[field];
      if (field === "operationalState") {
        refs.row.className = "siq-unit-row siq-unit-row--" + stateKey(model)
          + (model.deviceId === selectedDeviceId ? " siq-unit-row--selected" : "");
      } else if (field === "operationalStateLabel"
        || field === "operationalStateQualifierLabel") {
        updateStatePresentation(refs, model);
        flash(refs.operationalStateLabel);
      } else if (field === "stateDurationMs") {
        refs.stateDurationMs.textContent = Number.isFinite(value) ? formatDuration(value) : "";
        flash(refs.stateDurationMs);
      } else if (field === "completedMoves") {
        refs.completedMoves.textContent = Number.isFinite(model.completedMoves)
          ? String(model.completedMoves) : "—";
        flash(refs.completedMoves);
      } else if (field === "currentSpeedMph") {
        target.textContent = formatNumber(value, " mph", 1);
        flash(target);
      } else if (field === "engineHealth") {
        updateSecondaryMetrics(refs, model);
        flash(refs.faultIndicator);
      } else if (field === "lastCommunicationAt"
        || field === "communicationCondition"
        || field === "communicationConditionLabel") {
        updateReportCell(refs, model);
        flash(refs.lastCommunicationAt);
      } else if (field === "lastCompletedMoveAt") {
        target.textContent = formatTimestamp(value);
        flash(target);
      } else if (["fuelLevelPercent", "fuelLevelAt", "defLevelPercent",
        "defLevelAt", "engineHours", "engineHoursAt",
        "currentDriverDisplayName", "driverIdentifiedAt"].indexOf(field) !== -1) {
        updateSecondaryMetrics(refs, model);
        flash(refs[field] || refs.currentDriverDisplayName);
      } else if (field === "warningMessage") {
        if (target) {
          target.textContent = value || "";
          target.className = model.warningCode
            ? "siq-quality siq-quality--warn"
            : "siq-quality";
          flash(target);
        }
      } else if (target) {
        target.textContent = value === null || value === undefined ? "--" : String(value);
        if (field === "displayName" || field === "nativeDisplayName") {
          updateIdentity(refs, model);
        }
        flash(target);
      }
      updateRowAccessibility(refs, model);
      if (selectedDeviceId === model.deviceId) {
        patchDetail(model);
      }
    }

    var registry = createPersistentRowRegistry({
      reset: function () {
        domRows.clear();
        body.replaceChildren();
      },
      create: createRow,
      patch: patchRow,
      commit: function (rows) {
        var fragment = document.createDocumentFragment();
        rows.forEach(function (refs) {
          fragment.appendChild(refs.row);
        });
        body.appendChild(fragment);
      },
      afterPatch: function (models) {
        applyFilter(models);
        updateKpis();
      }
    });

    function setSelectedRows() {
      registry.order().forEach(function (deviceId) {
        var model = registry.model(deviceId);
        var refs = domRows.get(deviceId);
        var row = refs && refs.row;
        if (!row || !model) {
          return;
        }
        var selected = deviceId === selectedDeviceId;
        row.classList.toggle("siq-unit-row--selected", selected);
        row.setAttribute("aria-selected", String(selected));
      });
    }

    function detailMetric(container, key, label) {
      var wrapper = element("div", "siq-detail-metric");
      var value = element("strong", "", "--");
      wrapper.append(element("span", "", label), value);
      container.appendChild(wrapper);
      detailRefs[key] = value;
    }

    function buildEngineHealthSection() {
      var section = element("section", "siq-detail-section siq-engine-health");
      section.appendChild(element("h3", "siq-mini-title", "Engine Health"));
      detailRefs.engineHealthStatus = element(
        "p", "siq-engine-health__status", "Engine Health Unavailable"
      );
      section.appendChild(detailRefs.engineHealthStatus);
      var metrics = element("div", "siq-detail-metrics");
      detailMetric(metrics, "checkEngineLight", "Check Engine Light");
      detailMetric(metrics, "activeEngineFaults", "Active Engine Faults");
      detailMetric(metrics, "pendingEngineFaults", "Pending Engine Faults");
      detailMetric(metrics, "activeTransmissionFaults",
        "Active Transmission Faults");
      detailMetric(metrics, "pendingTransmissionFaults",
        "Pending Transmission Faults");
      detailMetric(metrics, "highestSeverity", "Highest Severity");
      detailMetric(metrics, "engineHealthLastUpdated", "Last Updated");
      detailRefs.engineHealthDetails = element(
        "div", "siq-engine-health__faults"
      );
      section.append(metrics, detailRefs.engineHealthDetails);
      return section;
    }

    function patchEngineHealthDetail(model) {
      if (!detailRefs || !detailRefs.engineHealthStatus) {
        return;
      }
      var health = model.engineHealth || {};
      var available = health.status === "AVAILABLE";
      detailRefs.engineHealthStatus.textContent = !available
        ? "Engine Health Unavailable"
        : health.noActivePowertrainFaults
          ? "No active powertrain faults"
          : "Current qualifying powertrain faults";
      detailRefs.checkEngineLight.textContent = available
        ? health.checkEngineLight || "Unavailable" : "Unavailable";
      [
        "activeEngineFaults",
        "pendingEngineFaults",
        "activeTransmissionFaults",
        "pendingTransmissionFaults"
      ].forEach(function (key) {
        detailRefs[key].textContent = available && Number.isFinite(health[key])
          ? String(health[key]) : "Unavailable";
      });
      detailRefs.highestSeverity.textContent = available
        ? health.highestSeverity || "Unavailable" : "Unavailable";
      detailRefs.engineHealthLastUpdated.textContent = available
        ? formatTimestamp(health.lastUpdated) : "Unavailable";
      detailRefs.engineHealthDetails.replaceChildren();
      if (!available || !Array.isArray(health.details)
        || !health.details.length) {
        return;
      }
      health.details.forEach(function (fault) {
        var code = Number.isFinite(fault.diagnosticCode)
          ? "SPN " + fault.diagnosticCode : "Diagnostic code unavailable";
        var failure = Number.isFinite(fault.failureModeCode)
          ? "FMI " + fault.failureModeCode : "FMI unavailable";
        var row = element("article", "siq-engine-health__fault");
        row.append(
          element("strong", "siq-engine-health__fault-title",
            (fault.category === "TRANSMISSION" ? "Transmission" : "Engine")
              + " · " + code + " · " + failure),
          element("span", "siq-engine-health__fault-description",
            fault.description || "Description unavailable"),
          element("span", "siq-engine-health__fault-meta",
            fault.state + " · " + (fault.severity || "Severity unavailable")
              + " · Count " + (Number.isFinite(fault.occurrenceCount)
                ? fault.occurrenceCount : "Unavailable")
              + " · " + formatTimestamp(fault.timestamp))
        );
        detailRefs.engineHealthDetails.appendChild(row);
      });
    }

    function buildDetail(model) {
      var drawer = byId("siq-detail-drawer");
      var content = byId("siq-detail-content");
      detailRefs = {};
      byId("siq-detail-title").textContent = model.displayName;
      byId("siq-detail-title").title = identityTitle(model);
      content.replaceChildren();
      var state = element("div", "siq-detail-state siq-detail-state--" + stateKey(model));
      detailRefs.stateBlock = state;
      var stateText = element("span", "siq-state-text");
      detailRefs.operationalStateLabel = element(
        "strong", "siq-state-text__primary", model.operationalStateLabel
      );
      detailRefs.operationalStateQualifierLabel = element(
        "span", "siq-state-text__qualifier", model.operationalStateQualifierLabel || ""
      );
      detailRefs.operationalStateQualifierLabel.hidden =
        !model.operationalStateQualifierLabel;
      stateText.append(
        detailRefs.operationalStateLabel,
        detailRefs.operationalStateQualifierLabel
      );
      detailRefs.stateDurationMs = element("span", "", "");
      state.append(element("span", "siq-state-rail"), stateText,
        detailRefs.stateDurationMs);

      var metrics = element("div", "siq-detail-metrics");
      detailMetric(metrics, "currentSpeedMph", "Current Speed");
      detailMetric(metrics, "lastCommunicationAt", "Last Report");
      detailMetric(metrics, "communicationConditionLabel", "Communication");
      if (model.nativeDisplayName && model.nativeDisplayName !== model.displayName) {
        detailMetric(metrics, "nativeDisplayName", "MyGeotab Name");
      }
      if (model.trailerStateSupported && model.fifthWheelStatusLabel) {
        detailMetric(metrics, "fifthWheelStatusLabel", "Trailer");
        detailMetric(metrics, "trailerStateAt", "Trailer State Reported");
      }
      if (typeof model.ignitionOn === "boolean") {
        detailMetric(metrics, "ignitionOn", "Ignition");
      }
      if (Number.isFinite(model.engineRpm)) {
        detailMetric(metrics, "engineRpm", "Engine RPM");
      }
      if (Number.isFinite(model.fuelLevelPercent)) {
        detailMetric(metrics, "fuelLevelPercent", "Fuel");
        detailMetric(metrics, "fuelLevelAt", "Fuel Reported");
      }
      if (Number.isFinite(model.defLevelPercent)) {
        detailMetric(metrics, "defLevelPercent", "DEF");
        detailMetric(metrics, "defLevelAt", "DEF Reported");
      }
      if (Number.isFinite(model.engineHours)) {
        detailMetric(metrics, "engineHours", "Engine Hours");
        detailMetric(metrics, "engineHoursAt", "Engine Hours Reported");
      }
      if (model.currentDriverDisplayName) {
        detailMetric(metrics, "currentDriverDisplayName", "Current Driver");
        detailMetric(metrics, "driverIdentifiedAt", "Driver Identified");
      }
      if (Number.isFinite(model.odometerMiles)) {
        detailMetric(metrics, "odometerMiles", "Odometer");
      }
      if (Number.isFinite(model.engineCoolantTemperatureCelsius)) {
        detailMetric(metrics, "engineCoolantTemperatureCelsius",
          "Engine Coolant Temperature");
      }
      content.append(state, metrics);
      var commercialItems = selectors.unitDetailCommercialFields(
        currentUserContext, model
      );
      if (commercialItems.length) {
        var commercialSection = element("section", "siq-detail-section");
        var commercialMetrics = element("div", "siq-detail-metrics");
        commercialSection.appendChild(
          element("h3", "siq-mini-title", "Commercial")
        );
        commercialItems.forEach(function (item) {
          var wrapper = element("div", "siq-detail-metric");
          wrapper.append(
            element("span", "", item[0]),
            element("strong", "", item[1])
          );
          commercialMetrics.appendChild(wrapper);
        });
        commercialSection.appendChild(commercialMetrics);
        content.appendChild(commercialSection);
      }
      if (model.engineHealth && (model.engineHealth.status === "AVAILABLE"
        || model.engineHealth.reason === "FAULT_DATA_NOT_LOADED")) {
        content.appendChild(buildEngineHealthSection());
      }
      drawer.classList.add("siq-detail-drawer--open");
      document.querySelector(".siq-operations-layout")
        .classList.add("siq-operations-layout--drawer-open");
      patchDetail(model);
    }

    function patchDetail(model) {
      if (!detailRefs || selectedDeviceId !== model.deviceId) {
        return;
      }
      function set(key, value) {
        if (detailRefs[key]) {
          detailRefs[key].textContent = value;
        }
      }
      byId("siq-detail-title").textContent = model.displayName;
      byId("siq-detail-title").title = identityTitle(model);
      set("operationalStateLabel", model.operationalStateLabel);
      set("operationalStateQualifierLabel", model.operationalStateQualifierLabel || "");
      if (detailRefs.operationalStateQualifierLabel) {
        detailRefs.operationalStateQualifierLabel.hidden =
          !model.operationalStateQualifierLabel;
      }
      set("stateDurationMs", Number.isFinite(model.stateDurationMs)
        ? formatDuration(model.stateDurationMs) : "");
      set("currentSpeedMph", formatNumber(model.currentSpeedMph, " mph", 1));
      set("lastCommunicationAt", formatTimestamp(model.lastCommunicationAt));
      set("communicationConditionLabel", model.communicationConditionLabel);
      set("nativeDisplayName", model.nativeDisplayName);
      set("fifthWheelStatusLabel", model.fifthWheelStatusLabel || "");
      set("trailerStateAt", formatTimestamp(model.trailerStateAt));
      set("ignitionOn", model.ignitionOn ? "On" : "Off");
      set("engineRpm", formatNumber(model.engineRpm, " rpm", 0));
      set("fuelLevelPercent", formatNumber(model.fuelLevelPercent, "%", 0));
      set("fuelLevelAt", formatTimestamp(model.fuelLevelAt));
      set("defLevelPercent", formatNumber(model.defLevelPercent, "%", 0));
      set("defLevelAt", formatTimestamp(model.defLevelAt));
      set("engineHours", formatNumber(model.engineHours, " h", 1));
      set("engineHoursAt", formatTimestamp(model.engineHoursAt));
      set("currentDriverDisplayName", model.currentDriverDisplayName || "");
      set("driverIdentifiedAt", formatTimestamp(model.driverIdentifiedAt));
      var telemetryPresentation = operationalTelemetryPresentation(model);
      set("odometerMiles", telemetryPresentation.odometer);
      set("engineCoolantTemperatureCelsius", telemetryPresentation.coolant);
      patchEngineHealthDetail(model);
    }

    function select(deviceId) {
      if (!registry.has(deviceId)) {
        return false;
      }
      selectedDeviceId = deviceId;
      setSelectedRows();
      buildDetail(registry.model(deviceId));
      onSelectionChange(deviceId);
      return true;
    }

    function closeDrawer() {
      byId("siq-detail-drawer").classList.remove("siq-detail-drawer--open");
      document.querySelector(".siq-operations-layout")
        .classList.remove("siq-operations-layout--drawer-open");
      selectedDeviceId = null;
      detailRefs = null;
      setSelectedRows();
      onSelectionChange(null);
    }

    function applyFilter(models) {
      (models || registry.models()).forEach(function (model) {
        var refs = domRows.get(model.deviceId);
        var row = refs && refs.row;
        if (row) {
          row.hidden = !rowMatches(model);
        }
      });
    }

    function updateKpis(models) {
      var source = models || registry.models();
      var summary = operationsSummaryModel(source, currentFacility);
      byId("siq-kpi-moving-value").textContent = String(summary.moving);
      byId("siq-kpi-idling-value").textContent = String(summary.idling);
      byId("siq-kpi-off-value").textContent = String(summary.off);
      byId("siq-kpi-coupled-value").textContent = String(summary.withTrailer);
      byId("siq-kpi-completed-value").textContent = appliedReportWindow
        ? String(summary.completedMoves) : "—";
      byId("siq-kpi-unit-detail").textContent =
        summary.authorizedUnits + " units in this facility";
    }

    function initializeRows(scopeKey, models) {
      var previousSelected = selectedDeviceId;
      var decorated = decorateModels(models);
      registry.initialize(scopeKey, decorated);
      updateKpis(decorated);
      applyFilter(decorated);
      if (previousSelected && registry.has(previousSelected)) {
        selectedDeviceId = previousSelected;
        setSelectedRows();
        if (detailRefs) {
          patchDetail(registry.model(previousSelected));
        }
      } else {
        closeDrawer();
      }
      byId("siq-kpi-strip").hidden = false;
    }

    function decorateModels(models) {
      return (models || []).map(function (model) {
        return Object.assign({}, model, {
          completedMoves: appliedReportWindow && reportByDevice.has(model.deviceId)
            ? reportByDevice.get(model.deviceId) : null
        });
      });
    }

    function appliedWindowLabel(window) {
      function label(value) {
        return new Date(value).toLocaleString([], {
          timeZone: window.timezone,
          month: "short", day: "numeric", year: "numeric",
          hour: "numeric", minute: "2-digit"
        });
      }
      return label(window.startUtc) + " – " + label(window.endUtc);
    }

    function applyReportResult(result) {
      if (!result || !result.window || !Array.isArray(result.units)) {
        return false;
      }
      appliedReportWindow = result.window;
      reportByDevice = new Map(result.units.map(function (unit) {
        return [unit.deviceId, Number.isFinite(unit.moveCount) ? unit.moveCount : null];
      }));
      var models = decorateModels(registry.models());
      registry.patch(models);
      updateKpis(models);
      byId("siq-operations-window-label").textContent =
        "Completed Moves · " + appliedWindowLabel(result.window);
      return true;
    }

    function showInitialLoading() {
      if (registry.order().length) {
        return;
      }
      var loading = element("div", "siq-empty-state siq-loading-state");
      loading.append(element("strong", "", "Loading Operations"),
        element("span", "", "Resolving authorized assets and current fleet data."));
      body.replaceChildren(loading);
      byId("siq-live-label").textContent = "Loading live data";
    }

    function showEmpty(message) {
      var block = element("div", "siq-empty-state");
      block.append(element("strong", "", "No authorized assets"),
        element("span", "", message || "No authorized assets"));
      body.replaceChildren(block);
      byId("siq-kpi-strip").hidden = true;
      byId("siq-live-label").textContent = "Live data unavailable";
    }

    function showConfiguredEmpty(message) {
      var block = element("div", "siq-empty-state");
      block.append(element("strong", "", "Configured facility"),
        element("span", "", message
          || "This configured facility has no active authorized devices."));
      body.replaceChildren(block);
      byId("siq-kpi-strip").hidden = false;
      byId("siq-live-label").textContent = "Live · no active devices";
    }

    function showScopePrompt(message) {
      var block = element("div", "siq-empty-state");
      block.append(element("strong", "", "Choose a facility"),
        element("span", "", message || "Select an authorized facility."));
      body.replaceChildren(block);
      byId("siq-kpi-strip").hidden = true;
      byId("siq-live-label").textContent = "Facility selection required";
    }

    function populateScopeSelect(select, records, selectedId, placeholder) {
      var options = [];
      if (placeholder) {
        options.push({ id: "", displayName: placeholder });
      }
      options = options.concat(records || []);
      select.replaceChildren();
      options.forEach(function (record) {
        var option = element("option", "", record.displayName);
        option.value = record.id;
        option.selected = record.id === (selectedId || "");
        select.appendChild(option);
      });
      select.value = selectedId || "";
    }

    function setScopeSelection(model, message) {
      var scope = model || {};
      var customerWrap = byId("siq-live-customer-selector-wrap");
      var facilityWrap = byId("siq-live-facility-selector-wrap");
      var controls = byId("siq-live-scope-controls");
      var customerSelect = byId("siq-live-customer-selector");
      var facilitySelect = byId("siq-live-facility-selector");
      var facilities = (scope.facilities || []).filter(function (facility) {
        return !scope.showCustomerSelector
          || facility.customerId === scope.selectedCustomerId;
      });
      customerWrap.hidden = !scope.showCustomerSelector;
      facilityWrap.hidden = !scope.showFacilitySelector;
      controls.hidden = customerWrap.hidden && facilityWrap.hidden;
      populateScopeSelect(customerSelect, scope.customers || [],
        scope.selectedCustomerId, "Select customer");
      populateScopeSelect(facilitySelect, facilities,
        scope.selectedFacilityId, scope.showCustomerSelector
          ? "Select facility" : null);
      facilitySelect.disabled = scope.showCustomerSelector
        && !scope.selectedCustomerId;
      facilitySelect.setAttribute("aria-disabled", String(facilitySelect.disabled));
      byId("siq-live-scope-status").textContent = message || "";
    }

    function clearScope() {
      clearedScopeSequence += 1;
      selectedDeviceId = null;
      detailRefs = null;
      currentFacility = null;
      reportByDevice.clear();
      appliedReportWindow = null;
      domRows.clear();
      registry.initialize("cleared::" + clearedScopeSequence, []);
      byId("siq-detail-drawer").classList.remove("siq-detail-drawer--open");
      document.querySelector(".siq-operations-layout")
        .classList.remove("siq-operations-layout--drawer-open");
      byId("siq-brand-context").hidden = true;
      byId("siq-facility-context-bar").hidden = true;
      byId("siq-kpi-strip").hidden = true;
      byId("siq-operations-window-label").textContent = "Completed Moves";
      body.replaceChildren();
    }

    function updateFreshness(status) {
      var checked = status.checkedAt ? new Date(status.checkedAt) : null;
      var latest = status.latestFleetDataAt ? new Date(status.latestFleetDataAt) : null;
      byId("siq-live-label").textContent = status.condition === "paused"
        ? "Live updates paused"
        : "Live";
      byId("siq-last-checked").textContent = checked
        ? "Last Checked " + checked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "Last Checked --";
      byId("siq-latest-fleet-data").textContent = latest && Number.isFinite(latest.getTime())
        ? "Latest Fleet Data " + latest.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        })
        : "Latest Fleet Data --";
      byId("siq-data-age").textContent = latest && Number.isFinite(latest.getTime())
        ? "Data age " + formatDuration(Math.max(0, Date.now() - latest.getTime()))
        : "Data age --";
    }

    function showFailure(status) {
      byId("siq-live-label").textContent = "Refresh unavailable";
      updateFreshness({
        condition: "failure",
        checkedAt: status.checkedAt,
        latestFleetDataAt: status.latestFleetDataAt
      });
      byId("siq-live-label").textContent = "Refresh unavailable";
      if (win.console && typeof win.console.error === "function") {
        win.console.error("[SpotterIQ staging] live refresh failed", {
          category: status.error && status.error.code || "unexpected"
        });
      }
    }

    function updateContext(result) {
      currentFacility = result.facility;
      byId("siq-brand-context").hidden = false;
      byId("siq-facility-context-bar").hidden = false;
      byId("siq-facility-context-error").hidden = true;
      byId("siq-brand-customer-name").textContent = result.customer.displayName;
      byId("siq-brand-facility-name").textContent = result.facility.displayName;
      byId("siq-customer-name").textContent = result.customer.displayName;
      byId("siq-facility-name").textContent = result.facility.displayName;
      byId("siq-context-timezone").textContent = result.facility.timezone;
      byId("siq-authorized-unit-count").textContent = String(result.deviceIds.length);
      byId("siq-shift-label").textContent = result.shiftOccurrence
        ? result.shiftOccurrence.shiftName : "Current Operations";
      byId("siq-shift-range").textContent = result.shiftOccurrence
        ? result.shiftOccurrence.startLocalDateTime.slice(11)
          + "–" + result.shiftOccurrence.endLocalDateTime.slice(11)
        : "Current telemetry";
      updateKpis();
    }

    function bind(nextController) {
      if (bound) {
        controller = nextController || controller;
        return;
      }
      bound = true;
      controller = nextController;
      appRoot.querySelectorAll("[data-board-filter]").forEach(function (button) {
        button.addEventListener("click", function () {
          activeFilter = button.getAttribute("data-board-filter");
          appRoot.querySelectorAll("[data-board-filter]").forEach(function (candidate) {
            var selected = candidate === button;
            candidate.classList.toggle("siq-filter-button--active", selected);
            candidate.setAttribute("aria-pressed", String(selected));
          });
          applyFilter();
        });
      });
      byId("siq-drawer-close").addEventListener("click", closeDrawer);
      byId("siq-refresh-button").addEventListener("click", function () {
        if (controller) {
          controller.refreshNow();
        }
      });
      byId("siq-live-customer-selector").addEventListener("change", function () {
        onCustomerScopeChange(this.value || null);
      });
      byId("siq-live-facility-selector").addEventListener("change", function () {
        onFacilityScopeChange(this.value || null);
      });
    }

    return {
      bind: bind,
      clearScope: clearScope,
      initializeRows: initializeRows,
      applyReportResult: applyReportResult,
      patchRows: function (models) {
        var decorated = decorateModels(models);
        var mutations = registry.patch(decorated);
        updateKpis(decorated);
        applyFilter(decorated);
        return mutations;
      },
      patchEngineHealth: function (deviceId, model) {
        if (!registry.has(deviceId) || !model || model.deviceId !== deviceId) {
          return false;
        }
        registry.patch([model]);
        return true;
      },
      registry: registry,
      selectedDeviceId: function () { return selectedDeviceId; },
      showEmpty: showEmpty,
      showConfiguredEmpty: showConfiguredEmpty,
      showFailure: showFailure,
      showInitialLoading: showInitialLoading,
      showScopePrompt: showScopePrompt,
      setScopeSelection: setScopeSelection,
      setUserContext: function (userContext) {
        currentUserContext = userContext || null;
      },
      updateContext: updateContext,
      updateFreshness: updateFreshness
    };
  }

  return {
    PATCH_FIELDS: PATCH_FIELDS,
    createOperationsDomView: createOperationsDomView,
    createPersistentRowRegistry: createPersistentRowRegistry,
    operationalTelemetryPresentation: operationalTelemetryPresentation,
    operationsSummaryModel: operationsSummaryModel
  };
}));
