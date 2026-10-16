"use strict";
// Keir 5.6.x (2026-10-16): a GitHub merge whose call errored ("Merge already
// in progress", a network drop) left its effect "started" and the task blocked
// for owner receipt inspection, although GitHub itself records whether the
// merge happened (ticket 1578 sat blocked for hours on an already-merged PR).
// This reads the PR and settles the effect: merged -> done with the GitHub
// receipt; still unmerged -> cleared so the task may retry; unreadable -> left
// alone. The task is then requeued with what was found. Only merge effects are
// reconciled; other uncertain effects still wait for inspection.
const MERGE_KEY = /^merge:(\d+):([0-9a-f]{7,40})$/;
const SETTLE_AFTER_MS = 2 * 60000;
const TERMINAL = ["done", "dismissed", "cancelled"];

function createEffectReconciler({ ledger, readPull, owner = "lakesidegamedev", now = () => Date.now(), log = () => {} }) {
  const d = ledger.data;
  let busy = false;
  async function tick() {
    if (busy || d.paused) return [];
    busy = true; const settled = [];
    try {
      for (const job of Object.values(d.jobs)) {
        if (TERMINAL.includes(job.state)) continue;
        for (const [key, e] of Object.entries(job.effects || {})) {
          const m = MERGE_KEY.exec(key);
          if (!m || e.state !== "started" || now() - (e.at || 0) < SETTLE_AFTER_MS) continue;
          let pr;
          try { pr = await readPull(`${owner}/${job.repository || "AHDGame"}`, Number(m[1])); } catch (err) { log(`effect reconcile ${key}: ${String(err.message).slice(0, 160)}`); continue; }
          if (!pr || Number(pr.number) !== Number(m[1])) continue;
          let note;
          if (pr.merged) {
            job.effects[key] = { state: "done", at: now(), result: { merged: true, sha: pr.merge_commit_sha, reconciled: "github", mergedAt: pr.merged_at }, error: e.error };
            note = `GitHub shows PR #${m[1]} merged at ${pr.merged_at} (${String(pr.merge_commit_sha || "").slice(0, 10)}). The earlier error was not a failed merge. Continue from the merged state; do not merge again.`;
          } else {
            delete job.effects[key];
            note = `GitHub shows PR #${m[1]} is ${pr.state} and not merged, so the earlier merge call did not land. You may retry it if it is still wanted and still authorized.`;
          }
          settled.push({ job: job.id, key, merged: Boolean(pr.merged) });
          ledger.audit("effect_reconciled", { job: job.id, key, merged: Boolean(pr.merged), source: "github" });
          (job.inbox ||= []).push({ role: "system", authorId: "effect-reconcile", at: new Date(now()).toISOString(), content: note });
          const uncertain = Object.values(job.effects || {}).some((x) => ["started", "uncertain", "executing"].includes(x?.state));
          if (job.state === "blocked" && !uncertain && /^External action needs receipt inspection/.test(job.summary || "")) { job.state = "queued"; job.wakeAt = now(); }
          log(`effect reconcile: ${job.id} ${key} -> ${pr.merged ? "merged" : "not merged"}`);
        }
      }
      if (settled.length) ledger.save();
    } finally { busy = false; }
    return settled;
  }
  return { tick };
}
module.exports = { createEffectReconciler, MERGE_KEY };
