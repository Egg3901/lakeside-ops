"use strict";

const fs = require("fs");
const path = require("path");
const INVENTORY_SLUG = "worldsim-readiness-inventory";
const ACCEPTED_RUN = "24fa81d5-db2d-4349-8cc0-145e1e99dd73";
const ACCEPTED_SLUGS = new Set([
  "worldsim-audit-europe-control-1991-0929",
  "worldsim-audit-europe-control-1991-0929-regions",
]);
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function qualificationFromHtml(html) {
  const match = html.match(/<script id="qualification-data" type="application\/json">([\s\S]*?)<\/script>/);
  try { return match ? JSON.parse(match[1]) : null; } catch { return null; }
}
function classifyReport(slug, html) {
  const data = qualificationFromHtml(html);
  const gates = data?.national ? [data.national, data.regional] : data ? [data] : [];
  const complete = gates.length > 0 && gates.every((gate) => gate?.passing === true);
  const accepted = ACCEPTED_SLUGS.has(slug) && complete && gates.every((gate) => gate.provenance?.runId === ACCEPTED_RUN);
  return {
    slug, url: `/reports/${slug}`,
    disposition: accepted ? "accepted-scoped-telemetry" : gates.length && !complete ? "rejected-telemetry" : "unreviewed-for-readiness",
    acceptedForOverallReadiness: false,
    scope: accepted ? "Approval, observed GDP and population only (#2099/#2100)" : "Not accepted as #2159 qualification evidence",
    telemetryGatePassing: gates.length ? complete : null,
    provenance: accepted ? gates[0].provenance : null,
    reasons: [...new Set(gates.flatMap((gate) => gate?.reasons || []))],
  };
}
function annotateReport(html, row) {
  const text = row.disposition === "accepted-scoped-telemetry"
    ? "Accepted only for approval, observed GDP and population telemetry (#2099/#2100). Not an overall world or release pass."
    : "Not accepted as #2159 readiness evidence. Completed turns describe execution progress; historical subsystem findings retain their separate scope.";
  const banner = `<aside id="readiness-evidence-status" style="padding:16px;background:#172033;color:#fff;border-bottom:2px solid #d9aa44;font:14px/1.5 system-ui">${text} <a style="color:#a9d4ff" href="/reports/${INVENTORY_SLUG}">Evidence inventory and qualification scope</a></aside>`;
  const previous = /<aside id="readiness-evidence-status"[\s\S]*?<\/aside>/;
  return previous.test(html) ? html.replace(previous, banner) : html.replace(/<body\b[^>]*>/i, (body) => body + banner);
}
function atomicWrite(file, body) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, body, { mode: 0o644 });
  fs.renameSync(temporary, file);
}
/** Static published files only. No database access or simulation execution. */
function publishReadinessInventory(directory, manifest) {
  const reports = [];
  for (const entry of manifest) {
    const slug = entry.slug;
    if (!/^worldsim-[a-z0-9-]+$/.test(slug || "") || slug === INVENTORY_SLUG || slug === "worldsim-audit-program") continue;
    const file = path.join(directory, `${slug}.html`);
    if (!fs.existsSync(file)) { reports.push({ slug, disposition: "missing-artifact", acceptedForOverallReadiness: false }); continue; }
    const html = fs.readFileSync(file, "utf8");
    const row = classifyReport(slug, html);
    reports.push(row);
    atomicWrite(file, annotateReport(html, row));
  }
  const inventory = {
    schemaVersion: 1, observedAt: new Date().toISOString(),
    scope: "Published worldsim reports. Child-issue bounded replays remain separately scoped subsystem evidence and are not overall-world qualification.",
    overallReadinessAcceptedReports: 0,
    acceptanceReferences: ["https://github.com/Egg3901/AHDGame/issues/2099#issuecomment-5904994223", "https://github.com/Egg3901/AHDGame/issues/2100#issuecomment-5904997911"],
    reports,
  };
  const rows = reports.map((row) => `<tr><td><a href="/reports/${escape(row.slug)}">${escape(row.slug)}</a></td><td>${escape(row.disposition)}</td><td>${escape(row.scope || "Missing artifact")}</td></tr>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Worldsim readiness evidence inventory</title><style>body{max-width:1200px;margin:40px auto;padding:20px;font:16px/1.5 system-ui}td,th{padding:12px;text-align:left;border-bottom:1px solid #aaa}table{width:100%;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><h1>Worldsim readiness evidence inventory</h1><p>No report in this inventory is accepted as an overall world or release pass. Two pages from the retained 1991 run can qualify only for approval, observed GDP and population telemetry after their source and complete-series checks pass. Completed engine iterations are a separate progress measure.</p><p>All other historical pages are rejected or unreviewed for #2159. Their narrower subsystem findings are not erased. Source-pinned bounded child replays remain separate evidence; exact-release and full-horizon qualification remain pending.</p><p>Observed ${escape(inventory.observedAt)}. <a href="https://github.com/Egg3901/AHDGame/issues/2159">Readiness tracker</a>.</p><table><thead><tr><th>Report</th><th>Disposition</th><th>Accepted scope</th></tr></thead><tbody>${rows}</tbody></table><details><summary>Machine-readable inventory and retained provenance</summary><pre>${escape(JSON.stringify(inventory, null, 2))}</pre></details><script id="readiness-inventory" type="application/json">${JSON.stringify(inventory).replace(/</g, "\\u003c")}</script></body></html>`;
  atomicWrite(path.join(directory, `${INVENTORY_SLUG}.html`), html);
  const entry = { slug: INVENTORY_SLUG, title: "Worldsim readiness evidence inventory", summary: "Explicit accepted telemetry scope and rejected or unreviewed historical reports.", category: "World Simulations", public: true, author: "worldsim-audit", badge: "Scoped evidence", publishedAt: inventory.observedAt };
  const existing = manifest.findIndex((item) => item.slug === INVENTORY_SLUG);
  if (existing < 0) manifest.push(entry); else manifest[existing] = entry;
  return inventory;
}
module.exports = { classifyReport, annotateReport, publishReadinessInventory };
