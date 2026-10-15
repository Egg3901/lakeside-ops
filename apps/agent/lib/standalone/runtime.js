"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createLedger } = require("../operator/store");
const { createAppChannel, createAppServer } = require("../operator/appchannel");
const { createAppAgent } = require("../operator/appagent");
const { createNotebook } = require("../operator/knowledge");

// Independent installations reuse Keir's durable conversation and task protocol.
// No Discord gateway, game broker, sensors or production effect adapters boot.
function createRuntime({ configFile, binary = "lakeside", log = console.error, execute = executeTask }) {
  const settings = JSON.parse(fs.readFileSync(configFile, "utf8"));
  if (!path.isAbsolute(settings.state_dir) || !settings.projects?.length || !settings.default_route) throw new Error("Incomplete Lakeside configuration");
  const state = path.join(settings.state_dir, "portal");
  const config = { ownerId: "100000000000000001", botId: "100000000000000002", taskLifetimeMs: 7 * 86400000, stateDir: state };
  const ledger = createLedger(path.join(state, "ledger.json"));
  const notebook = createNotebook({ file: path.join(state, "notebook.json") });
  for (const job of Object.values(ledger.data.jobs)) {
    if (job.state === "running") { job.state = "blocked"; job.summary = "Interrupted by restart. Inspect the previous attempt before retrying."; }
  }
  ledger.save();
  let busy = false, active = null, stopped = false;
  const app = createAppChannel({ ledger, config, conversation: { record() {} }, agent: () => agent, drain: () => queueMicrotask(drain) });
  const agent = createAppAgent({ ledger, config, app, notebook, drain: () => queueMicrotask(drain) });
  app.modelOptions = () => ({ selection: "auto", models: [{ id: "auto", title: settings.default_route, detail: "Installation default", available: true }] });
  app.selectModel = (_thread, selection) => {
    if (selection !== "auto") throw Object.assign(new Error("Set default_route in your installation config"), { status: 400 });
    return app.modelOptions();
  };
  const cancel = app.cancel;
  app.cancel = (id) => { const result = cancel(id); if (active?.id === id) active.controller.abort(); return result; };
  const server = createAppServer({ app, authenticate: async () => "owner", artifactsDir: path.join(state, "artifacts"),
    agentRoutes: async (route, method, body, query) => {
      if (method === "POST" && /^\/(watches|ideas)/.test(route)) throw Object.assign(new Error("Not enabled in standalone mode"), { status: 404 });
      if (route === "/threads" && method === "GET") return { threads: agent.threads().filter(t => t.id !== "watches") };
      const result = await agent.route(route, method, body, query);
      const control = /^\/tasks\/([a-f0-9]{12})\/(stop|pause)$/.exec(route);
      if (method === "POST" && control && active?.id === control[1]) active.controller.abort();
      return result;
    }, log });

  async function drain() {
    if (busy || stopped) return;
    const job = Object.values(ledger.data.jobs).find(j => j.state === "queued");
    if (!job) return;
    busy = true;
    const controller = new AbortController(); active = { id: job.id, controller };
    job.state = "running"; ledger.save(); app.updateStatus(job, "Working on your configured project");
    try {
      const history = app.history(24, job.appThread || "main").map(m => `${m.author}: ${m.content}`).join("\n\n");
      const result = await execute({ binary, configFile, project: settings.projects[0].id, state, jobId: job.id, prompt: history, signal: controller.signal });
      if (job.state === "running") {
        const text = result.outcome?.result?.summary || result.outcome?.final_text;
        if (!text) throw new Error("Provider returned no structured result or answer");
        app.deliver(`finish:${job.id}`, { content: text }, job);
        job.state = result.state === "done" ? "done" : "blocked";
        job.summary = text;
        job.attempt = result.outcome?.attempt_id || result.task || null;
      }
    } catch (error) {
      if (job.state === "running") {
        job.state = "blocked"; job.summary = "The attempt failed. Inspect the local agent log and retry.";
        app.deliver(`error-reply:${job.id}`, { content: job.summary }, job);
        log(`Keir attempt ${job.id} failed: ${error.code || error.name || "error"}`);
      }
    } finally {
      ledger.save(); active = null; busy = false;
      if (!stopped) queueMicrotask(drain);
    }
  }
  queueMicrotask(drain);
  return { server, app, ledger, stop() { stopped = true; active?.controller.abort(); server.close(); } };
}

function executeTask({ binary, configFile, project, state, jobId, prompt, signal }) {
  fs.mkdirSync(path.join(state, "prompts"), { recursive: true, mode: 0o700 });
  const file = path.join(state, "prompts", `${jobId}.md`);
  fs.writeFileSync(file, prompt, { mode: 0o600 });
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["run", "--config", configFile, "--project", project, "--role", "researcher", "--grant", "read", "--prompt-file", file, "--json"], {
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    let output = "", failed = false;
    let killTimer;
    const kill = () => {
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
      if (!killTimer) { killTimer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 10000); killTimer.unref(); }
    };
    const timer = setTimeout(kill, 960000); timer.unref();
    signal.addEventListener("abort", kill, { once: true });
    if (signal.aborted) kill();
    child.stdout.on("data", b => { output += b; if (output.length > 2e6) { failed = true; kill(); } });
    // Provider stderr may contain private task data. It never reaches a client.
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", code => {
      clearTimeout(timer); clearTimeout(killTimer); signal.removeEventListener("abort", kill); fs.rmSync(file, { force: true });
      if (code || signal.aborted || failed) return reject(Object.assign(new Error("Agent attempt failed"), { code }));
      try { resolve(JSON.parse(output)); } catch (e) { reject(e); }
    });
  });
}
module.exports = { createRuntime, executeTask };
