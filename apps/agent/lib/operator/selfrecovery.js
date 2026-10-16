"use strict";
// Keir 5.6 self-recovery (owner, 2026-10-16: "a durable way to fix stuck
// shit like this and let Keir self recover"). The watchkeeper only reported
// stalls. This acts on them, without an owner command:
//
// 1. Spin guard. A task that runs SPIN_ROUNDS rounds with no reply, effect,
//    new evidence or inbox change first gets a plain nudge. New evidence means
//    a read it has not made before; repeating the same read does not count.
//    If it spins again it is parked: a ticket waits an hour (a player message
//    wakes it sooner), a game finding waits for the morning brief, any other
//    task is stopped. Its lane is released either way.
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
const UNEXPLAINED_WAIT_MS = 45 * 60000;
const PLAYER_WAIT_MS = 24 * 3600000;
const PLAYER_NUDGE_MS = 6 * 3600000;
const UNCERTAIN_EFFECT_MS = 30 * 60000;
const HELD_MS = 2 * 3600000;
const FINDING_PARK_MS = 12 * 3600000;
const TERMINAL = ["done", "dismissed", "cancelled"];
const TICKET_LANES = /^investigation\d*$/;

function fingerprint(j) {
  const effects = Object.keys(j.effects || {}).length;
  return JSON.stringify([j.lastPublishedAt || null, effects, (j.inbox || []).length, j.distinctReads || 0, (j.raisedToDevelopers || []).length, (j.pullRequests || []).length]);
}
const inFlight = (j) => Object.values(j.effects || {}).some((e) => ["started", "executing", "uncertain"].includes(e?.state));

function record(d, ledger, entry) {
  d.recoveries = [...(d.recoveries || []), entry].slice(-100);
  ledger.audit("self_recovery", entry);
}

function createRecovery({ ledger, config = {}, now = () => Date.now(), log = () => {} }) {
  const d = ledger.data;

  function park(j, slot, reason) {
    const ticket = Boolean(j.ticket) && j.kind === "ticket";
    // Work the owner asked for is never discarded by a guard: it is blocked,
    // which shows as stuck in the app with its evidence kept for a retry.
    const owner = j.role === "owner";
    // A game finding is a live problem, not side work: it parks for the owner's
    // morning brief instead of being dropped (5.6.2).
    const finding = !ticket && !owner && j.kind === "finding";
    if (ticket) { j.state = "waiting"; j.wakeAt = now() + PARK_MS; }
    else if (finding) { j.state = "waiting"; j.wakeAt = now() + FINDING_PARK_MS; j.parkedForBrief = now(); }
    else j.state = owner ? "blocked" : "cancelled";
    const action = ticket || finding ? "parked" : owner ? "blocked" : "stopped";
    j.summary = `Self-recovery: ${reason}. ${ticket ? "Parked for an hour; a player message wakes it." : finding ? "Parked for the owner's morning brief." : owner ? "Blocked for review; retry it from the app." : "Stopped."} Was: ${String(j.summary || "").slice(0, 300)}`;
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

  // 5. Wait contract (owner, 2026-10-16: "he frequently gets stuck where he's
  //    not even asking me to approve something, just stopped waiting on some
  //    unknown outcome"). A ticket may sit idle only for:
  //      - a pending owner decision (visible in the app and DMs),
  //      - a player reply to an answer already posted (at most 24 hours),
  //      - a live subscription with an end (turn watch, CI watch, deploy hold).
  //    Anything else is an unknown: the wait is capped at 45 minutes and the
  //    task is woken with an order to find the outcome or ask. The second
  //    unknown wait opens an owner decision naming the ticket, what it is
  //    stuck on and the options, so it can never stall silently again.
  function waitReason(j) {
    if (j.ownerDecisionPending || Object.values(d.decisions || {}).some((x) => x.jobId === j.id && x.state === "pending")) return "decision";
    if (j.turnWatch || Object.keys(j.ciWatch || {}).length || (j.promotionHoldUntil || 0) > now()) return "subscription";
    const posted = typeof j.lastPublishedAt === "number" ? j.lastPublishedAt : Date.parse(j.lastPublishedAt || "") || 0;
    const player = typeof j.lastPlayerAt === "number" ? j.lastPlayerAt : Date.parse(j.lastPlayerAt || "") || 0;
    if (j.waitingFor?.kind === "player_reply" && posted && posted >= player) {
      const age = now() - posted;
      return age >= PLAYER_WAIT_MS ? "player-expired" : age >= PLAYER_NUDGE_MS ? "player-stale" : "player";
    }
    return null;
  }
  function waitContract() {
    if (!d.decisions) d.decisions = {};
    for (const j of Object.values(d.jobs)) {
      if (j.kind !== "ticket" || !j.ticket || !["waiting", "blocked"].includes(j.state) || j.channelClosed || j.resolved || inFlight(j)) continue;
      const reason = waitReason(j);
      if (reason === "decision" || reason === "subscription" || reason === "player") { delete j.unknownWait; continue; }
      const w = (j.unknownWait ||= { since: now(), count: 0 });
      if (reason === "player-stale") {
        if (!w.playerStaleNudged) {
          w.playerStaleNudged = now();
          wake(j, "Self-recovery: the player has not answered for 6 hours. If you asked them for something you can find yourself (records, logs, the page, the game state), go and find it now and continue without them. Only if their answer is truly essential, ask once more in one short line. Do not just keep waiting.");
        }
        continue;
      }
      if (reason === "player-expired") {
        if (!w.playerNudged) {
          w.playerNudged = now();
          wake(j, "Self-recovery: the player has not replied for 24 hours after your answer. Offer to resolve now, and resolve after the closure grace if they stay silent. Do not keep waiting.");
        }
        continue;
      }
      if (j.state === "waiting" && j.wakeAt && j.wakeAt - now() > UNEXPLAINED_WAIT_MS) j.wakeAt = now() + UNEXPLAINED_WAIT_MS;
      if (now() - w.since < UNEXPLAINED_WAIT_MS) continue;
      w.count += 1; w.since = now();
      if (w.count === 1) {
        wake(j, "Self-recovery: this ticket is waiting on something unknown: no owner decision, no player question awaiting a reply, and no live turn, CI or deploy watch. Find the outcome yourself now (read GitHub, the deploy, the game records), act on it, and tell the player. If only the owner can unblock it, ask with raise_to_developers kind decision and a concrete question. Do not finish waiting on an unknown again.");
      } else if (!w.askedAt && config.ownerId) {
        w.askedAt = now();
        const question = `Ticket ${j.ticket}: Keir has stalled twice waiting on an unknown outcome. Last state: ${String(j.summary || "").replace(/\s+/g, " ").slice(0, 400)} Options: approve to let Keir continue from its best verified state, reject to stop work on the ticket, or explain what it is waiting for.`;
        try { require("./decisions").openDecision(ledger, config, { jobId: j.id, question }); j.ownerDecisionPending = true; } catch (e) { log(`self-recovery: decision for ${j.ticket}: ${e.message}`); }
        record(d, ledger, { at: now(), job: j.id, ticket: j.ticket, action: "asked-owner", reason: "stalled twice on an unknown wait" });
      }
    }
  }
  function wake(j, content) {
    (j.inbox ||= []).push({ role: "system", authorId: "self-recovery", at: new Date(now()).toISOString(), content });
    if (["waiting", "blocked"].includes(j.state)) { j.state = "queued"; j.wakeAt = now(); }
    record(d, ledger, { at: now(), job: j.id, ticket: j.ticket || null, action: "woken", reason: content.slice(17, 120) });
  }

  // 6. Uncertain actions other than merges (heals, posts, writes) older than
  //    30 minutes: Keir cannot know whether they happened, and its retry
  //    guard refuses to repeat them. Ask the owner a yes/no that settles it:
  //    approve = it did NOT happen (Keir may retry), reject = it DID happen
  //    (Keir continues from it). The answer is applied automatically below.
  function uncertainEffects() {
    const MERGE = /^merge:\d+:/;
    for (const j of Object.values(d.jobs)) {
      if (TERMINAL.includes(j.state) || !config.ownerId) continue;
      for (const [key, e] of Object.entries(j.effects || {})) {
        if (!["started", "uncertain"].includes(e?.state) || now() - (e.at || now()) < UNCERTAIN_EFFECT_MS) continue;
        if (MERGE.test(key) && now() - (e.at || 0) < 2 * UNCERTAIN_EFFECT_MS) continue; // GitHub reconcile gets first try
        if (Object.values(d.decisions || {}).some((x) => x.selfRecovery?.effect === key && x.jobId === j.id && ["pending", "approve", "reject"].includes(x.state))) continue;
        const where = j.ticket ? `Ticket ${j.ticket}` : `Task ${j.id}`;
        const question = `${where}: Keir does not know whether this action happened: ${key}${e.error ? ` (error: ${String(e.error).slice(0, 160)})` : ""}. Approve if it did NOT happen, so Keir may retry. Reject if it DID happen, so Keir continues from it.`;
        try {
          const x = require("./decisions").openDecision(ledger, config, { jobId: j.id, actionId: `effect:${key}`, question });
          x.selfRecovery = { kind: "effect", effect: key };
          record(d, ledger, { at: now(), job: j.id, ticket: j.ticket || null, action: "asked-owner", reason: `uncertain action ${key}` });
        } catch (err) { log(`self-recovery: effect decision ${key}: ${err.message}`); }
      }
    }
  }

  // 7. A ticket held by another operator (or otherwise deferred) for two
  //    hours with no progress: ask the owner whether to hand it back to Keir.
  function heldTickets(supportDeferred) {
    if (!supportDeferred || !config.ownerId) return;
    for (const j of Object.values(d.jobs)) {
      if (j.kind !== "ticket" || !j.ticket || TERMINAL.includes(j.state) || j.channelClosed || j.resolved) continue;
      let held = false; try { held = Boolean(supportDeferred(j)); } catch {}
      if (!held) { delete j.heldSince; continue; }
      j.heldSince ||= now();
      const last = Math.max(j.heldSince, typeof j.updatedAt === "number" ? j.updatedAt : Date.parse(j.updatedAt || "") || 0);
      if (now() - last < HELD_MS) continue;
      if (Object.values(d.decisions || {}).some((x) => x.selfRecovery?.kind === "handback" && x.jobId === j.id && ["pending", "approve", "reject"].includes(x.state))) continue;
      const question = `Ticket ${j.ticket} has been held by another operator for ${Math.round((now() - j.heldSince) / 3600000)} hours with no progress. Approve to hand it back to Keir now. Reject to leave it where it is.`;
      try {
        const x = require("./decisions").openDecision(ledger, config, { jobId: j.id, actionId: `handback:${j.ticket}`, question });
        x.selfRecovery = { kind: "handback", ticket: j.ticket };
        record(d, ledger, { at: now(), job: j.id, ticket: j.ticket, action: "asked-owner", reason: "held by another operator 2h+" });
      } catch (err) { log(`self-recovery: handback decision ${j.ticket}: ${err.message}`); }
    }
  }

  // Apply the owner's answers to self-recovery questions exactly once.
  function applyAnswers(setTicketOwner) {
    for (const x of Object.values(d.decisions || {})) {
      if (!x.selfRecovery || x.selfRecovery.appliedAt || !["approve", "reject"].includes(x.state)) continue;
      const j = d.jobs[x.jobId]; x.selfRecovery.appliedAt = now();
      if (!j) continue;
      if (x.selfRecovery.kind === "effect") {
        const key = x.selfRecovery.effect;
        if (x.state === "approve") delete (j.effects || {})[key];
        else j.effects[key] = { ...(j.effects[key] || {}), state: "done", at: now(), result: { ownerConfirmed: true } };
        wake(j, `Self-recovery: the owner says action ${key} ${x.state === "approve" ? "did NOT happen; you may retry it if still wanted" : "DID happen; continue from it and do not repeat it"}.`);
      } else if (x.selfRecovery.kind === "handback" && x.state === "approve" && setTicketOwner) {
        try { setTicketOwner(x.selfRecovery.ticket, "keir"); wake(j, "Self-recovery: the owner handed this ticket back to Keir. Re-read the ticket and continue."); } catch (err) { log(`self-recovery: handback ${x.selfRecovery.ticket}: ${err.message}`); }
      }
      record(d, ledger, { at: now(), job: x.jobId, ticket: j.ticket || null, action: "owner-answer-applied", reason: `${x.selfRecovery.kind}:${x.state}` });
    }
  }

  function tick(active, { canRun, supportDeferred, setTicketOwner } = {}) {
    if (d.paused) return;
    try { applyAnswers(setTicketOwner); deadAppTasks(); staleDecisions(); waitContract(); uncertainEffects(); heldTickets(supportDeferred); spin(active); starvation(active, canRun); } catch (e) { log(`self-recovery: ${e.message}`); }
  }
  return { tick };
}
module.exports = { createRecovery, fingerprint, SPIN_ROUNDS, STARVE_MS, HOLD_MS, PARK_MS, PREEMPT_EVERY_MS, PREEMPT_GAP_MS };
