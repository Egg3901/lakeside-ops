// Exercise the installed terminal with ConPTY on Windows (or a PTY on Linux).
// node-pty is a CI-only dependency and is never included in the product package.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pty = require(path.join(process.env.LAKESIDE_CODE_PTY_ROOT, "node_modules/node-pty"));
const root = process.env.LAKESIDE_CODE_PACKAGE_ROOT;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lakeside-code-console-"));
const env = { ...process.env, TERM: "xterm-256color", OPENCODE_TEST_HOME: dir, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_MODELS_FETCH: "true", OPENCODE_CONFIG_CONTENT: "{}" };
for (const [key, sub] of [["XDG_CONFIG_HOME", "config"], ["XDG_DATA_HOME", "data"], ["XDG_CACHE_HOME", "cache"], ["XDG_STATE_HOME", "state"]]) env[key] = path.join(dir, sub);
delete env.LAKESIDE_CODE_CONFIG_DIR;
delete env.LAKESIDE_CODE_PEERS;
const child = pty.spawn(process.execPath, [path.join(root, "bin/lakeside.cjs"), "--preview"], { name: "xterm-256color", cols: 132, rows: 42, cwd: dir, env });
let output = "", exited = false;
const cleaned = () => output.replace(/\x1b(?:\][\s\S]*?(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[()][A-Z0-9]|[=>])/g, "");
child.onData(data => { output = (output + data).slice(-250000); });
const exit = new Promise(resolve => child.onExit(() => { exited = true; resolve(); }));
async function expect(text, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (!cleaned().includes(text)) {
    if (exited || Date.now() >= deadline) throw new Error(`Installed terminal did not show ${JSON.stringify(text)}: ${cleaned().slice(-3500)}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
try {
  await expect("Preview · sample data", 100000);
  output = "";
  child.write("\x1b");
  await expect("Inspect project", 10000);
  console.log(`Installed terminal: ${process.platform} preview and coding home passed; model calls: 0`);
} finally {
  if (!exited) child.kill();
  await Promise.race([exit, new Promise(resolve => { const timer = setTimeout(resolve, 5000); timer.unref(); })]);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
