import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export function loadPeers(env = process.env) {
  if (!env.LAKESIDE_CODE_PEERS) return [];
  const data = JSON.parse(fs.readFileSync(env.LAKESIDE_CODE_PEERS, "utf8"));
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
    return { id: peer.id, name: String(peer.name || peer.id).replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, 60), kind: peer.kind, url: url.origin, tokenEnv: peer.tokenEnv, directory: peer.directory, allowSubmit: peer.allowSubmit === true };
  });
}

async function request(peer, endpoint, { body, signal, env = process.env, fetchImpl = fetch } = {}) {
  const token = peer.tokenEnv ? env[peer.tokenEnv] : undefined;
  if (peer.tokenEnv && !token) throw new Error(`Missing credential environment variable ${peer.tokenEnv}`);
  const headers = { ...(body ? { "Content-Type": "application/json" } : {}) };
  if (token) headers.Authorization = peer.kind === "keir" ? `Bearer ${token}` : `Basic ${Buffer.from(`opencode:${token}`).toString("base64")}`;
  const response = await fetchImpl(new URL(endpoint, peer.url), { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined, redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]) });
  if (!response.ok) throw new Error(`Peer ${peer.id} returned HTTP ${response.status}`);
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
  const [session, messages] = await Promise.all([request(peer, `/session/${encodeURIComponent(id)}${query}`, options), request(peer, `/session/${encodeURIComponent(id)}/message${query}`, options)]);
  return { session, messages };
}

// Persist intent before dispatch. An uncertain response never causes an
// automatic resubmission. The caller reconciles the recorded client/task id.
export async function handoff(peer, spec, { env = process.env, fetchImpl = fetch, signal, stateDir = path.join(env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "lakeside-code", "handoffs") } = {}) {
  if (!peer.allowSubmit) throw new Error(`Peer ${peer.id} is read-only; explicitly enable allowSubmit to hand off work`);
  if (peer.kind !== "keir") throw new Error("OpenCode peers support inspection in this release; task submission is available for Keir peers");
  for (const key of ["goal", "repository", "branch", "base", "scope", "deliverable"]) if (typeof spec[key] !== "string" || !spec[key].trim()) throw new Error(`Handoff requires ${key}`);
  const id = crypto.randomUUID();
  const receipt = { id, peer: peer.id, state: "dispatching", at: new Date().toISOString(), spec };
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = path.join(stateDir, `${id}.json`);
  const save = () => { const temporary = `${file}.tmp`; fs.writeFileSync(temporary, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 }); fs.renameSync(temporary, file); };
  save();
  try {
    const text = `Coding handoff\n\nGoal: ${spec.goal}\nRepository: ${spec.repository}\nBranch: ${spec.branch}\nBase commit: ${spec.base}\nAllowed scope: ${spec.scope}\nReturn: ${spec.deliverable}\n\nWork in a separate worktree. Return findings, a commit/PR or a patch against the stated base. Report actual completion and validation evidence.`;
    if (text.length > 6000) throw new Error("Handoff exceeds the peer's message limit");
    const result = await request(peer, "/api/keir/app/messages", { body: { text, thread: spec.thread || "main", clientId: id, mode: "new" }, env, fetchImpl, signal });
    if (!result?.jobId) throw new Error("Peer returned no durable job id");
    receipt.state = "accepted"; receipt.taskId = result.jobId;
  } catch (error) { receipt.state = "uncertain"; receipt.error = error.message; }
  save();
  return receipt;
}
