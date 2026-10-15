const fs = require("node:fs");
const path = require("node:path");
const { claudeSessionState, claudeSessionUsage } = require("./claude-session-state");
const { homeDir } = require("./src/core/paths");
const cache = new Map();

function recentJsonlFiles(root, limit = 30) {
  const found = [];
  function walk(directory, depth) {
    if (depth > 5) return;
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.endsWith(".jsonl")) {
        try { found.push({ full, mtime: fs.statSync(full).mtimeMs }); } catch {}
      }
    }
  }
  walk(root, 0);
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, limit).map((item) => item.full);
}

function tailLines(file, bytes = 8 * 1024 * 1024) {
  const stat = fs.statSync(file);
  const size = Math.min(stat.size, bytes);
  const buffer = Buffer.alloc(size);
  const fd = fs.openSync(file, "r");
  try { fs.readSync(fd, buffer, 0, size, stat.size - size); } finally { fs.closeSync(fd); }
  return buffer.toString("utf8").split("\n").reverse();
}

function codexUsage() {
  for (const file of recentJsonlFiles(path.join(homeDir(), ".codex", "sessions"))) {
    for (const line of tailLines(file)) {
      try {
        const event = JSON.parse(line);
        const info = event?.payload?.type === "token_count" ? event.payload.info : null;
        const limits = event.payload.rate_limits || info?.rate_limits;
        const used = limits?.primary?.used_percent;
        if (Number.isFinite(used)) return {
          provider: "codex", direction: "remaining", percent: Math.max(0, 100 - used),
          label: `${Math.round(100 - used)}% remaining`, detail: "Weekly plan",
          resetsAt: limits.primary.resets_at || null,
        };
      } catch {}
    }
  }
  return null;
}

function claudeUsage(cwd) {
  const home = homeDir() || "/root";
  const projectDir = path.join(home, ".claude", "projects", String(cwd || home).replace(/[^a-zA-Z0-9-]/g, "-"));
  for (const file of recentJsonlFiles(projectDir, 10)) {
    for (const line of tailLines(file)) {
      try {
        const event = JSON.parse(line);
        const usage = event?.message?.usage;
        if (!usage) continue;
        const tokens = Number(usage.input_tokens || 0) + Number(usage.cache_read_input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0);
        const percent = Math.max(0, Math.min(100, (tokens / 1_000_000) * 100));
        return { provider: "claude", direction: "used", percent, label: `${Math.round(percent)}% filled`, detail: "Session context", tokens };
      } catch {}
    }
  }
  return null;
}

function kimiUsage() {
  for (const file of recentJsonlFiles(path.join(homeDir(), ".kimi", "sessions"), 10)) {
    for (const line of tailLines(file, 2 * 1024 * 1024)) {
      try {
        const event = JSON.parse(line);
        const usage = event?.message?.usage || event?.usage;
        if (!usage) continue;
        const tokens = Number(usage.input_tokens || usage.inputTokens || 0) +
          Number(usage.cache_read_input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0);
        if (!tokens) continue;
        const percent = Math.max(0, Math.min(100, (tokens / 1_000_000) * 100));
        return { provider: "kimi", direction: "used", percent, label: `${Math.round(percent)}% filled`, detail: "Session context", tokens };
      } catch {}
    }
  }
  return null;
}

function readCursorCliConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(homeDir(), ".cursor", "cli-config.json"), "utf8"));
  } catch {
    return null;
  }
}

function cursorModelFromConfig() {
  const cfg = readCursorCliConfig();
  const model = cfg?.model || {};
  const name = model.displayNameShort || model.displayName || model.displayModelId || model.modelId || "";
  return String(name).replace(/^Cursor\s+/i, "").trim() || null;
}

function cursorUsageFromTrackingDb() {
  try {
    const { spawnSync } = require("node:child_process");
    const result = spawnSync("sqlite3", [
      "-separator", "|",
      path.join(homeDir(), ".cursor", "ai-tracking", "ai-code-tracking.db"),
      `SELECT model, COUNT(*), MAX(createdAt) FROM ai_code_hashes WHERE createdAt > ${Date.now() - 6 * 60 * 60 * 1000} GROUP BY model ORDER BY MAX(createdAt) DESC LIMIT 1;`,
    ], { encoding: "utf8", timeout: 3000 });
    const line = String(result.stdout || "").trim();
    if (!line) return null;
    const [model, n] = line.split("|");
    if (!model) return null;
    return {
      provider: "cursor",
      direction: "used",
      percent: null,
      label: model,
      detail: `${n || "0"} tracked edits · last 6h`,
      model,
    };
  } catch {
    return null;
  }
}

function cursorUsage() {
  // Model identity is resolved separately via resolveAgentModel / cli-config.
  // Don't publish "Model X" as a usage reading — that blanks the burn meter
  // and hides real context % when the pane footer is momentarily missing.
  const model = cursorModelFromConfig();
  const tracked = cursorUsageFromTrackingDb();
  if (tracked && Number.isFinite(tracked.percent)) {
    return {
      provider: "cursor",
      direction: "used",
      percent: tracked.percent,
      label: tracked.label || `${Math.round(tracked.percent)}% filled`,
      detail: tracked.detail || "Session context",
      model: model || tracked.model || null,
    };
  }
  if (model) return { provider: "cursor", direction: "used", percent: null, label: null, detail: null, model };
  return null;
}

function getAgentUsage(provider, cwd, tmuxName) {
  // Several Claude agents normally share one working directory, so the cache has
  // to be keyed by session as well — otherwise four panes running in /root all
  // read back whichever one wrote to its log last.
  const key = `${provider}:${cwd}:${tmuxName || ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  let value = null;
  if (provider === "claude") value = claudeSessionUsage(tmuxName, cwd) || claudeUsage(cwd);
  else if (provider === "codex") value = codexUsage();
  else if (provider === "kimi") value = kimiUsage();
  else if (provider === "cursor") value = cursorUsage();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const lastUsageByKey = new Map();

function resolveAgentUsage(provider, cwd, output, detectUsageFromOutput, context = {}) {
  const fromFs = getAgentUsage(provider, cwd, context.tmuxName);
  const fromPane = typeof detectUsageFromOutput === "function"
    ? detectUsageFromOutput(provider, output)
    : null;
  if (!fromFs && !fromPane) return null;
  const cacheKey = `${provider}:${cwd || ""}:${context.tmuxName || ""}`;
  const cached = lastUsageByKey.get(cacheKey);
  const panePercent = Number.isFinite(fromPane?.percent) ? fromPane.percent : null;
  const fsPercent = Number.isFinite(fromFs?.percent) ? fromFs.percent : null;
  let percent = panePercent ?? fsPercent;
  // Cursor's footer can scroll off mid-turn; keep the last known context %.
  if (!Number.isFinite(percent) && Number.isFinite(cached?.percent)) percent = cached.percent;
  const tokens = fromPane?.tokens ?? fromFs?.tokens ?? cached?.tokens ?? null;
  const label = panePercent != null
    ? (fromPane.label || `${Math.round(panePercent)}% filled`)
    : (Number.isFinite(percent)
      ? (cached?.label || `${Math.round(percent)}% filled`)
      : (fromPane?.label || fromFs?.label || cached?.label || "Usage"));
  const detailParts = [];
  if (panePercent != null && fromPane?.detail) detailParts.push(fromPane.detail);
  else if (Number.isFinite(percent) && cached?.detail && panePercent == null && fsPercent == null) detailParts.push(cached.detail);
  else if (fromPane?.detail) detailParts.push(fromPane.detail);
  else if (fromFs?.detail) detailParts.push(fromFs.detail);
  else if (cached?.detail) detailParts.push(cached.detail);
  const resolved = {
    provider: fromPane?.provider || fromFs?.provider || provider,
    direction: fromPane?.direction || fromFs?.direction || cached?.direction || "used",
    percent,
    label,
    detail: detailParts.join(" · ") || "",
    tokens,
    model: fromFs?.model || cached?.model || null,
  };
  if (Number.isFinite(resolved.percent) || resolved.tokens != null) lastUsageByKey.set(cacheKey, resolved);
  return resolved;
}

function resolveAgentModel(provider, output, detectModelFromOutput, context = {}) {
  // The pane is preferred only because it can carry the effort level too
  // ("Opus 5 · high"); it states the model just after a /model command and not
  // at all the rest of the time, which is why the chip used to sit on
  // "Detecting…" for the whole life of a session.
  const fromPane = typeof detectModelFromOutput === "function"
    ? detectModelFromOutput(provider, output)
    : null;
  if (fromPane) return fromPane;
  if (provider === "cursor") return cursorModelFromConfig();
  if (provider === "claude" && context.tmuxName) {
    const state = claudeSessionState(context.tmuxName, context.cwd);
    if (state?.modelLabel) return state.modelLabel;
  }
  const usage = getAgentUsage(provider, context.cwd, context.tmuxName);
  return usage?.model || null;
}

module.exports = {
  cursorModelFromConfig,
  getAgentUsage,
  readCursorCliConfig,
  resolveAgentModel,
  resolveAgentUsage,
};
