"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { requireAdminAuthorization } = require("./heal-authorization");

test("accepts an explicit admin-authorized apply", () => {
  assert.equal(
    requireAdminAuthorization(true, {
      tool: "heal_apply",
      auth: { name: "operator" }
    }),
    null
  );
});

test("rejects a writer without explicit admin authorization", () => {
  const result = requireAdminAuthorization(false, {
    tool: "heal_adhoc_apply",
    auth: { name: "ticket-agent" }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /explicit admin request/);
  assert.match(result.error, /direct operator session may execute/);
  assert.equal(result.operator, "ticket-agent");
});
