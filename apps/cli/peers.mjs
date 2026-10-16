import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import config from "./config.mjs";

export function loadPeers(env = process.env) {
  const file = config.locations(env).peers;
  if (!fs.existsSync(file) && !env.LAKESIDE_CODE_PEERS) return [];
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data)) throw new Error("Peer configuration must be an array");
  const seen = new Set();
  return data.map(peer => {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(peer.id) || seen.has(peer.id)) throw new Error("Peer ids must be unique lowercase names");
    seen.add(peer.id);
    if (!["opencode", "keir"].includes(peer.kind)) throw new Error(`Unsupported peer kind: ${peer.kind}`);
    const url = new URL(peer.url);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || !(url.protocol === "https:" || url.protocol === "http:" && local)) throw new Error(`Peer ${peer.id} needs an HTTPS origin or loopback HTTP`);
    if (peer.tokenEnv && !/^[A-Z][A-Z0-9_]*$/.test(peer.tokenEnv)) throw new Error("tokenEnv must name an environment variable");
    if (peer.allowSubmit !== undefined && typeof peer.allowSubmit !== "boolean") throw new Error("allowSubmit must be boolean");
    if (peer.directory !== undefined && (typeof peer.directory !== "string" || !peer.directory.startsWith("/") || /[\x00-\x1f]/.test(peer.directory))) throw new Error("Peer directory must be an absolute path on the peer machine");
    if (peer.model !== undefined && (typeof peer.model !== "string" || !/^[^/\s]+\/.+/.test(peer.model))) throw new Error("Peer model must be provider/model");
    return { id: peer.id, name: String(peer.name || peer.id).replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, 60), kind: peer.kind, url: url.origin, tokenEnv: peer.tokenEnv, directory: peer.directory, model: peer.model, allowSubmit: peer.allowSubmit === true };
  });
}

async function request(peer, endpoint, { body, signal, env = process.env, fetchImpl = fetch } = {}) {
  const token = peer.tokenEnv ? env[peer.tokenEnv] : undefined;
  if (peer.tokenEnv && !token) throw new Error(`Missing credential environment variable ${peer.tokenEnv}`);
  const headers = { ...(body ? { "Content-Type": "application/json" } : {}) };
  if (token) headers.Authorization = peer.kind === "keir" ? `Bearer ${token}` : `Basic ${Buffer.from(`opencode:${token}`).toString("base64")}`;
  const response = await fetchImpl(new URL(endpoint, peer.url), { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined, redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]) });
  if (!response.ok) throw Object.assign(new Error(`Peer ${peer.id} returned HTTP ${response.status}`), { status: response.status });
  return response.status === 204 ? null : response.json();
}

export async function inspectPeer(peer, options = {}) {
  try {
    if (peer.kind === "keir") {
      const view = await request(peer, "/api/keir/app/thread?after=0", options);
      if (!Array.isArray(view.tasks)) throw new Error("Unexpected task response");
      return { id: peer.id, name: peer.name, kind: peer.kind, state: "connected", tasks: view.tasks.map(task => ({ id: task.id, title: task.title, state: task.state, thread: task.thread, summary: task.status })), checkedAt: Date.now() };
    }
    const query = peer.directory ? `?directory=${encodeURIComponent(peer.directory)}` : "";
    const [sessions, status] = await Promise.all([request(peer, `/session${query}`, options), request(peer, `/session/status${query}`, options)]);
    if (!Array.isArray(sessions) || !status || typeof status !== "object") throw new Error("Unexpected session response");
    return { id: peer.id, name: peer.name, kind: peer.kind, state: "connected", tasks: sessions.slice(0, 12).map(session => ({ id: session.id, title: session.title, state: status[session.id]?.type || "idle" })), checkedAt: Date.now() };
  } catch (error) {
    return { id: peer.id, name: peer.name, kind: peer.kind, state: "offline", tasks: [], error: error.name === "TimeoutError" ? "Connection timed out" : error.message, checkedAt: Date.now() };
  }
}

export async function peerTask(peer, id, options = {}) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid remote task id");
  if (peer.kind === "keir") return request(peer, `/api/keir/app/tasks/${encodeURIComponent(id)}`, options);
  const query = peer.directory ? `?directory=${encodeURIComponent(peer.directory)}` : "";
  const [session, messages, statuses] = await Promise.all([request(peer, `/session/${encodeURIComponent(id)}${query}`, options), request(peer, `/session/${encodeURIComponent(id)}/message${query}`, options), request(peer, `/session/status${query}`, options)]);
  const last = messages.filter(message => message.info?.role === "assistant").at(-1)?.info;
  const activity = statuses[id]?.type || "idle";
  const state = activity !== "idle" ? "running" : last?.error ? last.error.name === "MessageAbortedError" ? "cancelled" : "failed" : last?.time?.completed && last.finish && last.finish !== "tool-calls" ? "done" : "waiting";
  return { session, messages, state };
}

function receiptDirectory(options = {}) { return options.stateDir || config.locations(options.env).handoffs; }
function saveReceipt(receipt, options = {}) {
  const dir = receiptDirectory(options);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  receipt.updatedAt = new Date().toISOString();
  const file = path.join(dir, `${receipt.id}.json`), temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temporary, file);
}
function readReceipt(id, options = {}) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid handoff id");
  return JSON.parse(fs.readFileSync(path.join(receiptDirectory(options), `${id}.json`), "utf8"));
}
export function listHandoffs(options = {}) {
  const dir = receiptDirectory(options);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(file => /^[a-f0-9-]{36}\.json$/.test(file)).map(file => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))).sort((a, b) => b.at.localeCompare(a.at));
}
function handoffText(spec) {
  return `Coding handoff\n\nGoal: ${spec.goal}\nRepository: ${spec.repository}\nBranch: ${spec.branch}\nBase commit: ${spec.base}\nAllowed scope: ${spec.scope}\nReturn: ${spec.deliverable}\n\nWork in a separate worktree. Return findings, a commit/PR or a patch against the stated base. Report actual completion and validation evidence.`;
}
function writable(peer) {
  if (!peer.allowSubmit) throw new Error(`Peer ${peer.id} is read-only; explicitly enable allowSubmit to hand off work`);
}
function binding(peer, receipt) {
  if (receipt.peer !== peer.id || receipt.peerUrl !== peer.url || receipt.kind !== peer.kind || receipt.directory !== (peer.directory || null)) throw new Error("Peer target changed since dispatch; inspect the original receipt before continuing");
}
function directoryQuery(peer) { return peer.directory ? `?directory=${encodeURIComponent(peer.directory)}` : ""; }
async function sendKeir(peer, receipt, options) {
  const result = await request(peer, "/api/keir/app/messages", { ...options, body: { text: handoffText(receipt.spec), thread: receipt.spec.thread || "main", clientId: receipt.id, mode: "new" } });
  if (!result?.jobId) throw new Error("Peer returned no durable job id");
  receipt.taskId = result.jobId;
}

// Each dispatch has durable identity before network I/O. Recovery inspects
// that identity instead of silently starting replacement work.
export async function handoff(peer, spec, options = {}) {
  writable(peer);
  for (const key of ["goal", "repository", "branch", "base", "scope", "deliverable"]) if (typeof spec[key] !== "string" || !spec[key].trim()) throw new Error(`Handoff requires ${key}`);
  if (handoffText(spec).length > 6000) throw new Error("Handoff exceeds the peer's message limit");
  if (peer.kind === "opencode" && !peer.directory) throw new Error("OpenCode handoffs require an explicit peer directory (use a separate worktree)");
  const id = crypto.randomUUID();
  const receipt = { id, peer: peer.id, peerUrl: peer.url, kind: peer.kind, directory: peer.directory || null, state: "dispatching", at: new Date().toISOString(), spec, messageId: `msg_${crypto.randomBytes(16).toString("hex")}` };
  saveReceipt(receipt, options);
  try {
    if (peer.kind === "keir") await sendKeir(peer, receipt, options);
    else {
      const session = await request(peer, `/session${directoryQuery(peer)}`, { ...options, body: { title: `Lakeside handoff ${id}` } });
      if (!session?.id) throw new Error("Peer returned no session id");
      receipt.taskId = session.id;
      saveReceipt(receipt, options);
      const model = peer.model ? { providerID: peer.model.slice(0, peer.model.indexOf("/")), modelID: peer.model.slice(peer.model.indexOf("/") + 1) } : undefined;
      await request(peer, `/session/${encodeURIComponent(session.id)}/prompt_async${directoryQuery(peer)}`, { ...options, body: { messageID: receipt.messageId, parts: [{ type: "text", text: handoffText(spec) }], ...(model ? { model } : {}) } });
    }
    receipt.state = "accepted";
  } catch (error) { receipt.state = "uncertain"; receipt.error = error.message; }
  saveReceipt(receipt, options);
  return receipt;
}

export async function reconcileHandoff(peer, id, options = {}) {
  const receipt = readReceipt(id, options);
  binding(peer, receipt);
  if (!receipt.taskId && peer.kind === "keir" && options.retry === true) {
    writable(peer);
    // Keir retains client-id deduplication for seven days. Never replay
    // outside a conservative six-day window.
    if (Date.now() - Date.parse(receipt.at) > 6 * 86400000) throw new Error("Receipt is outside the safe deduplication window; inspect the remote thread manually");
    try { await sendKeir(peer, receipt, options); receipt.state = "accepted"; delete receipt.error; }
    catch (error) { receipt.error = error.message; }
    saveReceipt(receipt, options);
  }
  if (!receipt.taskId && peer.kind === "opencode") {
    const sessions = await request(peer, `/session${directoryQuery(peer)}`, options);
    const matches = sessions.filter(session => session.title === `Lakeside handoff ${receipt.id}`);
    if (matches.length === 1) receipt.taskId = matches[0].id;
  }
  if (!receipt.taskId) return receipt;
  if (peer.kind === "opencode" && receipt.state === "uncertain") {
    try { await request(peer, `/session/${encodeURIComponent(receipt.taskId)}/message/${encodeURIComponent(receipt.messageId)}${directoryQuery(peer)}`, options); receipt.state = "accepted"; }
    catch (error) { if (error.status !== 404) throw error; saveReceipt(receipt, options); return receipt; }
  }
  const result = await peerTask(peer, receipt.taskId, options);
  receipt.remoteState = result.state;
  if (result.state === "done") receipt.state = "completed";
  else if (["cancelled", "dismissed"].includes(result.state)) receipt.state = "cancelled";
  else if (["failed", "blocked"].includes(result.state)) receipt.state = result.state;
  const lastAssistant = result.messages?.filter(message => message.info?.role === "assistant").at(-1);
  const summary = result.summary || lastAssistant?.parts?.filter(part => part.type === "text").map(part => part.text).join("\n\n");
  if (summary) receipt.summary = summary.slice(0, 12000);
  delete receipt.error;
  saveReceipt(receipt, options);
  return receipt;
}

export async function cancelHandoff(peer, id, options = {}) {
  writable(peer);
  const receipt = readReceipt(id, options);
  binding(peer, receipt);
  if (["completed", "cancelled"].includes(receipt.state)) return receipt;
  if (!receipt.taskId) throw new Error("Remote task id is unknown. Recover the handoff before cancelling it");
  receipt.state = "cancelling";
  saveReceipt(receipt, options);
  try {
    const result = await request(peer, peer.kind === "keir" ? "/api/keir/app/cancel" : `/session/${encodeURIComponent(receipt.taskId)}/abort${directoryQuery(peer)}`, { ...options, body: peer.kind === "keir" ? { taskId: receipt.taskId } : {} });
    if (peer.kind === "keir" && result.state === "done") receipt.state = "completed";
    else if (peer.kind === "keir" && ["cancelled", "dismissed"].includes(result.state) || peer.kind === "opencode" && result === true) receipt.state = "cancelled";
    else throw new Error("Peer did not confirm cancellation");
    delete receipt.error;
  } catch (error) { receipt.state = "cancel-uncertain"; receipt.error = error.message; }
  saveReceipt(receipt, options);
  return receipt;
}
