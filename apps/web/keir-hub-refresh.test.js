"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { _cache: cache, _cached: cached } = require("./keir-hub-data");

test("cold upstream requests share one fetch and expired snapshots return immediately while refreshing", async () => {
  cache.clear(); let resolve, calls = 0;
  const fn = () => { calls++; return new Promise((done) => { resolve = done; }); };
  const first = cached("single", 60000, fn), second = cached("single", 60000, fn);
  await Promise.resolve(); assert.equal(calls, 1);
  resolve({ value: 1 }); assert.deepEqual(await first, { value: 1 }); assert.deepEqual(await second, { value: 1 });
  cache.get("single").at = cache.get("single").attemptedAt = Date.now() - 120000;
  assert.deepEqual(await cached("single", 60000, fn), { value: 1 });
  assert.equal(calls, 2); assert.ok(cache.get("single").pending);
  assert.deepEqual(await cached("single", 60000, fn), { value: 1 }); assert.equal(calls, 2);
  resolve({ value: 2 }); await cache.get("single").pending;
  assert.deepEqual(await cached("single", 60000, fn), { value: 2 });
});

test("background refresh failure retains last good data and records error without claiming fresh success", async () => {
  cache.clear(); await cached("failing", 60000, async () => [1]);
  const old = Date.now() - 120000; cache.get("failing").at = cache.get("failing").attemptedAt = old;
  assert.deepEqual(await cached("failing", 60000, async () => { throw new Error("upstream unavailable"); }), [1]);
  await cache.get("failing").pending;
  assert.equal(cache.get("failing").at, old); assert.equal(cache.get("failing").error, "upstream unavailable");
});

test("initial failure has no successful timestamp and resolved error envelopes cannot replace good data", async () => {
  cache.clear();
  const initial = await cached("initial-fail", 60000, async () => { throw new Error("offline"); });
  assert.equal(initial.error, "offline"); assert.equal(cache.get("initial-fail").at, null);
  assert.ok(cache.get("initial-fail").attemptedAt > 0);
  await cached("envelope", 60000, async () => [1, 2]);
  const old = Date.now() - 120000; cache.get("envelope").at = cache.get("envelope").attemptedAt = old;
  assert.deepEqual(await cached("envelope", 60000, async () => ({ error: "tool failed" })), [1, 2]);
  await cache.get("envelope").pending;
  assert.deepEqual(cache.get("envelope").value, [1, 2]); assert.equal(cache.get("envelope").at, old); assert.equal(cache.get("envelope").error, "tool failed");
});

test("cold background reads return an explicit unavailable placeholder until success", async () => {
  cache.clear(); let finish;
  assert.equal(await cached("loading", 60000, () => new Promise((done) => { finish = done; }), { initial: null }), null);
  assert.equal(cache.get("loading").at, undefined); assert.ok(cache.get("loading").pending);
  finish([1]); await cache.get("loading").pending;
  assert.deepEqual(await cached("loading", 60000, () => { throw new Error("must not run"); }, { initial: null }), [1]);
});

test("MCP transport, JSON-RPC, tool and payload errors are rejected before caching", async (t) => {
  const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
  const { _mcpCall: mcpCall } = require("./keir-hub-data");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-refresh-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, "mcp.json"); fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { support: { url: "http://127.0.0.1:1/mcp" } } }));
  for (const response of [
    { ok: false, status: 503 },
    { text: async () => JSON.stringify({ error: { message: "RPC unavailable" } }) },
    { text: async () => JSON.stringify({ result: { isError: true, content: [] } }) },
    { text: async () => JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ error: "payload failed" }) }] } }) },
  ]) await assert.rejects(mcpCall("support", "support_list", {}, { configPath, fetchImpl: async () => response }), /503|unavailable|failed/);
});

test("hub first response does not await cold GitHub and labels that source loading", async (t) => {
  const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
  const { buildHubState } = require("./keir-hub-data");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-local-first-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); cache.clear();
  const paths = Object.fromEntries(["ledger", "usage", "harness", "shadow", "release", "env", "mcp"].map((key) => [key, path.join(dir, key)]));
  fs.writeFileSync(paths.ledger, JSON.stringify({ jobs: { root: { id: "root", kind: "ticket", ticket: 1553, state: "waiting" } } }));
  let finish;
  const run = () => new Promise((resolve) => { finish = resolve; });
  const state = await buildHubState({ paths, run, kanban: { list: () => [] } });
  assert.equal(state.throughput.counts.ticketRoots, 1); assert.equal(state.sources.prs, "loading");
  assert.equal(state.sourceFreshness.prs.at, null); assert.equal(state.sourceFreshness.prs.refreshing, true);
  finish({ stdout: "[]" }); await cache.get("prs").pending;
});
