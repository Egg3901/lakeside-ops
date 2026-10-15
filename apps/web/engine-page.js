// engine-page.js — Game Engine Observatory. Renders the simulation-health
// snapshot (turns / elections / economy / anomalies). Returns { extraCss, body }.

function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function ago(d){if(!d)return"";const s=Math.round((Date.now()-new Date(d).getTime())/1000);if(s<60)return s+"s ago";if(s<3600)return Math.round(s/60)+"m ago";return Math.round(s/3600)+"h ago";}

const ENGINE_CSS = `
.en-wrap{max-width:1000px;margin:0 auto;padding:var(--s-5,24px) var(--s-4,16px);display:flex;flex-direction:column;gap:16px}
.en-head{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px}
.en-head h1{font-size:1.4rem;font-weight:700;letter-spacing:-.02em;margin:0}
.en-sub{color:var(--text-3);font-size:.85rem}
.en-flags{display:flex;flex-direction:column;gap:7px}
.en-flag{display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:11px;border:1px solid var(--border);font-size:.88rem}
.en-flag.error{border-color:color-mix(in srgb,#e5484d 45%,var(--border));background:color-mix(in srgb,#e5484d 9%,var(--surface));color:#ffb4b4}
.en-flag.warn{border-color:color-mix(in srgb,#f5a623 45%,var(--border));background:color-mix(in srgb,#f5a623 9%,var(--surface));color:#ffd79a}
.en-flag.info{color:var(--text-2)}
.en-ok{padding:12px 14px;border-radius:11px;border:1px solid color-mix(in srgb,#34d399 40%,var(--border));background:color-mix(in srgb,#34d399 8%,var(--surface));color:#9ff0c8;font-size:.9rem;font-weight:600}
.en-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
.en-card{border:1px solid var(--border);border-radius:13px;background:var(--surface);padding:14px 16px}
.en-card h2{font-size:.74rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);font-weight:700;margin:0 0 10px}
.en-kv{display:flex;justify-content:space-between;gap:10px;font-size:.88rem;padding:3px 0}
.en-kv .k{color:var(--text-3)}.en-kv .v{color:var(--text);font-weight:600;text-align:right}
.en-kv .v.bad{color:var(--red)}.en-kv .v.good{color:var(--green)}
.en-bars{display:flex;flex-direction:column;gap:4px;margin-top:6px}
.en-bar{display:flex;align-items:center;gap:8px;font-size:.78rem}
.en-bar .nm{width:120px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.en-bar .tr{flex:1;height:7px;border-radius:4px;background:var(--surface-2,#1a1c22);overflow:hidden}
.en-bar .fl{height:100%;border-radius:4px}
.en-bar .vx{width:42px;text-align:right;color:var(--text-3)}
`;

function kv(k, v, cls){ return `<div class="en-kv"><span class="k">${esc(k)}</span><span class="v ${cls||""}">${v==null?"—":esc(v)}</span></div>`; }

function makeEngineBody({ health }) {
  const h = health || {};
  const flags = h.flags || [];
  const errs = flags.filter(f=>f.level!=="info");
  const flagsHtml = flags.length
    ? flags.map(f=>`<div class="en-flag ${esc(f.level)}">${f.level==="error"?"🔴":f.level==="warn"?"🟠":"•"} ${esc(f.msg)}</div>`).join("")
    : `<div class="en-ok">✅ All systems nominal — turns processing, no stuck elections, economy in range.</div>`;
  const lt = h.lastTurn || {};
  const sched = h.schedule || {};
  const el = h.elections || {};
  const ec = h.economy || {};
  const hot = (ec.hot||[]);
  const bars = hot.map(r=>{const pct=Math.min(100,Math.round((r.x/2)*100));const col=r.x>=1.5?"var(--amber)":r.x<=0.7?"var(--accent)":"var(--green)";return `<div class="en-bar"><span class="nm">${esc(r.commodity)}</span><span class="tr"><span class="fl" style="width:${pct}%;background:${col}"></span></span><span class="vx">${r.x}×</span></div>`;}).join("");

  const body = `
<div class="en-wrap">
  <div class="en-head">
    <div><h1>🛰️ Game Engine Observatory</h1><div class="en-sub">Turn ${esc(h.turn)} · ${esc(h.year)} · ${esc(h.iteration&&(h.iteration.type+" "+h.iteration.number))} ${h.paused?"· <b style=color:var(--red)>PAUSED</b>":""}</div></div>
    <div class="en-sub">checked ${ago(h.checkedAt)} · <a href="/engine" style="color:var(--accent)">refresh</a></div>
  </div>
  <div class="en-flags">${flagsHtml}</div>
  <div class="en-grid">
    <div class="en-card"><h2>Turn pipeline</h2>
      ${kv("Last turn", lt.turn)}
      ${kv("Result", lt.success===false?"FAILED":"ok", lt.success===false?"bad":"good")}
      ${kv("Duration", lt.durationMs!=null?(Math.round(lt.durationMs/1000)+"s"):null)}
      ${kv("Failed phases", (lt.failedPhases||[]).length||0, (lt.failedPhases||[]).length?"bad":"")}
      ${kv("Avg (24)", h.recent?(Math.round(h.recent.avgMs/1000)+"s"):null)}
      ${kv("Failures (24)", h.recent?h.recent.failures:null, h.recent&&h.recent.failures?"bad":"")}
      ${kv("Next turn", sched.next?new Date(sched.next).toLocaleTimeString():null)}
      ${sched.overdueMin?kv("Overdue", sched.overdueMin+" min","bad"):""}
    </div>
    <div class="en-card"><h2>Elections</h2>
      ${kv("Active", el.active)}
      ${kv("Overdue (stuck)", el.overdue, el.overdue?"bad":"good")}
      ${kv("Zero-seat", el.zeroSeats, el.zeroSeats?"bad":"")}
    </div>
    <div class="en-card"><h2>Economy — commodity vs base</h2>
      ${ec.topInflation?kv("Hottest", ec.topInflation.commodity+" "+ec.topInflation.x+"×", ec.topInflation.x>=1.5?"bad":""):""}
      ${ec.topDeflation?kv("Coldest", ec.topDeflation.commodity+" "+ec.topDeflation.x+"×"):""}
      <div class="en-bars">${bars||'<span class="en-sub">prices near base</span>'}</div>
    </div>
  </div>
</div>`;
  return { extraCss: ENGINE_CSS, body };
}

module.exports = { makeEngineBody };
