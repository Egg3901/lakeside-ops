// community-voice-page.js — Markov mimicry + word cloud over the Discord corpus
// Returns { extraCss, body } for renderShell().

const { icon } = require("./ui-kit");

const VOICE_CSS = `
.cv-wrap{max-width:960px;margin:0 auto;padding:var(--s-5,24px) var(--s-4,16px);display:flex;flex-direction:column;gap:18px}
.cv-head h1{font-size:1.45rem;font-weight:700;letter-spacing:-.02em;margin:0 0 6px}
.cv-head p{color:var(--text-3);font-size:.9rem;margin:0;max-width:640px}
.cv-panels{display:grid;grid-template-columns:1fr;gap:18px}
@media(min-width:860px){.cv-panels{grid-template-columns:1.1fr .9fr}}
.cv-panel{border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.cv-panel h2{font-size:1.05rem;font-weight:700;margin:0;display:flex;align-items:center;gap:8px}
.cv-panel h2 .icon{color:var(--accent)}
.cv-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.cv-controls select,.cv-controls input{flex:1;min-width:140px}
.cv-out{min-height:120px;border:1px dashed var(--border);border-radius:10px;padding:12px 14px;background:var(--glass-1);color:var(--text);font-size:.95rem;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.cv-out em{color:var(--text-3);font-style:italic}
.cv-actions{display:flex;gap:8px;flex-wrap:wrap}
.cv-meta{font-size:.75rem;color:var(--text-3)}
.cv-wc-wrap{position:relative;height:340px;border:1px solid var(--border);border-radius:10px;background:var(--glass-1);overflow:hidden}
#cv-wc-canvas{width:100%;height:100%;display:block}
.cv-wc-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:.9rem;text-align:center;padding:20px}
.cv-legend{display:flex;flex-wrap:wrap;gap:8px;font-size:.75rem;color:var(--text-3)}
.cv-legend span{display:inline-flex;align-items:center;gap:4px}
.cv-dot{width:10px;height:10px;border-radius:50%;background:var(--accent)}
.cv-chips{display:flex;flex-wrap:wrap;gap:6px}
.cv-chip{font-size:.75rem;padding:.28rem .55rem;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text-2);cursor:pointer;transition:all var(--t)}
.cv-chip:hover{border-color:var(--accent);color:var(--text)}
.cv-chip.on{background:var(--accent-soft);border-color:var(--accent);color:var(--text)}
.cv-tip{font-size:.78rem;color:var(--text-3);margin-top:4px}
.cv-count{font-variant-numeric:tabular-nums;font-weight:600;color:var(--accent)}
`;

function makeVoiceBody({ authors = [], channels = [], total = 0 } = {}) {
  const authorOptions = authors.map((a) => `<option value="${esc(a.name)}" data-count="${a.count}">${esc(a.name)} (${a.count})</option>`).join('');
  const channelOptions = `<option value="">All channels</option>` + channels.map((c) => `<option value="${esc(c.name)}">${esc(c.name)} (${c.count})</option>`).join('');
  const topAuthorChips = authors.slice(0, 10).map((a) => `<button type="button" class="cv-chip" data-author="${esc(a.name)}">${esc(a.name)}</button>`).join('');

  const body = `
<div class="cv-wrap">
  <div class="cv-head">
    <h1>🗣️ Community Voice</h1>
    <p>Markov-chain mimicry and word clouds from the Discord corpus. Pick a user and let the machine speak in their voice, or explore what the server talks about most. <span class="cv-count">${total.toLocaleString()}</span> messages indexed.</p>
  </div>
  <div class="cv-panels">
    <div class="cv-panel">
      <h2>${icon('message-square', { size: 18 })} Markov Mimic</h2>
      <div class="cv-controls">
        <select id="cv-author" class="field"><option value="">Select a user…</option>${authorOptions}</select>
        <input id="cv-seed" class="field" type="text" placeholder="Seed word (optional)">
      </div>
      <div class="cv-chips">${topAuthorChips}</div>
      <div class="cv-out" id="cv-markov"><em>Select a user and hit Generate.</em></div>
      <div class="cv-actions">
        <button id="cv-gen" class="btn">Generate</button>
        <button id="cv-more" class="btn btn-ghost" disabled>More</button>
      </div>
      <div class="cv-meta" id="cv-meta"></div>
    </div>
    <div class="cv-panel">
      <h2>${icon('cloud', { size: 18 })} Word Cloud</h2>
      <div class="cv-controls">
        <select id="cv-wc-channel" class="field">${channelOptions}</select>
        <select id="cv-wc-author" class="field"><option value="">All users</option>${authorOptions}</select>
      </div>
      <div class="cv-wc-wrap"><canvas id="cv-wc-canvas"></canvas><div class="cv-wc-empty" id="cv-wc-empty">Loading…</div></div>
      <div class="cv-tip">Filter by channel or author; top 60 words drawn by frequency. Excludes common stop words and short tokens.</div>
    </div>
  </div>
</div>
<script>
(function(){
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
  var authorSel=document.getElementById('cv-author'), seedIn=document.getElementById('cv-seed'), out=document.getElementById('cv-markov'), meta=document.getElementById('cv-meta'), gen=document.getElementById('cv-gen'), more=document.getElementById('cv-more');
  var lastAuthor='', lastSeed='';
  function generate(){
    var a=authorSel.value, seed=seedIn.value.trim();
    function setHtml(el,html){if(!el)return;if(window.OpsDom&&OpsDom.setTrustedHtml)OpsDom.setTrustedHtml(el,html);}
  if(!a){setHtml(out,'<em>Select a user first.</em>');return;}
    out.textContent='Generating…'; gen.disabled=true; more.disabled=true;
    fetch('/api/community-voice/markov?author='+encodeURIComponent(a)+'&seed='+encodeURIComponent(seed)+'&n=5').then(function(r){return r.json();}).then(function(d){
      gen.disabled=false; more.disabled=false; lastAuthor=a; lastSeed=seed;
      if(d.error){out.textContent='Error: '+d.error; return;}
      setHtml(out,(d.sentences||[]).map(function(s){return '<p>'+esc(s)+'</p>';}).join(''));
      meta.textContent='model: order-2 · '+d.tokens.toLocaleString()+' tokens · '+d.messages.toLocaleString()+' messages';
    }).catch(function(){gen.disabled=false; out.textContent='Failed.';});
  }
  gen.onclick=generate;
  more.onclick=function(){if(lastAuthor)fetch('/api/community-voice/markov?author='+encodeURIComponent(lastAuthor)+'&seed='+encodeURIComponent(lastSeed)+'&n=5').then(function(r){return r.json();}).then(function(d){if(!d.error)setHtml(out,(out.innerHTML||'')+(d.sentences||[]).map(function(s){return '<p>'+esc(s)+'</p>';}).join(''));});};
  document.querySelectorAll('.cv-chip').forEach(function(b){b.onclick=function(){authorSel.value=b.getAttribute('data-author'); document.querySelectorAll('.cv-chip').forEach(function(x){x.classList.remove('on');}); b.classList.add('on'); generate();};});
  seedIn.addEventListener('keydown',function(e){if(e.key==='Enter')generate();});

  // Word cloud
  var wcC=document.getElementById('cv-wc-canvas'), wcE=document.getElementById('cv-wc-empty'), chSel=document.getElementById('cv-wc-channel'), auSel=document.getElementById('cv-wc-author');
  function resize(){var r=wcC.parentElement.getBoundingClientRect(); wcC.width=Math.floor(r.width); wcC.height=Math.floor(r.height);}
  function loadCloud(){
    wcE.textContent='Loading…'; wcE.style.display='flex';
    var url='/api/community-voice/wordcloud?channel='+encodeURIComponent(chSel.value)+'&author='+encodeURIComponent(auSel.value);
    fetch(url).then(function(r){return r.json();}).then(function(d){
      if(d.error){wcE.textContent='Error: '+d.error; return;}
      if(!d.words||!d.words.length){wcE.textContent='No words match.'; return;}
      wcE.style.display='none';
      drawCloud(d.words);
    }).catch(function(){wcE.textContent='Failed.'; wcE.style.display='flex';});
  }
  var palette=['var(--accent)','var(--accent-2)','#8b8b96','#a8a8b3','#66aaff','#ff8c66','#66ffcc','#cc66ff'];
  function drawCloud(words){
    resize();
    var ctx=wcC.getContext('2d'), W=wcC.width, H=wcC.height;
    ctx.clearRect(0,0,W,H);
    var max=words[0].count, min=words[words.length-1].count, placed=[];
    function tryPlace(word, size, i){
      ctx.font=size+'px Inter, sans-serif';
      var w=ctx.measureText(word).width, h=size;
      for(var spiral=0; spiral<500; spiral++){
        var t=spiral*.25, r=(spiral*3.5)+Math.random()*20;
        var x=W/2 + Math.cos(t)*r - w/2, y=H/2 + Math.sin(t)*r*.55 + h/2;
        if(x<8||y<h+8||x+w>W-8||y>H-8) continue;
        var ok=true;
        for(var k=0;k<placed.length;k++){
          var p=placed[k];
          if(!(x+w < p.x || p.x+p.w < x || y < p.y-p.h || p.y < y-h)) { ok=false; break; }
        }
        if(ok){placed.push({x,y,w,h}); ctx.fillStyle=palette[i%palette.length]; ctx.fillText(word,x,y); return true;}
      }
      return false;
    }
    words.forEach(function(w,i){
      var size=12 + Math.pow((w.count-min)/(max-min||1),.55) * 34;
      tryPlace(w.word, size, i);
    });
  }
  window.addEventListener('resize',function(){if(wcE.style.display==='none')loadCloud();});
  chSel.onchange=auSel.onchange=loadCloud;
  loadCloud();
})();
</script>
`;
  return { extraCss: VOICE_CSS, body };
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = { makeVoiceBody };
