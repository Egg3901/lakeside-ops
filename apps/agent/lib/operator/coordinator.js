"use strict";
// Keir 3.0 stage C, the WorkCoordinator. One record owns each ticket or
// request; model activations and Luna jobs are bounded attempts on that
// record. The coordinator is the only writer of workflow state: adapters
// (Discord, GitHub, providers) hand it events and evidence, it decides the
// next action. Invariants enforced here, not by callers:
// - at most one active mutating attempt per record (lease)
// - a lease is never held across a wait
// - a newer instruction supersedes older attempts without losing evidence
// - every accepted event is idempotent by its event id
// - terminal records require a resolution or cancellation receipt
// The store is a plain object ({ records, attempts, seenEvents }). Wired to
// the operator it lives inside the ledger (ledgerStore below) and every
// mutation calls onChange, which is ledger.save, so state survives a crash
// between any two calls exactly as the 2.x jobs do.
// Authority: only an owner, developer or delegate instruction supersedes
// running work. A player message is evidence on the record; it can reopen a
// resolved record during closure grace but can never cancel an attempt.

const ATTEMPT_TERMINAL = ["succeeded", "failed", "interrupted", "timed-out", "cancelled", "superseded"];
const SUPERSEDING_ROLES = ["owner", "developer", "delegate"];
const REOPENABLE = ["resolved", "closed-externally"];
const EVENT_TTL_MS = 7 * 24 * 3600000;

// Attempt ids must stay unique across restarts and pruning, so the counter
// resumes from the highest id ever issued, not from the current count.
function nextCounter(store) {
  const ids = Object.keys(store.attempts).map((id) => Number(/^a(\d+)$/.exec(id)?.[1] || 0));
  return Math.max(store.attemptCounter || 0, 0, ...ids);
}

function createCoordinator(store, { now = () => Date.now(), leaseMs = 10 * 60000, onChange = () => {},
  eventTtlMs = EVENT_TTL_MS } = {}) {
  store.records ||= {}; store.attempts ||= {}; store.seenEvents ||= {};
  const { records, attempts, seenEvents } = store;
  let counter = nextCounter(store);
  const changed = (result) => { onChange(); return result; };

  function record(workId, init = {}) {
    return (records[workId] ||= { id: workId, state: "open", evidence: [], instructions: [],
      nextAction: "attempt", lease: null, createdAt: now(), updatedAt: now(), ...init });
  }

  // Idempotent event intake. Persisting the event is what licenses an ack;
  // acceptance never claims work has started.
  // event: { id, workId, kind: "instruction" | "evidence" | ..., actor, role }.
  // role comes from the authenticated principal resolver, never from text.
  function accept(event) {
    if (!event?.id || !event?.workId || !event?.kind) throw new Error("an event needs id, workId and kind");
    if (seenEvents[event.id]) return { accepted: false, duplicate: true, record: records[event.workId] };
    // Bounded dedupe window: Discord and GitHub never redeliver week-old events.
    for (const [id, seen] of Object.entries(seenEvents)) if (now() - seen.at > eventTtlMs) delete seenEvents[id];
    seenEvents[event.id] = { at: now(), workId: event.workId, kind: event.kind };
    const rec = record(event.workId);
    const role = event.role || null;
    let reopened = false;
    // New instructions or evidence after resolution (closure grace, or a
    // player reporting it is still broken) reopen the record. The old
    // resolution is kept as history; a cancelled record stays cancelled
    // unless someone with authority instructs it.
    if (["instruction", "evidence"].includes(event.kind)
      && (REOPENABLE.includes(rec.state) || (rec.state === "cancelled" && SUPERSEDING_ROLES.includes(role)))) {
      (rec.resolutions ||= []).push(rec.resolution);
      rec.state = "open"; rec.resolution = null; rec.reopenedAt = now(); rec.nextAction = "attempt";
      reopened = true;
    }
    if (event.kind === "instruction" || event.kind === "evidence") {
      const list = event.kind === "instruction" ? rec.instructions : rec.evidence;
      list.push({ at: now(), actor: event.actor || null, role, eventId: event.id, ...(event.kind === "evidence" ? { kind: "event" } : {}) });
    }
    if (event.kind === "instruction" && SUPERSEDING_ROLES.includes(role) && event.supersedes !== false) {
      // Superseding marks the attempt obsolete but does not free its lease:
      // the process may still be mid-effect. The lease frees when it reports
      // (complete) or expires (reconcile), never on the instruction alone.
      for (const a of Object.values(attempts))
        if (a.workId === rec.id && !ATTEMPT_TERMINAL.includes(a.state)) { a.state = "superseded"; a.endedAt = now(); }
      if (rec.state === "open") rec.nextAction = "attempt";
    }
    rec.updatedAt = now();
    return changed({ accepted: true, record: rec, reopened });
  }

  function claim(workId, { provider = {}, mutating = true } = {}) {
    const rec = record(workId);
    if (rec.state !== "open") return { claimed: false, reason: `record is ${rec.state}` };
    if (mutating && rec.lease && rec.lease.expiresAt > now())
      return { claimed: false, reason: "mutating attempt already active", lease: rec.lease };
    store.attemptCounter = ++counter;
    const attempt = { id: `a${counter}`, workId, state: "running", mutating,
      provider, startedAt: now(), checkpoint: null };
    // Read-only attempts hold no lease but still have their own expiry, so
    // reconcile judges each attempt by its own clock.
    if (!mutating) attempt.expiresAt = now() + leaseMs;
    attempts[attempt.id] = attempt;
    if (mutating) rec.lease = { attemptId: attempt.id, expiresAt: now() + leaseMs };
    rec.nextAction = "awaiting-attempt"; rec.updatedAt = now();
    return changed({ claimed: true, attempt });
  }

  function checkpoint(attemptId, note) {
    const a = attempts[attemptId];
    if (!a || ATTEMPT_TERMINAL.includes(a.state)) throw new Error("only a live attempt can checkpoint");
    a.checkpoint = { at: now(), note: String(note || "").slice(0, 2000) };
    return changed(a);
  }

  // An attempt contributes evidence and ends. It never sets public state and
  // never decides the next owner-facing answer on its own.
  function complete(attemptId, outcome, evidence = []) {
    const a = attempts[attemptId];
    if (!a) throw new Error("unknown attempt");
    if (!ATTEMPT_TERMINAL.includes(outcome)) throw new Error(`unknown attempt outcome ${outcome}`);
    if (ATTEMPT_TERMINAL.includes(a.state)) {
      // A superseded or interrupted attempt that reports late cannot steer the
      // record, but what it did (receipts of external effects especially) is
      // kept, and its report is what frees a lease it still holds.
      const late = ["superseded", "interrupted"].includes(a.state) && !a.reportedAt;
      if (!late) return { applied: false, reason: `attempt already ${a.state}` };
      a.reportedAt = now(); a.reportedOutcome = outcome;
      const rec = record(a.workId);
      for (const e of evidence) rec.evidence.push({ at: now(), attemptId, late: true, ...e });
      if (rec.lease?.attemptId === attemptId) rec.lease = null;
      rec.updatedAt = now();
      return changed({ applied: false, evidenceKept: evidence.length, reason: `attempt already ${a.state}` });
    }
    a.state = outcome; a.endedAt = now();
    const rec = record(a.workId);
    for (const e of evidence) rec.evidence.push({ at: now(), attemptId, ...e });
    if (rec.lease?.attemptId === attemptId) rec.lease = null;
    if (rec.state === "open")
      rec.nextAction = outcome === "succeeded" ? "decide-next"
        : outcome === "interrupted" || outcome === "timed-out" ? "resume-or-block" : "attempt";
    rec.updatedAt = now();
    return changed({ applied: true, record: rec });
  }

  // Waiting releases the lease. The record resumes from an event, not from
  // a specific activation waking up.
  // The attempt that parks the record names itself and ends; a wait can
  // never orphan a still-running writer and let a second one claim.
  function wait(workId, { attemptId = null } = {}) {
    const rec = record(workId);
    const holder = rec.lease && attempts[rec.lease.attemptId];
    if (holder && holder.state === "running" && rec.lease.expiresAt > now()) {
      if (holder.id !== attemptId) throw new Error("a running mutating attempt holds the lease; it must park the record itself");
      holder.state = "succeeded"; holder.endedAt = now(); holder.parked = true;
    }
    rec.lease = null; rec.nextAction = "awaiting-event"; rec.updatedAt = now();
    return changed(rec);
  }

  function close(workId, receipt) {
    if (!receipt?.kind || !["resolved", "cancelled", "closed-externally"].includes(receipt.kind))
      throw new Error("closing a record needs a resolved, cancelled or closed-externally receipt");
    const rec = record(workId);
    rec.state = receipt.kind; rec.resolution = { at: now(), ...receipt };
    rec.lease = null; rec.nextAction = "none"; rec.updatedAt = now();
    return changed(rec);
  }

  // Crash and stall recovery: expired leases and running attempts past their
  // lease become interrupted with their checkpoint preserved, and the record
  // is told to resume or surface a blocker. Uncertain external effects are
  // flagged for receipt inspection, never blindly retried.
  function reconcile(at = now()) {
    const interrupted = [], uncertain = [];
    for (const a of Object.values(attempts)) {
      const rec = records[a.workId];
      const holdsLease = rec?.lease?.attemptId === a.id;
      // A superseded writer that never reported and whose lease ran out may
      // or may not have finished its effect: surface it, then free the lease.
      if (a.state === "superseded" && holdsLease && rec.lease.expiresAt <= at) {
        rec.lease = null; interrupted.push(a.id);
        if (a.uncertainEffect) uncertain.push({ attemptId: a.id, workId: a.workId, effect: a.uncertainEffect });
        continue;
      }
      if (a.state !== "running") continue;
      const expired = a.mutating
        ? !holdsLease || rec.lease.expiresAt <= at
        : (a.expiresAt ?? 0) <= at;
      if (!expired) continue;
      a.state = "interrupted"; a.endedAt = at; interrupted.push(a.id);
      if (a.uncertainEffect) uncertain.push({ attemptId: a.id, workId: a.workId, effect: a.uncertainEffect });
      if (rec && holdsLease) rec.lease = null;
      if (rec && rec.state === "open") { rec.nextAction = "resume-or-block"; rec.updatedAt = at; }
    }
    const stuck = Object.values(records).filter((r) => r.state === "open" && !r.nextAction).map((r) => r.id);
    if (interrupted.length) onChange();
    return { interrupted, uncertain, stuck };
  }

  return { accept, claim, checkpoint, complete, wait, close, reconcile,
    get: (workId) => records[workId], attemptsFor: (workId) =>
      Object.values(attempts).filter((a) => a.workId === workId) };
}

// The coordinator's durable home inside the v1 ledger envelope. The 2.x
// binary preserves unknown keys, so rollback is deleting `coordinator`.
function ledgerStore(ledger) {
  return (ledger.data.coordinator ||= { records: {}, attempts: {}, seenEvents: {}, attemptCounter: 0 });
}

module.exports = { createCoordinator, ledgerStore, ATTEMPT_TERMINAL, SUPERSEDING_ROLES };
