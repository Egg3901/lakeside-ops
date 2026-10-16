"use strict";
// Owner-authenticated desktop access. Authentication and Origin checks belong
// to appchannel. Host credentials stay here; this is not a remote shell.
const fs = require("node:fs"), path = require("node:path");
const { MCP_READS } = require("./ownermuse-policy");
const { validateArguments } = require("./broker");
const READS = { ...MCP_READS, "ops-knowledge": [...MCP_READS["ops-knowledge"], "knowledge_bootstrap", "knowledge_list", "box_projects", "worktree_fleet_status"] };
const COORDINATION = new Set(["kanban_add", "kanban_update", "work_report"]);
const object = properties => ({ type: "object", properties, additionalProperties: false });
const string = { type: "string" };
const TOOLS = [
  { name: "vps_status", description: "Inspect the actual connected Keir VPS, available read services and project roots. Remote paths belong to the VPS, not your PC.", inputSchema: object({}) },
  { name: "vps_tools", description: "Read schemas for permitted tools on one VPS MCP. Discover before calling. Production writes are not exposed; task coordination is available separately.", inputSchema: { ...object({ server: string }), required: ["server"] } },
  { name: "vps_read", description: "Call a permitted read tool on the VPS using its server-side credentials. Use ops-knowledge knowledge_bootstrap, knowledge_query/get for shared skills and runbooks, box_projects for paths, and worktree_fleet_status for other agents. Never interpret returned remote paths as local paths.", inputSchema: { ...object({ server: string, tool: string, args: { type: "object" } }), required: ["server", "tool"] } },
  { name: "vps_coordinate", description: "Update shared work tracking through kanban_add, kanban_update or work_report on the VPS. This does not authorize production changes, send messages or establish completion. Read vps_tools for schemas.", inputSchema: { ...object({ tool: string, args: { type: "object" } }), required: ["tool", "args"] } },
  { name: "vps_environment", description: "Inspect a registered VPS project's .env file. Returns keys, commented/configured state and redacted values. Use the VPS service tools rather than copying production secrets into a local checkout.", inputSchema: { ...object({ project: string, file: { type: "string", default: ".env.local" } }), required: ["project"] } },
  { name: "vps_sentry", description: "Read Sentry-compatible issues from the VPS using its configured API credentials. Does not require local Sentry environment variables and cannot resolve or mutate issues.", inputSchema: object({ id: string, query: string, period: string, limit: { type: "integer", minimum: 1, maximum: 25 } }) },
];
function createDesktopGateway({ mcp, projects, env = process.env, fetchImpl = fetch, audit = () => {}, readTools = {}, coordinationTools = ["kanban_add", "kanban_update", "work_report"] }) {
  const registry = () => typeof projects === "function" ? projects() : projects || {};
  const coordination = new Set(coordinationTools);
  const reads = { ...READS, ...readTools };
  const allowed = (server, name, write = false) => write ? server === "ops-knowledge" && coordination.has(name) : reads[server]?.includes(name);
  async function call(name, args) {
    const spec = TOOLS.find(tool => tool.name === name);
    if (!spec) throw Error("Unknown desktop tool");
    validateArguments(args, spec.inputSchema);
    audit(name);
    if (name === "vps_status") return { connected: true, services: mcp.servers().filter(server => reads[server]), projects: registry(), sentryConfigured: Boolean(env.SENTRY_API_TOKEN && env.SENTRY_ORG), environmentValues: "redacted", productionWrites: false, coordination: [...coordination] };
    if (name === "vps_tools") return (await mcp.list(args.server)).filter(tool => allowed(args.server, tool.name) || allowed(args.server, tool.name, true));
    if (name === "vps_read" || name === "vps_coordinate") {
      const coordination = name === "vps_coordinate", server = coordination ? "ops-knowledge" : args.server;
      if (!allowed(server, args.tool, coordination)) throw Error("This desktop capability is not exposed; production actions retain their existing approval path");
      const schema = (await mcp.list(server)).find(tool => tool.name === args.tool)?.inputSchema;
      if (!schema) throw Error("Tool is not available on the VPS");
      validateArguments(args.args || {}, schema);
      return mcp.call(server, args.tool, args.args || {}, coordination);
    }
    if (name === "vps_environment") {
      const root = registry()[args.project], file = args.file || ".env.local";
      if (!root || !/^\.env(?:\.[A-Za-z0-9_-]+)*$/.test(file)) throw Error("Choose a registered project and a .env filename, without directories");
      const directory = fs.realpathSync(root), destination = fs.realpathSync(path.join(directory, file));
      if (path.dirname(destination) !== directory || !fs.statSync(destination).isFile() || fs.statSync(destination).size > 256000) throw Error("Environment file is outside the registered project or size limit");
      return { project: args.project, file: destination, values: "redacted", entries: fs.readFileSync(destination, "utf8").split(/\r?\n/).flatMap(line => {
        const match = /^\s*(#\s*)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (!match) return [];
        const value = match[3].trim();
        return [{ key: match[2], commented: Boolean(match[1]), configured: !match[1] && !["", "''", '""'].includes(value), value: value ? "[redacted]" : "" }];
      }) };
    }
    if (name === "vps_sentry") {
      if (!env.SENTRY_API_TOKEN || !env.SENTRY_ORG) throw Error("Sentry is not configured on the VPS; local environment changes will not fix that");
      const base = new URL(env.SENTRY_API_URL || "https://sentry.io");
      if (base.username || base.password || !["https:", "http:"].includes(base.protocol)) throw Error("Invalid VPS Sentry endpoint");
      if (args.id && !/^\d{1,24}$/.test(args.id)) throw Error("Invalid Sentry issue id");
      const suffix = args.id ? `/api/0/issues/${args.id}/` : `/api/0/organizations/${encodeURIComponent(env.SENTRY_ORG)}/issues/`;
      const url = new URL(suffix, base);
      if (!args.id) { url.searchParams.set("query", args.query || "is:unresolved"); url.searchParams.set("statsPeriod", /^\d{1,3}[hd]$/.test(args.period || "") ? args.period : "24h"); url.searchParams.set("limit", String(args.limit || 10)); }
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${env.SENTRY_API_TOKEN}` }, redirect: "error", signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw Error(`VPS Sentry returned HTTP ${response.status}`);
      return response.json();
    }
  }
  return { call, async route(route, method, body) {
    if (route !== "/desktop/mcp") return;
    if (method !== "POST") throw Object.assign(Error("MCP requires POST"), { status: 405 });
    if (body.id === undefined) return {};
    const result = value => ({ jsonrpc: "2.0", id: body.id, result: value });
    if (body.method === "initialize") return result({ protocolVersion: body.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "keir-desktop", version: "1.0.0" } });
    if (body.method === "ping") return result({});
    if (body.method === "tools/list") return result({ tools: TOOLS });
    if (body.method !== "tools/call") return { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Unknown method" } };
    try { return result({ content: [{ type: "text", text: JSON.stringify(await call(body.params?.name, body.params?.arguments || {})) }] }); }
    catch (error) { return result({ isError: true, content: [{ type: "text", text: require("../text").redactSecrets(error.message).slice(0, 1000) }] }); }
  } };
}
module.exports = { createDesktopGateway };
