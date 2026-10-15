// report-card.js — two renderers:
//   renderReportSummaryCard(report)  -> compact exec card for the dashboard home
//   renderReportsFull(reports)       -> the full /reports page (carousel + actions)
const { isEnabled } = require("./src/services/featureFlags");
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtDate(d) { try { return new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); } catch { return d; } }

const REPORT_CSS = `
/* ── exec summary card (dashboard) ── */
.rsum{border:1px solid var(--border);border-radius:14px;background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 7%,var(--surface)),var(--surface));padding:16px 18px;margin-bottom:16px;text-decoration:none;color:inherit;display:block}
.rsum:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--border))}
.rsum-top{display:flex;align-items:center;gap:9px;margin-bottom:7px}
.rsum-top h2{font-size:var(--fs-h3,1rem);font-weight:700;margin:0;display:flex;align-items:center;gap:6px}
.rsum-badge{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;padding:2px 8px;border-radius:999px}
.rsum-badge.good{background:color-mix(in srgb,#34d399 18%,transparent);color:#34d399}
.rsum-badge.watch{background:color-mix(in srgb,#f5a623 20%,transparent);color:#f5a623}
.rsum-badge.alert{background:color-mix(in srgb,#e5484d 22%,transparent);color:#ff8a8a}
.rsum-date{margin-left:auto;font-size:var(--fs-sm,.8rem);color:var(--text-3)}
.rsum-headline{font-weight:650;font-size:1.02rem;line-height:1.35;margin:0 0 6px;color:var(--text)}
.rsum-exec{font-size:.87rem;line-height:1.55;color:var(--text-2);margin:0 0 11px}
.rsum-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.rsum-chip{font-size:.72rem;color:var(--text-2);background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:2px 8px}
.rsum-chip b{color:var(--text);font-variant-numeric:tabular-nums}
.rsum-act{font-size:.72rem;font-weight:700;color:#ffb86b;background:color-mix(in srgb,#f5a623 14%,transparent);border-radius:7px;padding:2px 8px}
.rsum-link{margin-left:auto;font-size:.8rem;font-weight:600;color:var(--accent)}
/* ── full reports page ── */
.rpt-wrap{max-width:1000px;margin:0 auto;padding:var(--s-5,24px) var(--s-4,16px)}
.rpt-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
.rpt-head h1{font-size:1.4rem;font-weight:700;margin:0}
.rpt-ctrl{display:flex;align-items:center;gap:8px}
.rpt-pos{font-size:.82rem;color:var(--text-3);min-width:54px;text-align:center;font-variant-numeric:tabular-nums}
.rpt-arrow{width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:1.15rem;cursor:pointer}
.rpt-arrow:hover{border-color:var(--accent);color:var(--accent)}
.rpt-slide{display:none}.rpt-slide.on{display:block;animation:rptIn .2s ease}
@keyframes rptIn{from{opacity:.4}to{opacity:1}}
.rpt-card{border:1px solid var(--border);border-radius:16px;background:var(--surface);padding:20px 22px}
.rpt-top{display:flex;align-items:center;gap:10px;margin-bottom:9px}
.rpt-headline{font-size:1.25rem;font-weight:650;line-height:1.3;margin:0 0 8px;color:var(--text)}
.rpt-exec{font-size:.95rem;line-height:1.6;color:var(--text-2);margin:0 0 18px;padding-left:12px;border-left:3px solid color-mix(in srgb,var(--accent) 50%,var(--border))}
.rpt-sections{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:13px}
.rpt-sec{border:1px solid var(--border);border-radius:12px;background:var(--bg-1,var(--surface));padding:13px 15px}
.rpt-sec-h{font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:5px}
.rpt-sec p{font-size:.87rem;line-height:1.55;color:var(--text-2);margin:0}
.rpt-actions{margin-top:20px}
.rpt-actions h3{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-3);margin:0 0 9px}
.rpt-action{border:1px solid var(--border);border-radius:12px;background:var(--bg-1,var(--surface));padding:13px 15px;margin-bottom:10px}
.rpt-act-top{display:flex;align-items:center;gap:9px;margin-bottom:4px}
.rpt-act-sev{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;padding:1px 7px;border-radius:999px}
.rpt-act-sev.high{background:color-mix(in srgb,#e5484d 22%,transparent);color:#ff8a8a}
.rpt-act-sev.med{background:color-mix(in srgb,#f5a623 20%,transparent);color:#f5a623}
.rpt-act-sev.low{background:var(--glass-2,#222);color:var(--text-2)}
.rpt-act-title{font-weight:650;font-size:.92rem;color:var(--text)}
.rpt-act-detail{font-size:.85rem;line-height:1.5;color:var(--text-2);margin:3px 0 10px}
.rpt-launch{display:inline-flex;align-items:center;gap:6px;border:1px solid color-mix(in srgb,var(--accent) 45%,var(--border));background:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent);font-weight:600;font-size:.82rem;border-radius:9px;padding:6px 12px;cursor:pointer;font-family:inherit}
.rpt-launch:hover{background:color-mix(in srgb,var(--accent) 18%,transparent)}
.rpt-launch:disabled{opacity:.6;cursor:default}
.rpt-foot{margin-top:14px;font-size:.72rem;color:var(--text-3)}
.rpt-dots{display:flex;gap:5px;justify-content:center;margin-top:14px}
.rpt-dot{width:7px;height:7px;border-radius:50%;border:none;background:var(--border-2,var(--border));cursor:pointer;padding:0}
.rpt-dot.on{background:var(--accent)}
.rpt-empty{color:var(--text-3);font-size:.9rem;padding:20px 2px}
/* ── curated report library (categorised) ── */
.lib{max-width:1000px;margin:8px auto 0;padding:0 var(--s-4,16px)}
.lib-h{font-size:1.15rem;font-weight:700;margin:30px 0 14px;display:flex;align-items:center;gap:8px;color:var(--text)}
.lib-cat{margin-bottom:22px}
.lib-cat-h{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);font-weight:700;margin:0 0 10px;border-bottom:1px solid var(--border);padding-bottom:6px}
.lib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.lib-card{display:block;text-decoration:none;color:inherit;border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:14px 16px;transition:border-color .15s}
.lib-card:hover{border-color:var(--accent)}
.lib-card .t{font-weight:650;font-size:.95rem;color:var(--text);margin-bottom:4px;display:flex;align-items:center;gap:7px}
.lib-card .d{font-size:.82rem;line-height:1.5;color:var(--text-2);margin-bottom:9px}
.lib-card .m{font-size:.7rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.04em;display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.lib-badge{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;padding:2px 7px;border-radius:999px;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
`;

function moodOf(r) { return ["good", "watch", "alert"].includes(r && r.mood) ? r.mood : "good"; }

// ── dashboard exec card ──
function renderReportSummaryCard(report) {
  if (!report) {
    return `<a class="rsum" href="/reports"><div class="rsum-top"><h2>📰 Daily Operations Report</h2><span class="rsum-link">Open →</span></div><div class="rsum-exec">No report yet — the first generates shortly, then daily.</div></a>`;
  }
  const r = report, mt = r.metrics || {}, acts = (r.actions || []).length;
  const chip = (label, v) => (v == null ? "" : `<span class="rsum-chip">${label} <b>${esc(typeof v === "number" ? v.toLocaleString() : v)}</b></span>`);
  return `<a class="rsum" href="/reports" title="Open the full daily reports">
    <div class="rsum-top"><h2>📰 Daily Operations Report</h2><span class="rsum-badge ${moodOf(r)}">${esc(moodOf(r))}</span><span class="rsum-date">${esc(fmtDate(r.date))}</span></div>
    <div class="rsum-headline">${esc(r.headline)}</div>
    <div class="rsum-exec">${esc(r.executiveSummary || "")}</div>
    <div class="rsum-chips">
      ${chip("Players", mt.players)}${chip("Visitors", mt.visitorsToday)}${chip("Open issues", mt.openIssues)}${chip("Open tickets", mt.openTickets)}
      ${acts ? `<span class="rsum-act">${acts} action${acts > 1 ? "s" : ""} →</span>` : ""}
      <span class="rsum-link">Full report →</span>
    </div>
  </a>`;
}

// ── full /reports page ──
function slide(r, i) {
  const secs = (r.sections || []).map((s) => `<div class="rpt-sec"><div class="rpt-sec-h">${esc(s.emoji || "•")} ${esc(s.title)}</div><p>${esc(s.body)}</p></div>`).join("");
  const acts = (r.actions || []).map((a, ai) => `<div class="rpt-action">
      <div class="rpt-act-top"><span class="rpt-act-sev ${esc(["high", "med", "low"].includes(a.severity) ? a.severity : "low")}">${esc(a.severity || "low")}</span><span class="rpt-act-title">${esc(a.title)}</span></div>
      <div class="rpt-act-detail">${esc(a.detail || "")}</div>
      ${isEnabled("codeAgent") ? `<button class="rpt-launch" data-date="${esc(r.date)}" data-idx="${ai}">🚀 Launch code agent</button>` : ""}
    </div>`).join("");
  return `<div class="rpt-slide${i === 0 ? " on" : ""}" data-idx="${i}"><div class="rpt-card">
    <div class="rpt-top"><span class="rsum-badge ${moodOf(r)}">${esc(moodOf(r))}</span><span class="rsum-date">${esc(fmtDate(r.date))}</span></div>
    <h2 class="rpt-headline">${esc(r.headline)}</h2>
    ${r.executiveSummary ? `<p class="rpt-exec">${esc(r.executiveSummary)}</p>` : ""}
    <div class="rpt-sections">${secs}</div>
    ${acts ? `<div class="rpt-actions"><h3>Action items</h3>${acts}</div>` : ""}
    <div class="rpt-foot">generated by ${esc(r.model || "agent")} · ${esc(r.date)}</div>
  </div></div>`;
}

// ── curated report library (categorised directory below the daily carousel) ──
function libCard(r) {
  return `<a class="lib-card" href="${esc(r.href)}">
    <div class="t">${esc(r.icon || "📄")} ${esc(r.title)}</div>
    <div class="d">${esc(r.desc || "")}</div>
    <div class="m">${r.badge ? `<span class="lib-badge">${esc(r.badge)}</span>` : ""}${r.meta ? `<span>${esc(r.meta)}</span>` : ""}</div>
  </a>`;
}

// `simReports` is supplied by the server (scanned from disk, so newly-generated
// sim pages appear automatically). The Elections / Economy categories are the
// pre-existing curated static reports, now surfaced here instead of on a
// separate (previously shadowed) directory page.
function renderLibrary(simReports, replayReports, publishedReports) {
  const cats = [];
  // Agent-published reports (via the report MCP) surface first, grouped by their
  // declared category, so freshly-published work is immediately visible.
  if (publishedReports && publishedReports.length) {
    const byCat = new Map();
    for (const r of publishedReports) {
      const c = r.category || "Published Reports";
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(r);
    }
    for (const [title, reports] of byCat) cats.push({ title, reports });
  }
  if (replayReports && replayReports.length) cats.push({ title: "Replay Analytics", reports: replayReports });
  if (simReports && simReports.length) cats.push({ title: "Simulation Experiments", reports: simReports });
  cats.push({
    title: "Ops & Infra", reports: [
      { href: "/reports/frontier-audit-2026-07", icon: "🔭", title: "Frontier Audit — Stack vs State of the Art", desc: "Adversarially-verified research sweep (22 sources, 99 claims, 25 triple-vote verified) of AI-agent memory, LLM observability and multi-agent orchestration tooling, benchmarked against the Hetzner/MCP/OpenReplay/GlitchTip/Claude Code stack. Verdict: the memory + orchestration layers are already near-frontier — the one real gap is LLM/agent tracing (self-host Langfuse, free). Includes a prioritized adoption plan and 3 new directions (in-game LLM economic agents, OpenTelemetry GenAI tracing, automated Discord insight mining).", badge: "Public", meta: "2026-07-07" },
    ],
  });
  cats.push({
    title: "Knowledge & Community", reports: [
      { href: "/reports/knowledge-synthesis", icon: "🧠", title: "The Sum of What We Know — Knowledge Synthesis", desc: "A cross-source synthesis of the whole shared knowledge pool — docs, skills, memory, player suggestions, support tickets and distilled Discord themes. Answer-first thesis, four charts (community input over time, system pressure, theme sentiment, impact×effort) and grounded citations: the six most-voted requests are every one declined/unreviewed, bug tickets are accelerating, and the reliability failures share one shared-state infra root cause. Regenerates from live data.", badge: "Live", meta: "regenerates on demand" },
    ],
  });
  cats.push({
    title: "State of the Game", reports: [
      { href: "/reports/state-of-the-game-t856", icon: "🩺", title: "Autopsy & Manifesto — State of the Game", desc: "Turn-856 forensic pass over engine, economy, players, community and the codebase itself — the 1.5\u00d7 wealth-compression problem, the \u221279% trading collapse, the fiscalYear ghost failure, bus-factor-2 git archaeology — plus a nine-point manifesto from golden-turn CI to the NPP economy flip.", badge: "Public", meta: "Turn 856 · Beta 2" },
    ],
  });
  cats.push({
    title: "Market & Strategy", reports: [
      { href: "/reports/market-growth-monetization-t858", icon: "📈", title: "Competitive Landscape, Growth & Monetization", desc: "Where AHD actually sits in the political-simulator market (Battle For The Hill and Power Play USA are the live rivals — both now ship economies, so AHD's moat is economic depth, not existence), the growth channels left untapped (Steam, alt-history content, Discord discovery), and a no-pay-to-win Patreon plan: keep the two working tiers ($4.99/$9.99, $118/mo, 18 paid) and add $19.99/$39.99 anchors above the ceiling 72% of patrons already sit at. Live web research + Discord corpus, with a genre map, tier-ladder analysis and audience-scale charts.", badge: "Public", meta: "Turn 858 · Beta 2" },
    ],
  });
  cats.push({
    title: "Elections", reports: [
      { href: "/reports/political-systems-audit-t809", icon: "🏛️", title: "The Machinery of Winning — Political Systems Audit", desc: "Full audit of demographics, state lean, party org/registration and the election engine at turn 809: the multiplier chain that decides votes, a GO verdict on Layer 1 demographics with completion checklist, and the registration-data corruption found in 4 of 8 countries.", badge: "Public", meta: "Turn 809 · Live" },
      { href: "/reports/election-post-mortem", icon: "🗳️", title: "Election Post-Mortem", desc: "Comprehensive analysis of completed presidential elections: vote tallies, state-by-state breakdowns, candidate performance, and recommendations.", badge: "Live", meta: "Presidential" },
      { href: "/reports/election-post-mortem-1992", icon: "📊", title: "1992 Election Post-Mortem", desc: "Deep analysis of the 1992 presidential election: electoral-vote breakdown, primary allocation, and the ghost-org effect.", badge: "Historical", meta: "Turn 48–96" },
    ],
  });
  cats.push({
    title: "Economy Audits", reports: [
      { href: "/reports/healthcare-demand-collapse-t1048", icon: "🏥", title: "The Sector That Can't Sell — Healthcare Demand Collapse", desc: "Issue #3137 forensics (follow-up to ticket #938): healthcare demand is 21% of supply because two fixes cut the same formula and nobody reconciled — GOVT_HEALTHCARE_DEMAND_RATE staged 0.025→0.005 against a shortage, then the era-cost rework cut the US budget it multiplies from $935B→$102B. Net 43× collapse of the dominant demand leg (180k calibration units → 4.2k). Price can't clear (demand divides by BASE price), supply can't shrink (ledger reads nameplate). Ranked repair plan: recalibrate the rate (one constant, worldsim-validated), price-responsive demand, supply self-correction — plus proof that agriculture's 0.45 realization is a capitalFactor disease, not demand.", badge: "Public", meta: "Turn 1048 · Issue #3137" },
      { href: "/reports/revenue-realization-t1001", icon: "💇", title: "The Haircut Nobody Explained — Revenue Realization", desc: "Ticket #938 forensics (v2, corrected): #2958 switched corp Financials from nameplate to realized revenue and every corp's number dropped at once (UPS #583: $5.7M→$4.3M, $0 actually lost). UPS sells 100% at above-base prices — his 0.76 is an energy-bound throughput throttle (37/37 sectors) × capital under-investment, all persisted per sector and surfaced nowhere. Maps the two things called 'stockpile', the blended ratio's four defects, and the rollup+bridge fix that unifies with the embargo trade-exposure model (#3001/#3002). v1 wrongly claimed ledger tier/no lever; prod runs capital.", badge: "Public", meta: "Turn 1001 · Ticket #938 · v2" },
      { href: "/reports/clearing-collapse-remediation-t879", icon: "🔥", title: "The Market That Ate Its Makers — Clearing Collapse & Total Remediation", desc: "Live-clone A/B autopsy of the clearing tier: −67.7% aggregate equity vs −15.9% under ledger, traced to an order-book bookkeeping mismatch (corps fill 13% in a market that clears 88%), amplified by fill-blind NPP auto-posture and masked by the 240-turn ramp (terminal state ≈ −96% revenue). Ships the total remediation plan (P0 fix-the-book → P3 away-safety), a systems-interaction UI overhaul with in-game mockups (fill-rate visibility, posture ladder, policy engine), and the NPP AI redesign.", badge: "Public", meta: "t879 clone · 100-turn A/B" },
      { href: "/reports/extraction-capacity", icon: "⛏️", title: "Extraction Capacity Remediation (live)", desc: "Live per-state extraction audit + the remediation plan. Capacity is enforced per state, so the fix differs by commodity: re-strategize idle-headroom deposits (copper/rare_earth/timber), place sectors into stranded deposits, bump capacity where states are genuinely maxed (iron). Includes utilization, haircut exposure, insolvent miners, and per-state targeting.", badge: "Live", meta: "t855+ · updates each load" },
      { href: "/reports/market-clearing-impact-t836", icon: "⚠️", title: "The Copper-Gated Fuse — Clearing/Capital Impact", desc: "Read-only live-prod model of promoting marketSystemMode to clearing/capital. The flip reads +6.2% on day one, −7.3% by year one, and settles near −55% at the full 240-turn ramp. Root cause: ~68% of revenue binds on copper (S/D 0.21, unmasked by t786), which auto-seed can't recover in time and no auto-transition mechanic exists to fix.", badge: "Decision", meta: "Turn 836 · Read-Only" },
      { href: "/reports/centralbank-forex-audit-t817", icon: "🏦", title: "The Free-Money Machines — Central Bank & Forex Audit", desc: "Structural audit of rates, savings, LOC, reserves and intervention bands at turn 817: the carry economy paying whale depositors minted interest, China's costless 0% funding window, bands that never bind, and four overhaul proposals.", badge: "Public", meta: "Turn 817 · Live" },
      { href: "/reports/commodity-structural-report-t806", icon: "📉", title: "Nothing Wants to Sell — Structural Report", desc: "Turn-806 re-audit of the t786 fixes (all working) plus the structural diagnosis: no quantity, no price in income, margin isn't a decision. Four proposed fixes — one tweak, three overhauls — with charts and in-game UI mockups.", badge: "Public", meta: "Turn 806 · Live" },
      { href: "/reports/seed-1953-audit", icon: "🕰️", title: "The 1953 Seed Files, Audited Hostile", desc: "Every value in the 1953-default preset assumed wrong until verified against the historical record. The US political core (83rd Congress, 1952 margins, Solid South registration, FY1953 budget) is test-locked and survives. The failures concentrate at the edges: Hungary/Romania seeded with 1979 party names (MSZMP/PCR instead of MDP/PMR), the CPSU card citing the Brezhnev Doctrine in Stalin's death year, Warsaw Pact implied two years early, bloc parliaments wholesale-recycled from 1979, and a whole class of countries silently falling back to 2019 registration/FX data. 6 critical anachronisms, 6 major gaps, ranked fix order.", badge: "Public", meta: "2026-07-20 · dev @ 0cb63fd74" },
      { href: "/reports/market-realization-phase1-t831", icon: "📊", title: "Price Realization — First Turns", desc: "Live-data assessment of Tier 1 of the market rework after 5 turns on production: realization factor by sector, predicted-vs-actual, the +2.9% aggregate money injection, an oscillation/stability check, and cost estimates for the ledger, clearing and capital tiers still to come.", badge: "Public", meta: "Turn 831 · Live" },
      { href: "/reports/commodity-market-audit-t786", icon: "🩺", title: "Commodity Market Clinical Audit", desc: "Why markets aren't dynamic: 10-year frozen S/D ratios, stabilizer-masked no-op commodities (copper at 3% real coverage), the silent extraction capacity clamp, and the missing price→supply feedback loop. Fix ladder from constants tweaks to a real production model.", badge: "Production", meta: "Turn 786 · Live" },
      { href: "/reports/sandbox-seed-audit-t101", icon: "🔁", title: "The Reset Button Problem — Sandbox Seed Audit", desc: "Is 1953-default reset-ready? Frozen commodity prices, inflation hard-clamped at 15% for 91 straight turns, zero federal budget docs for the played country, 409 elections that have never resolved, a dead labour substrate, and 11 feature flags flipped in 16 days validated only against one of 22 countries.", badge: "Public", meta: "Turn 101 · Sandbox" },
      { href: "/reports/sandbox-economy-audit", icon: "🏗️", title: "Sandbox Economy Audit", desc: "Structural analysis at Turn 22: commodity S/D imbalances, corporate solvency, fiscal positions, exchange rates, extraction bottlenecks.", badge: "Audit", meta: "Turn 22 · Sandbox" },
      { href: "/reports/production-economy-audit", icon: "📈", title: "Production Economy Audit", desc: "Structural analysis at Turn 107: commodity shortages, JPY crisis, corporate health, fiscal positions, wealth concentration.", badge: "Production", meta: "Turn 107 · Live" },
    ],
  });
  const inner = cats.map((c) =>
    `<div class="lib-cat"><div class="lib-cat-h">${esc(c.title)}</div><div class="lib-grid">${c.reports.map(libCard).join("")}</div></div>`
  ).join("");
  return `<div class="lib"><div class="lib-h">📚 Report Library</div>${inner}</div>`;
}

function renderReportsFull(reports, opts) {
  reports = reports || [];
  opts = opts || {};
  const library = renderLibrary(opts.simReports, opts.replayReports, opts.publishedReports);
  const head = `<div class="rpt-head"><h1>📰 Daily Operations Reports</h1>`;
  if (!reports.length) return { extraCss: REPORT_CSS, body: `<div class="rpt-wrap">${head}</div><div class="rpt-empty">No daily reports yet — the first one generates shortly, then daily.</div></div>${library}` };
  const slides = reports.map(slide).join("");
  const dots = reports.map((r, i) => `<button class="rpt-dot${i === 0 ? " on" : ""}" data-go="${i}" title="${esc(r.date)}"></button>`).join("");
  const body = `<div class="rpt-wrap">
  ${head}<div class="rpt-ctrl"><button class="rpt-arrow" id="rptPrev" title="Older">‹</button><span class="rpt-pos" id="rptPos">1 / ${reports.length}</span><button class="rpt-arrow" id="rptNext" title="Newer">›</button></div></div>
  <div class="rpt-track">${slides}</div>
  <div class="rpt-dots">${dots}</div>
</div>
<script>(function(){
  var sl=[].slice.call(document.querySelectorAll('.rpt-slide')); if(!sl.length)return;
  var dt=[].slice.call(document.querySelectorAll('.rpt-dot')), pos=document.getElementById('rptPos'), cur=0;
  function show(i){ if(i<0||i>=sl.length)return; sl[cur].classList.remove('on'); if(dt[cur])dt[cur].classList.remove('on'); cur=i; sl[cur].classList.add('on'); if(dt[cur])dt[cur].classList.add('on'); if(pos)pos.textContent=(cur+1)+' / '+sl.length; }
  var p=document.getElementById('rptPrev'), n=document.getElementById('rptNext');
  if(p)p.onclick=function(){show(cur+1);}; if(n)n.onclick=function(){show(cur-1);};
  dt.forEach(function(d){d.onclick=function(){show(+d.getAttribute('data-go'));};});
  document.querySelectorAll('.rpt-launch').forEach(function(b){ b.onclick=async function(){
    var lab=b.textContent; b.disabled=true; b.textContent='Launching…';
    try{ var r=await fetch('/api/reports/launch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:b.getAttribute('data-date'),idx:+b.getAttribute('data-idx')})});
      var d=await r.json().catch(function(){return {};});
      if(r.ok&&d.codeSessionId){location.href='/code/session/'+d.codeSessionId;return;}
      alert('Launch failed: '+(d.error||('HTTP '+r.status))); }catch(e){ alert('Launch failed: '+e.message); }
    b.disabled=false; b.textContent=lab;
  }; });
})();</script>
${library}`;
  return { extraCss: REPORT_CSS, body };
}

module.exports = { renderReportSummaryCard, renderReportsFull, renderLibrary, REPORT_CSS };
