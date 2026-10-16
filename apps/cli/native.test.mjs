import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createNativeRuntime } from "./native/runtime.mjs";
import { readRun } from "./native/store.mjs";
import { readProjectFile, writeProjectFile } from "./native/filesystem.mjs";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lakeside-native-"));
  const env = { ...process.env, LAKESIDE_CODE_STATE_DIR: path.join(directory, "state"), LAKESIDE_CODE_CONFIG_DIR: path.join(directory, "config"), LAKESIDE_FAKE_LOG: path.join(directory, "requests.log") };
  const backend = { id: "fixture", command: process.execPath, args: [fileURLToPath(new URL("./test-support/native-agent.mjs", import.meta.url))] };
  const runtimes = [];
  t.after(() => { for (const runtime of runtimes) runtime.close(); fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  return { directory, env, backend, runtimes };
}
function open(options, overrides = {}) {
  const runtime = createNativeRuntime({ ...options, ...overrides }, options.env);
  options.runtimes.push(runtime); return runtime;
}
async function until(predicate, milliseconds = 5000) {
  const deadline = Date.now() + milliseconds;
  while (!predicate()) { if (Date.now() >= deadline) throw new Error("Native fixture deadline exceeded"); await new Promise(resolve => setTimeout(resolve, 20)); }
}
test("native process streams tools, asks permission, edits files and deduplicates durable prompt ids", async t => {
  const options = fixture(t), runtime = open(options, { model: "fixture-model" });
  t.after(() => runtime.close());
  await runtime.ready;
  const id = crypto.randomUUID();
  await runtime.submit("edit fixture", id);
  await until(() => runtime.snapshot().permissions.length === 1);
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.state, "permission");
  assert.throws(() => open(options, { runId: snapshot.id }), /already owned/);
  assert.equal(readRun(snapshot.id, options.env).entries[0].id, id);
  assert.ok(!fs.existsSync(path.join(options.directory, "native-result.txt")));
  runtime.permission(snapshot.permissions[0].id, "allow");
  await until(() => runtime.snapshot().state === "completed");
  assert.match(fs.readFileSync(path.join(options.directory, "native-result.txt"), "utf8"), /Native fixture/);
  assert.ok(runtime.snapshot().entries.some(row => row.text === "Native fixture complete"));
  await runtime.submit("edit fixture", id);
  assert.equal(fs.readFileSync(options.env.LAKESIDE_FAKE_LOG, "utf8").split("\n").filter(value => value === "prompt").length, 1);
  await assert.rejects(runtime.submit("different task", id), /different request/);
  runtime.close();
  const resumed = open(options, { runId: snapshot.id });
  t.after(() => resumed.close());
  await resumed.ready;
  assert.equal(resumed.snapshot().id, snapshot.id);
  await resumed.submit("edit fixture", id);
  assert.equal(fs.readFileSync(options.env.LAKESIDE_FAKE_LOG, "utf8").split("\n").filter(value => value === "prompt").length, 1);
});
test("lost native final response stays uncertain and never automatically repeats a prompt", async t => {
  const options = fixture(t), runtime = open(options);
  t.after(() => runtime.close());
  await runtime.ready;
  await runtime.submit("disconnect", crypto.randomUUID());
  await until(() => runtime.snapshot().state === "uncertain");
  assert.match(runtime.snapshot().error, /Inspect actual effects/);
  assert.equal(fs.readFileSync(options.env.LAKESIDE_FAKE_LOG, "utf8").split("\n").filter(value => value === "prompt").length, 1);
});
test("native cancellation waits for the actual final response", async t => {
  const options = fixture(t), runtime = open(options);
  t.after(() => runtime.close());
  await runtime.ready;
  await runtime.submit("wait", crypto.randomUUID());
  await until(() => fs.readFileSync(options.env.LAKESIDE_FAKE_LOG, "utf8").includes("prompt"));
  const result = await runtime.cancel();
  assert.equal(result.confirmed, false);
  await until(() => runtime.snapshot().state === "cancelled");
});
test("ACP filesystem proxy rejects paths and symlinks outside the selected project", async t => {
  const options = fixture(t), project = path.join(options.directory, "project"), outside = path.join(options.directory, "outside.txt");
  fs.mkdirSync(project); fs.writeFileSync(outside, "private");
  const input = { sessionId: "native_fixture", path: outside };
  await assert.rejects(readProjectFile(input, project), /outside/);
  await assert.rejects(writeProjectFile({ ...input, content: "overwrite" }, project), /outside/);
  fs.symlinkSync(outside, path.join(project, "escape.txt"));
  await assert.rejects(readProjectFile({ ...input, path: path.join(project, "escape.txt") }, project), /outside/);
});
