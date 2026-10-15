"use strict";

const fs = require("fs");
const { renderWorldsimTimeline, timelineCss } = require("./worldsim-run-timeline");

const ISSUE_YIELD = [
  { id: 2080, title: "Loss-making metric hides negative-income firms", kind: "filed" },
  { id: 2081, title: "Focused sector test times out under worldsim load", kind: "filed" },
  { id: 2082, title: "Command-shortage branch breaks macro parity fixture", kind: "filed" },
  { id: 2083, title: "Pinned jobs collect from the shared runtime checkout", kind: "filed" },
  { id: 2090, title: "Founding turns advance fiscal years while the calendar is frozen", kind: "filed" },
  { id: 791, title: "Unemployment ignores measured labour demand", kind: "evidenced" },
  { id: 1975, title: "Fiscal surplus and debt sources diverge", kind: "evidenced" },
  { id: 1994, title: "Autonomous cabinet churn is excessive", kind: "evidenced" },
  { id: 1995, title: "Autonomous bills repeat enacted law levels", kind: "evidenced" },
  { id: 2054, title: "Clearing order book and ledger units diverge", kind: "evidenced" },
  { id: 2072, title: "Modern presets retain orphaned officials", kind: "evidenced" },
  { id: 2074, title: "Queue progress trails authoritative turns", kind: "evidenced" },
  { id: 2078, title: "Routine settlement triggers anomaly findings", kind: "evidenced" },
];

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const number = (value, digits = 0) => Number.isFinite(Number(value))
  ? Number(value).toLocaleString("en-US", { maximumFractionDigits: digits }) : "n/a";
const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
};

function trend(runs, key, color) {
  const values = runs.map((run) => Number(run.metrics?.[key])).filter(Number.isFinite);
  if (values.length < 2) return '<div class="empty">Awaiting comparable samples</div>';
  const low = Math.min(...values), high = Math.max(...values), span = high - low || 1;
  const points = values.map((value, index) =>
    `${(index * 100 / (values.length - 1)).toFixed(1)},${(36 - (value - low) / span * 30).toFixed(1)}`
  ).join(" ");
  return `<svg class="trend" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 6H100M0 21H100M0 36H100"/><polyline points="${points}" style="stroke:${color}"/></svg><div class="range"><span>${number(low, 2)}</span><span>${number(high, 2)}</span></div>`;
}

function calendarLabel(turn, calendar) {
  const rawTurn = Number(turn);
  if (!Number.isFinite(rawTurn) || !calendar?.startingYear) return `t${turn}`;
  const frozenTurns = Number(calendar.foundingElection?.frozenTurns || 0);
  const foundingEnd = Number(calendar.foundingElection?.rawEndTurn || 0);
  const founding = foundingEnd > 0 && rawTurn <= foundingEnd;
  const calendarTurn = Math.max(1, rawTurn - frozenTurns);
  const year = Number(calendar.startingYear) + Math.floor((calendarTurn - 1) / Number(calendar.turnsPerYear || 48));
  return `t${rawTurn} · ${year}${founding ? " · founding" : ""}`;
}

function seriesTrend(rows, key, color, unit = "ratio", calendar = null) {
  const points = (rows || []).filter((row) => Number.isFinite(Number(row[key])));
  if (points.length < 2) return '<div class="empty">No retained samples</div>';
  const values = points.map((row) => Number(row[key]));
  const low = Math.min(...values), high = Math.max(...values), span = high - low || 1;
  const polyline = values.map((value, index) =>
    `${(index * 100 / (values.length - 1)).toFixed(1)},${(36 - (value - low) / span * 30).toFixed(1)}`
  ).join(" ");
  const scale = unit === "ratio" ? 100 : 1;
  const suffix = unit === "ratio" || unit === "percent" ? "%" : "";
  const startTurn = Number(points[0].turn), endTurn = Number(points.at(-1).turn);
  const foundingEnd = Number(calendar?.foundingElection?.rawEndTurn || 0);
  const foundingWidth = foundingEnd >= startTurn && foundingEnd <= endTurn
    ? Math.max(0, Math.min(100, (foundingEnd - startTurn) / Math.max(1, endTurn - startTurn) * 100)) : 0;
  const foundingBand = foundingWidth > 0
    ? `<rect x="0" y="0" width="${foundingWidth.toFixed(2)}" height="40" fill="#ac8cff" opacity=".12"/><path d="M${foundingWidth.toFixed(2)} 0V40" stroke="#ac8cff" stroke-width=".7" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>` : "";
  const foundingNote = foundingWidth > 0 ? '<div class="founding-key"><i></i>Founding elections: year frozen</div>' : "";
  return `<svg class="trend" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">${foundingBand}<path d="M0 6H100M0 21H100M0 36H100"/><polyline points="${polyline}" style="stroke:${color}"/></svg><div class="range"><span>${calendarLabel(startTurn, calendar)} · ${number(low * scale,2)}${suffix}</span><span>${calendarLabel(endTurn, calendar)} · ${number(high * scale,2)}${suffix}</span></div>${foundingNote}`;
}

function coverageChips(map) {
  return Object.entries(map || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => `<span class="chip">${esc(key)} ${number(count)}</span>`).join("") || '<span class="chip">none</span>';
}

function metricCell(summary) {
  if (!summary || summary.status === "unavailable" || !summary.n) return '<span class="muted">unavailable</span>';
  return `${number(summary.median, 1)} <span class="sample">n=${summary.n}</span>`;
}

function cohortTable(cohorts) {
  const rows = (cohorts || []).filter((row) => row.grain === "era-mode-turn" || row.grain === "full");
  const visible = rows.length ? rows : (cohorts || []).filter((row) => row.grain === "turn");
  if (!visible.length) {
    return '<div class="empty">No SP cohort reaches k=5. Coverage counts still reflect accepted reports. These are not per-world trajectories.</div>';
  }
  const body = visible.map((row) => `<tr><td>${esc(row.grain)}</td><td>${esc(row.key.era || "all")}</td><td>${esc(row.key.mode || "all")}</td><td>${esc(row.key.turnBucket || "all")}</td><td>${esc(row.key.autonomy || "—")}</td><td>${number(row.sampleCount)}</td><td>${metricCell(row.metrics?.nppCount)}</td><td>${metricCell(row.metrics?.marketFillRatePercent)}</td><td>${metricCell(row.metrics?.gdpGrowthPercent)}</td><td>${metricCell(row.metrics?.governmentApprovalPercent)}</td></tr>`).join("");
  return `<div class="tablewrap"><table class="dense"><thead><tr><th>grain</th><th>era</th><th>mode</th><th>turns</th><th>autonomy</th><th>n</th><th>NPP</th><th>fill</th><th>GDP g</th><th>approval</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function spMetricChart(cohorts, metric, color, acceptedReports) {
  const rows = (cohorts || []).filter((row) => row.grain === "turn" && row.metrics?.[metric]?.n);
  if (!rows.length) {
    return `<div class="empty">Older clients did not emit this metric · n=0 of ${number(acceptedReports)}</div>`;
  }
  const values = rows.map((row) => Number(row.metrics[metric].median));
  const low = Math.min(...values), high = Math.max(...values), span = high - low || 1;
  const polyline = values.map((value, index) =>
    `${(index * 100 / Math.max(values.length - 1, 1)).toFixed(1)},${(36 - (value - low) / span * 30).toFixed(1)}`
  ).join(" ");
  const n = rows.reduce((sum, row) => sum + row.metrics[metric].n, 0);
  return `<svg class="trend" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 6H100M0 21H100M0 36H100"/><polyline points="${polyline}" style="stroke:${color}"/></svg><div class="range"><span>${esc(rows[0].key.turnBucket)} · ${number(low, 2)}</span><span>n=${number(n)} · ${esc(rows.at(-1).key.turnBucket)} · ${number(high, 2)}</span></div>`;
}

function legislatureTable(legislatures) {
  if (!legislatures?.length) return '<div class="empty">No national legislature aggregate retained</div>';
  const rows = legislatures.map((row) => {
    const parties = (row.parties || []).map((party) =>
      `${esc(party.abbreviation || party.name || party.partyId)} ${number(party.seats)}`
    ).join(" · ") || "unavailable";
    return `<tr><td>${esc(row.countryId)}</td><td>${esc(row.officeType || "unmapped")}</td><td>${number(row.totalSeats)}</td><td>${parties}</td></tr>`;
  }).join("");
  return `<div class="tablewrap" title="Seats by party show who controls each player country's national legislature and whether coalition arithmetic is plausible."><table class="dense legislature"><thead><tr><th>country</th><th>national chamber</th><th>seats</th><th>party distribution</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function politicalObservationTable(observations) {
  const rows = (observations || []).slice(-12).reverse();
  if (!rows.length) return '<div class="empty">Political retention begins with the next multiplayer collection</div>';
  const body = rows.map((row) => {
    const control = (row.legislatures || []).map((legislature) => {
      const leader = legislature.parties?.[0];
      return `${legislature.countryId}: ${leader ? `${leader.abbreviation || leader.name} ${number(leader.seats)}/${number(legislature.totalSeats)}` : "unavailable"}`;
    }).join(" · ");
    return `<tr><td>${esc(row.iteration)}</td><td>${number(row.turn)}</td><td>${number(row.year)}</td><td>${number(row.governmentApproval, 2)}%</td><td>${number(row.activeElections)}</td><td>${number(row.recentGovernmentFormations)}</td><td>${control || "unavailable"}</td></tr>`;
  }).join("");
  return `<div class="tablewrap" title="Compact retained observations make future multiplayer iterations comparable by turn, year, approval, election load, government formation, and legislative control."><table class="dense political-history"><thead><tr><th>iteration</th><th>turn</th><th>year</th><th>approval</th><th>active elections</th><th>formations</th><th>legislative control</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function buildWorldsimDashboard({ manifest, statuses = {}, artifacts = {}, jobs = [] }) {
  const runs = manifest.filter((item) => item.category === "World Simulations" && item.slug !== "worldsim-audit-program")
    .sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
  const live = artifacts.live || readJson("/var/lib/lakeside-worldsim/live-iterations.json", { snapshots: [], status: "not-collected" });
  const singleplayer = artifacts.singleplayer || readJson("/var/lib/lakeside-worldsim/singleplayer-telemetry.json", { snapshots: [], status: "not-connected" });
  const issueSnapshot = readJson("/var/lib/lakeside-worldsim/issues.json", { issues: ISSUE_YIELD });
  const issueItems = Array.isArray(issueSnapshot.issues) && issueSnapshot.issues.length
    ? issueSnapshot.issues : ISSUE_YIELD;
  const filed = issueItems.filter((issue) => issue.kind === "filed").length;
  const evidenced = issueItems.filter((issue) => issue.kind === "evidenced").length;
  const totalTurns = runs.reduce((total, run) => total + (Number(run.turn) || 0), 0);
  const multiplayer = live.snapshots?.[0];
  const mpSeries = multiplayer?.series || [];
  const macro = multiplayer?.macroSeries || {};
  const mpHeadline = multiplayer?.headline || {};
  const calendar = multiplayer?.calendar || null;
  const mpObservations = live.observations || [];
  const legislatures = multiplayer?.politics?.legislatures || [];
  const sources = [
    ["Sandbox worldsim", runs.length, "full provenance", "isolated"],
    ["Multiplayer observations", mpObservations.length, live.status === "ok" ? "legacy provenance is partial" : "collector pending", "sanitized"],
    ["Single-player cohorts", singleplayer.acceptedReports || 0, singleplayer.status === "ok" ? "anonymous k-anonymous aggregates" : "adapter pending", "opt-in only"],
  ].map(([label, count, provenance, privacy]) => `<div class="source" tabindex="0" title="Source coverage matters because comparisons are only defensible when origin, isolation, and retention are known."><b>${label}</b><strong>${count}</strong><span>${provenance} · ${privacy}</span></div>`).join("");
  const timeline = renderWorldsimTimeline(jobs, manifest);
  const issues = issueItems.map((issue) => `<a class="issue" href="${esc(issue.url || `https://github.com/lakesidegamedev/AHDGame/issues/${issue.id}`)}" rel="noopener"><b>#${issue.id}</b><span>${esc(issue.title)}</span><em>${issue.kind === "filed" ? "filed by audit" : "new evidence"}${issue.state ? ` · ${esc(issue.state)}` : ""}</em></a>`).join("");
  const kpis = [
    [runs.length, "published runs", "Publicly inspectable simulation runs provide reproducible evidence."],
    [statuses.running || 0, "running now", "Concurrent active runs show current use of simulation capacity."],
    [statuses["held-runtime-upgrade"] || 0, "held for runtime", "Held jobs are waiting for their pinned runtime so results remain attributable."],
    [statuses.completed || 0, "queue completed", "Completed jobs define the available comparison base."],
    [number(totalTurns), "retained raw turns", "Retained turns determine the time horizon available for detecting drift and cycles."],
    [filed, "issues filed", "New issues measure defects first identified by the audit."],
    [evidenced, "issues evidenced", "Evidenced issues are existing defects strengthened with new reproducible runs."],
    [mpObservations.length, "MP observations", "Compact multiplayer observations provide a retained, separate real-world comparison source."],
  ].map(([value, label, why]) => `<div class="kpi" tabindex="0" title="${esc(why)}"><b>${value}</b><span>${label}</span></div>`).join("");
  const now = new Date().toISOString();
  const provenance = multiplayer ? `<div class="provenance"><b>${esc(multiplayer.iteration)}</b><span>Turns ${esc(multiplayer.turnStart)} to ${esc(multiplayer.turnEnd)} · captured ${esc(String(multiplayer.capturedAt).slice(0,16).replace("T"," "))} UTC</span><span>Provenance: ${esc(multiplayer.provenance?.completeness)} · revision ${esc(multiplayer.provenance?.codeRevision || "not retained by this legacy iteration")} · ${esc(mpSeries.length)} bounded metric samples · ${esc(mpObservations.length)} compact political observations</span></div>` : '<div class="provenance"><b>Multiplayer unavailable</b><span>No sanitized iteration snapshot has been collected.</span></div>';
  const politicalKpis = [
    [mpHeadline.playerEnabledCountries, "player countries", "The default comparison scope is countries currently enabled for players."],
    [mpHeadline.activeElections, "active elections", "Active contests show immediate political-system load and participation opportunities."],
    [mpHeadline.totalElections, "elections retained", "Retained elections define the evidence available for cycle and outcome analysis."],
    [mpHeadline.recentGovernmentFormations, "recent formations", "Government formations reveal coalition churn and executive stability."],
    [mpHeadline.latestLegislativeSeatsObserved, "seats observed", "Observed seats measure whether legislative coverage is complete enough for political comparisons."],
  ].map(([value, label, why]) => `<div class="kpi" tabindex="0" title="${esc(why)}"><b>${number(value)}</b><span>${label}</span></div>`).join("");
  const spReady = singleplayer.status === "ok";
  const spState = spReady
    ? `${number(singleplayer.acceptedReports)} accepted reports · ${number(singleplayer.visibleCohorts)} visible cohorts · ${number(singleplayer.suppressedCohorts)} suppressed (k=5)`
    : "No sanitized SP cohort snapshot yet. Local saves are never read or inferred.";
  const spUnavailable = (singleplayer.unavailableFromLegacy || []).join(", ") || "none listed";
  const compactCss = `.kpis,.sources{gap:0!important;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#0a1829}.kpi,.source{border:0!important;border-right:1px solid var(--line)!important;border-radius:0!important;background:transparent!important;padding:6px 8px!important}.kpi:last-child,.source:last-child{border-right:0!important}.kpi b{font-size:1rem!important;line-height:1.15}.kpi span,.source span{font-size:.62rem!important}.source{grid-template-columns:1fr auto!important}.source strong{font-size:.9rem!important}.tablewrap{overflow-x:auto;margin-top:6px}.dense{width:100%;border-collapse:collapse;font-size:.7rem}.dense th,.dense td{padding:3px 6px;border-bottom:1px solid var(--line);white-space:nowrap;text-align:right}.dense th:first-child,.dense td:first-child,.dense th:nth-child(-n+5),.dense td:nth-child(-n+5){text-align:left}.sample,.muted{color:var(--muted);font-size:.62rem}.chips{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 8px}.chip{border:1px solid var(--line);border-radius:99px;padding:.05rem .4rem;color:var(--muted);font-size:.62rem}`;
  return { runs, filed, html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><title>A House Divided world and iteration audit</title><style>${compactCss}
:root{color-scheme:dark;--bg:#07111f;--panel:#0e1c2f;--line:#20334b;--muted:#93a4b8;--text:#eef6ff;--cyan:#39d4d8;--gold:#f6c85f}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 78% -10%,#173954 0,transparent 40%),var(--bg);color:var(--text);font:14px/1.4 Inter,system-ui,sans-serif}body>main{max-width:1320px;margin:auto;padding:22px 16px 56px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:var(--cyan);font-size:.68rem;font-weight:800}h1{font-size:clamp(1.8rem,4vw,3rem);line-height:1;margin:.2rem 0 .45rem}.lede{max-width:900px;color:var(--muted);margin:.2rem 0 1rem}.kpis,.sources,.charts,.runs{display:grid;gap:8px}.kpis{grid-template-columns:repeat(8,minmax(0,1fr))}.kpi,.source,.panel,.run,.provenance{background:linear-gradient(155deg,#12273e,#0a1829);border:1px solid var(--line);border-radius:9px}.kpi{padding:9px}.kpi b{display:block;font-size:1.25rem}.kpi span,.source span{color:var(--muted);font-size:.68rem}.sources{grid-template-columns:repeat(3,1fr);margin-top:8px}.source{padding:9px;display:grid;grid-template-columns:1fr auto;gap:2px 8px}.source strong{font-size:1.15rem}.source span{grid-column:1/-1}.charts{grid-template-columns:repeat(4,1fr);margin-top:8px}.panel{padding:10px;min-width:0}.panel h2{font-size:.82rem;margin:0 0 5px}.trend{width:100%;height:82px;background:#091625;border-radius:6px}.trend path{stroke:#20334b;stroke-width:.35}.trend polyline{fill:none;stroke-width:2;vector-effect:non-scaling-stroke}.range,.facts{display:flex;justify-content:space-between;color:var(--muted);font-size:.64rem}.provenance{display:flex;gap:8px;flex-wrap:wrap;padding:8px 10px;margin-top:8px}.provenance span{color:var(--muted);font-size:.7rem}.sectionhead{display:flex;justify-content:space-between;align-items:end;margin:18px 0 7px}.sectionhead h2{margin:0;font-size:1rem}.sectionhead span{color:var(--muted);font-size:.72rem}.runs{grid-template-columns:repeat(4,minmax(0,1fr))}.run{display:block;color:inherit;text-decoration:none;padding:10px;min-width:0}.run:hover{border-color:var(--cyan)}.runhead{display:flex;justify-content:space-between;gap:6px}.runhead strong{color:var(--muted);font-size:.68rem}.run h3{font-size:.82rem;margin:.45rem 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar{height:5px;background:#091625;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--cyan),var(--gold))}.badge{border:1px solid #34747a;color:#78edf0;border-radius:99px;padding:.1rem .4rem;font-size:.62rem;font-weight:800}.issues{display:grid;grid-template-columns:repeat(2,1fr);gap:5px}.issue{display:grid;grid-template-columns:46px 1fr auto;gap:7px;color:inherit;text-decoration:none;padding:7px;background:#091625;border-radius:6px}.issue b{color:var(--cyan)}.issue em{font-style:normal;color:var(--muted);font-size:.65rem}.note{margin-top:12px;border-left:3px solid var(--cyan);background:#0d1b2d;padding:9px 12px;color:#b8c7d7}.empty{display:grid;place-items:center;height:82px;color:var(--muted);font-size:.7rem}.tablewrap{overflow:auto;margin-top:8px}table{width:100%;border-collapse:collapse;font-size:.72rem}th,td{padding:4px 6px;border-bottom:1px solid var(--line);white-space:nowrap;text-align:left}th{color:var(--muted);font-weight:600}footer{margin-top:16px;color:var(--muted);font-size:.72rem}@media(max-width:950px){.kpis{grid-template-columns:repeat(4,1fr)}.charts,.runs{grid-template-columns:repeat(2,1fr)}}@media(max-width:620px){body>main{padding:16px 9px 44px}.kpis{grid-template-columns:repeat(2,1fr)}.sources,.charts,.runs,.issues{grid-template-columns:1fr}.issue{grid-template-columns:42px 1fr}.issue em{grid-column:2}.sectionhead{align-items:start;flex-direction:column}}
 .founding-key{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:.62rem;margin-top:3px}.founding-key i{width:9px;height:9px;background:#ac8cff33;border-left:1px dashed #ac8cff}.kpi[title],.source[title],.panel[title]{cursor:help}
${timelineCss}</style></head><body><main><div class="eyebrow">A House Divided · Comparable simulation evidence</div><h1>World and iteration audit</h1><p class="lede">A compact, sanitized view of reproducible sandbox runs and retained iteration aggregates. Missing provenance is shown as missing, never inferred.</p>${timeline}<section class="kpis">${kpis}</section><section class="sources">${sources}</section><div class="sectionhead"><h2>Multiplayer economy and politics</h2><span>Read-only, precomputed aggregates from the live world. Never queried by the browser.</span></div>${provenance}<section class="kpis">${politicalKpis}</section><section class="charts"><article class="panel" title="Annual GDP growth shows whether real economic output is expanding or contracting."><h2>GDP growth</h2>${seriesTrend(macro.gdpGrowth,"value","#f6c85f","percent",calendar)}</article><article class="panel" title="Population growth changes labour supply, demand, and the fiscal base."><h2>Population growth</h2>${seriesTrend(macro.populationGrowth,"value","#55d68b","percent",calendar)}</article><article class="panel" title="Approval tracks government legitimacy and near-term electoral pressure."><h2>Government approval</h2>${seriesTrend(macro.governmentApproval,"value","#39d4d8","percent",calendar)}</article><article class="panel" title="Election and formation counts show political activity, institutional load, and government stability."><h2>Political outcomes</h2><div class="empty">${number(mpHeadline.activeElections)} active elections · ${number(mpHeadline.recentGovernmentFormations)} recent formations · ${number(mpHeadline.latestLegislativeSeatsObserved)} seats in latest retained snapshot</div></article></section><div class="sectionhead"><h2>Multiplayer macro rates</h2><span>Population-weighted across current player-enabled countries; retained source histories are backfilled when available.</span></div><section class="charts"><article class="panel" title="Real GDP growth subtracts inflation from nominal growth to approximate expansion in actual output."><h2>Real GDP growth</h2>${seriesTrend(macro.realGrowth,"value","#55d68b","percent",calendar)}</article><article class="panel" title="Nominal GDP growth combines changes in output and prices."><h2>Nominal GDP growth</h2>${seriesTrend(macro.nominalGrowth,"value","#f6c85f","percent",calendar)}</article><article class="panel" title="Inflation measures annual price growth and separates price expansion from real expansion."><h2>Inflation</h2>${seriesTrend(macro.inflation,"value","#ff7185","percent",calendar)}</article><article class="panel" title="The policy rate shows the monetary stance applied by player-country central banks."><h2>Policy rate</h2>${seriesTrend(macro.policyRate,"value","#39d4d8","percent",calendar)}</article></section><div class="sectionhead"><h2>Player-country political control</h2><span>Current national chamber totals plus compact turn-level retention for future comparisons.</span></div>${legislatureTable(legislatures)}${politicalObservationTable(mpObservations)}<div class="sectionhead"><h2>Mechanical diagnostics</h2><span>Supporting signals, not the dashboard's primary frame.</span></div><section class="charts"><article class="panel" title="Market fill is the share of aggregate demand that receives supply."><h2>Market fill</h2>${seriesTrend(mpSeries,"pooledFillRate","#39d4d8","ratio",calendar)}</article><article class="panel" title="Sell-through is the share of produced goods that find buyers."><h2>Physical sell-through</h2>${seriesTrend(mpSeries,"physicalSellThrough","#55d68b","ratio",calendar)}</article><article class="panel" title="Staffing measures how much desired labour firms can actually hire."><h2>Labour staffing</h2>${seriesTrend(mpSeries,"labourStaffingRate","#ac8cff","ratio",calendar)}</article><article class="panel" title="The loss-making share is an early warning for insolvency and economic contraction."><h2>Loss-making firms</h2>${seriesTrend(mpSeries,"lossMakingShare","#ff7185","ratio",calendar)}</article></section><div class="sectionhead"><h2>Sandbox comparison</h2><span>Latest retained snapshot from each published run.</span></div><section class="charts"><article class="panel"><h2>Market fill across runs</h2>${trend(runs,"pooled","#39d4d8")}</article><article class="panel"><h2>Physical sell-through</h2>${trend(runs,"sellThrough","#55d68b")}</article><article class="panel"><h2>Loss-making firms</h2>${trend(runs,"lossMaking","#ff7185")}</article><article class="panel"><h2>Warnings per snapshot</h2>${trend(runs,"warnings","#f6c85f")}</article></section><div class="sectionhead"><h2>Single-player cohorts</h2><span>${esc(spState)}</span></div><div class="note">Anonymous opt-in aggregates, not reproducible worlds. No device, account, save, or per-world trajectory is retained. SP lines are never mixed with multiplayer iterations or sandbox simulations. k=5 suppression is in force. Legacy uploads omit GDP, population, inflation, unemployment, approval, and political outcomes.</div><div class="chips">${coverageChips(singleplayer.coverage?.eras)} ${coverageChips(singleplayer.coverage?.modes)}</div>${cohortTable(singleplayer.cohorts)}<section class="charts"><article class="panel" title="SP GDP growth is a k-anonymous cohort median, not a world trajectory."><h2>SP GDP growth</h2>${spMetricChart(singleplayer.cohorts,"gdpGrowthPercent","#f6c85f",singleplayer.acceptedReports)}</article><article class="panel" title="SP population growth is unavailable from current legacy uploads."><h2>SP population growth</h2>${spMetricChart(singleplayer.cohorts,"populationGrowthPercent","#55d68b",singleplayer.acceptedReports)}</article><article class="panel"><h2>SP approval / stability</h2>${spMetricChart(singleplayer.cohorts,"governmentApprovalPercent","#39d4d8",singleplayer.acceptedReports)}</article><article class="panel"><h2>SP political outcomes</h2>${spMetricChart(singleplayer.cohorts,"electionCountActive","#ac8cff",singleplayer.acceptedReports)}</article></section><section class="charts"><article class="panel"><h2>SP NPP count</h2>${spMetricChart(singleplayer.cohorts,"nppCount","#39d4d8",singleplayer.acceptedReports)}</article><article class="panel"><h2>SP market fill</h2>${spMetricChart(singleplayer.cohorts,"marketFillRatePercent","#55d68b",singleplayer.acceptedReports)}</article><article class="panel"><h2>SP loss-making firms</h2>${spMetricChart(singleplayer.cohorts,"corporateLossMakingSharePercent","#ff7185",singleplayer.acceptedReports)}</article><article class="panel"><h2>SP turn duration</h2>${spMetricChart(singleplayer.cohorts,"lastTurnDurationMs","#f6c85f",singleplayer.acceptedReports)}</article></section><div class="note">Legacy unavailable metrics: ${esc(spUnavailable)}. Completeness is per-metric; a missing field is not a zero.</div><div class="sectionhead"><h2>Issue yield</h2><span>${filed} newly filed · ${evidenced} existing issues strengthened</span></div><section class="issues">${issues}</section><div class="note">Source classes are never silently mixed. Sandbox, multiplayer, and opt-in single-player series retain separate provenance and completeness labels. Public output contains aggregates only, with no player identities, messages, raw logs, or database coordinates.</div><footer>Generated ${esc(now)} · 48 processed turns represent one game year · schema world-audit/v1</footer></main></body></html>` };
}

module.exports = { buildWorldsimDashboard, ISSUE_YIELD };
