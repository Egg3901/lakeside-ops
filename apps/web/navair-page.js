// navair-page.js — "Blue Water", the naval/air positioning slice, as a Cold War
// situation board.
//
// Map asset and theme are the game's own (navair/worldMap.js, navair/theme.js). The map
// is cropped to the scenario's declared theatre, and region markers are absolutely
// positioned in percentage coordinates over it — the technique the game's own
// GlobalConflictsBoard uses for its flashpoint pins.
//
// The interaction model, after a first pass that measurably had none:
//   · hover or tap any theatre     -> inspector (geography, berths, basing, contacts)
//   · tap an asset                 -> the map lights exactly where it may go
//   · tap a lit theatre            -> issues the order, drawn on the map as an arrow
//   · one order panel for the selected asset, not a dropdown per asset
//
// Returns { extraCss, body } for renderShell. The client renders a fogged view and posts
// orders back; the true state never leaves the server.

const R = require("./navair/rules");
const M = require("./navair/map");
const { MIL_COLOR, MIL_FONT, BLOC_COLOR, CW_CSS } = require("./navair/theme");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** The classification strip every situation-room page carries. Ported from `_coldwar/ClassificationStrip.tsx`. */
function classificationStrip(left, right) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 20px;
    background:repeating-linear-gradient(45deg,#1a1610,#1a1610 10px,#16130d 10px,#16130d 20px);
    border-bottom:1px solid #2a2416">
    <span style="font:600 10px ${MIL_FONT.mono};letter-spacing:.2em;color:#a9863a">${esc(left)}</span>
    <span style="font:500 10px ${MIL_FONT.mono};letter-spacing:.15em;color:#6f6a52;flex-shrink:0" id="nvStamp">${esc(right)}</span>
  </div>`;
}

function clientRules() {
  return {
    regions: M.REGIONS.map((r) => ({
      id: r.id, name: r.name, short: r.short, macro: r.macro, terrain: r.terrain,
      lon: r.lon, lat: r.lat, type: r.type, port: r.port, air: r.air, logi: r.logi, infra: r.infra,
    })),
    adjacency: M.ADJACENCY,
    projection: M.PROJECTION,
    navalMissions: Object.fromEntries(Object.entries(R.NAVAL_MISSIONS).map(([k, v]) => [k, { label: v.label, desc: v.desc }])),
    airMissions: Object.fromEntries(Object.entries(R.AIR_MISSIONS).map(([k, v]) => [k, { label: v.label, desc: v.desc }])),
    berthCost: R.BERTH_COST,
    strikeMissions: ["STRIKE_NAVAL", "STRIKE_AIRBASE"],
    color: MIL_COLOR,
    bloc: BLOC_COLOR,
  };
}

const NAVAIR_JS = `
(function(){
const S=window.__NAVAIR__, RULES=S.rules, C=RULES.color, P=RULES.projection;
const REG=Object.fromEntries(RULES.regions.map(r=>[r.id,r]));
let view=S.view, gameId=S.gameId;
let orders={}, works=null, sel=null, inspect=null, busy=false;

const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// ── projection: SVG units, then into the scenario's theatre crop ──────────
const svgX=lon=>((lon-P.lonMin)/(P.lonMax-P.lonMin))*1000;
const svgY=lat=>((P.latTop-lat)/(P.latTop-P.latBottom))*394.4;
function crop(){
  const t=view.theater, x=svgX(t.lonMin), y=svgY(t.latMax);
  return {x,y,w:svgX(t.lonMax)-x,h:svgY(t.latMin)-y};
}
/** Region position as a percentage of the cropped box. An off-theatre region pins to the
 *  edge rather than vanishing, so an asset ordered off-board is still visible. */
function pos(r){
  const c=crop();
  const x=((svgX(r.lon)-c.x)/c.w)*100, y=((svgY(r.lat)-c.y)/c.h)*100;
  return {x:clamp(x,3,97), y:clamp(y,6,94), off:x<0||x>100||y<0||y>100};
}

// ── graph ─────────────────────────────────────────────────────────────────
function bfs(from,to,pass){
  if(from===to) return 0;
  const seen=new Set([from]); let edge=[from], d=0;
  while(edge.length){ d++; const nx=[];
    for(const r of edge) for(const n of (RULES.adjacency[r]||[])){
      if(n===to) return d;
      if(seen.has(n)||(pass&&!pass(n))) continue;
      seen.add(n); nx.push(n);
    } edge=nx; }
  return Infinity;
}
const water=id=>REG[id]&&(REG[id].type==='naval'||REG[id].type==='mixed');
const navigable=id=>REG[id]&&REG[id].port>0;
const hops=(a,b)=>bfs(a,b,null);
const navHops=(a,b)=>water(b)?bfs(a,b,navigable):Infinity;

function ordered(u){ const o=orders[u.id]||{}; return {mission:o.mission||u.mission, region:o.region||u.region, target:o.target||null}; }
function missionPool(u){
  return u.domain==='naval'
    ? (u.canFly?Object.assign({},RULES.navalMissions,RULES.airMissions):RULES.navalMissions)
    : RULES.airMissions;
}
const isStrike=m=>RULES.strikeMissions.includes(m);

/** What tapping a theatre would do for the selected asset: move, aim, or nothing. */
function intentFor(u,id){
  if(!u) return null;
  const o=ordered(u);
  if(isStrike(o.mission)) return id!==o.region && hops(o.region,id)<=Math.max(1,u.radius) ? 'target' : null;
  if(id===u.region) return 'stay';
  const d=u.domain==='naval'?navHops(u.region,id):hops(u.region,id);
  return d<=(u.domain==='naval'?u.speed:u.radius)?'move':null;
}

// ── map ───────────────────────────────────────────────────────────────────
async function loadMap(){
  try{
    const r=await fetch('/navair/world.svg');
    if(!r.ok) throw new Error('HTTP '+r.status);
    $('nvMap').innerHTML=await r.text();
    const svg=$('nvMap').querySelector('svg'), c=crop();
    // Crop to the theatre. The whole globe spent most of its pixels where this scenario
    // has no forces, which is what left every marker too small to read or tap.
    svg.setAttribute('viewBox', c.x+' '+c.y+' '+c.w+' '+c.h);
    svg.querySelectorAll('rect').forEach(el=>{
      el.setAttribute('x',c.x); el.setAttribute('y',c.y);
      el.setAttribute('width',c.w); el.setAttribute('height',c.h);
    });
    $('nvMapBox').style.setProperty('--cw-ar',(c.w/c.h).toFixed(3));
    paintMap();
    render();
    centreOnForces();
  }catch(e){
    $('nvMap').innerHTML='<div class="cw-mapskel" style="animation:none;color:'+C.amber+'">GEOMETRY UNAVAILABLE</div>';
  }
}
/**
 * Pan the map to your own forces.
 *
 * On a phone the board is wider than the screen and scrolls; opening it parked on the
 * empty North Atlantic meant the first thing a player saw was ocean. Centres on the mean
 * position of your assets, so the theatre you are actually fighting in is on screen.
 */
function centreOnForces(){
  const sc=document.querySelector('.cw-mapscroll');
  if(!sc||sc.scrollWidth<=sc.clientWidth) return;
  const xs=view.units.map(u=>pos(REG[ordered(u).region]).x);
  if(!xs.length) return;
  const mid=xs.reduce((a,b)=>a+b,0)/xs.length;
  sc.scrollLeft=clamp((mid/100)*sc.scrollWidth-sc.clientWidth/2,0,sc.scrollWidth-sc.clientWidth);
}

function paintMap(){
  $('nvMap').querySelectorAll('path[data-bloc]').forEach(p=>{
    const b=RULES.bloc[p.getAttribute('data-bloc')]||RULES.bloc.other;
    p.setAttribute('fill',b.fill); p.setAttribute('stroke',b.stroke); p.setAttribute('stroke-width','0.5');
    p.style.cursor='default';
  });
}

function drawMarkers(){
  const u=sel?view.units.find(x=>x.id===sel):null;
  const lanes=new Set(view.lanes.map(l=>l.region));
  $('nvPins').innerHTML=RULES.regions.map(r=>{
    const c=view.contacts[r.id]||{level:0};
    const own=view.units.filter(x=>ordered(x).region===r.id);
    const bas=view.basing[r.id]||{};
    const p=pos(r), intent=intentFor(u,r.id);
    // Nine of nineteen regions sit outside this scenario's theatre. Pinning them all to
    // the map edge piled thirteen markers on top of each other at phone widths, so an
    // off-board region only earns a marker when something of yours is actually there.
    if(p.off && !own.length && !lanes.has(r.id)) return '';

    let cls='cw-mk '+(bas.status||'neutral');
    if(p.off) cls+=' offboard';
    if(lanes.has(r.id)) cls+=' lane';
    if(c.level<=0&&!own.length) cls+=' dark';
    if(inspect===r.id) cls+=' inspect';
    if(u){
      const o=ordered(u);
      if(o.target===r.id) cls+=' target';
      else if(o.region===r.id&&o.region!==u.region) cls+=' dest';
      else if(u.region===r.id) cls+=' here';
      else if(intent) cls+=' legal';
      else cls+=' illegal';
    }

    let foe='';
    if(c.level>=3&&c.count) foe=c.count+'\\u25CF'+(c.units||[]).map(x=>x.domain==='air'?'a':'n').join('');
    else if(c.level===2&&c.count) foe=c.count+'\\u25CF'+Object.entries(c.byDomain||{}).map(([d,n])=>n+d[0]).join('');
    else if(c.level===1&&c.count) foe='?\\u25CF';

    const pips=(own.length?'<span class="own">'+own.length+'\\u25B2</span>':'')+(foe?'<span class="foe">'+esc(foe)+'</span>':'');
    const lane=view.lanes.find(l=>l.region===r.id);
    const ring=lane&&lane.pressure>0?'<span class="ring"></span>':'';
    const label=intent==='move'?'move here':intent==='target'?'strike here':'inspect';
    return '<button type="button" class="'+cls+'" data-region="'+r.id+'" style="left:'+p.x+'%;top:'+p.y+'%" '
      +'aria-label="'+esc(r.name+' \\u2014 '+label)+'">'+ring
      +'<span class="tok">'+esc(r.short)+'</span>'
      +(pips?'<span class="pips">'+pips+'</span>':'')+'</button>';
  }).join('');

  $('nvPins').querySelectorAll('.cw-mk').forEach(el=>{
    el.addEventListener('click',()=>onRegion(el.dataset.region));
    el.addEventListener('mouseenter',()=>{ if(!inspect) drawInspector(el.dataset.region); });
    el.addEventListener('mouseleave',()=>{ if(!inspect) drawInspector(null); });
  });
}

/** Orders drawn on the map: a gold arrow for a move, a red bearing for a strike. */
function drawOrderLines(){
  const parts=[];
  for(const u of view.units){
    const o=ordered(u), from=REG[u.region];
    const to=o.target?REG[o.target]:(o.region!==u.region?REG[o.region]:null);
    if(!from||!to) continue;
    const a=pos(from), b=pos(to), strike=!!o.target;
    parts.push('<line x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" stroke="'+(strike?C.red:C.gold)+'" '
      +'stroke-width="0.5" stroke-dasharray="2.4 1.6" opacity="'+(sel===u.id?0.95:0.45)+'" '
      +'marker-end="url(#nvArrow'+(strike?'R':'G')+')" style="animation:cwDash 1.1s linear infinite"/>');
  }
  $('nvOrders').innerHTML='<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%">'
    +'<defs>'
    +'<marker id="nvArrowG" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="4" markerHeight="4" orient="auto">'
    +'<path d="M0,1 L6,4 L0,7 Z" fill="'+C.gold+'"/></marker>'
    +'<marker id="nvArrowR" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="4" markerHeight="4" orient="auto">'
    +'<path d="M0,1 L6,4 L0,7 Z" fill="'+C.red+'"/></marker>'
    +'</defs>'+parts.join('')+'</svg>';
}

function onRegion(id){
  const u=sel?view.units.find(x=>x.id===sel):null;
  const intent=intentFor(u,id);
  if(u&&intent==='move'){ (orders[u.id]=orders[u.id]||{}).region=id; }
  else if(u&&intent==='target'){ (orders[u.id]=orders[u.id]||{}).target=id; }
  else if(u&&intent==='stay'){ (orders[u.id]=orders[u.id]||{}).region=u.region; }
  else { inspect=inspect===id?null:id; }
  render();
}

// ── inspector ─────────────────────────────────────────────────────────────
function drawInspector(hoverId){
  const id=inspect||hoverId, box=$('nvInsp');
  if(!id){
    box.innerHTML='<div class="cw-empty">Hover or tap a theatre for its geography, basing rights and whatever your patrols have found there.</div>';
    return;
  }
  const r=REG[id], b=view.basing[id]||{}, c=view.contacts[id]||{level:0};
  const lane=view.lanes.find(l=>l.region===id);
  const own=view.units.filter(x=>ordered(x).region===id);
  const sight=['no contact','contact only','composition known','full order of battle'][clamp(c.level,0,3)];
  const kv=(k,v,col)=>'<div><span>'+esc(k)+'</span><b'+(col?' style="color:'+col+'"':'')+'>'+esc(v)+'</b></div>';
  let out='<div class="t">'+esc(r.name)+'</div><div class="s">'+esc(r.macro.toUpperCase()+' \\u00B7 '+r.terrain)+'</div><div class="cw-kv">'
    +kv('Basing',(b.status||'neutral').toUpperCase(), b.status==='hostile'?C.red:b.status==='home'?C.blue:null)
    +kv('Berths',(b.demand||0)+' / '+(b.capacity!=null?b.capacity:'?'), b.overcrowded>0?C.amber:null)
    +kv('Port',r.port+(b.works?' (+'+b.works+')':''))
    +kv('Airbase',String(r.air))
    +kv('Logistics',r.logi)
    +kv('Intel',sight)
    +'</div>';
  if(lane) out+='<div class="note" style="color:'+C.gold+'">Trade lane \\u2014 pressure '+lane.pressure+', weight '+lane.weight+'.</div>';
  if(own.length) out+='<div class="note">Yours here: '+esc(own.map(u=>u.name).join(', '))+'.</div>';
  if(c.count) out+='<div class="note" style="color:#ff8080">'+esc(c.band||'Contacts')+' \\u2014 '
    +(c.level>=3?esc((c.units||[]).map(x=>x.type+' ('+x.mission+')').join(', '))
      :c.level===2?esc(Object.entries(c.byDomain||{}).map(([d,n])=>n+' '+d).join(', '))
      :c.count+' contact'+(c.count===1?'':'s')+', composition unknown')+'.</div>';
  if(b.overcrowded>0) out+='<div class="note" style="color:'+C.amber+'">Overcrowded by '+b.overcrowded+' berths. Supply here is capped and falling.</div>';
  box.innerHTML='<div class="cw-insp">'+out+'</div>';
}

// ── objectives ────────────────────────────────────────────────────────────
const tone=(good,warn)=>good?C.green:warn?C.gold:C.amber;
function cell(lbl,val,note,pct,col){
  return '<div><div class="cw-label">'+esc(lbl)+'</div><div class="v" style="color:'+col+'">'+esc(val)+'</div>'
    +'<div class="n">'+esc(note)+'</div><div class="cw-track"><i style="width:'+clamp(pct,0,100)+'%;background:'+col+'"></i></div></div>';
}
function drawObjectives(){
  const o=view.objectives, f=view.front, csg=view.units.find(x=>x.id===o.flagshipId);
  $('nvObj').innerHTML=
      cell('Embargo index',view.embargoIndex+' / '+o.embargoTarget,'sustained '+view.embargoStreak+' of '+o.embargoTurns,
           view.embargoIndex/o.embargoTarget*100, tone(view.embargoIndex>=o.embargoTarget,view.embargoIndex>=o.embargoTarget*0.6))
    + cell('Central Front',f.control.toFixed(1)+'%','lost at '+o.frontLossAt+'%',f.control/o.frontLossAt*100,
           tone(f.control<o.frontLossAt-18,f.control<o.frontLossAt-8))
    + cell('Flagship',csg?csg.hp+'%':'LOST',csg?csg.name:'operation over',csg?csg.hp:0,
           tone(!!csg&&csg.hp>60,!!csg&&csg.hp>30))
    + view.lanes.map(l=>cell(l.name,String(l.pressure),'weight '+l.weight+' \\u00B7 '+l.region.toUpperCase(),
           l.pressure,tone(l.pressure>=60,l.pressure>=30))).join('');
}

// ── roster + order panel ──────────────────────────────────────────────────
const bar=(v,col)=>'<span><i style="width:'+clamp(v,0,100)+'%;background:'+col+'"></i></span>';
function drawRoster(){
  $('nvUnits').innerHTML=view.units.map(u=>{
    const o=ordered(u), pool=missionPool(u), bas=view.basing[o.region]||{};
    const mi=(pool[o.mission]||{}).label||o.mission;
    return '<button type="button" class="cw-unit'+(sel===u.id?' sel':'')+'" data-u="'+u.id+'" aria-pressed="'+(sel===u.id)+'">'
      +'<div class="r1"><span class="nm">'+esc(u.name)+'</span><span class="mi">'+esc(mi)+'</span>'
      +'<span class="loc">'+esc(REG[o.region].short)+(o.region!==u.region?' \\u2192':'')+(o.target?' \\u25CE':'')+'</span></div>'
      +'<div class="cw-bars">'+bar(u.hp,tone(u.hp>60,u.hp>30))+bar(u.readiness,tone(u.readiness>55,u.readiness>25))
      +bar(u.supply,tone(u.supply>65,u.supply>40))+'</div>'
      +(bas.overcrowded>0?'<div class="warn">\\u26A0 berths '+bas.demand+'/'+bas.capacity+' \\u2014 supply bleeding</div>':'')
      +'</button>';
  }).join('');
  $('nvUnits').querySelectorAll('.cw-unit').forEach(el=>el.addEventListener('click',()=>{
    sel=sel===el.dataset.u?null:el.dataset.u; inspect=null; render();
  }));
}

function drawOrder(){
  const box=$('nvOrder'), u=sel?view.units.find(x=>x.id===sel):null;
  if(!u){ box.innerHTML=''; box.style.display='none'; return; }
  box.style.display='';
  const o=ordered(u), pool=missionPool(u), bas=view.basing[o.region]||{};
  const segs=Object.entries(pool).map(([k,v])=>
    '<button type="button" data-m="'+k+'" aria-pressed="'+(k===o.mission)+'">'+esc(v.label)+'</button>').join('');
  const crowd=bas.overcrowded>0?' <em>Berths '+bas.demand+'/'+bas.capacity+' here \\u2014 overcrowded, supply is bleeding.</em>':'';
  const dest=isStrike(o.mission)
    ? (o.target?'Striking <b>'+esc(REG[o.target].short)+'</b>':'Pick a target \\u2014 tap a lit theatre')
    : (o.region!==u.region?'Moving to <b>'+esc(REG[o.region].short)+'</b>':'Holding at <b>'+esc(REG[u.region].short)+'</b>');
  const clear=(o.region!==u.region||o.target)?'<button type="button" id="nvClear">CLEAR</button>':'';
  box.innerHTML='<button type="button" class="close" id="nvClose" aria-label="Close">\\u2715</button>'
    +'<div class="hd"><span class="nm">'+esc(u.name)+'</span><span class="ty">'+esc(u.type)+'</span></div>'
    +'<div class="cw-seg">'+segs+'</div>'
    +'<div class="desc">'+esc((pool[o.mission]||{}).desc||'')+crowd+'</div>'
    +'<div class="cw-dest">'+dest+clear+'</div>';
  box.querySelectorAll('.cw-seg button').forEach(b=>b.addEventListener('click',()=>{
    const oo=orders[u.id]=orders[u.id]||{};
    oo.mission=b.dataset.m;
    if(!isStrike(b.dataset.m)) oo.target=null;
    render();
  }));
  const cl=$('nvClear');
  if(cl) cl.addEventListener('click',()=>{ const oo=orders[u.id]=orders[u.id]||{}; oo.region=u.region; oo.target=null; render(); });
  $('nvClose').addEventListener('click',()=>{ sel=null; render(); });
}

function drawWorks(){
  const p=view.portProjects[0], rules=view.portWorksRules;
  if(p){
    $('nvWorks').innerHTML='<div class="prog">\\u25C6 ENGINEERS AT '+esc(REG[p.region].short)+' \\u2014 '+p.turnsLeft+' TURN'+(p.turnsLeft===1?'':'S')+'</div>'
      +'<p>Adds +'+rules.capacityGain+' berths of your own forward basing on completion.</p>';
    return;
  }
  const opts=RULES.regions.filter(r=>r.port>0&&r.type!=='land')
    .map(r=>{const b=view.basing[r.id]||{};return '<option value="'+r.id+'"'+(works===r.id?' selected':'')+'>'+esc(r.short)+' \\u2014 '+b.status+', '+b.capacity+' berths</option>';}).join('');
  $('nvWorks').innerHTML='<select class="cw-sel" id="nvWorksSel" aria-label="Forward basing project"><option value="">\\u2014 no project \\u2014</option>'+opts+'</select>'
    +'<p>Tenders and anchorages you bring yourself, so they count at full value even off a hostile coast. '
    +rules.buildTurns+' turns, +'+rules.capacityGain+' berths. An ally lends you 75% of its port; an enemy coast, 20%.</p>';
  const el=$('nvWorksSel');
  if(el) el.addEventListener('change',()=>{ works=el.value||null; });
}

function drawLog(){
  const errs=(view.orderErrors||[]).map(e=>'<div class="r err"><span class="ph">order</span><span>'+esc(e)+'</span></div>').join('');
  const rows=(view.log||[]).map(l=>'<div class="r"><span class="ph">'+esc(l.phase)+'</span><span>'+esc(l.text)+'</span></div>').join('');
  $('nvLog').innerHTML=errs+rows||'<div class="cw-empty">No traffic yet. Issue orders and resolve the turn.</div>';
}

function drawOutcome(){
  const box=$('nvOutcome');
  if(!view.outcome){ box.innerHTML=''; box.className=''; return; }
  const win=view.outcome.result==='win';
  box.className='cw-outcome';
  box.style.borderTopColor=win?C.green:C.red;
  box.innerHTML='<h3 style="color:'+(win?C.green:C.red)+'">'+(win?'OBJECTIVE MET':'OPERATION FAILED')+'</h3><p>'+esc(view.outcome.reason)+'</p>';
}

function render(){
  $('nvStamp').textContent='TURN '+view.turn+' OF '+view.maxTurns+' \\u00B7 '+view.scenario.year;
  drawObjectives(); drawMarkers(); drawOrderLines(); drawInspector(null);
  drawRoster(); drawOrder(); drawWorks(); drawLog(); drawOutcome();
  for(const id of ['nvEnd','nvEnd2']){
    const b=$(id); if(!b) continue;
    b.textContent=busy?'Resolving\\u2026':'Resolve turn '+view.turn;
    b.disabled=busy||!!view.outcome;
  }
}

async function post(url,payload){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const j=await r.json();
  if(j.error) throw new Error(j.error);
  return j;
}
async function endTurn(){
  if(busy||view.outcome) return;
  busy=true; render();
  const payload=Object.entries(orders).map(([unitId,o])=>Object.assign({unitId},o));
  if(works) payload.push({command:'PORT_WORKS',region:works});
  try{ view=(await post('/api/navair/turn',{gameId,orders:payload})).view; orders={}; works=null; sel=null; }
  catch(e){ alert('Could not resolve the turn: '+e.message); }
  finally{ busy=false; render(); }
}
async function restart(){
  busy=true; render();
  try{ const j=await post('/api/navair/new',{}); gameId=j.gameId; view=j.view; orders={}; works=null; sel=null; inspect=null; }
  catch(e){ alert('Could not start a new game: '+e.message); }
  finally{ busy=false; render(); }
}

document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&(sel||inspect)){ sel=null; inspect=null; render(); } });
$('nvEnd').addEventListener('click',endTurn);
$('nvEnd2').addEventListener('click',endTurn);
$('nvNew').addEventListener('click',restart);
loadMap();
render();
})();
`;

function makeNavairBody({ view, gameId }) {
  const sc = view.scenario;
  const body = `<div class="cw-root">
  ${classificationStrip(`◆ EYES ONLY · BLUE WATER — ${sc.name.toUpperCase()}`, `TURN ${view.turn} OF ${view.maxTurns} · ${sc.year}`)}

  <div style="padding:14px 20px 0">
    <div style="font:600 17px ${MIL_FONT.serif};color:${MIL_COLOR.textStrong}">${esc(sc.name)}</div>
    <div style="font:400 11.5px ${MIL_FONT.sans};color:${MIL_COLOR.textMuted};line-height:1.55;max-width:88ch;margin-top:3px">${esc(sc.brief)}</div>
  </div>

  <div class="cw-board">
    <div class="cw-col">
      <div class="cw-panel"><div class="cw-obj" id="nvObj"></div></div>

      <div class="cw-panel">
        <div class="cw-panel-hd"><h2>${esc(view.theater.name)}</h2><span class="hint">tap a theatre to inspect · pick an asset to move it</span></div>
        <div class="cw-mapscroll">
          <div class="cw-mapbox" id="nvMapBox">
            <div id="nvMap"><div class="cw-mapskel">LOADING GEOMETRY</div></div>
            <div id="nvOrders"></div>
            <div id="nvPins"></div>
            <div class="cw-vig"></div>
          </div>
        </div>
        <div class="cw-scrollhint">← swipe the board to pan the theatre →</div>
        <div class="cw-legend">
          <span><i style="background:${BLOC_COLOR.west.fill};border:1px solid ${BLOC_COLOR.west.stroke}"></i>West</span>
          <span><i style="background:${BLOC_COLOR.east.fill};border:1px solid ${BLOC_COLOR.east.stroke}"></i>East</span>
          <span><i style="background:${BLOC_COLOR.swing.fill};border:1px solid ${BLOC_COLOR.swing.stroke}"></i>Swing</span>
          <span style="color:#7db3ff">▲ yours</span>
          <span style="color:#ff8080">● contacts</span>
          <span style="color:${MIL_COLOR.gold}">▭ lane · → orders</span>
          <span style="color:${MIL_COLOR.green}">▭ reachable</span>
        </div>
      </div>

      <div class="cw-panel"><div class="cw-panel-hd"><h2>Theatre inspector</h2></div><div id="nvInsp"></div></div>

      <div class="cw-panel grow">
        <div class="cw-panel-hd"><h2>Signals traffic</h2><span class="hint">last resolved turn</span></div>
        <div class="cw-log" id="nvLog"></div>
      </div>
    </div>

    <div class="cw-col">
      <div class="cw-panel">
        <div class="cw-panel-hd"><h2>Order of battle</h2><span class="hint">hull · readiness · supply</span></div>
        <div id="nvUnits"></div>
        <div class="cw-order" id="nvOrder" style="display:none"></div>
        <div class="cw-act" id="nvSticky">
          <button class="cw-btn" id="nvEnd">Resolve turn</button>
          <button class="cw-btn ghost" id="nvNew">Restart</button>
        </div>
        <div id="nvOutcome"></div>
      </div>

      <div class="cw-panel">
        <div class="cw-panel-hd"><h2>Forward basing</h2><span class="hint">defence ministry</span></div>
        <div class="cw-works" id="nvWorks"></div>
      </div>

      <div class="cw-act cw-resolvebar" style="border:1px solid ${MIL_COLOR.border};border-radius:3px">
        <button class="cw-btn" id="nvEnd2">Resolve turn</button>
      </div>
    </div>
  </div>
</div>
<script>window.__NAVAIR__=${JSON.stringify({ view, gameId, rules: clientRules() }).replace(/</g, "\\u003c")};</script>
<script>${NAVAIR_JS}</script>`;

  return { extraCss: CW_CSS, body };
}

module.exports = { makeNavairBody, clientRules };
