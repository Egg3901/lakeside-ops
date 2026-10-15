"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { createLedger } = require("../lib/operator/store");
const { createAppComputer } = require("../lib/operator/appcomputer");
function fixture(t) {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-computer-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
 const ledger = createLedger(path.join(dir, "ledger.json"));
 const config = { stateDir: dir };
 const job = ledger.createJob("app:owner", { kind: "command", role: "owner", replyChannel: "app", channelId: "app", source: { channelId: "app", authorId: "owner" } });
 job.state = "paused"; job.appPaused = true; job.appBrowserId = crypto.randomUUID(); job.appComputer = { file: "old.png", scope: "public-browser" }; ledger.save();
 const remote = { read: async () => ({ title: "Form", text: "Submitted", url: "https://example.test" }), screenshot: async () => Buffer.from("png"), input: async () => {}, delete: async () => ({ deleted: true }) };
 return { ledger, config, job, remote, make: () => createAppComputer({ ledger, config, remote, sandbox: {} }) };
}
test("manual browser input journals before execution and cannot resend after capture failure or restart", async (t) => {
 const f = fixture(t); let inputs = 0;
 f.remote.input = async () => {
  inputs++;
  const disk = JSON.parse(fs.readFileSync(path.join(f.config.stateDir, "ledger.json")));
  assert.equal(Object.values(disk.jobs[f.job.id].effects).filter(e => e.state === "started").length, 1);
 };
 f.remote.screenshot = async () => { throw new Error("screen failed after submission"); };
 let computer = f.make();
 const body = { action: "key", key: "Enter", clientId: "press-1", screen: "old.png" };
 await assert.rejects(computer.route(`/computer/${f.job.id}`, "POST", body), /screen failed/);
 assert.equal(inputs, 1); assert.equal(f.job.state, "paused");
 const loaded = createLedger(path.join(f.config.stateDir, "ledger.json"));
 computer = createAppComputer({ ledger: loaded, config: f.config, remote: f.remote, sandbox: {} });
 await assert.rejects(computer.route(`/computer/${f.job.id}`, "POST", body), /uncertain/);
 await assert.rejects(computer.route(`/computer/${f.job.id}`, "POST", { ...body, clientId: "press-2" }), /uncertain/);
 assert.equal(inputs, 1);
 f.remote.screenshot = async () => Buffer.from("png");
 await computer.route(`/computer/${f.job.id}`, "POST", { action: "look" });
 assert.equal(inputs, 1); assert.equal(Object.keys(loaded.data.jobs[f.job.id].effects).length, 1);
});
test("completed manual input is idempotent and stays bound to the original screen and arguments", async (t) => {
 const f = fixture(t); let inputs = 0; f.remote.input = async () => { inputs++; };
 const computer = f.make(), body = { action: "key", key: "Enter", clientId: "press-1", screen: "old.png" };
 await computer.route(`/computer/${f.job.id}`, "POST", body);
 await computer.route(`/computer/${f.job.id}`, "POST", body);
 assert.equal(inputs, 1);
 await assert.rejects(computer.route(`/computer/${f.job.id}`, "POST", { ...body, key: "Tab" }), /different/);
});
test("cancelled remote capture cannot publish a fresh screen", async (t) => {
 const f = fixture(t); f.remote.screenshot = async () => { f.job.state = "cancelled"; return Buffer.from("png"); };
 await assert.rejects(f.make().act(f.job, { action: "look" }), /stopped/);
 assert.equal(f.job.appComputer.file, "old.png");
});
test("terminal browser cleanup frees profiles repeatedly while preserving paused takeover", async (t) => {
 const f = fixture(t); const deleted = [];
 f.remote.delete = async id => { deleted.push(id); return { deleted: true }; };
 const computer = f.make();
 await computer.cleanup(); assert.deepEqual(deleted, []);
 for (let n = 0; n < 25; n++) {
  const job = f.ledger.createJob(`app:task-${n}`, { kind: "command", role: "owner", replyChannel: "app", channelId: "app", source: { channelId: "app", authorId: "owner" } });
  job.state = n % 2 ? "done" : "cancelled"; job.appBrowserId = crypto.randomUUID(); job.appComputer = { file: "saved.png" };
  await computer.cleanup(); assert.equal(job.appBrowserId, undefined); assert.equal(job.appComputer.closed, true);
 }
 assert.equal(deleted.length, 25); assert.ok(f.job.appBrowserId);
});
test("read failure fences manual input until explicit owner inspection of a fresh screen", async (t) => {
 const f = fixture(t); let inputs = 0; f.remote.input = async () => { inputs++; };
 const read = f.remote.read; f.remote.read = async () => { throw new Error("read failed"); };
 const computer = f.make(), url = `/computer/${f.job.id}`, body = { action: "key", key: "Enter", clientId: "press-1", screen: "old.png" };
 await assert.rejects(computer.route(url, "POST", body), /read failed/);
 const effectId = Object.keys(f.job.effects)[0];
 await assert.rejects(computer.route(url, "POST", { action: "acknowledge", effectId, screen: "old.png" }), /Refresh/);
 f.remote.read = read; await computer.route(url, "POST", { action: "look" });
 await computer.route(url, "POST", { action: "acknowledge", effectId, screen: f.job.appComputer.file });
 assert.equal(f.job.effects[effectId].state, "inspected");
 await assert.rejects(computer.route(url, "POST", body), /uncertain or already inspected/);
 assert.equal(inputs, 1);
 await computer.route(url, "POST", { ...body, clientId: "press-2", screen: f.job.appComputer.file });
 assert.equal(inputs, 2);
});
test("failed browser deletion retains a durable cleanup receipt and retries safely", async (t) => {
 const f = fixture(t); f.job.state = "cancelled"; const browser = f.job.appBrowserId;
 f.remote.delete = async () => { throw new Error("lost delete response"); };
 await f.make().cleanup();
 assert.equal(f.job.appBrowserId, browser); assert.equal(f.job.computerCleanup.state, "started");
 f.remote.delete = async id => { assert.equal(id, browser); return { deleted: true }; };
 await f.make().cleanup(); assert.equal(f.job.appBrowserId, undefined); assert.equal(f.job.computerCleanup.state, "done");
});
test("opening a new browser waits for in-flight terminal cleanup to free its slot", async (t) => {
 const f = fixture(t); f.job.state = "done";
 let deleted, entered; const deleting = new Promise(resolve => { entered = resolve; });
 f.remote.delete = async () => { entered(); await new Promise(resolve => { deleted = resolve; }); };
 let opened = 0; f.remote.open = async () => { opened++; };
 const computer = f.make(), cleanup = computer.cleanup(); await deleting;
 const job = f.ledger.createJob("app:next", { kind: "command", role: "owner", replyChannel: "app", source: { channelId: "app" } }); job.state = "running";
 const opening = computer.act(job, { action: "open", url: "https://example.test" });
 await Promise.resolve(); assert.equal(opened, 0);
 deleted(); await cleanup; await opening; assert.equal(opened, 1);
});
test("cancelled uncertain browser survives cleanup until owner inspection", async (t) => {
 const f = fixture(t); let deleted = 0; f.remote.delete = async () => { deleted++; };
 const computer = f.make(), url = `/computer/${f.job.id}`;
 f.remote.screenshot = async () => { throw new Error("capture lost"); };
 await assert.rejects(computer.route(url, "POST", { action: "key", key: "Enter", clientId: "press-1", screen: "old.png" }), /capture lost/);
 f.job.state = "cancelled"; await computer.cleanup();
 assert.equal(deleted, 0); assert.ok(f.job.appBrowserId);
 const effectId = Object.keys(f.job.effects)[0];
 f.remote.screenshot = async () => Buffer.from("png");
 await computer.route(url, "POST", { action: "look" });
 await computer.route(url, "POST", { action: "acknowledge", effectId, screen: f.job.appComputer.file });
 await computer.cleanup(); assert.equal(deleted, 1);
});
test("legacy cancelled model effects require explicit discard before profile deletion", async (t) => {
 const f = fixture(t); let deleted = 0; f.remote.delete = async () => { deleted++; };
 f.job.state = "cancelled"; f.job.effects["action:old"] = { state: "started", at: 1 };
 const computer = f.make(), url = `/computer/${f.job.id}`;
 await computer.cleanup(); assert.equal(deleted, 0);
 assert.equal((await computer.route(url, "GET")).retainedForInspection, true);
 await assert.rejects(computer.route(url, "POST", { action: "key", key: "Enter", clientId: "new", screen: "old.png" }), /cancelled|inspection/);
 await computer.route(url, "POST", { action: "look" });
 await computer.route(url, "POST", { action: "discard", confirmDiscard: true, screen: f.job.appComputer.file });
 assert.equal(deleted, 1); assert.equal(f.job.effects["action:old"].state, "started");
 assert.ok(f.job.computerDiscarded);
});
