(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_STAGING_LOG = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var PREFIX = "[SpotterIQ staging]";

  function debugEnabled(search) {
    return /(?:^|[?&])siqDebug=1(?:&|$)/.test(String(search || ""));
  }

  function createLogger(consoleObject, search) {
    var target = consoleObject || {};
    var verbose = debugEnabled(search);
    function write(method, message, detail) {
      if (method !== "error" && !verbose) {
        return;
      }
      var output = PREFIX + " " + message;
      if (typeof target[method] === "function") {
        if (detail === undefined) {
          target[method](output);
        } else {
          target[method](output, detail);
        }
      }
    }
    return {
      debugEnabled: verbose,
      info: function (message, detail) { write("log", message, detail); },
      warn: function (message, detail) { write("warn", message, detail); },
      error: function (message, detail) { write("error", message, detail); }
    };
  }

  return {
    PREFIX: PREFIX,
    createLogger: createLogger,
    debugEnabled: debugEnabled
  };
}));
