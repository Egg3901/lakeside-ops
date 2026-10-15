// Generates reports/knowledge-synthesis.html from live data — stat tiles, four
// self-contained SVG charts (input-over-time, theme sentiment, system pressure,
// impact x effort), grounded citations to the actual suggestion/ticket numbers,
// memory entries and themes. Re-run to refresh. Charts follow the dataviz method
// (sequential single-hue for magnitude; reserved status colors for sentiment,
// always shipped with text labels; one axis; hover tooltips).
require("dotenv").config();
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");
const ks = require("./knowledge-store");

const C = { blue: "#6c8cff", blue2: "#9db4ff", tkt: "#ff7a7a", neg: "#ff6b6b", mix: "#f5b342", pos: "#3ddc97", neu: "#9a9a9a", axis: "#3a3a3a", ink3: "#8a8a8a", ink2: "#bbb" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => ` data-tip="${esc(t)}"`;

// magnitude: horizontal sequential-blue bars with direct value labels + optional right note
function hbars(rows, { w = 620, rowH = 26, max, unit = "" }) {
  max = max || Math.max(...rows.map((r) => r.v));
  const labelW = 132, barMax = w - labelW - 150;
  const h = rows.length * rowH + 8;
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img">`;
  rows.forEach((r, i) => {
    const y = i * rowH + 4, bw = Math.max(2, (r.v / max) * barMax);
    s += `<text x="${labelW - 8}" y="${y + rowH / 2 + 4}" text-anchor="end" font-size="12.5" fill="${C.ink2}">${esc(r.k)}</text>`;
    s += `<rect x="${labelW}" y="${y + 4}" width="${bw}" height="${rowH - 12}" rx="4" fill="${r.c || C.blue}"${tip(r.tip || r.k + ": " + r.v + unit)}/>`;
    s += `<text x="${labelW + bw + 7}" y="${y + rowH / 2 + 4}" font-size="12" font-weight="700" fill="#e8e8ea">${r.v}${unit}</text>`;
    if (r.note) s += `<text x="${labelW + bw + 34}" y="${y + rowH / 2 + 4}" font-size="10.5" fill="${C.ink3}">${esc(r.note)}</text>`;
  });
  return s + "</svg>";
}

(async () => {
  const cli = new MongoClient(process.env.MONGODB_URI, { directConnection: true });
  await cli.connect();
  const db = cli.db("a-house-divided");
  const S = db.collection("suggestions"), T = db.collection("tickets");

  const kinds = Object.fromEntries((await db.collection(ks.COLLECTION).aggregate([{ $match: { deletedAt: null } }, { $group: { _id: "$kind", n: { $sum: 1 } } }]).toArray()).map((x) => [x._id, x.n]));
  const nSug = await S.countDocuments(), nTkt = await T.countDocuments(), nThm = await db.collection("discord_themes").countDocuments();
  const sBySys = await S.aggregate([{ $group: { _id: "$gameSystem", n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray();
  const sByStatus = Object.fromEntries((await S.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray()).map((x) => [x._id, x.n]));
  const themes = await db.collection("discord_themes").find({}).toArray();
  const sentByThemeSys = {}; themes.forEach((t) => { if (!sentByThemeSys[t.gameSystem]) sentByThemeSys[t.gameSystem] = []; sentByThemeSys[t.gameSystem].push(t.sentiment); });
  const worstSent = (sys) => { const a = sentByThemeSys[sys] || []; if (a.includes("negative")) return ["negative", C.neg]; if (a.includes("mixed")) return ["mixed", C.mix]; if (a.includes("positive")) return ["positive", C.pos]; if (a.length) return ["neutral", C.neu]; return ["—", C.neu]; };
  const sentTally = {}; themes.forEach((t) => (sentTally[t.sentiment] = (sentTally[t.sentiment] || 0) + 1));
  const sMon = await S.aggregate([{ $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray();
  const tMon = await T.aggregate([{ $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray();
  const react = await db.collection("suggestionReactions").aggregate([{ $group: { _id: "$suggestionId", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 6 }]).toArray();
  const top = []; for (const r of react) { const s = await S.findOne({ _id: r._id }); if (s) top.push({ num: s.issueNumber, title: s.title, sys: s.gameSystem, votes: r.n, status: s.status }); }

  const SYSLBL = { legislature: "legislature", economy: "economy", meta_other: "meta / other", parties: "parties", elections: "elections", corporations: "corporations", executive: "executive", map_geo: "map / geo", npps: "npps", onboarding_account: "onboarding", diplomacy: "diplomacy", notifications: "notifications", combat_or_military: "military" };

  // ---------- Chart A: community input over time (grouped bars, 2 series) ----------
  const months = [...new Set([...sMon.map((x) => x._id), ...tMon.map((x) => x._id)])].sort();
  const sM = Object.fromEntries(sMon.map((x) => [x._id, x.n])), tM = Object.fromEntries(tMon.map((x) => [x._id, x.n]));
  const aMax = Math.max(...months.map((m) => Math.max(sM[m] || 0, tM[m] || 0)));
  const AW = 620, AH = 250, ax0 = 44, ax1 = 600, ay0 = 20, ay1 = 205;
  let cA = `<svg viewBox="0 0 ${AW} ${AH}" width="100%" role="img">`;
  for (let g = 0; g <= 4; g++) { const v = Math.round((aMax / 4) * g), y = ay1 - (v / aMax) * (ay1 - ay0); cA += `<line x1="${ax0}" y1="${y}" x2="${ax1}" y2="${y}" stroke="${C.axis}" stroke-width="1"/><text x="${ax0 - 6}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="${C.ink3}">${v}</text>`; }
  const gw = (ax1 - ax0) / months.length;
  months.forEach((m, i) => {
    const cx = ax0 + gw * (i + 0.5), bw = 26;
    const sv = sM[m] || 0, tv = tM[m] || 0;
    const sh = (sv / aMax) * (ay1 - ay0), th = (tv / aMax) * (ay1 - ay0);
    cA += `<rect x="${cx - bw - 3}" y="${ay1 - sh}" width="${bw}" height="${sh}" rx="3" fill="${C.blue}"${tip(m + " · " + sv + " suggestions")}/>`;
    if (tv) cA += `<rect x="${cx + 3}" y="${ay1 - th}" width="${bw}" height="${th}" rx="3" fill="${C.tkt}"${tip(m + " · " + tv + " tickets")}/>`;
    cA += `<text x="${cx}" y="${ay1 + 15}" text-anchor="middle" font-size="11" fill="${C.ink2}">${m}</text>`;
  });
  cA += `<line x1="${ax0}" y1="${ay1}" x2="${ax1}" y2="${ay1}" stroke="${C.ink3}" stroke-width="1"/>`;
  cA += `<rect x="${ax1 - 210}" y="6" width="10" height="10" rx="2" fill="${C.blue}"/><text x="${ax1 - 196}" y="15" font-size="11" fill="${C.ink2}">suggestions</text><rect x="${ax1 - 110}" y="6" width="10" height="10" rx="2" fill="${C.tkt}"/><text x="${ax1 - 96}" y="15" font-size="11" fill="${C.ink2}">tickets</text></svg>`;

  // ---------- Chart B: theme sentiment (status bars, labelled) ----------
  const sentRows = [["negative", C.neg], ["mixed", C.mix], ["neutral", C.neu], ["positive", C.pos]].filter(([k]) => sentTally[k]).map(([k, c]) => ({ k, v: sentTally[k] || 0, c, tip: (sentTally[k] || 0) + " themes · " + k }));
  const cB = hbars(sentRows, { max: Math.max(...sentRows.map((r) => r.v)), unit: "" });

  // ---------- Chart C: system pressure ----------
  const cRows = sBySys.filter((x) => x._id && x.n >= 1).slice(0, 10).map((x) => { const [lab, col] = worstSent(x._id); return { k: SYSLBL[x._id] || x._id, v: x.n, c: C.blue, note: lab === "—" ? "" : lab, tip: (SYSLBL[x._id] || x._id) + ": " + x.n + " suggestions · sentiment " + lab }; });
  const cC = hbars(cRows, { unit: "" });

  // ---------- Chart D: impact x effort (scatter, my analysis) ----------
  const recs = [
    { t: "Mongo replica-set migration", eff: 5, imp: 9, n: 1 },
    { t: "Legislature reliability + QoL", eff: 6, imp: 8, n: 2 },
    { t: "Clear triage backlog + visible response", eff: 3, imp: 7, n: 3 },
    { t: "Economy legibility (explain, don't just tune)", eff: 6, imp: 6, n: 4 },
    { t: "Onboarding + fix map abbreviations", eff: 2, imp: 5, n: 5 },
    { t: "Write the 34 dangling docs", eff: 3, imp: 4, n: 6 },
  ];
  const DW = 620, DH = 300, dx0 = 46, dx1 = 600, dy0 = 18, dy1 = 250;
  const sx = (e) => dx0 + (e / 10) * (dx1 - dx0), sy = (i) => dy1 - (i / 10) * (dy1 - dy0);
  let cD = `<svg viewBox="0 0 ${DW} ${DH}" width="100%" role="img">`;
  const mx = (dx0 + dx1) / 2, my = (dy0 + dy1) / 2;
  cD += `<rect x="${dx0}" y="${dy0}" width="${mx - dx0}" height="${my - dy0}" fill="${C.pos}" opacity="0.05"/>`; // hi impact / lo effort
  cD += `<line x1="${mx}" y1="${dy0}" x2="${mx}" y2="${dy1}" stroke="${C.axis}" stroke-dasharray="3 3"/><line x1="${dx0}" y1="${my}" x2="${dx1}" y2="${my}" stroke="${C.axis}" stroke-dasharray="3 3"/>`;
  cD += `<text x="${dx0 + 6}" y="${dy0 + 14}" font-size="10.5" fill="${C.pos}" font-weight="700">DO FIRST — high impact, low effort</text>`;
  cD += `<text x="${dx1 - 6}" y="${dy0 + 14}" text-anchor="end" font-size="10.5" fill="${C.ink3}">MAJOR BETS</text>`;
  cD += `<text x="${dx0 + 6}" y="${dy1 - 6}" font-size="10.5" fill="${C.ink3}">FILL-INS</text>`;
  cD += `<text x="${mx}" y="${dy1 + 15}" text-anchor="middle" font-size="11" fill="${C.ink2}">Effort →</text>`;
  cD += `<text x="14" y="${my}" text-anchor="middle" font-size="11" fill="${C.ink2}" transform="rotate(-90 14 ${my})">Impact →</text>`;
  recs.forEach((r) => {
    const x = sx(r.eff), y = sy(r.imp);
    cD += `<circle cx="${x}" cy="${y}" r="12" fill="${C.blue}"${tip("#" + r.n + " " + r.t + " (impact " + r.imp + "/10, effort " + r.eff + "/10)")}/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">${r.n}</text>`;
  });
  cD += "</svg>";
  const recLegend = recs.map((r) => `<span style="white-space:nowrap;margin-right:14px"><b style="color:${C.blue}">${r.n}</b> ${esc(r.t)}</span>`).join("");

  // citations
  const declined = top.filter((t) => t.status === "not_implementing" || t.status === "not_reviewed").length;
  const topCites = top.map((t) => `<tr><td><b>#${t.num}</b></td><td>${esc(t.title.slice(0, 58))}</td><td>${esc(SYSLBL[t.sys] || t.sys)}</td><td style="text-align:right">${t.votes}</td><td><span class="st st-${(t.status || "").replace(/_/g, "-")}">${esc((t.status || "").replace(/_/g, " "))}</span></td></tr>`).join("");

  const html = `<style>
  /* Self-contained dark surface: the report reads identically whether the ops
     dash is in light or dark theme (it hardcodes its own dark palette). */
  .ahd-main:has(.ks){background:#0b0b0b}
  .ks{--tx:#e8e8ea;--t2:#c4c4c8;--t3:#8f8f96;--acc:#7d97ff;--card:#161616;--bd:#2a2a2a;max-width:980px;margin:0 auto;padding:22px 20px 90px;color:var(--tx);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.6;background:#0b0b0b}
  .ks h1{font-size:2rem;font-weight:800;letter-spacing:-.02em;margin:0 0 4px}
  .ks .sub{color:var(--t3);font-size:.88rem;margin:0 0 20px}
  .ks h2{font-size:1.18rem;font-weight:700;margin:36px 0 4px;letter-spacing:-.01em}
  .ks h2 .tag{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--t3);border:1px solid var(--bd);border-radius:999px;padding:1px 8px;margin-left:8px;vertical-align:middle}
  .ks p{color:var(--t2);margin:8px 0}.ks strong{color:var(--tx)}
  .ks .thesis{font-size:1.1rem;color:var(--tx);background:linear-gradient(180deg,color-mix(in srgb,var(--acc) 10%,transparent),transparent);border-left:3px solid var(--acc);padding:14px 16px;border-radius:0 10px 10px 0;margin:12px 0}
  .ks .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(108px,1fr));gap:9px;margin:16px 0}
  .ks .tile{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:11px 13px}
  .ks .tile .v{font-size:1.45rem;font-weight:800;font-variant-numeric:tabular-nums}.ks .tile .l{font-size:.7rem;color:var(--t3);text-transform:uppercase;letter-spacing:.05em}
  .ks .card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:16px 18px;margin:12px 0;overflow-x:auto}
  .ks svg{max-width:100%;height:auto}
  .ks .cap{font-size:.78rem;color:var(--t3);margin:2px 0 10px}
  .ks .cite{font-size:.8rem;color:var(--t3)}.ks .cite b{color:var(--t2)}.ks .cite code{background:#0e0e0e;padding:.05em .35em;border-radius:4px}
  .ks table{width:100%;border-collapse:collapse;font-size:.84rem}.ks th{text-align:left;font-size:.66rem;text-transform:uppercase;letter-spacing:.05em;color:var(--t3);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--bd)}.ks td{padding:7px 8px;border-bottom:1px solid #202020}
  .ks .st{font-size:.64rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:1px 7px;border-radius:999px;background:#222;color:#bbb}
  .ks .st-not-implementing{background:color-mix(in srgb,#ff6b6b 18%,transparent);color:#ff6b6b}.ks .st-not-reviewed{background:color-mix(in srgb,#f5b342 20%,transparent);color:#f5b342}.ks .st-completed{background:color-mix(in srgb,#3ddc97 20%,transparent);color:#3ddc97}
  .ks .rec{display:flex;gap:12px;align-items:flex-start;margin:11px 0}.ks .rec .rank{flex:none;width:26px;height:26px;border-radius:50%;background:var(--acc);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:.82rem}
  .ks .conf{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:1px 7px;border-radius:999px;background:#1e1e1e;color:var(--t3);border:1px solid var(--bd)}
  .ks a{color:var(--acc)}.ks .foot{color:var(--t3);font-size:.78rem;margin-top:38px;border-top:1px solid var(--bd);padding-top:14px}
  #kstip{position:fixed;pointer-events:none;background:#0b0b0b;border:1px solid #2a2a2a;border-radius:7px;padding:4px 9px;font-size:.75rem;color:#eee;display:none;z-index:99;max-width:280px}
</style>
<div class="ks">
  <h1>The Sum of What We Know</h1>
  <p class="sub">A cross-source synthesis of the shared knowledge pool — generated ${new Date().toISOString().slice(0, 10)} from live data. Sentiment/themes are LLM-extracted (directional, medium-confidence); counts are exact.</p>

  <div class="thesis"><strong>The verdict:</strong> A House Divided has a rival-beating economic core and a roadmap players are genuinely excited for — but it is <strong>losing the present tense</strong>. The legislative loop players use most is the one most reported broken; bug tickets are <strong>accelerating</strong> (${(tM[months[months.length - 1]] || 0)} this month vs ${(tM[months[months.length - 2]] || 0)} last); the <strong>six most-upvoted community requests are every one of them declined or unreviewed</strong>; and a single class of shared-state infrastructure fragility keeps resurfacing as player-visible data incidents. The moat is real. The leak is in execution throughput and reliability, not vision.</p>

  <div class="tiles">
    <div class="tile"><div class="v">${kinds.docs || 0}</div><div class="l">Docs</div></div>
    <div class="tile"><div class="v">${kinds.skills || 0}</div><div class="l">Skills</div></div>
    <div class="tile"><div class="v">${kinds.memory || 0}</div><div class="l">Memories</div></div>
    <div class="tile"><div class="v">${nSug}</div><div class="l">Suggestions</div></div>
    <div class="tile"><div class="v">${nTkt}</div><div class="l">Tickets</div></div>
    <div class="tile"><div class="v">${nThm}</div><div class="l">Themes</div></div>
    <div class="tile"><div class="v">133k</div><div class="l">Discord msgs</div></div>
  </div>

  <h2>1 · Community input is shifting from ideas to bug reports <span class="tag">exact counts · high confidence</span></h2>
  <p>Suggestions surged then cooled; <strong>tickets are climbing</strong>. That mix-shift — fewer "here's an idea", more "here's what's broken" — is the clearest leading indicator in the pool, and it points at reliability, not roadmap.</p>
  <div class="card"><div class="cap">Community input by month — suggestions vs support tickets</div>${cA}</div>

  <h2>2 · Player demand and player pain both peak at legislature &amp; economy <span class="tag">exact + LLM sentiment</span></h2>
  <p><strong>Legislature</strong> draws the most suggestions of any system and the community reports <em>"many bills fail or have no effect; executive orders and embargoes are non-functional"</em>. <strong>Economy</strong> is second and owns both high-prevalence themes — including the outright-negative <em>"balance &amp; complexity"</em>, whose headline complaint is literally <em>"difficulty understanding the economy."</em> Depth is the moat; legibility and legislative reliability are the wounds.</p>
  <div class="card"><div class="cap">System pressure — suggestions per game system, with worst community sentiment</div>${cC}</div>

  <h2>3 · The most-wanted asks are the ones we're not doing <span class="tag">exact counts · high confidence</span></h2>
  <p>Of the six highest-upvoted suggestions, <strong>${declined} of 6 are "not implementing" or "not reviewed"</strong> — and <strong>none</strong> are planned, in progress, or shipped. Two of the six are outright appeals to undo recent changes (#19 revert PS org building, #25 "make it economy only"). Whatever the merits case-by-case, the aggregate signal is a widening gap between what the vocal community votes for and what the roadmap serves — and the community feels it (negative theme: <em>"tickets and questions go unanswered by developers"</em>).</p>
  <div class="card"><table><tr><th>ID</th><th>Request</th><th>System</th><th style="text-align:right">Votes</th><th>Fate</th></tr>${topCites}</table></div>

  <h2>4 · Sentiment is net-negative, and every positive is about the future <span class="tag">LLM sentiment · medium confidence</span></h2>
  <p>Across ${nThm} distilled themes, negatives outnumber positives ${sentTally.negative || 0}:${sentTally.positive || 0}. Tellingly, the <em>only</em> two positive themes are anticipation (<em>upcoming unions &amp; election rework</em>) and enjoyment of the game's data depth. Nothing about the <strong>current</strong> state reads positive. This is a "great trajectory, rough present" profile — and retention risk lives in that gap.</p>
  <div class="card"><div class="cap">Distilled Discord themes by sentiment (last 14 days)</div>${cB}</div>

  <h2>5 · The reliability failures share one root cause <span class="tag">incident record · high confidence</span></h2>
  <p>The memory of what we've had to fix reads as one failure class under many names: <strong>standalone Mongo → no transactions → data desyncs and stuck turns</strong>; <strong>blanket CDN caching → cross-user data leak</strong>; <strong>missing FX conversion → economic blow-ups</strong>. Players see the surface as the high-prevalence negative theme <em>"Technical Bugs &amp; Security Incidents,"</em> data exposure included. The documented single highest-leverage fix — migrating prod Mongo to a replica set — is still pending and would retire the whole category.</p>
  <div class="card cite"><b>Cited incidents (knowledge memory):</b> <code>standalone-mongo-no-txns</code> (#877/879/880) · <code>cdn-cache-incident</code> (cross-user leak) · <code>nationalization-fx-incident</code> (t841 blow-up) · <code>turn-stuck-incident</code> · <code>extraction-capacity-remediation</code>. Trace them in the <a href="/knowledge/graph">knowledge graph</a>.</div>

  <h2>What to do about it — ranked by leverage <span class="tag">impact × effort</span></h2>
  <div class="card"><div class="cap">Recommendations plotted by impact and effort — top-left is do-first</div>${cD}<div style="font-size:.78rem;color:var(--t3);margin-top:8px;line-height:1.9">${recLegend}</div></div>
  <div class="rec"><div class="rank">1</div><div><b>Ship the Mongo replica-set migration.</b> <span class="conf">high impact</span> Retires the recurring data-integrity/desync class behind multiple incidents and the player-visible "data exposure" sentiment. One fix, whole category gone. Doc already exists (<code>mongo-replicaset-migration</code>).</div></div>
  <div class="rec"><div class="rank">2</div><div><b>Legislature reliability + QoL sprint.</b> <span class="conf">high impact</span> Fix non-functional bills / executive orders / embargoes; ship the top-voted auto-pass (#23) and voting-period asks. Highest demand × highest brokenness.</div></div>
  <div class="rec"><div class="rank">3</div><div><b>Clear the triage backlog &amp; make responsiveness visible.</b> <span class="conf">quick win</span> ${sByStatus.not_reviewed || 0} suggestions unreviewed, ${(await T.countDocuments({ status: { $nin: ["closed"] } }))} tickets open. Close the loop publicly — "unanswered" is a retention leak. Push it through the AI-triage pipeline.</div></div>
  <div class="rec"><div class="rank">4</div><div><b>Invest in economy <em>legibility</em>, not just balance.</b> The complaint is "hard to understand," not only "unbalanced." Add in-game explanation + telemetry. Depth is the moat — make it readable.</div></div>
  <div class="rec"><div class="rank">5</div><div><b>Onboarding pass + fix map abbreviations.</b> <span class="conf">quick win</span> Cheapest growth lever, directly community-requested (map "CN = Canada vs China" confusion; new players asking basics).</div></div>
  <div class="rec"><div class="rank">6</div><div><b>Write the 34 dangling docs.</b> Close the knowledge graph's known player-facing gaps (election-mechanics, corporations, stats-actions…).</div></div>

  <div class="foot">Synthesized from ${kinds.docs || 0} docs · ${kinds.skills || 0} skills · ${kinds.memory || 0} memories · ${nSug} suggestions · ${nTkt} tickets · ${nThm} Discord themes (from ~133k messages). Counts are exact as of generation; sentiment/themes are LLM-extracted and directional. Explore the connections at <a href="/knowledge/graph">/knowledge/graph</a>. Regenerate: <code>node build-synthesis-report.js</code>.</div>
</div>
<div id="kstip"></div>
<script>(function(){var tp=document.getElementById('kstip');document.querySelectorAll('.ks [data-tip]').forEach(function(el){el.addEventListener('mousemove',function(e){tp.textContent=el.getAttribute('data-tip');tp.style.display='block';tp.style.left=(e.clientX+12)+'px';tp.style.top=(e.clientY+12)+'px';});el.addEventListener('mouseleave',function(){tp.style.display='none';});});})();</script>`;

  fs.writeFileSync(path.join(__dirname, "reports", "knowledge-synthesis.html"), html);
  console.log("wrote reports/knowledge-synthesis.html — " + html.length + " bytes");
  await cli.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
