"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createStaleRefreshCache, warmUntilReady } = require("./dashboard-snapshot-cache");

test("stale dashboard snapshots return immediately while one refresh runs", async () => {
  let now = 0;
  let calls = 0;
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
  const cache = createStaleRefreshCache({
    ttlMs: 30_000,
    now: () => now,
    load: async () => {
      calls += 1;
      if (calls === 1) return { version: 1 };
      await refreshGate;
      return { version: 2 };
    },
  });

  assert.deepEqual(await cache.get(), { version: 1 });
  now = 31_000;
  const started = Date.now();
  assert.deepEqual(await cache.get(), { version: 1 });
  assert.ok(Date.now() - started < 50, "stale read must not await refresh");
  assert.equal(calls, 2);

  await cache.get();
  assert.equal(calls, 2, "concurrent stale reads share one refresh");
  releaseRefresh();
  await cache.refreshing();
  assert.deepEqual(await cache.get(), { version: 2 });
});

test("getStale starts a cold refresh without waiting for it", async () => {
  let calls = 0;
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
  const cache = createStaleRefreshCache({
    load: async () => {
      calls += 1;
      await refreshGate;
      return { ready: true };
    },
  });

  assert.equal(cache.getStale(), null);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(cache.peek(), null);

  releaseRefresh();
  await cache.refreshing();
  assert.deepEqual(cache.getStale(), { ready: true });
});

test("a failed background refresh preserves the last complete snapshot", async () => {
  let now = 0;
  let calls = 0;
  const cache = createStaleRefreshCache({
    ttlMs: 10,
    now: () => now,
    load: async () => {
      calls += 1;
      if (calls > 1) throw new Error("integration timeout");
      return { healthy: true };
    },
  });
  assert.deepEqual(await cache.get(), { healthy: true });
  now = 20;
  assert.deepEqual(await cache.get(), { healthy: true });
  await cache.refreshing();
  assert.deepEqual(cache.peek(), { healthy: true });
});

test("startup warm retries a failed Mongo read until the first snapshot is ready", async () => {
  let calls = 0;
  const scheduled = [];
  const cache = createStaleRefreshCache({
    load: async () => {
      calls += 1;
      if (calls === 1) throw new Error("Mongo selection timed out");
      return { healthy: true };
    },
  });

  await warmUntilReady(cache, { retryMs: 30_000, schedule: (fn, delay) => {
    scheduled.push({ fn, delay });
    return { unref() {} };
  } });
  assert.equal(cache.peek(), null);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 30_000);

  await scheduled[0].fn();
  assert.deepEqual(cache.peek(), { healthy: true });
  assert.equal(calls, 2);
  assert.equal(scheduled.length, 1, "a ready snapshot stops startup retries");
});
