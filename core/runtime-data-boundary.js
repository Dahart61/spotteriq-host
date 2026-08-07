(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_RUNTIME_DATA_BOUNDARY = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var FIXTURE_MODE = "fixture";
  var HISTORICAL_UNAVAILABLE =
    "Historical reporting is not configured for this facility.";

  function normalizeMode(mode) {
    return String(mode || "live").toLowerCase();
  }

  function project(mode, fixtureSource) {
    var normalizedMode = normalizeMode(mode);
    var fixtureAllowed = normalizedMode === FIXTURE_MODE;
    if (fixtureAllowed && (!fixtureSource || typeof fixtureSource !== "object")) {
      throw new Error("Explicit fixture mode requires SIQ_FIXTURES.");
    }
    return Object.freeze({
      mode: normalizedMode,
      fixtureAllowed: fixtureAllowed,
      fixture: fixtureAllowed ? fixtureSource : null,
      historicalAvailable: fixtureAllowed,
      historicalUnavailableMessage: HISTORICAL_UNAVAILABLE
    });
  }

  function fixtureData(projection, label) {
    if (!projection || projection.fixtureAllowed !== true || !projection.fixture) {
      throw new Error(
        (label || "Fixture data") + " is unavailable outside explicit fixture mode."
      );
    }
    return projection.fixture;
  }

  function assertNoFixtureRecords(projection, records) {
    if (projection && projection.fixtureAllowed === true) {
      return true;
    }
    var queue = Array.isArray(records) ? records.slice() : [records];
    var visited = new Set();
    while (queue.length) {
      var value = queue.shift();
      if (!value || typeof value !== "object" || visited.has(value)) {
        continue;
      }
      visited.add(value);
      if (value.source === "SIQ_FIXTURES"
        || value.dataSource === "SIQ_FIXTURES"
        || value.fixtureSource === true) {
        throw new Error("Live runtime data contains a fixture-sourced record.");
      }
      Object.keys(value).forEach(function (key) {
        queue.push(value[key]);
      });
    }
    return true;
  }

  return {
    FIXTURE_MODE: FIXTURE_MODE,
    HISTORICAL_UNAVAILABLE: HISTORICAL_UNAVAILABLE,
    project: project,
    fixtureData: fixtureData,
    assertNoFixtureRecords: assertNoFixtureRecords
  };
}));
