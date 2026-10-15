"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const BRIDGE = path.join(__dirname, "codex-agent-bridge.js");

function waitFor(events, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const match = events.find(predicate);
      if (match) {
        clearInterval(timer);
        resolve(match);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for event: ${JSON.stringify(events)}`));
      }
    }, 10);
  });
}

test("streams structured Codex events and resumes the same thread", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-test-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const fakeCodex = path.join(tempDir, "fake-codex.js");
  fs.writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const resumed = args.includes("resume");
const event = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
event({ type: "thread.started", thread_id: "thread-test-123" });
event({ type: "turn.started" });
event({ type: "item.started", item: { id: "cmd-1", type: "command_execution", command: "/bin/bash -lc pwd", status: "in_progress" } });
event({ type: "item.completed", item: { id: "cmd-1", type: "command_execution", command: "/bin/bash -lc pwd", aggregated_output: "/workspace\\n", exit_code: 0, status: "completed" } });
event({ type: "item.completed", item: { id: "msg-1", type: "agent_message", text: resumed ? "RESUMED" : "STARTED".repeat(1000) } });
event({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
`
  );
  fs.chmodSync(fakeCodex, 0o755);

  const child = spawn(process.execPath, [BRIDGE], {
    cwd: __dirname,
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));

  const events = [];
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) events.push(JSON.parse(line));
    }
  });

  child.stdin.write(
    `${JSON.stringify({
      type: "init",
      workdir: tempDir,
      model: "test-model",
      permissionMode: "safe",
      codexBin: fakeCodex,
    })}\n`
  );
  child.stdin.write(`${JSON.stringify({ type: "message", content: "first" })}\n`);

  await waitFor(events, (event) => event.type === "answer" && event.text === "STARTED".repeat(1000));
  assert.equal(
    events.filter((event) => event.type === "token").length,
    1,
    "a completed Codex answer should cross the bridge in one batch"
  );
  assert.ok(
    events.some(
      (event) =>
        event.type === "tool_start" &&
        event.tool === "terminal" &&
        event.args.command.includes("pwd")
    )
  );
  assert.ok(
    events.some(
      (event) =>
        event.type === "tool_result" &&
        event.result.output === "/workspace\n" &&
        event.result.exitCode === 0
    )
  );

  child.stdin.write(`${JSON.stringify({ type: "message", content: "second" })}\n`);
  const resumed = await waitFor(
    events,
    (event) => event.type === "answer" && event.text === "RESUMED"
  );
  assert.equal(resumed.hermesSessionId, "thread-test-123");
});
