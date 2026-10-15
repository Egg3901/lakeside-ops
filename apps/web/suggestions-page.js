// ─── COMMUNITY: SUGGESTIONS MANAGEMENT PAGE ──────────────────────────────
// Self-contained body/CSS generators for /suggestions list + detail.
// Reuses shared styling/helpers from tickets-page.js.
const { icon } = require("./ui-kit");
const { isEnabled } = require("./src/services/featureFlags");
const { COMMUNITY_CSS, esc, fmtDate, statusBadge, triageBadge, renderAssessmentCard, renderTriageMeta, renderTrackedWork } = require("./tickets-page");

// "Easiest wins" curation rendered above the list. `wins` is an array of
// { issueNumber, title, complexity, risk, reason } where reason ∈
// {"decline","quick","easy"}.
function makeEasiestWins(wins) {
  if (!wins || !wins.length) return "";
  const tagLabel = { decline: "Decline", quick: "Quick implement", easy: "Easy fix" };
  const cards = wins
    .map((w) => {
      const reason = tagLabel[w.reason] ? w.reason : "easy";
      return `<a class="cm-win" href="/suggestions/${esc(w.issueNumber)}">
        <div class="cm-win-top"><span class="cm-win-num">#${esc(w.issueNumber)}</span><span class="cm-tag ${reason}">${esc(tagLabel[reason])}</span></div>
        <div class="cm-win-title">${esc(w.title || "(untitled)")}</div>
        <div class="cm-win-meta"><span class="cm-chip">${esc(w.complexity || "—")}</span><span class="cm-chip risk-${esc(w.risk || "low")}">${esc(w.risk || "—")}</span></div>
      </a>`;
    })
    .join("");
  return `<div class="cm-wins">
    <div class="cm-wins-head">${icon("zap", { size: 15 })} Easiest wins <span class="n">· quick to clear</span></div>
    <div class="cm-wins-grid">${cards}</div>
  </div>`;
}

function makeSuggestionsListBody({ suggestions, page, totalPages, status, total, easiestWins }) {
  const statuses = ["all", "not_reviewed", "planned", "in_progress", "completed", "not_implementing"];
  const cur = status || "all";
  const tabs = statuses
    .map((s) => `<a class="cm-tab ${s === cur ? "on" : ""}" href="/suggestions${s === "all" ? "" : "?status=" + s}">${esc(s.replace(/_/g, " "))}</a>`)
    .join("");

  const rows = suggestions.length
    ? suggestions
        .map((s) => {
          const sub = [s.category, s.gameSystem, s.priority ? "priority: " + s.priority : null].filter(Boolean);
          return `<a class="cm-row" href="/suggestions/${esc(s.issueNumber)}">
            <span class="cm-num">#${esc(s.issueNumber)}</span>
            <span class="cm-main">
              <div class="cm-title">${esc(s.title || "(untitled)")}</div>
              <div class="cm-sub">${sub.map((x) => `<span>${esc(x)}</span>`).join("")}<span>${esc(fmtDate(s.createdAt))}</span></div>
            </span>
            <span class="cm-right">${triageBadge(s.triage)}${statusBadge(s.status)}</span>
          </a>`;
        })
        .join("")
    : `<div class="cm-empty">No suggestions${cur !== "all" ? " with status “" + esc(cur) + "”" : ""} yet.</div>`;

  const qp = cur === "all" ? "" : `&status=${cur}`;
  const pager = `<div class="cm-pager">
    <span>${total} suggestion${total === 1 ? "" : "s"}${totalPages > 1 ? ` · page ${page}/${totalPages}` : ""}</span>
    <span>
      <a class="${page <= 1 ? "disabled" : ""}" href="/suggestions?page=${page - 1}${qp}">← Prev</a>
      <a class="${page >= totalPages ? "disabled" : ""}" href="/suggestions?page=${page + 1}${qp}">Next →</a>
    </span>
  </div>`;

  return {
    extraCss: COMMUNITY_CSS,
    body: `<div class="cm-head"><h1>${icon("lightbulb", { size: 22 })} Suggestions</h1><p>Community feature suggestions, with automated read-only triage.</p></div>
      ${makeEasiestWins(easiestWins)}
      <div class="cm-tabs">${tabs}</div>
      <div class="cm-list">${rows}</div>
      ${pager}`,
  };
}

// One function, two viewers, mirroring the ticket detail page: reporters see
// their own words (description, context, impact), the status, and the tracked
// work card. Numbers, triage internals, assessments, and every action stay
// staff-only. `tracked` is the raw tracker_items document or null.
function makeSuggestionDetailBody({ suggestion, assessment, fixSession, viewer = "staff", tracked = null }) {
  const isStaff = viewer !== "public";
  const s = suggestion;
  const meta = [];
  meta.push(`<span>${icon("calendar", { size: 13 })} ${esc(fmtDate(s.createdAt))}</span>`);
  if (s.category) meta.push(`<span>${icon("tag", { size: 13 })} ${esc(s.category)}</span>`);
  if (s.gameSystem) meta.push(`<span>${icon("layers", { size: 13 })} ${esc(s.gameSystem)}</span>`);
  if (s.priority) meta.push(`<span>${icon("flag", { size: 13 })} ${esc(s.priority)}</span>`);

  let launchBlock;
  if (!isEnabled("codeAgent")) {
    launchBlock = fixSession && fixSession.prUrl
      ? `<div class="cm-card"><h2>${icon("git-pull-request", { size: 14 })} Work in progress</h2><div class="cm-launch-result"><a href="${esc(fixSession.prUrl)}" target="_blank" rel="noopener">View PR →</a></div></div>`
      : "";
  } else if (fixSession && fixSession.codeSessionId) {
    launchBlock = `<div class="cm-card"><h2>${icon("git-pull-request", { size: 14 })} Work in progress</h2>
      <div class="cm-launch-result">A code-agent session was launched. <a href="/code/session/${esc(fixSession.codeSessionId)}">Open session →</a>${fixSession.prUrl ? ` · <a href="${esc(fixSession.prUrl)}" target="_blank" rel="noopener">View PR →</a>` : ""}</div></div>`;
  } else {
    const canLaunch = !!assessment && assessment.status !== "error";
    launchBlock = `<div class="cm-card"><h2>${icon("wand", { size: 14 })} Launch implementation</h2>
      <button class="cm-launch" id="cm-launch-btn" ${canLaunch ? "" : "disabled"}>${icon("zap", { size: 15 })} Launch session</button>
      <div class="cm-launch-note">${canLaunch ? "Creates a code-agent session on a fresh branch off <code>development</code>, seeded with this suggestion and its assessment. This is the only action that writes." : "Waiting for an assessment before work can be launched."}</div>
      <div class="cm-launch-result" id="cm-launch-result"></div></div>`;
  }

  const launchJs = `<script>(function(){function fail(el,msg){el.replaceChildren();var s=document.createElement('span');s.style.color='var(--red,#e05c5c)';s.textContent=msg;el.appendChild(s);}function launched(el,id){el.replaceChildren();el.appendChild(document.createTextNode('Session launched. '));var a=document.createElement('a');a.href='/code/session/'+encodeURIComponent(id);a.textContent='Open session →';el.appendChild(a);}
    var btn=document.getElementById('cm-launch-btn');if(!btn)return;
    var out=document.getElementById('cm-launch-result');
    btn.addEventListener('click',function(){
      if(!confirm('Launch a code-agent session for suggestion #${esc(s.issueNumber)}?'))return;
      btn.disabled=true;btn.textContent='Launching…';
      fetch('/api/suggestions/${esc(s._id)}/launch',{method:'POST',headers:{'Content-Type':'application/json'}})
        .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d}})})
        .then(function(res){
          if(res.ok&&res.d.codeSessionId){launched(out,res.d.codeSessionId);setTimeout(function(){location.href='/code/session/'+res.d.codeSessionId},1200);}
          else{fail(out,'Failed: '+((res.d&&res.d.error)||'error'));btn.disabled=false;btn.innerHTML='Launch session';}
        }).catch(function(e){fail(out,'Failed: '+e.message);btn.disabled=false;btn.innerHTML='Launch session';});
    });
  })();</script>`;

  // Re-run triage block — forces the worker to re-assess this suggestion next tick.
  const retriageBlock = `<button class="cm-retriage" id="cm-retriage-btn">${icon("refresh", { size: 14 })} Re-run triage</button>
    <span class="cm-launch-result" id="cm-retriage-result" style="margin-left:.5rem"></span>`;
  const retriageJs = `<script>(function(){function fail(el,msg){el.replaceChildren();var s=document.createElement('span');s.style.color='var(--red,#e05c5c)';s.textContent=msg;el.appendChild(s);}function launched(el,id){el.replaceChildren();el.appendChild(document.createTextNode('Session launched. '));var a=document.createElement('a');a.href='/code/session/'+encodeURIComponent(id);a.textContent='Open session →';el.appendChild(a);}
    var btn=document.getElementById('cm-retriage-btn');if(!btn)return;
    var out=document.getElementById('cm-retriage-result');
    btn.addEventListener('click',function(){
      if(!confirm('Re-run triage for suggestion #${esc(s.issueNumber)}? The current assessment will be replaced on the next worker tick.'))return;
      btn.disabled=true;btn.textContent='Re-queuing…';
      fetch('/api/suggestions/${esc(s._id)}/retriage',{method:'POST',headers:{'Content-Type':'application/json'}})
        .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d}})})
        .then(function(res){
          if(res.ok&&res.d.ok){
            out.textContent='Re-assessing…';var tries=0;
            var poll=setInterval(function(){tries++;
              fetch('/api/suggestions/${esc(s._id)}/triage-status').then(function(r){return r.json()}).then(function(st){
                if(st.triageStatus==='assessed'){clearInterval(poll);out.textContent='Done — reloading…';location.reload();}
                else if(st.triageStatus==='error'){clearInterval(poll);fail(out,'Assessment failed: '+(st.error||''));btn.disabled=false;btn.innerHTML='Re-run triage';}
                else if(tries>40){clearInterval(poll);location.reload();}
              }).catch(function(){});
            },2000);
          }
          else{fail(out,'Failed: '+((res.d&&res.d.error)||'error'));btn.disabled=false;btn.innerHTML='Re-run triage';}
        }).catch(function(e){fail(out,'Failed: '+e.message);btn.disabled=false;btn.innerHTML='Re-run triage';});
    });
  })();</script>`;

  const contextCard = s.context
    ? `<div class="cm-card"><h2>${icon("file-text", { size: 14 })} Context</h2><div class="cm-desc">${esc(s.context)}</div></div>`
    : "";

  return {
    extraCss: COMMUNITY_CSS,
    body: `${isStaff
        ? `<a class="cm-back" href="/suggestions">${icon("arrow-left", { size: 14 })} All suggestions</a>`
        : `<a class="cm-back" href="https://www.ahousedividedgame.com">${icon("arrow-left", { size: 14 })} Back to the game</a>`}
      <div class="cm-dhead"><h1>${isStaff ? `#${esc(s.issueNumber)} ` : ""}${esc(s.title || "(untitled)")}</h1>${statusBadge(s.status)}</div>
      <div class="cm-dmeta">${meta.join("")}</div>
      <div class="cm-card"><h2>${icon("file-text", { size: 14 })} Description</h2><div class="cm-desc">${esc(s.description || "(no description)")}</div></div>
      ${contextCard}
      ${s.impact ? `<div class="cm-card"><h2>${icon("trending-up", { size: 14 })} Impact</h2><div class="cm-desc">${esc(s.impact)}</div></div>` : ""}
      ${renderTrackedWork(tracked, viewer)}
      ${isStaff ? `${renderTriageMeta({ tags: s.tags, assessment, statusHistory: s.statusHistory })}
      ${renderAssessmentCard(assessment)}
      ${launchBlock}
      <div class="cm-card"><h2>${icon("refresh", { size: 14 })} Re-triage</h2>
        <div>${retriageBlock}</div>
        <div class="cm-launch-note">Resets this suggestion so the triage worker re-assesses it on its next tick. The previous assessment is kept as history.</div>
      </div>
      ${launchJs}
      ${retriageJs}` : ""}`,
  };
}

module.exports = { makeSuggestionsListBody, makeSuggestionDetailBody };
