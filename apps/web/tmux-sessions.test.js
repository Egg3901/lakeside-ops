"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { homeDir } = require("./src/core/paths");
const {
  codexSelectionDelay,
  detectCodexConfig,
  enqueueMessage,
  getLastUserMessage,
  getQueue,
  getUserMessageHistory,
  permissionStateFor,
  rememberUserMessage,
  resetAgentSessionState,
  setPermissionMode,
  tailLines,
} = require("./tmux-sessions");

test("Codex selection waits for the effort picker after choosing a model", () => {
  assert.ok(codexSelectionDelay(["key", "Enter"]) >= 300);
  assert.ok(codexSelectionDelay(["key", "Down"]) < 100);
});

test("Codex config detection uses the newest status line", () => {
  const config = detectCodexConfig([
    "gpt-5.6-luna medium · ~",
    "some output",
    "gpt-5.6-sol high · ~",
  ].join("\n"));
  assert.deepEqual(config, { model: "gpt-5.6-sol", effort: "high" });
});

test("permission modes include Plan for cursor, claude, and kimi", () => {
  const { permissionModesFor } = require("./tmux-sessions");
  assert.ok(permissionModesFor("cursor").some((m) => m.id === "plan"));
  assert.ok(permissionModesFor("claude").some((m) => m.id === "plan"));
  assert.ok(permissionModesFor("kimi").some((m) => m.id === "plan"));
  assert.ok(!permissionModesFor("codex").some((m) => m.id === "plan"));
});

test("Claude Auto uses permission-mode auto (root-safe), not dangerously-skip", () => {
  const { buildSpawnCommand, PERMISSION_MODES } = require("./tmux-sessions");
  const auto = PERMISSION_MODES.claude.find((m) => m.id === "auto");
  assert.ok(auto);
  assert.match(auto.flags, /--permission-mode auto/);
  assert.doesNotMatch(auto.flags, /dangerously-skip-permissions/);
  assert.match(buildSpawnCommand("claude", "auto"), /--permission-mode auto/);
});

test("Ollama and OpenCode spawn commands take a separate model flag", () => {
  const {
    buildSpawnCommand,
    modelsForProvider,
    permissionModesFor,
    spawnOptionsFor,
  } = require("./tmux-sessions");
  assert.ok(modelsForProvider("ollama").length >= 15);
  assert.ok(modelsForProvider("opencode").length >= 20);
  assert.ok(permissionModesFor("ollama").some((m) => m.id === "plan"));
  assert.ok(!permissionModesFor("ollama").some((m) => m.id === "pro"));
  // wrap:false pins the bare TUI shape — the happy-wrapped ACP shape (no -m,
  // model rides in OPENCODE_CONFIG_CONTENT) is covered in happy-spawn.test.js.
  assert.match(buildSpawnCommand("ollama", "auto", "kimi-k2.7-code", { wrap: false }), /-m ollama-cloud\/kimi-k2\.7-code/);
  assert.match(buildSpawnCommand("opencode", "plan", "grok-4.5", { wrap: false }), /-m opencode-go\/grok-4\.5/);
  assert.match(buildSpawnCommand("ollama", "auto", "ollama-cloud/minimax-m3", { wrap: false }), /-m ollama-cloud\/minimax-m3/);
  const opts = spawnOptionsFor("ollama");
  assert.equal(opts.defaultModel, "deepseek-v4-flash");
  assert.ok(opts.models.some((m) => m.id === "qwen3.5:397b"));
});

test("agentCliEnv always supplies HOME for Cursor's set -u wrapper", () => {
  const { agentCliEnv } = require("./tmux-sessions");
  const home = homeDir() || os.homedir() || "/root";
  const env = agentCliEnv({ PATH: "/usr/bin" });
  assert.equal(env.HOME, home);
  assert.equal(env.USER, "root");
  assert.match(env.XDG_CACHE_HOME, /\/\.cache$/);
});

test("withAgentHomeEnv prefixes env HOME for tmux panes", () => {
  const { withAgentHomeEnv } = require("./tmux-sessions");
  const home = homeDir() || os.homedir() || "/root";
  const agentBin = path.join(home, ".local", "bin", "agent");
  assert.match(withAgentHomeEnv(agentBin), new RegExp(`^env HOME='${home.replace(/'/g, "'\\\\''")}' USER=root `));
});

test("tailLines returns the last n lines of a captured pane", () => {
  const pane = "line1\nline2\nline3\nline4\n";
  assert.equal(tailLines(pane, 2), "line3\nline4\n");
  assert.equal(tailLines(pane, 10), pane);
  assert.equal(tailLines(pane, 1), "line4\n");
});

test("tailLines handles empty input", () => {
  assert.equal(tailLines("", 5), "");
});

test("withAgentHomeEnv inlines Ollama/OpenCode keys for tmux panes", () => {
  const prev = {
    OLLAMA_API_KEY: process.env.OLLAMA_API_KEY,
    OLLAMA_CLOUD_KEY: process.env.OLLAMA_CLOUD_KEY,
    OPENCODE_GO_API_KEY: process.env.OPENCODE_GO_API_KEY,
  };
  process.env.OLLAMA_API_KEY = "ollama-test-key";
  delete process.env.OLLAMA_CLOUD_KEY;
  process.env.OPENCODE_GO_API_KEY = "go-test-key";
  try {
    const { withAgentHomeEnv } = require("./tmux-sessions");
    const cmd = withAgentHomeEnv("opencode");
    assert.match(cmd, /OLLAMA_API_KEY='ollama-test-key'/);
    assert.match(cmd, /OLLAMA_CLOUD_KEY='ollama-test-key'/);
    assert.match(cmd, /OPENCODE_GO_API_KEY='go-test-key'/);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("live agent titles omit Live prefix and org rename/group persist", () => {
  const {
    parseTmuxSessions,
    createAgentGroup,
    setAgentTitle,
    setAgentGroup,
    enrichLiveSessions,
    deleteAgentGroup,
    listAgentGroups,
  } = require("./tmux-sessions");
  const parsed = parseTmuxSessions("cursorabc\tagent\tModel Bar\t/root\t1\t1700000000");
  assert.equal(parsed[0].title, "Cursor · Model Bar");
  assert.doesNotMatch(parsed[0].title, /^Live /);
  const codex = parseTmuxSessions([
    "gpt\tcodex\t⠴ root\t/root\t0\t1700000000",
    "gpt2\tcodex\t⠏ root\t/root\t0\t1700000000",
  ].join("\n"));
  assert.deepEqual(codex.map((session) => session.title), ["Codex · root", "Codex · root"]);

  const group = createAgentGroup("Ops dash test " + Date.now());
  assert.ok(group.id);
  setAgentTitle(parsed[0].sessionId, "Model Bar Indicator");
  setAgentGroup(parsed[0].sessionId, group.id);
  const enriched = enrichLiveSessions(parsed);
  assert.equal(enriched[0].title, "Model Bar Indicator");
  assert.equal(enriched[0].groupId, group.id);
  assert.equal(enriched[0].groupName, group.name);
  setAgentTitle(parsed[0].sessionId, "");
  setAgentGroup(parsed[0].sessionId, null);
  deleteAgentGroup(group.id);
  assert.ok(!listAgentGroups().some((g) => g.id === group.id));
});


test("isOutputBusy ignores Working lines that have scrolled out of the live tail", () => {
  const { isOutputBusy, forceFlushQueue } = require("./tmux-sessions");
  const idle = [
    "• Working (45s • esc to interrupt)",
    "",
    "› Use /skills to list available skills",
    "",
    "  gpt-5.6-terra medium · ~",
    "",
  ].join("\n");
  assert.equal(isOutputBusy("codex", idle), false);

  const busy = [
    "doing things",
    "• Working (12s • esc to interrupt)",
    "",
  ].join("\n");
  assert.equal(isOutputBusy("codex", busy), true);
  assert.equal(typeof forceFlushQueue, "function");
});

test("agentComposerReady detects Cursor footer before seeding", () => {
  const { agentComposerReady } = require("./tmux-sessions");
  const booting = [
    "Cursor Agent",
    "v2026.07.23-e383d2b",
    "Tip: Use subagents to parallelize work and preserve context.",
    "",
  ].join("\n");
  assert.equal(agentComposerReady("cursor", booting), false);

  const ready = [
    "Cursor Agent",
    "v2026.07.23-e383d2b",
    "",
    "  → Add a follow-up                                             ctrl+c to stop",
    "",
    "  Cursor Grok 4.5 High · 31.1% · 0 files edited                 Run Everything",
  ].join("\n");
  assert.equal(agentComposerReady("cursor", ready), true);

  const busy = [
    "  Exploring the codebase",
    "  ⠋ Thinking",
    "  esc to interrupt",
  ].join("\n");
  assert.equal(agentComposerReady("cursor", busy), false);
});

test("seedAgentPrompt rejects missing session names the way ticket #998 failed", async () => {
  const { seedAgentPrompt } = require("./tmux-sessions");
  // spawnTmuxAgent returns a Promise; without await, callers read `.name` on the
  // Promise itself (undefined) and hit this exact error within ~1s of worktree prep.
  await assert.rejects(() => seedAgentPrompt(undefined, "fix ticket"), /Invalid tmux session/);
  await assert.rejects(() => seedAgentPrompt({ then() {} }, "fix ticket"), /Invalid tmux session/);
});

test("ticket-repair launch awaits async spawn and seed (source lock)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const start = src.indexOf("async function launchAutomatedTicketFix");
  assert.ok(start >= 0, "launchAutomatedTicketFix missing");
  const end = src.indexOf("\nasync function requestAutomatedTicketRecheck", start);
  assert.ok(end > start, "could not bound launchAutomatedTicketFix");
  const body = src.slice(start, end);
  assert.match(body, /tmux = await spawnTmuxAgent\(/);
  assert.match(body, /await seedAgentPrompt\(/);
  assert.doesNotMatch(body, /^\s*const tmux = spawnTmuxAgent\(/m);
  assert.doesNotMatch(body, /^\s*seedAgentPrompt\(/m);
});

test("detectAttention recognizes Claude workspace trust confirm", () => {
  const { detectAttention } = require("./tmux-sessions");
  const pane = [
    "Accessing workspace:",
    "/root",
    "Quick safety check: Is this a project you created or one you trust?",
    "❯ 1. Yes, I trust this folder",
    "  2. No, exit",
    "Enter to confirm · Esc to cancel",
  ].join("\n");
  const attention = detectAttention("claude", pane);
  assert.ok(attention);
  assert.match(attention.excerpt, /trust this folder|Enter to confirm/i);
});

// Shaped from a real blocked pane. A pending question reaches the dashboard from
// nowhere else: the CLI writes its AskUserQuestion record to the session log only
// once the question has been answered.
const QUESTION_PANE = [
  "  1. World-level founding phase",
  "     The founding phase where cycle-0 races seat every nation before the",
  "     real game starts. Code exists but is OFF in prod right now.",
  "  2. Primary window before the general",
  "     The per-election phase between startTurn and primaryEndTurn.",
  "  3. Type something.",
  "────────────────────────────────",
  "  4. Chat about this",
  "Enter to select · ↑/↓ to navigate · Esc to cancel",
  "  5 tasks (1 done, 4 open)",
].join("\n");

test("detectPendingQuestion reads an open question menu out of the pane", () => {
  const { detectPendingQuestion } = require("./tmux-sessions");
  const pending = detectPendingQuestion("claude", QUESTION_PANE);
  assert.ok(pending);
  assert.equal(pending.options.length, 4);
  assert.equal(pending.partial, false);
  assert.equal(pending.options[0].label, "World-level founding phase");
  // The index is the key that answers, so it has to survive intact.
  assert.deepEqual(pending.options.map((o) => o.index), [1, 2, 3, 4]);
  // A separator rule between options must not be read as description text.
  assert.equal(pending.options[3].label, "Chat about this");
  assert.match(pending.options[0].description, /cycle-0 races seat every nation/);
  assert.doesNotMatch(pending.options[1].description, /─/);
});

test("a menu whose first options scrolled off is reported as partial", () => {
  const { detectPendingQuestion } = require("./tmux-sessions");
  // The pane holds only the visible rows, so a long menu loses its top.
  const clipped = QUESTION_PANE.split("\n").slice(3).join("\n");
  const pending = detectPendingQuestion("claude", clipped);
  assert.ok(pending);
  assert.equal(pending.partial, true);
  assert.equal(pending.options[0].index, 2);
});

test("a permission prompt is not mistaken for a question", () => {
  const { detectPendingQuestion } = require("./tmux-sessions");
  const pane = [
    "❯ 1. Yes, I trust this folder",
    "  2. No, exit",
    "Enter to confirm · Esc to cancel",
  ].join("\n");
  assert.equal(detectPendingQuestion("claude", pane), null);
});

test("auto-approve never answers a question on the operator's behalf", () => {
  const { detectPendingQuestion } = require("./tmux-sessions");
  // maybeAutoApproveAttention presses "1" on anything the attention matcher
  // flags. The question menu now trips that matcher, so this guard is the only
  // thing stopping option 1 being recorded as someone's decision.
  assert.ok(detectPendingQuestion("claude", QUESTION_PANE));
});

// ── Claude permission-mode cycling ───────────────────────────────────
// Claude has no slash command for LEAVING plan mode, so mode changes press
// shift+tab and read the footer back. Everything below fixes the shape of
// that read: a misread footer means pressing blind.

const CLAUDE_COMPOSER = [
  "─".repeat(60),
  "❯ ",
  "─".repeat(60),
].join("\n");

test("the pane footer names Claude's live permission mode", () => {
  const { claudeModeFromPane } = require("./tmux-sessions");
  const withFooter = (footer) => `${CLAUDE_COMPOSER}\n  ${footer}`;
  assert.equal(claudeModeFromPane(withFooter("⏸ plan mode on (shift+tab to cycle) · ← for agents")), "plan");
  assert.equal(claudeModeFromPane(withFooter("⏵⏵ auto mode on (shift+tab to cycle) · ← for agents")), "auto");
  assert.equal(claudeModeFromPane(withFooter("⏵⏵ accept edits on (shift+tab to cycle)")), "acceptEdits");
  assert.equal(claudeModeFromPane(withFooter("⏵⏵ bypass permissions on (shift+tab to cycle)")), "bypassPermissions");
  // The "(shift+tab to cycle)" hint drops off once a session has background
  // shells, so the label alone has to carry it.
  assert.equal(claudeModeFromPane(withFooter("⏵⏵ auto mode on · 6 shells · esc to interrupt")), "auto");
});

test("Ask mode is read as the absence of a footer, but only over a drawn composer", () => {
  const { claudeModeFromPane } = require("./tmux-sessions");
  // Default is the one mode that prints no footer at all.
  assert.equal(claudeModeFromPane(`some transcript\n${CLAUDE_COMPOSER}`), "default");
  // A frame that has not finished painting must not be read as any mode.
  assert.equal(claudeModeFromPane(""), null);
  assert.equal(claudeModeFromPane("scrollback with no composer"), null);
  // ❯ also prefixes every echoed user message above, so the marker alone is
  // not the composer — it needs the ─── rules bracketing it.
  assert.equal(claudeModeFromPane("❯ an earlier message\nand its answer"), null);
});

test("an open question menu is never read as Ask mode", () => {
  const { claudeModeFromPane } = require("./tmux-sessions");
  // Reproduces a real blocked pane: no mode footer, and a ❯ on the highlighted
  // option. Reading this as "default" would have made the cycle stop dead,
  // reporting the agent as already in Ask while it sat waiting on a human.
  const menu = [
    "  1. World-level founding phase",
    "❯ 2. Primary window before the general",
    "─".repeat(60),
    "  3. Chat about this",
    "Enter to select · ↑/↓ to navigate · Esc to cancel",
  ].join("\n");
  assert.equal(claudeModeFromPane(menu), null);
});

test("Claude plan mode carries no slash command", () => {
  const { PERMISSION_MODES } = require("./tmux-sessions");
  // `/permission-mode` is a CLI flag, not a command, and `/plan` only ever
  // ENTERS plan mode. Injecting either typed an unknown command into the
  // composer and submitted it.
  for (const mode of PERMISSION_MODES.claude) assert.equal(mode.slash, null);
});

test("a cycle refuses to press blind", async () => {
  const { cycleClaudePermission } = require("./tmux-sessions");
  // No such session, so the capture is empty and the mode unreadable. The
  // cycle must report that rather than start pressing keys.
  const result = await cycleClaudePermission("claude-no-such-session", "auto");
  assert.equal(result.landed, false);
  assert.equal(result.presses, 0);
  assert.ok(["unreadable", "awaiting_answer"].includes(result.reason));
});

test("a cycle to a mode Claude does not have gives up immediately", async () => {
  const { cycleClaudePermission } = require("./tmux-sessions");
  const result = await cycleClaudePermission("claude-no-such-session", "yolo");
  assert.equal(result.landed, false);
  assert.equal(result.reason, "unsupported");
});

// ── Multi-select questions ───────────────────────────────────────────
// Shaped from a live menu at the 120x60 pane size. At 80x24 the question text
// and the tab strip had both scrolled off, which is why the panel could only
// ever show bare numbered options.
const MULTI_SELECT_PANE = [
  "─".repeat(60),
  "←  ☒ Colours  ✔ Submit  →",
  "",
  "Which colours do you want?",
  "",
  "❯ 1. [✔] Red",
  "  A warm, high-attention colour that reads as urgent or alerting.",
  "  2. [ ] Green",
  "  A calm, natural colour that reads as success or growth.",
  "  3. [✔] Blue",
  "  A cool, steady colour that reads as trustworthy or informational.",
  "  4. [ ] Amber",
  "  A golden mid-tone that reads as caution or pending.",
  "  5. [ ] Type something",
  "     Submit",
  "─".repeat(60),
  "  6. Chat about this",
  "",
  "Enter to select · ↑/↓ to navigate · Esc to cancel",
].join("\n");

test("a multi-select menu reports its question, checkboxes, and ticked state", () => {
  const { detectPendingQuestion } = require("./tmux-sessions");
  const pending = detectPendingQuestion("claude", MULTI_SELECT_PANE);
  assert.ok(pending);
  assert.equal(pending.question, "Which colours do you want?");
  assert.equal(pending.header, "Colours");
  assert.equal(pending.multiSelect, true);
  // The checkbox is chrome, not part of the answer's name.
  assert.deepEqual(pending.options.slice(0, 4).map((o) => o.label), ["Red", "Green", "Blue", "Amber"]);
  assert.deepEqual(pending.options.slice(0, 4).map((o) => o.checked), [true, false, true, false]);
  // Descriptions here are indented to the option NUMBER, not the label, so the
  // old four-space continuation rule dropped every one of them.
  assert.match(pending.options[0].description, /high-attention colour/);
  // The escape hatches below the rule carry no checkbox even on this menu, so
  // "every option has a box" is the wrong test for multi-select.
  assert.equal(pending.options[5].label, "Chat about this");
  assert.equal(pending.options[5].checkbox, false);
});

test("a single-select menu is not reported as multi-select", () => {
  const { detectPendingQuestion } = require("./tmux-sessions");
  const pending = detectPendingQuestion("claude", QUESTION_PANE);
  assert.equal(pending.multiSelect, false);
  assert.equal(pending.options[0].checked, false);
});

test("the live menu wins over a repainted frame's leftovers", () => {
  const { detectPendingQuestion } = require("./tmux-sessions");
  // Reading the FIRST "Enter to select" in the capture pinned a dead panel open
  // on a stale menu, and left the queue flusher believing nothing was waiting.
  const stale = [
    "  1. An old question's first answer",
    "  2. An old question's second answer",
    "Enter to select · Esc to cancel",
    "",
    "Which colours do you want?",
    "",
    "  1. [ ] Red",
    "  2. [ ] Green",
    "Enter to select · Esc to cancel",
  ].join("\n");
  const pending = detectPendingQuestion("claude", stale);
  assert.equal(pending.question, "Which colours do you want?");
  assert.deepEqual(pending.options.map((o) => o.label), ["Red", "Green"]);
});

test("answering refuses an option that is not on the menu", async () => {
  const { answerPendingQuestion } = require("./tmux-sessions");
  await assert.rejects(
    () => answerPendingQuestion("claude-no-such-session", [1]),
    /no longer open/i,
  );
  await assert.rejects(
    () => answerPendingQuestion("claude-no-such-session", []),
    /at least one option/i,
  );
});

test("the pane wins over the session log for Claude's live mode", () => {
  const { claudeModeFromPane } = require("./tmux-sessions");
  // permissionStateFor prefers claudeModeFromPane because the log's
  // permission-mode record is written on a state flush and can trail a change by
  // a whole turn — long enough that a change which HAD landed read as the old
  // mode on the next poll and snapped the control back under the reader's finger.
  const pane = [
    "─".repeat(60),
    "❯ ",
    "─".repeat(60),
    "  ⏵⏵ auto mode on (shift+tab to cycle)",
  ].join("\n");
  assert.equal(claudeModeFromPane(pane), "auto");
});
