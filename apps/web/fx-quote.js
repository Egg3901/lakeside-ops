"use strict";

function round(value, places = 6) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function requireRate(row, label) {
  const rate = Number(row?.rate);
  if (!Number.isFinite(rate) || rate === 0) {
    throw new Error(`${label} must have a valid non-zero rate`);
  }
  return rate;
}

function currencyDetails(row) {
  return {
    countryId: row.countryId || null,
    currencyCode: row.currencyCode,
    localPerAnchor: Number(row.rate),
    baseRate: Number.isFinite(Number(row.baseRate)) ? Number(row.baseRate) : null,
    macroTarget: Number.isFinite(Number(row.macroTarget)) ? Number(row.macroTarget) : null,
    buyVolume24: Number.isFinite(Number(row.buyVolume24)) ? Number(row.buyVolume24) : null,
    sellVolume24: Number.isFinite(Number(row.sellVolume24)) ? Number(row.sellVolume24) : null,
    cyclePressureRegime: row.cyclePressureRegime || null,
    cyclePressureUntilTurn: row.cyclePressureUntilTurn ?? null,
  };
}

function buildFxQuote(baseRow, quoteRow, { historyTurns = 20 } = {}) {
  const baseRate = requireRate(baseRow, "base currency");
  const quoteRate = requireRate(quoteRow, "quote currency");
  const baseCurrency = String(baseRow.currencyCode || "").toUpperCase();
  const quoteCurrency = String(quoteRow.currencyCode || "").toUpperCase();
  if (!baseCurrency || !quoteCurrency) throw new Error("both rows must have a currencyCode");

  const quoteHistory = new Map((quoteRow.rateHistory || []).map((point) => [point.turn, Number(point.rate)]));
  const history = (baseRow.rateHistory || []).flatMap((basePoint) => {
    const historicalBase = Number(basePoint.rate);
    const historicalQuote = quoteHistory.get(basePoint.turn);
    if (!Number.isFinite(historicalBase) || historicalBase === 0 || !Number.isFinite(historicalQuote)) return [];
    return [{
      turn: basePoint.turn,
      quotePerBase: round(historicalQuote / historicalBase),
      basePerQuote: round(historicalBase / historicalQuote),
    }];
  }).sort((a, b) => a.turn - b.turn).slice(-historyTurns);

  const quotePerBase = round(quoteRate / baseRate);
  const basePerQuote = round(baseRate / quoteRate);
  const first = history[0]?.quotePerBase;
  const changePct = first ? round(((quotePerBase - first) / first) * 100, 2) : null;

  return {
    pair: `${baseCurrency}/${quoteCurrency}`,
    current: { baseCurrency, quoteCurrency, quotePerBase, basePerQuote },
    changeOverHistoryPct: changePct,
    base: currencyDetails(baseRow),
    quote: currencyDetails(quoteRow),
    formula: "quotePerBase = quote.localPerAnchor / base.localPerAnchor",
    history,
    chart: {
      metric: `${quoteCurrency} per ${baseCurrency}`,
      xLabel: "turn",
      x: history.map((point) => point.turn),
      y: history.map((point) => point.quotePerBase),
    },
  };
}

module.exports = { buildFxQuote };
