// Ops Discord MCP — self-hosted MCP over the AHD community Discord, using the
// bot token server-side (the agent never sees it). Lets agents read channels,
// post messages, and list channels. Channels are discovered dynamically from
// the guild (no hardcoded IDs). Same pattern as the ops-knowledge MCP:
// Streamable HTTP + scoped bearer-token auth (agent-tokens).
//
// Token + port come from mcp-discord.env (0600, gitignored). Run via the
// ahd-discord-mcp systemd service.  node mcp/discord-server.js  (default :9727)

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
require("dotenv").config({ path: require("path").join(__dirname, "..", "mcp-discord.env") });
const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { createServer } = require("../packages/mcp-server");
const store = require("../knowledge-store"); // getDb (token validation only)
const tokens = require("../agent-tokens");

const PORT = parseInt(process.env.DISCORD_MCP_PORT || "9727", 10);
const BOT = process.env.DISCORD_BOT_TOKEN;
const API = "https://discord.com/api/v10";
if (!BOT) { console.error("ERROR: DISCORD_BOT_TOKEN required (mcp-discord.env)"); process.exit(1); }

async function discord(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { Authorization: "Bot " + BOT, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error("discord " + r.status + " " + (await r.text()).slice(0, 160));
  return r.status === 204 ? null : r.json();
}

// ─── dynamic channel discovery (cached 60s) ─────────────────────────────────
let _guildId = process.env.DISCORD_GUILD_ID || null;
let _chanCache = { at: 0, byName: {}, list: [] };
async function guildId() {
  if (_guildId) return _guildId;
  const g = await discord("/users/@me/guilds");
  _guildId = g && g[0] && g[0].id;
  return _guildId;
}
async function channels() {
  if (Date.now() - _chanCache.at < 60000 && _chanCache.list.length) return _chanCache;
  const chans = (await discord(`/guilds/${await guildId()}/channels`)).filter((c) => c.type === 0 || c.type === 5);
  const byName = {};
  chans.forEach((c) => { byName[c.name.toLowerCase()] = c.id; });
  _chanCache = { at: Date.now(), byName, list: chans.map((c) => ({ name: c.name, id: c.id })) };
  return _chanCache;
}
async function resolveChannel(nameOrId) {
  if (/^\d{5,}$/.test(String(nameOrId))) return String(nameOrId);
  const { byName } = await channels();
  return byName[String(nameOrId).toLowerCase().replace(/^#/, "")] || null;
}

async function main() {
  const db = await store.getDb(process.env.MONGODB_URI);
  await tokens.ensureIndexes(db);
  function buildServer(auth) {
    const server = new McpServer({ name: "ops-discord", version: "1.0.0" });

    server.tool(
      "discord_channels",
      "List text channels in the AHD Discord (name + id) the agent can read. Posting is disabled.",
      {},
      async () => jsonResult((await channels()).list)
    );

    server.tool(
      "discord_read",
      "Read recent messages from a channel (by #name like 'dev-chat'/'tickets' or a raw id). Newest first.",
      { channel: z.string().describe("channel name or numeric id"), limit: z.number().int().min(1).max(50).optional().default(20) },
      async ({ channel, limit }) => {
        const id = await resolveChannel(channel);
        if (!id) return errorResult(`unknown channel "${channel}" — call discord_channels for valid names`);
        const msgs = await discord(`/channels/${id}/messages?limit=${limit}`);
        return jsonResult((msgs || []).map((m) => ({
          author: m.author && (m.author.global_name || m.author.username),
          content: m.content,
          timestamp: m.timestamp,
          attachments: (m.attachments || []).map((a) => a.url),
        })));
      }
    );

    // Posting is disabled for agents. Ticket repair must use
    // support_notify_ops_findings (ops #operations only). Server-side
    // ticket-ship-notify owns all other Discord posts.
    if (auth.scopes && auth.scopes.write) {
      server.tool(
        "discord_send",
        "DISABLED — agents must not post to Discord. For ticket-repair ops updates use support MCP support_notify_ops_findings. Ticket channels and player messages are never agent-writable.",
        { channel: z.string(), content: z.string().max(1900).describe("message text (markdown ok)") },
        async () => errorResult(
          "discord_send is disabled. Do not reply in ticket channels or Discord. "
          + "For pre-PR findings use support_notify_ops_findings; the ops dashboard posts development, production, heal, and resolution milestones. Use support_resolve for a verified terminal ticket receipt."
        )
      );
    }

    return server;
  }

  createServer({
    name: "ops-discord-mcp", port: PORT, bind: process.env.MCP_BIND || "127.0.0.1", jsonLimit: "1mb",
    authorize: req => tokens.validate(db, req.headers.authorization), buildServer,
    onListen: async () => { try { console.log(`[discord-mcp] guild ${await guildId()}, ${(await channels()).list.length} channels`); } catch {} },
  });
}

function jsonResult(o) { return { content: [{ type: "text", text: JSON.stringify(o, null, 2) }] }; }
function errorResult(m) { return { content: [{ type: "text", text: "Error: " + m }], isError: true }; }
function rpcError(code, message) { return { jsonrpc: "2.0", error: { code, message }, id: null }; }

main().catch((e) => { console.error("[discord-mcp] fatal:", e); process.exit(1); });
