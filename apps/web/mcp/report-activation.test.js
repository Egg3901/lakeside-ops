"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { activatePublishedReports } = require("./report-activation");

test("publishing activates disk-backed reports without restarting Ops", () => {
  assert.deepEqual(activatePublishedReports(), {
    ok: true,
    skipped: true,
    note: "Report files are live immediately; the Ops service was not restarted.",
  });
});
