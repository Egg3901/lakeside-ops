"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  MIN_COHORT,
  turnBucket,
  hashFeatureFlags,
  percentile,
  buildSnapshot,
  atomicWrite,
} = require("./worldsim-singleplayer-telemetry");

function doc(overrides = {}) {
  return {
    createdAt: new Date("2026-09-10T12:00:00.000Z"),
    appMajorVersion: 2,
    metricDefinitionVersion: 1,
    setup: {
      era: "2019",
      mode: "normal",
      difficulty: "normal",
      autonomy: "v4",
      featureFlags: { forexEnabled: true },
    },
    metrics: { nppCount: 10, partyCount: 8, lastTurnDurationMs: 1000 },
    turn: 12,
    ...overrides,
  };
}

test("turn buckets are bounded and inclusive", () => {
  assert.equal(turnBucket(0), "0-11");
  assert.equal(turnBucket(11), "0-11");
  assert.equal(turnBucket(12), "12-47");
  assert.equal(turnBucket(240), "240+");
  assert.equal(turnBucket(null), "unknown");
});

test("feature flag hashes are stable across insertion order", () => {
  const a = hashFeatureFlags({ rpgStatsEnabled: false, forexEnabled: true });
  const b = hashFeatureFlags({ forexEnabled: true, rpgStatsEnabled: false });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.notEqual(hashFeatureFlags({ forexEnabled: true }), hashFeatureFlags({ forexEnabled: false }));
});

test("percentiles interpolate a sorted sample", () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([10], 0.25), 10);
});

test("k-anonymity suppresses cohorts below 5", () => {
  const docs = Array.from({ length: 4 }, () => doc());
  const snapshot = buildSnapshot(docs);
  assert.equal(snapshot.summary.acceptedReports, 4);
  assert.equal(snapshot.summary.visibleCohorts, 0);
  assert.equal(snapshot.summary.suppressedCohorts, 1);
  assert.equal(snapshot.privacy.minimumCohortSize, MIN_COHORT);
});

test("visible cohorts expose sample size and omit min/max below the range floor", () => {
  const docs = Array.from({ length: 6 }, (_, i) => doc({ metrics: { nppCount: 10 + i } }));
  const snapshot = buildSnapshot(docs);
  assert.equal(snapshot.summary.visibleCohorts, 1);
  const metric = snapshot.cohorts[0].metrics.nppCount;
  assert.equal(metric.n, 6);
  assert.equal(metric.median, 12.5);
  assert.equal(metric.min, undefined);
  assert.equal(metric.max, undefined);
});

test("missing metrics from older clients stay omitted", () => {
  const docs = Array.from({ length: 5 }, () => doc({ metrics: { nppCount: 3 } }));
  const snapshot = buildSnapshot(docs);
  assert.equal(snapshot.cohorts[0].metrics.gdpGrowthPercent, undefined);
  assert.ok(snapshot.summary.unavailableFromLegacyUploads.includes("gdpGrowthPercent"));
});

test("raw document fields and identifiers do not leak", () => {
  const docs = Array.from({ length: 5 }, () => doc({
    _id: "507f1f77bcf86cd799439011",
    expiresAt: new Date("2026-10-10T00:00:00.000Z"),
  }));
  const snapshot = buildSnapshot(docs);
  const text = JSON.stringify(snapshot);
  assert.equal(text.includes("507f1f77bcf86cd799439011"), false);
  assert.equal(text.includes("expiresAt"), false);
  assert.equal(text.includes("12:00:00"), false);
  assert.equal(snapshot.privacy.containsIdentifiers, false);
  assert.equal(snapshot.privacy.supportsPerWorldTrajectory, false);
});

test("atomic write replaces through a temp file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-tel-"));
  const file = path.join(dir, "singleplayer-telemetry.json");
  atomicWrite(file, '{"ok":true}\n');
  assert.equal(fs.readFileSync(file, "utf8"), '{"ok":true}\n');
  assert.equal(fs.statSync(file).mode & 0o777, 0o644);
  fs.rmSync(dir, { recursive: true, force: true });
});
