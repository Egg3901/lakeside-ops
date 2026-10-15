"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  callAskTool, callPublicAskTool, discoverAskTools, discoverPublicAskTools, isReadOnlyName, parseRpcBody, resultToText, summarizeArgs, toolId,
} = require("./ask-mcp");

/** A fetch stand-in that answers JSON-RPC from a per-path script. */
function stubFetch(handlers) {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    // Longest match wins: "/mcp" is a substring of "/gamestate/mcp".
    const key = Object.keys(handlers)
      .sort((a, b) => b.length - a.length)
      .find((k) => String(url).endsWith(k));
    if (!key) return { ok: false, status: 502, headers: { get: () => "application/json" }, text: async () => "{}" };
    return handlers[key](body, options);
  };
}

function jsonReply(result) {
  return {
    ok: true, status: 200,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
  };
}

test("write-scoped tool names are recognised and excluded", () => {
  assert.equal(isReadOnlyName("knowledge_query"), true);
  assert.equal(isReadOnlyName("knowledge_save*"), false);
  assert.equal(isReadOnlyName("support_set_status*"), false);
  assert.equal(isReadOnlyName("support_set_status"), false);
  assert.equal(isReadOnlyName("support_update"), false);
  assert.equal(isReadOnlyName("support_tracker_sync"), false);
  assert.equal(isReadOnlyName("support_tracker_note"), false);
  assert.equal(isReadOnlyName("support_notify_ops_findings"), false);
  assert.equal(isReadOnlyName("discord_send"), false);
  assert.equal(isReadOnlyName("knowledge_feedback"), false);
  assert.equal(isReadOnlyName(undefined), false);
});

test("tool ids stay namespaced and legal for function calling", () => {
  assert.equal(toolId("gamestate", "country_snapshot"), "gamestate__country_snapshot");
  // Function names may not carry punctuation like a dot or a slash.
  assert.equal(toolId("ops-knowledge", "knowledge.query/v2"), "ops-knowledge__knowledge_query_v2");
  assert.match(toolId("ops-knowledge", "knowledge_query"), /^[a-zA-Z0-9_-]+$/);
});

test("both transport reply shapes parse", () => {
  assert.deepEqual(parseRpcBody('{"result":{"ok":true}}', "application/json"), { result: { ok: true } });
  const sse = 'event: message\ndata: {"result":{"ok":true}}\n\n';
  assert.deepEqual(parseRpcBody(sse, "text/event-stream"), { result: { ok: true } });
  assert.equal(parseRpcBody("not json", "application/json"), null);
});

test("results flatten to text and are capped", () => {
  assert.equal(resultToText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }), "a\nb");
  const huge = resultToText({ content: [{ type: "text", text: "x".repeat(40000) }] });
  assert.ok(huge.length < 25000);
  assert.match(huge, /truncated/);
  assert.equal(resultToText(null), "");
});

test("argument summaries stay short and readable", () => {
  assert.equal(summarizeArgs({ country: "US", turn: 412 }), " (country=US, turn=412)");
  assert.equal(summarizeArgs({}), "");
  assert.equal(summarizeArgs(null), "");
  // Empty values are noise in a citation label.
  assert.equal(summarizeArgs({ q: "", country: "US" }), " (country=US)");
});

test("discovery skips write tools and unreachable servers without failing", async (t) => {
  process.env.ASK_MCP_TOKEN = "test-token";
  delete require.cache[require.resolve("./ask-mcp")];
  const mod = require("./ask-mcp");

  const fetchImpl = stubFetch({
    "/mcp": (body) => {
      if (body.method !== "tools/list") return jsonReply({});
      return jsonReply({ tools: [
        { name: "knowledge_query", description: "Search the brain", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
        { name: "knowledge_save*", description: "Write a doc" },
      ] });
    },
    "/gamestate/mcp": () => { throw new Error("ECONNREFUSED"); },
  });

  const { tools, index, skipped } = await mod.discoverAskTools({
    fetchImpl,
    servers: { "ops-knowledge": { kind: "knowledge", label: "ops-knowledge" }, gamestate: { kind: "state", label: "gamestate" } },
  });

  const names = tools.map((tool) => tool.function.name);
  assert.ok(names.includes("ops-knowledge__knowledge_query"));
  // The write tool must never reach the model's tool list.
  assert.ok(!names.some((name) => name.includes("knowledge_save")));
  // A dead server costs depth, never the answer.
  assert.ok(skipped.some((entry) => entry.startsWith("gamestate:")));
  assert.equal(index.get("ops-knowledge__knowledge_query").toolName, "knowledge_query");
  assert.deepEqual(tools[0].function.parameters, { type: "object", properties: { q: { type: "string" } } });

  t.after(() => { delete process.env.ASK_MCP_TOKEN; delete require.cache[require.resolve("./ask-mcp")]; });
});

test("public Ask cannot discover private support, Discord, diagnostic, or trace tools", async (t) => {
  process.env.ASK_MCP_TOKEN = "test-token";
  delete require.cache[require.resolve("./ask-mcp")];
  const mod = require("./ask-mcp");

  const fetchImpl = stubFetch({
    "/gamestate/mcp": () => jsonReply({ tools: [
      { name: "countries" }, { name: "wars" }, { name: "extraction_market" },
      { name: "trace_character" }, { name: "trace_corp" },
    ] }),
    "/engine/mcp": () => jsonReply({ tools: [
      { name: "economy_pulse" }, { name: "engine_health" },
    ] }),
    "/support/mcp": () => jsonReply({ tools: [{ name: "support_get" }] }),
    "/discord/mcp": () => jsonReply({ tools: [{ name: "discord_read" }] }),
  });

  const { tools } = await mod.discoverPublicAskTools({ fetchImpl });
  const names = tools.map((tool) => tool.function.name);
  assert.deepEqual(names.sort(), [
    "engine__economy_pulse", "gamestate__countries", "gamestate__wars",
  ]);

  t.after(() => { delete process.env.ASK_MCP_TOKEN; delete require.cache[require.resolve("./ask-mcp")]; });
});

test("a deep server cannot starve the ones declared after it", async (t) => {
  process.env.ASK_MCP_TOKEN = "test-token";
  delete require.cache[require.resolve("./ask-mcp")];
  const mod = require("./ask-mcp");

  // gamestate is declared before support and lists far more tools than the cap
  // allows. Under first-come admission it took the whole budget and support was
  // silently unreachable, which is the bug this pins.
  const many = (prefix, n) =>
    Array.from({ length: n }, (_, i) => ({ name: `${prefix}_${i}`, description: `${prefix} ${i}` }));

  const fetchImpl = stubFetch({
    "/gamestate/mcp": () => jsonReply({ tools: many("state", 60) }),
    "/support/mcp": () => jsonReply({ tools: many("ticket", 6) }),
  });

  const { tools, skipped } = await mod.discoverAskTools({
    fetchImpl,
    servers: { gamestate: { kind: "state", label: "gamestate" }, support: { kind: "state", label: "support" } },
  });

  const names = tools.map((tool) => tool.function.name);
  // Every support tool fits within a fair share, so all of them survive.
  assert.equal(names.filter((n) => n.startsWith("support__")).length, 6);
  assert.ok(names.includes("support__ticket_0"));
  // The cut lands on the deep server's tail, not on a whole server.
  assert.ok(names.filter((n) => n.startsWith("gamestate__")).length > 0);
  // And it is reported rather than looking like a healthy fleet.
  assert.ok(skipped.some((entry) => entry.includes("tool cap") && entry.includes("gamestate:")));

  t.after(() => { delete process.env.ASK_MCP_TOKEN; delete require.cache[require.resolve("./ask-mcp")]; });
});

test("critical live intelligence tools survive the global tool cap", async (t) => {
  process.env.ASK_MCP_TOKEN = "test-token";
  delete require.cache[require.resolve("./ask-mcp")];
  const mod = require("./ask-mcp");
  const many = Array.from({ length: 55 }, (_, i) => ({ name: `specialized_${i}`, description: `tool ${i}` }));
  const critical = ["game_overview", "countries", "map_snapshot", "fx_quote", "entity_search", "trace_corp", "trace_sector", "extraction_market", "elections"]
    .map((name) => ({ name, description: name }));

  const fetchImpl = stubFetch({
    "/gamestate/mcp": () => jsonReply({ tools: [...many, ...critical] }),
    "/engine/mcp": () => jsonReply({ tools: [...many, { name: "economy_pulse", description: "economy" }] }),
  });
  const { tools } = await mod.discoverAskTools({
    fetchImpl,
    servers: {
      gamestate: { kind: "state", label: "gamestate" },
      engine: { kind: "state", label: "engine" },
    },
  });
  const names = new Set(tools.map((tool) => tool.function.name));

  for (const name of critical.map((tool) => `gamestate__${tool.name}`)) assert.ok(names.has(name), name);
  assert.ok(names.has("engine__economy_pulse"));
  assert.equal(tools.length, mod.MAX_TOOLS);

  t.after(() => { delete process.env.ASK_MCP_TOKEN; delete require.cache[require.resolve("./ask-mcp")]; });
});

test("with no token configured nothing is exposed", async () => {
  delete process.env.ASK_MCP_TOKEN;
  delete process.env.OPS_KNOWLEDGE_MCP_TOKEN;
  delete require.cache[require.resolve("./ask-mcp")];
  const mod = require("./ask-mcp");
  const { tools, skipped } = await mod.discoverAskTools({ fetchImpl: async () => { throw new Error("should not be called"); } });
  assert.deepEqual(tools, []);
  assert.match(skipped[0], /no ASK_MCP_TOKEN/);
  delete require.cache[require.resolve("./ask-mcp")];
});

test("a successful call yields both model text and a citation", async (t) => {
  process.env.ASK_MCP_TOKEN = "test-token";
  delete require.cache[require.resolve("./ask-mcp")];
  const mod = require("./ask-mcp");

  const index = new Map([["gamestate__snapshot", {
    serverKey: "gamestate", path: "/gamestate/mcp", toolName: "snapshot",
    meta: { kind: "state", label: "gamestate" },
  }]]);
  const fetchImpl = stubFetch({ "/gamestate/mcp": () => jsonReply({ content: [{ type: "text", text: "turn 412" }] }) });

  const ok = await mod.callAskTool(index, "gamestate__snapshot", { country: "US" }, { fetchImpl });
  assert.equal(ok.text, "turn 412");
  assert.deepEqual(ok.source, { kind: "state", label: "gamestate: snapshot (country=US)", detail: "turn 412" });

  t.after(() => { delete process.env.ASK_MCP_TOKEN; delete require.cache[require.resolve("./ask-mcp")]; });
});

test("public Ask rejects a tool result that grows private fields", async (t) => {
  process.env.ASK_MCP_TOKEN = "test-token";
  delete require.cache[require.resolve("./ask-mcp")];
  const mod = require("./ask-mcp");
  const index = new Map([["gamestate__countries", {
    serverKey: "gamestate", path: "/gamestate/mcp", toolName: "countries",
    meta: { kind: "state", label: "gamestate" },
  }]]);
  const fetchImpl = stubFetch({
    "/gamestate/mcp": () => jsonReply({
      content: [{ type: "text", text: JSON.stringify({ countries: [], militaryRoster: ["hidden"] }) }],
    }),
  });

  const blocked = await mod.callPublicAskTool(index, "gamestate__countries", {}, { fetchImpl });
  assert.match(blocked.text, /outside the public disclosure contract/i);
  assert.equal(blocked.source, null);

  t.after(() => { delete process.env.ASK_MCP_TOKEN; delete require.cache[require.resolve("./ask-mcp")]; });
});

test("a failed call is reported to the model but never cited", async (t) => {
  process.env.ASK_MCP_TOKEN = "test-token";
  delete require.cache[require.resolve("./ask-mcp")];
  const mod = require("./ask-mcp");

  const index = new Map([["gamestate__snapshot", {
    serverKey: "gamestate", path: "/gamestate/mcp", toolName: "snapshot",
    meta: { kind: "state", label: "gamestate" },
  }]]);
  const fetchImpl = stubFetch({
    "/gamestate/mcp": () => ({
      ok: false, status: 503, headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ error: { message: "database unavailable" } }),
    }),
  });

  const failed = await mod.callAskTool(index, "gamestate__snapshot", {}, { fetchImpl });
  assert.match(failed.text, /database unavailable/);
  // An answer must not claim evidence it never got.
  assert.equal(failed.source, null);

  const unknown = await mod.callAskTool(index, "nope__missing", {}, { fetchImpl });
  assert.match(unknown.text, /unknown tool/);
  assert.equal(unknown.source, null);

  t.after(() => { delete process.env.ASK_MCP_TOKEN; delete require.cache[require.resolve("./ask-mcp")]; });
});
