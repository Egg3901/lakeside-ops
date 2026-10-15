const test = require("node:test");
const assert = require("node:assert/strict");
const { buildEconomyMetricSnapshot } = require("./economy-metrics");

test("uses only canonical state metrics and population weights world metrics", () => {
  const states = [
    { _id: "US_BIG", countryId: "US", population: 900 },
    { _id: "US_SMALL", countryId: "US", population: 100 },
    { _id: "JP_ONE", countryId: "JP", population: 1_000 },
  ];
  const metric = (id, countryId, gdpGrowth, income) => ({
    _id: id,
    countryId,
    economic: {
      gdpGrowth: { value: gdpGrowth },
      unemploymentRate: { value: 5 },
      medianIncome: { value: income },
      povertyRate: { value: 10 },
      costOfLiving: { value: 100 },
    },
  });
  const metrics = [
    metric("US_BIG", "US", 2, 40_000),
    metric("US_SMALL", "US", 12, 20_000),
    metric("JP_ONE", "JP", 4, 6_000_000),
    metric("federal", "US", 99, 99_000_000),
    metric("UKR", "RU", 99, 99_000_000),
  ];
  const fx = [
    { countryId: "US", currencyCode: "USD", rate: 1 },
    { countryId: "JP", currencyCode: "JPY", rate: 150 },
  ];

  const result = buildEconomyMetricSnapshot(states, metrics, fx);

  assert.equal(result.excludedMetricDocCount, 2);
  assert.equal(result.world.gdpGrowth, 3.5);
  assert.equal(result.world.medianIncomeAnchor, 39_000);
  assert.equal(result.world.medianIncomeAnchorPopulation, 2_000);
  assert.equal(result.world.medianIncomeAnchorCoveragePct, 100);
  assert.deepEqual(result.countries.find((row) => row.countryId === "US"), {
    countryId: "US",
    population: 1_000,
    stateCount: 2,
    metricStateCount: 2,
    currencyCode: "USD",
    localPerAnchor: 1,
    metrics: {
      gdpGrowth: 3,
      unemploymentRate: 5,
      povertyRate: 10,
      costOfLiving: 100,
      medianIncomeLocal: 38_000,
      medianIncomeAnchor: 38_000,
    },
  });
});

test("does not invent anchor income when country FX is missing", () => {
  const result = buildEconomyMetricSnapshot(
    [{ _id: "XX_A", countryId: "XX", population: 100 }],
    [{ _id: "XX_A", countryId: "XX", economic: { medianIncome: { value: 10_000 } } }],
    []
  );

  assert.equal(result.countries[0].metrics.medianIncomeLocal, 10_000);
  assert.equal(result.countries[0].metrics.medianIncomeAnchor, undefined);
  assert.equal(result.world.medianIncomeAnchor, undefined);
  assert.equal(result.world.medianIncomeAnchorPopulation, 0);
  assert.equal(result.world.medianIncomeAnchorCoveragePct, 0);
});
