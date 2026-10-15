"use strict";

// ─── HAPPY BRIDGE ────────────────────────────────────────────────────────
// Integration with the happy-coder relay for sessions the dash spawns through
// the `happy` wrapper. Two jobs:
//
// 1. Map a tmux session to its Happy session id. ACP wrappers print
//    "Happy Session ID: <id>" into the pane at boot; the id is also matched
//    against ~/.happy/sessions.json via the pane's process tree (hostPid).
//
// 2. Impersonate the phone client. Happy's daemon HTTP API has no
//    send-message route, but the CLI package exports ApiSessionClient and the
//    per-session encryption keys live in ~/.happy/sessions.json, so the dash
//    can enqueue a `{role:"user"}` envelope exactly the way the mobile app
//    does. That is how ACP sessions (kimi/opencode — no TUI in the pane) get
//    their seed prompt and every follow-up message from the web UI, and how
//    the workspace renders their transcript.
//
// Everything degrades: if happy is not installed, not authenticated, or the
// lib import fails, callers get `null`/false and fall back to pane behavior.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const HAPPY_HOME = process.env.HAPPY_HOME_DIR || path.join(os.homedir(), ".happy");
const SESSIONS_FILE = path.join(HAPPY_HOME, "sessions.json");
const ACCESS_FILE = path.join(HAPPY_HOME, "access.key");
const PANE_ID_RE = /Happy Session ID: ([a-z0-9]+)/;

// The lib ships inside the happy-coder package; resolve it from the binary so
// an npm upgrade or relocation keeps working without a code change.
function happyLibPath() {
  try {
    const bin = execFileSync("which", ["happy"], { encoding: "utf8", timeout: 2000 }).trim();
    const real = fs.realpathSync(bin);
    const root = path.resolve(path.dirname(real), "..");
    const lib = path.join(root, "dist", "lib.mjs");
    if (fs.existsSync(lib)) return lib;
  } catch { /* fall through */ }
  const fallback = path.join(process.env.HERMES_NODE_MODULES_ROOT || path.join(os.homedir(), ".hermes", "node", "lib", "node_modules"), "happy-coder", "dist", "lib.mjs");
  return fs.existsSync(fallback) ? fallback : null;
}

function happyAvailable() {
  return !!happyLibPath() && fs.existsSync(ACCESS_FILE);
}

let libPromise = null;
function loadLib() {
  if (!libPromise) {
    const libFile = happyLibPath();
    if (!libFile) return Promise.reject(new Error("happy-coder lib not found"));
    libPromise = import(libFile);
  }
  return libPromise;
}

function readAccessToken() {
  const parsed = JSON.parse(fs.readFileSync(ACCESS_FILE, "utf8"));
  if (!parsed?.token) throw new Error("happy access.key has no token — run `happy auth login`");
  return parsed.token;
}

let sessionsCache = null;
function readSessionStore() {
  try {
    const stat = fs.statSync(SESSIONS_FILE);
    if (sessionsCache && sessionsCache.mtimeMs === stat.mtimeMs) return sessionsCache.value;
    const value = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"))?.sessions || {};
    sessionsCache = { mtimeMs: stat.mtimeMs, value };
    return value;
  } catch {
    return {};
  }
}

/**
 * The Happy session id for a tmux session, or null.
 *
 * Two strategies, because happy's flavors differ: ACP wrappers print a
 * "Happy Session ID:" banner into the pane at boot; `happy codex` renders its
 * own box UI with no banner, so its session is found by walking the pane's
 * process tree and matching `metadata.hostPid` in sessions.json.
 */
function happySessionIdForTmux(tmuxName) {
  const name = String(tmuxName || "");
  if (!name) return null;
  try {
    // Bare session name: `=name` is session-target syntax and capture-pane
    // takes a pane target, where it fails with "can't find pane".
    const text = execFileSync(
      "tmux", ["capture-pane", "-p", "-S", "-", "-t", name],
      { encoding: "utf8", timeout: 3000, maxBuffer: 1024 * 1024 }
    );
    const match = text.match(PANE_ID_RE);
    if (match) return match[1];
  } catch { /* session gone or tmux blip */ }
  return happySessionIdFromProcessTree(name);
}

function happySessionIdFromProcessTree(name) {
  let panePid = 0;
  try {
    panePid = Number(execFileSync(
      "tmux", ["list-panes", "-t", name, "-F", "#{pane_pid}"],
      { encoding: "utf8", timeout: 3000 }
    ).trim().split("\n")[0]);
  } catch { return null; }
  if (!panePid) return null;
  const byHostPid = new Map();
  for (const [id, rec] of Object.entries(readSessionStore())) {
    const pid = Number(rec?.metadata?.hostPid || 0);
    if (pid) byHostPid.set(pid, id);
  }
  if (!byHostPid.size) return null;
  // One ps pass, then follow children breadth-first from the pane pid.
  let psOutput;
  try {
    psOutput = execFileSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8", timeout: 3000 });
  } catch { return null; }
  const children = new Map();
  for (const line of psOutput.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const queue = [panePid];
  while (queue.length) {
    const pid = queue.shift();
    if (byHostPid.has(pid)) return byHostPid.get(pid);
    for (const child of children.get(pid) || []) queue.push(child);
  }
  return null;
}

// ── Relay-derived busy state ─────────────────────────────
// Headless codex has no pane signal at all (its box UI never updates), so
// busyness is inferred from the relay: a send marks the session busy, and the
// next transcript fetch settles it from turn-start/turn-end envelopes. Entries
// go stale-idle after two minutes so a lost turn-end cannot pin a queue.
const busyById = new Map();
const BUSY_STALE_MS = 120_000;

function noteBusy(happyId, busy) {
  busyById.set(String(happyId), { busy: !!busy, at: Date.now() });
}

/** true/false from the last relay observation, or null when nothing is known. */
function happySessionBusy(happyId) {
  const entry = busyById.get(String(happyId || ""));
  if (!entry) return null;
  if (entry.busy && Date.now() - entry.at > BUSY_STALE_MS) return false;
  return entry.busy;
}

function sessionRecord(happyId) {
  return readSessionStore()[String(happyId || "")] || null;
}

async function makeClient(happyId) {
  const rec = sessionRecord(happyId);
  if (!rec) throw new Error(`No local record for happy session ${happyId}`);
  const { ApiSessionClient } = await loadLib();
  return new ApiSessionClient(readAccessToken(), {
    id: String(happyId),
    metadata: rec.metadata || {},
    metadataVersion: rec.metadataVersion || 0,
    agentState: rec.agentState ?? null,
    agentStateVersion: rec.agentStateVersion || 0,
    encryptionKey: new Uint8Array(Buffer.from(rec.encryptionKey, "base64")),
    encryptionVariant: rec.encryptionVariant || "dataKey",
  });
}

/** Send a user message into a happy session, as the phone would. */
async function sendHappyUserMessage(happyId, text) {
  const body = String(text || "").trim();
  if (!body) throw new Error("Empty message");
  const client = await makeClient(happyId);
  try {
    client.enqueueMessage({ role: "user", content: { type: "text", text: body } }, false);
    await client.flushOutbox();
    noteBusy(happyId, true);
  } finally {
    try { client.close(); } catch { /* fire-and-forget */ }
  }
}

// ── Transcript from the relay ────────────────────────────
// fetchMessages() pages GET /v3/sessions/:id/messages, decrypts each with the
// session key, and routes: user envelopes hit onUserMessage, everything else
// is emitted as "message". The mapper below folds that stream into the same
// `{turns:[{user, blocks}]}` shape claude-log-transcript produces, so the
// workspace renders ACP sessions with zero client changes.

function extractAcpText(data, out) {
  // ACP payloads vary by agent ("agent_message_chunk", "message", nested
  // content arrays). Collect every plausible visible-text field, skipping
  // thinking/thought chunks — those get their own block kind.
  if (data == null) return;
  if (typeof data === "string") { out.push(data); return; }
  if (Array.isArray(data)) { for (const item of data) extractAcpText(item, out); return; }
  if (typeof data !== "object") return;
  if (typeof data.text === "string") { out.push(data.text); return; }
  for (const key of ["message", "content", "chunk", "delta", "update"]) {
    if (key in data) extractAcpText(data[key], out);
  }
}

function isThoughtChunk(data) {
  const t = String(data?.type || data?.update?.sessionUpdate || "");
  return /thought|thinking|reasoning/i.test(t);
}

function isToolChunk(data) {
  const t = String(data?.type || data?.update?.sessionUpdate || "");
  return /tool_call|tool_use|toolcall/i.test(t);
}

function toolTitleFrom(data) {
  const src = data?.update || data;
  return String(src?.title || src?.toolCall?.title || src?.name || "Tool call").slice(0, 160);
}

/**
 * Rebuild a workspace transcript for a happy session from the relay.
 * Returns null when nothing usable came back (caller falls back to the pane).
 */
async function happyTranscript(happyId, { maxTurns = 40 } = {}) {
  const { pushText, pushTool, toolItem } = require("./tmux-live-transcript");
  const client = await makeClient(happyId);
  const turns = [];
  let current = null;
  // Agent output streams as many tiny chunks ("INE", "APP", "LE"); buffer per
  // kind and only pushText a completed run, because pushText trims each call
  // and would eat the spaces between chunks.
  let pendingText = "";
  let pendingThinking = "";
  const flushPending = () => {
    if (!current) return;
    if (pendingThinking) { pushText(current.blocks, "thinking", pendingThinking); pendingThinking = ""; }
    if (pendingText) { pushText(current.blocks, "text", pendingText); pendingText = ""; }
  };
  const openTurn = (user) => {
    flushPending();
    current = { user: user || "", blocks: [] };
    turns.push(current);
    return current;
  };
  const seenTools = new Set();
  // Relay envelopes carry explicit turn boundaries; an open turn at the end of
  // the stream means the agent is mid-reply right now.
  let turnOpen = false;
  try {
    client.onUserMessage((message) => {
      const text = String(message?.content?.text || "").trim();
      if (text) openTurn(text);
    });
    client.on("message", (body) => {
      if (!body || body.role === "user") return;
      // The CLI normalizes agent output into session-protocol envelopes:
      // {role:"session", content:{role:"agent", turn, ev:{t:"text"|"turn-start"|
      // "turn-end"|"tool"…, text?, thinking?}}} — verified against a live ACP
      // session 2026-08-05. Bare {role:"agent"} envelopes only carry lifecycle
      // events ("ready") and usage, which the transcript does not render.
      if (body.role === "session") {
        const c = body.content;
        if (!c || c.role !== "agent" || !c.ev) return;
        if (!current) openTurn("");
        const ev = c.ev;
        if (ev.t === "turn-start") { turnOpen = true; return; }
        if (ev.t === "text" && typeof ev.text === "string") {
          if (ev.thinking) pendingThinking += ev.text;
          else pendingText += ev.text;
          return;
        }
        if (ev.t === "turn-end") { turnOpen = false; flushPending(); return; }
        if (/tool/.test(String(ev.t || ""))) {
          flushPending();
          const title = String(ev.name || ev.title || ev.t).slice(0, 160);
          if (!seenTools.has(`${turns.length}:${title}`)) {
            seenTools.add(`${turns.length}:${title}`);
            pushTool(current.blocks, toolItem(title, String(ev.detail || ev.ref || ""), { running: false }));
          }
        }
        return;
      }
      const content = body.content;
      if (content?.type === "acp") {
        // Fallback for any agent flavor that ships raw ACP payloads instead of
        // session envelopes.
        if (!current) openTurn("");
        const data = content.data;
        if (isToolChunk(data)) {
          flushPending();
          const title = toolTitleFrom(data);
          if (!seenTools.has(`${turns.length}:${title}`)) {
            seenTools.add(`${turns.length}:${title}`);
            pushTool(current.blocks, toolItem(title, "", { running: false }));
          }
          return;
        }
        const pieces = [];
        extractAcpText(data, pieces);
        const text = pieces.join("");
        if (!text) return;
        if (isThoughtChunk(data)) pendingThinking += text;
        else pendingText += text;
        return;
      }
      if (content?.type === "text" && typeof content.text === "string") {
        if (!current) openTurn("");
        flushPending();
        pushText(current.blocks, "text", content.text);
      }
    });
    await client.fetchMessages();
    flushPending();
  } finally {
    try { client.close(); } catch { /* best-effort */ }
  }
  noteBusy(happyId, turnOpen);
  const usable = turns.filter((turn) => turn.user || turn.blocks.length);
  if (!usable.length) return null;
  const recent = usable.slice(-maxTurns);
  const last = recent[recent.length - 1];
  return {
    user: last.user,
    blocks: last.blocks,
    turns: recent,
    truncated: usable.length > recent.length,
    busy: turnOpen,
    source: "happy-relay",
  };
}

/**
 * Wait until a freshly spawned happy session is registered (pane banner
 * printed and sessions.json written), then return its id. Used by callers
 * that need to send the seed prompt right after spawn.
 */
async function waitForHappySession(tmuxName, { timeoutMs = 45_000, pollMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = happySessionIdForTmux(tmuxName);
    if (id && sessionRecord(id)) return id;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Happy session for ${tmuxName} did not register within ${Math.round(timeoutMs / 1000)}s`);
}

module.exports = {
  happyAvailable,
  happySessionBusy,
  happySessionIdForTmux,
  sessionRecord,
  sendHappyUserMessage,
  happyTranscript,
  waitForHappySession,
};
