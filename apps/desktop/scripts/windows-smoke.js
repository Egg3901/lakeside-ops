"use strict";
// Exercise the installed executable against the real standalone portal and a
// deterministic worker. No production login, credentials or model calls.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const net = require("node:net");
const { createPortal } = require("../../web/portal/server");
const { passwordHash } = require("../../web/portal/auth");
const { createRuntime } = require("../../agent/lib/standalone/runtime");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { try { const value = await fn(); if (value) return value; } catch {} await sleep(200); }
  throw new Error("Windows smoke timed out");
}
async function port() { const s = net.createServer(); s.listen(0, "127.0.0.1"); await once(s, "listening"); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function cdp(base) {
  const page = await until(async () => (await (await fetch(`${base}/json/list`)).json()).find(p => p.type === "page" && p.url.includes("/keir/app")));
  const ws = new WebSocket(page.webSocketDebuggerUrl); await once(ws, "open");
  let seq = 0; const pending = new Map();
  ws.addEventListener("message", event => { const r = JSON.parse(String(event.data)); const p = pending.get(r.id); if (p) { pending.delete(r.id); r.error ? p.reject(new Error(r.error.message)) : p.resolve(r.result); } });
  function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP deadline: " + method)); }, 10000); pending.set(id, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } }); ws.send(JSON.stringify({ id, method, params })); }); }
  return { close: () => ws.close(), call, eval: async expression => { const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error("Browser evaluation failed"); return r.result?.value; } };
}
async function main() {
  assert.equal(process.platform, "win32", "Installer smoke runs on Windows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keir-install-"));
  const install = path.join(root, "installed"), data = path.join(root, "profile"), output = path.resolve(process.env.KEIR_SMOKE_OUTPUT || "dist/windows-smoke");
  fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(data, { recursive: true });
  let runtime, server, child, browser; const evidence = { installer: null, installedStartup: false, login: false, modelSelection: false, sendHistory: false, reconnect: false, providerCalls: "fixture only" };
  async function stop() {
    if (browser && child?.exitCode === null) {
      try { await browser.eval("window.close(); true"); } catch {}
      await until(() => child.exitCode !== null, 5000).catch(() => {});
    }
    browser?.close(); browser = null;
    if (child && child.exitCode === null) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    child = null;
    await sleep(500);
  }
  try {
    const installers = fs.readdirSync("dist").filter(n => n.endsWith(".exe")); assert.equal(installers.length, 1);
    const installer = path.resolve("dist", installers[0]); evidence.installer = installers[0];
    // NSIS requires /D last. Runner temp paths contain no spaces.
    assert.ok(!install.includes(" "), "Use a space-free runner temp directory");
    const installed = spawnSync(installer, ["/S", `/D=${install}`], { timeout: 120000, stdio: "inherit" });
    assert.equal(installed.status, 0, "Silent installer failed");
    const exe = path.join(install, "Keir.exe"); assert.ok(fs.existsSync(exe));
    const origin = `http://127.0.0.1:${await port()}`;
    const configFile = path.join(root, "config.json");
    fs.writeFileSync(configFile, JSON.stringify({ state_dir: path.join(root, "state"), default_route: "claude:claude-opus-5-5", available_routes: ["claude:claude-sonnet-5-5", "agy:gemini-3.8-flash", "ollama:deepseek-v4.1-flash"], projects: [{ id: "smoke", repo_path: root, default_branch: "main", public: false, uses_check_scheduler: false }] }));
    const routes = [];
    runtime = createRuntime({ configFile, log() {}, execute: async request => { routes.push(request.route); return { state: "done", outcome: { result: { summary: "Windows fixture reply received." } } }; } });
    server = createPortal({ origin, passwordHash: await passwordHash("windows-smoke-only"), stateDir: path.join(root, "auth"), runtime });
    server.listen(Number(new URL(origin).port), "127.0.0.1"); await once(server, "listening");
    fs.writeFileSync(path.join(data, "server.json"), JSON.stringify({ origin }));
    async function launch() {
      const debugPort = await port();
      child = spawn(exe, [`--user-data-dir=${data}`, `--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1"], { stdio: "ignore" });
      child.on("error", () => {});
      browser = await cdp(`http://127.0.0.1:${debugPort}`);
      await until(async () => await browser.eval("location.href") === origin + "/keir/app");
    }
    await launch(); evidence.installedStartup = true;
    await until(() => browser.eval("!!document.querySelector('#password')"));
    await browser.eval("document.querySelector('#password').value='windows-smoke-only'; document.querySelector('#signin').requestSubmit(document.querySelector('#signin button')); true");
    await until(() => browser.eval("!document.querySelector('#workspace').hidden")); evidence.login = true;
    await until(() => browser.eval("!document.querySelector('#model-picker').disabled && document.querySelector('#model-picker').textContent.includes('Auto')"));
    await browser.eval("document.querySelector('#model-picker').click(); true");
    await until(() => browser.eval("document.querySelector('#models').open"));
    await browser.eval("document.querySelector('#model-search').value='Sonnet'; document.querySelector('#model-search').dispatchEvent(new Event('input')); true");
    assert.equal(await browser.eval("document.querySelectorAll('#model-options button').length"), 1);
    await browser.eval("document.querySelector('[data-route=\"claude:claude-sonnet-5-5\"]').click(); true");
    await until(() => browser.eval("document.querySelector('#model-picker').textContent.includes('Sonnet')")); evidence.modelSelection = true;
    await browser.eval("document.querySelector('#models').close(); document.querySelector('#message').value='Hello'; document.querySelector('#compose').requestSubmit(document.querySelector('#compose button:not([type])')); true");
    await until(() => browser.eval("document.querySelector('#messages').textContent.includes('Windows fixture reply received.')"));
    assert.deepEqual(routes, ["claude:claude-sonnet-5-5"]); evidence.sendHistory = true;
    fs.writeFileSync(path.join(output, "windows-chat.png"), Buffer.from((await browser.call("Page.captureScreenshot")).data, "base64"));
    await stop(); await launch();
    await until(() => browser.eval("!document.querySelector('#workspace').hidden && document.querySelector('#messages').textContent.includes('Windows fixture reply received.') && document.querySelector('#model-picker').textContent.includes('Sonnet')")); evidence.reconnect = true;
    console.log(JSON.stringify(evidence));
  } catch (error) {
    evidence.error = error.message;
    if (browser) {
      try { fs.writeFileSync(path.join(output, "windows-failure.png"), Buffer.from((await browser.call("Page.captureScreenshot")).data, "base64")); } catch {}
    }
    throw error;
  } finally {
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(evidence, null, 2));
    await stop(); runtime?.stop(); if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
