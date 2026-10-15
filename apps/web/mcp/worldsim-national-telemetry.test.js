"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { nationalTelemetry } = require("./worldsim-national-telemetry");

test("keeps full durable national levels and labels a missing historical turn", () => {
  const macro = [];
  const approval = [];
  for (let turn = 1; turn <= 120; turn += 1) {
    if (turn !== 42) macro.push({ country: "US", region: null, metric: "economic.gdp", turn, year: 1953, value: turn });
    macro.push({ country: "US", region: null, metric: "population.population", turn, year: 1953, value: 1000 + turn });
    approval.push({ country: "US", region: null, turn, year: 1953, approval: 50 });
  }
  const result = nationalTelemetry({ country: "US", durableApproval: approval, durableMacro: macro, legacyApproval: [{ turn: 120, value: 1 }], legacyGdpGrowth: [], legacyPopulationGrowth: [], toTurn: 120 });
  assert.equal(result.source, "durable");
  assert.equal(result.gdpLevels.length, 119);
  assert.equal(result.populationLevels.length, 120);
  assert.deepEqual(result.coverage.gdp.missingTurns, [42]);
  assert.deepEqual(result.coverage.population.missingTurns, []);
  assert.equal(result.approval.length, 120);
});

test("a partial durable run never fills gaps with bounded legacy projections", () => {
  const result = nationalTelemetry({ country: "US", durableApproval: [{ country: "US", region: null, turn: 2, approval: 50 }], durableMacro: [], legacyApproval: [{ turn: 2, value: 70 }], legacyGdpGrowth: [{ turn: 2, value: 2 }], legacyPopulationGrowth: [], toTurn: 2 });
  assert.equal(result.source, "durable");
  assert.deepEqual(result.gdpLevels, []);
  assert.deepEqual(result.coverage.gdp.missingTurns, [1, 2]);
  assert.deepEqual(result.gdpGrowth, []);
});

test("a country missing every durable point stays missing in a durable run", () => {
  const result = nationalTelemetry({ country: "US", durableApproval: [], durableMacro: [], hasDurableRun: true, legacyApproval: [{ turn: 2, value: 70 }], legacyGdpGrowth: [], legacyPopulationGrowth: [], toTurn: 2 });
  assert.equal(result.source, "durable");
  assert.deepEqual(result.approval, []);
  assert.deepEqual(result.coverage.approval.missingTurns, [1, 2]);
});

test("older runs retain an explicitly labeled bounded fallback", () => {
  const legacy = [{ turn: 100, value: 2 }];
  const result = nationalTelemetry({ country: "US", durableApproval: [], durableMacro: [], sourceCapability: "legacy", legacyApproval: [], legacyGdpGrowth: legacy, legacyPopulationGrowth: [], toTurn: 120 });
  assert.equal(result.source, "legacy-bounded");
  assert.equal(result.gdpGrowth, legacy);
  assert.equal(result.coverage, null);
});

test("a modern zero-row run is unavailable, never a legacy reconstruction", () => {
  const result = nationalTelemetry({ country: "US", durableApproval: [], durableMacro: [], sourceCapability: "required", legacyApproval: [{ turn: 120, value: 50 }], legacyGdpGrowth: [{ turn: 120, value: 2 }], legacyPopulationGrowth: [], toTurn: 120 });
  assert.equal(result.source, "unavailable");
  assert.deepEqual(result.approval, []);
  assert.deepEqual(result.gdpGrowth, []);
  assert.equal(result.coverage.gdp.missingTurns.length, 120);
});

test("an unknown source also fails closed when no durable rows exist", () => {
  const result = nationalTelemetry({ country: "US", durableApproval: [], durableMacro: [], legacyApproval: [{ turn: 3, value: 50 }], legacyGdpGrowth: [], legacyPopulationGrowth: [], toTurn: 3 });
  assert.equal(result.source, "unavailable");
  assert.deepEqual(result.coverage.approval.missingTurns, [1, 2, 3]);
});
