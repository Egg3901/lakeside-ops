"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { engineHealth } = require("./engine-health");

function fakeDb(turns) {
  return {
    collection(name) {
      if (name === "gameState") return { findOne: async () => ({ currentTurn: 12, currentYear: 1970 }) };
      if (name === "turnLogs") return {
        find() {
          return { sort() { return this; }, limit() { return this; }, async toArray() { return turns; } };
        },
      };
      if (name === "elections") return { countDocuments: async () => 0 };
      if (name === "commodityPrices") return { find: () => ({ toArray: async () => [] }) };
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

test("warning-bearing completed turns do not become failures", async () => {
  const result = await engineHealth(fakeDb([{
    turn: 12,
    success: false,
    durationMs: 1_000,
    warnings: ["non-fatal"],
    phaseStatuses: { economy: { status: "completed" }, optional: { status: "skipped" } },
  }]));

  assert.equal(result.lastTurn.success, true);
  assert.equal(result.recent.failures, 0);
  assert.equal(result.flags.some((flag) => flag.code === "turn-failed"), false);
});

test("an incomplete phase still marks the turn failed", async () => {
  const result = await engineHealth(fakeDb([{
    turn: 12,
    success: false,
    durationMs: 1_000,
    phaseStatuses: { economy: { status: "failed", reason: "boom" } },
  }]));

  assert.equal(result.lastTurn.success, false);
  assert.equal(result.recent.failures, 1);
  assert.equal(result.flags.some((flag) => flag.code === "turn-failed"), true);
});
