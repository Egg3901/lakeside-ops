"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { locations } = require("./config.mjs");
const { listSkills } = require("./skills");
const { launch, engineBinary, supportedVersion } = require("./launch");

function flags(input) {
  const values = {}, words = [];
  for (let i = 0; i < input.length; i++) {
    const arg = input[i];
    if (!arg.startsWith("--")) { words.push(arg); continue; }
    const key = arg.slice(2);
    if (["json", "allow-submit", "retry"].includes(key)) values[key] = true;
    else { if (!input[i + 1] || input[i + 1].startsWith("--")) throw new Error(`${arg} needs a value`); values[key] = input[++i]; }
  }
  return { values, words };
}
async function main(input = [], env = process.env) {
  if (input.length === 1 && ["--version", "version"].includes(input[0])) { console.log(`Lakeside Code ${require("./package.json").version} (OpenCode ${supportedVersion})`); return; }
  if (input.length === 1 && ["--help", "-h", "help"].includes(input[0])) { console.log("Lakeside Code\n\nlakeside code [project] [--continue] [--session ID] [--model provider/model]\nlakeside code doctor\nlakeside code skills\nlakeside code projects [add NAME LOCAL_PATH]\nlakeside code workflow [enable|disable github|kanban|tickets]\nlakeside code mcp [add --id NAME --url URL --token-env VARIABLE]\nlakeside code peers [add --id NAME --kind keir|opencode --url ORIGIN --directory /remote/worktree --token-env VARIABLE --allow-submit]\nlakeside code handoffs [refresh|cancel ID] [--retry]\nlakeside code --preview\n\nInside the terminal: /connect, /agents, /handoffs, /workbench, /connections, /inspect-project, /review-changes\nOther OpenCode commands and options pass through to the engine."); return; }
  if (input[0] === "skills") { if (input.length !== 1) throw new Error("Usage: lakeside code skills"); console.log(JSON.stringify(listSkills(), null, 2)); return; }
  if (input[0] === "projects") {
    const { loadProjects, addProject } = await import("./workspace/projects.mjs");
    if (input.length === 1) { console.log(JSON.stringify(loadProjects(env), null, 2)); return; }
    if (input.length !== 4 || input[1] !== "add") throw new Error("Usage: lakeside code projects [add NAME LOCAL_PATH]");
    console.log(JSON.stringify(addProject(input[2], input[3], env), null, 2)); return;
  }
  if (input[0] === "mcp") {
    const { loadConnections, addConnection } = await import("./integrations/mcp.mjs");
    if (input.length === 1) { console.log(JSON.stringify(loadConnections(env).map(row => ({ ...row, credentialAvailable: !row.tokenEnv || Boolean(env[row.tokenEnv]) })), null, 2)); return; }
    const { words, values } = flags(input.slice(1));
    if (words.length !== 1 || words[0] !== "add" || Object.keys(values).some(key => !["id", "url", "token-env"].includes(key))) throw new Error("Usage: lakeside code mcp add --id NAME --url URL [--token-env VARIABLE]");
    console.log(JSON.stringify(addConnection({ id: values.id, url: values.url, tokenEnv: values["token-env"] }, env), null, 2)); return;
  }
  if (input[0] === "workflow") {
    const { loadPolicy, configureIntegration } = await import("./workflow/policy.mjs");
    if (input.length === 1) { console.log(JSON.stringify(loadPolicy(env), null, 2)); return; }
    if (input.length !== 3 || !["enable", "disable"].includes(input[1])) throw new Error("Usage: lakeside code workflow [enable|disable github|kanban|tickets]");
    console.log(JSON.stringify(configureIntegration(input[2], input[1] === "enable", env), null, 2)); return;
  }
  const { loadPeers, inspectPeer, listHandoffs, reconcileHandoff, cancelHandoff } = await import("./peers.mjs");
  if (!["doctor", "peers", "handoffs"].includes(input[0])) return launch(input, env);
  const { values, words } = flags(input.slice(1));
  const allowed = input[0] === "doctor" ? ["json"] : input[0] === "peers" ? ["id", "name", "kind", "url", "directory", "model", "token-env", "allow-submit", "json"] : ["retry", "json"];
  for (const key of Object.keys(values)) if (!allowed.includes(key)) throw new Error(`Unknown option --${key}`);
  const loc = locations(env);
  const output = value => console.log(JSON.stringify(value, null, 2));
  if (input[0] === "doctor") {
    const binary = engineBinary(env);
    const probe = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 15000, env });
    const version = probe.stdout?.trim();
    let pluginReady = true;
    try { await import("@opencode-ai/plugin"); } catch { pluginReady = false; }
    const skills = listSkills();
    const result = { skills: skills.map(row => row.name), ready: probe.status === 0 && version === supportedVersion && pluginReady && (Number(process.versions.node.split(".")[0]) > 22 || Number(process.versions.node.split(".")[0]) === 22 && Number(process.versions.node.split(".")[1]) >= 12), engine: version || "unavailable", requiredEngine: supportedVersion, pluginReady, node: process.versions.node, platform: process.platform, binary, configuration: loc.config, peers: loadPeers(env).map(({ id, kind, url, directory, allowSubmit }) => ({ id, kind, url, directory, allowSubmit })) };
    output(result); if (!result.ready) process.exitCode = 1; return;
  }
  if (input[0] === "peers") {
    if (words[0] === "add") {
      const peer = { id: values.id, name: values.name || values.id, kind: values.kind, url: values.url, ...(values.directory ? { directory: values.directory } : {}), ...(values.model ? { model: values.model } : {}), ...(values["token-env"] ? { tokenEnv: values["token-env"] } : {}), allowSubmit: Boolean(values["allow-submit"]) };
      const existing = loadPeers(env);
      if (existing.some(row => row.id === peer.id)) throw new Error("Peer already exists; edit the private peer file to change its target");
      fs.mkdirSync(path.dirname(loc.peers), { recursive: true, mode: 0o700 });
      // Validate with the same reader used by the runtime before replacing
      // a working configuration. Credentials are never accepted as arguments.
      const temporary = `${loc.peers}.${process.pid}.tmp`;
      try { fs.writeFileSync(temporary, JSON.stringify([...existing, peer], null, 2) + "\n", { mode: 0o600 }); loadPeers({ ...env, LAKESIDE_CODE_PEERS: temporary }); fs.renameSync(temporary, loc.peers); }
      finally { fs.rmSync(temporary, { force: true }); }
      output({ saved: peer.id, file: loc.peers }); return;
    }
    if (words.length) throw new Error("Usage: lakeside code peers [add --id NAME --kind keir|opencode --url ORIGIN ...]");
    output(await Promise.all(loadPeers(env).map(peer => inspectPeer(peer, { env })))); return;
  }
  if (!words.length) { output(listHandoffs({ env })); return; }
  const [operation, id] = words;
  if (!["refresh", "cancel"].includes(operation) || !id || words.length !== 2) throw new Error("Usage: lakeside code handoffs [refresh|cancel HANDOFF_ID] [--retry]");
  const receipt = listHandoffs({ env }).find(row => row.id === id);
  if (!receipt) throw new Error("Unknown handoff id");
  const peer = loadPeers(env).find(peer => peer.id === receipt.peer);
  if (!peer) throw new Error("The original peer is no longer configured");
  output(await (operation === "cancel" ? cancelHandoff : reconcileHandoff)(peer, id, { env, retry: Boolean(values.retry) }));
}
module.exports = { main, flags };
