"use strict";

// Embedded in the hub client. All ledger text is rendered through textContent.
function createWatchPanel(root, { onJob = () => {} } = {}) {
  const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = String(text); return n; };
  const age = (at) => { if (!at) return "never"; const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000)); return minutes < 1 ? "just now" : minutes < 60 ? minutes + "m ago" : minutes < 1440 ? Math.floor(minutes / 60) + "h ago" : Math.floor(minutes / 1440) + "d ago"; };
  const link = (label, href) => {
    try { const u = new URL(href, location.origin); if (!((u.origin === location.origin && u.pathname === "/kanban") || (u.protocol === "https:" && u.hostname === "github.com"))) return null; const a = el("a", "kw-link", label); a.href = u.href; if (u.origin !== location.origin) { a.target = "_blank"; a.rel = "noopener noreferrer"; } return a; } catch { return null; }
  };
  const append = (parent, nodes) => nodes.filter(Boolean).forEach((n) => parent.append(n));
  let state = null, signature = null, filter = "open", sensor = "all", query = "";
  const expanded = new Set();
  const head = el("div", "kh-ph");
  const heading = el("h2", "", "Watch"); heading.append(el("small", "", "proactive game monitoring"));
  const mode = el("span", "kw-mode"); append(head, [heading, mode]);
  const notice = el("p", "kw-notice"); notice.setAttribute("role", "status");
  const metrics = el("div", "kw-metrics");
  const body = el("div", "kw-body");
  const sensors = el("div", "kw-sensors");
  const right = el("div", "kw-findings");
  const tools = el("div", "kw-tools");
  const filters = el("div", "kh-seg"); filters.setAttribute("aria-label", "Filter findings");
  for (const [value, label] of [["open", "Open"], ["severe", "Severe"], ["deferred", "Deferred"], ["all", "All"]]) {
    const b = el("button", value === filter ? "on" : "", label); b.type = "button"; b.dataset.filter = value; b.setAttribute("aria-pressed", String(value === filter));
    b.onclick = () => { filter = value; [...filters.children].forEach((n) => { n.classList.toggle("on", n === b); n.setAttribute("aria-pressed", String(n === b)); }); drawFindings(); };
    filters.append(b);
  }
  const search = el("input", "kh-search"); search.type = "search"; search.placeholder = "Search findings"; search.setAttribute("aria-label", "Search monitoring findings"); search.oninput = () => { query = search.value.toLowerCase().trim(); drawFindings(); };
  const list = el("div", "kw-list");
  const count = el("p", "kw-count"); count.setAttribute("aria-live", "polite");
  append(tools, [filters, search]); append(right, [tools, count, list]); append(body, [sensors, right]);
  const policy = el("div", "kw-policy");
  root.replaceChildren(head, notice, metrics, body, policy);

  function drawFindings() {
    if (!state) return;
    const rows = (state.findings || []).filter((f) => (filter === "all" || (filter === "open" ? f.state !== "resolved" : filter === "severe" ? f.severe && f.state !== "resolved" : f.deferredAt && !f.job && f.state !== "resolved")) && (sensor === "all" || f.sensor === sensor) && (!query || `${f.title} ${f.evidence} ${f.sensor}`.toLowerCase().includes(query)));
    count.textContent = rows.length + " finding" + (rows.length === 1 ? "" : "s") + (sensor === "all" ? "" : " from " + sensor) + (state.hiddenFindings ? "; " + state.hiddenFindings + " older records omitted" : "");
    list.replaceChildren();
    if (!rows.length) { list.append(el("p", "kh-empty", state.available ? "No findings match these filters." : "No monitoring history yet.")); return; }
    for (const f of rows) {
      const row = el("details", "kw-finding" + (f.severe ? " severe" : "")); row.open = expanded.has(f.fp);
      row.addEventListener("toggle", () => { if (row.open) expanded.add(f.fp); else expanded.delete(f.fp); });
      const summary = el("summary");
      const title = el("span", "kw-finding-title", f.title);
      const meta = el("span", "kw-finding-meta", [f.severe ? "Severe" : f.hard ? "Hard signal" : "Repeated signal", f.sensor, f.state, f.job?.state, "last seen " + age(f.lastSeen)].filter(Boolean).join(" · "));
      append(summary, [title, meta]); row.append(summary);
      const detail = el("div", "kw-evidence");
      detail.append(el("pre", "", f.evidence || "No evidence recorded."));
      if (f.job?.summary) detail.append(el("p", "", f.job.summary));
      const links = el("div", "kw-links");
      append(links, [f.issue && link("Issue #" + f.issue.number, f.issue.url), f.kanban && link("Kanban #" + f.kanban.id, f.kanban.url), ...(f.pullRequests || []).map((u) => link("Fix PR #" + u.split("/").pop(), u))]);
      if (f.job?.id) { const b = el("button", "kw-link", "Open task"); b.type = "button"; b.onclick = () => onJob(f.job.id); links.append(b); }
      if (f.repairs?.length) detail.append(el("p", "kw-manual", f.repairs.length + " repair specification" + (f.repairs.length === 1 ? "" : "s") + " prepared for manual review. This monitor cannot apply them."));
      append(detail, [links, el("span", "kw-finding-meta", "First seen " + age(f.firstSeen) + (f.raisedAt ? "; task raised " + age(f.raisedAt) : "") + (f.deferredAt && !f.job ? "; waiting for monitoring budget" : ""))]);
      row.append(detail); list.append(row);
    }
  }

  function update(next) {
    const key = JSON.stringify(next);
    if (next !== state && key === signature) return;
    signature = key;
    state = next || { available: false, mode: "unavailable", sensors: [], findings: [], budget: {}, score: {} };
    mode.textContent = state.mode === "report" ? "Report only" : state.mode === "off" ? "Off" : !state.available ? "Awaiting release" : "Active";
    mode.dataset.mode = state.mode;
    notice.textContent = !state.available ? "This operator has no watch history yet. Monitoring appears after the Keir 5.0 release." : state.paused ? "The operator is paused. These are the last recorded observations." : state.mode === "report" ? "Shadow monitoring records evidence without starting finding tasks or staff proposals." : state.mode === "off" ? "Monitoring is disabled. Previous findings remain visible." : "Signals are checked automatically. Findings are confirmed before filing or preparing a fix.";
    metrics.replaceChildren();
    const budget = state.budget || {}, score = state.score || {};
    const open = state.openFindings ?? (state.findings || []).filter((f) => f.state !== "resolved").length;
    for (const [label, value, note] of [["Open findings", open, (state.findings || []).filter((f) => f.severe && f.state !== "resolved").length + " severe"], ["New tasks this hour", `${budget.hourUsed || 0} / ${budget.perHour || 3}`, `${budget.dayUsed || 0} / ${budget.perDay || 8} today`], ["Caught before a report", score.caughtFirst || 0, `${score.playerFirst || 0} player first`], ["Confirmed caught-first share", score.share == null ? "No sample" : score.share + "%", "Compared when a later report links the issue"]]) {
      const item = el("div", "kw-metric"); append(item, [el("span", "", label), el("strong", "", value), el("small", "", note)]); metrics.append(item);
    }
    sensors.replaceChildren();
    const all = el("button", "kw-sensor-all", sensor === "all" ? "All sensors" : "Clear sensor filter"); all.type = "button"; all.onclick = () => { sensor = "all"; update(state); }; sensors.append(all);
    for (const s of state.sensors || []) {
      const b = el("button", "kw-sensor" + (sensor === s.id ? " selected" : "")); b.type = "button"; b.setAttribute("aria-pressed", String(sensor === s.id));
      const line = el("span", "kw-sensor-line"); append(line, [el("b", "", s.label), el("span", "kw-health", s.status)]); line.lastChild.dataset.status = s.status;
      append(b, [line, el("small", "", "Last success " + age(s.lastSuccessAt) + " · " + (s.perTurn ? "each processed turn" : "every " + Math.round(s.cadenceMs / 60000) + "m"))]);
      if (s.error) b.append(el("small", "kw-error", s.error));
      b.onclick = () => { sensor = sensor === s.id ? "all" : s.id; update(state); }; sensors.append(b);
    }
    policy.replaceChildren();
    policy.append(el("b", "", "Policy boundaries"));
    policy.append(el("span", "", "Detect and confirm · Draft code fixes · Prepare manual repairs · Ship only own static display fixes · Egg or Ariane approves high-impact work"));
    const caps = state.capabilities;
    if (caps && state.available) {
      const receipts = el("details", "kw-audit"); receipts.append(el("summary", "", "Capability receipts, last 24 hours"));
      for (const [name, value] of [["Carried ticket approvals", caps.authorityCarried], ["Issues closed after deployment", caps.issuesClosedLive], ["Sentry issues resolved", caps.sentryResolved], ["Promotions held for owner hours", caps.heldPromotions], ["Sensor failures", caps.sensorFailures], ["Skill loading failures", caps.skillFailures]]) receipts.append(el("p", "", name + ": " + (value ?? 0)));
      if (caps.skills) receipts.append(el("p", "", "Last skill delivery: " + (caps.skills.disabled ? "disabled" : caps.skills.degraded ? "degraded" : "loaded") + ", " + caps.skills.lane + " lane, " + (caps.skills.names || []).length + " skills, " + caps.skills.chars.toLocaleString() + " characters. " + age(caps.skills.at)));
      receipts.append(el("small", "", "Counts cover retained ledger audit events; missing receipts do not prove a capability passed.")); policy.append(receipts);
    }
    if ((state.recent || []).length) {
      const log = el("details", "kw-audit"); log.append(el("summary", "", "Recent guard activity"));
      for (const a of state.recent.slice(0, 8)) log.append(el("p", "", age(a.at) + " · " + a.kind.replace(/_/g, " ") + (a.reason ? ": " + a.reason : "")));
      policy.append(log);
    }
    drawFindings();
  }
  return { update };
}

const WATCH_CSS = `
.kh-watch{overflow:hidden}.kw-mode{font-size:12px;font-weight:600;color:var(--text-2);border:1px solid var(--border);padding:4px 9px;border-radius:5px}.kw-mode[data-mode="report"]{color:var(--st-warn)}
.kw-notice{margin:0;padding:0 20px 16px;font-size:13px;line-height:1.5;color:var(--text-2)}.kw-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-block:1px solid var(--border)}.kw-metric{padding:16px 20px;border-right:1px solid var(--border);display:flex;flex-direction:column;gap:6px}.kw-metric:last-child{border:0}.kw-metric>span,.kw-metric small{font-size:11.5px;color:var(--text-3);line-height:1.4}.kw-metric strong{font-size:24px;font-weight:550;letter-spacing:-.6px;font-variant-numeric:tabular-nums}
.kw-body{display:grid;grid-template-columns:minmax(245px,.8fr) minmax(0,2fr)}.kw-sensors{padding:12px 16px;border-right:1px solid var(--border)}.kw-sensor-all{background:none;border:0;color:var(--text-2);font:inherit;font-size:12px;padding:7px 0;cursor:pointer}.kw-sensor{display:block;width:100%;text-align:left;background:transparent;color:inherit;border:0;border-bottom:1px solid var(--border);padding:12px 0;cursor:pointer}.kw-sensor.selected{box-shadow:inset 2px 0 var(--accent);padding-left:10px}.kw-sensor-line{display:flex;gap:10px;justify-content:space-between;align-items:center}.kw-sensor b{font-weight:550;font-size:12.5px}.kw-sensor small{display:block;margin-top:7px;font-size:11px;color:var(--text-3);line-height:1.5}.kw-sensor .kw-error{color:var(--st-crit);overflow-wrap:anywhere}.kw-health{font-size:11px;color:var(--text-3);text-transform:capitalize}.kw-health[data-status="healthy"]{color:var(--st-good)}.kw-health[data-status="error"],.kw-health[data-status="stale"]{color:var(--st-crit)}
.kw-findings{min-width:0;padding:16px 20px}.kw-tools{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap}.kw-tools .kh-search{min-width:130px;max-width:220px;flex:1}.kw-count{font-size:11px;color:var(--text-3);margin:12px 0}.kw-list{max-height:450px;overflow:auto}.kw-finding{border-top:1px solid var(--border);padding:12px 0}.kw-finding summary{cursor:pointer;list-style:none;padding-left:14px;position:relative}.kw-finding summary:before{content:'›';position:absolute;left:0;color:var(--text-3)}.kw-finding[open] summary:before{content:'⌄'}.kw-finding-title{display:block;font-size:13px;line-height:1.5;font-weight:550}.kw-finding.severe .kw-finding-title:before{content:'';display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--st-crit);vertical-align:middle;margin-right:7px}.kw-finding-meta{display:block;font-size:11px;color:var(--text-3);line-height:1.6;margin-top:5px}.kw-evidence{padding:12px 0 2px 14px}.kw-evidence pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11.5px;line-height:1.6;font-family:var(--font-mono,monospace);color:var(--text-2);margin:0}.kw-evidence p{font-size:12px;line-height:1.6;color:var(--text-2)}.kw-links{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}.kw-link{color:var(--accent);text-decoration:none;border:0;background:none;padding:0;font:inherit;font-size:12px;cursor:pointer}.kw-policy{border-top:1px solid var(--border);padding:14px 20px;display:flex;gap:8px;flex-wrap:wrap;font-size:11.5px;line-height:1.6;color:var(--text-3)}.kw-policy b{font-weight:550;color:var(--text-2)}.kw-audit{width:100%}.kw-audit summary{cursor:pointer}.kw-audit p{margin:6px 0}.kw-sensor:focus-visible,.kw-link:focus-visible,.kw-sensor-all:focus-visible,.kw-finding summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
@media(max-width:760px){.kw-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.kw-metric:nth-child(2){border-right:0}.kw-metric:nth-child(-n+2){border-bottom:1px solid var(--border)}.kw-body{grid-template-columns:1fr}.kw-sensors{border-right:0;border-bottom:1px solid var(--border);display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px}.kw-sensor-all{grid-column:1/-1;text-align:left}.kw-findings{padding:14px 16px}.kw-tools .kh-search{max-width:none}.kw-metric{padding:14px 16px}.kw-metric strong{font-size:21px}.kw-notice{padding-inline:16px}}
`;

module.exports = { createWatchPanel, WATCH_CSS };
