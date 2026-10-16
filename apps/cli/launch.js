"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn, spawnSync } = require("node:child_process");

const supportedVersion = "1.19.0";

function launchSettings(input, env = process.env) {
  const args = [], options = {};
  for (let i = 0; i < input.length; i++) {
    const word = input[i];
    if (word === "--preview") options.preview = true;
    else if (word === "--name") {
      if (!input[i + 1] || input[i + 1].startsWith("--")) throw new Error("--name needs a display name");
      options.name = input[++i];
    } else args.push(word);
  }
  const name = options.name || env.LAKESIDE_CODE_NAME || "Lakeside Code";
  if (!name.trim() || name.length > 32 || /[\x00-\x1f\x7f-\x9f]/.test(name)) throw new Error("Display name must be 1 to 32 printable characters");
  if (options.preview && args.length) throw new Error("--preview runs by itself; use it without engine commands, projects or prompt flags");
  return { args, name, preview: Boolean(options.preview), binary: env.LAKESIDE_OPENCODE_BIN || "opencode" };
}

function prepare(settings, env = process.env) {
  const dir = env.LAKESIDE_CODE_CONFIG_DIR || path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "lakeside-code");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // A generated launch file never replaces the user's OpenCode configuration.
  const tuiFile = path.join(dir, "terminal.generated.json");
  fs.writeFileSync(tuiFile, JSON.stringify({
    theme: "midnight",
    plugin: [[pathToFileURL(path.join(__dirname, "terminal.tsx")).href, { name: settings.name }]],
    prompt: { max_width: "auto", max_height: 8 },
    diff_style: "auto",
    attention: { enabled: false },
  }, null, 2) + "\n", { mode: 0o600 });
  const inline = env.OPENCODE_CONFIG_CONTENT ? JSON.parse(env.OPENCODE_CONFIG_CONTENT) : {};
  const plugin = pathToFileURL(path.join(__dirname, "coordination-plugin.mjs")).href;
  const childEnv = {
    ...env,
    LAKESIDE_CODE_NAME: settings.name,
    OPENCODE_TUI_CONFIG: tuiFile,
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...inline,
      permission: typeof inline.permission === "string" ? inline.permission : { agent_handoff: "ask", ...(inline.permission || {}) },
      plugin: [...(inline.plugin || []), plugin],
    }),
  };
  if (settings.preview) childEnv.OPENCODE_ROUTE = JSON.stringify({ type: "plugin", id: "lakeside.preview" });
  return { args: settings.args, env: childEnv };
}

async function launch(input = [], env = process.env) {
  const settings = launchSettings(input, env);
  try { require.resolve("@opencode-ai/plugin", { paths: [__dirname] }); }
  catch { throw new Error("Install the coding client dependency first: npm --prefix apps/cli ci --ignore-scripts"); }
  const version = spawnSync(settings.binary, ["--version"], { encoding: "utf8", timeout: 15000, env });
  if (version.error || version.status !== 0) throw new Error(`Install OpenCode ${supportedVersion} first, or set LAKESIDE_OPENCODE_BIN to its executable`);
  if (version.stdout.trim() !== supportedVersion) throw new Error(`This terminal targets OpenCode ${supportedVersion}; found ${version.stdout.trim()}. Use a matching binary via LAKESIDE_OPENCODE_BIN.`);
  const prepared = prepare(settings, env);
  return new Promise((resolve, reject) => {
    const child = spawn(settings.binary, prepared.args, { stdio: "inherit", env: prepared.env });
    // The terminal delivers Ctrl-C to the foreground process group. Let
    // OpenCode restore terminal modes before the launcher exits.
    const interrupt = () => {};
    const terminate = () => child.kill("SIGTERM");
    const hangup = () => child.kill("SIGHUP");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    process.on("SIGHUP", hangup);
    const cleanup = () => { process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); process.off("SIGHUP", hangup); };
    child.once("error", error => { cleanup(); reject(error); });
    child.once("exit", (code, signal) => { cleanup(); process.exitCode = code ?? (signal ? 130 : 1); resolve(); });
  });
}

module.exports = { launch, launchSettings, prepare, supportedVersion };
