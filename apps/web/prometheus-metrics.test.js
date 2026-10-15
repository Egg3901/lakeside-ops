"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { renderPrometheusMetrics, resetMetricsCache } = require("./prometheus-metrics");

test("exports live-world metrics in Prometheus format", async () => {
  resetMetricsCache();
  const collections = {
    gameState: { findOne: async () => ({ currentTurn: 42, currentYear: 1998 }) },
    turnLogs: { find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [{ turn: 41, durationMs: 2500, success: true }] }) }) }) },
    elections: { countDocuments: async () => 0 },
    commodityPrices: { find: () => ({ toArray: async () => [] }) },
  };
  const db = { collection: (name) => collections[name] };
  const body = await renderPrometheusMetrics(db);
  assert.match(body, /lakeside_world_turn 42/);
  assert.match(body, /lakeside_turn_last_duration_seconds 2\.5/);
  assert.match(body, /lakeside_turn_last_success 1/);
});
