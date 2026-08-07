(function (root, factory) {
  "use strict";

  var identity = typeof module === "object" && module.exports
    ? require("./asset-identity")
    : root.SIQ_ASSET_IDENTITY;
  var api = factory(identity);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_ASSET_ASSIGNMENTS = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (identity) {
  "use strict";

  var DEPLOYMENT_ROLES = ["ONSITE_SPARE", "REGIONAL_LOANER", "RENTAL"];

  function finding(path, code, message) {
    return { path: path, code: code, message: message };
  }

  function text(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function validateAssignments(profile) {
    var assignments = profile && profile.facilityAssignments || [];
    var findings = identity.validateEffectiveHistory(assignments, {
      path: "facilityAssignments",
      fromKey: "effectiveFrom",
      throughKey: "effectiveThrough",
      overlapCode: "FACILITY_ASSIGNMENT_OVERLAP",
      overlapMessage: "Facility assignments may not overlap without a reviewed exception"
    });
    // Historical entitlement must have one unambiguous owner at every exact
    // timestamp. Reviewed exceptions may describe a business condition, but
    // they cannot authorize overlapping customer or facility visibility.
    assignments.forEach(function (assignment, index) {
      var path = "facilityAssignments[" + index + "]";
      [
        "assignmentId",
        "assetId",
        "facilityId",
        "billingFacilityId",
        "homeFacilityId",
        "operationalStatus",
        "assignmentReason"
      ].forEach(function (key) {
        if (!text(assignment && assignment[key])) {
          findings.push(finding(path + "." + key, "INVALID_FACILITY_ASSIGNMENT",
            key + " is required"));
        }
      });
      if (assignment && profile && assignment.assetId !== profile.assetId) {
        findings.push(finding(path + ".assetId", "ASSET_ASSIGNMENT_MISMATCH",
          "Assignment assetId must match the physical asset"));
      }
      if (assignment && !Object.prototype.hasOwnProperty.call(
        identity.OPERATIONAL_STATUSES, assignment.operationalStatus
      )) {
        findings.push(finding(path + ".operationalStatus",
          "INVALID_OPERATIONAL_STATUS", "Operational status is not supported"));
      }
      if (assignment && DEPLOYMENT_ROLES.indexOf(profile.role) !== -1
        && assignment.operationalStatus === "LOANER_IN_SERVICE"
        && !text(assignment.replacesAssetId)) {
        findings.push(finding(path + ".replacesAssetId",
          "COVERED_ASSET_REQUIRED",
          "An in-service spare, loaner, or rental must identify the covered asset"));
      }
    });
    return { ok: findings.length === 0, findings: findings };
  }

  function resolveAssignment(profile, timestamp) {
    return identity.resolveEffective(profile && profile.facilityAssignments,
      timestamp, "effectiveFrom", "effectiveThrough");
  }

  function assignmentChanges(profile, start, end) {
    var startMs = Date.parse(start);
    var endMs = Date.parse(end);
    return (profile && profile.facilityAssignments || []).filter(function (assignment) {
      var assignmentStart = Date.parse(assignment.effectiveFrom);
      var assignmentEnd = assignment.effectiveThrough
        ? Date.parse(assignment.effectiveThrough)
        : Infinity;
      return assignmentStart < endMs && assignmentEnd > startMs;
    }).map(function (assignment) {
      return Object.assign({}, assignment);
    });
  }

  function deploymentMetrics(profile, periodStart, periodEnd, readings) {
    var deployments = assignmentChanges(profile, periodStart, periodEnd)
      .filter(function (assignment) {
        return assignment.operationalStatus === "LOANER_IN_SERVICE";
      });
    var hours = 0;
    deployments.forEach(function (deployment) {
      var matching = (readings || []).filter(function (reading) {
        var time = Date.parse(reading.timestamp);
        return time >= Date.parse(deployment.effectiveFrom)
          && time < Date.parse(deployment.effectiveThrough || periodEnd);
      }).sort(function (left, right) {
        return Date.parse(left.timestamp) - Date.parse(right.timestamp);
      });
      if (matching.length > 1) {
        hours += matching[matching.length - 1].cumulativeEngineHours
          - matching[0].cumulativeEngineHours;
      }
    });
    return {
      deploymentCount: deployments.length,
      engineHoursByDeployment: hours,
      facilitiesSupported: Array.from(new Set(deployments.map(function (item) {
        return item.facilityId;
      }))),
      assetsReplaced: Array.from(new Set(deployments.map(function (item) {
        return item.replacesAssetId;
      }).filter(Boolean)))
    };
  }

  return {
    DEPLOYMENT_ROLES: DEPLOYMENT_ROLES.slice(),
    assignmentChanges: assignmentChanges,
    deploymentMetrics: deploymentMetrics,
    resolveAssignment: resolveAssignment,
    validateAssignments: validateAssignments
  };
}));
