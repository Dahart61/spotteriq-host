(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_TIMEZONE = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var formatterCache = new Map();

  function TimezoneResolutionError(code, message, details) {
    this.name = "TimezoneResolutionError";
    this.code = code;
    this.message = message;
    this.details = details || {};
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TimezoneResolutionError);
    }
  }
  TimezoneResolutionError.prototype = Object.create(Error.prototype);
  TimezoneResolutionError.prototype.constructor = TimezoneResolutionError;

  function utcMilliseconds(parts) {
    var date = new Date(0);
    date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
    date.setUTCHours(parts.hour || 0, parts.minute || 0, parts.second || 0, 0);
    return date.getTime();
  }

  function parseLocalDate(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) {
      throw new RangeError("Local date must use YYYY-MM-DD");
    }

    var parts = {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3])
    };
    var date = new Date(utcMilliseconds(parts));
    if (parts.year < 1
      || date.getUTCFullYear() !== parts.year
      || date.getUTCMonth() + 1 !== parts.month
      || date.getUTCDate() !== parts.day) {
      throw new RangeError("Invalid local date: " + value);
    }
    return parts;
  }

  function parseLocalTime(value) {
    var match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ""));
    if (!match) {
      throw new RangeError("Local time must use valid 24-hour HH:mm");
    }
    return {
      hour: Number(match[1]),
      minute: Number(match[2])
    };
  }

  function localDateTimeParts(localDate, localTime) {
    return Object.assign({}, parseLocalDate(localDate), parseLocalTime(localTime), {
      second: 0
    });
  }

  function formatDateParts(parts) {
    return String(parts.year).padStart(4, "0")
      + "-" + String(parts.month).padStart(2, "0")
      + "-" + String(parts.day).padStart(2, "0");
  }

  function addLocalDays(localDate, amount) {
    var parts = parseLocalDate(localDate);
    var date = new Date(utcMilliseconds(parts));
    date.setUTCDate(date.getUTCDate() + amount);
    return formatDateParts({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate()
    });
  }

  function compareLocalDates(left, right) {
    var leftParts = parseLocalDate(left);
    var rightParts = parseLocalDate(right);
    return Math.sign(utcMilliseconds(leftParts) - utcMilliseconds(rightParts));
  }

  function isoWeekday(localDate) {
    var day = new Date(utcMilliseconds(parseLocalDate(localDate))).getUTCDay();
    return day === 0 ? 7 : day;
  }

  function isValidIanaTimeZone(timezone) {
    if (typeof timezone !== "string" || !timezone) {
      return false;
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
      return true;
    } catch (error) {
      return false;
    }
  }

  function requireIanaTimeZone(timezone) {
    if (!isValidIanaTimeZone(timezone)) {
      throw new RangeError("Invalid IANA timezone: " + timezone);
    }
    return timezone;
  }

  function formatter(timezone, includeName) {
    requireIanaTimeZone(timezone);
    var key = timezone + "::" + (includeName ? "name" : "parts");
    if (!formatterCache.has(key)) {
      var options = {
        timeZone: timezone,
        calendar: "iso8601",
        numberingSystem: "latn",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      };
      if (includeName) {
        options.timeZoneName = "short";
      }
      formatterCache.set(key, new Intl.DateTimeFormat("en-CA", options));
    }
    return formatterCache.get(key);
  }

  function zonedParts(instant, timezone, includeName) {
    var date = instant instanceof Date ? instant : new Date(instant);
    if (!Number.isFinite(date.getTime())) {
      throw new RangeError("Invalid exact instant");
    }

    var result = {};
    formatter(timezone, includeName).formatToParts(date).forEach(function (part) {
      if (part.type === "year"
        || part.type === "month"
        || part.type === "day"
        || part.type === "hour"
        || part.type === "minute"
        || part.type === "second") {
        result[part.type] = Number(part.value);
      } else if (part.type === "timeZoneName") {
        result.timeZoneName = part.value;
      }
    });
    return result;
  }

  function offsetMillisecondsAt(instantMilliseconds, timezone) {
    var parts = zonedParts(instantMilliseconds, timezone, false);
    return utcMilliseconds(parts) - instantMilliseconds;
  }

  function sameLocalDateTime(left, right) {
    return left.year === right.year
      && left.month === right.month
      && left.day === right.day
      && left.hour === right.hour
      && left.minute === right.minute
      && left.second === right.second;
  }

  function possibleInstantsForLocalDateTime(localDate, localTime, timezone) {
    requireIanaTimeZone(timezone);
    var target = localDateTimeParts(localDate, localTime);
    var wallMilliseconds = utcMilliseconds(target);
    var offsets = new Set();
    var sampleStep = 6 * 60 * 60 * 1000;
    var sampleRadius = 4 * 24 * 60 * 60 * 1000;

    for (var delta = -sampleRadius; delta <= sampleRadius; delta += sampleStep) {
      offsets.add(offsetMillisecondsAt(wallMilliseconds + delta, timezone));
    }

    var candidates = [];
    offsets.forEach(function (offset) {
      var candidate = wallMilliseconds - offset;
      if (sameLocalDateTime(zonedParts(candidate, timezone, false), target)) {
        candidates.push(candidate);
      }
    });

    return Array.from(new Set(candidates)).sort(function (left, right) {
      return left - right;
    }).map(function (milliseconds) {
      return new Date(milliseconds).toISOString();
    });
  }

  function resolveLocalDateTime(localDate, localTime, timezone, disambiguation) {
    var candidates = possibleInstantsForLocalDateTime(localDate, localTime, timezone);
    var localLabel = localDate + "T" + localTime;

    if (!candidates.length) {
      throw new TimezoneResolutionError(
        "nonexistent-local-time",
        "Nonexistent local boundary " + localLabel + " in " + timezone,
        { localDateTime: localLabel, timezone: timezone }
      );
    }
    if (candidates.length > 1 && disambiguation !== "earlier" && disambiguation !== "later") {
      throw new TimezoneResolutionError(
        "ambiguous-local-time",
        "Ambiguous local boundary " + localLabel + " in " + timezone
          + "; specify earlier or later disambiguation",
        { localDateTime: localLabel, timezone: timezone, candidates: candidates.slice() }
      );
    }

    var iso = candidates.length === 1 || disambiguation === "earlier"
      ? candidates[0]
      : candidates[candidates.length - 1];
    var milliseconds = Date.parse(iso);
    var details = zonedParts(milliseconds, timezone, true);
    return {
      iso: iso,
      offsetMinutes: offsetMillisecondsAt(milliseconds, timezone) / 60000,
      timezoneAbbreviation: details.timeZoneName,
      ambiguous: candidates.length > 1,
      disambiguation: candidates.length > 1 ? disambiguation : null
    };
  }

  function formatLocalLabel(instant, timezone) {
    var parts = zonedParts(instant, timezone, true);
    return formatDateParts(parts)
      + " " + String(parts.hour).padStart(2, "0")
      + ":" + String(parts.minute).padStart(2, "0")
      + " " + parts.timeZoneName;
  }

  return {
    TimezoneResolutionError: TimezoneResolutionError,
    addLocalDays: addLocalDays,
    compareLocalDates: compareLocalDates,
    formatLocalLabel: formatLocalLabel,
    isValidIanaTimeZone: isValidIanaTimeZone,
    isoWeekday: isoWeekday,
    parseLocalDate: parseLocalDate,
    parseLocalTime: parseLocalTime,
    possibleInstantsForLocalDateTime: possibleInstantsForLocalDateTime,
    resolveLocalDateTime: resolveLocalDateTime,
    zonedParts: zonedParts
  };
}));
