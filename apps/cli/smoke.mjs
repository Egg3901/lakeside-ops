// Exercise the actual pinned engine and installed plugin without provider calls.
import { startMcpProbe } from "./test-support/mcp-probe.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const packageRoot = process.env.LAKESIDE_CODE_PACKAGE_ROOT || fileURLToPath(new URL(".", import.meta.url));
const { engineBinary, launchSettings, prepare } = require(path.join(packageRoot, "launch.js"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lakeside-code-engine-"));
const secret = crypto.randomUUID();
const env = { ...process.env, OPENCODE_TEST_HOME: dir, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_MODELS_FETCH: "true", OPENCODE_CONFIG_CONTENT: "{}", OPENCODE_SERVER_PASSWORD: secret };
delete env.LAKESIDE_CODE_CONFIG_DIR;
delete env.LAKESIDE_CODE_PEERS;
for (const [key, sub] of [["XDG_CONFIG_HOME", "config"], ["XDG_STATE_HOME", "state"], ["XDG_DATA_HOME", "data"], ["XDG_CACHE_HOME", "cache"]]) env[key] = path.join(dir, sub);
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const probe = await startMcpProbe(secret);
env.LAKESIDE_MCP_TEST_TOKEN = secret;
const connectionDir = path.join(env.XDG_CONFIG_HOME, "lakeside-code");
fs.mkdirSync(connectionDir, { recursive: true });
fs.writeFileSync(path.join(connectionDir, "mcp.json"), JSON.stringify([{ id: "probe", url: probe.url, tokenEnv: "LAKESIDE_MCP_TEST_TOKEN" }]));
const prepared = prepare(launchSettings([], env), env);
const child = spawn(engineBinary(env), ["serve", "--port", String(port), "--hostname", "127.0.0.1"], { cwd: dir, env: prepared.env, stdio: ["ignore", "pipe", "pipe"] });
let logs = "", spawnError;
child.once("error", error => { spawnError = error; });
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { logs = (logs + chunk).slice(-5000); });
const get = async endpoint => {
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { headers: { Authorization: `Basic ${Buffer.from(`opencode:${secret}`).toString("base64")}` }, signal: AbortSignal.timeout(endpoint === "/global/health" ? 1500 : 120000) });
  if (!response.ok) throw new Error(`Engine returned HTTP ${response.status}`);
  return response.json();
};
try {
  const deadline = Date.now() + 45000;
  let ready = false;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    try { if ((await get("/global/health")).healthy) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Engine startup deadline exceeded");
  const tools = await get("/experimental/tool/ids");
  const expected = ["agent_status", "agent_handoff", "agent_result", "agent_handoffs", "agent_reconcile", "agent_cancel", "workflow_status", "workflow_checkpoint"];
  if (!expected.every(name => tools.includes(name))) throw new Error(`Missing coordination tools: ${expected.filter(name => !tools.includes(name)).join(", ")}`);
  const connections = await get("/mcp");
  if (connections.probe?.status !== "connected" || !probe.observed.has("tools/list")) throw new Error("Native MCP authentication or tool discovery failed");
  const skills = await get("/skill");
  const expectedSkills = ["ponytail", "ponytail-review", "systematic-debugging", "verification-before-completion", "test-driven-development", "frontend-design", "design-system", "ux-design", "accessible-design", "terminal-design", "design-review"];
  if (!expectedSkills.every(name => skills.some(row => row.name === name))) throw new Error(`Missing built-in skills: ${expectedSkills.filter(name => !skills.some(row => row.name === name)).join(", ")}`);
  const commands = await get("/command");
  if (!expectedSkills.every(name => commands.some(row => row.name === name))) throw new Error("Missing skill slash commands");
  console.log(JSON.stringify({ skills: expectedSkills, engine: "1.19.0", coordinationTools: expected, modelCalls: 0, result: "passed" }));
} catch (error) { console.error(error.message); console.error(logs); process.exitCode = 1; }
finally {
  await probe.close();
  if (child.exitCode === null && !spawnError) {
    child.kill("SIGTERM");
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
