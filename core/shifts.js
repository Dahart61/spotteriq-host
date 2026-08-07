(function (root, factory) {
  "use strict";

  var timezone = typeof module === "object" && module.exports
    ? require("./timezone")
    : root.SIQ_TIMEZONE;
  var api = factory(timezone);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_SHIFTS = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (timezone) {
  "use strict";

  function validationError(field, code, message) {
    return { field: field, code: code, message: message };
  }

  function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function validateShiftProfile(profile) {
    var errors = [];
    var start;
    var end;

    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      return {
        ok: false,
        errors: [validationError("", "invalid-profile", "Shift profile must be an object")]
      };
    }

    ["id", "facilityId", "name"].forEach(function (field) {
      if (!isNonEmptyString(profile[field])) {
        errors.push(validationError(field, "required", field + " is required"));
      }
    });

    if (!timezone.isValidIanaTimeZone(profile.timezone)) {
      errors.push(validationError("timezone", "invalid-timezone", "timezone must be a valid IANA timezone"));
    }

    try {
      start = timezone.parseLocalTime(profile.startLocalTime);
    } catch (error) {
      errors.push(validationError("startLocalTime", "invalid-local-time", error.message));
    }
    try {
      end = timezone.parseLocalTime(profile.endLocalTime);
    } catch (error) {
      errors.push(validationError("endLocalTime", "invalid-local-time", error.message));
    }

    if (start && end && start.hour === end.hour && start.minute === end.minute) {
      errors.push(validationError(
        "endLocalTime",
        "zero-length-shift",
        "Shift start and end may not be equal"
      ));
    }

    if (!Array.isArray(profile.activeWeekdays) || !profile.activeWeekdays.length) {
      errors.push(validationError(
        "activeWeekdays",
        "invalid-weekdays",
        "activeWeekdays must contain at least one ISO weekday"
      ));
    } else {
      var seenWeekdays = new Set();
      profile.activeWeekdays.forEach(function (weekday) {
        if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
          errors.push(validationError(
            "activeWeekdays",
            "invalid-weekday",
            "activeWeekdays values must be ISO weekdays 1 through 7"
          ));
        } else if (seenWeekdays.has(weekday)) {
          errors.push(validationError(
            "activeWeekdays",
            "duplicate-weekday",
            "activeWeekdays may not contain duplicates"
          ));
        }
        seenWeekdays.add(weekday);
      });
    }

    try {
      timezone.parseLocalDate(profile.effectiveFrom);
    } catch (error) {
      errors.push(validationError("effectiveFrom", "invalid-local-date", error.message));
    }

    if (profile.effectiveThrough !== undefined && profile.effectiveThrough !== null) {
      try {
        timezone.parseLocalDate(profile.effectiveThrough);
        if (errors.every(function (item) {
          return item.field !== "effectiveFrom";
        }) && timezone.compareLocalDates(profile.effectiveThrough, profile.effectiveFrom) < 0) {
          errors.push(validationError(
            "effectiveThrough",
            "invalid-effective-range",
            "effectiveThrough may not precede effectiveFrom"
          ));
        }
      } catch (error) {
        errors.push(validationError("effectiveThrough", "invalid-local-date", error.message));
      }
    }

    if (typeof profile.reportingEnabled !== "boolean") {
      errors.push(validationError(
        "reportingEnabled",
        "invalid-reporting-enabled",
        "reportingEnabled must be a boolean"
      ));
    }

    if (profile.displayOrder !== undefined
      && (!Number.isFinite(profile.displayOrder) || profile.displayOrder < 0)) {
      errors.push(validationError(
        "displayOrder",
        "invalid-display-order",
        "displayOrder must be a non-negative finite number"
      ));
    }

    ["startDisambiguation", "endDisambiguation"].forEach(function (field) {
      if (profile[field] !== undefined
        && profile[field] !== "earlier"
        && profile[field] !== "later") {
        errors.push(validationError(
          field,
          "invalid-disambiguation",
          field + " must be earlier or later when supplied"
        ));
      }
    });

    return { ok: errors.length === 0, errors: errors };
  }

  function validateShiftProfiles(profiles) {
    if (!Array.isArray(profiles)) {
      return {
        ok: false,
        errors: [validationError("", "invalid-profiles", "Shift profiles must be an array")]
      };
    }

    var errors = [];
    var ids = new Set();
    profiles.forEach(function (profile, index) {
      validateShiftProfile(profile).errors.forEach(function (error) {
        errors.push(Object.assign({ profileIndex: index, profileId: profile && profile.id }, error));
      });
      if (profile && isNonEmptyString(profile.id)) {
        if (ids.has(profile.id)) {
          errors.push(Object.assign(
            { profileIndex: index, profileId: profile.id },
            validationError("id", "duplicate-profile-id", "Shift profile IDs must be unique")
          ));
        }
        ids.add(profile.id);
      }
    });
    return { ok: errors.length === 0, errors: errors };
  }

  function assertValidShiftProfiles(profiles) {
    var validation = validateShiftProfiles(profiles);
    if (!validation.ok) {
      var error = new RangeError(validation.errors.map(function (item) {
        return (item.profileId ? item.profileId + ": " : "") + item.message;
      }).join("; "));
      error.code = "invalid-shift-configuration";
      error.validationErrors = validation.errors;
      throw error;
    }
    return profiles;
  }

  function wallMinutes(localTime) {
    var parts = timezone.parseLocalTime(localTime);
    return parts.hour * 60 + parts.minute;
  }

  function scheduledWallMinutes(profile) {
    var start = wallMinutes(profile.startLocalTime);
    var end = wallMinutes(profile.endLocalTime);
    return end > start ? end - start : 1440 - start + end;
  }

  function crossesMidnight(profile) {
    return wallMinutes(profile.endLocalTime) < wallMinutes(profile.startLocalTime);
  }

  function isProfileActiveOnDate(profile, occurrenceDate) {
    return profile.reportingEnabled
      && profile.activeWeekdays.indexOf(timezone.isoWeekday(occurrenceDate)) !== -1
      && timezone.compareLocalDates(occurrenceDate, profile.effectiveFrom) >= 0
      && (profile.effectiveThrough === undefined
        || profile.effectiveThrough === null
        || timezone.compareLocalDates(occurrenceDate, profile.effectiveThrough) <= 0);
  }

  function generateOccurrence(profile, occurrenceDate) {
    var overnight = crossesMidnight(profile);
    var endDate = overnight ? timezone.addLocalDays(occurrenceDate, 1) : occurrenceDate;
    var start = timezone.resolveLocalDateTime(
      occurrenceDate,
      profile.startLocalTime,
      profile.timezone,
      profile.startDisambiguation
    );
    var end = timezone.resolveLocalDateTime(
      endDate,
      profile.endLocalTime,
      profile.timezone,
      profile.endDisambiguation
    );
    var scheduled = scheduledWallMinutes(profile);
    var actual = (Date.parse(end.iso) - Date.parse(start.iso)) / 60000;

    if (actual <= 0) {
      var error = new RangeError(
        "Resolved shift duration must be greater than zero"
      );
      error.code = "invalid-resolved-shift-duration";
      throw error;
    }

    return {
      occurrenceId: profile.id + ":" + occurrenceDate,
      shiftProfileId: profile.id,
      facilityId: profile.facilityId,
      shiftName: profile.name,
      occurrenceDate: occurrenceDate,
      timezone: profile.timezone,
      startLocalDateTime: occurrenceDate + "T" + profile.startLocalTime,
      endLocalDateTime: endDate + "T" + profile.endLocalTime,
      startUtc: start.iso,
      endUtc: end.iso,
      scheduledWallMinutes: scheduled,
      actualElapsedMinutes: actual,
      dstAdjustmentMinutes: actual - scheduled,
      crossesMidnight: overnight,
      startOffsetMinutes: start.offsetMinutes,
      endOffsetMinutes: end.offsetMinutes,
      startTimezoneAbbreviation: start.timezoneAbbreviation,
      endTimezoneAbbreviation: end.timezoneAbbreviation
    };
  }

  function generateShiftOccurrences(profiles, startDate, endDate) {
    assertValidShiftProfiles(profiles);
    timezone.parseLocalDate(startDate);
    timezone.parseLocalDate(endDate);
    if (timezone.compareLocalDates(endDate, startDate) < 0) {
      throw new RangeError("Occurrence end date may not precede start date");
    }

    var occurrences = [];
    for (var date = startDate;
      timezone.compareLocalDates(date, endDate) <= 0;
      date = timezone.addLocalDays(date, 1)) {
      profiles.forEach(function (profile) {
        if (isProfileActiveOnDate(profile, date)) {
          occurrences.push(generateOccurrence(profile, date));
        }
      });
    }

    return occurrences.sort(function (left, right) {
      var startDifference = Date.parse(left.startUtc) - Date.parse(right.startUtc);
      if (startDifference) {
        return startDifference;
      }
      return left.shiftProfileId.localeCompare(right.shiftProfileId);
    });
  }

  return {
    assertValidShiftProfiles: assertValidShiftProfiles,
    crossesMidnight: crossesMidnight,
    generateOccurrence: generateOccurrence,
    generateShiftOccurrences: generateShiftOccurrences,
    isProfileActiveOnDate: isProfileActiveOnDate,
    scheduledWallMinutes: scheduledWallMinutes,
    validateShiftProfile: validateShiftProfile,
    validateShiftProfiles: validateShiftProfiles
  };
}));
