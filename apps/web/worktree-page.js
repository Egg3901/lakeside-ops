const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_REPORT = path.join(__dirname, "data", "worktree-fleet-latest.json");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function displayRepository(repository) {
  const home = os.homedir();
  return repository.startsWith(home + path.sep) ? path.relative(home, repository) : repository;
}

function loadWorktreeReport(reportPath = DEFAULT_REPORT) {
  return JSON.parse(fs.readFileSync(reportPath, "utf8"));
}

function makeWorktreeBody(report) {
  const summary = report.after || report.before;
  const rows = report.repositories.flatMap(repo => repo.worktrees
    .filter(tree => !tree.primary && !["safe-prune", "delivered-prune", "patch-equivalent-prune", "obsolete-prune"].includes(tree.classification))
    .map(tree => ({ repository: repo.repository, ...tree })))
    .sort((a, b) => (a.classification === "dirty" ? -1 : 0) - (b.classification === "dirty" ? -1 : 0) || a.repository.localeCompare(b.repository));
  const cards = Object.entries(summary.classifications || {}).map(([name, count]) => `<div class="wt-stat"><strong>${count}</strong><span>${escapeHtml(name)}</span></div>`).join("");
  return {
    extraCss: `.wt-wrap{max-width:1200px;margin:0 auto;padding:2rem}.wt-lead{color:var(--text-3);max-width:70ch}.wt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:.75rem;margin:1.5rem 0}.wt-stat{padding:1rem;border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface);display:flex;flex-direction:column}.wt-stat strong{font-size:1.7rem}.wt-stat span{font-size:.76rem;color:var(--text-3)}.wt-table{width:100%;border-collapse:collapse;font-size:.76rem}.wt-table th,.wt-table td{text-align:left;padding:.65rem;border-bottom:1px solid var(--border);vertical-align:top}.wt-table code{font-size:.7rem}.wt-badge{display:inline-block;padding:.2rem .45rem;border-radius:999px;background:var(--amber-soft);color:var(--amber);font-weight:700}.wt-badge.dirty{background:var(--red-soft);color:var(--red)}@media(max-width:760px){.wt-wrap{padding:1rem}.wt-table th:nth-child(2),.wt-table td:nth-child(2),.wt-table th:nth-child(5),.wt-table td:nth-child(5){display:none}}`,
    body: `<main class="wt-wrap"><h1>Worktree lifecycle</h1><p class="wt-lead">Fleet-wide Git delivery state. Dirty and unlanded work is never removed automatically. Generated ${escapeHtml(report.generatedAt)}.</p><div class="wt-stats">${cards}</div><table class="wt-table"><thead><tr><th>Repository</th><th>Checkout</th><th>Branch</th><th>State</th><th>Evidence</th></tr></thead><tbody>${rows.map(row => `<tr><td><code>${escapeHtml(displayRepository(row.repository))}</code></td><td><code>${escapeHtml(row.path.replace(`${row.repository}/`, ""))}</code></td><td>${escapeHtml(row.branch || "detached")}</td><td><span class="wt-badge ${row.classification === "dirty" ? "dirty" : ""}">${escapeHtml(row.classification)}</span></td><td>${row.dirty || 0} dirty, ${row.patchUnique ?? "?"} unlanded</td></tr>`).join("")}</tbody></table></main>`,
  };
}

module.exports = { loadWorktreeReport, makeWorktreeBody };
