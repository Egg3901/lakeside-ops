"use strict";
// Keir 3.0 F3 (parts 2 and 3): SLA clocks with breach forecasting, and the
// fix verification loop planner. Clocks run from work-record receipts, not
// from any single job, so a ticket handled by three attempts has one clock.
// A breach is forecast before the deadline when elapsed time plus the class
// median remaining work would overrun it, giving the coordinator time to
// act or communicate instead of explaining afterwards.

const { BUDGETS } = require("./metrics");
const { turnKey } = require("./waits");

const CLOCKS = {
  ack: { budgetMs: BUDGETS.ackP95Ms },
  firstSubstantive: { budgetMs: 30 * 60000 },
  updateCadence: { budgetMs: BUDGETS.silenceMaxMs },
};

// record: work-record projection. milestones: { ackAt, firstSubstantiveAt }
// from delivery receipts. medianRemainingMs comes from stage B metrics.
function evaluateClocks(record, milestones = {}, { now = Date.now(), medianRemainingMs = 0 } = {}) {
  const created = record.createdAt ?? now;
  const clock = (name, start, doneAt) => {
    const budget = CLOCKS[name].budgetMs;
    const elapsed = (doneAt ?? now) - start;
    return { name, budgetMs: budget, elapsedMs: elapsed, done: doneAt !== undefined && doneAt !== null,
      breached: elapsed > budget,
      forecastBreach: doneAt == null && elapsed + medianRemainingMs > budget };
  };
  const clocks = [
    clock("ack", created, milestones.ackAt),
    clock("firstSubstantive", created, milestones.firstSubstantiveAt),
    clock("updateCadence", record.lastPublicActivityAt || created, null),
  ];
  return { clocks, anyBreached: clocks.some((c) => c.breached),
    anyForecast: clocks.some((c) => c.forecastBreach) };
}

// Honest ETA: class median for the remaining stage, plus queue position
// times the class median activation when queued. Returns null when there is
// no baseline to stand on rather than inventing a number.
function etaMs({ queuedAhead = 0, medianActivationMs = null, medianRemainingMs = null } = {}) {
  if (medianActivationMs === null && medianRemainingMs === null) return null;
  return queuedAhead * (medianActivationMs || 0) + (medianRemainingMs || medianActivationMs || 0);
}

// The verification loop: once a fix is deployed (web and, for turn logic,
// worker), each affected ticket gets turn waits. Only a satisfied live
// check on a later turn may mark the ticket live-verified; a deployment
// receipt alone never can. Returns wait specs for the wait registry.
function planVerification({ workId, world, deployedTurn, needsWorker = true, workerDeployed = false, turnsToObserve = 2 } = {}) {
  if (!workId || !world || !Number.isInteger(deployedTurn)) throw new Error("verification needs a workId, the world and the deployment turn");
  if (needsWorker && !workerDeployed) return { waits: [], blockedOn: "turn-worker deployment", expected: turnsToObserve };
  const waits = Array.from({ length: turnsToObserve }, (_, i) => ({
    workId, kind: "turn", correlation: turnKey(deployedTurn + i + 1, world),
    deadlineMs: 6 * 3600000, subject: { purpose: "live-verification", index: i + 1 },
  }));
  return { waits, blockedOn: null, expected: turnsToObserve };
}

// expected: how many turns the plan asked for. A timed-out turn wait leaves a
// missing observation, which is incomplete evidence, never a pass.
function verificationVerdict(observations, { expected = 1 } = {}) {
  if (!observations.length) return { verified: false, reason: "no live observations yet" };
  if (observations.some((o) => o.outcome === "still-broken"))
    return { verified: false, reason: "a later turn still shows the defect", reopen: true };
  if (observations.length < expected) return { verified: false, reason: "observations incomplete" };
  if (observations.every((o) => o.outcome === "fixed"))
    return { verified: true, reason: "later turns confirm the fix" };
  return { verified: false, reason: "observations incomplete" };
}

module.exports = { CLOCKS, evaluateClocks, etaMs, planVerification, verificationVerdict };
