"use strict";

/**
 * Read what a live Claude session says about itself from the CLI's own session
 * log instead of scraping it back out of the tmux pane.
 *
 * The pane is a rendering: it word-wraps, it repaints, and it only names the
 * model when someone asks it to. The log is the record — every assistant
 * message carries its model, and mode changes are written as they happen.
 *
 * Two things make this non-trivial, and both are handled here:
 *
 *   1. Agents usually share a working directory. Four panes running in /root
 *      all map to `/root/.claude/projects/-root`, so "the newest log in that
 *      directory" is the wrong file for three of them. Sessions the dash
 *      spawned carry `--session-id <uuid>` in their argv, which is an exact
 *      link. Sessions started by hand are matched on log creation time, which
 *      lands 1-3s after the process starts.
 *
 *   2. Logs are polled while they grow. Each read consumes only the bytes
 *      appended since the previous one and keeps facts already resolved, so a
 *      busy session costs a few KB per poll rather than a full re-scan.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PROJECTS_ROOT = process.env.CLAUDE_PROJECTS_ROOT || path.join(os.homedir(), ".claude", "projects");
// A first read is bounded: enough to cover the recent turns that carry the
// model and mode records, small enough not to stall a poll on a long session.
const FIRST_READ_BYTES = 512 * 1024;
const PROCESS_TTL = 4000;
const DIRECTORY_TTL = 4000;
// A hand-started session's log is created a beat after the process. Anything
// outside this window belongs to a different run.
const BIRTH_SLACK_MS = 90_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID_ARG_RE = /--session-id[= ]([0-9a-f-]{36})/i;

// Claude Code's own permission vocabulary, mapped onto the three modes the dash
// exposes. `acceptEdits` has no dash equivalent on purpose: it is reported with
// its real label and leaves every segment unselected rather than lying about it.
const PERMISSION_LABELS = Object.freeze({
  auto: "Auto",
  default: "Ask",
  acceptEdits: "Accept edits",
  plan: "Plan",
  bypassPermissions: "Bypass",
});
const PERMISSION_TO_DASH = Object.freeze({
  auto: "auto",
  default: "ask",
  acceptEdits: null,
  plan: "plan",
  bypassPermissions: "auto",
});

/** `claude-opus-5` → `Opus 5`; `claude-haiku-4-5-20251001` → `Haiku 4.5`. */
function formatModelLabel(model) {
  const raw = String(model || "").trim();
  if (!raw) return null;
  const bare = raw.replace(/^claude-/i, "").replace(/-\d{8}$/, "");
  const parts = bare.split("-").filter(Boolean);
  if (!parts.length) return raw;
  const family = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  const version = parts.slice(1).filter((part) => /^\d+$/.test(part)).join(".");
  return version ? `${family} ${version}` : family;
}

function permissionLabelFor(mode) {
  const raw = String(mode || "");
  return PERMISSION_LABELS[raw] || (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : null);
}

function dashModeFor(mode) {
  const raw = String(mode || "");
  return Object.prototype.hasOwnProperty.call(PERMISSION_TO_DASH, raw) ? PERMISSION_TO_DASH[raw] : null;
}

/** The log directory Claude Code derives from a working directory. */
function projectDirFor(cwd) {
  return path.join(PROJECTS_ROOT, String(cwd || os.homedir()).replace(/[^a-zA-Z0-9-]/g, "-"));
}

let processCache = { at: 0, byPid: new Map(), children: new Map() };

/**
 * One `ps` snapshot per few seconds, shared by every session on the page. Uses
 * elapsed seconds rather than a formatted start date because it parses reliably.
 */
function processSnapshot() {
  const now = Date.now();
  if (now - processCache.at < PROCESS_TTL) return processCache;
  const byPid = new Map();
  const children = new Map();
  let out = "";
  try {
    out = execFileSync("ps", ["-eo", "pid=,ppid=,etimes=,args="], { encoding: "utf8", timeout: 4000 });
  } catch {
    out = "";
  }
  for (const line of out.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const entry = {
      pid,
      ppid: Number(match[2]),
      startedAtMs: now - (Number(match[3]) * 1000),
      args: match[4],
    };
    byPid.set(pid, entry);
    if (!children.has(entry.ppid)) children.set(entry.ppid, []);
    children.get(entry.ppid).push(entry);
  }
  processCache = { at: now, byPid, children };
  return processCache;
}

/** The pane's process and its descendants, nearest first. */
function processTree(panePid, snapshot) {
  const root = snapshot.byPid.get(Number(panePid));
  if (!root) return [];
  const found = [root];
  const queue = [root.pid];
  while (queue.length && found.length < 64) {
    const next = snapshot.children.get(queue.shift()) || [];
    for (const child of next) {
      found.push(child);
      queue.push(child.pid);
    }
  }
  return found;
}

let paneCache = { at: 0, panes: [] };

function paneSnapshot() {
  const now = Date.now();
  if (now - paneCache.at < PROCESS_TTL) return paneCache.panes;
  let out = "";
  try {
    out = execFileSync("tmux", ["list-panes", "-a", "-F", "#{session_name}\t#{pane_pid}\t#{pane_current_path}"], {
      encoding: "utf8",
      timeout: 4000,
    });
  } catch {
    out = "";
  }
  const panes = out.split("\n").map((line) => {
    const [name, pid, cwd] = line.split("\t");
    if (!name || !pid) return null;
    return { tmuxName: name, panePid: Number(pid), cwd: cwd || "/root" };
  }).filter(Boolean);
  paneCache = { at: now, panes };
  return panes;
}

/**
 * Every live pane that is running Claude, with its session id when the argv
 * states one. Panes are resolved together because the creation-time fallback
 * has to assign logs one-to-one.
 */
function claudePanes() {
  const snapshot = processSnapshot();
  const found = [];
  for (const pane of paneSnapshot()) {
    const tree = processTree(pane.panePid, snapshot);
    const claude = tree.find((entry) => /(?:^|\/)claude(?:\s|$)/.test(entry.args));
    if (!claude) continue;
    const match = claude.args.match(SESSION_ID_ARG_RE);
    const sessionId = match && UUID_RE.test(match[1]) ? match[1].toLowerCase() : null;
    found.push({ ...pane, startedAtMs: claude.startedAtMs, sessionId });
  }
  return found;
}

const directoryCache = new Map();

function logFilesIn(projectDir) {
  const now = Date.now();
  const hit = directoryCache.get(projectDir);
  if (hit && now - hit.at < DIRECTORY_TTL) return hit.files;
  let names = [];
  try {
    names = fs.readdirSync(projectDir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    names = [];
  }
  const files = names.map((name) => {
    const full = path.join(projectDir, name);
    try {
      const stat = fs.statSync(full);
      return { full, sessionId: name.replace(/\.jsonl$/, "").toLowerCase(), birthMs: stat.birthtimeMs, mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    }
  }).filter(Boolean);
  directoryCache.set(projectDir, { at: now, files });
  return files;
}

/**
 * The log belonging to one pane. An argv session id is exact. Without one, the
 * pane is matched against logs created just after it started, and siblings
 * claim theirs first so two panes never share a file.
 */
function resolveLogPath(tmuxName, cwd) {
  const panes = claudePanes();
  const self = panes.find((pane) => pane.tmuxName === tmuxName);
  if (!self) return null;
  const projectDir = projectDirFor(cwd || self.cwd);
  const files = logFilesIn(projectDir);
  if (!files.length) return null;

  if (self.sessionId) {
    const exact = files.find((file) => file.sessionId === self.sessionId);
    if (exact) return exact.full;
  }

  // Creation-time fallback. Panes whose id is already known take their file out
  // of the running first, then the rest claim in start order.
  const claimed = new Set();
  for (const pane of panes) {
    if (!pane.sessionId || pane.tmuxName === tmuxName) continue;
    const owned = files.find((file) => file.sessionId === pane.sessionId);
    if (owned) claimed.add(owned.full);
  }
  const contenders = panes
    .filter((pane) => !pane.sessionId && projectDirFor(pane.cwd) === projectDir)
    .sort((a, b) => a.startedAtMs - b.startedAtMs);
  const byBirth = files.slice().sort((a, b) => a.birthMs - b.birthMs);
  let mine = null;
  for (const pane of contenders) {
    const pick = byBirth.find((file) => !claimed.has(file.full)
      && file.birthMs >= pane.startedAtMs - 2000
      && file.birthMs <= pane.startedAtMs + BIRTH_SLACK_MS);
    // A resumed session reuses an older log, so nothing is created after start.
    // Fall back to the most recently written unclaimed file for that pane.
    const chosen = pick || byBirth.filter((file) => !claimed.has(file.full))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
    if (!chosen) continue;
    claimed.add(chosen.full);
    if (pane.tmuxName === tmuxName) mine = chosen.full;
  }
  return mine;
}

// Resolved facts per log path, advanced by the bytes appended since last read.
const factsCache = new Map();

function blankFacts() {
  return {
    model: null,
    permissionMode: null,
    mode: null,
    title: null,
    customTitle: null,
    tokens: null,
    updatedAt: null,
  };
}

/**
 * Fold one log record into the running facts. Records are visited oldest-first
 * within a chunk so later ones win, which is what "current" means here.
 */
function applyRecord(facts, record) {
  const type = record?.type;
  // Prompt records stamp the mode that was in force when they were sent, which
  // is a fresher signal than the dedicated record written only on a change.
  if (record?.permissionMode) facts.permissionMode = record.permissionMode;
  if (type === "assistant") {
    const message = record.message || {};
    if (message.model) facts.model = message.model;
    const usage = message.usage;
    if (usage) {
      const tokens = Number(usage.input_tokens || 0)
        + Number(usage.cache_read_input_tokens || 0)
        + Number(usage.cache_creation_input_tokens || 0);
      if (tokens > 0) facts.tokens = tokens;
    }
    return;
  }
  if (type === "permission-mode" && record.permissionMode) facts.permissionMode = record.permissionMode;
  else if (type === "mode" && record.mode) facts.mode = record.mode;
  else if (type === "ai-title" && record.aiTitle) facts.title = record.aiTitle;
  else if (type === "custom-title" && (record.customTitle || record.title)) {
    facts.customTitle = record.customTitle || record.title;
  }
}

/**
 * Facts for one log, reading only what is new. A log that shrank or rotated is
 * re-read from a bounded tail.
 */
function readFacts(logPath) {
  let stat;
  try {
    stat = fs.statSync(logPath);
  } catch {
    factsCache.delete(logPath);
    return null;
  }
  const cached = factsCache.get(logPath);
  const grewInPlace = cached && stat.size >= cached.offset && cached.mtimeMs <= stat.mtimeMs;
  const facts = grewInPlace ? cached.facts : blankFacts();
  let start = grewInPlace ? cached.offset : Math.max(0, stat.size - FIRST_READ_BYTES);
  if (stat.size <= start) {
    factsCache.set(logPath, { offset: stat.size, mtimeMs: stat.mtimeMs, facts });
    return facts;
  }

  const length = stat.size - start;
  const buffer = Buffer.alloc(length);
  let read = 0;
  let fd = null;
  try {
    fd = fs.openSync(logPath, "r");
    read = fs.readSync(fd, buffer, 0, length, start);
  } catch {
    return facts;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }

  const text = buffer.subarray(0, read).toString("utf8");
  // Consume whole lines only. The tail after the last newline is a record still
  // being written, so the offset stops there and picks it up next time.
  const lastBreak = text.lastIndexOf("\n");
  const consumed = lastBreak >= 0 ? text.slice(0, lastBreak) : "";
  for (const line of consumed.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== "{") continue;
    try {
      applyRecord(facts, JSON.parse(trimmed));
    } catch { /* a partial or malformed record tells us nothing */ }
  }
  facts.updatedAt = stat.mtimeMs;
  factsCache.set(logPath, {
    offset: lastBreak >= 0 ? start + Buffer.byteLength(consumed, "utf8") + 1 : start,
    mtimeMs: stat.mtimeMs,
    facts,
  });
  return facts;
}

/**
 * What the CLI currently reports for a live Claude pane, or null when the log
 * cannot be located (a non-Claude session, or a pane that just started).
 */
function claudeSessionState(tmuxName, cwd) {
  const name = String(tmuxName || "");
  if (!name) return null;
  let logPath = null;
  try {
    logPath = resolveLogPath(name, cwd);
  } catch {
    return null;
  }
  if (!logPath) return null;
  const facts = readFacts(logPath);
  if (!facts) return null;
  const permissionMode = facts.permissionMode || null;
  return {
    sessionId: path.basename(logPath, ".jsonl"),
    logPath,
    model: facts.model || null,
    modelLabel: formatModelLabel(facts.model),
    permissionMode,
    permissionLabel: permissionLabelFor(permissionMode),
    dashPermissionMode: dashModeFor(permissionMode),
    mode: facts.mode || null,
    title: facts.customTitle || facts.title || null,
    tokens: facts.tokens || null,
    updatedAt: facts.updatedAt || null,
  };
}

/**
 * Context usage in the shape resolveAgentUsage consumes. Read per session so
 * four panes sharing /root no longer report each other's numbers.
 */
function claudeSessionUsage(tmuxName, cwd) {
  const state = claudeSessionState(tmuxName, cwd);
  if (!state || !state.tokens) return null;
  const percent = Math.max(0, Math.min(100, (state.tokens / 1_000_000) * 100));
  return {
    provider: "claude",
    direction: "used",
    percent,
    label: `${Math.round(percent)}% filled`,
    detail: "Session context",
    tokens: state.tokens,
    model: state.modelLabel || null,
  };
}

/** Drop cached state for a session that was killed or respawned. */
function clearClaudeSessionState(tmuxName) {
  processCache = { at: 0, byPid: new Map(), children: new Map() };
  paneCache = { at: 0, panes: [] };
  directoryCache.clear();
  if (!tmuxName) factsCache.clear();
}

module.exports = {
  PERMISSION_LABELS,
  PERMISSION_TO_DASH,
  applyRecord,
  claudePanes,
  claudeSessionState,
  claudeSessionUsage,
  clearClaudeSessionState,
  dashModeFor,
  formatModelLabel,
  permissionLabelFor,
  projectDirFor,
  readFacts,
  resolveLogPath,
};
