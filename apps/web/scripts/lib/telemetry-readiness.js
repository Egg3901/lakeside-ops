"use strict";

const METRICS = ["approval", "economic.gdp", "population.population"];
const sha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const object = (value) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
const keyOf = (row) => `${row.country}\0${row.region ?? ""}\0${row.metric}`;

/** Qualification applies only to the declared approval/GDP/population series. */
function qualifyTelemetry({ context = {}, points = [], scopes = [] }) {
  const reasons = new Set();
  const fail = (reason) => reasons.add(reason);
  const { runId, sourceCommit, seed, effectiveManifest, actorConfiguration, turnRange, terminalTurn } = context;
  if (!runId || !sha(sourceCommit) || !seed) fail("Missing run, seed or exact executed source attribution");
  if (context.requestedCommit !== sourceCommit || (context.jobSourceCommit && context.jobSourceCommit !== sourceCommit)) fail("Requested and executed sources do not match");
  const directReader = context.collectionMode === "durable-direct" && context.collectorRepository === "LSGD-ops-dash";
  if (!sha(context.collectorCommit) || context.collectorDirty !== false) fail("Missing clean collector/reader source attribution");
  if (directReader) {
    if (context.expectedReaderCommit !== context.collectorCommit) fail("Reader source does not match its execution pin");
  } else if (context.collectorCommit !== sourceCommit && !context.collectorRecoveryVerified) {
    fail("Collector source differs without verified recovery provenance");
  }
  if (!object(effectiveManifest?.gameState) || !object(effectiveManifest?.gameConfig) || !Number.isInteger(effectiveManifest?.capturedAtTurn))
    fail("Missing immutable effective manifest");
  if (!object(actorConfiguration) || !["pure-npp", "synthetic"].includes(actorConfiguration.mode) ||
      !actorConfiguration.autonomyLevel || !Number.isInteger(actorConfiguration.coverageRegistryVersion))
    fail("Missing or unknown actor configuration");
  const rangeValid = Number.isInteger(turnRange?.from) && Number.isInteger(turnRange?.to) && turnRange.from <= turnRange.to;
  if (!rangeValid || terminalTurn !== turnRange?.to) fail("Missing or stale authoritative turn range");
  if (context.status !== "completed") fail("Run has not completed");
  for (const issue of context.measurementIssues || []) fail(`Known measurement defect: ${issue}`);
  if (!scopes.length) fail("No declared country/region scope");
  const expected = new Map();
  for (const scope of scopes) for (const metric of METRICS) expected.set(keyOf({ ...scope, metric }), new Map());
  const worlds = new Set();
  for (const row of points) {
    if (!METRICS.includes(row.metric)) continue;
    const series = expected.get(keyOf(row));
    if (!series) { fail("Telemetry outside declared country/region scope"); continue; }
    if (!Number.isInteger(row.turn) || !rangeValid || row.turn < turnRange.from || row.turn > turnRange.to) {
      fail("Telemetry outside declared raw-turn range"); continue;
    }
    if (series.has(row.turn)) fail("Duplicate raw-turn observations");
    series.set(row.turn, row);
    if (!Number.isFinite(row.value) || !Number.isFinite(row.year) || typeof row.foundingTurn !== "boolean") fail("Invalid value or calendar provenance");
    if (row.runId !== runId || row.codeVersion !== sourceCommit || row.seed !== seed || row.sourceClass !== "sandbox" || !row.worldId)
      fail("Unattributed or wrong-source telemetry point");
    worlds.add(row.worldId);
    if (row.schemaVersion !== 1 || row.calcVersion !== 1 || row.retentionVersion !== 1 || row.retentionPolicy !== "world-raw-full")
      fail("Unsupported calculation/schema or incomplete retention policy");
    const units = { approval: "%", "economic.gdp": "local-currency millions", "population.population": "people" };
    if ((row.metric !== "approval" || row.units !== undefined) && row.units !== units[row.metric]) fail("Wrong or missing metric units");
    if (row.actorConfiguration && ["mode", "autonomyLevel", "coverageRegistryVersion"].some(
      (field) => row.actorConfiguration[field] !== actorConfiguration?.[field])) fail("Mixed actor configuration");
  }
  if (worlds.size !== 1) fail("Missing or mixed world identity");
  const coverage = [];
  if (rangeValid) for (const [key, rows] of expected) {
    const missingTurns = [];
    for (let turn = turnRange.from; turn <= turnRange.to; turn++) if (!rows.has(turn)) missingTurns.push(turn);
    if (missingTurns.length) fail("Incomplete retained time series");
    const [country, region, metric] = key.split("\0");
    coverage.push({ country, region: region || null, metric, observedPoints: rows.size, missingTurns });
  }
  return {
    schemaVersion: 1,
    scope: "Declared sandbox approval, observed GDP and population telemetry only; not an overall world or release pass",
    passing: reasons.size === 0,
    reasons: [...reasons],
    coverage,
    provenance: { runId, sourceCommit, requestedCommit: context.requestedCommit, seed, effectiveManifest, actorConfiguration,
      actorCoverage: context.actorCoverage ?? null, turnRange, terminalTurn,
      collectionMode: context.collectionMode ?? "same-source", readerRepository: context.collectorRepository ?? "AHDGame",
      readerCommit: context.collectorCommit, readerDirty: context.collectorDirty,
      failedExperimentCollector: context.failedExperimentCollector ?? null, pointSchemaVersion: 1, calculationVersion: 1, retentionPolicy: "world-raw-full" },
  };
}
function runQualificationContext(run = {}, job = {}, state = {}, reader = {}) {
  const capturedAtTurn = run.effectiveConfigInitial?.capturedAtTurn;
  return {
    runId: run.runId ?? job._id,
    sourceCommit: run.source?.executedCommit,
    requestedCommit: run.source?.requestedCommit ?? job.sourceCommit,
    jobSourceCommit: job.sourceCommit,
    seed: run.seed ?? job.seed,
    effectiveManifest: run.effectiveConfigInitial,
    actorConfiguration: { mode: run.actorMode, autonomyLevel: run.autonomyLevel,
      coverageRegistryVersion: run.actorCoverage?.registryVersion },
    actorCoverage: run.actorCoverage,
    turnRange: { from: Number.isInteger(capturedAtTurn) ? capturedAtTurn + 1 : null,
      to: Number.isInteger(capturedAtTurn) && Number.isInteger(job.turns) ? capturedAtTurn + job.turns : null },
    terminalTurn: state.currentTurn,
    status: job.status === "completed" && run.status === "completed" ? "completed" : "unverified",
    collectionMode: "durable-direct", collectorRepository: "LSGD-ops-dash",
    collectorCommit: reader.commit, expectedReaderCommit: reader.commit, collectorDirty: reader.dirty,
    failedExperimentCollector: job.experimentsReportError ? { status: "failed", stage: "collectExperimentReport" } : null,
    measurementIssues: [...(run.measurementIssues || []), ...(job.measurementIssues || [])],
  };
}
module.exports = { qualifyTelemetry, runQualificationContext, METRICS };
