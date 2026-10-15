// Turn Diagnostics MCP — deep observability on the game engine's turn loop:
// per-phase timings, timing regressions, anomaly sweep, and live lock status.
// Complements the engine MCP (health summary) with phase-level triage so agents
// can diagnose slow/stuck turns BEFORE players report them. Read-only.
// Streamable HTTP + scoped bearer-token auth.
//   node mcp/turndiag-server.js   (default :9736)
require("dotenv").config({ quiet: true, path: require("path").join(__dirname, "..", ".env") });
const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { createServer } = require("../packages/mcp-server");
const store = require("../knowledge-store");
const tokens = require("../agent-tokens");

const PORT = parseInt(process.env.TURNDIAG_MCP_PORT || "9736", 10);
const TURNLOG_PROJ = { turn: 1, durationMs: 1, success: 1, warnings: 1, phaseStatuses: 1, realTime: 1 };

// phaseStatuses: { [phase]: { status, startedAt, completedAt, reason, message } }
function phaseDurations(t) {
  return Object.entries(t.phaseStatuses || {}).map(([phase, p]) => {
    const start = p && p.startedAt ? new Date(p.startedAt).getTime() : null;
    const end = p && p.completedAt ? new Date(p.completedAt).getTime() : null;
    return { phase, status: (p && p.status) || "unknown", ms: start != null && end != null ? end - start : null,
      reason: (p && (p.reason || p.message)) || null };
  });
}
function median(xs) { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; }

async function main() {
  const db = await store.getDb(process.env.MONGODB_URI);
  await tokens.ensureIndexes(db);

  function buildServer() {
    const server = new McpServer({ name: "ops-turndiag", version: "1.0.0" });

    server.tool("turn_phase_timings",
      "Per-phase timing breakdown for one turn (default: latest). Returns phases sorted slowest-first with ms, status, and share of total turn time. Use to find which phase makes a turn slow.",
      { turn: z.number().int().optional().describe("turn number; omit for latest logged turn"),
        top: z.number().int().min(1).max(200).optional().default(25) },
      async ({ turn, top }) => {
        const q = turn != null ? { turn } : {};
        const t = await db.collection("turnLogs").find(q, { projection: TURNLOG_PROJ }).sort({ turn: -1 }).limit(1).next();
        if (!t) return jsonResult({ error: turn != null ? `no turnLog for turn ${turn}` : "no turnLogs" });
        const rows = phaseDurations(t).sort((a, b) => (b.ms || 0) - (a.ms || 0));
        const total = t.durationMs || rows.reduce((a, r) => a + (r.ms || 0), 0) || 1;
        return jsonResult({ turn: t.turn, realTime: t.realTime, durationMs: t.durationMs, success: t.success,
          warnings: (t.warnings || []).length, phaseCount: rows.length,
          notCompleted: rows.filter((r) => r.status !== "completed" && r.status !== "skipped"),
          slowest: rows.slice(0, top).map((r) => ({ ...r, pctOfTurn: r.ms != null ? +((100 * r.ms) / total).toFixed(1) : null })) });
      });

    server.tool("phase_history",
      "Timing history of ONE named phase across recent turns: per-turn ms, median, max, and failures. Use after turn_phase_timings to see whether a slow phase is a spike or a trend.",
      { phase: z.string().describe("exact phase key, e.g. 'autoCrisisTurn'"),
        turns: z.number().int().min(2).max(100).optional().default(30) },
      async ({ phase, turns }) => {
        const logs = await db.collection("turnLogs")
          .find({ [`phaseStatuses.${phase}`]: { $exists: true } }, { projection: { turn: 1, durationMs: 1, [`phaseStatuses.${phase}`]: 1 } })
          .sort({ turn: -1 }).limit(turns).toArray();
        if (!logs.length) return jsonResult({ error: `phase '${phase}' not found in recent turnLogs` });
        const series = logs.map((t) => {
          const p = t.phaseStatuses[phase] || {};
          const ms = p.startedAt && p.completedAt ? new Date(p.completedAt) - new Date(p.startedAt) : null;
          return { turn: t.turn, ms, status: p.status || "unknown" };
        }).reverse();
        const msVals = series.map((s) => s.ms).filter((v) => v != null);
        return jsonResult({ phase, turns: series.length, medianMs: median(msVals), maxMs: Math.max(0, ...msVals),
          latestMs: series[series.length - 1] && series[series.length - 1].ms,
          failures: series.filter((s) => s.status !== "completed" && s.status !== "skipped").map((s) => s.turn),
          series });
      });

    server.tool("phase_regressions",
      "Find phases that got SLOWER: compares each phase's median ms in the recent window vs a baseline window and flags regressions above a threshold. The proactive 'why are turns creeping up' tool.",
      { recent: z.number().int().min(3).max(50).optional().default(10).describe("recent window (turns)"),
        baseline: z.number().int().min(5).max(200).optional().default(40).describe("baseline window before the recent one (turns)"),
        minMs: z.number().int().min(0).optional().default(500).describe("ignore phases whose recent median is below this"),
        factor: z.number().min(1).optional().default(1.5).describe("flag when recentMedian >= factor * baselineMedian") },
      async ({ recent, baseline, minMs, factor }) => {
        const logs = await db.collection("turnLogs").find({}, { projection: { turn: 1, phaseStatuses: 1, durationMs: 1 } })
          .sort({ turn: -1 }).limit(recent + baseline).toArray();
        if (logs.length < recent + 5) return jsonResult({ error: `not enough turnLogs (${logs.length})` });
        const recentLogs = logs.slice(0, recent), baseLogs = logs.slice(recent);
        const collect = (set) => {
          const m = {};
          for (const t of set) for (const r of phaseDurations(t)) if (r.ms != null) (m[r.phase] = m[r.phase] || []).push(r.ms);
          return m;
        };
        const rm = collect(recentLogs), bm = collect(baseLogs);
        const regressions = Object.keys(rm).map((phase) => {
          const r = median(rm[phase]), b = bm[phase] ? median(bm[phase]) : null;
          return { phase, recentMedianMs: r, baselineMedianMs: b, factor: b ? +(r / b).toFixed(2) : null };
        }).filter((x) => x.recentMedianMs >= minMs && (x.baselineMedianMs == null || x.recentMedianMs >= factor * x.baselineMedianMs))
          .sort((a, b) => (b.factor || 99) - (a.factor || 99));
        const turnTotals = { recentMedianMs: median(recentLogs.map((t) => t.durationMs || 0)), baselineMedianMs: median(baseLogs.map((t) => t.durationMs || 0)) };
        return jsonResult({ windows: { recentTurns: [recentLogs[recentLogs.length - 1].turn, recentLogs[0].turn], baselineTurns: [baseLogs[baseLogs.length - 1].turn, baseLogs[0].turn] },
          turnTotals, regressions, note: regressions.length ? undefined : "no phase regressions at these thresholds" });
      });

    server.tool("turn_anomalies",
      "Anomaly sweep over recent turns: failed turns, failed/stuck phases (with reasons), warning texts, and duration outliers (> 2x median). The first tool to run when something feels off.",
      { turns: z.number().int().min(1).max(60).optional().default(20) },
      async ({ turns }) => {
        const logs = await db.collection("turnLogs").find({}, { projection: TURNLOG_PROJ }).sort({ turn: -1 }).limit(turns).toArray();
        const med = median(logs.map((t) => t.durationMs || 0));
        const anomalies = [];
        for (const t of logs) {
          if (t.success === false) anomalies.push({ turn: t.turn, kind: "turn-failed" });
          for (const r of phaseDurations(t)) if (r.status !== "completed" && r.status !== "skipped")
            anomalies.push({ turn: t.turn, kind: "phase-" + r.status, phase: r.phase, reason: r.reason });
          if (med && (t.durationMs || 0) > 2 * med) anomalies.push({ turn: t.turn, kind: "slow-turn", durationMs: t.durationMs, medianMs: med });
          for (const w of (t.warnings || []).slice(0, 10)) anomalies.push({ turn: t.turn, kind: "warning", detail: typeof w === "string" ? w.slice(0, 300) : w });
        }
        return jsonResult({ turnsScanned: logs.length, medianDurationMs: med, anomalyCount: anomalies.length, anomalies });
      });

    server.tool("lock_status",
      "LIVE turn-processing lock state from gameState: isProcessing, current phase, heartbeat age, and a stuck verdict. If stuck, points at the reset-lock runbook. Run this FIRST for 'turn is stuck' reports.",
      {},
      async () => {
        // `_id: "current"` is the singleton the app itself reads. The live
        // document carries isActive:false, so an { isActive: true } query
        // matches NOTHING and every field below falls back to null — which
        // this tool then reported as a confident "idle". Canonical id first.
        const gs = (await db.collection("gameState").findOne({ _id: "current" }, { projection: {
          currentTurn: 1, lastTurnProcessed: 1, nextScheduledTurn: 1, pausedAt: 1, pauseKind: 1, pauseReason: 1,
          isProcessing: 1, processingHeartbeatAt: 1, processingKind: 1, processingPhase: 1, processingStartedAt: 1, processingTargetTurn: 1 } }))
          || (await db.collection("gameState").findOne({ isActive: true }))
          || {};
        const now = Date.now();
        const hbAgeSec = gs.processingHeartbeatAt ? Math.round((now - new Date(gs.processingHeartbeatAt).getTime()) / 1000) : null;
        const runningMin = gs.processingStartedAt ? Math.round((now - new Date(gs.processingStartedAt).getTime()) / 60000) : null;
        const overdueMin = gs.nextScheduledTurn ? Math.max(0, Math.round((now - new Date(gs.nextScheduledTurn).getTime()) / 60000)) : null;
        // No document at all is UNKNOWN, not idle. Reporting a confident
        // "idle" for an unreadable lock is how a stuck turn looks healthy.
        let verdict = gs.currentTurn == null ? "unknown (no gameState document found)" : "idle";
        if (gs.isProcessing) verdict = hbAgeSec != null && hbAgeSec > 300 ? "STUCK (heartbeat stale >5min)" : "processing (heartbeat live)";
        else if (overdueMin != null && overdueMin > 10 && !gs.pausedAt) verdict = "overdue (not processing, past schedule)";
        return jsonResult({ verdict, currentTurn: gs.currentTurn, targetTurn: gs.processingTargetTurn || null,
          isProcessing: !!gs.isProcessing, processingKind: gs.processingKind || null, processingPhase: gs.processingPhase || null,
          processingStartedAt: gs.processingStartedAt || null, runningMin, heartbeatAgeSec: hbAgeSec,
          nextScheduledTurn: gs.nextScheduledTurn || null, overdueMin,
          paused: !!gs.pausedAt, pauseReason: gs.pauseReason || gs.pauseKind || null,
          runbook: verdict.startsWith("STUCK") ? "POST /api/admin/turn/reset-lock (admin) — see ops-knowledge 'turn stuck incident' runbook before resetting" : null });
      });

    return server;
  }

  createServer({
    name: "turndiag-mcp", version: "1.0.0", port: PORT, bind: process.env.MCP_BIND || "127.0.0.1",
    authorize: req => tokens.validate(db, req.headers.authorization), buildServer,
  });
}
function jsonResult(o) { return { content: [{ type: "text", text: JSON.stringify(o, null, 2) }] }; }
function rpcErr(code, message) { return { jsonrpc: "2.0", error: { code, message }, id: null }; }
main().catch((e) => { console.error("[turndiag-mcp] fatal:", e); process.exit(1); });
