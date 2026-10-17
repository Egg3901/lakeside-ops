"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const host = require("./host");

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lakeside-host-"));
  const saved = { HOME: process.env.HOME, PATH: process.env.PATH, LAKESIDE_PROVIDER_RUNNER: process.env.LAKESIDE_PROVIDER_RUNNER, LAKESIDE_CLAUDE_BIN: process.env.LAKESIDE_CLAUDE_BIN };
  t.after(() => { for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : process.env[k] = v; fs.rmSync(dir, { recursive: true, force: true }); });
  process.env.HOME = dir; process.env.PATH = "/usr/bin:/bin";
  delete process.env.LAKESIDE_PROVIDER_RUNNER; delete process.env.LAKESIDE_CLAUDE_BIN;
  const tool = (rel) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, "#!/bin/sh\n", { mode: 0o755 }); return f; };
  return { dir, tool };
}

test("paths resolve from HOME, never a fixed account", (t) => {
  const { dir } = sandbox(t);
  assert.equal(host.credential(".codex/auth.json"), path.join(dir, ".codex/auth.json"));
  assert.ok(host.searchPath().startsWith(path.join(dir, ".local/bin")));
  assert.ok(!host.searchPath().includes("/root/"));
});

test("an engine's install location wins over another copy on PATH", (t) => {
  const { tool } = sandbox(t);
  tool(".local/bin/claude");
  const installed = tool(".hermes/node/bin/claude");
  assert.equal(host.bin("claude"), installed);
});

test("explicit overrides win and a missing engine stays a bare name", (t) => {
  sandbox(t);
  assert.equal(host.bin("opencode"), "opencode");
  process.env.LAKESIDE_CLAUDE_BIN = "/opt/claude";
  assert.equal(host.bin("claude"), "/opt/claude");
});

test("the provider launcher is optional", (t) => {
  const { tool } = sandbox(t);
  assert.equal(host.providerRunner(), null);
  const runner = tool("bin/provider-agent-run.sh");
  assert.equal(host.providerRunner(), runner);
});

test("OpenCode uses the launcher when present and runs the engine directly otherwise", (t) => {
  const { dir } = sandbox(t);
  const { launchCommand } = require("./opencode");
  const promptFile = path.join(dir, "prompt.md"); fs.writeFileSync(promptFile, "do the task");
  const base = { binary: "/x/opencode", control: "/c", worktree: "/w", promptFile, model: "ollama/m", log: "/l", session: "ses_1" };
  assert.deepEqual(launchCommand({ ...base, runner: "/r.sh" }), ["/r.sh", ["opencode", "/c", "/w", promptFile, "ollama/m", "/l"]]);
  assert.deepEqual(launchCommand({ ...base, runner: null }), ["/x/opencode", ["run", "--standalone", "-m", "ollama/m", "--session", "ses_1", "do the task"]]);
});
