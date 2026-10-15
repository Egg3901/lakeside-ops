"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const data = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "reports", "research", "economy-program-update-t440.json"),
    "utf8",
  ),
);
const output =
  process.argv[2] ||
  path.join(ROOT, "reports", "economy-market-program-update-t440.html");

const pct = (value, digits = 1) => `${Number(value).toFixed(digits)}%`;
const statusClass = (status) =>
  status === "live" || status === "validated" ? "ok" : "hold";
const jargon = (key, label, kind = "econ") =>
  `<span class="jg ${kind}" data-jg="${key}" tabindex="0">${label}</span>`;
const issue = (number, label) =>
  `<a href="https://github.com/Egg3901/AHDGame/issues/${number}" target="_blank" rel="noopener">#${number} ${label}</a>`;

const p = data.program;
const us = data.usMarketFormation;
const demand = data.usDemand;
const sim = p.simulation;
const trial = data.marketFormationTrial;
const rollout = data.productionRollout;
const baseline = rollout.baseline;
const classificationLabels = {
  fundamental_zero: "Fundamental zero",
  import_served: "Import-served",
  unserved: "Unserved positive use",
  entry_gap: "Entry gap",
  coordination_gap: "Coordination gap",
  data_zero: "Data zero",
};
const reasonLabels = {
  cohort_ineligible: "Outside entry cohort",
  entered: "Entered",
  margin_below_floor: "Margin below floor",
  strategy_disallowed: "Strategy disallowed",
  unprofitable: "Unprofitable",
  credit_cooldown: "Credit cooldown",
  logistics_capacity: "Logistics capacity",
  no_enterable_market: "No enterable market",
  credit_rounding_shortfall: "Credit rounding shortfall",
  credit_issuance_failed: "Credit issuance failed",
  credit_capacity: "Credit capacity",
  cash_floor: "Cash floor",
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Economy Market Program: Production Rollout and Tracker Baseline</title>
<style>
:root{--ink:#172033;--muted:#607086;--paper:#f5f7fa;--card:#fff;--line:#dbe2eb;--blue:#2563eb;--teal:#087f75;--green:#14804a;--amber:#a15c00;--red:#ba1a1a;--navy:#152b4d;--shadow:0 8px 26px rgba(21,43,77,.08)}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:var(--blue)}.shell{max-width:1220px;margin:auto;padding:28px 24px 60px}.hero{background:linear-gradient(135deg,#102443,#1c4d72);color:#fff;border-radius:16px;padding:30px 34px;box-shadow:var(--shadow)}.eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;color:#9ed8ff}.hero h1{font:700 34px/1.12 Georgia,serif;margin:7px 0 10px}.hero p{max-width:900px;color:#dcecff;font-size:15px;margin:0}.meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.pill,.badge{display:inline-block;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.pill{background:rgba(255,255,255,.12);color:#fff}.badge.ok{background:#dff5e8;color:var(--green)}.badge.hold{background:#fff0d4;color:var(--amber)}.badge.bad{background:#fde5e5;color:var(--red)}.headline{display:grid;grid-template-columns:1.35fr .65fr;gap:18px;margin:20px 0}.card{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:19px 21px;box-shadow:var(--shadow)}.card h2,.card h3{margin:0 0 9px}.card h2{font:700 24px/1.2 Georgia,serif}.card h3{font-size:15px}.lead{font-size:16px;line-height:1.55}.callout{border-left:5px solid var(--blue)}.callout.bad{border-color:var(--red)}.callout.good{border-color:var(--green)}.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:13px;margin:18px 0}.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:var(--shadow)}.tile .v{font:700 28px/1 Georgia,serif;color:var(--navy)}.tile .l{font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:800;color:var(--muted);margin-top:7px}.section{margin-top:28px}.section>h2{font:700 27px/1.2 Georgia,serif;margin:0 0 12px}.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}table{width:100%;border-collapse:collapse}th,td{padding:10px 9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}.barrow{display:grid;grid-template-columns:150px 1fr 42px;align-items:center;gap:9px;margin:8px 0}.bar{height:9px;background:#e8edf3;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:var(--blue);border-radius:99px}.small{font-size:12px;color:var(--muted)}.priority{display:grid;grid-template-columns:48px 1.1fr 1.5fr 1.2fr;gap:12px;padding:13px 0;border-bottom:1px solid var(--line)}.priority:last-child{border:0}.rank{font-size:12px;font-weight:900;color:var(--blue)}.priority b{display:block;margin-bottom:4px}.source-list li{margin:8px 0}.jg{text-decoration-line:underline;text-decoration-style:wavy;text-underline-offset:4px;cursor:help}.jg.econ{text-decoration-color:#16986e}.jg.game{text-decoration-color:#2878d0}.tip{position:fixed;z-index:30;max-width:320px;padding:11px 13px;background:#101b2d;color:white;border-radius:9px;box-shadow:0 10px 34px rgba(0,0,0,.3);font-size:12px;pointer-events:none;display:none}.tip b{display:block;margin-bottom:3px}.note{padding:11px 13px;border-radius:9px;background:#edf5ff;color:#244568}.footer{margin-top:25px;color:var(--muted);font-size:12px}@media(max-width:850px){.headline,.grid2,.grid3{grid-template-columns:1fr}.tiles{grid-template-columns:repeat(2,1fr)}.priority{grid-template-columns:42px 1fr}.priority div:nth-child(n+3){grid-column:2}.barrow{grid-template-columns:120px 1fr 38px}}@media(max-width:500px){.shell{padding:14px 12px 40px}.hero{padding:22px}.hero h1{font-size:28px}.tiles{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<main class="shell">
  <header class="hero">
    <div class="eyebrow">Operations research note</div>
    <h1>Economy Market Program: Production Rollout and Tracker Baseline</h1>
    <p>The market program is now an operating policy, not a simulation project. Four reversible interventions address empty markets, fragile supply, sovereign issue access, and equity depth. The completed matched trial remains the causal evidence for empty-market coverage; focused tests and bounded checks support the other mechanisms; Markets Watch now measures their production effects from turn ${rollout.activatedAtTurn}.</p>
    <div class="meta"><span class="pill">Production baseline turn ${data.turn}</span><span class="pill">Rollout commit ${rollout.commit}</span><span class="pill">Review turn ${rollout.reviewTurn}</span><span class="pill">Outside-economist frame</span></div>
  </header>

  <section class="headline">
    <div class="card callout bad">
      <h2>Bottom line</h2>
      <p class="lead"><b>The US problem is market formation, not an economy-wide shortage of demand.</b> ${us.emptyCells} of ${us.stateSectorCells} production cells were empty in the production snapshot, spread across ${us.statesWithEmptyCells} of ${us.states} states. All ${us.facilityReadyEmptyCells} empty cells passed the engine's demand-headroom test for at least one facility. The matched trial confirms that candidate allocation, not insufficient entry funding or low national demand, is the immediate binding margin.</p>
      <p>Economically, a zero-firm cell is an ${jargon("extensive", "extensive-margin outcome")}: whether a market exists at all. It is not evidence that the desired amount of output is zero. The permanent entry funnel now records why each observed NPP entrant does or does not form.</p>
    </div>
    <div class="card callout good">
      <h2>What changed</h2>
      <p>Production commit <code>${p.productionCommit}</code> ships the complete guarded batch. The capped frontier-entry rule passed its ${trial.turns}-turn coverage and aggregate guardrails. Fragile supply, sovereign access, and equity quoting are live with explicit governance records, tracker baselines, and one-switch rollback.</p>
      <p class="small">Program: <a href="https://github.com/Egg3901/AHDGame/issues/${p.issue}" target="_blank" rel="noopener">issue #${p.issue}</a>. Final evidence: <a href="https://github.com/Egg3901/AHDGame/pull/${p.finalEvidencePullRequest}" target="_blank" rel="noopener">PR #${p.finalEvidencePullRequest}</a>. Measurement: <a href="https://github.com/Egg3901/AHDGame/pull/${p.marketFormationPullRequest}" target="_blank" rel="noopener">PR #${p.marketFormationPullRequest}</a>. Coverage treatment: <a href="https://github.com/Egg3901/AHDGame/pull/${p.marketCoveragePullRequest}" target="_blank" rel="noopener">PR #${p.marketCoveragePullRequest}</a>.</p>
    </div>
  </section>

  <div class="tiles">
    <div class="tile"><div class="v">${baseline.usFacilityReadyEmptyCells}</div><div class="l">US facility-ready empty baseline</div></div>
    <div class="tile"><div class="v">${pct(baseline.sovereignNoHolderPct)}</div><div class="l">Sovereign issues without holders</div></div>
    <div class="tile"><div class="v">${pct(baseline.activeTradedListingsPct)}</div><div class="l">Listings recently traded</div></div>
    <div class="tile"><div class="v">${pct(baseline.twoSidedListingsPct)}</div><div class="l">Listings with two-sided books</div></div>
  </div>

  <section class="section">
    <h2>Production rollout ledger</h2>
    <div class="card callout good">
      <h3>Decision: SHIP, MEASURE, AND REVERSE IF NEEDED</h3>
      <p class="lead">The release basis is proportional to the change: focused tests, bounded live-data checks, default-off switches, preserved accounting and financing constraints, and a production tracker. No unfinished worldsim is treated as evidence. The stopped seven-turn diagnostic is retained for engineering audit only.</p>
      <p>Release <a href="https://github.com/Egg3901/AHDGame/pull/${rollout.releasePullRequest}" target="_blank" rel="noopener">PR #${rollout.releasePullRequest}</a> activates review from turn ${rollout.activatedAtTurn}; scheduled assessment is turn ${rollout.reviewTurn}. A guardrail breach can disable the responsible mechanism without reverting the measurement layer.</p>
    </div>
    <div class="grid2" style="margin-top:16px">
      ${rollout.changes
        .map(
          (change) =>
            `<div class="card"><h3>${change.name} <span class="badge ok">live</span></h3><p>${change.effect}</p><p class="small"><a href="https://github.com/Egg3901/AHDGame/pull/${change.pullRequest}" target="_blank" rel="noopener">Implementation PR #${change.pullRequest}</a></p><p class="note"><b>Rollback:</b> ${change.rollback}</p></div>`,
        )
        .join("")}
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="card">
        <h3>Turn ${rollout.activatedAtTurn} before-values</h3>
        <table><tbody>
          <tr><td>World facility-ready empty cells</td><td class="num">${baseline.worldFacilityReadyEmptyCells.toLocaleString()}</td></tr>
          <tr><td>US facility-ready empty cells</td><td class="num">${baseline.usFacilityReadyEmptyCells}</td></tr>
          <tr><td>Pooled goods fill</td><td class="num">${pct(baseline.pooledFillPct, 2)}</td></tr>
          <tr><td>Country-scoped fill</td><td class="num">${pct(baseline.countryFillPct, 2)}</td></tr>
          <tr><td>Staffing</td><td class="num">${pct(baseline.staffingPct, 2)}</td></tr>
          <tr><td>High-concentration low-fill markets</td><td class="num">${pct(baseline.highConcentrationLowFillPct, 2)}</td></tr>
          <tr><td>Sovereign issues without a holder</td><td class="num">${pct(baseline.sovereignNoHolderPct, 2)}</td></tr>
          <tr><td>Recently traded listings</td><td class="num">${pct(baseline.activeTradedListingsPct, 2)}</td></tr>
          <tr><td>Two-sided listings</td><td class="num">${pct(baseline.twoSidedListingsPct, 2)}</td></tr>
          <tr><td>Order-book depth / market cap</td><td class="num">${pct(baseline.depthToMarketCapPct, 2)}</td></tr>
        </tbody></table>
      </div>
      <div class="card">
        <h3>What should change next</h3>
        <ol>${rollout.expectedSignature.map((item) => `<li>${item}</li>`).join("")}</ol>
        <p class="note"><b>Interpretation rule:</b> production movement is evidence for continuation or rollback, not a promise that every threshold will be reached immediately.</p>
      </div>
    </div>
  </section>

  <section class="section">
    <h2>Delivery record</h2>
    <div class="card">
      <table><thead><tr><th>Control</th><th>Status</th><th>Evidence</th></tr></thead><tbody>
      ${p.controls.map((x) => `<tr><td><b>${x.name}</b></td><td><span class="badge ${statusClass(x.status)}">${x.status}</span></td><td>${x.detail}</td></tr>`).join("")}
      </tbody></table>
      <div class="note"><b>Why holding controls off is progress:</b> the experiment framework stopped plausible but weak interventions from becoming permanent rules. Conservation is necessary, but an economically immaterial change does not earn activation.</div>
    </div>
  </section>

  <section class="section">
    <h2>Matched market-formation trial</h2>
    <div class="card callout good">
      <h3>Decision: ${trial.gate.overall.toUpperCase()}</h3>
      <p class="lead">The treatment changed only where an already eligible NPP entrant looked first. It did not increase the entry cohort, waive profitability, reduce founding cost, relax logistics, add credit, or guarantee survival. Relative to control, it reduced US facility-ready empty cells by <b>${Math.abs(trial.effects.usFacilityReadyEmptyCellDifference)} cells</b>, equal to <b>${Math.abs(trial.effects.usFacilityReadyEmptyPointDifference).toFixed(1)} percentage points</b> of the ${us.stateSectorCells}-cell US market universe.</p>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="card">
        <h3>Coverage outcomes</h3>
        <table><thead><tr><th>Metric</th><th class="num">Control</th><th class="num">Treatment</th><th class="num">Difference</th></tr></thead><tbody>
          <tr><td>Global empty cells, end</td><td class="num">${trial.control.end.emptyCells}</td><td class="num">${trial.treatment.end.emptyCells}</td><td class="num">${trial.effects.globalEmptyCellDifference}</td></tr>
          <tr><td>Global facility-ready empties, end</td><td class="num">${trial.control.end.facilityReadyEmptyCells}</td><td class="num">${trial.treatment.end.facilityReadyEmptyCells}</td><td class="num">${trial.effects.globalFacilityReadyEmptyCellDifference}</td></tr>
          <tr><td>US empty cells, end</td><td class="num">${trial.control.end.usEmptyCells}</td><td class="num">${trial.treatment.end.usEmptyCells}</td><td class="num">${trial.effects.usEmptyCellDifference}</td></tr>
          <tr><td>US facility-ready empties, end</td><td class="num">${trial.control.end.usFacilityReadyEmptyCells}</td><td class="num">${trial.treatment.end.usFacilityReadyEmptyCells}</td><td class="num">${trial.effects.usFacilityReadyEmptyCellDifference}</td></tr>
          <tr><td>Gross entries</td><td class="num">${trial.control.totals.entered.toLocaleString()}</td><td class="num">${trial.treatment.totals.entered.toLocaleString()}</td><td class="num">${trial.effects.entryDifference}</td></tr>
        </tbody></table>
        <p class="small">Both arms begin from the same live clone and run turns ${trial.startTurn} to ${trial.endTurn}. Negative coverage differences mean fewer empty markets under treatment.</p>
      </div>
      <div class="card">
        <h3>Guardrails, turn means</h3>
        <table><thead><tr><th>Metric</th><th class="num">Control</th><th class="num">Treatment</th><th class="num">Change</th></tr></thead><tbody>
          <tr><td>Pooled fill</td><td class="num">${pct(trial.control.means.pooledFillPct, 2)}</td><td class="num">${pct(trial.treatment.means.pooledFillPct, 2)}</td><td class="num">${trial.effects.pooledFillPointChange.toFixed(2)} pts</td></tr>
          <tr><td>Country fill</td><td class="num">${pct(trial.control.means.countryFillPct, 2)}</td><td class="num">${pct(trial.treatment.means.countryFillPct, 2)}</td><td class="num">${trial.effects.countryFillPointChange.toFixed(2)} pts</td></tr>
          <tr><td>Intent fill</td><td class="num">${pct(trial.control.means.intentFillPct, 2)}</td><td class="num">${pct(trial.treatment.means.intentFillPct, 2)}</td><td class="num">${trial.effects.intentFillPointChange.toFixed(2)} pts</td></tr>
          <tr><td>Sell-through</td><td class="num">${pct(trial.control.means.sellThroughPct, 2)}</td><td class="num">${pct(trial.treatment.means.sellThroughPct, 2)}</td><td class="num">${trial.effects.sellThroughPointChange.toFixed(2)} pts</td></tr>
          <tr><td>Staffing</td><td class="num">${pct(trial.control.means.staffingPct, 2)}</td><td class="num">${pct(trial.treatment.means.staffingPct, 2)}</td><td class="num">${trial.effects.staffingPointChange.toFixed(2)} pts</td></tr>
        </tbody></table>
        <p class="small">Trial balance remained at zero unbalanced currencies in both arms. Stock-flow findings are reported separately because that subsystem is still amber.</p>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Fragile commodity cross-check</h3>
      <table><thead><tr><th>Commodity</th><th class="num">Control fill</th><th class="num">Treatment fill</th><th class="num">Control sellers</th><th class="num">Treatment sellers</th><th>Result</th></tr></thead><tbody>
        ${trial.fragileMarkets.map((row) => `<tr><td>${row.commodity}</td><td class="num">${pct(row.controlFillPct, 2)}</td><td class="num">${pct(row.treatmentFillPct, 2)}</td><td class="num">${row.controlSellers}</td><td class="num">${row.treatmentSellers}</td><td>${row.result}</td></tr>`).join("")}
      </tbody></table>
      <p class="note"><b>Stress gate remains open:</b> removing the largest advertising supplier still produces a critical result. Treatment improves stressed fill from ${pct(trial.stress.controlStressedAdvertisingFillPct, 2)} to ${pct(trial.stress.treatmentStressedAdvertisingFillPct, 2)} and reduces unmet units by ${((1 - trial.stress.treatmentUnmetAdvertisingUnits / trial.stress.controlUnmetAdvertisingUnits) * 100).toFixed(1)}%, but it does not remove the single-supplier exposure. This needs a commodity-specific capacity and ownership treatment.</p>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>What the funnel proved</h3>
      <p>The control recorded ${trial.control.totals.entered.toLocaleString()} entries, or ${trial.control.means.enteredPerTurn.toFixed(1)} per turn, while empty markets increased. The problem was not a lack of entrepreneurial events. It was a ${jargon("revealed", "revealed-preference problem")} in the candidate-ranking rule: firms kept choosing occupied markets whose current signals were strongest, leaving viable empty markets outside the search path.</p>
      <p>The treatment is therefore a narrow information and allocation correction. It creates no free capital and no artificial demand. Failure and exit remain possible after entry.</p>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="card">
        <h3>Empty-market classification, endpoint</h3>
        <table><thead><tr><th>Classification</th><th class="num">Control</th><th class="num">Treatment</th></tr></thead><tbody>
          ${Object.entries(classificationLabels)
            .map(
              ([key, label]) =>
                `<tr><td>${label}</td><td class="num">${trial.control.end.classifications[key]}</td><td class="num">${trial.treatment.end.classifications[key]}</td></tr>`,
            )
            .join("")}
        </tbody></table>
      </div>
      <div class="card">
        <h3>Control entry outcomes, 48 turns</h3>
        <table><thead><tr><th>Exclusive outcome</th><th class="num">Count</th></tr></thead><tbody>
          ${Object.entries(trial.control.totals.reasons)
            .sort((a, b) => b[1] - a[1])
            .map(
              ([key, value]) =>
                `<tr><td>${reasonLabels[key] ?? key}</td><td class="num">${value.toLocaleString()}</td></tr>`,
            )
            .join("")}
        </tbody></table>
        <p class="small">Each observed corporation receives one outcome per turn. Cohort ineligibility is expected under the one-in-eight entry cap.</p>
      </div>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="card">
        <h3>What should change in production</h3>
        <ul>
          <li>The first visible change should be a shift in the destination of NPP entries, not a large increase in the number of entries.</li>
          <li>Facility-ready empty cells should begin falling within 12 turns and improve by at least 10 percentage points by the 48-turn review.</li>
          <li>New local facilities should appear first in states and sectors with positive headroom but no incumbent, including telecommunications, automobiles, media, construction, healthcare, and finance.</li>
          <li>Local output and supplier breadth should follow with a lag as facilities staff and produce. Resident demand should not jump merely because the rule is enabled.</li>
        </ul>
      </div>
      <div class="card">
        <h3>What should not change</h3>
        <ul>
          <li>Gross entry should stay near the established cohort-limited range. A surge would indicate an accidental relaxation of the entry cap.</li>
          <li>Import-served and fundamental-zero cells may remain empty. The objective is viable missing production, not one firm in every cell.</li>
          <li>Pooled fill, country fill, staffing, sell-through, trial balance, and money attribution must remain inside their registered guardrails.</li>
          <li>The rule does not solve thin equity books, unheld sovereign issues, or stock-flow divergences. Those remain separate mechanisms and gates.</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="section">
    <h2>What the six-arm trial established</h2>
    <div class="grid3">
      <div class="card"><h3>Real-goods control</h3><table><tbody><tr><td>Pooled fill</td><td class="num">${pct(sim.control.pooledFillPct)}</td></tr><tr><td>Country fill</td><td class="num">${pct(sim.control.countryFillPct)}</td></tr><tr><td>Intent fill</td><td class="num">${pct(sim.control.intentFillPct)}</td></tr><tr><td>Nonlocal sourcing</td><td class="num">${pct(sim.control.nonlocalSourcingPct)}</td></tr><tr><td>Sell-through</td><td class="num">${pct(sim.control.sellThroughPct)}</td></tr><tr><td>Staffing</td><td class="num">${pct(sim.control.staffingPct)}</td></tr></tbody></table></div>
      <div class="card"><h3>Securities remain thin</h3><table><tbody><tr><td>Listings that traded</td><td class="num">${pct(sim.securities.activeListingsPct)}</td></tr><tr><td>Two-sided books</td><td class="num">${pct(sim.securities.twoSidedBooksPct)}</td></tr><tr><td>Depth / market cap</td><td class="num">${pct(sim.securities.depthToMarketCapPct, 2)}</td></tr></tbody></table><p class="small">The bond intervention helped but did not restore broad holder demand.</p></div>
      <div class="card"><h3>Accounting confidence</h3><table><tbody><tr><td>Trial balance</td><td><span class="badge ok">${sim.accounting.trialBalance}</span></td></tr><tr><td>Money attribution</td><td><span class="badge ok">${sim.accounting.moneyAttribution}</span></td></tr><tr><td>${jargon("stockflow", "Stock-flow")}</td><td><span class="badge hold">${sim.accounting.stockFlow}</span></td></tr></tbody></table><p class="small">Monetary experiments remain subordinate to closing stock-flow divergences.</p></div>
    </div>
  </section>

  <section class="section">
    <h2>The US coverage gap</h2>
    <div class="grid2">
      <div class="card"><h3>Empty cells by sector</h3>${us.emptyCellsBySector.map(([name, value]) => `<div class="barrow"><span>${name}</span><span class="bar"><i style="width:${(value / us.emptyCellsBySector[0][1]) * 100}%"></i></span><b>${value}</b></div>`).join("")}</div>
      <div class="card"><h3>States with the broadest gaps</h3>${us.statesWithMostEmptyCells.map(([name, value]) => `<div class="barrow"><span>${name}</span><span class="bar"><i style="width:${(value / 13) * 100}%"></i></span><b>${value}</b></div>`).join("")}<p class="small">These counts describe missing local firm presence, not unmet resident consumption by themselves.</p></div>
    </div>
    <div class="card callout" style="margin-top:16px">
      <h3>Outside-economic reading</h3>
      <p>Complementary sectors can fail to appear when no single firm expects the surrounding suppliers, customers, logistics, and workforce to appear first. Classic big-push research describes cases in which simultaneous industrialization can be profitable even though no sector can break even alone.<a href="#source-9">[9]</a> Place-based research similarly notes that a firm can avoid moving where it would lose cluster benefits.<a href="#source-10">[10]</a></p>
      <p>That mechanism fits the evidence better than a simple demand-floor story. The empty markets include services and industries with positive facility-scale headroom. The trial shows that the binding gate is candidate allocation: eligible firms repeatedly rank occupied markets ahead of viable missing ones.</p>
    </div>
  </section>

  <section class="section">
    <h2>US demand: low in some states, not low as a country</h2>
    <div class="tiles">
      <div class="tile"><div class="v">${demand.populationSharePct.toFixed(1)}%</div><div class="l">World population share</div></div>
      <div class="tile"><div class="v">${demand.worldBaseValueDemandSharePct.toFixed(1)}%</div><div class="l">World demand value share</div></div>
      <div class="tile"><div class="v">${demand.usStatesBelowNonUsAbsoluteMedian}</div><div class="l">US states below foreign absolute median</div></div>
      <div class="tile"><div class="v">${demand.usStatesBelowNonUsPerCapitaMedian}</div><div class="l">US states below foreign per-capita median</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Correct interpretation</h3><p>The user's visual comparison is real in absolute terms: ${demand.usStatesBelowNonUsRawUnitMedian} US states sit below the non-US median in raw units and ${demand.usStatesBelowNonUsAbsoluteMedian} sit below it in base-price-weighted value. Small-state scale explains much of that pattern. Per capita, only ${demand.usStatesBelowNonUsPerCapitaMedian} US states fall below the non-US median.</p><p>Consumer expenditure should be assigned to where residents live, then separated from what local producers can capture.<a href="#source-11">[11]</a> Comparing local firms with resident demand without accounting for imports creates a false diagnosis.</p></div>
      <div class="card"><h3>Demand account to build</h3><p><b>Gross local use</b> = household final demand + government demand + investment demand + intermediate business demand.</p><p><b>Local output absorption</b> = gross local use - inbound supply + outbound sales +/- inventory change.</p><p>Regional input-output methods explicitly treat investment and household purchases as final-demand changes,<a href="#source-12">[12]</a> while historical business-pattern data support employment and payroll-based intermediate-demand allocation.<a href="#source-13">[13]</a></p></div>
    </div>
  </section>

  <section class="section">
    <h2>What the tracker owns next</h2>
    <div class="card">
      ${data.nextActions.map((x) => `<div class="priority"><div class="rank">${x.priority}</div><div><b>${x.change}</b></div><div><b>Measure</b>${x.measure}</div><div><b>Activation gate</b>${x.gate}</div></div>`).join("")}
    </div>
    <div class="card" style="margin-top:16px"><h3>Open implementation tracks</h3><ul>${data.trackingIssues.map(([number, label]) => `<li>${issue(number, label)}</li>`).join("")}</ul></div>
  </section>

  <section class="section">
    <h2>Recommended change sequence</h2>
    <div class="card">
      <ol>
        <li><b>Observe rejection before relaxing gates.</b> Add a per-turn NPP entry funnel with one exclusive reason code per rejected opportunity.</li>
        <li><b>Classify empty markets.</b> Separate fundamental zero, import-served, unserved, entry gap, coordination gap, and data zero.</li>
        <li><b>Run a capped frontier-entry trial.</b> Use real financing and facility costs, stagger entry, preserve planned-economy rules, and permit failure.</li>
        <li><b>Calibrate regional demand independently.</b> Do not infer demand from existing firms, since doing so makes empty markets look demandless by construction.</li>
        <li><b>Keep the failed broad levers off.</b> Rework adaptive sourcing, freight billing, and securities support only against named mechanisms and preregistered gates.</li>
      </ol>
    </div>
  </section>

  <section class="section">
    <h2>Sources</h2>
    <div class="card"><ol class="source-list">
      <li id="source-9">Murphy, Shleifer, and Vishny. <a href="https://www.journals.uchicago.edu/doi/10.1086/261641" target="_blank" rel="noopener">Industrialization and the Big Push</a>.</li>
      <li id="source-10">OECD. <a href="https://www.oecd.org/en/publications/place-based-policies-for-the-future_e5ff6716-en/full-report/the-case-for-place-based-policies_866a9f45.html" target="_blank" rel="noopener">The case for place-based policies</a>.</li>
      <li id="source-11">US Bureau of Economic Analysis. <a href="https://www.bea.gov/sites/default/files/2024-11/BEA-PCE-by-State-Concepts-and-Methods.pdf" target="_blank" rel="noopener">Personal Consumption Expenditures by State: Concepts, Data Sources, and Statistical Methods</a>.</li>
      <li id="source-12">US Bureau of Economic Analysis. <a href="https://www.bea.gov/sites/default/files/methodologies/RIMSII_User_Guide.pdf" target="_blank" rel="noopener">RIMS II User Guide</a>.</li>
      <li id="source-13">US Census Bureau. <a href="https://www2.census.gov/econ2007/Reference_materials/htm%20files/cbidesc.htm" target="_blank" rel="noopener">Historical County Business Patterns Data</a>.</li>
    </ol><p class="small">Local evidence is a read-only turn 445 production baseline, the completed six-arm control set, the matched 48-turn coverage trial, and focused implementation checks. Counts and rollout decisions are frozen in the accompanying JSON for reproducibility.</p></div>
  </section>

  <p class="footer">Economy market program update, turn ${data.turn}. Operations research report prepared ${data.asOf}. Wavy-underlined terms have plain-language definitions.</p>
</main>
<div class="tip" id="tip"></div>
<script>
const definitions={
  coordination:{term:'Coordination failure',def:'A market can remain empty when each potential entrant waits for complementary suppliers, customers, logistics, or workers to arrive first.'},
  extensive:{term:'Extensive margin',def:'The decision about whether an activity exists at all. Here it means whether any active firm operates in a state-sector cell.'},
  stockflow:{term:'Stock-flow reconciliation',def:'A check that changes in balances between two observations are explained by recorded transactions during the interval.'},
  revealed:{term:'Revealed preference',def:'A conclusion drawn from actual choices. Here, the ranking rule showed what it favored by repeatedly selecting occupied markets.'}
};
const tip=document.getElementById('tip');
document.querySelectorAll('[data-jg]').forEach(function(el){
  function show(){const d=definitions[el.dataset.jg];if(!d)return;tip.innerHTML='<b>'+d.term+'</b>'+d.def;tip.style.display='block';const r=el.getBoundingClientRect();tip.style.left=Math.min(window.innerWidth-335,Math.max(8,r.left))+'px';tip.style.top=Math.min(window.innerHeight-tip.offsetHeight-8,r.bottom+8)+'px'}
  function hide(){tip.style.display='none'}
  el.addEventListener('mouseenter',show);el.addEventListener('focus',show);el.addEventListener('click',show);el.addEventListener('mouseleave',hide);el.addEventListener('blur',hide);
});
</script>
</body>
</html>`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
process.stdout.write(`${output}\n`);
