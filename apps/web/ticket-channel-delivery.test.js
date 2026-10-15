"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { maybePostTicketChannelUpdate } = require("./ticket-ship-notify");

test("a channel resolution receipt is recorded once without suppressing the closure DM", async () => {
  const ticket = { _id: "ticket-1", ticketNumber: 7, discordChannelId: "channel-1", publicUpdates: [] };
  const writes = [];
  const collection = {
    findOne: async () => ticket,
    updateOne: async (_filter, update) => {
      writes.push(update);
      if (update.$push?.publicUpdates) ticket.publicUpdates.push(update.$push.publicUpdates);
      if (update.$set?.["publicUpdates.$.delivery"]) {
        ticket.publicUpdates[0].delivery = update.$set["publicUpdates.$.delivery"];
        ticket.resolution = { channelDelivery: update.$set["resolution.channelDelivery"] };
      }
      return { modifiedCount: 1 };
    },
  };
  const db = { collection: () => collection };
  let sends = 0;
  const params = {
    ticketNumber: 7,
    key: "resolution:receipt-7",
    kind: "resolution",
    message: "Resolved.",
    receiptUrl: "https://example.com/t/test-token",
    postChannel: async () => { sends++; return { posted: true, id: "message-1", channel: "channel-1" }; },
  };

  const first = await maybePostTicketChannelUpdate(db, params);
  const second = await maybePostTicketChannelUpdate(db, params);

  assert.equal(first.posted, true);
  assert.equal(second.alreadyPosted, true);
  assert.equal(sends, 1);
  assert.equal(ticket.publicUpdates[0].delivery.messageId, "message-1");
  assert.equal(ticket.resolution.channelDelivery.status, "posted");
  assert.ok(writes.some((write) => write.$set?.["resolution.channelDelivery"]?.status === "posted"));
  assert.ok(writes.every((write) => !write.$set?.["resolution.deliveredAt"]));
});
