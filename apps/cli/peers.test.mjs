import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { loadPeers, inspectPeer, peerTask, handoff } from "./peers.mjs";
import { createRequire } from "node:module";

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lakeside-code-peers-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const spec = { goal: "Review the patch", repository: "owner/repo", branch: "feat/search", base: "a91c2e4", scope: "Read only", deliverable: "Findings with paths and lines" };

test("peer configuration is explicit, unique and does not embed credentials in URLs", t => {
  assert.deepEqual(loadPeers({}), []);
  const file = path.join(scratch(t), "peers.json");
  const read = value => { fs.writeFileSync(file, JSON.stringify(value)); return loadPeers({ LAKESIDE_CODE_PEERS: file }); };
  assert.throws(() => read([{ id: "vps", kind: "keir", url: "http://remote.example" }]), /HTTPS/);
  assert.throws(() => read([{ id: "vps", kind: "keir", url: "https://secret@example.com" }]), /HTTPS/);
  const peer = { id: "local", kind: "opencode", url: "http://127.0.0.1:4096" };
  assert.equal(read([peer])[0].allowSubmit, false);
  assert.throws(() => read([peer, peer]), /unique/);
});

test("real HTTP peers expose activity and completed results with credentials and directory scope", async t => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/session/status")) res.end(JSON.stringify({ ses_1: { type: "busy" } }));
    else if (req.url.startsWith("/session/ses_1/message")) res.end(JSON.stringify([{ info: { role: "assistant" }, parts: [{ text: "Reviewed" }] }]));
    else if (req.url.startsWith("/session/ses_1")) res.end(JSON.stringify({ id: "ses_1", title: "Review" }));
    else res.end(JSON.stringify([{ id: "ses_1", title: "Review" }]));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const peer = { id: "local", name: "Local reviewer", kind: "opencode", url: `http://127.0.0.1:${server.address().port}`, tokenEnv: "TEST_PASSWORD", directory: "/workspace/project" };
  const options = { env: { TEST_PASSWORD: "test-password" } };
  const view = await inspectPeer(peer, options);
  assert.equal(view.state, "connected"); assert.equal(view.tasks[0].state, "busy");
  const result = await peerTask(peer, "ses_1", options);
  assert.equal(result.messages[0].parts[0].text, "Reviewed");
  assert.ok(requests.every(row => row.url.includes("directory=%2Fworkspace%2Fproject")));
  assert.ok(requests.every(row => row.authorization === `Basic ${Buffer.from("opencode:test-password").toString("base64")}`));
});

test("unreachable peers produce offline state without blocking local use", async () => {
  const result = await inspectPeer({ id: "vps", name: "Keir", kind: "keir", url: "https://example.com" }, { fetchImpl: async () => { throw new Error("Unavailable"); } });
  assert.equal(result.state, "offline"); assert.deepEqual(result.tasks, []);
});

test("handoff records intent before network I/O and acceptance never claims completion", async t => {
  const stateDir = scratch(t);
  let sent;
  const receipt = await handoff({ id: "vps", kind: "keir", url: "https://example.com", allowSubmit: true }, spec, { stateDir, fetchImpl: async (_url, options) => {
    const files = fs.readdirSync(stateDir).filter(name => name.endsWith(".json"));
    assert.equal(files.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(stateDir, files[0]))).state, "dispatching");
    sent = JSON.parse(options.body);
    return Response.json({ jobId: "abcdef123456" }, { status: 201 });
  } });
  assert.equal(receipt.state, "accepted"); assert.equal(receipt.taskId, "abcdef123456");
  assert.equal(sent.clientId, receipt.id); assert.match(sent.text, /Base commit: a91c2e4/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(stateDir, `${receipt.id}.json`))).state, "accepted");
});

test("lost handoff responses remain uncertain and are never automatically retried", async t => {
  let calls = 0;
  const receipt = await handoff({ id: "vps", kind: "keir", url: "https://example.com", allowSubmit: true }, spec, { stateDir: scratch(t), fetchImpl: async () => { calls++; throw new Error("Connection lost after dispatch"); } });
  assert.equal(calls, 1); assert.equal(receipt.state, "uncertain"); assert.equal(receipt.taskId, undefined);
  await assert.rejects(handoff({ id: "readonly", allowSubmit: false }, spec), /read-only/);
  await assert.rejects(handoff({ id: "local", allowSubmit: true, kind: "opencode" }, spec), /inspection/);
});

test("Keir's real durable app protocol accepts a handoff and returns its completed result", async t => {
  const require = createRequire(import.meta.url);
  const { createRuntime } = require("../agent/lib/standalone/runtime");
  const dir = scratch(t), configFile = path.join(dir, "config.json");
  fs.writeFileSync(configFile, JSON.stringify({ state_dir: path.join(dir, "state"), default_route: "codex:test-model@medium", projects: [{ id: "test-project", repo_path: dir }] }));
  const runtime = createRuntime({ configFile, execute: async ({ prompt }) => {
    assert.match(prompt, /Base commit: a91c2e4/);
    return { state: "done", outcome: { attempt_id: "test-attempt", result: { summary: "Review complete against a91c2e4; no code changed." } } };
  } });
  await new Promise(resolve => runtime.server.listen(0, "127.0.0.1", resolve));
  t.after(() => { runtime.server.closeAllConnections(); runtime.stop(); });
  const peer = { id: "test-keir", name: "Test Keir", kind: "keir", url: `http://127.0.0.1:${runtime.server.address().port}`, allowSubmit: true };
  const receipt = await handoff(peer, spec, { stateDir: path.join(dir, "handoffs") });
  assert.equal(receipt.state, "accepted");
  let result;
  for (let i = 0; i < 20; i++) {
    result = await peerTask(peer, receipt.taskId);
    if (result.state === "done") break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(result.state, "done");
  assert.match(result.summary, /against a91c2e4/);
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, "state", "portal", "ledger.json")));
  assert.equal(persisted.jobs[receipt.taskId].state, "done");
});
