"use strict";
const $ = id => document.getElementById(id);
let selected = "main", cursor = 0, version = "", stopped = true, generation = 0;
function error(e) { $("error").textContent = e.message; $("error").hidden = false; }
async function api(route, body, signal) {
  const r = await fetch(route, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal });
  const data = await r.json(); if (!r.ok) { if (r.status === 401 && route !== "/api/login") signedOut(); throw new Error(data.error || "Request failed"); } return data;
}
function signedOut() { stopped = true; generation++; $("workspace").hidden = true; $("login").hidden = false; }
async function connected() {
  const me = await api("/api/me"); $("identity").textContent = me.email;
  $("workspace").hidden = false; $("login").hidden = true; $("password").value = ""; $("error").hidden = true;
  stopped = false; await threads(); select("main");
}
async function threads() {
  const result = await api("/api/keir/app/threads"); $("threads").replaceChildren();
  for (const row of result.threads || []) {
    if (row.id === "watches" || row.archived) continue;
    const b = document.createElement("button"); b.textContent = row.title; b.dataset.thread = row.id; b.setAttribute("aria-current", String(row.id === selected));
    b.onclick = () => select(row.id, row.title); $("threads").append(b);
  }
}
function select(id, title = "Keir") {
  selected = id; cursor = 0; version = ""; $("title").textContent = title; $("messages").replaceChildren(); $("tasks").replaceChildren();
  for (const b of $("threads").children) b.setAttribute("aria-current", String(b.dataset.thread === id));
  const run = ++generation; poll(run);
}
async function poll(run) {
  while (!stopped && run === generation) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 32000);
    try {
      const q = new URLSearchParams({ thread: selected, after: String(cursor), since: version, wait: version ? "25" : "0" });
      const view = await api(`/api/keir/app/thread?${q}`, null, controller.signal);
      if (run !== generation) return;
      for (const row of view.messages || []) { const a = document.createElement("article"), author = document.createElement("strong"); a.className = row.role; author.textContent = row.role === "owner" ? "You" : "Keir"; a.append(author, document.createTextNode(row.text)); $("messages").append(a); }
      if (view.messages?.length) $("messages").scrollTop = $("messages").scrollHeight;
      cursor = view.cursor; version = view.version; $("connection").textContent = view.working ? "Working" : "Connected";
      $("tasks").replaceChildren();
      for (const task of view.tasks || []) {
        const div = document.createElement("div"), label = document.createElement("span"), stop = document.createElement("button"); div.className = "task";
        label.textContent = `${task.state}: ${task.status || task.title}`; stop.textContent = "Stop";
        stop.onclick = () => api("/api/keir/app/cancel", { taskId: task.id }).catch(error); div.append(label, stop); $("tasks").append(div);
      }
    } catch (e) { if (run !== generation || stopped) return; $("connection").textContent = "Reconnecting"; if (e.name !== "AbortError") error(e); await new Promise(r => setTimeout(r, 3000)); }
    finally { clearTimeout(timeout); }
  }
}
$("signin").onsubmit = async e => { e.preventDefault(); const b = e.submitter; b.disabled = true; try { await api("/api/login", { password: $("password").value, email: $("email").value }); await connected(); } catch (e) { error(e); } finally { b.disabled = false; } };
$("logout").onclick = async () => { try { await api("/api/logout", {}); signedOut(); } catch (e) { error(e); } };
$("new-thread").onclick = async () => { const title = prompt("Conversation title"); if (!title?.trim()) return; try { const row = await api("/api/keir/app/threads", { title }); await threads(); select(row.id, row.title); } catch (e) { error(e); } };
let pending = null;
$("compose").onsubmit = async e => { e.preventDefault(); const text = $("message").value.trim(); if (!text) return; const b = e.submitter; b.disabled = true;
  if (!pending || pending.text !== text || pending.thread !== selected) pending = { text, thread: selected, clientId: crypto.randomUUID(), mode: "new" };
  try { await api("/api/keir/app/messages", pending); pending = null; $("message").value = ""; $("error").hidden = true; } catch (e) { error(e); } finally { b.disabled = false; }
};
api("/api/portal/config").then(config => {
  if (config.mode === "lakeside") {
    $("email-label").hidden = config.auth !== "password";
    $("signin").hidden = config.auth === "sso"; $("sso").hidden = config.auth !== "sso";
  }
}).catch(error);
connected().catch(e => { if (!$("login").hidden) return; error(e); });
