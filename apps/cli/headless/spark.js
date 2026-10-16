"use strict";
// Short text-only inference helpers (classifier fallback, decision TL;DRs,
// knowledge distillation). Keir 5.6 (owner, 2026-10-16): Muse is billed per
// call now, so these run on Codex GPT 6 Luna at low effort on the ChatGPT
// subscription. Each request gets an isolated CODEX_HOME with no MCP servers
// and every tool feature off, an empty workspace and a read-only sandbox.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const MODEL = "gpt-6-luna";
const EFFORT = "low";
const OFF = ["shell_tool", "apps", "plugins", "browser_use", "browser_use_external", "computer_use", "multi_agent", "image_generation", "hooks", "goals",
  "in_app_browser", "memories", "remote_plugin", "skill_search", "sleep_tool"];

function makeSpark({ spawnImpl = spawn, codexBin = "codex", timeoutMs = 30000 } = {}) {
  return (system, prompt) => new Promise((resolve) => {
    let dir, child, timer, out = "", settled = false;
    const finish = (text = "") => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      resolve(text);
    };
    const kill = () => { try { process.kill(-child.pid, "SIGKILL"); } catch {} };
    try {
      dir = fs.mkdtempSync("/var/tmp/keir-spark-");
      const home = path.join(dir, "home"), ws = path.join(dir, "ws"), last = path.join(dir, "last.txt");
      fs.mkdirSync(home); fs.mkdirSync(ws);
      fs.symlinkSync("/root/.codex/auth.json", path.join(home, "auth.json"));
      fs.writeFileSync(path.join(home, "config.toml"), [`model = ${JSON.stringify(MODEL)}`, `model_reasoning_effort = ${JSON.stringify(EFFORT)}`, `web_search = "disabled"`, "",
        "[features]", ...OFF.map((f) => `${f} = false`), ""].join("\n"));
      const args = ["exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-C", ws, "-o", last, "-"];
      child = spawnImpl(codexBin, args, { cwd: ws, detached: true, stdio: ["pipe", "pipe", "ignore"],
        env: { HOME: "/root", CODEX_HOME: home, PATH: "/root/.local/bin:/root/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8", TMPDIR: dir } });
      timer = setTimeout(() => { kill(); finish(); }, timeoutMs);
      child.stdout.on("data", (c) => { out += c; if (out.length > 64000) { kill(); finish(); } });
      child.on("error", () => finish());
      // The -o file holds only the final message; stdout is the fallback.
      child.on("close", (code) => { let text = ""; if (code === 0) { try { text = fs.readFileSync(last, "utf8").trim(); } catch {} text ||= out.trim(); } finish(text.slice(0, 64000)); });
      child.stdin.on?.("error", () => { kill(); finish(); });
      child.stdin.end(`${system}\n\nAnswer using only the supplied text. Do not use tools.\n\n${prompt}`);
    } catch { if (child) kill(); finish(); }
  });
}

function parseObject(text) {
  try { return JSON.parse(String(text).slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return null; }
}
module.exports = { makeSpark, parseObject, MODEL };
