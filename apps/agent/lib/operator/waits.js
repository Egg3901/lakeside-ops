"use strict";
// Keir 3.0 correlation waits. A wait is a durable record keyed by what the
// outside world will eventually report (CI for repo+PR+head, a deploy SHA, a
// game turn, a decision), never by which job happened to be awake. Every
// wait has a deadline, and every deadline produces an explicit terminal
// outcome. Observations for a superseded correlation (an old PR head after a
// new commit) are kept as history and can never advance current work.

const TERMINAL_WAIT = ["satisfied", "timed-out", "cancelled", "superseded"];

function ciKey(repository, number, headSha) { return `ci:${repository}#${number}@${headSha}`; }
function deployKey(environment, sha) { return `deploy:${environment}@${sha}`; }
// Turns are per world; a turn number alone matches every world's turn N.
function turnKey(turn, world) {
  if (!world) throw new Error("a turn wait needs its world");
  return `turn:${world}:${turn}`;
}
function decisionKey(effectId) { return `decision:${effectId}`; }

function createWaitRegistry(store, { id, now = () => Date.now() } = {}) {
  store.waits ||= {};
  const waits = store.waits;
  let counter = Object.keys(waits).length;
  const newId = id || (() => `w${++counter}`);

  // One pending wait per (workId, correlation). Re-arming the same correlation
  // returns the existing record; arming a new head supersedes the old wait.
  function arm({ workId, kind, correlation, deadlineMs, subject = {} }) {
    if (!workId || !kind || !correlation || !Number.isFinite(deadlineMs) || deadlineMs <= 0)
      throw new Error("a wait needs workId, kind, correlation and a positive deadline");
    for (const w of Object.values(waits)) {
      if (w.workId !== workId || TERMINAL_WAIT.includes(w.state)) continue;
      if (w.correlation === correlation) return { wait: w, created: false };
      if (w.kind === kind && kind === "ci"
        && w.correlation.split("@")[0] === correlation.split("@")[0]) {
        w.state = "superseded"; w.endedAt = now(); w.supersededBy = correlation;
      }
    }
    const wait = { id: newId(), workId, kind, correlation, subject,
      state: "pending", createdAt: now(), deadline: now() + deadlineMs, observations: [] };
    waits[wait.id] = wait;
    return { wait, created: true };
  }

  // Applies an external observation. Returns which waits advanced so each
  // work record moves immediately, independent of unrelated waits.
  // A CI result must say what the PR head is now (outcome.currentHead, read
  // from the same API call). If the PR moved on, the wait is superseded, not
  // satisfied, even if nobody has armed the new head yet.
  // A terminal result arriving after the wait timed out still advances it,
  // marked late, so the record can recover instead of staying timed out.
  function observe(correlation, outcome = {}) {
    const advanced = [];
    for (const w of Object.values(waits)) {
      if (w.correlation !== correlation) continue;
      w.observations.push({ at: now(), ...outcome });
      const late = w.state === "timed-out" && outcome.terminal === true && !w.lateResult;
      if (TERMINAL_WAIT.includes(w.state) && !late) continue; // superseded, cancelled or duplicate: history only
      if (w.kind === "ci" && outcome.terminal === true) {
        if (!outcome.currentHead) throw new Error("a CI result needs the PR's current head");
        const waitedHead = w.correlation.split("@")[1];
        if (outcome.currentHead !== waitedHead) {
          w.state = "superseded"; w.endedAt = now(); w.supersededBy = `head ${outcome.currentHead}`;
          continue;
        }
      }
      if (outcome.terminal === true) {
        if (late) { w.lateResult = true; w.late = true; }
        w.state = "satisfied"; w.endedAt = now(); w.result = outcome.result ?? null;
        advanced.push(w);
      }
    }
    return advanced;
  }

  // Deadline sweep. A hung dependency becomes a visible timed-out wait and a
  // named work record to act on, never a silently frozen ticket.
  function sweep(at = now()) {
    const timedOut = [];
    for (const w of Object.values(waits)) {
      if (w.state === "pending" && w.deadline <= at) {
        w.state = "timed-out"; w.endedAt = at; timedOut.push(w);
      }
    }
    return timedOut;
  }

  function cancelForWork(workId, reason) {
    const cancelled = [];
    for (const w of Object.values(waits)) {
      if (w.workId === workId && w.state === "pending") {
        w.state = "cancelled"; w.endedAt = now(); w.result = reason || null; cancelled.push(w);
      }
    }
    return cancelled;
  }

  const pendingFor = (workId) => Object.values(waits)
    .filter((w) => w.workId === workId && w.state === "pending")
    .sort((a, b) => a.deadline - b.deadline);

  return { arm, observe, sweep, cancelForWork, pendingFor, all: () => Object.values(waits) };
}

module.exports = { createWaitRegistry, ciKey, deployKey, turnKey, decisionKey, TERMINAL_WAIT };
