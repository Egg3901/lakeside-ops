// ideas-page.js — semantic search over vectorized AHD Discord messages
// ("Ideas"). Card+search UI; results link straight back to Discord.
// Returns { extraCss, body } for renderShell().

const IDEAS_CSS = `
.id-wrap{max-width:880px;margin:0 auto;padding:var(--s-5,24px) var(--s-4,16px);display:flex;flex-direction:column;gap:16px}
.id-head h1{font-size:1.4rem;font-weight:700;letter-spacing:-.02em;margin:0 0 4px}
.id-head p{color:var(--text-3,#888);font-size:.9rem;margin:0;max-width:620px}
.id-search input{width:100%;padding:.65rem .95rem;border-radius:11px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:.95rem;outline:none}
.id-search input:focus{border-color:var(--accent)}
.id-count{font-size:.74rem;color:var(--text-3);margin-top:2px}
.id-list{display:flex;flex-direction:column;gap:9px}
.id-card{border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:12px 14px}
.id-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:5px}
.id-meta{font-size:.74rem;color:var(--text-3)}
.id-ch{color:var(--accent);font-weight:600}
.id-score{font-size:.68rem;color:var(--accent);font-weight:700}
.id-body{font-size:.9rem;line-height:1.55;color:var(--text);white-space:pre-wrap;word-break:break-word}
.id-open{font-size:.74rem;color:var(--text-3);text-decoration:none;margin-top:6px;display:inline-block}
.id-open:hover{color:var(--accent)}
.id-empty{color:var(--text-3);text-align:center;padding:40px 10px;font-size:.9rem}
.id-themes{display:flex;flex-wrap:wrap;gap:7px}
.id-theme{font-size:.78rem;padding:.32rem .7rem;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text-2);cursor:pointer;transition:border-color var(--t,.15s)}
.id-theme:hover{border-color:var(--accent);color:var(--text)}
.id-theme b{color:var(--text);font-weight:600}
.id-story{border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:2px 16px}
.id-story summary{cursor:pointer;font-weight:600;font-size:.92rem;padding:11px 0;list-style:none}
.id-story summary::-webkit-details-marker{display:none}
.id-story summary::before{content:"▸ ";color:var(--text-3)}
.id-story[open] summary::before{content:"▾ "}
.id-story-body{padding:2px 0 14px;font-size:.9rem;line-height:1.62;color:var(--text-2)}
.id-story-body h1{font-size:1.15rem;color:var(--text);margin:.4em 0 .3em}.id-story-body h2{font-size:1rem;color:var(--text);margin:1.1em 0 .3em}
.id-story-body ul{margin:.3em 0;padding-left:1.2em}.id-story-body strong{color:var(--text)}
.id-ask{display:flex;gap:8px}
.id-ask input{flex:1;padding:.7rem 1rem;border-radius:11px;border:1px solid color-mix(in srgb,var(--accent) 30%,var(--border));background:var(--surface);color:var(--text);font:inherit;font-size:.95rem;outline:none}
.id-ask input:focus{border-color:var(--accent)}
.id-ask button{padding:.7rem 1.3rem;border-radius:11px;border:none;background:var(--accent);color:var(--on-accent,#fff);font-weight:600;cursor:pointer;font-family:inherit}
.id-ask button:disabled{opacity:.6;cursor:default}
.id-answer{display:none}
.id-answer.on{display:block;border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));border-radius:12px;background:color-mix(in srgb,var(--accent) 6%,var(--surface));padding:14px 16px}
.id-answer .ans{font-size:.93rem;line-height:1.6;color:var(--text)}
.id-answer .ans strong{color:var(--text)}.id-answer .ans ul{margin:.3em 0;padding-left:1.2em}
.id-srcs{margin-top:11px;border-top:1px solid var(--border);padding-top:9px}
.id-srcs .sh{font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:5px}
.id-srcref{font-size:.78rem;color:var(--text-2);margin:3px 0;line-height:1.45}
.id-srcref a{color:var(--accent);text-decoration:none}
`;

function makeIdeasBody({ count = 0 } = {}) {
  const body = `
<div class="id-wrap">
  <div class="id-head">
    <h1>💡 Ideas</h1>
    <p>Semantic search across the community's Discord — ideas, suggestions, dev chat. Search by meaning, jump straight to the message. <strong id="id-total">${count}</strong> messages indexed.</p>
  </div>
  <div class="id-ask"><input id="id-ask-q" type="text" placeholder="🧠 Ask the community anything…  e.g. &quot;how do players feel about the reset?&quot;" autocomplete="off"><button id="id-ask-btn">Ask</button></div>
  <div class="id-answer" id="id-answer"></div>
  <div class="id-themes" id="id-themes"></div>
  <div class="id-search"><input id="id-q" type="text" placeholder="Or search individual messages by meaning…" autocomplete="off"></div>
  <div class="id-count" id="id-count"></div>
  <div class="id-list" id="id-list"><div class="id-empty">Search, or tap a theme above.</div></div>
  <details class="id-story" id="id-story-wrap"><summary>📖 Server storyboard</summary><div class="id-story-body" id="id-story">Loading…</div></details>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.0/marked.min.js"></script>
<script>
(function(){
  var q=document.getElementById('id-q'),listEl=document.getElementById('id-list'),countEl=document.getElementById('id-count');
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
  var t=null;
  function setHtml(el,html){if(!el)return;if(window.OpsDom&&OpsDom.setTrustedHtml)OpsDom.setTrustedHtml(el,html);}
  q.addEventListener('input',function(){clearTimeout(t);var v=q.value.trim();if(!v){setHtml(listEl,'<div class="id-empty">Start typing to search the idea-base.</div>');countEl.textContent='';return;}t=setTimeout(function(){run(v);},260);});
  function run(v){
    fetch('/api/ideas/search?q='+encodeURIComponent(v)).then(function(r){return r.json();}).then(function(d){
      var rows=d.results||[];
      countEl.textContent=rows.length?rows.length+' matches'+(d.semantic?' · semantic':' · keyword'):'';
      if(!rows.length){setHtml(listEl,'<div class="id-empty">No matching ideas.</div>');return;}
      setHtml(listEl,rows.map(function(r){
        var dt=r.ts?new Date(r.ts).toLocaleDateString():'';
        return '<div class="id-card"><div class="id-top"><span class="id-meta"><strong>'+esc(r.author||'?')+'</strong> · <span class="id-ch">#'+esc(r.channelName||'')+'</span> · '+esc(dt)+'</span><span class="id-score">'+Math.min(100,Math.round((r.score||0)*100))+'%</span></div>'+
          '<div class="id-body">'+esc(r.content||'')+'</div>'+
          (r.jumpLink?'<a class="id-open" href="'+esc(r.jumpLink)+'" target="_blank" rel="noopener">Open in Discord ↗</a>':'')+'</div>';
      }).join(''));
    }).catch(function(){setHtml(listEl,'<div class="id-empty">Search failed.</div>');});
  }
  // Ask the community (RAG)
  var askQ=document.getElementById('id-ask-q'),askBtn=document.getElementById('id-ask-btn'),ansEl=document.getElementById('id-answer');
  function doAsk(){
    var question=askQ.value.trim();if(!question)return;
    ansEl.className='id-answer on';setHtml(ansEl,'<div class="ans">Thinking…</div>');askBtn.disabled=true;
    fetch('/api/ideas/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:question})}).then(function(r){return r.json();}).then(function(d){
      askBtn.disabled=false;
      if(d.error){setHtml(ansEl,'<div class="ans">Error: '+esc(d.error)+'</div>');return;}
      var srcs=(d.sources||[]).map(function(s,i){return '<div class="id-srcref">['+(i+1)+'] <strong>'+esc(s.author||'?')+'</strong> in #'+esc(s.channelName||'')+': '+esc((s.content||'').slice(0,140))+' '+(s.jumpLink?'<a href="'+esc(s.jumpLink)+'" target="_blank" rel="noopener">↗</a>':'')+'</div>';}).join('');
      setHtml(ansEl,'<div class="ans">'+(window.marked?marked.parse(d.answer||''):esc(d.answer||''))+'</div>'+(srcs?'<div class="id-srcs"><div class="sh">Sources ('+(d.sources||[]).length+')</div>'+srcs+'</div>':''));
    }).catch(function(){askBtn.disabled=false;setHtml(ansEl,'<div class="ans">Ask failed.</div>');});
  }
  if(askBtn)askBtn.onclick=doAsk;
  if(askQ)askQ.addEventListener('keydown',function(e){if(e.key==='Enter')doAsk();});
  // storyboard + theme chips (precomputed digest)
  var tw=document.getElementById('id-themes'),sw=document.getElementById('id-story');
  fetch('/api/ideas/meta').then(function(r){return r.json();}).then(function(d){
    if(d.themes&&d.themes.length){
      setHtml(tw,d.themes.map(function(t){return '<button class="id-theme" data-q="'+esc(t.summary||t.title)+'" title="'+esc(t.summary||'')+'"><b>'+esc(t.title)+'</b></button>';}).join(''));
      tw.querySelectorAll('.id-theme').forEach(function(b){b.onclick=function(){q.value=b.getAttribute('data-q');q.dispatchEvent(new Event('input'));window.scrollTo(0,0);};});
    }
    if(sw)setHtml(sw,d.storyboard?(window.marked?marked.parse(d.storyboard):esc(d.storyboard)):'Not generated yet.');
  }).catch(function(){if(sw)sw.textContent='';});
})();
</script>
`;
  return { extraCss: IDEAS_CSS, body };
}

module.exports = { makeIdeasBody };
