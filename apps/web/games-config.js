// games-config.js — compatibility shim over the project registry.
// Prefer src/services/projectRegistry.js for new code.
// Add/edit games in config/dashboard.yaml (type: game).

const { loadConfig } = require("./src/core/config");
const { listGames } = require("./src/services/projectRegistry");

loadConfig();

/** @type {ReturnType<typeof listGames>} */
let GAMES = listGames();

function refreshGames() {
  GAMES = listGames();
  return GAMES;
}

// ─── Health checks ───────────────────────────────────────────────────
// Server-side, short timeout, never throws. Result shape per game:
// { key, ok, checks: [{ label, ok, status, ms, reason }] }

async function probe(check, timeoutMs) {
  const t0 = Date.now();
  try {
    const r = await fetch(check.url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    const ok = r.status >= 200 && r.status < 400;
    return { label: check.label, ok, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { label: check.label, ok: false, status: 0, ms: Date.now() - t0, reason: e.name === "TimeoutError" ? "timeout" : (e.message || "unreachable") };
  }
}

async function checkGamesHealth({ timeoutMs = 3000 } = {}) {
  const games = listGames();
  const settled = await Promise.allSettled(
    games.map(async (g) => {
      if (!g.checks || g.checks.length === 0) {
        return { key: g.key, ok: null, checks: [] };
      }
      const checks = await Promise.all((g.checks || []).map((c) => probe(c, timeoutMs)));
      return { key: g.key, ok: checks.every((c) => c.ok), checks };
    })
  );
  return settled.map((s, i) =>
    s.status === "fulfilled" ? s.value : { key: games[i].key, ok: false, checks: [{ label: "check", ok: false, status: 0, ms: 0, reason: s.reason && s.reason.message }] }
  );
}

// 30s memoised variant so hot pages (the home dashboard) stay fast.
let _cache = null; // { at, promise }
function checkGamesHealthCached({ maxAgeMs = 30_000, timeoutMs = 3000 } = {}) {
  const now = Date.now();
  if (_cache && now - _cache.at < maxAgeMs) return _cache.promise;
  _cache = { at: now, promise: checkGamesHealth({ timeoutMs }) };
  return _cache.promise;
}

module.exports = { GAMES, refreshGames, checkGamesHealth, checkGamesHealthCached };
