// Game Engine Observatory MCP — exposes simulation health (turns / elections /
// economy) to agents, and alerts new anomalies to Discord (ops webhook).
// Read-only. Streamable HTTP + scoped bearer-token auth.
//   node mcp/engine-server.js   (default :9731)
require("dotenv").config({ quiet: true, path: require("path").join(__dirname, "..", ".env") });
const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { createServer } = require("../packages/mcp-server");
const store = require("../knowledge-store");
const tokens = require("../agent-tokens");
const { engineHealth } = require("../engine-health");
const { loadEconomyMetricSnapshot } = require("./economy-metrics");

const PORT = parseInt(process.env.ENGINE_MCP_PORT || "9731", 10);
const WEBHOOK = process.env.DISCORD_OPS_WEBHOOK_URL || "";
const ALERT_MS = 5 * 60 * 1000;

async function main() {
  const db = await store.getDb(process.env.MONGODB_URI);
  await tokens.ensureIndexes(db);
  // ── anomaly alerter: post NEW error/warn flags to Discord ──
  let seen = new Set();
  async function alertTick() {
    if (!WEBHOOK) return;
    try {
      const h = await engineHealth(db);
      const actionable = h.flags.filter((f) => f.level === "error" || f.level === "warn");
      const codes = new Set(actionable.map((f) => f.code));
      const fresh = actionable.filter((f) => !seen.has(f.code));
      seen = codes; // only alert on transitions into a flag state
      if (fresh.length) {
        const lines = fresh.map((f) => (f.level === "error" ? "🔴" : "🟠") + " " + f.msg).join("\n");
        await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: `**🛰️ Game Engine alert** (turn ${h.turn})\n${lines}` }) }).catch(() => {});
      }
    } catch (e) { console.warn("[engine-mcp] alert tick failed:", e.message); }
  }
  setInterval(alertTick, ALERT_MS);
  setTimeout(alertTick, 8000);

  function buildServer() {
    const server = new McpServer({ name: "ops-engine", version: "1.0.0" });
    server.tool("engine_health", "Health of the game simulation: current turn, last-turn success/duration, failed phases, schedule adherence, election integrity, economy pulse, and active anomaly flags.", {}, async () => jsonResult(await engineHealth(db)));
    server.tool("recent_turns", "Recent turn-processing records (duration, success, warnings, failed phases).", { limit: z.number().int().min(1).max(50).optional().default(15) }, async ({ limit }) => {
      const rows = await db.collection("turnLogs").find({}, { projection: { turn: 1, durationMs: 1, success: 1, warnings: 1, realTime: 1, phaseStatuses: 1 } }).sort({ turn: -1 }).limit(limit).toArray();
      return jsonResult(rows.map((t) => ({ turn: t.turn, durationMs: t.durationMs, success: t.success, warnings: (t.warnings || []).length,
        failedPhases: Object.entries(t.phaseStatuses || {}).filter(([, p]) => p && p.status !== "completed" && p.status !== "skipped").map(([k]) => k) })));
    });
    server.tool("economy_pulse", "Economy snapshot: commodity prices vs base plus population-weighted metrics from canonical states. Median income is anchor-converted before world aggregation.", {}, async () => {
      const cps = await db.collection("commodityPrices").find({}, { projection: { commodity: 1, globalPrice: 1, basePrice: 1 } }).toArray();
      const ratios = cps.map((c) => ({ commodity: c.commodity, vsBase: c.basePrice ? +(c.globalPrice / c.basePrice).toFixed(2) : 1 })).sort((a, b) => b.vsBase - a.vsBase);
      const metricSnapshot = await loadEconomyMetricSnapshot(db);
      return jsonResult({ commodities: ratios, metricSnapshot });
    });
    return server;
  }

  createServer({
    name: "engine-mcp", port: PORT, bind: process.env.MCP_BIND || "127.0.0.1",
    authorize: req => tokens.validate(db, req.headers.authorization), buildServer,
    health: () => ({ alerts: !!WEBHOOK }),
  });
}
function jsonResult(o) { return { content: [{ type: "text", text: JSON.stringify(o, null, 2) }] }; }
main().catch((e) => { console.error("[engine-mcp] fatal:", e); process.exit(1); });
