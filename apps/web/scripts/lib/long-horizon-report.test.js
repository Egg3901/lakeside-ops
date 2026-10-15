"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeLongHorizonTelemetry } = require("./long-horizon-report");

test("marks partial telemetry non-passing and retains exact missing turns", () => {
  const summary = summarizeLongHorizonTelemetry({
    schemaVersion: 1,
    availability: "observed-partial",
    worldId: "w",
    runId: "r",
    turnRange: { from: 1, to: 3 },
    approval: {
      points: [{ country: "US", region: null, turn: 1, approval: 51 }],
      series: [
        {
          country: "US",
          region: null,
          expectedPoints: 3,
          observedPoints: 1,
          missingTurns: [2, 3],
        },
      ],
    },
    macro: { points: [], series: [] },
  });
  assert.equal(summary.passing, false);
  assert.match(summary.warning, /not complete/);
  assert.deepEqual(summary.coverage[0].missingTurns, [2, 3]);
});

test("does not silently bless legacy reports", () => {
  const summary = summarizeLongHorizonTelemetry(undefined);
  assert.equal(summary.passing, false);
  assert.equal(summary.availability, "legacy-unavailable");
  assert.match(summary.warning, /cannot demonstrate complete/);
});

test("keeps every retained point and aggregates regional macro totals by country", () => {
  const points = Array.from({ length: 12 }, (_, turn) => ({
    country: "US",
    region: "TX",
    turn: turn + 1,
    metric: "economic.gdp",
    value: 100 + turn,
  }));
  const summary = summarizeLongHorizonTelemetry({
    availability: "observed-complete",
    approval: { points: [], series: [] },
    macro: { points, series: [] },
  });
  assert.equal(summary.gdpSeries[0].data.length, 12);
  assert.deepEqual(summary.gdpSeries[0].data.at(-1), { x: 12, y: 111 });
});

test("prefers national macro points instead of double-counting regional detail", () => {
  const summary = summarizeLongHorizonTelemetry({
    availability: "observed-complete",
    approval: { points: [], series: [] },
    macro: {
      points: [
        {
          country: "US",
          region: null,
          turn: 1,
          metric: "population.population",
          value: 300,
        },
        {
          country: "US",
          region: "CA",
          turn: 1,
          metric: "population.population",
          value: 120,
        },
        {
          country: "US",
          region: "TX",
          turn: 1,
          metric: "population.population",
          value: 180,
        },
      ],
      series: [],
    },
  });
  assert.deepEqual(summary.populationSeries[0].data, [{ x: 1, y: 300 }]);
});
