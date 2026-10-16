"use strict";
// Keir 5.6 self-recovery (owner, 2026-10-16: "a durable way to fix stuck
// shit like this and let Keir self recover"). The watchkeeper only reported
// stalls. This acts on them, without an owner command:
//
// 1. Spin guard. A task that runs SPIN_ROUNDS rounds with no reply, effect,
//    new evidence or inbox change first gets a plain nudge. If it spins again
//    it is parked: a ticket waits an hour (a player message wakes it sooner),
//    any other task is stopped. Its lane is released either way.
// 2. Starvation guard. When a ticket has sat queued STARVE_MS past its wake
//    and no lane it can use is free, the lowest-priority occupant (non-ticket
//    work first, then the longest-held lane) is requeued behind it.
//
// Recoveries are recorded on the ledger (d.recoveries) and audited; nothing
// pages the owner. Effects in flight are never interrupted.
const SPIN_ROUNDS = 40;
const STARVE_MS = 15 * 60000;
const HOLD_MS = 20 * 60000;
const PREEMPT_EVERY_MS = 10 * 60000;
const PREEMPT_GAP_MS = 2 * 60000;
const VICTIM_DELAY_MS = 5 * 60000;
const PARK_MS = 60 * 60000;
const DEAD_APP_MS = 60 * 60000;
const TERMINAL = ["done", "dismissed", "cancelled"];
const TICKET_LANES = /^investigation\d*$/;

function fingerprint(j) {
  const effects = Object.keys(j.effects || {}).length;
  return JSON.stringify([j.lastPublishedAt || null, effects, (j.inbox || []).length, j.investigatedReads || 0, (j.raisedToDevelopers || []).length, (j.pullRequests || []).length]);
}
const inFlight = (j) => Object.values(j.effects || {}).some((e) => ["started", "executing", "uncertain"].includes(e?.state));

function record(d, ledger, entry) {
  d.recoveries = [...(d.recoveries || []), entry].slice(-100);
  ledger.audit("self_recovery", entry);
}

function createRecovery({ ledger, now = () => Date.now(), log = () => {} }) {
  const d = ledger.data;

  function park(j, slot, reason) {
    const ticket = Boolean(j.ticket) && j.kind === "ticket";
    // Work the owner asked for is never discarded by a guard: it is blocked,
    // which shows as stuck in the app with its evidence kept for a retry.
    const owner = j.role === "owner";
    if (ticket) { j.state = "waiting"; j.wakeAt = now() + PARK_MS; }
    else j.state = owner ? "blocked" : "cancelled";
    const action = ticket ? "parked" : owner ? "blocked" : "stopped";
    j.summary = `Self-recovery: ${reason}. ${ticket ? "Parked for an hour; a player message wakes it." : owner ? "Blocked for review; retry it from the app." : "Stopped."} Was: ${String(j.summary || "").slice(0, 300)}`;
    if (slot) slot.controller.abort();
    record(d, ledger, { at: now(), job: j.id, ticket: j.ticket || null, action, reason });
    log(`self-recovery: ${j.id} ${action}: ${reason}`);
  }

  function spin(active) {
    const slots = new Map(Object.values(active).filter(Boolean).map((s) => [s.job.id, s]));
    for (const j of Object.values(d.jobs)) {
      if (TERMINAL.includes(j.state) || j.internalProbe || j.codingParent) continue;
      const r = (j.recovery ||= { rounds: j.rounds || 0, fp: fingerprint(j), strikes: 0 });
      const fp = fingerprint(j);
      if (fp !== r.fp) { j.recovery = { rounds: j.rounds || 0, fp, strikes: 0 }; continue; }
      if ((j.rounds || 0) - r.rounds < SPIN_ROUNDS || inFlight(j)) continue;
      r.strikes += 1; r.rounds = j.rounds || 0;
      if (r.strikes === 1) {
        (j.inbox ||= []).push({ role: "system", authorId: "self-recovery", at: new Date(now()).toISOString(),
          content: `Self-recovery: ${SPIN_ROUNDS} rounds without a reply, an action or a new finding. Stop re-checking. Either tell the player what you know now, do the next concrete step, or finish (done, or waiting with a real reason). Repeating the same check again ends this task.` });
        record(d, ledger, { at: now(), job: j.id, ticket: j.ticket || null, action: "nudged", reason: `${SPIN_ROUNDS} rounds without progress` });
        r.fp = fingerprint(j);
      } else park(j, slots.get(j.id), `${SPIN_ROUNDS * r.strikes}+ rounds without a reply, action or finding`);
    }
  }

  // Admission can still refuse a "starving" ticket (another operator holds it,
  // staff claimed it, a directive holds it). Preempting for one of those only
  // frees a lane nobody can use: on 2026-10-16 a Codex-held ticket made this
  // abort the same job about 340 times in three minutes. So: only tickets
  // admission could run, one preemption per ticket per PREEMPT_EVERY_MS, at
  // most one per PREEMPT_GAP_MS overall, and the victim waits out its delay
  // instead of being requeued straight back into the lane.
  function starvation(active, canRun) {
    const t = now(), st = (d.selfRecovery ||= {}), last = (st.preemptAt ||= {});
    if (t - (st.lastPreemptAt || 0) < PREEMPT_GAP_MS) return;
    const starving = Object.values(d.jobs).filter((j) => j.kind === "ticket" && j.state === "queued" && !j.ownerDecisionPending &&
      (!canRun || canRun(j)) && t - (last[j.id] || 0) >= PREEMPT_EVERY_MS &&
      t - (j.wakeAt || j.updatedAt || t) >= STARVE_MS).sort((a, b) => (a.wakeAt || a.updatedAt || 0) - (b.wakeAt || b.updatedAt || 0));
    if (!starving.length) return;
    const lanes = Object.entries(active).filter(([lane]) => TICKET_LANES.test(lane));
    if (lanes.some(([, s]) => !s)) return; // a lane is free; admission will place it
    const candidates = lanes.map(([lane, s]) => ({ lane, s })).filter(({ s }) => s && !inFlight(s.job) && (s.job.kind !== "ticket" || t - (s.startedAt || t) >= HOLD_MS));
    if (!candidates.length) return;
    candidates.sort((a, b) => (a.s.job.kind === "ticket") - (b.s.job.kind === "ticket") || (a.s.startedAt || 0) - (b.s.startedAt || 0));
    const { lane, s } = candidates[0];
    const victim = s.job, waiting = starving[0];
    victim.state = "waiting"; victim.wakeAt = t + VICTIM_DELAY_MS;
    victim.summary = `Self-recovery: lane given to ticket ${waiting.ticket}; resumes in ${VICTIM_DELAY_MS / 60000} minutes. Was: ${String(victim.summary || "").slice(0, 300)}`;
    s.controller.abort();
    last[waiting.id] = t; st.lastPreemptAt = t;
    record(d, ledger, { at: t, job: victim.id, ticket: victim.ticket || null, action: "preempted", lane, for: waiting.id, forTicket: waiting.ticket || null,
      reason: `ticket ${waiting.ticket} waited ${Math.round((t - (waiting.wakeAt || waiting.updatedAt)) / 60000)}m with every lane busy` });
    log(`self-recovery: preempted ${victim.id} on ${lane} for ticket ${waiting.ticket}`);
  }

  // 3. Stale decision guard. A task marked as waiting on an owner decision
  //    with no pending decision left (answered, expired or withdrawn by
  //    another path) was blocked forever (ticket 1560, 2026-10-16).
  function staleDecisions() {
    for (const j of Object.values(d.jobs)) {
      if (!j.ownerDecisionPending || TERMINAL.includes(j.state)) continue;
      const own = Object.values(d.decisions || {}).filter((x) => x.jobId === j.id);
      // A hold with no decision record at all came from a legacy handoff note
      // and has nothing to resolve it here: keep it for a person to release.
      if (!own.length || own.some((x) => x.state === "pending")) continue;
      delete j.ownerDecisionPending;
      if (j.state === "blocked") { j.state = "queued"; j.wakeAt = now(); }
      (j.inbox ||= []).push({ role: "system", authorId: "self-recovery", at: new Date(now()).toISOString(),
        content: "Self-recovery: the owner decision this task was held on is no longer pending (answered, expired or withdrawn). Re-read the ticket and its decision history, then continue." });
      record(d, ledger, { at: now(), job: j.id, ticket: j.ticket || null, action: "decision-hold-cleared", reason: "no pending decision for this task" });
    }
  }

  // 4. Dead app task guard. An owner-app conversation or command left blocked
  //    by a failed model call or an unsupported-capability refusal after its
  //    work was done showed in the app as "needs you" forever. After an hour
  //    it is dismissed, unless a decision or an uncertain effect still needs it.
  function deadAppTasks() {
    for (const j of Object.values(d.jobs)) {
      if (j.state !== "blocked" || j.replyChannel !== "app" || j.source?.channelId !== "app" || j.ticket) continue;
      const since = typeof j.updatedAt === "number" ? j.updatedAt : Date.parse(j.updatedAt || "") || (typeof j.at === "number" ? j.at : Date.parse(j.at || "")) || now();
      if (now() - since < DEAD_APP_MS) continue;
      if (inFlight(j) || j.ownerDecisionPending || Object.values(d.decisions || {}).some((x) => x.jobId === j.id && x.state === "pending")) continue;
      j.state = "dismissed";
      j.summary = `Self-recovery: dismissed after an hour blocked (${String(j.summary || "").slice(0, 200)})`;
      record(d, ledger, { at: now(), job: j.id, ticket: null, action: "app-task-dismissed", reason: "blocked app task with nothing pending" });
    }
  }

  function tick(active, { canRun } = {}) {
    if (d.paused) return;
    try { deadAppTasks(); staleDecisions(); spin(active); starvation(active, canRun); } catch (e) { log(`self-recovery: ${e.message}`); }
  }
  return { tick };
}
module.exports = { createRecovery, fingerprint, SPIN_ROUNDS, STARVE_MS, HOLD_MS, PARK_MS, PREEMPT_EVERY_MS, PREEMPT_GAP_MS };
