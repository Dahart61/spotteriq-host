(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SIQ_SPEED_EVIDENCE = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Curve-logged observations are irregular. Never infer persistence by polling
  // the same point, or bridge a long gap merely because both endpoints move.
  var DEFAULTS = Object.freeze({ minimumSpeedMph: 5, minimumObservations: 3,
    minimumDurationMs: 20000, maximumGapMs: 120000 });
  function configuration(value) {
    var result = Object.assign({}, DEFAULTS, value || {});
    Object.keys(DEFAULTS).forEach(function (key) {
      if (!Number.isFinite(result[key]) || result[key] <= 0) {
        throw new RangeError("Invalid movement confirmation " + key);
      }
    });
    if (result.minimumObservations < 2 || !Number.isInteger(result.minimumObservations)) {
      throw new RangeError("Movement confirmation requires multiple observations");
    }
    return result;
  }
  function start(interval) { return Number.isFinite(interval.start) ? interval.start : Date.parse(interval.startUtc); }
  function end(interval) { return Number.isFinite(interval.end) ? interval.end : Date.parse(interval.endUtc); }
  function intervalAt(intervals, instant) {
    var low = 0, high = intervals.length - 1;
    while (low <= high) {
      var index = Math.floor((low + high) / 2), item = intervals[index];
      if (instant < start(item)) { high = index - 1; }
      else if (instant >= end(item)) { low = index + 1; }
      else { return item; }
    }
    return null;
  }
  function running(interval) {
    return Boolean(interval && interval.engineRunning === true && !interval.unavailable);
  }
  function off(interval) {
    return Boolean(interval && interval.state === "ENGINE_OFF" && !interval.unavailable);
  }
  function confirmed(observations, config) {
    return observations.length >= config.minimumObservations
      && Date.parse(observations[observations.length - 1].timestamp)
        - Date.parse(observations[0].timestamp) >= config.minimumDurationMs;
  }
  function offRanges(intervals) {
    var ranges = [];
    intervals.forEach(function (interval) {
      if (!off(interval)) { return; }
      var last = ranges[ranges.length - 1];
      if (last && last.endUtc === interval.startUtc) { last.endUtc = interval.endUtc; }
      else { ranges.push({startUtc: interval.startUtc, endUtc: interval.endUtc}); }
    });
    return ranges;
  }
  function peak(observations) {
    return observations.reduce(function (best, observation) {
      return !best || observation.mph > best.mph ? observation : best;
    }, null);
  }
  function analyze(observations, intervals, window, options) {
    var config = configuration(options);
    var offAuthority = !options || options.engineOffAuthority !== false;
    var ranges = offAuthority ? offRanges(intervals) : [];
    var from = Date.parse(window.startUtc), to = Date.parse(window.endUtc);
    var candidates = observations.filter(function (item) {
      var instant = Date.parse(item.timestamp);
      return Number.isFinite(instant) && instant >= from && instant < to
        && Number.isFinite(item.mph) && item.mph >= 0;
    }).map(function (item) {
      var state = intervalAt(intervals, Date.parse(item.timestamp));
      return Object.assign({}, item, {operational: running(state),
        moving: running(state) && state.moving === true,
        condition: running(state) ? "Operational" : offAuthority && off(state)
          ? "Engine Off movement — unconfirmed" : "Engine state unavailable"});
    }).sort(function (a, b) { return Date.parse(a.timestamp) - Date.parse(b.timestamp); });
    var run = [], runRange = null, episodes = [];
    function finish() {
      if (confirmed(run, config)) {
        var evidence = { firstTimestamp: run[0].timestamp,
          lastTimestamp: run[run.length - 1].timestamp, observationCount: run.length,
          durationSeconds: (Date.parse(run[run.length - 1].timestamp)
            - Date.parse(run[0].timestamp)) / 1000 };
        run.forEach(function (item) { item.condition = "Possible Towing"; item.evidence = evidence; });
        episodes.push(Object.assign({peak: peak(run)}, evidence));
      }
      run = []; runRange = null;
    }
    candidates.forEach(function (item) {
      var instant = Date.parse(item.timestamp), range = intervalAt(ranges, instant);
      // ID-less API boundary interpolations cannot corroborate movement.
      if (!range || !item.stored || item.mph <= config.minimumSpeedMph) { finish(); return; }
      var previous = run[run.length - 1];
      if (previous && (range !== runRange
        || instant - Date.parse(previous.timestamp) > config.maximumGapMs)) { finish(); }
      previous = run[run.length - 1];
      if (previous && instant === Date.parse(previous.timestamp)) { return; }
      runRange = range; run.push(item);
    });
    finish();
    var operational = candidates.filter(function (item) { return item.operational; });
    var excluded = ["Possible Towing", "Engine Off movement — unconfirmed", "Engine state unavailable"]
      .map(function (condition) { return peak(candidates.filter(function (item) {
        return item.condition === condition && item.mph > 0;
      })); }).filter(Boolean);
    return { observations: candidates, operationalObservations: operational,
      operationalPeak: peak(operational), excludedPeaks: excluded, towingEpisodes: episodes };
  }
  function observeLive(previous, observation, engineOff, options) {
    var config = configuration(options), instant = Date.parse(observation && observation.timestamp);
    if (!engineOff || !Number.isFinite(instant) || !Number.isFinite(observation.mph)
      || observation.mph <= config.minimumSpeedMph) { return {observations: [], confirmed: false}; }
    var points = (previous || []).filter(function (point) {
      return Date.parse(point.timestamp) <= instant
        && instant - Date.parse(point.timestamp) <= config.maximumGapMs;
    });
    if (!points.length || instant > Date.parse(points[points.length - 1].timestamp)) {
      points.push(observation);
    }
    return {observations: points, confirmed: confirmed(points, config)};
  }
  // Future exposure metrics use two observed endpoints, bounded gaps, canonical
  // running/moving intervals, and already overlap-resolved driver sessions.
  // No extrapolation after the last observation and no engine-off/Unknown time.
  function timeAboveThresholdMinutes(observations, intervals, sessions, threshold, options) {
    var config = configuration(options), totals = new Map();
    if (!Number.isFinite(threshold) || threshold < 0) { throw new RangeError("Invalid speed threshold"); }
    for (var i = 0; i + 1 < observations.length; i += 1) {
      var left = observations[i], right = observations[i + 1];
      var from = Date.parse(left.timestamp), to = Date.parse(right.timestamp);
      if (!Number.isFinite(left.mph) || !Number.isFinite(right.mph)
        || left.mph <= threshold || to <= from || to - from > config.maximumGapMs) { continue; }
      intervals.filter(function (item) { return running(item) && item.moving; }).forEach(function (state) {
        sessions.filter(function (item) { return item.driverId; }).forEach(function (session) {
          var duration = Math.min(to, end(state), end(session)) - Math.max(from, start(state), start(session));
          if (duration > 0) { totals.set(session.driverId, (totals.get(session.driverId) || 0) + duration / 60000); }
        });
      });
    }
    return totals;
  }
  return {DEFAULTS: DEFAULTS, analyze: analyze, observeLive: observeLive,
    intervalAt: intervalAt, running: running, timeAboveThresholdMinutes: timeAboveThresholdMinutes};
}));
