(function (root, factory) {
  "use strict";

  var fixtures = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = fixtures;
  }
  root.SIQ_FIXTURES = fixtures;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function performance(values) {
    return {
      movesPerEngineHour: values.movesPerEngineHour,
      productiveUtilization: values.productiveUtilization,
      bobtailIdle: values.bobtailIdle,
      fuelPerMove: values.fuelPerMove,
      dataWarnings: values.dataWarnings || [],
      carryover: values.carryover,
      coupledMoving: values.coupledMoving,
      bobtailMoving: values.bobtailMoving,
      coupledIdle: values.coupledIdle,
      engineHours: values.engineHours,
      fuelConsumed: values.fuelConsumed,
      estimatedBobtailIdleFuel: values.estimatedBobtailIdleFuel,
      speedingEventCount: values.speedingEventCount,
      longestSpeedingEvent: values.longestSpeedingEvent,
      maximumSpeedExceedance: values.maximumSpeedExceedance,
      priorComparison: values.priorComparison,
      stateSegments: values.stateSegments,
      capabilities: values.capabilities || {
        fifthWheelStatus: true,
        verifiedMoves: true,
        engineHours: true,
        fuel: true,
        speed: true,
        driverIdentification: false
      },
      priorMetrics: values.priorMetrics || {},
      distributionMinutes: values.distributionMinutes || {},
      trends: values.trends || {}
    };
  }

  function trendPoints(current, prior, facilityCurrent, missingIndex) {
    var labels = ["06:00", "08:00", "10:00", "12:00", "14:00"];
    var dayLabels = ["Jul 25", "Jul 26", "Jul 27", "Jul 28", "Jul 29"];
    return labels.map(function (label, index) {
      var ratio = index / (labels.length - 1);
      var value = prior + (current - prior) * ratio;
      var facilityStart = facilityCurrent * 0.96;
      var facilityValue = facilityStart + (facilityCurrent - facilityStart) * ratio;
      return {
        label: label,
        dayLabel: dayLabels[index],
        customLabel: "Jul 29 " + label,
        value: index === missingIndex ? null : Number(value.toFixed(1)),
        facilityAverage: Number(facilityValue.toFixed(1))
      };
    });
  }

  function applyPerformanceFixture(unit, values) {
    var record = unit.performance;
    record.capabilities = Object.assign({
      fifthWheelStatus: true,
      verifiedMoves: true,
      engineHours: true,
      fuel: true,
      speed: true,
      driverIdentification: false
    }, values.capabilities || {});
    record.idleMinutes = values.current.idleTime;
    record.priorMetrics = values.prior;
    record.distributionMinutes = values.distribution;
    record.trends = {};
    [
      "movesPerEngineHour",
      "productiveUtilization",
      "fuelPerMove",
      "idleTime",
      "timeOverLimit",
      "engineHours"
    ].forEach(function (metricKey) {
      var current = values.current[metricKey];
      var prior = values.prior[metricKey];
      if (current === null || prior === null) {
        return;
      }
      record.trends[metricKey] = trendPoints(
        current,
        prior,
        values.facility[metricKey],
        values.missingTrendMetric === metricKey ? 2 : -1
      );
    });
  }

  var units = [
    {
      id: "demo-device-101",
      name: "Yard Tractor A01",
      state: "Coupled Moving",
      stateKey: "coupled-moving",
      duration: "12m",
      moves: 8,
      moveInProgress: true,
      speed: 11,
      fifthWheelStatus: "Trailer Coupled",
      lastMove: "14:08",
      fuel: 71,
      def: 66,
      engineHours: "4,182.4",
      freshness: "18s",
      quality: "",
      alert: "New completed move",
      topSpeed: 18,
      overSpeed: "4m",
      recentMoves: ["14:08 completed", "13:42 completed", "13:16 coupled movement"],
      performance: performance({
        movesPerEngineHour: "3.1",
        productiveUtilization: "76%",
        bobtailIdle: "12m",
        fuelPerMove: "0.8 gal",
        carryover: "1 inbound carryover fixture",
        coupledMoving: "1h 36m",
        bobtailMoving: "38m",
        coupledIdle: "42m",
        engineHours: "2h 35m",
        fuelConsumed: "6.4 gal",
        estimatedBobtailIdleFuel: "0.4 gal",
        speedingEventCount: 2,
        longestSpeedingEvent: "2m",
        maximumSpeedExceedance: "3 mph",
        priorComparison: "Moves up 14%; fuel per move down 8%",
        stateSegments: [
          { label: "Coupled moving", value: "1h 36m", percent: 42, key: "coupled-moving" },
          { label: "Bobtail moving", value: "38m", percent: 17, key: "bobtail-moving" },
          { label: "Coupled idle", value: "42m", percent: 19, key: "coupled-idle" },
          { label: "Bobtail idle", value: "12m", percent: 6, key: "bobtail-idle" }
        ]
      })
    },
    {
      id: "demo-device-102",
      name: "Yard Tractor A02",
      state: "Key On — Engine Not Running",
      stateKey: "key-on-engine-not-running",
      duration: "5m",
      moves: 5,
      moveInProgress: false,
      speed: 9,
      fifthWheelStatus: "Trailer Uncoupled",
      lastMove: "13:54",
      fuel: 48,
      def: 52,
      engineHours: "3,902.8",
      freshness: "24s",
      quality: "Speed review",
      alert: "Time over speed limit",
      topSpeed: 21,
      overSpeed: "6m",
      recentMoves: ["13:54 completed", "13:12 bobtail reposition", "12:38 completed"],
      performance: performance({
        movesPerEngineHour: "2.2",
        productiveUtilization: "61%",
        bobtailIdle: "28m",
        fuelPerMove: "1.1 gal",
        carryover: "No carryover moves",
        coupledMoving: "1h 04m",
        bobtailMoving: "52m",
        coupledIdle: "31m",
        engineHours: "2h 18m",
        fuelConsumed: "5.5 gal",
        estimatedBobtailIdleFuel: "0.9 gal",
        speedingEventCount: 3,
        longestSpeedingEvent: "3m",
        maximumSpeedExceedance: "6 mph",
        priorComparison: "Moves down 1; over-limit time up 4m",
        stateSegments: [
          { label: "Coupled moving", value: "1h 04m", percent: 29, key: "coupled-moving" },
          { label: "Bobtail moving", value: "52m", percent: 24, key: "bobtail-moving" },
          { label: "Coupled idle", value: "31m", percent: 14, key: "coupled-idle" },
          { label: "Bobtail idle", value: "28m", percent: 13, key: "bobtail-idle" }
        ]
      })
    },
    {
      id: "demo-device-103",
      name: "Yard Tractor A03",
      state: "Unknown",
      stateKey: "unknown-stale",
      duration: "18m",
      moves: 7,
      moveInProgress: false,
      speed: 0,
      fifthWheelStatus: "Trailer Coupled",
      lastMove: "13:47",
      fuel: 63,
      def: 59,
      engineHours: "5,106.1",
      freshness: "31s",
      quality: "Conflicting ignition and RPM evidence",
      alert: "None",
      topSpeed: 16,
      overSpeed: "0m",
      recentMoves: ["13:47 completed", "13:20 completed", "12:55 idle coupled"],
      performance: performance({
        movesPerEngineHour: "3.0",
        productiveUtilization: "72%",
        bobtailIdle: "9m",
        fuelPerMove: "0.7 gal",
        carryover: "1 outbound carryover fixture",
        coupledMoving: "1h 28m",
        bobtailMoving: "31m",
        coupledIdle: "54m",
        engineHours: "2h 20m",
        fuelConsumed: "4.9 gal",
        estimatedBobtailIdleFuel: "0.3 gal",
        speedingEventCount: 0,
        longestSpeedingEvent: "None",
        maximumSpeedExceedance: "0 mph",
        priorComparison: "Productive utilization up 5 pts",
        stateSegments: [
          { label: "Coupled moving", value: "1h 28m", percent: 39, key: "coupled-moving" },
          { label: "Bobtail moving", value: "31m", percent: 14, key: "bobtail-moving" },
          { label: "Coupled idle", value: "54m", percent: 24, key: "coupled-idle" },
          { label: "Bobtail idle", value: "9m", percent: 4, key: "bobtail-idle" }
        ]
      })
    },
    {
      id: "demo-device-104",
      name: "Yard Tractor B01",
      state: "Bobtail Idle",
      stateKey: "bobtail-idle",
      duration: "26m",
      moves: 4,
      moveInProgress: false,
      speed: 0,
      fifthWheelStatus: "Trailer Uncoupled",
      lastMove: "13:10",
      fuel: 34,
      def: 41,
      engineHours: "2,447.9",
      freshness: "44s",
      quality: "Idle review",
      alert: "Bobtail idle threshold",
      topSpeed: 14,
      overSpeed: "0m",
      recentMoves: ["13:10 completed", "12:44 bobtail idle", "12:18 completed"],
      performance: performance({
        movesPerEngineHour: "1.5",
        productiveUtilization: "43%",
        bobtailIdle: "1h 08m",
        fuelPerMove: "1.4 gal",
        carryover: "No carryover moves",
        coupledMoving: "48m",
        bobtailMoving: "29m",
        coupledIdle: "34m",
        engineHours: "2h 40m",
        fuelConsumed: "5.6 gal",
        estimatedBobtailIdleFuel: "1.8 gal",
        speedingEventCount: 0,
        longestSpeedingEvent: "None",
        maximumSpeedExceedance: "0 mph",
        priorComparison: "Bobtail idle up 23m",
        stateSegments: [
          { label: "Coupled moving", value: "48m", percent: 19, key: "coupled-moving" },
          { label: "Bobtail moving", value: "29m", percent: 12, key: "bobtail-moving" },
          { label: "Coupled idle", value: "34m", percent: 14, key: "coupled-idle" },
          { label: "Bobtail idle", value: "1h 08m", percent: 27, key: "bobtail-idle" }
        ]
      })
    },
    {
      id: "demo-device-105",
      name: "Yard Tractor B02",
      state: "Engine Off",
      stateKey: "engine-off",
      duration: "41m",
      moves: 6,
      moveInProgress: false,
      speed: 0,
      fifthWheelStatus: "Trailer Uncoupled",
      lastMove: "12:59",
      fuel: 82,
      def: 77,
      engineHours: "3,318.6",
      freshness: "1m",
      quality: "",
      alert: "None",
      topSpeed: 15,
      overSpeed: "0m",
      recentMoves: ["12:59 completed", "12:23 completed", "11:51 engine off"],
      performance: performance({
        movesPerEngineHour: "2.8",
        productiveUtilization: "69%",
        bobtailIdle: "16m",
        fuelPerMove: "0.9 gal",
        carryover: "No carryover moves",
        coupledMoving: "1h 12m",
        bobtailMoving: "36m",
        coupledIdle: "39m",
        engineHours: "2h 09m",
        fuelConsumed: "5.4 gal",
        estimatedBobtailIdleFuel: "0.5 gal",
        speedingEventCount: 0,
        longestSpeedingEvent: "None",
        maximumSpeedExceedance: "0 mph",
        priorComparison: "No meaningful change",
        stateSegments: [
          { label: "Coupled moving", value: "1h 12m", percent: 35, key: "coupled-moving" },
          { label: "Bobtail moving", value: "36m", percent: 18, key: "bobtail-moving" },
          { label: "Coupled idle", value: "39m", percent: 19, key: "coupled-idle" },
          { label: "Bobtail idle", value: "16m", percent: 8, key: "bobtail-idle" }
        ]
      })
    },
    {
      id: "demo-device-106",
      name: "Yard Tractor C01",
      state: "Unknown or Stale",
      stateKey: "unknown-stale",
      duration: "9m",
      moves: 3,
      moveInProgress: false,
      speed: 0,
      fifthWheelStatus: "Unavailable",
      lastMove: "12:36",
      fuel: 57,
      def: 49,
      engineHours: "4,774.2",
      freshness: "8m",
      quality: "Partial Data",
      alert: "Sensor data stale",
      topSpeed: 12,
      overSpeed: "0m",
      recentMoves: ["12:36 completed", "12:04 Fifth Wheel Status unavailable", "11:40 completed"],
      performance: performance({
        movesPerEngineHour: "1.9",
        productiveUtilization: "51%",
        bobtailIdle: "22m",
        fuelPerMove: "1.2 gal",
        dataWarnings: [
          {
            code: "fifth-wheel-status-unavailable",
            label: "Partial Data",
            message: "Fifth Wheel Status was unavailable for 34 minutes. Move and bobtail metrics may be incomplete.",
            summary: "Some unit metrics are incomplete because Fifth Wheel Status was unavailable during part of the selected period."
          }
        ],
        carryover: "Classification incomplete",
        coupledMoving: "42m",
        bobtailMoving: "34m",
        coupledIdle: "27m",
        engineHours: "1h 36m",
        fuelConsumed: "3.6 gal",
        estimatedBobtailIdleFuel: "0.7 gal",
        speedingEventCount: 0,
        longestSpeedingEvent: "None",
        maximumSpeedExceedance: "0 mph",
        priorComparison: "Move classification unavailable for 34 minutes",
        stateSegments: [
          { label: "Coupled moving", value: "42m", percent: 27, key: "coupled-moving" },
          { label: "Bobtail moving", value: "34m", percent: 22, key: "bobtail-moving" },
          { label: "Coupled idle", value: "27m", percent: 17, key: "coupled-idle" },
          { label: "Bobtail idle", value: "22m", percent: 14, key: "bobtail-idle" }
        ]
      })
    },
    {
      id: "demo-device-107",
      name: "Yard Tractor C02",
      state: "Not Communicating",
      stateKey: "not-communicating",
      duration: "2h 14m",
      moves: 9,
      moveInProgress: false,
      speed: null,
      fifthWheelStatus: "Unavailable",
      lastMove: "11:52",
      fuel: null,
      def: null,
      engineHours: "4,010.0",
      freshness: "2h 14m",
      quality: "Not communicating",
      alert: "No recent telemetry",
      topSpeed: 17,
      overSpeed: "4m",
      recentMoves: ["11:52 completed", "11:14 completed", "10:58 communication lost"],
      performance: performance({
        movesPerEngineHour: "2.6",
        productiveUtilization: "64%",
        bobtailIdle: "19m",
        fuelPerMove: "--",
        dataWarnings: [
          {
            code: "communication-gap",
            label: "Communication Gap",
            message: "The unit stopped reporting for 2 hours 14 minutes. Metrics after 11:52 may be incomplete.",
            summary: "Some unit metrics are incomplete because a communication gap occurred during the selected period."
          },
          {
            code: "fuel-unavailable",
            label: "Fuel Data Unavailable",
            message: "Fuel-per-move and total fuel cannot be calculated for this period.",
            summary: "Fuel-per-move and total fuel are unavailable for an affected unit."
          }
        ],
        carryover: "1 carryover; fixture data partial",
        coupledMoving: "1h 16m",
        bobtailMoving: "41m",
        coupledIdle: "37m",
        engineHours: "3h 28m",
        fuelConsumed: "--",
        estimatedBobtailIdleFuel: "0.6 gal estimated before gap",
        speedingEventCount: 2,
        longestSpeedingEvent: "3m",
        maximumSpeedExceedance: "2 mph",
        priorComparison: "Comparison limited by communication gap",
        stateSegments: [
          { label: "Coupled moving", value: "1h 16m", percent: 29, key: "coupled-moving" },
          { label: "Bobtail moving", value: "41m", percent: 16, key: "bobtail-moving" },
          { label: "Coupled idle", value: "37m", percent: 14, key: "coupled-idle" },
          { label: "Bobtail idle", value: "19m", percent: 7, key: "bobtail-idle" }
        ]
      })
    },
    {
      id: "demo-device-108",
      name: "Calibration Tractor Z01",
      state: "Engine Off",
      stateKey: "engine-off",
      duration: "3h",
      moves: 0,
      moveInProgress: false,
      speed: 0,
      fifthWheelStatus: "Unavailable",
      lastMove: "--",
      fuel: 90,
      def: 90,
      engineHours: "1,000.0",
      freshness: "5m",
      quality: "Unenrolled",
      alert: "Not enrolled",
      topSpeed: 0,
      overSpeed: "0m",
      recentMoves: [],
      performance: performance({
        movesPerEngineHour: "0.0",
        productiveUtilization: "0%",
        bobtailIdle: "0m",
        fuelPerMove: "--",
        dataWarnings: [
          {
            code: "insufficient-data",
            label: "Insufficient Data",
            message: "This fixture unit is not enrolled, so operational metrics are unavailable.",
            summary: "Operational metrics are unavailable for a unit outside the enrolled scope."
          }
        ],
        carryover: "Not enrolled",
        coupledMoving: "0m",
        bobtailMoving: "0m",
        coupledIdle: "0m",
        engineHours: "0m",
        fuelConsumed: "--",
        estimatedBobtailIdleFuel: "--",
        speedingEventCount: 0,
        longestSpeedingEvent: "None",
        maximumSpeedExceedance: "0 mph",
        priorComparison: "Not enrolled",
        stateSegments: [
          { label: "Coupled moving", value: "0m", percent: 0, key: "coupled-moving" },
          { label: "Bobtail moving", value: "0m", percent: 0, key: "bobtail-moving" },
          { label: "Coupled idle", value: "0m", percent: 0, key: "coupled-idle" },
          { label: "Bobtail idle", value: "0m", percent: 0, key: "bobtail-idle" }
        ]
      })
    }
  ];

  function fixtureHealth(values) {
    return Object.assign({
      status: "AVAILABLE",
      reason: null,
      checkEngineLight: "Unavailable",
      activeEngineFaults: 0,
      pendingEngineFaults: 0,
      activeTransmissionFaults: 0,
      pendingTransmissionFaults: 0,
      highestSeverity: "None",
      lastUpdated: "2026-07-29T18:10:00Z",
      noActivePowertrainFaults: true,
      details: []
    }, values || {});
  }

  units.forEach(function (unit) {
    unit.performance.capabilities.powertrainFaultMonitoring = false;
    unit.engineHealth = {
      status: "UNAVAILABLE",
      reason: "CAPABILITY_DISABLED",
      checkEngineLight: "Unavailable",
      activeEngineFaults: null,
      pendingEngineFaults: null,
      activeTransmissionFaults: null,
      pendingTransmissionFaults: null,
      highestSeverity: "Unavailable",
      lastUpdated: null,
      noActivePowertrainFaults: false,
      details: []
    };
  });

  units[0].performance.capabilities.powertrainFaultMonitoring = true;
  units[0].engineHealth = fixtureHealth({
    checkEngineLight: "On",
    activeEngineFaults: 1,
    highestSeverity: "High",
    noActivePowertrainFaults: false,
    details: [{
      category: "ENGINE",
      diagnosticCode: 412,
      failureModeCode: 4,
      description: "Fictional engine oil-pressure circuit signal low",
      state: "Active",
      severity: "High",
      occurrenceCount: 3,
      timestamp: "2026-07-29T18:09:00Z"
    }]
  });
  units[1].performance.capabilities.powertrainFaultMonitoring = true;
  units[1].commercialConfigurationStatus = "NOT_CONFIGURED";
  units[1].engineHealth = fixtureHealth({ checkEngineLight: "Off" });
  units[2].performance.capabilities.powertrainFaultMonitoring = true;
  units[2].engineHealth = fixtureHealth({
    pendingTransmissionFaults: 1,
    highestSeverity: "Medium",
    noActivePowertrainFaults: false,
    details: [{
      category: "TRANSMISSION",
      diagnosticCode: 728,
      failureModeCode: 7,
      description: "Fictional transmission shift actuator response",
      state: "Pending",
      severity: "Medium",
      occurrenceCount: 1,
      timestamp: "2026-07-29T18:07:00Z"
    }]
  });
  units[4].performance.capabilities.powertrainFaultMonitoring = true;
  units[4].engineHealth = fixtureHealth({
    activeTransmissionFaults: 1,
    highestSeverity: "Warning",
    noActivePowertrainFaults: false,
    details: [{
      category: "TRANSMISSION",
      diagnosticCode: 521,
      failureModeCode: 2,
      description: "Fictional transmission input-speed signal",
      state: "Active",
      severity: "Warning",
      occurrenceCount: 2,
      timestamp: "2026-07-29T18:05:00Z"
    }]
  });
  units[5].performance.capabilities.powertrainFaultMonitoring = true;
  units[5].engineHealth = fixtureHealth({
    checkEngineLight: "Off",
    pendingEngineFaults: 1,
    highestSeverity: "Low",
    noActivePowertrainFaults: false,
    details: [{
      category: "ENGINE",
      diagnosticCode: 914,
      failureModeCode: 9,
      description: "Fictional engine sensor update rate",
      state: "Pending",
      severity: "Low",
      occurrenceCount: 1,
      timestamp: "2026-07-29T18:04:00Z"
    }]
  });
  units[6].performance.capabilities.powertrainFaultMonitoring = true;
  units[6].engineHealth.reason = "STALE_FAULT_DATA";

  var lifecycleByDevice = {
    "demo-device-101": {
      assetId: "asset-demo-101",
      customerUnitNumber: "D1",
      fleetsourceUnitNumber: "DEMO-2101",
      displayLabel: "D1 / DEMO-2101",
      role: "CONTRACT_FLEET_UNIT",
      roleLabel: "Contract Fleet Unit",
      operationalStatus: "ACTIVE",
      statusLabel: "Active",
      currentAssignment: "Riverbend Yard",
      homeFacility: "Riverbend Yard",
      leaseStart: "July 1, 2026",
      verifiedMovesLabel: "8",
      groupReconciliation: "MATCHED",
      driverIdentificationStatus: "IDENTIFIED",
      currentDriverDisplayName: "Alex Morgan",
      driverIdentifiedAt: "2026-07-29T17:42:00Z",
      driverAttributionLabel: "Alex Morgan",
      ignitionOn: true,
      odometerMiles: 18426.7,
      engineCoolantTemperatureCelsius: 91,
      driverTimeline: [{
        id: "fixture-driver-event-101",
        timestamp: "2026-07-29T17:42:00Z",
        label: "Driver identified: Alex Morgan"
      }]
    },
    "demo-device-102": {
      assetId: "asset-demo-102",
      customerUnitNumber: null,
      fleetsourceUnitNumber: "DEMO-2102",
      displayLabel: "DEMO-2102",
      role: "ONSITE_SPARE",
      roleLabel: "Onsite Spare",
      operationalStatus: "STANDBY",
      statusLabel: "Standby",
      currentAssignment: "Riverbend Yard",
      homeFacility: "Riverbend Yard",
      leaseStart: "July 1, 2026",
      deploymentState: "Standby",
      lastExercised: "9 days ago",
      verifiedMovesLabel: "Verified Moves Unavailable",
      groupReconciliation: "MATCHED",
      driverIdentificationStatus: "UNATTRIBUTED",
      currentDriverDisplayName: null,
      driverIdentifiedAt: null,
      driverAttributionLabel: "Unattributed",
      driverTimeline: [{
        id: "fixture-driver-event-102-a",
        timestamp: "2026-07-29T16:05:00Z",
        label: "Driver identified: Jordan Lee"
      }, {
        id: "fixture-driver-event-102-b",
        timestamp: "2026-07-29T18:10:00Z",
        label: "Driver cleared"
      }]
    },
    "demo-device-103": {
      assetId: "asset-demo-103",
      customerUnitNumber: null,
      fleetsourceUnitNumber: "DEMO-2103",
      displayLabel: "DEMO-2103",
      role: "ONSITE_SPARE",
      roleLabel: "Onsite Spare",
      operationalStatus: "LOANER_IN_SERVICE",
      statusLabel: "In Service",
      currentAssignment: "Riverbend Yard",
      homeFacility: "Summit Yard",
      leaseStart: "July 1, 2026",
      deploymentState: "In Service",
      coveringUnit: "D8 / DEMO-2198",
      billableDeploymentUsage: "18.4 hr",
      verifiedMovesLabel: "7",
      groupReconciliation: "ASSIGNED_NOT_IN_GROUP",
      driverIdentificationStatus: "UNATTRIBUTED",
      currentDriverDisplayName: null,
      driverIdentifiedAt: null,
      driverAttributionLabel: "Unattributed",
      driverTimeline: []
    },
    "demo-device-104": {
      assetId: "asset-demo-104",
      customerUnitNumber: "L4",
      fleetsourceUnitNumber: "DEMO-2204",
      displayLabel: "L4 / DEMO-2204",
      role: "REGIONAL_LOANER",
      roleLabel: "Regional Loaner",
      operationalStatus: "LOANER_IN_SERVICE",
      statusLabel: "In Service",
      currentAssignment: "Summit Yard",
      homeFacility: "Riverbend Yard",
      leaseStart: "July 1, 2026",
      coveringUnit: "S7 / DEMO-2297",
      verifiedMovesLabel: "4",
      groupReconciliation: "MATCHED",
      driverIdentificationStatus: "UNAVAILABLE",
      currentDriverDisplayName: null,
      driverIdentifiedAt: null,
      driverAttributionLabel: "Driver Identification Unavailable",
      driverTimeline: []
    },
    "demo-device-105": {
      assetId: "asset-demo-105",
      customerUnitNumber: "R5",
      fleetsourceUnitNumber: "DEMO-2205",
      displayLabel: "R5 / DEMO-2205",
      role: "RENTAL",
      roleLabel: "Rental",
      operationalStatus: "ACTIVE",
      statusLabel: "Active",
      currentAssignment: "Summit Yard",
      homeFacility: "Summit Yard",
      leaseStart: "July 16, 2026",
      assignmentReason: "Temporary Capacity",
      deviceHistoryNote: "Device replacement preserved",
      verifiedMovesLabel: "Verified Moves Unavailable",
      groupReconciliation: "MATCHED",
      driverIdentificationStatus: "IDENTIFIED",
      currentDriverDisplayName: "Taylor Reed",
      driverIdentifiedAt: "2026-07-29T19:18:00Z",
      driverAttributionLabel: "Taylor Reed",
      driverTimeline: [{
        id: "fixture-driver-event-105",
        timestamp: "2026-07-29T19:18:00Z",
        label: "Driver identified: Taylor Reed"
      }]
    },
    "demo-device-106": {
      assetId: "asset-demo-106",
      customerUnitNumber: "M6",
      fleetsourceUnitNumber: "DEMO-2306",
      displayLabel: "M6 / DEMO-2306",
      role: "CONTRACT_FLEET_UNIT",
      roleLabel: "Contract Fleet Unit",
      operationalStatus: "OUT_FOR_REPAIR",
      statusLabel: "Out for Repair",
      currentAssignment: "Mesa Depot",
      homeFacility: "Mesa Depot",
      leaseStart: "July 1, 2026",
      verifiedMovesLabel: "Verified Moves Unavailable",
      groupReconciliation: "MATCHED"
    },
    "demo-device-107": {
      assetId: "asset-demo-107",
      customerUnitNumber: "M7",
      fleetsourceUnitNumber: "DEMO-2307",
      displayLabel: "M7 / DEMO-2307",
      role: "RENTAL",
      roleLabel: "Rental",
      operationalStatus: "IN_TRANSIT",
      statusLabel: "In Transit",
      currentAssignment: "Mesa Depot",
      homeFacility: "Summit Yard",
      leaseStart: "July 12, 2026",
      assignmentReason: "Evaluation",
      verifiedMovesLabel: "Verified Moves Unavailable",
      groupReconciliation: "MATCHED"
    }
  };

  units.forEach(function (unit) {
    if (lifecycleByDevice[unit.id]) {
      Object.assign(unit, lifecycleByDevice[unit.id]);
      unit.name = unit.displayLabel;
      if (unit.verifiedMovesLabel === "Verified Moves Unavailable") {
        unit.fifthWheelStatus = "Fifth Wheel Status Unavailable";
      }
    }
  });
  var facilityTrendReference = {
    movesPerEngineHour: 2.7,
    productiveUtilization: 68,
    fuelPerMove: 0.9,
    idleTime: 51,
    timeOverLimit: 3,
    engineHours: 2.4
  };

  applyPerformanceFixture(units[0], {
    current: {
      completedMoves: 8,
      movesPerEngineHour: 3.1,
      productiveUtilization: 76,
      fuelPerMove: 0.8,
      engineHours: 2.6,
      idleTime: 55,
      timeOverLimit: 4
    },
    prior: {
      completedMoves: 6,
      movesPerEngineHour: 2.7,
      productiveUtilization: 72,
      fuelPerMove: 0.9,
      engineHours: 2.4,
      idleTime: 63,
      timeOverLimit: 2
    },
    facility: facilityTrendReference,
    distribution: {
      coupledMoving: 70,
      uncoupledMoving: 30,
      coupledIdle: 35,
      uncoupledIdle: 20,
      off: 300,
      unavailable: 25
    }
  });

  applyPerformanceFixture(units[1], {
    capabilities: {
      fifthWheelStatus: false,
      verifiedMoves: false
    },
    current: {
      completedMoves: null,
      movesPerEngineHour: null,
      productiveUtilization: 61,
      fuelPerMove: null,
      engineHours: 2.3,
      idleTime: 56,
      timeOverLimit: 6
    },
    prior: {
      completedMoves: null,
      movesPerEngineHour: null,
      productiveUtilization: 66,
      fuelPerMove: null,
      engineHours: 2.1,
      idleTime: 42,
      timeOverLimit: 2
    },
    facility: facilityTrendReference,
    distribution: {
      moving: 82,
      idle: 56,
      off: 330,
      unavailable: 12
    }
  });
  units[1].performance.dataWarnings.push({
    code: "fifth-wheel-status-unavailable",
    label: "Fifth Wheel Status Unavailable",
    message: "Fifth Wheel Status is not supported for this unit. Verified move metrics are unavailable.",
    summary: "Verified move metrics exclude a unit without Fifth Wheel Status capability."
  });

  applyPerformanceFixture(units[2], {
    current: {
      completedMoves: 7,
      movesPerEngineHour: 3,
      productiveUtilization: 72,
      fuelPerMove: 0.7,
      engineHours: 2.3,
      idleTime: 45,
      timeOverLimit: 0
    },
    prior: {
      completedMoves: 5,
      movesPerEngineHour: 2.5,
      productiveUtilization: 67,
      fuelPerMove: 0.9,
      engineHours: 2.2,
      idleTime: 58,
      timeOverLimit: 0
    },
    facility: facilityTrendReference,
    missingTrendMetric: "productiveUtilization",
    distribution: {
      coupledMoving: 70,
      uncoupledMoving: 25,
      coupledIdle: 35,
      uncoupledIdle: 10,
      off: 340,
      unavailable: 0
    }
  });

  applyPerformanceFixture(units[3], {
    current: {
      completedMoves: 4,
      movesPerEngineHour: 1.5,
      productiveUtilization: 43,
      fuelPerMove: 1.4,
      engineHours: 2.7,
      idleTime: 80,
      timeOverLimit: 0
    },
    prior: {
      completedMoves: 6,
      movesPerEngineHour: 2.1,
      productiveUtilization: 55,
      fuelPerMove: 1.1,
      engineHours: 2.5,
      idleTime: 57,
      timeOverLimit: 0
    },
    facility: facilityTrendReference,
    distribution: {
      coupledMoving: 55,
      uncoupledMoving: 25,
      coupledIdle: 45,
      uncoupledIdle: 35,
      off: 320,
      unavailable: 0
    }
  });

  applyPerformanceFixture(units[4], {
    current: {
      completedMoves: 6,
      movesPerEngineHour: 2.8,
      productiveUtilization: 69,
      fuelPerMove: 0.9,
      engineHours: 2.2,
      idleTime: 44,
      timeOverLimit: 0
    },
    prior: {
      completedMoves: 6,
      movesPerEngineHour: 2.7,
      productiveUtilization: 68,
      fuelPerMove: 0.9,
      engineHours: 2.1,
      idleTime: 46,
      timeOverLimit: 0
    },
    facility: facilityTrendReference,
    distribution: {
      coupledMoving: 60,
      uncoupledMoving: 25,
      coupledIdle: 30,
      uncoupledIdle: 14,
      off: 351,
      unavailable: 0
    }
  });

  applyPerformanceFixture(units[5], {
    capabilities: {
      fifthWheelStatus: false,
      verifiedMoves: false
    },
    current: {
      completedMoves: null,
      movesPerEngineHour: null,
      productiveUtilization: 51,
      fuelPerMove: null,
      engineHours: 1.6,
      idleTime: 41,
      timeOverLimit: 0
    },
    prior: {
      completedMoves: null,
      movesPerEngineHour: null,
      productiveUtilization: 56,
      fuelPerMove: null,
      engineHours: 1.8,
      idleTime: 34,
      timeOverLimit: 0
    },
    facility: facilityTrendReference,
    distribution: {
      moving: 55,
      idle: 41,
      off: 334,
      unavailable: 50
    }
  });

  applyPerformanceFixture(units[6], {
    capabilities: {
      fifthWheelStatus: false,
      verifiedMoves: false,
      fuel: false
    },
    current: {
      completedMoves: null,
      movesPerEngineHour: null,
      productiveUtilization: 64,
      fuelPerMove: null,
      engineHours: 3.5,
      idleTime: 73,
      timeOverLimit: 4
    },
    prior: {
      completedMoves: null,
      movesPerEngineHour: null,
      productiveUtilization: 62,
      fuelPerMove: null,
      engineHours: 3.1,
      idleTime: 58,
      timeOverLimit: 1
    },
    facility: facilityTrendReference,
    distribution: {
      moving: 135,
      idle: 73,
      off: 204,
      unavailable: 68
    }
  });

  ["demo-device-101", "demo-device-102", "demo-device-103", "demo-device-105"]
    .forEach(function (deviceId) {
      var unit = units.find(function (candidate) {
        return candidate.id === deviceId;
      });
      unit.performance.capabilities.driverIdentification = true;
    });
  var driverOnlyUnit = units.find(function (unit) {
    return unit.id === "demo-device-105";
  });
  driverOnlyUnit.performance.capabilities.fifthWheelStatus = false;
  driverOnlyUnit.performance.capabilities.verifiedMoves = false;

  function enrollment(deviceId, facilityId, displayName) {
    return {
      deviceId: deviceId,
      facilityId: facilityId,
      displayName: displayName,
      capability: {
        movementSpeedThresholdMph: 2,
        engineOnRpmThreshold: 400,
        rpmFreshnessMs: 120000,
        speedFreshnessMs: 120000,
        fifthWheelStatusFreshnessMs: 120000
      },
      diagnosticMappings: {
        rpm: {
          diagnosticId: "fixture-diagnostic-rpm-" + deviceId,
          unit: "rpm"
        },
        speed: {
          diagnosticId: "fixture-diagnostic-speed-" + deviceId,
          unit: "kph"
        },
        fifthWheelStatus: {
          diagnosticId: "fixture-diagnostic-fifth-wheel-" + deviceId,
          unit: "boolean",
          coupledWhen: "LOW"
        },
        fuelUsed: {
          diagnosticId: "fixture-diagnostic-fuel-used-" + deviceId,
          unit: "liters"
        },
        fuelLevel: {
          diagnosticId: "fixture-diagnostic-fuel-level-" + deviceId,
          unit: "percent"
        },
        defLevel: {
          diagnosticId: "fixture-diagnostic-def-" + deviceId,
          unit: "percent"
        },
        engineHours: {
          diagnosticId: "fixture-diagnostic-engine-hours-" + deviceId,
          unit: "seconds"
        }
      },
      commissionedAt: "2026-06-01T08:00:00-04:00",
      lastVerifiedAt: "2026-07-29T09:30:00-04:00"
    };
  }

  function shiftProfile(values) {
    return Object.assign({
      activeWeekdays: [1, 2, 3, 4, 5, 6, 7],
      effectiveFrom: "2026-01-01",
      effectiveThrough: null,
      reportingEnabled: true
    }, values);
  }

  function speedPolicy(values) {
    return Object.assign({
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveThrough: null,
      minimumReportableEventDurationMs: 30000,
      eventCloseGraceMs: 5000,
      missingDataPolicy: "INTERRUPT_EVENT",
      reason: "Fictional fixture policy"
    }, values);
  }

  var riverbendShiftProfiles = [
    shiftProfile({
      id: "shift-profile-riverbend-demo-a",
      facilityId: "facility-riverbend-yard",
      name: "Demo Shift A",
      timezone: "America/New_York",
      startLocalTime: "06:00",
      endLocalTime: "14:00",
      displayOrder: 1
    }),
    shiftProfile({
      id: "shift-profile-riverbend-demo-c",
      facilityId: "facility-riverbend-yard",
      name: "Demo Shift C",
      timezone: "America/New_York",
      startLocalTime: "14:00",
      endLocalTime: "22:00",
      displayOrder: 2
    }),
    shiftProfile({
      id: "shift-profile-riverbend-demo-b",
      facilityId: "facility-riverbend-yard",
      name: "Demo Shift B",
      timezone: "America/New_York",
      startLocalTime: "22:00",
      endLocalTime: "06:00",
      displayOrder: 3
    })
  ];

  var summitShiftProfiles = [
    shiftProfile({
      id: "shift-profile-summit-days",
      facilityId: "facility-summit-yard",
      name: "Demo Day 12",
      timezone: "America/Chicago",
      startLocalTime: "06:00",
      endLocalTime: "18:00",
      displayOrder: 1
    }),
    shiftProfile({
      id: "shift-profile-summit-nights",
      facilityId: "facility-summit-yard",
      name: "Demo Night 12",
      timezone: "America/Chicago",
      startLocalTime: "18:00",
      endLocalTime: "06:00",
      displayOrder: 2
    })
  ];

  var mesaShiftProfiles = [];

  var shiftFixtureSchedules = {
    completeThreeShift24x7: riverbendShiftProfiles,
    completeTwoShift24x7: summitShiftProfiles,
    newYorkDstOvernight: [riverbendShiftProfiles[2]],
    phoenixNoDstOvernight: [mesaShiftProfiles[2]],
    gap: [
      shiftProfile({
        id: "shift-profile-gap-first",
        facilityId: "facility-summit-yard",
        name: "Gap Fixture First",
        timezone: "America/Chicago",
        startLocalTime: "00:00",
        endLocalTime: "08:00"
      }),
      shiftProfile({
        id: "shift-profile-gap-second",
        facilityId: "facility-summit-yard",
        name: "Gap Fixture Second",
        timezone: "America/Chicago",
        startLocalTime: "09:00",
        endLocalTime: "00:00"
      })
    ],
    overlap: [
      shiftProfile({
        id: "shift-profile-overlap-first",
        facilityId: "facility-summit-yard",
        name: "Overlap Fixture First",
        timezone: "America/Chicago",
        startLocalTime: "00:00",
        endLocalTime: "13:00"
      }),
      shiftProfile({
        id: "shift-profile-overlap-second",
        facilityId: "facility-summit-yard",
        name: "Overlap Fixture Second",
        timezone: "America/Chicago",
        startLocalTime: "12:00",
        endLocalTime: "00:00"
      })
    ]
  };

  function billingProfile(unit, facilityId, role, status, leaseStart, customerId) {
    return {
      assetId: unit.assetId,
      customerId: customerId || "customer-harbor-cartage",
      roadVehicle: true,
      vin: "FICTIONALVIN" + unit.assetId.slice(-3).padStart(6, "0"),
      fleetsourceUnitNumber: unit.fleetsourceUnitNumber,
      role: role,
      homeFacilityId: facilityId,
      customerUnitNumberHistory: unit.customerUnitNumber ? [{
        value: unit.customerUnitNumber,
        effectiveFrom: "2026-01-01T00:00:00Z",
        effectiveThrough: null,
        facilityId: facilityId,
        reason: "Fixture assignment"
      }] : [],
      deviceAssignments: [{
        assignmentId: "device-assignment-" + unit.assetId,
        assetId: unit.assetId,
        myGeotabDeviceId: unit.id,
        installedAt: "2026-01-01T00:00:00Z",
        removedAt: null,
        installationReason: "Fixture commissioning",
        diagnosticProfileVersion: "fixture-v2"
      }],
      facilityAssignments: [{
        assignmentId: "facility-assignment-" + unit.assetId,
        assetId: unit.assetId,
        facilityId: facilityId,
        billingFacilityId: facilityId,
        homeFacilityId: facilityId,
        effectiveFrom: leaseStart,
        effectiveThrough: null,
        operationalStatus: status,
        assignmentReason: role === "RENTAL"
          ? "Temporary Capacity" : "Fixture assignment",
        replacesAssetId: status === "LOANER_IN_SERVICE"
          ? "asset-demo-covered" : null
      }],
      commercialTerms: {
        leaseStartDate: leaseStart,
        leaseEndDate: null,
        billingStartDate: leaseStart,
        billingEndDate: null,
        billingMode: role === "RENTAL"
          ? "RENTAL_ENGINE_HOURS" : "ENGINE_HOURS",
        rateCode: "FIXTURE-RATE",
        engineHourRate: null,
        includedHours: null,
        minimumBillableHours: null,
        maximumBillableHours: null
      },
      capabilities: {
        engineHours: true
      }
    };
  }

  var billingProfiles = [
    billingProfile(units[0], "facility-riverbend-yard",
      "CONTRACT_FLEET_UNIT", "ACTIVE", "2026-07-01T00:00:00Z"),
    billingProfile(units[1], "facility-riverbend-yard",
      "ONSITE_SPARE", "STANDBY", "2026-07-01T00:00:00Z"),
    billingProfile(units[2], "facility-riverbend-yard",
      "ONSITE_SPARE", "LOANER_IN_SERVICE", "2026-07-01T00:00:00Z"),
    billingProfile(units[3], "facility-summit-yard",
      "REGIONAL_LOANER", "ACTIVE", "2026-07-01T00:00:00Z"),
    billingProfile(units[4], "facility-summit-yard",
      "RENTAL", "ACTIVE", "2026-07-16T00:00:00Z"),
    billingProfile(units[5], "facility-mesa-depot",
      "CONTRACT_FLEET_UNIT", "OUT_FOR_REPAIR", "2026-07-01T00:00:00Z",
      "customer-pioneer-parcel"),
    billingProfile(units[6], "facility-mesa-depot",
      "RENTAL", "IN_TRANSIT", "2026-07-12T00:00:00Z",
      "customer-pioneer-parcel")
  ];
  var billingReadingsByAsset = {
    "asset-demo-101": [
      { timestamp: "2026-07-01T00:00:00Z", cumulativeEngineHours: 4100, myGeotabDeviceId: "demo-device-101" },
      { timestamp: "2026-08-01T00:00:00Z", cumulativeEngineHours: 4182.4, myGeotabDeviceId: "demo-device-101" }
    ],
    "asset-demo-102": [
      { timestamp: "2026-07-01T00:00:00Z", cumulativeEngineHours: 3890, myGeotabDeviceId: "demo-device-102" },
      { timestamp: "2026-08-01T00:00:00Z", cumulativeEngineHours: 3902.8, myGeotabDeviceId: "demo-device-102" }
    ],
    "asset-demo-103": [
      { timestamp: "2026-07-01T00:00:00Z", cumulativeEngineHours: 5075, myGeotabDeviceId: "demo-device-103" },
      { timestamp: "2026-08-01T00:00:00Z", cumulativeEngineHours: 5106.1, myGeotabDeviceId: "demo-device-103" }
    ],
    "asset-demo-105": [
      { timestamp: "2026-07-16T00:00:00Z", cumulativeEngineHours: 3300, myGeotabDeviceId: "demo-device-105" },
      { timestamp: "2026-08-01T00:00:00Z", cumulativeEngineHours: 3318.6, myGeotabDeviceId: "demo-device-105" }
    ],
    "asset-demo-106": [
      { timestamp: "2026-07-01T00:00:00Z", cumulativeEngineHours: 4700, myGeotabDeviceId: "demo-device-106" },
      { timestamp: "2026-08-01T00:00:00Z", cumulativeEngineHours: 4774.2, myGeotabDeviceId: "demo-device-106" }
    ],
    "asset-demo-107": [
      { timestamp: "2026-07-12T00:00:00Z", cumulativeEngineHours: 3970, myGeotabDeviceId: "demo-device-107" },
      { timestamp: "2026-08-01T00:00:00Z", cumulativeEngineHours: 4010, myGeotabDeviceId: "demo-device-107" }
    ]
  };

  return {
    defaultUserId: "fixture-user-single-facility-viewer",
    configuration: {
      customers: [
        {
          id: "customer-harbor-cartage",
          displayName: "Harbor Cartage Cooperative",
          reportBranding: {
            title: "SpotterIQ by Fleetsource",
            accentColor: "#f47b20"
          }
        },
        {
          id: "customer-pioneer-parcel",
          displayName: "Pioneer Parcel Labs",
          reportBranding: {
            title: "SpotterIQ by Fleetsource",
            accentColor: "#276f9d"
          }
        }
      ],
      facilities: [
        {
          id: "facility-riverbend-yard",
          customerId: "customer-harbor-cartage",
          displayName: "Riverbend Yard",
          myGeotabGroupId: "group-riverbend-yard",
          timezone: "America/New_York",
          enrolledDeviceIds: ["demo-device-101", "demo-device-102", "demo-device-103"],
          shiftProfileIds: riverbendShiftProfiles.map(function (profile) {
            return profile.id;
          }),
          speedPolicies: [speedPolicy({
            id: "speed-policy-riverbend-demo",
            facilityId: "facility-riverbend-yard",
            speedLimitMph: 15,
            severeSpeedThresholdMph: 20
          })],
          moveThresholds: { minimumCoupledSeconds: 30, staleMoveMinutes: 20 },
          communicationFreshnessThresholds: { freshSeconds: 60, warningSeconds: 300, staleSeconds: 900 },
          reportBranding: { subtitle: "Riverbend Yard fixture reports" }
        },
        {
          id: "facility-summit-yard",
          customerId: "customer-harbor-cartage",
          displayName: "Summit Yard",
          myGeotabGroupId: "group-summit-yard",
          timezone: "America/Chicago",
          enrolledDeviceIds: ["demo-device-104", "demo-device-105"],
          shiftProfileIds: summitShiftProfiles.map(function (profile) {
            return profile.id;
          }),
          speedPolicies: [speedPolicy({
            id: "speed-policy-summit-demo",
            facilityId: "facility-summit-yard",
            speedLimitMph: 12,
            severeSpeedThresholdMph: 16
          })],
          moveThresholds: { minimumCoupledSeconds: 45, staleMoveMinutes: 25 },
          communicationFreshnessThresholds: { freshSeconds: 60, warningSeconds: 360, staleSeconds: 1200 },
          reportBranding: { subtitle: "Summit Yard fixture reports" }
        },
        {
          id: "facility-mesa-depot",
          customerId: "customer-pioneer-parcel",
          displayName: "Mesa Depot",
          myGeotabGroupId: "group-mesa-depot",
          timezone: "America/Phoenix",
          enrolledDeviceIds: ["demo-device-106", "demo-device-107"],
          shiftProfileIds: mesaShiftProfiles.map(function (profile) {
            return profile.id;
          }),
          speedPolicies: [],
          moveThresholds: { minimumCoupledSeconds: 30, staleMoveMinutes: 30 },
          communicationFreshnessThresholds: { freshSeconds: 90, warningSeconds: 420, staleSeconds: 1500 },
          reportBranding: { subtitle: "Mesa Depot fixture reports" }
        }
      ],
      assetEnrollments: [
        enrollment("demo-device-101", "facility-riverbend-yard", "Yard Tractor A01"),
        enrollment("demo-device-102", "facility-riverbend-yard", "Yard Tractor A02"),
        enrollment("demo-device-103", "facility-riverbend-yard", "Yard Tractor A03"),
        enrollment("demo-device-104", "facility-summit-yard", "Yard Tractor B01"),
        enrollment("demo-device-105", "facility-summit-yard", "Yard Tractor B02"),
        enrollment("demo-device-106", "facility-mesa-depot", "Yard Tractor C01"),
        enrollment("demo-device-107", "facility-mesa-depot", "Yard Tractor C02")
      ],
      assetProfiles: billingProfiles,
      shiftProfiles: riverbendShiftProfiles.concat(summitShiftProfiles, mesaShiftProfiles),
      myGeotabGroups: [
        { id: "group-riverbend-yard", deviceIds: ["demo-device-101", "demo-device-102", "demo-device-103", "demo-device-108"] },
        { id: "group-summit-yard", deviceIds: ["demo-device-104", "demo-device-105"] },
        { id: "group-mesa-depot", deviceIds: ["demo-device-106", "demo-device-107"] }
      ],
      users: [
        {
          id: "fixture-user-single-facility-viewer",
          displayName: "Single-Facility Viewer",
          role: "Customer Viewer",
          customerId: "customer-harbor-cartage",
          accessibleDeviceIds: ["demo-device-101", "demo-device-102", "demo-device-104", "demo-device-108"],
          authorizedFacilityIds: ["facility-riverbend-yard"],
          canAdministerSpotterIQ: false
        },
        {
          id: "fixture-user-customer-manager",
          displayName: "Customer Manager",
          role: "Customer Manager",
          customerId: "customer-harbor-cartage",
          accessibleDeviceIds: ["demo-device-101", "demo-device-102", "demo-device-103", "demo-device-104", "demo-device-105", "demo-device-106"],
          authorizedFacilityIds: ["facility-riverbend-yard", "facility-summit-yard", "facility-mesa-depot"],
          canAdministerSpotterIQ: false
        },
        {
          id: "fixture-user-fleetsource-admin",
          displayName: "Fleetsource Administrator",
          role: "Fleetsource Administrator",
          accessibleDeviceIds: ["demo-device-101", "demo-device-102", "demo-device-103", "demo-device-104", "demo-device-105", "demo-device-106", "demo-device-107", "demo-device-108"],
          authorizedFacilityIds: ["facility-riverbend-yard", "facility-summit-yard", "facility-mesa-depot"],
          canAdministerSpotterIQ: true
        }
      ],
      units: units
    },
    shiftFixtureSchedules: shiftFixtureSchedules,
    freshness: {
      age: "Data age 22s",
      checked: "Checked 14:16"
    },
    scope: {
      dateRange: "today",
      shift: "shift-a",
      compare: "prior-equivalent",
      startDate: "2026-07-29",
      startTime: "06:00",
      endDate: "2026-07-29",
      endTime: "14:00"
    },
    dateRanges: [
      { value: "today", label: "Today", start: "Today 00:00", end: "Today 23:59" },
      { value: "yesterday", label: "Yesterday", start: "Yesterday 00:00", end: "Yesterday 23:59" },
      { value: "last-7", label: "Last 7 Days", start: "7 fixture days ago", end: "Today 23:59" },
      { value: "last-30", label: "Last 30 Days", start: "30 fixture days ago", end: "Today 23:59" },
      { value: "this-week", label: "This Week", start: "Fixture week start", end: "Today 23:59" },
      { value: "last-week", label: "Last Week", start: "Prior fixture week start", end: "Prior fixture week end" },
      { value: "custom", label: "Custom Range", start: "", end: "" }
    ],
    shifts: [
      { value: "all-activity", label: "All Activity", hours: "No shift filtering", overnight: false },
      { value: "all-defined", label: "All Defined Shifts", hours: "All configured fixture shifts", overnight: false },
      { value: "shift-a", label: "Demo Shift A", hours: "06:00-14:00", overnight: false },
      { value: "shift-b", label: "Demo Shift B", hours: "22:00-06:00", overnight: true },
      { value: "unassigned", label: "Unassigned Time", hours: "Outside defined fixture shifts", overnight: false },
      { value: "custom-window", label: "Custom Time Window", hours: "Exact fixture start and end", overnight: false }
    ],
    comparisons: [
      { value: "none", label: "No Comparison" },
      { value: "prior-equivalent", label: "Prior Equivalent Period" },
      { value: "prior-shift", label: "Prior Shift" },
      { value: "prior-7-shifts", label: "Prior 7 Shifts" },
      { value: "prior-30", label: "Prior 30 Days" }
    ],
    reports: [
      {
        id: "monthly-usage-summary",
        name: "Monthly Usage Summary",
        description: "Engine-hour usage, approved adjustments, billable hours, and billing exceptions by physical asset.",
        formats: ["Preview"],
        comparison: false,
        requiresShift: false,
        speedCompliance: false
      },
      {
        id: "shift-operations",
        name: "Shift Operations Report",
        description: "Shift closeout summary with unit activity, moves, idle, fuel, and operational exceptions.",
        formats: ["PDF", "XLSX", "CSV"],
        comparison: true,
        requiresShift: true,
        speedCompliance: true
      },
      {
        id: "unit-scorecard",
        name: "Unit Scorecard",
        description: "Unit-level productivity, utilization, fuel, speed, and operational exceptions.",
        formats: ["PDF", "XLSX"],
        comparison: true,
        requiresShift: false,
        speedCompliance: true
      },
      {
        id: "shift-scorecard",
        name: "Shift Scorecard",
        description: "Operational scorecard grouped by configured fixture shift.",
        formats: ["PDF", "XLSX"],
        comparison: true,
        requiresShift: true,
        speedCompliance: true
      },
      {
        id: "move-detail",
        name: "Move Detail Report",
        description: "Detailed completed and carryover move fixture records.",
        formats: ["XLSX", "CSV"],
        comparison: false,
        requiresShift: false,
        speedCompliance: false
      },
      {
        id: "fuel-idle",
        name: "Fuel and Idle Report",
        description: "Fuel use and productive, coupled-idle, and bobtail-idle context.",
        formats: ["PDF", "XLSX"],
        comparison: true,
        requiresShift: false,
        speedCompliance: false
      },
      {
        id: "data-availability",
        name: "Data Availability Report",
        description: "Shows communication gaps and missing Fifth Wheel Status, speed, fuel, or engine data that may affect operational reporting.",
        formats: ["PDF", "CSV"],
        comparison: false,
        requiresShift: false,
        speedCompliance: false
      }
    ],
    monthlyUsageFixture: {
      profiles: billingProfiles,
      readingsByAsset: billingReadingsByAsset,
      adjustmentsByAsset: {
        "asset-demo-102": [{
          type: "NON_BILLABLE_EXERCISE",
          hours: -12.8,
          reason: "Approved standby exercise and maintenance operation",
          approved: true
        }]
      },
      periodStart: "2026-07-01T00:00:00Z",
      periodEnd: "2026-08-01T00:00:00Z",
      boundaryToleranceMs: 86400000
    }
  };
}));
