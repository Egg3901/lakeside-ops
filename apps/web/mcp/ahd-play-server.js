// AHD Play MCP — lets an agent PLAY the game as authorized test accounts by
// driving the game's own cookie-authenticated HTTP API (same surface a human
// browser uses). Every action passes real game validation / cost / turn-gating,
// so it cannot cheat. Read-token gated like the rest of the fleet.
//   node mcp/ahd-play-server.js   (default :9742)
require("dotenv").config({ quiet: true, path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { createServer } = require("../packages/mcp-server");
const store = require("../knowledge-store");
const tokens = require("../agent-tokens");

const PORT = parseInt(process.env.AHD_PLAY_MCP_PORT || "9747", 10);
const BASE = process.env.AHD_GAME_BASE || "https://www.ahousedividedgame.com";

// ── credentials: { username -> {email,password} }, aliased by persona ──
const CREDS_FILE = path.join(__dirname, "ahd-play.credentials.json");
const rawCreds = JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));
const ALIAS = { brennan: "dalebrennan", pemberton: "rupertpemberton" };
const ACCOUNTS = {};
for (const a of rawCreds) ACCOUNTS[a.username] = { email: a.email, password: a.password, cookie: null };
function resolve(account) {
  const u = ALIAS[account] || account;
  const acc = ACCOUNTS[u];
  if (!acc) throw new Error(`unknown account '${account}' (have: ${Object.keys(ACCOUNTS).join(", ")} / aliases ${Object.keys(ALIAS).join(", ")})`);
  return { username: u, acc };
}

const COMMON_HEADERS = { "Origin": BASE, "Referer": BASE + "/" };

async function login(acc) {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...COMMON_HEADERS },
    body: JSON.stringify({ email: acc.email, password: acc.password }),
  });
  if (!r.ok) throw new Error(`login failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const jar = (typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [])
    .map((c) => c.split(";")[0]).filter(Boolean);
  if (!jar.length) throw new Error("login returned no Set-Cookie");
  acc.cookie = jar.join("; ");
  return acc.cookie;
}

// authenticated request with one transparent re-login on 401
async function apiCall(account, method, apiPath, body, { multipart } = {}) {
  const { acc } = resolve(account);
  if (!acc.cookie) await login(acc);
  const doFetch = async () => {
    const headers = { ...COMMON_HEADERS, "Cookie": acc.cookie };
    let payload;
    if (multipart) { payload = body; /* FormData */ }
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    return fetch(BASE + apiPath, { method, headers, body: payload });
  };
  let r = await doFetch();
  if (r.status === 401) { await login(acc); r = await doFetch(); }
  const text = await r.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, ok: r.ok, body: parsed };
}

async function main() {
  const db = await store.getDb(process.env.MONGODB_URI);
  await tokens.ensureIndexes(db);

  function buildServer() {
    const server = new McpServer({ name: "ahd-play", version: "1.0.0" });
    const ACCT = z.string().describe("account: 'brennan' (US) or 'pemberton' (UK)");

    server.tool("play_accounts", "List the playable test accounts this MCP controls.", {}, async () =>
      jsonResult(Object.entries(ACCOUNTS).map(([u, a]) => ({ username: u, email: a.email, loggedIn: !!a.cookie }))));

    server.tool("play_whoami", "Get the authenticated user + active character for an account.", { account: ACCT },
      async ({ account }) => jsonResult(await apiCall(account, "GET", "/api/auth/me")));

    server.tool("play_request",
      "Authenticated passthrough to any game API endpoint as the account (auto-login, same-origin). Use for endpoints without a dedicated tool.",
      { account: ACCT, method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), path: z.string().describe("api path starting with /api/"), body: z.any().optional() },
      async ({ account, method, path: p, body }) => {
        if (!p.startsWith("/api/")) throw new Error("path must start with /api/");
        return jsonResult(await apiCall(account, method, p, body));
      });

    server.tool("play_create_character",
      "Create the account's player character. policies.economic/social are -5..5. demographics + stats (28pt RPG) required per game rules.",
      { account: ACCT, name: z.string().min(2).max(50), countryId: z.string().min(2).max(3), homeState: z.string(),
        party: z.string().optional(), policies: z.object({ economic: z.number(), social: z.number(), domainPositions: z.record(z.number()).optional() }),
        demographics: z.any(), stats: z.record(z.number()).optional() },
      async ({ account, ...b }) => jsonResult(await apiCall(account, "POST", "/api/auth/character", b)));

    server.tool("play_set_bio", "Set the character bio (<=500 chars).", { account: ACCT, bio: z.string().max(500) },
      async ({ account, bio }) => jsonResult(await apiCall(account, "PATCH", "/api/profile/bio", { bio })));

    server.tool("play_set_campaign_song", "Set the character campaign song (YouTube URL).",
      { account: ACCT, campaignSongUrl: z.string(), campaignSongAutoplay: z.boolean().optional() },
      async ({ account, ...b }) => jsonResult(await apiCall(account, "PATCH", "/api/settings/campaign-song", b)));

    server.tool("play_found_corporation",
      "Found a corporation. type/secondaryType are sector enums; tickerSymbol is 1-5 uppercase letters.",
      { account: ACCT, name: z.string().min(2).max(60), tickerSymbol: z.string(), type: z.string(),
        secondaryType: z.string().optional(), startingCapital: z.number().int().optional(),
        ipo: z.object({ floatPct: z.number().int(), superShareMultiplier: z.number().int().optional() }).optional() },
      async ({ account, ...b }) => jsonResult(await apiCall(account, "POST", "/api/corporations", b)));

    server.tool("play_enter_election", "Declare candidacy in a government election by election id.",
      { account: ACCT, electionId: z.string() },
      async ({ account, electionId }) => jsonResult(await apiCall(account, "POST", `/api/elections/${electionId}/enter`)));

    server.tool("play_execute_action",
      "Take a per-turn political action. actionType: fundraise|campaign|advertise|buildDonorBase|poll|pollLarge|convertCash|rest|debatePrep.",
      { account: ACCT, actionType: z.string(), count: z.number().int().optional(), targetState: z.string().optional(), convertAmount: z.number().optional() },
      async ({ account, ...b }) => jsonResult(await apiCall(account, "POST", "/api/actions/execute", b)));

    server.tool("play_upload_image",
      "Upload an image (avatar|profile-header|corporation-logo|corporation-header) from a local file path or http(s) URL.",
      { account: ACCT, kind: z.enum(["avatar", "profile-header", "corporation-logo", "corporation-header"]), source: z.string().describe("local path or http(s) URL"), corporationId: z.string().optional() },
      async ({ account, kind, source, corporationId }) => {
        let bytes, filename = "upload";
        if (/^https?:\/\//.test(source)) { const g = await fetch(source); if (!g.ok) throw new Error(`fetch source ${g.status}`); bytes = Buffer.from(await g.arrayBuffer()); filename = source.split("/").pop().split("?")[0] || "upload"; }
        else { bytes = fs.readFileSync(source); filename = path.basename(source); }
        const fd = new FormData();
        fd.append("file", new Blob([bytes]), filename);
        if (corporationId) fd.append("corporationId", corporationId);
        return jsonResult(await apiCall(account, "POST", `/api/upload/${kind}`, fd, { multipart: true }));
      });

    return server;
  }

  createServer({
    name: "ahd-play-mcp", version: "1.0.0", port: PORT, bind: process.env.MCP_BIND || "127.0.0.1",
    authorize: req => tokens.validate(db, req.headers.authorization), buildServer,
    health: () => ({ accounts: Object.keys(ACCOUNTS) }),
  });
}
function jsonResult(o) { return { content: [{ type: "text", text: JSON.stringify(o, null, 2) }] }; }
function rpcErr(code, message) { return { jsonrpc: "2.0", error: { code, message }, id: null }; }
main().catch((e) => { console.error("[ahd-play-mcp] fatal:", e); process.exit(1); });
