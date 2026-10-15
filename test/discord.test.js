"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRuntime } = require("../apps/agent/lib/standalone/runtime");
const { createDiscordChannel, discordSettings } = require("../apps/agent/lib/standalone/discord");
const ownerId = "200000000000000001", botId = "200000000000000002", channelId = "200000000000000003";
const row = (id, text, author = ownerId) => ({ id: String(id), channel_id: channelId, author: { id: author }, content: text });

function fixture(t, execute) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-discord-"));
  const configFile = path.join(dir, "config.json");
  fs.writeFileSync(configFile, JSON.stringify({ state_dir: dir, projects: [{ id: "demo" }], default_route: "claude:fixture@medium" }));
  const runtimes = [], connectors = [], messages = [], sent = [];
  let failSend = false;
  async function call(method, route, body) {
    if (route === "/users/@me") return { id: botId, bot: true };
    if (route === "/users/@me/channels") { assert.equal(body.recipient_id, ownerId); return { id: channelId, type: 1, recipients: [{ id: ownerId }] }; }
    if (method === "GET" && route.endsWith("?limit=1")) return messages.slice(-1);
    if (method === "GET" && route.includes("?after=")) {
      const after = new URL(route, "https://fixture.invalid").searchParams.get("after");
      return messages.filter(m => BigInt(m.id) > BigInt(after)).slice(0, 100).reverse();
    }
    assert.equal(method, "POST"); assert.equal(route, `/channels/${channelId}/messages`);
    assert.deepEqual(body.allowed_mentions, { parse: [] }); assert.equal(body.enforce_nonce, true);
    sent.push(body);
    if (failSend) { failSend = false; throw new Error("Response lost after Discord accepted message"); }
    return { id: `receipt-${sent.length}` };
  }
  function start() {
    const runtime = createRuntime({ configFile, execute, log() {} }); runtimes.push(runtime);
    const connector = createDiscordChannel({ runtime, token: "fixture", ownerId, call }); connectors.push(connector);
    return { runtime, connector };
  }
  t.after(() => { connectors.forEach(c => c.stop()); runtimes.forEach(r => r.stop()); fs.rmSync(dir, { recursive: true, force: true }); });
  return { start, messages, sent, failNextSend() { failSend = true; } };
}
const settle = () => new Promise(r => setImmediate(r));

test("Discord is opt-in and requires an explicitly authorized owner", () => {
  assert.equal(discordSettings({}), null);
  assert.throws(() => discordSettings({ LAKESIDE_DISCORD_BOT_TOKEN: "fixture" }));
  assert.throws(() => discordSettings({ LAKESIDE_DISCORD_OWNER_ID: "invalid", LAKESIDE_DISCORD_BOT_TOKEN: "fixture" }));
  assert.equal(discordSettings({ LAKESIDE_DISCORD_OWNER_ID: ownerId, LAKESIDE_DISCORD_BOT_TOKEN: "fixture" }).ownerId, ownerId);
});

test("ported Discord DMs use the same durable Keir tasks, owner authorization and delivery receipts", async t => {
  let calls = 0;
  const f = fixture(t, async () => { calls++; return { state: "done", outcome: { result: { summary: "Repository inspected. @everyone" } } }; });
  f.messages.push(row(100, "Old instruction must not execute"));
  const { runtime, connector } = f.start();
  await connector.poll(); assert.equal(calls, 0);
  f.messages.push(row(101, "Other user must not execute", botId), { ...row(102, "Webhook must not execute"), webhook_id: "webhook" },
    { ...row(103, "Bot must not execute"), author: { id: ownerId, bot: true } }, row(104, "Inspect my repository"));
  await connector.poll(); await settle(); await connector.poll();
  assert.equal(calls, 1); assert.equal(f.sent.length, 1);
  const jobs = Object.values(runtime.ledger.data.jobs); assert.equal(jobs.length, 1); assert.equal(jobs[0].state, "done");
  assert.ok(runtime.app.view(0, jobs[0].appThread).messages.some(m => m.text === "Inspect my repository"));
  assert.equal(runtime.app.view(0, "main").messages.length, 0);
  // Web-only conversations must not be disclosed to Discord.
  runtime.app.authenticatedPost("Private web conversation", "web-only", "main"); await settle(); await connector.poll();
  assert.equal(f.sent.length, 1);
  await connector.poll(); assert.equal(f.sent.length, 1);
  connector.stop(); runtime.stop();
  const restarted = f.start(); await restarted.connector.poll();
  assert.equal(f.sent.length, 1); assert.equal(calls, 2);
});

test("uncertain Discord deliveries retry with the same nonce and survive restart", async t => {
  const f = fixture(t, async () => ({ state: "done", outcome: { result: { summary: "x".repeat(2100) } } }));
  const { runtime, connector } = f.start(); await connector.poll();
  f.messages.push(row(200, "Inspect the code")); f.failNextSend();
  await assert.rejects(connector.poll());
  assert.equal(f.sent.length, 1); connector.stop(); runtime.stop();
  const next = f.start(); await next.connector.poll();
  assert.equal(f.sent.length, 3); assert.equal(f.sent[0].nonce, f.sent[1].nonce);
  assert.notEqual(f.sent[1].nonce, f.sent[2].nonce);
  assert.equal(f.sent[1].content + f.sent[2].content, "x".repeat(2100));
  await next.connector.poll(); assert.equal(f.sent.length, 3);
});

test("Discord can inspect and cancel its task without cancelling a web task", async t => {
  const signals = [];
  const f = fixture(t, ({ signal }) => new Promise(resolve => {
    signals.push(signal);
    signal.addEventListener("abort", () => resolve({ state: "done", outcome: { result: { summary: "late" } } }));
  }));
  const { runtime, connector } = f.start(); await connector.poll();
  f.messages.push(row(300, "Inspect the code")); await connector.poll(); await settle();
  const job = Object.values(runtime.ledger.data.jobs)[0];
  const web = runtime.app.authenticatedPost("Web task", "web", "main");
  f.messages.push(row(301, `/stop ${web.jobId}`), row(302, "/tasks"), row(303, `/stop ${job.id}`));
  await connector.poll();
  assert.equal(signals[0].aborted, true); assert.equal(job.state, "cancelled");
  assert.notEqual(runtime.ledger.data.jobs[web.jobId].state, "cancelled");
  assert.ok(f.sent.some(s => s.content.includes(`${job.id}: running`)));
  assert.ok(!f.sent.some(s => s.content === "late"));
});
