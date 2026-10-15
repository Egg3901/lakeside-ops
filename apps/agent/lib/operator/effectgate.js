"use strict";
// Keir 3.0 stage D, the EffectGate. Approvals stop being properties of jobs
// and become immutable capabilities over a typed effect identity:
// operation + target + environment + content digest. The same identity
// reuses a live approval and says so; any material change mints a new
// identity that must be approved again. Unknown kinds fail closed.
//
// The taxonomy carries the live 2.x rules (broker.request, publishPatch,
// decisions.js) so the gate can replace them without changing authority:
// - auto: reversible work under standing operator authority. Opening or
//   revising a development PR is here, as in 2.x publishPatch.
// - standing: the owner's own request authorizes it (2.x ownerDirected
//   auto-approval, receipt = the request message). Anyone else needs an
//   exact approval.
// - exact: always its own explicit yes, even inside owner work (economy
//   merges, promotions, high-impact heals, money, policy, moderation).
// Heals split by impact with the 2.x predicate (money, compensation,
// gameConfig, more than 25 records). Lifetimes are per kind (heals 9 min,
// as in 2.x). The delegate may approve only an escalated effect, and the
// approval records that it was on the owner's behalf. Approvals come only
// from minted principals (principals.js) and the approver's role is checked
// again at execution. An execution ends done, failed (nothing happened,
// retryable) or uncertain (inspect the receipt, never retry blindly).

const crypto = require("node:crypto");
const { isAuthentic } = require("./principals");
const digestOf = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

const MIN = 60000, HOUR = 3600000;
const EFFECTS = {
  "investigate-read": { tier: "auto" },
  "public-status": { tier: "auto" },          // derived from verified state, safe copy
  "patch-prepare": { tier: "auto" },          // snapshot edits and focused tests
  "patch-publish": { tier: "auto" },          // dev PR: CI and a human still gate merge
  "heal-nonprod": { tier: "standing", roles: ["owner", "delegate", "developer"], ttlMs: 9 * MIN },
  "heal-prod": { tier: "standing", roles: ["owner", "delegate"], requesterMayApprove: true, ttlMs: 9 * MIN },
  "mcp-write": { tier: "standing", roles: ["owner", "delegate"], ttlMs: HOUR },
  "host-command": { tier: "standing", roles: ["owner", "delegate"], ttlMs: 9 * MIN },
  "heal-prod-high": { tier: "exact", roles: ["owner", "delegate"], ttlMs: HOUR },
  "pr-merge": { tier: "exact", roles: ["owner", "delegate"], ttlMs: 24 * HOUR },
  "promotion": { tier: "exact", roles: ["owner", "delegate"], ttlMs: 24 * HOUR },
  "money-move": { tier: "exact", roles: ["owner", "delegate"], ttlMs: HOUR },
  "policy-change": { tier: "exact", roles: ["owner", "delegate"], ttlMs: 24 * HOUR },
  "moderation": { tier: "exact", roles: ["owner", "moderator"], ttlMs: HOUR },
  "delete-data": { tier: "exact", roles: ["owner"], ttlMs: HOUR },
};
const HEAL_KINDS = ["heal-nonprod", "heal-prod", "heal-prod-high"];

// The 2.x high-impact predicate (broker.request): prod heals that move
// money, pay compensation, change world config or touch many records.
function healKind(spec = {}) {
  if (spec.env !== "prod") return "heal-nonprod";
  const high = spec.touchesMoney || spec.kind === "compensation" || spec.collection === "gameConfig"
    || Number(spec.expectedMax || 0) > 25;
  return high ? "heal-prod-high" : "heal-prod";
}

function effectIdentity({ kind, target, environment = "prod", contentDigest }) {
  if (!EFFECTS[kind]) throw new Error(`unknown effect kind: ${kind}`);
  if (!target) throw new Error("an effect needs a target");
  return digestOf({ kind, target, environment, contentDigest: contentDigest || null });
}

// rolesOf(actorId): current roles from the principal resolver, used to
// re-check an approver at execution. Without it no role re-check happens,
// which is only acceptable in unit tests.
function createEffectGate(store, { now = () => Date.now(), defaultTtlMs = null, rolesOf = null } = {}) {
  store.effects ||= {}; store.approvals ||= {}; store.toolRejections ||= {};
  const { effects, approvals, toolRejections } = store;
  const ttlOf = (kind) => defaultTtlMs ?? EFFECTS[kind].ttlMs ?? 24 * HOUR;
  const live = (a) => Boolean(a && a.state === "approved" && a.expiresAt > now());

  function grant(effect, principal, role, extra = {}) {
    approvals[effect.identity] = { state: "approved", actor: principal.actor, role, via: principal.via,
      messageId: principal.messageId, at: now(), expiresAt: now() + ttlOf(effect.kind), ...extra };
    effect.state = "authorized";
    return approvals[effect.identity];
  }

  // Registers an intended effect. requester: the minted principal whose
  // request this effect serves. origin: { kind, ticket } of the work item.
  function propose(spec, { requester = null, origin = null } = {}) {
    const identity = effectIdentity(spec);
    const def = EFFECTS[spec.kind];
    if (origin?.kind === "candidate" && !origin.ticket && def.tier !== "auto")
      throw new Error("finish intake first; a candidate cannot request privileged execution");
    if (HEAL_KINDS.includes(spec.kind) && spec.workId && toolRejections[spec.workId])
      throw new Error(`the heal tool rejected this work's last apply before it ran (${toolRejections[spec.workId].error}); re-planning repeats the same rejection, so it stays blocked until the adapter is fixed`);
    const existing = effects[identity];
    if (existing) {
      const approval = approvals[identity];
      return { effect: existing, identity, reusedApproval: live(approval),
        needsApproval: def.tier !== "auto" && !live(approval) && !["done", "executing", "uncertain"].includes(existing.state) };
    }
    const effect = { identity, kind: spec.kind, target: spec.target,
      environment: spec.environment || "prod", contentDigest: spec.contentDigest || null,
      workId: spec.workId || null, requester: requester && isAuthentic(requester) ? requester.actor : null,
      state: def.tier === "auto" ? "authorized" : "proposed", proposedAt: now(), receipt: null, failures: [] };
    effects[identity] = effect;
    // Standing authority: the owner's own request is the approval, with the
    // request message as its receipt. Never for exact-tier effects.
    if (def.tier === "standing" && isAuthentic(requester) && requester.roles.includes("owner") && requester.via === "message") {
      grant(effect, requester, "owner", { standing: true });
      return { effect, identity, reusedApproval: false, needsApproval: false, standing: true };
    }
    return { effect, identity, reusedApproval: false, needsApproval: def.tier !== "auto" };
  }

  function approverRole(effect, principal) {
    const def = EFFECTS[effect.kind];
    const allowed = def.roles || [];
    for (const role of principal.roles) {
      if (!allowed.includes(role)) continue;
      if (role === "delegate" && !effect.escalatedAt) continue; // delegate answers only escalated asks
      return role;
    }
    if (def.requesterMayApprove && effect.requester === principal.actor && principal.roles.includes("developer")) return "requester";
    return null;
  }

  function approve(identity, principal) {
    const effect = effects[identity];
    if (!effect) throw new Error("unknown effect identity");
    if (!isAuthentic(principal)) throw new Error("approvals come only from an authenticated principal");
    const role = approverRole(effect, principal);
    if (!role) throw new Error(`role ${principal.roles.join("/") || "none"} cannot approve ${effect.kind}`);
    // An approval can never re-arm an effect that ran, is running or may
    // have run: that is a second execution, not a fresh decision.
    if (["done", "executing", "uncertain"].includes(effect.state))
      throw new Error(`effect is ${effect.state}; inspect its receipt`);
    return grant(effect, principal, role, role === "delegate" ? { onBehalfOf: "owner" } : {});
  }

  function reject(identity, principal) {
    const effect = effects[identity];
    if (!effect) throw new Error("unknown effect identity");
    if (!isAuthentic(principal)) throw new Error("rejections come only from an authenticated principal");
    const role = approverRole(effect, principal);
    if (!role) throw new Error(`role ${principal.roles.join("/") || "none"} cannot reject ${effect.kind}`);
    if (["done", "executing", "uncertain"].includes(effect.state)) throw new Error(`effect is ${effect.state}; a rejection cannot undo it`);
    approvals[identity] = { state: "rejected", actor: principal.actor, role, at: now(), expiresAt: 0 };
    effect.state = "rejected";
    return approvals[identity];
  }

  // decisions.js escalation after three hours unlocks the delegate.
  function escalate(identity) {
    const effect = effects[identity];
    if (!effect) throw new Error("unknown effect identity");
    effect.escalatedAt ||= now();
    return effect;
  }

  function check(effect) {
    if (effect.state === "done") return { allowed: false, reason: "already executed; inspect the receipt", receipt: effect.receipt };
    if (effect.state === "executing" || effect.state === "uncertain")
      return { allowed: false, reason: "execution outcome uncertain; inspect the receipt before any retry" };
    if (EFFECTS[effect.kind].tier === "auto") return { allowed: true, identity: effect.identity };
    const approval = approvals[effect.identity];
    if (!approval || approval.state !== "approved") return { allowed: false, reason: "no live approval for this exact effect" };
    if (approval.expiresAt <= now()) return { allowed: false, reason: "approval expired" };
    if (rolesOf) {
      const current = rolesOf(approval.actor);
      const still = approval.role === "requester" ? current.includes("developer") : current.includes(approval.role);
      if (!still) return { allowed: false, reason: "the approver no longer holds the role that approved this" };
    }
    return { allowed: true, identity: effect.identity, approval };
  }

  // Native guard recheck immediately before execution. Any drift between the
  // approved identity and what is about to run refuses to proceed.
  function authorizeExecution(spec) {
    const effect = effects[effectIdentity(spec)];
    if (!effect) return { allowed: false, reason: "effect was never proposed" };
    return check(effect);
  }

  // Re-runs the full check, so a caller cannot skip authorizeExecution and
  // execute on an expired or revoked approval.
  function beginExecution(identity) {
    const effect = effects[identity];
    if (!effect) throw new Error("unknown effect identity");
    const verdict = check(effect);
    if (!verdict.allowed || effect.state !== "authorized") throw new Error(`effect is not authorized to execute: ${verdict.reason || effect.state}`);
    effect.state = "executing"; effect.startedAt = now();
    return effect;
  }

  function recordReceipt(identity, receipt) {
    const effect = effects[identity];
    if (!effect) throw new Error("unknown effect identity");
    effect.state = "done"; effect.receipt = { at: now(), ...receipt };
    return effect;
  }

  // definite: the adapter proved nothing happened (validation rejection,
  // refused before write). Otherwise the outcome is uncertain.
  function recordFailure(identity, { definite = false, error = "", toolRejected = false } = {}) {
    const effect = effects[identity];
    if (!effect) throw new Error("unknown effect identity");
    effect.failures.push({ at: now(), definite, error: String(error).slice(0, 500) });
    if (!definite) { effect.state = "uncertain"; return effect; }
    effect.state = EFFECTS[effect.kind].tier === "auto" || live(approvals[identity]) ? "authorized" : "proposed";
    if (toolRejected && HEAL_KINDS.includes(effect.kind) && effect.workId)
      toolRejections[effect.workId] = { at: now(), error: String(error).slice(0, 300), identity };
    return effect;
  }

  // Startup: anything that was executing when the process died may or may
  // not have happened.
  function recoverInFlight() {
    const recovered = [];
    for (const e of Object.values(effects)) if (e.state === "executing") { e.state = "uncertain"; recovered.push(e.identity); }
    return recovered;
  }

  // After inspecting the external system: either the receipt was found, or
  // the effect provably did not happen and may be authorized again.
  function resolveUncertain(identity, { receipt = null, notExecuted = false } = {}) {
    const effect = effects[identity];
    if (!effect || effect.state !== "uncertain") throw new Error("effect is not uncertain");
    if (receipt) return recordReceipt(identity, { ...receipt, via: "reconciled" });
    if (!notExecuted) throw new Error("resolve with a receipt or with proof it did not execute");
    effect.state = EFFECTS[effect.kind].tier === "auto" || live(approvals[identity]) ? "authorized" : "proposed";
    return effect;
  }

  const clearToolRejection = (workId) => { delete toolRejections[workId]; };

  // A completed broader promotion retires only pending effects it exactly
  // subsumes: same destination environment and a source contained in the
  // promoted set. Everything else stays pending and visible.
  function reconcilePromotion({ environment, containedDigests = [] }) {
    const contained = new Set(containedDigests);
    const retired = [];
    for (const effect of Object.values(effects)) {
      if (effect.kind !== "promotion" || !["proposed", "authorized"].includes(effect.state)) continue;
      if (effect.environment === environment && contained.has(effect.contentDigest)) {
        effect.state = "done";
        effect.receipt = { at: now(), via: "subsumed-by-promotion", environment };
        retired.push(effect.identity);
      }
    }
    return retired;
  }

  return { propose, approve, reject, escalate, authorizeExecution, beginExecution, recordReceipt,
    recordFailure, recoverInFlight, resolveUncertain, clearToolRejection, reconcilePromotion,
    get: (identity) => effects[identity] };
}

module.exports = { EFFECTS, HEAL_KINDS, healKind, effectIdentity, createEffectGate };
