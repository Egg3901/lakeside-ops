const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCountryFx,
  convertSectorRevenue,
  rankPublicSectorCorporations,
} = require("./sector-fx");

test("converts sector revenue with the host country's currency", () => {
  const countryFx = buildCountryFx([
    { countryId: "US", currencyCode: "USD", rate: 1.1 },
    { countryId: "JP", currencyCode: "JPY", rate: 292.5 },
  ]);

  const converted = convertSectorRevenue(
    { countryId: "JP", revenue: 1_016_665_917.53 },
    countryFx
  );

  assert.deepEqual(converted, {
    currencyCode: "JPY",
    localPerAnchor: 292.5,
    revenueAnchor: 3_475_780.9146324787,
  });
  assert.notEqual(converted.revenueAnchor, 1_016_665_917.53 / 1.1);
});

test("does not invent a conversion when host-country FX is missing", () => {
  const countryFx = buildCountryFx([{ countryId: "US", currencyCode: "USD", rate: 1.1 }]);

  assert.equal(
    convertSectorRevenue({ countryId: "JP", revenue: 1_000 }, countryFx),
    undefined
  );
});

test("rejects invalid rates and amounts", () => {
  const countryFx = buildCountryFx([
    { countryId: "JP", currencyCode: "JPY", rate: 0 },
    { countryId: "FR", currencyCode: "FRF", rate: Number.NaN },
  ]);

  assert.equal(convertSectorRevenue({ countryId: "JP", revenue: 1_000 }, countryFx), undefined);
  assert.equal(convertSectorRevenue({ countryId: "FR", revenue: 1_000 }, countryFx), undefined);
  assert.equal(convertSectorRevenue({ countryId: "US", revenue: Number.NaN }, countryFx), undefined);
});

test("ranks mixed-country stakes by host-currency anchor revenue", () => {
  const corporations = [
    { _id: "tinky", name: "Tinky", liquidCurrencyCode: "USD" },
    { _id: "fiskars", name: "Fiskars", liquidCurrencyCode: "GBP" },
  ];
  const rows = [
    { corporationId: "tinky", countryId: "JP", revenue: 990_000_000 },
    { corporationId: "fiskars", countryId: "US", revenue: 8_000_000 },
  ];
  const countryFx = buildCountryFx([
    { countryId: "JP", currencyCode: "JPY", rate: 300 },
    { countryId: "US", currencyCode: "USD", rate: 1 },
  ]);

  const result = rankPublicSectorCorporations(rows, corporations, countryFx);

  assert.deepEqual(
    result.ranked.map(({ corp, revenueAnchor }) => [corp.name, revenueAnchor]),
    [
      ["Fiskars", 8_000_000],
      ["Tinky", 3_300_000],
    ]
  );
  assert.equal(result.missingFxStakeRows, 0);
});

test("omits a corporation rather than publishing a partial total when any stake lacks FX", () => {
  const corporations = [{ _id: "tinky", name: "Tinky" }];
  const rows = [
    { corporationId: "tinky", countryId: "US", revenue: 10 },
    { corporationId: "tinky", countryId: "XX", revenue: 20 },
  ];
  const countryFx = buildCountryFx([{ countryId: "US", currencyCode: "USD", rate: 1 }]);

  const result = rankPublicSectorCorporations(rows, corporations, countryFx);

  assert.deepEqual(result.ranked, []);
  assert.equal(result.missingFxStakeRows, 1);
  assert.equal(result.omittedCorporations, 1);
});
