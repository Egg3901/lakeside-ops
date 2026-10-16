"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { redactSecrets } = require("./text");
async function invokeClaude({ spawnImpl, prompt, tools, url, maxTurns, timeoutMs, signal, model, effort, brief, stateDir, claudeBin }) {
  const cwd = path.join(stateDir, "claude-cwd"); fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
    const args = ["-p", "--system-prompt", brief, "--model", model, "--effort", effort,
      "--setting-sources", "", "--tools", "", "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: { keir: { type: "http", url } } }),
      "--allowedTools", tools.map((t) => `mcp__keir__${t.name}`).join(","), "--max-turns", String(maxTurns), "--no-session-persistence", "--output-format", "json"];
    const env = { HOME: "/root", PATH: "/root/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8", DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" };
    return new Promise((resolve, reject) => {
      const child = spawnImpl(claudeBin || "/root/.hermes/node/bin/claude", args, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
      let out = "", err = "", timedOut = false;
      let termination;
      const kill = () => { termination ||= require("./process-tree").terminateTree(child.pid); };
      const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
      signal.addEventListener("abort", kill, { once: true });
      if (signal.aborted) kill();
      child.stdout.on("data", (c) => { out += c; if (out.length > 4e6) kill(); });
      child.stderr.on("data", (c) => { err = (err + c).slice(-4000); });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", async (code) => {
        await termination;
        clearTimeout(timer); signal.removeEventListener("abort", kill);
        if (timedOut) return resolve({ subtype: "error_max_turns", is_error: true, timedOut: true });
        // Killed by a signal (service restart, OOM): resume later, never fail the task.
        if (code === null && !signal.aborted) return resolve({ subtype: "error_max_turns", is_error: true, interrupted: true });
        if (signal.aborted) return reject(new Error("activation aborted"));
        try { resolve(JSON.parse(out.trim().split("\n").at(-1))); }
        catch { reject(new Error(`model request failed: claude exited ${code} ${redactSecrets(err).slice(-600)}`)); }
      });
      child.stdin.end(prompt);
    });
  }

module.exports = { invokeClaude };
