"use strict";
// Starts the real server.js. node --check cannot catch a top-level require of a
// file that is not in the repository, which left main undeployable unnoticed.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

test("server.js boots from a clean checkout and answers health", { timeout: 60000 }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ops-boot-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    cwd: __dirname,
    env: { PATH: process.env.PATH, HOME: home, PORT: String(port), OPS_PASSIVE: "1",
      OPS_PASSWORD_HASH: "$2b$10$abcdefghijklmnopqrstuuJ8H0aV3o3Qe5xk3wF3m9zD0b1c2d3e4",
      MONGODB_URI: "mongodb://127.0.0.1:1/ops-boot-test", OPS_SESSIONS_FILE: path.join(home, "sessions.json") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { child.kill("SIGKILL"); fs.rmSync(home, { recursive: true, force: true }); });
  let output = "";
  const listening = new Promise((resolve, reject) => {
    const onData = (chunk) => { output += chunk; if (/listening on/.test(output)) resolve(); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("close", (code) => reject(new Error(`server exited ${code}:\n${output.slice(-2000)}`)));
  });
  await listening;
  const status = await new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 10000 }, (res) => { res.resume(); resolve(res.statusCode); })
      .on("error", () => resolve(0));
  });
  assert.ok(status > 0 && status < 500, `health answered ${status}`);
  assert.doesNotMatch(output, /Cannot find module/);
});
