"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createEventConsumers } = require("./event-consumers");

const row = (id, type, payload = {}) => [id, ["id", `event:${id}`, "type", type, "source", "ahd", "occurredAt", "2026-09-23T01:00:00Z", "payload", JSON.stringify(payload)]];

test("turn and deploy events notify subscribers without exposing payloads", async () => {
  const commands = [];
  const bus = createEventConsumers({ execute: async args => { commands.push(args); return 1; } });
  const received = [];
  bus.subscribe(event => received.push(event));
  await bus.processRows([["lakeside:events", [row("1-0", "turn:completed", { secret: "hidden" }), row("2-0", "deploy:completed")]]]);
  assert.deepEqual(received.map(event => event.type), ["turn:completed", "deploy:completed"]);
  assert.equal(JSON.stringify(received).includes("hidden"), false);
  assert.equal(commands.filter(args => args[0] === "XACK").length, 2);
});

test("failed ticket delivery enters dead letters before acknowledgement and can be replayed", async () => {
  const commands = [];
  let published;
  const bus = createEventConsumers({
    execute: async args => {
      commands.push(args);
      if (args[0] === "XRANGE") return [row("3-0", "ticket:resolved", { summary: "Resolved" })];
      return 1;
    },
    notify: async () => ({ error: "Discord unavailable" }),
    publish: async event => { published = event; return { streamId: "4-0" }; },
  });
  await bus.processRows([["lakeside:events", [row("3-0", "ticket:resolved", { summary: "Resolved" })]]]);
  assert.deepEqual(commands.slice(0, 2).map(args => args[0]), ["XADD", "XACK"]);
  await bus.replayDeadLetter("3-0");
  assert.equal(published.type, "ticket:resolved");
  assert.match(published.id, /:replay:/);
  assert.equal(commands.at(-1)[0], "XDEL");
});
