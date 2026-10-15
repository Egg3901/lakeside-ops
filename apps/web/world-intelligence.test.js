"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { metricValue, pct, percentChange, pointDelta, trendAt, buildSignals, OPERATED_CORPORATION } = require("./world-intelligence");

test("world metrics preserve zero and reject missing/non-finite observations", () => {
  assert.equal(metricValue({ value: 0 }), 0);
  assert.equal(metricValue({ value: 1.25 }), 1.25);
  assert.equal(metricValue({ value: Number.NaN }), null);
  assert.equal(metricValue(null), null);
});

test("fractional health metrics render as percentages", () => {
  assert.equal(pct(0.8734), 87.3);
  assert.equal(pct(0), 0);
  assert.equal(pct(null), null);
});

test("corporation intelligence admits only player and NPP operators", () => {
  assert.deepEqual(OPERATED_CORPORATION, {
    $or: [
      { ceoType: "npp" },
      { ceoType: { $in: ["character", "imperial"] }, userId: { $exists: true, $ne: null } },
    ],
  });
});

test("trend math reports changes without manufacturing a baseline", () => {
  assert.equal(percentChange(120, 100), 20);
  assert.equal(percentChange(80, 100), -20);
  assert.equal(percentChange(10, 0), null);
  assert.equal(pointDelta(31.2, 20.1), 11.1);
  assert.deepEqual(trendAt([{ turn: 10, value: 1 }, { turn: 34, value: 2 }], 34, 24), {
    current: { turn: 34, value: 2 }, previous: { turn: 10, value: 1 }, turns: 24,
  });
});

test("briefing prioritizes material distress over inventory facts", () => {
  const signals = buildSignals({
    players: { activityTrend: { current: 8, previous: 10, changePct: -20 } },
    economy: { player: { key: "player", latest: { lossRate: 42 }, change24: { lossRatePoints: 12, marginPoints: -8, turns: 24 }, driver: "US drove the movement." } },
    politics: { membershipTrend: { current: 12, previous: 12, change: 0, turns: 24 } },
  });
  assert.equal(signals[0].level, "critical");
  assert.match(signals[0].title, /Player corporations/);
  assert.equal(signals.some((signal) => /strongest party/i.test(signal.title)), false);
});

test("briefing calls out deteriorating playable-country commodity markets", () => {
  const signals = buildSignals({
    players: {}, economy: {}, politics: {},
    markets: {
      comparisonTurns: 24,
      latest: { severe: 12 },
      worsening: [{ label: "Rare Earth", fillPct: 18.4, deltaPoints: -21.1, unmetUnits: 433 }],
    },
  });
  assert.deepEqual(signals[0], {
    level: "warning",
    domain: "Markets",
    title: "Rare Earth availability deteriorated",
    value: "-21.1 points",
    detail: "18.4% of demand was filled across playable countries, down over 24 turns. 12 commodity markets are below 50% fill.",
    cause: "433 units of demand went unmet this turn.",
  });
});
