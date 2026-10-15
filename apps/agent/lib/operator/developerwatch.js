"use strict";
// A filed question is not an accepted handoff. Track the queue receipt until
// somebody owns it, and wake the originating task on progress or a missed SLA.
// These observations never grant execution authority or resolve a ticket.
const ACK_MS = 30 * 60000, PROGRESS_MS = 2 * 3600000, POLL_MS = 5 * 60000;
const pendingHandoffs = (job) => (job.raisedToDevelopers || []).filter((r) => r.blocking && r.id && !r.releasedAt);
const timestamp = (value) => typeof value === "number" ? value : Date.parse(value) || 0;

function createDeveloperWatch({ ledger, mcp, now = () => Date.now(), held = () => false, log = () => {} }) {
  const d = ledger.data;
  function tell(job, r, key, content, alert = false) {
    const w = (r.watch ||= {});
    if ((w.delivered ||= []).includes(key)) return;
    w.delivered = [...w.delivered, key].slice(-20);
    (job.inbox ||= []).push({ authorId: "developer-watch", role: "system", at: new Date(now()).toISOString(), content });
    if (["waiting", "blocked"].includes(job.state)) { job.state = "queued"; job.wakeAt = 0; }
    if (alert) ledger.notify(`recovery:developer-handoff:${job.id}:${r.id}:${key}`, "owner", content);
    ledger.audit("developer_handoff_wake", { job: job.id, item: r.id, reason: key, alert });
  }
  async function tick() {
    if (d.paused) return;
    const reads = new Map();
    let count = 0;
    for (const job of Object.values(d.jobs)) {
      if (["done", "dismissed", "cancelled", "deferred"].includes(job.state) || job.resolved || job.channelClosed || held(job) ||
        Object.values(job.effects || {}).some((e) => e.state === "started")) continue;
      // Old ledgers identify a blocking question by its explicit reply wait.
      // Do not infer blocking work from arbitrary historical issue filings.
      if (job.waitingFor?.kind === "developer_reply") for (const r of job.raisedToDevelopers || []) {
        if (r.blocking === undefined && r.kind === undefined && r.id) r.blocking = true;
      }
      for (const r of pendingHandoffs(job)) {
        const w = (r.watch ||= {});
        if (w.checkedAt != null && now() - w.checkedAt < POLL_MS) continue;
        if (count++ >= 5) { ledger.save(); return; }
        w.checkedAt = now();
        let item;
        try {
          if (!reads.has(r.id)) reads.set(r.id, mcp.call("ops-knowledge", "kanban_get", { id: r.id }, false));
          item = await reads.get(r.id);
          if (!item || Number(item.id) !== Number(r.id)) throw new Error("developer queue returned no matching item");
          w.errors = 0; delete w.errorSince;
        } catch (e) {
          if (!w.errors) w.errorSince = now();
          w.errors = (w.errors || 0) + 1;
          log(`developer handoff ${r.id}: ${String(e.message).slice(0, 200)}`);
          if (w.errors >= 3) tell(job, r, `unreadable:${w.errorSince}`, `Developer handoff #${r.id} could not be read three times. Inspect its receipt and route the work; do not claim it was accepted or resolved.`, true);
          continue;
        }
        const progressAt = timestamp(item.last_progress_at);
        const summary = String(item.progress_summary || "").trim().replace(/\s+/g, " ").toLowerCase();
        const version = JSON.stringify([item.lane, item.assigned_to || null, summary, item.evidence_url || null]);
        const changed = w.version !== version;
        if (changed) {
          w.meaningfulAt = w.version ? now() : Math.max(r.at, Math.min(now(), progressAt));
          w.version = version; w.changedAt = now();
        }
        if (item.lane === "done") {
          if (item.evidence_url) {
            r.releasedAt = now();
            tell(job, r, `completed:${version}`, `Developer handoff #${r.id} is marked complete with evidence: ${item.evidence_url}. Re-read the result and verify the actual outcome and deployment before resolving the original problem.`);
          } else tell(job, r, `no-evidence:${version}`, `Developer handoff #${r.id} is marked complete without evidence. Check its result before claiming the problem is fixed.`, true);
          continue;
        }
        const accepted = item.lane === "now" && Boolean(item.assigned_to) && progressAt >= r.at;
        if (accepted && !w.acceptedAt) {
          w.acceptedAt = now();
          tell(job, r, `accepted:${version}`, `Developer handoff #${r.id} was accepted by ${item.assigned_to}. It is still in progress; filing or acceptance alone is not a verified resolution.`);
        } else if (changed && w.lastProgressAt != null) {
          tell(job, r, `progress:${version}`, `Developer handoff #${r.id} has new progress. Read its current result before choosing the next step.`);
        }
        w.lastProgressAt = progressAt;
        const baseline = accepted ? Math.max(r.at, w.meaningfulAt) : r.at;
        const budget = accepted ? PROGRESS_MS : ACK_MS;
        if (now() - baseline >= budget) tell(job, r, `overdue:${version}`, `Developer handoff #${r.id} ${accepted ? "has had no progress for two hours" : "has not been accepted within thirty minutes"}. Check the dependency, re-plan or arrange an explicit responsible owner. Do not file a duplicate, widen permissions, or finish merely because the item exists.`, true);
      }
    }
    ledger.save();
  }
  return { tick };
}
module.exports = { createDeveloperWatch, pendingHandoffs, ACK_MS, PROGRESS_MS, POLL_MS };
