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
