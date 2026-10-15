// games-page.js — the Lakeside Games hub: one card per game (from
// games-config.js, the single source of truth) with live server-side health
// results. Returns { extraCss, body } for renderShell, same contract as
// observatory-page.js / engine-page.js.

function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

const GAMES_CSS = `
.gh-wrap{max-width:1000px;margin:0 auto;padding:var(--s-5,24px) var(--s-4,16px);display:flex;flex-direction:column;gap:16px}
.gh-head h1{font-size:1.4rem;font-weight:700;letter-spacing:-.02em;margin:0}
.gh-sub{color:var(--text-3);font-size:.85rem;margin-top:2px}
.gh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--s-4,16px)}
.gh-card{position:relative;border:1px solid var(--border);border-top:3px solid var(--gh-accent,var(--accent));border-radius:var(--r-lg,14px);background:var(--surface);box-shadow:var(--e1),var(--hi);padding:var(--s-5,20px);display:flex;flex-direction:column;gap:10px}
.gh-card .gh-top{display:flex;align-items:center;gap:10px}
.gh-card h3{font-size:1.05rem;font-weight:700;margin:0}
.gh-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;margin-left:auto}
.gh-dot.ok{background:var(--ok,#34d399);box-shadow:0 0 7px var(--ok,#34d399)}
.gh-dot.bad{background:var(--danger,#e5484d);box-shadow:0 0 7px var(--danger,#e5484d)}
.gh-tag{color:var(--text-2);font-size:.85rem;line-height:1.5;flex:1}
.gh-checks{display:flex;flex-direction:column;gap:4px}
.gh-check{display:flex;align-items:center;justify-content:space-between;font-size:.78rem;color:var(--text-2);font-family:var(--mono);padding:.28rem .5rem;border-radius:var(--r-sm,8px);background:var(--glass-2)}
.gh-check .st{font-weight:700}
.gh-check .st.ok{color:var(--ok,#34d399)}.gh-check .st.bad{color:var(--danger,#e5484d)}
.gh-meta{font-size:.72rem;color:var(--text-3);font-family:var(--mono)}
.gh-visit{display:inline-flex;align-items:center;gap:.35rem;align-self:flex-start;color:var(--gh-accent,var(--accent));font-size:.82rem;font-weight:600}
`;

function makeGamesBody({ games, results, extraInfo = {} }) {
  const byKey = Object.fromEntries((results || []).map((r) => [r.key, r]));
  const cards = games
    .map((g) => {
      const r = byKey[g.key];
      const ok = !!(r && r.ok);
      const checks = (r ? r.checks : [])
        .map((c) => `<div class="gh-check"><span>${esc(c.label)}</span><span class="st ${c.ok ? "ok" : "bad"}">${c.ok ? (c.status + " · " + c.ms + "ms") : esc(c.reason || "HTTP " + c.status)}</span></div>`)
        .join("") || `<div class="gh-check"><span>check</span><span class="st bad">no result</span></div>`;
      const info = extraInfo[g.key] ? `<div class="gh-meta">${esc(extraInfo[g.key])}</div>` : "";
      return `<div class="gh-card" style="--gh-accent:${g.accent}">
        <div class="gh-top"><h3>${esc(g.name)}</h3><span class="gh-dot ${ok ? "ok" : "bad"}" title="${ok ? "healthy" : "degraded"}"></span></div>
        <p class="gh-tag">${esc(g.tagline)}</p>
        <div class="gh-checks">${checks}</div>
        ${info}
        <a class="gh-visit" href="${g.publicUrl}" target="_blank" rel="noopener">Visit ${esc(g.publicUrl.replace(/^https?:\/\//, ""))} →</a>
      </div>`;
    })
    .join("");
  const body = `<div class="gh-wrap">
    <div class="gh-head"><h1>Games</h1><div class="gh-sub">The Lakeside Games portfolio — live health, checked server-side just now. Edit the roster in <code>games-config.js</code>.</div></div>
    <div class="gh-grid">${cards}</div>
  </div>`;
  return { extraCss: GAMES_CSS, body };
}

module.exports = { makeGamesBody };
