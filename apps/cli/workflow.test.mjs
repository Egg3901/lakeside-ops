import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPolicy, configureIntegration, workflowInstructions } from "./workflow/policy.mjs";
import { readCheckpoints, saveCheckpoint } from "./workflow/checkpoints.mjs";
import { addProject, resolveProject } from "./workspace/projects.mjs";
import { addConnection, engineConnections } from "./integrations/mcp.mjs";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lakeside-workflow-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { LAKESIDE_CODE_CONFIG_DIR: path.join(dir, "config"), LAKESIDE_CODE_STATE_DIR: path.join(dir, "state") };
}
test("work integration consent persists independently of credentials and validates policy", t => {
  const env = fixture(t);
  assert.deepEqual(loadPolicy(env).enabled, []);
  configureIntegration("github", true, env);
  configureIntegration("tickets", true, env);
  configureIntegration("github", true, env);
  assert.deepEqual(loadPolicy(env).enabled, ["tickets", "github"]);
  configureIntegration("tickets", false, env);
  assert.deepEqual(loadPolicy(env).enabled, ["github"]);
  assert.throws(() => configureIntegration("unknown", true, env));
  assert.match(workflowInstructions(loadPolicy(env)), /not proof of authentication/);
  fs.writeFileSync(path.join(env.LAKESIDE_CODE_CONFIG_DIR, "workflow.json"), '{"version":2,"enabled":[]}');
  assert.throws(() => loadPolicy(env), /Invalid workflow policy/);
});
test("recovery checkpoints survive model changes, stay session scoped and retain uncertainty", t => {
  const env = fixture(t), input = { task: "Fix #22", state: "uncertain", evidence: ["Test command passed; remote update response lost"], next: "Read the issue before attempting any write" };
  const original = saveCheckpoint("ses_test", input, env);
  saveCheckpoint("ses_test", { ...input, state: "active", next: "Confirmed update; continue validation" }, env);
  assert.equal(readCheckpoints("ses_test", env).length, 2);
  assert.deepEqual(readCheckpoints("ses_test", env).find(row => row.id === original.id), original);
  assert.deepEqual(readCheckpoints("ses_other", env), []);
  assert.throws(() => readCheckpoints("../outside", env));
  assert.throws(() => saveCheckpoint("ses_test", { ...input, state: "invented" }, env));
  assert.throws(() => saveCheckpoint("ses_test", { ...input, state: "completed", evidence: [] }, env), /requires evidence/);
});
test("MCP credentials are references only; absent credentials disable connection", t => {
  const env = fixture(t);
  addConnection({ id: "support", url: "http://127.0.0.1:9735/mcp", tokenEnv: "SUPPORT_TOKEN" }, env);
  assert.equal(engineConnections(env).support.enabled, false);
  const ready = engineConnections({ ...env, SUPPORT_TOKEN: "test-secret-not-persisted" });
  assert.equal(ready.support.enabled, true);
  assert.equal(ready.support.headers.Authorization, "Bearer {env:SUPPORT_TOKEN}");
  assert.ok(!fs.readFileSync(path.join(env.LAKESIDE_CODE_CONFIG_DIR, "mcp.json"), "utf8").includes("test-secret"));
  for (const url of ["http://public.example/mcp", "https://user:secret@example.com/mcp", "https://example.com/mcp?token=secret"]) assert.throws(() => addConnection({ id: "bad", url }, env));
  assert.throws(() => addConnection({ id: "support", url: "https://example.com/mcp" }, env), /already configured/);
});

test("named projects resolve independently of shell directory and reject stale paths", t => {
  const env = fixture(t), directory = env.LAKESIDE_CODE_STATE_DIR;
  fs.mkdirSync(directory);
  addProject("AHDGame", directory, env);
  assert.deepEqual(resolveProject(["AHDGame", "--continue"], env), [directory, "--continue"]);
  assert.deepEqual(resolveProject(["--model", "test/model"], env), ["--model", "test/model"]);
  assert.throws(() => addProject("run", directory, env));
  assert.throws(() => addProject("AHDGame", directory, env));
  fs.rmdirSync(directory);
  assert.throws(() => resolveProject(["AHDGame"], env), /unavailable/);
});
