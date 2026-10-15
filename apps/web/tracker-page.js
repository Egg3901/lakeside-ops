// tracker-page.js — Long-running projects, goals and checklists.
//
// The data comes from lakeside-tracker (:9741), which owns the store and serves
// the same shape to off-box agents over MCP. This module owns only the view, and
// renders it in the dashboard's own design system rather than importing another
// product's stylesheet — a page that looks like a different application inside
// this one reads as a mistake, however good it looks on its own.
//
// Returns { extraCss, body } like every other page here.

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

const TRACKER_CSS = `
.tr-wrap{max-width:1040px;margin:0 auto;padding:var(--s-5,24px) var(--s-4,16px);display:flex;flex-direction:column;gap:18px}
.tr-head{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:10px}
.tr-head h1{font-size:1.4rem;font-weight:700;letter-spacing:-.02em;margin:0}
.tr-sub{color:var(--text-3);font-size:.85rem}

.tr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.tr-stat{border:1px solid var(--border);border-radius:13px;background:var(--surface);padding:13px 15px}
.tr-stat .n{font-size:1.5rem;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.tr-stat .l{color:var(--text-3);font-size:.74rem;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-top:2px}
.tr-stat.warn .n{color:#ffd79a}
.tr-stat.good .n{color:#7ee2af}

/* Filters. Plain segmented buttons in the dashboard's idiom — no imported
   control from another product. */
.tr-filters{display:flex;gap:6px;flex-wrap:wrap}
.tr-filters button{padding:.4rem .85rem;border:1px solid var(--border);border-radius:var(--r-full,999px);background:var(--surface);color:var(--text-2);font:600 .8rem var(--font);cursor:pointer;transition:all var(--t,.15s)}
.tr-filters button:hover{color:var(--text);border-color:var(--border-2,var(--border))}
.tr-filters button.on{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}

.tr-realm{display:flex;flex-direction:column;gap:10px}
.tr-realm > header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding-bottom:8px;border-bottom:1px solid var(--border)}
.tr-realm > header h2{font-size:1.05rem;font-weight:700;letter-spacing:-.02em;margin:0}
.tr-realm > header .c{color:var(--text-3);font-size:.78rem;font-variant-numeric:tabular-nums}

.tr-proj{border:1px solid var(--border);border-radius:13px;background:var(--surface);overflow:hidden}
.tr-proj > header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 15px}
.tr-proj > header h3{font-size:.9rem;font-weight:700;margin:0}
.tr-proj-right{display:flex;align-items:center;gap:10px;color:var(--text-3);font-size:.76rem;font-variant-numeric:tabular-nums}

.tr-phase{border-top:1px solid var(--border)}
.tr-phase > .name{padding:8px 15px 4px;color:var(--text-3);font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}

.tr-row{display:grid;grid-template-columns:18px minmax(0,1fr) auto auto;gap:11px;align-items:center;padding:9px 15px;border-top:1px solid var(--border)}
.tr-phase > .name + .tr-row{border-top:0}
.tr-row:hover{background:var(--glass-2,transparent)}
.tr-row .t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.86rem}
.tr-row.done .t{color:var(--text-2)}
.tr-row.live .t{text-decoration:line-through;text-decoration-color:var(--border)}
.tr-why{grid-column:2/-1;margin-top:2px;color:#ffd79a;font-size:.76rem}

/* Kind marker. A check is a circle, a task a square — and a tick is EARNED by
   completion, never given by category. An unrun check that renders like a passed
   one is the exact failure a tracker exists to prevent. */
.tr-mark{width:18px;height:18px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border-2,var(--border));border-radius:5px;color:var(--text-3);font-size:.62rem}
.tr-mark.check{border-radius:50%}
.tr-mark.project,.tr-mark.goal{border-style:dashed}
.tr-row.done .tr-mark{border-color:#34d399;color:#7ee2af}
.tr-row.blocked .tr-mark{border-color:#f5a623;color:#ffd79a}

/* Delivery rail: branch, dev, production. Three segments rather than a tick,
   because a tick says "finished" for work that has sat unmerged for three weeks. */
.tr-rail{display:flex;gap:3px}
.tr-rail i{display:block;width:15px;height:4px;border-radius:999px;background:var(--border-2,var(--border))}
.tr-rail i.on{background:var(--accent)}
.tr-rail i.on.live{box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 28%,transparent)}

.tr-chip{padding:2px 8px;border-radius:999px;background:var(--glass-2,var(--surface));border:1px solid var(--border);color:var(--text-3);font-size:.66rem;font-weight:700;white-space:nowrap}
.tr-chip.blocked{border-color:color-mix(in srgb,#f5a623 45%,var(--border));background:color-mix(in srgb,#f5a623 10%,var(--surface));color:#ffd79a}
.tr-chip.active{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));background:color-mix(in srgb,var(--accent) 10%,var(--surface));color:var(--accent)}
.tr-chip.live{border-color:color-mix(in srgb,#34d399 45%,var(--border));background:color-mix(in srgb,#34d399 10%,var(--surface));color:#7ee2af}
.tr-issue{padding:2px 7px;border-radius:999px;background:var(--glass-2,var(--surface));border:1px solid var(--border);color:var(--text-2);font-size:.66rem;font-weight:700;white-space:nowrap}
.tr-issue:hover{color:var(--text)}

.tr-empty{padding:22px 15px;color:var(--text-3);font-size:.86rem;text-align:center}
.tr-down{border:1px solid color-mix(in srgb,#e5484d 45%,var(--border));background:color-mix(in srgb,#e5484d 9%,var(--surface));color:#ffb4b4;padding:14px 16px;border-radius:12px;font-size:.88rem}
@media(max-width:640px){.tr-row{grid-template-columns:18px minmax(0,1fr) auto}.tr-row .tr-chip{display:none}}
`;

const KIND_MARK = { project: "▣", goal: "◇", task: "", check: "", note: "·" };

function rail(stage) {
  return `<span class="tr-rail">${[1, 2, 3]
    .map((n) => {
      const on = stage >= n ? " on" : "";
      const live = n === 3 && stage >= 3 ? " live" : "";
      const title = ["On a branch", "On development", "In production"][n - 1];
      return `<i class="${(on + live).trim()}" title="${title}"></i>`;
    })
    .join("")}</span>`;
}

// `links` maps tracker item id -> { href, label } for rows whose work came
// from a support report. Resolved server-side, so the board JSON itself never
// carries report numbers to readers who should not see them.
function row(item, links) {
  const done = item.stage > 0;
  const cls = [
    "tr-row",
    done ? "done" : "",
    item.stage === 3 ? "live" : "",
    item.status === "blocked" ? "blocked" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const chipCls =
    item.status === "blocked"
      ? " blocked"
      : item.status === "active"
        ? " active"
        : item.status === "done_prod"
          ? " live"
          : "";

  const issue = item.issue_url
    ? `<a class="tr-issue" href="${esc(item.issue_url)}" target="_blank" rel="noreferrer noopener">${esc(
        item.issue.startsWith("#") ? item.issue : "#" + String(item.issue).split("#").pop(),
      )}</a>`
    : "";

  const report = links && links[item.id]
    ? `<a class="tr-issue" href="${esc(links[item.id].href)}">${esc(links[item.id].label)}</a>`
    : "";

  // A blocked item with no reason is indistinguishable from a forgotten one.
  const why =
    item.status === "blocked" && item.blocked_by
      ? `<span class="tr-why">${esc(item.blocked_by)}</span>`
      : "";

  return `<div class="${cls}">
    <span class="tr-mark ${esc(item.kind)}" title="${esc(item.kind)}">${done ? "✓" : KIND_MARK[item.kind] || ""}</span>
    <span class="t" title="${esc(item.title)}">${esc(item.title)}</span>
    ${rail(item.stage)}
    <span style="display:flex;gap:7px;align-items:center">${issue}${report}<span class="tr-chip${chipCls}">${esc(item.status_label)}</span></span>
    ${why}
  </div>`;
}

function makeTrackerBody({ board, error, links = null, loading = false }) {
  if (loading) {
    return {
      extraCss: TRACKER_CSS,
      body: `<div class="tr-wrap">
        <div class="tr-head"><h1>Work</h1></div>
        <div class="tr-empty" id="trLoading" role="status">Loading the work board...</div>
        <button id="trRetry" type="button" hidden onclick="location.reload()">Try again</button>
      </div>
      <script>(function(){
        var attempts=0;
        var retry=document.getElementById('trRetry');
        async function check(){
          try{
            var response=await fetch('/api/tracker/cache-status',{cache:'no-store'});
            if(response.ok){var state=await response.json();if(state.ready){location.reload();return;}}
          }catch(e){}
          attempts++;
          if(attempts>=40){
            document.getElementById('trLoading').textContent='The tracker is still unavailable.';
            retry.hidden=false;
            return;
          }
          setTimeout(check,750);
        }
        setTimeout(check,500);
      })();</script>`,
    };
  }

  if (error) {
    return {
      extraCss: TRACKER_CSS,
      body: `<div class="tr-wrap">
        <div class="tr-head"><h1>Work</h1></div>
        <div class="tr-down"><strong>The tracker is not answering.</strong><br>
        This page is a view; the store lives in <code>lakeside-tracker</code> on :9741.
        <br><span style="opacity:.75">${esc(error)}</span></div>
      </div>`,
    };
  }

  const t = board.totals || {};
  const realms = (board.realms || [])
    .map((realm) => {
      const projects = (realm.projects || [])
        .map((p) => {
          const phases = (p.phases || [])
            .map((ph) => {
              const items = (ph.items || []).map((i) => row(i, links)).join("");
              if (!items) return "";
              // An unnamed phase gets no heading: an empty label reads as a
              // missing name, not as "no phase".
              const name = ph.name ? `<div class="name">${esc(ph.name)}</div>` : "";
              return `<div class="tr-phase">${name}${items}</div>`;
            })
            .join("");
          if (!phases) return "";
          // A project named the same as its realm just repeats the heading.
          const same =
            realm.realm &&
            p.project.toLowerCase().replace(/[-_ ]/g, "") ===
              realm.realm.toLowerCase().replace(/[-_ ]/g, "");
          return `<section class="tr-proj">
            <header>
              <h3>${esc(same ? "All work" : p.project)}</h3>
              <span class="tr-proj-right">${p.progress.done}/${p.progress.total}${rail(p.progress.in_production > 0 ? 3 : p.progress.done > 0 ? 1 : 0)}</span>
            </header>${phases}
          </section>`;
        })
        .join("");
      if (!projects) return "";

      const tot = (realm.projects || []).reduce(
        (a, p) => ({
          total: a.total + p.progress.total,
          done: a.done + p.progress.done,
          live: a.live + p.progress.in_production,
        }),
        { total: 0, done: 0, live: 0 },
      );
      // A fraction says what is left; a percentage does not.
      return `<div class="tr-realm">
        <header><h2>${esc(realm.realm)}</h2><span class="c">${tot.done} of ${tot.total} done · ${tot.live} live</span></header>
        ${projects}
      </div>`;
    })
    .join("");

  const body = `<div class="tr-wrap" id="trWrap">
  <div class="tr-head">
    <div>
      <h1>Work</h1>
      <div class="tr-sub">Every project, goal and checklist, grouped the way the work is. Agents read and write the same store over MCP.</div>
    </div>
    <div class="tr-filters" id="trFilters">
      <button data-f="open" class="on">Open</button>
      <button data-f="blocked">Blocked</button>
      <button data-f="all">All</button>
    </div>
  </div>

  <div class="tr-stats">
    <div class="tr-stat"><div class="n">${t.total ?? 0}</div><div class="l">Tracked</div></div>
    <div class="tr-stat"><div class="n">${t.active ?? 0}</div><div class="l">Active</div></div>
    <div class="tr-stat warn"><div class="n">${t.blocked ?? 0}</div><div class="l">Blocked</div></div>
    <div class="tr-stat good"><div class="n">${t.in_production ?? 0}</div><div class="l">In production</div></div>
  </div>

  ${realms || '<div class="tr-empty">Nothing tracked yet.</div>'}
</div>

<script>
(function(){
  // Filtering is client-side over already-rendered rows: the board is small, and
  // a round trip to re-render three dozen lines would be slower than hiding them.
  var STATES = {
    // Branch and dev still count as open. Unpromoted work is exactly the kind
    // that goes quiet, so hiding it would defeat the point of the split.
    open: ['Open','Active','Blocked','On branch','On dev'],
    blocked: ['Blocked'],
  };
  function apply(f){
    document.querySelectorAll('.tr-row').forEach(function(r){
      var chip = r.querySelector('.tr-chip');
      var label = chip ? chip.textContent.trim() : '';
      var show = f === 'all' || (STATES[f] || []).indexOf(label) !== -1;
      r.style.display = show ? '' : 'none';
    });
    // Hide a phase, project or realm that has nothing left to show, so the page
    // does not fill with empty headings.
    document.querySelectorAll('.tr-phase').forEach(function(p){
      p.style.display = p.querySelector('.tr-row:not([style*="none"])') ? '' : 'none';
    });
    document.querySelectorAll('.tr-proj').forEach(function(p){
      p.style.display = p.querySelector('.tr-phase:not([style*="none"])') ? '' : 'none';
    });
    document.querySelectorAll('.tr-realm').forEach(function(p){
      p.style.display = p.querySelector('.tr-proj:not([style*="none"])') ? '' : 'none';
    });
  }
  document.querySelectorAll('#trFilters button').forEach(function(b){
    b.addEventListener('click', function(){
      document.querySelectorAll('#trFilters button').forEach(function(x){ x.classList.toggle('on', x === b); });
      apply(b.dataset.f);
    });
  });
  apply('open');
})();
</script>`;

  return { extraCss: TRACKER_CSS, body };
}

module.exports = { makeTrackerBody };
