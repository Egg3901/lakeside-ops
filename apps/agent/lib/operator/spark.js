"use strict";
// Short text-only inference helpers use Muse's Meta subscription. Each request
// has an empty workspace and private config, so it cannot inherit host MCPs.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const MODEL = "muse-spark-1.3-contributor";

function makeSpark({ spawnImpl = spawn, museBin = "/root/.local/bin/muse", timeoutMs = 30000 } = {}) {
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
      const ws = path.join(dir, "workspace"), config = path.join(dir, "config"), tmp = path.join(dir, "tmp");
      fs.mkdirSync(ws); fs.mkdirSync(tmp); fs.mkdirSync(path.join(config, "muse"), { recursive: true });
      fs.symlinkSync("/root/.config/muse/auth.json", path.join(config, "muse/auth.json"));
      const promptFile = path.join(dir, "prompt.txt");
      fs.writeFileSync(promptFile, `${system}\n\nAnswer using only the supplied text. Do not use tools.\n\n${prompt}`, { mode: 0o600 });
      const args = ["exec", "--provider", "meta", "--model", MODEL, "--contributor-mode", "on", "--reasoning-effort", "low",
        "--workspace", ws, "--worktree", "off", "--no-session-log", "--no-foreign-personal-context",
        "--disable-shell", "--disable-write", "--disable-web-tools", "--disable-reminders", "--approval-mode", "never",
        "--max-model-steps", "1", "--prompt-file", promptFile];
      child = spawnImpl(museBin, args, { cwd: ws, detached: true, stdio: ["pipe", "pipe", "ignore"],
        env: { HOME: "/root", PATH: "/root/.local/bin:/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8",
          GIT_CEILING_DIRECTORIES: dir, TMPDIR: tmp, XDG_CONFIG_HOME: config, MUSE_AUTH_PATH: "/root/.config/muse/auth.json", MUSE_NO_AUTO_UPDATE: "1" } });
      timer = setTimeout(() => { kill(); finish(); }, timeoutMs);
      child.stdout.on("data", (c) => { out += c; if (out.length > 64000) { kill(); finish(); } });
      child.on("error", () => finish());
      child.on("close", (code) => finish(code === 0 ? out.trim() : ""));
      child.stdin.on?.("error", () => { kill(); finish(); });
      child.stdin.end();
    } catch { if (child) kill(); finish(); }
  });
}

function parseObject(text) {
  try { return JSON.parse(String(text).slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return null; }
}
module.exports = { makeSpark, parseObject, MODEL };
