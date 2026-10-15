"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyRecord,
  dashModeFor,
  formatModelLabel,
  permissionLabelFor,
  projectDirFor,
} = require("./claude-session-state");
const { claudeTranscriptFromLog, detailFor } = require("./claude-log-transcript");
const { detectBusy, extractComposerDraft, parseLiveTranscript } = require("./tmux-live-transcript");
const { isOutputBusy } = require("./tmux-sessions");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Real pane shapes, captured from live sessions on the box.
const WORKING_PANE = [
  "  Note the empty state reads \"No agents are running\".",
  "",
  "✻ Channelling… (27s · ↑ 1.4k tokens)",
  "  ⏵  Tip: Dynamic workflows let Claude write a script.",
  "                Still working. Check in from your phone",
  "────────────────────────────────────────────",
  "❯ ",
  "────────────────────────────────────────────",
  "  ⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt…",
].join("\n");

// A finished turn that still has a background shell open. The verb is randomised
// every turn, and past-tense verbs like "Sautéed" mean DONE, not working.
const IDLE_WITH_SHELL_PANE = [
  "  Next is yours to pick: merge 0a into main, or start 0b.",
  "",
  "✻ Sautéed for 3m 21s · 1 shell still running",
  "────────────────────────────────────────────",
  "❯ merge 0a into main",
  "────────────────────────────────────────────",
  "  ⏵⏵ auto mode on · 1 shell · ← for agents · ↓ to manage",
].join("\n");

test("a finished Claude turn is not reported as working", () => {
  // "Sautéed" was in the old busy verb list, and "shell still running" forced
  // busy regardless of provider, so an idle agent showed Working indefinitely.
  assert.equal(isOutputBusy("claude", IDLE_WITH_SHELL_PANE), false);
  assert.equal(detectBusy("claude", IDLE_WITH_SHELL_PANE.split("\n")), false);
});

test("a running Claude turn is still reported as working", () => {
  assert.equal(isOutputBusy("claude", WORKING_PANE), true);
  assert.equal(detectBusy("claude", WORKING_PANE.split("\n")), true);
});

test("a background shell alone does not mean the agent is working", () => {
  const pane = [
    "  All done.",
    "✻ Brewed for 4m 2s",
    "────────────────────────────────────────────",
    "❯ ",
    "────────────────────────────────────────────",
    "  ⏵⏵ auto mode on · 2 shells · ← for agents",
  ].join("\n");
  assert.equal(isOutputBusy("claude", pane), false);
});

test("unsent composer text is a draft, not a sent message", () => {
  const { lines, draft } = extractComposerDraft(IDLE_WITH_SHELL_PANE.split("\n"));
  assert.equal(draft, "merge 0a into main");
  // Only the composer line is cleared. The prose above happens to mention the
  // same words, and that is a real part of the conversation.
  assert.ok(!lines.some((line) => /^\s*❯/.test(line) && /merge 0a/.test(line)));
  assert.ok(lines.some((line) => /Next is yours to pick/.test(line)));
});

test("an empty composer yields no draft", () => {
  const { draft } = extractComposerDraft(WORKING_PANE.split("\n"));
  assert.equal(draft, "");
});

test("Claude status chrome stays out of the conversation", () => {
  const parsed = parseLiveTranscript("claude", IDLE_WITH_SHELL_PANE, {});
  const prose = [...(parsed.turns || []).flatMap((turn) => turn.blocks || []), ...(parsed.blocks || [])]
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  assert.ok(!/mode on/i.test(prose), "mode footer leaked into the transcript");
  assert.ok(!/Sautéed for/i.test(prose), "completion line leaked into the transcript");
  assert.ok(!/Still working\. Check in/i.test(prose));
  assert.ok(!/Tip:/i.test(prose));
  // The draft must not become a user bubble on its own turn.
  assert.ok(!(parsed.turns || []).some((turn) => turn.user === "merge 0a into main"));
});

test("model ids render as readable labels", () => {
  assert.equal(formatModelLabel("claude-opus-5"), "Opus 5");
  assert.equal(formatModelLabel("claude-sonnet-5"), "Sonnet 5");
  assert.equal(formatModelLabel("claude-opus-4-8"), "Opus 4.8");
  assert.equal(formatModelLabel("claude-haiku-4-5-20251001"), "Haiku 4.5");
  assert.equal(formatModelLabel("claude-fable-5"), "Fable 5");
  assert.equal(formatModelLabel(""), null);
});

test("permission modes map onto the dash's controls honestly", () => {
  assert.equal(dashModeFor("auto"), "auto");
  assert.equal(dashModeFor("default"), "ask");
  assert.equal(dashModeFor("plan"), "plan");
  // No dash segment matches acceptEdits, so it must not claim one.
  assert.equal(dashModeFor("acceptEdits"), null);
  assert.equal(permissionLabelFor("acceptEdits"), "Accept edits");
  assert.equal(permissionLabelFor("default"), "Ask");
});

test("project directories follow Claude Code's slug", () => {
  assert.equal(projectDirFor("/root"), "/root/.claude/projects/-root");
  assert.equal(
    projectDirFor("/root/projects/a-house-divided"),
    "/root/.claude/projects/-root-projects-a-house-divided"
  );
});

test("later records win when folding session facts", () => {
  const facts = {
    model: null, permissionMode: null, mode: null, title: null, customTitle: null, tokens: null, updatedAt: null,
  };
  applyRecord(facts, { type: "assistant", message: { model: "claude-sonnet-5" } });
  applyRecord(facts, { type: "permission-mode", permissionMode: "default" });
  applyRecord(facts, { type: "assistant", message: { model: "claude-opus-5" } });
  // A prompt record stamps the mode in force when it was sent.
  applyRecord(facts, { type: "user", permissionMode: "plan", message: { content: "hi" } });
  applyRecord(facts, { type: "ai-title", aiTitle: "Some title" });
  assert.equal(facts.model, "claude-opus-5");
  assert.equal(facts.permissionMode, "plan");
  assert.equal(facts.title, "Some title");
});

test("session-log transcript keeps every turn, with tool cards and results", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-log-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, [
    JSON.stringify({ type: "user", message: { role: "user", content: "first question" } }),
    JSON.stringify({
      type: "assistant",
      message: { model: "claude-opus-5", content: [{ type: "text", text: "STATUS: looking at the tree" }] },
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-5",
        content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "git status" } }],
      },
    }),
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "clean tree" }] },
    }),
    JSON.stringify({
      type: "assistant",
      message: { model: "claude-opus-5", content: [{ type: "text", text: "The tree is clean." }] },
    }),
    JSON.stringify({ type: "user", message: { role: "user", content: "second question" } }),
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-5",
        content: [{ type: "tool_use", id: "t2", name: "mcp__ops-knowledge__knowledge_query", input: { text: "plan" } }],
      },
    }),
    "",
  ].join("\n"));

  const transcript = claudeTranscriptFromLog(file);
  assert.equal(transcript.source, "session-log");
  // The pane could only ever show the last screenful; the log keeps both turns.
  assert.equal(transcript.turns.length, 2);
  assert.equal(transcript.turns[0].user, "first question");
  assert.equal(transcript.turns[1].user, "second question");

  const first = transcript.turns[0].blocks;
  // A STATUS: announcement is intent, not an answer.
  assert.equal(first[0].type, "thinking");
  assert.equal(first[0].text, "looking at the tree");
  const tools = first.find((block) => block.type === "tools");
  assert.equal(tools.items[0].verb, "Shell");
  assert.equal(tools.items[0].detail, "git status");
  assert.equal(tools.items[0].output, "clean tree");
  assert.equal(tools.items[0].running, false, "a tool with a result is finished");
  assert.ok(first.some((block) => block.type === "text" && /tree is clean/.test(block.text)));

  // MCP calls are named by tool, not by their arguments.
  const mcp = transcript.turns[1].blocks.find((block) => block.type === "tools");
  // The shared tool vocabulary normalises Called/Calling to "Tool"; the detail
  // is what identifies the call.
  assert.equal(mcp.items[0].verb, "Tool");
  assert.equal(mcp.items[0].detail, "ops-knowledge · knowledge_query");
  assert.equal(mcp.items[0].running, true, "a tool still awaiting its result is running");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("todo writes become a task panel, not a tool card", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-log-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, [
    JSON.stringify({ type: "user", message: { role: "user", content: "do the thing" } }),
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-5",
        content: [{
          type: "tool_use",
          id: "t1",
          name: "TodoWrite",
          input: { todos: [
            { content: "read the code", status: "completed" },
            { content: "write the fix", status: "in_progress" },
          ] },
        }],
      },
    }),
    "",
  ].join("\n"));
  const transcript = claudeTranscriptFromLog(file);
  const tasks = transcript.turns[0].blocks.find((block) => block.type === "tasks");
  assert.ok(tasks, "expected a tasks block");
  assert.equal(tasks.items.length, 2);
  assert.equal(tasks.items[1].status, "in_progress");
  assert.equal(tasks.items[1].text, "write the fix");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("sidechain records stay out of the main conversation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-log-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, [
    JSON.stringify({ type: "user", message: { role: "user", content: "main question" } }),
    JSON.stringify({ type: "user", isSidechain: true, message: { role: "user", content: "subagent prompt" } }),
    JSON.stringify({
      type: "assistant",
      isSidechain: true,
      message: { model: "claude-opus-5", content: [{ type: "text", text: "subagent answer" }] },
    }),
    JSON.stringify({
      type: "assistant",
      message: { model: "claude-opus-5", content: [{ type: "text", text: "main answer" }] },
    }),
    "",
  ].join("\n"));
  const transcript = claudeTranscriptFromLog(file);
  assert.equal(transcript.turns.length, 1);
  assert.equal(transcript.turns[0].user, "main question");
  const prose = transcript.turns[0].blocks.map((block) => block.text).join(" ");
  assert.ok(/main answer/.test(prose));
  assert.ok(!/subagent/.test(prose));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a question to the operator reads as the question, not as an argument dump", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-log-ask-"));
  const file = path.join(dir, "session.jsonl");
  const questions = [
    {
      header: "Stat floor",
      question: 'For "start from 0 for each" on stats — which do you mean?',
      multiSelect: false,
      options: [{ label: "UI only: nothing pre-assigned" }, { label: "Real 0 floor: change STAT_MIN to 0" }],
    },
    { header: "Derived leans", question: "RU and DD have no derived electorate leans in prod.", options: [] },
  ];
  fs.writeFileSync(file, [
    JSON.stringify({ type: "user", message: { role: "user", content: "redesign the creator" } }),
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-5",
        content: [{ type: "tool_use", id: "q1", name: "AskUserQuestion", input: { questions } }],
      },
    }),
    "",
  ].join("\n"));

  const transcript = claudeTranscriptFromLog(file);
  const card = transcript.turns[0].blocks.find((block) => block.type === "tools").items[0];
  // Regression: none of the argument paths (command/file_path/query/...) match
  // an AskUserQuestion input, so this used to fall through to the generic key
  // dump and render as "questions: [object Object]".
  assert.equal(card.verb, "Asking");
  assert.equal(card.detail, "Stat floor (+1 more)");
  assert.ok(!/\[object Object\]/.test(JSON.stringify(card)), "no argument dump leaks into the card");
  // No tool_result yet: the agent is stopped, waiting on a human.
  assert.equal(card.running, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("a question with no header falls back to the question text", () => {
  assert.equal(
    detailFor("AskUserQuestion", { questions: [{ question: "  Which  branch?  " }] }),
    "Which branch?"
  );
  // A tool that genuinely has no recognised argument still degrades gracefully.
  assert.equal(detailFor("AskUserQuestion", { questions: [] }), "AskUserQuestion");
});

test("an unreadable or empty log falls back rather than throwing", () => {
  assert.equal(claudeTranscriptFromLog("/root/.claude/projects/does-not-exist/none.jsonl"), null);
});
