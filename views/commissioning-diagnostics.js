(function (root, factory) {
  "use strict";

  var identity = typeof module === "object" && module.exports
    ? require("../core/addin-identity")
    : root.SIQ_ADDIN_IDENTITY;
  var api = factory(identity);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_COMMISSIONING_DIAGNOSTICS = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (identity) {
  "use strict";

  var FIELD_DEFINITIONS = [
    ["lifecycleInitialized", "MyGeotab lifecycle initialized"],
    ["apiAvailable", "API object available"],
    ["addInId", "AddInId"],
    ["queryStatus", "AddInData query status"],
    ["authorizedRecordCount", "Authorized configuration records"],
    ["selectedCustomer", "Selected customer"],
    ["selectedFacility", "Selected facility"],
    ["configuredGroupId", "Configured group ID"],
    ["authorizedDeviceCount", "Authorized enrolled-device count"],
    ["resolvedMappingCount", "Resolved diagnostic mapping count"],
    ["unresolvedMappings", "Unresolved diagnostic mappings"],
    ["timezone", "Selected timezone"],
    ["activeShift", "Active shift occurrence"],
    ["refreshState", "Refresh controller state"],
    ["latestSuccessfulRequest", "Latest successful API request"],
    ["lastErrorCategory", "Last non-sensitive error category"]
  ];

  function queryEnabled(search) {
    return /(?:^|[?&])siqCommissioning=1(?:&|$)/.test(String(search || ""));
  }

  function authorized(options) {
    var user = options && options.userContext || {};
    return Boolean(options && options.staging === true
      && queryEnabled(options.search)
      && user.role === "Fleetsource Administrator"
      && user.canCommissionSpotterIQ === true);
  }

  function createCommissioningDiagnostics(document, options) {
    if (!document || !authorized(options)) {
      return null;
    }
    var appRoot = document.querySelector(".siq-app");
    var main = appRoot && appRoot.querySelector("#siq-main");
    if (!main) {
      return null;
    }
    var values = {};
    var panel = document.createElement("section");
    panel.className = "siq-commissioning";
    panel.setAttribute("aria-labelledby", "siq-commissioning-title");
    var heading = document.createElement("div");
    heading.className = "siq-module-heading";
    var headingCopy = document.createElement("div");
    var title = document.createElement("h2");
    title.id = "siq-commissioning-title";
    title.className = "siq-section-title";
    title.textContent = "Staging Commissioning Diagnostics";
    var note = document.createElement("p");
    note.className = "siq-screen-note";
    note.textContent = "Read-only operational status for authorized Fleetsource commissioning.";
    headingCopy.append(title, note);
    heading.appendChild(headingCopy);
    panel.appendChild(heading);

    var grid = document.createElement("dl");
    grid.className = "siq-commissioning__grid";
    FIELD_DEFINITIONS.forEach(function (definition) {
      var wrapper = document.createElement("div");
      var term = document.createElement("dt");
      var value = document.createElement("dd");
      term.textContent = definition[1];
      value.textContent = "--";
      wrapper.append(term, value);
      grid.appendChild(wrapper);
      values[definition[0]] = value;
    });
    panel.appendChild(grid);
    main.appendChild(panel);

    function update(next) {
      Object.keys(next || {}).forEach(function (key) {
        if (values[key]) {
          var value = next[key];
          values[key].textContent = value === null || value === undefined || value === ""
            ? "--"
            : String(value);
        }
      });
    }

    update({
      lifecycleInitialized: "Yes",
      addInId: identity.SPOTTERIQ_V4_ADDIN_ID,
      queryStatus: "Not queried",
      authorizedRecordCount: "0",
      authorizedDeviceCount: "0",
      resolvedMappingCount: "0",
      unresolvedMappings: "None",
      refreshState: "Not started",
      lastErrorCategory: "None"
    });
    return { panel: panel, update: update };
  }

  return {
    authorized: authorized,
    createCommissioningDiagnostics: createCommissioningDiagnostics,
    queryEnabled: queryEnabled
  };
}));
