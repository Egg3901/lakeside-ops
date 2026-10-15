"use strict";

function metricValue(metric) { return metric && Number.isFinite(metric.value) ? metric.value : null; }
function pct(value) { return Number.isFinite(value) ? Math.round(value * 1000) / 10 : null; }
function round(value, digits = 1) { if (!Number.isFinite(value)) return null; const n = 10 ** digits; return Math.round(value * n) / n; }
function percentChange(current, previous) { return !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0 ? null : round(((current - previous) / Math.abs(previous)) * 100); }
function pointDelta(current, previous) { return !Number.isFinite(current) || !Number.isFinite(previous) ? null : round(current - previous); }
function trendAt(series, currentTurn, turnsAgo) {
  const current = series.find((row) => row.turn === currentTurn) || series.at(-1);
  if (!current) return { current: null, previous: null, turns: turnsAgo };
  const previous = [...series].reverse().find((row) => row.turn <= current.turn - turnsAgo) || null;
  return { current, previous, turns: previous ? current.turn - previous.turn : turnsAgo };
}
function severityRank(level) { return ({ critical: 4, warning: 3, watch: 2, positive: 1, info: 0 })[level] ?? 0; }

function buildSignals({ players, economy, markets, politics }) {
  const signals = [];
  const activity = players?.activityTrend;
  if (activity && Number.isFinite(activity.changePct) && Math.abs(activity.changePct) >= 10) {
    const falling = activity.changePct <= -20, rising = activity.changePct >= 20;
    signals.push({ level: falling ? "warning" : rising ? "positive" : "info", domain: "Players", title: falling ? "Player participation fell" : rising ? "Player participation rose" : "Player participation is steady", value: `${activity.changePct > 0 ? "+" : ""}${activity.changePct}%`, detail: `${activity.current} players acted in the latest 24 turns versus ${activity.previous} in the prior 24.` });
  }
  for (const cohort of [economy?.player, economy?.npp].filter(Boolean)) {
    if (!cohort.change24) continue;
    const label = cohort.key === "player" ? "Player corporations" : "NPP corporations";
    const shock = cohort.change1;
    if (shock && (Math.abs(shock.incomePct || 0) >= 15 || Math.abs(shock.marginPoints || 0) >= 3)) {
      const worsening = shock.incomePct < 0 || shock.marginPoints < 0;
      signals.push({ level: worsening ? "warning" : "positive", domain: "Economy", title: `${label} had a ${worsening ? "sharp setback" : "strong turn"}`, value: `${shock.incomePct > 0 ? "+" : ""}${shock.incomePct}% income`, detail: `Net income moved ${shock.incomePct > 0 ? "up" : "down"} in the latest turn; operating margin moved ${shock.marginPoints >= 0 ? "+" : ""}${shock.marginPoints} points.`, cause: cohort.driver1 });
    }
    const lossDelta = cohort.change24.lossRatePoints, marginDelta = cohort.change24.marginPoints;
    if (Math.abs(lossDelta || 0) < 3 && Math.abs(marginDelta || 0) < 3) {
      if (Math.abs(cohort.change24.revenuePct || 0) >= 10) signals.push({ level: cohort.change24.revenuePct > 0 ? "positive" : "watch", domain: "Economy", title: `${label} revenue ${cohort.change24.revenuePct > 0 ? "expanded" : "contracted"}`, value: `${cohort.change24.revenuePct > 0 ? "+" : ""}${cohort.change24.revenuePct}%`, detail: `FX-normalized revenue over 24 turns, with margin moving ${cohort.change24.marginPoints >= 0 ? "+" : ""}${cohort.change24.marginPoints} points.`, cause: cohort.driver });
      continue;
    }
    const worsening = lossDelta >= 3 || marginDelta <= -3;
    signals.push({ level: worsening ? (lossDelta >= 10 ? "critical" : "warning") : "positive", domain: "Economy", title: `${label} ${worsening ? "are under more pressure" : "improved"}`, value: `${cohort.latest.lossRate}% losing`, detail: `${lossDelta >= 0 ? "+" : ""}${lossDelta} points versus ${cohort.change24.turns} turns ago; operating margin moved ${marginDelta >= 0 ? "+" : ""}${marginDelta} points.`, cause: cohort.driver });
  }
  const membership = politics?.membershipTrend;
  if (membership && Number.isFinite(membership.change) && membership.change !== 0) {
    signals.push({ level: Math.abs(membership.change) >= 3 ? "watch" : "info", domain: "Politics", title: membership.change === 0 ? "Player party membership is unchanged" : `Player party membership ${membership.change > 0 ? "grew" : "contracted"}`, value: `${membership.change > 0 ? "+" : ""}${membership.change}`, detail: `${membership.current} player party members across playable countries, compared with ${membership.previous} ${membership.turns} turns ago.`, cause: membership.driver });
  }
  const market = markets?.latest;
  const mover = markets?.worsening?.[0];
  if (market && mover && mover.deltaPoints <= -5) {
    signals.push({
      level: mover.fillPct < 25 ? "warning" : "watch",
      domain: "Markets",
      title: `${mover.label} availability deteriorated`,
      value: `${mover.deltaPoints} points`,
      detail: `${mover.fillPct}% of demand was filled across playable countries, down over ${markets.comparisonTurns} turns. ${market.severe} commodity markets are below 50% fill.`,
      cause: `${Math.round(mover.unmetUnits).toLocaleString()} units of demand went unmet this turn.`,
    });
  }
  return signals.sort((a, b) => severityRank(b.level) - severityRank(a.level)).slice(0, 5);
}

const OPERATED_CORPORATION = { $or: [{ ceoType: "npp" }, { ceoType: { $in: ["character", "imperial"] }, userId: { $exists: true, $ne: null } }] };

async function playableCountryIds(db) {
  const rows = await db.collection("countryGameStates").find({ enabledForPlayers: true }, { projection: { countryId: 1, code: 1 } }).toArray();
  return rows.map((row) => row.countryId || row.code || row._id).filter(Boolean);
}
async function scopedCorporations(db, countryIds) {
  return db.collection("corporations").find({ countryId: { $in: countryIds }, ...OPERATED_CORPORATION }, { projection: { _id: 1, name: 1, countryId: 1, ceoType: 1 } }).toArray();
}

async function playerPulse(db, currentTurn) {
  const users = db.collection("users"), actions = db.collection("actionLogs"), now = Date.now();
  const activitySince = (date) => ({ $or: [{ lastActivity: { $gte: date } }, { lastLogin: { $gte: date } }] });
  const currentWindow = currentTurn == null ? {} : { turn: { $gt: currentTurn - 24, $lte: currentTurn } };
  const priorWindow = currentTurn == null ? {} : { turn: { $gt: currentTurn - 48, $lte: currentTurn - 24 } };
  const [total, active24h, active7d, new7d, currentActors, priorActors, currentActions, priorActions] = await Promise.all([
    users.estimatedDocumentCount(), users.countDocuments(activitySince(new Date(now - 86400000))), users.countDocuments(activitySince(new Date(now - 7 * 86400000))), users.countDocuments({ createdAt: { $gte: new Date(now - 7 * 86400000) } }), actions.distinct("userId", currentWindow), actions.distinct("userId", priorWindow), actions.countDocuments(currentWindow), actions.countDocuments(priorWindow),
  ]);
  const current = currentActors.filter(Boolean).length, previous = priorActors.filter(Boolean).length;
  return { total, active24h, active7d, new7d, activityTrend: { current, previous, changePct: percentChange(current, previous), currentActions, priorActions, turns: 24 } };
}

function anchorExpression(field) {
  return { $cond: [{ $and: [{ $ne: ["$currencyCode", null] }, { $gt: [{ $ifNull: ["$fxRateAtWrite", 0] }, 0] }] }, { $divide: [{ $ifNull: [`$${field}`, 0] }, "$fxRateAtWrite"] }, { $ifNull: [`$${field}`, 0] }] };
}
async function cohortSeries(db, currentTurn, ids) {
  if (!ids.length || currentTurn == null) return [];
  return db.collection("corporationHistory").aggregate([
    { $match: { corporationId: { $in: ids }, turn: { $gte: currentTurn - 24, $lte: currentTurn } } },
    { $project: { turn: 1, revenue: anchorExpression("revenue"), income: anchorExpression("income"), costs: anchorExpression("totalCosts") } },
    { $group: { _id: "$turn", firms: { $sum: 1 }, revenue: { $sum: "$revenue" }, income: { $sum: "$income" }, costs: { $sum: "$costs" }, losing: { $sum: { $cond: [{ $lt: ["$income", 0] }, 1, 0] } } } },
    { $project: { _id: 0, turn: "$_id", firms: 1, revenue: 1, income: 1, costs: 1, lossRate: { $multiply: [{ $divide: ["$losing", "$firms"] }, 100] }, margin: { $cond: [{ $gt: ["$revenue", 0] }, { $multiply: [{ $divide: ["$income", "$revenue"] }, 100] }, null] } } }, { $sort: { turn: 1 } },
  ]).toArray();
}
async function countryDrivers(db, currentTurn, corporations, turnsAgo) {
  const output = new Map();
  if (currentTurn == null || !corporations.length) return output;
  const rows = await db.collection("corporationHistory").aggregate([
    { $match: { corporationId: { $in: corporations.map((c) => c._id) }, turn: { $in: [currentTurn, currentTurn - turnsAgo] } } },
    { $project: { corporationId: 1, turn: 1, income: anchorExpression("income") } }, { $group: { _id: { corporationId: "$corporationId", turn: "$turn" }, income: { $sum: "$income" } } },
  ]).toArray();
  const values = new Map(rows.map((r) => [`${String(r._id.corporationId)}:${r._id.turn}`, r.income]));
  for (const corp of corporations) {
    const current = values.get(`${corp._id}:${currentTurn}`), previous = values.get(`${corp._id}:${currentTurn - turnsAgo}`);
    if (Number.isFinite(current) && Number.isFinite(previous)) output.set(corp.countryId, (output.get(corp.countryId) || 0) + current - previous);
  }
  return output;
}
function describeDriver(driver, turns) { return driver ? `${driver[0]} contributed the largest ${turns}-turn income movement (${driver[1] >= 0 ? "+" : ""}${Math.round(driver[1]).toLocaleString()} anchor).` : null; }
function summarizeCohort(key, series, drivers) {
  const window = trendAt(series, series.at(-1)?.turn, 24);
  if (!window.current) return { key, latest: {}, series: [] };
  const driver1 = [...drivers.one.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const driver24 = [...drivers.day.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const change = (turns) => { const comparison = trendAt(series, window.current.turn, turns); return comparison.previous ? { turns: comparison.turns, revenuePct: percentChange(comparison.current.revenue, comparison.previous.revenue), incomePct: percentChange(comparison.current.income, comparison.previous.income), lossRatePoints: pointDelta(comparison.current.lossRate, comparison.previous.lossRate), marginPoints: pointDelta(comparison.current.margin, comparison.previous.margin) } : null; };
  return { key, latest: { ...window.current, revenue: round(window.current.revenue, 0), income: round(window.current.income, 0), costs: round(window.current.costs, 0), lossRate: round(window.current.lossRate), margin: round(window.current.margin) }, change1: change(1), change6: change(6), change24: change(24), driver1: describeDriver(driver1, 1), driver: describeDriver(driver24, 24), series: series.map((row) => ({ turn: row.turn, income: round(row.income, 0), lossRate: round(row.lossRate), margin: round(row.margin) })) };
}
async function economyPulse(db, currentTurn, corporations) {
  const player = corporations.filter((c) => c.ceoType !== "npp"), npp = corporations.filter((c) => c.ceoType === "npp");
  const latest = await db.collection("corporationHistory").findOne(
    { corporationId: { $in: corporations.map((c) => c._id) }, ...(currentTurn == null ? {} : { turn: { $lte: currentTurn } }) },
    { sort: { turn: -1 }, projection: { turn: 1 } }
  );
  const historyTurn = latest?.turn ?? null;
  const [playerSeries, nppSeries, playerDriver1, playerDriver24, nppDriver1, nppDriver24] = await Promise.all([cohortSeries(db, historyTurn, player.map((c) => c._id)), cohortSeries(db, historyTurn, npp.map((c) => c._id)), countryDrivers(db, historyTurn, player, 1), countryDrivers(db, historyTurn, player, 24), countryDrivers(db, historyTurn, npp, 1), countryDrivers(db, historyTurn, npp, 24)]);
  return { turn: historyTurn, lagTurns: currentTurn != null && historyTurn != null ? currentTurn - historyTurn : null, player: summarizeCohort("player", playerSeries, { one: playerDriver1, day: playerDriver24 }), npp: summarizeCohort("npp", nppSeries, { one: nppDriver1, day: nppDriver24 }) };
}

function commodityLabel(value) {
  return String(value || "unknown").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

async function marketPulse(db, currentTurn, countryIds) {
  const latest = await db.collection("commodityFlows").findOne(
    currentTurn == null ? {} : { turn: { $lte: currentTurn } },
    { sort: { turn: -1 }, projection: { turn: 1 } }
  );
  const latestTurn = latest?.turn ?? null;
  if (latestTurn == null) return { series: [], worsening: [] };
  const rows = await db.collection("commodityFlows").aggregate([
    { $match: { turn: { $gte: latestTurn - 24, $lte: latestTurn } } },
    { $project: { turn: 1, commodity: 1, countries: { $objectToArray: "$byCountry" } } },
    { $unwind: "$countries" },
    { $match: { "countries.k": { $in: countryIds } } },
    { $group: { _id: { turn: "$turn", commodity: "$commodity" }, demand: { $sum: { $ifNull: ["$countries.v.demand", 0] } }, cleared: { $sum: { $ifNull: ["$countries.v.cleared", 0] } } } },
    { $project: { _id: 0, turn: "$_id.turn", commodity: "$_id.commodity", demand: 1, cleared: 1, fill: { $cond: [{ $gt: ["$demand", 0] }, { $divide: ["$cleared", "$demand"] }, null] } } },
    { $sort: { turn: 1 } },
  ]).toArray();
  const turns = [...new Set(rows.map((row) => row.turn))].sort((a, b) => a - b);
  const series = turns.map((turn) => {
    const points = rows.filter((row) => row.turn === turn && Number.isFinite(row.fill));
    const demand = points.reduce((sum, row) => sum + row.demand, 0);
    const cleared = points.reduce((sum, row) => sum + row.cleared, 0);
    return { turn, fillPct: demand > 0 ? round((cleared / demand) * 100) : null, empty: points.filter((row) => row.demand > 0 && row.cleared === 0).length, severe: points.filter((row) => row.fill < 0.5).length };
  });
  const current = rows.filter((row) => row.turn === latestTurn);
  const baselineTurn = latestTurn - 24;
  const baseline = new Map(rows.filter((row) => row.turn === baselineTurn).map((row) => [row.commodity, row]));
  const worsening = current.map((row) => {
    const previous = baseline.get(row.commodity);
    return { commodity: row.commodity, label: commodityLabel(row.commodity), fillPct: round(row.fill * 100), deltaPoints: previous ? pointDelta(row.fill * 100, previous.fill * 100) : null, unmetUnits: Math.max(0, row.demand - row.cleared) };
  }).filter((row) => Number.isFinite(row.deltaPoints)).sort((a, b) => a.deltaPoints - b.deltaPoints).slice(0, 5);
  return { turn: latestTurn, comparisonTurns: 24, latest: series.at(-1) || null, change24: series.length > 1 ? pointDelta(series.at(-1).fillPct, series[0].fillPct) : null, series, worsening };
}

async function politicsPulse(db, currentTurn, countryIds) {
  const scope = { countryId: { $in: countryIds } };
  const [history, activeElections, billStatuses, recentEvents] = await Promise.all([
    db.collection("partyHistory").find({ ...scope, turn: { $gte: currentTurn - 24, $lte: currentTurn } }, { projection: { countryId: 1, partyId: 1, turn: 1, playerCount: 1 } }).toArray(),
    db.collection("elections").countDocuments({ ...scope, status: "active" }),
    db.collection("stateBills").aggregate([{ $match: scope }, { $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
    db.collection("countryHistory").find({ ...scope, turn: { $gt: currentTurn - 24, $lte: currentTurn }, eventType: { $in: ["bill_enacted", "international_relations"] } }, { projection: { _id: 0, countryId: 1, turn: 1, eventType: 1, title: 1 } }).sort({ turn: -1 }).limit(8).toArray(),
  ]);
  const latestTurn = Math.max(...history.map((r) => r.turn), currentTurn || 0), previousTurn = latestTurn - 24;
  const total = (turn) => history.filter((r) => r.turn === turn).reduce((sum, row) => sum + (row.playerCount || 0), 0);
  const current = total(latestTurn), previous = total(previousTurn), changes = new Map();
  for (const row of history) if (row.turn === latestTurn || row.turn === previousTurn) { const key = `${row.countryId}:${row.partyId}`, item = changes.get(key) || { countryId: row.countryId, partyId: row.partyId, current: 0, previous: 0 }; item[row.turn === latestTurn ? "current" : "previous"] += row.playerCount || 0; changes.set(key, item); }
  const driver = [...changes.values()].map((row) => ({ ...row, delta: row.current - row.previous })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  return { activeElections, enacted24Turns: recentEvents.filter((event) => event.eventType === "bill_enacted").length, recentEvents, bills: Object.fromEntries(billStatuses.map((row) => [String(row._id || "unknown"), row.count])), membershipTrend: { current, previous, change: current - previous, turns: 24, driver: driver?.delta ? `${driver.countryId} party ${driver.partyId} moved ${driver.delta > 0 ? "+" : ""}${driver.delta} player member${Math.abs(driver.delta) === 1 ? "" : "s"}.` : null } };
}

async function getWorldIntelligence(db, engine) {
  const currentTurn = engine?.lastTurn?.turn ?? engine?.turn ?? null, countryIds = await playableCountryIds(db), corporations = await scopedCorporations(db, countryIds);
  const settled = await Promise.allSettled([playerPulse(db, currentTurn), economyPulse(db, currentTurn, corporations), marketPulse(db, currentTurn, countryIds), politicsPulse(db, currentTurn, countryIds)]);
  const value = (index) => settled[index].status === "fulfilled" ? { ok: true, ...settled[index].value } : { ok: false, reason: settled[index].reason?.message || "unavailable" };
  const players = value(0), economy = value(1), markets = value(2), politics = value(3);
  return { players, economy, markets, politics, signals: buildSignals({ players, economy, markets, politics }), scope: { playableCountries: countryIds.length, corporations: corporations.length } };
}

module.exports = { getWorldIntelligence, metricValue, pct, percentChange, pointDelta, trendAt, buildSignals, OPERATED_CORPORATION };
