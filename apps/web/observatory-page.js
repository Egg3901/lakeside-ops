// observatory-page.js — "The Observatory": the consolidated Watchtower feed +
// audit registry on ONE page (anti-sprawl: no new service, no seven tabs).
// Returns { extraCss, body }. Data comes from watchtower.js (live scan) and the
// opsAuditRegistry Mongo collection (tracked findings with expiry dates).

function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function ago(d){if(!d)return"";const s=Math.round((Date.now()-new Date(d).getTime())/1000);if(s<60)return s+"s ago";if(s<3600)return Math.round(s/60)+"m ago";if(s<86400)return Math.round(s/3600)+"h ago";return Math.round(s/86400)+"d ago";}
function until(d){if(!d)return null;const s=Math.round((new Date(d).getTime()-Date.now())/1000);if(s<=0)return"expired";if(s<86400)return"in "+Math.round(s/3600)+"h";return"in "+Math.round(s/86400)+"d";}

const OBS_CSS = `
.ob-wrap{max-width:1000px;margin:0 auto;padding:var(--s-5,24px) var(--s-4,16px);display:flex;flex-direction:column;gap:16px}
.ob-head{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px}
.ob-head h1{font-size:1.4rem;font-weight:700;letter-spacing:-.02em;margin:0}
.ob-sub{color:var(--text-3);font-size:.85rem}
.ob-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border)}
.ob-tab{padding:.5rem .9rem;font-size:.85rem;font-weight:600;color:var(--text-3);border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.ob-tab.active{color:var(--text);border-bottom-color:var(--accent)}
.ob-tab .ct{margin-left:.35rem;font-size:.7rem;padding:.05rem .4rem;border-radius:var(--r-full,999px);background:var(--glass-2);color:var(--text-2)}
.ob-panel{display:none;flex-direction:column;gap:9px}
.ob-panel.active{display:flex}
.ob-summary{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px}
.ob-pill{font-size:.78rem;font-weight:700;padding:.3rem .7rem;border-radius:var(--r-full,999px);border:1px solid var(--border)}
.ob-pill.crit{color:var(--red);border-color:color-mix(in srgb,var(--red) 45%,var(--border));background:color-mix(in srgb,var(--red) 9%,var(--surface))}
.ob-pill.warn{color:var(--amber);border-color:color-mix(in srgb,var(--amber) 45%,var(--border));background:color-mix(in srgb,var(--amber) 9%,var(--surface))}
.ob-pill.ok{color:var(--green);border-color:color-mix(in srgb,var(--green) 40%,var(--border));background:color-mix(in srgb,var(--green) 8%,var(--surface))}
.ob-alert{border:1px solid var(--border);border-left-width:3px;border-radius:11px;background:var(--surface);padding:11px 14px;display:flex;flex-direction:column;gap:5px}
.ob-alert.crit{border-left-color:var(--red)}.ob-alert.warn{border-left-color:var(--amber)}.ob-alert.info{border-left-color:var(--text-3)}.ob-alert.ok{border-left-color:var(--green)}
.ob-alert .top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ob-alert .sev{font-size:.64rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:.12rem .45rem;border-radius:5px}
.ob-alert.crit .sev{background:color-mix(in srgb,var(--red) 20%,transparent);color:var(--red)}
.ob-alert.warn .sev{background:color-mix(in srgb,var(--amber) 20%,transparent);color:var(--amber)}
.ob-alert.info .sev{background:var(--glass-2);color:var(--text-2)}
.ob-alert .ttl{font-weight:600;font-size:.92rem}
.ob-alert .metric{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:700;font-size:.85rem;color:var(--text-2)}
.ob-alert .det{color:var(--text-2);font-size:.84rem;line-height:1.45}
.ob-alert .meta{display:flex;gap:10px;font-size:.72rem;color:var(--text-3)}
.ob-alert .meta code{background:var(--glass-2);padding:.05rem .35rem;border-radius:4px}
.ob-alert .track{margin-left:auto;font-size:.72rem;color:var(--accent);background:none;border:1px solid var(--border);border-radius:6px;padding:.2rem .55rem;cursor:pointer}
.ob-empty{padding:22px;text-align:center;color:var(--text-3);border:1px dashed var(--border);border-radius:12px}
.ob-reg{border:1px solid var(--border);border-radius:11px;background:var(--surface);padding:11px 14px;display:flex;flex-direction:column;gap:5px}
.ob-reg.expired{opacity:.55}
.ob-reg .top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ob-reg .exp{margin-left:auto;font-size:.72rem;color:var(--text-3)}
.ob-reg .exp.soon{color:var(--amber)}.ob-reg .exp.gone{color:var(--red)}
.ob-reg .resolve{font-size:.72rem;color:var(--text-3);background:none;border:1px solid var(--border);border-radius:6px;padding:.2rem .55rem;cursor:pointer}
`;

function alertCard(a){
  const sev = a.severity==="crit"?"crit":a.severity==="warn"?"warn":a.severity==="ok"?"ok":"info";
  const icon = sev==="crit"?"🔴":sev==="warn"?"🟠":sev==="ok"?"🟢":"•";
  return `<div class="ob-alert ${sev}" data-code="${esc(a.code)}">
    <div class="top">
      <span class="sev">${icon} ${esc(a.severity)}</span>
      <span class="ttl">${esc(a.title)}</span>
      ${a.metric?`<span class="metric">${esc(a.metric)}</span>`:""}
    </div>
    ${a.detail?`<div class="det">${esc(a.detail)}</div>`:""}
    <div class="meta">
      <span>source <code>${esc(a.source)}</code></span>
      ${a.turn!=null?`<span>turn ${esc(a.turn)}</span>`:""}
      ${a.entity?`<span title="use trace_${esc(a.entity.type)} in the gamestate MCP">🔎 <code>trace_${esc(a.entity.type)} ${esc(a.entity.name||a.entity.id)}</code></span>`:""}
      <button class="track" data-track='${esc(JSON.stringify({title:a.title,severity:a.severity,source:a.source,code:a.code,finding:a.detail||"",turn:a.turn,entity:a.entity||null}))}'>track →</button>
    </div>
  </div>`;
}

function regCard(r){
  const u = until(r.expiresAt);
  const expired = u==="expired";
  const soon = u && u.startsWith("in") && /\bh$/.test(u);
  const sev = r.severity==="crit"?"crit":r.severity==="warn"?"warn":"info";
  const icon = sev==="crit"?"🔴":sev==="warn"?"🟠":"•";
  return `<div class="ob-reg ${expired?"expired":""}" data-id="${esc(r._id)}">
    <div class="top">
      <span class="sev" style="font-size:.64rem;font-weight:800;text-transform:uppercase">${icon} ${esc(r.severity)}</span>
      <span style="font-weight:600;font-size:.92rem">${esc(r.title)}</span>
      <span class="exp ${expired?"gone":soon?"soon":""}">${r.status==="resolved"?"resolved":(u?("re-check "+u):"no expiry")}</span>
    </div>
    ${r.finding?`<div class="det" style="color:var(--text-2);font-size:.84rem;line-height:1.45">${esc(r.finding)}</div>`:""}
    <div class="meta" style="display:flex;gap:10px;font-size:.72rem;color:var(--text-3);align-items:center">
      <span>source <code style="background:var(--glass-2);padding:.05rem .35rem;border-radius:4px">${esc(r.source||"—")}</code></span>
      <span>logged ${esc(ago(r.createdAt))}</span>
      ${r.status!=="resolved"?`<button class="resolve" data-id="${esc(r._id)}" style="margin-left:auto">mark resolved</button>`:""}
    </div>
  </div>`;
}

function makeObservatoryBody({ scan, registry }){
  const alerts = (scan && scan.alerts) || [];
  const counts = (scan && scan.counts) || {};
  const reg = registry || [];
  const openReg = reg.filter(r=>r.status!=="resolved");

  const summary = alerts.length ? `<div class="ob-summary">
    ${counts.crit?`<span class="ob-pill crit">🔴 ${counts.crit} critical</span>`:""}
    ${counts.warn?`<span class="ob-pill warn">🟠 ${counts.warn} warning</span>`:""}
    ${!counts.crit&&!counts.warn?`<span class="ob-pill ok">🟢 nothing critical</span>`:""}
  </div>` : "";

  const feed = alerts.length
    ? summary + alerts.map(alertCard).join("")
    : `<div class="ob-empty">🟢 Watchtower is quiet — every cross-instrument probe came back clean at turn ${esc(scan&&scan.turn)}.</div>`;

  const regHtml = reg.length
    ? reg.map(regCard).join("")
    : `<div class="ob-empty">No tracked findings yet. Hit <b>track →</b> on any Watchtower alert to log it here with a re-check date.</div>`;

  const body = `
<div class="ob-wrap">
  <div class="ob-head">
    <div><h1>🔭 The Observatory</h1><div class="ob-sub">Cross-instrument anomaly watch + tracked findings · turn ${esc(scan&&scan.turn)} · scanned ${esc(ago(scan&&scan.scannedAt))}</div></div>
    <div class="ob-sub"><a href="/observatory" style="color:var(--accent)">refresh</a></div>
  </div>
  <div class="ob-tabs">
    <button class="ob-tab active" data-tab="watch">Watchtower<span class="ct">${alerts.length}</span></button>
    <button class="ob-tab" data-tab="reg">Audit registry<span class="ct">${openReg.length}</span></button>
  </div>
  <div class="ob-panel active" id="ob-watch">${feed}</div>
  <div class="ob-panel" id="ob-reg">${regHtml}</div>
</div>
<script>
(function(){
  document.querySelectorAll(".ob-tab").forEach(function(t){
    t.addEventListener("click",function(){
      document.querySelectorAll(".ob-tab").forEach(x=>x.classList.remove("active"));
      document.querySelectorAll(".ob-panel").forEach(x=>x.classList.remove("active"));
      t.classList.add("active");
      document.getElementById("ob-"+t.dataset.tab).classList.add("active");
    });
  });
  document.querySelectorAll(".track").forEach(function(b){
    b.addEventListener("click",async function(){
      b.disabled=true;b.textContent="tracking…";
      try{
        const payload=JSON.parse(b.dataset.track);
        const r=await fetch("/api/observatory/registry",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
        if(!r.ok)throw new Error(await r.text());
        b.textContent="tracked ✓";
      }catch(e){b.textContent="failed";b.disabled=false;}
    });
  });
  document.querySelectorAll(".resolve").forEach(function(b){
    b.addEventListener("click",async function(){
      b.disabled=true;b.textContent="…";
      try{
        const r=await fetch("/api/observatory/registry",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({resolve:b.dataset.id})});
        if(!r.ok)throw new Error();
        b.closest(".ob-reg").classList.add("expired");b.textContent="resolved ✓";
      }catch(e){b.textContent="failed";b.disabled=false;}
    });
  });
})();
</script>`;
  return { extraCss: OBS_CSS, body };
}

module.exports = { makeObservatoryBody };
