"use strict";

// Keir conversation archive (/inbox).
//
// Left: every DM thread, newest first, with unread counts and claim state.
// Right: the conversation (both directions, screenshots inline), the reward
// claim card with Approve / Reject / Recheck, and a reply box that sends as
// Keir. Data comes from /api/keir/inbox/* (proxied to keir-inbox.service) and
// is re-polled every 15 seconds.
//
// Returns { extraCss, body } like every other page here.

const INBOX_CSS = `
.ib-wrap{max-width:1500px;margin:0 auto;padding:var(--s-5,24px) var(--s-4,16px);display:flex;flex-direction:column;gap:14px}
.ib-head{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:10px}
.ib-head h1{font-size:1.4rem;font-weight:700;letter-spacing:-.02em;margin:0}
.ib-sub{color:var(--text-3);font-size:.82rem}
.ib-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.ib-stat{border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:10px 13px}
.ib-stat .n{font-size:1.35rem;font-weight:700;font-variant-numeric:tabular-nums}
.ib-stat .l{color:var(--text-3);font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;font-weight:700}
.ib-stat.warn .n{color:var(--warn,#b07700)}
.ib-main{display:grid;grid-template-columns:340px minmax(0,1fr);gap:12px;align-items:start}
.ib-list{border:1px solid var(--border);border-radius:13px;background:var(--surface);display:flex;flex-direction:column;max-height:80vh}
.ib-bar{display:flex;gap:6px;flex-wrap:wrap;padding:10px;border-bottom:1px solid var(--border)}
.ib-bar input{flex:1;min-width:140px;padding:.42rem .7rem;border:1px solid var(--border);border-radius:9px;background:var(--bg,var(--surface));color:var(--text);font:500 .82rem var(--font)}
.ib-btn{padding:.38rem .8rem;border:1px solid var(--border);border-radius:var(--r-full,999px);background:var(--surface);color:var(--text-2);font:600 .78rem var(--font);cursor:pointer}
.ib-btn:hover{color:var(--text)}
.ib-btn.on,.ib-btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}
.ib-btn.danger{color:var(--danger,#dc4444);border-color:color-mix(in srgb,var(--danger,#dc4444) 45%,var(--border))}
.ib-btn:disabled{opacity:.5;cursor:default}
.ib-threads{overflow:auto}
.ib-thread{display:flex;flex-direction:column;gap:3px;padding:9px 12px;border-bottom:1px solid var(--border);cursor:pointer;background:none;border-left:3px solid transparent;text-align:left;width:100%;color:var(--text);font:inherit}
.ib-thread:hover{background:var(--bg,transparent)}
.ib-thread.sel{border-left-color:var(--accent);background:var(--bg,transparent)}
.ib-thread .top{display:flex;gap:6px;align-items:center}
.ib-thread .who{font-weight:700;font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ib-thread .when{margin-left:auto;color:var(--text-3);font-size:.7rem;white-space:nowrap}
.ib-thread .pv{color:var(--text-3);font-size:.76rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ib-badge{min-width:18px;padding:0 6px;border-radius:999px;background:var(--accent);color:var(--on-accent,#fff);font-size:.66rem;font-weight:700;text-align:center}
.ib-chip{padding:1px 7px;border-radius:999px;border:1px solid var(--border);font-size:.66rem;font-weight:700;white-space:nowrap;color:var(--text-2)}
.ib-chip.needs_review,.ib-chip.failed{color:var(--warn,#b07700);border-color:color-mix(in srgb,var(--amber,#b07700) 50%,var(--border));background:var(--amber-soft,transparent)}
.ib-chip.granted{color:var(--success,#1f9d55);border-color:color-mix(in srgb,var(--success,#1f9d55) 45%,var(--border))}
.ib-chip.rejected{color:var(--danger,#dc4444)}
.ib-pane{border:1px solid var(--border);border-radius:13px;background:var(--surface);display:flex;flex-direction:column;min-height:60vh;max-height:80vh}
.ib-pane-head{padding:12px 14px;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.ib-pane-head h2{font-size:1rem;margin:0}
.ib-pane-head .id{color:var(--text-3);font-size:.72rem;font-variant-numeric:tabular-nums}
.ib-claim{margin:12px 14px 0;border:1px solid var(--border);border-radius:11px;padding:11px 12px;display:flex;flex-direction:column;gap:8px}
.ib-claim.needs_review,.ib-claim.failed{border-color:color-mix(in srgb,var(--amber,#b07700) 50%,var(--border))}
.ib-claim .row{display:flex;gap:14px;flex-wrap:wrap;font-size:.8rem;color:var(--text-2)}
.ib-claim .row b{color:var(--text)}
.ib-claim .flags{display:flex;gap:6px;flex-wrap:wrap}
.ib-claim .flag{font-size:.74rem;padding:2px 8px;border-radius:8px;background:var(--amber-soft,transparent);border:1px solid color-mix(in srgb,var(--amber,#b07700) 45%,var(--border));color:var(--warn,#b07700)}
.ib-claim .quote{font-size:.8rem;color:var(--text-2);border-left:3px solid var(--border);padding-left:9px;white-space:pre-wrap}
.ib-claim .acts{display:flex;gap:8px;flex-wrap:wrap}
.ib-msgs{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.ib-msg{max-width:78%;border:1px solid var(--border);border-radius:12px;padding:8px 11px;display:flex;flex-direction:column;gap:5px}
.ib-msg.in{align-self:flex-start;background:var(--bg,transparent)}
.ib-msg.out{align-self:flex-end;background:color-mix(in srgb,var(--accent) 10%,var(--surface))}
.ib-msg .meta{font-size:.68rem;color:var(--text-3)}
.ib-msg .txt{font-size:.85rem;white-space:pre-wrap;overflow-wrap:anywhere}
.ib-msg img{max-width:min(420px,100%);max-height:320px;border-radius:8px;border:1px solid var(--border);cursor:zoom-in}
.ib-msg .file{font-size:.75rem;color:var(--text-3)}
.ib-reply{border-top:1px solid var(--border);padding:10px 14px;display:flex;gap:8px;align-items:flex-end}
.ib-reply textarea{flex:1;min-height:54px;max-height:200px;resize:vertical;padding:.5rem .65rem;border:1px solid var(--border);border-radius:9px;background:var(--bg,var(--surface));color:var(--text);font:500 .85rem var(--font)}
.ib-empty{color:var(--text-3);font-size:.84rem;padding:18px}
.ib-err{border:1px solid color-mix(in srgb,var(--danger,#dc4444) 45%,var(--border));background:var(--red-soft,transparent);color:var(--danger,#dc4444);padding:10px 13px;border-radius:10px;font-size:.84rem}
dialog.ib-dlg{width:min(560px,94vw);border:1px solid var(--border);border-radius:14px;background:var(--surface);color:var(--text);padding:18px}
dialog.ib-dlg::backdrop{background:rgba(0,0,0,.55)}
dialog.ib-img{max-width:94vw;max-height:94vh;padding:0;border:0;background:transparent}
dialog.ib-img img{max-width:94vw;max-height:94vh;display:block}
.ib-dlg textarea{width:100%;min-height:90px;margin-top:8px;padding:.5rem .65rem;border:1px solid var(--border);border-radius:9px;background:var(--bg,var(--surface));color:var(--text);font:500 .85rem var(--font)}
.ib-dlg .acts{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
.ib-attn{border:1px solid color-mix(in srgb,var(--amber,#b07700) 45%,var(--border));border-radius:13px;background:var(--surface);padding:11px 13px;display:flex;flex-direction:column;gap:9px;max-height:48vh;overflow:auto}
.ib-attn[hidden]{display:none}
.ib-attn-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ib-attn-head b{font-size:.9rem;margin-right:4px}
.ib-attn-chip{padding:2px 9px;border-radius:999px;border:1px solid var(--border);font-size:.72rem;font-weight:700;color:var(--text-3);font-variant-numeric:tabular-nums}
.ib-attn-chip.on{color:var(--warn,#b07700);border-color:color-mix(in srgb,var(--amber,#b07700) 50%,var(--border));background:var(--amber-soft,transparent)}
.ib-attn-hold{font-size:.82rem;font-weight:600;color:var(--danger,#dc4444)}
.ib-attn-sec{display:flex;flex-direction:column;gap:4px}
.ib-attn-sec h3{margin:2px 0 0;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);font-weight:700}
.ib-attn-row{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-size:.8rem;padding:5px 0;border-top:1px solid var(--border)}
.ib-attn-row .txt{flex:1;min-width:200px;white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3;overflow:hidden;cursor:pointer}
.ib-attn-row .txt.open{display:block;-webkit-line-clamp:unset;line-clamp:none}
.ib-attn-row .act{flex-basis:100%;font-size:.76rem;color:var(--text-2)}
.ib-attn-row .meta{color:var(--text-3);font-size:.7rem;white-space:nowrap}
.ib-attn-quiet{color:var(--text-3);font-size:.74rem}
@media(max-width:900px){.ib-main{grid-template-columns:1fr}.ib-list{max-height:40vh}}
`;

// Turns the inbox service's GET /alerts payload into what the Attention panel
// shows. Pure and self-contained: it runs in Node for tests and is inlined
// into the page script via toString(). Returns null when nothing needs the
// owner (no hold, no approvals, no blocked tasks, no alerts, no anomalies),
// so the panel stays hidden. Every string here is rendered with textContent.
function attentionModel(data, now) {
  const d = data && typeof data === "object" ? data : {};
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
  const str = (v) => (v == null ? "" : String(v));
  const num = (v) => { const n = typeof v === "string" && !/^\d+$/.test(v) ? Date.parse(v) : Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const rel = (ms) => {
    if (!ms) return "";
    const diff = ms - now; const a = Math.abs(diff);
    const u = a < 60e3 ? "<1m" : a < 3600e3 ? Math.floor(a / 60e3) + "m" : a < 864e5 ? Math.floor(a / 3600e3) + "h" : Math.floor(a / 864e5) + "d";
    return diff >= 0 ? "in " + u : u + " ago";
  };
  const et = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
  const ticket = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? "#" + n : ""; };

  const holdMs = num(d.prodHold);
  const hold = holdMs && holdMs > now ? { until: et(holdMs), rel: rel(holdMs) } : null;

  const approvals = list(d.pendingApprovals).map((p) => {
    const at = num(p.at); const exp = num(p.expiresAt);
    return {
      id: str(p.id), kind: str(p.kind), ticket: ticket(p.ticket), summary: str(p.summary),
      when: rel(at), title: at ? et(at) : "", expires: exp ? (exp > now ? "expires " + rel(exp) : "expired") : "",
      action: "Reply `Keir approve " + str(p.id) + "` in the task's channel",
    };
  });
  const blocked = list(d.blocked).map((b) => {
    const at = num(b.updatedAt);
    return { id: str(b.id), kind: str(b.kind), ticket: ticket(b.ticket), summary: str(b.summary), when: rel(at), title: at ? et(at) : "" };
  });
  const alerts = list(d.alerts).map((a) => {
    const at = num(a.at);
    return { key: str(a.key), content: str(a.content), when: rel(at), title: at ? et(at) : "" };
  });
  const sh = d.shadow && typeof d.shadow === "object" ? d.shadow : null;
  const shAt = sh ? num(sh.at) : null;
  const anomalies = sh && Array.isArray(sh.anomalies) ? sh.anomalies.map(str).filter(Boolean) : [];
  const shadow = anomalies.length ? { when: rel(shAt), title: shAt ? et(shAt) : "", anomalies } : null;

  if (!hold && !approvals.length && !blocked.length && !alerts.length && !shadow) return null;
  return {
    hold, approvals, blocked, alerts, shadow,
    chips: [
      ["Pending approvals", approvals.length],
      ["Blocked tasks", blocked.length],
      ["Alerts (24h)", alerts.length],
      ["Shadow anomalies", anomalies.length],
    ],
  };
}

// Every string that reaches innerHTML passes through esc(). Attachment URLs
// are built from validated file names only.
const INBOX_JS = `
(function(){
const API='/api/keir/inbox';
const st={threads:[],sel:null,detail:null,filter:'all',q:'',busy:false,older:[]};
const $=s=>document.querySelector(s);
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=ms=>{if(!ms)return '';const d=new Date(Number(ms));const diff=Date.now()-d;if(diff<864e5)return d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'});return d.toLocaleDateString([],{month:'short',day:'numeric',timeZone:'America/New_York'})};
const label=t=>t.kind&&t.kind!=='dm'?'#'+(t.channel_name||t.display_name||t.channel_id):(t.display_name||t.username||t.user_id);
const full=ms=>new Date(Number(ms)).toLocaleString([],{timeZone:'America/New_York'})+' ET';
const STATUS={collecting:'Collecting',checking:'Checking',incomplete:'Waiting on player',not_linked:'Not linked',needs_review:'Needs review',approved:'Approved',granting:'Paying',granted:'Paid',failed:'Payment failed',rejected:'Rejected'};
const fileOk=f=>/^[\\w.-]+$/.test(String(f||''));
async function api(path,opts){
  const r=await fetch(API+path,Object.assign({credentials:'same-origin'},opts||{}));
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||('HTTP '+r.status));
  return j;
}
const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'ops-dashboard'},body:JSON.stringify(body||{})});
function err(msg){const box=$('#ib-error');box.textContent='';if(!msg)return;const d=document.createElement('div');d.className='ib-err';d.textContent=msg;box.appendChild(d)}

${attentionModel.toString()}
// The Attention panel is built with textContent only: alert text can carry
// player-provided strings. A missing endpoint (404) hides the panel; any other
// failure leaves one quiet line and never touches the page error banner.
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n}
function attnRow(main,metaParts,title,action){
  const r=el('div','ib-attn-row');const t=el('span','txt',main);t.title='Click to expand';r.appendChild(t);
  const meta=metaParts.filter(Boolean).join(' · ');if(meta){const m=el('span','meta',meta);if(title)m.title=title;r.appendChild(m)}
  if(action)r.appendChild(el('span','act',action));
  return r;
}
function attnSection(box,heading,rows){if(!rows.length)return;const s=el('div','ib-attn-sec');s.appendChild(el('h3',null,heading));rows.forEach(x=>s.appendChild(x));box.appendChild(s)}
function renderAttention(m){
  const box=$('#ib-attn');box.replaceChildren();
  if(!m){box.hidden=true;return}
  box.hidden=false;
  const head=el('div','ib-attn-head');head.appendChild(el('b',null,'Attention'));
  m.chips.forEach(([l,n])=>head.appendChild(el('span','ib-attn-chip'+(n>0?' on':''),n+' '+l)));
  box.appendChild(head);
  if(m.hold)box.appendChild(el('div','ib-attn-hold','Production hold active until '+m.hold.until+' ('+m.hold.rel+')'));
  attnSection(box,'Pending approvals',m.approvals.map(p=>attnRow(p.summary||p.kind,[p.ticket,p.kind,p.when,p.expires],p.title,p.action)));
  attnSection(box,'Blocked tasks',m.blocked.map(b=>attnRow(b.summary||b.id,[b.ticket,b.kind,b.when],b.title)));
  attnSection(box,'Alerts, last 24h',m.alerts.map(a=>attnRow(a.content,[a.when],a.title)));
  if(m.shadow)attnSection(box,'Shadow anomalies'+(m.shadow.when?' ('+m.shadow.when+')':''),m.shadow.anomalies.map(t=>attnRow(t,[],m.shadow.title)));
}
async function loadAttention(){
  const box=$('#ib-attn');
  try{
    const r=await fetch(API+'/alerts',{credentials:'same-origin'});
    if(r.status===404){renderAttention(null);return}
    if(!r.ok)throw new Error('HTTP '+r.status);
    renderAttention(attentionModel(await r.json(),Date.now()));
  }catch(e){box.replaceChildren(el('span','ib-attn-quiet','Keir alerts unavailable.'));box.hidden=false}
}
const statCell=([l,n,w])=>'<div class="ib-stat'+(w?' warn':'')+'"><div class="n">'+esc(n)+'</div><div class="l">'+esc(l)+'</div></div>';
async function loadStats(){
  try{const s=await api('/stats');const c=s.claims||{};
    const cells=[['Threads',s.threads],['Unread',s.unread,s.unread>0],['Needs review',c.needs_review||0,(c.needs_review||0)>0],['Payment failed',c.failed||0,(c.failed||0)>0],['Waiting on player',(c.incomplete||0)+(c.not_linked||0)],['Paid',c.granted||0]];
    $('#ib-stats').innerHTML=cells.map(statCell).join('');
  }catch(e){err(e.message)}
}
async function loadThreads(){
  try{const j=await api('/threads?limit=300'+(st.q?'&q='+encodeURIComponent(st.q):''));st.threads=j.threads||[];renderThreads();err('')}
  catch(e){err(e.message)}
}
function visible(){
  return st.threads.filter(t=>st.filter==='all'||(st.filter==='unread'&&t.unread>0)||(st.filter==='review'&&['needs_review','failed'].includes(t.claim_status))||st.filter===t.kind);
}
function renderThreads(){
  const list=visible();
  $('#ib-threads').innerHTML=list.length?list.map(threadRow).join(''):emptyList();
}
const emptyList=()=>'<div class="ib-empty">No conversations'+(st.filter!=='all'?' in this view':'')+'.</div>';
function threadRow(t){
  return '<button class="ib-thread'+(t.channel_id===st.sel?' sel':'')+'" data-id="'+esc(t.channel_id)+'">'
    +'<span class="top"><span class="who">'+esc(label(t))+'</span>'
    +'<span class="ib-chip">'+esc(t.kind||'dm')+'</span>'
    +(t.claim_status?'<span class="ib-chip '+esc(t.claim_status)+'">'+esc(STATUS[t.claim_status]||t.claim_status)+'</span>':'')
    +(t.unread>0?'<span class="ib-badge">'+esc(t.unread)+'</span>':'')
    +'<span class="when">'+esc(when(t.last_message_at))+'</span></span>'
    +'<span class="pv">'+esc(t.character_name?t.character_name+' · ':'')+esc(t.preview||'(attachment)')+'</span></button>';
}
async function openThread(id,keepScroll){
  if(st.sel!==id)st.older=[];st.sel=id;renderThreads();
  try{
    const d=await api('/threads/'+id);const seen=new Set(d.messages.map(m=>m.id));d.messages=[...st.older.filter(m=>!seen.has(m.id)),...d.messages];st.detail=d;renderDetail(keepScroll);
    if(d.thread.unread>0){await post('/threads/'+id+'/read');const t=st.threads.find(x=>x.channel_id===id);if(t)t.unread=0;renderThreads();loadStats()}
  }catch(e){err(e.message)}
}
function claimCard(c,flagText){
  if(!c)return '';
  const v=c.verdict||{};const flags=(c.flags||[]).map(f=>'<span class="flag">'+esc((flagText||{})[f]||f)+'</span>').join('');
  const g=c.grant_result;
  const decidable=['needs_review','failed','incomplete','not_linked'].includes(c.status);
  return '<div class="ib-claim '+esc(c.status)+'">'
    +'<div class="row"><span><b>Reward claim #'+esc(c.id)+'</b></span><span class="ib-chip '+esc(c.status)+'">'+esc(STATUS[c.status]||c.status)+'</span>'
    +(c.character_name?'<span>Character <b>'+esc(c.character_name)+'</b></span>':'')
    +(c.itch_username?'<span>itch.io <b>'+esc(c.itch_username)+'</b></span>':'')
    +(v.in_collection!==undefined?'<span>In collection <b>'+(v.in_collection?'yes':'no')+'</b></span>':'')
    +(v.comment_found!==undefined?'<span>Comment <b>'+(v.comment_found?'yes':'no')+'</b></span>':'')
    +(v.edit_suspicion?'<span>Edit check <b>'+esc(v.edit_suspicion)+'</b></span>':'')
    +(c.reviewed_by?'<span>Reviewed by <b>'+esc(c.reviewed_by)+'</b></span>':'')+'</div>'
    +(flags?'<div class="flags">'+flags+'</div>':'')
    +(v.comment_text?'<div class="quote">'+esc(v.comment_text)+'</div>':'')
    +(v.notes?'<div class="row">'+esc(v.notes)+'</div>':'')
    +(c.note?'<div class="row">Note: '+esc(c.note)+'</div>':'')
    +(g?'<div class="row">Paid <b>₳'+esc(Number(g.amountAnchor||0).toLocaleString('en-US'))+'</b>'+(g.currency?' as '+esc(Number(g.amountLocal||0).toLocaleString('en-US',{maximumFractionDigits:0}))+' '+esc(g.currency):'')+(g.status==='already_granted'?' (already paid earlier)':'')+'</div>':'')
    +(decidable?'<div class="acts"><button class="ib-btn primary" data-act="approve" data-claim="'+esc(c.id)+'">Approve and pay</button><button class="ib-btn" data-act="recheck" data-claim="'+esc(c.id)+'">Recheck</button><button class="ib-btn danger" data-act="reject" data-claim="'+esc(c.id)+'">Reject</button></div>':'')
    +'</div>';
}
function renderDetail(keepScroll){
  const d=st.detail;if(!d){$('#ib-pane').innerHTML='<div class="ib-empty">Pick a conversation.</div>';return}
  const t=d.thread;const box=$('#ib-msgs');const prev=box?box.scrollTop:0;const draft=$('#ib-text')?$('#ib-text').value:'';
  const msgs=d.messages.map(m=>'<div class="ib-msg '+esc(m.direction)+'"><span class="meta">'+esc(m.direction==='out'?(m.sent_by&&m.sent_by!=='keir'?'Keir (sent by '+m.sent_by+')':'Keir'):(m.author_name||'Player'))+' · '+esc(full(m.created_at))+'</span>'
    +(m.content?'<span class="txt">'+esc(m.content)+'</span>':'')
    +(m.attachments||[]).map(a=>a.file&&fileOk(a.file)?'<img loading="lazy" alt="'+esc(a.filename||'screenshot')+'" src="'+API+'/attachments/'+esc(a.file)+'">':'<span class="file">Attachment: '+esc(a.filename||'file')+(a.error?' (not saved: '+esc(a.error)+')':'')+'</span>').join('')
    +'</div>').join('');
  $('#ib-pane').innerHTML='<div class="ib-pane-head"><h2>'+esc(label(t))+'</h2><span class="id">'+esc(t.kind==='dm'?'DM · '+(t.username||t.user_id):t.kind+' · '+t.channel_id)+'</span><button class="ib-btn" data-act="sync" style="margin-left:auto">Sync from Discord</button></div>'
    +claimCard(d.claim,d.flagText)
    +(d.messages.length>=500?'<button class="ib-btn" data-act="older">Load older messages</button>':'')
    +'<div class="ib-msgs" id="ib-msgs">'+(msgs||'<div class="ib-empty">No messages.</div>')+'</div>'
    +'<form class="ib-reply" id="ib-reply"><textarea id="ib-text" maxlength="2000" placeholder="Reply as Keir in this conversation."></textarea><button class="ib-btn primary" type="submit">Send</button></form>';
  $('#ib-text').value=draft;
  const nb=$('#ib-msgs');nb.scrollTop=keepScroll?prev:nb.scrollHeight;
}
async function act(kind,claimId){
  if(st.busy)return;st.busy=true;
  try{
    if(kind==='older'){const first=st.detail.messages[0];const d=await api('/threads/'+st.sel+'?before='+first.id);st.older=[...d.messages,...st.detail.messages];await openThread(st.sel,true);return}
    if(kind==='sync'){await post('/threads/'+st.sel+'/sync')}
    else if(kind==='reject'){const dlg=$('#ib-reject');dlg.dataset.claim=claimId;$('#ib-reject-msg').value='';dlg.showModal();return}
    else{const r=await post('/claims/'+claimId+'/'+kind);if(r.ok===false)throw new Error(r.error||'Action failed')}
    await openThread(st.sel);await loadThreads();await loadStats();
  }catch(e){err(e.message)}finally{st.busy=false}
}
document.addEventListener('click',e=>{
  const th=e.target.closest('.ib-thread');if(th){openThread(th.dataset.id);return}
  const b=e.target.closest('[data-act]');if(b){e.preventDefault();b.disabled=true;act(b.dataset.act,b.dataset.claim).finally(()=>{b.disabled=false});return}
  const f=e.target.closest('[data-filter]');if(f){st.filter=f.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('on',x===f));renderThreads();return}
  const at=e.target.closest('.ib-attn-row .txt');if(at){at.classList.toggle('open');return}
  const img=e.target.closest('.ib-msg img');if(img){$('#ib-img img').src=img.src;$('#ib-img').showModal();return}
  if(e.target.id==='ib-img')$('#ib-img').close();
});
document.addEventListener('submit',async e=>{
  if(e.target.id==='ib-reply'){e.preventDefault();const text=$('#ib-text').value.trim();if(!text||st.busy)return;st.busy=true;
    try{await post('/threads/'+st.sel+'/reply',{content:text});$('#ib-text').value='';await openThread(st.sel)}catch(x){err(x.message)}finally{st.busy=false}}
  if(e.target.id==='ib-reject-form'){e.preventDefault();const dlg=$('#ib-reject');const msg=$('#ib-reject-msg').value.trim();dlg.close();st.busy=true;
    try{const r=await post('/claims/'+dlg.dataset.claim+'/reject',{message:msg});if(r.ok===false)throw new Error(r.error);await openThread(st.sel);await loadThreads();await loadStats()}catch(x){err(x.message)}finally{st.busy=false}}
});
document.querySelector('[data-close]').addEventListener('click',()=>$('#ib-reject').close());
let qt;$('#ib-q').addEventListener('input',e=>{clearTimeout(qt);qt=setTimeout(()=>{st.q=e.target.value.trim();loadThreads()},250)});
loadAttention();loadStats();loadThreads();renderDetail();
setInterval(()=>{if(document.hidden||st.busy)return;loadAttention();loadStats();loadThreads();if(st.sel&&!($('#ib-text')&&$('#ib-text').value))openThread(st.sel,true)},15000);
})();
`;

function makeKeirInboxBody({ configured = true } = {}) {
  const body = `<div class="ib-wrap">
<div class="ib-head"><div><h1>Keir inbox</h1><div class="ib-sub">DMs, tickets, channels and threads where Keir participates. Search messages or participants. Replies here are sent as Keir in the selected conversation.</div></div></div>
${configured ? "" : '<div class="ib-err">The inbox token is not configured on this dashboard.</div>'}
<div class="ib-attn" id="ib-attn" hidden></div>
<div id="ib-error"></div>
<div class="ib-stats" id="ib-stats"></div>
<div class="ib-main">
  <div class="ib-list">
    <div class="ib-bar"><input type="search" id="ib-q" placeholder="Search messages, people or channels"><button class="ib-btn on" data-filter="all">All</button><button class="ib-btn" data-filter="dm">DMs</button><button class="ib-btn" data-filter="ticket">Tickets</button><button class="ib-btn" data-filter="channel">Channels</button><button class="ib-btn" data-filter="thread">Threads</button><button class="ib-btn" data-filter="unread">Unread</button><button class="ib-btn" data-filter="review">Review</button></div>
    <div class="ib-threads" id="ib-threads"><div class="ib-empty">Loading...</div></div>
  </div>
  <div class="ib-pane" id="ib-pane"></div>
</div>
</div>
<dialog class="ib-dlg" id="ib-reject"><form id="ib-reject-form" method="dialog">
  <b>Reject this claim</b>
  <div class="ib-sub">Optional message to the player, sent as Keir. Leave it empty to reject silently.</div>
  <textarea id="ib-reject-msg" maxlength="2000" placeholder="For example: This screenshot was already used for another account, so I can't pay this one."></textarea>
  <div class="acts"><button class="ib-btn" type="button" data-close>Cancel</button><button class="ib-btn danger" type="submit">Reject</button></div>
</form></dialog>
<dialog class="ib-img" id="ib-img"><img alt="Screenshot"></dialog>
<script>${INBOX_JS}</script>`;
  return { extraCss: INBOX_CSS, body };
}

module.exports = { makeKeirInboxBody, attentionModel, INBOX_CSS };
