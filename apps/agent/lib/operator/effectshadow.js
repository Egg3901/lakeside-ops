"use strict";
// Keir 3.0 wiring, shadow mode: every privileged request the 2.x broker
// decides is also put to the EffectGate, and the two verdicts are compared.
// The broker's decision stands; the gate only records agreement or the
// exact disagreement. Promotion of the gate to the enforcing path waits on a
// clean disagreement record over real traffic.

const crypto = require("node:crypto");
const { createEffectGate, healKind } = require("./effectgate");
const { createPrincipals } = require("./principals");

const hash = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

function mapKind(kind, args = {}) {
  if (kind === "heal") return healKind(args.spec || {});
  if (kind === "github") return /promot/i.test(String(args.action || "")) ? "promotion" : "pr-merge";
  if (kind === "host_command") return "host-command";
  if (kind === "mcp_write") return "mcp-write";
  return null;
}

function createEffectShadow({ ledger, config, now = () => Date.now() }) {
  const d = ledger.data;
  const principals = createPrincipals(config);
  const gate = createEffectGate((d.effectGateShadow ||= {}), { now, rolesOf: principals.rolesOf });

  // action: the 2.x action record after request() decided it.
  function compare(job, kind, args, action) {
    try {
      const gateKind = mapKind(kind, args);
      const legacy = action?.state === "approved" ? "approved" : "needs-approval";
      if (!gateKind) return record({ job: job.id, kind, legacy, gate: "unmapped", agree: false });
      // The requester is the authenticated author of the job's opening
      // message, exactly what 2.x ownerDirected() trusts.
      const authorId = job.source?.authorId;
      const requester = authorId && authorId === job.actorId && job.kind === "command"
        ? principals.fromAuthenticated({ authorId, via: "message", messageId: job.source.messageId || null }) : null;
      const spec = { kind: gateKind, target: job.ticket ? `ticket:${job.ticket}` : `job:${job.id}`,
        environment: kind === "heal" ? args.spec?.env || "prod" : "prod", contentDigest: action?.digest || hash(args), workId: job.ticket ? `ticket:${job.ticket}` : job.id };
      let verdict;
      try { verdict = gate.propose(spec, { requester, origin: { kind: job.kind, ticket: job.ticket || null } }).needsApproval ? "needs-approval" : "approved"; }
      catch (e) { verdict = `refused: ${String(e.message).slice(0, 120)}`; }
      return record({ job: job.id, kind, gateKind, legacy, gate: verdict, agree: verdict === legacy });
    } catch (e) { return record({ job: job.id, kind, legacy: "unknown", gate: `error: ${e.message}`, agree: false }); }
  }

  function record(row) {
    const entry = { at: now(), ...row };
    d.effectShadow = [...(d.effectShadow || []), entry].slice(-300);
    if (!row.agree) { const { kind, ...rest } = entry; ledger.audit("effectgate_disagreement", { ...rest, requestKind: kind }); }
    return entry;
  }

  function summary(since = 0) {
    const rows = (d.effectShadow || []).filter((r) => r.at >= since);
    return { compared: rows.length, agreed: rows.filter((r) => r.agree).length,
      disagreements: rows.filter((r) => !r.agree).slice(-20) };
  }

  return { compare, summary, mapKind };
}

module.exports = { createEffectShadow, mapKind };
