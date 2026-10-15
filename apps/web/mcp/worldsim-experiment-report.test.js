"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildExperimentReportResponse,
} = require("./worldsim-experiment-report");

test("samples legacy timelines but preserves all long-horizon evidence", () => {
  const telemetry = {
    availability: "observed-partial",
    approval: {
      points: Array.from({ length: 25 }, (_, turn) => ({
        turn,
        approval: 50 + turn,
      })),
      series: [{ expectedPoints: 25, observedPoints: 24, missingTurns: [12] }],
    },
    macro: { points: [], series: [] },
  };
  const result = buildExperimentReportResponse(
    {
      _id: "run-1",
      seatsTimeline: Array.from({ length: 25 }, (_, turn) => ({ turn })),
      partyOrgTimeline: [],
      corporationsTimeline: [],
      longHorizonTelemetry: telemetry,
    },
    10,
  );

  assert.equal(result.seatsTimeline.length, 10);
  assert.strictEqual(result.longHorizonTelemetry, telemetry);
  assert.equal(result.longHorizonTelemetry.approval.points.length, 25);
  assert.deepEqual(
    result.longHorizonTelemetry.approval.series[0].missingTurns,
    [12],
  );
});

test("keeps older experiment reports backward compatible", () => {
  const result = buildExperimentReportResponse(
    {
      _id: "legacy",
      seatsTimeline: [],
      partyOrgTimeline: [],
      corporationsTimeline: [],
    },
    10,
  );
  assert.equal(result.runId, "legacy");
  assert.equal("longHorizonTelemetry" in result, false);
});
