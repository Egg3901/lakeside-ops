"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const data = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "reports", "research", "economy-snapshot.json"),
    "utf8",
  ),
);
const vizCss = fs.readFileSync("/root/misc/report-kit/viz.css", "utf8");
const vizJs = fs.readFileSync("/root/misc/report-kit/viz.js", "utf8");
const output =
  process.argv[2] ||
  path.join(ROOT, "reports", "outside-economist-state-of-economy-t435.html");

const pct = (value, digits = 1) => `${(Number(value) * 100).toFixed(digits)}%`;
const num = (value, digits = 1) =>
  Number(value).toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
const money = (value) => {
  const absolute = Math.abs(Number(value));
  if (absolute >= 1e9) return `${(Number(value) / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `${(Number(value) / 1e6).toFixed(1)}M`;
  if (absolute >= 1e3) return `${(Number(value) / 1e3).toFixed(1)}K`;
  return num(value, 0);
};
const titleCase = (value) =>
  String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const cite = (id) =>
  `<a class="cite" href="#source-${id}" aria-label="Source ${id}">[${id}]</a>`;
const jargon = (key, text, kind = "econ") =>
  `<span class="jg ${kind}" data-jg="${key}" tabindex="0">${text}</span>`;

const a = data.allocation;
const t = data.trade;
const p = data.production;
const f = data.firms;
const h = data.households;
const e = data.equityLiquidity;
const m = data.money;
const b = data.bonds;

const dashboardRows = [
  [
    jargon("fill", "Goods-market fill"),
    `${pct(a.pooledFill)} now; ${pct(a.windowFillMedian)} 48-turn median`,
    "Weak",
    "bad",
  ],
  [
    "Price signal",
    `scarcity-price correlation ${num(a.priceScarcityCorrelation, 2)}`,
    "Functioning, incomplete",
    "warn",
  ],
  [
    "Geographic integration",
    `${pct(t.intraStateShare)} of delivered units local`,
    "Weak",
    "bad",
  ],
  [
    "Production response",
    `${pct(p.throughputFloorShare)} at throughput floor`,
    "Constrained",
    "bad",
  ],
  [
    "Listed-firm concentration",
    `${jargon("hhi", "HHI")} ${num(f.publicFirmHhi, 0)}; top four ${pct(f.top4FirmShare)}`,
    "High",
    "bad",
  ],
  [
    "Household wealth",
    `${jargon("gini", "Gini")} ${num(h.gini, 4)}; top 10% hold ${pct(h.top10PctShare, 2)}`,
    "Critical",
    "crit",
  ],
  [
    "Equity breadth",
    `${pct(e.activeTradedShare)} of listings traded`,
    "Thin",
    "warn",
  ],
  [
    "Bond breadth",
    `${pct(b.bondsWithNoHolder / b.activeBonds)} of issues unheld`,
    "Dysfunctional",
    "crit",
  ],
  [
    "Monetary conditions",
    `${num(m.annualizedM2GrowthMedian, 1)}% ${jargon("m2", "M2")}; ${num(m.inflationMedian, 2)}% inflation`,
    "Watch, not crisis",
    "warn",
  ],
  [
    "Accounting confidence",
    `${jargon("trial_balance", "trial balance")} green; two layers amber`,
    "Mixed",
    "warn",
  ],
];

const agenda = [
  {
    priority: "P0",
    title: "Publish the market's vital signs",
    finding:
      "The current data can describe allocation, but not spreads, depth, execution time, active money, dormant money, or monetary velocity.",
    action:
      "Release one recurring, turn-consistent economic dataset covering prices, quantities, liquidity, concentration, balance sheets, and reconciliation.",
    gate: "All headline series share one cutoff and stock-flow checks remain green for four turns.",
  },
  {
    priority: "P1",
    title: "Lower geographic and matching frictions",
    finding: `Only ${pct(1 - t.intraStateShare)} of delivered sourcing crosses a state or national border; ${pct(t.toleranceBoundShareOfUnmet)} of unmet sourcing is tolerance-bound.`,
    action:
      "Improve route coverage, delivered-price visibility, freight availability, and automatic matching before adding aggregate demand.",
    gate: "12-turn sourcing fulfillment above 70%, cross-border share above 25%, essential-goods prices stable.",
  },
  {
    priority: "P2",
    title: "Restore a gradual supply response",
    finding: `${pct(p.throughputFloorShare)} of measured sectors sit at the 0.85 floor and labour staffing is ${pct(p.labourStaffingRate)}.`,
    action:
      "Repair leading input and labour constraints, then taper the throughput floor in staged cohorts.",
    gate: "Floor-bound share below 50%, staffing above 65%, pooled fill above 80%, no distress spike.",
  },
  {
    priority: "P3",
    title: "Deepen securities markets",
    finding: `${b.bondsWithNoHolder} of ${b.activeBonds} bond issues have no holder and only ${pct(e.activeTradedShare)} of listings traded in 48 turns.`,
    action:
      "Consolidate bond maturities, run auctions, expose order-book depth, and add a tightly limited market-making facility.",
    gate: "Unheld bonds below 35%, traded listings above 60%, execution time and spread falling.",
  },
  {
    priority: "P4",
    title: "Widen entry where concentration causes harm",
    finding: `Listed-firm HHI is ${num(f.publicFirmHhi, 0)} and the top four hold ${pct(f.top4FirmShare)} of capitalization.`,
    action:
      "Measure seller and buyer concentration by commodity, then target entry finance, input access, or switching costs in the harmed markets.",
    gate: "Top-four capitalization below 70% and seller concentration declines in at least half of high-shortage markets.",
  },
  {
    priority: "P5",
    title: "Repair monetary observability",
    finding: `Money reconciliation is amber in ${m.ledger.moneySupplyFindingCount} currency areas and stock-flow reconciliation has ${m.ledger.divergentAccountCount.toLocaleString("en-US")} divergent accounts.`,
    action:
      "Classify active, dormant, corporate, escrow, bank, and state balances, then measure velocity before changing broad faucets or sinks.",
    gate: "Active money, velocity, output, and a weighted price index reconcile for 12 turns.",
  },
  {
    priority: "P6",
    title: "Treat sinks and taxes as experiments",
    finding:
      "Removing money or assets does not show that the intended price, volume, or distribution outcome occurred.",
    action:
      "Use staged or matched interventions with a pre-registered target, incidence analysis, review date, and rollback threshold.",
    gate: "Every intervention has a comparison, target metric, guardrails, and a published result.",
  },
  {
    priority: "P7",
    title: "Run system-wide stress scenarios",
    finding:
      "Concentrated ownership and essential-input bottlenecks create common points of failure that ordinary averages will miss.",
    action:
      "Simulate the largest supplier failing, freight disruption, exchange closure, synchronized liquidation, and dormant money returning.",
    gate: "Publish the first failure, propagation path, unmet demand, loss, and recovery time for every scenario.",
  },
];

const sources = [
  [
    1,
    "Bank for International Settlements",
    "Market liquidity: proceedings of workshop held at the BIS",
    "https://www.bis.org/publ/bppdf/bispap02.pdf",
  ],
  [
    2,
    "US Department of Justice and Federal Trade Commission",
    "2023 Merger Guidelines, Guideline 1",
    "https://www.justice.gov/atr/merger-guidelines/applying-merger-guidelines/guideline-1",
  ],
  [
    3,
    "Federal Reserve Board",
    "Distributional Financial Accounts Overview",
    "https://www.federalreserve.gov/releases/z1/dataviz/dfa",
  ],
  [
    4,
    "Hogan-Hennessy, Xenopoulos, and Silva",
    "Market Interventions in a Large-Scale Virtual Economy",
    "https://arxiv.org/abs/2210.07970",
  ],
  [
    5,
    "International Monetary Fund",
    "Monetary and Financial Statistics Manual and Compilation Guide 2016",
    "https://www.imf.org/-/media/files/data/guides/mfsmcg_merged-web-pdf.pdf",
  ],
  [
    6,
    "International Monetary Fund and partner agencies",
    "Consumer Price Index Manual: Concepts and Methods, 2020",
    "https://www.imf.org/-/media/files/data/cpi/cpi-manual-concepts-and-methods.pdf",
  ],
  [
    7,
    "Bank of England",
    "System-wide exploratory scenario exercise final report",
    "https://www.bankofengland.co.uk/financial-stability/boe-system-wide-exploratory-scenario-exercise/boe-swes-exercise-final-report",
  ],
  [
    8,
    "CCP Games",
    "EVE Online Quarterly Economic Newsletter, Q3 2010",
    "https://cdn1.eveonline.com/community/QEN/QEN_Q3-2010.pdf",
  ],
];

const customCss = `
.viz-root{--hero:#102236;--hero2:#173e59;--paper:#f5f2eb;--cream:#efe7d7;--navy:#102236;--accent:#d26a36;--teal:#187d74;background:var(--paper)}
.wrap{max-width:1180px;padding-top:18px}
.hero{background:linear-gradient(125deg,var(--hero),var(--hero2));color:#fff;border-radius:18px;padding:30px 34px 28px;box-shadow:0 12px 36px rgba(16,34,54,.16)}
.hero h1{font-family:Georgia,"Times New Roman",serif;font-size:42px;line-height:1.03;margin:9px 0 8px;letter-spacing:-.6px}
.hero .eyebrow{font-size:11px;letter-spacing:1.6px;text-transform:uppercase;font-weight:750;color:#b9d7df}
.hero .deck{max-width:850px;font-size:17px;line-height:1.55;color:#e9f1f3;margin:14px 0 20px}
.hero-meta{display:flex;gap:9px;flex-wrap:wrap}.hero-meta span{border:1px solid rgba(255,255,255,.22);border-radius:99px;padding:5px 10px;font-size:11.5px;color:#dce9ec}
.verdict{display:grid;grid-template-columns:1.55fr .85fr;gap:16px;margin:18px 0}
.verdict-copy{background:var(--surface-1);border:1px solid var(--ring);border-left:5px solid var(--accent);border-radius:12px;padding:18px 20px}.verdict-copy h2{font-family:Georgia,"Times New Roman",serif;font-size:23px;margin:0 0 7px}.verdict-copy p{font-size:15px;margin:0}
.risk-box{background:var(--navy);color:#fff;border-radius:12px;padding:17px 19px}.risk-box .k{font-size:10.5px;letter-spacing:1.2px;text-transform:uppercase;color:#b9d7df}.risk-box ol{margin:8px 0 0;padding-left:20px}.risk-box li{color:#fff;margin:5px 0;font-size:13px}
.tabs{top:0;border-radius:0 0 10px 10px}.tab{border-radius:99px}.tab.active{background:var(--navy);border-color:var(--navy)}
.pane h2{font-family:Georgia,"Times New Roman",serif;font-size:25px;color:var(--navy)}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .pane h2{color:#dbeaf1}}
:root[data-theme="dark"] .pane h2{color:#dbeaf1}
.lead{font-size:16px;line-height:1.65;max-width:900px}.kicker{font-size:11px;color:var(--accent);font-weight:800;letter-spacing:1.3px;text-transform:uppercase;margin-top:26px}
.score-table td:first-child{font-weight:650}.score-table td:nth-child(3){white-space:nowrap}.status{font-size:10.5px;border-radius:99px;padding:3px 8px;font-weight:750;text-transform:uppercase;letter-spacing:.35px}.status.bad{background:#f9d9ca;color:#8a321d}.status.crit{background:#d03b3b;color:#fff}.status.warn{background:#f9e8b5;color:#6b5000}
.metric-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:15px 0}.metric{border-top:3px solid var(--teal)}.metric .v{font-size:29px;font-weight:700}.metric .l{font-size:12px;color:var(--ink-2);margin-top:2px}.metric .why{font-size:12px;color:var(--ink-3);margin-top:7px;line-height:1.45}
.finding{display:grid;grid-template-columns:44px 1fr;gap:12px;border-bottom:1px solid var(--grid);padding:14px 0}.finding .n{font-family:Georgia,"Times New Roman",serif;font-size:28px;color:var(--accent)}.finding h3{font-size:15px;margin:0 0 4px}.finding p{margin:0;color:var(--ink-2)}
.split{display:grid;grid-template-columns:1fr 1fr;gap:14px}.callout{background:var(--cream);border-radius:10px;padding:14px 16px;border:1px solid #dfd2ba}.callout p{margin:4px 0}.callout b{color:var(--navy)}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .callout{background:#24211d;border-color:#423a2f}:root:where(:not([data-theme="light"])) .callout b{color:#fff}}
:root[data-theme="dark"] .callout{background:#24211d;border-color:#423a2f}:root[data-theme="dark"] .callout b{color:#fff}
.mixbar{display:flex;height:24px;border-radius:7px;overflow:hidden;margin:10px 0 7px}.mixbar span{display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;min-width:2px}.mixlegend{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--ink-2)}
.agenda{display:grid;gap:11px}.agenda-item{display:grid;grid-template-columns:54px 1fr;gap:14px;background:var(--surface-1);border:1px solid var(--ring);border-radius:11px;padding:15px 17px}.agenda-item .prio{width:43px;height:43px;border-radius:10px;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800}.agenda-item h3{font-size:16px;margin:0 0 4px}.agenda-item p{margin:4px 0;font-size:13px}.agenda-item .gate{color:var(--teal);font-weight:650}
.formula{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--surface-1);border:1px solid var(--ring);border-radius:8px;padding:11px 13px;font-size:12px}.cite{font-size:10px;vertical-align:super;color:var(--s1);text-decoration:none;font-weight:750;margin-left:2px}.sources li{font-size:12.5px;margin:8px 0}.sources a{color:var(--s1)}
.source-note{display:flex;gap:12px;background:var(--surface-1);border:1px solid var(--ring);border-radius:10px;padding:11px 13px;margin:11px 0}.source-note .dot{width:10px;height:10px;border-radius:50%;background:var(--teal);margin-top:5px;flex:0 0 auto}.source-note p{margin:0;font-size:12.5px;color:var(--ink-2)}
.gloss-key{font-size:11px;color:var(--ink-3);margin:7px 0 0}.gloss-key .econ{margin-right:12px}.method-list li{margin-bottom:8px}
@media(max-width:780px){.hero{padding:24px 21px}.hero h1{font-size:33px}.verdict,.split{grid-template-columns:1fr}.metric-grid{grid-template-columns:1fr 1fr}.agenda-item{grid-template-columns:44px 1fr}.wrap{padding-left:12px;padding-right:12px}}
@media(max-width:500px){.metric-grid{grid-template-columns:1fr}.hero h1{font-size:29px}.hero .deck{font-size:15px}.score-table{font-size:11px}.score-table th:nth-child(2),.score-table td:nth-child(2){display:none}}
@media print{.tabs{display:none}.pane{display:block!important}.hero{background:#102236!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.card,.agenda-item{break-inside:avoid}}
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>State of the Economy | External Assessment | Turn ${data.metadata.turn}</title>
<style>${vizCss}\n${customCss}</style>
</head>
<body class="viz-root">
<div class="wrap">
  <header class="hero">
    <div class="eyebrow">Independent economic assessment</div>
    <h1>State of the Economy</h1>
    <p class="deck">A productive economy with a weak allocation mechanism. Prices recognize scarcity, but trade, supply, capital, and ownership respond too slowly or too narrowly.</p>
    <div class="hero-meta"><span>Turn ${data.metadata.turn}</span><span>Year ${data.metadata.year}</span><span>48-turn evidence window</span><span>Production data through 27 Aug 2026</span></div>
  </header>

  <section class="verdict">
    <div class="verdict-copy">
      <h2>The outside view</h2>
      <p>Goods that reach market usually sell, and prices move in the right direction when scarcity rises. Yet current demand fill is only <b>${pct(a.pooledFill)}</b>, production is pinned by administrative floors, trade is overwhelmingly local, securities markets are shallow below their largest issuers, and the median household owns almost none of the economy's wealth.</p>
    </div>
    <aside class="risk-box"><div class="k">Priority risks</div><ol><li>Persistent unmet demand</li><li>Concentrated ownership</li><li>Shallow capital markets</li></ol></aside>
  </section>

  <div class="tabs" role="tablist" aria-label="Report sections">
    <button class="tab active" data-p="findings">Findings</button>
    <button class="tab" data-p="goods">Goods &amp; trade</button>
    <button class="tab" data-p="capital">Capital &amp; wealth</button>
    <button class="tab" data-p="money">Money &amp; stability</button>
    <button class="tab" data-p="agenda">Improvement agenda</button>
    <button class="tab" data-p="methods">Methods &amp; sources</button>
  </div>

  <main>
    <section class="pane active" id="p_findings">
      <div class="kicker">Executive findings</div>
      <h2>Prices work. Adjustment does not.</h2>
      <p class="lead">The economy's main failure is incomplete <span class="jg econ" data-jg="adjustment" tabindex="0">market adjustment</span>. Prices signal shortages, but capital, labour, inputs, and goods do not move quickly enough to close them. Broad monetary tightening would treat the wrong mechanism.</p>
      <div class="tiles">
        <div class="tile serious"><div class="v">${pct(a.pooledFill)}</div><div class="l">current goods fill</div><div class="d">${pct(a.windowFillMedian)} median over 48 turns</div></div>
        <div class="tile good"><div class="v">0.76</div><div class="l">scarcity-price correlation</div><div class="d">directional signal is working</div></div>
        <div class="tile crit"><div class="v">${num(h.gini, 4)}</div><div class="l">wealth ${jargon("gini", "Gini")}</div><div class="d">extreme concentration</div></div>
        <div class="tile serious"><div class="v">${num(f.publicFirmHhi, 0)}</div><div class="l">listed-firm ${jargon("hhi", "HHI")}</div><div class="d">top four hold ${pct(f.top4FirmShare)}</div></div>
        <div class="tile serious"><div class="v">${pct(b.bondsWithNoHolder / b.activeBonds)}</div><div class="l">active bonds unheld</div><div class="d">median issue has zero holders</div></div>
      </div>
      <p class="gloss-key"><span class="jg econ" data-jg="jargon" tabindex="0">Wavy underline</span> means a term has a plain-language popup. Hover, tap, or focus it.</p>

      <div class="card">
        <h3>Conditions dashboard</h3>
        <table class="score-table"><thead><tr><th>Domain</th><th>Reading</th><th>Assessment</th></tr></thead><tbody>
          ${dashboardRows.map(([domain, reading, assessment, tone]) => `<tr><td>${domain}</td><td>${reading}</td><td><span class="status ${tone}">${assessment}</span></td></tr>`).join("\n")}
        </tbody></table>
      </div>

      <div class="finding"><div class="n">01</div><div><h3>Unresolved scarcity</h3><p>Current fill is ${pct(a.pooledFill)} and the recent 12-turn median is ${pct(a.recent12TurnFillMedian)}. Twenty-four of 28 commodities trade above twice base price.</p></div></div>
      <div class="finding"><div class="n">02</div><div><h3>Weak trade reach</h3><p>${pct(t.intraStateShare)} of sourced units remain intrastate. ${pct(t.toleranceBoundShareOfUnmet)} of unmet sourcing is limited by delivered-price tolerance, while ${pct(t.capacityBoundShareOfUnmet)} is marked capacity-bound.</p></div></div>
      <div class="finding"><div class="n">03</div><div><h3>Muted supply response</h3><p>${pct(p.throughputFloorShare)} of measured sectors sit at the throughput floor, staffing is ${pct(p.labourStaffingRate)}, and ${pct(p.physicalSellThrough)} of produced output sells.</p></div></div>
      <div class="finding"><div class="n">04</div><div><h3>Ownership without breadth</h3><p>The top 10% of observed households hold ${pct(h.top10PctShare, 2)} of net worth, while only ${pct(e.activeTradedShare)} of positive-value listings traded during the window.</p></div></div>
    </section>

    <section class="pane" id="p_goods">
      <div class="kicker">Product markets</div>
      <h2>Scarcity is priced, but rarely arbitraged away</h2>
      <p class="lead">Across 28 commodities, log scarcity and log price relative to base correlate at <b>${num(a.priceScarcityCorrelation, 2)}</b>. That is credible <span class="jg econ" data-jg="price_discovery" tabindex="0">price discovery</span>. The problem is that profitable shortage does not reliably produce entry, substitution, investment, or geographic <span class="jg econ" data-jg="arbitrage" tabindex="0">arbitrage</span>.</p>
      <div class="card"><figure><div class="legend"><span><i class="sw" style="background:var(--s1)"></i>Pooled demand filled</span></div><div id="fillTrend"></div><figcaption>Settled commodity ledger, selected observations from turn ${data.metadata.fromTurn} through ${data.metadata.turn}. Fill is cyclic, so current, recent-median, and distributional readings are reported together. The median price multiple declined from 4.21x near the start of the window to 3.41x at the current observation.</figcaption></figure></div>
      <div class="metric-grid">
        <div class="card metric"><div class="v">${pct(a.windowFillMedian)}</div><div class="l">48-turn median fill</div><div class="why">10th to 90th percentile: ${pct(a.windowFillP10)} to ${pct(a.windowFillP90)}</div></div>
        <div class="card metric"><div class="v">${num(a.medianCommodityPriceMultiple, 2)}x</div><div class="l">median commodity price vs base</div><div class="why">${a.commoditiesAbove4xBase} of ${a.commodities} commodities exceed 4x base</div></div>
        <div class="card metric"><div class="v">${pct(a.countryScopedFill)}</div><div class="l">country-scoped fill</div><div class="why">Geography reduces reachable supply below the pooled book</div></div>
      </div>
      <div class="split">
        <div class="card"><h3>Lowest-fill commodities</h3><div id="shortageBars"></div><p class="note">Bar shows cleared demand. Label shows price relative to base.</p></div>
        <div class="card"><h3>What is blocking sourcing</h3><div class="mixbar"><span style="width:${t.intraStateShare * 100}%;background:var(--s1)">local</span><span style="width:${t.interStateShare * 100}%;background:var(--s3)"></span><span style="width:${t.importShare * 100}%;background:var(--s4)"></span></div><div class="mixlegend"><span>Local ${pct(t.intraStateShare)}</span><span>Interstate ${pct(t.interStateShare)}</span><span>Imports ${pct(t.importShare)}</span></div><p><b>${money(t.unmetUnits)} units</b> of sourcing intent are unmet. Of that amount, ${pct(t.toleranceBoundShareOfUnmet)} is recorded as <span class="jg game" data-jg="tolerance" tabindex="0">tolerance-bound</span>, against only ${pct(t.capacityBoundShareOfUnmet)} as capacity-bound.</p><div class="callout"><p><b>Economic reading:</b> the binding margin is usually the all-in delivered cost or access path, not nameplate world capacity.</p></div></div>
      </div>

      <div class="kicker">Production</div>
      <h2>Demand can absorb more output</h2>
      <div class="metric-grid">
        <div class="card metric"><div class="v">${pct(p.physicalSellThrough)}</div><div class="l">physical sell-through</div><div class="why">Produced goods usually find buyers</div></div>
        <div class="card metric"><div class="v">${pct(p.throughputFloorShare)}</div><div class="l">sectors at 0.85 floor</div><div class="why">They account for ${pct(p.throughputFloorOutputShare)} of output</div></div>
        <div class="card metric"><div class="v">${pct(p.labourStaffingRate)}</div><div class="l">desired labour staffed</div><div class="why">A broad constraint on expansion</div></div>
      </div>
      <div class="card"><h3>Most common binding inputs</h3><div id="bindingBars"></div></div>
      <p class="lead">This combination is a <span class="jg econ" data-jg="coordination_failure" tabindex="0">coordination failure</span>: demand exists, nearly all output sells, and prices signal shortage, but the system does not mobilize inputs and labour fast enough. Market access comes first. The floor should then be tapered in cohorts, not removed across the economy at once.</p>
    </section>

    <section class="pane" id="p_capital">
      <div class="kicker">Corporate sector</div>
      <h2>Profitable in aggregate, concentrated at the top</h2>
      <p class="lead">The operating corporate sector earns positive aggregate income, but capitalization and trading activity cluster in a few firms. An aggregate HHI of <b>${num(f.publicFirmHhi, 0)}</b> is above the 1,800 screening threshold used for a highly concentrated market in US merger guidance.${cite(2)} This is a warning, not a legal conclusion, because product-market boundaries differ.</p>
      <div class="metric-grid">
        <div class="card metric"><div class="v">${f.operatingCorporations}</div><div class="l">operating corporations</div><div class="why">${f.negativeIncomeCorporations} negative-income; ${f.distressedCorporations} distressed</div></div>
        <div class="card metric"><div class="v">${money(f.publicMarketCapAnchor)}</div><div class="l">listed capitalization</div><div class="why">Current global-exchange snapshot</div></div>
        <div class="card metric"><div class="v">${pct(f.top4FirmShare)}</div><div class="l">top-four capitalization share</div><div class="why">Largest firm alone holds ${pct(f.top1FirmShare)}</div></div>
      </div>
      <div class="card"><h3>Capitalization held by the ten largest firms</h3><div id="firmBars"></div><figcaption>Firms are ranked and labeled by sector to keep the report focused on structure rather than personalities.</figcaption></div>

      <div class="kicker">Market liquidity</div>
      <h2>Turnover exists; depth is not yet observable</h2>
      <p class="lead">Across 48 turns, 375 trades transferred ${money(e.tradeNotionalAnchor)} anchor units, or ${pct(e.turnoverToMarketCap)} of current capitalization as ${jargon("turnover", "turnover")}. Yet only ${e.activeTradedCorporations} of ${f.publicListings} positive-value listings traded, and only ${e.openOrders} orders were open at observation.</p>
      <div class="source-note"><div class="dot"></div><p>A liquid market supports quick, large trades close to the prevailing price. Trade count alone is insufficient. Publish <span class="jg econ" data-jg="spread" tabindex="0">spread</span>, <span class="jg econ" data-jg="depth" tabindex="0">depth</span>, <span class="jg econ" data-jg="price_impact" tabindex="0">price impact</span>, execution time, and post-shock <span class="jg econ" data-jg="resilience" tabindex="0">resilience</span>.${cite(1)}</p></div>
      <div class="split">
        <div class="card"><h3>Equity-market breadth</h3><div class="metric-grid" style="grid-template-columns:1fr 1fr"><div><div class="v" style="font-size:27px;font-weight:700">${pct(e.activeTradedShare)}</div><div class="note">listings traded</div></div><div><div class="v" style="font-size:27px;font-weight:700">${e.openOrders}</div><div class="note">open orders</div></div></div><p class="note">Market-buy activity dominates recorded trade kinds, making depth and execution-quality measures especially important.</p></div>
        <div class="card"><h3>Bond-market breadth</h3><div class="metric-grid" style="grid-template-columns:1fr 1fr"><div><div class="v" style="font-size:27px;font-weight:700">${b.activeBonds}</div><div class="note">active issues</div></div><div><div class="v" style="font-size:27px;font-weight:700">${b.bondsWithNoHolder}</div><div class="note">issues with no holder</div></div></div><p class="note">The median bond has zero holders. Issue count is not financial depth.</p></div>
      </div>

      <div class="kicker">Household balance sheets</div>
      <h2>The typical household owns almost none of the aggregate</h2>
      <div class="metric-grid">
        <div class="card metric"><div class="v">${money(h.medianNetWorthAnchor)}</div><div class="l">median net worth</div><div class="why">Mean is ${money(h.meanNetWorthAnchor)}</div></div>
        <div class="card metric"><div class="v">${pct(h.top1PctShare)}</div><div class="l">held by richest ${h.top1PctCount} households</div><div class="why">Single largest fortune: ${pct(h.largestFortuneShare)}</div></div>
        <div class="card metric"><div class="v">${pct(h.top10PctShare, 2)}</div><div class="l">held by top 10%</div><div class="why">Observed population: ${h.observedPlayers}</div></div>
      </div>
      <div class="card"><h3>Composition of observed household net worth</h3><div class="mixbar"><span style="width:${(h.wealthComponents.stock / h.totalNetWorthAnchor) * 100}%;background:var(--s1)">stocks</span><span style="width:${(h.wealthComponents.bonds / h.totalNetWorthAnchor) * 100}%;background:var(--s3)">bonds</span><span style="width:${(h.wealthComponents.cash / h.totalNetWorthAnchor) * 100}%;background:var(--s4)">cash</span></div><div class="mixlegend"><span>Stocks ${money(h.wealthComponents.stock)}</span><span>Bonds ${money(h.wealthComponents.bonds)}</span><span>Cash ${money(h.wealthComponents.cash)}</span></div><p>Distribution should be monitored by percentile and asset composition, as official distributional accounts do, not through mean wealth alone.${cite(3)}</p></div>
    </section>

    <section class="pane" id="p_money">
      <div class="kicker">Monetary conditions</div>
      <h2>Money growth is not the current master variable</h2>
      <p class="lead">Median annualized M2 growth across 24 currency areas is <b>${num(m.annualizedM2GrowthMedian, 1)}%</b>, while median reported inflation is <b>${num(m.inflationMedian, 2)}%</b>. Their cross-country correlation is <b>${num(m.m2GrowthInflationCorrelation, 2)}</b>. This one snapshot does not establish causation, but it contradicts a simple one-for-one money-growth story.</p>
      <div class="metric-grid">
        <div class="card metric"><div class="v">${num(m.annualizedM2GrowthMedian, 1)}%</div><div class="l">median M2 growth</div><div class="why">P10 ${num(m.annualizedM2GrowthP10, 1)}%; P90 ${num(m.annualizedM2GrowthP90, 1)}%</div></div>
        <div class="card metric"><div class="v">${num(m.inflationMedian, 2)}%</div><div class="l">median inflation</div><div class="why">P10 ${num(m.inflationP10, 2)}%; P90 ${num(m.inflationP90, 2)}%</div></div>
        <div class="card metric"><div class="v">${pct(m.medianSavingsShareOfM2)}</div><div class="l">median broad-money component share</div><div class="why">Savings, deposits, and other non-immediate balances</div></div>
      </div>
      <div class="split">
        <div class="card"><h3>Fastest M2 growth</h3><div id="moneyFastBars"></div></div>
        <div class="card"><h3>Slowest M2 growth</h3><div id="moneySlowBars"></div></div>
      </div>
      <p class="lead">Monetary reporting should separate stocks and flows, and classify money by instrument, issuer, and holder.${cite(5)} It should also distinguish active balances from dormant balances. EVE's first-party economic reports made that distinction because inactive money can reactivate and become a monetary overhang.${cite(8)}</p>

      <div class="kicker">Accounting confidence</div>
      <h2>Balance stocks are usable; causal flow stories are not</h2>
      <div class="card"><table><thead><tr><th>Reconciliation layer</th><th>Status</th><th class="num">Findings</th><th>Economic use</th></tr></thead><tbody><tr><td>${jargon("trial_balance", "Trial balance")}</td><td><span class="badge ok">GREEN</span></td><td class="num">${m.ledger.unbalancedCount}</td><td>Balance identities are usable.</td></tr><tr><td>${jargon("stock_flow", "Stock versus flow")}</td><td><span class="badge warnb">AMBER</span></td><td class="num">${m.ledger.divergentAccountCount.toLocaleString("en-US")}</td><td>Do not attribute changes to precise mechanisms yet.</td></tr><tr><td>Money supply</td><td><span class="badge warnb">AMBER</span></td><td class="num">${m.ledger.moneySupplyFindingCount}</td><td>Do not tune broad faucets or sinks from current flow attribution.</td></tr></tbody></table></div>

      <div class="kicker">Stability</div>
      <h2>Concentration turns ordinary shocks into system shocks</h2>
      <p class="lead">The largest firm has ${pct(f.top1FirmShare)} of listed capitalization, essential production depends repeatedly on the same inputs, and household asset ownership is concentrated. These overlaps can create <span class="jg econ" data-jg="systemic_risk" tabindex="0">systemic risk</span> even when aggregate income is positive.</p>
      <div class="chain"><div class="n">Large supplier or holder shock</div><div class="a">&#8594;</div><div class="n">Thin buying capacity</div><div class="a">&#8594;</div><div class="n">Price jump or input shortage</div><div class="a">&#8594;</div><div class="n">Synchronized retrenchment</div></div>
      <p>A system-wide stress exercise should model participants together because simultaneous selling can exceed available buying capacity and create a sudden jump to illiquidity.${cite(7)}</p>
    </section>

    <section class="pane" id="p_agenda">
      <div class="kicker">Reform program</div>
      <h2>Fix access, response, and depth in that order</h2>
      <p class="lead">The sequence is deliberately conservative. Better routing should improve realized returns in shortage markets. That should attract labour and capital. Throughput floors can then be tapered. Monetary interventions come last because current evidence points more strongly to allocation and circulation failures than generalized excess demand.</p>
      <div class="agenda">${agenda.map((item) => `<article class="agenda-item"><div class="prio">${item.priority}</div><div><h3>${item.title}</h3><p><b>Finding:</b> ${item.finding}</p><p><b>Action:</b> ${item.action}</p><p class="gate"><b>Success gate:</b> ${item.gate}</p></div></article>`).join("\n")}</div>
      <div class="source-note"><div class="dot"></div><p>A causal study of a large virtual economy found that targeted item sinks raised affected prices by about 7% and 14.4% without a detectable reduction in volume, while the tested tax thresholds had no meaningful volume effect.${cite(4)} A sink needs a named objective and counterfactual, not applause for destroying assets.</p></div>
    </section>

    <section class="pane" id="p_methods">
      <div class="kicker">Method</div>
      <h2>One observation cutoff, separate economic books</h2>
      <ul class="method-list">
        <li><b>Period:</b> current stocks at turn ${data.metadata.turn}, with a flow window from turn ${data.metadata.fromTurn} through ${data.metadata.turn}.</li>
        <li><b>Goods:</b> fill and price readings use settled commodity-flow ledgers. Geographic reach and rejection causes use the separately labeled sourcing-intent book. The two books are not added together.</li>
        <li><b>Valuation:</b> corporation, equity, and household wealth use anchor-normalized snapshots. Current equity concentration and turnover share one global-exchange snapshot.</li>
        <li><b>Money:</b> balance stocks are compared within currency areas before rates are summarized across countries.</li>
        <li><b>Coverage:</b> wealth observations include ${h.observedPlayers} households. Public equity includes ${f.publicListings} positive-value listings.</li>
      </ul>
      <div class="formula">pooled fill = settled cleared units / recorded demand units<br>HHI = 10,000 x sum of squared market shares<br>turnover = 48-turn traded notional / current listed capitalization<br>wealth Gini = concentration of nonnegative observed net worth</div>

      <div class="kicker">Limits</div>
      <h2>What this report does not claim</h2>
      <ul class="method-list">
        <li>This is descriptive, not causal. It does not estimate welfare, utility, consumer surplus, or the effect of an unimplemented rule.</li>
        <li>Commodity units are not commensurable, so aggregate fill is an operating index rather than a complete welfare measure.</li>
        <li>Fill is cyclic. Current, recent-median, and 48-turn distributional readings are shown to avoid treating one endpoint as equilibrium.</li>
        <li>Current exchange capitalization differs from an earlier same-turn history snapshot because prices move within a turn. Concentration and turnover use the current exchange snapshot for consistency.</li>
        <li>Real-world thresholds are measurement guides, not legal or historical targets for this economy.</li>
      </ul>
      <p>For an inflation index, international practice calls for explicit expenditure weights, category contributions, linking, and treatment of missing and new goods.${cite(6)} The current median price multiple is a diagnostic, not a cost-of-living index.</p>

      <div class="kicker">External sources</div>
      <h2>Research base</h2>
      <ol class="sources">${sources.map(([id, author, title, url]) => `<li id="source-${id}"><b>${author}.</b> <a href="${url}" target="_blank" rel="noopener">${title}</a>.</li>`).join("\n")}</ol>
      <p class="src">Local evidence: read-only production snapshot generated ${data.metadata.generatedAt}; report calculations are reproducible from the attached collector and snapshot.</p>
    </section>
  </main>
</div>
<div class="tip" id="tip"></div>
<script>const REPORT_DATA=${JSON.stringify(data)};</script>
<script>${vizJs}</script>
<script>
const s1=css('--s1'), s2=css('--s2'), s3=css('--s3'), s4=css('--s4');
const CRIT=css('--crit'), SER=css('--serious'), GOOD=css('--good');
const JG={
  adjustment:{kind:'econ',term:'Market adjustment',def:'The process by which prices, supply, demand, entry, and substitution respond until a shortage or surplus narrows.'},
  fill:{kind:'econ',term:'Goods-market fill',def:'The share of recorded demand that receives settled goods. A higher rate means fewer requested units go unfilled.'},
  hhi:{kind:'econ',term:'Herfindahl-Hirschman Index (HHI)',def:'A concentration measure found by squaring and adding market shares. A higher score means activity is controlled by fewer firms.'},
  gini:{kind:'econ',term:'Gini coefficient',def:'A measure of inequality from 0 for equal holdings to 1 for one holder owning everything.'},
  m2:{kind:'econ',term:'M2 money supply',def:'A broad measure of spendable money that includes cash-like balances and less immediate deposit or savings balances.'},
  turnover:{kind:'econ',term:'Market turnover',def:'Trading value during a period divided by the current value of listed assets. It indicates how actively ownership changes hands.'},
  trial_balance:{kind:'econ',term:'Trial balance',def:'A check that all recorded debits and credits offset. Passing it shows the accounting entries balance, not that every economic flow has been classified.'},
  stock_flow:{kind:'econ',term:'Stock-flow reconciliation',def:'A check that changes in balance-sheet stocks can be explained by the recorded flows between observations.'},
  jargon:{kind:'econ',term:'Jargon popup',def:'Hover, tap, or focus any wavy-underlined term for a plain-language explanation.'},
  price_discovery:{kind:'econ',term:'Price discovery',def:'The process by which orders and trades reveal the price that balances current supply and demand.'},
  arbitrage:{kind:'econ',term:'Arbitrage',def:'Buying where a good is cheaper and selling where it is dearer, which tends to narrow price gaps.'},
  tolerance:{kind:'game',term:'Tolerance-bound sourcing',def:'Demand that could not be sourced within the permitted delivered-price or route tolerance. It is an intent-book classification, not settled demand.'},
  coordination_failure:{kind:'econ',term:'Coordination failure',def:'A situation where individually reasonable choices do not move enough resources toward a collectively valuable outcome.'},
  spread:{kind:'econ',term:'Bid-ask spread',def:'The gap between the best available buying price and selling price. A wider gap makes trading more expensive.'},
  depth:{kind:'econ',term:'Market depth',def:'How much can be bought or sold near the current price before the price moves materially.'},
  price_impact:{kind:'econ',term:'Price impact',def:'How far the market price moves when a given amount is traded. Lower impact usually means greater liquidity.'},
  resilience:{kind:'econ',term:'Market resilience',def:'How quickly prices and trading costs return to normal after a temporary order imbalance or shock.'},
  systemic_risk:{kind:'econ',term:'Systemic risk',def:'The risk that one failure or common shock spreads through connected markets and impairs the economy as a whole.'}
};

document.querySelectorAll('.tab').forEach(function(tab){tab.addEventListener('click',function(){document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active')});document.querySelectorAll('.pane').forEach(function(x){x.classList.remove('active')});tab.classList.add('active');document.getElementById('p_'+tab.dataset.p).classList.add('active');window.scrollTo({top:document.querySelector('.tabs').offsetTop,behavior:'smooth'});});});
initJargon(JG);

const trend=REPORT_DATA.allocation.flowTrend;
lineChart(document.getElementById('fillTrend'),[
  {name:'fill',color:s1,pts:trend.map(function(x){return [x.turn,x.fill]})}
],{h:280,fmt:function(v){return (v*100).toFixed(0)+'%'}});

hbar(document.getElementById('shortageBars'),REPORT_DATA.allocation.worstCommodities.slice(0,8).map(function(x){return [x.commodity,x.fill,x.priceMultiple.toFixed(1)+'x base',x.fill<.5?CRIT:(x.fill<.7?SER:s1)]}),{fmt:function(v){return (v*100).toFixed(0)+'%'},color:s1,max:1});
hbar(document.getElementById('bindingBars'),REPORT_DATA.production.leadingBindingInputs.slice(0,8).map(function(x){return [x.input,x.count,'sectors']}),{fmt:function(v){return Math.round(v)},color:s2});
hbar(document.getElementById('firmBars'),REPORT_DATA.firms.largestPublicFirms.map(function(x,i){return ['#'+(i+1)+' '+x.sector,x.share,'of listed value',i<4?SER:s1]}),{fmt:function(v){return (v*100).toFixed(1)+'%'},color:s1,max:.42});
hbar(document.getElementById('moneyFastBars'),REPORT_DATA.money.fastestM2Growth.map(function(x){return [x.country,x.growth,'% annualized']}),{fmt:function(v){return v.toFixed(1)},color:s2,max:20});
hbar(document.getElementById('moneySlowBars'),REPORT_DATA.money.slowestM2Growth.map(function(x){return [x.country,x.growth,'% annualized']}),{fmt:function(v){return v.toFixed(1)},color:s3,max:20});
</script>
</body>
</html>`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
process.stdout.write(`${output}\n`);
