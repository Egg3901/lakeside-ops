// replay-page.js — renders the OpenReplay analytics digest (data from replay-analytics.js).
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function num(n) {
  return Number(n || 0).toLocaleString();
}
function shortPath(p) {
  const s = String(p || "—").replace(/^https?:\/\/[^/]+/, "");
  return s.length > 46 ? s.slice(0, 44) + "…" : s;
}
const BOT_SET = new Set(["Applebot", "Googlebot", "bingbot", "PetalBot", "YandexBot", "GPTBot"]);

const REPLAY_CSS = `
.rp-wrap{max-width:1180px;margin:0 auto;padding:var(--s-6,24px) var(--s-4,16px) 72px}
.rp-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin-bottom:8px}
.rp-title{display:flex;align-items:center;gap:11px}.rp-mark{display:grid;place-items:center;width:36px;height:36px;border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));border-radius:11px;background:var(--accent-soft);color:var(--accent)}
.rp-head h1{font-size:1.35rem;font-weight:750;letter-spacing:-.015em;margin:0}
.rp-sub{color:var(--text-3);font-size:.82rem}
.rp-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0 26px}
.rp-tile{border:1px solid var(--border);border-radius:var(--r-md,14px);background:linear-gradient(145deg,var(--surface),var(--glass-1,var(--surface)));padding:15px 17px;box-shadow:var(--e1),var(--hi)}
.rp-tile .k{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-3)}
.rp-tile .v{font-size:1.5rem;font-weight:750;margin-top:3px;font-variant-numeric:tabular-nums}
.rp-tile .h{font-size:.74rem;color:var(--text-3);margin-top:2px}
.rp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.rp-card{border:1px solid var(--border);border-radius:var(--r-md,14px);background:var(--surface);overflow:hidden;box-shadow:var(--e1),var(--hi)}
.rp-card h2{font-size:.82rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-2);margin:0;padding:13px 16px 9px}
.rp-card.warn h2{color:#ffb86b}
table.rp{width:100%;border-collapse:collapse;font-size:.85rem}
table.rp th,table.rp td{padding:7px 16px;text-align:right;border-top:1px solid var(--border);white-space:nowrap}
table.rp th{font-size:.68rem;text-transform:uppercase;letter-spacing:.04em;color:var(--text-3);font-weight:600;border-top:none}
table.rp td:first-child,table.rp th:first-child{text-align:left;font-family:var(--mono,ui-monospace,monospace)}
table.rp td{font-variant-numeric:tabular-nums}
table.rp tr td .bot{font-size:.62rem;color:#ff8a8a;border:1px solid color-mix(in srgb,#e5484d 40%,transparent);border-radius:5px;padding:0 5px;margin-left:6px}
.rp-bars{padding:6px 16px 14px;display:flex;flex-direction:column;gap:7px}
.rp-bar{display:grid;grid-template-columns:120px 1fr 52px;align-items:center;gap:8px;font-size:.8rem}
.rp-bar .lbl{color:var(--text-2)}
.rp-bar .track{height:9px;background:var(--glass-2,#222);border-radius:5px;overflow:hidden}
.rp-bar .fill{height:100%;border-radius:5px;background:var(--accent)}
.rp-bar.friction .fill{background:#f5a623}
.rp-bar .n{text-align:right;font-variant-numeric:tabular-nums;color:var(--text-2)}
.rp-note{font-size:.78rem;color:var(--text-3);margin-top:18px;line-height:1.6;border-left:3px solid var(--border);padding-left:12px}
.rp-actions{display:flex;gap:8px;margin-left:auto}
.rp-btn{font-size:.76rem;border:1px solid var(--border);background:var(--surface);color:var(--text-2);border-radius:9px;padding:6px 10px;text-decoration:none}
.rp-btn.on{border-color:var(--accent);color:var(--accent)}
.rp-btn.primary{border-color:var(--accent);background:var(--accent);color:white;font-weight:650}
@media(max-width:640px){.rp-actions{width:100%;margin-left:0;overflow:auto}.rp-grid{grid-template-columns:1fr}.rp-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.rp-bar{grid-template-columns:94px 1fr 42px}}
`;

function tileRow(d) {
  const o = d.overview || {},
    e = d.engagement || {};
  const tiles = [
    ["Human sessions", num(o.humanSessions), `${num(o.botSessions)} bots excluded`],
    ["Unique users", num(o.users), ""],
    ["Median session", (e.median_sec != null ? Math.round(e.median_sec) + "s" : "—"), `avg ${e.avg_sec ? Math.round(e.avg_sec / 60) + "m" : "—"}`],
    ["Pages / session", e.avg_pages ?? "—", `${e.avg_events ?? "—"} events`],
    ["Friction signals", num((d.issues.find((i) => i.type === "click_rage")?.n || 0) + (d.issues.find((i) => i.type === "dead_click")?.n || 0)), "rage + dead clicks"],
  ];
  return `<div class="rp-tiles">${tiles.map((t) => `<div class="rp-tile"><div class="k">${esc(t[0])}</div><div class="v">${esc(t[1])}</div><div class="h">${esc(t[2])}</div></div>`).join("")}</div>`;
}

function pageTable(title, rows, valKey, valLabel) {
  if (!rows.length) return "";
  return `<div class="rp-card"><h2>${esc(title)}</h2><table class="rp"><thead><tr><th>Path</th><th>${esc(valLabel)}</th><th>Sessions</th></tr></thead><tbody>${rows
    .map((r) => `<tr><td>${esc(shortPath(r.path))}</td><td>${num(r[valKey])}</td><td>${num(r.sessions)}</td></tr>`)
    .join("")}</tbody></table></div>`;
}

function frictionBars(rows) {
  if (!rows.length) return "";
  const max = Math.max(...rows.map((r) => Number(r.n)), 1);
  return `<div class="rp-card warn"><h2>Frustration hotspots</h2><div class="rp-bars">${rows
    .map((r) => `<div class="rp-bar friction"><span class="lbl">${esc(shortPath(r.url))}</span><span class="track"><span class="fill" style="width:${Math.round((Number(r.n) / max) * 100)}%"></span></span><span class="n">${num(r.n)}</span></div>`)
    .join("")}</div></div>`;
}

function issueBars(rows) {
  if (!rows.length) return "";
  const max = Math.max(...rows.map((r) => Number(r.n)), 1);
  return `<div class="rp-card"><h2>Issues by type</h2><div class="rp-bars">${rows
    .map((r) => `<div class="rp-bar"><span class="lbl">${esc(r.type)}</span><span class="track"><span class="fill" style="width:${Math.round((Number(r.n) / max) * 100)}%"></span></span><span class="n">${num(r.n)}</span></div>`)
    .join("")}</div></div>`;
}

function deviceTable(rows) {
  if (!rows.length) return "";
  return `<div class="rp-card"><h2>Device · Browser · OS</h2><table class="rp"><thead><tr><th>Device</th><th>Browser</th><th>OS</th><th>Sessions</th></tr></thead><tbody>${rows
    .map(
      (r) =>
        `<tr><td>${esc(r.dev)}</td><td>${esc(r.br)}${BOT_SET.has(r.br) ? '<span class="bot">BOT</span>' : ""}</td><td>${esc(r.os)}</td><td>${num(r.n)}</td></tr>`
    )
    .join("")}</tbody></table></div>`;
}

function renderReplayDigest(d, opts) {
  const win = (opts && opts.window) || "all";
  const btn = (w, label) => `<a class="rp-btn${win === w ? " on" : ""}" href="/replay${w === "all" ? "" : "?window=" + w}">${label}</a>`;
  const body = `<div class="rp-wrap">
  <div class="rp-head">
    <div class="rp-title"><span class="rp-mark" aria-hidden="true">▶</span><div><h1>Replay analytics</h1><div class="rp-sub">${esc(d.overview.first || "")} → ${esc(d.overview.last || "")} · ${esc(d.window)}</div></div></div>
    <div class="rp-actions">${btn("all", "All time")}${btn("168", "7 days")}${btn("24", "24 hours")}<a class="rp-btn primary" href="https://replay.lakesidegames.net" target="_blank" rel="noopener">Watch sessions ↗</a></div>
  </div>
  ${tileRow(d)}
  <div class="rp-grid">
    ${pageTable("Top pages by clicks", d.topClicks, "clicks", "Clicks")}
    ${pageTable("Top pages by views", d.topViews, "views", "Views")}
    ${frictionBars(d.friction)}
    ${issueBars(d.issues)}
    ${deviceTable(d.devices)}
    ${d.errors.length ? `<div class="rp-card"><h2>JS errors by page</h2><table class="rp"><thead><tr><th>Path</th><th>Errors</th></tr></thead><tbody>${d.errors.map((r) => `<tr><td>${esc(shortPath(r.path))}</td><td>${num(r.n)}</td></tr>`).join("")}</tbody></table></div>` : ""}
  </div>
  <div class="rp-note">Aggregated from ${num(d.overview.sessions)} recorded sessions. Automated traffic is excluded from human-session totals. Open an individual recording for visual playback and network, console, and performance context. Generated ${esc(new Date(d.generatedAt).toISOString().replace("T", " ").slice(0, 16))} UTC.</div>
</div>`;
  return { extraCss: REPLAY_CSS, body };
}

// ── Weekly archived report: a self-contained standalone HTML document ──
function pct(a, b) {
  a = Number(a || 0);
  b = Number(b || 0);
  if (!b) return null;
  return Math.round(((a - b) / b) * 100);
}
function delta(a, b) {
  const p = pct(a, b);
  if (p == null) return '<span style="color:#8b938d">no prior week</span>';
  const up = p >= 0;
  return `<span style="color:${up ? "#2f9e59" : "#d0574a"}">${up ? "▲" : "▼"} ${Math.abs(p)}%</span>`;
}
function rows2(rows, cols) {
  return rows
    .map((r) => `<tr>${cols.map((c) => `<td class="${c.cls || ""}">${c.fmt ? c.fmt(r[c.k], r) : esc(r[c.k])}</td>`).join("")}</tr>`)
    .join("");
}

function renderReplayReport(r) {
  const o = r.overview || {},
    e = r.engagement || {},
    w = r.weekOverWeek || {};
  const issue = (t) => r.issues.find((i) => i.type === t)?.n || 0;
  const hoursMax = Math.max(...(r.busiestHours || []).map((h) => Number(h.sessions)), 1);
  const hourBars = (r.busiestHours || [])
    .map((h) => `<div class="hr"><span class="hn">${String(h.hour).padStart(2, "0")}h</span><span class="ht"><span class="hf" style="height:${Math.round((Number(h.sessions) / hoursMax) * 100)}%"></span></span></div>`)
    .join("");
  const label = new Date(r.generatedAt).toISOString().slice(0, 10);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex">
<title>Weekly Replay Report — ${esc(label)}</title>
<style>
:root{--bg:#f6f7f5;--panel:#fff;--ink:#171a16;--ink2:#5b625a;--ink3:#8b938d;--hair:#e3e6e0;--accent:#2f6d6a;--warn:#b0731c;--crit:#b13a2c;--good:#2f7d54;--mono:ui-monospace,"SF Mono",Menlo,monospace;--sans:system-ui,-apple-system,"Segoe UI",sans-serif;--serif:Georgia,"Iowan Old Style",serif}
@media(prefers-color-scheme:dark){:root{--bg:#101312;--panel:#181b1a;--ink:#e7eae6;--ink2:#9aa4a0;--ink3:#6f7a75;--hair:#272d2b;--accent:#4db3ac;--warn:#dca94f;--crit:#e0685a;--good:#5cc78a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55}
.wrap{max-width:920px;margin:0 auto;padding:32px 20px 80px}
h1{font-family:var(--serif);font-size:28px;margin:0 0 2px;letter-spacing:-.01em}
.sub{color:var(--ink3);font-size:13px;font-family:var(--mono)}
h2{font-family:var(--serif);font-size:19px;margin:34px 0 10px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}
.tile{border:1px solid var(--hair);border-radius:12px;background:var(--panel);padding:13px 15px}
.tile .k{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3)}
.tile .v{font-size:1.5rem;font-weight:750;margin-top:2px;font-variant-numeric:tabular-nums}
.tile .d{font-size:.74rem;margin-top:2px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:680px){.grid{grid-template-columns:1fr}}
.card{border:1px solid var(--hair);border-radius:12px;background:var(--panel);overflow:hidden}
.card h3{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--ink2);margin:0;padding:12px 15px 8px;font-family:var(--sans);font-weight:700}
.card.warn h3{color:var(--warn)}
table{width:100%;border-collapse:collapse;font-size:.83rem}
th,td{padding:6px 15px;text-align:right;border-top:1px solid var(--hair);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px}
th{font-size:.66rem;text-transform:uppercase;letter-spacing:.04em;color:var(--ink3);font-weight:600;border-top:none}
td:first-child,th:first-child{text-align:left;font-family:var(--mono);font-size:.78rem}
td{font-variant-numeric:tabular-nums}
.hours{display:flex;gap:3px;align-items:flex-end;height:70px;padding:10px 15px 6px}
.hr{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px}
.hr .ht{width:100%;height:52px;background:var(--bg);border-radius:3px;display:flex;align-items:flex-end}
.hr .hf{width:100%;background:var(--accent);border-radius:3px}
.hr .hn{font-size:.5rem;color:var(--ink3);font-family:var(--mono)}
.note{font-size:.78rem;color:var(--ink3);margin-top:22px;border-left:3px solid var(--hair);padding-left:12px;line-height:1.6}
.chips{display:flex;flex-wrap:wrap;gap:6px;padding:4px 15px 14px}
.chip{font-size:.74rem;border:1px solid var(--hair);border-radius:7px;padding:3px 9px;color:var(--ink2)}
.chip b{color:var(--ink);font-variant-numeric:tabular-nums}
</style></head><body><div class="wrap">
<h1>📹 Weekly Replay Report</h1>
<div class="sub">${esc(o.first || "")} → ${esc(o.last || "")} · generated ${esc(new Date(r.generatedAt).toISOString().replace("T", " ").slice(0, 16))} UTC</div>
<div class="tiles">
  <div class="tile"><div class="k">Human sessions</div><div class="v">${num(o.humanSessions)}</div><div class="d">${delta(w.this_period, w.prev_period)} vs prior wk</div></div>
  <div class="tile"><div class="k">Unique users</div><div class="v">${num(o.users)}</div><div class="d">${num(o.botSessions)} bots filtered</div></div>
  <div class="tile"><div class="k">Median session</div><div class="v">${e.median_sec != null ? Math.round(e.median_sec) + "s" : "—"}</div><div class="d">avg ${w.this_dur ? Math.round(w.this_dur / 60) + "m" : "—"} · ${delta(w.this_dur, w.prev_dur)}</div></div>
  <div class="tile"><div class="k">Pages / session</div><div class="v">${e.avg_pages ?? "—"}</div><div class="d">${e.avg_events ?? "—"} events</div></div>
</div>

<h2>Where users go</h2>
<div class="grid">
  <div class="card"><h3>🔥 Top pages by clicks</h3><table><thead><tr><th>Path</th><th>Clicks</th><th>Sessions</th></tr></thead><tbody>${rows2(r.topClicks, [{ k: "path", fmt: shortPath }, { k: "clicks", fmt: num }, { k: "sessions", fmt: num }])}</tbody></table></div>
  <div class="card"><h3>👁 Top pages by views</h3><table><thead><tr><th>Path</th><th>Views</th><th>Sessions</th></tr></thead><tbody>${rows2(r.topViews, [{ k: "path", fmt: shortPath }, { k: "views", fmt: num }, { k: "sessions", fmt: num }])}</tbody></table></div>
  <div class="card"><h3>🚪 Entry pages (session starts)</h3><table><thead><tr><th>Path</th><th>Sessions</th></tr></thead><tbody>${rows2(r.entryPages, [{ k: "path", fmt: shortPath }, { k: "sessions", fmt: num }])}</tbody></table></div>
  <div class="card"><h3>👆 Most-clicked elements</h3><table><thead><tr><th>Element (path)</th><th>Clicks</th></tr></thead><tbody>${rows2(r.topElements, [{ k: "element", fmt: (v, row) => esc(shortPath(row.path)) + " · " + esc(String(v).slice(0, 40)) }, { k: "clicks", fmt: num }])}</tbody></table></div>
</div>

<h2>Friction &amp; frustration</h2>
<div class="grid">
  <div class="card warn"><h3>😤 Mouse-thrashing by page</h3><table><thead><tr><th>Page</th><th>Events</th></tr></thead><tbody>${rows2(r.friction, [{ k: "url", fmt: shortPath }, { k: "n", fmt: num }])}</tbody></table></div>
  <div class="card"><h3>Top rage / dead-click targets</h3><table><thead><tr><th>Type · selector</th><th>n</th></tr></thead><tbody>${rows2(r.rageSelectors, [{ k: "selector", fmt: (v, row) => esc(row.type) + " · " + esc(String(v).slice(0, 44)) }, { k: "n", fmt: num }])}</tbody></table></div>
</div>
<div class="card" style="margin-top:14px"><h3>Issue totals (7d)</h3><div class="chips">${r.issues.map((i) => `<span class="chip">${esc(i.type)} <b>${num(i.n)}</b></span>`).join("")}</div></div>

<h2>Audience &amp; timing</h2>
<div class="grid">
  <div class="card"><h3>Device · Browser · OS</h3><table><thead><tr><th>Device</th><th>Browser</th><th>OS</th><th>n</th></tr></thead><tbody>${rows2(r.devices, [{ k: "dev" }, { k: "br", fmt: (v) => esc(v) + (BOT_SET.has(v) ? " 🤖" : "") }, { k: "os" }, { k: "n", fmt: num }])}</tbody></table></div>
  <div class="card"><h3>Sessions by hour (UTC)</h3><div class="hours">${hourBars}</div></div>
</div>
${r.errors.length ? `<h2>Errors</h2><div class="card"><h3>JS errors by page</h3><table><thead><tr><th>Path</th><th>Errors</th></tr></thead><tbody>${rows2(r.errors, [{ k: "path", fmt: shortPath }, { k: "n", fmt: num }])}</tbody></table></div>` : ""}

<div class="note">Aggregated from ${num(o.sessions)} recorded sessions (OpenReplay ClickHouse) over the trailing ${Math.round((r.periodHours || 168) / 24)} days. Bot user-agents excluded from human counts. Element/selector labels are raw CSS-class chains (no visual click-map without the session player). Week-over-week compares against the prior equal window. Live view: /replay.</div>
</div></body></html>`;
}

module.exports = { renderReplayDigest, renderReplayReport, REPLAY_CSS };
