"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { nextJob } = require("../lib/operator/scheduling");
const owner = { id: "developer", role: "owner", kind: "command", state: "queued", updatedAt: 1 };
const ticket = { id: "ticket", role: "support", kind: "ticket", state: "queued", updatedAt: 2 };
test("the support slot admits a ready ticket despite a developer backlog", () => {
  assert.equal(nextJob([owner, ticket], { quick: false, preferSupport: true }), ticket);
  assert.equal(nextJob([owner, ticket], { quick: false }), owner);
});
test("the support slot is available to developers when support is absent, deferred or already active", () => {
  assert.equal(nextJob([owner], { quick: false, preferSupport: true }), owner);
  assert.equal(nextJob([owner, ticket], { quick: false, preferSupport: true, supportDeferred: true }), owner);
  assert.equal(nextJob([owner, ticket], { quick: false, preferSupport: true, activeIds: [ticket.id] }), owner);
  assert.equal(nextJob([{ ...ticket, state: "waiting" }, owner], { quick: false, preferSupport: true }), owner);
});
test("quick conversations remain separate and support queues keep oldest-first order", () => {
  const other = { ...ticket, id: "older", updatedAt: 0 };
  const conversation = { ...owner, id: "question", kind: "conversation" };
  assert.equal(nextJob([owner, ticket, other, conversation], { quick: true, preferSupport: false }), conversation);
  assert.equal(nextJob([owner, ticket, other, conversation], { quick: false, preferSupport: true }), other);
});
