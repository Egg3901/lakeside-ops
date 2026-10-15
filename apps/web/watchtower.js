// watchtower.js — cross-instrument anomaly sentinel for the GAME SIMULATION.
// Read-only. Reuses engineHealth() and adds cross-collection checks that no
// single subsystem alarm would catch (market activity collapse, minted wealth,
// corporate black holes, unfunded savings interest). Consumed by:
//   • the /observatory page (Watchtower feed)
//   • daily-report.js cron (folds these alerts into the daily digest)
//   • the audit registry (findings can be promoted to tracked entries)
// Every check is independently try/caught so one failing probe can't blank the
// board — it degrades to a "probe-failed" info line instead.

const { engineHealth } = require("./engine-health");
const { loadRates, toAnchor } = require("./fx");
const { ObjectId } = require("mongodb");

const REGISTRY_COLLECTION = "opsAuditRegistry";

// severity rank for sorting: crit > warn > info > ok
const RANK = { crit: 0, warn: 1, info: 2, ok: 3 };

function pct(a, b) { return b ? Math.round(((a - b) / b) * 100) : 0; }
function money(n) {
  if (n == null || !isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return Math.round(n).toString();
}

// ── individual probes ──────────────────────────────────────────────
// Each returns 0+ alert objects: {severity, code, title, detail, metric, source, turn}

async function probeEngine(db, turn) {
  const h = await engineHealth(db);
  const map = { error: "crit", warn: "warn", info: "info" };
  return (h.flags || []).map((f) => ({
    severity: map[f.level] || "info",
    code: "engine:" + f.code,
    title: f.msg,
    detail: null,
    metric: null,
    source: "engine",
    turn: h.turn,
  }));
}

// Market activity collapse — the "−79% trading, unexplained" class of finding.
// Compares trade volume in the most recent 3-turn window vs the prior 3-turn one.
async function probeMarketActivity(db, turn) {
  if (turn == null) return [];
  const recent = await db.collection("shareTradeHistory")
    .countDocuments({ turn: { $gt: turn - 3, $lte: turn } });
  const prior = await db.collection("shareTradeHistory")
    .countDocuments({ turn: { $gt: turn - 6, $lte: turn - 3 } });
  // Require real baseline volume (≈20 trades/turn) before calling a collapse —
  // on a market that does ~5 trades/turn a % swing is noise, not a signal.
  if (prior < 60) return [];
  const change = pct(recent, prior);
  if (change <= -40) {
    return [{
      severity: change <= -70 ? "crit" : "warn",
      code: "market:activity-collapse",
      title: `Share-trade volume fell ${Math.abs(change)}% in 3 turns`,
      detail: `${recent} trades in turns ${turn - 2}–${turn} vs ${prior} in the prior window. A drop this steep with no engine failure usually means a deploy or a phase silently stopped writing.`,
      metric: `${prior} → ${recent}`,
      source: "shareTradeHistory",
      turn,
    }];
  }
  if (recent === 0) {
    return [{ severity: "crit", code: "market:silent", title: "The market recorded zero trades last window", detail: "No shareTradeHistory writes in the last 3 turns — the exchange may be dead while no alarm fires.", metric: "0 trades", source: "shareTradeHistory", turn }];
  }
  return [];
}

// Corporate black holes — insolvency concentration + a single extreme outlier.
async function probeCorpSolvency(db, turn) {
  const total = await db.collection("corporations").countDocuments({ isNationalized: { $ne: true } });
  if (!total) return [];
  const insolvent = await db.collection("corporations")
    .countDocuments({ isNationalized: { $ne: true }, liquidCapital: { $lt: 0 } });
  const out = [];
  const share = Math.round((insolvent / total) * 100);
  if (share >= 5) {
    out.push({ severity: share >= 15 ? "crit" : "warn", code: "corp:insolvency", title: `${share}% of corporations are insolvent`, detail: `${insolvent} of ${total} active corporations hold negative liquid capital.`, metric: `${insolvent}/${total}`, source: "corporations", turn });
  }
  const worst = await db.collection("corporations")
    .find({ isNationalized: { $ne: true }, liquidCapital: { $lt: -1e9 } }, { projection: { name: 1, liquidCapital: 1, liquidCurrencyCode: 1 } })
    .sort({ liquidCapital: 1 }).limit(1).toArray();
  if (worst[0]) {
    out.push({ severity: "crit", code: "corp:black-hole", title: `"${worst[0].name}" is a balance-sheet black hole`, detail: `Liquid capital ${money(worst[0].liquidCapital)} ${worst[0].liquidCurrencyCode || ""}. A single corp this far negative distorts every aggregate it touches. Run trace_corp to find the turn it broke.`, metric: money(worst[0].liquidCapital), source: "corporations", turn, entity: { type: "corporation", id: String(worst[0]._id), name: worst[0].name } });
  }
  return out;
}

// Unfunded savings interest — money minted into balances with no matching sink.
// FOREX-AWARE: savingsLedger.amount is in each account's local currency, so we
// convert every credit to the anchor ₳ before summing/ranking — otherwise a
// weak-currency account (e.g. NGN at ~1557/₳) falsely dominates by denomination.
// Interest is paid in periodic batches (~every 6 turns) so we scan a window, and
// we flag on CONCENTRATION (one account's share of all interest), which is the
// currency-robust signal, not a raw total.
const SAVINGS_WINDOW = 8;
async function probeSavingsMint(db, turn) {
  if (turn == null) return [];
  const from = turn - SAVINGS_WINDOW;
  const rates = await loadRates(db);
  const rows = await db.collection("savingsLedger").aggregate([
    { $match: { type: "interest", turn: { $gt: from, $lte: turn } } },
    { $group: { _id: { ch: "$characterId", ccy: "$currencyCode" }, amt: { $sum: "$amount" }, n: { $sum: 1 } } },
  ]).toArray();
  if (!rows.length) return [];
  const perCh = {}; let total = 0, credits = 0;
  for (const r of rows) {
    const a = toAnchor(r.amt, r._id.ccy, rates);
    perCh[r._id.ch] = (perCh[r._id.ch] || 0) + a;
    total += a; credits += r.n;
  }
  const ranked = Object.entries(perCh).sort((a, b) => b[1] - a[1]);
  const [topId, topAmt] = ranked[0] || [null, 0];
  const share = total > 0 ? topAmt / total : 0;
  const out = [];
  // Total interest across the pool spiking well past baseline (anchor ₳).
  if (total > 2e7) {
    out.push({ severity: "warn", code: "savings:interest-mint", title: `₳${money(total)} in savings interest paid in ${SAVINGS_WINDOW} turns`, detail: `${credits} interest credits since turn ${from} (forex-converted to anchor). If the treasury isn't debited the same amount this is minted money.`, metric: `₳${money(total)}`, source: "savingsLedger", turn });
  }
  // Concentration: one account taking a large share of all interest — the
  // currency-robust "leaderboard is minted" signal.
  if (topId && share >= 0.4 && topAmt > 1e6) {
    const ch = await db.collection("characters").findOne({ _id: ObjectId.isValid(topId) ? new ObjectId(topId) : topId }, { projection: { name: 1 } });
    out.push({ severity: share >= 0.75 ? "crit" : "warn", code: "savings:top-earner", title: `${ch ? ch.name : "One account"} earned ₳${money(topAmt)} in interest — ${Math.round(share * 100)}% of the pool`, detail: `Over ${SAVINGS_WINDOW} turns, forex-converted to anchor. Run trace_character to see whether the balance is legitimately funded. This is how a leaderboard gets minted.`, metric: `${Math.round(share * 100)}%`, source: "savingsLedger", turn, entity: { type: "character", id: String(topId), name: ch ? ch.name : null } });
  }
  return out;
}

// Wealth concentration — top holder's share of tracked wealth, and its slope.
async function probeWealthConcentration(db, turn) {
  const snaps = await db.collection("wealthListSnapshots")
    .find({}, { projection: { turn: 1, entries: 1, createdAt: 1 } })
    .sort({ turn: -1 }).limit(1).toArray();
  const snap = snaps[0];
  if (!snap || !Array.isArray(snap.entries) || !snap.entries.length) return [];
  const field = ["netWorth", "wealth", "total", "value", "amount"]
    .find((f) => typeof snap.entries[0][f] === "number");
  if (!field) return [];
  const vals = snap.entries.map((e) => e[field]).filter((v) => typeof v === "number").sort((a, b) => b - a);
  const sum = vals.reduce((a, v) => a + v, 0);
  if (sum <= 0) return [];
  const topShare = Math.round((vals[0] / sum) * 100);
  if (topShare >= 25) {
    return [{ severity: topShare >= 40 ? "crit" : "warn", code: "wealth:top-heavy", title: `Top wealth holder owns ${topShare}% of tracked wealth`, detail: `Leaderboard net worth ${money(vals[0])} of ${money(sum)} total across ${vals.length} tracked players. Concentration this high is usually a minting bug, not skill.`, metric: `${topShare}%`, source: "wealthListSnapshots", turn: snap.turn }];
  }
  return [];
}

// Commodity dumping — the clearing-era cartel/flood play (week-1 pass, t900).
// A same-turn surplus spike + price crash on one commodity is the signature of
// someone (or a legacy stockpile) flooding a posted-price market. Ledger-only
// read: commodityFlows for surplus, commodityPriceHistory for the price move.
async function probeCommodityDumping(db, turn) {
  if (turn == null) return [];
  const [cur, prev] = await Promise.all([
    db.collection("commodityFlows").find({ turn }, { projection: { commodity: 1, surplusUnits: 1, supplyUnits: 1 } }).toArray(),
    db.collection("commodityFlows").find({ turn: turn - 1 }, { projection: { commodity: 1, surplusUnits: 1 } }).toArray(),
  ]);
  if (!cur.length || !prev.length) return [];
  const prevSurplus = new Map(prev.map((d) => [d.commodity, d.surplusUnits || 0]));
  const [curPx, prevPx] = await Promise.all([
    db.collection("commodityPriceHistory").find({ turn }, { projection: { commodity: 1, globalPrice: 1 } }).toArray(),
    db.collection("commodityPriceHistory").find({ turn: turn - 1 }, { projection: { commodity: 1, globalPrice: 1 } }).toArray(),
  ]);
  const px = new Map(curPx.map((d) => [d.commodity, d.globalPrice]));
  const pxPrev = new Map(prevPx.map((d) => [d.commodity, d.globalPrice]));
  const out = [];
  for (const d of cur) {
    const sPrev = prevSurplus.get(d.commodity) || 0;
    const sCur = d.surplusUnits || 0;
    // Spike: surplus at least tripled AND is material (>10% of supply).
    if (!(sCur > 3 * Math.max(1, sPrev) && d.supplyUnits > 0 && sCur / d.supplyUnits > 0.1)) continue;
    const p = px.get(d.commodity), p0 = pxPrev.get(d.commodity);
    if (!(p > 0 && p0 > 0)) continue;
    const drop = ((p - p0) / p0) * 100;
    if (drop <= -5) {
      out.push({
        severity: drop <= -15 ? "crit" : "warn",
        code: "market:dumping",
        title: `Possible dumping in ${d.commodity}: surplus ×${(sCur / Math.max(1, sPrev)).toFixed(1)} + price ${drop.toFixed(1)}% in one turn`,
        detail: `Surplus ${Math.round(sPrev).toLocaleString()} → ${Math.round(sCur).toLocaleString()} units while the global price fell ${Math.abs(drop).toFixed(1)}%. Under posted-price clearing this is the flood signature — check whether one corp's stockpile drained the same turn (trace_sector / trace_ledger).`,
        metric: `${drop.toFixed(1)}% px`,
        source: "commodityFlows",
        turn,
      });
    }
  }
  return out;
}

// Market-rework dials — the week-1 live watchlist (see
// /reports/clearing-capital-live-t899): chronic per-commodity unmet demand,
// stockpile-cover overhang, and scarcity-drift multipliers pinned at cap.
async function probeMarketDials(db, turn) {
  if (turn == null) return [];
  const flows = await db.collection("commodityFlows")
    .find({ turn }, { projection: { commodity: 1, supplyUnits: 1, demandUnits: 1, unmetDemandUnits: 1, stockUnits: 1 } }).toArray();
  const out = [];
  for (const f of flows) {
    if (f.demandUnits > 0 && (f.unmetDemandUnits || 0) / f.demandUnits >= 0.6) {
      out.push({ severity: "warn", code: "market:chronic-shortage", title: `${f.commodity}: ${Math.round(((f.unmetDemandUnits || 0) / f.demandUnits) * 100)}% of demand unmet`, detail: `Supply ${Math.round(f.supplyUnits).toLocaleString()} vs demand ${Math.round(f.demandUnits).toLocaleString()} at turn ${turn}. If scarcity drift is enabled its multiplier should be climbing — flat prices here mean the signal is still not transmitting.`, metric: `s/d ${(f.supplyUnits / f.demandUnits).toFixed(2)}`, source: "commodityFlows", turn });
    }
    if (f.demandUnits > 0 && f.stockUnits != null && f.stockUnits / f.demandUnits >= 800) {
      out.push({ severity: "warn", code: "market:stock-overhang", title: `${f.commodity}: ${Math.round(f.stockUnits / f.demandUnits).toLocaleString()} turns of stock cover`, detail: `${Math.round(f.stockUnits).toLocaleString()} units banked against ${Math.round(f.demandUnits).toLocaleString()}/turn demand — pre-clearing legacy inventory that can flood the market at will. Cover-cap spoilage (stockCoverCapEnabled) is the designed drawdown.`, metric: `${Math.round(f.stockUnits / f.demandUnits)}t cover`, source: "commodityFlows", turn });
    }
  }
  // Scarcity-drift multipliers pinned at cap → the drift has said all it can;
  // supply-side response (capacity, adoption) is the remaining lever.
  const pinned = await db.collection("commodityPrices")
    .find({ scarcityMult: { $gte: 2.45 } }, { projection: { commodity: 1, scarcityMult: 1 } }).toArray();
  for (const p of pinned) {
    out.push({ severity: "info", code: "market:drift-capped", title: `${p.commodity} scarcity multiplier pinned at cap (${p.scarcityMult.toFixed(2)}×)`, detail: "Price memory has saturated — further correction must come from supply (capacity bumps, re-strategizing, placement), not price.", metric: `${p.scarcityMult.toFixed(2)}×`, source: "commodityPrices", turn });
  }
  return out;
}

const PROBES = [
  ["engine", probeEngine],
  ["market activity", probeMarketActivity],
  ["corp solvency", probeCorpSolvency],
  ["savings mint", probeSavingsMint],
  ["wealth concentration", probeWealthConcentration],
  ["commodity dumping", probeCommodityDumping],
  ["market dials", probeMarketDials],
];

// Run every probe, tolerate individual failures, return a sorted alert list.
async function watchtowerScan(db) {
  const gs = (await db.collection("gameState").findOne({ isActive: true }, { projection: { currentTurn: 1 } })) || {};
  const turn = gs.currentTurn ?? null;
  const results = await Promise.all(PROBES.map(async ([name, fn]) => {
    try { return await fn(db, turn); }
    catch (e) { return [{ severity: "info", code: "probe:failed", title: `Probe "${name}" failed`, detail: e.message, metric: null, source: name, turn }]; }
  }));
  const alerts = results.flat();
  alerts.sort((a, b) => (RANK[a.severity] - RANK[b.severity]) || 0);
  const counts = alerts.reduce((m, a) => ((m[a.severity] = (m[a.severity] || 0) + 1), m), {});
  return { turn, alerts, counts, scannedAt: new Date() };
}

module.exports = { watchtowerScan, REGISTRY_COLLECTION, money };
