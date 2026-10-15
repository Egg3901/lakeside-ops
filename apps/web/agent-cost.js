"use strict";

// Thin cached wrapper around CodeBurn (https://github.com/getagentseal/codeburn)
// for API-equivalent cost totals shown on the Code Agent screens.

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const { resolveBinary } = require("./src/core/paths");

// Resolve the codeburn binary lazily on first use instead of blocking server
// boot with a spawnSync("which") at require time.
let _codeburnBin = null;
function codeburnBin() {
  if (_codeburnBin) return _codeburnBin;
  _codeburnBin = resolveBinary("codeburn");
  if (_codeburnBin === "codeburn") {
    try {
      const resolved = (spawnSync("which", ["codeburn"], { encoding: "utf8" }).stdout || "").trim();
      if (resolved) _codeburnBin = resolved;
    } catch { /* keep basename */ }
  }
  return _codeburnBin;
}

const cache = new Map();
const CACHE_MS = 60_000;
let overviewWarmInFlight = null;
const asyncInFlight = new Map();

function runCodeburn(args, timeoutMs = 90_000) {
  const result = spawnSync(codeburnBin(), args, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const err = new Error((result.stderr || result.stdout || "codeburn failed").trim().slice(0, 400));
    err.status = result.status;
    throw err;
  }
  return result.stdout || "";
}

function runCodeburnAsync(args, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(codeburnBin(), args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 32 * 1024 * 1024) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) return reject(new Error(`codeburn stopped (${signal})`));
      if (code !== 0) {
        const error = new Error((stderr || stdout || "codeburn failed").trim().slice(0, 400));
        error.status = code;
        return reject(error);
      }
      resolve(stdout);
    });
  });
}

function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

function cachedAsync(key, fn) {
  const hit = peekCached(key);
  if (hit) return Promise.resolve(hit);
  if (asyncInFlight.has(key)) return asyncInFlight.get(key);
  const pending = Promise.resolve()
    .then(fn)
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => asyncInFlight.delete(key));
  asyncInFlight.set(key, pending);
  return pending;
}

function peekCached(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  return null;
}

function warmCostOverviewAsync() {
  if (peekCached("overview")) return Promise.resolve(peekCached("overview"));
  if (overviewWarmInFlight) return overviewWarmInFlight;
  overviewWarmInFlight = getCostOverviewAsync()
    .catch(() => null)
    .finally(() => { overviewWarmInFlight = null; });
  return overviewWarmInFlight;
}

const BREAKDOWN_PERIODS = new Set(["today", "week", "month"]);

function normalizeBreakdownPeriod(period) {
  const p = String(period || "today").toLowerCase();
  return BREAKDOWN_PERIODS.has(p) ? p : null;
}

function parseSessions(period = "today", provider = "all") {
  const key = `sessions:${period}:${provider}`;
  return cached(key, () => {
    const raw = runCodeburn(["sessions", "--format", "json", "-p", String(period), "--provider", String(provider)]);
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try { return JSON.parse(trimmed); } catch { return []; }
  });
}

function parseJsonRows(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return [];
  try { return JSON.parse(trimmed); } catch { return []; }
}

function parseSessionsAsync(period = "today", provider = "all") {
  const key = `sessions:${period}:${provider}`;
  return cachedAsync(key, async () =>
    parseJsonRows(await runCodeburnAsync([
      "sessions", "--format", "json", "-p", String(period), "--provider", String(provider),
    ]))
  );
}

function parseModels(period = "today", provider = "all") {
  const key = `models:${period}:${provider}`;
  return cached(key, () => {
    const raw = runCodeburn(["models", "--format", "json", "-p", String(period), "--provider", String(provider)]);
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try { return JSON.parse(trimmed); } catch { return []; }
  });
}

function parseModelsAsync(period = "today", provider = "all") {
  const key = `models:${period}:${provider}`;
  return cachedAsync(key, async () =>
    parseJsonRows(await runCodeburnAsync([
      "models", "--format", "json", "-p", String(period), "--provider", String(provider),
    ]))
  );
}

function summarizeByProject(sessions) {
  const byProject = {};
  for (const session of sessions || []) {
    const project = session.project || "unknown";
    const c = Number(session.cost) || 0;
    const k = Number(session.calls) || 0;
    if (!byProject[project]) byProject[project] = { project, cost: 0, calls: 0, sessions: 0 };
    byProject[project].cost += c;
    byProject[project].calls += k;
    byProject[project].sessions += 1;
  }
  return Object.values(byProject)
    .map((row) => ({ ...row, label: money(row.cost) }))
    .sort((a, b) => b.cost - a.cost);
}

function mapSessionRow(s) {
  const inputTokens = Number(s.inputTokens) || 0;
  const outputTokens = Number(s.outputTokens) || 0;
  const cacheReadTokens = Number(s.cacheReadTokens) || 0;
  const cacheWriteTokens = Number(s.cacheWriteTokens) || 0;
  return {
    sessionId: s.sessionId,
    provider: s.provider || "unknown",
    project: s.project || "unknown",
    models: s.models || [],
    cost: Number(s.cost) || 0,
    label: money(s.cost),
    calls: Number(s.calls) || 0,
    turns: Number(s.turns) || 0,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    startedAt: s.startedAt || null,
    endedAt: s.endedAt || null,
    durationMs: Number(s.durationMs) || 0,
  };
}

function buildCostBreakdown(normalized, sessions, models) {
    const totals = summarizeSessions(sessions);
    const byModel = models
      .map((m) => ({
        provider: m.provider || "unknown",
        model: m.modelDisplayName || m.model || "unknown",
        cost: Number(m.costUSD) || 0,
        label: money(m.costUSD),
        calls: Number(m.calls) || 0,
        inputTokens: Number(m.inputTokens) || 0,
        outputTokens: Number(m.outputTokens) || 0,
        cacheReadTokens: Number(m.cacheReadTokens) || 0,
        cacheWriteTokens: Number(m.cacheWriteTokens) || 0,
        totalTokens: Number(m.totalTokens) || 0,
      }))
      .sort((a, b) => b.cost - a.cost);
    const byProvider = (totals.byProvider || []).map((p) => ({ ...p, label: money(p.cost) }));
    return {
      source: "codeburn",
      bin: codeburnBin(),
      period: normalized,
      generatedAt: new Date().toISOString(),
      totals: { ...totals, byProvider },
      byProvider,
      byModel,
      byProject: summarizeByProject(sessions),
      sessions: sessions
        .slice()
        .map(mapSessionRow)
        .sort((a, b) => b.cost - a.cost),
    };
}

function getCostBreakdown(period = "today") {
  const normalized = normalizeBreakdownPeriod(period) || "today";
  return cached(`breakdown:${normalized}`, () => {
    const sessions = parseSessions(normalized, "all") || [];
    const models = parseModels(normalized, "all") || [];
    return buildCostBreakdown(normalized, sessions, models);
  });
}

function getCostBreakdownAsync(period = "today") {
  const normalized = normalizeBreakdownPeriod(period) || "today";
  return cachedAsync(`breakdown:${normalized}`, async () => {
    const [sessions, models] = await Promise.all([
      parseSessionsAsync(normalized, "all"),
      parseModelsAsync(normalized, "all"),
    ]);
    return buildCostBreakdown(normalized, sessions, models);
  });
}

function money(n) {
  const v = Number(n) || 0;
  let digits = 2;
  if (v >= 100) digits = 0;
  else if (v >= 10) digits = 1;
  else if (v > 0 && v < 0.01) digits = 4;
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function summarizeSessions(sessions) {
  const byProvider = {};
  let cost = 0;
  let calls = 0;
  let turns = 0;
  for (const session of sessions || []) {
    const provider = session.provider || "unknown";
    const c = Number(session.cost) || 0;
    const k = Number(session.calls) || 0;
    const t = Number(session.turns) || 0;
    cost += c;
    calls += k;
    turns += t;
    if (!byProvider[provider]) byProvider[provider] = { provider, cost: 0, calls: 0, sessions: 0 };
    byProvider[provider].cost += c;
    byProvider[provider].calls += k;
    byProvider[provider].sessions += 1;
  }
  return {
    cost,
    calls,
    turns,
    sessions: (sessions || []).length,
    label: money(cost),
    byProvider: Object.values(byProvider).sort((a, b) => b.cost - a.cost),
  };
}

function buildCostOverview(todaySessions, monthSessions) {
    const today = summarizeSessions(todaySessions);
    const month = summarizeSessions(monthSessions);
    return {
      source: "codeburn",
      bin: codeburnBin(),
      generatedAt: new Date().toISOString(),
      today,
      month,
      recent: (todaySessions || [])
        .slice()
        .sort((a, b) => String(b.endedAt || b.startedAt || "").localeCompare(String(a.endedAt || a.startedAt || "")))
        .slice(0, 12)
        .map((s) => ({
          sessionId: s.sessionId,
          provider: s.provider,
          project: s.project,
          models: s.models || [],
          cost: Number(s.cost) || 0,
          label: money(s.cost),
          calls: s.calls || 0,
          turns: s.turns || 0,
          startedAt: s.startedAt || null,
          endedAt: s.endedAt || null,
        })),
    };
}

function getCostOverview() {
  return cached("overview", () => {
    const todaySessions = parseSessions("today", "all");
    const monthSessions = parseSessions("month", "all");
    return buildCostOverview(todaySessions, monthSessions);
  });
}

function getCostOverviewAsync() {
  return cachedAsync("overview", async () => {
    const todaySessions = await parseSessionsAsync("today", "all");
    const monthSessions = await parseSessionsAsync("month", "all");
    return buildCostOverview(todaySessions, monthSessions);
  });
}

function getProviderCost(provider, period = "today") {
  return summarizeSessions(parseSessions(period, provider));
}

const KIND_TO_CODEBURN = {
  cursor: "cursor-agent",
  claude: "claude",
  codex: "codex",
  kimi: "kimi",
  gemini: "gemini",
};

function codeburnProviderForKind(kind) {
  return KIND_TO_CODEBURN[kind] || kind || "all";
}

function getCostForKind(kind, period = "today") {
  const provider = codeburnProviderForKind(kind);
  if (period === "today" || period === "month") {
    const overview = peekCached("overview") || null;
    if (!overview) {
      warmCostOverviewAsync();
      return { provider, kind, cost: 0, calls: 0, sessions: 0, turns: 0, label: "…", byProvider: [], pending: true };
    }
    const bucket = period === "month" ? overview.month : overview.today;
    const hit = (bucket.byProvider || []).find((p) => p.provider === provider);
    return {
      provider,
      kind,
      cost: hit?.cost || 0,
      calls: hit?.calls || 0,
      sessions: hit?.sessions || 0,
      turns: 0,
      label: money(hit?.cost || 0),
      byProvider: hit ? [hit] : [],
    };
  }
  const summary = getProviderCost(provider, period);
  return { ...summary, provider, kind };
}

function latestSessionForKind(kind) {
  const provider = codeburnProviderForKind(kind);
  const overview = peekCached("overview");
  if (!overview) {
    warmCostOverviewAsync();
    return null;
  }
  const hit = (overview.recent || []).find((s) => s.provider === provider);
  return hit || null;
}

function peekCostOverview() {
  const value = peekCached("overview");
  if (!value) warmCostOverviewAsync();
  return value;
}

function findSessionCost(sessionId) {
  if (!sessionId) return null;
  const needle = String(sessionId);
  for (const period of ["today", "week", "month"]) {
    const hit = (parseSessions(period, "all") || []).find((s) => String(s.sessionId) === needle);
    if (hit) {
      return {
        sessionId: hit.sessionId,
        provider: hit.provider,
        cost: Number(hit.cost) || 0,
        label: money(hit.cost),
        calls: hit.calls || 0,
        turns: hit.turns || 0,
        models: hit.models || [],
        period,
      };
    }
  }
  return null;
}

function clearCostCache() {
  cache.clear();
  asyncInFlight.clear();
  overviewWarmInFlight = null;
}

module.exports = {
  BREAKDOWN_PERIODS,
  clearCostCache,
  codeburnProviderForKind,
  findSessionCost,
  getCostBreakdown,
  getCostBreakdownAsync,
  getCostForKind,
  getCostOverview,
  getCostOverviewAsync,
  getProviderCost,
  latestSessionForKind,
  money,
  normalizeBreakdownPeriod,
  parseModels,
  parseSessions,
  peekCostOverview,
  warmCostOverviewAsync,
};
