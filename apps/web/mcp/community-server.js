// Community Brain MCP — exposes the vectorized 117k-message community corpus to
// agents: semantic search + RAG "ask the community". Thin MCP over the ideas
// service (127.0.0.1:9728) which holds the HNSW index + DeepSeek RAG. Same
// pattern as the other MCPs: Streamable HTTP + scoped bearer-token auth.
//   node mcp/community-server.js   (default :9729)
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { createServer } = require("../packages/mcp-server");
const store = require("../knowledge-store"); // getDb (token validation only)
const tokens = require("../agent-tokens");

const PORT = parseInt(process.env.COMMUNITY_MCP_PORT || "9729", 10);
const IDEAS = process.env.IDEAS_URL || "http://127.0.0.1:9728";

async function main() {
  const db = await store.getDb(process.env.MONGODB_URI);
  await tokens.ensureIndexes(db);

  function buildServer() {
    const server = new McpServer({ name: "ops-community", version: "1.0.0" });

    server.tool(
      "community_search",
      "Semantic search over the AHD community's 117k+ Discord messages. Returns the most relevant messages with author, channel, date and a jump-link.",
      { query: z.string().describe("what to find, in natural language"), limit: z.number().int().min(1).max(40).optional().default(15) },
      async ({ query, limit }) => {
        const r = await fetch(`${IDEAS}/search?q=${encodeURIComponent(query)}&limit=${limit}`);
        const d = await r.json();
        return jsonResult({ vectors: d.vectors, results: d.results || [] });
      }
    );

    server.tool(
      "community_ask",
      "Ask a question and get an answer grounded in real community Discord messages (RAG), with cited sources. Use this to learn what players think, want, or have discussed.",
      { question: z.string() },
      async ({ question }) => {
        const r = await fetch(`${IDEAS}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
        const d = await r.json();
        if (d.error) return errorResult(d.error);
        return jsonResult({ answer: d.answer, sources: d.sources || [] });
      }
    );

    return server;
  }

  createServer({
    name: "community-mcp", version: "1.0.0", port: PORT, bind: process.env.MCP_BIND || "127.0.0.1",
    authorize: req => tokens.validate(db, req.headers.authorization), buildServer,
  });
}
function jsonResult(o) { return { content: [{ type: "text", text: JSON.stringify(o, null, 2) }] }; }
function errorResult(m) { return { content: [{ type: "text", text: "Error: " + m }], isError: true }; }
function rpcErr(code, message) { return { jsonrpc: "2.0", error: { code, message }, id: null }; }
main().catch((e) => { console.error("[community-mcp] fatal:", e); process.exit(1); });
