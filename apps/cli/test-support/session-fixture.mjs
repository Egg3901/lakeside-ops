import net from "node:net";
import crypto from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";

// Persist a real, empty session without sending a provider request.
export async function seedSession(root, directory, env) {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const password = crypto.randomUUID();
  const server = spawn(process.execPath, [path.join(root, "bin/lakeside.cjs"), "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: directory, env: { ...env, OPENCODE_SERVER_PASSWORD: password }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "", failure;
  server.once("error", error => { failure = error; });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { logs = (logs + data).slice(-3000); });
  const request = async (endpoint, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { method: body ? "POST" : "GET", headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(body ? 120000 : 1500) });
    if (!response.ok) throw new Error(`Session fixture returned ${response.status}`);
    return response.json();
  };
  try {
    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      try { if ((await request("/global/health")).healthy) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error(`Session fixture did not start: ${logs}`);
    const session = await request(`/session?directory=${encodeURIComponent(directory)}`, { title: "Lakeside session smoke" });
    return session.id;
  } finally {
    if (server.exitCode === null && !failure) {
      server.kill("SIGTERM");
      await new Promise(resolve => {
        const timer = setTimeout(() => { server.kill("SIGKILL"); resolve(); }, 5000);
        server.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
  }
}
