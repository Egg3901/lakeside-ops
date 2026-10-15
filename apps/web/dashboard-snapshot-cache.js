"use strict";

function createStaleRefreshCache({ load, ttlMs = 30_000, now = Date.now, onError = () => {} }) {
  if (typeof load !== "function") throw new TypeError("load must be a function");
  let snapshot = null;
  let updatedAt = null;
  let inFlight = null;

  function refresh() {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(load)
      .then((value) => {
        snapshot = value;
        updatedAt = now();
        return snapshot;
      })
      .catch((error) => {
        onError(error);
        if (snapshot === null) throw error;
        return snapshot;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  async function get() {
    if (snapshot === null) return refresh();
    if (updatedAt === null || now() - updatedAt >= ttlMs) refresh();
    return snapshot;
  }

  function getStale() {
    if (snapshot === null) {
      refresh().catch(() => {});
      return null;
    }
    if (updatedAt === null || now() - updatedAt >= ttlMs) refresh().catch(() => {});
    return snapshot;
  }

  return {
    get,
    getStale,
    peek: () => snapshot,
    refresh,
    refreshing: () => inFlight || Promise.resolve(snapshot),
  };
}

function warmUntilReady(cache, { retryMs = 30_000, schedule = setTimeout } = {}) {
  async function attempt() {
    try { await cache.refresh(); } catch { /* cache reports through onError */ }
    if (cache.peek() !== null) return;
    const timer = schedule(attempt, retryMs);
    timer?.unref?.();
  }
  return attempt();
}

module.exports = { createStaleRefreshCache, warmUntilReady };
