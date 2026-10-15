#!/usr/bin/env node
"use strict";

// Persistent NDJSON adapter between the ops dashboard Code UI and `codex exec`.
// The browser never receives a raw shell. Codex runs inside the session's
// isolated git worktree and streams structured CLI events back through the
// existing authenticated WebSocket/session pipeline.

const readline = require("readline");
const { spawn } = require("child_process");
const { SHIP_PROTOCOL_INSTRUCTIONS } = require("./code-ship");

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

let config = null;
let threadId = null;
let current = null;
let model = "";
let permissionMode = "auto";
let queue = Promise.resolve();
let shipProtocolInjected = false;

function emit(type, data = {}) {
  process.stdout.write(`${JSON.stringify({ type, ...data })}\n`);
}

function sandboxForMode(mode) {
  return mode === "auto" ? "workspace-write" : "read-only";
}

function toolName(item) {
  if (item.type === "command_execution") return "terminal";
  if (item.type === "file_change") return "patch";
  if (item.type === "mcp_tool_call") return item.tool || item.name || "mcp";
  if (item.type === "web_search") return "web_search";
  return item.type || "tool";
}

function toolArgs(item) {
  if (item.type === "command_execution") return { command: item.command || "" };
  if (item.type === "file_change") return { changes: item.changes || [] };
  if (item.type === "mcp_tool_call") return item.arguments || item.args || {};
  if (item.type === "web_search") return { query: item.query || "" };
  return {};
}

function toolResult(item) {
  if (item.type === "command_execution") {
    return {
      output: item.aggregated_output || "",
      exitCode: item.exit_code,
      status: item.status,
    };
  }
  if (item.type === "file_change") {
    return { changes: item.changes || [], status: item.status || "completed" };
  }
  if (item.type === "mcp_tool_call") {
    return {
      output: item.result || item.output || "",
      error: item.error || null,
      status: item.status,
    };
  }
  return { output: item.output || "", status: item.status || "completed" };
}

function queueAgentText(text, state) {
  if (!text) return;
  state.answerParts.push(text);
  // Codex exposes assistant text only after the item completes. Forward that
  // item in one write; delayed fake chunks made long answers arrive seconds
  // late and forced the browser through hundreds of redundant DOM mutations.
  emit("token", { content: text, runtime: "codex" });
}

function mapEvent(event, state) {
  if (event.type === "thread.started") {
    threadId = event.thread_id || threadId;
    emit("ready", {
      sessionId: threadId,
      // Keep the existing persistence field compatible with old sessions.
      hermesSessionId: threadId,
      runtime: "codex",
    });
    return;
  }
  if (event.type === "turn.started") {
    emit("thinking", { content: "Codex is planning the next step", runtime: "codex" });
    emit("stage", { text: "Planning response…", runtime: "codex" });
    return;
  }
  if (event.type === "item.started" && event.item) {
    const item = event.item;
    if (item.type !== "agent_message") {
      emit("tool_start", {
        id: item.id || `codex_${Date.now()}`,
        tool: toolName(item),
        args: toolArgs(item),
        runtime: "codex",
      });
    }
    return;
  }
  if (event.type === "item.completed" && event.item) {
    const item = event.item;
    if (item.type === "agent_message") {
      if (item.text) {
        queueAgentText(item.text, state);
      }
      return;
    }
    emit("tool_result", {
      id: item.id || `codex_${Date.now()}`,
      tool: toolName(item),
      result: toolResult(item),
      runtime: "codex",
    });
    if (item.type === "file_change") {
      emit("file_changes", { changes: item.changes || [], runtime: "codex" });
    }
    return;
  }
  if (event.type === "turn.failed") {
    emit("error", {
      error: event.error?.message || event.message || "Codex turn failed",
      runtime: "codex",
    });
    return;
  }
  if (event.type === "error") {
    emit("error", {
      error: event.message || event.error || "Codex runtime error",
      runtime: "codex",
    });
  }
}

function runTurn(prompt) {
  return new Promise((resolve) => {
    const args = [
      "exec",
      "--sandbox",
      sandboxForMode(permissionMode),
      "--cd",
      config.workdir
    ];
    // `resume` is an exec subcommand; exec-level sandbox/cwd flags must precede
    // it, while resume's own output/model flags follow the session id.
    if (threadId) args.push("resume", threadId);
    args.push("--json");
    if (model) args.push("--model", model);
    args.push(prompt);

    const state = { answerParts: [] };
    const child = spawn(config.codexBin || "codex", args, {
      cwd: config.workdir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MONGODB_URI: undefined,
        OPS_USERS: undefined,
        LLM_API_KEY: undefined,
      },
    });
    current = child;
    let progressTick = 0;
    const progressTimer = setInterval(() => {
      progressTick += 1;
      emit("stage", {
        text: progressTick % 2 ? "Codex is working…" : "Still working through the request…",
        runtime: "codex",
      });
    }, 5000);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const lines = stdout.split("\n");
      stdout = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          mapEvent(JSON.parse(line), state);
        } catch {
          emit("info", { message: line, runtime: "codex" });
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    child.on("error", (error) => {
      emit("error", { error: `Could not start Codex: ${error.message}`, runtime: "codex" });
    });

    child.on("close", (code, signal) => {
      current = null;
      clearInterval(progressTimer);
      if (stdout.trim()) {
        try {
          mapEvent(JSON.parse(stdout), state);
        } catch {}
      }
      if (signal) {
        emit("cancelled", { runtime: "codex" });
      } else if (code !== 0) {
        const detail = stderr.trim().split("\n").slice(-3).join(" ").slice(-600);
        emit("error", {
          error: `Codex exited with code ${code}${detail ? ` — ${detail}` : ""}`,
          runtime: "codex",
        });
      } else {
        emit("answer", {
          text: state.answerParts.join("\n\n").trim() || "Codex completed the turn.",
          hermesSessionId: threadId,
          runtime: "codex",
        });
        emit("done", { runtime: "codex" });
        resolve();
        return;
      }
      emit("done", { runtime: "codex" });
      resolve();
    });
  });
}

rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    emit("error", { error: "Invalid bridge message", runtime: "codex" });
    return;
  }

  if (message.type === "init") {
    config = message;
    threadId = message.hermesSessionId || null;
    model = message.model || "";
    permissionMode = message.permissionMode || "auto";
    // Resumed threads already had the protocol on first turn; only inject for new threads.
    shipProtocolInjected = Boolean(threadId);
    emit("ready", {
      sessionId: threadId,
      hermesSessionId: threadId,
      runtime: "codex",
    });
    return;
  }
  if (!config) {
    emit("error", { error: "Codex bridge has not been initialized", runtime: "codex" });
    return;
  }
  if (message.type === "message" && typeof message.content === "string") {
    let prompt = message.content.trim();
    if (!shipProtocolInjected && SHIP_PROTOCOL_INSTRUCTIONS) {
      prompt =
        SHIP_PROTOCOL_INSTRUCTIONS +
        "\n\n---\n\n" +
        prompt;
      shipProtocolInjected = true;
    }
    queue = queue.then(() => runTurn(prompt)).catch((error) => {
      emit("error", { error: error.message, runtime: "codex" });
      emit("done", { runtime: "codex" });
    });
    return;
  }
  if (message.type === "cancel") {
    if (current) current.kill("SIGTERM");
    return;
  }
  if (message.type === "set_permissions") {
    permissionMode = message.mode || permissionMode;
    emit("info", {
      message:
        permissionMode === "auto"
          ? "Codex workspace-write mode enabled"
          : "Codex read-only mode enabled",
      runtime: "codex",
    });
    return;
  }
  if (message.type === "switch_model") {
    model = message.model || model;
    emit("model_switched", {
      model,
      provider: "codex",
      runtime: "codex",
    });
  }
});

process.on("SIGTERM", () => {
  if (current) current.kill("SIGTERM");
  process.exit(0);
});
