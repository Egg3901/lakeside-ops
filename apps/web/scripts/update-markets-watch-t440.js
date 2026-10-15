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
const trial = data.marketFormationTrial;
const source =
  process.argv[2] ||
  "/root/projects/LSGD-ops-dash/reports/published/markets-watch.html";
const output =
  process.argv[3] || path.join(ROOT, "reports", "markets-watch-t440.html");

let html = fs.readFileSync(source, "utf8");
const sourceIsV46 = html.includes("data through turn 389");
const sourceIsV50 = html.includes("data through turn 440") && html.includes('id="t440-update"');
if ((!sourceIsV46 && !sourceIsV50) || !html.includes('class="tabs"')) {
  throw new Error("Markets Watch source does not match the expected v4.6 or v5.0 shape");
}

const oldHeading =
  '<h1>Markets Watch <span class="badge crit">NOT WORKING</span> <span class="badge warnb">PLAN REVISED</span> <span class="badge stale">LIVING TRACKER</span></h1>';
const newHeading =
  '<h1>Markets Watch <span class="badge ok">CORE PROGRAM LIVE</span> <span class="badge ok">COVERAGE FIX VALIDATED</span> <span class="badge stale">LIVING TRACKER</span></h1>';
html = html.replace(oldHeading, newHeading).replace(
  '<h1>Markets Watch <span class="badge ok">CORE PROGRAM LIVE</span> <span class="badge crit">ENTRY GAP OPEN</span> <span class="badge stale">LIVING TRACKER</span></h1>',
  newHeading,
);

html = html.replace(
  /<div class="sub">A House Divided prod &middot; updated [^<]*?(?:v4\.6|v5\.0)\.[\s\S]*?<\/div>\n/,
  `<div class="sub">A House Divided prod &middot; updated ${data.asOf} &middot; production data through turn ${data.turn}, matched clone evidence through turn ${trial.endTurn} &middot; v5.1. The core P0-P7 measurement, experiment-governance, and stress program is in production. Final evidence is live at commit ${data.program.productionCommit}. The US coverage diagnosis is now causal rather than descriptive: the baseline generated ${trial.control.totals.entered.toLocaleString()} entries across ${trial.turns} turns but ended with more empty markets because entrants repeatedly selected occupied high-scoring cells. Redirecting the existing eligible entry slot toward facility-ready empty cells cut US facility-ready empties by ${Math.abs(trial.effects.usFacilityReadyEmptyCellDifference)} cells relative to control without raising the entry cap or weakening the fill, staffing, sell-through, or trial-balance guardrails. Prepared by Fable and Codex. Wavy-underlined terms pop up a plain-language definition on hover or tap (<span style="text-decoration:underline wavy #2a78d6;text-underline-offset:3px">blue = game term</span>, <span style="text-decoration:underline wavy #1baf7a;text-underline-offset:3px">green = economics</span>), with a link to read more.</div>\n`,
);

const update = `
<section id="t440-update" style="margin:18px 0 22px">
  <div class="callout good"><b>MATCHED TRIAL RESULT</b><br>The coverage fix passed its coverage and aggregate guardrails. It changes candidate allocation, not funding or the entry cap: an already eligible NPP entrant first considers a viable empty market instead of defaulting to an occupied cell with the strongest current signal. US facility-ready empty cells ended ${Math.abs(trial.effects.usFacilityReadyEmptyCellDifference)} lower than control, a ${Math.abs(trial.effects.usFacilityReadyEmptyPointDifference).toFixed(1)}-point improvement across the 869-cell US market universe.</div>
  <div class="kpis" style="margin-top:12px">
    <div class="kpi"><span class="v">${trial.control.end.usFacilityReadyEmptyCells}</span><span class="l">Control US facility-ready empties</span><span class="n">End of turn ${trial.endTurn}</span></div>
    <div class="kpi"><span class="v">${trial.treatment.end.usFacilityReadyEmptyCells}</span><span class="l">Treatment US facility-ready empties</span><span class="n">Same start and ${trial.turns}-turn horizon</span></div>
    <div class="kpi"><span class="v">${trial.treatment.totals.entered.toLocaleString()}</span><span class="l">Treatment gross entries</span><span class="n">Control: ${trial.control.totals.entered.toLocaleString()}</span></div>
    <div class="kpi"><span class="v">${trial.effects.usFacilityReadyEmptyPointDifference.toFixed(1)} pts</span><span class="l">US coverage difference</span><span class="n">Negative means fewer empty markets</span></div>
  </div>
  <div class="grid2" style="margin-top:12px">
    <div class="card">
      <h3>What shipped</h3>
      <ul>
        <li>Core P0-P7 market observability, intervention governance, concentration controls, and systemic stress tooling are in production through <a href="https://github.com/Egg3901/AHDGame/pull/973" target="_blank" rel="noopener">#973</a>.</li>
        <li>A six-arm, 48-turn clone experiment established a stable control: 83.41% pooled fill, 73.50% country fill, 62.74% intent fill, 25.78% nonlocal sourcing, 90.81% sell-through, and 93.35% staffing.</li>
        <li>Trial balance and money attribution are green. Stock-flow reconciliation remains amber and correctly blocks broad monetary intervention.</li>
        <li>Final baseline-retention and reproducibility fixes are live through <a href="https://github.com/Egg3901/AHDGame/pull/1002" target="_blank" rel="noopener">#1002</a>.</li>
        <li>The state-sector coverage account and exclusive entry funnel are in <a href="https://github.com/Egg3901/AHDGame/pull/${data.program.marketFormationPullRequest}" target="_blank" rel="noopener">#${data.program.marketFormationPullRequest}</a>.</li>
        <li>The capped market-coverage treatment and its governance flag are in <a href="https://github.com/Egg3901/AHDGame/pull/${data.program.marketCoveragePullRequest}" target="_blank" rel="noopener">#${data.program.marketCoveragePullRequest}</a>.</li>
      </ul>
    </div>
    <div class="card">
      <h3>What did not activate</h3>
      <ul>
        <li><b>Adaptive sourcing:</b> +0.19 percentage points pooled fill and +0.52 points intent fill, below the 5-point gate.</li>
        <li><b>Canonical freight billing:</b> conserved money to the cent but produced -0.15 points pooled fill and +0.27 points intent fill.</li>
        <li><b>Sovereign bond target:</b> cut no-holder issues from 76.92% to 56.17%, missing the below-35% gate.</li>
      </ul>
      <p class="note"><b>Verdict:</b> leaving these flags off is the correct result. Each needs a narrower mechanism, not a lower success threshold.</p>
    </div>
  </div>
  <div class="card" style="margin-top:12px">
    <h3>Matched 48-turn market-formation evidence</h3>
    <table><thead><tr><th>Metric</th><th class="num">Control</th><th class="num">Treatment</th><th class="num">Difference</th></tr></thead><tbody>
      <tr><td>Global empty cells, end</td><td class="num">${trial.control.end.emptyCells}</td><td class="num">${trial.treatment.end.emptyCells}</td><td class="num">${trial.effects.globalEmptyCellDifference}</td></tr>
      <tr><td>US facility-ready empty cells, end</td><td class="num">${trial.control.end.usFacilityReadyEmptyCells}</td><td class="num">${trial.treatment.end.usFacilityReadyEmptyCells}</td><td class="num">${trial.effects.usFacilityReadyEmptyCellDifference}</td></tr>
      <tr><td>Mean pooled fill</td><td class="num">${trial.control.means.pooledFillPct.toFixed(2)}%</td><td class="num">${trial.treatment.means.pooledFillPct.toFixed(2)}%</td><td class="num">${trial.effects.pooledFillPointChange.toFixed(2)} pts</td></tr>
      <tr><td>Mean country fill</td><td class="num">${trial.control.means.countryFillPct.toFixed(2)}%</td><td class="num">${trial.treatment.means.countryFillPct.toFixed(2)}%</td><td class="num">${trial.effects.countryFillPointChange.toFixed(2)} pts</td></tr>
      <tr><td>Mean sell-through</td><td class="num">${trial.control.means.sellThroughPct.toFixed(2)}%</td><td class="num">${trial.treatment.means.sellThroughPct.toFixed(2)}%</td><td class="num">${trial.effects.sellThroughPointChange.toFixed(2)} pts</td></tr>
      <tr><td>Mean staffing</td><td class="num">${trial.control.means.staffingPct.toFixed(2)}%</td><td class="num">${trial.treatment.means.staffingPct.toFixed(2)}%</td><td class="num">${trial.effects.staffingPointChange.toFixed(2)} pts</td></tr>
    </tbody></table>
    <p class="note"><b>Interpretation:</b> the baseline had plenty of entry events but poor search coverage. This is a market-discovery failure. The validated change redirects scarce entrepreneurial attention toward viable missing markets while preserving real founding costs, profitability screens, logistics, cohort caps, and failure risk.</p>
    <p class="note"><b>Open resilience gate:</b> advertising fill improves from ${trial.fragileMarkets[0].controlFillPct.toFixed(2)}% to ${trial.fragileMarkets[0].treatmentFillPct.toFixed(2)}% and sellers rise from ${trial.fragileMarkets[0].controlSellers} to ${trial.fragileMarkets[0].treatmentSellers}, but removing the largest advertising supplier still leaves only ${trial.stress.treatmentStressedAdvertisingFillPct.toFixed(2)}% stressed fill. Freight and rare-earth breadth also fail to improve. Coverage delivery can proceed behind governance, but commodity-specific resilience remains open.</p>
  </div>
  <div class="grid2" style="margin-top:12px">
    <div class="card">
      <h3>Expected production signature</h3>
      <ul>
        <li>The destination mix of NPP entry changes first. Gross entry volume should remain near the control range.</li>
        <li>Facility-ready empty cells begin falling within 12 turns and improve by at least 10 points by the turn-48 review.</li>
        <li>Facilities, staffing, local output, and supplier breadth follow in that order. Demand itself should not jump on activation.</li>
        <li>Import-served and fundamental-zero cells can remain empty. Universal local production is not the objective.</li>
      </ul>
    </div>
    <div class="card">
      <h3>Rollback signature</h3>
      <ul>
        <li>An entry-volume surge indicates that the cohort cap was bypassed.</li>
        <li>A material fall in pooled fill, country fill, staffing, or sell-through fails the economic guardrail.</li>
        <li>Any trial-balance break or worsening money-attribution result fails the accounting guardrail.</li>
        <li>Equity depth, sovereign breadth, and stock-flow reconciliation remain separate open tracks and are not credited to this fix.</li>
      </ul>
    </div>
  </div>
  <div class="grid2" style="margin-top:12px">
    <div class="card">
      <h3>US demand correction</h3>
      <p>Some US states are small in absolute demand: 12 fall below the non-US median in base-price-weighted value and 16 in raw units. That does not add up to weak US demand nationally. The US holds 45.59% of world demand value with 11.50% of population, and only two US states fall below the non-US median per capita.</p>
      <p>The right split is resident demand versus local-producer demand. A state can have residents consuming imported goods while showing no local firm. BEA's state consumer-spending method assigns out-of-state purchases to the buyer's state of residence. <a href="https://www.bea.gov/sites/default/files/2024-11/BEA-PCE-by-State-Concepts-and-Methods.pdf" target="_blank" rel="noopener">Method source</a>.</p>
    </div>
    <div class="card">
      <h3>Next market changes</h3>
      <ol>
        <li>Keep the <span class="jg game" data-jg="npp" tabindex="0">NPP</span> entry funnel and state-sector classifications as permanent vital signs.</li>
        <li>Stage the validated coverage rule behind its governance record, then observe the same coverage and guardrail series for 48 production turns.</li>
        <li>Roll back if pooled fill, country fill, staffing, sell-through, or accounting crosses its preregistered boundary.</li>
        <li>Build an independent regional-use account: household + government + investment + intermediate demand, adjusted for trade and inventories.</li>
        <li>Continue the separate equity, bond, and stock-flow tracks in <a href="https://github.com/Egg3901/AHDGame/issues/990" target="_blank" rel="noopener">#990</a>, <a href="https://github.com/Egg3901/AHDGame/issues/991" target="_blank" rel="noopener">#991</a>, <a href="https://github.com/Egg3901/AHDGame/issues/992" target="_blank" rel="noopener">#992</a>, and <a href="https://github.com/Egg3901/AHDGame/issues/1001" target="_blank" rel="noopener">#1001</a>.</li>
      </ol>
    </div>
  </div>
  <p class="note"><b>Economic frame:</b> an empty market is an extensive-margin outcome, not proof of zero demand. Complementary sectors may fail to enter one by one even when coordinated entry would be profitable. See Murphy, Shleifer, and Vishny's <a href="https://www.journals.uchicago.edu/doi/10.1086/261641" target="_blank" rel="noopener">Industrialization and the Big Push</a> and the OECD's <a href="https://www.oecd.org/en/publications/place-based-policies-for-the-future_e5ff6716-en/full-report/the-case-for-place-based-policies_866a9f45.html" target="_blank" rel="noopener">case for place-based policy</a>.</p>
</section>
`;

if (sourceIsV50) {
  html = html.replace(
    /<section id="t440-update"[\s\S]*?<\/section>\n<div class="tabs">/,
    `${update}<div class="tabs">`,
  );
} else {
  html = html.replace('<div class="tabs">', `${update}<div class="tabs">`);
}
html = html.replace(
  "Markets Watch v4.6: Fable, 2026-08-25, turn 389.",
  `Markets Watch v5.1: Fable and Codex, ${data.asOf}, production turn ${data.turn}, matched clone through turn ${trial.endTurn}.`,
);
html = html.replace(
  "Markets Watch v5.0: Fable and Codex, 2026-08-28, turn 440.",
  `Markets Watch v5.1: Fable and Codex, ${data.asOf}, production turn ${data.turn}, matched clone through turn ${trial.endTurn}.`,
);
html = html.replace(
  "deployed source, support queue, community archive.</p>",
  "deployed source, support queue, community archive, plus the matched market-formation control and treatment databases for turns 442-489.</p>",
);

if (!html.includes("MATCHED TRIAL RESULT") || !html.includes("Markets Watch v5.1")) {
  throw new Error("Turn 440 update was not fully applied");
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
process.stdout.write(`${output}\n`);
