import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectVps } from "./vps-profile.mjs";
import { loadStudio, summarizeTickets, summarizeKanban } from "./integrations/studio.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keir-studio-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { LAKESIDE_CODE_CONFIG_DIR: root }, file = path.join(root, "token"); fs.writeFileSync(file, "b".repeat(64));
  connectVps("https://ops.example", file, env); return env;
}
const reply = (id, result) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "content-type": "application/json" } });
// The gateway returns the remote tool's parsed result as JSON text.
const gatewayText = value => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

test("studio reads open tickets and the kanban brief through vps_read", async (t) => {
  const env = fixture(t), calls = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://ops.example/api/keir/app/desktop/mcp");
    const body = JSON.parse(options.body); calls.push(body.params?.arguments?.tool || body.method);
    if (body.method === "initialize") return reply(body.id, { protocolVersion: "2025-06-18" });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    assert.equal(body.params.name, "vps_read");
    if (body.params.arguments.tool === "support_list") return reply(body.id, gatewayText({ count: 1, items: [{ number: 1599, title: "Loans\nbroken", category: "bug", status: "open" }] }));
    return reply(body.id, gatewayText({ counts: { now: 2, needs_owner: 1 }, now: [{ id: 7, title: "Ship it", assigned_to: "keir" }], needs_owner: [{ id: 9, title: "Pick", needs_owner: true }], next: [], blocked: [] }));
  };
  const studio = await loadStudio(env, { fetchImpl });
  assert.equal(studio.state, "connected");
  assert.deepEqual(calls, ["initialize", "notifications/initialized", "support_list", "kanban_brief"]);
  assert.deepEqual(studio.tickets, [{ number: 1599, title: "Loans broken", category: "bug", status: "open", updatedAt: "" }]);
  assert.equal(studio.kanban.counts.now, 2); assert.equal(studio.kanban.now[0].owner, "keir"); assert.equal(studio.kanban.needsOwner[0].needsOwner, true);
});

test("one failing section does not hide the other, and expiry says what to do", async (t) => {
  const env = fixture(t);
  const partial = await loadStudio(env, { fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.method === "initialize") return reply(body.id, {});
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.params.arguments.tool === "support_list") return reply(body.id, { isError: true, content: [{ type: "text", text: "nope" }] });
    return reply(body.id, gatewayText({ counts: {}, now: [] }));
  } });
  assert.equal(partial.state, "connected"); assert.equal(partial.tickets, null); assert.deepEqual(partial.errors, ["tickets unavailable"]);
  const expired = await loadStudio(env, { fetchImpl: async () => new Response("", { status: 401 }) });
  assert.equal(expired.state, "error"); assert.match(expired.detail, /token file/);
  assert.equal((await loadStudio({ LAKESIDE_CODE_CONFIG_DIR: path.join(os.tmpdir(), "nope-studio") })).state, "unconfigured");
});

test("summaries cap sizes and strip control characters", () => {
  assert.equal(summarizeTickets({ items: Array.from({ length: 12 }, (_, i) => ({ number: i, title: "t" })) }).length, 8);
  assert.deepEqual(summarizeKanban({}).now, []);
});
