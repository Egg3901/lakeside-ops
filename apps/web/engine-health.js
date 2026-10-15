// engine-health.js — observability for the GAME SIMULATION (turns, elections,
// economy), computed from existing telemetry. Read-only. Used by the /engine
// page, the engine MCP, and the Discord anomaly alerter.

async function engineHealth(db) {
  const now = Date.now();
  const gs = (await db.collection("gameState").findOne({ isActive: true })) || {};

  // ── turn health (turnLogs: durationMs, success, phaseStatuses) ──
  const recent = await db.collection("turnLogs")
    .find({}, { projection: { turn: 1, durationMs: 1, success: 1, warnings: 1, phaseStatuses: 1, realTime: 1 } })
    .sort({ turn: -1 }).limit(24).toArray();
  const last = recent[0] || null;
  const failedPhases = last
    ? Object.entries(last.phaseStatuses || {}).filter(([, p]) => p && p.status && p.status !== "completed" && p.status !== "skipped")
        .map(([phase, p]) => ({ phase, status: p.status, reason: p.reason || p.message || null }))
    : [];
  const avgMs = recent.length ? Math.round(recent.reduce((a, t) => a + (t.durationMs || 0), 0) / recent.length) : 0;
  const maxMs = recent.reduce((m, t) => Math.max(m, t.durationMs || 0), 0);
  // Historical successful turns used `success: false` when they completed
  // with warnings. A turn is operationally failed only when a phase did not
  // complete or skip; otherwise alerts would fire continuously on healthy
  // warning-bearing worlds.
  const hasFailedPhase = (turn) => Object.values(turn.phaseStatuses || {}).some(
    (phase) => phase && phase.status && phase.status !== "completed" && phase.status !== "skipped"
  );
  const lastFailed = !!(last && hasFailedPhase(last));
  const failures = recent.filter(hasFailedPhase).length;
  const nextTs = gs.nextScheduledTurn ? new Date(gs.nextScheduledTurn).getTime() : null;
  const overdueMin = nextTs ? Math.max(0, Math.round((now - nextTs) / 60000)) : null;

  // ── election integrity ──
  const [activeEl, overdueEl, zeroCand] = await Promise.all([
    db.collection("elections").countDocuments({ status: "active" }),
    db.collection("elections").countDocuments({ status: "active", endTime: { $lt: new Date() } }),
    db.collection("elections").countDocuments({ status: "active", $or: [{ totalSeats: { $lte: 0 } }, { totalSeats: null }] }),
  ]);

  // ── economy pulse (commodity price vs base = inflation proxy) ──
  const cps = await db.collection("commodityPrices").find({}, { projection: { commodity: 1, globalPrice: 1, basePrice: 1 } }).toArray();
  const ratios = cps.map((c) => ({ commodity: c.commodity, x: c.basePrice ? +(c.globalPrice / c.basePrice).toFixed(2) : 1 })).sort((a, b) => b.x - a.x);
  const hot = ratios.filter((r) => r.x >= 1.5 || r.x <= 0.7);

  // ── flags (the alertable signals) ──
  const flags = [];
  if (gs.pausedAt) flags.push({ level: "warn", code: "paused", msg: "Game paused: " + (gs.pauseReason || gs.pauseKind || "?") });
  if (lastFailed) flags.push({ level: "error", code: "turn-failed", msg: `Turn ${last.turn} FAILED` });
  if (failedPhases.length) flags.push({ level: "error", code: "phase-failed", msg: `${failedPhases.length} failed phase(s) in turn ${last && last.turn}: ${failedPhases.map((p) => p.phase).join(", ")}` });
  if (overdueMin != null && overdueMin > 10 && !gs.pausedAt) flags.push({ level: "warn", code: "turn-overdue", msg: `Turn ~${overdueMin}min overdue` });
  if (overdueEl > 0) flags.push({ level: "warn", code: "election-stuck", msg: `${overdueEl} election(s) past endTime but still active` });
  if (zeroCand > 0) flags.push({ level: "warn", code: "election-empty", msg: `${zeroCand} active election(s) with no seats` });
  if (last && last.warnings && last.warnings.length) flags.push({ level: "info", code: "turn-warnings", msg: `${last.warnings.length} warning(s) in turn ${last.turn}` });
  if (maxMs > 300000) flags.push({ level: "warn", code: "slow-turn", msg: `A recent turn took ${Math.round(maxMs / 1000)}s` });

  return {
    turn: gs.currentTurn, year: gs.currentYear, iteration: gs.iteration, paused: !!gs.pausedAt, pauseReason: gs.pauseReason || null,
    lastTurn: last ? { turn: last.turn, durationMs: last.durationMs, success: !lastFailed, warnings: (last.warnings || []).length, failedPhases } : null,
    schedule: { next: gs.nextScheduledTurn || null, overdueMin },
    recent: { count: recent.length, avgMs, maxMs, failures },
    elections: { active: activeEl, overdue: overdueEl, zeroSeats: zeroCand },
    economy: { hot: hot.slice(0, 10), topInflation: ratios[0] || null, topDeflation: ratios[ratios.length - 1] || null },
    flags,
    checkedAt: new Date(),
  };
}

module.exports = { engineHealth };
