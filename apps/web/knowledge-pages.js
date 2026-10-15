// knowledge-pages.js — human-facing read views over the shared knowledge store
// (the "Docs", "Skills" and "Memories" apps on the ops dash). One parametrized
// renderer; the route layer picks the `kind`. Search + entry bodies are fetched
// from /api/knowledge/* (which runs semantic search via the dashboard's own
// bge-small pipeline). Returns { extraCss, body } for renderShell().

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function fmtDate(d) {
  if (!d) return "";
  try { return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return ""; }
}

const META = {
  docs: { title: "Docs", icon: "book-open", blurb: "Project documentation — searchable, agent-readable, persisted in the shared knowledge store." },
  skills: { title: "Skills", icon: "zap", blurb: "Reusable agent procedures. Curate these into sharper toolsets for cloud-code sessions." },
  memory: { title: "Memories", icon: "pin", blurb: "Facts agents persist across sessions — recalled by meaning via semantic search." },
};

const EXTRA_CSS = `
.kn-wrap{max-width:920px;margin:0 auto;padding:var(--s-5,24px) var(--s-4,16px);display:flex;flex-direction:column;gap:18px}
.kn-head h1{font-size:1.4rem;font-weight:700;letter-spacing:-.02em;margin:0 0 4px;display:flex;align-items:center;gap:9px}
.kn-head p{color:var(--text-3,#888);font-size:.9rem;margin:0;max-width:640px}
.kn-search{display:flex;gap:10px;align-items:center}
.kn-search input{flex:1;padding:.6rem .9rem;border-radius:11px;border:1px solid var(--border,#2a2a2a);background:var(--bg-1,#161616);color:var(--text,#eee);font-size:.9rem;font-family:inherit;outline:none}
.kn-search input:focus{border-color:var(--accent,#6c8cff)}
.kn-count{font-size:.75rem;color:var(--text-3,#888);white-space:nowrap}
.kn-list{display:flex;flex-direction:column;gap:10px}
.kn-item{border:1px solid var(--border,#2a2a2a);border-radius:13px;background:var(--bg-1,#161616);padding:14px 16px;cursor:pointer;transition:border-color var(--t,.15s)}
.kn-item:hover{border-color:color-mix(in srgb,var(--accent) 40%,var(--border))}
.kn-item-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.kn-item-title{font-size:.95rem;font-weight:700;color:var(--text,#eee)}
.kn-item-meta{font-size:.72rem;color:var(--text-3,#888);white-space:nowrap}
.kn-item-desc{font-size:.83rem;color:var(--text-2,#bbb);margin-top:3px}
.kn-tags{margin-top:7px;display:flex;gap:5px;flex-wrap:wrap}
.kn-tag{font-size:.68rem;background:var(--glass-2,#222);color:var(--text-3,#999);padding:1px 7px;border-radius:999px}
.kn-score{font-size:.66rem;color:var(--accent,#6c8cff);font-weight:600}
.kn-body{margin-top:10px;padding-top:10px;border-top:1px solid color-mix(in srgb,var(--border) 55%,transparent);font-size:.85rem;line-height:1.55;color:var(--text-2,#ccc);white-space:pre-wrap;display:none}
.kn-item.open .kn-body{display:block}
.kn-empty{color:var(--text-3,#888);font-size:.88rem;padding:24px 4px;text-align:center}
.kn-chips{display:flex;gap:7px;flex-wrap:wrap}
.kn-chip{padding:.3rem .8rem;border-radius:999px;border:1px solid var(--border,#2a2a2a);background:transparent;color:var(--text-2,#bbb);font-size:.78rem;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px}
.kn-chip.on{background:var(--glass-2,#222);color:var(--text,#eee);border-color:color-mix(in srgb,var(--accent) 45%,var(--border))}
.kn-chip .n{font-size:.68rem;color:var(--text-3,#888)}
.kn-kind{font-size:.64rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:1px 7px;border-radius:999px;margin-right:7px;vertical-align:middle}
.kn-kind.docs{background:color-mix(in srgb,#6c8cff 20%,transparent);color:#8aa2ff}
.kn-kind.skills{background:color-mix(in srgb,#f5a623 22%,transparent);color:#f5a623}
.kn-kind.memory{background:color-mix(in srgb,#34d399 20%,transparent);color:#34d399}
`;

function itemHtml(e) {
  const tags = (e.tags || []).map((t) => `<span class="kn-tag">${esc(t)}</span>`).join("");
  const score = e.score != null ? `<span class="kn-score">${Math.min(100, Math.round(e.score * 100))}% match</span> · ` : "";
  return `<div class="kn-item" data-name="${esc(e.name)}">
    <div class="kn-item-top">
      <span class="kn-item-title">${esc(e.title || e.name)}</span>
      <span class="kn-item-meta">${score}${esc(fmtDate(e.updatedAt))}</span>
    </div>
    ${e.description ? `<div class="kn-item-desc">${esc(e.description)}</div>` : ""}
    ${tags ? `<div class="kn-tags">${tags}</div>` : ""}
    <div class="kn-body">${e.body ? esc(e.body) : '<em style="color:var(--text-3)">Loading…</em>'}</div>
  </div>`;
}

function makeKnowledgeBody({ kind, entries = [] } = {}) {
  const m = META[kind] || { title: kind, icon: "file", blurb: "" };
  const list = entries.length
    ? entries.map(itemHtml).join("")
    : `<div class="kn-empty">No ${esc(m.title.toLowerCase())} yet.</div>`;

  const body = `
<div class="kn-wrap">
  <div class="kn-head">
    <h1>${esc(m.title)}</h1>
    <p>${esc(m.blurb)}</p>
  </div>
  <div class="kn-search">
    <input type="text" id="kn-q" placeholder="Search ${esc(m.title.toLowerCase())} by meaning or keyword…" autocomplete="off">
    <span class="kn-count" id="kn-count">${entries.length} entr${entries.length === 1 ? "y" : "ies"}</span>
  </div>
  <div class="kn-list" id="kn-list">${list}</div>
</div>

<script>
(function(){
  var KIND=${JSON.stringify(kind)};
  var listEl=document.getElementById('kn-list');
  var countEl=document.getElementById('kn-count');
  var qEl=document.getElementById('kn-q');
  var bodies={}; // name -> loaded body
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}

  function render(items, scored){
    if(!items.length){ listEl.innerHTML='<div class="kn-empty">No matches.</div>'; countEl.textContent='0 results'; return; }
    listEl.innerHTML=items.map(function(e){
      var tags=(e.tags||[]).map(function(t){return '<span class="kn-tag">'+esc(t)+'</span>';}).join('');
      var score=(scored&&e.score!=null)?'<span class="kn-score">'+Math.min(100,Math.round(e.score*100))+'% match</span> · ':'';
      var d=e.updatedAt?new Date(e.updatedAt).toLocaleDateString():'';
      return '<div class="kn-item" data-name="'+esc(e.name)+'">'+
        '<div class="kn-item-top"><span class="kn-item-title">'+esc(e.title||e.name)+'</span>'+
        '<span class="kn-item-meta">'+score+esc(d)+'</span></div>'+
        (e.description?'<div class="kn-item-desc">'+esc(e.description)+'</div>':'')+
        (tags?'<div class="kn-tags">'+tags+'</div>':'')+
        '<div class="kn-body">'+(e.body!=null?esc(e.body):'<em style="color:var(--text-3)">Loading…</em>')+'</div></div>';
    }).join('');
    countEl.textContent=(scored?items.length+' result'+(items.length!==1?'s':''):items.length+' entr'+(items.length===1?'y':'ies'));
    wire();
  }

  function wire(){
    listEl.querySelectorAll('.kn-item').forEach(function(it){
      it.onclick=function(){
        it.classList.toggle('open');
        var name=it.getAttribute('data-name');
        var bodyEl=it.querySelector('.kn-body');
        if(it.classList.contains('open') && bodyEl && bodyEl.textContent==='Loading…'){
          fetch('/api/knowledge/entry?kind='+encodeURIComponent(KIND)+'&name='+encodeURIComponent(name))
            .then(function(r){return r.json();}).then(function(d){ bodyEl.textContent=(d.entry&&d.entry.body)||'(empty)'; });
        }
      };
    });
  }
  wire();

  var t=null;
  qEl.addEventListener('input',function(){
    clearTimeout(t);
    var q=qEl.value.trim();
    t=setTimeout(function(){
      if(!q){ location.reload(); return; }
      fetch('/api/knowledge/search?kind='+encodeURIComponent(KIND)+'&q='+encodeURIComponent(q))
        .then(function(r){return r.json();}).then(function(d){ render(d.results||[], true); })
        .catch(function(){});
    },280);
  });
})();
</script>
`;
  return { extraCss: EXTRA_CSS, body };
}

// Unified "Knowledge" homepage — docs + skills + memory in one searchable view.
function makeKnowledgeHome({ counts = {}, entries = [] } = {}) {
  const total = (counts.docs || 0) + (counts.skills || 0) + (counts.memory || 0);
  const chip = (k, label) =>
    `<button class="kn-chip${k === "all" ? " on" : ""}" data-kind="${k}">${label} <span class="n">${k === "all" ? total : counts[k] || 0}</span></button>`;

  const body = `
<div class="kn-wrap">
  <div class="kn-head">
    <h1>Knowledge <a href="/knowledge/graph" style="font-size:.8rem;font-weight:600;color:var(--accent,#6c8cff);text-decoration:none;margin-left:8px">◉ Graph view →</a></h1>
    <p>The shared brain — documentation, agent skills and durable memories in one place. Semantic + keyword search across all three; what any agent saves, every agent (and you) can find.</p>
  </div>
  <div class="kn-search">
    <input type="text" id="kn-q" placeholder="Search everything by meaning or keyword…" autocomplete="off">
    <span class="kn-count" id="kn-count">${total} entr${total === 1 ? "y" : "ies"}</span>
  </div>
  <div class="kn-chips">
    ${chip("all", "All")}${chip("docs", "Docs")}${chip("skills", "Skills")}${chip("memory", "Memories")}
  </div>
  <div class="kn-list" id="kn-list"></div>
</div>

<script>
(function(){
  var ALL=${JSON.stringify(entries)};
  var activeKind='all';
  var listEl=document.getElementById('kn-list');
  var countEl=document.getElementById('kn-count');
  var qEl=document.getElementById('kn-q');
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}

  function render(items, scored){
    if(!items.length){ listEl.innerHTML='<div class="kn-empty">No matches.</div>'; countEl.textContent=(scored?'0 results':'0 entries'); return; }
    listEl.innerHTML=items.map(function(e){
      var tags=(e.tags||[]).map(function(t){return '<span class="kn-tag">'+esc(t)+'</span>';}).join('');
      var score=(scored&&e.score!=null)?'<span class="kn-score">'+Math.min(100,Math.round(e.score*100))+'% match</span> · ':'';
      var d=e.updatedAt?new Date(e.updatedAt).toLocaleDateString():'';
      return '<div class="kn-item" data-name="'+esc(e.name)+'" data-kind="'+esc(e.kind)+'">'+
        '<div class="kn-item-top"><span class="kn-item-title"><span class="kn-kind '+esc(e.kind)+'">'+esc(e.kind)+'</span>'+esc(e.title||e.name)+'</span>'+
        '<span class="kn-item-meta">'+score+esc(d)+'</span></div>'+
        (e.description?'<div class="kn-item-desc">'+esc(e.description)+'</div>':'')+
        (tags?'<div class="kn-tags">'+tags+'</div>':'')+
        '<div class="kn-body">'+(e.body!=null?esc(e.body):'<em style="color:var(--text-3)">Loading…</em>')+'</div></div>';
    }).join('');
    countEl.textContent=(scored?items.length+' result'+(items.length!==1?'s':''):items.length+' entr'+(items.length===1?'y':'ies'));
    wire();
  }
  function browse(){
    var items=(activeKind==='all')?ALL:ALL.filter(function(e){return e.kind===activeKind;});
    render(items, false);
  }
  function wire(){
    listEl.querySelectorAll('.kn-item').forEach(function(it){
      it.onclick=function(){
        it.classList.toggle('open');
        var name=it.getAttribute('data-name'), kind=it.getAttribute('data-kind');
        var bodyEl=it.querySelector('.kn-body');
        if(it.classList.contains('open') && bodyEl && bodyEl.textContent==='Loading…'){
          fetch('/api/knowledge/entry?kind='+encodeURIComponent(kind)+'&name='+encodeURIComponent(name))
            .then(function(r){return r.json();}).then(function(d){ bodyEl.textContent=(d.entry&&d.entry.body)||'(empty)'; });
        }
      };
    });
  }
  document.querySelectorAll('.kn-chip').forEach(function(c){
    c.onclick=function(){
      document.querySelectorAll('.kn-chip').forEach(function(x){x.classList.remove('on');});
      c.classList.add('on'); activeKind=c.getAttribute('data-kind');
      var q=qEl.value.trim();
      if(q) doSearch(q); else browse();
    };
  });
  function doSearch(q){
    var url='/api/knowledge/search?q='+encodeURIComponent(q)+(activeKind==='all'?'':'&kind='+encodeURIComponent(activeKind));
    fetch(url).then(function(r){return r.json();}).then(function(d){ render(d.results||[], true); }).catch(function(){});
  }
  var t=null;
  qEl.addEventListener('input',function(){
    clearTimeout(t); var q=qEl.value.trim();
    t=setTimeout(function(){ if(!q){ browse(); return; } doSearch(q); },280);
  });
  browse();
})();
</script>
`;
  return { extraCss: EXTRA_CSS, body };
}

module.exports = { makeKnowledgeBody, makeKnowledgeHome, KIND_META: META };
