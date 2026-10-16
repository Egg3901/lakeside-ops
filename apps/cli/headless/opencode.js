"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { spawnBounded } = require("./providers");

function engineConfig({ model, brief, tools, url, maxTurns, providerConfig }) {
  const grant = Object.fromEntries(tools.map(t => [`keir_${t.name}`, "allow"]));
  return {
    model, default_agent: "keir", share: "disabled", autoupdate: false,
    permission: { "*": "deny", ...grant },
    ...(providerConfig ? { provider: providerConfig } : {}),
    mcp: tools.length ? { keir: { type: "remote", url, enabled: true } } : {},
    agent: {
      keir: { description: "Keir scoped headless worker", mode: "primary", model,
        prompt: brief, steps: maxTurns, permission: { "*": "deny", ...grant } },
      title: { disable: true }, summary: { disable: true },
    },
  };
}

// OpenCode owns the model/tool loop. The host launcher still owns admission,
// provider provenance, protected Git metadata and the heavy-check guard.
async function invokeOpenCode(options) {
  const { stateDir, model, prompt, spawnImpl, signal, timeoutMs } = options;
  if (!model.includes("/")) throw new Error("OpenCode requires provider/model; no model substitution is allowed");
  const base = path.join(stateDir, "opencode-runtime");
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const attempt = path.join(base, crypto.randomUUID());
  const control = path.join(attempt, "control");
  fs.mkdirSync(attempt, { mode: 0o700 });
  const git = args => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  // A control repository contains no application source or credentials.
  // Linked worktrees satisfy the host launcher's mandatory registration seam.
  if (!fs.existsSync(path.join(control, ".git"))) {
    fs.mkdirSync(control, { recursive: true });
    git(["init", "-b", "main", control]);
    git(["-C", control, "-c", "user.name=Keir", "-c", "user.email=keir@localhost", "commit", "--allow-empty", "-m", "chore: initialize execution workspace"]);
  }
  const worktree = path.join(control, "worktrees", path.basename(attempt));
  git(["-C", control, "worktree", "add", "--detach", worktree, "HEAD"]);
  const config = engineConfig(options);
  const configDir = path.join(attempt, "config"); fs.mkdirSync(configDir);
  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify(config), { mode: 0o600 });
  const promptFile = path.join(attempt, "prompt.md"), log = path.join(attempt, "provider.log");
  fs.writeFileSync(promptFile, prompt, { mode: 0o600 });
  const env = { ...require("../provider-routes").credentialEnv(), ...options.providerEnv, HOME: process.env.HOME, PATH: process.env.PATH, LANG: "C.UTF-8",
    XDG_CONFIG_HOME: configDir, XDG_DATA_HOME: path.join(attempt, "data"), XDG_CACHE_HOME: path.join(attempt, "cache"),
    OPENCODE_CONFIG_DIR: configDir, OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_PROJECT_CONFIG: "true",
    OPENCODE_DISABLE_AUTOUPDATE: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true" };
  const auth = path.join(process.env.HOME || osHome(), ".local/share/opencode/auth.json");
  if (fs.existsSync(auth)) {
    const data = path.join(env.XDG_DATA_HOME, "opencode"); fs.mkdirSync(data, { recursive: true, mode: 0o700 });
    fs.symlinkSync(auth, path.join(data, "auth.json"));
  }
  try {
    const result = await spawnBounded(spawnImpl, "/root/bin/provider-agent-run.sh",
      ["opencode", control, worktree, promptFile, model, log], { cwd: worktree, env }, timeoutMs, signal);
    if (result.timedOut || result.code === null) return { subtype: "error_max_turns", is_error: true, timedOut: result.timedOut, interrupted: !result.timedOut };
    if (result.code !== 0) throw new Error(`OpenCode launcher exited ${result.code}: ${require("./text").redactSecrets(result.out).slice(-700)}`);
    const binary = "/root/.opencode/bin/opencode";
    const sessions = await spawnBounded(spawnImpl, binary, ["session", "list", "--format", "json"], { cwd: worktree, env }, 15000, signal);
    const rows = JSON.parse(sessions.out);
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("OpenCode did not record exactly one activation session");
    const session = rows[0].id;
    const exported = await spawnBounded(spawnImpl, binary, ["export", session], { cwd: worktree, env }, 15000, signal);
    const transcript = JSON.parse(exported.out);
    fs.writeFileSync(path.join(attempt, "transcript.json"), exported.out, { mode: 0o600 });
    const messages = (transcript.messages || []).filter(m => m.info?.role === "assistant");
    if (!messages.length) throw new Error("OpenCode returned no assistant messages");
    const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    for (const message of messages) {
      const tokens = message.info.tokens || {};
      usage.input_tokens += tokens.input || 0; usage.output_tokens += tokens.output || 0;
      usage.cache_read_input_tokens += tokens.cache?.read || 0; usage.cache_creation_input_tokens += tokens.cache?.write || 0;
    }
    const last = messages.at(-1);
    if (last.info.finish === "length") throw new Error("OpenCode generation incomplete: output limit");
    if (last.info.error) throw new Error(`OpenCode model request failed: ${last.info.error.name || "unknown"}`);
    return { subtype: "success", is_error: false, result: (last.parts || []).filter(p => p.type === "text").map(p => p.text).join("\n"),
      num_turns: messages.length, usage, provenance: { session, transcript: path.join(attempt, "transcript.json") } };
  } finally {
    // Logs/session data are retained as attempt evidence; the scratch worktree is disposable.
    try { git(["-C", control, "worktree", "remove", "--force", worktree]); } catch { /* interrupted launcher may still own it */ }
  }
}
function osHome() { return require("node:os").homedir(); }
module.exports = { invokeOpenCode, engineConfig };
