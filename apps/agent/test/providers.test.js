"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { invokeAgy, invokeMuse } = require("../lib/operator/providers");

// A fake child process that records what it was launched with.
function fakeSpawn(stdout, onLaunch, code = 0) {
  return (cmd, args, opts) => {
    onLaunch(cmd, args, opts);
    const c = new EventEmitter();
    c.pid = 999999; c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.stdin = { end() {} };
    setImmediate(() => { c.stdout.emit("data", stdout); c.emit("close", code); });
    return c;
  };
}
const base = () => ({ stateDir: fs.mkdtempSync(path.join(os.tmpdir(), "keir-prov-")), model: "m", effort: "medium", brief: "BRIEF", prompt: '{"task":1}',
  tools: [{ name: "finish" }, { name: "read" }], url: "http://127.0.0.1:1/mcp/abc", maxTurns: 6, timeoutMs: 5000, signal: new AbortController().signal });

test("agy runs with only Keir's tools allowed, its shell denied, and a Claude-shaped result", async () => {
  let seen;
  const spawnImpl = fakeSpawn(JSON.stringify({ status: "SUCCESS", response: "done", num_turns: 3, usage: { input_tokens: 10, output_tokens: 2 } }), (cmd, args, opts) => {
    const home = opts.env.HOME;
    seen = { cmd, args, settings: JSON.parse(fs.readFileSync(path.join(home, ".gemini/antigravity-cli/settings.json"), "utf8")),
      mcp: JSON.parse(fs.readFileSync(path.join(home, ".gemini/config/mcp_config.json"), "utf8")), task: fs.readFileSync(path.join(opts.cwd, "task.md"), "utf8") };
  });
  const r = await invokeAgy({ ...base(), spawnImpl });
  assert.equal(seen.cmd, "agy");
  assert.equal(seen.mcp.mcpServers.keir.serverUrl, "http://127.0.0.1:1/mcp/abc");
  assert.ok(seen.settings.permissions.allow.includes("mcp(keir/finish)"));
  assert.ok(seen.settings.permissions.deny.includes("command(*)"));
  assert.match(seen.task, /BRIEF[\s\S]*"task":1/);
  assert.deepEqual([r.result, r.num_turns, r.is_error], ["done", 3, false]);
});

test("muse runs headless with shell, writes and web off and Keir's MCP server pinned", async () => {
  let args;
  const r = await invokeMuse({ ...base(), spawnImpl: fakeSpawn("final answer", (cmd, a) => { args = a; }) });
  for (const flag of ["--disable-shell", "--disable-write", "--disable-web-tools", "--no-session-log"]) assert.ok(args.includes(flag), flag);
  assert.ok(args.some((a) => a.startsWith("mcp_servers.keir=") && a.includes("/mcp/abc")));
  assert.equal(args[args.indexOf("--max-model-steps") + 1], "6");
  assert.deepEqual([r.result, r.is_error], ["final answer", false]);
});

test("a failed muse run surfaces as a model request failure", async () => {
  await assert.rejects(invokeMuse({ ...base(), spawnImpl: fakeSpawn("", () => {}, 2) }), /model request failed: muse exited 2/);
});

test("a muse step-cap stop is a turn limit, not an error", async () => {
  const spawnImpl = (cmd, args, opts) => { const { EventEmitter } = require("node:events"); const c = new EventEmitter(); c.pid = 999998; c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.stdin = { end() {} };
    setImmediate(() => { c.stderr.emit("data", "agent loop failed: model did not reach a terminal state within 6 step(s)"); c.emit("close", 1); }); return c; };
  const r = await invokeMuse({ ...base(), spawnImpl });
  assert.equal(r.subtype, "error_max_turns");
});

test("codex runs with an isolated config: only Keir's MCP, auto-approved, shell and plugins off", async () => {
  let seen;
  const { invokeCodex } = require("../lib/operator/providers");
  const spawnImpl = (cmd, args, opts) => {
    const toml = fs.readFileSync(path.join(opts.env.CODEX_HOME, "config.toml"), "utf8");
    fs.writeFileSync(args[args.indexOf("-o") + 1], "answer");
    seen = { cmd, args, toml, home: opts.env.CODEX_HOME };
    const c = new EventEmitter(); c.pid = 999997; c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.stdin = { end(input) { seen.stdin = input; } };
    setImmediate(() => { c.stderr.emit("data", "tokens used\n12,345\n"); c.emit("close", 0); }); return c;
  };
  const r = await invokeCodex({ ...base(), model: "gpt-6-luna", effort: "max", spawnImpl });
  assert.equal(seen.cmd, "codex");
  assert.match(seen.toml, /model_reasoning_effort = "max"/);
  assert.match(seen.toml, /shell_tool = false/);
  assert.match(seen.toml, /\[mcp_servers\.keir\]\nurl = "http:\/\/127\.0\.0\.1:1\/mcp\/abc"\ndefault_tools_approval_mode = "approve"/);
  assert.match(seen.toml, /required = true/, "Keir cannot run without its broker tools");
  assert.match(seen.toml, /mcp_optional_startup_grace_ms = 0/);
  assert.ok(!/mcp_servers\.(?!keir)/.test(seen.toml), "no other MCP servers");
  assert.ok(seen.args.includes("--ephemeral") && seen.args.includes("read-only"));
  assert.match(seen.stdin, /BRIEF[\s\S]*"task":1/);
  assert.deepEqual([r.result, r.usage.input_tokens], ["answer", 12345]);
});


test("current benchmark follows the actual Codex worker model and fixed medium pin", () => {
  const { currentWorker } = require("../lib/operator/benchmarkProvider");
  assert.deepEqual(currentWorker({ KEIR_WORKER_PROVIDER: "codex:gpt-6.1-sol@medium", KEIR_MODEL: "claude-opus-5-5" }), { runner: "codex", model: "gpt-6.1-sol", effort: "medium" });
  assert.deepEqual(currentWorker({}), { runner: "claude", model: "claude-opus-5-5", effort: null });
});

test("the Rust runner receives the job, lane, tool session and route, and its Claude-shaped result passes through", async () => {
  const { invokeRust } = require("../lib/operator/providers");
  let seen;
  const out = JSON.stringify({ subtype: "success", is_error: false, result: "answered", num_turns: 4, usage: { input_tokens: 5, output_tokens: 1 }, provenance: { runner: "rust", attempt: "k-1", label: "claude-cli-subscription-via-rust", tool_calls: 4 } });
  let briefSeen;
  const r = await invokeRust({ ...base(), spawnImpl: fakeSpawn(out, (cmd, args, opts) => { seen = { cmd, args, opts }; briefSeen = fs.readFileSync(args[args.indexOf("--brief-file") + 1], "utf8"); }), runner: "claude", job: { id: "job1", ticket: 1522 }, lane: "quick", bin: "/usr/local/bin/lakeside" });
  assert.equal(seen.cmd, "/usr/local/bin/lakeside");
  assert.equal(seen.args[0], "activation");
  assert.equal(seen.args[seen.args.indexOf("--task") + 1], "ticket:1522");
  assert.equal(seen.args[seen.args.indexOf("--route") + 1], "claude:m@medium");
  assert.equal(seen.args[seen.args.indexOf("--tools-url") + 1], "http://127.0.0.1:1/mcp/abc");
  assert.equal(briefSeen, "BRIEF");
  assert.equal(fs.existsSync(seen.args[seen.args.indexOf("--brief-file") + 1]), false, "scratch is cleaned up");
  assert.equal(r.subtype, "success"); assert.equal(r.provenance.runner, "rust"); assert.equal(r.num_turns, 4);
  await assert.rejects(invokeRust({ ...base(), spawnImpl: fakeSpawn("not json", () => {}, 1), runner: "claude", job: { id: "j" }, lane: "worker" }), /lakeside/);
});

test("the Rust runner takes listed lanes, probes only when listed, and worker tickets only from the allowlist", () => {
  const { rustLaneAllowed } = require("../lib/operator/agent");
  const cfg = (lanes, tickets = []) => ({ rustRunnerLanes: lanes, rustRunnerTickets: tickets });
  assert.equal(rustLaneAllowed(cfg(["quick"]), { kind: "conversation" }, "quick"), true);
  assert.equal(rustLaneAllowed(cfg(["quick"]), { kind: "ticket", ticket: 1 }, "worker"), false);
  assert.equal(rustLaneAllowed(cfg(["quick"]), { internalProbe: true }, "quick"), false, "probes need their own entry");
  assert.equal(rustLaneAllowed(cfg(["probe"]), { internalProbe: true }, "quick"), true);
  assert.equal(rustLaneAllowed(cfg(["worker"], [1539]), { kind: "ticket", ticket: 1539 }, "worker"), true);
  assert.equal(rustLaneAllowed(cfg(["worker"], [1539]), { kind: "ticket", ticket: 1540 }, "worker"), false);
  assert.equal(rustLaneAllowed(cfg(["worker"], [1539]), { kind: "command" }, "worker"), true, "owner commands without a ticket follow the lane");
  assert.equal(rustLaneAllowed(cfg(["worker"]), { kind: "ticket", ticket: 7 }, "worker"), true, "empty allowlist means every ticket");
});

test("the vision lane routes a screenshot task to Spark standard once, and leaves coders and text tasks alone", () => {
  const { routeForVision } = require("../lib/operator/agent");
  const audits = []; const ledger = { audit: (k, d) => audits.push([k, d]), save() {} };
  const cfg = { visionProvider: "muse:muse-spark-1.3@medium" };
  const job = { id: "j", ticket: 1522, tags: { needsVision: true }, provider: { lane: "worker", runner: "muse", model: "muse-wonder-full-1.0" } };
  assert.equal(routeForVision(job, cfg, ledger, "worker"), true);
  assert.deepEqual([job.provider.runner, job.provider.model, job.provider.effort, job.provider.lane, job.provider.vision], ["muse", "muse-spark-1.3", "medium", "worker", true]);
  assert.equal(job.provider.routedFrom, "muse:muse-wonder-full-1.0");
  assert.equal(routeForVision(job, cfg, ledger, "worker"), false, "the next activation hands it back");
  assert.deepEqual([job.provider.runner, job.provider.model, job.provider.vision], ["muse", "muse-wonder-full-1.0", undefined], "back on its driver");
  assert.equal(audits.length, 2); assert.equal(audits[0][0], "vision_lane_routed"); assert.equal(audits[1][0], "vision_lane_released");
  assert.equal(routeForVision(job, cfg, ledger, "worker"), false, "no new screenshot, no new routing");
  job.requestInbox = [{ attachments: [{ type: "image/png" }] }];
  assert.equal(routeForVision(job, cfg, ledger, "worker"), true, "a new screenshot routes once more");
  const quick = { id: "q", tags: { needsVision: true } };
  routeForVision(quick, cfg, ledger, "quick"); assert.equal(quick.provider.lane, "quick", "lane kept so providerOf does not reassign");
  assert.equal(routeForVision({ id: "t", tags: { needsVision: false } }, cfg, ledger), false);
  assert.equal(routeForVision({ id: "c", codingParent: "p", tags: { needsVision: true } }, cfg, ledger), false);
  const def = { id: "d", tags: { needsVision: true } }; routeForVision(def, {}, ledger); assert.equal(def.provider.model, "muse-spark-1.3", "Spark standard is the default");
});

test("Ollama Cloud runs its own tool loop and hands tool images back as image messages", async () => {
  const { invokeOllama } = require("../lib/operator/providers");
  const chats = [], rpcs = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (url === "http://tools/mcp") {
      rpcs.push(body.method);
      const result = body.method === "tools/list" ? { tools: [{ name: "view_attachment", description: "image", inputSchema: { type: "object", properties: { index: { type: "integer" } } } }] }
        : body.method === "tools/call" ? { content: [{ type: "text", text: "{\"ok\":true}" }, { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }] } : {};
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result }) };
    }
    assert.equal(opts.headers.authorization, "Bearer k");
    chats.push(body);
    const message = chats.length === 1 ? { role: "assistant", content: "", tool_calls: [{ function: { name: "view_attachment", arguments: { index: 0 } } }] } : { role: "assistant", content: "The screenshot shows the fund page." };
    return { ok: true, json: async () => ({ message, prompt_eval_count: 10, eval_count: 5, done: true }) };
  };
  const r = await invokeOllama({ fetchImpl, key: "k", model: "deepseek-v4.1-flash", effort: "medium", brief: "brief", prompt: "{}", url: "http://tools/mcp", maxTurns: 5, timeoutMs: 5000, signal: new AbortController().signal });
  assert.equal(r.subtype, "success"); assert.equal(r.result, "The screenshot shows the fund page."); assert.equal(r.num_turns, 2);
  assert.deepEqual(r.usage, { input_tokens: 20, output_tokens: 10 });
  assert.deepEqual(rpcs, ["initialize", "tools/list", "tools/call"]);
  assert.equal(chats[0].tools[0].function.name, "view_attachment"); assert.equal(chats[0].model, "deepseek-v4.1-flash"); assert.equal(chats[0].think, true);
  const last = chats[1].messages;
  assert.equal(last.at(-2).role, "tool"); assert.deepEqual(last.at(-1).images, ["iVBORw0KGgo="]);
});

test("Ollama Cloud stops at the turn budget and low effort turns thinking off", async () => {
  const { invokeOllama } = require("../lib/operator/providers");
  let think;
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (url === "http://tools/mcp") return { ok: true, json: async () => ({ result: body.method === "tools/list" ? { tools: [] } : { content: [{ type: "text", text: "x" }] } }) };
    think = body.think;
    return { ok: true, json: async () => ({ message: { content: "", tool_calls: [{ function: { name: "shell", arguments: "{}" } }] } }) };
  };
  const r = await invokeOllama({ fetchImpl, key: "k", model: "m", effort: "low", brief: "b", prompt: "{}", url: "http://tools/mcp", maxTurns: 3, timeoutMs: 5000, signal: new AbortController().signal });
  assert.equal(r.subtype, "error_max_turns"); assert.equal(r.num_turns, 3); assert.equal(think, false);
});
test("Ollama stops immediately after an accepted finish and skips later batch tools", async () => {
  const { invokeOllama } = require("../lib/operator/providers");
  let chats = 0; const executed = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (url === "http://tools/mcp") {
      if (body.method === "tools/call") executed.push(body.params.name);
      return { ok: true, json: async () => ({ result: body.method === "tools/list" ? { tools: [] } : { content: [{ type: "text", text: JSON.stringify({ state: "waiting" }) }] } }) };
    }
    chats++; assert.equal(chats, 1, "must not ask the model again after the committed finish");
    assert.doesNotMatch(body.messages[1].content, /no tool call/);
    return { ok: true, json: async () => ({ message: { tool_calls: [{ function: { name: "finish", arguments: { state: "waiting", summary: "Waiting on the actual next turn." } } }, { function: { name: "shell", arguments: {} } }] }, prompt_eval_count: 3, eval_count: 2 }) };
  };
  const r = await invokeOllama({ fetchImpl, key: "k", model: "m", effort: "medium", brief: "b", prompt: "{}", url: "http://tools/mcp", maxTurns: 5, timeoutMs: 5000, signal: new AbortController().signal });
  assert.equal(r.subtype, "success"); assert.equal(r.result, "Waiting on the actual next turn."); assert.equal(chats, 1); assert.deepEqual(executed, ["finish"]);
});
test("a refused finish remains a tool error and does not masquerade as completion", async () => {
  const { invokeOllama } = require("../lib/operator/providers"); let chats = 0;
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (url === "http://tools/mcp") return { ok: true, json: async () => ({ result: body.method === "tools/list" ? { tools: [] } : { isError: true, content: [{ type: "text", text: "Completion refused: missing evidence" }] } }) };
    chats++;
    return { ok: true, json: async () => ({ message: { tool_calls: [{ function: { name: "finish", arguments: { state: "done", summary: "Unsupported claim" } } }] } }) };
  };
  const r = await invokeOllama({ fetchImpl, key: "k", model: "m", brief: "b", prompt: "{}", url: "http://tools/mcp", maxTurns: 2, timeoutMs: 5000, signal: new AbortController().signal });
  assert.equal(r.subtype, "error_max_turns"); assert.equal(chats, 2);
});
