"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { executeActivation, validate } = require("../lib/operator/cli-runtime")("runtime");
const { invokeCli } = require("../lib/operator/cli-runner");
const { engineConfig, readTranscript, workerPrompt } = require("../lib/operator/cli-runtime")("opencode");

function fixture(t) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-cli-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  return { version: 1, runner: "claude", model: "fixture-model", brief: "Use only granted tools", prompt: "fixture prompt",
    stateDir, timeoutMs: 5000, maxTurns: 2, url: "http://127.0.0.1:12345/mcp/fixture", tools: [{ name: "finish" }], job: { id: "fixture" }, lane: "worker" };
}
test("real operator-to-CLI subprocess preserves route, prompt, grants and usage", async t => {
  const request = fixture(t), executable = path.join(request.stateDir, "claude-fixture");
  fs.writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs'); let body = '';
process.stdin.on('data', c => body += c);
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  if (args[args.indexOf('--model')+1] !== 'fixture-model' || body !== 'fixture prompt' || !args.includes('--strict-mcp-config')) process.exit(2);
  console.log(JSON.stringify({subtype:'success',result:'fixture complete',usage:{input_tokens:21,output_tokens:3}}));
});\n`, { mode: 0o700 });
  const result = await invokeCli({ ...request, claudeBin: executable, signal: new AbortController().signal });
  assert.equal(result.result, "fixture complete");
  assert.equal(result.usage.input_tokens, 21);
  assert.equal(result.provenance.runtime, "lakeside-code");
  const records = fs.readdirSync(path.join(request.stateDir, "cli-attempts"));
  assert.equal(records.length, 1);
  const record = JSON.parse(fs.readFileSync(path.join(request.stateDir, "cli-attempts", records[0])));
  assert.equal(record.state, "completed");
  assert.equal(record.model, request.model);
  assert.ok(!JSON.stringify(record).includes(request.prompt));
});
test("unknown providers and nonlocal tools fail before starting an attempt", t => {
  const request = fixture(t);
  assert.throws(() => validate({ ...request, runner: "unknown" }), /route/);
  assert.throws(() => validate({ ...request, url: "https://example.com/mcp" }), /loopback/);
  assert.throws(() => validate({ ...request, maxTurns: 0 }), /turn limit/);
  assert.equal(fs.existsSync(path.join(request.stateDir, "cli-attempts")), false);
  assert.throws(() => validate({ ...request, toolsMode: "native" }), /registered worktree/);
});
test("provider failure records a failed attempt without trying another route", async t => {
  const request = fixture(t); let launches = 0;
  await assert.rejects(executeActivation(request, { spawnImpl() { launches++; throw new Error("fixture provider unavailable"); } }), /provider unavailable/);
  assert.equal(launches, 1);
  const record = JSON.parse(fs.readFileSync(path.join(request.stateDir, "cli-attempts", fs.readdirSync(path.join(request.stateDir, "cli-attempts"))[0])));
  assert.equal(record.state, "failed");
});
test("already cancelled attempts never launch", async t => {
  const request = fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(executeActivation(request, { signal: controller.signal, spawnImpl() { assert.fail("launched"); } }), /aborted/);
});
test("cancelling the real CLI kills native descendants and records interruption", async t => {
  const request = fixture(t), executable = path.join(request.stateDir, "hanging-provider");
  const pidFile = path.join(request.stateDir, "descendant.pid");
  fs.writeFileSync(executable, `#!/usr/bin/env node
const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {detached:true,stdio:'ignore'});
require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(child.pid));
setInterval(()=>{},1000);\n`, { mode: 0o700 });
  const controller = new AbortController();
  const pending = invokeCli({ ...request, claudeBin: executable, signal: controller.signal });
  // Register the rejection handler before cancelling.
  const rejected = assert.rejects(pending, /activation aborted/);
  const deadline = Date.now() + 3000;
  while (!fs.existsSync(pidFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(fs.existsSync(pidFile));
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  t.after(() => { try { process.kill(pid, "SIGKILL"); } catch {} });
  controller.abort(); await rejected;
  let live = false;
  try { live = !/[ZX]/.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1][0]); } catch {}
  assert.equal(live, false);
  const record = JSON.parse(fs.readFileSync(path.join(request.stateDir, "cli-attempts", fs.readdirSync(path.join(request.stateDir, "cli-attempts"))[0])));
  assert.equal(record.state, "interrupted");
});
test("OpenCode gets the explicit model and only exact broker tool grants", () => {
  const config = engineConfig({ model: "opencode/glm-5.3-flash-free", brief: "fixture", maxTurns: 3,
    url: "http://127.0.0.1:12345/mcp/fixture", tools: [{ name: "finish" }, { name: "shell" }] });
  assert.equal(config.default_agent, "keir");
  assert.equal(config.agents.keir.model, config.model);
  assert.deepEqual(config.permissions, [{ action: "*", resource: "*", effect: "deny" }, { action: "keir_finish", resource: "*", effect: "allow" }, { action: "keir_shell", resource: "*", effect: "allow" }]);
  assert.equal(config.mcp.servers.keir.codemode, false);
  assert.equal(config.agents.keir.steps, 3);
  assert.deepEqual(Object.keys(config.mcp.servers), ["keir"]);
  const native = engineConfig({ model: config.model, brief: "fixture", tools: [], maxTurns: 3, toolsMode: "native", effort: "medium" });
  assert.deepEqual(native.mcp, { servers: {} });
  assert.equal(native.permissions[0].effect, "allow");
  assert.ok(native.permissions.some(p => p.action === "subagent" && p.effect === "deny"));
  assert.equal(native.agents.keir.request.body.reasoningEffort, "medium");
});
test("Ollama delegates its loop to OpenCode while keeping provider, credential and model explicit", async t => {
  const request = { ...fixture(t), runner: "ollama", model: "deepseek-v4.1-flash" };
  let seen;
  const result = await executeActivation(request, { ollamaCredential: () => "fixture-secret", openCodeImpl: async options => {
    seen = options;
    return { subtype: "success", result: "fixture", usage: { input_tokens: 10, output_tokens: 2 } };
  } });
  assert.equal(seen.model, "keir-ollama/deepseek-v4.1-flash");
  assert.equal(seen.providerConfig["keir-ollama"].options.baseURL, "https://ollama.com/v1");
  assert.equal(seen.providerConfig["keir-ollama"].options.apiKey, "{env:OLLAMA_API_KEY}");
  assert.equal(seen.providerEnv.OLLAMA_API_KEY, "fixture-secret");
  assert.equal(result.provenance.engine, "opencode");
  const records = fs.readdirSync(path.join(request.stateDir, "cli-attempts"));
  assert.doesNotMatch(fs.readFileSync(path.join(request.stateDir, "cli-attempts", records[0]), "utf8"), /fixture-secret/);
});
test("headless API provider aliases select the same explicit engine routes as interactive mode", async t => {
  for (const [provider, prefix] of [["codex-api", "openai"], ["claude-api", "anthropic"], ["opencode-go", "opencode-go"]]) {
    const request = { ...fixture(t), runner: undefined, provider, model: "fixture-model" };
    const result = await executeActivation(request, { openCodeImpl: async options => {
      assert.equal(options.model, `${prefix}/fixture-model`);
      return { subtype: "success", result: "fixture", usage: {} };
    } });
    assert.equal(result.provenance.engine, "opencode");
  }
});

test("OpenCode V2 preserves native system prompts and reads real transcript accounting", () => {
  const config = engineConfig({ model: "fixture/model", briefPath: "/private/brief.md", tools: [], maxTurns: 4 });
  assert.deepEqual(config.instructions, ["/private/brief.md"]);
  assert.equal(config.agents.keir.system, undefined);
  const result = readTranscript({ info: { outcome: "succeeded" }, messages: [
    { type: "user", text: "task" },
    { type: "assistant", tokens: { input: 12, output: 4, cache: { read: 3 } }, content: [{ type: "tool" }] },
    { type: "assistant", tokens: { input: 8, output: 2 }, finish: "stop", content: [{ type: "text", text: "verified" }] },
    { type: "idle", outcome: "succeeded" },
  ] });
  assert.equal(result.result, "verified");
  assert.equal(result.num_turns, 2);
  assert.deepEqual(result.usage, { input_tokens: 20, output_tokens: 6, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 });
  assert.throws(() => readTranscript({ info: { outcome: "failed" }, messages: [] }), /ended failed/);
  assert.throws(() => readTranscript({ messages: [{ type: "assistant", finish: "length" }] }), /output limit/);
});

test("broker workers receive explicit workspace and supervisor checkpoint ownership", () => {
  const prompt = workerPrompt({ prompt: "Repair the fixture", tools: [{ name: "shell" }, { name: "finish" }] });
  assert.match(prompt, /empty control repository/);
  assert.match(prompt, /worker must not commit/);
  assert.match(prompt, /call keir_finish/);
  assert.equal(workerPrompt({ prompt: "native task", toolsMode: "native", tools: [] }), "native task");
});

test("native Claude uses explicit coding permissions that work under root", async t => {
  const { EventEmitter } = require("node:events");
  const { invokeNativeTools } = require("../lib/operator/cli-runtime")("native-tools");
  const request = fixture(t); let seen;
  const spawnImpl = (_binary, args) => {
    seen = args;
    const child = new EventEmitter(); child.pid = 999999;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { end() { queueMicrotask(() => { child.stdout.emit("data", JSON.stringify({ subtype: "success", is_error: false })); child.emit("close", 0); }); } };
    return child;
  };
  await invokeNativeTools({ ...request, worktree: request.stateDir, signal: new AbortController().signal, spawnImpl });
  assert.ok(!seen.includes("--dangerously-skip-permissions"));
  assert.equal(seen[seen.indexOf("--permission-mode") + 1], "dontAsk");
  assert.equal(seen[seen.indexOf("--allowedTools") + 1], "Bash,Read,Edit,Write,Glob,Grep");
});
