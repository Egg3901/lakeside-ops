"use strict";
// Incidents (owner, 2026-10-14): staff-opened catch-all tickets for outages
// and other problems many players hit at once. Moderators and developers open
// them through the normal ticket flow; repeat tickets are merged into them by
// staff (/merge-ticket) or by Keir (support_merge). Keir does not work an
// incident channel on its own: staff own it, and developers summon Keir there
// like anywhere else.
//
// Before a new ticket's first model run Keir asks Jev, in one bundled call,
// whether the report is the same problem as each open incident. A decisive
// match merges at once with no model tokens; a plausible match is handed to
// the model as a candidate it may merge with merge_into_incident. Everything
// fails open: no incidents, no key or no verdict means the ticket is worked
// as usual.

const JEV = "/root/bin/lib/jev.mjs";
const defaultAsk = (spec) => (process.env.KEIR_JEV === "off" ? Promise.resolve(null) : import(JEV).then((m) => m.ask(spec)));
const AUTO_MERGE = 0.85;
const CANDIDATE = 0.5;
const CACHE_MS = 60000;

let cache = { at: 0, items: [] };
async function openIncidents(mcp, { now = Date.now(), signal } = {}) {
  if (cache.at && now - cache.at < CACHE_MS) return cache.items;
  const r = await mcp.call("support", "support_list", { kind: "ticket", category: "incident", openOnly: true, limit: 20 }, false, signal).catch(() => null);
  const items = (r?.items || []).filter((t) => t.category === "incident" && !["resolved", "closed"].includes(t.status));
  const detailed = [];
  for (const t of items.slice(0, 8)) {
    const full = await mcp.call("support", "support_get", { kind: "ticket", number: t.number }, false, signal).catch(() => null);
    detailed.push({ number: t.number, title: t.title, description: String(full?.description || "").slice(0, 800), merged: (full?.mergedTickets || []).length, createdAt: t.createdAt });
  }
  cache = { at: now, items: detailed };
  return detailed;
}
const resetIncidentCache = () => { cache = { at: 0, items: [] }; };

function reportText(job) {
  return [job.source, ...(job.requestInbox || []), ...(job.inbox || [])].filter(Boolean).slice(0, 4).map((s) => String(s.content || "")).join("\n").slice(0, 1500);
}

// Returns { best: {number, p} | null, candidates: [{number, title, p}] }.
async function matchIncident({ job, incidents, ask = defaultAsk, timeoutMs = 6000 }) {
  if (!incidents.length) return { best: null, candidates: [] };
  const questions = Object.fromEntries(incidents.map((inc) => [`i${inc.number}`, {
    type: "noul",
    instructions: `Is the player's report the same problem as incident #${inc.number}? Incident: ${inc.title}. ${inc.description}`.slice(0, 1200),
    criteria: { true: "The report describes the same outage, error or broken behaviour as the incident, even in different words.", false: "The report is about a different problem, a different part of the game, or only mentions the incident in passing." },
  }]));
  const out = await ask({ state: { report: reportText(job), ticket: job.ticket || null }, questions, timeoutMs }).catch(() => null);
  if (!out?.answers) return { best: null, candidates: [] };
  const scored = incidents.map((inc) => ({ number: inc.number, title: inc.title, p: Number(out.answers[`i${inc.number}`]?.noul) })).filter((x) => Number.isFinite(x.p)).sort((a, b) => b.p - a.p);
  const top = scored[0];
  // A merge needs one clear winner, not two incidents that both look likely.
  const clear = top && top.p >= AUTO_MERGE && !(scored[1] && scored[1].p >= CANDIDATE);
  return { best: clear ? { number: top.number, p: top.p } : null, candidates: scored.filter((x) => x.p >= CANDIDATE).slice(0, 3) };
}

async function mergeIntoIncident({ mcp, ledger, job, target, reason, by = "keir", requireIncident = true, signal }) {
  const source = job.ticket;
  if (!source) throw new Error("only a ticket task can merge its own ticket");
  const r = await mcp.call("support", "support_merge", { source_number: source, target_number: target, reason: String(reason || "").slice(0, 500), merged_by: by, require_incident: requireIncident }, true, signal);
  job.mergedInto = target; job.state = "done"; job.channelClosed = true;
  job.summary = `Merged into ${requireIncident ? "incident" : "ticket"} #${target}: ${String(reason || "same problem").slice(0, 200)}`;
  ledger.audit("merged_into_incident", { job: job.id, ticket: source, target, by, steps: r?.steps || null, alreadyMerged: Boolean(r?.alreadyMerged) });
  resetIncidentCache();
  ledger.save();
  return r;
}

module.exports = { openIncidents, matchIncident, mergeIntoIncident, resetIncidentCache, AUTO_MERGE, CANDIDATE };
