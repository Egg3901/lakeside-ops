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
const rollout = data.productionRollout;
const baseline = rollout.baseline;
const source =
  process.argv[2] ||
  "/root/projects/LSGD-ops-dash/reports/published/markets-watch.html";
const output =
  process.argv[3] || path.join(ROOT, "reports", "markets-watch-t445.html");

let html = fs.readFileSync(source, "utf8");
if (
  !html.includes("Markets Watch v5.1") ||
  !html.includes('id="t440-update"') ||
  !html.includes('class="tabs"')
) {
  throw new Error(
    "Markets Watch source does not match the expected v5.1 shape",
  );
}

html = html.replace(
  "</style>",
  `.rollout-kpis,.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:12px 0}.rollout-kpi,.kpi{background:var(--surface-1);border:1px solid var(--ring);border-radius:10px;padding:13px 15px}.rollout-kpi .v,.kpi .v{display:block;font-size:25px;font-weight:650;line-height:1.1}.rollout-kpi .l,.kpi .l{display:block;font-size:12px;color:var(--ink-2);margin-top:4px}.rollout-kpi .n,.kpi .n{display:block;font-size:11.5px;color:var(--ink-3);margin-top:2px}.rollout-grid,.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}.rollout-grid .card,.grid2 .card{margin:0}@media(max-width:760px){.rollout-kpis,.kpis,.rollout-grid,.grid2{grid-template-columns:1fr 1fr}}@media(max-width:480px){.rollout-kpis,.kpis,.rollout-grid,.grid2{grid-template-columns:1fr}}</style>`,
);

html = html.replace(
  '<h1>Markets Watch <span class="badge ok">CORE PROGRAM LIVE</span> <span class="badge ok">COVERAGE FIX VALIDATED</span> <span class="badge stale">LIVING TRACKER</span></h1>',
  '<h1>Markets Watch <span class="badge ok">ECONOMY ROLLOUT LIVE</span> <span class="badge ok">TRACKER ACTIVE</span> <span class="badge stale">LIVING TRACKER</span></h1>',
);
html = html.replace(
  /<div class="sub">A House Divided prod &middot; updated [\s\S]*?v5\.1\.[\s\S]*?<\/div>\n/,
  `<div class="sub">A House Divided prod &middot; updated ${data.asOf} &middot; production baseline turn ${rollout.activatedAtTurn} &middot; v5.2. The complete guarded economy batch is on production commit ${rollout.commit}. Empty-market coverage, fragile-supply routing, sovereign-bond access, and bounded equity quotes are live and reversible. This tracker, not another long worldsim, now decides whether each mechanism continues, changes, or rolls back. Prepared by Fable and Codex. Wavy-underlined terms pop up a plain-language definition on hover or tap (<span style="text-decoration:underline wavy #2a78d6;text-underline-offset:3px">blue = game term</span>, <span style="text-decoration:underline wavy #1baf7a;text-underline-offset:3px">green = economics</span>), with a link to read more.</div>\n`,
);

const rolloutSection = `
<section id="t445-rollout" style="margin:18px 0 22px">
  <div class="callout good"><b>PRODUCTION ROLLOUT ACTIVE</b><br>Four bounded interventions entered production at turn ${rollout.activatedAtTurn}. The causal 48-turn coverage result remains valid: treatment ended with 168 US facility-ready empty cells versus 445 in control without materially raising entry volume. The other mechanisms ship on focused tests, bounded checks, reversible flags, and the live before-values below.</div>
  <div class="rollout-kpis">
    <div class="rollout-kpi"><span class="v">${baseline.usFacilityReadyEmptyCells}</span><span class="l">US facility-ready empties</span><span class="n">Turn ${rollout.activatedAtTurn} baseline</span></div>
    <div class="rollout-kpi"><span class="v">${baseline.sovereignNoHolderPct.toFixed(1)}%</span><span class="l">Sovereign issues unheld</span><span class="n">Bond-access before-value</span></div>
    <div class="rollout-kpi"><span class="v">${baseline.activeTradedListingsPct.toFixed(1)}%</span><span class="l">Listings recently traded</span><span class="n">Equity before-value</span></div>
    <div class="rollout-kpi"><span class="v">${baseline.twoSidedListingsPct.toFixed(1)}%</span><span class="l">Two-sided listings</span><span class="n">Equity before-value</span></div>
  </div>
  <div class="rollout-grid">
    ${rollout.changes
      .map(
        (change) =>
          `<div class="card"><h3>${change.name} <span class="badge ok">live</span></h3><p>${change.effect}</p><p><a href="https://github.com/Egg3901/AHDGame/pull/${change.pullRequest}" target="_blank" rel="noopener">Implementation #${change.pullRequest}</a></p><p class="note"><b>Rollback:</b> ${change.rollback}</p></div>`,
      )
      .join("")}
  </div>
  <div class="rollout-grid">
    <div class="card">
      <h3>Frozen production baseline</h3>
      <table><thead><tr><th>Tracker series</th><th class="num">Turn ${rollout.activatedAtTurn}</th></tr></thead><tbody>
        <tr><td>World facility-ready empty cells</td><td class="num">${baseline.worldFacilityReadyEmptyCells.toLocaleString()}</td></tr>
        <tr><td>US facility-ready empty cells</td><td class="num">${baseline.usFacilityReadyEmptyCells}</td></tr>
        <tr><td><span class="jg game" data-jg="fill" tabindex="0">Pooled fill</span></td><td class="num">${baseline.pooledFillPct.toFixed(2)}%</td></tr>
        <tr><td>Country-scoped fill</td><td class="num">${baseline.countryFillPct.toFixed(2)}%</td></tr>
        <tr><td>Staffing</td><td class="num">${baseline.staffingPct.toFixed(2)}%</td></tr>
        <tr><td>High-concentration low-fill markets</td><td class="num">${baseline.highConcentrationLowFillPct.toFixed(2)}%</td></tr>
        <tr><td>Sovereign issues without a holder</td><td class="num">${baseline.sovereignNoHolderPct.toFixed(2)}%</td></tr>
        <tr><td>Recently traded listings</td><td class="num">${baseline.activeTradedListingsPct.toFixed(2)}%</td></tr>
        <tr><td>Two-sided listings</td><td class="num">${baseline.twoSidedListingsPct.toFixed(2)}%</td></tr>
        <tr><td>Order-book depth / market cap</td><td class="num">${baseline.depthToMarketCapPct.toFixed(2)}%</td></tr>
      </tbody></table>
    </div>
    <div class="card">
      <h3>Expected sequence</h3>
      <ol>${rollout.expectedSignature.map((item) => `<li>${item}</li>`).join("")}</ol>
      <p class="note"><b>Review rule:</b> keep measuring through turn ${rollout.reviewTurn}, but disable a responsible flag immediately if backing, accounting, concentration, fill, staffing, or sell-through breaches its rollback condition.</p>
    </div>
  </div>
  <p class="note"><b>Evidence policy:</b> the stopped seven-turn engineering diagnostic is not scored as an economic result. It is retained only to prove the phases executed. Production observations from the frozen turn-${rollout.activatedAtTurn} baseline now carry the decision.</p>
</section>
`;

html = html.replace(
  '<section id="t440-update"',
  `${rolloutSection}<section id="t440-update"`,
);
html = html.replace(
  /Markets Watch v5\.1: Fable and Codex, [^<]*\./,
  `Markets Watch v5.2: Fable and Codex, ${data.asOf}, production rollout baseline turn ${rollout.activatedAtTurn}.`,
);
html = html.replace(
  "deployed source, support queue, community archive, plus the matched market-formation control and treatment databases for turns 442-489.</p>",
  "deployed source, support queue, community archive, the matched market-formation trial for turns 442-489, and the frozen turn-445 production rollout baseline.</p>",
);

if (
  !html.includes("PRODUCTION ROLLOUT ACTIVE") ||
  !html.includes("Markets Watch v5.2") ||
  !html.includes(rollout.commit)
) {
  throw new Error("Turn 445 rollout update was not fully applied");
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
process.stdout.write(`${output}\n`);
