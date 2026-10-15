const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ticketAutoRepairEnabled } = require("./triage-worker");

test("ticket auto-repair requires an explicit opt-in", () => {
  assert.equal(ticketAutoRepairEnabled({}), false);
  assert.equal(ticketAutoRepairEnabled({ TICKET_AUTO_REPAIR_ENABLED: "0" }), false);
  assert.equal(ticketAutoRepairEnabled({ TICKET_AUTO_REPAIR_ENABLED: "true" }), false);
  assert.equal(ticketAutoRepairEnabled({ TICKET_AUTO_REPAIR_ENABLED: "1" }), true);
});
