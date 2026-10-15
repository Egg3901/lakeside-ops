"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const retained = require("./fixtures/telemetry-1991-retained.json");
const legacy = require("./fixtures/telemetry-1953-legacy.json");
const { qualifyTelemetry, runQualificationContext } = require("./telemetry-readiness");
const { summarizeLongHorizonTelemetry } = require("./long-horizon-report");
function actual() {
  return { context: structuredClone(retained.context), scopes: structuredClone(retained.scopes),
    points: retained.points.map((row) => ({ ...retained.metadata, ...row })) };
}
test("actual retained national and regional480-series qualify in their explicit scope", () => {
  const q = qualifyTelemetry(actual());
  assert.equal(q.passing, true, q.reasons.join("; "));
  assert.equal(q.coverage.length, 6);
  assert(q.coverage.every((row) => row.observedPoints === 480 && row.missingTurns.length === 0));
  assert.match(q.scope, /not an overall world/);
});
for (const [name, alter, reason] of [
  ["missing attribution", (x) => { delete x.context.sourceCommit; }, /source/],
  ["missing actors", (x) => { delete x.context.actorConfiguration; }, /actor/],
  ["different actor autonomy", (x) => { x.points[0].actorConfiguration = { ...x.context.actorConfiguration, autonomyLevel: "v5" }; }, /actor/],
  ["different actor coverage registry", (x) => { x.points[0].actorConfiguration = { ...x.context.actorConfiguration, coverageRegistryVersion: 99 }; }, /actor/],
  ["missing effective manifest", (x) => { delete x.context.effectiveManifest; }, /manifest/],
  ["wrong point source", (x) => { x.points[10].codeVersion = "b".repeat(40); }, /wrong-source/],
  ["wrong requested source", (x) => { x.context.requestedCommit = "b".repeat(40); }, /sources/],
  ["different job source", (x) => { x.context.jobSourceCommit = "b".repeat(40); }, /sources/],
  ["different reader checkout", (x) => { x.context.collectorCommit = "b".repeat(40); }, /Reader/],
  ["dirty reader checkout", (x) => { x.context.collectorDirty = true; }, /clean/],
  ["missing terminal status", (x) => { delete x.context.status; }, /completed/],
  ["wrong GDP unit", (x) => { x.points.find(r => r.metric === "economic.gdp").units = "USD"; }, /units/],
  ["missing GDP unit", (x) => { delete x.points.find(r => r.metric === "economic.gdp").units; }, /units/],
  ["stale report", (x) => { x.context.terminalTurn++; }, /stale/],
  ["missing last observation", (x) => { x.points.pop(); }, /Incomplete/],
  ["entire missing region", (x) => { x.points = x.points.filter((r) => r.region === null); }, /Incomplete/],
  ["missing calculation version", (x) => { delete x.points[0].calcVersion; }, /calculation/],
  ["unknown calculation version", (x) => { x.points[0].calcVersion = 99; }, /calculation/],
  ["known mismeasurement", (x) => { x.context.measurementIssues = ["Fixture: double-deflated GDP"]; }, /measurement defect/],
  ["duplicate observation", (x) => { x.points.push(x.points[0]); }, /Duplicate/],
  ["nonfinite observation", (x) => { x.points[0].value = NaN; }, /Invalid value/],
  ["mixed world", (x) => { x.points[0].worldId = "other"; }, /mixed world/],
]) test(`completed turns cannot pass with ${name}`, () => {
  const data = actual(); alter(data); const q = qualifyTelemetry(data);
  assert.equal(q.passing, false); assert.match(q.reasons.join("; "), reason);
});
test("actual legacy report remains nonqualifying despite240 completed iterations", () => {
  assert.equal(legacy.source, "legacy-bounded");
  assert.equal(legacy.approval.length, 20);
  assert.equal(legacy.gdpGrowth.length, 96);
  const data = actual();
  data.points = legacy.approval.map((row) => ({ country: "US", region: null, metric: "approval", ...row }));
  assert.equal(qualifyTelemetry(data).passing, false);
});
test("original formatter reproduction no longer blesses empty or unattributed complete payloads", () => {
  const q = summarizeLongHorizonTelemetry({ availability: "observed-complete",
    approval: { points: [{ country: "US", region: null, turn: 2, approval: 50 }], series: [{country:"US",region:null,missingTurns:[]}] },
    macro: { points: [], series: [] } });
  assert.equal(q.passing, false);
  assert.match(q.warning, /attributable/);
});
test("publisher context requires both sandbox and control completion and preserves failed collector provenance", () => {
  const run = { status: "completed", source: { executedCommit: "a".repeat(40) } };
  const job = { status: "completed", experimentsReportError: "private failure detail" };
  const reader = { commit: "b".repeat(40), dirty: false };
  const context = runQualificationContext(run, job, {}, reader);
  assert.equal(context.status, "completed");
  assert.equal(context.collectorCommit, reader.commit);
  assert.equal(context.collectorDirty, false);
  assert.deepEqual(context.failedExperimentCollector, { status: "failed", stage: "collectExperimentReport" });
  assert.equal(runQualificationContext({}, job).status, "unverified");
  assert.equal(runQualificationContext(run, {}).status, "unverified");
});
