"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createDesktopGateway } = require("../lib/operator/desktop");
const { createAppServer } = require("../lib/operator/appchannel");
test("desktop MCP uses owner authentication and keeps production writes behind their original path", async t => {
  const calls = [];
  const mcp = { servers: () => ["ops-knowledge", "heal-ops"], list: async () => ["knowledge_get", "work_report", "knowledge_delete", "heal_execute"].map(name => ({ name, inputSchema: { type: "object" } })), call: async (...args) => { calls.push(args); return { actual: true }; } };
  const desktop = createDesktopGateway({ mcp, projects: { Fixture: "/remote/fixture" } });
  const server = createAppServer({ app: {}, artifactsDir: os.tmpdir(), agentRoutes: desktop.route, authenticate: async req => req.headers.cookie === "ops_session=" + "a".repeat(32) ? "owner" : req.headers.cookie === "staff" ? "staff" : false });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/keir/app/desktop/mcp`;
  const rpc = cookie => fetch(url, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "vps_status" } }) });
  assert.equal((await rpc("")).status, 401); assert.equal((await rpc("staff")).status, 403);
  const status = JSON.parse((await (await rpc("ops_session=" + "a".repeat(32))).json()).result.content[0].text);
  assert.equal(status.connected, true); assert.deepEqual(status.projects, { Fixture: "/remote/fixture" });
  await desktop.call("vps_read", { server: "ops-knowledge", tool: "knowledge_get", args: { collection: "skills", name: "workflow" } });
  await desktop.call("vps_coordinate", { tool: "work_report", args: {} });
  assert.deepEqual(calls.map(row => row[3]), [false, true]);
  await assert.rejects(desktop.call("vps_read", { server: "heal-ops", tool: "heal_execute" }), /not exposed/);
  await assert.rejects(desktop.call("vps_coordinate", { tool: "knowledge_delete", args: {} }), /not exposed/);
  const token = await fetch(url.replace("/mcp", "/token"), { headers: { cookie: "ops_session=" + "a".repeat(32) } });
  assert.equal(await token.text(), "a".repeat(32) + "\n"); assert.equal(token.headers.get("cache-control"), "no-store");
});
test("remote env inspection preserves configured/commented state without disclosing values", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keir-desktop-env-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, ".env.local"), '# SENTRY_API_TOKEN=comment-secret\nSENTRY_API_TOKEN=live-secret\nEMPTY=""\n');
  const desktop = createDesktopGateway({ mcp: {}, projects: { Fixture: root } });
  const result = await desktop.call("vps_environment", { project: "Fixture" });
  assert.equal(result.entries[0].commented, true); assert.equal(result.entries[1].configured, true); assert.equal(result.entries[2].configured, false);
  assert.ok(!JSON.stringify(result).includes("live-secret")); assert.ok(!JSON.stringify(result).includes("comment-secret"));
  await assert.rejects(desktop.call("vps_environment", { project: "Fixture", file: "../.env" }));
  await assert.rejects(desktop.call("vps_environment", { project: "Unknown" }));
});
test("Sentry requests use VPS credentials and cannot be redirected to a model-supplied destination", async () => {
  const requests = [];
  const desktop = createDesktopGateway({ mcp: {}, env: { SENTRY_API_TOKEN: "server-only", SENTRY_ORG: "fixture", SENTRY_API_URL: "https://errors.example" }, fetchImpl: async (url, options) => { requests.push({ url: String(url), options }); return { ok: true, json: async () => [{ id: "42", title: "Actual fixture issue" }] }; } });
  assert.equal((await desktop.call("vps_sentry", {}))[0].id, "42");
  assert.equal(requests[0].options.headers.Authorization, "Bearer server-only");
  assert.equal(new URL(requests[0].url).hostname, "errors.example");
  await assert.rejects(desktop.call("vps_sentry", { id: "../../other" }), /Invalid/);
});

test("Paseo agents come back structured and messages are opt-in, verified and backgrounded", async () => {
  const listed = { text: "agents_count=2\nagents_ids=a,b\n\n" + JSON.stringify({ agents: [
    { id: "aaaaaaaa-1", shortId: "aaaaaaa", title: "Old", status: "idle", updatedAt: "2026-10-16T00:00:00Z" },
    { id: "bbbbbbbb-2", shortId: "bbbbbbb", title: "Needs you", status: "idle", requiresAttention: true, attentionReason: "finished", updatedAt: "2026-10-17T00:00:00Z" },
  ] }) };
  const calls = [];
  const mcp = { servers: () => ["paseo"], list: async () => [], call: async (...args) => { calls.push(args); return args[1] === "list_agents" ? listed : { ok: true }; } };
  const off = createDesktopGateway({ mcp, projects: {}, env: {} });
  const rows = await off.call("vps_agents", { needsAttention: true });
  assert.equal(rows.count, 1); assert.equal(rows.agents[0].id, "bbbbbbbb-2"); assert.equal(rows.agents[0].attentionReason, "finished");
  assert.equal((await off.call("vps_agents", {})).agents[0].title, "Needs you");
  await assert.rejects(off.call("vps_message", { agentId: "bbbbbbb", message: "hi" }), /not enabled/);
  const on = createDesktopGateway({ mcp, projects: {}, env: { KEIR_DESKTOP_AGENT_MESSAGES: "1" } });
  await assert.rejects(on.call("vps_message", { agentId: "zzzzzzzz", message: "hi" }), /No active agent/);
  const sent = await on.call("vps_message", { agentId: "bbbbbbb", message: "Critique attached" });
  assert.equal(sent.sent, true); assert.equal(sent.agent.id, "bbbbbbbb-2");
  const prompt = calls.find(c => c[1] === "send_agent_prompt");
  assert.deepEqual([prompt[0], prompt[2].agentId, prompt[2].background, prompt[3]], ["paseo", "bbbbbbbb-2", true, true]);
  assert.match(prompt[2].prompt, /^\[Message from the owner's Lakeside Code terminal\]/);
  const status = await on.call("vps_status", {});
  assert.equal(status.agents, true); assert.equal(status.agentMessages, true);
});

test("the desktop token download exchanges the browser session for a 30-day device session", async t => {
  const browser = "b".repeat(32), device = "d".repeat(64), exchanges = [];
  const fetchImpl = async (url, options) => { exchanges.push({ url, options }); return { ok: true, json: async () => ({ token: device, expiresAt: Date.UTC(2026, 10, 16) }) }; };
  const server = createAppServer({ app: {}, artifactsDir: os.tmpdir(), authenticate: async () => "owner", sessionExchangeUrl: "http://dash.local/api/auth/native-session", fetchImpl });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const download = await fetch(`http://127.0.0.1:${server.address().port}/api/keir/app/desktop/token`, { headers: { cookie: `ops_session=${browser}`, host: "ops.example" } });
  assert.equal(download.status, 200);
  assert.equal((await download.text()).trim(), device);
  assert.equal(download.headers.get("x-session-expires"), "2026-11-16T00:00:00.000Z");
  assert.equal(exchanges[0].options.method, "POST");
  assert.equal(exchanges[0].options.headers["x-lakeside-client"], "desktop");
  assert.equal(exchanges[0].options.headers.cookie, `ops_session=${browser}`);
  const fallback = createAppServer({ app: {}, artifactsDir: os.tmpdir(), authenticate: async () => "owner", sessionExchangeUrl: "http://dash.local/x", fetchImpl: async () => ({ ok: false }) });
  await new Promise(resolve => fallback.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => fallback.close(resolve)));
  const old = await fetch(`http://127.0.0.1:${fallback.address().port}/api/keir/app/desktop/token`, { headers: { cookie: `ops_session=${browser}` } });
  assert.equal((await old.text()).trim(), browser);
  assert.equal(old.headers.get("x-session-expires"), "browser-session");
});
