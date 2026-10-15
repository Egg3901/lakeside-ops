const METRIC_FIELDS = [
  "gdpGrowth",
  "unemploymentRate",
  "povertyRate",
  "costOfLiving",
];

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round2(value) {
  return finiteNumber(value) ? Math.round(value * 100) / 100 : undefined;
}

function weightedMean(rows, valueForRow) {
  let weightedTotal = 0;
  let weightTotal = 0;
  for (const row of rows) {
    const value = valueForRow(row);
    const weight = Number(row.population);
    if (!finiteNumber(value) || !finiteNumber(weight) || weight <= 0) continue;
    weightedTotal += value * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedTotal / weightTotal : undefined;
}

function buildEconomyMetricSnapshot(states, metricDocs, exchangeRows) {
  const metricsByState = new Map((metricDocs || []).map((row) => [String(row._id), row]));
  const fxByCountry = new Map();
  for (const row of exchangeRows || []) {
    const countryId = row && (row.countryId || row._id);
    const rate = Number(row && row.rate);
    if (!countryId || !row.currencyCode || !finiteNumber(rate) || rate <= 0) continue;
    fxByCountry.set(String(countryId), {
      currencyCode: row.currencyCode,
      localPerAnchor: rate,
    });
  }

  const joined = [];
  const byCountry = new Map();
  for (const state of states || []) {
    const countryId = String(state.countryId || "");
    const population = Number(state.population);
    const metric = metricsByState.get(String(state._id));
    if (!countryId || !finiteNumber(population) || population <= 0) continue;

    const row = { state, metric, countryId, population, fx: fxByCountry.get(countryId) };
    joined.push(row);
    const countryRows = byCountry.get(countryId) || [];
    countryRows.push(row);
    byCountry.set(countryId, countryRows);
  }

  const metricValue = (field) => (row) => row.metric?.economic?.[field]?.value;
  const incomeAnchor = (row) => {
    const income = row.metric?.economic?.medianIncome?.value;
    return finiteNumber(income) && row.fx ? income / row.fx.localPerAnchor : undefined;
  };

  const countries = [...byCountry.entries()].map(([countryId, rows]) => {
    const fx = fxByCountry.get(countryId);
    const metrics = {};
    for (const field of METRIC_FIELDS) metrics[field] = round2(weightedMean(rows, metricValue(field)));
    metrics.medianIncomeLocal = round2(weightedMean(rows, metricValue("medianIncome")));
    metrics.medianIncomeAnchor = round2(weightedMean(rows, incomeAnchor));
    return {
      countryId,
      population: rows.reduce((sum, row) => sum + row.population, 0),
      stateCount: rows.length,
      metricStateCount: rows.filter((row) => row.metric).length,
      currencyCode: fx?.currencyCode || null,
      localPerAnchor: fx?.localPerAnchor,
      metrics,
    };
  }).sort((a, b) => a.countryId.localeCompare(b.countryId));

  const world = {};
  for (const field of METRIC_FIELDS) world[field] = round2(weightedMean(joined, metricValue(field)));
  world.medianIncomeAnchor = round2(weightedMean(joined, incomeAnchor));
  const totalPopulation = joined.reduce((sum, row) => sum + row.population, 0);
  const incomeAnchorPopulation = joined.reduce(
    (sum, row) => sum + (finiteNumber(incomeAnchor(row)) ? row.population : 0),
    0
  );
  world.medianIncomeAnchorPopulation = incomeAnchorPopulation;
  world.medianIncomeAnchorCoveragePct = totalPopulation > 0
    ? round2(incomeAnchorPopulation / totalPopulation * 100)
    : 0;

  const canonicalMetricIds = new Set(joined.filter((row) => row.metric).map((row) => String(row.metric._id)));
  return {
    method: "population-weighted canonical state metrics; income converted to anchor currency",
    population: totalPopulation,
    canonicalStateCount: joined.length,
    canonicalMetricCount: canonicalMetricIds.size,
    excludedMetricDocCount: Math.max(0, (metricDocs || []).length - canonicalMetricIds.size),
    world,
    countries,
  };
}

async function loadEconomyMetricSnapshot(db) {
  const [states, metricDocs, exchangeRows] = await Promise.all([
    db.collection("states").find({}, { projection: { _id: 1, countryId: 1, population: 1 } }).toArray(),
    db.collection("macroMetrics").find({}, { projection: {
      _id: 1,
      countryId: 1,
      "economic.gdpGrowth.value": 1,
      "economic.unemploymentRate.value": 1,
      "economic.medianIncome.value": 1,
      "economic.povertyRate.value": 1,
      "economic.costOfLiving.value": 1,
    } }).toArray(),
    db.collection("exchangeRates").find({}, { projection: {
      _id: 1,
      countryId: 1,
      currencyCode: 1,
      rate: 1,
    } }).toArray(),
  ]);
  return buildEconomyMetricSnapshot(states, metricDocs, exchangeRows);
}

module.exports = { buildEconomyMetricSnapshot, loadEconomyMetricSnapshot, weightedMean };
