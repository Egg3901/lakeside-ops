#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { passwordHash } = require("../apps/web/portal/auth");
const { publicOrigin } = require("../apps/web/portal/server");
const root = path.resolve(__dirname, "..");
function args(input) {
  const [command = "help", ...rest] = input; const options = {}, words = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) { const key = rest[i].slice(2); options[key] = ["password-stdin", "json"].includes(key) ? true : rest[++i]; }
    else words.push(rest[i]);
  }
  return { command, options, words };
}
function locations(env = process.env) {
  const dir = env.LAKESIDE_CONFIG_DIR || path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "lakeside");
  return { dir, config: path.join(dir, "lakeside.json"), portal: path.join(dir, "portal.json"), client: path.join(dir, "client.json"), state: path.join(env.XDG_STATE_HOME || path.join(os.homedir(), ".local/state"), "lakeside") };
}
function save(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" }); }
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function agentBinary() {
  return process.env.LAKESIDE_AGENT_BIN || path.join(root, "apps/agent/rust/target/release/lakeside");
}
async function password(options) {
  if (options["password-stdin"]) { let input = ""; for await (const b of process.stdin) { input += b; if (input.length > 2048) throw new Error("Password input too long"); } return input.replace(/\r?\n$/, ""); }
  if (!process.stdin.isTTY) throw new Error("Pass --password-stdin or run in a terminal");
  process.stderr.write("Portal password: "); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const handler = data => {
      for (const c of data.toString()) {
        if (c === "\u0003" || c === "\r" || c === "\n") { process.stdin.off("data", handler); process.stdin.setRawMode(false); process.stdin.pause(); process.stderr.write("\n"); return c === "\u0003" ? reject(new Error("Cancelled")) : resolve(value); }
        if (c === "\u007f") value = value.slice(0, -1); else value += c;
      }
    };
    process.stdin.on("data", handler);
  });
}
async function request(client, endpoint, payload) {
  const origin = publicOrigin(client.origin);
  const response = await fetch(new URL(endpoint, origin), { method: payload ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(35000),
    headers: { ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}), ...(payload ? { "Content-Type": "application/json" } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return { result, response };
}
async function main(input = process.argv.slice(2)) {
  if (input[0] === "code") return require("../apps/cli/commands").main(input.slice(1));
  const { command, options, words } = args(input), loc = locations();
  if (command === "init") {
    if (fs.existsSync(loc.config) || fs.existsSync(loc.portal)) throw new Error(`Configuration already exists in ${loc.dir}`);
    const repo = path.resolve(options.project || process.cwd());
    if (spawnSync("git", ["-C", repo, "rev-parse", "--show-toplevel"]).status !== 0) throw new Error("--project must point to a Git repository");
    const route = options.route; if (!route || !/^[a-z]+:[^\s]+$/.test(route)) throw new Error("Set --route provider:model@effort for a provider you have installed and signed in to");
    const origin = publicOrigin(options.url || "http://127.0.0.1:9724").origin;
    const hash = await passwordHash(await password(options));
    const branch = spawnSync("git", ["-C", repo, "symbolic-ref", "--short", "HEAD"], { encoding: "utf8" });
    save(loc.config, { state_dir: loc.state, default_route: route, projects: [{ id: "my-project", repo_path: repo, default_branch: branch.stdout.trim() || "main", public: false, uses_check_scheduler: false }] });
    save(loc.portal, { origin, passwordHash: hash, email: options.email || "owner@localhost" });
    console.log(`Configured ${loc.config}\nRun lakeside doctor, then lakeside serve.`); return;
  }
  if (command === "serve") {
    const portal = read(loc.portal);
    process.env.LAKESIDE_MODE = "standalone"; process.env.LAKESIDE_CONFIG = loc.config;
    process.env.LAKESIDE_PUBLIC_URL = portal.origin; process.env.LAKESIDE_PASSWORD_HASH = portal.passwordHash;
    process.env.LAKESIDE_OWNER_EMAIL = portal.email;
    process.env.LAKESIDE_PORTAL_GRANT = portal.grant || "read";
    if (portal.worktree) process.env.LAKESIDE_PORTAL_WORKTREE = portal.worktree; process.env.LAKESIDE_AGENT_BIN = agentBinary();
    require("../apps/web/portal/server").start(); return;
  }
  if (command === "doctor") {
    const config = read(loc.config), portal = read(loc.portal); publicOrigin(portal.origin);
    for (const p of config.projects) { if (!fs.statSync(p.repo_path).isDirectory()) throw new Error(`Missing project ${p.id}`); }
    const bin = agentBinary(); if (!fs.existsSync(bin)) throw new Error("Agent binary missing. Run npm run build:agent.");
    const check = spawnSync(bin, ["run", "--config", loc.config, "--project", config.projects[0].id, "--prompt-file", path.join(root, "config/probe.md"), "--dry-run", "--json"], { encoding: "utf8" });
    if (check.status !== 0) throw new Error(check.stderr.trim() || "Agent setup check failed");
    console.log(`Ready: ${config.projects.length} project(s), ${config.default_route}, portal ${portal.origin}`); return;
  }
  if (command === "agent") {
    const child = spawnSync(agentBinary(), [...input.slice(1), "--config", loc.config], { stdio: "inherit" });
    if (child.error) throw child.error; process.exitCode = child.status ?? 1; return;
  }
  if (command === "login") {
    if (fs.existsSync(loc.client)) throw new Error("Already signed in. Run lakeside logout first.");
    const origin = publicOrigin(options.url || read(loc.portal).origin).origin;
    const { response } = await request({ origin }, "/api/login", { password: await password(options) });
    const token = /ops_session=([A-Za-z0-9_-]{43})/.exec(response.headers.get("set-cookie") || "")?.[1];
    if (!token) throw new Error("Server did not issue a session"); save(loc.client, { origin, token }); console.log("Signed in."); return;
  }
  if (["logout", "chat", "tasks", "stop", "start", "status", "model", "approval", "skills"].includes(command)) {
    const client = read(loc.client);
    if (command === "logout") { await request(client, "/api/logout", {}); fs.rmSync(loc.client); console.log("Signed out."); return; }
    if (["stop", "start", "status", "model", "approval", "skills"].includes(command)) {
      const { result } = await request(client, "/api/keir/app/messages", { text: `/${command}${words.length ? " " + words.join(" ") : ""}`, thread: options.thread || "main", clientId: crypto.randomUUID(), mode: "new" });
      console.log(result.text || JSON.stringify(result, null, 2)); return;
    }
    const endpoint = command === "tasks" ? "/api/keir/app/tasks" : "/api/keir/app/messages";
    const text = words.join(" "); if (command === "chat" && !text.trim()) throw new Error("Usage: lakeside chat <message>");
    const { result } = await request(client, endpoint, command === "chat" ? { text, thread: options.thread || "main", clientId: crypto.randomUUID(), mode: "new" } : undefined);
    console.log(JSON.stringify(result, null, 2)); return;
  }
  console.log("lakeside code [project] [--preview] [--name display-name]  (local coding terminal)\nlakeside init --project /path/to/repo --route provider:model@effort [--url https://ops.example.com] [--password-stdin]\nlakeside serve | doctor | login [--url origin] | logout | chat <message> | tasks\nlakeside agent run|tasks|show ...  (project harness)");
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { main, args, locations, request };
