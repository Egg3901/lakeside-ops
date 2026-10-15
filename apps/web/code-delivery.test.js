"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { deriveDeliveryState } = require("./code-delivery");

test("delivery state calls out uncommitted work", () => {
  const state = deriveDeliveryState({ branch: "feature/ui", dirty: 3, ahead: 0 });
  assert.equal(state.phase, "changes");
  assert.equal(state.steps[0].state, "active");
  assert.equal(state.steps[1].state, "next");
});

test("delivery state presents open PRs and failed checks", () => {
  const state = deriveDeliveryState({
    branch: "feature/ui",
    ahead: 2,
    pr: {
      number: 42,
      state: "OPEN",
      statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }],
    },
  });
  assert.equal(state.phase, "blocked");
  assert.equal(state.steps[2].label, "PR #42");
  assert.equal(state.steps[2].state, "failed");
});

test("delivery state recognizes a completed promotion chain", () => {
  const state = deriveDeliveryState({
    branch: "development",
    developmentInStaging: true,
    stagingInMaster: true,
  });
  assert.equal(state.phase, "complete");
  assert.ok(state.steps.every((step) => step.state === "done"));
});
