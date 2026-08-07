(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_ADDIN_IDENTITY = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /*
   * Generated once on 2026-07-30 using Geotab's documented encoded-GUID
   * algorithm. This value identifies SpotterIQ v4 AddInData across deployments.
   */
  var SOURCE_GUID = "91060de4-4c36-48c2-b122-f4bf590debb6";
  var SPOTTERIQ_V4_ADDIN_ID = "aTEwNjBkZTQtNGMzNi00OGM";
  var ENCODED_GUID_PATTERN = /^a[A-Za-z0-9_-]{22}$/;

  function base64Ascii(value) {
    if (typeof btoa === "function") {
      return btoa(value);
    }
    if (typeof Buffer === "function") {
      return Buffer.from(value, "ascii").toString("base64");
    }
    throw new Error("A Base64 encoder is required to validate an encoded GUID");
  }

  function encodeGuid(guid) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(guid)) {
      throw new TypeError("A canonical GUID is required");
    }
    var encoded = base64Ascii(guid).replace(/\//g, "_").replace(/\+/g, "-");
    return "a" + encoded.substring(1, 23);
  }

  function isValidEncodedGuid(value) {
    return ENCODED_GUID_PATTERN.test(value);
  }

  return Object.freeze({
    SOURCE_GUID: SOURCE_GUID,
    SPOTTERIQ_V4_ADDIN_ID: SPOTTERIQ_V4_ADDIN_ID,
    encodeGuid: encodeGuid,
    isValidEncodedGuid: isValidEncodedGuid
  });
}));
