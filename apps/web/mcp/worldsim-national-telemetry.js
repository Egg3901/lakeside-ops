"use strict";

// National durable telemetry for the legacy public worldsim publisher. The
// operational arrays are a labeled fallback only for runs predating #2192.
function series(rows, country, metric) {
  return rows
    .filter((row) => row.country === country && row.region === null && row.metric === metric)
    .map((row) => ({
      turn: row.turn,
      year: row.year,
      foundingTurn: row.foundingTurn === true,
      value: Number.isFinite(row.value) ? row.value : null,
    }))
    .filter((row) => Number.isInteger(row.turn) && row.value !== null)
    .sort((a, b) => a.turn - b.turn);
}

function coverage(points, fromTurn, toTurn) {
  const observed = new Set(points.map((point) => point.turn));
  const missingTurns = [];
  for (let turn = fromTurn; turn <= toTurn; turn += 1) {
    if (!observed.has(turn)) missingTurns.push(turn);
  }
  return { observedPoints: observed.size, missingTurns };
}

function nationalTelemetry({
  country,
  durableApproval,
  durableMacro,
  legacyApproval,
  legacyGdpGrowth,
  legacyPopulationGrowth,
  hasDurableRun,
  sourceCapability = "unknown",
  fromTurn = 1,
  toTurn,
}) {
  const durable = hasDurableRun ?? (durableApproval.length > 0 || durableMacro.length > 0);
  if (!durable && sourceCapability === "legacy") {
    return {
      source: "legacy-bounded",
      approval: legacyApproval,
      gdpLevels: [],
      populationLevels: [],
      gdpGrowth: legacyGdpGrowth,
      populationGrowth: legacyPopulationGrowth,
      coverage: null,
    };
  }
  const approval = series(
    durableApproval.map((row) => ({ ...row, metric: "approval", value: row.approval })),
    country,
    "approval"
  );
  const gdpLevels = series(durableMacro, country, "economic.gdp");
  const populationLevels = series(durableMacro, country, "population.population");
  return {
    source: durable ? "durable" : "unavailable",
    approval,
    gdpLevels,
    populationLevels,
    gdpGrowth: [],
    populationGrowth: [],
    coverage: {
      approval: coverage(approval, fromTurn, toTurn),
      gdp: coverage(gdpLevels, fromTurn, toTurn),
      population: coverage(populationLevels, fromTurn, toTurn),
    },
  };
}

module.exports = { nationalTelemetry };
