const { icon, faviconFor, THEME_HEAD, themeToggle, THEME_TOGGLE_JS } = require('./ui-kit');
const { clientBootstrapScript, escapeHtml } = require('./src/ui/safeDom');
const { getTenant, getPrimaryProject } = require('./src/services/projectRegistry');

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? escapeHtml(url.href) : null;
  } catch { return null; }
}

module.exports = function makeStatusPage(FONT_LINKS, BASE_CSS, branding = {}) {
  const tenant = branding.tenant || getTenant();
  const primary = branding.primary || getPrimaryProject();
  const displayName = escapeHtml(primary?.name || tenant?.name || 'System');
  const mainUrl = safeExternalUrl(primary?.publicUrl || tenant?.homeUrl);
  const sandboxUrl = safeExternalUrl(primary?.sandboxUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${displayName} — System Status</title>
${THEME_HEAD}
<link rel="icon" href="${faviconFor('activity')}">
<meta name="description" content="Real-time service status and uptime monitoring for ${displayName}">
${FONT_LINKS}
<style>${BASE_CSS}
.container{max-width:960px}
.status-hero{display:flex;align-items:center;gap:var(--s-4);text-align:left;margin-bottom:var(--s-8);padding:var(--s-4) 0;border-bottom:1px solid var(--border)}
.brand{display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;flex:0 0 52px;font-size:2rem;border-radius:var(--r-md);background:var(--accent-soft);color:var(--accent);border:1px solid var(--border)}
.status-hero h1{font-size:clamp(1.6rem,4vw,2.2rem);font-weight:800;letter-spacing:-.03em}
.status-hero p{color:var(--text-3);font-size:.95rem;margin-top:.25rem}

.overall{position:relative;overflow:hidden;display:flex;align-items:center;gap:var(--s-5);padding:var(--s-5) var(--s-6);margin-bottom:var(--s-8);border-radius:var(--r-lg);border:1px solid var(--border);background:linear-gradient(180deg,var(--glass-2),var(--glass-1));backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
.overall::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px}
.overall.operational::before{background:var(--green)}
.overall.degraded::before{background:var(--amber)}
.overall.major_outage::before{background:var(--red)}
.overall .icon{display:flex;align-items:center;justify-content:center;width:48px;height:48px;font-size:1.25rem;font-weight:700;border-radius:var(--r-md);flex-shrink:0}
.overall .icon svg{width:24px;height:24px}
.overall.operational .icon{background:var(--green-soft);color:var(--green)}
.overall.degraded .icon{background:var(--amber-soft);color:var(--amber)}
.overall.major_outage .icon{background:var(--red-soft);color:var(--red)}
.overall .info{flex:1;min-width:0}
.overall .title{font-size:1.1rem;font-weight:700}
.overall.operational .title{color:var(--green)}
.overall.degraded .title{color:var(--amber)}
.overall.major_outage .title{color:var(--red)}
.overall .sub{font-size:.8125rem;color:var(--text-3);margin-top:.15rem}

.section{margin-bottom:var(--s-8)}
.section-header{display:flex;align-items:center;gap:var(--s-3);font-family:var(--font);font-size:1.05rem;font-weight:700;letter-spacing:-.01em;color:var(--text-2);margin-bottom:var(--s-4);padding-bottom:var(--s-3);border-bottom:1px solid var(--border)}
.section-header .cat-ico{font-size:1.15em;opacity:.8}

.services{display:flex;flex-direction:column;gap:var(--s-3)}
.svc{position:relative;overflow:hidden;padding:var(--s-5);border-radius:var(--r-lg);border:1px solid var(--border);background:linear-gradient(180deg,var(--glass-2),var(--glass-1));backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);transition:border-color var(--t),transform var(--t),box-shadow var(--t)}
.svc:hover{border-color:var(--border-2);transform:translateY(-2px);box-shadow:var(--shadow)}
.svc::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px}
.svc.operational::before{background:var(--green)}
.svc.degraded::before{background:var(--amber)}
.svc.major_outage::before{background:var(--red)}
.svc.unknown::before{background:var(--text-3)}

.svc-header{display:flex;align-items:center;justify-content:space-between;gap:var(--s-3);margin-bottom:var(--s-4)}
.svc-name{display:flex;align-items:center;gap:var(--s-3);font-weight:600;font-size:.95rem;min-width:0}
.svc-name a{color:var(--text);transition:color var(--t)}
.svc-name a:hover{color:var(--accent)}
.dot.operational{background:var(--green);box-shadow:0 0 0 3px var(--green-soft)}
.dot.degraded{background:var(--amber);box-shadow:0 0 0 3px var(--amber-soft)}
.dot.major_outage{background:var(--red);box-shadow:0 0 0 3px var(--red-soft)}
.dot.unknown{background:var(--text-3)}
.svc-badge{font-size:.6875rem;font-weight:600;letter-spacing:.03em;padding:.28rem .65rem;border-radius:var(--r-full);text-transform:uppercase;border:1px solid transparent;white-space:nowrap}
.svc-badge.operational{background:var(--green-soft);color:var(--green);border-color:color-mix(in srgb,var(--green) 25%,transparent)}
.svc-badge.degraded{background:var(--amber-soft);color:var(--amber);border-color:color-mix(in srgb,var(--amber) 25%,transparent)}
.svc-badge.major_outage{background:var(--red-soft);color:var(--red);border-color:color-mix(in srgb,var(--red) 25%,transparent)}
.svc-badge.unknown{background:var(--glass-2);color:var(--text-3);border-color:var(--border)}

.svc-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--s-2);margin-bottom:var(--s-4);padding:var(--s-4) 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.stat{text-align:center}
.stat-label{font-size:.625rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:.3rem}
.stat-value{font-size:.95rem;font-weight:700;font-variant-numeric:tabular-nums}
.stat-value.good{color:var(--green)}.stat-value.warn{color:var(--amber)}.stat-value.bad{color:var(--red)}

.uptime-bar-container{margin-top:var(--s-2)}
.uptime-bar-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem}
.uptime-bar-label{font-size:.625rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3)}
.uptime-bar-pct{font-size:.75rem;font-weight:700;color:var(--text-2);font-variant-numeric:tabular-nums}
.uptime-bar{display:flex;gap:2px;height:24px;align-items:stretch}
.day{flex:1;min-width:2px;border-radius:3px;position:relative;cursor:default;transition:transform .12s var(--ease)}
.day:hover{transform:scaleY(1.3);z-index:2}
.day.up{background:var(--green)}
.day.partial{background:var(--amber)}
.day.down{background:var(--red)}
.day.nodata{background:var(--glass-3)}
.day .tip{display:none;position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:var(--bg-1);border:1px solid var(--border-2);color:var(--text);font-size:.6875rem;font-weight:500;padding:.3rem .55rem;border-radius:var(--r-xs);white-space:nowrap;z-index:10;pointer-events:none;box-shadow:var(--shadow)}
.day:hover .tip{display:block}

.links{display:flex;justify-content:center;gap:var(--s-6);margin-top:var(--s-3)}
.refresh{display:flex;align-items:center;justify-content:center;gap:.45rem;color:var(--text-3);font-size:.75rem;margin-top:var(--s-4)}
.refresh .live{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px var(--green-soft);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}

@media(max-width:640px){.svc-stats{grid-template-columns:repeat(2,1fr);gap:var(--s-3)}}
</style>
</head>
<body>
${themeToggle('fixed')}
<div class="container">
  <div class="status-hero">
    <div class="brand">${icon('landmark', { size: 30 })}</div>
    <div><h1>${displayName}</h1><p>System status · live service health</p></div>
  </div>

  <div id="overall" class="overall operational">
    <div class="icon" id="overall-icon">${icon('check-circle', { size: 24 })}</div>
    <div class="info">
      <div class="title" id="overall-text">Checking systems…</div>
      <div class="sub" id="overall-sub">Contacting services…</div>
    </div>
  </div>

  <div id="categories">
    <div class="section">
      <div class="section-header">Loading</div>
      <div class="services">
        <div class="svc" style="padding:var(--s-5)">
          <div class="skeleton" style="height:1rem;width:38%"></div>
          <div class="skeleton" style="height:54px;margin-top:var(--s-4)"></div>
          <div class="skeleton" style="height:24px;margin-top:var(--s-4)"></div>
        </div>
        <div class="svc" style="padding:var(--s-5)">
          <div class="skeleton" style="height:1rem;width:46%"></div>
          <div class="skeleton" style="height:54px;margin-top:var(--s-4)"></div>
          <div class="skeleton" style="height:24px;margin-top:var(--s-4)"></div>
        </div>
        <div class="svc" style="padding:var(--s-5)">
          <div class="skeleton" style="height:1rem;width:32%"></div>
          <div class="skeleton" style="height:54px;margin-top:var(--s-4)"></div>
          <div class="skeleton" style="height:24px;margin-top:var(--s-4)"></div>
        </div>
      </div>
    </div>
  </div>

  <section class="section" aria-labelledby="deploy-timeline-title">
    <h2 id="deploy-timeline-title" class="section-header">Recent deployments</h2>
    <div id="deploy-timeline">Loading…</div>
  </section>

  <footer class="app-footer">
    <p>${displayName} · Service Status</p>
    <div class="links">
      ${mainUrl ? `<a href="${mainUrl}">Main Site</a>` : ''}
      ${sandboxUrl ? `<a href="${sandboxUrl}">Sandbox</a>` : ''}
      <a href="/">Dashboard</a>
    </div>
    <div class="refresh">
      <span class="live"></span>
      <span id="status-connection" role="status">Connecting…</span> · <span id="last-checked">—</span>
    </div>
  </footer>
</div>
${clientBootstrapScript()}
<script>
function setHtml(el,html){if(window.OpsDom&&OpsDom.setTrustedHtml)OpsDom.setTrustedHtml(el,html);}
function esc(value){return window.OpsDom.escapeHtml(value);}
function safePageUrl(value){
  if(typeof value!=='string'||!value)return null;
  try{const url=new URL(value,location.origin);return ['http:','https:'].includes(url.protocol)?url.href:null;}
  catch{return null;}
}
const STATUS_LABELS={operational:'Operational',degraded:'Degraded',major_outage:'Outage',unknown:'Checking…'};
const STATUS_ORDER={major_outage:0,degraded:1,operational:2,unknown:3};
const CATS={
  app:{title:'Applications',icon:'${icon('package', { size: 17 })}',order:1},
  infra:{title:'Infrastructure',icon:'${icon('cpu', { size: 17 })}',order:2},
  ops:{title:'Operations',icon:'${icon('settings', { size: 17 })}',order:3},
  games:{title:'Games',icon:'${icon('globe', { size: 17 })}',order:4}
};

async function loadStatus(){
  try{
    const r=await fetch('/api/status');
    if(!r.ok) throw new Error('fetch failed');
    renderStatus(await r.json());
  }catch(e){
    setHtml(document.getElementById('categories'),'<div class="empty"><div class="e-ico">${icon('alert-triangle')}</div><div class="err-text">Failed to load status. Retrying…</div></div>');
  }
}

function renderStatus(data){
  const services=data.services||[];
  let worst='operational';
  for(const s of services){
    if((STATUS_ORDER[s.current]??99)<(STATUS_ORDER[worst]??0)) worst=s.current;
  }
  const el=document.getElementById('overall');
  el.className='overall '+worst;
  setHtml(document.getElementById('overall-icon'),worst==='operational'?'${icon('check-circle', { size: 24 })}':worst==='degraded'?'${icon('alert-triangle', { size: 24 })}':'${icon('alert-circle', { size: 24 })}');
  document.getElementById('overall-text').textContent=worst==='operational'?'All Systems Operational':worst==='degraded'?'Partial Degradation':'System Outage';
  document.getElementById('overall-sub').textContent=services.length+' services monitored · Last checked '+new Date(data.updated).toLocaleTimeString();
  document.getElementById('last-checked').textContent=new Date(data.updated).toLocaleTimeString();

  const groups={};
  for(const s of services){
    const c=s.category||'other';
    if(!groups[c]) groups[c]=[];
    groups[c].push(s);
  }
  let html='';
  for(const[cat,svcs] of Object.entries(groups).sort((a,b)=>(CATS[a[0]]?.order||99)-(CATS[b[0]]?.order||99))){
    const meta=CATS[cat]||{title:cat,icon:'${icon('dot', { size: 17 })}'};
    html+='<div class="section">';
    html+='<div class="section-header"><span class="cat-ico">'+meta.icon+'</span>'+esc(meta.title)+'</div>';
    html+='<div class="services">';
    for(const s of svcs) html+=svcCard(s);
    html+='</div></div>';
  }
  setHtml(document.getElementById('categories'),html);
}

function svcCard(s){
  const current=Object.hasOwn(STATUS_LABELS,s.current)?s.current:'unknown';
  const lat=Number.isFinite(s.latencyMs)?s.latencyMs:'—';
  const up24=s.uptime24h!=null?s.uptime24h.toFixed(2)+'%':'—';
  const up7d=s.uptime7d!=null?s.uptime7d.toFixed(2)+'%':'—';
  const up90=s.uptime90d!=null?s.uptime90d.toFixed(1)+'%':'—';
  const bar=uptimeBar(s.history||[]);
  const latClass=lat==='—'?'':lat<300?'good':lat<1000?'warn':'bad';
  const up24Class=up24==='—'?'':parseFloat(up24)>=99.9?'good':parseFloat(up24)>=99?'warn':'bad';
  const up7dClass=up7d==='—'?'':parseFloat(up7d)>=99.9?'good':parseFloat(up7d)>=99?'warn':'bad';
  const up90Class=up90==='—'?'':parseFloat(up90)>=99.9?'good':parseFloat(up90)>=99?'warn':'bad';

  let h='<div class="svc '+current+'">';
  h+='<div class="svc-header">';
  const pageUrl=safePageUrl(s.pageUrl);
  h+='<div class="svc-name"><span class="dot '+current+'"></span>'+(pageUrl?'<a href="'+esc(pageUrl)+'" target="_blank" rel="noopener">'+esc(s.name)+'</a>':esc(s.name))+'</div>';
  h+='<span class="svc-badge '+current+'">'+STATUS_LABELS[current]+'</span>';
  h+='</div>';
  h+='<div class="svc-stats">';
  h+='<div class="stat"><div class="stat-label">Latency</div><div class="stat-value '+latClass+'">'+(typeof lat==='number'?lat+'ms':lat)+'</div></div>';
  h+='<div class="stat"><div class="stat-label">Uptime 24h</div><div class="stat-value '+up24Class+'">'+up24+'</div></div>';
  h+='<div class="stat"><div class="stat-label">Uptime 7d</div><div class="stat-value '+up7dClass+'">'+up7d+'</div></div>';
  h+='<div class="stat"><div class="stat-label">Uptime 90d</div><div class="stat-value '+up90Class+'">'+up90+'</div></div>';
  h+='</div>';
  h+='<div class="uptime-bar-container">';
  h+='<div class="uptime-bar-header"><span class="uptime-bar-label">90-Day History</span><span class="uptime-bar-pct">'+up90+'</span></div>';
  h+='<div class="uptime-bar">'+bar+'</div>';
  h+='</div></div>';
  return h;
}

// history is now a daily-rollup array from /api/status: [{date, pct, total}].
function uptimeBar(history){
  if(!history||!history.length) return '<div class="day nodata" style="flex:1"><span class="tip">No data</span></div>';
  const days={};
  for(const r of history){ days[r.date]=r; }
  let html='';
  const now=new Date();
  for(let i=89;i>=0;i--){
    const d=new Date(now.getTime()-i*86400000);
    const key=d.toISOString().slice(0,10);
    const data=days[key];
    let cls='nodata',tip=key+': No data';
    if(data&&data.total>0&&data.pct!=null){
      const pct=data.pct;
      if(pct>=99.9){cls='up';}
      else if(pct>=95){cls='partial';}
      else{cls='down';}
      tip=key+': '+pct.toFixed(1)+'%';
    }
    html+='<div class="day '+cls+'"><span class="tip">'+esc(tip)+'</span></div>';
  }
  return html;
}

loadStatus();
async function loadDeployTimeline(){
  try{
    const response=await fetch('/api/status/timeline');
    if(!response.ok)return;
    const data=await response.json();
    const host=document.getElementById('deploy-timeline');
    host.replaceChildren();
    const events=(data.events||[]).slice(0,8);
    if(!events.length){host.textContent='No recent deployments.';return;}
    for(const event of events){
      const row=document.createElement('p');
      row.textContent=(event.type==='deploy:completed'?'Completed':'Started')+' · '+new Date(event.occurredAt).toLocaleString();
      host.append(row);
    }
  }catch{}
}
loadDeployTimeline();
if(window.EventSource){
  const live=new EventSource('/api/status/events');
  live.addEventListener('open',()=>{document.getElementById('status-connection').textContent='Live updates'});
  live.addEventListener('error',()=>{document.getElementById('status-connection').textContent='Reconnecting…'});
  live.addEventListener('update',event=>{
    loadStatus();
    try{if(JSON.parse(event.data).type.startsWith('deploy:'))loadDeployTimeline();}catch{}
  });
}else{document.getElementById('status-connection').textContent='Periodic updates'}
setInterval(loadStatus,300000);
</script>
${THEME_TOGGLE_JS}
</body>
</html>`;
};
