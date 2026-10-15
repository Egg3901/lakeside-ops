"use strict";
// Counts root tickets separately from delegated jobs and completed activations.
// No requester text, prompt, patch, approval question or raw tool output leaves
// this projection. Unknown wait time stays explicitly unknown.
const HOUR = 3600000, TERMINAL = new Set(["done", "cancelled", "dismissed", "deferred"]);
const stamp = (x) => { const n = typeof x === "number" ? x : Date.parse(x); return Number.isFinite(n) && n > 0 ? n : null; };
const finite = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
const count = (n) => Math.floor(finite(n));
const earliest = (values) => { const known = values.map(stamp).filter(Boolean); return known.length ? Math.min(...known) : null; };
const ticketOf = (j) => Number(j?.ticket || /^ticket-.*-(\d+)$/.exec(j?.source?.channelName || "")?.[1]) || null;
const labelOf = (j) => ticketOf(j) ? `Ticket ${ticketOf(j)}` : j?.codingParent ? "Delegated work" : j?.kind === "command" ? "Staff request" : "Operator task";
function buildThroughput(d = {}, usage = [], { now = Date.now(), windowMs = 6 * HOUR, limit = 12, supportTickets = null } = {}) {
  const jobs = d.jobs || {}, all = Object.values(jobs).filter((j) => j && !j.internalProbe);
  const rootOf = (job) => { let current = job; const seen = new Set(); while (current?.codingParent && !seen.has(current.id)) { seen.add(current.id); if (!jobs[current.codingParent]) break; current = jobs[current.codingParent]; } return current || job; };
  const visible = (j) => j && !j.internalProbe && !rootOf(j).internalProbe;
  const active = all.filter((j) => visible(j) && !TERMINAL.has(j.state));
  const children = active.filter((j) => j.codingParent);
  const decisions = Object.values(d.decisions || {}).filter((x) => x && x.state === "pending");
  const byParent = new Map();
  for (const j of active) if (j.codingParent && ["queued", "running", "waiting"].includes(j.state)) { const list = byParent.get(j.codingParent) || []; list.push(j); byParent.set(j.codingParent, list); }
  function waiting(j) {
    if (j.state === "running") return { kind: "executing", since: stamp(j.startedAt), basis: "activation-start" };
    const asks = decisions.filter((x) => x.jobId === j.id);
    const ci = Object.entries(j.ciWatch || {}).filter(([n, w]) => /^\d+$/.test(n) && w);
    const dependencies = byParent.get(j.id) || [];
    if (asks.length || j.ownerDecisionPending) return { kind: "owner", since: earliest(asks.map((x) => x.at)), basis: "decision-opened" };
    if (ci.length) return { kind: "ci", since: earliest(ci.map(([, w]) => w.since)), basis: "ci-watch-start", prs: ci.slice(0, 8).map(([n, w]) => ({ number: Number(n), url: /^Egg3901\/(AHDGame|AHDClient)$/.test(w.repository || "Egg3901/AHDGame") ? `https://github.com/${w.repository || "Egg3901/AHDGame"}/pull/${n}` : null })) };
    if (dependencies.length) return { kind: "dependency", since: null, basis: "current-child-state", children: dependencies.length };
    if (j.turnWatch) return { kind: "turn", since: stamp(j.turnWatch.since || j.turnWatch.at), basis: "turn-watch-start" };
    if (j.promotionHoldUntil > now) return { kind: "schedule", since: null, basis: "owner-hours-hold" };
    return { kind: j.state === "queued" ? "queued" : "other", since: null, basis: "unknown" };
  }
  const primary = active.map((j) => ({ job: j, wait: waiting(j) }));
  const counts = Object.fromEntries(["executing", "queued", "dependency", "ci", "owner", "turn", "schedule", "other"].map((k) => [k, primary.filter((r) => r.wait.kind === k).length]));
  const since = now - windowMs;
  const history = all.filter(visible).flatMap((j) => (Array.isArray(j.history) ? j.history : []).filter((h) => h.kind === "turn-limit" && stamp(h.at) >= since && stamp(h.at) <= now).map((h) => ({ job: j.id, at: stamp(h.at) })));
  const records = (Array.isArray(usage) ? usage : []).filter((u) => {
    const at = stamp(u.atMs || u.at); return at >= since && at <= now && (!jobs[u.job] || visible(jobs[u.job]));
  }).map((u) => ({ job: u.job || null, at: stamp(u.atMs || u.at), durationMs: typeof u.durationMs === "number" && Number.isFinite(u.durationMs) && u.durationMs >= 0 ? u.durationMs : null,
    exhausted: u.outcome === "error_max_turns", timeout: u.outcome === "timeout", outcome: u.outcome || "unknown" }));
  // Historical turn-limit entries cover runners that logged an incomplete
  // activation as 'ok'. Never add a second activation for the same receipt.
  const historyOnly = [];
  for (const h of history) {
    const nearest = records.filter((u) => u.job === h.job && Math.abs(u.at - h.at) < 120000).sort((a, b) => Math.abs(a.at - h.at) - Math.abs(b.at - h.at))[0];
    if (nearest) nearest.exhausted = true; else historyOnly.push(h);
  }
  const exhaustion = [...records.filter((u) => u.exhausted), ...historyOnly.map((h) => ({ ...h, exhausted: true, durationMs: null }))];
  const groups = new Map();
  const group = (root) => {
    if (!groups.has(root.id)) groups.set(root.id, { id: root.id, ticket: ticketOf(root), label: labelOf(root), kind: root.kind, rootState: root.state, rootActive: !TERMINAL.has(root.state), jobs: [], modelMs: 0, activations: 0, exhausted: 0, exhaustionLifetime: 0, lastActivityAt: null });
    return groups.get(root.id);
  };
  for (const j of active) group(rootOf(j)).jobs.push(j);
  for (const u of records) {
    if (!jobs[u.job] || !visible(jobs[u.job])) continue;
    const g = group(rootOf(jobs[u.job])); g.modelMs += u.durationMs || 0; g.activations++; g.lastActivityAt = Math.max(g.lastActivityAt || 0, u.at);
  }
  for (const u of exhaustion) if (jobs[u.job] && visible(jobs[u.job])) group(rootOf(jobs[u.job])).exhausted++;
  for (const j of all.filter(visible)) {
    const lifetime = Math.max(count(j.exhaustedActivations), (j.history || []).filter((h) => h.kind === "turn-limit").length);
    if (lifetime || !TERMINAL.has(j.state)) group(rootOf(j)).exhaustionLifetime += lifetime;
  }
  const rows = [...groups.values()].map((g) => {
    const root = jobs[g.id], liveChildren = g.jobs.filter((j) => j.codingParent), running = g.jobs.filter((j) => j.state === "running");
    const wait = running.length ? { kind: "executing", since: earliest(running.map((j) => j.startedAt)), basis: "activation-start" } : waiting(root);
    const observedAt = stamp(root.updatedAt || root.at), waitSince = stamp(wait.since);
    const ageSince = wait.kind === "executing" ? null : waitSince || observedAt;
    const monitor = Boolean(root.resolved || root.resolutionSubmitted || root.resolutionReadyAt || (Array.isArray(supportTickets) && supportTickets.some((t) => Number(t.number) === ticketOf(root) && ["closed", "resolved"].includes(t.status))));
    const coding = liveChildren.filter((j) => !j.investigation && ["queued", "running", "waiting"].includes(j.state));
    const investigating = liveChildren.filter((j) => j.investigation && ["queued", "running", "waiting"].includes(j.state));
    const stage = monitor ? "monitoring" : wait.kind === "owner" ? "approval" : wait.kind === "ci" ? "ci" : wait.kind === "schedule" ? "release"
      : coding.length ? "coding" : investigating.length || running.length ? "investigation" : wait.kind === "queued" ? "queued" : "unknown";
    return { stage, monitoring: monitor, id: g.id, ticket: g.ticket, label: g.label, kind: g.kind, state: g.rootState, active: g.jobs.length > 0, category: wait.kind,
      waitSince, ageMs: ageSince ? Math.max(0, now - ageSince) : null, ageBasis: waitSince ? wait.basis : "last-job-update", updatedAt: observedAt,
      running: running.length, children: liveChildren.length, blockedChildren: liveChildren.filter((j) => j.state === "blocked").length, queuedChildren: liveChildren.filter((j) => j.state === "queued").length,
      investigationChildren: liveChildren.filter((j) => j.investigation).length, codingChildren: liveChildren.filter((j) => !j.investigation).length,
      activations: g.activations, modelMs: g.modelMs, exhausted: g.exhausted, exhaustionLifetime: g.exhaustionLifetime, repeatedExhaustion: g.exhausted >= 2,
      lastActivationAt: g.lastActivityAt, prs: wait.prs || [],
    };
  }).sort((a, b) => Number(b.active) - Number(a.active) || b.exhausted - a.exhausted || (b.ageMs || 0) - (a.ageMs || 0) || b.modelMs - a.modelMs);
  const ticketRoots = active.filter((j) => !j.codingParent && j.kind === "ticket");
  const support = Array.isArray(supportTickets) ? supportTickets : [];
  const supportState = new Map(support.map((t) => [Number(t.number), t.status]));
  const ticketGroups = new Map();
  for (const j of ticketRoots) { const key = ticketOf(j) || j.id; const list = ticketGroups.get(key) || []; list.push(j); ticketGroups.set(key, list); }
  const watching = [...ticketGroups.values()].filter((roots) => roots.every((j) => j.resolved || j.resolutionSubmitted || j.resolutionReadyAt || ["resolved", "closed"].includes(supportState.get(ticketOf(j))))).length;
  const statuses = support.reduce((counts, t) => { const k = ["open", "in_progress", "closed", "resolved"].includes(t.status) ? t.status : "other"; counts[k] = (counts[k] || 0) + 1; return counts; }, {});
  const stalls = rows.filter((r) => r.active && r.category !== "executing").sort((a, b) => (b.ageMs || 0) - (a.ageMs || 0)).slice(0, 8);
  const linkedModelMs = rows.reduce((sum, r) => sum + r.modelMs, 0);
  const modelMs = records.reduce((sum, r) => sum + (r.durationMs || 0), 0);
  return { at: now, windowMs, paused: Boolean(d.paused), counts: { ticketRoots: ticketGroups.size, actionableTicketRoots: ticketGroups.size - watching, monitoringTicketRoots: watching, rootJobs: active.length - children.length, childJobs: children.length,
      liveJobs: active.length, ...counts, investigationExecuting: children.filter((j) => j.investigation && j.state === "running").length, codingExecuting: children.filter((j) => !j.investigation && j.state === "running").length, investigationChildren: children.filter((j) => j.investigation).length, codingChildren: children.filter((j) => !j.investigation).length },
    supportSample: { available: Array.isArray(supportTickets), count: support.length, limit: 60, statuses, label: "Latest support-list sample, not the whole ticket database" },
    cost: { activations: records.length, modelMs, unattributedModelMs: Math.max(0, modelMs - linkedModelMs), durationKnown: records.filter((r) => r.durationMs !== null).length, exhausted: exhaustion.length, exhaustionHistoryOnly: historyOnly.length, timedOut: records.filter((r) => r.timeout).length,
      repeatedRoots: rows.filter((r) => r.repeatedExhaustion).length, lifetimeExhausted: rows.reduce((sum, r) => sum + r.exhaustionLifetime, 0) },
    work: rows.slice(0, Math.max(1, Math.min(40, limit))), hiddenWork: Math.max(0, rows.length - Math.max(1, Math.min(40, limit))), longestStalls: stalls,
    note: "Model time is summed completed activation duration, not elapsed wait or measured waste. Wait ages use recorded CI/decision timestamps; other ages are since the last root-job update." };
}
module.exports = { buildThroughput };
