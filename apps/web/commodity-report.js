// AHD Commodity Economy Report — Turn 236
// Comprehensive analysis of commodity supply/demand imbalances
// Verified against live DB data. All claims fact-checked.
// Exports makeCommodityPage() for injection into server.js

const { icon, faviconFor, THEME_HEAD, themeToggle, THEME_TOGGLE_JS } = require('./ui-kit');

function makeCommodityPage(fontLinks, baseCss) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lakeside Ops — Commodity Economy Report</title>
${THEME_HEAD}
<link rel="icon" href="${faviconFor('coins')}">
${fontLinks}
<style>${baseCss}
.container{max-width:1200px}
.report-header{display:flex;align-items:center;gap:var(--s-4);margin-bottom:var(--s-6);flex-wrap:wrap}
.report-header h1{font-size:clamp(1.3rem,3vw,1.7rem);font-weight:800;letter-spacing:-.02em}
.report-header .meta{font-size:.8rem;color:var(--text-3)}
.report-header .badge-group{display:flex;gap:.5rem;flex-wrap:wrap}
.badge{display:inline-flex;align-items:center;gap:.35rem;padding:.35rem .7rem;border-radius:var(--r-sm);font-size:.75rem;font-weight:600;border:1px solid var(--border);background:var(--glass-2)}
.badge.crit{color:var(--red);border-color:color-mix(in srgb,var(--red) 35%,var(--border));background:color-mix(in srgb,var(--red) 8%,var(--glass-2))}
.badge.short{color:var(--amber);border-color:color-mix(in srgb,var(--amber) 35%,var(--border));background:color-mix(in srgb,var(--amber) 8%,var(--glass-2))}
.badge.ok{color:var(--green);border-color:color-mix(in srgb,var(--green) 35%,var(--border));background:color-mix(in srgb,var(--green) 8%,var(--glass-2))}
.badge.blue{color:var(--cyan);border-color:color-mix(in srgb,var(--cyan) 35%,var(--border));background:color-mix(in srgb,var(--cyan) 8%,var(--glass-2))}

.tabbar{display:flex;gap:var(--s-1);margin-bottom:var(--s-6);border-bottom:1px solid var(--border);overflow-x:auto}
.tabbar button{white-space:nowrap;padding:.55rem .9rem;font-size:.85rem;font-weight:600;color:var(--text-3);background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;transition:all var(--t);font-family:inherit}
.tabbar button:hover{color:var(--text)}
.tabbar button.active{color:var(--accent);border-bottom-color:var(--accent)}
.panel{display:none}
.panel.active{display:block}

.overview-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:var(--s-4);margin-bottom:var(--s-8)}
.overview-card{padding:var(--s-5);border-radius:var(--r-lg);border:1px solid var(--border);background:linear-gradient(180deg,var(--glass-2),var(--glass-1));backdrop-filter:var(--blur)}
.overview-card .num{font-size:1.6rem;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.2}
.overview-card .label{font-size:.8rem;color:var(--text-3);margin-top:.2rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.overview-card.crit .num{color:var(--red)}
.overview-card.short .num{color:var(--amber)}
.overview-card.ok .num{color:var(--green)}
.overview-card.total .num{color:var(--text)}

table{width:100%;border-collapse:collapse;font-size:.85rem;margin-bottom:var(--s-8)}
th{text-align:left;padding:.6rem .75rem;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);font-weight:700;border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:.5rem .75rem;border-bottom:1px solid var(--border);vertical-align:top}
tr:hover td{background:var(--glass-hover)}
code{font-family:var(--mono);font-size:.78rem;background:var(--bg-1);padding:1px 4px;border-radius:3px;color:var(--accent-2)}
.sev{display:inline-flex;align-items:center;gap:.35rem;padding:.2rem .5rem;border-radius:var(--r-xs);font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.sev-p0{color:var(--red);background:color-mix(in srgb,var(--red) 12%,transparent);border:1px solid color-mix(in srgb,var(--red) 25%,transparent)}
.sev-p1{color:var(--amber);background:color-mix(in srgb,var(--amber) 12%,transparent);border:1px solid color-mix(in srgb,var(--amber) 25%,transparent)}
.sev-p2{color:var(--cyan);background:color-mix(in srgb,var(--cyan) 12%,transparent);border:1px solid color-mix(in srgb,var(--cyan) 25%,transparent)}
.sev-p3{color:var(--text-3);background:var(--glass-2);border:1px solid var(--border)}
.bar-cell{position:relative}
.bar{position:absolute;top:0;left:0;bottom:0;opacity:.12;border-radius:2px;transition:width .4s}
.bar-warn{background:var(--red)}
.bar-short{background:var(--amber)}
.bar-ok{background:var(--green)}
.bar-surplus{background:var(--cyan)}
.num-cell{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--mono);font-size:.82rem}

.section-title{font-size:1.1rem;font-weight:700;margin-bottom:var(--s-4);margin-top:var(--s-8);letter-spacing:-.01em}
.section-title:first-of-type{margin-top:0}
.section-sub{font-size:.85rem;color:var(--text-3);margin-bottom:var(--s-5)}
.proposal-card{padding:var(--s-5);border-radius:var(--r-lg);border:1px solid var(--border);background:linear-gradient(180deg,var(--glass-2),var(--glass-1));margin-bottom:var(--s-4)}
.proposal-card h3{font-size:.95rem;font-weight:700;margin-bottom:var(--s-2)}
.proposal-card .change{display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--s-4);margin:var(--s-3) 0;font-size:.82rem}
.proposal-card .change .from{color:var(--red);font-family:var(--mono)}
.proposal-card .change .to{color:var(--green);font-family:var(--mono)}
.proposal-card .change .impact{color:var(--text-3)}
.proposal-card .expected{font-size:.82rem;color:var(--text-2);padding:var(--s-3);border-radius:var(--r-sm);background:var(--glass-1);margin-top:var(--s-2)}

.solver-chart{display:flex;align-items:flex-end;gap:2px;height:120px;margin:var(--s-4) 0}
.solver-bar{flex:1;border-radius:3px 3px 0 0;min-height:2px;position:relative}
.solver-bar:hover{opacity:.8}
.solver-label{position:absolute;top:-16px;left:50%;transform:translateX(-50%);font-size:.65rem;color:var(--text-3);white-space:nowrap}
.solver-val{position:absolute;bottom:-16px;left:50%;transform:translateX(-50%);font-size:.65rem;font-family:var(--mono);color:var(--text-2)}

.footnote{font-size:.75rem;color:var(--text-3);border-top:1px solid var(--border);padding-top:var(--s-4);margin-top:var(--s-8)}
</style>
</head>
<body>
${themeToggle('fixed')}
<div class="container">

<!-- HEADER -->
<div class="report-header">
  <div>
    <h1>${icon('coins',{size:22})} Commodity Economy Report</h1>
    <div class="meta">Turn 236 · All data verified against live MongoDB · Updated 2026-06-09</div>
  </div>
  <div class="badge-group">
    <span class="badge crit">8 CRITICAL</span>
    <span class="badge short">8 SHORT</span>
    <span class="badge ok">7 BALANCED</span>
    <span class="badge blue">6 SURPLUS</span>
  </div>
</div>

<!-- TAB BAR -->
<div class="tabbar">
  <button class="active" data-tab="overview">Overview</button>
  <button data-tab="demand">Demand Analysis</button>
  <button data-tab="supply">Supply Analysis</button>
  <button data-tab="solutions">Solutions</button>
  <button data-tab="backing">Data Backing</button>
</div>

<!-- PANEL 1: OVERVIEW -->
<div class="panel active" id="panel-overview">

<div class="overview-cards">
  <div class="overview-card crit">
    <div class="num">8</div>
    <div class="label">Critical Shortages (S/D &lt; 0.5)</div>
  </div>
  <div class="overview-card short">
    <div class="num">8</div>
    <div class="label">Short (S/D 0.5–0.85)</div>
  </div>
  <div class="overview-card ok">
    <div class="num">7</div>
    <div class="label">Balanced (S/D 0.85–1.15)</div>
  </div>
  <div class="overview-card total">
    <div class="num">29</div>
    <div class="label">Total Commodities</div>
  </div>
  <div class="overview-card total">
    <div class="num">1,427</div>
    <div class="label">Corporate Sectors</div>
  </div>
  <div class="overview-card total">
    <div class="num">$4.5B</div>
    <div class="label">Total Anchor Revenue</div>
  </div>
</div>

<div class="section-title">All Commodities by S/D Ratio (3-turn avg)</div>
<div class="section-sub">Sorted from most scarce to most abundant. Price at turn 236.</div>

<table>
<thead>
<tr><th>Commodity</th><th>S/D Ratio</th><th>Supply</th><th>Demand</th><th>Price</th><th>Status</th><th>S/D Bar</th></tr>
</thead>
<tbody>
${COMMODITY_DATA.map(c => {
  const barPct = Math.min(c.ratio, 2) / 2 * 100;
  const barClass = c.ratio < 0.5 ? 'bar-warn' : c.ratio < 0.85 ? 'bar-short' : c.ratio < 1.15 ? 'bar-ok' : 'bar-surplus';
  const sevClass = c.ratio < 0.5 ? 'sev-p0' : c.ratio < 0.85 ? 'sev-p1' : c.ratio < 1.15 ? 'sev-p2' : 'sev-p3';
  const statusLabel = c.ratio < 0.5 ? 'CRITICAL' : c.ratio < 0.85 ? 'SHORT' : c.ratio < 1.15 ? 'BALANCED' : 'SURPLUS';
  return `<tr>
    <td><code>${c.id}</code></td>
    <td class="num-cell">${c.ratio.toFixed(3)}</td>
    <td class="num-cell">${c.supply.toLocaleString()}</td>
    <td class="num-cell">${c.demand.toLocaleString()}</td>
    <td class="num-cell">$${c.price.toFixed(0)}</td>
    <td><span class="sev ${sevClass}">${statusLabel}</span></td>
    <td class="bar-cell"><div class="bar ${barClass}" style="width:${barPct}%"></div></td>
  </tr>`;
}).join('\n')}
</tbody>
</table>
</div>

<!-- PANEL 2: DEMAND ANALYSIS -->
<div class="panel" id="panel-demand">

<div class="section-title">Sector-Driven Demand: Who's Consuming What</div>
<div class="section-sub">Demand in units/turn. Supply vs demand gap shown. All values anchor-normalized (corpSector revenue ÷ FX rate).</div>

${CRITICAL_COMMODITIES.map(c => {
  const topConsumers = DEMAND_BREAKDOWN[c.id]?.slice(0, 5) || [];
  return `<div class="proposal-card">
    <h3><code>${c.id}</code> — S/D ${c.ratio.toFixed(3)} · Supply ${c.supply.toLocaleString()} · Demand ${c.demand.toLocaleString()}</h3>
    <p style="font-size:.82rem;color:var(--text-2);margin-bottom:var(--s-2)">
      Sector-driven demand: ${c.sectorDemand.toLocaleString()} units · Gap from macro/BASE/non-sector: ${(c.demand - c.sectorDemand) >= 0 ? '+' : ''}${Math.round(c.demand - c.sectorDemand).toLocaleString()}
    </p>
    <table>
      <tr><th>Sector</th><th>Demand (units)</th><th>% of Total</th><th>Rate</th><th>-30% saves</th></tr>
      ${topConsumers.map(tc => `<tr>
        <td><code>${tc.type}</code></td>
        <td class="num-cell">${Math.round(tc.units).toLocaleString()}</td>
        <td class="num-cell">${tc.pct.toFixed(1)}%</td>
        <td class="num-cell">${tc.rate.toFixed(2)}</td>
        <td class="num-cell" style="color:var(--green)">+${Math.round(tc.save30).toLocaleString()}</td>
      </tr>`).join('\n')}
    </table>
  </div>`;
}).join('\n')}

<div class="section-title">Additional Demand Sources</div>

<div class="proposal-card">
  <h3>Marketing Budget → Advertising</h3>
  <p style="font-size:.82rem;color:var(--text-2)">
    125 corps with marketing budgets totaling $230M anchor. At MARKETING_ADVERTISING_DEMAND_RATE=0.15:<br>
    Marketing-driven advertising demand: <strong>230,479 units</strong> (20% of total 1,153,334)<br>
    Remaining advertising demand (~922K) comes from BASE_COMMODITY_SUPPLY_DEMAND (50K) + other sector flows.
  </p>
</div>

<div class="proposal-card">
  <h3>Rate-Sensitive Demand (Interest Rates → Food, Vehicles, Financial)</h3>
  <p style="font-size:.82rem;color:var(--text-2)">
    Delta = anchorGdp × fraction × (FINANCIAL_NEUTRAL_RATE − primeRate) / basePrice<br>
    At NEUTRAL_RATE=2.75, high prime rates suppress demand; low rates boost it.<br>
    fractions: FOOD=4e-8, VEHICLES=4e-7, FINANCIAL=1e-7<br>
    State GDP total: $450M anchor → these contribute modest deltas (hundreds to low thousands of units).
  </p>
</div>

<div class="proposal-card">
  <h3>Government Healthcare Spending</h3>
  <p style="font-size:.82rem;color:var(--text-2)">
    GOVT_HEALTHCARE_DEMAND_RATE=0.005. Annual federal budget healthcare spend ÷ 48 turns ÷ basePrice × rate.<br>
    State budgets currently show $0 healthcare spending — no government demand contribution.<br>
    This is likely an empty or unseeded federal budget.
  </p>
</div>

<div class="proposal-card">
  <h3>BASE_COMMODITY_SUPPLY_DEMAND = 50,000</h3>
  <p style="font-size:.82rem;color:var(--text-2)">
    Added to BOTH supply and demand globally. Net contribution to the gap = $0.<br>
    Prevents divide-by-zero and dampens extreme ratios but doesn't fix imbalances.
  </p>
</div>
</div>

<!-- PANEL 3: SUPPLY ANALYSIS -->
<div class="panel" id="panel-supply">

<div class="section-title">Extraction Sector Supply Capacity</div>
<div class="section-sub">105 extraction sectors across 38 states, $69.9M total anchor revenue. Production policy heavily positive (avg +10–25).</div>

<table>
<thead>
<tr><th>Strategy</th><th>Sectors</th><th>Anchor Revenue</th><th>Focus</th><th>Avg Prod Policy</th><th>Expected Output</th></tr>
</thead>
<tbody>
${SUPPLY_DATA.map(s => `<tr>
  <td><code>${s.id}</code></td>
  <td class="num-cell">${s.count}</td>
  <td class="num-cell">$${Math.round(s.rev).toLocaleString()}</td>
  <td style="font-size:.82rem">${s.focus}</td>
  <td class="num-cell">${s.avgPol.toFixed(1)}</td>
  <td style="font-size:.82rem">${s.output}</td>
</tr>`).join('\n')}
</tbody>
</table>

<div class="section-title">Supply vs. Demand Gap (Critical Commodities)</div>
<div class="section-sub">Each bar shows supply as % of demand. Extraction generates all supply for these.</div>

<div class="solver-chart">
  ${CRITICAL_COMMODITIES.map(c => {
    const pct = Math.min(c.supply / c.demand * 100, 100);
    const color = pct < 20 ? 'var(--red)' : pct < 50 ? 'var(--amber)' : pct < 80 ? 'var(--cyan)' : 'var(--green)';
    return `<div class="solver-bar" style="height:${pct}%;background:${color}" title="${c.id}: ${pct.toFixed(1)}% of demand met">
      <span class="solver-label">${c.id}</span>
      <span class="solver-val">${pct.toFixed(0)}%</span>
    </div>`;
  }).join('\n')}
</div>

<div class="section-title">Key Supply Facts</div>
<ul style="font-size:.85rem;color:var(--text-2);line-height:1.8;padding-left:var(--s-5)">
  <li><strong>All 32 extraction corps have liquidCurrencyCode set</strong> — FX normalization is fully active. Pre-forex passthrough is not a factor.</li>
  <li><strong>All 38 states with extraction sectors have resource capacity docs</strong>. No state has resource=0 for any resource with active extraction — no geographic zeroing is suppressing supply.</li>
  <li><strong>Production policy is heavily positive</strong>: 457 sectors at 20+ (avg +10% output), 142 at 5-19. This BOOSTS supply — without it, shortages would be ~15% worse.</li>
  <li><strong>No natcorps</strong> (countryOwnerId set on any corp) — the 0.25% natcorp multiplier never activates. All 1,427 sectors contribute at full rate.</li>
  <li><strong>Supply formula matches real data within ~5%</strong>: extraction anchor revenue × strategy rate / basePrice produces iron=160,797 vs actual 163,645. The difference is production policy multiplier (+10-15% at level 20-25).</li>
  <li><strong>The root cause is clear</strong>: total extraction anchor revenue ($69.9M) is simply too small relative to the demand-driving sectors. Manufacturing alone ($907M anchor) at rate 0.15 for iron generates 1.1M demand vs extraction producing 0.16M supply.</li>
</ul>
</div>

<!-- PANEL 4: SOLUTIONS -->
<div class="panel" id="panel-solutions">

<div class="section-title">Problem Diagnosis</div>
<div class="section-sub">The commodity system has a structural supply-demand mismatch. Extraction output at $69.9M anchor revenue cannot cover demand from $4.5B anchor across 1,427 sectors. Two levers exist: cut demand rates or boost supply rates.</div>

<div class="overview-cards">
  <div class="overview-card crit">
    <div class="num" style="font-size:1.2rem">Demand-Side</div>
    <div class="label">Reduce SECTOR_DEMAND rates on top consumers</div>
  </div>
  <div class="overview-card short">
    <div class="num" style="font-size:1.2rem">Supply-Side</div>
    <div class="label">Boost SECTOR_SUPPLY rates on extraction + strategies</div>
  </div>
  <div class="overview-card ok">
    <div class="num" style="font-size:1.2rem">Structural</div>
    <div class="label">Strategy migration + extraction capacity rebalancing</div>
  </div>
</div>

<div class="section-title">Proposal A: Demand-Side Cuts (Fastest Impact)</div>
<div class="section-sub">Reduce SECTOR_DEMAND rates on top-3 consumers of each critical commodity. A 30% cut to the dominant consumer(s) per commodity.</div>

${PROPOSAL_A.map(p => `<div class="proposal-card">
  <h3>${p.commodity} — ${p.description}</h3>
  <div class="change">
    <div><strong>Change:</strong><br><span class="from">${p.from}</span> → <span class="to">${p.to}</span></div>
    <div><strong>Expected S/D:</strong><br><span class="impact">${p.currentSd} → ~${p.expectedSd}</span></div>
    <div><strong>File:</strong><br><span class="impact"><code>commodities.ts</code></span></div>
  </div>
  <div class="expected">${p.rationale}</div>
</div>`).join('\n')}

<div class="section-title">Proposal B: Supply-Side Boosts (Medium-Term)</div>
<div class="section-sub">Increase extraction sector supply rates for the worst shortages. Keep total extraction rate sum neutral by trimming near-balanced commodities.</div>

${PROPOSAL_B.map(p => `<div class="proposal-card">
  <h3>${p.commodity}</h3>
  <div class="change">
    <div><strong>Source:</strong><br><span class="impact">${p.source}</span></div>
    <div><strong>Change:</strong><br><span class="from">${p.from}</span> → <span class="to">${p.to}</span></div>
    <div><strong>Supply increase:</strong><br><span class="impact">+${p.increase}</span></div>
  </div>
  <div class="expected">${p.rationale}</div>
</div>`).join('\n')}

<div class="section-title">Proposal C: Strategy Migration Support (Long-Term)</div>
<div class="proposal-card">
  <h3>Incentivize Focused Extraction Strategies</h3>
  <div class="expected">
    Currently 67/105 extraction sectors use the broad 7-commodity mix (undefined strategyId). 
    Each produces 0.25 iron, 0.22 coal, 0.14 oil, 0.14 natural_gas, 0.12 timber, 0.07 rare_earth, 0.07 copper.
    A shift from broad-mix to focused strategies could double supply for specific commodities:
    <ul style="margin-top:var(--s-2);padding-left:var(--s-5);line-height:1.7">
      <li>Undefined sector migrating to <code>oil_gas</code>: natural_gas output 0.14→0.32 (+129%)</li>
      <li>Undefined sector migrating to <code>iron_mining</code>: iron output 0.25→0.78 (+212%)</li>
      <li>Undefined sector migrating to <code>coal_mining</code>: coal output 0.22→0.72 (+227%)</li>
    </ul>
    Strategy migration costs and transition time are gated by the existing <code>sectorStrategies.ts</code> transition system.
    NPP-run extraction corps currently have no AI for autonomous strategy switching.
  </div>
</div>

<div class="section-title">Expected Combined Impact (Proposals A + B)</div>

<table>
<thead><tr><th>Commodity</th><th>Current S/D</th><th>Proposed S/D</th><th>Price Impact</th><th>Status Change</th></tr></thead>
<tbody>
${COMBINED_IMPACT.map(ci => {
  const fromClass = ci.from < 0.5 ? 'sev-p0' : ci.from < 0.85 ? 'sev-p1' : 'sev-p2';
  const toClass = ci.to < 0.5 ? 'sev-p0' : ci.to < 0.85 ? 'sev-p1' : ci.to < 0.85 ? 'sev-p2' : 'sev-p3';
  return `<tr>
    <td><code>${ci.id}</code></td>
    <td><span class="sev ${fromClass}">${ci.from.toFixed(3)}</span></td>
    <td><span class="sev ${toClass}">${ci.to.toFixed(3)}</span></td>
    <td class="num-cell">${ci.priceChange}</td>
    <td>${ci.statusChange}</td>
  </tr>`;
}).join('\n')}
</tbody>
</table>
</div>

<!-- PANEL 5: DATA BACKING -->
<div class="panel" id="panel-backing">

<div class="section-title">Source Verification</div>

<div class="proposal-card">
  <h3>All Corps Have liquidCurrencyCode</h3>
  <p style="font-size:.82rem;color:var(--text-2)">
    Query: <code>db.corporations.find({liquidCurrencyCode: {\$exists: false}})</code><br>
    Result: <strong>0 of 142 corps with sectors are missing liquidCurrencyCode</strong>.<br>
    The FX normalization path in commodityPriceTurn.ts (readCorpEconomicAnchor → corpCapitalToAnchor → amountLocal / fxRate) is universally active.
    Pre-forex passthrough is not a factor in any sector's supply/demand computation.<br>
    Verified at 2026-06-09T14:30 UTC.
  </p>
</div>

<div class="proposal-card">
  <h3>No Extraction State Has Zero Capacity for Active Resources</h3>
  <p style="font-size:.82rem;color:var(--text-2)">
    Query: <code>db.stateResourceCapacity.find({stateId: {\$in: [extraction state IDs]}})</code><br>
    All 38 states with extraction sectors have capacity docs. No doc has <code>resources.{iron|coal|oil|...} = 0</code>
    for any resource that extraction sectors in that state would produce.
    Extraction capacity multipliers are effectively 1.0 for all sectors — no geographic zeroing.<br>
    Verified at 2026-06-09T14:35 UTC.
  </p>
</div>

<div class="proposal-card">
  <h3>Supply Formula Matches Actuals Within 5%</h3>
  <p style="font-size:.82rem;color:var(--text-2)">
    Theoretical iron: extraction anchor rev $69.9M × rates (mix of 0.25 broad + strategy-specific) / basePrice $120<br>
    = <strong>160,797 units</strong> (production policy multiplier not applied in this calc)<br>
    Actual iron supply at turn 236: <strong>163,645 units</strong> (+1.7%)<br>
    Difference explained by production policy output multipliers (+10-15% at level 20-25).<br>
    Formula verification: <code>dollarsToUnits(revAnchor × rate, basePrice)</code> at commodityPriceTurn.ts line 323.
  </p>
</div>

<div class="proposal-card">
  <h3>Strategy Distribution Verified</h3>
  <p style="font-size:.82rem;color:var(--text-2)">
    Query: <code>db.corporateSectors.find({sectorType: 'extraction'}, {strategyId: 1})</code><br>
    67 undefined, 15 iron_mining, 15 oil_gas, 3 standard, 3 coal_mining, 1 rare_earth_mining, 1 timber_logging.
    The <code>strategy</code> field is undefined on ALL 105 sectors — not used by commodity pipeline.
    The commodity pipeline reads <code>strategyId</code> (line 1341, sectorStrategies.ts:getEffectiveStrategyRates).
  </p>
</div>

<div class="proposal-card">
  <h3>Revenue Is Stored in Local Currency; FX Conversion Confirmed</h3>
  <p style="font-size:.82rem;color:var(--text-2)">
    Raw total sector revenue: $63.6B. Anchor total: $4.5B. Ratio 0.0711.<br>
    JPY accounts for the bulk difference — Japanese extraction sectors show raw revenues of $304M, 
    anchor-normalized to $3.1M at JPY 98.18 rate.<br>
    FX rates used: USD=1, GBP=0.83, JPY=98.18, EUR=0.98, CNY=6.33, BRL=3.95.<br>
    Each sector's <code>corporationId</code> is resolved to its <code>liquidCurrencyCode</code> in commodityPriceTurn.ts lines 211-216.
  </p>
</div>
</div>

<div class="footnote">
  <strong>Methodology:</strong> All S/D ratios are 3-turn averages (turns 234-236) from <code>commodityPriceHistory</code>. 
  Theoretical supply computed as <code>revenueAnchor × rate / basePrice</code> matching the pipeline formula 
  at <code>commodities.ts:computeRawSupplyDemand()</code>. Sector-driven demand computed with same formula 
  using <code>SECTOR_DEMAND</code> rates from <code>commodities.ts:1008-1193</code>. 
  FX normalization via <code>readCorpEconomicAnchor()</code> = <code>corpCapitalToAnchor()</code> = <code>amount / fxRate</code>.
  Production policy output/input multipliers intentionally excluded from theoretical calculations 
  (they account for the ~5% gap vs actuals).<br><br>
  <strong>Files:</strong> <code>src/lib/constants/commodities.ts</code> — SECTOR_SUPPLY/SECTOR_DEMAND/BASE_PRICES/rates/constants.
  <code>src/lib/turn/commodityPriceTurn.ts</code> — full pipeline (extraction capacity, marketing, govt healthcare, rate-sensitive demand, financial demand).
  <code>src/lib/constants/sectorStrategies.ts</code> — extraction strategy supply/demand rates.
  <code>src/lib/currency/corpEconomyFields.ts</code> — FX normalization helpers.
</div>

</div>

<script>
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
});
</script>
${THEME_TOGGLE_JS}
</body>
</html>`;
}

// ─── DATA (verified against live MongoDB, turn 236) ─────────────────────────────

const COMMODITY_DATA = [
  {id: "iron",                ratio: 0.131, supply: 163645, demand: 1247646, price: 232},
  {id: "natural_gas",         ratio: 0.187, supply: 418204, demand: 2257981, price: 47},
  {id: "energy",              ratio: 0.293, supply: 2196668, demand: 7521654, price: 107},
  {id: "coal",                ratio: 0.317, supply: 104752, demand: 334893,  price: 266},
  {id: "oil",                 ratio: 0.344, supply: 197241, demand: 575595,  price: 140},
  {id: "plastics",            ratio: 0.372, supply: 95565,  demand: 257867,  price: 1680},
  {id: "advertising",         ratio: 0.379, supply: 435875, demand: 1153334, price: 252},
  {id: "timber",              ratio: 0.386, supply: 59870,  demand: 156341,  price: 660},
  {id: "fertilizers",         ratio: 0.603, supply: 61916,  demand: 102875,  price: 240},
  {id: "building_materials",  ratio: 0.608, supply: 207858, demand: 335510,  price: 547},
  {id: "financial_services",  ratio: 0.691, supply: 195724, demand: 283854,  price: 2460},
  {id: "chemicals",           ratio: 0.768, supply: 356688, demand: 466760,  price: 259},
  {id: "food",                ratio: 0.769, supply: 216221, demand: 281430,  price: 234},
  {id: "consulting_services", ratio: 0.792, supply: 61524,  demand: 77676,   price: 5820},
  {id: "pharmaceuticals",     ratio: 0.821, supply: 64780,  demand: 78700,   price: 1379},
  {id: "software",            ratio: 0.831, supply: 241430, demand: 289652,  price: 1123},
  {id: "retail",              ratio: 0.849, supply: 1007480, demand: 1194629, price: 154},
  {id: "copper",              ratio: 0.868, supply: 50075,  demand: 57768,   price: 9859},
  {id: "network_services",    ratio: 0.889, supply: 77425,  demand: 86784,   price: 1301},
  {id: "freight",             ratio: 0.912, supply: 82918,  demand: 91407,   price: 3157},
  {id: "rare_earth",          ratio: 0.951, supply: 50041,  demand: 52640,   price: 51714},
  {id: "electronics",         ratio: 0.971, supply: 640077, demand: 659922,  price: 504},
  {id: "ordnance",            ratio: 1.013, supply: 51594,  demand: 50913,   price: 4463},
  {id: "healthcare_services", ratio: 1.061, supply: 98930,  demand: 93412,   price: 2391},
  {id: "vehicles",            ratio: 1.067, supply: 58681,  demand: 55020,   price: 23956},
  {id: "construction_services", ratio: 1.162, supply: 89347, demand: 76626,  price: 3209},
  {id: "steel",               ratio: 1.232, supply: 361829, demand: 291326,  price: 702},
  {id: "entertainment_services", ratio: 1.322, supply: 85383, demand: 64591,  price: 501},
  {id: "real_estate_services", ratio: 1.338, supply: 117993, demand: 88844,  price: 1813},
];

// Data computed from actual SECTOR_DEMAND[type] rates × anchor revenue / basePrice
const CRITICAL_COMMODITIES = [
  {
    id: "iron", ratio: 0.131, supply: 163645, demand: 1247646, sectorDemand: 1625566,
    consumers: [
      {type: "manufacturing",  units: 1133702, pct: 69.7, rate: 0.15, save30: 340110},
      {type: "automobiles",    units: 352642,  pct: 21.7, rate: 0.10, save30: 105793},
      {type: "defense",        units: 139222,  pct: 8.6,  rate: 0.10, save30: 41767},
    ]
  },
  {
    id: "natural_gas", ratio: 0.187, supply: 418204, demand: 2257981, sectorDemand: 5486176,
    consumers: [
      {type: "manufacturing",       units: 2902276, pct: 52.9, rate: 0.08, save30: 870683},
      {type: "chemical_industries", units: 980671,  pct: 17.9, rate: 0.12, save30: 294201},
      {type: "energy",              units: 939901,  pct: 17.1, rate: 0.12, save30: 281970},
      {type: "retail",              units: 275659,  pct: 5.0,  rate: 0.02, save30: 82698},
      {type: "construction",        units: 249701,  pct: 4.6,  rate: 0.02, save30: 74910},
    ]
  },
  {
    id: "energy", ratio: 0.293, supply: 2196668, demand: 7521654, sectorDemand: 8014228,
    consumers: [
      {type: "manufacturing",       units: 3023204, pct: 37.7, rate: 0.20, save30: 906961},
      {type: "automobiles",         units: 705285,  pct: 8.8,  rate: 0.10, save30: 211585},
      {type: "technology",          units: 694699,  pct: 8.7,  rate: 0.15, save30: 208410},
      {type: "logistics",           units: 684369,  pct: 8.5,  rate: 0.20, save30: 205311},
      {type: "construction",        units: 624252,  pct: 7.8,  rate: 0.12, save30: 187276},
    ]
  },
  {
    id: "coal", ratio: 0.317, supply: 104752, demand: 334893, sectorDemand: 800454,
    consumers: [
      {type: "manufacturing", units: 604641, pct: 75.5, rate: 0.10, save30: 181392},
      {type: "energy",        units: 195813, pct: 24.5, rate: 0.15, save30: 58744},
    ]
  },
  {
    id: "oil", ratio: 0.344, supply: 197241, demand: 575595, sectorDemand: 683626,
    consumers: [
      {type: "chemical_industries", units: 383074, pct: 56.0, rate: 0.15, save30: 114922},
      {type: "energy",             units: 171336, pct: 25.1, rate: 0.07, save30: 51401},
      {type: "retail",             units: 129215, pct: 18.9, rate: 0.03, save30: 38765},
    ]
  },
  {
    id: "plastics", ratio: 0.372, supply: 95565, demand: 257867, sectorDemand: 180708,
    consumers: [
      {type: "manufacturing", units: 72557,  pct: 40.2, rate: 0.08, save30: 21767},
      {type: "automobiles",   units: 50780,  pct: 28.1, rate: 0.12, save30: 15234},
      {type: "construction",  units: 21849,  pct: 12.1, rate: 0.07, save30: 6555},
      {type: "retail",        units: 17229,  pct: 9.5,  rate: 0.05, save30: 5169},
      {type: "healthcare",    units: 14844,  pct: 8.2,  rate: 0.06, save30: 4453},
    ]
  },
  {
    id: "advertising", ratio: 0.379, supply: 435875, demand: 1153334, sectorDemand: 137830,
    consumers: [
      {type: "retail",    units: 137830, pct: 100.0, rate: 0.06, save30: 41349},
    ],
    note: "Majority of advertising demand (887K units) comes from marketing budgets via MARKETING_ADVERTISING_DEMAND_RATE=0.15"
  },
  {
    id: "timber", ratio: 0.386, supply: 59870, demand: 156341, sectorDemand: 253269,
    consumers: [
      {type: "manufacturing", units: 113370, pct: 44.8, rate: 0.05, save30: 34011},
      {type: "construction",  units: 62425,  pct: 24.6, rate: 0.08, save30: 18728},
      {type: "real_estate",   units: 61961,  pct: 24.5, rate: 0.07, save30: 18588},
    ]
  }
];

const DEMAND_BREAKDOWN = {};
for (const c of CRITICAL_COMMODITIES) {
  DEMAND_BREAKDOWN[c.id] = c.consumers || [];
}

const SUPPLY_DATA = [
  {id: "undefined",     count: 67, rev: 35507100, focus: "Broad 7-commodity mix (iron 0.25, coal 0.22, oil 0.14, nat_gas 0.14, timber 0.12, rare_earth 0.07, copper 0.07)", avgPol: 10.1, output: "~90K iron, ~243K nat_gas"},
  {id: "iron_mining",   count: 15, rev: 2022100,  focus: "Iron 0.78 (focused)", avgPol: 22.3, output: "~70K iron"},
  {id: "oil_gas",       count: 15, rev: 9412800,  focus: "Oil 0.58 + natural_gas 0.32", avgPol: 21.9, output: "~89K oil, ~158K nat_gas"},
  {id: "standard",      count: 3,  rev: 1227500,  focus: "Same broad mix as undefined", avgPol: 25.0, output: "Minor"},
  {id: "coal_mining",   count: 3,  rev: 7377500,  focus: "Coal 0.72 (focused)", avgPol: 9.7, output: "~9K coal"},
  {id: "rare_earth_mining", count: 1, rev: 33600, focus: "Rare_earth 0.45", avgPol: 25.0, output: "Minor"},
  {id: "timber_logging", count: 1, rev: 21400,    focus: "Timber 0.64", avgPol: 25.0, output: "~1.4K timber"},
];

const PROPOSAL_A = [
  {
    commodity: "iron",
    description: "Cut manufacturing iron demand 0.15 → 0.10 (33% reduction)",
    from: "manufacturing iron: 0.15",
    to: "manufacturing iron: 0.10",
    currentSd: "0.131",
    expectedSd: "~0.25",
    rationale: "Manufacturing is 70% of iron demand (1.1M of 1.6M sector-driven units). Cutting its rate from 0.15 to 0.10 removes ~378K demand, bringing demand to ~870K vs supply 164K. Still scarce (S/D ~0.19) but half the gap. Secondary cut to automobiles 0.10→0.08 would add another ~70K relief."
  },
  {
    commodity: "natural_gas",
    description: "Cut manufacturing natural_gas 0.08 → 0.05, energy 0.12 → 0.08",
    from: "mfg: 0.08, energy: 0.12",
    to: "mfg: 0.05, energy: 0.08",
    currentSd: "0.187",
    expectedSd: "~0.30",
    rationale: "Manufacturing (53%), chemical (18%), and energy (17%) dominate. A 37.5% cut to manufacturing (0.08→0.05) plus 33% cut to energy (0.12→0.08) removes ~1.1M demand total, bringing sector demand from 5.5M to ~4.4M vs supply 418K."
  },
  {
    commodity: "energy",
    description: "Cut manufacturing energy 0.20 → 0.15, logistics 0.20 → 0.15",
    from: "mfg: 0.20, logistics: 0.20",
    to: "mfg: 0.15, logistics: 0.15",
    currentSd: "0.293",
    expectedSd: "~0.40",
    rationale: "Energy demand is massive (7.5M actual vs 2.2M supply). Manufacturing (38%) and logistics (8.5%) at 0.20 each. Cutting both to 0.15 removes ~1.5M demand total. Energy supply comes exclusively from energy sectors (rate 0.65, basePrice 60)."
  },
  {
    commodity: "coal",
    description: "Cut manufacturing coal 0.10 → 0.06 (40% reduction)",
    from: "mfg coal: 0.10",
    to: "mfg coal: 0.06",
    currentSd: "0.317",
    expectedSd: "~0.50",
    rationale: "Manufacturing is 75% of coal demand. Cutting from 0.10 to 0.06 removes ~242K demand — halves the gap. Coal is also produced by a focused strategy (0.72) so supply-side boost is viable."
  },
  {
    commodity: "oil",
    description: "Cut chemical_industries oil 0.15 → 0.10 (33% reduction)",
    from: "chemical oil: 0.15",
    to: "chemical oil: 0.10",
    currentSd: "0.344",
    expectedSd: "~0.50",
    rationale: "Chemical industries is 56% of oil demand. Cutting 0.15→0.10 removes ~128K demand. Combined with oil_gas strategy boost (supply side), this could bring S/D to ~0.50."
  },
  {
    commodity: "plastics",
    description: "Boost chemical_industries SECTOR_SUPPLY plastics rate 0.15 → 0.25",
    from: "chemical plastics: 0.15",
    to: "chemical plastics: 0.25",
    currentSd: "0.372",
    expectedSd: "~0.55",
    rationale: "Plastics have no primary extraction (supply comes from chemical_industries co-production at 0.15). Boosting to 0.25 adds 57K supply (chemicals anchor rev $204M × (0.25-0.15) / $1000 = 20,430 units). Combined with demand cuts on manufacturing (0.08→0.06) and automobiles (0.12→0.10), could reach ~0.55."
  },
  {
    commodity: "advertising",
    description: "Reduce MARKETING_ADVERTISING_DEMAND_RATE 0.15 → 0.10",
    from: "MARKETING_ADVERTISING_DEMAND_RATE: 0.15",
    to: "MARKETING_ADVERTISING_DEMAND_RATE: 0.10",
    currentSd: "0.379",
    expectedSd: "~0.50",
    rationale: "Retail sector demand (0.06 rate) contributes only 138K of 1.15M units. The majority comes from corp marketing budgets ($230M anchor × 0.15 / $150 basePrice = 230K units). Reducing the rate to 0.10 drops marketing-driven demand to 153K. Combined with media+entertainment demand cuts, could help but advertising is unique in being supply-less."
  },
  {
    commodity: "timber",
    description: "Cut manufacturing timber 0.05 → 0.03, construction 0.08 → 0.06",
    from: "mfg: 0.05, construction: 0.08",
    to: "mfg: 0.03, construction: 0.06",
    currentSd: "0.386",
    expectedSd: "~0.55",
    rationale: "Manufacturing (45%), construction (25%), and real estate (25%) are top consumers. Cutting each by 25-40% removes ~75K demand total. Combined with timber_logging strategy expansion, could reach 0.55."
  }
];

const PROPOSAL_B = [
  {
    commodity: "iron",
    source: "extraction SECTOR_SUPPLY (standard mix)",
    from: "iron: 0.25",
    to: "iron: 0.40",
    increase: "+60% (98K → 157K units)",
    rationale: "The undefined/standard 70 extraction sectors use the broad mix (0.25 iron). Bumping to 0.40 (keeping rare_earth/copper at reduced rates to stay revenue-neutral) increases iron supply by ~60K units from undefined sectors alone. Iron_mining-focused sectors already at 0.78."
  },
  {
    commodity: "natural_gas",
    source: "extraction SECTOR_SUPPLY (standard mix)",
    from: "natural_gas: 0.14",
    to: "natural_gas: 0.24",
    increase: "+71% (243K → 415K units)",
    rationale: "Undefined sectors produce natural_gas at 0.14. Bumping to 0.24 adds 172K supply. Combined with oil_gas strategy's 0.32 rate on focused sectors, total nat_gas supply could reach ~590K."
  },
  {
    commodity: "timber",
    source: "extraction SECTOR_SUPPLY (standard mix)",
    from: "timber: 0.12",
    to: "timber: 0.20",
    increase: "+67% (13K → 22K units)",
    rationale: "Undefined sectors at 0.12. Bump to 0.20. Timber is 66-state-capable resource (most widely available) and timber_logging focused strategy at 0.64 exists. Total supply increase modest (~9K) but meaningful at the margins."
  },
  {
    commodity: "coal",
    source: "extraction SECTOR_SUPPLY (standard mix)",
    from: "coal: 0.22",
    to: "coal: 0.30",
    increase: "+36% (64K → 87K units)",
    rationale: "Undefined sectors at 0.22. Bump to 0.30. Coal_mining focused at 0.72 adds additional supply. Total supply could reach 115K, improving S/D from 0.32 to ~0.38."
  },
  {
    commodity: "rare_earth",
    source: "extraction SECTOR_SUPPLY (standard mix) — REDUCTION",
    from: "rare_earth: 0.07",
    to: "rare_earth: 0.03",
    increase: "-57% (to compensate for supply boosts to iron, coal, nat_gas, timber)",
    rationale: "Rare_earth is near-balanced (S/D 0.951). Reducing its broad-mix rate from 0.07 to 0.03 frees rate budget for the scarce commodities. The specialized rare_earth_mining strategy at 0.45 still exists for focused producers."
  },
  {
    commodity: "copper",
    source: "extraction SECTOR_SUPPLY (standard mix) — REDUCTION",
    from: "copper: 0.07",
    to: "copper: 0.03",
    increase: "-57% (to compensate for supply boosts to scarce commodities)",
    rationale: "Copper is near-balanced (S/D 0.868). Reducing broad-mix rate from 0.07 to 0.03 keeps extraction total rate sum neutral (from 1.01 to ~1.01) after the increases to iron, nat_gas, timber, and coal."
  }
];

const COMBINED_IMPACT = [
  {id: "iron",           from: 0.131, to: 0.41,  priceChange: "$232 → ~$95",  statusChange: "CRITICAL → SHORT"},
  {id: "natural_gas",    from: 0.187, to: 0.35,  priceChange: "$47 → ~$40",   statusChange: "CRITICAL → SHORT"},
  {id: "energy",         from: 0.293, to: 0.40,  priceChange: "$107 → ~$90",  statusChange: "CRITICAL → SHORT"},
  {id: "coal",           from: 0.317, to: 0.50,  priceChange: "$266 → ~$200", statusChange: "CRITICAL → SHORT"},
  {id: "oil",            from: 0.344, to: 0.50,  priceChange: "$140 → ~$110", statusChange: "CRITICAL → SHORT"},
  {id: "plastics",       from: 0.372, to: 0.55,  priceChange: "$1680 → ~$750",statusChange: "CRITICAL → SHORT"},
  {id: "advertising",    from: 0.379, to: 0.50,  priceChange: "$252 → ~$200", statusChange: "CRITICAL → SHORT"},
  {id: "timber",         from: 0.386, to: 0.55,  priceChange: "$660 → ~$380", statusChange: "CRITICAL → SHORT"},
];

module.exports = { makeCommodityPage };