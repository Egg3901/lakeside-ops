"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDiscord } = require("../lib/operator/discord");
test("a transient fetch failure retries the actual channel scan request", async () => {
  let calls = 0;
  const discord = createDiscord({ token: "fixture", sleep: async () => {}, fetchImpl: async () => {
    if (++calls === 1) throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    return new Response(JSON.stringify([{ id: "channel" }]), { status: 200 });
  } });
  assert.deepEqual(await discord("GET", "/guilds/fixture/channels"), [{ id: "channel" }]);
  assert.equal(calls, 2);
});

test("a transient 503 retries but invalid credentials do not", async () => {
  let calls = 0;
  const discord = createDiscord({ token: "fixture", sleep: async () => {}, fetchImpl: async () => ++calls === 1 ? new Response("unavailable", { status: 503 }) : new Response("[]") });
  assert.deepEqual(await discord("GET", "/guilds/fixture/channels"), []); assert.equal(calls, 2);
  let denied = 0;
  const invalid = createDiscord({ token: "fixture", sleep: async () => {}, fetchImpl: async () => { denied++; return new Response("denied", { status: 401 }); } });
  await assert.rejects(invalid("GET", "/guilds/fixture/channels"), (e) => e.status === 401);
  assert.equal(denied, 1);
});

test("network retries stop after three attempts and identify the failing request", async () => {
  let calls = 0;
  const discord = createDiscord({ token: "fixture", sleep: async () => {}, fetchImpl: async () => { calls++; throw new TypeError("fetch failed", { cause: { code: "ETIMEDOUT" } }); } });
  await assert.rejects(discord("GET", "/guilds/fixture/channels"), /GET \/guilds\/fixture\/channels failed after 3 attempt\(s\) \(ETIMEDOUT\)/);
  assert.equal(calls, 3);
});

test("uncertain writes are not replayed; nonce-protected messages can retry", async () => {
  let calls = 0;
  const discord = createDiscord({ token: "fixture", sleep: async () => {}, fetchImpl: async () => { calls++; throw new TypeError("fetch failed"); } });
  await assert.rejects(discord("POST", "/channels/123/messages", { content: "test" }), /1 attempt/);
  assert.equal(calls, 1);
  await assert.rejects(discord("POST", "/channels/123/messages", { content: "test", nonce: "unique", enforce_nonce: true }), /3 attempt/);
  assert.equal(calls, 4);
});

test("one failed scan stays quiet; sustained failure alerts and recovery clears the count", () => {
  const { createScanHealth } = require("../lib/operator/discord");
  const ledger = { data: {} }, health = createScanHealth({ ledger, now: () => 100 });
  const error = new Error("fetch failed");
  assert.equal(health.failure(error), false); assert.equal(health.failure(error), false);
  assert.equal(health.failure(error), true); assert.equal(health.state.failures, 3);
  assert.equal(health.success(), 3); assert.equal(health.state.failures, 0); assert.equal(health.state.lastSuccessAt, 100);
  assert.equal(health.failure(error), false);
  assert.equal(health.failure(Object.assign(new Error("invalid credentials"), { status: 401 })), true);
});
