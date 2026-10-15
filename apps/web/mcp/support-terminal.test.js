"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildTerminalTicketTrackerPlan,
  syncTerminalTicketTracker,
} = require("./support-terminal");

const RESOLUTION = {
  message: "The placement queue is moving again.",
  actions: [
    {
      label: "Removed the unattainable reserve gate",
      detail: "Verified the next turn.",
    },
  ],
  followUp: "Watch the next few turns.",
};

test("terminal resolution creates a done tracker item when the ticket was never linked", () => {
  const plan = buildTerminalTicketTrackerPlan({
    number: 1333,
    title: "Share Issue",
    existing: { status: "open" },
    resolution: RESOLUTION,
    by: "agent-1",
    nowMs: 1000,
  });

  assert.ok(!plan.error, plan.error);
  assert.equal(plan.trackerItemId, "support-ticket-1333");
  assert.equal(plan.update.$set.status, "done_prod");
  assert.match(plan.update.$set.body, /placement queue is moving again/);
  assert.equal(plan.update.$set.updated_by, "agent-1");
});

test("terminal resolution preserves an existing tracker body while completing it", () => {
  const plan = buildTerminalTicketTrackerPlan({
    number: 1333,
    title: "Share Issue",
    existing: { trackerItemId: "support-ticket-1333" },
    resolution: RESOLUTION,
    by: "agent-1",
    nowMs: 1000,
  });

  assert.ok(!plan.error, plan.error);
  assert.equal(plan.update.$set.status, "done_prod");
  assert.equal(plan.update.$set.body, undefined);
});

test("ticket status is not touched when tracker completion fails", async () => {
  let ticketUpdates = 0;
  await assert.rejects(
    syncTerminalTicketTracker({
      trackerItems: {
        updateOne: async () => {
          throw new Error("tracker unavailable");
        },
      },
      tickets: {
        updateOne: async () => {
          ticketUpdates += 1;
        },
      },
      ticketKey: { ticketNumber: 1333 },
      ticket: { title: "Share Issue" },
      number: 1333,
      resolution: RESOLUTION,
      by: "agent-1",
      now: new Date(1000),
    }),
    /tracker unavailable/,
  );
  assert.equal(ticketUpdates, 0);
});
