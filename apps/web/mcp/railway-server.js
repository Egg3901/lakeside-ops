// Railway MCP — deploy status / history / logs over the Railway GraphQL API
// (self-hosted, like our other MCPs). Read-only. Token-gated.
//   node mcp/railway-server.js   (default :9734)
require("dotenv").config({ quiet: true, path: require("path").join(__dirname, "..", ".env") });
const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { createServer } = require("../packages/mcp-server");
const store = require("../knowledge-store");
const tokens = require("../agent-tokens");

const PORT = parseInt(process.env.RAILWAY_MCP_PORT || "9734", 10);
const RW_TOKEN = process.env.RAILWAY_API_TOKEN;
const PROJECT_ID = process.env.RAILWAY_PROJECT_ID;
const API = "https://backboard.railway.app/graphql/v2";

async function gql(query, variables) {
  const r = await fetch(API, { method: "POST", headers: { Authorization: `Bearer ${RW_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors.map((e) => e.message).join("; "));
  return j.data;
}
async function project() {
  const d = await gql(`query($id:String!){ project(id:$id){ name environments{edges{node{id name}}} services{edges{node{id name}}} } }`, { id: PROJECT_ID });
  const p = d.project;
  return { name: p.name, environments: p.environments.edges.map((e) => e.node), services: p.services.edges.map((e) => e.node) };
}
async function latestDeployments(environmentId, serviceId, first = 5) {
  const d = await gql(
    `query($first:Int!,$input:DeploymentListInput!){ deployments(first:$first, input:$input){ edges{ node{ id status createdAt staticUrl url } } } }`,
    { first, input: { projectId: PROJECT_ID, environmentId, serviceId } });
  return d.deployments.edges.map((e) => e.node);
}

async function main() {
  const db = await store.getDb(process.env.MONGODB_URI);
  await tokens.ensureIndexes(db);

  function buildServer() {
    const server = new McpServer({ name: "ops-railway", version: "1.0.0" });

    server.tool("railway_status", "Current Railway deploy status: each service's latest deployment (status, when, URL) in the production environment.", {}, async () => {
      const p = await project();
      const prod = p.environments.find((e) => /prod/i.test(e.name)) || p.environments[0];
      const services = [];
      for (const s of p.services) {
        let latest = null;
        try { latest = (await latestDeployments(prod.id, s.id, 1))[0] || null; } catch { /* some services (DB) have no deploys */ }
        services.push({ service: s.name, status: latest && latest.status, deployedAt: latest && latest.createdAt, url: latest && (latest.staticUrl || latest.url) });
      }
      return jsonResult({ project: p.name, environment: prod.name, services });
    });

    server.tool("railway_deployments", "Recent deployments for a service (default: Main Site).", {
      service: z.string().optional().describe("service name, default 'Main Site'"), limit: z.number().int().min(1).max(20).optional().default(8),
    }, async ({ service, limit }) => {
      const p = await project();
      const prod = p.environments.find((e) => /prod/i.test(e.name)) || p.environments[0];
      const svc = p.services.find((s) => s.name.toLowerCase() === (service || "main site").toLowerCase()) || p.services.find((s) => /main site/i.test(s.name)) || p.services[0];
      const deps = await latestDeployments(prod.id, svc.id, limit);
      return jsonResult({ service: svc.name, deployments: deps.map((d) => ({ id: d.id, status: d.status, createdAt: d.createdAt, url: d.staticUrl || d.url })) });
    });

    server.tool("railway_logs", "Deployment logs for a deployment id (from railway_deployments).", {
      deploymentId: z.string(), limit: z.number().int().min(1).max(200).optional().default(80),
    }, async ({ deploymentId, limit }) => {
      const d = await gql(`query($id:String!,$limit:Int!){ deploymentLogs(deploymentId:$id, limit:$limit){ message timestamp severity } }`, { id: deploymentId, limit });
      return jsonResult({ deploymentId, logs: (d.deploymentLogs || []).map((l) => ({ t: l.timestamp, sev: l.severity, msg: l.message })) });
    });

    return server;
  }

  createServer({
    name: "railway-mcp", version: "1.0.0", port: PORT, bind: process.env.MCP_BIND || "127.0.0.1",
    authorize: req => tokens.validate(db, req.headers.authorization), buildServer,
    health: () => ({ configured: !!RW_TOKEN }),
  });
}
function jsonResult(o) { return { content: [{ type: "text", text: JSON.stringify(o, null, 2) }] }; }
function rpcErr(code, message) { return { jsonrpc: "2.0", error: { code, message }, id: null }; }
main().catch((e) => { console.error("[railway-mcp] fatal:", e); process.exit(1); });
