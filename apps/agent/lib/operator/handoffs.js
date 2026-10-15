"use strict";
// Keir 3.0 F4, the Handoff Desk. Inter-agent handoffs become structured,
// receipted work instead of notebook entries that may or may not be read.
// A handoff is complete only in three steps: filed with scope, evidence and
// explicit asks; acknowledged back to the sender; and incorporated into the
// linked work records before its deadline. Long content is document-backed
// by reference (doc name plus digest) so nothing is ever silently truncated
// to fit a note field. A handoff is context and asks, never new authority:
// filing one cannot approve an effect.

function createHandoffDesk(store, { now = () => Date.now(), defaultDeadlineMs = 24 * 3600000 } = {}) {
  store.handoffs ||= {};
  const handoffs = store.handoffs;

  function file(h) {
    if (!h?.id || !h?.from || !h?.scope) throw new Error("a handoff needs id, from and scope");
    if (!Array.isArray(h.asks) || !h.asks.length) throw new Error("a handoff needs explicit asks");
    if (handoffs[h.id]) return { handoff: handoffs[h.id], duplicate: true };
    // Nothing is cut to fit: oversize fields are refused so the sender moves
    // them into the document instead of losing the tail silently.
    if (String(h.scope).length > 500 || h.asks.some((a) => String(a).length > 500))
      throw new Error("scope and each ask must fit 500 characters; put the rest in the backing document");
    const rec = { id: h.id, from: h.from, scope: String(h.scope),
      asks: h.asks.map(String), body: h.body ? String(h.body) : null,
      evidence: h.evidence || [], workIds: h.workIds || [],
      document: h.document || null, // { name, digest } for anything long
      state: "filed", filedAt: now(), deadline: now() + (h.deadlineMs || defaultDeadlineMs),
      incorporatedInto: [] };
    if ((h.body || "").length > 4000 && !rec.document)
      throw new Error("long handoffs must be document-backed (name plus digest), not truncated into a note");
    handoffs[h.id] = rec;
    return { handoff: rec, duplicate: false };
  }

  // The sender gets a receipt they can check; filing is not acknowledgement.
  function acknowledge(id, by) {
    const rec = handoffs[id];
    if (!rec) throw new Error("unknown handoff");
    if (rec.state === "filed") { rec.state = "acknowledged"; rec.acknowledgedAt = now(); rec.acknowledgedBy = by || null; }
    return rec;
  }

  // Incorporation is per linked work record and explicit: reading a handoff
  // is not incorporating it.
  function incorporate(id, workId, note) {
    const rec = handoffs[id];
    if (!rec) throw new Error("unknown handoff");
    if (rec.workIds.length && !rec.workIds.includes(workId))
      throw new Error("work record is not linked to this handoff");
    if (!rec.incorporatedInto.some((x) => x.workId === workId))
      rec.incorporatedInto.push({ workId, at: now(), note: String(note || "").slice(0, 500) });
    const linked = rec.workIds.length ? rec.workIds : [workId];
    if (linked.every((w) => rec.incorporatedInto.some((x) => x.workId === w))) rec.state = "incorporated";
    return rec;
  }

  const overdue = (at = now()) => Object.values(handoffs)
    .filter((h) => h.state !== "incorporated" && h.deadline <= at)
    .map((h) => ({ id: h.id, state: h.state, from: h.from, overdueMs: at - h.deadline }));

  return { file, acknowledge, incorporate, overdue, get: (id) => handoffs[id] };
}

module.exports = { createHandoffDesk };
