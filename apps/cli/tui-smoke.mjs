// Exercise the installed terminal with ConPTY on Windows (or a PTY on Linux).
// node-pty is a CI-only dependency and is never included in the product package.
import { seedSession } from "./test-support/session-fixture.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pty = require(path.join(process.env.LAKESIDE_CODE_PTY_ROOT, "node_modules/node-pty"));
const root = process.env.LAKESIDE_CODE_PACKAGE_ROOT;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lakeside-code-console-"));
const workspace = path.join(dir, "project");
fs.mkdirSync(workspace);
const env = { ...process.env, TERM: "xterm-256color", OPENCODE_TEST_HOME: dir, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_MODELS_FETCH: "true", OPENCODE_CONFIG_CONTENT: "{}" };
for (const [key, sub] of [["XDG_CONFIG_HOME", "config"], ["XDG_DATA_HOME", "data"], ["XDG_CACHE_HOME", "cache"], ["XDG_STATE_HOME", "state"]]) env[key] = path.join(dir, sub);
delete env.LAKESIDE_CODE_CONFIG_DIR;
delete env.LAKESIDE_CODE_PEERS;
let output = "", exited = false, exit;
const cleaned = () => output.replace(/\x1b(?:\][\s\S]*?(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[()][A-Z0-9]|[=>])/g, "");
function open(args) {
  output = ""; exited = false;
  const terminal = pty.spawn(process.execPath, [path.join(root, "bin/lakeside.cjs"), ...args], { name: "xterm-256color", cols: 132, rows: 42, cwd: workspace, env });
  terminal.onData(data => { output = (output + data).slice(-250000); });
  exit = new Promise(resolve => terminal.onExit(() => { exited = true; resolve(); }));
  return terminal;
}
let child;
async function expect(text, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (!cleaned().includes(text)) {
    if (exited || Date.now() >= deadline) throw new Error(`Installed terminal did not show ${JSON.stringify(text)}: ${cleaned().slice(-3500)}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
try {
  execFileSync("git", ["init", workspace], { stdio: "ignore" });
  const example = path.join(workspace, "lakeside-fixture.txt");
  fs.writeFileSync(example, "before\n");
  execFileSync("git", ["add", "lakeside-fixture.txt"], { cwd: workspace, stdio: "ignore" });
  execFileSync("git", ["-c", `core.hooksPath=${path.join(dir, "no-hooks")}`, "-c", "user.name=CLI Test", "-c", "user.email=cli-test@example.invalid", "commit", "-m", "fixture"], { cwd: workspace, stdio: "ignore" });
  fs.writeFileSync(example, "after\n");
  const session = await seedSession(root, workspace, env);
  child = open(["--preview"]);
  await expect("Preview · sample data", 100000);
  output = "";
  child.write("\x1b");
  await expect("Inspect project", 10000);
  output = "";
  child.resize(100, 25);
  await expect("▄██▄", 10000);
  output = "";
  child.write("/workbench");
  await expect("live workbench", 20000);
  await new Promise(resolve => setTimeout(resolve, 200));
  child.write("\r");
  await new Promise(resolve => setTimeout(resolve, 200));
  child.write("\r");
  await expect("Lakeside workbench", 10000);
  await expect("lakeside-fixture.txt", 10000);
  output = "";
  child.write("3");
  await expect("MCP connections", 10000);
  child.kill();
  await Promise.race([exit || Promise.resolve(), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (!exited) throw new Error("Preview terminal did not stop");
  child = open(["--session", session]);
  await expect("Workspace", 45000);
  await expect("changes, commands, connections", 10000);
  await expect("Lakeside session smoke", 10000);
  if (output.includes("OC |")) throw new Error("Stock window title leaked into session");
  console.log(`Installed terminal: ${process.platform} preview, compact logo, live workbench, MCP view and actual coding session passed; model calls: 0`);
} finally {
  if (child && !exited) child.kill();
  await Promise.race([exit || Promise.resolve(), new Promise(resolve => { const timer = setTimeout(resolve, 5000); timer.unref(); })]);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
