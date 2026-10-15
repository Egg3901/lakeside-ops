"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createLedger } = require("../lib/operator/store");
const { createAppChannel, createAppServer } = require("../lib/operator/appchannel");
const { applyModel } = require("../lib/operator/appmodels");
const { createAppPush } = require("../lib/operator/apppush");
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-controls-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ledger = createLedger(path.join(dir, "ledger.json"));
  const config = { ownerId: "333052320252297216", botId: "1479984768194969663", taskLifetimeMs: 3600000, model: "conversation-model", codingProvider: "codex:coding-model@low", investigatorProvider: "muse:investigator-model@medium", workerProvider: "claude:coordinator-model@high" };
  const app = createAppChannel({ ledger, config }); return { dir, ledger, config, app };
}
test("kill switch persists, cancels all roles and publications, and Start cannot resurrect them", t => {
  const { ledger, app, dir } = setup(t);
  const { jobId } = app.authenticatedPost("Investigate repository", "new");
  ledger.data.jobs[jobId].state = "running";
  const support = ledger.createJob("support", { role: "support", kind: "ticket" });
  ledger.notify("queued-publication", "owner", "a pending message");
  app.controls.update({ action: "stop" });
  const saved = createLedger(path.join(dir, "ledger.json"));
  assert.equal(saved.data.paused, true); assert.equal(saved.data.jobs[jobId].state, "cancelled");
  assert.equal(saved.data.jobs[support.id].state, "cancelled"); assert.ok(saved.data.outbox["queued-publication"].skipped);
  assert.throws(() => app.authenticatedPost("New work", "blocked"), /stopped/);
  app.authenticatedPost("/start", "start");
  assert.equal(ledger.data.paused, false); assert.equal(ledger.data.jobs[jobId].state, "cancelled");
  assert.ok(app.authenticatedPost("New work", "fresh").jobId);
});
test("role routes stay separate, reach delegated children, and task overrides are scoped", t => {
  const { ledger, app, config } = setup(t);
  app.controls.update({ action: "configure", routes: { conversation: "claude:conversation-model", coding: "codex:coding-model@low", investigation: "muse:investigator-model@medium" } });
  const root = ledger.data.jobs[app.authenticatedPost("Investigate repository").jobId];
  const child = ledger.createJob("child", { role: "owner", codingParent: root.id, kind: "coding" });
  const investigation = ledger.createJob("investigate", { role: "owner", codingParent: root.id, kind: "coding", investigation: true });
  applyModel(child, config, ledger, "worker"); applyModel(investigation, config, ledger, "worker");
  assert.equal(child.provider.model, "coding-model"); assert.equal(investigation.provider.model, "investigator-model");
  app.controls.update({ action: "configure", taskId: root.id, routes: { coding: "muse:investigator-model@medium" } });
  applyModel(child, config, ledger, "worker"); assert.equal(child.provider.runner, "muse");
  const support = ledger.createJob("support", { role: "support", kind: "ticket" });
  applyModel(support, config, ledger, "worker"); assert.equal(support.provider, undefined);
  assert.throws(() => app.controls.update({ action: "configure", taskId: support.id, routes: { coding: "auto" } }), /Unknown active owner/);
});
test("invalid preferences fail atomically and settings wake long polls", t => {
  const { app, ledger } = setup(t); const before = app.view().version;
  assert.throws(() => app.controls.update({ action: "configure", approvalMode: "yolo", skills: { coding: ["../../private"] } }), /unavailable/);
  assert.equal(app.controls.view().approvalMode, "ask");
  app.controls.update({ action: "configure", skills: { coding: [] } });
  assert.notEqual(app.view().version, before); assert.deepEqual(ledger.data.appThread.preferences.main.skills.coding, []);
  assert.throws(() => app.controls.update({ action: "configure", routes: { coding: "invented:model" } }), /not available/);
});
test("shared commands are local controls, deduplicate retries and never call a provider", t => {
  const { app, ledger } = setup(t);
  const a = app.authenticatedPost("/approval yolo", "same"), b = app.authenticatedPost("/approval yolo", "same");
  assert.equal(a.command, true); assert.equal(b.duplicate, true);
  assert.equal(app.controls.view().approvalMode, "yolo"); assert.equal(Object.keys(ledger.data.jobs).length, 0);
  assert.match(app.authenticatedPost("/model", "model").text, /conversation:/);
});
test("control writes are unavailable without owner authentication", async t => {
  const { app, dir } = setup(t);
  const server = createAppServer({ app, artifactsDir: dir, authenticate: async req => req.headers.authorization === "owner" ? "owner" : "staff" });
  await new Promise(r => server.listen(0, "127.0.0.1", r)); t.after(() => new Promise(r => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/api/keir/app/controls`;
  const write = auth => fetch(url, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }) });
  assert.equal((await write("staff")).status, 403); assert.equal(app.controls.view().stopped, false);
  assert.equal((await write("owner")).status, 200); assert.equal(app.controls.view().stopped, true);
});
test("Live Activity updates use separate tokens, end on stop, and contain no task content", async t => {
  const { app, ledger } = setup(t); const calls = [];
  const push = createAppPush({ ledger, apns: { send: async (...args) => { calls.push(args); return { status: 200 }; } } });
  app.authenticatedPost("Investigate private fixture data", "fixture"); app.registerActivity("a".repeat(64), "activity-1");
  await push.tick(); assert.equal(calls[0][2].pushType, "liveactivity");
  assert.equal(calls[0][1].aps.event, "update"); assert.ok(!JSON.stringify(calls).includes("private fixture"));
  app.controls.update({ action: "stop" }); await push.tick();
  assert.equal(calls.at(-1)[1].aps.event, "end"); assert.equal(ledger.data.appThread.activities.length, 0);
});
