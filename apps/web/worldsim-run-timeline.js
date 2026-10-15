"use strict";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function time(value) {
  const date = iso(value);
  return date ? `<time datetime="${date}">${date.slice(0, 16).replace("T", " ")} UTC</time>` : "Time not recorded";
}

// Project only queue metadata. Never publish raw errors, DB coordinates or worker arguments.
async function readWorldsimQueue(db) {
  return db.collection("simJobs").find({}, { projection: {
    _id: 1, seed: 1, preset: 1, status: 1, currentTurn: 1, turns: 1,
    createdAt: 1, queuedAt: 1, triggeredAt: 1, workerStartedAt: 1,
    completedAt: 1, updatedAt: 1, ownerStoppedAt: 1,
  } }).sort({ createdAt: -1 }).toArray();
}

const statusLabels = { queued: "Queued", running: "Running", completed: "Completed", failed: "Failed", stopped: "Stopped", unknown: "Status unavailable" };
function jobStatus(job) {
  if (job.ownerStoppedAt || job.status === "cancelled") return "stopped";
  if (job.status === "held-runtime-upgrade") return "queued";
  return Object.hasOwn(statusLabels, job.status) ? job.status : "unknown";
}
function statusBadge(job) {
  const status = jobStatus(job);
  return `<span class="sim-status sim-status-${status}">${statusLabels[status]}</span>`;
}
function runSlug(job) {
  const id = String(job._id);
  if (!/^[a-z0-9-]{1,66}$/.test(id)) throw new Error("Invalid worldsim run ID");
  return `worldsim-run-${id}`;
}
function reportMap(manifest) {
  return new Map(manifest.filter((item) => item.runId &&
    item.category === "World Simulations" && !item.slug?.endsWith("-regions") &&
    /^[a-z0-9-]+$/.test(item.slug || "")).map((item) => [String(item.runId), item.slug]));
}
function renderWorldsimTimeline(jobs = [], manifest = []) {
  const rows = jobs.map((job) => ({
    ...job,
    eventAt: iso(job.triggeredAt) || iso(job.queuedAt) || iso(job.createdAt),
  })).sort((a, b) => String(b.eventAt || "").localeCompare(String(a.eventAt || "")) ||
    String(a._id).localeCompare(String(b._id)));
  const rowHtml = (job) => {
    const status = jobStatus(job);
    const turn = Number(job.currentTurn);
    const progress = Number.isFinite(turn) && turn > 0
      ? `Raw turn ${turn.toLocaleString("en-US")}`
      : ["queued", "held-runtime-upgrade"].includes(job.status) ? "Not started" : "No completed turn recorded";
    const title = esc(job.seed || job.preset || "World simulation");

    const requested = Number(job.turns);
    return `<li class="sim-event" data-run-id="${esc(job._id)}"><a class="sim-card sim-card-${status}" href="/reports/${runSlug(job)}"><div class="sim-event-head"><strong>${title}</strong>${statusBadge(job)}</div><div class="sim-event-facts"><span>${esc(job.preset || "Preset not recorded")}</span><span>${progress}</span>${Number.isFinite(requested) && requested > 0 ? `<span>${requested.toLocaleString("en-US")}-turn run</span>` : ""}</div><div class="sim-event-times"><span>${job.triggeredAt ? "Triggered" : "Queued"} ${time(job.eventAt)}</span>${job.workerStartedAt ? `<span>Started ${time(job.workerStartedAt)}</span>` : ""}${job.ownerStoppedAt ? `<span>Stopped by request ${time(job.ownerStoppedAt)}</span>` : job.completedAt ? `<span>Finished ${time(job.completedAt)}</span>` : ""}</div><small class="sim-run-id">${esc(job._id)}</small><span class="sim-open">View run details →</span></a></li>`;
  };
  const running = rows.filter((job) => job.status === "running" && !job.ownerStoppedAt);
  const active = running.length ? `<div class="sim-active"><b>Running now</b>${running.map((job) => `<a href="/reports/${runSlug(job)}">${esc(job.seed || job._id)} · raw turn ${esc(job.currentTurn ?? "unknown")}</a>`).join("")}</div>` : "";
  const counts = rows.reduce((all, job) => { const status = jobStatus(job); all[status] = (all[status] || 0) + 1; return all; }, {});
  const summary = Object.entries(statusLabels).filter(([status]) => counts[status]).map(([status, label]) => `<span class="sim-status sim-status-${status}">${counts[status]} ${label.toLowerCase()}</span>`).join("");
  const remaining = rows.slice(6);
  return `<section class="sim-timeline" aria-labelledby="sim-timeline-heading"><div class="sectionhead"><h2 id="sim-timeline-heading">Worldsim timeline</h2><span>Newest queued or triggered first · ${rows.length} runs</span></div><div class="sim-status-summary">${summary}</div><p class="sim-queue-note">Queued jobs are waiting to start. New runs start from 03:00 to 08:00 America/New_York, one at a time. A running simulation continues after that window. The newest requests appear first, so recent cards can all be queued.</p>${active}<ol class="sim-events">${rows.slice(0, 6).map(rowHtml).join("") || '<li class="empty">No worldsim jobs queued yet.</li>'}</ol>${remaining.length ? `<details class="sim-more"><summary><span class="sim-show-more">Show more (${remaining.length})</span><span class="sim-show-less">Show less</span></summary><ol class="sim-events" start="7">${remaining.map(rowHtml).join("")}</ol></details>` : ""}</section>`;
}

const timelineCss = `.sim-timeline{margin:16px 0 22px}.sim-events{list-style:none;margin:0;padding:0 0 0 18px;border-left:2px solid var(--line)}.sim-event{position:relative;margin:0 0 14px}.sim-event:before{content:"";position:absolute;left:-24px;top:24px;width:8px;height:8px;border:2px solid var(--cyan);border-radius:50%;background:var(--bg)}.sim-card{display:block;padding:18px 20px;background:#182338;border:1px solid #42516b;border-left:4px solid #8192ab;border-radius:12px;color:var(--text,#edf3ff);text-decoration:none;box-shadow:0 4px 12px #0003;transition:background .15s,border-color .15s}.sim-card:hover{background:#22324c;border-color:#b9cbed}.sim-card:focus-visible{outline:3px solid #fff;outline-offset:3px}.sim-card-queued{border-left-color:#f5bd51}.sim-card-running{border-left-color:#65c9ff}.sim-card-completed{border-left-color:#70df9b}.sim-card-failed{border-left-color:#ff949b}.sim-event-head{display:flex;justify-content:space-between;gap:12px;align-items:start}.sim-event-head strong{font-size:.92rem;overflow-wrap:anywhere;min-width:0}.sim-event-facts,.sim-event-times{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:9px;color:var(--muted,#b8c5d9);font-size:.76rem}.sim-run-id{display:block;margin-top:8px;color:var(--muted,#b8c5d9);font-size:.65rem;overflow-wrap:anywhere}.sim-open{display:block;margin-top:12px;color:#9bdcff;font-size:.77rem;font-weight:700}.sim-status{display:inline-block;flex-shrink:0;border:1px solid;border-radius:999px;padding:4px 10px;font-size:.72rem;font-weight:750;white-space:nowrap}.sim-status-queued{color:#ffda82;background:#433416;border-color:#a47b2c}.sim-status-running{color:#a2e2ff;background:#123d58;border-color:#368cbb}.sim-status-completed{color:#a1efbb;background:#173e2a;border-color:#418e5b}.sim-status-failed{color:#ffb6bd;background:#501f2b;border-color:#b55d6d}.sim-status-stopped,.sim-status-unknown{color:#d7dce5;background:#333b49;border-color:#7c889b}.sim-status-summary{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.sim-queue-note{color:var(--muted,#b8c5d9);font-size:.8rem;line-height:1.6}.sim-active{display:flex;flex-wrap:wrap;gap:6px 12px;margin:14px 0;padding:12px;border:1px solid #368cbb;background:#123d5844;border-radius:8px;font-size:.8rem}.sim-active a{color:#a2e2ff;overflow-wrap:anywhere}.sim-more>summary{cursor:pointer;display:list-item;margin:14px 0 14px 20px;color:var(--cyan);font-size:.85rem;font-weight:700}.sim-show-less{display:none}.sim-more[open] .sim-show-more{display:none}.sim-more[open] .sim-show-less{display:inline}@media(max-width:480px){.sim-card{padding:14px 12px}.sim-event-head{flex-wrap:wrap}}`;

module.exports = { readWorldsimQueue, renderWorldsimTimeline, timelineCss, esc, time, jobStatus, statusBadge, runSlug, reportMap };
