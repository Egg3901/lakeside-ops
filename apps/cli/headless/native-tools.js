"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnBounded } = require("./providers");
const host = require("./host");

// Explicit local coding mode, also used as the benchmark's harness-off arm.
// Provider tools replace broker tools; the caller must supply its own linked
// worktree. This is never selected by an operator activation or on failure.
async function invokeNativeTools(options) {
  const { runner, model, effort, brief, prompt, stateDir, worktree, spawnImpl, timeoutMs, maxTurns, signal } = options;
  const scratch = path.join(stateDir, "native-tools", crypto.randomUUID());
  const home = path.join(scratch, "home"), final = path.join(scratch, "final.txt");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const env = { HOME: home, PATH: process.env.PATH, LANG: "C.UTF-8", TMPDIR: scratch };
  let binary, args, stdin = `${brief}\n\n${prompt}`;
  if (runner === "claude") {
    binary = host.bin("claude");
    // HOME selects scratch config; subscription credentials remain read-only
    // references to the existing signed-in host identity.
    const credentials = host.credential(".claude/.credentials.json");
    fs.mkdirSync(path.join(home, ".claude"));
    if (fs.existsSync(credentials)) fs.symlinkSync(credentials, path.join(home, ".claude/.credentials.json"));
    args = ["-p", "--system-prompt", brief, "--model", model, "--effort", effort,
      "--setting-sources", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      "--tools", "Bash,Read,Edit,Write,Glob,Grep",
      "--allowedTools", "Bash,Read,Edit,Write,Glob,Grep", "--permission-mode", "dontAsk",
      "--max-turns", String(maxTurns), "--no-session-persistence", "--output-format", "json"];
    stdin = prompt;
  } else if (runner === "codex") {
    binary = host.bin("codex");
    const codex = path.join(home, ".codex"); fs.mkdirSync(codex);
    fs.symlinkSync(host.credential(".codex/auth.json"), path.join(codex, "auth.json"));
    env.CODEX_HOME = codex;
    fs.writeFileSync(path.join(codex, "config.toml"), `model = ${JSON.stringify(model)}\nmodel_reasoning_effort = ${JSON.stringify(effort)}\nweb_search = "disabled"\n[features]\napps = false\nplugins = false\nmulti_agent = false\n`);
    args = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "-C", worktree, "-o", final, "-"];
  } else if (runner === "agy") {
    binary = host.bin("agy");
    const gemini = path.join(home, ".gemini"); fs.mkdirSync(path.join(gemini, "config"), { recursive: true });
    fs.mkdirSync(path.join(gemini, "antigravity-cli"));
    fs.symlinkSync(host.credential(".gemini/antigravity-cli/antigravity-oauth-token"), path.join(gemini, "antigravity-cli/antigravity-oauth-token"));
    fs.writeFileSync(path.join(gemini, "config/mcp_config.json"), '{"mcpServers":{}}');
    args = ["--model", model, "--effort", effort, "--output-format", "json", "--dangerously-skip-permissions", "-p", stdin];
    stdin = "";
  } else throw new Error(`No native coding adapter for ${runner}`);
  const result = await spawnBounded(spawnImpl, binary, args, { cwd: worktree, env }, timeoutMs, signal, stdin);
  if (result.timedOut || result.code === null) return { subtype: "error_max_turns", is_error: true, timedOut: result.timedOut, interrupted: !result.timedOut };
  if (result.code !== 0) throw new Error(`Native ${runner} exited ${result.code}: ${require("./text").redactSecrets(result.err).slice(-400)}`);
  if (runner === "claude") return JSON.parse(result.out.trim().split("\n").at(-1));
  if (runner === "agy") {
    const value = JSON.parse(result.out.slice(result.out.indexOf("{"))), usage = value.usage || {};
    return { subtype: value.status === "SUCCESS" ? "success" : "error", is_error: value.status !== "SUCCESS", result: value.response || "", num_turns: value.num_turns,
      usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cache_read_input_tokens: usage.cache_read_tokens } };
  }
  const events = result.out.split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const usage = events.findLast(event => event.type === "turn.completed")?.usage || {};
  return { subtype: "success", is_error: false, result: fs.existsSync(final) ? fs.readFileSync(final, "utf8").trim() : "", usage: {
    input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cache_read_input_tokens: usage.cached_input_tokens } };
}
module.exports = { invokeNativeTools };
