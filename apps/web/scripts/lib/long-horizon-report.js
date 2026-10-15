"use strict";
const { qualifyTelemetry } = require("./telemetry-readiness");

const COLORS = [
  "#5865F2",
  "#dc2626",
  "#ffce42",
  "#22c55e",
  "#ea580c",
  "#a855f7",
  "#38bdf8",
  "#f472b6",
];

function seriesLabel(country, region) {
  return region == null ? country : `${country} · ${region}`;
}

function lineSeries(points, valueKey, groupKey) {
  const groups = new Map();
  for (const point of points || []) {
    const key = groupKey(point);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(point);
  }
  return [...groups.entries()].map(([label, rows], index) => ({
    label,
    borderColor: COLORS[index % COLORS.length],
    backgroundColor: "transparent",
    tension: 0.2,
    pointRadius: 0,
    borderWidth: 1.5,
    data: rows
      .sort((a, b) => a.turn - b.turn)
      .map((row) => ({ x: row.turn, y: row[valueKey] })),
  }));
}

function summedMacroSeries(points, metric) {
  const groups = new Map();
  for (const point of points || []) {
    if (point.metric !== metric) continue;
    const key = `${point.country}\0${point.turn}`;
    const group = groups.get(key) || {
      country: point.country,
      turn: point.turn,
      national: undefined,
      regional: 0,
    };
    if (point.region == null) group.national = point.value;
    else group.regional += point.value;
    groups.set(key, group);
  }
  // New reports contain both national aggregates and regional detail. Prefer
  // the authoritative national point, falling back to a regional sum for
  // early contract drafts that only retained regions.
  const rows = [...groups.values()].map((group) => ({
    country: group.country,
    turn: group.turn,
    value: group.national === undefined ? group.regional : group.national,
  }));
  return lineSeries(rows, "value", (point) => point.country);
}

function distinct(points, key) {
  return [
    ...new Set(
      (points || [])
        .map((point) => point[key])
        .filter((value) => value !== undefined && value !== null),
    ),
  ];
}

function distinctJson(points, key) {
  return [
    ...new Set(
      (points || [])
        .map((point) => point[key])
        .filter((value) => value !== undefined && value !== null)
        .map((value) => JSON.stringify(value)),
    ),
  ];
}

function summarizeLongHorizonTelemetry(telemetry, context = {}) {
  if (!telemetry) {
    return {
      availability: "legacy-unavailable",
      passing: false,
      warning:
        "This legacy report has no durable long-horizon telemetry. It cannot demonstrate complete approval, GDP, or population coverage.",
      approvalSeries: [],
      gdpSeries: [],
      populationSeries: [],
      coverage: [],
      provenance: [],
    };
  }
  const approvalPoints = telemetry.approval?.points || [];
  const macroPoints = telemetry.macro?.points || [];
  const coverage = [
    ...(telemetry.approval?.series || []),
    ...(telemetry.macro?.series || []),
  ];
  const missing = coverage.filter(
    (series) => (series.missingTurns || []).length > 0,
  );
  const points = [...approvalPoints, ...macroPoints];
  const manifests = distinctJson(points, "effectiveManifest");
  const actors = distinctJson(points, "actorConfiguration");
  const scopes = [...new Map(coverage.map((row) => [`${row.country}\0${row.region ?? ""}`, { country: row.country, region: row.region ?? null }])).values()];
  const qualification = qualifyTelemetry({ context, scopes, points: [
    ...approvalPoints.map((row) => ({ ...row, metric: "approval", value: row.approval })), ...macroPoints,
  ] });
  const passing = qualification.passing && telemetry.availability === "observed-complete" && missing.length === 0;
  return {
    availability: telemetry.availability || "missing",
    passing,
    qualification,
    warning: passing
      ? null
      : `${telemetry.availability || "missing"}: long-horizon telemetry is not complete or attributable; do not treat this run as passing readiness evidence. ${qualification.reasons.join("; ")}`,
    turnRange: telemetry.turnRange,
    cardinalityPolicy: telemetry.cardinalityPolicy,
    approvalSeries: lineSeries(
      approvalPoints.filter((point) => point.region == null),
      "approval",
      (point) => seriesLabel(point.country, point.region),
    ),
    gdpSeries: summedMacroSeries(macroPoints, "economic.gdp"),
    populationSeries: summedMacroSeries(macroPoints, "population.population"),
    coverage,
    provenance: [
      ["World", telemetry.worldId],
      ["Run", telemetry.runId],
      ["Telemetry schema", telemetry.schemaVersion],
      ["Source class", distinct(points, "sourceClass").join(", ")],
      ["Seed", distinct(points, "seed").join(", ")],
      ["Code version", distinct(points, "codeVersion").join(", ")],
      ["Point schema versions", distinct(points, "schemaVersion").join(", ")],
      ["Calculation versions", distinct(points, "calcVersion").join(", ")],
      ["Retention", distinct(points, "retentionPolicy").join(", ")],
      ["Retention versions", distinct(points, "retentionVersion").join(", ")],
      ["Effective manifest", manifests.join(" | ")],
      ["Actor configuration", actors.join(" | ")],
    ],
  };
}

module.exports = { summarizeLongHorizonTelemetry };
