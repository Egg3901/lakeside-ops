"use strict";
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const runtime = require("./cli-runtime");
const { terminateTree } = require("./process-tree");

async function invokeCli(options) {
  const { spawnImpl, signal, fetchImpl, ...values } = options;
  const request = { ...values, version: 1, attemptId: crypto.randomUUID(), job: { id: values.job.id, ticket: values.job.ticket } };
  // Injected provider transports exercise the same runtime without replacing
  // the subprocess boundary in production.
  if (spawnImpl && spawnImpl !== spawn || fetchImpl) return runtime("runtime").executeActivation(request, { spawnImpl, signal, fetchImpl });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(runtime.root, "bin/activation.cjs")], {
      cwd: values.stateDir, env: { ...require(path.join(runtime.root, "provider-routes")).credentialEnv(), HOME: process.env.HOME, PATH: process.env.PATH, LANG: "C.UTF-8" },
      detached: true, stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "", termination;
    const kill = () => { termination ||= terminateTree(child.pid); };
    const timer = setTimeout(kill, values.timeoutMs + 10000);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", kill); };
    signal.addEventListener("abort", kill, { once: true });
    if (signal.aborted) kill();
    child.stdout.on("data", chunk => { out += chunk; if (out.length > 4000000) kill(); });
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {});
    child.once("error", error => { cleanup(); reject(error); });
    child.once("close", async code => {
      await termination; cleanup();
      if (termination || code === null) {
        const file = path.join(values.stateDir, "cli-attempts", `${request.attemptId}.json`);
        try { const record = JSON.parse(fs.readFileSync(file)); if (record.state === "running") {
          fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...record, state: "interrupted", finishedAt: Date.now() }) + "\n", { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file);
        } } catch { /* the child may have stopped before creating the record */ }
      }
      if (signal.aborted) return reject(new Error("activation aborted"));
      if (code === null) return resolve({ subtype: "error_max_turns", is_error: true, interrupted: true });
      try { const result = JSON.parse(out.trim()); if (typeof result.subtype !== "string") throw new Error(); resolve(result); }
      catch { reject(new Error("Keir CLI returned no valid activation result")); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
module.exports = { invokeCli };
