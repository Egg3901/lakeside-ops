"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  buildSpawnCommand,
  happyWrapEnabled,
  isOutputBusy,
  spawnEnvExtras,
  spawnOptionsFor,
} = require("./tmux-sessions");

test("HAPPY_WRAP=0 spawns every provider bare", () => {
  const prev = process.env.HAPPY_WRAP;
  process.env.HAPPY_WRAP = "0";
  try {
    assert.match(buildSpawnCommand("claude", "auto"), /claude/);
    assert.doesNotMatch(buildSpawnCommand("claude", "auto"), /happy/);
    assert.match(buildSpawnCommand("kimi", "yolo"), /--yolo/);
    assert.match(buildSpawnCommand("ollama", "auto", "deepseek-v4-flash"), /-m ollama-cloud\/deepseek-v4-flash/);
  } finally {
    if (prev === undefined) delete process.env.HAPPY_WRAP; else process.env.HAPPY_WRAP = prev;
  }
});

test("wrap: false override always spawns bare, whatever the global switch says", () => {
  const cmd = buildSpawnCommand("kimi", "yolo", null, { wrap: false });
  assert.doesNotMatch(cmd, /happy/);
  assert.match(cmd, /--yolo/);
});

// The wrapped shapes only exist where happy is installed and authenticated —
// on a bare CI box these asserts would test a configuration that cannot occur.
test("wrapped commands take the happy shapes", { skip: !happyWrapEnabled() }, () => {
  assert.match(buildSpawnCommand("claude", "auto"), /happy(?:\S*)\s+--permission-mode auto/);
  // ACP subcommands accept no flags — permission/model flags must be absent.
  const kimi = buildSpawnCommand("kimi", "yolo");
  assert.match(kimi, /happy(?:\S*) acp -- \S*kimi acp$/);
  assert.doesNotMatch(kimi, /--yolo/);
  const ollama = buildSpawnCommand("ollama", "auto", "deepseek-v4-flash");
  assert.match(ollama, /happy(?:\S*) acp -- \S*opencode acp$/);
  assert.doesNotMatch(ollama, /-m /);
  // Codex wraps through happy's app-server flavor, with codex's own
  // permission flags forwarded.
  const codex = buildSpawnCommand("codex", "auto");
  assert.match(codex, /happy(?:\S*) codex /);
  assert.match(codex, /--ask-for-approval never/);
  // Cursor has no happy integration and may never take the happy shape.
  assert.doesNotMatch(buildSpawnCommand("cursor", "yolo"), /happy/);
  // wrap:false pins codex bare for restarts of legacy TUI sessions.
  assert.doesNotMatch(buildSpawnCommand("codex", "auto", null, { wrap: false }), /happy/);
});

test("ACP model pinning rides in OPENCODE_CONFIG_CONTENT", { skip: !happyWrapEnabled() }, () => {
  const extras = spawnEnvExtras("ollama", "deepseek-v4-flash");
  assert.deepStrictEqual(JSON.parse(extras.OPENCODE_CONFIG_CONTENT), { model: "ollama-cloud/deepseek-v4-flash" });
  // Kimi's ACP server has no config-content mechanism — nothing to pin.
  assert.deepStrictEqual(spawnEnvExtras("kimi", "k3"), {});
  // Unwrapped providers pass the model as argv, not env.
  assert.deepStrictEqual(spawnEnvExtras("claude", "sonnet"), {});
});

test("ACP pane busyness reads the last Status line", () => {
  const busy = "[04:17] Happy Session ID: abc123\n[04:17] Status: idle\n[04:18] Status: running";
  const idle = "[04:17] Happy Session ID: abc123\n[04:18] Status: running\n[04:19] Status: idle";
  assert.strictEqual(isOutputBusy("ollama", busy), true);
  assert.strictEqual(isOutputBusy("ollama", idle), false);
  assert.strictEqual(isOutputBusy("kimi", busy), true);
  // A TUI kimi pane (no happy banner) keeps the TUI heuristics.
  assert.strictEqual(isOutputBusy("kimi", "some pane\ncontext: 12% (24k/200k)"), false);
});

test("spawn options carry models and efforts for TUI providers now", () => {
  const claude = spawnOptionsFor("claude");
  assert.ok(claude.models.length >= 2, "claude models present");
  assert.ok(claude.efforts.includes("high"), "claude efforts present");
  assert.ok(!claude.models.some((m) => m.id === "opus"), "opus stays denied");
  const codex = spawnOptionsFor("codex");
  assert.ok(codex.models.length >= 3 && codex.efforts.length >= 3);
  const ollama = spawnOptionsFor("ollama");
  assert.ok(ollama.models.some((m) => m.providerModel === "ollama-cloud/deepseek-v4-flash"));
  assert.strictEqual(ollama.defaultModel, "deepseek-v4-flash");
});
