"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { CHECK_PRESETS } = require("./scheduler-service");
const { schedulerSnapshot } = require("./scheduler-service");
const { makeSchedulerBody } = require("./scheduler-page");

test("exposes only bounded heavy-check presets", () => {
  assert.deepEqual(Object.keys(CHECK_PRESETS), ["typecheck", "test", "verify", "build"]);
  assert.equal(CHECK_PRESETS.verify.join(" "), "npm run verify");
});

test("scheduler snapshot includes CPU, memory, and disk telemetry", async () => {
  const data = await schedulerSnapshot();
  assert.equal(typeof data.host.memory.usedPct, "number");
  assert.equal(typeof data.host.disk.usedPct, "number");
  assert.equal(typeof data.host.cpuCount, "number");
});

test("scheduler page supports mobile and both queue types", () => {
  const page = makeSchedulerBody();
  assert.match(page.extraCss, /@media\(max-width:900px\)/);
  assert.match(page.body, /Checks and builds/);
  assert.match(page.body, /World simulations/);
  assert.match(page.body, /\/api\/scheduler\/checks/);
  assert.match(page.body, /\/api\/scheduler\/worldsims/);
  assert.match(page.body, /Dirty worktrees/);
});
