// fx.js — forex conversion to the game anchor (₳). Shared by watchtower.js and
// the gamestate MCP forensics tools so neither sums raw local-currency amounts
// (the t841 nationalization-FX incident bug class). exchangeRates.rate is
// "units of that currency per 1 anchor", so anchor = amount / rate.

async function loadRates(db) {
  const rows = await db.collection("exchangeRates")
    .find({}, { projection: { currencyCode: 1, rate: 1 } }).toArray();
  const map = {};
  for (const r of rows) if (r.currencyCode && r.rate) map[r.currencyCode] = r.rate;
  return map;
}

// Convert a local-currency amount to anchor ₳. Unknown currency → treat as 1:1
// (best effort) rather than dropping the value silently.
function toAnchor(amount, currencyCode, rates) {
  if (typeof amount !== "number" || !isFinite(amount)) return 0;
  const rate = rates[currencyCode];
  return rate ? amount / rate : amount;
}

module.exports = { loadRates, toAnchor };
