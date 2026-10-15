"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = "world-audit/v1";
const MIN_COHORT = 5;
const MIN_RANGE = 10;
const RAW_RETENTION_DAYS = 30;
const TURN_BUCKETS = ["0-11", "12-47", "48-95", "96-239", "240+", "unknown"];
const METRIC_KEYS = [
  "nppCount", "nppOfficeSharePercent", "partyCount", "corporationCount",
  "totalCorporationEmployment", "marketFillRatePercent", "corporateLossMakingSharePercent",
  "lastTurnDurationMs", "lastTurnWarningCount",
  "gdpTotal", "gdpPerCapita", "gdpGrowthPercent", "totalPopulation", "populationGrowthPercent",
  "inflationRatePercent", "unemploymentRatePercent", "governmentApprovalPercent",
  "averageStability", "electionCountUpcoming", "electionCountActive", "electionCountCompleted",
  "electionCountResolved", "electionCountCancelled", "governmentFormationCount",
  "legislativeSeatTotal", "executiveControlSharePercent",
];
const LEGACY_UNAVAILABLE = [
  "gdpTotal", "gdpPerCapita", "gdpGrowthPercent", "totalPopulation", "populationGrowthPercent",
  "inflationRatePercent", "unemploymentRatePercent", "governmentApprovalPercent",
  "electionCountUpcoming", "electionCountActive", "electionCountCompleted",
  "electionCountResolved", "electionCountCancelled", "governmentFormationCount",
  "legislativeSeatTotal", "executiveControlSharePercent",
];
const LEAK_PATTERNS = [
  /accountId/i, /userId/i, /characterId/i, /displayName/i, /email/i, /partyName/i,
  /mongodb(\+srv)?:\/\//i, /\/root\//, /expiresAt/,
];

function turnBucket(turn) {
  if (turn === null || turn === undefined || !Number.isInteger(turn) || turn < 0) return "unknown";
  if (turn <= 11) return "0-11";
  if (turn <= 47) return "12-47";
  if (turn <= 95) return "48-95";
  if (turn <= 239) return "96-239";
  return "240+";
}

function hashFeatureFlags(flags) {
  if (!flags || typeof flags !== "object") return "none";
  const parts = Object.keys(flags)
    .filter((key) => typeof flags[key] === "boolean")
    .sort()
    .map((key) => `${key}:${flags[key] ? "1" : "0"}`);
  if (!parts.length) return "none";
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function dayStamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function summarizeMetric(values, sampleCount) {
  const present = values.length;
  if (!present) return { n: 0, completeness: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const summary = {
    n: present,
    completeness: Number((present / sampleCount).toFixed(4)),
    median: percentile(sorted, 0.5),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
  };
  if (sampleCount >= MIN_RANGE) {
    summary.min = sorted[0];
    summary.max = sorted[sorted.length - 1];
  }
  return summary;
}

function cohortKey(doc) {
  const setup = doc.setup || {};
  return [
    setup.era || "unknown",
    setup.mode || "unknown",
    setup.difficulty || "unknown",
    setup.autonomy || "unknown",
    doc.appMajorVersion == null ? "unknown" : String(doc.appMajorVersion),
    hashFeatureFlags(setup.featureFlags),
    turnBucket(doc.turn),
    String(doc.metricDefinitionVersion || 1),
  ].join("|");
}

function emptyGroup(doc) {
  const setup = doc.setup || {};
  return {
    era: setup.era || "unknown",
    mode: setup.mode || "unknown",
    difficulty: setup.difficulty || "unknown",
    autonomy: setup.autonomy || "unknown",
    appMajorVersion: doc.appMajorVersion ?? null,
    featureFlagHash: hashFeatureFlags(setup.featureFlags),
    turnBucket: turnBucket(doc.turn),
    metricDefinitionVersion: doc.metricDefinitionVersion || 1,
    days: new Set(),
    values: Object.fromEntries(METRIC_KEYS.map((key) => [key, []])),
  };
}

function addDoc(group, doc) {
  group.count = (group.count || 0) + 1;
  const day = dayStamp(doc.createdAt);
  if (day) group.days.add(day);
  const metrics = doc.metrics || {};
  for (const key of METRIC_KEYS) {
    const value = metrics[key];
    if (typeof value === "number" && Number.isFinite(value)) group.values[key].push(value);
  }
}

function finishGroup(group, sampleCount) {
  const days = [...group.days].sort();
  const metrics = {};
  for (const key of METRIC_KEYS) {
    const summary = summarizeMetric(group.values[key], sampleCount);
    if (summary.n > 0) metrics[key] = summary;
  }
  return {
    era: group.era,
    mode: group.mode,
    difficulty: group.difficulty,
    autonomy: group.autonomy,
    appMajorVersion: group.appMajorVersion,
    featureFlagHash: group.featureFlagHash,
    turnBucket: group.turnBucket,
    sampleCount,
    schemaVersion: 1,
    metricDefinitionVersion: group.metricDefinitionVersion,
    coverageFrom: days[0] || null,
    coverageTo: days[days.length - 1] || null,
    source: "anonymous-opt-in-aggregates",
    retentionDays: RAW_RETENTION_DAYS,
    metrics,
  };
}

function rollupKey(doc, dims) {
  const setup = doc.setup || {};
  const parts = [];
  if (dims.includes("era")) parts.push(setup.era || "unknown");
  if (dims.includes("mode")) parts.push(setup.mode || "unknown");
  if (dims.includes("turnBucket")) parts.push(turnBucket(doc.turn));
  parts.push(String(doc.metricDefinitionVersion || 1));
  return parts.join("|");
}

function emptyRollup(doc, dims) {
  const setup = doc.setup || {};
  return {
    label: dims.join("+"),
    era: dims.includes("era") ? setup.era || "unknown" : "pooled",
    mode: dims.includes("mode") ? setup.mode || "unknown" : "pooled",
    turnBucket: dims.includes("turnBucket") ? turnBucket(doc.turn) : "pooled",
    metricDefinitionVersion: doc.metricDefinitionVersion || 1,
    days: new Set(),
    values: Object.fromEntries(METRIC_KEYS.map((key) => [key, []])),
  };
}

function buildSnapshot(docs, now = new Date()) {
  const groups = new Map();
  const rollupGroups = new Map();
  const eras = new Set();
  const modes = new Set();
  const days = [];
  for (const doc of docs) {
    const setup = doc.setup || {};
    if (setup.era) eras.add(setup.era);
    if (setup.mode) modes.add(setup.mode);
    const day = dayStamp(doc.createdAt);
    if (day) days.push(day);
    const key = cohortKey(doc);
    if (!groups.has(key)) groups.set(key, emptyGroup(doc));
    addDoc(groups.get(key), doc);
    for (const dims of [["turnBucket"], ["era", "mode", "turnBucket"], ["mode", "turnBucket"]]) {
      const rkey = `${dims.join("+")}|${rollupKey(doc, dims)}`;
      if (!rollupGroups.has(rkey)) rollupGroups.set(rkey, emptyRollup(doc, dims));
      addDoc(rollupGroups.get(rkey), doc);
    }
  }
  const cohorts = [];
  let suppressedCohorts = 0;
  for (const group of groups.values()) {
    const count = group.count || 0;
    if (count < MIN_COHORT) {
      suppressedCohorts += 1;
      continue;
    }
    cohorts.push(finishGroup(group, count));
  }
  const rollups = [];
  for (const group of rollupGroups.values()) {
    const n = group.count || 0;
    if (n < MIN_COHORT) continue;
    const finished = finishGroup(group, n);
    rollups.push({
      label: group.label,
      era: group.era,
      mode: group.mode,
      turnBucket: group.turnBucket,
      sampleCount: n,
      metricDefinitionVersion: group.metricDefinitionVersion,
      coverageFrom: finished.coverageFrom,
      coverageTo: finished.coverageTo,
      metrics: finished.metrics,
      pooled: true,
    });
  }
  days.sort();
  const eraCounts = {};
  const modeCounts = {};
  for (const doc of docs) {
    const era = doc.setup?.era || "unknown";
    const mode = doc.setup?.mode || "unknown";
    eraCounts[era] = (eraCounts[era] || 0) + 1;
    modeCounts[mode] = (modeCounts[mode] || 0) + 1;
  }
  const displayCohorts = [
    ...cohorts.map((row) => ({
      grain: "full",
      key: {
        era: row.era,
        mode: row.mode,
        difficulty: row.difficulty,
        autonomy: row.autonomy,
        turnBucket: row.turnBucket,
        appMajorVersion: row.appMajorVersion,
        featureFlagHash: row.featureFlagHash,
      },
      sampleCount: row.sampleCount,
      metrics: row.metrics,
      coverageFrom: row.coverageFrom,
      coverageTo: row.coverageTo,
    })),
    ...rollups.map((row) => ({
      grain: row.label === "turnBucket" ? "turn" : row.label === "era+mode+turnBucket" ? "era-mode-turn" : row.label,
      key: { era: row.era === "pooled" ? undefined : row.era, mode: row.mode === "pooled" ? undefined : row.mode, turnBucket: row.turnBucket },
      sampleCount: row.sampleCount,
      metrics: row.metrics,
      pooled: true,
    })),
  ];
  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    status: "ok",
    generatedAt: now.toISOString(),
    privacy: {
      source: "anonymous-opt-in-aggregates",
      rawRetentionDays: RAW_RETENTION_DAYS,
      containsIdentifiers: false,
      supportsPerWorldTrajectory: false,
      minimumCohortSize: MIN_COHORT,
    },
    acceptedReports: docs.length,
    visibleCohorts: cohorts.length,
    suppressedCohorts,
    unavailableFromLegacy: LEGACY_UNAVAILABLE,
    coverage: { eras: eraCounts, modes: modeCounts },
    summary: {
      acceptedReports: docs.length,
      visibleCohorts: cohorts.length,
      suppressedCohorts,
      eras: [...eras].sort(),
      modes: [...modes].sort(),
      coverageFrom: days[0] || null,
      coverageTo: days[days.length - 1] || null,
      unavailableFromLegacyUploads: LEGACY_UNAVAILABLE,
    },
    cohorts: displayCohorts,
    rollups,
  };
  const serialized = JSON.stringify(snapshot);
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(serialized)) throw new Error(`sanitized snapshot leaked ${pattern}`);
  }
  return snapshot;
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, data, { mode: 0o644 });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o644);
}

module.exports = {
  SCHEMA_VERSION,
  MIN_COHORT,
  METRIC_KEYS,
  LEGACY_UNAVAILABLE,
  turnBucket,
  hashFeatureFlags,
  percentile,
  buildSnapshot,
  atomicWrite,
};
