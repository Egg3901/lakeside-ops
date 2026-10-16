import test from "node:test";
import assert from "node:assert/strict";
import { createPeerMonitor } from "./peer-monitor.mjs";
const peer = { id: "vps", kind: "keir", url: "https://example.com", tokenEnv: "SESSION" };
test("VPS reconnect retains explicitly stale tasks and restores fresh status", async () => {
  let connected = true;
  const monitor = createPeerMonitor({ inspect: async () => connected ? { state: "connected", tasks: [{ id: "work" }], checkedAt: 100, latencyMs: 4 } : { state: "offline", tasks: [], checkedAt: 200, errorKind: "connection" } });
  assert.equal((await monitor.refresh([peer]))[0].stale, false);
  connected = false;
  const [stale] = await monitor.refresh([peer]);
  assert.equal(stale.stale, true); assert.equal(stale.lastSuccessAt, 100); assert.equal(stale.tasks[0].id, "work");
  connected = true;
  assert.equal((await monitor.refresh([peer]))[0].stale, false);
});
test("expired credentials and changed VPS targets never inherit cached tasks", async () => {
  let state = "connected", errorKind = "auth";
  const env = { SESSION: "first" };
  const monitor = createPeerMonitor({ env, inspect: async () => ({ state, errorKind, checkedAt: 100, tasks: state === "connected" ? [{ id: "private" }] : [] }) });
  await monitor.refresh([peer]); state = "offline";
  assert.deepEqual((await monitor.refresh([peer]))[0].tasks, []);
  state = "connected"; await monitor.refresh([peer]); state = "offline"; errorKind = "connection"; env.SESSION = "second";
  assert.deepEqual((await monitor.refresh([peer]))[0].tasks, []);
  state = "connected"; await monitor.refresh([peer]); state = "offline";
  assert.deepEqual((await monitor.refresh([{ ...peer, url: "https://another.example.com" }]))[0].tasks, []);
});
test("overlapping UI reconnects share a read and never dispatch work", async () => {
  let resolve, calls = 0;
  const monitor = createPeerMonitor({ inspect: () => { calls++; return new Promise(done => { resolve = done; }); } });
  const a = monitor.refresh([peer]), b = monitor.refresh([peer]);
  assert.equal(a, b); assert.equal(calls, 1);
  resolve({ state: "connected", checkedAt: 100, tasks: [] }); await a;
});
