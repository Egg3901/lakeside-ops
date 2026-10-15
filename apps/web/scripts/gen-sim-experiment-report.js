#!/usr/bin/env node
/**
 * Generator for the "NPP Sim Experiment Audit" report page.
 *
 * Reads a headless-sim run's `simExperimentReports` doc from the ops
 * control-plane DB, resolves party names (via the doc's `parties` directory),
 * reshapes the timelines into Chart.js-ready series, and writes a
 * SELF-CONTAINED static HTML page to reports/sim-experiment-audit.html (data
 * embedded as JSON — no live DB call at render time). Re-run for a new run:
 *
 *   node scripts/gen-sim-experiment-report.js [runId]
 *
 * Env (from /root/misc/ahd-sim-sandbox/worker.env): OPS_MONGODB_URI, OPS_DB_NAME.
 */

const fs = require("fs");
const path = require("path");
const { summarizeLongHorizonTelemetry } = require("./lib/long-horizon-report");

const RUN_ID = process.argv[2] || "trial250-1782932436936";
// Optional 2nd arg = output slug (writes reports/<slug>.html). Defaults to the
// canonical "latest" page. Lets one run write a per-run page (e.g.
// sim-experiment-cp1000) while a final run can also refresh the canonical one.
const OUT_SLUG = (process.argv[3] || "sim-experiment-audit").replace(/[^a-z0-9-]/gi, "");
const OUT_PATH = path.join(__dirname, "..", "reports", `${OUT_SLUG}.html`);
// When true (final run), ALSO overwrite the canonical latest page.
const ALSO_LATEST = process.argv.includes("--latest");
const MAX_POINTS = 60; // per series
const COUNTRY_NAMES = {
  US: "United States", UK: "United Kingdom", DE: "Germany", JP: "Japan",
  CN: "China", BR: "Brazil", NG: "Nigeria", IE: "Ireland",
};
const COUNTRY_COLORS = {
  US: "#5865F2", UK: "#dc2626", DE: "#ffce42", JP: "#22c55e", CN: "#ea580c",
  BR: "#16a34a", NG: "#a855f7", IE: "#38bdf8",
};
const PARTY_COLORS = ["#5865F2", "#dc2626", "#ffce42", "#22c55e", "#ea580c", "#a855f7", "#38bdf8", "#f472b6", "#94a3b8", "#facc15"];
const OFFICE_LABELS = {
  president: "President", primeMinister: "PM", vicePresident: "VP", governor: "Governor",
  senate: "Senate", house: "House", commons: "Commons", lords: "Lords",
  stateSenate: "State Senate", regionalCouncil: "Regional Council",
  shugiin: "House of Reps", sangiin: "House of Councillors", dail: "Dáil", seanad: "Seanad",
  bundestag: "Bundestag", bundesrat: "Bundesrat", ministerPresident: "Minister-Pres.",
  chamber: "Chamber of Deputies", peoplesCongress: "NPC", npcDelegate: "NPC Delegates", cppcc: "CPPCC",
  landtag: "Landtag",
};

// The chambers/offices to surface per country for the "who governs" strips, in
// display order. Curated to the meaningful NATIONAL bodies + the governors/
// state-executive aggregate — deliberately EXCLUDING the huge sub-national
// legislatures (US stateSenate, DE landtag, JP regionalCouncil, CN cppcc/
// npcDelegate) that a raw max-seats pick would wrongly surface. [officeType, label].
const COUNTRY_CHAMBERS = {
  US: [["president", "President"], ["house", "House"], ["senate", "Senate"], ["governor", "Governors"]],
  UK: [["commons", "House of Commons"], ["lords", "House of Lords"]],
  DE: [["bundestag", "Bundestag"], ["bundesrat", "Bundesrat"], ["ministerPresident", "Minister-Presidents"]],
  JP: [["shugiin", "House of Representatives"], ["sangiin", "House of Councillors"]],
  IE: [["dail", "Dáil Éireann"], ["seanad", "Seanad Éireann"]],
  BR: [["president", "President"], ["chamber", "Chamber of Deputies"], ["senate", "Federal Senate"]],
  NG: [["president", "President"], ["house", "House of Reps"], ["senate", "Senate"]],
  CN: [["peoplesCongress", "National People's Congress"]],
};
// The single office whose turnover defines "the government" of each country
// (for the headline turnover count) — the executive in presidential systems,
// the lower house in parliamentary ones.
const PRIMARY_CHAMBER = {
  US: "president", UK: "commons", DE: "bundestag", JP: "shugiin",
  IE: "dail", BR: "president", NG: "president", CN: "peoplesCongress",
};
const GOV_COUNTRY_ORDER = ["US", "UK", "DE", "JP", "CN", "BR", "NG", "IE"];

function downsample(arr, max) {
  if (arr.length <= max) return arr.slice();
  const step = (arr.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

function fmtMoney(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return "₳" + (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "₳" + (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return "₳" + (n / 1e3).toFixed(0) + "K";
  return "₳" + Math.round(n);
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function pct(x) { return (x * 100).toFixed(1) + "%"; }

async function main() {
  require("dotenv").config({ path: "/root/misc/ahd-sim-sandbox/worker.env" });
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(process.env.OPS_MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.OPS_DB_NAME || "a-house-divided");
  const doc = await db.collection("simExperimentReports").findOne({ _id: RUN_ID });
  const job = await db.collection("simJobs").findOne({ _id: RUN_ID }, { projection: {
    status: 1, sourceCommit: 1, turns: 1, experimentsReportRecovery: 1,
  } });
  await client.close();
  if (!doc) throw new Error(`No simExperimentReports doc for runId "${RUN_ID}"`);

  const fm = doc.finalMetrics || {};
  const seats = doc.seatsTimeline || [];
  const org = doc.partyOrgTimeline || [];
  const corps = doc.corporationsTimeline || [];
  const parties = doc.parties || [];
  const govTimeline = doc.governmentTimeline || [];
  const wealthLeaders = doc.wealthLeaders || [];
  const topCorps = doc.topCorporations || [];
  const config = doc.runConfig || {};
  const source = config.source || {};
  const point = doc.longHorizonTelemetry?.approval?.points?.[0];
  const longHorizon = summarizeLongHorizonTelemetry(doc.longHorizonTelemetry, {
    runId: config.jobId, sourceCommit: source.executedCommit, requestedCommit: source.requestedCommit,
    collectorCommit: source.collectorCommit, collectorDirty: config.gitDirty,
    collectorRecoveryVerified: source.collectionMode === "recovery" &&
      source.recoveredFromSimulationCommit === source.executedCommit && config.gitDirty === false &&
      job?.experimentsReportRecovery?.simulationCommit === source.executedCommit &&
      job?.experimentsReportRecovery?.collectorCommit === source.collectorCommit,
    status: job?.status, jobSourceCommit: job?.sourceCommit,
    seed: config.seed, effectiveManifest: config.effectiveConfigInitial,
    actorConfiguration: point?.actorConfiguration, actorCoverage: doc.actorCoverage,
    turnRange: {
      from: Number.isInteger(config.effectiveConfigInitial?.capturedAtTurn) ? config.effectiveConfigInitial.capturedAtTurn + 1 : null,
      to: Number.isInteger(config.effectiveConfigInitial?.capturedAtTurn) && Number.isInteger(job?.turns) ? config.effectiveConfigInitial.capturedAtTurn + job.turns : null,
    }, terminalTurn: doc.turn,
    measurementIssues: doc.measurementIssues || [],
  });

  // ── Party-name directory: `${cid}:${pid}` → {name, abbr, color} ──
  const partyMap = new Map();
  for (const p of parties) partyMap.set(`${p.countryId}:${p.partyId}`, p);
  const partyName = (cid, pid) => {
    if (pid === "independent") return "Independents";
    const p = partyMap.get(`${cid}:${pid}`);
    return p ? p.name : `Party ${pid}`;
  };
  const partyAbbr = (cid, pid) => {
    if (pid === "independent") return "IND";
    const p = partyMap.get(`${cid}:${pid}`);
    return p ? p.abbreviation : pid;
  };
  const partyColor = (cid, pid, fallbackIdx) => {
    const p = partyMap.get(`${cid}:${pid}`);
    if (p && p.color) return p.color;
    if (pid === "independent") return "#94a3b8";
    return PARTY_COLORS[(fallbackIdx || 0) % PARTY_COLORS.length];
  };

  const allTurns = [...new Set(corps.map((c) => c.turn))].sort((a, b) => a - b);
  const turnLo = allTurns[0];
  const turnHi = allTurns[allTurns.length - 1];

  // ── §Government control: one strip per meaningful chamber, grouped by country ──
  const govGroups = [];
  for (const cid of GOV_COUNTRY_ORDER) {
    const chambers = COUNTRY_CHAMBERS[cid];
    if (!chambers) continue;
    const strips = [];
    for (const [oType, label] of chambers) {
      const pts = govTimeline.filter((g) => g.countryId === cid && g.officeType === oType).sort((a, b) => a.turn - b.turn);
      if (pts.length === 0) continue;
      const ds = downsample(pts, MAX_POINTS);
      const segments = ds.map((g) => ({
        turn: g.turn,
        name: partyName(cid, g.governingParty),
        color: partyColor(cid, g.governingParty),
        share: g.totalSeats > 0 ? g.seats / g.totalSeats : 0,
      }));
      // Full-resolution turnover accounting (not downsampled).
      let changes = 0;
      for (let i = 1; i < pts.length; i++) if (pts[i].governingParty !== pts[i - 1].governingParty) changes++;
      const last = pts[pts.length - 1];
      strips.push({
        oType, label, segments, changes,
        endName: partyName(cid, last.governingParty),
        endColor: partyColor(cid, last.governingParty),
        endSeats: last.seats, endTotal: last.totalSeats,
        endShare: last.totalSeats > 0 ? last.seats / last.totalSeats : 0,
        singleSeat: last.totalSeats <= 1, // president/executive — "share" is trivially 100%
      });
    }
    if (strips.length === 0) continue;
    const primary = strips.find((s) => s.oType === PRIMARY_CHAMBER[cid]) || strips[0];
    govGroups.push({ cid, name: COUNTRY_NAMES[cid] || cid, strips, primaryChanges: primary.changes, primaryLabel: primary.label });
  }

  // ── §Corporations by country: count + market cap series ──
  const corpCountries = [...new Set(corps.map((c) => c.countryId))].sort();
  const corpTurns = downsample(allTurns, MAX_POINTS);
  const corpCountSeries = [];
  const corpMcapSeries = [];
  for (const cid of corpCountries) {
    const byTurn = new Map(corps.filter((c) => c.countryId === cid).map((c) => [c.turn, c]));
    const color = COUNTRY_COLORS[cid] || "#94a3b8";
    corpCountSeries.push({
      label: cid, borderColor: color, backgroundColor: color + "22", tension: 0.25, pointRadius: 0, borderWidth: 2,
      data: corpTurns.map((t) => (byTurn.has(t) ? byTurn.get(t).corpCount : null)),
    });
    corpMcapSeries.push({
      label: cid, borderColor: color, backgroundColor: color + "22", tension: 0.25, pointRadius: 0, borderWidth: 2,
      data: corpTurns.map((t) => (byTurn.has(t) ? Math.round(byTurn.get(t).totalMarketCapAnchor) : null)),
    });
  }
  const finalCorpRows = corpCountries
    .map((cid) => {
      const last = corps.filter((c) => c.countryId === cid).sort((a, b) => b.turn - a.turn)[0];
      return { cid, corpCount: last.corpCount, marketCap: last.totalMarketCapAnchor, liquid: last.totalLiquidCapitalAnchor };
    })
    .sort((a, b) => b.marketCap - a.marketCap);

  // ── §Party org over time — one panel per country that HAS org history ──
  const orgCountries = [...new Set(org.map((o) => o.countryId))].sort();
  const orgPanels = [];
  for (const cid of orgCountries) {
    const rows = org.filter((o) => o.countryId === cid);
    const pids = [...new Set(rows.map((r) => r.partyId))];
    // Rank parties by peak org, keep top 6.
    const ranked = pids
      .map((pid) => {
        const pts = rows.filter((r) => r.partyId === pid).sort((a, b) => a.turn - b.turn);
        return { pid, pts, peak: Math.max(...pts.map((p) => p.organization || 0)) };
      })
      .filter((x) => x.pts.length >= 2)
      .sort((a, b) => b.peak - a.peak)
      .slice(0, 6);
    if (ranked.length === 0) continue;
    const series = ranked.map((r, i) => ({
      label: partyAbbr(cid, r.pid),
      fullName: partyName(cid, r.pid),
      borderColor: partyColor(cid, r.pid, i),
      backgroundColor: "transparent", tension: 0.25, pointRadius: 0, borderWidth: 1.5,
      data: downsample(r.pts, 50).map((p) => ({ x: p.turn, y: Math.round((p.organization || 0) * 10) / 10 })),
    }));
    orgPanels.push({ cid, name: COUNTRY_NAMES[cid] || cid, series });
  }

  // ── §Seats over time — top-2 legislatures, real party names ──
  function seatSeriesFor(cid) {
    const rows = seats.filter((s) => s.countryId === cid);
    const turns = [...new Set(rows.map((s) => s.turn))].sort((a, b) => a - b);
    const pids = [...new Set(rows.map((s) => s.party))];
    const perTurnParty = new Map();
    for (const s of rows) {
      const k = `${s.turn}:${s.party}`;
      perTurnParty.set(k, (perTurnParty.get(k) || 0) + (s.seats || 0));
    }
    const peak = pids.map((p) => ({ p, max: Math.max(...turns.map((t) => perTurnParty.get(`${t}:${p}`) || 0)) }));
    peak.sort((a, b) => b.max - a.max);
    const topParties = peak.slice(0, 6).map((x) => x.p);
    const dsTurns = downsample(turns, MAX_POINTS);
    const series = topParties.map((p, i) => ({
      label: partyAbbr(cid, p), fullName: partyName(cid, p),
      borderColor: partyColor(cid, p, i), backgroundColor: partyColor(cid, p, i) + "44", fill: true,
      tension: 0.25, pointRadius: 0, borderWidth: 1.5,
      data: dsTurns.map((t) => perTurnParty.get(`${t}:${p}`) || 0),
    }));
    return { turns: dsTurns, series };
  }
  const seatCandidates = [...new Set(seats.map((s) => s.countryId))];
  const seatTotals = seatCandidates
    .map((cid) => ({ cid, total: seats.filter((s) => s.countryId === cid).reduce((a, s) => a + (s.seats || 0), 0) }))
    .sort((a, b) => b.total - a.total);
  const seatCountryA = seatTotals[0]?.cid;
  const seatCountryB = seatTotals[1]?.cid;
  const seatsA = seatCountryA ? seatSeriesFor(seatCountryA) : { turns: [], series: [] };
  const seatsB = seatCountryB ? seatSeriesFor(seatCountryB) : { turns: [], series: [] };

  // ── Resolve wealth-leader + top-corp rows (server-side name resolution) ──
  const wealthRows = wealthLeaders.map((w, i) => ({
    rank: i + 1, name: w.name, cid: w.countryId,
    partyName: partyName(w.countryId, w.party), partyColor: partyColor(w.countryId, w.party),
    wealth: w.wealthAnchor, warChest: w.warChestAnchor, office: w.office ? (OFFICE_LABELS[w.office] || w.office) : null,
    ceo: w.ceoOfCorp, stocks: w.stockPositionCount,
  }));
  const corpLeagueRows = topCorps.map((c, i) => ({
    rank: i + 1, name: c.name, cid: c.countryId, sector: c.sector,
    ceo: c.ceoName, mcap: c.marketCapAnchor, liquid: c.liquidCapitalAnchor, insolvent: c.insolvent,
  }));

  const payload = {
    runId: RUN_ID, turnLo, turnHi, collectedAt: doc.collectedAt,
    runConfig: doc.runConfig || {},
    govGroups, corpTurns, corpCountSeries, corpMcapSeries,
    orgPanels, seatCountryA, seatsA, seatCountryB, seatsB,
    wealthRows, corpLeagueRows, finalCorpRows,
    longHorizon,
  };

  const html = renderHtml(payload, fm);
  fs.writeFileSync(OUT_PATH, html, "utf8");
  console.log(`Wrote ${OUT_PATH} (${(html.length / 1024).toFixed(0)} KB)`);
  if (ALSO_LATEST && OUT_SLUG !== "sim-experiment-audit") {
    const latest = path.join(__dirname, "..", "reports", "sim-experiment-audit.html");
    fs.writeFileSync(latest, html, "utf8");
    console.log(`Also refreshed canonical ${latest}`);
  }
  console.log(`Run ${RUN_ID}: turns ${turnLo}-${turnHi}, ${govGroups.length} gov country-groups, ${wealthRows.length} wealth leaders, ${corpLeagueRows.length} top corps`);
}

function renderHtml(p, fm) {
  const w = fm.wealth || {}, el = fm.electoral || {}, ot = fm.officeTurnover || {}, cr = fm.crises || {}, ec = fm.economy || {};
  const rc = p.runConfig || {};

  const chip = (color, text) =>
    `<span class="chip" style="--c:${color}">${esc(text)}</span>`;

  // Run configuration / provenance panel — the exact conditions this run used.
  const cfgItem = (k, v) => `<div class="cfg-item"><div class="cfg-k">${esc(k)}</div><div class="cfg-v">${v}</div></div>`;
  const flags = rc.featureFlags || {};
  const flagsOn = Object.keys(flags).filter((k) => flags[k]);
  const gitStr = rc.gitCommit ? `${esc(rc.gitCommit)}${rc.gitDirty ? " <span class=\"cfg-dirty\">+uncommitted</span>" : ""}` : "—";
  const turnsStr = rc.turns != null ? `${rc.turns} this leg` : "—";
  const flagLabels = { autoDisastersEnabled: "auto-disasters", crisisAidBillsEnabled: "crisis-aid bills", conflictsEnabled: "conflicts", coldWarEnabled: "cold-war", autoSectorSeedEnabled: "auto-sector-seed", sectorTechTreesEnabled: "sector tech-trees" };
  const configHtml = `<div class="cfg">
    <div class="cfg-h">⚙️ Run Configuration</div>
    <div class="cfg-grid">
      ${cfgItem("Seed", esc(rc.seed || "—"))}
      ${cfgItem("Preset / Era", esc(rc.preset || "—"))}
      ${cfgItem("Turn range", `${p.turnLo}–${p.turnHi}${rc.turnRange && rc.turnRange.to ? "" : ""}`)}
      ${cfgItem("Turns", esc(turnsStr))}
      ${cfgItem("Site version", esc(rc.appVersion ? "v" + rc.appVersion : "—"))}
      ${cfgItem("Git commit", gitStr)}
      ${cfgItem("Worldsim MCP", esc(rc.mcpVersion ? "v" + rc.mcpVersion : "—"))}
      ${cfgItem("NPP autonomy", esc(rc.nppAutonomyLevel || "—"))}
      ${cfgItem("Countries", esc((rc.countries || []).join(" · ") || "—"))}
      ${cfgItem("Corps / sector", esc(rc.corpsPerSector != null ? String(rc.corpsPerSector) : "—"))}
      ${cfgItem("Fund-invest interval", esc(rc.fundInvestmentInterval != null ? `every ${rc.fundInvestmentInterval} turns` : "—"))}
      ${cfgItem("Crisis spawn ×", esc(rc.crisisSpawnMultiplier != null ? `${rc.crisisSpawnMultiplier}×` : "—"))}
      ${cfgItem("Insolvency threshold", esc(rc.insolvencyThresholdAnchor != null ? "₳" + rc.insolvencyThresholdAnchor.toLocaleString() : "—"))}
      ${cfgItem("Feature flags", flagsOn.length ? flagsOn.map((k) => `<span class="cfg-flag">${esc(flagLabels[k] || k)}</span>`).join(" ") : "—")}
    </div>
  </div>`;

  // Government control — country blocks, one strip per chamber.
  const govHtml = p.govGroups.map((grp) => {
    const rows = grp.strips.map((s) => {
      const segs = s.segments.map((seg) =>
        `<span class="seg" style="background:${seg.color}" title="T${seg.turn} · ${esc(seg.name)}${s.singleSeat ? "" : " · " + (seg.share * 100).toFixed(0) + "% of chamber"}"></span>`
      ).join("");
      const status = s.changes === 0
        ? `<span class="tag frozen">no turnover</span>`
        : `<span class="tag flux">${s.changes} change${s.changes === 1 ? "" : "s"}</span>`;
      const share = s.singleSeat ? "" : `<span class="muted num">${s.endSeats}/${s.endTotal} (${(s.endShare * 100).toFixed(0)}%)</span>`;
      return `<div class="gov-row">
        <div class="gov-head">
          <div class="gov-chamber">${esc(s.label)}</div>
          <div>${chip(s.endColor, s.endName)} ${share} ${status}</div>
        </div>
        <div class="strip">${segs}</div>
      </div>`;
    }).join("\n");
    return `<div class="gov-group">
      <div class="gov-country">${esc(grp.name)}</div>
      ${rows}
    </div>`;
  }).join("\n");
  // "Turnover" = the country's PRIMARY office (executive or lower house) changed hands.
  const frozenCount = p.govGroups.filter((g) => g.primaryChanges === 0).length;

  // Wealth leaderboard.
  const wealthHtml = p.wealthRows.map((r) => {
    const why = [];
    if (r.office) why.push(esc(r.office));
    if (r.ceo) why.push("CEO of " + esc(r.ceo));
    if (r.stocks > 0) why.push(r.stocks + " equity position" + (r.stocks === 1 ? "" : "s"));
    return `<tr>
      <td class="num">${r.rank}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(COUNTRY_NAMES[r.cid] || r.cid)}</td>
      <td>${chip(r.partyColor, r.partyName)}</td>
      <td class="num">${fmtMoney(r.wealth)}</td>
      <td class="num muted">${r.warChest ? fmtMoney(r.warChest) : "—"}</td>
      <td>${why.length ? why.join(" · ") : '<span class="muted">rank-and-file</span>'}</td>
    </tr>`;
  }).join("\n");

  // Top corporations league table.
  const corpLeagueHtml = p.corpLeagueRows.map((r) =>
    `<tr>
      <td class="num">${r.rank}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(COUNTRY_NAMES[r.cid] || r.cid)}</td>
      <td>${esc(r.sector || "—")}</td>
      <td>${esc(r.ceo || "—")}</td>
      <td class="num">${fmtMoney(r.mcap)}</td>
      <td class="num" style="${r.insolvent ? "color:var(--red-light);font-weight:700" : ""}">${fmtMoney(r.liquid)}</td>
    </tr>`
  ).join("\n");

  // Corp-by-country final table.
  const corpTableRows = p.finalCorpRows.map((r) =>
    `<tr><td>${esc(COUNTRY_NAMES[r.cid] || r.cid)}</td><td class="num">${r.corpCount}</td><td class="num">${fmtMoney(r.marketCap)}</td><td class="num" style="${r.liquid < 0 ? "color:var(--red-light);font-weight:700" : ""}">${fmtMoney(r.liquid)}</td></tr>`
  ).join("\n");

  // Party-org panels (one canvas each).
  const orgPanelHtml = p.orgPanels.map((o) =>
    `<div class="chart-box"><h3>${esc(o.name)}</h3><canvas id="org_${o.cid}"></canvas></div>`
  ).join("\n");

  const lh = p.longHorizon;
  const telemetryStatus = lh.passing
    ? '<span class="telemetry-status pass">complete</span>'
    : `<span class="telemetry-status fail">${esc(lh.availability)}</span>`;
  const telemetryWarning = lh.warning
    ? `<div class="telemetry-warning"><strong>Not passing:</strong> ${esc(lh.warning)}</div>`
    : '<div class="telemetry-ok">Every observed series contains every turn in the authoritative range.</div>';
  const provenanceRows = lh.provenance
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => `<tr><td>${esc(label)}</td><td><code>${esc(String(value))}</code></td></tr>`)
    .join("\n");
  const coverageRows = lh.coverage.map((series) => {
    const missing = series.missingTurns || [];
    const label = `${series.country}${series.region == null ? " · national" : " · " + series.region}${series.metric ? " · " + series.metric : " · approval"}`;
    return `<tr class="${missing.length ? "coverage-missing" : ""}"><td>${esc(label)}</td><td class="num">${series.observedPoints}/${series.expectedPoints}</td><td>${missing.length ? esc(missing.join(", ")) : '<span class="telemetry-status pass">none</span>'}</td></tr>`;
  }).join("\n");
  const telemetryCharts = lh.approvalSeries.length || lh.gdpSeries.length || lh.populationSeries.length
    ? `<div class="chart-row">
        <div class="chart-box full"><h3>National Government Approval (%)</h3><canvas id="approvalChart"></canvas></div>
        <div class="chart-box"><h3>GDP by Country</h3><canvas id="gdpChart"></canvas></div>
        <div class="chart-box"><h3>Population by Country</h3><canvas id="populationChart"></canvas></div>
      </div>`
    : '<div class="chart-box full"><p class="muted">No long-horizon chart points were retained for this report.</p></div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NPP Sim Experiment Audit — ${esc(p.runId)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Geist+Sans:wght@400;500;600;700&family=Fraunces:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#0d0d12;--surface:#16161d;--surface-hover:#1e1e28;--border:#2a2a35;--text:#f6f1e7;--text-secondary:#a0a0a8;--muted:#6b6b75;--red:#a51c1c;--red-light:#dc2626;--gold:#ffce42;--green:#16a34a;--green-light:#22c55e;--blue:#5865F2;--orange:#ea580c;}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:var(--bg);color:var(--text);font-family:'Geist Sans',system-ui,-apple-system,sans-serif;line-height:1.6;}
.container{max-width:1200px;margin:0 auto;padding:2rem 1.5rem;}
h1,h2,h3{font-family:'Fraunces',Georgia,serif;font-weight:600;}
h1{font-size:1.8rem;margin-bottom:0.5rem;}
h2{font-size:1.4rem;margin:2rem 0 1rem;color:var(--gold);border-bottom:1px solid var(--border);padding-bottom:0.5rem;}
h3{font-size:1.1rem;margin:1.5rem 0 0.75rem;color:var(--text);}
.subtitle{color:var(--text-secondary);font-size:0.95rem;margin-bottom:2rem;}
.cfg{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1rem 1.25rem;margin-bottom:1.5rem;}
.cfg-h{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:1rem;color:var(--gold);margin-bottom:0.75rem;}
.cfg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:0.6rem 1.25rem;}
.cfg-item{min-width:0;}
.cfg-k{font-size:0.66rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:0.1rem;}
.cfg-v{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:0.82rem;color:var(--text);word-break:break-word;}
.cfg-dirty{color:var(--orange);font-size:0.72rem;}
.cfg-flag{display:inline-block;font-size:0.7rem;font-family:'Geist Sans',sans-serif;background:var(--surface-hover);color:var(--green-light);border:1px solid var(--border);border-radius:999px;padding:0.05rem 0.45rem;margin:0.1rem 0.15rem 0 0;}
.exec-summary{background:linear-gradient(135deg,#1a1a2e 0%,#16161d 100%);border:1px solid var(--border);border-left:4px solid var(--gold);border-radius:6px;padding:1.5rem;margin-bottom:2rem;}
.exec-summary p{color:var(--text-secondary);font-size:0.95rem;line-height:1.7;}
.exec-summary strong{color:var(--text);}
table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:0.85rem;}
th{text-align:left;padding:0.6rem 0.75rem;background:var(--surface-hover);color:var(--text-secondary);font-weight:600;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);}
td{padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);color:var(--text-secondary);}
tr:hover td{background:var(--surface-hover);}
.num{text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:0.82rem;}
.muted{color:var(--muted);}
.chip{display:inline-flex;align-items:center;gap:0.35rem;padding:0.1rem 0.5rem;border-radius:999px;font-size:0.78rem;font-weight:600;color:var(--text);background:color-mix(in srgb,var(--c) 22%,transparent);border:1px solid color-mix(in srgb,var(--c) 55%,transparent);}
.chip::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--c);}
.chart-row{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin:1rem 0;}
.chart-box{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1.25rem;}
.chart-box.full{grid-column:1 / -1;}
.chart-box h3{margin-top:0;font-size:0.95rem;}
canvas{max-height:340px;}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin:1rem 0;}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1rem;text-align:center;}
.kpi-value{font-size:1.5rem;font-weight:700;font-family:'JetBrains Mono',monospace;}
.kpi-label{font-size:0.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-top:0.25rem;}
.kpi.good .kpi-value{color:var(--green-light);}
.kpi.warn .kpi-value{color:var(--orange);}
.kpi.info .kpi-value{color:var(--blue);}
code{background:var(--surface-hover);padding:0.15rem 0.4rem;border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:0.82rem;}
.section-divider{height:1px;background:linear-gradient(90deg,transparent,var(--border),transparent);margin:2.5rem 0;}
.back-link{display:inline-flex;align-items:center;gap:0.4rem;color:var(--blue);text-decoration:none;font-size:0.85rem;margin-bottom:1.5rem;}
.back-link:hover{text-decoration:underline;}
.note{color:var(--text-secondary);font-size:0.9rem;margin-bottom:1rem;}
.gov-group{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1rem 1.25rem;margin:1rem 0;}
.gov-row{margin:0.55rem 0;}
.gov-row:first-of-type{margin-top:0.35rem;}
.gov-head{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:0.3rem;font-size:0.85rem;}
.gov-country{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:1.05rem;color:var(--gold);margin-bottom:0.5rem;padding-bottom:0.4rem;border-bottom:1px solid var(--border);}
.gov-chamber{font-weight:600;color:var(--text-secondary);}
.strip{display:flex;height:16px;border-radius:4px;overflow:hidden;border:1px solid var(--border);}
.seg{flex:1 1 0;min-width:0;}
.tag{font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;padding:0.1rem 0.45rem;border-radius:3px;margin-left:0.4rem;font-weight:700;}
.tag.frozen{background:rgba(220,38,38,0.15);color:var(--red-light);}
.tag.flux{background:rgba(34,197,94,0.15);color:var(--green-light);}
.telemetry-status{display:inline-block;border-radius:999px;padding:0.1rem 0.5rem;font-size:0.75rem;font-weight:700;text-transform:uppercase;}
.telemetry-status.pass{background:rgba(34,197,94,0.15);color:var(--green-light);}
.telemetry-status.fail{background:rgba(220,38,38,0.18);color:var(--red-light);}
.telemetry-warning{background:rgba(220,38,38,0.12);border:1px solid var(--red);border-left:4px solid var(--red-light);padding:1rem;margin:1rem 0;color:var(--red-light);}
.telemetry-ok{background:rgba(34,197,94,0.1);border:1px solid var(--green);padding:0.75rem 1rem;margin:1rem 0;color:var(--green-light);}
.coverage-missing td{background:rgba(220,38,38,0.08);color:var(--red-light);}
@media(max-width:768px){.chart-row{grid-template-columns:1fr;}.kpi-grid{grid-template-columns:repeat(2,1fr);}}
</style>
</head>
<body>
<div class="container">
<a href="/reports" class="back-link">← Back to Reports</a>

<h1>NPP Sim Experiment Audit</h1>
<p class="subtitle">Run <code>${esc(p.runId)}</code> · ${esc(rc.preset || "1991-default")} · headless NPP autonomy · timeline turns ${p.turnLo}–${p.turnHi}</p>

${configHtml}

<div class="exec-summary">
  <p><strong>A fully-autonomous NPP simulation across 8 countries (US · UK · DE · JP · CN · BR · NG · IE).</strong> Every politician, corporation, party and government is AI-driven — no players. This report shows the retained history window (turns ${p.turnLo}–${p.turnHi}; per-turn snapshots keep the last ~96 turns) plus end-of-run leaderboards and balance metrics. <strong>Government control:</strong> ${frozenCount} of ${p.govGroups.length} countries saw <em>no</em> change in the governing (plurality) party across the window — control is largely entrenched, with turnover concentrated in the few countries whose strips below show colour changes. Wealth concentration Gini <strong>${(w.gini ?? 0).toFixed(3)}</strong>, top-1% share <strong>${pct(w.top1PctShare ?? 0)}</strong>; ${pct(el.contestedPct ?? 0)} of races contested.</p>
</div>

<div class="kpi-grid">
  <div class="kpi info"><div class="kpi-value">${(w.nppCount ?? 0).toLocaleString()}</div><div class="kpi-label">NPPs</div></div>
  <div class="kpi ${frozenCount === p.govGroups.length ? "warn" : "info"}"><div class="kpi-value">${p.govGroups.length - frozenCount}/${p.govGroups.length}</div><div class="kpi-label">Countries w/ Turnover</div></div>
  <div class="kpi good"><div class="kpi-value">${(w.gini ?? 0).toFixed(3)}</div><div class="kpi-label">Wealth Gini</div></div>
  <div class="kpi good"><div class="kpi-value">${pct(w.top1PctShare ?? 0)}</div><div class="kpi-label">Top-1% Share</div></div>
  <div class="kpi good"><div class="kpi-value">${pct(el.contestedPct ?? 0)}</div><div class="kpi-label">Contested Races</div></div>
  <div class="kpi info"><div class="kpi-value">${(el.effectivePartyCount ?? 0).toFixed(2)}</div><div class="kpi-label">Eff. Party Count</div></div>
  <div class="kpi warn"><div class="kpi-value">${(cr.totalSpawned ?? 0)}/${(cr.resolved ?? 0)}</div><div class="kpi-label">Crises Spawned/Resolved</div></div>
  <div class="kpi warn"><div class="kpi-value">${(ec.inflationIndex ?? 0).toFixed(3)}</div><div class="kpi-label">Inflation Index</div></div>
</div>

<h2>§1 Who Governs — Control Timeline</h2>
<p class="note">Each strip is the party controlling one chamber/office of a country, left→right across turns ${p.turnLo}–${p.turnHi}: the party holding the executive (President), the plurality party in each national legislature, and — for the US — the party controlling the most Governorships. A solid single colour = one party held it the whole window; colour changes = it turned over. The headline "turnover" count above tracks each country's <em>primary</em> office (executive in presidential systems, lower house in parliamentary ones). Hover any segment for the turn, party and chamber share.</p>
${govHtml}

<div class="section-divider"></div>

<h2>§2 Wealthiest Politicians — and Why</h2>
<p class="note">Top ${p.wealthRows.length} NPPs by <strong>personal net worth</strong> (personal balances + APY savings + investment portfolio), converted to the ₳ anchor. <strong>Excludes the campaign war chest</strong> (<code>npp.funds</code>) — a political-operating account, shown in its own column, not personal wealth. Folding it in previously inflated this table and the Gini/top-1% figures. The Sources column attributes the net worth: office held, corp run as CEO, equity stakes.</p>
<table>
<thead><tr><th class="num">#</th><th>Politician</th><th>Country</th><th>Party</th><th class="num">Net Worth</th><th class="num">War Chest</th><th>Sources</th></tr></thead>
<tbody>
${wealthHtml}
</tbody>
</table>

<div class="section-divider"></div>

<h2>§3 Largest Corporations</h2>
<p class="note">Top ${p.corpLeagueRows.length} corporations by market cap (₳ anchor — comparable across currencies). Negative liquid capital (red) flags a corp running insolvent; the NPP auto-dissolution mechanic winds these down over subsequent turns.</p>
<table>
<thead><tr><th class="num">#</th><th>Corporation</th><th>Country</th><th>Sector</th><th>CEO</th><th class="num">Market Cap</th><th class="num">Liquid Capital</th></tr></thead>
<tbody>
${corpLeagueHtml}
</tbody>
</table>

<div class="section-divider"></div>

<h2>§4 Corporations by Country Over Time</h2>
<p class="note">Corporation count and total market cap (₳ anchor) per country across the retained window. Growth above the seeded base reflects autonomous NPP corporation-founding; declines reflect insolvency wind-downs.</p>
<div class="chart-row">
  <div class="chart-box"><h3>Corporation Count by Country</h3><canvas id="corpCountChart"></canvas></div>
  <div class="chart-box"><h3>Total Market Cap by Country (₳)</h3><canvas id="corpMcapChart"></canvas></div>
</div>
<table>
<thead><tr><th>Country</th><th class="num">Final Corps</th><th class="num">Market Cap (₳)</th><th class="num">Liquid Capital (₳)</th></tr></thead>
<tbody>
${corpTableRows}
</tbody>
</table>

<div class="section-divider"></div>

<h2>§5 Seats Over Time</h2>
<p class="note">Seats held by party (summed across chambers) for the two largest legislatures — <strong>${esc(COUNTRY_NAMES[p.seatCountryA] || p.seatCountryA || "—")}</strong> and <strong>${esc(COUNTRY_NAMES[p.seatCountryB] || p.seatCountryB || "—")}</strong>. Legend uses real party abbreviations; hover for full names.</p>
<div class="chart-row">
  <div class="chart-box"><h3>${esc(COUNTRY_NAMES[p.seatCountryA] || p.seatCountryA || "—")}</h3><canvas id="seatsAChart"></canvas></div>
  <div class="chart-box"><h3>${esc(COUNTRY_NAMES[p.seatCountryB] || p.seatCountryB || "—")}</h3><canvas id="seatsBChart"></canvas></div>
</div>

<div class="section-divider"></div>

<h2>§6 Party Organization Over Time</h2>
<p class="note">State-party organization strength (summed per party) over the window, one panel per country with org history. Autonomous NPP org-building offsets per-turn decay. <span class="muted">Note: org snapshots currently cover status:"active" countries only.</span></p>
<div class="chart-row">
${orgPanelHtml || '<div class="chart-box full"><p class="muted">No party-org history captured for this run.</p></div>'}
</div>

<div class="section-divider"></div>

<h2>§7 Long-Horizon Readiness Telemetry ${telemetryStatus}</h2>
<p class="note">Full retained approval, GDP, and population evidence. These series are embedded in this static report; the browser does not query a game database. GDP and population chart lines use the national point for each country and turn, with regional sums as a fallback. No long-horizon points are downsampled.</p>
${telemetryWarning}
${telemetryCharts}
<h3>Provenance</h3>
<table><tbody>${provenanceRows || '<tr><td colspan="2" class="muted">No provenance recorded (legacy report).</td></tr>'}</tbody></table>
<h3>Completeness and Missing Turns</h3>
<table>
<thead><tr><th>Series</th><th class="num">Observed / Expected</th><th>Missing turns</th></tr></thead>
<tbody>${coverageRows || '<tr><td colspan="3" class="muted">No observed series coverage metadata.</td></tr>'}</tbody>
</table>

<div class="section-divider"></div>

<h2>§8 Balance Metrics (End of Run)</h2>
<table>
<thead><tr><th>Metric</th><th class="num">Value</th><th>Reading</th></tr></thead>
<tbody>
  <tr><td>Wealth Gini</td><td class="num">${(w.gini ?? 0).toFixed(3)}</td><td>Concentration of NPP net worth</td></tr>
  <tr><td>Top-1% wealth share</td><td class="num">${pct(w.top1PctShare ?? 0)}</td><td>Share held by richest 1%</td></tr>
  <tr><td>Mean / median NPP wealth</td><td class="num">${fmtMoney(w.meanWealth ?? 0)} / ${fmtMoney(w.medianWealth ?? 0)}</td><td>Right-skewed, expected</td></tr>
  <tr><td>Contested races</td><td class="num">${pct(el.contestedPct ?? 0)}</td><td>Competitive primaries</td></tr>
  <tr><td>Effective party count</td><td class="num">${(el.effectivePartyCount ?? 0).toFixed(2)}</td><td>Genuine multi-party systems</td></tr>
  <tr><td>Elections resolved / total</td><td class="num">${(el.resolvedElections ?? 0)} / ${(el.totalElections ?? 0)}</td><td>Cycle turnover working</td></tr>
  <tr><td>Filled offices · NPP-held</td><td class="num">${(ot.officeCount ?? 0).toLocaleString()} · ${pct(ot.nppHeldPct ?? 0)}</td><td>Fully NPP-governed world</td></tr>
  <tr><td>Crises spawned / resolved</td><td class="num">${(cr.totalSpawned ?? 0)} / ${(cr.resolved ?? 0)}</td><td>Lifecycle intact</td></tr>
  <tr><td>Inflation index</td><td class="num">${(ec.inflationIndex ?? 0).toFixed(3)}</td><td>Mild, stable</td></tr>
  <tr><td>Price volatility</td><td class="num">${(ec.priceVolatility ?? 0).toFixed(3)}</td><td>Commodity market active</td></tr>
</tbody>
</table>

<div class="section-divider"></div>
<p style="color:var(--muted);font-size:0.8rem;text-align:center;margin-top:2rem;">
  NPP Sim Experiment Audit · generated by <code>scripts/gen-sim-experiment-report.js</code> · data: <code>simExperimentReports/${esc(p.runId)}</code>
</p>
</div>

<script>
const DATA = ${JSON.stringify(payload_min(p))};
const AX = { color:'#a0a0a8', font:{family:'JetBrains Mono',size:10} };
const GRID = { color:'#2a2a35' };
const LEG = { labels:{ color:'#f6f1e7', font:{size:10}, boxWidth:12, padding:6 } };
// Legend/tooltip: prefer a series' fullName when present.
const nameTip = { callbacks:{ title:(items)=>{ const d=items[0]?.dataset; return d&&d.fullName?d.fullName:(items[0]?.label||''); } } };
function lineChart(id, labels, datasets, opts){
  const el = document.getElementById(id); if(!el) return;
  new Chart(el.getContext('2d'), { type:'line', data:{ labels, datasets },
    options: Object.assign({ responsive:true, interaction:{mode:'index',intersect:false},
      plugins:{ legend:LEG, tooltip:nameTip }, scales:{ x:{grid:GRID,ticks:AX}, y:{grid:GRID,ticks:AX,beginAtZero:true} } }, opts||{}) });
}
lineChart('corpCountChart', DATA.corpTurns, DATA.corpCountSeries);
lineChart('corpMcapChart', DATA.corpTurns, DATA.corpMcapSeries, { plugins:{legend:LEG}, scales:{ x:{grid:GRID,ticks:AX}, y:{grid:GRID,ticks:{...AX, callback:v=>'₳'+(v/1e6).toFixed(0)+'M'}} } });
lineChart('seatsAChart', DATA.seatsA.turns, DATA.seatsA.series, { plugins:{legend:LEG,tooltip:nameTip}, scales:{ x:{grid:GRID,ticks:AX}, y:{grid:GRID,ticks:AX,stacked:true} }, elements:{line:{fill:true}} });
lineChart('seatsBChart', DATA.seatsB.turns, DATA.seatsB.series, { plugins:{legend:LEG,tooltip:nameTip}, scales:{ x:{grid:GRID,ticks:AX}, y:{grid:GRID,ticks:AX,stacked:true} }, elements:{line:{fill:true}} });
function telemetryChart(id, datasets, valueLabel){
  const el=document.getElementById(id); if(!el||!datasets.length)return;
  new Chart(el.getContext('2d'), { type:'line', data:{datasets}, options:{responsive:true,interaction:{mode:'nearest',intersect:false},plugins:{legend:LEG,tooltip:nameTip},scales:{x:{type:'linear',grid:GRID,ticks:AX,title:{display:true,text:'Turn',color:'#6b6b75'}},y:{grid:GRID,ticks:AX,title:{display:true,text:valueLabel,color:'#6b6b75'}}}} });
}
telemetryChart('approvalChart', DATA.longHorizon.approvalSeries, 'Approval %');
telemetryChart('gdpChart', DATA.longHorizon.gdpSeries, 'Local-currency millions');
telemetryChart('populationChart', DATA.longHorizon.populationSeries, 'People');
// Party-org panels (linear x, {x,y} points).
for (const o of DATA.orgPanels){
  const el=document.getElementById('org_'+o.cid); if(!el)continue;
  new Chart(el.getContext('2d'), { type:'line', data:{ datasets:o.series },
    options:{ responsive:true, interaction:{mode:'nearest',intersect:false},
      plugins:{ legend:LEG, tooltip:nameTip }, scales:{ x:{type:'linear',grid:GRID,ticks:AX,title:{display:true,text:'Turn',color:'#6b6b75'}}, y:{grid:GRID,ticks:AX,beginAtZero:true} } } });
}
</script>
</body>
</html>`;
}

// Only ship the chart data the client needs (keeps embedded JSON lean; tables
// are already rendered into static HTML above).
function payload_min(p) {
  return {
    corpTurns: p.corpTurns, corpCountSeries: p.corpCountSeries, corpMcapSeries: p.corpMcapSeries,
    orgPanels: p.orgPanels,
    seatsA: p.seatsA, seatsB: p.seatsB,
    longHorizon: {
      approvalSeries: p.longHorizon.approvalSeries,
      gdpSeries: p.longHorizon.gdpSeries,
      populationSeries: p.longHorizon.populationSeries,
    },
  };
}

if (require.main === module) {
  main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
}

module.exports = { renderHtml, payload_min };
