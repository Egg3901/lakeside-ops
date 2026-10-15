"use strict";

const fs = require("fs");
const path = require("path");
const { esc, time, jobStatus, statusBadge, runSlug, reportMap, timelineCss } = require("./worldsim-run-timeline");

function renderWorldsimRun(job, manifest = []) {
  const status = jobStatus(job);
  const report = reportMap(manifest).get(String(job._id));
  const notes = {
    queued: job.status === "held-runtime-upgrade" ? "Waiting for a worker runtime upgrade before this job can start." : "Waiting to start. The worker starts new runs from 03:00 to 08:00 America/New_York, one at a time. Existing work must finish before another run starts.",
    running: "This simulation is running. It can continue after the overnight start window closes.",
    completed: "The worker completed this run. Completion alone does not establish that its telemetry or release qualification passed.",
    failed: "This run failed. It is no longer waiting in the queue.",
    stopped: job.ownerStoppedAt ? "Stopped at the owner's request to keep only one world simulation running. Retained results remain available." : "This run was stopped or cancelled. It is no longer waiting in the queue.",
    unknown: "The worker status is not available.",
  };
  const turn = Number(job.currentTurn);
  const progress = Number.isFinite(turn) && turn > 0 ? `Raw turn ${turn.toLocaleString("en-US")}` : status === "queued" ? "Not started" : "No completed turn recorded";
  const facts = [
    ["Run ID", esc(job._id)], ["Preset", esc(job.preset || "Not recorded")],
    ["Progress", progress], ["Requested turns", Number(job.turns) > 0 ? esc(job.turns) : "Not recorded"],
    ["Queued", time(job.queuedAt || job.createdAt)],
    ...(job.triggeredAt ? [["Triggered", time(job.triggeredAt)]] : []),
    ["Started", job.workerStartedAt ? time(job.workerStartedAt) : "Not started"],
    ...(job.ownerStoppedAt ? [["Stopped by request", time(job.ownerStoppedAt)]] : job.completedAt ? [["Finished", time(job.completedAt)]] : []),
    ["Worker last updated", time(job.updatedAt)],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(job.seed || "World simulation")} | Worldsim</title><style>:root{--bg:#101827;--line:#42516b;--cyan:#9bdcff;--muted:#b8c5d9}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#edf3ff;font:16px/1.6 system-ui,sans-serif}main{max-width:850px;margin:40px auto;padding:0 20px}a{color:var(--cyan)}h1{overflow-wrap:anywhere;font-size:1.6rem}article{background:#182338;border:1px solid var(--line);border-radius:12px;padding:24px;margin:20px 0}dl{display:grid;grid-template-columns:minmax(120px,1fr) 2fr;gap:12px}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}.report-link{display:inline-block;background:#123d58;padding:12px 18px;border:1px solid #368cbb;border-radius:8px}small{color:var(--muted)}@media(max-width:480px){dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:12px}article{padding:16px}}${timelineCss}</style></head><body><main><a href="/reports/worldsim-audit-program">← Worldsim timeline</a><h1>${esc(job.seed || "World simulation")}</h1>${statusBadge(job)}<p>${notes[status]}</p><article><h2>Run details</h2><dl>${facts.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("")}</dl></article>${report ? `<a class="report-link" href="/reports/${esc(report)}">Open simulation report →</a>` : "<p>No published report is attached to this run yet.</p>"}<p><small>Status pages refresh on the server every minute. Reload this page for the latest progress.</small></p></main></body></html>`;
}

// Older manifest entries omitted runId. Read the explicit report footer, never infer
// identity from a reused seed. Bound each read and keep this metadata in memory.
function reportsWithRunIds(directory, manifest) {
  return manifest.map((item) => {
    if (item.runId || item.category !== "World Simulations" ||
        !/^[a-z0-9][a-z0-9-]{1,79}$/.test(item.slug || "") ||
        item.slug.endsWith("-regions")) return item;
    let fd;
    try {
      fd = fs.openSync(path.join(directory, `${item.slug}.html`), "r");
      const chunk = Buffer.alloc(64 * 1024);
      let tail = "";
      for (let offset = 0; offset < 4 * 1024 * 1024; offset += chunk.length) {
        const size = fs.readSync(fd, chunk, 0, chunk.length, offset);
        if (!size) break;
        const text = tail + chunk.toString("utf8", 0, size);
        const match = text.match(/Run ID <code>([a-z0-9-]{1,66})<\/code>/);
        if (match) return { ...item, runId: match[1] };
        tail = text.slice(-100);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
    return item;
  });
}

// Private status pages are deliberately absent from the public report manifest.
function writeWorldsimRunPages(directory, jobs, manifest) {
  const reports = reportsWithRunIds(directory, manifest);
  let written = 0;
  for (const job of jobs) {
    const output = path.join(directory, `${runSlug(job)}.html`);
    const html = renderWorldsimRun(job, reports);
    if (fs.existsSync(output) && fs.readFileSync(output, "utf8") === html) continue;
    const temp = `${output}.${process.pid}.tmp`;
    fs.writeFileSync(temp, html, { mode: 0o644 });
    fs.renameSync(temp, output);
    written++;
  }
  return written;
}

module.exports = { renderWorldsimRun, writeWorldsimRunPages, reportsWithRunIds };
