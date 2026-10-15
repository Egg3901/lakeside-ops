// AHD US Presidential Election Demographic-Lean Audit
// Runs the ACTUAL game pipeline inline — no TS imports needed by the dashboard.
// Source: src/lib/seeds/stateDemographics.ts + src/lib/utils/demographics.ts

const fs = require("fs");
const path = require("path");
const { icon, faviconFor, THEME_HEAD, themeToggle, THEME_TOGGLE_JS } = require('./ui-kit');

const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, "election-engine-data.json"), "utf-8"));
const CAT = SEED.voterGroupsCategory;
const TR = SEED.turnoutRates;
const COMP = SEED.composition;
const voterGroupIds = ["young_renters","evangelicals","rural_traditionalists","union_trades","soccer_moms","college_liberals","small_business","public_sector","retirees","libertarians","new_immigrants","secular_professionals"];
const EC = {AL:9,AK:3,AZ:11,AR:6,CA:54,CO:10,CT:7,DE:3,DC:3,FL:30,GA:16,HI:4,ID:4,IL:19,IN:11,IA:6,KS:6,KY:8,LA:8,ME:4,MD:10,MA:11,MI:15,MN:10,MS:6,MO:10,MT:4,NE:5,NV:6,NH:4,NJ:14,NM:5,NY:28,NC:16,ND:3,OH:17,OK:7,OR:8,PA:19,RI:4,SC:9,SD:3,TN:11,TX:40,UT:6,VT:3,VA:13,WA:12,WV:4,WI:10,WY:3};

const CSV_PATH = path.join(require("os").homedir(), ".hermes/cache/documents/doc_b956ba0d0959_us-layer1-demographics.csv");
const groupDefs = {};
CAT.groups.forEach(g => { groupDefs[g.id] = g; });

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clampLean(v) { return clamp(Math.round(v * 10) / 10, -5, 5); }
function fmt(n) { return (n >= 0 ? "+" : "") + n.toFixed(2); }

function deriveGroupPopulations(config) {
  const vw = {};
  for (const [dim, groups] of Object.entries(config)) {
    vw[dim] = {};
    const rates = TR[dim] || {};
    for (const [key, pct] of Object.entries(groups)) {
      vw[dim][key] = (pct * (rates[key] || 55)) / 100;
    }
  }
  const raw = {};
  for (const [groupId, comp] of Object.entries(COMP)) {
    let score = 0;
    comp.weights.forEach(({dim, key, w}) => { score += (vw[dim]?.[key] ?? 0) * w; });
    score *= comp.civicMultiplier ?? 1.0;
    raw[groupId] = score;
  }
  const total = Object.values(raw).reduce((s, v) => s + v, 0);
  voterGroupIds.forEach(id => { raw[id] = total > 0 ? (raw[id] / total) * 100 : 100/12; });
  return raw;
}

function deriveGroupLean(groupId, config) {
  const def = groupDefs[groupId] || { defaultEconomicLean: 0, defaultSocialLean: 0 };
  const { ideology } = config;
  const cNet = ideology.patriots + ideology.gunowners - (ideology.progressives + ideology.environmentalists);
  const pNet = ideology.progressives + ideology.environmentalists - (ideology.evangelicals + ideology.patriots);
  const eNet = ideology.evangelicals - ideology.environmentalists;
  switch (groupId) {
    case "retirees": return { e: clampLean(def.defaultEconomicLean + cNet * 0.05), s: clampLean(def.defaultSocialLean + cNet * 0.05) };
    case "soccer_moms": return { e: clampLean(def.defaultEconomicLean - pNet * 0.04), s: clampLean(def.defaultSocialLean - pNet * 0.04) };
    case "union_trades": return { e: clampLean(def.defaultEconomicLean - (ideology.progressives - ideology.patriots) * 0.05), s: clampLean(def.defaultSocialLean - pNet * 0.03) };
    case "rural_traditionalists": return { e: clampLean(def.defaultEconomicLean + cNet * 0.04), s: clampLean(def.defaultSocialLean + cNet * 0.05) };
    case "evangelicals": return { e: clampLean(def.defaultEconomicLean + eNet * 0.04), s: clampLean(def.defaultSocialLean + eNet * 0.03) };
    case "small_business": return { e: clampLean(def.defaultEconomicLean + (ideology.libertarians - ideology.progressives) * 0.04), s: clampLean(def.defaultSocialLean + cNet * 0.02) };
    case "college_liberals": case "secular_professionals": case "public_sector": return { e: clampLean(def.defaultEconomicLean - pNet * 0.04), s: clampLean(def.defaultSocialLean - pNet * 0.04) };
    default: return { e: def.defaultEconomicLean, s: def.defaultSocialLean };
  }
}

function deriveGroupTurnout(groupId, config, baseT) {
  const comp = COMP[groupId];
  if (!comp) return baseT;
  const tw = comp.weights.reduce((s, c) => s + c.w, 0);
  let base = 0;
  comp.weights.forEach(({dim, key, w}) => { const r = TR[dim] || {}; base += (r[key] || 55) * (w / tw); });
  base *= comp.civicMultiplier ?? 1.0;
  const { age, education, race } = config;
  switch (groupId) {
    case "young_renters": return Math.round(clamp(base - (age.young - 24) * 0.4, 28, 48));
    case "retirees": return Math.round(clamp(base + (age.senior - 24) * 0.3, 70, 82));
    case "secular_professionals": return Math.round(clamp(base + (education.graduate - 14) * 0.15, 62, 76));
    case "new_immigrants": return Math.round(clamp(base + (race.hispanic + race.asian - 24) * 0.05, 30, 52));
    default: return Math.round(clamp(base, 25, 85));
  }
}

function generateStateDemographics(sid, config) {
  const pops = deriveGroupPopulations(config);
  const groups = {};
  voterGroupIds.forEach(id => {
    const gd = groupDefs[id];
    const bt = gd?.defaultTurnout ?? 55;
    const dt = deriveGroupTurnout(id, config, bt);
    const lean = deriveGroupLean(id, config);
    groups[id] = { population: Math.round(pops[id] * 100) / 100, economicLean: lean.e, socialLean: lean.s, turnout: dt };
  });
  return { _id: sid, countryId: "US", categoryWeights: { voterGroups: 100 }, groups };
}

function calculateStateLean(demog, categories) {
  if (!demog?.groups || !Array.isArray(categories) || !categories.length) return { e: 0, s: 0 };
  let tw = 0, we = 0, ws = 0;
  for (const cat of categories) {
    const cw = (demog.categoryWeights ?? {})[cat._id]; if (!cw || cw <= 0) continue;
    for (const g of (cat.groups || [])) {
      const sg = demog.groups[g.id]; if (!sg) continue;
      const pop = sg.population || 0;
      const t = sg.turnout ?? g.defaultTurnout ?? 55;
      const w = (pop / 100) * (t / 100) * (cw / 100);
      tw += w; we += w * (sg.economicLean ?? g.defaultEconomicLean ?? 0); ws += w * (sg.socialLean ?? g.defaultSocialLean ?? 0);
    }
  }
  return tw <= 0 ? { e: 0, s: 0 } : { e: clamp(Math.round((we / tw) * 100) / 100, -5, 5), s: clamp(Math.round((ws / tw) * 100) / 100, -5, 5) };
}

function getDisplayLean(e, s) {
  if ((e >= 0) === (s >= 0)) return Math.round(((e + s) / 2) * 100) / 100;
  return Math.round((Math.abs(e) >= Math.abs(s) ? e : s) * 100) / 100;
}

function computeAll() {
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const lines = raw.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/\r$/, ""));
  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(",").map(v => v.trim().replace(/\r$/, ""));
    if (vals.length < headers.length) continue;
    const st = {};
    headers.forEach((h, j) => { st[h] = h === "stateId" ? vals[j] : parseFloat(vals[j]); });
    const config = {
      race: { white: st.race_white, black: st.race_black, hispanic: st.race_hispanic, asian: st.race_asian, other: st.race_other },
      education: { no_college: st.education_no_college, college: st.education_college, graduate: st.education_graduate },
      wealth: { low: st.wealth_low, middle: st.wealth_middle, high: st.wealth_high },
      age: { young: st.age_young, mid: st.age_mid, mature: st.age_mature, senior: st.age_senior },
      ideology: { evangelicals: st.ideology_evangelicals, environmentalists: st.ideology_environmentalists, libertarians: st.ideology_libertarians, progressives: st.ideology_progressives, patriots: st.ideology_patriots, gunowners: st.ideology_gunowners },
    };
    const demog = generateStateDemographics(st.stateId, config);
    const lean = calculateStateLean(demog, [CAT]);
    const dl = getDisplayLean(lean.e, lean.s);
    const cat = dl < -0.3 ? "safe-d" : dl < 0 ? "lean-d" : dl < 0.3 ? "lean-r" : "safe-r";
    results.push({ state: st.stateId, ec: EC[st.stateId] || 0, el: lean.e, sl: lean.s, dl, category: cat });
  }
  results.sort((a, b) => a.dl - b.dl);
  const dEC = results.filter(r => r.dl < -0.3).reduce((s, r) => s + r.ec, 0);
  const rEC = results.filter(r => r.dl > 0.3).reduce((s, r) => s + r.ec, 0);
  const tEC = results.filter(r => Math.abs(r.dl) <= 0.3).reduce((s, r) => s + r.ec, 0);
  return {
    summary: { d_ec: dEC, r_ec: rEC, tossup_ec: tEC, d_lean_ec: Math.round(dEC + tEC * 0.5), r_lean_ec: Math.round(rEC + tEC * 0.5) },
    states: results,
  };
}

const DATA = JSON.stringify(computeAll());

function makeElectionAuditPage(fontLinks, baseCss) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AHD Ops — Election Demographic-Lean Audit (Real Engine)</title>
${THEME_HEAD}
<link rel="icon" href="${faviconFor('vote')}">
${fontLinks}
<style>${baseCss}
.container{max-width:1200px}
.audit-header{display:flex;align-items:center;gap:var(--s-4);margin-bottom:var(--s-4);flex-wrap:wrap}
.audit-header h1{font-size:clamp(1.3rem,3vw,1.7rem);font-weight:800;letter-spacing:-.02em}
.audit-header .badge{display:inline-flex;align-items:center;gap:.35rem;padding:.35rem .7rem;border-radius:var(--r-sm);font-size:.75rem;font-weight:600;border:1px solid var(--border);background:var(--glass-2)}
.audit-header .badge.engine{color:var(--green);border-color:color-mix(in srgb,var(--green) 35%,var(--border));background:color-mix(in srgb,var(--green) 8%,var(--glass-2))}

p.note{margin-top:var(--s-2);font-size:.85rem;color:var(--text-3);line-height:1.65}
p.note strong{color:var(--text);font-weight:700}

.metric-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--s-4);margin-bottom:var(--s-6)}
.metric-card{padding:var(--s-5);border-radius:var(--r-lg);border:1px solid var(--border);background:linear-gradient(180deg,var(--glass-2),var(--glass-1));backdrop-filter:var(--blur)}
.metric-value{font-size:1.6rem;font-weight:800;font-variant-numeric:tabular-nums;color:var(--text);line-height:1.2}
.metric-label{font-size:.8rem;color:var(--text-3);margin-top:.2rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.metric-card.demo .metric-value{color:#3b82f6}.metric-card.gop .metric-value{color:#ef4444}.metric-card.tossup .metric-value{color:#f59e0b}

.bar-row{display:flex;align-items:center;gap:var(--s-4);margin-bottom:var(--s-6);padding:var(--s-5);border-radius:var(--r-lg);border:1px solid var(--border);background:var(--glass-1);flex-wrap:wrap}
.bar-label{min-width:100px;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.bar-outer{flex:1;height:28px;border-radius:var(--r-sm);background:var(--bg-1);overflow:hidden;display:flex;position:relative;min-width:200px}
.bar-inner{height:100%;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;font-variant-numeric:tabular-nums;color:#fff}
.bar-d{background:#3b82f6}.bar-r{background:#ef4444}.bar-tt{background:#f59e0b}
.bar-mid{position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--text-3);opacity:.4}

.state-table{width:100%;border-collapse:collapse;font-size:.85rem;margin-bottom:var(--s-8)}
.state-table th{text-align:left;padding:.6rem .75rem;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);font-weight:700;border-bottom:1px solid var(--border);white-space:nowrap;position:sticky;top:0;background:var(--bg-0);z-index:2}
.state-table td{padding:.45rem .75rem;border-bottom:1px solid var(--border);vertical-align:top}
.state-table tr:hover td{background:var(--glass-hover)}
.state-table code{font-family:var(--mono);font-size:.75rem;background:var(--bg-1);padding:1px 4px;border-radius:3px}

.cat{display:inline-flex;align-items:center;padding:.15rem .45rem;border-radius:var(--r-xs);font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.cat-sd{color:#3b82f6;background:#3b82f610;border:1px solid #3b82f630}.cat-ld{color:#60a5fa;background:#3b82f608;border:1px solid #3b82f618}
.cat-lr{color:#f87171;background:#ef444408;border:1px solid #ef444418}.cat-sr{color:#ef4444;background:#ef444410;border:1px solid #ef444430}

.lean-bar{display:inline-block;height:8px;border-radius:4px;vertical-align:middle;margin-right:4px}
.lean-d{background:#3b82f6}.lean-r{background:#ef4444}

.tabbar{display:flex;gap:var(--s-1);margin-bottom:var(--s-6);border-bottom:1px solid var(--border);overflow-x:auto}
.tabbar button{white-space:nowrap;padding:.55rem .9rem;font-size:.85rem;font-weight:600;color:var(--text-3);background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;transition:all var(--t)}
.tabbar button:hover{color:var(--text)}.tabbar button.active{color:var(--accent);border-bottom-color:var(--accent)}

.pipeline-box{margin:var(--s-6) 0;padding:var(--s-5);border-radius:var(--r-lg);border:1px solid var(--border);background:var(--glass-1);font-size:.8rem;line-height:1.7}
.pipeline-box strong{color:var(--accent)}
.pipeline-box code{font-family:var(--mono);font-size:.78rem;background:var(--bg-1);padding:1px 4px;border-radius:3px}

footer{margin-top:var(--s-8);text-align:center;font-size:.75rem;color:var(--text-3);border-top:1px solid var(--border);padding-top:var(--s-4)}
footer a{color:var(--accent)}
</style>
</head>
<body>
${themeToggle('fixed')}
<div class="container">
<div class="audit-header">
  <h1>${icon('vote',{size:22})} US Election — Demographic-Lean Audit</h1>
  <span class="badge engine">Real Engine</span>
  <span class="badge">Layer 1 Demographics</span>
</div>
<p class="note">
  <strong>This page runs the actual game pipeline.</strong> CSV → <code>generateStateDemographics()</code> →
  <code>calculateStateLean()</code> → <code>getDisplayLean()</code> — the same functions that compute
  the per-state lean displayed on every region page in A House Divided.
  <strong>No toy model.</strong> Source: <code>src/lib/seeds/stateDemographics.ts</code> +
  <code>src/lib/utils/demographics.ts</code>, inlined for the plain-JS ops dashboard.<br><br>
  <strong>Pipeline:</strong> Layer 1 census buckets → turnout-weighted → cross-walked into 12 voter
  archetypes via <code>VOTER_GROUP_COMPOSITION</code> → each group's lean ideology-modulated by state
  conservative/progressive net → turnout-weighted average → dominant-axis display lean.<br><br>
  <strong>Thresholds:</strong> Safe (&lt; −0.3 / &gt; +0.3) · Lean (−0.3–0 / 0–+0.3).
  Demographics-only baseline — no candidates, party org, or persuasion drivers.
</p>

<div class="metric-grid">
  <div class="metric-card demo"><div class="metric-value" id="demEC">—</div><div class="metric-label">Safe Dem EV</div></div>
  <div class="metric-card gop"><div class="metric-value" id="gopEC">—</div><div class="metric-label">Safe GOP EV</div></div>
  <div class="metric-card tossup"><div class="metric-value" id="tossupEC">—</div><div class="metric-label">Tossup EV</div></div>
  <div class="metric-card"><div class="metric-value" id="totalEC">—</div><div class="metric-label">Total EC Votes</div></div>
  <div class="metric-card demo"><div class="metric-value" id="leanDem">—</div><div class="metric-label">Lean Dem (safe + ½ tossup)</div></div>
  <div class="metric-card gop"><div class="metric-value" id="leanGOP">—</div><div class="metric-label">Lean GOP (safe + ½ tossup)</div></div>
</div>

<div id="ecbar" class="bar-row" style="display:none">
  <div class="bar-label">Electoral</div>
  <div class="bar-outer">
    <div class="bar-mid"></div><div id="barD" class="bar-inner bar-d" style="width:0%"></div><div id="barTT" class="bar-inner bar-tt" style="width:0%"></div><div id="barR" class="bar-inner bar-r" style="width:0%"></div>
  </div>
</div>

<div class="pipeline-box">
  <strong>How the lean is computed (matching the game)</strong><br>
  ① Layer 1 buckets → turnout-weighted by <code>DEMOGRAPHIC_TURNOUT_RATES</code><br>
  ② Cross-walked into 12 voter groups via <code>VOTER_GROUP_COMPOSITION</code> weights<br>
  ③ <code>deriveGroupLean</code>: state ideological culture shifts group leans (e.g. evangelicals drift right in AL, center in MA)<br>
  ④ <code>deriveGroupTurnout</code>: composition-weighted turnout, state-adjusted for age/education/race<br>
  ⑤ <code>calculateStateLean</code>: turnout-weighted avg of econ & social positions (−5..+5)<br>
  ⑥ <code>getDisplayLean</code>: same-sign→avg, opposite→stronger axis
</div>

<div class="tabbar">
  <button id="tab-all" class="active" onclick="s('all')">All (51)</button>
  <button id="tab-safe-d" onclick="s('safe-d')">Safe Dem</button>
  <button id="tab-lean-d" onclick="s('lean-d')">Lean Dem</button>
  <button id="tab-lean-r" onclick="s('lean-r')">Lean GOP</button>
  <button id="tab-safe-r" onclick="s('safe-r')">Safe GOP</button>
</div>

<table class="state-table" id="tbl">
<thead><tr><th>State</th><th>EC</th><th>Display Lean</th><th>Econ Lean</th><th>Soc Lean</th><th>Category</th></tr></thead>
<tbody id="tb"></tbody>
</table>

<footer><p>A House Divided — Ops Dashboard · <a href="/">Home</a> · <a href="/election-audit">Refresh</a> · Real game engine (demographics-only baseline)</p></footer>
</div>

<script>
var D=${DATA};
var CAT={"safe-d":"Safe Dem","lean-d":"Lean Dem","lean-r":"Lean GOP","safe-r":"Safe GOP"};
var CS={"safe-d":"cat-sd","lean-d":"cat-ld","lean-r":"cat-lr","safe-r":"cat-sr"};
function $(id){return document.getElementById(id);}
(function render(){
  var d=D;
  $("demEC").textContent=d.summary.d_ec;$("gopEC").textContent=d.summary.r_ec;
  $("tossupEC").textContent=d.summary.tossup_ec;$("totalEC").textContent=d.summary.d_ec+d.summary.r_ec+d.summary.tossup_ec;
  $("leanDem").textContent=d.summary.d_lean_ec;$("leanGOP").textContent=d.summary.r_lean_ec;
  var total=d.summary.d_ec+d.summary.r_ec+d.summary.tossup_ec;
  setBar("barD",d.summary.d_ec,(d.summary.d_ec/total*100).toFixed(1));
  setBar("barTT",d.summary.tossup_ec,(d.summary.tossup_ec/total*100).toFixed(1));
  setBar("barR",d.summary.r_ec,(d.summary.r_ec/total*100).toFixed(1));
  $("ecbar").style.display="flex";
  var tb=$("tb");
  d.states.forEach(function(s){
    var sign=s.dl>=0?"+":"";
    var tr=document.createElement("tr");tr.className="cat-"+s.category;
    tr.innerHTML='<td><strong>'+s.state+'</strong></td><td>'+s.ec+'</td>'+
      '<td><span class="lean-bar '+(s.dl<0?'lean-d':'lean-r')+'" style="width:'+(Math.abs(s.dl)*30)+'px"></span><code>'+sign+s.dl.toFixed(2)+'</code></td>'+
      '<td><code>'+(s.el>=0?'+':'')+s.el.toFixed(2)+'</code></td><td><code>'+(s.sl>=0?'+':'')+s.sl.toFixed(2)+'</code></td>'+
      '<td><span class="cat '+CS[s.category]+'">'+CAT[s.category]+'</span></td>';
    tb.appendChild(tr);
  });
})();
function setBar(id,val,pct){var e=$(id);e.style.width=pct+'%';e.textContent=val+(+pct>5?' ('+pct+'%)':'');}
function s(tab){
  document.querySelectorAll('.tabbar button').forEach(function(b){b.classList.remove('active');});
  $("tab-"+tab).classList.add('active');
  document.querySelectorAll('#tb tr').forEach(function(r){r.style.display=(tab==='all'||r.classList.contains('cat-'+tab))?'':'none';});
}
</script>
${THEME_TOGGLE_JS}
</body>
</html>`;
}

module.exports = { makeElectionAuditPage };
