"use strict";
// Keir 3.0 stage E, the StatusPublisher plus deterministic acknowledgment.
// Public words are a deterministic projection of verified work state: given
// the same record, release facts and last published phase, the publisher
// always derives the same status, posts only on a meaningful phase change,
// and refreshes the same message during waits. A model can contribute
// findings; it cannot decide that something is live. The ack is composed at
// intake with no model call, and it tells the truth about queuing: accepted
// and queued, with position and next action, never "working on it" when
// nothing has started.

const { ticketReleaseState } = require("./release");

const PHASE_COPY = {
  accepted: "Received. It is in the queue and I will take it from there.",
  investigating: "I am investigating this now and checking the evidence before drawing conclusions.",
  preparing: "The cause is confirmed and a fix is being prepared.",
  testing: "A fix is prepared and in testing. It is not live yet.",
  releasing: "The fix has passed testing and is being released. It is not live yet.",
  verifying: "The fix is released and I am verifying it against live play before calling it done.",
  live: "This is now live and verified.",
  waiting: "This is waiting on checks finishing; nothing further is needed from you.",
  blocked: "This is blocked and I have flagged exactly what it needs. I will update here when it moves.",
  "staff-owned": "A member of the team has picked this up directly.",
  // Closure is announced by the resolve path with its own receipt; the
  // status publisher stays silent rather than describe a closed record.
  closed: null,
};

const CLOSED = ["resolved", "cancelled", "closed-externally", "terminal"];
const STAGE_PHASE = { prepared: "preparing", "in-pr": "preparing", "ci-green": "testing",
  development: "testing", staging: "testing", main: "releasing",
  "deployed-web": "verifying", "deployed-worker": "verifying" };

// facts: release facts for this ticket's fix (see release.js). record: a
// work-record projection (see workrecord.js) or coordinator record.
// Release phases come only from the ordered release state, so one later fact
// across a missing earlier gate never reads as released. A blocker is never
// hidden behind release progress, and a closed record is never "investigating".
function derivePhase(record, facts = {}) {
  const rel = ticketReleaseState(facts);
  if (CLOSED.includes(record.state)) return rel.canClaimLive ? "live" : "closed";
  if (record.staffClaimedBy) return "staff-owned";
  if (rel.canClaimLive) return "live";
  if (record.state === "blocked" || record.nextAction === "blocked") return "blocked";
  if (STAGE_PHASE[rel.stage]) return STAGE_PHASE[rel.stage];
  if (record.nextAction === "awaiting-ci" || record.nextAction === "awaiting-event") return "waiting";
  if ((record.attempts || []).length === 0 && record.nextAction === "attempt") return "accepted";
  return "investigating";
}

// Decide post vs edit vs silence. Same phase inside the refresh window is
// silence; same phase beyond it refreshes (edits) the one status message; a
// new phase posts the transition. Live is terminal and posts once.
// Keys are outbox idempotency keys (ledger.notify drops a reused key), so
// each transition gets its own sequence number: a phase that recurs later
// still posts, and a retry of the same transition reuses the same key. The
// caller stores the returned seq in `last`.
function planPublication({ record, facts = {}, last = null, now = Date.now(), refreshMs = 15 * 60000 }) {
  const phase = derivePhase(record, facts);
  const copy = PHASE_COPY[phase];
  const seq = (last?.seq || 0) + 1;
  const key = `status:${record.id}:${seq}:${phase}`;
  if (copy === null) return { action: "none", phase, copy, key, seq: last?.seq || 0 };
  if (!last || last.phase !== phase) return { action: "post", phase, copy, key, seq };
  if (phase === "live") return { action: "none", phase, copy, key, seq: last.seq || 0 };
  if (now - (last.at || 0) >= refreshMs && last.messageId)
    return { action: "edit", phase, copy, messageId: last.messageId, seq: last.seq || 0,
      key: `status:${record.id}:${last.seq || 0}:refresh:${Math.floor(now / refreshMs)}` };
  return { action: "none", phase, copy, key, seq: last.seq || 0 };
}

// Composed synchronously at accept(), before any model runs. Queue facts
// come from admission (ackFacts), so the words cannot drift from the
// scheduler. Nothing ahead is not the same as starting: every slot in the
// class may be busy, so only an explicit startingNow says work is starting.
function composeAck({ queuedAhead = 0, startingNow = false, nextAction = "attempt", etaMs = null } = {}) {
  if (nextAction === "attempt" && startingNow && queuedAhead === 0)
    return "Received. I am picking this up now.";
  const eta = etaMs ? ` Current estimate to a first substantive reply: about ${Math.max(1, Math.round(etaMs / 60000))} minutes.` : "";
  const ahead = queuedAhead === 0 ? "It is next in line." : `${queuedAhead} item${queuedAhead === 1 ? "" : "s"} ahead of this one.`;
  return `Received and queued. ${ahead}${eta} I will post here when work starts and at each meaningful change.`;
}

module.exports = { PHASE_COPY, derivePhase, planPublication, composeAck };
