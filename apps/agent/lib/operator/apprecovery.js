"use strict";
const policy = require("./ownermuse-policy");
// Administrative recovery never mints an owner origin or carries consent across
// tasks. Bind every request to its saved source and keep uncertainty held.
function recover({ ledger, config, app, agent }, input) {
  const d = ledger.data, job = d.jobs[input.taskId];
  if (!job || job.role !== "owner" || job.replyChannel !== "app" || job.source?.messageId !== input.sourceMessageId) throw new Error("Saved owner task source does not match.");
  if (!["blocked", "waiting"].includes(job.state) && !job.adminReportRecovery) throw new Error("Only stopped owner tasks can be recovered.");
  const uncertain = Object.values(job.effects || {}).some(e => ["started", "executing"].includes(e.state)) || Object.values(d.actions || {}).some(a => a.jobId === job.id && a.state === "executing");
  if (input.operation === "retry") {
    if (uncertain) throw new Error("Inspect the uncertain action outcome before recovery.");
    const origin = policy.origin(d, job);
    if (!origin.valid || origin.actorId !== config.ownerId) throw new Error("A fresh authenticated owner request is required. Administrative recovery cannot create one.");
    ledger.audit("admin_app_recovery", { job: job.id, source: input.sourceMessageId, origin: origin.digest });
    return agent.retry(job.id, String(input.note || "").slice(0, 600));
  }
  if (input.operation !== "report") throw new Error("Unknown recovery operation.");
  const artifact = d.appThread?.artifacts?.[input.artifactId];
  if (!artifact || artifact.task !== job.id || artifact.kind !== "report" || !artifact.summary || !artifact.markdown || policy.digest(artifact) !== input.artifactDigest) throw new Error("Saved report does not match this task and digest.");
  if (job.adminReportRecovery) {
    if (job.adminReportRecovery.artifactDigest !== input.artifactDigest) throw new Error("A different report was already recovered.");
    return { ...job.adminReportRecovery, duplicate: true };
  }
  // Report an existing result, without treating it as completion of unrelated
  // plan steps, executing actions, or granting a legacy task write authority.
  const text = `Recovered saved report: ${artifact.title}\n\n${artifact.summary}\n\nThe full report remains in this task's artifacts. This restores the recorded result; other unfinished steps and approvals remain separate.`;
  const messageIds = app.deliver(`recovered-report:${job.id}:${artifact.id}`, { content: text }, job);
  job.adminReportRecovery = { artifactId: artifact.id, artifactDigest: input.artifactDigest, messageIds, retainedActionHold: uncertain, at: Date.now() };
  (job.history ||= []).push({ at: new Date().toISOString(), kind: "saved_report_recovered", summary: artifact.summary, priorBlocker: job.ownerMuseBlocker || null });
  delete job.ownerMuseBlocker;
  job.summary = `${artifact.summary} ${uncertain ? "An earlier action still needs verification; no action was retried." : "Other unfinished work requires a fresh authenticated owner request."}`;
  job.updatedAt = Date.now();
  ledger.audit("admin_app_report_recovered", { job: job.id, ...job.adminReportRecovery }); ledger.save();
  return job.adminReportRecovery;
}
module.exports = { recover };
