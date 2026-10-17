"use strict";
// Owner-authenticated desktop access. Authentication and Origin checks belong
// to appchannel. Host credentials stay here; this is not a remote shell.
const fs = require("node:fs"), path = require("node:path");
const { MCP_READS } = require("./ownermuse-policy");
const { validateArguments } = require("./broker");
const READS = { ...MCP_READS, "ops-knowledge": [...MCP_READS["ops-knowledge"], "knowledge_bootstrap", "knowledge_list", "box_projects", "worktree_fleet_status"], discord: ["discord_channels", "discord_read"], community: [...MCP_READS.community, "community_ask"] };
const object = properties => ({ type: "object", properties, additionalProperties: false });
const string = { type: "string" };
const TOOLS = [
  { name: "vps_status", description: "Inspect the actual connected Keir VPS, available read services and project roots. Remote paths belong to the VPS, not your PC.", inputSchema: object({}) },
  { name: "vps_tools", description: "Read schemas for permitted tools on one VPS MCP. Discover before calling. Production writes are not exposed; task coordination is available separately.", inputSchema: { ...object({ server: string }), required: ["server"] } },
  { name: "vps_read", description: "Call a permitted read tool on the VPS using its server-side credentials. Use ops-knowledge knowledge_bootstrap, knowledge_query/get for shared skills and runbooks, box_projects for paths, and worktree_fleet_status for other agents. For the AHD Discord, read discord_channels and discord_read on the discord server, and use community_search or community_ask for what players discussed. Never interpret returned remote paths as local paths.", inputSchema: { ...object({ server: string, tool: string, args: { type: "object" } }), required: ["server", "tool"] } },
  { name: "vps_coordinate", description: "Update shared work tracking through kanban_add, kanban_update or work_report on the VPS. This does not authorize production changes, send messages or establish completion. Read vps_tools for schemas.", inputSchema: { ...object({ tool: string, args: { type: "object" } }), required: ["tool", "args"] } },
  { name: "vps_environment", description: "Inspect a registered VPS project's .env file. Returns keys, commented/configured state and redacted values. Use the VPS service tools rather than copying production secrets into a local checkout.", inputSchema: { ...object({ project: string, file: { type: "string", default: ".env.local" } }), required: ["project"] } },
  { name: "vps_agents", description: "List coding agents on the VPS (Paseo) as structured rows: id, title, provider, model, status, whether they need the owner, cwd and last update. Filter by status, needsAttention and recency.", inputSchema: object({ statuses: { type: "array", items: { type: "string", enum: ["initializing", "idle", "running", "error", "closed"] } }, needsAttention: { type: "boolean" }, sinceHours: { type: "integer", minimum: 1, maximum: 720 }, limit: { type: "integer", minimum: 1, maximum: 100 } }) },
  { name: "vps_message", description: "Send a message to one VPS coding agent (Paseo) on the owner's behalf. The agent sees it came from the owner's terminal and runs it in the background. Coordination only: it does not approve production changes. Confirm the agent id with vps_agents first.", inputSchema: { ...object({ agentId: string, message: string }), required: ["agentId", "message"] } },
  { name: "vps_discord_send", description: "Post a message to one channel in the AHD Discord on the owner's behalf. Players read what is posted, so confirm the channel and the exact text with the owner before calling. Read first with vps_read on the discord server (discord_channels, discord_read).", inputSchema: { ...object({ channel: string, content: { type: "string", maxLength: 1900 } }), required: ["channel", "content"] } },
  { name: "vps_sentry", description: "Read Sentry-compatible issues from the VPS using its configured API credentials. Does not require local Sentry environment variables and cannot resolve or mutate issues.", inputSchema: object({ id: string, query: string, period: string, limit: { type: "integer", minimum: 1, maximum: 25 } }) },
];
// Paseo answers list_agents with a short header and then JSON, which arrives
// here as { text }. Return rows an agent can filter and sort.
function agentRows(value) {
  let data = value;
  if (typeof value?.text === "string") { const start = value.text.indexOf("{"); data = start >= 0 ? JSON.parse(value.text.slice(start)) : {}; }
  return (Array.isArray(data?.agents) ? data.agents : []).map(a => ({
    id: a.id, shortId: a.shortId || String(a.id || "").slice(0, 7), title: String(a.title || "").slice(0, 160), provider: a.provider || null, model: a.model || null,
    status: a.status || null, needsAttention: a.requiresAttention === true, attentionReason: a.requiresAttention ? a.attentionReason || null : null,
    cwd: a.cwd || null, createdAt: a.createdAt || null, updatedAt: a.updatedAt || null, archived: Boolean(a.archivedAt),
  })).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function createDesktopGateway({ mcp, projects, env = process.env, fetchImpl = fetch, audit = () => {}, readTools = {}, coordinationTools = ["kanban_add", "kanban_update", "work_report"], agentMessages = env.KEIR_DESKTOP_AGENT_MESSAGES === "1", discordMessages = env.KEIR_DESKTOP_DISCORD_MESSAGES === "1" }) {
  const registry = () => typeof projects === "function" ? projects() : projects || {};
  const coordination = new Set(coordinationTools);
  const reads = { ...READS, ...readTools };
  const allowed = (server, name, write = false) => write ? server === "ops-knowledge" && coordination.has(name) : reads[server]?.includes(name);
  async function call(name, args) {
    const spec = TOOLS.find(tool => tool.name === name);
    if (!spec) throw Error("Unknown desktop tool");
    validateArguments(args, spec.inputSchema);
    audit(name);
    if (name === "vps_status") return { connected: true, services: mcp.servers().filter(server => reads[server]), agents: mcp.servers().includes("paseo"), agentMessages: agentMessages && mcp.servers().includes("paseo"), discord: mcp.servers().includes("discord"), discordMessages: discordMessages && mcp.servers().includes("discord"), projects: registry(), sentryConfigured: Boolean(env.SENTRY_API_TOKEN && env.SENTRY_ORG), environmentValues: "redacted", productionWrites: false, coordination: [...coordination] };
    if (name === "vps_tools") return (await mcp.list(args.server)).filter(tool => allowed(args.server, tool.name) || allowed(args.server, tool.name, true));
    if (name === "vps_read" || name === "vps_coordinate") {
      const coordination = name === "vps_coordinate", server = coordination ? "ops-knowledge" : args.server;
      if (!allowed(server, args.tool, coordination)) throw Error("This desktop capability is not exposed; production actions retain their existing approval path");
      const schema = (await mcp.list(server)).find(tool => tool.name === args.tool)?.inputSchema;
      if (!schema) throw Error("Tool is not available on the VPS");
      validateArguments(args.args || {}, schema);
      return mcp.call(server, args.tool, args.args || {}, coordination);
    }
    if (name === "vps_agents" || name === "vps_message") {
      if (!mcp.servers().includes("paseo")) throw Error("No agent service (Paseo) is configured on this VPS");
      if (name === "vps_agents") {
        const rows = agentRows(await mcp.call("paseo", "list_agents", { ...(args.statuses ? { statuses: args.statuses } : {}), sinceHours: args.sinceHours || 168, limit: 200 }, false));
        const filtered = rows.filter(row => args.needsAttention === undefined || row.needsAttention === args.needsAttention);
        return { count: filtered.length, agents: filtered.slice(0, args.limit || 25) };
      }
      if (!agentMessages) throw Error("Agent messages are not enabled on this VPS (KEIR_DESKTOP_AGENT_MESSAGES=1)");
      const message = String(args.message || "").trim();
      if (!message || message.length > 4000) throw Error("Message must be 1 to 4000 characters");
      if (!/^[A-Za-z0-9-]{6,64}$/.test(args.agentId)) throw Error("Invalid agent id");
      const target = agentRows(await mcp.call("paseo", "list_agents", { sinceHours: 720, limit: 200 }, false)).find(row => row.id === args.agentId || row.shortId === args.agentId);
      if (!target || target.archived) throw Error("No active agent with that id; check vps_agents");
      audit(`vps_message:${target.id}`);
      await mcp.call("paseo", "send_agent_prompt", { agentId: target.id, prompt: `[Message from the owner's Lakeside Code terminal]\n\n${message}`, background: true }, true);
      return { sent: true, agent: { id: target.id, title: target.title, status: target.status } };
    }
    if (name === "vps_discord_send") {
      if (!mcp.servers().includes("discord")) throw Error("No Discord service is configured on this VPS");
      if (!discordMessages) throw Error("Discord posting is not enabled on this VPS (KEIR_DESKTOP_DISCORD_MESSAGES=1)");
      const channel = String(args.channel || "").trim(), content = String(args.content || "").trim();
      if (!channel || channel.length > 100) throw Error("Channel must be a #name or a numeric id");
      if (!content || content.length > 1900) throw Error("Message must be 1 to 1900 characters");
      audit(`vps_discord_send:${channel}`);
      return mcp.call("discord", "discord_send", { channel, content }, true);
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
module.exports = { createDesktopGateway, agentRows };
