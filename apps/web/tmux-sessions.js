const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { claudeSessionState, clearClaudeSessionState, dashModeFor, permissionLabelFor } = require("./claude-session-state");
const { homeDir, agentPathExtras, resolveBinary } = require("./src/core/paths");
const happyBridge = require("./happy-bridge");
const { allowedModels, isDenied, modelFor, effortFor, scoreComplexity } = require("./model-router");

const TMUX_NAME = /^(?:gpt|claude|kimi|cursor|opencode|ollama)[a-zA-Z0-9_-]*$/;
const TRANSIENT_TITLE_PREFIX_RE = /^[\s✳⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠐⠘⠤⠀⠞⣾⣷⣯⣟⡿⢿⣻⣽]+/u;
const AGENT_KINDS = Object.freeze({
  gpt: Object.freeze({ kind: "codex", label: "Codex", supportsConfig: true }),
  claude: Object.freeze({ kind: "claude", label: "Claude", supportsConfig: true }),
  kimi: Object.freeze({ kind: "kimi", label: "Kimi", supportsConfig: true }),
  cursor: Object.freeze({ kind: "cursor", label: "Cursor", supportsConfig: false }),
  opencode: Object.freeze({ kind: "opencode", label: "OpenCode", supportsConfig: true }),
  ollama: Object.freeze({ kind: "ollama", label: "Ollama Cloud", supportsConfig: true }),
  gemini: Object.freeze({ kind: "gemini", label: "Gemini", supportsConfig: false }),
});
const TMUX_KEYS = Object.freeze({
  "ctrl-c": "C-c", escape: "Escape", tab: "Tab", enter: "Enter",
  up: "Up", down: "Down", "page-up": "PageUp", "page-down": "PageDown",
  home: "Home", end: "End",
  // tmux sends BTab as CSI Z, which is what a CLI reads for shift+tab. Claude
  // cycles its permission mode on it — the only way out of plan mode.
  "shift-tab": "BTab",
});
// A detached tmux session defaults to 80x24, and a CLI that draws in the alternate
// screen has no scrollback — so 24 rows was literally everything the dash could ever
// see of a Claude pane. An AskUserQuestion menu did not fit: the question text had
// already scrolled off by the time anyone looked, leaving bare numbered options.
// Bigger costs nothing (no client is attached) and is what makes the pane readable.
const AGENT_PANE_SIZE = Object.freeze(["-x", "120", "-y", "60"]);
const CODEX_MODELS = Object.freeze(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]);
const CODEX_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]);
const CLAUDE_MODELS = Object.freeze(["fable", "opus", "sonnet", "haiku"]);
const CLAUDE_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
const KIMI_MODELS = Object.freeze(["k3", "kimi-for-coding", "kimi-for-coding-highspeed"]);
// OpenCode provider id → cloud model catalog (ids without the provider/ prefix).
const OPENCODE_MODEL_PROVIDERS = Object.freeze({
  ollama: "ollama-cloud",
  opencode: "opencode-go",
});
const OLLAMA_CLOUD_MODELS = Object.freeze([
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "gemma4:31b",
  "glm-5.1",
  "glm-5.2",
  "gpt-oss:20b",
  "gpt-oss:120b",
  "kimi-k2.5",
  "kimi-k2.6",
  "kimi-k2.7-code",
  "minimax-m2.5",
  "minimax-m2.7",
  "minimax-m3",
  "mistral-large-3:675b",
  "nemotron-3-nano:30b",
  "nemotron-3-super",
  "nemotron-3-ultra",
  "qwen3.5:397b",
]);
const OPENCODE_GO_MODELS = Object.freeze([
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "glm-5",
  "glm-5.1",
  "glm-5.2",
  "grok-4.5",
  "hy3",
  "hy3-preview",
  "kimi-k2.5",
  "kimi-k2.6",
  "kimi-k2.7-code",
  "kimi-k3",
  "mimo-v2-omni",
  "mimo-v2-pro",
  "mimo-v2.5",
  "mimo-v2.5-pro",
  "minimax-m2.5",
  "minimax-m2.7",
  "minimax-m3",
  "qwen3.5-plus",
  "qwen3.6-plus",
  "qwen3.7-max",
  "qwen3.7-plus",
]);
const DEFAULT_OPENCODE_MODELS = Object.freeze({
  ollama: "deepseek-v4-flash",
  opencode: "deepseek-v4-flash",
});
const TMUX_DISCOVERY_CACHE_MS = 400;
const PROCESS_DISCOVERY_CACHE_MS = 2000;
const CAPTURE_CACHE_MS = 1000;
let tmuxDiscoveryCache = null;
let processDiscoveryCache = null;
const captureCache = new Map();
// Per-session runtime maps — swept on the background tick so dead sessions
// (killed without going through terminateAgent) don't accumulate forever.
const PER_SESSION_MAPS = [];

/** systemd runs the dash without HOME; Cursor's agent wrapper needs it (`set -u`). */
function agentCliEnv(extra = {}) {
  const home = homeDir() || os.homedir() || "/root";
  const env = {
    ...process.env,
    HOME: home,
    USER: process.env.USER || "root",
    LOGNAME: process.env.LOGNAME || process.env.USER || "root",
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || path.join(home, ".cache"),
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
    ...extra,
  };
  // Codex (and other CLIs) read AHD_MCP_TOKEN for the shared HTTP MCP fleet.
  if (!env.AHD_MCP_TOKEN) {
    try {
      const token = fs.readFileSync(path.join(home, ".config", "ahd-mcp-token"), "utf8").trim();
      if (token) env.AHD_MCP_TOKEN = token;
    } catch { /* optional */ }
  }
  // OpenCode reads these for Go / Zen / Ollama Cloud (also in auth.json).
  for (const key of ["OPENCODE_GO_API_KEY", "OPENCODE_ZEN_API_KEY", "OLLAMA_API_KEY", "OLLAMA_CLOUD_KEY"]) {
    if (!env[key] && process.env[key]) env[key] = process.env[key];
  }
  // Prefer PATH that includes opencode + agent CLIs.
  const extras = agentPathExtras();
  const parts = String(env.PATH || "").split(":").filter(Boolean);
  for (const p of extras.reverse()) {
    if (!parts.includes(p)) parts.unshift(p);
  }
  env.PATH = parts.join(":");
  return env;
}

/** Ensure tmux panes get HOME + cloud provider keys.
 *  tmux panes inherit the *server* environment, not the dashboard client's —
 *  so OLLAMA_API_KEY / OPENCODE_* must be inlined here or OpenCode sees empty
 *  `{env:OLLAMA_API_KEY}` and returns unauthorized. */
function withAgentHomeEnv(command, extraEnv = {}) {
  const home = homeDir() || os.homedir() || "/root";
  const cache = process.env.XDG_CACHE_HOME || `${home}/.cache`;
  const parts = [
    `HOME=${shellSingleQuote(home)}`,
    "USER=root",
    `XDG_CACHE_HOME=${shellSingleQuote(cache)}`,
  ];
  for (const [key, value] of Object.entries(extraEnv)) {
    if (/^[A-Z][A-Z0-9_]*$/.test(key) && value != null) parts.push(`${key}=${shellSingleQuote(value)}`);
  }
  try {
    const token = fs.readFileSync(path.join(home, ".config", "ahd-mcp-token"), "utf8").trim();
    if (token) parts.push(`AHD_MCP_TOKEN=${shellSingleQuote(token)}`);
  } catch { /* optional */ }
  for (const key of ["OPENCODE_GO_API_KEY", "OPENCODE_ZEN_API_KEY", "OLLAMA_API_KEY", "OLLAMA_CLOUD_KEY"]) {
    const value = process.env[key];
    if (value) parts.push(`${key}=${shellSingleQuote(value)}`);
  }
  // Keep Ollama Cloud key aliases in sync when only one is set.
  if (process.env.OLLAMA_API_KEY && !process.env.OLLAMA_CLOUD_KEY) {
    parts.push(`OLLAMA_CLOUD_KEY=${shellSingleQuote(process.env.OLLAMA_API_KEY)}`);
  } else if (process.env.OLLAMA_CLOUD_KEY && !process.env.OLLAMA_API_KEY) {
    parts.push(`OLLAMA_API_KEY=${shellSingleQuote(process.env.OLLAMA_CLOUD_KEY)}`);
  }
  return `env ${parts.join(" ")} ${command}`;
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function clearAgentRuntimeCaches(name) {
  tmuxDiscoveryCache = null;
  processDiscoveryCache = null;
  // A respawned session runs a new process against a new log, so the pane→log
  // mapping has to be rebuilt rather than served from the previous occupant.
  clearClaudeSessionState(name);
  if (!name) {
    captureCache.clear();
    return;
  }
  const prefix = `${name}:`;
  for (const key of captureCache.keys()) {
    if (key.startsWith(prefix)) captureCache.delete(key);
  }
}

function agentKindFor(name) {
  const match = String(name || "").match(/^(gpt|claude|kimi|cursor|opencode|ollama)/);
  return match ? AGENT_KINDS[match[1]] : null;
}

function safeTmuxName(value) {
  const name = String(value || "");
  return TMUX_NAME.test(name) ? name : null;
}

function safeTmuxKey(value) {
  return TMUX_KEYS[String(value || "").toLowerCase()] || null;
}

function parseTmuxSessions(output) {
  return String(output || "").split("\n").filter(Boolean).map((line) => line.split("\t"))
    .filter(([name]) => safeTmuxName(name))
    .map(([name, command, title, currentPath, attached, created]) => {
      const agent = agentKindFor(name) || AGENT_KINDS.gpt;
      const started = new Date(Number(created || 0) * 1000);
      let usefulTitle = String(title || "").replace(TRANSIENT_TITLE_PREFIX_RE, "").trim();
      // Generic pane titles ("Kimi Code", "agent"…) say nothing — use the folder.
      if (!usefulTitle || /^(kimi code|claude( code)?|codex|agent|cursor( agent)?|gemini|opencode|ollama)$/i.test(usefulTitle)) {
        usefulTitle = currentPath ? String(currentPath).split("/").filter(Boolean).pop() : "";
      }
      return {
        sessionId: `tmux:${name}`, tmuxName: name,
        title: `${agent.label} · ${usefulTitle || name}`,
        defaultTitle: `${agent.label} · ${usefulTitle || name}`,
        branchName: null, baseBranch: null, worktreePath: currentPath || null,
        status: "active", model: agent.label, kind: agent.kind,
        supportsConfig: agent.supportsConfig,
        provider: `${agent.kind}-tmux`, externalTmux: true,
        createdAt: started, updatedAt: started,
      };
    });
}

// Sessions that predate AGENT_PANE_SIZE, or that were started by hand outside the
// dash, are still 80x24. Widen them once each — resize-window is idempotent, and
// the memo keeps this to a single call per session for the life of the process.
const resizedSessions = new Set();
PER_SESSION_MAPS.push(resizedSessions);

function ensureAgentPaneSize(output) {
  for (const line of String(output || "").split("\n")) {
    if (!line) continue;
    const [name, , , , attached] = line.split("\t");
    if (!safeTmuxName(name) || resizedSessions.has(name)) continue;
    resizedSessions.add(name);
    // An attached client owns the geometry — forcing a size would fight the human
    // looking at it, and their terminal is a real window with real scrollback.
    if (attached && attached !== "0") continue;
    try {
      execFileSync("tmux", ["resize-window", "-t", `=${name}`, ...AGENT_PANE_SIZE],
        { timeout: 3000, env: agentCliEnv() });
      clearAgentRuntimeCaches(name);
    } catch { /* a session that just died needs no resizing */ }
  }
}

function listTmuxSessions() {
  if (tmuxDiscoveryCache && Date.now() - tmuxDiscoveryCache.at < TMUX_DISCOVERY_CACHE_MS) {
    return tmuxDiscoveryCache.value;
  }
  try {
    const output = execFileSync("tmux", ["list-panes", "-a", "-F",
      "#{session_name}\t#{pane_current_command}\t#{pane_title}\t#{pane_current_path}\t#{session_attached}\t#{session_created}"],
    { encoding: "utf8", timeout: 5000, env: agentCliEnv() });
    ensureAgentPaneSize(output);
    const value = parseTmuxSessions(output);
    tmuxDiscoveryCache = { at: Date.now(), value };
    return value;
  } catch {
    // Don't cache failures as [] — a brief tmux blip would blank the lander.
    return [];
  }
}

// ── Process-based discovery ──────────────────────────────
// Agent sessions started OUTSIDE tmux can't be captured or controlled, but
// they should still show up as live. Detect their processes, exclude any
// whose ancestor chain includes a tmux pane, and surface them as
// `externalProcess` sessions.
const PROCESS_PATTERNS = Object.freeze([
  Object.freeze({ kind: "claude", re: /(?:^|[\s/])claude(?:[\s]|$)/ }),
  Object.freeze({ kind: "codex", re: /(?:^|[\s/])codex(?:[\s]|$)/ }),
  Object.freeze({ kind: "kimi", re: /Kimi Code|(?:^|[\s/])kimi(?:[\s]|$)/ }),
  Object.freeze({ kind: "cursor", re: /cursor-agent/ }),
  Object.freeze({ kind: "opencode", re: /(?:^|[\s/])opencode(?:[\s]|$)/ }),
  Object.freeze({ kind: "gemini", re: /(?:^|[\s/])gemini(?:[\s]|$)/ }),
]);

function etimeToSeconds(etime) {
  const match = String(etime || "").trim().match(/^(?:(\d+)-)?(\d+):(\d+)(?::(\d+))?$/);
  if (!match) return 0;
  const days = Number(match[1] || 0);
  const rest = match[4] !== undefined
    ? [Number(match[2]), Number(match[3]), Number(match[4])]
    : [0, Number(match[2]), Number(match[3])];
  return days * 86400 + rest[0] * 3600 + rest[1] * 60 + rest[2];
}

function listProcessAgents() {
  if (processDiscoveryCache && Date.now() - processDiscoveryCache.at < PROCESS_DISCOVERY_CACHE_MS) {
    return processDiscoveryCache.value;
  }
  let psOutput;
  try {
    psOutput = execFileSync("ps", ["-eo", "pid=,ppid=,etime=,args="], { encoding: "utf8", timeout: 3000 });
  } catch { return []; }
  const procs = new Map();
  for (const line of psOutput.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (match) procs.set(Number(match[1]), { pid: Number(match[1]), ppid: Number(match[2]), etime: match[3], args: match[4] });
  }
  let panePids = new Set();
  try {
    panePids = new Set(execFileSync("tmux", ["list-panes", "-a", "-F", "#{pane_pid}"], { encoding: "utf8", timeout: 3000 })
      .split("\n").filter(Boolean).map(Number));
  } catch {}
  const candidates = [];
  for (const proc of procs.values()) {
    const pattern = PROCESS_PATTERNS.find((entry) => entry.re.test(proc.args));
    if (pattern) candidates.push({ ...proc, kind: pattern.kind });
  }
  const candidatePids = new Set(candidates.map((proc) => proc.pid));
  const sessions = [];
  for (const proc of candidates) {
    // Skip if a parent is also a candidate (keep the topmost process only),
    // or if the process lives inside a tmux pane (already covered by tmux discovery).
    let ancestor = proc.ppid;
    let covered = false;
    for (let depth = 0; depth < 32 && ancestor > 1; depth += 1) {
      if (candidatePids.has(ancestor) || panePids.has(ancestor)) { covered = true; break; }
      const parent = procs.get(ancestor);
      if (!parent) break;
      if (/tmux/.test(parent.args)) { covered = true; break; }
      ancestor = parent.ppid;
    }
    if (covered) continue;
    let cwd = null;
    try { cwd = fs.readlinkSync(`/proc/${proc.pid}/cwd`); } catch {}
    const agent = Object.values(AGENT_KINDS).find((entry) => entry.kind === proc.kind)
      || { kind: proc.kind, label: proc.kind[0].toUpperCase() + proc.kind.slice(1), supportsConfig: false };
    const seconds = etimeToSeconds(proc.etime);
    const started = new Date(Date.now() - seconds * 1000);
    const folder = cwd ? cwd.split("/").filter(Boolean).pop() : null;
    sessions.push({
      sessionId: `proc:${proc.pid}`, processId: proc.pid, tmuxName: null,
      title: `${agent.label} · ${folder || "unknown dir"}`,
      defaultTitle: `${agent.label} · ${folder || "unknown dir"}`,
      branchName: null, baseBranch: null, worktreePath: cwd,
      status: "active", model: agent.label, kind: agent.kind,
      supportsConfig: false, provider: `${agent.kind}-proc`,
      externalTmux: false, externalProcess: true, activity: "detached",
      createdAt: started, updatedAt: started,
    });
  }
  processDiscoveryCache = { at: Date.now(), value: sessions };
  return sessions;
}

function captureTmuxSession(name, lines = 240, options = {}) {
  const safe = safeTmuxName(name);
  if (!safe) throw new Error("Invalid tmux session");
  const now = Date.now();
  const styled = !!options.styled;
  const styledSuffix = styled ? "e" : "p";
  const key = `${safe}:${lines}:${styledSuffix}`;
  const cached = captureCache.get(key);
  if (cached && now - cached.at < CAPTURE_CACHE_MS) return cached.value;
  // Serve a smaller capture from a larger fresh cached one with the SAME
  // styled flag instead of forking tmux again. The pane only grows downward,
  // so a superset capture's tail is identical to what a smaller one returns.
  // (Styled and plain captures differ — never cross-serve between them.)
  const prefix = `${safe}:`;
  for (const [k, v] of captureCache) {
    if (!k.startsWith(prefix)) continue;
    if (now - v.at >= CAPTURE_CACHE_MS) continue;
    if (!k.endsWith(`:${styledSuffix}`)) continue;
    const mid = k.slice(prefix.length, k.lastIndexOf(":"));
    const cachedLines = Number(mid);
    if (cachedLines > lines) {
      const sliced = tailLines(v.value, lines);
      captureCache.set(key, { at: now, value: sliced });
      return sliced;
    }
  }
  // styled=true keeps SGR escape sequences (-e) so the transcript parser can
  // tell dim/italic thinking text apart from the agent's actual responses.
  const args = ["capture-pane", "-p", "-J"];
  if (styled) args.push("-e");
  args.push("-S", `-${lines}`, "-t", safe);
  const value = execFileSync("tmux", args,
    { encoding: "utf8", timeout: 3000, maxBuffer: 1024 * 1024 });
  captureCache.set(key, { at: now, value });
  return value;
}

// Return the last `n` lines of a captured pane string (cheap string work,
// no subprocess). A captured pane ends with a trailing newline, which
// `split("\n")` turns into a final "" element; we slice the content lines
// and re-append the trailing newline so callers see the same shape.
function tailLines(text, n) {
  if (!text) return text;
  const lines = text.split("\n");
  const hasTrailing = lines[lines.length - 1] === "";
  const content = hasTrailing ? lines.slice(0, -1) : lines;
  if (content.length <= n) return text;
  const slice = content.slice(content.length - n);
  return slice.join("\n") + (hasTrailing ? "\n" : "");
}

async function sendTmuxInput(name, text) {
  const safe = safeTmuxName(name);
  if (!safe) throw new Error("Invalid tmux session");
  const input = String(text || "");
  if (!input || input.length > 16_000) throw new Error("Input must be 1–16000 characters");
  // ACP sessions have no composer in the pane — deliver through the happy
  // relay instead, exactly as the mobile app would. Every message path
  // (composer POST, queue drain, seeding, recheck nudges) funnels through
  // here, so this one switch covers them all.
  if (isHappyAcpSession(safe)) {
    const happyId = happyBridge.happySessionIdForTmux(safe);
    if (!happyId) throw new Error("Happy session id not visible yet — try again in a few seconds");
    await happyBridge.sendHappyUserMessage(happyId, input);
    clearAgentRuntimeCaches(safe);
    return;
  }
  // Paste via the tmux buffer (bracketed paste) instead of send-keys -l:
  // send-keys types newlines as Enter, so multi-line messages got submitted
  // piecemeal and "cut off". Pasting delivers the whole message atomically.
  const tmp = path.join(os.tmpdir(), `ops-tmux-paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  fs.writeFileSync(tmp, input.replace(/\r/g, "").replace(/\n+$/, ""), { mode: 0o600 });
  try {
    execFileSync("tmux", ["load-buffer", tmp], { timeout: 3000 });
    execFileSync("tmux", ["paste-buffer", "-d", "-p", "-t", safe], { timeout: 3000 });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
  await sleep(400);
  execFileSync("tmux", ["send-keys", "-t", safe, "Enter"], { timeout: 3000 });
  clearAgentRuntimeCaches(safe);
}

function sendTmuxKey(name, key) {
  const safe = safeTmuxName(name);
  if (!safe) throw new Error("Invalid tmux session");
  const raw = String(key || "");
  // Single printable chars (y/n/1/2/3…) answer permission prompts literally.
  if (/^[a-z0-9]$/i.test(raw)) {
    execFileSync("tmux", ["send-keys", "-t", safe, "-l", raw], { timeout: 3000 });
    clearAgentRuntimeCaches(safe);
    return;
  }
  const tmuxKey = safeTmuxKey(raw);
  if (!tmuxKey) throw new Error("Invalid terminal key");
  execFileSync("tmux", ["send-keys", "-t", safe, tmuxKey], { timeout: 3000 });
  clearAgentRuntimeCaches(safe);
}

function codexSelectionSteps(model, effort, currentModel) {
  const requestedModel = String(model || "");
  // Codex renders the active model first in the /model picker. Navigating by
  // the static catalog index makes the first choice select the current model
  // (Luna on this host), which made SOL appear to switch and immediately
  // revert. Keep the current item first, then use the stable catalog order.
  const activeModel = CODEX_MODELS.includes(String(currentModel || "")) ? String(currentModel) : "";
  const pickerModels = activeModel
    ? [activeModel, ...CODEX_MODELS.filter((entry) => entry !== activeModel)]
    : CODEX_MODELS;
  const modelIndex = pickerModels.indexOf(requestedModel);
  const effortIndex = CODEX_EFFORTS.indexOf(String(effort || "").toLowerCase());
  if (modelIndex < 0 || effortIndex < 0) throw new Error("Unsupported Codex model or effort");
  const steps = [["literal", "/model"], ["key", "Enter"], ["key", "Home"]];
  for (let i = 0; i < modelIndex; i += 1) steps.push(["key", "Down"]);
  steps.push(["key", "Enter"], ["key", "Home"]);
  if (effortIndex < 4) {
    for (let i = 0; i < effortIndex; i += 1) steps.push(["key", "Down"]);
    steps.push(["key", "Enter"]);
  } else {
    for (let i = 0; i < 4; i += 1) steps.push(["key", "Down"]);
    steps.push(["key", "Enter"], ["key", "Home"]);
    if (effortIndex === 5) steps.push(["key", "Down"]);
    steps.push(["key", "Enter"]);
  }
  return steps;
}

// ── Permission modes (per provider) ──────────────────────
// Labels match each CLI's own language. Mid-session changes prefer
// injecting the provider's slash command (no restart). `autoApprove`
// means the dash auto-answers residual permission prompts.
const PERMISSION_MODES = Object.freeze({
  claude: Object.freeze([
    // Root cannot use --dangerously-skip-permissions; --permission-mode auto is the
    // supported Auto path, with the dash still auto-approving UI prompts.
    Object.freeze({ id: "auto", label: "Auto", description: "Dash auto-approves permission prompts", flags: "--permission-mode auto", slash: null, autoApprove: true, needsConfirm: true }),
    Object.freeze({ id: "ask", label: "Ask", description: "Confirm before tools run", flags: "--permission-mode manual", slash: null, autoApprove: false, needsConfirm: false }),
    // No slash: `/permission-mode` is a CLI flag, not a command, and `/plan` only
    // ever enters plan mode. Every Claude mode change goes through the shift+tab
    // cycle instead — see cycleClaudePermission.
    Object.freeze({ id: "plan", label: "Plan", description: "Read-only planning — propose changes, no edits", flags: "--permission-mode plan", slash: null, autoApprove: false, needsConfirm: false }),
  ]),
  codex: Object.freeze([
    Object.freeze({ id: "auto", label: "Auto", description: "Dash auto-approves approval prompts", flags: "--ask-for-approval never --sandbox danger-full-access", slash: null, autoApprove: true, needsConfirm: true }),
    Object.freeze({ id: "ask", label: "Ask", description: "Approve commands on request", flags: "--ask-for-approval on-request --sandbox workspace-write", slash: null, autoApprove: false, needsConfirm: false }),
  ]),
  kimi: Object.freeze([
    Object.freeze({ id: "yolo", label: "Yolo", description: "Dash auto-approves all actions", flags: "--yolo", slash: null, autoApprove: true, needsConfirm: true }),
    Object.freeze({ id: "ask", label: "Ask", description: "Confirm before actions", flags: "", slash: null, autoApprove: false, needsConfirm: false }),
    Object.freeze({ id: "plan", label: "Plan", description: "Read-only plan mode", flags: "--plan", slash: null, restart: true, autoApprove: false, needsConfirm: false }),
  ]),
  cursor: Object.freeze([
    Object.freeze({ id: "yolo", label: "Run Everything", description: "Force-allow all commands", flags: "--yolo --trust --approve-mcps", slash: "/run-everything on", autoApprove: true, needsConfirm: true }),
    Object.freeze({ id: "auto", label: "Auto", description: "Smart auto-review for safe calls", flags: "--auto-review --trust --approve-mcps", slash: "/auto-review", autoApprove: true, needsConfirm: true }),
    Object.freeze({ id: "ask", label: "Ask", description: "Prompt for each command", flags: "--trust --approve-mcps", slash: "/run-everything off", autoApprove: false, needsConfirm: false }),
    Object.freeze({ id: "plan", label: "Plan", description: "Read-only planning — analyze and propose, no edits", flags: "--plan --trust --approve-mcps", slash: null, restart: true, autoApprove: false, needsConfirm: false }),
  ]),
  // OpenCode TUI — model is chosen separately via -m; these flags only pick the agent.
  opencode: Object.freeze([
    Object.freeze({ id: "auto", label: "Auto", description: "Build agent — tools allowed", flags: "--agent build", slash: null, autoApprove: true, needsConfirm: true }),
    Object.freeze({ id: "ask", label: "Ask", description: "Build agent — confirm external dirs", flags: "--agent build", slash: null, autoApprove: false, needsConfirm: false }),
    Object.freeze({ id: "plan", label: "Plan", description: "Plan agent — read-only", flags: "--agent plan", slash: null, restart: true, autoApprove: false, needsConfirm: false }),
  ]),
  // Ollama Cloud via OpenCode (ollama.com) — model picked in the spawn UI.
  ollama: Object.freeze([
    Object.freeze({ id: "auto", label: "Auto", description: "Build agent — tools allowed", flags: "--agent build", slash: null, autoApprove: true, needsConfirm: true }),
    Object.freeze({ id: "ask", label: "Ask", description: "Build agent — confirm external dirs", flags: "--agent build", slash: null, autoApprove: false, needsConfirm: false }),
    Object.freeze({ id: "plan", label: "Plan", description: "Plan agent — read-only", flags: "--agent plan", slash: null, restart: true, autoApprove: false, needsConfirm: false }),
  ]),
});

// Per-tmux metadata so we can respawn into the *same* provider chat (Cursor)
// instead of the CLI's default "resume picker / latest session" behavior.
const providerMetaBySession = new Map();

const SPAWN_BINARIES = Object.freeze({
  claude: Object.freeze({ prefix: "claude", binary: resolveBinary("claude") }),
  codex: Object.freeze({ prefix: "gpt", binary: resolveBinary("codex") }),
  kimi: Object.freeze({ prefix: "kimi", binary: resolveBinary("kimi") }),
  cursor: Object.freeze({ prefix: "cursor", binary: resolveBinary("cursor") }),
  opencode: Object.freeze({ prefix: "opencode", binary: resolveBinary("opencode") }),
  ollama: Object.freeze({ prefix: "ollama", binary: resolveBinary("opencode") }),
});

// ── Happy wrapper ────────────────────────────────────────
// Sessions spawn through `happy` (happy.engineering) when it is installed and
// authenticated, which mirrors the agent to the Happy mobile app. Claude keeps
// its interactive TUI in the pane — happy is transparent for it and all
// pane-driven machinery (capture, keystrokes, permission cycling) still
// applies.
//
// The rest run HEADLESS: kimi/opencode as ACP servers (`happy acp`, pane is a
// status log), codex through happy's app-server flavor (`happy codex`, pane is
// an inert box UI). For headless sessions, messages, transcripts and busyness
// flow through happy-bridge (relay) rather than the pane — all flavors
// normalize to the same session-protocol envelopes, verified live 2026-08-05.
// Cursor has no happy integration and always spawns bare.
// Set HAPPY_WRAP=0 to spawn every provider bare.
const HAPPY_BINARY = resolveBinary("happy");
const HAPPY_ACP_PROVIDERS = Object.freeze(new Set(["kimi", "opencode", "ollama"]));
const HAPPY_HEADLESS_PROVIDERS = Object.freeze(new Set(["kimi", "opencode", "ollama", "codex"]));
const HAPPY_UNWRAPPED_PROVIDERS = Object.freeze(new Set(["cursor"]));

function happyBinaryExists() {
  // resolveBinary falls back to the bare name ("rely on PATH") — check the
  // same dirs agentCliEnv puts on the pane's PATH, not the dash's own cwd.
  if (path.isAbsolute(HAPPY_BINARY)) return fs.existsSync(HAPPY_BINARY);
  return agentPathExtras().some((dir) => {
    try { return fs.existsSync(path.join(dir, HAPPY_BINARY)); } catch { return false; }
  });
}

function happyWrapEnabled() {
  if (process.env.HAPPY_WRAP === "0") return false;
  try { return happyBridge.happyAvailable() && happyBinaryExists(); } catch { return false; }
}

/**
 * True when this tmux session is a headless happy session (no usable TUI in
 * the pane — ACP kimi/opencode, or app-server codex). Spawn metadata is
 * authoritative; after a dash restart the metadata map is empty, so fall back
 * to whether a happy session resolves for the pane (banner or process tree).
 * A bare legacy TUI session resolves nothing and stays pane-driven.
 */
function isHappyHeadlessSession(name) {
  const safe = safeTmuxName(name);
  if (!safe) return false;
  const kind = agentKindFor(safe)?.kind;
  if (!HAPPY_HEADLESS_PROVIDERS.has(kind)) return false;
  const meta = providerMetaBySession.get(safe);
  if (meta && "happyAcp" in meta) return !!meta.happyAcp;
  return !!happyBridge.happySessionIdForTmux(safe);
}

// Back-compat alias — earlier callers predate codex joining the headless set.
const isHappyAcpSession = isHappyHeadlessSession;

// Back-compat for callers that still read SPAWN_COMMANDS.*.command
const SPAWN_COMMANDS = Object.freeze(Object.fromEntries(
  Object.entries(SPAWN_BINARIES).map(([kind, spec]) => {
    const mode = PERMISSION_MODES[kind][0];
    const command = [spec.binary, mode.flags].filter(Boolean).join(" ").trim();
    return [kind, Object.freeze({ prefix: spec.prefix, command, binary: spec.binary })];
  })
));

function defaultPermissionMode(kind) {
  return PERMISSION_MODES[kind]?.[0]?.id || "auto";
}

function resolvePermissionMode(kind, mode) {
  const modes = PERMISSION_MODES[kind] || [];
  return modes.find((entry) => entry.id === mode) || modes[0] || null;
}

function modelsForProvider(kind) {
  if (kind === "ollama") return [...OLLAMA_CLOUD_MODELS];
  if (kind === "opencode") return [...OPENCODE_GO_MODELS];
  return [];
}

function defaultModelForProvider(kind) {
  return DEFAULT_OPENCODE_MODELS[kind] || modelsForProvider(kind)[0] || null;
}

function resolveSpawnModel(kind, model) {
  const catalog = modelsForProvider(kind);
  if (!catalog.length) return null;
  const wanted = String(model || "").trim();
  // Accept bare ids or provider/id forms.
  const bare = wanted.includes("/") ? wanted.split("/").slice(1).join("/") : wanted;
  if (bare && catalog.includes(bare)) return bare;
  // Live catalogs grow ahead of the static list — allow any plausible id.
  if (bare && /^[\w.:@+/-]+$/.test(bare)) return bare;
  return defaultModelForProvider(kind);
}

function buildSpawnCommand(kind, mode, model, options = {}) {
  const spec = SPAWN_BINARIES[kind];
  const perm = resolvePermissionMode(kind, mode);
  if (!spec || !perm) throw new Error("Unsupported provider — choose claude, codex, kimi, cursor, opencode or ollama");
  // `options.wrap` pins the decision for restarts: an existing TUI kimi must
  // respawn as a TUI (its -C resume flags mean nothing to an ACP server), and
  // an ACP session must stay ACP. New spawns leave it undefined and follow
  // the global switch.
  const wrap = !HAPPY_UNWRAPPED_PROVIDERS.has(kind)
    && (options.wrap !== undefined ? !!options.wrap : happyWrapEnabled());
  if (wrap && HAPPY_ACP_PROVIDERS.has(kind)) {
    // The acp subcommands accept no flags: model rides in the environment
    // (OPENCODE_CONFIG_CONTENT, see spawnTmuxAgent) and permission policy is
    // the ACP client's, so perm.flags and -m are intentionally absent here.
    return `${HAPPY_BINARY} acp -- ${spec.binary} acp`;
  }
  if (wrap && kind === "codex") {
    // happy's codex flavor forwards codex args (verified with the approval and
    // sandbox flags), so permission modes survive the wrap.
    return [`${HAPPY_BINARY} codex`, perm.flags].filter(Boolean).join(" ").trim();
  }
  const parts = [wrap ? HAPPY_BINARY : spec.binary, perm.flags].filter(Boolean);
  const cloudProvider = OPENCODE_MODEL_PROVIDERS[kind];
  if (cloudProvider) {
    const resolved = resolveSpawnModel(kind, model);
    if (!resolved) throw new Error(`No models configured for ${kind}`);
    parts.push("-m", `${cloudProvider}/${resolved}`);
  }
  return parts.join(" ").trim();
}

/** Env additions a spawn needs beyond withAgentHomeEnv's defaults. */
function spawnEnvExtras(kind, model) {
  if (!happyWrapEnabled() || !HAPPY_ACP_PROVIDERS.has(kind)) return {};
  const cloudProvider = OPENCODE_MODEL_PROVIDERS[kind];
  if (!cloudProvider) return {};
  const resolved = resolveSpawnModel(kind, model);
  if (!resolved) return {};
  // OpenCode merges OPENCODE_CONFIG_CONTENT on top of its global config, so
  // this pins the model without touching provider/auth definitions.
  return { OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: `${cloudProvider}/${resolved}` }) };
}

function permissionModesFor(kind) {
  return (PERMISSION_MODES[kind] || []).map((entry) => ({
    id: entry.id,
    label: entry.label,
    description: entry.description,
    autoApprove: entry.autoApprove,
    needsConfirm: !!entry.needsConfirm,
    hasSlash: !!entry.slash,
    restart: !!entry.restart,
  }));
}

/**
 * Models that can be switched to *within* a running session. Separate from
 * modelsForProvider, which answers a different question — what the spawn modal
 * must choose up front — and only covers the cloud providers.
 */
function selectableModelsFor(kind) {
  // Filtered through the router's deny list, so a banned model is unreachable
  // from the picker, the API, and a stored schedule alike — not merely hidden.
  if (kind === "claude") return allowedModels(CLAUDE_MODELS);
  if (kind === "codex") return allowedModels(CODEX_MODELS);
  if (kind === "kimi") return allowedModels(KIMI_MODELS);
  return allowedModels(modelsForProvider(kind));
}

/** Effort/thinking levels a provider accepts alongside a model choice. */
function effortsForProvider(kind) {
  if (kind === "claude") return [...CLAUDE_EFFORTS];
  if (kind === "codex") return [...CODEX_EFFORTS];
  // Kimi has no effort scale — thinking is simply on or off.
  if (kind === "kimi") return ["standard", "thinking"];
  return [];
}

function spawnOptionsFor(kind) {
  const modes = permissionModesFor(kind);
  // Cloud (OpenCode-backed) providers pick their model at spawn; every other
  // provider's picker uses the same catalog mid-session selection does, so the
  // spawn sheet can offer model + effort for claude/codex/kimi too instead of
  // an empty list.
  const catalog = OPENCODE_MODEL_PROVIDERS[kind] ? modelsForProvider(kind) : selectableModelsFor(kind);
  const models = catalog.map((id) => ({
    id,
    label: id,
    providerModel: OPENCODE_MODEL_PROVIDERS[kind] ? `${OPENCODE_MODEL_PROVIDERS[kind]}/${id}` : id,
  }));
  return {
    kind,
    modes,
    models,
    efforts: effortsForProvider(kind),
    defaultModel: defaultModelForProvider(kind),
    defaultMode: modes[0]?.id || "auto",
  };
}

function createCursorChatId() {
  // Cursor's `agent create-chat` prints a UUID then hangs. Poll a temp file so
  // we can SIGTERM as soon as the id appears (~2s) instead of waiting 20s+.
  const outFile = path.join(os.tmpdir(), `cursor-chat-${process.pid}-${Date.now()}.txt`);
  const script = `
set -e
rm -f ${shellSingleQuote(outFile)}
stdbuf -oL -eL ${shellSingleQuote(SPAWN_BINARIES.cursor.binary)} create-chat > ${shellSingleQuote(outFile)} 2>/dev/null &
pid=$!
for _ in $(seq 1 200); do
  if [ -s ${shellSingleQuote(outFile)} ]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    cat ${shellSingleQuote(outFile)}
    rm -f ${shellSingleQuote(outFile)}
    exit 0
  fi
  sleep 0.05
done
kill "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true
rm -f ${shellSingleQuote(outFile)}
exit 1
`.trim();
  let out = "";
  try {
    out = execFileSync("bash", ["-c", script], {
      encoding: "utf8",
      timeout: 15000,
      env: agentCliEnv(),
    }).trim();
  } catch (error) {
    try { out = fs.readFileSync(outFile, "utf8").trim(); } catch { /* ignore */ }
    try { fs.unlinkSync(outFile); } catch { /* ignore */ }
    out = out || String(error.stdout || "").trim();
    if (!out) {
      throw new Error(
        `Cursor create-chat failed: ${String(error.stderr || error.message || "empty response").slice(0, 160)}`
      );
    }
  }
  const id = out.split(/\s+/).filter(Boolean).pop() || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`Cursor create-chat failed: ${out.slice(0, 120) || "empty response"}`);
  }
  return id;
}

function freshClaudeSessionId() {
  return require("node:crypto").randomUUID();
}

function detectAgentMode(kind, output) {
  const text = String(output || "");
  if (kind === "cursor") {
    const switches = [...text.matchAll(/\bSwitchMode\s*(?:→|->)\s*([A-Za-z][\w ]+?)\s+Mode\s+switch\s+approved\b/gi)];
    if (switches.length) {
      const last = String(switches[switches.length - 1][1] || "").trim().toLowerCase();
      if (/^plan\b/.test(last)) return { id: "plan", label: "Plan" };
      if (/^agent\b|^ask\b/.test(last)) return { id: "agent", label: "Agent" };
    }
    if (/\bplan\s+mode\b/i.test(text.slice(-500)) && !/\bagent\s+mode\b/i.test(text.slice(-200))) {
      return { id: "plan", label: "Plan" };
    }
  }
  if (kind === "kimi" && /shift-tab:\s*plan mode/i.test(text.slice(-400)) && /\bplan\b/i.test(text.slice(-200))) {
    // Kimi footer always mentions plan mode; only treat as active when the
    // mode chip / banner says so.
    if (/\b(?:in\s+)?plan\s+mode\b/i.test(text.slice(-300)) && !/\byolo\s+agent\b/i.test(text.slice(-120))) {
      return { id: "plan", label: "Plan" };
    }
  }
  if (kind === "claude" && /\bpermission\s*mode[:\s]+plan\b/i.test(text.slice(-500))) {
    return { id: "plan", label: "Plan" };
  }
  return null;
}

const PERMS_FILE = path.join(__dirname, "data", "tmux-permissions.json");
const permissionBySession = new Map();
const lastAutoApproveAt = new Map();
PER_SESSION_MAPS.push(permissionBySession, lastAutoApproveAt);

function loadPermissionModes() {
  try {
    const saved = JSON.parse(fs.readFileSync(PERMS_FILE, "utf8"));
    for (const [name, mode] of Object.entries(saved || {})) {
      if (safeTmuxName(name) && typeof mode === "string") permissionBySession.set(name, mode);
    }
  } catch { /* first boot */ }
}

function savePermissionModes() {
  try {
    fs.mkdirSync(path.dirname(PERMS_FILE), { recursive: true });
    fs.writeFileSync(PERMS_FILE, JSON.stringify(Object.fromEntries(permissionBySession), null, 2));
  } catch { /* ignore persistence failures */ }
}

// Custom titles + named groups for live agents (tmux/process). Survives restarts;
// keyed by sessionId (`tmux:…` / `proc:…`). Stale keys for dead sessions are pruned
// whenever the lander loads.
const AGENT_ORG_FILE = path.join(__dirname, "data", "tmux-agent-org.json");
const agentOrg = {
  groups: [], // { id, name, createdAt }
  titles: Object.create(null), // sessionId -> title
  membership: Object.create(null), // sessionId -> groupId
};

function loadAgentOrg() {
  try {
    const saved = JSON.parse(fs.readFileSync(AGENT_ORG_FILE, "utf8"));
    agentOrg.groups = Array.isArray(saved?.groups) ? saved.groups.filter((g) => g && g.id && g.name) : [];
    agentOrg.titles = saved?.titles && typeof saved.titles === "object" ? { ...saved.titles } : Object.create(null);
    agentOrg.membership = saved?.membership && typeof saved.membership === "object"
      ? { ...saved.membership }
      : Object.create(null);
  } catch { /* first boot */ }
}

function saveAgentOrg() {
  try {
    fs.mkdirSync(path.dirname(AGENT_ORG_FILE), { recursive: true });
    fs.writeFileSync(AGENT_ORG_FILE, JSON.stringify({
      groups: agentOrg.groups,
      titles: agentOrg.titles,
      membership: agentOrg.membership,
    }, null, 2));
  } catch { /* ignore persistence failures */ }
}

loadAgentOrg();

function newGroupId() {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeTitle(title) {
  const cleaned = String(title || "").trim().replace(/\s+/g, " ").slice(0, 120);
  return cleaned || null;
}

function sanitizeGroupName(name) {
  const cleaned = String(name || "").trim().replace(/\s+/g, " ").slice(0, 60);
  return cleaned || null;
}

function isLiveSessionId(sessionId) {
  return /^(?:tmux|proc):/.test(String(sessionId || ""));
}

function listAgentGroups() {
  return agentOrg.groups.map((g) => ({ id: g.id, name: g.name, createdAt: g.createdAt }));
}

function createAgentGroup(name) {
  const cleaned = sanitizeGroupName(name);
  if (!cleaned) throw new Error("Group name required");
  if (agentOrg.groups.some((g) => g.name.toLowerCase() === cleaned.toLowerCase())) {
    throw new Error("A group with that name already exists");
  }
  const group = { id: newGroupId(), name: cleaned, createdAt: new Date().toISOString() };
  agentOrg.groups.push(group);
  saveAgentOrg();
  return group;
}

function renameAgentGroup(groupId, name) {
  const group = agentOrg.groups.find((g) => g.id === groupId);
  if (!group) throw new Error("Group not found");
  const cleaned = sanitizeGroupName(name);
  if (!cleaned) throw new Error("Group name required");
  if (agentOrg.groups.some((g) => g.id !== groupId && g.name.toLowerCase() === cleaned.toLowerCase())) {
    throw new Error("A group with that name already exists");
  }
  group.name = cleaned;
  saveAgentOrg();
  return group;
}

function deleteAgentGroup(groupId) {
  const before = agentOrg.groups.length;
  agentOrg.groups = agentOrg.groups.filter((g) => g.id !== groupId);
  if (agentOrg.groups.length === before) throw new Error("Group not found");
  for (const [sessionId, gid] of Object.entries(agentOrg.membership)) {
    if (gid === groupId) delete agentOrg.membership[sessionId];
  }
  saveAgentOrg();
  return { ok: true };
}

function setAgentTitle(sessionId, title) {
  const id = String(sessionId || "");
  if (!isLiveSessionId(id)) throw new Error("Invalid live agent session");
  const cleaned = sanitizeTitle(title);
  if (!cleaned) {
    delete agentOrg.titles[id];
  } else {
    agentOrg.titles[id] = cleaned;
  }
  saveAgentOrg();
  return { sessionId: id, title: cleaned };
}

function setAgentGroup(sessionId, groupId) {
  const id = String(sessionId || "");
  if (!isLiveSessionId(id)) throw new Error("Invalid live agent session");
  if (!groupId) {
    delete agentOrg.membership[id];
    saveAgentOrg();
    return { sessionId: id, groupId: null };
  }
  if (!agentOrg.groups.some((g) => g.id === groupId)) throw new Error("Group not found");
  agentOrg.membership[id] = groupId;
  saveAgentOrg();
  return { sessionId: id, groupId };
}

function pruneAgentOrg(liveSessionIds) {
  const live = new Set((liveSessionIds || []).map(String));
  let changed = false;
  for (const id of Object.keys(agentOrg.titles)) {
    if (!live.has(id)) { delete agentOrg.titles[id]; changed = true; }
  }
  for (const id of Object.keys(agentOrg.membership)) {
    if (!live.has(id)) { delete agentOrg.membership[id]; changed = true; }
  }
  if (changed) saveAgentOrg();
}

function applyAgentOrg(session) {
  if (!session || !session.sessionId) return session;
  const id = session.sessionId;
  const customTitle = agentOrg.titles[id];
  const groupId = agentOrg.membership[id] || null;
  const group = groupId ? agentOrg.groups.find((g) => g.id === groupId) : null;
  return {
    ...session,
    defaultTitle: session.defaultTitle || session.title,
    title: customTitle || session.title,
    customTitle: customTitle || null,
    groupId: group ? group.id : null,
    groupName: group ? group.name : null,
  };
}

function enrichLiveSessions(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  pruneAgentOrg(list.map((s) => s.sessionId));
  return list.map(applyAgentOrg);
}

function getPermissionMode(name) {
  const safe = safeTmuxName(name);
  const kind = agentKindFor(safe)?.kind || "codex";
  const stored = permissionBySession.get(safe);
  if (stored && resolvePermissionMode(kind, stored)) return stored;
  return defaultPermissionMode(kind);
}

// The dash exposes three modes; the CLI has six. These are the two it can name.
const CLAUDE_DASH_TO_CLI = Object.freeze({ auto: "auto", ask: "default", plan: "plan" });
// The cycle is at most six modes long, so eight presses is one full lap plus slack.
// Bounded because a CLI that ignores the key entirely must fail, not spin.
const CLAUDE_CYCLE_MAX_PRESSES = 8;
const CLAUDE_CYCLE_SETTLE_MS = 140;

/**
 * Put a live Claude pane into `targetDashMode` by pressing shift+tab and reading
 * the footer back after each press.
 *
 * Claude has no slash command for leaving plan mode — `/plan` only enters it, and
 * `/permission-mode` is a CLI flag, not a command. Cycling is the mechanism the CLI
 * itself advertises ("shift+tab to cycle"), and the footer names the new mode on the
 * very next repaint, so each press can be verified instead of counted.
 *
 * Modes the dash does not expose (accept edits, bypass permissions) are passed
 * through on the way; only the target ends the loop.
 */
async function cycleClaudePermission(safe, targetDashMode) {
  const target = CLAUDE_DASH_TO_CLI[targetDashMode];
  if (!target) return { landed: false, mode: null, presses: 0, reason: "unsupported" };

  // A pane that cannot be captured (gone, or tmux refusing) reads as an empty
  // frame, which the checks below treat as "unreadable" and refuse to press into.
  const frame = () => {
    try { return captureTmuxSession(safe, 40); } catch { return ""; }
  };

  // A menu or an approval prompt owns the keyboard: shift+tab there does something
  // other than cycle, and the mode footer is not on screen to read back.
  const open = frame();
  if (detectPendingQuestion("claude", open) || detectAttention("claude", open)) {
    return { landed: false, mode: null, presses: 0, reason: "awaiting_answer" };
  }

  const readMode = () => {
    clearAgentRuntimeCaches(safe);
    return claudeModeFromPane(frame());
  };

  let current = readMode();
  if (current === target) return { landed: true, mode: current, presses: 0 };
  // An unreadable frame means the pane is mid-repaint or not a drawn Claude UI.
  // Pressing blind could land anywhere, so refuse rather than guess.
  if (current === null) return { landed: false, mode: null, presses: 0, reason: "unreadable" };

  const seen = new Set([current]);
  for (let presses = 1; presses <= CLAUDE_CYCLE_MAX_PRESSES; presses += 1) {
    execFileSync("tmux", ["send-keys", "-t", safe, TMUX_KEYS["shift-tab"]], { timeout: 3000 });
    await sleep(CLAUDE_CYCLE_SETTLE_MS);
    const next = readMode();
    if (next === target) return { landed: true, mode: next, presses };
    // A full lap with no new mode means the key is not reaching the CLI.
    if (next !== null && seen.has(next) && seen.size > 1) {
      return { landed: false, mode: next, presses, reason: "cycled_without_target" };
    }
    if (next !== null) seen.add(next);
    current = next;
  }
  return { landed: false, mode: current, presses: CLAUDE_CYCLE_MAX_PRESSES, reason: "exhausted" };
}

async function setPermissionMode(name, mode, opts = {}) {
  const safe = safeTmuxName(name);
  if (!safe) throw new Error("Invalid agent session");
  const kind = agentKindFor(safe)?.kind || "codex";
  const resolved = resolvePermissionMode(kind, mode);
  if (!resolved) throw new Error("Unsupported permission mode for this provider");

  // Auto / Yolo / Run Everything need an explicit confirm from the client UX.
  if (resolved.needsConfirm && !opts.confirmed) {
    const error = new Error(`Confirm enabling ${resolved.label} — the agent will run tools with fewer prompts.`);
    error.statusCode = 400;
    error.code = "needs_confirm";
    error.permissions = {
      mode: getPermissionMode(safe),
      label: resolvePermissionMode(kind, getPermissionMode(safe))?.label,
      autoApprove: !!resolvePermissionMode(kind, getPermissionMode(safe))?.autoApprove,
      modes: permissionModesFor(kind),
      pendingMode: resolved.id,
      pendingLabel: resolved.label,
    };
    throw error;
  }

  const previousMode = getPermissionMode(safe);
  const leavingOrEnteringPlan = resolved.id === "plan" || previousMode === "plan";
  const preferRestart = !!resolved.restart
    || opts.restart === true
    || ((kind === "cursor" || kind === "kimi") && leavingOrEnteringPlan);
  const cycles = kind === "claude" && !preferRestart;

  const refuseIfBusy = () => {
    if (!isAgentBusy(safe)) return;
    const error = new Error("Agent is busy. Stop or wait before changing permissions.");
    error.statusCode = 409;
    throw error;
  };

  // Everything except the Claude cycle records the new mode up front, because the
  // dash's own record is all those paths have. The cycle reads the CLI back, so it
  // records only what actually landed — writing first is exactly what made a failed
  // change look successful and then snap back on the next poll.
  if (!cycles) {
    permissionBySession.set(safe, resolved.id);
    savePermissionModes();
  }

  let injected = null;
  let restarted = false;
  let landed = true;
  let liveMode = null;
  if (cycles) {
    refuseIfBusy();
    const result = await cycleClaudePermission(safe, resolved.id);
    landed = result.landed;
    liveMode = result.mode;
    if (landed) {
      permissionBySession.set(safe, resolved.id);
      savePermissionModes();
      injected = `shift+tab ×${result.presses}`;
    } else {
      injected = null;
    }
  } else if (resolved.slash && !preferRestart) {
    refuseIfBusy();
    // Inject the provider's own slash command — no session restart.
    await sendTmuxInput(safe, resolved.slash);
    injected = resolved.slash;
  } else if (preferRestart || resolved.restart) {
    refuseIfBusy();
    const session = listTmuxSessions().find((entry) => entry.tmuxName === safe);
    const cwd = session?.worktreePath || providerMetaBySession.get(safe)?.cwd || "/root";
    const meta = providerMetaBySession.get(safe) || {};
    // A restart must preserve the session's nature: an ACP session respawns as
    // ACP (with its model env), a TUI as a TUI (with its resume flags).
    const acp = isHappyHeadlessSession(safe);
    let command = buildSpawnCommand(kind, resolved.id, meta.model,
      HAPPY_HEADLESS_PROVIDERS.has(kind) ? { wrap: acp } : {});
    if (kind === "cursor") {
      if (meta.chatId) {
        command = `${command} --resume ${meta.chatId}`;
      } else {
        // Pre-fix live agents have no stored chat id — continue the latest
        // chat for this workspace instead of opening an empty one.
        command = `${command} --continue`;
      }
      providerMetaBySession.set(safe, { ...meta, cwd, kind });
    } else if (kind === "kimi" && !acp) {
      // Keep conversation history across the plan-mode restart.
      command = `${command} -C`.trim();
      providerMetaBySession.set(safe, { ...meta, cwd, kind });
    } else if (kind === "claude" && meta.sessionId) {
      // --session-id refuses an id that already has a log, so a respawn has to
      // resume the conversation rather than claim its id a second time.
      command = `${command} --resume ${meta.sessionId}`;
    }
    try { execFileSync("tmux", ["kill-session", "-t", `=${safe}`], { timeout: 3000 }); } catch { /* already gone */ }
    execFileSync("tmux", ["new-session", "-d", "-s", safe, ...AGENT_PANE_SIZE, "-c", cwd,
      withAgentHomeEnv(command, acp ? spawnEnvExtras(kind, meta.model) : {})], {
      timeout: 5000,
      env: agentCliEnv(),
    });
    await sleep(600);
    if (!tmuxSessionExists(safe)) throw new Error(`${command} exited immediately after permission restart`);
    clearAgentRuntimeCaches(safe);
    restarted = true;
    injected = `restarted · ${resolved.label}`;
  }

  // A cycle that did not land leaves the agent where it was. Report the mode the
  // CLI is actually in, not the one that was asked for, and say so — the client
  // offers a restart rather than showing a button that lies.
  const settled = landed ? resolved : (resolvePermissionMode(kind, dashModeFor(liveMode)) || resolved);
  return {
    mode: landed ? resolved.id : (dashModeFor(liveMode) || ""),
    label: landed ? resolved.label : (permissionLabelFor(liveMode) || settled.label),
    autoApprove: landed ? resolved.autoApprove : !!settled.autoApprove,
    modes: permissionModesFor(kind),
    injected,
    restarted,
    landed,
    requestedMode: resolved.id,
    requestedLabel: resolved.label,
    canRestart: landed ? false : kind === "claude",
  };
}

/**
 * What Claude itself reports for its permission mode, or null when unknown.
 * The operator can cycle modes with shift+tab straight in the terminal, so the
 * value the dash remembers from the last time it was asked drifts out of date.
 *
 * The pane footer is the fresher of the two sources and wins. The session log
 * writes its permission-mode record on a state flush, which can trail a mode
 * change by a whole turn — long enough that a change which HAD landed still read
 * as the old mode on the next poll, and the control snapped back under the
 * reader's finger. The log stays as the fallback for a frame that has not
 * finished painting.
 */
function claudeLivePermission(safe, kind) {
  if (kind !== "claude") return null;
  try {
    const fromPane = claudeModeFromPane(captureTmuxSession(safe, 40));
    if (fromPane) {
      return {
        mode: fromPane,
        label: permissionLabelFor(fromPane),
        dashMode: dashModeFor(fromPane),
        source: "pane",
      };
    }
  } catch { /* fall through to the log */ }
  try {
    const session = listTmuxSessions().find((entry) => entry.tmuxName === safe);
    const state = claudeSessionState(safe, session?.worktreePath);
    if (!state?.permissionMode) return null;
    return {
      mode: state.permissionMode,
      label: state.permissionLabel,
      dashMode: state.dashPermissionMode,
      source: "session-log",
    };
  } catch {
    return null;
  }
}

function permissionStateFor(name) {
  const safe = safeTmuxName(name);
  const kind = agentKindFor(safe)?.kind || "codex";
  const stored = getPermissionMode(safe);
  const live = claudeLivePermission(safe, kind);
  const resolved = resolvePermissionMode(kind, live?.dashMode || stored);
  return {
    // A mode the CLI has but the dash does not expose (acceptEdits) reports its
    // real label with no id, so the control shows the truth and highlights
    // nothing rather than pointing at a button that is not what is running.
    mode: live ? (live.dashMode || "") : (resolved?.id || stored),
    label: live?.label || resolved?.label || stored,
    autoApprove: live && !live.dashMode ? false : !!resolved?.autoApprove,
    modes: permissionModesFor(kind),
    live: live ? { mode: live.mode, label: live.label, source: live.source } : null,
  };
}

function maybeAutoApproveAttention(name, capturedOutput) {
  const safe = safeTmuxName(name);
  if (!safe) return null;
  const kind = agentKindFor(safe)?.kind || "codex";
  const resolved = resolvePermissionMode(kind, getPermissionMode(safe));
  if (!resolved?.autoApprove) return null;
  const output = capturedOutput == null ? captureTmuxSession(safe, 40) : String(capturedOutput);
  const attention = detectAttention(kind, output);
  // An AskUserQuestion menu trips the same attention matcher, but auto-approval
  // presses "1" — which would silently answer whatever the agent asked with its
  // first option and record that as the operator's decision. Permission prompts
  // are safe to auto-approve because there is a known-correct answer; a question
  // exists precisely because there is not. Questions always wait for a human.
  if (detectPendingQuestion(kind, output)) return null;
  const trustConfirm = /Enter to confirm/i.test(busyTail(output, 12))
    && /Yes,? I trust this folder|trust this folder/i.test(output);
  if (!attention && !trustConfirm) return null;
  const now = Date.now();
  if ((lastAutoApproveAt.get(safe) || 0) + 1800 > now) return null;
  lastAutoApproveAt.set(safe, now);
  let key = "1";
  if (trustConfirm || /Enter to confirm/i.test(attention?.excerpt || "")) key = "enter";
  else if (/\[y\/N\]|\(y\/n\)|\(yes\/no\)/i.test(attention?.excerpt || "")) key = "y";
  sendTmuxKey(safe, key);
  return {
    ...(attention || { type: "permission", excerpt: "Workspace trust confirm" }),
    autoApproved: true,
    key,
  };
}

loadPermissionModes();

// ── Spawning ─────────────────────────────────────────────
// One-click live agents: start a provider CLI inside a fresh tmux session
// whose name matches TMUX_NAME so discovery picks it up immediately.
function tmuxSessionExists(name) {
  try {
    execFileSync("tmux", ["has-session", "-t", `=${name}`], { timeout: 3000, stdio: "ignore" });
    return true;
  } catch { return false; }
}

async function spawnTmuxAgent(kind, cwd, permissionMode, model, options = {}) {
  const provider = String(kind || "");
  const spec = SPAWN_BINARIES[provider];
  if (!spec) throw new Error("Unsupported provider — choose claude, codex, kimi, cursor, opencode or ollama");
  const resolved = resolvePermissionMode(provider, permissionMode || defaultPermissionMode(provider));
  if (!resolved) throw new Error("Unsupported permission mode");
  if (!fs.existsSync(spec.binary)) throw new Error(`${spec.binary} is not installed on this host`);
  if (isDenied(model)) throw new Error(`${model} is not available on this platform`);

  // `model: "auto"` (or no model alongside a task) sizes the model to the task
  // from the prompt the session is about to be seeded with. Only the two
  // OpenCode-backed providers accept a model at spawn; for the rest the choice
  // is applied after boot by autoTuneAgent, because their CLIs ignore it here.
  const auto = model === "auto" || (!model && options.prompt);
  const routed = auto ? routeForPrompt(provider, options.prompt) : null;
  const requestedModel = auto ? routed.model : model;
  const resolvedModel = OPENCODE_MODEL_PROVIDERS[provider] ? resolveSpawnModel(provider, requestedModel) : null;
  let command = buildSpawnCommand(provider, resolved.id, resolvedModel);
  const dir = path.resolve(String(cwd || "/root"));
  if (!dir.startsWith("/root")) throw new Error("Working directory must be under /root");
  let stat;
  try { stat = fs.statSync(dir); } catch { throw new Error(`Directory not found: ${dir}`); }
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${dir}`);
  let name = null;
  for (const candidate of [spec.prefix, ...Array.from({ length: 19 }, (_, i) => `${spec.prefix}${i + 2}`)]) {
    if (!tmuxSessionExists(candidate)) { name = candidate; break; }
  }
  if (!name) throw new Error("No free session name for this provider");

  // Always start a *new* provider chat. Bare `agent` / reused Claude sessions
  // otherwise surface old chats the operator already ended from the dash.
  const meta = { cwd: dir, kind: provider };
  if (resolvedModel) meta.model = resolvedModel;
  meta.happyAcp = happyWrapEnabled() && HAPPY_HEADLESS_PROVIDERS.has(provider);
  if (provider === "cursor") {
    meta.chatId = createCursorChatId();
    command = `${command} --resume ${meta.chatId}`;
  } else if (provider === "claude") {
    meta.sessionId = freshClaudeSessionId();
    const narrationFile = path.join(__dirname, "live-agent-narration.txt");
    let narrate = "";
    if (fs.existsSync(narrationFile)) {
      if (happyWrapEnabled()) {
        // happy injects its own --append-system-prompt into claude, and claude
        // refuses to boot when the -file variant is mixed with it ("Cannot use
        // both"). Inlining the content (560 bytes) boots cleanly — verified
        // 2026-08-05.
        const content = fs.readFileSync(narrationFile, "utf8").trim();
        if (content) narrate = ` --append-system-prompt ${shellSingleQuote(content)}`;
      } else {
        narrate = ` --append-system-prompt-file ${shellSingleQuote(narrationFile)}`;
      }
    }
    command = `${command}${narrate} --session-id ${meta.sessionId}`;
  }

  // Names are intentionally reused (gpt, gpt2, ...). A previous occupant may
  // have disappeared without passing through terminateAgent, so clear its
  // persisted transcript and queue before the new CLI is discoverable.
  resetAgentSessionState(name);
  providerMetaBySession.set(name, meta);
  execFileSync("tmux", ["new-session", "-d", "-s", name, ...AGENT_PANE_SIZE, "-c", dir,
    withAgentHomeEnv(command, spawnEnvExtras(provider, resolvedModel))], {
    timeout: 5000,
    env: agentCliEnv(),
  });
  await sleep(600);
  if (!tmuxSessionExists(name)) throw new Error(`${command} exited immediately — check the CLI on this host`);
  permissionBySession.set(name, resolved.id);
  savePermissionModes();
  clearAgentRuntimeCaches(name);
  return {
    name,
    kind: provider,
    command,
    cwd: dir,
    model: resolvedModel,
    permissionMode: resolved.id,
    permissionLabel: resolved.label,
    chatId: meta.chatId || null,
    sessionId: meta.sessionId || null,
  };
}

const { END_SESSION_WRAPUP_PROMPT, detectEndReady } = require("./agent-end-session");
const wrapUpBySession = new Map(); // name -> { startedAt, ready }

function clearWrapUp(name) {
  if (!name) {
    wrapUpBySession.clear();
    return;
  }
  wrapUpBySession.delete(String(name));
}

function getWrapUpState(name) {
  const entry = wrapUpBySession.get(String(name || ""));
  if (!entry) return null;
  return {
    wrappingUp: true,
    ready: !!entry.ready,
    startedAt: entry.startedAt,
  };
}

function markWrapUpReady(name) {
  const safe = String(name || "");
  const entry = wrapUpBySession.get(safe);
  if (!entry) return null;
  entry.ready = true;
  wrapUpBySession.set(safe, entry);
  return getWrapUpState(safe);
}

function refreshWrapUpFromOutput(name, output) {
  const safe = String(name || "");
  if (!detectEndReady(output)) return getWrapUpState(safe);
  const entry = wrapUpBySession.get(safe);
  if (!entry) {
    wrapUpBySession.set(safe, { startedAt: new Date().toISOString(), ready: true });
  } else if (!entry.ready) {
    entry.ready = true;
    wrapUpBySession.set(safe, entry);
  }
  return getWrapUpState(safe);
}

function terminateAgent(sessionId) {
  const id = String(sessionId || "");
  const tmuxMatch = id.match(/^tmux:(.+)$/);
  if (tmuxMatch) {
    const name = safeTmuxName(tmuxMatch[1]);
    if (!name || !tmuxSessionExists(name)) throw new Error("Live tmux session not found");
    execFileSync("tmux", ["kill-session", "-t", `=${name}`], { timeout: 3000 });
    resetAgentSessionState(name);
    clearWrapUp(name);
    return { terminated: name };
  }
  const procMatch = id.match(/^proc:(\d+)$/);
  if (procMatch) {
    const pid = Number(procMatch[1]);
    // Only allow killing processes that currently discover as agent sessions.
    const agent = listProcessAgents().find((s) => s.processId === pid);
    if (!agent) throw new Error("Live agent process not found");
    process.kill(pid, "SIGTERM");
    clearAgentRuntimeCaches();
    return { terminated: pid };
  }
  throw new Error("Invalid live agent session");
}

/** Soft end-session: queue wrap-up prompt. Force-kill only when force=true or agent already signaled ready. */
function requestEndSession(sessionId, options = {}) {
  const id = String(sessionId || "");
  const force = !!options.force;
  const tmuxMatch = id.match(/^tmux:(.+)$/);
  const procMatch = id.match(/^proc:(\d+)$/);

  // Detached process agents cannot receive a wrap-up prompt.
  if (force || procMatch) {
    return { ...terminateAgent(id), mode: "force" };
  }
  if (!tmuxMatch) throw new Error("Invalid live agent session");

  const name = safeTmuxName(tmuxMatch[1]);
  if (!name || !tmuxSessionExists(name)) throw new Error("Live tmux session not found");

  const existing = wrapUpBySession.get(name);
  if (existing?.ready) {
    return { ...terminateAgent(id), mode: "force", reason: "ready" };
  }
  if (existing && !force) {
    return {
      mode: "wrapup",
      wrappingUp: true,
      ready: false,
      already: true,
      name,
      sessionId: `tmux:${name}`,
      startedAt: existing.startedAt,
    };
  }

  wrapUpBySession.set(name, { startedAt: new Date().toISOString(), ready: false });
  rememberUserMessage(name, "End session — wrap up");
  const queued = enqueueMessage(name, END_SESSION_WRAPUP_PROMPT, {
    displayText: "End session — wrap up",
  });
  setImmediate(() => {
    try { flushTmuxQueues(); } catch { /* ignore */ }
  });
  return {
    mode: "wrapup",
    wrappingUp: true,
    ready: false,
    queued,
    name,
    sessionId: `tmux:${name}`,
  };
}

// ── Message queue ────────────────────────────────────────
// Messages sent while an agent is busy are queued server-side and flushed
// in order once the agent goes idle. Persisted to disk so dashboard
// restarts don't drop them.
const QUEUE_FILE = path.join(__dirname, "data", "tmux-queues.json");
const messageQueues = new Map();
PER_SESSION_MAPS.push(messageQueues);

function loadQueues() {
  try {
    const saved = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
    for (const [name, items] of Object.entries(saved)) {
      if (Array.isArray(items) && items.length) messageQueues.set(name, items);
    }
  } catch {}
}

function saveQueues() {
  try {
    fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(Object.fromEntries(messageQueues)), { mode: 0o600 });
  } catch {}
}

function enqueueMessage(name, text, metadata = {}) {
  const safe = safeTmuxName(name);
  if (!safe) throw new Error("Invalid tmux session");
  const input = String(text || "");
  if (!input || input.length > 16_000) throw new Error("Input must be 1–16000 characters");
  const queue = messageQueues.get(safe) || [];
  if (queue.length >= 20) throw new Error("Queue is full (20 messages)");
  queue.push({
    text: input,
    displayText: String(metadata.displayText || "").trim() || undefined,
    images: Array.isArray(metadata.images) ? metadata.images : undefined,
    enqueuedAt: new Date().toISOString(),
  });
  messageQueues.set(safe, queue);
  saveQueues();
  return queue.length;
}

// Last user prompts delivered into each live agent — used by the web view so
// follow-ups stay chat bubbles even when the CLI echoes them into the pane.
const USERS_FILE = path.join(__dirname, "data", "tmux-last-users.json");
const lastUserBySession = new Map();
PER_SESSION_MAPS.push(lastUserBySession);

function loadLastUsers() {
  try {
    const saved = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    for (const [name, entry] of Object.entries(saved || {})) {
      if (entry && entry.text) lastUserBySession.set(name, entry);
    }
  } catch {}
}
loadLastUsers();

function saveLastUsers() {
  try {
    fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(Object.fromEntries(lastUserBySession), null, 2), { mode: 0o600 });
  } catch {}
}

function safeUserImage(image) {
  const id = String(image?.id || "");
  const mimeType = String(image?.mimeType || "");
  const filePath = String(image?.path || "");
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mimeType)) return null;
  if (!/^\/tmp\/ops-agent-\d+-[a-f0-9]{10}\.(?:png|jpg|webp|gif)$/.test(filePath)) return null;
  return {
    id,
    name: path.basename(String(image?.name || filePath))
      .replace(/[\u0000-\u001f\u007f"\\]/g, "")
      .slice(0, 160),
    mimeType,
    path: filePath,
  };
}

function sanitizeStoredUserText(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const cut = raw.search(/\bSwitchMode\s*(?:→|->)\s*.+?\s*Mode\s+switch\s+approved\b/i);
  return (cut >= 0 ? raw.slice(0, cut) : raw).trim();
}

function rememberUserMessage(name, text, options = {}) {
  const safe = String(name || "");
  const value = sanitizeStoredUserText(text);
  if (!safe || !value) return;
  const prev = lastUserBySession.get(safe);
  const history = Array.isArray(prev?.history) ? prev.history.slice(-19) : [];
  const attachments = Array.isArray(prev?.attachments) ? prev.attachments.slice(-19) : [];
  const images = (Array.isArray(options.images) ? options.images : []).map(safeUserImage).filter(Boolean);
  if (!history.length && prev?.text) history.push(sanitizeStoredUserText(prev.text) || prev.text);
  if (!history.length || history[history.length - 1] !== value) history.push(value);
  if (images.length) {
    const previous = attachments[attachments.length - 1];
    const item = { text: value, images, at: Date.now() };
    if (previous?.text === value) attachments[attachments.length - 1] = item;
    else attachments.push(item);
  }
  lastUserBySession.set(safe, { text: value, history, attachments, at: Date.now() });
  saveLastUsers();
}

function getLastUserMessage(name) {
  const entry = lastUserBySession.get(String(name || ""));
  if (!entry) return "";
  if (Date.now() - entry.at > 6 * 60 * 60 * 1000) {
    lastUserBySession.delete(String(name || ""));
    saveLastUsers();
    return "";
  }
  return sanitizeStoredUserText(entry.text) || String(entry.text || "").trim();
}

function getUserMessageHistory(name) {
  const entry = lastUserBySession.get(String(name || ""));
  if (!entry) return [];
  if (Array.isArray(entry.history) && entry.history.length) return entry.history.slice(-20);
  return entry.text ? [entry.text] : [];
}

function getUserMessageAttachments(name) {
  const entry = lastUserBySession.get(String(name || ""));
  return (Array.isArray(entry?.attachments) ? entry.attachments : []).map((item) => ({
    text: item.text,
    images: (item.images || []).map(({ id, name: imageName, mimeType }) => ({ id, name: imageName, mimeType })),
  }));
}

function getUserImage(name, id) {
  const entry = lastUserBySession.get(String(name || ""));
  for (const item of Array.isArray(entry?.attachments) ? entry.attachments : []) {
    const image = (item.images || []).find((candidate) => candidate.id === id);
    if (image && fs.existsSync(image.path)) return image;
  }
  return null;
}

function getQueue(name) {
  return (messageQueues.get(String(name || "")) || []).map((item, index) => ({
    index,
    text: item.displayText || item.text,
    enqueuedAt: item.enqueuedAt,
    images: (Array.isArray(item.images) ? item.images : []).map(safeUserImage).filter(Boolean)
      .map(({ id, name: imageName, mimeType }) => ({ id, name: imageName, mimeType })),
  }));
}

function removeQueuedMessage(name, index) {
  const queue = messageQueues.get(String(name || "")) || [];
  if (index < 0 || index >= queue.length) throw new Error("Queued message not found");
  queue.splice(index, 1);
  if (queue.length) messageQueues.set(name, queue); else messageQueues.delete(name);
  saveQueues();
  return queue.length;
}

async function flushTmuxQueues() {
  for (const [name, queue] of [...messageQueues.entries()]) {
    if (!queue.length) { messageQueues.delete(name); continue; }
    if (!tmuxSessionExists(name)) { messageQueues.delete(name); saveQueues(); continue; }
    try {
      const kind = agentKindFor(name)?.kind || "codex";
      // Headless happy sessions have no pane truth (codex's box never moves) —
      // gate on the relay's last-known turn state instead. Unknown reads as
      // idle: happy's own queue tolerates a message landing mid-turn.
      if (isHappyHeadlessSession(name)) {
        const happyId = happyBridge.happySessionIdForTmux(name);
        if (happyId && happyBridge.happySessionBusy(happyId)) continue;
        await deliverQueuedMessage(name, queue);
        continue;
      }
      const tail = captureTmuxSession(name, 30);
      // Never flush into a busy agent OR a permission prompt.
      if (isOutputBusy(kind, tail) || detectAttention(kind, tail)) continue;
      await deliverQueuedMessage(name, queue);
    } catch { /* try again on the next tick */ }
  }
}

async function deliverQueuedMessage(name, queue) {
  const next = queue.shift();
  if (queue.length) messageQueues.set(name, queue); else messageQueues.delete(name);
  saveQueues();
  rememberUserMessage(name, next.displayText || next.text, { images: next.images });
  await sendTmuxInput(name, next.text);
  return next;
}

/** Force the next queued message through even if busy detection thinks the agent is working. */
async function forceFlushQueue(name, options = {}) {
  const safe = safeTmuxName(name);
  if (!safe) throw new Error("Invalid tmux session");
  const queue = messageQueues.get(safe) || [];
  if (!queue.length) {
    const error = new Error("No queued messages");
    error.statusCode = 404;
    throw error;
  }
  if (!tmuxSessionExists(safe)) {
    messageQueues.delete(safe);
    saveQueues();
    const error = new Error("Live agent session not found");
    error.statusCode = 404;
    throw error;
  }
  const kind = agentKindFor(safe)?.kind || "codex";
  const tail = captureTmuxSession(safe, 30);
  const busy = isOutputBusy(kind, tail);
  const attention = !!detectAttention(kind, tail);
  let interrupted = false;
  if ((busy || attention || options.interrupt) && options.interrupt !== false) {
    // Wake a stuck/busy turn so the forced prompt lands in an idle composer.
    try { sendTmuxKey(safe, "escape"); } catch { /* ignore */ }
    await sleep(180);
    try { sendTmuxKey(safe, "ctrl-c"); } catch { /* ignore */ }
    await sleep(320);
    interrupted = true;
  }
  const delivered = await deliverQueuedMessage(safe, queue);
  return {
    ok: true,
    interrupted,
    remaining: queue.length,
    text: delivered.displayText || delivered.text,
  };
}

// Pre-warm the capture cache for every live tmux agent so the list endpoint
// and other readers hit the cache instead of forking tmux per agent on the
// request thread. Called on the same 2.5 s background tick as flushTmuxQueues.
function refreshAgentCaptures() {
  for (const session of listTmuxSessions()) {
    if (!session.tmuxName) continue;
    try { captureTmuxSession(session.tmuxName, 30); } catch { /* dead session */ }
  }
}

// Drop runtime map entries for tmux sessions that no longer exist.
function sweepDeadSessions() {
  const live = new Set(listTmuxSessions().map((s) => s.tmuxName).filter(Boolean));
  if (!live.size) return;
  for (const map of PER_SESSION_MAPS) {
    for (const key of map.keys()) {
      if (!live.has(key)) map.delete(key);
    }
  }
  for (const key of captureCache.keys()) {
    const name = key.slice(0, key.indexOf(":"));
    if (name && !live.has(name)) captureCache.delete(key);
  }
}

loadQueues();

function resetAgentSessionState(name) {
  const safe = safeTmuxName(name);
  if (!safe) throw new Error("Invalid agent session");

  const remembered = lastUserBySession.get(safe);
  for (const item of Array.isArray(remembered?.attachments) ? remembered.attachments : []) {
    for (const image of Array.isArray(item?.images) ? item.images : []) {
      if (!safeUserImage(image)) continue;
      try { fs.unlinkSync(image.path); } catch {}
    }
  }

  lastUserBySession.delete(safe);
  messageQueues.delete(safe);
  permissionBySession.delete(safe);
  providerMetaBySession.delete(safe);
  lastAutoApproveAt.delete(safe);
  saveLastUsers();
  saveQueues();
  savePermissionModes();
  clearAgentRuntimeCaches(safe);
}

// Non-blocking sleep — lets the event loop interleave other requests (other
// tabs' 900 ms capture polls) while a selection/permission sequence paces its
// keystrokes. Replaces the Atomics.wait sync sleep that froze the whole server.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function codexSelectionDelay(previousStep) {
  if (!previousStep) return 0;
  if (previousStep[0] === "key" && previousStep[1] === "Enter") return 360;
  if (previousStep[0] === "literal") return 80;
  return 55;
}

function detectCodexConfig(text) {
  const matches = [...String(text || "").matchAll(/\b(gpt-[\w.-]+)\s+([a-z]+)\s+·/gi)];
  const match = matches[matches.length - 1];
  if (!match) return null;
  return {
    model: match[1],
    effort: match[2].toLowerCase() === "default" ? "medium" : match[2].toLowerCase(),
  };
}

async function selectCodexModel(name, model, effort) {
  const safe = safeTmuxName(name);
  if (!safe || agentKindFor(safe)?.kind !== "codex") throw new Error("Codex session required");
  const current = detectModelFromOutput("codex", captureTmuxSession(safe, 80));
  const currentModel = current ? current.split(" · ")[0] : "";
  const steps = codexSelectionSteps(model, effort, currentModel);
  for (const [index, [kind, value]] of steps.entries()) {
    if (index) await sleep(codexSelectionDelay(steps[index - 1]));
    const args = ["send-keys", "-t", safe];
    if (kind === "literal") args.push("-l");
    args.push(value);
    execFileSync("tmux", args, { timeout: 3000 });
  }
  let confirmed = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await sleep(150);
    confirmed = detectCodexConfig(captureTmuxSession(safe, 80));
    if (confirmed?.model === model && confirmed?.effort === String(effort).toLowerCase()) {
      return { ...confirmed, confirmed: true };
    }
  }
  const actual = confirmed ? `${confirmed.model} · ${confirmed.effort}` : "unknown";
  const error = new Error(`Codex did not apply ${model} · ${effort}; still ${actual}`);
  error.statusCode = 409;
  throw error;
}

// Claude picks a random verb for its status line, so matching a verb list is
// hopeless — "Sautéed" and "Cogitated" are past tense and actually mean the turn
// FINISHED. The ellipsis is the real signal: a running turn prints
// "✻ Channelling… (27s · ↑ 1.4k tokens)", a finished one "✻ Cooked for 4m 2s".
const CLAUDE_LIVE_SPINNER_RE = /[✻✳✽✢✶*]\s+[^\s…]+…/;
const CLAUDE_TURN_DONE_RE = /[✻✳✽✢✶*]\s+\S+\s+for\s+\d/i;
// The footer under the composer, e.g. "⏵⏵ auto mode on (shift+tab to cycle)".
const CLAUDE_MODE_FOOTER_RE = /(?:auto|plan|accept edits|bypass(?:ing)?\s+permissions?)\s+mode\s+on\b/i;

// Each mode Claude can be in, and the footer it prints while in it. The "(shift+tab
// to cycle)" hint is NOT always present — a session with background shells prints
// "⏵⏵ auto mode on · 6 shells · esc to interrupt" — so match on the label alone.
// Order is the order the CLI cycles through, but nothing here depends on that:
// the cycle presses and re-reads rather than counting.
const CLAUDE_MODE_FOOTERS = Object.freeze([
  Object.freeze({ mode: "plan", re: /\bplan\s+mode\s+on\b/i }),
  Object.freeze({ mode: "acceptEdits", re: /\baccept\s+edits\s+(?:mode\s+)?on\b/i }),
  Object.freeze({ mode: "bypassPermissions", re: /\bbypass(?:ing)?\s+permissions?(?:\s+mode)?\s+on\b/i }),
  Object.freeze({ mode: "auto", re: /\bauto\s+mode\s+on\b/i }),
]);
// Default ("Ask") is the one mode that prints NO footer, so it can only be read as
// an absence. Absence is also what a blank frame, a mid-repaint frame, and — the
// one that actually bit — an open AskUserQuestion menu all look like.
//
// So the fall-through demands the drawn composer, and specifically its *shape*:
// a ❯ input line bracketed by ─── rules. A bare ❯ is not enough, because the same
// marker prefixes every echoed user message in the transcript above.
const CLAUDE_COMPOSER_RULE_RE = /^\s*─{20,}\s*$/;
const CLAUDE_COMPOSER_INPUT_RE = /^\s*[❯>]\s?/;

function hasClaudeComposer(lines) {
  for (let i = 1; i < lines.length - 1; i += 1) {
    if (!CLAUDE_COMPOSER_INPUT_RE.test(lines[i])) continue;
    // The box can wrap over several input rows, so scan outward for its rules.
    let above = i - 1;
    while (above >= 0 && !CLAUDE_COMPOSER_RULE_RE.test(lines[above]) && lines[above].trim()) above -= 1;
    if (above < 0 || !CLAUDE_COMPOSER_RULE_RE.test(lines[above])) continue;
    let below = i + 1;
    while (below < lines.length && !CLAUDE_COMPOSER_RULE_RE.test(lines[below]) && lines[below].trim()) below += 1;
    if (below < lines.length && CLAUDE_COMPOSER_RULE_RE.test(lines[below])) return true;
  }
  return false;
}

/**
 * The permission mode Claude itself is showing, read from the pane footer.
 *
 * The session log carries the same fact but only writes it on a state flush, so it
 * can lag a mode change by a whole turn. The footer repaints immediately, which is
 * what makes a press-and-verify cycle possible at all.
 *
 * Returns null when the frame cannot be trusted — never guess "default" from a
 * screenful that has not finished drawing.
 */
function claudeModeFromPane(output) {
  const text = String(output || "");
  if (!text.trim()) return null;
  // The footer sits under the composer; a stale one further up is not the live mode.
  const lines = text.split("\n");
  const tail = lines.slice(-14).join("\n");
  for (const entry of CLAUDE_MODE_FOOTERS) {
    if (entry.re.test(tail)) return entry.mode;
  }
  return hasClaudeComposer(lines.slice(-10)) ? "default" : null;
}

const BUSY_PATTERNS = Object.freeze({
  claude: /(?:esc to interrupt|[✻✳✽✢✶*]\s+[^\s…]+…)/i,
  codex: /(?:•\s+Working\b|esc to interrupt)/i,
  kimi: /(?:esc to interrupt|●\s+\w+ing\b|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)/i,
  cursor: /(?:esc to interrupt|•\s+\w+ing\b|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)/i,
});

// A background shell outlives the turn that started it, so for Claude it says
// nothing about whether the agent is working — a session can sit idle at the
// prompt for an hour with "1 shell still running" in its footer. Providers that
// only ever print it as part of a live status line still count it.
const BACKGROUND_SHELL_MEANS_BUSY = Object.freeze({ claude: false });

const ATTENTION_PATTERNS = Object.freeze({
  // "Enter to select" is the AskUserQuestion menu; "Enter to confirm" is the
  // permission prompt. Only the latter was listed, so an agent blocked on a
  // question read as idle and nothing flagged it for a human.
  claude: /(?:Do you want to proceed\?|❯\s*1\.\s*Yes|Yes,? I trust this folder|Enter to confirm|Enter to select|\[y\/N\]|\(y\/n\)|\(yes\/no\))/i,
  codex: /(?:❯\s*1\.\s*Yes|\[y\/N\]|\(y\/n\)|Allow .{0,60}\?|approval required|Press y to)/i,
  kimi: /(?:\[y\/N\]|\(y\/n\)|\(yes\/no\)|Approve.{0,40}\?|Allow .{0,60}\?|❯\s*1\.\s*Yes)/i,
  cursor: /(?:\[y\/N\]|\(y\/n\)|\(yes\/no\)|Approve.{0,40}\?|Allow .{0,60}\?|Press y to|Run this command\?|→\s*Run \(once\))/i,
});

/**
 * Detect an open AskUserQuestion menu and pull its options out of the pane.
 *
 * A pending question is invisible everywhere else. Claude Code only writes the
 * `AskUserQuestion` record to its session log once the question has been
 * ANSWERED, so the log-backed transcript cannot show one that is still waiting —
 * and the permission matcher above looks for "Enter to confirm" while this menu
 * says "Enter to select", so it did not register as needing attention either.
 * The result was an agent parked on a question that the dashboard rendered as a
 * plain idle session, answerable only by someone attached to its tmux pane.
 *
 * The pane is therefore the only source, and it holds just the ~25 visible rows
 * of the alternate screen: the question text itself has usually scrolled off,
 * but the numbered options are what a reader needs to decide, and those sit
 * directly above the marker. `index` doubles as the key that selects the option.
 */
const QUESTION_MENU_RE = /Enter to select/i;
const QUESTION_OPTION_RE = /^\s{0,6}(?:[❯>]\s*)?(\d{1,2})\.\s+(.*\S)\s*$/;
// Box-drawing separators sit between options and carry no text.
const RULE_ONLY_RE = /^[\s─━—\-_·|┌┐└┘├┤┬┴┼]*$/;
// A multi-select menu prefixes each option with a checkbox and gains a tab strip
// above the question: "←  ☒ Colours  ✔ Submit  →". The checkbox is the reliable
// per-option signal; the strip only says whether anything is ticked yet.
const QUESTION_CHECKBOX_RE = /^\[([ x✔✓×])\]\s*/i;
const QUESTION_TABSTRIP_RE = /^\s*(?:←\s*)?[☐☒]\s+(.+?)\s{2,}✔\s*Submit/;
// Chrome that sits inside the menu but is not an option, a description, or the
// question: the submit affordance, and the review screen's own heading.
const QUESTION_CHROME_RE = /^\s*(?:Submit|Cancel|Review your answers|Ready to submit your answers\?)\s*$/i;
// The escape hatch that opens a free-text prompt instead of choosing a listed answer.
const QUESTION_FREE_TEXT_RE = /^(?:type something|other|chat about this)\.?$/i;

/**
 * Read the question, its options, and their checked state out of an open menu.
 *
 * The pane is the only source: Claude Code writes the AskUserQuestion record to its
 * session log once the question has been ANSWERED, so a question still waiting is by
 * definition absent from the log.
 *
 * Panes are 120x60 now (see AGENT_PANE_SIZE). At 80x24 the question text had always
 * scrolled off and only the bare numbered options survived, which is why this used to
 * return options alone — a reader had to guess what was being asked.
 */
function detectPendingQuestion(kind, output) {
  if (kind && kind !== "claude") return null;
  const lines = String(output || "").split("\n");
  // The LAST marker is the live menu. Taking the first matched a repainted frame's
  // leftovers higher up the capture, which pinned a dead panel open with no way to
  // clear it — and left the queue flusher believing nothing was waiting.
  let marker = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (QUESTION_MENU_RE.test(lines[i])) { marker = i; break; }
  }
  if (marker < 0) return null;

  const options = [];
  let open = null;
  let firstOptionAt = -1;
  for (let i = 0; i < marker; i += 1) {
    const line = lines[i];
    const match = line.match(QUESTION_OPTION_RE);
    if (match) {
      if (firstOptionAt < 0) firstOptionAt = i;
      open = { index: Number(match[1]), label: match[2].trim(), description: "", at: i };
      options.push(open);
      continue;
    }
    if (!open || RULE_ONLY_RE.test(line) || QUESTION_CHROME_RE.test(line)) continue;
    // A continuation line is indented under its option; anything flush left has left
    // the menu behind. Two spaces, not four: multi-select descriptions are indented
    // to the option number, single-select ones to the label.
    if (!/^\s{2,}\S/.test(line)) { open = null; continue; }
    open.description = `${open.description} ${line.trim()}`.trim();
  }

  const usable = options.filter((option) => option.label);
  if (usable.length < 2) return null;
  // A repainted frame can leave a stale partial menu above the live one; the run
  // ending at the marker is the one on screen.
  const ordered = [];
  for (const option of usable) {
    if (ordered.length && option.index !== ordered[ordered.length - 1].index + 1) ordered.length = 0;
    ordered.push(option);
  }
  if (ordered.length < 2) return null;

  const cleaned = ordered.map((option) => {
    const box = option.label.match(QUESTION_CHECKBOX_RE);
    return {
      index: option.index,
      label: box ? option.label.slice(box[0].length).trim() : option.label,
      description: option.description.slice(0, 400),
      checked: box ? box[1] !== " " : false,
      checkbox: !!box,
      at: option.at,
    };
  });
  // One digit TOGGLES a multi-select option and Enter toggles it again rather than
  // submitting — the answer only lands from the Submit tab (→ then 1). Sending a
  // lone digit here, as the single-select path does, left the menu open forever.
  //
  // `some`, not `every`: the escape hatches below the rule ("Chat about this") carry
  // no checkbox even on a multi-select menu, and a single-select menu never renders
  // one at all.
  const multiSelect = cleaned.some((option) => option.checkbox);

  // The question sits flush left above the first option, under the tab strip. Only
  // reachable now that the pane is tall enough to hold it.
  let question = null;
  let header = null;
  for (let i = (cleaned[0].at ?? firstOptionAt) - 1; i >= 0 && i > marker - 40; i -= 1) {
    const line = lines[i];
    if (!line.trim() || RULE_ONLY_RE.test(line) || QUESTION_CHROME_RE.test(line)) continue;
    const strip = line.match(QUESTION_TABSTRIP_RE);
    if (strip) { header = strip[1].trim(); break; }
    if (/^\s{2,}\S/.test(line)) continue;   // an earlier option's description
    if (!question) question = line.trim().slice(0, 300);
  }

  // The pane can still clip a very long menu. Say so rather than presenting options
  // 2..n as if they were the whole set — the numbers still select correctly, but a
  // reader must know something above them exists.
  return {
    question,
    header,
    multiSelect,
    options: cleaned.map(({ at, ...rest }) => rest),
    partial: ordered[0].index !== 1,
  };
}

/**
 * Answer an open question menu.
 *
 * Single-select takes one digit and is done. Multi-select toggles with a digit per
 * choice, then needs the Submit tab: → moves to it, and 1 is "Submit answers".
 * Verified against a live menu — Enter on an option row toggles it back off.
 */
async function answerPendingQuestion(name, indices, text) {
  const safe = safeTmuxName(name);
  if (!safe) throw new Error("Invalid agent session");
  const wanted = (Array.isArray(indices) ? indices : [indices])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 99);
  if (!wanted.length) throw new Error("Choose at least one option");

  // A pane that has gone away is the same answer as a menu that has closed: the
  // question is not there to answer. Both are the operator being a beat late.
  let frame = "";
  try { frame = captureTmuxSession(safe, 60); } catch { /* gone */ }
  const pending = detectPendingQuestion("claude", frame);
  if (!pending) {
    const error = new Error("That question is no longer open.");
    error.statusCode = 409;
    throw error;
  }
  const byIndex = new Map(pending.options.map((option) => [option.index, option]));
  for (const index of wanted) {
    if (!byIndex.has(index)) throw new Error(`Option ${index} is not on this menu`);
  }
  // Only the checkbox rows toggle. The escape hatches below the rule ("Type
  // something", "Chat about this") select outright even on a multi-select menu, so
  // choosing one is a single answer and needs no Submit trip.
  const toggles = wanted.every((index) => byIndex.get(index).checkbox);
  if (!toggles && wanted.length > 1) throw new Error("This question takes one answer");

  // send-keys -l types the digits of a two-digit index literally, so option 10 and
  // up answer like any other. Routing them through the named-key table produced
  // "Invalid terminal key" behind a button the panel had already rendered.
  for (const index of wanted) {
    execFileSync("tmux", ["send-keys", "-t", safe, "-l", String(index)], { timeout: 3000 });
    await sleep(120);
  }
  if (toggles && pending.multiSelect) {
    execFileSync("tmux", ["send-keys", "-t", safe, "Right"], { timeout: 3000 });
    await sleep(250);
    execFileSync("tmux", ["send-keys", "-t", safe, "-l", "1"], { timeout: 3000 });
  }

  // "Type something" drops the CLI into a text prompt. Typing into the message box
  // instead cannot work — a queued message is refused while a menu is open, and
  // pasting into the menu would be read as navigation — so the free-text answer
  // rides along with the option that opens the prompt.
  let typed = false;
  const free = wanted.length === 1 && QUESTION_FREE_TEXT_RE.test(byIndex.get(wanted[0]).label);
  if (free && String(text || "").trim()) {
    await sleep(350);
    await sendTmuxInput(safe, String(text).trim());
    typed = true;
  }

  clearAgentRuntimeCaches(safe);
  return {
    answered: wanted,
    multiSelect: pending.multiSelect,
    submitted: toggles && pending.multiSelect,
    typed,
  };
}

// Detect a permission/auth prompt in the TAIL of the output (scrollback
// history must not trigger it). Returns an excerpt for display.
function detectAttention(kind, output) {
  const text = String(output || "");
  const pattern = ATTENTION_PATTERNS[kind] || /(?:\[y\/N\]|\(y\/n\)|Do you want to proceed\?|Approve.{0,40}\?)/i;
  const tail = text.split("\n").slice(-12).join("\n");
  if (!pattern.test(tail)) return null;
  const lines = tail.split("\n").map((line) => line.trim()).filter(Boolean);
  const at = lines.findIndex((line) => pattern.test(line));
  const around = at < 0 ? lines.slice(-3) : lines.slice(Math.max(0, at - 2), at + 2);
  return { type: "permission", excerpt: around.join(" · ").slice(0, 220) };
}

function busyTail(output, lines = 18) {
  return String(output || "").split("\n").slice(-Math.max(8, lines)).join("\n");
}

function looksAgentIdle(kind, tail) {
  const nonempty = String(tail || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!nonempty.length) return false;
  const last = nonempty[nonempty.length - 1];
  const prev = nonempty[nonempty.length - 2] || "";
  const bottom = nonempty.slice(-5).join("\n");

  if (kind === "codex") {
    if (/^•\s+Working\b/i.test(last) || /esc to interrupt\)?\s*$/i.test(last)) return false;
    if (/^gpt-[\w.-]+\s+\w+\s+·/.test(last)) return true;
    if (/^›/.test(last) || /^›/.test(prev)) return true;
    return false;
  }
  if (kind === "cursor") {
    if (/(?:esc to interrupt|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*(?:Running|Thinking|Working)\b)/i.test(bottom)
      && !/(?:files edited|Run Everything)/i.test(last)) return false;
    if (/^Cursor\s+.+\s+[·•|]\s+[\d.]+%/i.test(last) || /Run Everything/i.test(last)) return true;
    return false;
  }
  if (kind === "claude") {
    if (/esc to interrupt/i.test(bottom) || CLAUDE_LIVE_SPINNER_RE.test(bottom)) return false;
    // Claude draws its composer inside a box with the mode footer underneath, so
    // the prompt is almost never the final line. Either shape means the CLI has
    // handed control back and is waiting for input.
    if (CLAUDE_MODE_FOOTER_RE.test(last) || /^❯/.test(last) || /^❯/.test(prev)) return true;
    if (CLAUDE_TURN_DONE_RE.test(bottom)) return true;
    return false;
  }
  if (kind === "kimi") {
    if (/esc to interrupt/i.test(bottom)) return false;
    return false;
  }
  return false;
}

function isOutputBusy(kind, output) {
  // Happy ACP panes are log streams, not TUIs — the last "Status:" line is the
  // whole truth about whether a turn is running.
  if (HAPPY_ACP_PROVIDERS.has(kind) && /Happy Session ID:/.test(String(output || ""))) {
    const statuses = String(output || "").match(/Status: ([a-z-]+)/g);
    const last = statuses ? statuses[statuses.length - 1] : "";
    return /Status: (?:starting|running|thinking|working)/.test(last);
  }
  // Only the live status chrome at the bottom counts. Older "• Working" /
  // "esc to interrupt" lines in scrollback would otherwise pin queues forever
  // after the agent has already returned to an idle prompt.
  const tail = busyTail(output, 18);
  if (looksAgentIdle(kind, tail)) return false;
  const pattern = BUSY_PATTERNS[kind] || /(?:•\s+Working\b|esc to interrupt|✻\s+\w+ing\b|shell still running)/i;
  if (pattern.test(tail)) return true;
  if (BACKGROUND_SHELL_MEANS_BUSY[kind] === false) return false;
  return /shell still running/i.test(tail);
}

function isAgentBusy(name) {
  const safe = safeTmuxName(name);
  const kind = agentKindFor(safe)?.kind || "codex";
  return isOutputBusy(kind, captureTmuxSession(safe, 30));
}

/** True when the live pane shows a composer that can accept a pasted prompt. */
function agentComposerReady(kind, output) {
  const text = String(output || "");
  const tail = busyTail(text, 24);
  if (kind === "cursor") {
    // Cursor prints the banner immediately, but the footer / follow-up chip only
    // appear once the interactive composer can accept Enter. Seeding before that
    // loses the paste (ticket-repair #997: 3+ min idle until a human message).
    return /Run Everything/i.test(tail)
      || /→\s*Add a follow-up/i.test(tail)
      || /^Cursor\s+.+\s+[·•|]\s+[\d.]+%/im.test(tail);
  }
  if (kind === "codex") {
    return looksAgentIdle("codex", busyTail(text, 18)) || /^›/m.test(tail);
  }
  if (kind === "claude") {
    return /^❯/m.test(tail);
  }
  return looksAgentIdle(kind, busyTail(text, 18));
}

/**
 * Block until a live agent pane is idle and showing a ready composer.
 * Used before auto-seeding ticket-repair prompts so paste+Enter is not lost
 * during Cursor boot / MCP handshake.
 */
async function waitUntilAgentAcceptsInput(name, options = {}) {
  const safe = safeTmuxName(name);
  if (!safe) throw new Error("Invalid tmux session");
  const kind = agentKindFor(safe)?.kind || "cursor";
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 45_000;
  const pollMs = Number.isFinite(options.pollMs) ? options.pollMs : 500;
  const started = Date.now();
  let lastOutput = "";
  while (Date.now() - started < timeoutMs) {
    if (!tmuxSessionExists(safe)) {
      throw new Error(`tmux session ${safe} disappeared while waiting for ready`);
    }
    lastOutput = captureTmuxSession(safe, 40);
    // Dismiss startup trust / permission prompts before looking for the composer.
    try { maybeAutoApproveAttention(safe, lastOutput); } catch { /* ignore */ }
    if (!isOutputBusy(kind, lastOutput) && agentComposerReady(kind, lastOutput)) {
      return { waitedMs: Date.now() - started, kind, output: lastOutput };
    }
    await sleep(pollMs);
  }
  throw new Error(
    `Agent ${safe} did not become ready for input within ${timeoutMs}ms`
    + (lastOutput ? ` (tail: ${busyTail(lastOutput, 6).replace(/\s+/g, " ").slice(0, 160)})` : "")
  );
}

/**
 * Wait for a ready composer, paste a seed prompt, and confirm a turn started
 * (busy chrome). Retries once if the first Enter was swallowed during boot.
 *
 * Must be async: sendTmuxInput is async (paste + settle + Enter). Calling it
 * without await races the busy-confirm loop and can report a false seed
 * failure — or, worse, pair with a missing await on spawnTmuxAgent so
 * `tmux.name` is undefined and the repair dies with "Invalid tmux session"
 * (ticket #998, three auto-retries in ~20 minutes before a human nudge).
 */
async function seedAgentPrompt(name, text, options = {}) {
  const safe = safeTmuxName(name);
  if (!safe) throw new Error("Invalid tmux session");
  const kind = agentKindFor(safe)?.kind || "cursor";
  // ACP sessions have no composer to wait for — the gate is the happy
  // registration handshake (pane banner + sessions.json), then the relay
  // delivers the seed exactly like any other user message.
  if (isHappyAcpSession(safe)) {
    const happyId = await happyBridge.waitForHappySession(safe, {
      timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 60_000,
    });
    await happyBridge.sendHappyUserMessage(happyId, text);
    rememberUserMessage(safe, text);
    return { ok: true, attempt: 1, waitedMs: 0, kind, via: "happy-relay", happySessionId: happyId };
  }
  const attempts = Number.isFinite(options.attempts) ? Math.max(1, options.attempts) : 2;
  const confirmMs = Number.isFinite(options.confirmMs) ? options.confirmMs : 8_000;
  const pollMs = Number.isFinite(options.pollMs) ? options.pollMs : 500;
  let lastWait = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastWait = await waitUntilAgentAcceptsInput(safe, options);
    await sendTmuxInput(safe, text);
    rememberUserMessage(safe, text);

    const deadline = Date.now() + confirmMs;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      if (isOutputBusy(kind, captureTmuxSession(safe, 30))) {
        return {
          ok: true,
          attempt,
          waitedMs: lastWait.waitedMs,
          kind,
        };
      }
    }
  }

  throw new Error(
    `Seed prompt to ${safe} did not start an agent turn after ${attempts} attempt(s)`
  );
}

function stripUsageEscapes(value) {
  // Defensive: styled tmux captures insert SGR codes between footer tokens
  // ("High\x1b[0m \x1b[2m·\x1b[0m \x1b[2m42%"), which breaks naive regexes.
  return String(value || "").replace(/\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\([A-Za-z0-9]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g, "");
}

function detectUsageFromOutput(kind, text) {
  const output = stripUsageEscapes(text);
  // Usage markers live in the status footer or recent lines, not the whole
  // pane — scan only the tail to avoid regex over the full 800-line buffer.
  const tail = tailLines(output, 60);
  if (kind === "kimi") {
    const match = tail.match(/context:\s*([\d.]+)%\s*\(([\d.]+k?)\/([\d.]+[km])\)/i);
    if (!match) return null;
    const percent = Math.max(0, Math.min(100, Number(match[1])));
    return { provider: "kimi", direction: "used", percent,
      label: `${Math.round(percent)}% filled`, detail: `Session context · ${match[2]}/${match[3]}` };
  }
  if (kind === "cursor") {
    // Footer: "Cursor Grok 4.5 High · 23.8% · 7 files edited"
    // Prefer the LAST files-edited footer — conversation text can mention
    // similar "Cursor … %" patterns and .match() would grab the wrong one.
    const footerMatches = [...output.matchAll(/([\d.]+)\s*%\s*[·•|]\s*\d+\s+files?\s+edited/gi)];
    const match = footerMatches.length
      ? footerMatches[footerMatches.length - 1]
      : output.match(/Cursor\s+[^\n]+?\s+[·•|]\s+([\d.]+)\s*%/i)
        || tail.match(/Cursor\s+.+?\s+[·•|]\s+([\d.]+)\s*%/i);
    const tokenMatch = output.match(/(?:Running|Thinking|Working)\s+([\d.]+)\s*([kKmM])?\s*tokens?\b/i)
      || tail.match(/\b([\d.]+)\s*([kKmM])\s*tokens?\b/i);
    let tokens = null;
    if (tokenMatch) {
      const n = Number(tokenMatch[1]);
      const unit = String(tokenMatch[2] || "").toLowerCase();
      tokens = unit === "m" ? Math.round(n * 1_000_000) : unit === "k" ? Math.round(n * 1000) : Math.round(n);
    }
    if (!match && tokens == null) return null;
    const percent = match ? Math.max(0, Math.min(100, Number(match[1]))) : null;
    const tokenLabel = tokenMatch ? `${tokenMatch[1]}${tokenMatch[2] || ""} tokens` : null;
    const label = percent != null ? `${Math.round(percent)}% filled` : (tokenLabel || "Cursor");
    const detailParts = [];
    if (percent != null) detailParts.push("Session context");
    else if (tokenLabel) detailParts.push(`${tokenLabel} this turn`);
    else detailParts.push("Session context");
    if (percent != null && tokenLabel) detailParts.push(tokenLabel);
    return {
      provider: "cursor",
      direction: "used",
      percent,
      label,
      detail: detailParts.join(" · "),
      tokens,
    };
  }
  return null;
}

function detectModelFromOutput(kind, text) {
  // Model markers are in the status footer — scan only the tail.
  const output = tailLines(String(text || ""), 40);
  if (kind === "kimi") {
    const match = output.match(/\((\w[\w.-]*)\s*●\)/);
    if (!match) return null;
    return { k3: "k3", "k2.7": "kimi-for-coding" }[match[1].toLowerCase()] || match[1];
  }
  if (kind === "cursor") {
    const clean = stripUsageEscapes(output);
    const match = clean.match(/Cursor\s+(.+?)\s+[·•|]\s+[\d.]+\s*%/i);
    if (match) return match[1].trim().replace(/^Cursor\s+/i, "");
    try {
      const { cursorModelFromConfig } = require("./agent-usage");
      return cursorModelFromConfig();
    } catch {
      return null;
    }
  }
  if (kind === "claude") {
    const match = output.match(/\b(Fable|Opus|Sonnet|Haiku)(?:\s+\d+(?:\.\d+)?)?\s+with\s+(low|medium|high|xhigh|max)\s+effort/i);
    return match ? `${match[1]} · ${match[2].toLowerCase()}` : null;
  }
  if (kind === "codex") {
    const config = detectCodexConfig(output);
    return config ? `${config.model} · ${config.effort}` : null;
  }
  return null;
}

function selectKimiModel(name, model, effort) {
  if (!KIMI_MODELS.includes(String(model || ""))) throw new Error("Unsupported Kimi model");
  // A wrapped kimi is a happy ACP server: `kimi acp` takes no model flags and
  // an ACP restart cannot `-C` its way back into the conversation. Refusing
  // beats silently killing the thread — the model switch lives in the Happy
  // app for these sessions.
  if (isHappyAcpSession(name)) {
    throw new Error("This kimi session is phone-managed (happy ACP) — switch its model from the Happy app");
  }
  // Kimi CLI has no live model command — restart the session, resuming history.
  const thinking = String(effort || "").toLowerCase() !== "standard";
  const session = listTmuxSessions().find((entry) => entry.tmuxName === name);
  const cwd = session?.worktreePath || "/root";
  const mode = getPermissionMode(name);
  const cmd = [buildSpawnCommand("kimi", mode, null, { wrap: false }), "-C", "-m", model, thinking ? "--thinking" : "--no-thinking"]
    .map((arg) => `'${arg}'`).join(" ");
  execFileSync("tmux", ["kill-session", "-t", `=${name}`], { timeout: 3000 });
  execFileSync("tmux", ["new-session", "-d", "-s", name, ...AGENT_PANE_SIZE, "-c", cwd, withAgentHomeEnv(cmd)], {
    timeout: 5000,
    env: agentCliEnv(),
  });
  permissionBySession.set(name, mode);
  savePermissionModes();
  return { model, effort: thinking ? "thinking" : "standard", restarted: true, permissionMode: mode };
}

/**
 * Size a model to the task a session is being spawned for.
 *
 * A one-line "rename this field" and a "trace why turn totals disagree across
 * three subsystems" previously booted identically, on whatever the CLI
 * defaulted to. Returns the provider's own default (null) when it has no tier
 * table, rather than inventing a model it would ignore.
 */
function routeForPrompt(provider, prompt) {
  const { tier, reasons } = scoreComplexity(prompt || "");
  return { tier, reasons, model: modelFor(provider, tier), effort: effortFor(tier) };
}

/**
 * Apply a routed model to a session whose CLI could not take one at spawn.
 *
 * Claude, Codex and Kimi ignore a model argument at launch, so the choice has to
 * be typed in after the TUI is up. Best-effort by design: a session running on
 * its default model is a worse outcome than one running on the routed model, but
 * a far better one than a spawn that fails because a picker did not respond.
 */
async function autoTuneAgent(name, provider, prompt) {
  const routed = routeForPrompt(provider, prompt);
  if (!routed.model) return { applied: false, ...routed };
  try {
    await selectAgentConfig(name, routed.model, routed.effort);
    console.log(`[router] ${name}: ${routed.tier} → ${routed.model}/${routed.effort} (${routed.reasons.join(", ")})`);
    return { applied: true, ...routed };
  } catch (e) {
    console.warn(`[router] ${name}: could not apply ${routed.model} (${e.message}) — staying on the CLI default`);
    return { applied: false, error: e.message, ...routed };
  }
}

async function selectAgentConfig(name, model, effort) {
  const safe = safeTmuxName(name);
  if (!safe) throw new Error("Invalid agent session");
  const agent = agentKindFor(safe);
  if (!agent?.supportsConfig) throw new Error(`Model switching is not supported for ${agent?.label || "this"} sessions`);
  // Headless happy sessions have no TUI to type the switch into; their model
  // lives with the phone client.
  if (HAPPY_HEADLESS_PROVIDERS.has(agent.kind) && isHappyHeadlessSession(safe)) {
    const error = new Error(`This ${agent.label} session is phone-managed (happy) — switch its model from the Happy app`);
    error.statusCode = 409;
    throw error;
  }
  if (isAgentBusy(safe)) {
    const error = new Error("Agent is busy. Stop or wait for the current turn before switching.");
    error.statusCode = 409;
    throw error;
  }
  // Checked before the per-provider branches so no provider path can reach a
  // denied model, however it was asked for.
  if (isDenied(model)) throw new Error(`${model} is not available on this platform`);
  if (agent.kind === "codex") return selectCodexModel(safe, model, effort);
  if (agent.kind === "kimi") return selectKimiModel(safe, model, effort);
  const normalizedModel = String(model || "").toLowerCase();
  const normalizedEffort = String(effort || "").toLowerCase();
  if (!selectableModelsFor("claude").includes(normalizedModel) || !CLAUDE_EFFORTS.includes(normalizedEffort)) throw new Error("Unsupported Claude model or effort");
  await sendTmuxInput(safe, `/model ${normalizedModel}`);
  await sleep(260);
  await sendTmuxInput(safe, `/effort ${normalizedEffort}`);
  return { model: normalizedModel, effort: normalizedEffort };
}

module.exports = {
  AGENT_KINDS, CLAUDE_EFFORTS, CLAUDE_MODELS, CODEX_EFFORTS, CODEX_MODELS, KIMI_MODELS,
  OLLAMA_CLOUD_MODELS, OPENCODE_GO_MODELS, OPENCODE_MODEL_PROVIDERS, DEFAULT_OPENCODE_MODELS,
  PERMISSION_MODES, SPAWN_COMMANDS, SPAWN_BINARIES,
  agentCliEnv, agentKindFor, answerPendingQuestion, autoTuneAgent, buildSpawnCommand, captureTmuxSession, claudeModeFromPane, clearAgentRuntimeCaches, codexSelectionDelay, codexSelectionSteps, cycleClaudePermission, happyWrapEnabled, isHappyAcpSession, isHappyHeadlessSession, spawnEnvExtras,
  routeForPrompt,
  createAgentGroup, createCursorChatId, defaultModelForProvider, effortsForProvider, defaultPermissionMode, deleteAgentGroup, detectAgentMode, detectAttention, detectCodexConfig, detectModelFromOutput, detectPendingQuestion, detectUsageFromOutput,
  agentComposerReady, enrichLiveSessions, enqueueMessage, flushTmuxQueues, forceFlushQueue, getLastUserMessage, getPermissionMode, getQueue, getUserImage, getUserMessageAttachments, getUserMessageHistory, isAgentBusy, isOutputBusy,
  listAgentGroups, listProcessAgents, listTmuxSessions, maybeAutoApproveAttention, modelsForProvider, parseTmuxSessions,
  permissionModesFor, permissionStateFor, refreshAgentCaptures, rememberUserMessage, removeQueuedMessage, renameAgentGroup, resolvePermissionMode, resolveSpawnModel,
  requestEndSession, resetAgentSessionState, selectableModelsFor, safeTmuxKey, safeTmuxName, sweepDeadSessions, selectAgentConfig, selectCodexModel, selectKimiModel, seedAgentPrompt,
  sendTmuxInput, sendTmuxKey, setAgentGroup, setAgentTitle, setPermissionMode, spawnOptionsFor, spawnTmuxAgent, tailLines, terminateAgent,
  getWrapUpState, refreshWrapUpFromOutput, clearWrapUp, waitUntilAgentAcceptsInput, withAgentHomeEnv,

};
