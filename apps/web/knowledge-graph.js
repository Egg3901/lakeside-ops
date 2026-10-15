// knowledge-graph.js — visual node-link map of the knowledge web.
// Six node kinds clustered into labelled regions: the authored brain (docs /
// skills / memory) plus the feedback woven into it — player suggestions,
// support tickets, and extracted Discord themes — each linked to the knowledge
// it relates to. Edge layers: link ([[wiki-links]]), the three feedback layers,
// semantic (nearest by meaning), tag (shared tags). Self-contained canvas force
// layout — no external libs (CSP-safe). Mouse + touch (drag / pan / pinch).

// [key, color, Label, anchorX, anchorY]. First three are the authored brain;
// the rest are "feedback" kinds (carry a meta payload + an edge layer).
const KINDS = [
  ["docs", "#6c8cff", "Docs", 0.18, 0.5],
  ["skills", "#f5a623", "Skills", 0.36, 0.16],
  ["memory", "#34d399", "Memory", 0.64, 0.16],
  ["suggestion", "#c77dff", "Suggestions", 0.82, 0.5],
  ["ticket", "#ff7a7a", "Tickets", 0.64, 0.86],
  ["theme", "#22d3ee", "Themes", 0.36, 0.86],
];
const FEEDBACK = ["suggestion", "ticket", "theme"];

const EXTRA_CSS = `
.kg-wrap{max-width:1200px;margin:0 auto;padding:var(--s-5,24px) var(--s-4,16px);display:flex;flex-direction:column;gap:14px}
.kg-head h1{font-size:1.4rem;font-weight:700;letter-spacing:-.02em;margin:0 0 4px;display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.kg-head p{color:var(--text-3,#888);font-size:.9rem;margin:0;max-width:720px}
.kg-toolbar{display:flex;gap:7px;flex-wrap:wrap;align-items:center}
.kg-toggle{padding:.35rem .7rem;border-radius:999px;border:1px solid var(--border,#2a2a2a);background:transparent;color:var(--text-2,#bbb);font-size:.76rem;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;-webkit-tap-highlight-color:transparent}
.kg-toggle.on{background:var(--glass-2,#222);color:var(--text,#eee)}
.kg-toggle .dot{width:9px;height:9px;border-radius:50%}
.kg-stat{font-size:.74rem;color:var(--text-3,#888);margin-left:auto}
.kg-stage{position:relative;border:1px solid var(--border,#2a2a2a);border-radius:14px;overflow:hidden;background:radial-gradient(circle at 50% 40%,color-mix(in srgb,var(--accent) 4%,var(--bg-1,#161616)),var(--bg-0,#0e0e0e));touch-action:none}
.kg-stage canvas{display:block;width:100%;height:66vh;cursor:grab;touch-action:none}
.kg-stage canvas:active{cursor:grabbing}
.kg-hint{position:absolute;left:12px;bottom:10px;font-size:.7rem;color:var(--text-3,#777);pointer-events:none}
.kg-panel{position:absolute;top:12px;right:12px;width:320px;max-width:calc(100% - 24px);max-height:calc(100% - 24px);overflow:auto;background:color-mix(in srgb,var(--bg-1,#161616) 95%,transparent);border:1px solid var(--border,#2a2a2a);border-radius:12px;padding:14px 16px;display:none;backdrop-filter:blur(4px)}
.kg-panel.on{display:block}
.kg-panel h3{margin:0 6px 2px 0;font-size:1rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kg-kindb{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:1px 7px;border-radius:999px;border:1px solid currentColor}
.kg-panel .kg-desc{font-size:.82rem;color:var(--text-2,#bbb);margin:6px 0}
.kg-panel .kg-body{font-size:.8rem;line-height:1.5;color:var(--text-2,#ccc);white-space:pre-wrap;max-height:34vh;overflow:auto;margin-top:8px;border-top:1px solid color-mix(in srgb,var(--border) 55%,transparent);padding-top:8px}
.kg-panel .kg-nb{font-size:.74rem;color:var(--text-3,#888);margin-top:8px}
.kg-panel .kg-nb b{color:var(--text-2,#bbb)}
.kg-panel .kg-x{position:absolute;top:8px;right:12px;cursor:pointer;color:var(--text-3);font-size:1.3rem;line-height:1;border:none;background:none}
.kg-tip{position:absolute;pointer-events:none;background:var(--bg-0,#0e0e0e);border:1px solid var(--border,#2a2a2a);border-radius:7px;padding:3px 8px;font-size:.74rem;color:var(--text,#eee);display:none;white-space:nowrap;z-index:5;max-width:60%;overflow:hidden;text-overflow:ellipsis}
.kg-dangling{font-size:.8rem;color:var(--text-3,#888)}
.kg-dangling b{color:var(--text-2,#bbb)}.kg-dangling code{background:var(--bg-0,#0e0e0e);padding:.05em .35em;border-radius:4px;font-size:.9em}
@media (max-width:640px){
  .kg-stage canvas{height:56vh}
  .kg-panel{top:auto;bottom:8px;left:8px;right:8px;width:auto;max-width:none;max-height:48%}
  .kg-hint{display:none}
  .kg-stat{margin-left:0;flex-basis:100%;order:9}
}
`;

function makeKnowledgeGraphBody() {
  const kindToggles = KINDS.map(([k, c, l]) =>
    `<button class="kg-toggle on" data-kind="${k}"><span class="dot" style="background:${c}"></span>${l}</button>`).join("");

  const body = `
<div class="kg-wrap">
  <div class="kg-head">
    <h1>Knowledge graph <a href="/knowledge" style="font-size:.8rem;font-weight:600;color:var(--accent,#6c8cff);text-decoration:none">← list view</a></h1>
    <p>The whole brain in one web — <b style="color:#6c8cff">Docs</b>, <b style="color:#f5a623">Skills</b>, <b style="color:#34d399">Memories</b>, and the community feedback woven in: player <b style="color:#c77dff">Suggestions</b>, support <b style="color:#ff7a7a">Tickets</b>, and Discord <b style="color:#22d3ee">Themes</b> — each linked to the knowledge it touches.</p>
  </div>
  <div class="kg-toolbar">
    ${kindToggles}
    <button class="kg-toggle" id="kg-sem"><span class="dot" style="background:#7ad3b0"></span>Semantic</button>
    <button class="kg-toggle" id="kg-tags"><span class="dot" style="background:#888"></span>Tag links</button>
    <button class="kg-toggle" id="kg-fit">⤢ Fit</button>
    <button class="kg-toggle" id="kg-relayout">↻ Re-layout</button>
    <span class="kg-stat" id="kg-stat">loading…</span>
  </div>
  <div class="kg-stage">
    <canvas id="kg-canvas"></canvas>
    <div class="kg-tip" id="kg-tip"></div>
    <div class="kg-hint">drag node · drag background to pan · scroll / pinch to zoom · Fit to reframe</div>
    <div class="kg-panel" id="kg-panel">
      <button class="kg-x" id="kg-panel-x">×</button>
      <h3><span class="kg-kindb" id="kg-p-kind"></span><span id="kg-p-title"></span></h3>
      <div class="kg-desc" id="kg-p-desc"></div>
      <div class="kg-nb" id="kg-p-nb"></div>
      <div class="kg-body" id="kg-p-body"></div>
    </div>
  </div>
  <div class="kg-dangling" id="kg-dangling"></div>
</div>

<script>
(function(){
  var KINDS=${JSON.stringify(KINDS)}, FEEDBACK=${JSON.stringify(FEEDBACK)};
  var K={},LBL={},ANCH={};KINDS.forEach(function(x){K[x[0]]=x[1];LBL[x[0]]=x[2];ANCH[x[0]]=[x[3],x[4]];});
  var canvas=document.getElementById('kg-canvas'),ctx=canvas.getContext('2d');
  var tip=document.getElementById('kg-tip'),panel=document.getElementById('kg-panel');
  // edge layers: link (knowledge structure) · one per feedback kind · sem · tag
  var nodes=[],L={link:[],sem:[],tag:[],suggestion:[],ticket:[],theme:[]};
  var STYLE={link:['rgba(150,160,200,0.22)',null],suggestion:['rgba(199,125,255,0.20)',null],ticket:['rgba(255,122,122,0.20)',null],theme:['rgba(34,211,238,0.18)',null],sem:['rgba(122,211,176,0.13)',[3,3]],tag:['rgba(150,150,150,0.08)',[2,4]]};
  var show={sem:false,tag:false};KINDS.forEach(function(x){show[x[0]]=true;});
  var view={x:0,y:0,z:1},dragNode=null,panning=false,last={x:0,y:0},hover=null,moved=false,pinch=null,anchors={},fitted=false;
  var W=1,H=1,alpha=1,raf=null;
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
  function computeAnchors(){anchors={};KINDS.forEach(function(x){anchors[x[0]]={x:W*x[3],y:H*x[4]};});}
  function resize(){var r=canvas.getBoundingClientRect();W=canvas.width=Math.max(300,r.width|0);H=canvas.height=Math.max(280,r.height|0);computeAnchors();}
  window.addEventListener('resize',function(){resize();fit();});

  fetch('/api/knowledge/graph').then(function(r){return r.json();}).then(function(d){
    resize();
    var idx={};
    nodes=(d.nodes||[]).map(function(n,i){idx[n.id]=i;var a=anchors[n.kind]||{x:W/2,y:H/2};return {id:n.id,kind:n.kind,title:n.title||n.id,hits:n.hits||0,deg:n.deg||0,meta:n.meta||null,
      x:a.x+Math.cos(i*2.399)*70,y:a.y+Math.sin(i*2.399)*70,vx:0,vy:0,fixed:false,hub:false};});
    function map(arr){return (arr||[]).map(function(e){return [idx[e.s],idx[e.t]];}).filter(function(e){return e[0]!=null&&e[1]!=null;});}
    L.link=map(d.linkEdges);L.sem=map(d.semanticEdges);L.tag=map(d.tagEdges);
    L.suggestion=map(d.sugEdges);L.ticket=map(d.ticketEdges);L.theme=map(d.themeEdges);
    nodes.slice().sort(function(a,b){return b.deg-a.deg;}).slice(0,14).forEach(function(n){n.hub=true;});
    function cnt(k){return nodes.filter(function(n){return n.kind===k;}).length;}
    document.getElementById('kg-stat').textContent=nodes.length+' nodes · '+cnt('suggestion')+' sug · '+cnt('ticket')+' tkt · '+cnt('theme')+' themes';
    var dl=d.danglingTop||[];
    if(dl.length)document.getElementById('kg-dangling').innerHTML='<b>'+d.danglingCount+' dangling links</b> — most-referenced unwritten entries (worth creating): '+dl.map(function(x){return '<code>'+esc(x.name)+'</code> ×'+x.count;}).join('  ');
    fitted=false;alpha=1;run();
  }).catch(function(){document.getElementById('kg-stat').textContent='failed to load graph';});

  function visible(n){return show[n.kind];}
  function shownLayers(){var a=[['link',L.link]];FEEDBACK.forEach(function(k){if(show[k])a.push([k,L[k]]);});if(show.sem)a.push(['sem',L.sem]);if(show.tag)a.push(['tag',L.tag]);return a;}

  function tick(){
    var i,j,n,m,dx,dy,d2,f,inv;
    for(i=0;i<nodes.length;i++){n=nodes[i];if(!visible(n))continue;
      for(j=i+1;j<nodes.length;j++){m=nodes[j];if(!visible(m))continue;
        dx=n.x-m.x;dy=n.y-m.y;d2=dx*dx+dy*dy+0.01;
        if(d2<160000){f=2200/d2;inv=1/Math.sqrt(d2);n.vx+=dx*inv*f;n.vy+=dy*inv*f;m.vx-=dx*inv*f;m.vy-=dy*inv*f;}
      }
    }
    springs(L.link,90,0.022);
    FEEDBACK.forEach(function(k){if(show[k])springs(L[k],150,0.005);});
    if(show.sem)springs(L.sem,150,0.004);
    for(i=0;i<nodes.length;i++){n=nodes[i];if(!visible(n))continue;
      var an=anchors[n.kind]||{x:W/2,y:H/2};n.vx+=(an.x-n.x)*0.009;n.vy+=(an.y-n.y)*0.009;
      if(n===dragNode||n.fixed){n.vx=n.vy=0;continue;}
      n.vx*=0.86;n.vy*=0.86;n.x+=n.vx*alpha;n.y+=n.vy*alpha;
    }
    alpha*=0.986;
  }
  function springs(E,rest,k){for(var i=0;i<E.length;i++){var n=nodes[E[i][0]],m=nodes[E[i][1]];if(!n||!m||!visible(n)||!visible(m))continue;
    var dx=m.x-n.x,dy=m.y-n.y,d=Math.sqrt(dx*dx+dy*dy)+0.01,f=(d-rest)*k;n.vx+=dx/d*f;n.vy+=dy/d*f;m.vx-=dx/d*f;m.vy-=dy/d*f;}}

  function radius(n){return 3.5+Math.min(11,n.deg*1.3)+Math.min(4,n.hits*0.3);}
  function toScreen(n){return {x:n.x*view.z+view.x,y:n.y*view.z+view.y};}
  function fromScreen(px,py){return {x:(px-view.x)/view.z,y:(py-view.y)/view.z};}

  function groupLabels(){
    KINDS.forEach(function(x){var k=x[0];if(!show[k])return;var sx=0,sy=0,c=0;
      for(var i=0;i<nodes.length;i++){var n=nodes[i];if(n.kind!==k)continue;sx+=n.x;sy+=n.y;c++;}
      if(!c)return;var s=toScreen({x:sx/c,y:sy/c});
      ctx.save();ctx.textAlign='center';ctx.font='700 '+Math.round(21*Math.max(0.55,Math.min(1.7,view.z)))+'px system-ui';
      ctx.fillStyle=K[k];ctx.globalAlpha=0.15;ctx.fillText(LBL[k].toUpperCase()+'  ·  '+c,s.x,s.y);ctx.restore();
    });
  }
  function draw(){
    ctx.clearRect(0,0,W,H);
    groupLabels();
    var order=[];if(show.tag)order.push('tag');if(show.sem)order.push('sem');FEEDBACK.forEach(function(k){if(show[k])order.push(k);});order.push('link');
    ctx.lineWidth=1;
    order.forEach(function(key){var E=L[key],st=STYLE[key];ctx.strokeStyle=st[0];ctx.setLineDash(st[1]||[]);
      for(var i=0;i<E.length;i++){var a=nodes[E[i][0]],b=nodes[E[i][1]];if(!a||!b||!visible(a)||!visible(b))continue;var sa=toScreen(a),sb=toScreen(b);ctx.beginPath();ctx.moveTo(sa.x,sa.y);ctx.lineTo(sb.x,sb.y);ctx.stroke();}
    });
    ctx.setLineDash([]);
    for(var i=0;i<nodes.length;i++){var n=nodes[i];if(!visible(n))continue;var s=toScreen(n),r=radius(n)*Math.sqrt(view.z);
      ctx.beginPath();ctx.arc(s.x,s.y,r,0,6.2832);
      ctx.fillStyle=K[n.kind]||'#999';ctx.globalAlpha=(hover&&hover!==n&&!isNeighbor(hover,n))?0.28:1;ctx.fill();
      if(hover===n){ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();}
      ctx.globalAlpha=1;
      if(hover===n||n.hub||view.z>2.4){ctx.fillStyle='rgba(233,233,238,'+(hover===n?1:0.7)+')';ctx.font=(hover===n?'600 ':'')+'11px system-ui';ctx.fillText(n.title.slice(0,28),s.x+r+3,s.y+3);}
    }
  }
  function isNeighbor(a,b){var Ls=shownLayers();for(var l=0;l<Ls.length;l++){var E=Ls[l][1];for(var i=0;i<E.length;i++){if((nodes[E[i][0]]===a&&nodes[E[i][1]]===b)||(nodes[E[i][1]]===a&&nodes[E[i][0]]===b))return true;}}return false;}
  function run(){if(raf)cancelAnimationFrame(raf);(function loop(){tick();if(!fitted&&alpha<0.12){fitted=true;fit();}draw();if(alpha>0.03)raf=requestAnimationFrame(loop);})();}

  function fit(){var xs=[],ys=[];for(var i=0;i<nodes.length;i++){var n=nodes[i];if(visible(n)){xs.push(n.x);ys.push(n.y);}}if(!xs.length)return;
    var minx=Math.min.apply(null,xs),maxx=Math.max.apply(null,xs),miny=Math.min.apply(null,ys),maxy=Math.max.apply(null,ys);
    var pad=70,z=Math.min(W/(maxx-minx+pad*2),H/(maxy-miny+pad*2));z=Math.max(0.05,Math.min(2.2,z));
    view.z=z;view.x=W/2-((minx+maxx)/2)*z;view.y=H/2-((miny+maxy)/2)*z;draw();}

  function nodeAt(px,py){var p=fromScreen(px,py),best=null,bd=1e9;for(var i=0;i<nodes.length;i++){var n=nodes[i];if(!visible(n))continue;var dx=n.x-p.x,dy=n.y-p.y,dd=dx*dx+dy*dy,rr=radius(n)+8;if(dd<rr*rr&&dd<bd){bd=dd;best=n;}}return best;}
  function down(px,py){moved=false;last={x:px,y:py};var n=nodeAt(px,py);if(n){dragNode=n;n.fixed=true;}else{panning=true;}}
  function move(px,py){
    if(dragNode){var w=fromScreen(px,py);dragNode.x=w.x;dragNode.y=w.y;moved=true;alpha=Math.max(alpha,0.3);if(alpha<=0.031)run();}
    else if(panning){view.x+=px-last.x;view.y+=py-last.y;last={x:px,y:py};moved=true;draw();}
    else{var n=nodeAt(px,py);hover=n;if(n){tip.style.display='block';tip.style.left=(px+12)+'px';tip.style.top=(py+8)+'px';tip.textContent=n.title;}else{tip.style.display='none';}if(alpha<=0.031)draw();}
  }
  function up(){if(dragNode&&!moved)openNode(dragNode);if(dragNode)dragNode.fixed=false;dragNode=null;panning=false;}
  function zoomAt(px,py,f){var w=fromScreen(px,py);view.z=Math.max(0.05,Math.min(6,view.z*f));view.x=px-w.x*view.z;view.y=py-w.y*view.z;draw();}
  function rel(cx,cy){var r=canvas.getBoundingClientRect();return {x:cx-r.left,y:cy-r.top};}

  canvas.addEventListener('mousedown',function(ev){var p=rel(ev.clientX,ev.clientY);down(p.x,p.y);});
  window.addEventListener('mousemove',function(ev){var p=rel(ev.clientX,ev.clientY);move(p.x,p.y);});
  window.addEventListener('mouseup',up);
  canvas.addEventListener('wheel',function(ev){ev.preventDefault();var p=rel(ev.clientX,ev.clientY);zoomAt(p.x,p.y,ev.deltaY<0?1.12:0.893);},{passive:false});
  canvas.addEventListener('touchstart',function(ev){ev.preventDefault();if(ev.touches.length===1){var p=rel(ev.touches[0].clientX,ev.touches[0].clientY);down(p.x,p.y);}else if(ev.touches.length===2){dragNode=null;panning=false;pinch=touchDist(ev);}},{passive:false});
  canvas.addEventListener('touchmove',function(ev){ev.preventDefault();if(ev.touches.length===1&&!pinch){var p=rel(ev.touches[0].clientX,ev.touches[0].clientY);move(p.x,p.y);}else if(ev.touches.length===2){var d=touchDist(ev);if(pinch&&pinch.dist>0)zoomAt(d.cx,d.cy,d.dist/pinch.dist);pinch=d;}},{passive:false});
  canvas.addEventListener('touchend',function(ev){ev.preventDefault();if(ev.touches.length===0){pinch=null;up();}},{passive:false});
  function touchDist(ev){var a=ev.touches[0],b=ev.touches[1],r=canvas.getBoundingClientRect();var dx=a.clientX-b.clientX,dy=a.clientY-b.clientY;return {dist:Math.sqrt(dx*dx+dy*dy),cx:(a.clientX+b.clientX)/2-r.left,cy:(a.clientY+b.clientY)/2-r.top};}

  document.querySelectorAll('.kg-toggle[data-kind]').forEach(function(t){t.onclick=function(){var k=t.getAttribute('data-kind');show[k]=!show[k];t.classList.toggle('on',show[k]);alpha=Math.max(alpha,0.2);fitted=false;run();};});
  document.getElementById('kg-sem').onclick=function(){show.sem=!show.sem;this.classList.toggle('on',show.sem);alpha=Math.max(alpha,0.3);run();};
  document.getElementById('kg-tags').onclick=function(){show.tag=!show.tag;this.classList.toggle('on',show.tag);draw();};
  document.getElementById('kg-fit').onclick=function(){fit();};
  document.getElementById('kg-relayout').onclick=function(){computeAnchors();nodes.forEach(function(n,i){var a=anchors[n.kind]||{x:W/2,y:H/2};n.x=a.x+Math.cos(i*2.399)*70;n.y=a.y+Math.sin(i*2.399)*70;n.vx=n.vy=0;n.fixed=false;});fitted=false;alpha=1;run();};
  document.getElementById('kg-panel-x').onclick=function(){panel.classList.remove('on');};

  function openNode(n){
    panel.classList.add('on');
    var kb=document.getElementById('kg-p-kind');kb.textContent=n.kind;kb.style.color=K[n.kind]||'#999';
    document.getElementById('kg-p-title').textContent=' '+n.title;
    document.getElementById('kg-p-desc').innerHTML='';document.getElementById('kg-p-nb').innerHTML='';
    document.getElementById('kg-p-body').textContent='';
    if(FEEDBACK.indexOf(n.kind)>=0 && n.meta){
      var g=n.meta,bits=[];
      if(g.number!=null)bits.push('#'+g.number);
      ['sentiment','gameSystem','status','prevalence','category'].forEach(function(f){if(g[f])bits.push(g[f]);});
      document.getElementById('kg-p-desc').textContent=bits.join(' · ');
      document.getElementById('kg-p-body').innerHTML=esc(g.desc||'(no description)')+(g.href?'<br><br><a href="'+g.href+'" style="color:var(--accent,#6c8cff)">open →</a>':'');
    } else {
      document.getElementById('kg-p-body').textContent='Loading…';
      fetch('/api/knowledge/entry?kind='+encodeURIComponent(n.kind)+'&name='+encodeURIComponent(n.id)).then(function(r){return r.json();}).then(function(d){
        var e=d.entry||{};document.getElementById('kg-p-desc').textContent=e.description||'';
        document.getElementById('kg-p-body').textContent=e.body||'(empty)';
      }).catch(function(){document.getElementById('kg-p-body').textContent='(failed to load)';});
    }
    var Ls=shownLayers(),outN=[],i,l;for(l=0;l<Ls.length;l++){var E=Ls[l][1];for(i=0;i<E.length;i++){var a=nodes[E[i][0]],b=nodes[E[i][1]];if(a===n)outN.push(b.title);else if(b===n)outN.push(a.title);}}
    if(outN.length)document.getElementById('kg-p-nb').innerHTML='<b>'+outN.length+' connected:</b> '+outN.slice(0,12).map(esc).join(', ')+(outN.length>12?'…':'');
  }
})();
</script>
`;
  return { extraCss: EXTRA_CSS, body };
}

module.exports = { makeKnowledgeGraphBody };
