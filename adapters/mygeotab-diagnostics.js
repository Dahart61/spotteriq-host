(function (root, factory) {
  "use strict";

  var diagnosticChannels = typeof module === "object" && module.exports
    ? require("../core/diagnostic-channels")
    : root.SIQ_DIAGNOSTIC_CHANNELS;
  var api = factory(diagnosticChannels);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_MYGEOTAB_DIAGNOSTICS = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (
  diagnosticChannels
) {
  "use strict";

  function validateDiagnosticMappings(enrollment) {
    var mappings = enrollment && enrollment.diagnosticMappings;
    if (!enrollment || !enrollment.deviceId || !mappings || typeof mappings !== "object") {
      return {
        ok: false,
        errors: ["A device enrollment with diagnosticMappings is required"]
      };
    }
    var result = diagnosticChannels.validateMappings(
      mappings,
      enrollment.capabilities || null,
      { pathPrefix: "diagnosticMappings" }
    );
    return {
      ok: result.ok,
      errors: result.findings.map(function (entry) { return entry.message; }),
      findings: result.findings
    };
  }

  function diagnosticIds(enrollments, channels) {
    var ids = new Set();
    (enrollments || []).forEach(function (enrollment) {
      var mappings = enrollment.diagnosticMappings || {};
      (channels || Object.keys(mappings)).forEach(function (channel) {
        if (diagnosticChannels.channelEnabled(enrollment, channel)
          && mappings[channel].diagnosticId) {
          ids.add(mappings[channel].diagnosticId);
        }
      });
    });
    return Array.from(ids);
  }

  return {
    channelEnabled: diagnosticChannels.channelEnabled,
    diagnosticIds: diagnosticIds,
    validateDiagnosticMappings: validateDiagnosticMappings
  };
}));
