"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { renderHtml } = require("./gen-sim-experiment-report");
const { summarizeLongHorizonTelemetry } = require("./lib/long-horizon-report");

function minimalPayload(longHorizon) {
  return {
    runId: "run-1",
    turnLo: 1,
    turnHi: 3,
    runConfig: {},
    govGroups: [],
    wealthRows: [],
    corpLeagueRows: [],
    finalCorpRows: [],
    orgPanels: [],
    corpTurns: [],
    corpCountSeries: [],
    corpMcapSeries: [],
    seatsA: { turns: [], series: [] },
    seatsB: { turns: [], series: [] },
    longHorizon,
  };
}

test("renders partial telemetry as visibly non-passing with exact missing turns", () => {
  const summary = summarizeLongHorizonTelemetry({
    schemaVersion: 1,
    availability: "observed-partial",
    worldId: "world-1",
    runId: "run-1",
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
  const html = renderHtml(minimalPayload(summary), {});
  assert.match(html, /observed-partial/);
  assert.match(html, /Not passing:/);
  assert.match(html, />2, 3</);
  assert.doesNotMatch(html, /Every observed series contains every turn/);
});

test("renders legacy reports without failing and does not claim complete telemetry", () => {
  const html = renderHtml(
    minimalPayload(summarizeLongHorizonTelemetry(undefined)),
    {},
  );
  assert.match(html, /legacy-unavailable/);
  assert.match(html, /No provenance recorded/);
  assert.doesNotMatch(html, /Every observed series contains every turn/);
});
