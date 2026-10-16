"use strict";

// suggestion-swipe-page.js: the /suggestions/swipe deck, built for a phone.
//
// Swipe right = want it, left = no, up = already shipped or a duplicate,
// down = skip for now. Double tap or the star = super like. Arrow keys work
// on a desktop (shift+right for a super like, U to undo). Gestures that start
// in the scrolling text only read sideways swipes, so reading a long
// suggestion never votes on it. All player text is rendered with textContent.
//
// Returns { extraCss, body } like every other page here.

const SWIPE_CSS = `
.sw-wrap{max-width:560px;margin:0 auto;padding:14px 12px 28px;display:flex;flex-direction:column;gap:12px}
.sw-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap}
.sw-head h1{font-size:1.2rem;font-weight:700;letter-spacing:-.02em;margin:0}
.sw-head a{color:var(--text-3);font-size:.78rem}
.sw-prog{color:var(--text-3);font-size:.78rem;display:flex;gap:10px;flex-wrap:wrap}
.sw-prog b{color:var(--text);font-variant-numeric:tabular-nums}
.sw-tabs{display:flex;gap:6px}
.sw-tab{flex:1;padding:.5rem .4rem;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--text-2);font:600 .8rem var(--font);cursor:pointer}
.sw-tab.on{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}
.sw-stage{position:relative;height:min(64vh,560px);touch-action:none}
.sw-card{position:absolute;inset:0;border:1px solid var(--border);border-radius:16px;background:var(--surface);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 6px 22px rgba(0,0,0,.18);touch-action:none;user-select:none;-webkit-user-select:none}
.sw-card.next{transform:scale(.96) translateY(10px);opacity:.6;pointer-events:none}
.sw-card.fly{transition:transform .28s ease-out,opacity .28s ease-out}
.sw-card.back{transition:transform .2s ease-out}
.sw-top{padding:12px 14px 8px;display:flex;flex-direction:column;gap:6px;border-bottom:1px solid var(--border)}
.sw-meta{display:flex;gap:5px;flex-wrap:wrap;align-items:center;font-size:.7rem;color:var(--text-3)}
.sw-chip{padding:1px 7px;border-radius:999px;border:1px solid var(--border);font-size:.66rem;font-weight:700;white-space:nowrap;color:var(--text-2)}
.sw-chip.good{color:var(--success,#2a9d5c);border-color:color-mix(in srgb,var(--success,#2a9d5c) 45%,var(--border))}
.sw-chip.warn{color:var(--warn,#b07700);border-color:color-mix(in srgb,var(--amber,#b07700) 50%,var(--border))}
.sw-title{font-size:1.05rem;font-weight:700;line-height:1.3;color:var(--text)}
.sw-scroll{flex:1;overflow-y:auto;padding:10px 14px 14px;display:flex;flex-direction:column;gap:10px;touch-action:pan-y;-webkit-overflow-scrolling:touch}
.sw-text{white-space:pre-wrap;font-size:.88rem;line-height:1.45;color:var(--text)}
.sw-label{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:3px}
.sw-ai{border:1px solid var(--border);border-radius:10px;padding:8px 10px;font-size:.8rem;line-height:1.4;color:var(--text-2);display:flex;flex-direction:column;gap:5px}
.sw-rel{display:flex;flex-direction:column;gap:4px;font-size:.78rem}
.sw-rel a{color:var(--text-2);display:flex;gap:6px;align-items:center}
.sw-stamp{position:absolute;top:18px;padding:4px 12px;border:3px solid;border-radius:8px;font:800 1.1rem var(--font);letter-spacing:.06em;opacity:0;pointer-events:none;transform:rotate(-10deg)}
.sw-stamp.yes{left:16px;color:var(--success,#2a9d5c)}
.sw-stamp.no{right:16px;color:var(--danger,#dc4444);transform:rotate(10deg)}
.sw-stamp.done{left:50%;margin-left:-58px;color:var(--accent);transform:none}
.sw-stamp.skip{left:50%;margin-left:-34px;top:auto;bottom:18px;color:var(--text-3);transform:none}
.sw-btns{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.sw-btn{padding:.7rem 0;border:1px solid var(--border);border-radius:14px;background:var(--surface);color:var(--text-2);font:700 .78rem var(--font);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px}
.sw-btn .g{font-size:1.25rem;line-height:1}
.sw-btn.no .g{color:var(--danger,#dc4444)}
.sw-btn.yes .g{color:var(--success,#2a9d5c)}
.sw-btn.super .g{color:var(--warn,#b07700)}
.sw-btn.done .g{color:var(--accent)}
.sw-btn:disabled{opacity:.4}
.sw-undo{align-self:center;background:none;border:0;color:var(--text-3);font:600 .78rem var(--font);cursor:pointer;padding:4px 10px}
.sw-undo:disabled{opacity:.35}
.sw-empty{border:1px dashed var(--border);border-radius:16px;padding:34px 18px;text-align:center;color:var(--text-2);font-size:.9rem;line-height:1.5}
.sw-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:var(--text);color:var(--surface);padding:9px 16px;border-radius:999px;font:600 .84rem var(--font);opacity:0;transition:opacity .2s;pointer-events:none;z-index:50;max-width:92vw;text-align:center}
.sw-toast.on{opacity:1}
.sw-list{display:flex;flex-direction:column;gap:10px}
.sw-item{border:1px solid var(--border);border-radius:13px;background:var(--surface);padding:11px 13px;display:flex;flex-direction:column;gap:7px}
.sw-item .t{font-weight:700;font-size:.9rem;color:var(--text)}
.sw-votes{display:flex;gap:6px;flex-wrap:wrap;font-size:.74rem;color:var(--text-2)}
.sw-acts{display:flex;gap:6px;flex-wrap:wrap}
.sw-act{padding:.42rem .75rem;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--text-2);font:600 .76rem var(--font);cursor:pointer}
.sw-act.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}
.sw-check.good{border-color:color-mix(in srgb,var(--success,#2a9d5c) 45%,var(--border))}
.sw-check.warn{border-color:color-mix(in srgb,var(--amber,#b07700) 50%,var(--border))}
.sw-ask{font-size:.76rem}
.sw-ev{color:var(--text-3);font-size:.7rem;word-break:break-word;margin:2px 0 4px}
.sw-more{background:none;border:0;padding:0;color:var(--accent);font:600 .78rem var(--font);cursor:pointer}
.sw-err{border:1px solid color-mix(in srgb,var(--danger,#dc4444) 45%,var(--border));color:var(--danger,#dc4444);padding:10px 13px;border-radius:10px;font-size:.84rem}
.sw-help{color:var(--text-3);font-size:.72rem;text-align:center;line-height:1.5}
`;

const SWIPE_JS = `
(function(){
const $=(s,r)=>(r||document).querySelector(s);
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=String(text);return e;};
const VOTE_LABEL={yes:'Yes',super:'Super like',no:'No',done:'Shipped',skip:'Skip'};
const OUTCOME_LABEL={planned:'Planned',not_implementing:'Declined',completed:'Shipped',in_progress:'Built, not live yet',discuss:'Discuss'};
const CHECK_LABEL={implemented:'Already in game',partial:'Partly in game',in_development:'Built, not live yet',not_implemented:'Not in game',unclear:'Code check unclear'};
const CHECK_CLS={implemented:'good',partial:'warn',in_development:'warn',not_implemented:'',unclear:''};
const ASK_LABEL={live:'live',dev_only:'on dev',missing:'missing',opposite_by_design:'opposite by design',unclear:'unclear'};
const STATUS_LABEL={not_reviewed:'not reviewed',planned:'planned',in_progress:'in progress',completed:'completed',not_implementing:'not implementing'};
let deck=null,tab='deck',busy=false,history=[],dragging=false,renderLater=false;

async function api(path,body){
  const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'ops-dashboard'},body:JSON.stringify(body),credentials:'same-origin'}:{credentials:'same-origin'});
  const j=await r.json().catch(()=>({error:'Bad response ('+r.status+')'}));
  if(!r.ok)throw new Error(j.error||('HTTP '+r.status));
  return j;
}
function toast(msg){const t=$('#sw-toast');t.textContent=msg;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),2400);}
function showErr(msg){const e=$('#sw-err');e.textContent=msg||'';e.style.display=msg?'block':'none';}

async function load(){
  try{deck=await api('/api/suggestions/swipe/deck');showErr('');}catch(e){showErr(e.message);deck=deck||{cards:[],counts:{},otherVoters:[],discuss:[],decided:[]};}
  render();
}

function renderProgress(){
  const p=$('#sw-prog');p.textContent='';
  const c=deck.counts||{};
  const add=(n,label)=>{const s=el('span');s.appendChild(el('b',null,n));s.appendChild(document.createTextNode(' '+label));p.appendChild(s);};
  add(c.mine||0,'left for you');
  for(const o of deck.otherVoters||[])add(o.remaining,'left for '+o.voter);
  add(c.matches||0,'matches');
  add(c.discuss||0,'to discuss');
  if(deck.audit&&deck.audit.sourceCommit){const s=el('span',null,'code checked against game '+String(deck.audit.sourceCommit).slice(0,7)+(deck.audit.generatedAt?' on '+String(deck.audit.generatedAt).slice(0,10):''));p.appendChild(s);}
  $('#sw-tab-discuss').textContent='Discuss'+(c.discuss?' ('+c.discuss+')':'');
}

function chip(text,cls){return el('span','sw-chip'+(cls?' '+cls:''),text);}
// Long AI text would bury the player's own words; show the start, tap for the rest.
function clamped(text,n){
  const d=el('div');
  if(text.length<=n){d.textContent=text;return d;}
  const cut=text.slice(0,n).replace(/\\s+\\S*$/,'');
  d.textContent=cut+'... ';
  const more=el('button','sw-more','more');
  more.onclick=(e)=>{e.stopPropagation();d.textContent=text;};
  d.appendChild(more);
  return d;
}

function codeCheckBox(c){
  const box=el('div','sw-ai sw-check '+(CHECK_CLS[c.verdict]||''));
  const head=el('div','sw-meta');
  head.appendChild(el('span','sw-label','Code check'));
  head.appendChild(chip(CHECK_LABEL[c.verdict]||c.verdict,CHECK_CLS[c.verdict]));
  head.appendChild(chip(c.confidence+' confidence'));
  box.appendChild(head);
  if(c.inGameToday){const d=el('div');d.appendChild(el('b',null,'In game: '));d.appendChild(document.createTextNode(c.inGameToday));box.appendChild(d);}
  if(c.missing){const d=el('div');d.appendChild(el('b',null,'Missing: '));d.appendChild(document.createTextNode(c.missing));box.appendChild(d);}
  if(c.notes)box.appendChild(clamped(c.notes,160));
  if(c.asks&&c.asks.length){
    const more=el('button','sw-more','show each part ('+c.asks.length+')');
    more.onclick=(e)=>{e.stopPropagation();more.remove();
      for(const x of c.asks){const r=el('div','sw-ask');r.appendChild(chip(ASK_LABEL[x.status]||x.status,x.status==='live'?'good':x.status==='dev_only'?'warn':''));r.appendChild(el('span',null,' '+x.ask));if(x.evidence)r.appendChild(el('div','sw-ev',x.evidence));box.appendChild(r);}
    };
    box.appendChild(more);
  }
  return box;
}

function buildCard(card){
  const c=el('div','sw-card');
  const top=el('div','sw-top');
  const meta=el('div','sw-meta');
  meta.appendChild(chip('S#'+card.issueNumber));
  if(card.category)meta.appendChild(chip(card.category.replace(/_/g,' ')));
  if(card.gameSystem)meta.appendChild(chip(card.gameSystem.replace(/_/g,' ')));
  if(card.likes||card.dislikes)meta.appendChild(chip('+'+card.likes+' / -'+card.dislikes));
  if(card.members.length>1)meta.appendChild(chip(card.members.length+' near-identical','warn'));
  const a=card.assessment;
  const cc=card.codeCheck;
  if(cc)meta.appendChild(chip(CHECK_LABEL[cc.verdict]||cc.verdict,CHECK_CLS[cc.verdict]));
  else meta.appendChild(chip('not code-checked','warn'));
  if(!cc&&a&&a.likelyAlreadyFixed)meta.appendChild(chip('AI: likely already shipped','good'));
  if(a&&a.recommendedAction==='quick_implement')meta.appendChild(chip('AI: quick','good'));
  if(a&&a.recommendedAction==='decline')meta.appendChild(chip('AI: decline','warn'));
  top.appendChild(meta);
  top.appendChild(el('div','sw-title',card.title||'(untitled)'));
  c.appendChild(top);
  const sc=el('div','sw-scroll');
  if(card.description)sc.appendChild(el('div','sw-text',card.description));
  if(card.impact){const d=el('div');d.appendChild(el('div','sw-label','Why it matters'));d.appendChild(el('div','sw-text',card.impact));sc.appendChild(d);}
  if(card.memberTitles&&card.memberTitles.length){
    const d=el('div');d.appendChild(el('div','sw-label','Merged with'));
    const l=el('div','sw-rel');
    for(const m of card.memberTitles)l.appendChild(el('div',null,'S#'+m.issueNumber+' '+m.title));
    d.appendChild(l);sc.appendChild(d);
  }
  if(cc)sc.appendChild(codeCheckBox(cc));
  if(a){
    const box=el('div','sw-ai');
    box.appendChild(el('div','sw-label','Earlier AI triage'));
    if(a.summary)box.appendChild(clamped(a.summary,280));
    if(a.recommendation)box.appendChild(clamped(a.recommendation,200));
    const m=el('div','sw-meta');
    if(a.complexity)m.appendChild(chip('complexity '+a.complexity));
    if(a.risk)m.appendChild(chip('risk '+a.risk));
    box.appendChild(m);sc.appendChild(box);
  }
  if(card.related&&card.related.length){
    const d=el('div');d.appendChild(el('div','sw-label','Similar suggestions'));
    const l=el('div','sw-rel');
    for(const r of card.related){
      const link=el('a');link.href='/suggestions/'+r.issueNumber;link.target='_blank';link.rel='noopener';
      link.appendChild(chip(STATUS_LABEL[r.status]||r.status,r.status==='completed'?'good':''));
      link.appendChild(el('span',null,'S#'+r.issueNumber+' '+r.title));
      l.appendChild(link);
    }
    d.appendChild(l);sc.appendChild(d);
  }
  const open=el('a','sw-chip','Open full suggestion');open.href='/suggestions/'+card.issueNumber;open.target='_blank';open.rel='noopener';open.style.alignSelf='flex-start';
  sc.appendChild(open);
  c.appendChild(sc);
  for(const k of ['yes','no','done','skip']){const s=el('div','sw-stamp '+k,k==='yes'?'YES':k==='no'?'NO':k==='done'?'SHIPPED':'SKIP');s.dataset.k=k;c.appendChild(s);}
  return c;
}

function renderDeck(){
  const stage=$('#sw-stage');stage.textContent='';
  const cards=deck.cards||[];
  const btns=document.querySelectorAll('.sw-btn');
  btns.forEach(b=>b.disabled=!cards.length);
  $('#sw-undo').disabled=!history.length;
  if(!cards.length){
    const c=deck.counts||{};
    const msg=c.open?('You have voted on everything open. '+(c.waiting||0)+' card'+(c.waiting===1?' is':'s are')+' waiting on the other vote.'):'The backlog is clear.';
    stage.appendChild(el('div','sw-empty',msg));
    return;
  }
  if(cards[1])stage.appendChild(Object.assign(buildCard(cards[1]),{className:'sw-card next'}));
  const top=buildCard(cards[0]);
  stage.appendChild(top);
  attachGestures(top,cards[0]);
}

function attachGestures(card,data){
  let sx=0,sy=0,dx=0,dy=0,active=false,inScroll=false,lastTap=0;
  const stamps={};card.querySelectorAll('.sw-stamp').forEach(s=>stamps[s.dataset.k]=s);
  const dirOf=()=>{
    if(Math.abs(dx)>=Math.abs(dy))return dx>0?'yes':'no';
    if(inScroll)return null;
    return dy<0?'done':'skip';
  };
  const paint=()=>{
    card.style.transform='translate('+dx+'px,'+dy+'px) rotate('+(dx/18)+'deg)';
    const d=dirOf(),mag=Math.min(1,Math.max(Math.abs(dx),Math.abs(dy))/110);
    for(const k in stamps)stamps[k].style.opacity=(k===d?mag:0);
  };
  card.addEventListener('pointerdown',e=>{
    if(busy||e.target.closest('a'))return;
    active=true;dragging=true;inScroll=!!e.target.closest('.sw-scroll');sx=e.clientX;sy=e.clientY;dx=dy=0;
    card.classList.remove('back');
  });
  card.addEventListener('pointermove',e=>{
    if(!active)return;
    dx=e.clientX-sx;dy=e.clientY-sy;
    if(inScroll){
      // Vertical movement in the text is reading, not voting.
      if(Math.abs(dy)>Math.abs(dx)&&Math.abs(dx)<12){dx=0;dy=0;paint();return;}
      dy=0;
      if(!card.hasPointerCapture(e.pointerId))card.setPointerCapture(e.pointerId);
    }else if(!card.hasPointerCapture(e.pointerId)){card.setPointerCapture(e.pointerId);}
    paint();
  });
  const end=()=>{
    if(!active)return;active=false;dragging=false;
    // A vote re-renders on its own; only a cancelled drag owes a deferred render.
    const flush=()=>{if(renderLater){renderLater=false;setTimeout(render,0);}};
    const d=dirOf(),far=Math.max(Math.abs(dx),Math.abs(dy))>100;
    if(far&&d){renderLater=false;flyOut(card,d);vote(data,d);return;}
    if(Math.abs(dx)<6&&Math.abs(dy)<6&&!inScroll){
      const now=Date.now();
      if(now-lastTap<320){lastTap=0;renderLater=false;flyOut(card,'yes');vote(data,'super');return;}
      lastTap=now;
    }
    dx=dy=0;card.classList.add('back');paint();flush();
  };
  card.addEventListener('pointerup',end);
  card.addEventListener('pointercancel',end);
}

function flyOut(card,dir){
  if(!card)return;
  const w=window.innerWidth;
  const t={yes:[w,0],no:[-w,0],done:[0,-window.innerHeight],skip:[0,window.innerHeight]}[dir]||[w,0];
  card.classList.add('fly');
  card.style.transform='translate('+t[0]+'px,'+t[1]+'px) rotate('+(t[0]/40)+'deg)';
  card.style.opacity='0';
}

function describe(results){
  if(!results||!results.length)return null;
  const r=results[0];
  const n='S#'+Math.min.apply(null,r.issueNumbers);
  if(r.outcome==='planned')return 'Match! '+n+' is planned'+(r.superLike?' as top priority':'')+(r.kanbanId?' (kanban #'+r.kanbanId+')':'');
  if(r.outcome==='not_implementing')return 'You both said no to '+n;
  if(r.outcome==='completed')return n+' marked shipped';
  if(r.outcome==='discuss')return 'Split vote on '+n+', moved to Discuss';
  return null;
}

async function vote(card,v){
  if(busy)return;busy=true;
  // Show the next card at once; the server answer refreshes counts after.
  setTimeout(()=>{if(deck.cards[0]===card){deck.cards.shift();deck.counts.mine=Math.max(0,(deck.counts.mine||1)-1);renderProgress();renderDeck();}},200);
  try{
    const res=await api('/api/suggestions/swipe/vote',{issueNumbers:card.members,vote:v});
    history.push(card);if(history.length>20)history.shift();
    toast(describe(res.results)||VOTE_LABEL[v]);
    busy=false;
    await load();
  }catch(e){showErr(e.message);busy=false;await load();}
}

async function undo(){
  const card=history.pop();if(!card||busy)return;busy=true;
  try{await api('/api/suggestions/swipe/reopen',{issueNumbers:card.members,mine:true});toast('Undid S#'+card.issueNumber);await load();}
  catch(e){showErr(e.message);}
  finally{busy=false;}
}

function voteChips(votes){
  const w=el('div','sw-votes');
  for(const v of votes||[])w.appendChild(chip((v.mine?'You':v.voter)+': '+(VOTE_LABEL[v.vote]||v.vote)));
  return w;
}

function renderDiscuss(){
  const list=$('#sw-list');list.textContent='';
  const items=deck.discuss||[];
  if(!items.length){list.appendChild(el('div','sw-empty','Nothing to discuss. Split votes land here.'));return;}
  for(const d of items){
    const it=el('div','sw-item');
    const t=el('a','t','S#'+d.issueNumber+' '+(d.title||'(untitled)'));t.href='/suggestions/'+d.issueNumber;t.target='_blank';t.rel='noopener';
    it.appendChild(t);
    if(d.members.length>1)it.appendChild(el('div','sw-votes','Also covers '+d.members.slice(1).map(n=>'S#'+n).join(', ')));
    it.appendChild(voteChips(d.votes));
    if(d.card&&d.card.description){const x=el('div','sw-text',d.card.description.slice(0,600)+(d.card.description.length>600?'...':''));x.style.fontSize='.8rem';it.appendChild(x);}
    if(d.card&&d.card.codeCheck)it.appendChild(codeCheckBox(d.card.codeCheck));
    else if(d.card&&d.card.assessment&&d.card.assessment.summary){const x=el('div','sw-ai');x.appendChild(clamped(d.card.assessment.summary,280));it.appendChild(x);}
    const acts=el('div','sw-acts');
    const mk=(label,outcome,sup,primary)=>{const b=el('button','sw-act'+(primary?' primary':''),label);b.onclick=()=>decide(d,outcome,sup);return b;};
    acts.appendChild(mk('Plan','planned',false,true));
    acts.appendChild(mk('Plan, top priority','planned',true));
    acts.appendChild(mk('Decline','not_implementing',false));
    acts.appendChild(mk('Already shipped','completed',false));
    it.appendChild(acts);
    list.appendChild(it);
  }
}

async function decide(d,outcome,superLike){
  if(busy)return;busy=true;
  try{const res=await api('/api/suggestions/swipe/decide',{issueNumbers:d.members,outcome,superLike});toast(describe(res.results)||'Done');await load();}
  catch(e){showErr(e.message);}
  finally{busy=false;}
}

function renderDecided(){
  const list=$('#sw-list');list.textContent='';
  const items=deck.decided||[];
  if(!items.length){list.appendChild(el('div','sw-empty','No decisions yet.'));return;}
  for(const d of items){
    const it=el('div','sw-item');
    const t=el('a','t','S#'+d.issueNumber+' '+(d.title||'(untitled)'));t.href='/suggestions/'+d.issueNumber;t.target='_blank';t.rel='noopener';
    it.appendChild(t);
    const m=el('div','sw-meta');
    m.appendChild(chip(OUTCOME_LABEL[d.outcome]+(d.superLike?' (top priority)':''),d.outcome==='planned'?'good':''));
    if(d.verdict)m.appendChild(chip(CHECK_LABEL[d.verdict]||d.verdict,CHECK_CLS[d.verdict]));
    if(d.members.length>1)m.appendChild(chip(d.members.length+' suggestions'));
    if(d.kanbanId){const k=el('a','sw-chip','kanban #'+d.kanbanId);k.href='/kanban';m.appendChild(k);}
    if(!d.appliedStatus)m.appendChild(chip('status was changed elsewhere first','warn'));
    if(d.decidedBy)m.appendChild(el('span',null,'by '+d.decidedBy));
    it.appendChild(m);
    it.appendChild(voteChips(d.votes));
    const acts=el('div','sw-acts');
    const b=el('button','sw-act','Reopen (both vote again)');
    b.onclick=async()=>{if(busy)return;busy=true;try{await api('/api/suggestions/swipe/reopen',{issueNumbers:d.members});toast('Reopened S#'+d.issueNumber);await load();}catch(e){showErr(e.message);}finally{busy=false;}};
    acts.appendChild(b);it.appendChild(acts);
    list.appendChild(it);
  }
}

function render(){
  // Never swap the card out from under a finger; finish after the gesture.
  if(dragging){renderLater=true;return;}
  renderProgress();
  document.querySelectorAll('.sw-tab').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab));
  $('#sw-deck').style.display=tab==='deck'?'flex':'none';
  $('#sw-list').style.display=tab==='deck'?'none':'flex';
  if(tab==='deck')renderDeck();else if(tab==='discuss')renderDiscuss();else renderDecided();
}

document.querySelectorAll('.sw-tab').forEach(b=>b.addEventListener('click',()=>{tab=b.dataset.tab;render();}));
document.querySelectorAll('.sw-btn').forEach(b=>b.addEventListener('click',()=>{
  const card=deck&&deck.cards&&deck.cards[0];if(!card||busy)return;
  const v=b.dataset.v;flyOut($('#sw-stage .sw-card:not(.next)'),v==='super'?'yes':v);vote(card,v);
}));
$('#sw-undo').addEventListener('click',undo);
document.addEventListener('keydown',e=>{
  if(tab!=='deck'||e.target.closest('input,textarea,select'))return;
  const card=deck&&deck.cards&&deck.cards[0];
  if(e.key==='u'||e.key==='U'){undo();return;}
  if(!card)return;
  const map={ArrowRight:e.shiftKey?'super':'yes',ArrowLeft:'no',ArrowUp:'done',ArrowDown:'skip'};
  const v=map[e.key];if(!v)return;
  e.preventDefault();flyOut($('#sw-stage .sw-card:not(.next)'),v==='super'?'yes':v);vote(card,v);
});
load();
})();
`;

function makeSuggestionSwipeBody() {
  const body = `<div class="sw-wrap">
  <div class="sw-head"><h1>Suggestion swipe</h1><a href="/suggestions">List view</a></div>
  <div class="sw-prog" id="sw-prog"></div>
  <div class="sw-tabs">
    <button class="sw-tab on" data-tab="deck">Deck</button>
    <button class="sw-tab" data-tab="discuss" id="sw-tab-discuss">Discuss</button>
    <button class="sw-tab" data-tab="decided">Decided</button>
  </div>
  <div class="sw-err" id="sw-err" style="display:none"></div>
  <div id="sw-deck" style="display:flex;flex-direction:column;gap:12px">
    <div class="sw-stage" id="sw-stage"></div>
    <div class="sw-btns">
      <button class="sw-btn no" data-v="no"><span class="g">&#10005;</span>No</button>
      <button class="sw-btn skip" data-v="skip"><span class="g">&#8595;</span>Skip</button>
      <button class="sw-btn done" data-v="done"><span class="g">&#8593;</span>Shipped</button>
      <button class="sw-btn super" data-v="super"><span class="g">&#9733;</span>Super</button>
      <button class="sw-btn yes" data-v="yes"><span class="g">&#10003;</span>Yes</button>
    </div>
    <button class="sw-undo" id="sw-undo" disabled>Undo last swipe</button>
    <div class="sw-help">Right yes, left no, up already shipped or duplicate, down skip. Double tap for a super like. Votes stay hidden until you both vote. Status changes are silent: players are not notified.</div>
  </div>
  <div class="sw-list" id="sw-list" style="display:none"></div>
  <div class="sw-toast" id="sw-toast"></div>
</div>
<script>${SWIPE_JS}</script>`;
  return { extraCss: SWIPE_CSS, body };
}

module.exports = { makeSuggestionSwipeBody };
