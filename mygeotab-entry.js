(function (root) {
  "use strict";

  root.geotab = root.geotab || {};
  root.geotab.addin = root.geotab.addin || {};

  root.geotab.addin.spotterIQ = function () {
    var initialized = false;
    var mode = root.SIQ_MYGEOTAB_CONFIGURATION.runtimeMode(
      root.location && root.location.search
    );
    var logger = root.SIQ_STAGING_LOG.createLogger(
      root.console,
      root.location && root.location.search
    );
    var deployment = null;
    var dataSource = null;
    var view = null;
    var controller = null;
    var performanceView = null;
    var performanceController = null;
    var performanceNavigationBound = false;
    var controllerConfigurationKey = null;
    var visibilityHandler = null;
    var commissioningView = null;
    var focused = false;
    var lifecycleGeneration = 0;
    var commissioningState = {
      lifecycleInitialized: "No",
      apiAvailable: "No",
      addInId: root.SIQ_ADDIN_IDENTITY.SPOTTERIQ_V4_ADDIN_ID,
      queryStatus: "Not queried",
      authorizedRecordCount: 0,
      selectedCustomer: null,
      selectedFacility: null,
      configuredGroupId: null,
      authorizedDeviceCount: 0,
      resolvedMappingCount: 0,
      unresolvedMappings: "None",
      timezone: null,
      activeShift: null,
      refreshState: "Not started",
      latestSuccessfulRequest: null,
      lastErrorCategory: "None"
    };

    function updateCommissioning(values) {
      Object.assign(commissioningState, values || {});
      if (commissioningView) {
        commissioningView.update(commissioningState);
      }
    }

    function userContextFromState(state) {
      var role = state && state.spotterIQRole;
      if ([
        "Customer Viewer",
        "Customer Manager",
        "Fleetsource Administrator"
      ].indexOf(role) === -1) {
        role = "Customer Viewer";
      }
      return {
        role: role,
        customerId: state && state.spotterIQCustomerId || null,
        canCommissionSpotterIQ: role === "Fleetsource Administrator"
          && state && state.spotterIQCanCommission === true
      };
    }

    function ensureCommissioningView(userContext) {
      if (commissioningView) {
        return;
      }
      commissioningView =
        root.SIQ_COMMISSIONING_DIAGNOSTICS.createCommissioningDiagnostics(
          root.document,
          {
            search: root.location && root.location.search,
            staging: true,
            userContext: userContext
          }
        );
      if (commissioningView) {
        commissioningView.update(commissioningState);
      }
    }

    function prepareView() {
      if (view) {
        return;
      }
      view = root.SIQ_OPERATIONS_VIEW.createOperationsDomView(root.document, {
        window: root,
        onSelectionChange: function (deviceId) {
          if (controller && typeof controller.selectDevice === "function") {
            controller.selectDevice(deviceId);
          }
        }
      });
      view.bind(null);
      visibilityHandler = function () {
        if (controller) {
          controller.setVisible(root.document.visibilityState !== "hidden");
        }
      };
      root.document.addEventListener("visibilitychange", visibilityHandler);
    }

    function configurationKey(configuration, records) {
      if (records && records.length) {
        return records.map(function (record) {
          return (record.entityId || "")
            + ":" + JSON.stringify(record.record && record.record.details || {});
        }).join("|");
      }
      return JSON.stringify(configuration);
    }

    function prepareController(configuration, records) {
      var nextKey = configurationKey(configuration, records);
      if (controller && controllerConfigurationKey === nextKey) {
        return;
      }
      if (controller) {
        controller.blur();
      }
      dataSource = root.SIQ_MYGEOTAB_OPERATIONS.createOperationsDataSource(
        configuration
      );
      controller = root.SIQ_OPERATIONS_CONTROLLER.createOperationsController({
        dataSource: dataSource,
        view: view,
        logger: logger,
        onStatus: function (status) {
          var snapshot = controller && controller.snapshot();
          updateCommissioning({
            refreshState: status,
            latestSuccessfulRequest: snapshot && snapshot.lastSuccessAt
              ? new Date(snapshot.lastSuccessAt).toISOString()
              : commissioningState.latestSuccessfulRequest,
            lastErrorCategory: status === "failure" ? "operations-request" : "None"
          });
        }
      });
      controllerConfigurationKey = nextKey;
      view.bind(controller);
    }

    function preparePerformance(api, result) {
      if (!result || !result.ok || !Array.isArray(result.devices)) {
        return;
      }
      if (!performanceView) {
        performanceView = root.SIQ_PERFORMANCE_VIEW.createPerformanceDomView(
          root.document
        );
        performanceController = root.SIQ_PERFORMANCE_CONTROLLER
          .createPerformanceController({
            view: performanceView,
            onApplied: function (report) {
              if (view && typeof view.applyReportResult === "function") {
                view.applyReportResult(report);
              }
            }
          });
        performanceView.bind(performanceController);
      }
      performanceController.focus({
        api: api,
        customer: result.customer,
        facility: result.facility,
        devices: result.devices
      });
      if (!performanceNavigationBound) {
        performanceNavigationBound = true;
        var button = root.document.querySelector('[data-module="performance"]');
        button.addEventListener("click", function () {
          performanceController.open();
        });
      }
      var panel = root.document.getElementById("siq-module-performance");
      if (panel && panel.classList.contains("siq-module--active")) {
        performanceController.open();
      }
    }

    function mappingStats(configuration) {
      var resolved = 0;
      var unresolved = [];
      var channels = root.SIQ_FACILITY_CONFIG
        && Array.isArray(root.SIQ_FACILITY_CONFIG.REQUIRED_DIAGNOSTIC_CHANNELS)
        ? root.SIQ_FACILITY_CONFIG.REQUIRED_DIAGNOSTIC_CHANNELS : [];
      (configuration && configuration.assetEnrollments || []).forEach(function (entry) {
        channels.forEach(function (channel) {
          var mapping = entry.diagnosticMappings && entry.diagnosticMappings[channel];
          if (mapping && (mapping.diagnosticId
            || channel === "speed" && mapping.source === "DeviceStatusInfo")) {
            resolved += 1;
          } else {
            unresolved.push(entry.deviceId + ": " + channel);
          }
        });
      });
      return {
        resolved: resolved,
        unresolved: unresolved.length ? unresolved.join(", ") : "None"
      };
    }

    function loadLocalDeploymentConfiguration(done) {
      if (Object.prototype.hasOwnProperty.call(root, "SIQ_DEPLOYMENT_CONFIG")) {
        done();
        return;
      }
      var script = root.document.createElement("script");
      script.src = "deployment-config.local.js";
      script.onload = done;
      script.onerror = done;
      root.document.head.appendChild(script);
    }

    function initialize(api, state, callback) {
      logger.info("initialize called");
      function complete() {
        if (typeof callback === "function") {
          callback();
        }
      }
      if (initialized) {
        complete();
        return;
      }
      initialized = true;
      updateCommissioning({
        lifecycleInitialized: "Yes",
        apiAvailable: api && typeof api.call === "function" ? "Yes" : "No"
      });
      if (root.SIQ_APP && typeof root.SIQ_APP.initialize === "function") {
        root.SIQ_APP.initialize({ mode: mode });
      }
      if (mode === root.SIQ_MYGEOTAB_CONFIGURATION.MODES.FIXTURE) {
        complete();
        return;
      }
      prepareView();
      if (mode === root.SIQ_MYGEOTAB_CONFIGURATION.MODES.LOCAL) {
        loadLocalDeploymentConfiguration(function () {
          deployment = root.SIQ_MYGEOTAB_CONFIGURATION.deploymentConfiguration(root);
          if (deployment.ok) {
            prepareController(deployment.configuration);
          } else {
            view.showEmpty("Explicit local development configuration is invalid.");
            logger.error("local configuration validation failed", deployment.errors);
          }
          complete();
        });
        return;
      }
      complete();
    }

    function isCurrentFocus(generation) {
      return focused && generation === lifecycleGeneration;
    }

    async function focusLocal(api, state, selectedGroupIds, generation) {
      if (!controller || !deployment || !deployment.ok) {
        return;
      }
      var session = await root.SIQ_MYGEOTAB_CLIENT.getSession(api);
      if (!isCurrentFocus(generation)) {
        return null;
      }
      var user = root.SIQ_MYGEOTAB_CONFIGURATION.resolveConfiguredUser(
        deployment.configuration,
        session
      );
      var selection = root.SIQ_MYGEOTAB_CONFIGURATION.resolveFacilitySelection(
        deployment.configuration,
        user,
        selectedGroupIds,
        {
          customerId: state && state.spotterIQCustomerId,
          facilityId: state && state.spotterIQFacilityId
        }
      );
      view.setUserContext(selection && selection.user
        ? selection.user : userContextFromState(state));
      return controller.focus({
        api: api,
        state: state,
        selection: selection,
        selectedGroupIds: selectedGroupIds
      });
    }

    async function focusLive(api, state, selectedGroupIds, userContext, generation) {
      updateCommissioning({
        apiAvailable: api && typeof api.call === "function" ? "Yes" : "No",
        queryStatus: "Querying",
        lastErrorCategory: "None"
      });
      var loaded;
      try {
        loaded = await root.SIQ_ADDIN_DATA_CONFIG.loadFacilityConfiguration({
          api: api,
          state: state,
          activeGroupIds: selectedGroupIds,
          userContext: userContext,
          explicitSelection: {
            customerId: state && state.spotterIQCustomerId,
            facilityId: state && state.spotterIQFacilityId
          }
        });
      } catch (error) {
        var configurationError = new Error("Facility configuration failed");
        configurationError.code = "FACILITY_CONFIGURATION_FAILED";
        configurationError.cause = error;
        throw configurationError;
      }
      if (!isCurrentFocus(generation)) {
        return null;
      }
      logger.info("AddInData records retrieved", {
        count: loaded.records.length,
        authorizedCount: loaded.authorizedRecords.length
      });
      logger.info("configuration validation result", {
        valid: loaded.ok,
        findingCount: loaded.findings.length
      });
      updateCommissioning({
        queryStatus: loaded.code,
        authorizedRecordCount: loaded.authorizedRecords.length,
        lastErrorCategory: loaded.errorCategory || "None",
        unresolvedMappings: loaded.findings.length
          ? loaded.findings.reduce(function (all, item) {
            return all.concat((item.findings || []).map(function (finding) {
              return finding.code;
            }));
          }, []).join(", ") || "Validation finding"
          : "None"
      });
      if (!loaded.ok) {
        view.showEmpty(loaded.message);
        return loaded;
      }

      var stats;
      try {
        stats = mappingStats(loaded.configuration);
      } catch (error) {
        var mappingError = new Error("Facility mapping projection failed");
        mappingError.code = "FACILITY_MAPPING_FAILED";
        mappingError.cause = error;
        throw mappingError;
      }
      updateCommissioning({
        selectedCustomer: loaded.selection.customer.displayName,
        selectedFacility: loaded.selection.facility.displayName,
        configuredGroupId: loaded.selection.facility.myGeotabGroupId,
        resolvedMappingCount: stats.resolved,
        unresolvedMappings: stats.unresolved,
        timezone: loaded.selection.facility.timezone
      });
      try {
        prepareController(loaded.configuration, loaded.authorizedRecords);
        view.setUserContext(userContext);
      } catch (error) {
        var setupError = new Error("Operations controller setup failed");
        setupError.code = "CONTROLLER_SETUP_FAILED";
        setupError.cause = error;
        throw setupError;
      }
      var result;
      try {
        result = await controller.focus({
          api: api,
          state: state,
          selection: loaded.selection,
          selectedGroupIds: selectedGroupIds
        });
      } catch (error) {
        var focusError = new Error("Operations controller focus failed");
        focusError.code = "CONTROLLER_FOCUS_FAILED";
        focusError.cause = error;
        throw focusError;
      }
      if (!isCurrentFocus(generation)) {
        return null;
      }
      root.SIQ_RUNTIME_DATA_BOUNDARY.assertNoFixtureRecords(
        root.SIQ_APP && root.SIQ_APP.runtimeProjection,
        result && result.viewModels || []
      );
      if (result && result.ok) {
        preparePerformance(api, result);
        logger.info("effective authorized asset count", {
          count: result.deviceIds.length
        });
        var gaps = stats.unresolved === "None" ? [] : stats.unresolved.split(", ");
        if (gaps.length) {
          logger.info("diagnostic mapping gaps", { count: gaps.length });
        }
        updateCommissioning({
          authorizedDeviceCount: result.deviceIds.length,
          activeShift: result.shiftOccurrence
            ? result.shiftOccurrence.occurrenceId
            : result.shiftStatus === "SHIFT_SCHEDULE_NOT_CONFIGURED"
              ? "Selected reporting window"
              : "Selected reporting window"
        });
      }
      return result;
    }

    async function focus(api, state) {
      var generation = ++lifecycleGeneration;
      focused = true;
      logger.info("focus called");
      if (mode === root.SIQ_MYGEOTAB_CONFIGURATION.MODES.FIXTURE) {
        return;
      }
      var userContext = userContextFromState(state);
      ensureCommissioningView(userContext);
      try {
        var selectedGroupIds =
          await root.SIQ_MYGEOTAB_CONFIGURATION.groupIdsFromState(state);
        if (!isCurrentFocus(generation)) {
          return null;
        }
        if (mode === root.SIQ_MYGEOTAB_CONFIGURATION.MODES.LOCAL) {
          return await focusLocal(api, state, selectedGroupIds, generation);
        }
        return await focusLive(
          api,
          state,
          selectedGroupIds,
          userContext,
          generation
        );
      } catch (error) {
        if (!isCurrentFocus(generation)) {
          return null;
        }
        var category = error && error.code || "unexpected";
        logger.error("Operations initial load failure [" + category + "]", {
          category: category
        });
        updateCommissioning({
          queryStatus: "failed",
          lastErrorCategory: category
        });
        view.showFailure({
          message: "Refresh unavailable",
          error: error,
          checkedAt: Date.now(),
          latestFleetDataAt: null
        });
      }
    }

    function blur() {
      logger.info("blur called");
      focused = false;
      lifecycleGeneration += 1;
      if (controller) {
        controller.blur();
      }
      updateCommissioning({ refreshState: "Paused" });
    }

    return {
      initialize: initialize,
      focus: focus,
      blur: blur
    };
  };
}(typeof globalThis !== "undefined" ? globalThis : this));
