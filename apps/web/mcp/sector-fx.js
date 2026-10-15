function buildCountryFx(exchangeRows) {
  const byCountry = new Map();
  for (const row of exchangeRows || []) {
    const countryId = row && (row.countryId || row._id);
    const currencyCode = row && row.currencyCode;
    const rate = Number(row && row.rate);
    if (!countryId || !currencyCode || !Number.isFinite(rate) || rate <= 0) continue;
    byCountry.set(String(countryId), { currencyCode, localPerAnchor: rate });
  }
  return byCountry;
}

function convertSectorRevenue(sector, countryFx) {
  const revenue = Number(sector && sector.revenue);
  const fx = countryFx && countryFx.get(String(sector && sector.countryId));
  if (!Number.isFinite(revenue) || !fx) return undefined;
  return {
    currencyCode: fx.currencyCode,
    localPerAnchor: fx.localPerAnchor,
    revenueAnchor: revenue / fx.localPerAnchor,
  };
}

function rankPublicSectorCorporations(rows, corporations, countryFx) {
  const publicById = new Map(
    (corporations || [])
      .filter((corp) => corp.isPrivate !== true && corp.hiddenFromExchange !== true)
      .map((corp) => [String(corp._id), corp])
  );
  const totals = new Map();
  let missingFxStakeRows = 0;

  for (const row of rows || []) {
    const id = String(row.corporationId);
    const corp = publicById.get(id);
    if (!corp) continue;
    const current = totals.get(id) || {
      corp,
      stakes: 0,
      revenueAnchor: 0,
      missingFxStakes: 0,
    };
    current.stakes += 1;
    const converted = convertSectorRevenue(row, countryFx);
    if (converted) current.revenueAnchor += converted.revenueAnchor;
    else {
      current.missingFxStakes += 1;
      missingFxStakeRows += 1;
    }
    totals.set(id, current);
  }

  const all = [...totals.values()];
  const ranked = all
    .filter((row) => row.missingFxStakes === 0)
    .sort((a, b) => b.revenueAnchor - a.revenueAnchor);
  return {
    ranked,
    missingFxStakeRows,
    omittedCorporations: all.length - ranked.length,
  };
}

module.exports = { buildCountryFx, convertSectorRevenue, rankPublicSectorCorporations };
