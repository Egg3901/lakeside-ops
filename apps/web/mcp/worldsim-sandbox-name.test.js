"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { worldsimSandboxName } = require("./worldsim-sandbox-name");

test("same-seed campaign control and treatment use distinct safe sandbox databases", () => {
  const seed = "issue-2119-1991-pilot";
  const off = worldsimSandboxName(seed, "11111111-1111-4111-8111-111111111111", false);
  const on = worldsimSandboxName(seed, "22222222-2222-4222-8222-222222222222", true);
  assert.notEqual(off, on);
  for (const name of [off, on]) assert.match(name, /^[a-zA-Z0-9_-]{1,64}$/);
});

test("legacy jobs retain their existing seed-based sandbox name", () => {
  assert.equal(worldsimSandboxName("same-seed", "first"), "ahd_sim_same-seed");
  assert.equal(worldsimSandboxName("same-seed", "second"), "ahd_sim_same-seed");
});

test("long campaign seed still fits worker validation and Mongo name limits", () => {
  const name = worldsimSandboxName("s".repeat(64), "12345678-1234-1234-1234-123456789abc", false);
  assert.equal(name.length, 61);
  assert.match(name, /^[a-zA-Z0-9_-]{1,64}$/);
});
