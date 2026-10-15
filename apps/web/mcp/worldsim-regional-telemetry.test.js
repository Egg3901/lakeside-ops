"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildRegionalTelemetry, renderRegionalReport } = require("./worldsim-regional-telemetry");

test("regional publisher keeps observed levels, founding turns, provenance, and explicit gaps", () => {
  const provenance = {
    runId: "run-1", sourceClass: "sandbox", codeVersion: "a".repeat(40), worldId: "1991-default:0",
    retentionPolicy: "world-raw-full", retentionVersion: 1, schemaVersion: 1, calcVersion: 1,
  };
  const states = [{ _id: "US_CA", countryId: "US" }, { _id: "US_NY", countryId: "US" }];
  const approvals = [1, 2, 3].map((turn) => ({
    ...provenance, country: "US", region: "US_CA", turn, year: 1953,
    foundingTurn: turn <= 2, approval: 50 + turn,
  }));
  const macros = [1, 3].flatMap((turn) => [
    { ...provenance, country: "US", region: "US_CA", metric: "economic.gdp", turn, year: 1953, foundingTurn: turn === 1, value: 100 + turn, units: "local-currency millions" },
    { ...provenance, country: "US", region: "US_CA", metric: "population.population", turn, year: 1953, foundingTurn: turn === 1, value: 1000 + turn, units: "people" },
  ]);
  const rows = buildRegionalTelemetry({ states, approvals, macros, toTurn: 3 });
  assert.equal(rows.length, 2);
  const ca = rows.find((row) => row.region === "US_CA");
  assert.deepEqual(ca.series["economic.gdp"].points.map((point) => point.turn), [1, 3]);
  assert.deepEqual(ca.series["economic.gdp"].coverage.missingTurns, [2]);
  assert.deepEqual(ca.series["economic.gdp"].segmentStartTurns, [1, 3]);
  assert.equal(ca.series.approval.points[0].foundingTurn, true);
  assert.equal(ca.series.approval.points[2].foundingTurn, false);
  assert.equal(ca.series["economic.gdp"].provenance.codeVersion, provenance.codeVersion);
  assert.equal(ca.series["economic.gdp"].provenance.retentionPolicy, "world-raw-full");
  const ny = rows.find((row) => row.region === "US_NY");
  assert.deepEqual(ny.series.approval.coverage.missingTurns, [1, 2, 3]);
  assert.equal(ny.series.approval.provenanceStatus, "missing");
});

test("incomplete provenance cannot be labeled consistent and mixed run IDs are flagged", () => {
  const states = [{ _id: "US_CA", countryId: "US" }];
  const base = { country: "US", region: "US_CA", year: 1953, approval: 50,
    sourceClass: "sandbox", codeVersion: "a".repeat(40), worldId: "1991-default:0",
    retentionPolicy: "world-raw-full", retentionVersion: 1, schemaVersion: 1, calcVersion: 1 };
  const missing = buildRegionalTelemetry({ states, approvals: [{ ...base, turn: 1 }], macros: [], toTurn: 1 });
  assert.equal(missing[0].series.approval.provenanceStatus, "incomplete");
  const mixed = buildRegionalTelemetry({ states, approvals: [
    { ...base, runId: "run-1", turn: 1 }, { ...base, runId: "run-2", turn: 2 },
  ], macros: [], toTurn: 2 });
  assert.equal(mixed[0].series.approval.provenanceStatus, "mixed");
});

test("regional report escapes source text and contains no private database identifiers", () => {
  const html = renderRegionalReport({
    title: "<script>alert(1)</script>", runId: "</script><script>alert(3)</script>", sourceRevision: "</script><script>alert(2)</script>",
    effectiveManifest: { label: "</script>" }, updated: "2026-09-30T00:00:00Z",
    regions: [{ country: "US", region: "US_CA", series: {} }],
  });
  assert.doesNotMatch(html, /<script>alert\([123]\)<\/script>/);
  assert.match(html, /Download selected region JSON/);
  assert.match(html, /series\.segmentStartTurns\.includes\(point\.turn\)/);
  assert.match(html, /US_CA/);
});
