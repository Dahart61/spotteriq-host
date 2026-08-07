(function (root, factory) {
  "use strict";

  var timezone = typeof module === "object" && module.exports
    ? require("./timezone")
    : root.SIQ_TIMEZONE;
  var shifts = typeof module === "object" && module.exports
    ? require("./shifts")
    : root.SIQ_SHIFTS;
  var api = factory(timezone, shifts);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SIQ_INTERVALS = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (timezone, shifts) {
  "use strict";

  var FILTER_MODES = Object.freeze({
    ALL_ACTIVITY: "all-activity",
    ALL_DEFINED_SHIFTS: "all-defined-shifts",
    SPECIFIC_SHIFT_PROFILE: "specific-shift-profile",
    UNASSIGNED_TIME: "unassigned-time",
    CUSTOM_EXACT_TIME_RANGE: "custom-exact-time-range"
  });

  function exactMilliseconds(value, label) {
    if (!(value instanceof Date)
      && (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value))) {
      throw new RangeError(
        (label || "Exact instant") + " must include Z or an explicit UTC offset"
      );
    }
    var milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
    if (!Number.isFinite(milliseconds)) {
      throw new RangeError((label || "Exact instant") + " must be a valid exact date/time");
    }
    return milliseconds;
  }

  function exactRange(start, end) {
    var startMilliseconds = exactMilliseconds(start, "Interval start");
    var endMilliseconds = exactMilliseconds(end, "Interval end");
    if (endMilliseconds <= startMilliseconds) {
      throw new RangeError("Interval end must be after interval start");
    }
    return { start: startMilliseconds, end: endMilliseconds };
  }

  function intervalRecord(start, end, additions) {
    return Object.assign({
      startUtc: new Date(start).toISOString(),
      endUtc: new Date(end).toISOString(),
      durationMinutes: (end - start) / 60000
    }, additions || {});
  }

  function occurrenceRange(occurrence) {
    return {
      start: exactMilliseconds(occurrence.startUtc, "Occurrence start"),
      end: exactMilliseconds(occurrence.endUtc, "Occurrence end")
    };
  }

  function findOccurrencesContainingInstant(occurrences, instant) {
    var milliseconds = exactMilliseconds(instant);
    return (occurrences || []).filter(function (occurrence) {
      var range = occurrenceRange(occurrence);
      return range.start <= milliseconds && milliseconds < range.end;
    });
  }

  function findOccurrenceContainingInstant(occurrences, instant) {
    return findOccurrencesContainingInstant(occurrences, instant)[0] || null;
  }

  function findOccurrencesOverlappingInterval(occurrences, start, end) {
    var selected = exactRange(start, end);
    return (occurrences || []).filter(function (occurrence) {
      var range = occurrenceRange(occurrence);
      return range.start < selected.end && selected.start < range.end;
    });
  }

  function findOccurrencesByProfileId(occurrences, profileId) {
    return (occurrences || []).filter(function (occurrence) {
      return occurrence.shiftProfileId === profileId;
    });
  }

  function findOccurrencesByStartDateRange(occurrences, startDate, endDate) {
    timezone.parseLocalDate(startDate);
    timezone.parseLocalDate(endDate);
    if (timezone.compareLocalDates(endDate, startDate) < 0) {
      throw new RangeError("Occurrence end date may not precede start date");
    }
    return (occurrences || []).filter(function (occurrence) {
      return timezone.compareLocalDates(occurrence.occurrenceDate, startDate) >= 0
        && timezone.compareLocalDates(occurrence.occurrenceDate, endDate) <= 0;
    });
  }

  function mergeUtcIntervals(intervals, clipStart, clipEnd) {
    var normalized = (intervals || []).map(function (interval) {
      var sourceStart = interval.startUtc !== undefined ? interval.startUtc : interval.start;
      var sourceEnd = interval.endUtc !== undefined ? interval.endUtc : interval.end;
      return {
        start: exactMilliseconds(sourceStart),
        end: exactMilliseconds(sourceEnd)
      };
    }).filter(function (interval) {
      if (clipStart !== undefined) {
        interval.start = Math.max(interval.start, clipStart);
      }
      if (clipEnd !== undefined) {
        interval.end = Math.min(interval.end, clipEnd);
      }
      return interval.start < interval.end;
    }).sort(function (left, right) {
      return left.start - right.start || left.end - right.end;
    });

    var merged = [];
    normalized.forEach(function (interval) {
      var previous = merged[merged.length - 1];
      if (previous && interval.start <= previous.end) {
        previous.end = Math.max(previous.end, interval.end);
      } else {
        merged.push({ start: interval.start, end: interval.end });
      }
    });
    return merged.map(function (interval) {
      return intervalRecord(interval.start, interval.end);
    });
  }

  function unassignedIntervalsForExactRange(occurrences, start, end) {
    var selected = exactRange(start, end);
    var covered = mergeUtcIntervals(occurrences || [], selected.start, selected.end);
    var cursor = selected.start;
    var gaps = [];

    covered.forEach(function (interval) {
      var coveredStart = Date.parse(interval.startUtc);
      var coveredEnd = Date.parse(interval.endUtc);
      if (cursor < coveredStart) {
        gaps.push(intervalRecord(cursor, coveredStart));
      }
      cursor = Math.max(cursor, coveredEnd);
    });
    if (cursor < selected.end) {
      gaps.push(intervalRecord(cursor, selected.end));
    }
    return gaps;
  }

  function withLocalLabels(interval, facilityTimezone, additions) {
    return Object.assign({}, interval, {
      startLocalLabel: timezone.formatLocalLabel(interval.startUtc, facilityTimezone),
      endLocalLabel: timezone.formatLocalLabel(interval.endUtc, facilityTimezone)
    }, additions || {});
  }

  function selectedFacilityProfiles(profiles, options) {
    var facilityId = options && options.facilityId;
    var selected = facilityId
      ? profiles.filter(function (profile) {
        return profile.facilityId === facilityId;
      })
      : profiles.slice();
    var facilities = Array.from(new Set(selected.map(function (profile) {
      return profile.facilityId;
    })));
    var timezones = Array.from(new Set(selected.map(function (profile) {
      return profile.timezone;
    })));

    if (!selected.length) {
      throw new RangeError("No shift profiles are available for facility coverage");
    }
    if (facilities.length !== 1 || timezones.length !== 1) {
      throw new RangeError("Coverage analysis requires one facility and one timezone");
    }
    return {
      profiles: selected,
      facilityId: facilities[0],
      timezone: timezones[0]
    };
  }

  function overlappingSegments(occurrences, rangeStart, rangeEnd, facilityTimezone) {
    var points = new Set([rangeStart, rangeEnd]);
    var clipped = [];
    occurrences.forEach(function (occurrence) {
      var range = occurrenceRange(occurrence);
      var start = Math.max(range.start, rangeStart);
      var end = Math.min(range.end, rangeEnd);
      if (start < end) {
        points.add(start);
        points.add(end);
        clipped.push({ occurrence: occurrence, start: start, end: end });
      }
    });

    var sorted = Array.from(points).sort(function (left, right) {
      return left - right;
    });
    var overlaps = [];
    for (var index = 0; index < sorted.length - 1; index += 1) {
      var start = sorted[index];
      var end = sorted[index + 1];
      if (start === end) {
        continue;
      }
      var active = clipped.filter(function (item) {
        return item.start <= start && end <= item.end;
      });
      if (active.length > 1) {
        var profileIds = Array.from(new Set(active.map(function (item) {
          return item.occurrence.shiftProfileId;
        }))).sort();
        var occurrenceIds = active.map(function (item) {
          return item.occurrence.occurrenceId;
        }).sort();
        var previous = overlaps[overlaps.length - 1];
        if (previous
          && Date.parse(previous.endUtc) === start
          && previous.conflictingShiftProfileIds.join("\u0000") === profileIds.join("\u0000")) {
          previous.endUtc = new Date(end).toISOString();
          previous.endLocalLabel = timezone.formatLocalLabel(end, facilityTimezone);
          previous.durationMinutes = (end - Date.parse(previous.startUtc)) / 60000;
          previous.conflictingOccurrenceIds = Array.from(new Set(
            previous.conflictingOccurrenceIds.concat(occurrenceIds)
          )).sort();
        } else {
          overlaps.push(withLocalLabels(intervalRecord(start, end), facilityTimezone, {
            conflictingShiftProfileIds: profileIds,
            conflictingOccurrenceIds: occurrenceIds
          }));
        }
      }
    }
    return overlaps;
  }

  function analyzeFacilityCoverage(profiles, startDate, endDate, options) {
    shifts.assertValidShiftProfiles(profiles);
    timezone.parseLocalDate(startDate);
    timezone.parseLocalDate(endDate);
    if (timezone.compareLocalDates(endDate, startDate) < 0) {
      throw new RangeError("Coverage end date may not precede start date");
    }

    var facility = selectedFacilityProfiles(profiles, options || {});
    var nextDate = timezone.addLocalDays(endDate, 1);
    var startBoundary = timezone.resolveLocalDateTime(
      startDate,
      "00:00",
      facility.timezone,
      options && options.startDisambiguation
    );
    var endBoundary = timezone.resolveLocalDateTime(
      nextDate,
      "00:00",
      facility.timezone,
      options && options.endDisambiguation
    );
    var rangeStart = Date.parse(startBoundary.iso);
    var rangeEnd = Date.parse(endBoundary.iso);
    var occurrences = shifts.generateShiftOccurrences(
      facility.profiles,
      timezone.addLocalDays(startDate, -1),
      endDate
    ).filter(function (occurrence) {
      var range = occurrenceRange(occurrence);
      return range.start < rangeEnd && rangeStart < range.end;
    });
    var coveredIntervals = mergeUtcIntervals(occurrences, rangeStart, rangeEnd).map(function (interval) {
      return withLocalLabels(interval, facility.timezone);
    });
    var gaps = unassignedIntervalsForExactRange(
      occurrences,
      startBoundary.iso,
      endBoundary.iso
    ).map(function (interval) {
      return withLocalLabels(interval, facility.timezone);
    });
    var overlaps = overlappingSegments(
      occurrences,
      rangeStart,
      rangeEnd,
      facility.timezone
    );

    return {
      facilityId: facility.facilityId,
      timezone: facility.timezone,
      localStartDate: startDate,
      localEndDate: endDate,
      rangeStartUtc: startBoundary.iso,
      rangeEndUtc: endBoundary.iso,
      rangeActualElapsedMinutes: (rangeEnd - rangeStart) / 60000,
      occurrences: occurrences,
      coveredIntervals: coveredIntervals,
      gaps: gaps,
      unassignedIntervals: gaps.slice(),
      overlaps: overlaps,
      conflictingShiftProfileIds: Array.from(new Set(overlaps.flatMap(function (interval) {
        return interval.conflictingShiftProfileIds;
      }))).sort(),
      isFullyCovered: gaps.length === 0,
      hasOverlaps: overlaps.length > 0
    };
  }

  function occurrenceIntervals(occurrences, start, end) {
    var selected = exactRange(start, end);
    return mergeUtcIntervals(occurrences, selected.start, selected.end);
  }

  function overlapWarnings(occurrences, start, end) {
    var selected = exactRange(start, end);
    var points = [];
    (occurrences || []).forEach(function (occurrence) {
      var range = occurrenceRange(occurrence);
      var start = Math.max(range.start, selected.start);
      var end = Math.min(range.end, selected.end);
      if (start < end) {
        points.push({ time: start, kind: "start", occurrence: occurrence });
        points.push({ time: end, kind: "end", occurrence: occurrence });
      }
    });
    points = points.sort(function (left, right) {
      if (left.time !== right.time) {
        return left.time - right.time;
      }
      if (left.kind !== right.kind) {
        return left.kind === "end" ? -1 : 1;
      }
      return left.occurrence.occurrenceId.localeCompare(right.occurrence.occurrenceId);
    });

    var active = new Map();
    var conflictingProfileIds = new Set();
    points.forEach(function (point) {
      if (point.kind === "end") {
        active.delete(point.occurrence.occurrenceId);
      } else {
        active.set(point.occurrence.occurrenceId, point.occurrence.shiftProfileId);
      }
      if (active.size > 1) {
        active.forEach(function (profileId) {
          conflictingProfileIds.add(profileId);
        });
      }
    });
    return conflictingProfileIds.size ? [{
      code: "overlapping-reporting-schedules",
      message: "Reporting shift occurrences overlap; returned intervals were merged to prevent double-counting",
      conflictingShiftProfileIds: Array.from(conflictingProfileIds).sort()
    }] : [];
  }

  function resolveFilterIntervals(request) {
    if (!request || typeof request !== "object") {
      throw new TypeError("Filter request is required");
    }
    var mode = request.mode;
    var occurrences = request.occurrences || [];

    if (mode === FILTER_MODES.SPECIFIC_SHIFT_PROFILE) {
      if (!request.profileId) {
        throw new RangeError("Specific Shift requires profileId");
      }
      var matching = findOccurrencesByStartDateRange(
        findOccurrencesByProfileId(occurrences, request.profileId),
        request.startDate,
        request.endDate
      );
      return {
        mode: mode,
        intervals: matching.map(function (occurrence) {
          return intervalRecord(Date.parse(occurrence.startUtc), Date.parse(occurrence.endUtc), {
            occurrenceId: occurrence.occurrenceId,
            shiftProfileId: occurrence.shiftProfileId,
            occurrenceDate: occurrence.occurrenceDate
          });
        }),
        occurrences: matching,
        warnings: []
      };
    }

    var selected = exactRange(request.startUtc, request.endUtc);
    if (mode === FILTER_MODES.ALL_ACTIVITY || mode === FILTER_MODES.CUSTOM_EXACT_TIME_RANGE) {
      return {
        mode: mode,
        intervals: [intervalRecord(selected.start, selected.end)],
        occurrences: [],
        warnings: []
      };
    }
    if (mode === FILTER_MODES.ALL_DEFINED_SHIFTS) {
      var overlapping = findOccurrencesOverlappingInterval(
        occurrences,
        request.startUtc,
        request.endUtc
      );
      return {
        mode: mode,
        intervals: occurrenceIntervals(overlapping, request.startUtc, request.endUtc),
        occurrences: overlapping,
        warnings: overlapWarnings(overlapping, request.startUtc, request.endUtc)
      };
    }
    if (mode === FILTER_MODES.UNASSIGNED_TIME) {
      return {
        mode: mode,
        intervals: unassignedIntervalsForExactRange(
          occurrences,
          request.startUtc,
          request.endUtc
        ),
        occurrences: [],
        warnings: overlapWarnings(occurrences, request.startUtc, request.endUtc)
      };
    }
    throw new RangeError("Unknown interval filter mode: " + mode);
  }

  return {
    FILTER_MODES: FILTER_MODES,
    analyzeFacilityCoverage: analyzeFacilityCoverage,
    findOccurrenceContainingInstant: findOccurrenceContainingInstant,
    findOccurrencesByProfileId: findOccurrencesByProfileId,
    findOccurrencesByStartDateRange: findOccurrencesByStartDateRange,
    findOccurrencesContainingInstant: findOccurrencesContainingInstant,
    findOccurrencesOverlappingInterval: findOccurrencesOverlappingInterval,
    mergeUtcIntervals: mergeUtcIntervals,
    resolveFilterIntervals: resolveFilterIntervals,
    unassignedIntervalsForExactRange: unassignedIntervalsForExactRange
  };
}));
