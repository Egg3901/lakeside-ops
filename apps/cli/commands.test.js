"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("installed-style entry point adds private peers, rejects invalid targets and lists receipts", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lakeside-code-commands-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, LAKESIDE_CODE_CONFIG_DIR: dir, LAKESIDE_CODE_STATE_DIR: path.join(dir, "state") };
  delete env.LAKESIDE_CODE_PEERS;
  const run = args => spawnSync(process.execPath, [path.join(__dirname, "bin/lakeside.cjs"), "code", ...args], { encoding: "utf8", env });
  const saved = run(["peers", "add", "--id", "reviewer", "--kind", "opencode", "--url", "http://127.0.0.1:4096", "--directory", "/worktrees/review", "--token-env", "REVIEW_PASSWORD"]);
  assert.equal(saved.status, 0, saved.stderr);
  const file = path.join(dir, "peers.json"), peers = JSON.parse(fs.readFileSync(file));
  assert.equal(peers[0].tokenEnv, "REVIEW_PASSWORD");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const rejected = run(["peers", "add", "--id", "bad", "--kind", "keir", "--url", "http://remote.example"]);
  assert.equal(rejected.status, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), peers);
  const receipts = run(["handoffs"]);
  assert.equal(receipts.status, 0, receipts.stderr);
  assert.deepEqual(JSON.parse(receipts.stdout), []);
});

test("bare installed lakeside opens the coding engine in the current folder", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lakeside-code-default-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const engine = path.join(dir, "engine"), result = path.join(dir, "launch.json");
  fs.writeFileSync(engine, '#!/usr/bin/env node\nif (process.argv.includes("--version")) console.log("1.19.0"); else require("node:fs").writeFileSync(process.env.TEST_LAUNCH_RESULT, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));\n', { mode: 0o700 });
  const env = { ...process.env, LAKESIDE_OPENCODE_BIN: engine, LAKESIDE_CODE_CONFIG_DIR: path.join(dir, "config"), TEST_LAUNCH_RESULT: result };
  const run = args => spawnSync(process.execPath, [path.join(__dirname, "bin/lakeside.cjs"), ...args], { cwd: dir, encoding: "utf8", env });
  const started = run([]);
  assert.equal(started.status, 0, started.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(result)), { args: [], cwd: dir });
  assert.match(run(["--version"]).stdout, /Lakeside Code 0\.1\.0/);
  assert.match(run(["--help"]).stdout, /skills/);
});
