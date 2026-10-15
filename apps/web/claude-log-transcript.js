"use strict";

/**
 * Build a live Claude agent's conversation from the CLI's session log.
 *
 * The tmux pane cannot supply this. Claude Code draws itself in the terminal's
 * alternate screen buffer, which has no scrollback at all — `capture-pane -S -800`
 * returns the ~25 visible rows and nothing more. Every earlier turn is simply
 * gone, and what remains is a repainting frame that has to be reverse-engineered
 * out of wrapped, decorated text.
 *
 * The session log has the whole conversation already separated into user
 * messages, assistant prose, thinking, and tool calls with their results, so
 * this reads it directly and emits the same block shapes the pane parser does.
 *
 * The pane is still the right source for two things it alone knows: whether a
 * turn is running right now, and what is sitting unsent in the composer.
 */

const fs = require("node:fs");
const { pushTasks, pushText, pushTool, toolItem } = require("./tmux-live-transcript");

// Claude's tool names mapped onto the verbs the web view already renders.
const TOOL_VERBS = Object.freeze({
  bash: "Shell",
  bashoutput: "Shell",
  read: "Read",
  edit: "Edit",
  multiedit: "Edit",
  write: "Write",
  notebookedit: "Edit",
  grep: "Grep",
  glob: "List",
  ls: "List",
  task: "Explore",
  agent: "Explore",
  websearch: "Search",
  webfetch: "Search",
  todowrite: "Plan",
  taskcreate: "Plan",
  taskupdate: "Plan",
  killshell: "Shell",
  skill: "Tool",
  // A question to the operator is not a tool action like the rest — it is the
  // agent stopping and waiting for a human. It gets its own verb so the card
  // reads "Asking · Stat floor", matching the desktop UI, instead of being
  // filed under the generic "Tool".
  askuserquestion: "Asking",
});

const MAX_TURNS = 40;
const MAX_OUTPUT_CHARS = 4000;
const MAX_READ_BYTES = 8 * 1024 * 1024;

// The dash asks live agents to announce progress as "STATUS: …" (see
// live-agent-narration.txt). The pane parser renders those as thinking chips
// rather than answer prose, and this keeps the two sources consistent.
const STATUS_LINE_RE = /^(?:STATUS|Progress|Working on)\s*:\s*(.+)$/is;
const MCP_TOOL_RE = /^mcp__([a-z0-9-]+)__(.+)$/i;

function verbFor(name) {
  const raw = String(name || "");
  if (MCP_TOOL_RE.test(raw)) return "Called";
  return TOOL_VERBS[raw.toLowerCase()] || "Tool";
}

/** A short, human argument for a tool card — the command, the path, the query. */
function detailFor(name, input) {
  const data = input && typeof input === "object" ? input : {};
  // An MCP call is identified by which tool it is, not by its arguments —
  // "ops-knowledge · knowledge_query" reads far better than "text: harness plan".
  const mcp = String(name || "").match(MCP_TOOL_RE);
  if (mcp) return `${mcp[1]} · ${mcp[2]}`;
  // AskUserQuestion carries its meaning in the question itself, not in any of
  // the argument paths below — none of them match, so it used to fall through
  // to the generic key dump and render as "questions: [object Object]", losing
  // the one thing a reader needs: what is being asked.
  if (Array.isArray(data.questions)) {
    const primary = data.questions[0];
    const label = String(primary?.header || primary?.question || "").replace(/\s+/g, " ").trim();
    const rest = data.questions.length - 1;
    if (label) return rest > 0 ? `${label} (+${rest} more)` : label;
    // A malformed or empty question set is still a question, not an argument
    // list — never let it fall through to the generic key dump.
    return String(name || "");
  }
  const first = data.command || data.file_path || data.path || data.pattern
    || data.query || data.prompt || data.url || data.notebook_path || "";
  if (first) return String(first).replace(/\s+/g, " ").trim();
  const keys = Object.keys(data);
  if (!keys.length) return String(name || "");
  return `${keys[0]}: ${String(data[keys[0]]).replace(/\s+/g, " ").trim()}`;
}

function todoItemsFrom(input) {
  const todos = input && Array.isArray(input.todos) ? input.todos : null;
  if (!todos) return [];
  return todos.map((todo) => ({
    status: String(todo?.status || "pending"),
    text: String(todo?.content || todo?.activeForm || "").trim(),
  })).filter((item) => item.text);
}

function textOf(part) {
  return String(part?.text || "").replace(/\r/g, "").trim();
}

/** Plain text the operator typed, ignoring tool results and system noise. */
function userTextFrom(message) {
  const content = message?.content;
  if (typeof content === "string") return content.replace(/\r/g, "").trim();
  if (!Array.isArray(content)) return "";
  const parts = content.filter((part) => part?.type === "text").map(textOf).filter(Boolean);
  return parts.join("\n").trim();
}

function toolResultText(part) {
  const content = part?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((entry) => (typeof entry === "string" ? entry : textOf(entry))).filter(Boolean).join("\n");
  }
  return "";
}

function readRecords(logPath) {
  let raw = "";
  try {
    const stat = fs.statSync(logPath);
    const size = Math.min(stat.size, MAX_READ_BYTES);
    const buffer = Buffer.alloc(size);
    const fd = fs.openSync(logPath, "r");
    try {
      fs.readSync(fd, buffer, 0, size, stat.size - size);
    } finally {
      fs.closeSync(fd);
    }
    raw = buffer.toString("utf8");
  } catch {
    return [];
  }
  const records = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== "{") continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch { /* a truncated first line or a record still being written */ }
  }
  return records;
}

/**
 * Turns for one session log, oldest first, capped to the most recent MAX_TURNS.
 * Returns null when the log yields nothing usable so callers can fall back to
 * parsing the pane.
 */
function claudeTranscriptFromLog(logPath) {
  const records = readRecords(logPath);
  if (!records.length) return null;

  const turns = [];
  // Output arrives in a later record than the call, so tool cards are indexed by
  // id and filled in when their result shows up.
  const toolsById = new Map();
  let current = null;

  const openTurn = (user) => {
    current = { user: user || "", blocks: [] };
    turns.push(current);
    return current;
  };

  for (const record of records) {
    if (record?.isSidechain) continue;
    const type = record?.type;

    if (type === "user") {
      const content = record.message?.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type !== "tool_result") continue;
          const card = toolsById.get(part.tool_use_id);
          if (!card) continue;
          card.running = false;
          const output = toolResultText(part).trim();
          if (output) card.output = output.slice(0, MAX_OUTPUT_CHARS);
        }
      }
      const text = userTextFrom(record.message);
      // A local command echo ("<command-name>…") is plumbing, not a message.
      if (text && !/^<(?:command-name|local-command|command-message)/.test(text)) openTurn(text);
      continue;
    }

    if (type !== "assistant") continue;
    if (!current) openTurn("");
    const parts = record.message?.content;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (part?.type === "text") {
        const text = textOf(part);
        if (!text) continue;
        const status = text.match(STATUS_LINE_RE);
        if (status) pushText(current.blocks, "thinking", status[1].trim());
        else pushText(current.blocks, "text", text);
        continue;
      }
      if (part?.type === "thinking") {
        const text = String(part.thinking || "").trim();
        if (text) pushText(current.blocks, "thinking", text);
        continue;
      }
      if (part?.type !== "tool_use") continue;

      const tasks = todoItemsFrom(part.input);
      if (tasks.length) {
        pushTasks(current.blocks, "Tasks", tasks);
        continue;
      }
      const card = toolItem(verbFor(part.name), detailFor(part.name, part.input), { running: true });
      pushTool(current.blocks, card);
      // pushTool folds a repeat of the same call into the previous card, so index
      // whichever card actually ended up last.
      const group = current.blocks[current.blocks.length - 1];
      const stored = group?.type === "tools" ? group.items[group.items.length - 1] : card;
      if (part.id) toolsById.set(part.id, stored);
    }
  }

  const usable = turns.filter((turn) => turn.user || turn.blocks.length);
  if (!usable.length) return null;
  const recent = usable.slice(-MAX_TURNS);
  const last = recent[recent.length - 1];
  return {
    user: last.user,
    blocks: last.blocks,
    turns: recent,
    truncated: usable.length > recent.length,
    source: "session-log",
  };
}

module.exports = { claudeTranscriptFromLog, detailFor, verbFor };
