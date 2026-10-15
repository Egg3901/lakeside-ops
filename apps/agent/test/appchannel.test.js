"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createLedger } = require("../lib/operator/store");
const { createConversation } = require("../lib/operator/conversation");
const { createAppChannel, createAuthenticator, createAppServer, isAppJob, ownerIdentity } = require("../lib/operator/appchannel");

const config = { ownerId: "333052320252297216", botId: "1479984768194969663", staffIds: ["2"], taskLifetimeMs: 3600000 };
function setup() {
  const ledger = createLedger(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "keir-app-")), "ledger.json"));
  const conversation = createConversation({ ledger, config });
  let drained = 0;
  const app = createAppChannel({ ledger, config, conversation, drain: () => drained++ });
  return { ledger, conversation, app, drained: () => drained };
}

test("an app request is an owner-directed command with an app reply channel", () => {
  const { ledger, app, drained } = setup();
  const r = app.post("Merge the green dev PR for the bond fix", "c1");
  const job = ledger.data.jobs[r.jobId];
  assert.equal(job.kind, "command"); assert.equal(job.role, "owner"); assert.equal(job.actorId, config.ownerId);
  assert.equal(job.source.authorId, config.ownerId); assert.equal(job.replyChannel, "app"); assert.equal(job.source.channelId, "app");
  assert.ok(isAppJob(job)); assert.equal(job.needsAck, true); assert.equal(drained(), 1);
  assert.equal(app.view().messages[0].role, "owner");
});

test("a plain question takes the quick conversation lane and follow-ups join the live task", () => {
  const { ledger, app } = setup();
  const a = app.post("What turn is it?"), b = app.post("what mode?");
  assert.equal(ledger.data.jobs[a.jobId].kind, "conversation");
  assert.equal(b.jobId, a.jobId); assert.equal(ledger.data.jobs[a.jobId].inbox.length, 1);
});

test("a retried send with the same client id is not a second request", () => {
  const { ledger, app } = setup();
  const a = app.post("Fix ticket 1540", "same"), b = app.post("Fix ticket 1540", "same");
  assert.equal(b.duplicate, true); assert.equal(b.jobId, a.jobId);
  assert.equal(Object.keys(ledger.data.jobs).length, 1); assert.equal(app.view().messages.length, 1);
});

test("empty text is refused", () => {
  const { app } = setup();
  assert.throws(() => app.post("   "), /empty/);
});

test("the ack is a status line, progress edits it and the answer replaces it", () => {
  const { ledger, app, conversation } = setup();
  const { jobId } = app.post("Investigate the ledger drift");
  const job = ledger.data.jobs[jobId]; job.state = "running";
  assert.deepEqual(app.deliver(`ack:${jobId}`, { content: "Checking the ledger now" }, job), [`app-status-${jobId}`]);
  assert.equal(app.view().tasks[0].status, "Checking the ledger now");
  app.updateStatus(job, "Found two drifted accounts");
  assert.equal(app.view().tasks[0].status, "Found two drifted accounts");
  app.deliver(`channel-reply:${jobId}:x`, { content: "Two accounts drifted — healed. token ahdk_abcdefghijklmnop" }, job);
  const v = app.view();
  assert.equal(v.messages.at(-1).role, "keir"); assert.match(v.messages.at(-1).text, /drifted , healed/); assert.match(v.messages.at(-1).text, /\[redacted\]/);
  assert.equal(v.tasks[0].status, null); assert.equal(job.progressMessageId, undefined);
  assert.equal(conversation.snapshot(job).messages.length, 2);
});

test("only Keir's own chart files ride along", () => {
  const { ledger, app } = setup();
  const { jobId } = app.post("Chart the bond yields");
  const job = ledger.data.jobs[jobId];
  app.deliver(`chart:${jobId}:a`, { content: "Yields", chart: true, files: [{ path: "/var/lib/keir-operator/artifacts/chart-abcdefabcdef-012345012345.png" }] }, job);
  app.deliver(`chart:${jobId}:b`, { content: "Other", chart: true, files: [{ path: "/etc/passwd" }] }, job);
  const [a, b] = app.view().messages.slice(-2);
  assert.equal(a.chart, "chart-abcdefabcdef-012345012345.png"); assert.equal(b.chart, undefined);
});

test("cancel stops only app tasks", () => {
  const { ledger, app } = setup();
  const { jobId } = app.post("Run the promote chain");
  assert.equal(app.cancel(jobId).state, "cancelled");
  const other = ledger.createJob("x", { kind: "command", role: "owner", channelId: "1", replyChannel: "1", source: { channelId: "1" } });
  assert.throws(() => app.cancel(other.id), /unknown task/);
  assert.equal(app.view().tasks.length, 0);
});

test("the version changes when a task status changes", () => {
  const { ledger, app } = setup();
  const { jobId } = app.post("Investigate turn time");
  const v1 = app.view().version;
  ledger.data.jobs[jobId].state = "running";
  assert.notEqual(app.view().version, v1);
});

function authResponse(status, headers) { return { status, headers: { get: (k) => headers[k.toLowerCase()] ?? null } }; }
test("only the owner's admin ops session authenticates", async () => {
  const sessions = { ownersession0000001: ["admin", ownerIdentity(config)], ariane0000000000001: ["admin", "arlebina@ahousedivided.local"], mod00000000000000001: ["moderator", ownerIdentity(config)] };
  let calls = 0;
  const auth = createAuthenticator({ config, checkUrl: "http://check", fetchImpl: async (_u, opts) => {
    calls++; const token = /ops_session=(.+)/.exec(opts.headers.cookie)[1]; const s = sessions[token];
    return s ? authResponse(200, { "x-auth-role": s[0], "x-auth-user": s[1] }) : authResponse(401, {});
  } });
  const req = (cookie, extra = {}) => ({ headers: { cookie, ...extra } });
  assert.equal(await auth(req("ops_session=ownersession0000001")), "owner");
  assert.equal(await auth(req("ops_session=ownersession0000001")), "owner"); assert.equal(calls, 1);
  assert.equal(await auth(req("ops_session=ariane0000000000001")), "staff");
  assert.equal(await auth(req("ops_session=mod00000000000000001")), false);
  assert.equal(await auth(req("")), false);
  // A forged identity header proves nothing; only the dashboard's answer counts.
  assert.equal(await auth(req("ops_session=nobody0000000000001", { "x-auth-user": ownerIdentity(config), "x-auth-role": "admin" })), false);
});

test("the HTTP surface refuses strangers and serves the owner's thread", async () => {
  const { app } = setup();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-art-"));
  fs.writeFileSync(path.join(dir, "chart-abcdefabcdef-012345012345.png"), "png");
  const server = createAppServer({ app, artifactsDir: dir, pollMs: 10, authenticate: async (req) => req.headers.cookie === "ops_session=good" ? "owner" : req.headers.cookie === "ops_session=staff" ? "staff" : false });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/api/keir/app`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/thread`)).status, 401);
    assert.equal((await fetch(`${base}/thread`, { headers: { cookie: "ops_session=staff" } })).status, 403);
    const headers = { cookie: "ops_session=good", "content-type": "application/json" };
    const sent = await fetch(`${base}/messages`, { method: "POST", headers, body: JSON.stringify({ text: "What turn is it?", clientId: "k1" }) });
    assert.equal(sent.status, 201);
    const thread = await (await fetch(`${base}/thread`, { headers })).json();
    assert.equal(thread.messages.length, 1); assert.equal(thread.cursor, 1);
    const started = Date.now();
    const waited = await (await fetch(`${base}/thread?after=1&wait=1&since=${thread.version}`, { headers })).json();
    assert.ok(Date.now() - started >= 900); assert.equal(waited.messages.length, 0);
    const img = await fetch(`${base}/artifacts/chart-abcdefabcdef-012345012345.png`, { headers });
    assert.equal(img.status, 200); assert.equal(img.headers.get("content-type"), "image/png");
    assert.equal((await fetch(`${base}/artifacts/..%2Fledger.json`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/messages`, { method: "POST", headers, body: "{}" })).status, 400);
  } finally { server.close(); }
});

const { duePushes, createAppPush } = require("../lib/operator/apppush");
test("decisions are answered through the shared decision path", async () => {
  const { ledger, conversation } = setup();
  const calls = [];
  const app = createAppChannel({ ledger, config, conversation, decisions: () => ({ apply: async (x, verdict, actor, text) => { calls.push([x.id, verdict, actor, text]); x.state = verdict; } }) });
  ledger.data.decisions = { abcdefabcdef: { id: "abcdefabcdef", jobId: "j", question: "Merge PR 4180?", state: "pending", at: 1, sent: {} } };
  assert.equal(app.pendingDecisions().length, 1);
  await assert.rejects(app.answer("abcdefabcdef", "explain", " "), /say what/);
  assert.deepEqual(await app.answer("abcdefabcdef", "approve"), { id: "abcdefabcdef", state: "approve" });
  assert.deepEqual(calls, [["abcdefabcdef", "approve", config.ownerId, ""]]);
  assert.equal(ledger.data.decisions.abcdefabcdef.answeredVia, "app");
  await assert.rejects(app.answer("abcdefabcdef", "reject"), /already approve/);
  await assert.rejects(app.answer("000000000000", "approve"), /unknown decision/);
});

test("device registration validates tokens and keeps the last five", () => {
  const { app, ledger } = setup();
  assert.throws(() => app.register("nope"), /invalid device token/);
  for (let i = 0; i < 7; i++) app.register(String(i).repeat(64), { incidents: false });
  const devices = ledger.data.appThread.devices;
  assert.equal(devices.length, 5); assert.equal(devices.at(-1).prefs.incidents, false); assert.equal(devices.at(-1).prefs.replies, true);
});

test("pushes cover new Keir replies, open decisions and Watchkeeper incidents once each", () => {
  const { app, ledger } = setup();
  const d = ledger.data;
  duePushes(d, { now: 1000 }).forEach((p) => p.mark());
  const { jobId } = app.post("What turn is it?");
  app.deliver(`channel-reply:${jobId}:x`, { content: "Turn 202." }, d.jobs[jobId]);
  d.decisions = { aaaaaaaaaaaa: { id: "aaaaaaaaaaaa", question: "Promote to main?", state: "pending", at: 2000 } };
  d.alerts = [{ key: "error:watch-recurring:turn", content: "Turn warning again", at: 3000 }, { key: "digest:2026-10-15", content: "digest", at: 3000 }];
  const due = duePushes(d, { now: 4000 });
  assert.deepEqual(due.map((p) => p.pref), ["replies", "decisions", "incidents"]);
  assert.equal(due[0].payload.aps.alert.body, "Turn 202.");
  assert.equal(due[1].payload.aps["interruption-level"], "time-sensitive");
  due.forEach((p) => p.mark());
  assert.equal(duePushes(d, { now: 5000 }).length, 0);
});

test("push respects preferences and drops dead device tokens", async () => {
  const { app, ledger } = setup();
  app.register("a".repeat(64), { replies: false }); app.register("b".repeat(64));
  const sent = [];
  const push = createAppPush({ ledger, apns: { send: async (token, payload) => { sent.push([token[0], payload.route]); return token[0] === "b" ? { status: 410, reason: "Unregistered" } : { status: 200 }; } } });
  ledger.data.appThread.push = { seq: 0, decisions: {}, alerts: {}, since: 0 };
  const { jobId } = app.post("What mode?");
  app.deliver(`finish:${jobId}:1`, { content: "Live mode." }, ledger.data.jobs[jobId]);
  await push.tick();
  assert.deepEqual(sent, [["b", "keir"]]);
  assert.deepEqual(ledger.data.appThread.devices.map((x) => x.token[0]), ["a"]);
});

test("temporary dashboard auth failures are unavailable, not a forced sign-out", async () => {
  const auth = createAuthenticator({ config, checkUrl: "http://check", fetchImpl: async () => { throw new Error("connection reset"); } });
  await assert.rejects(auth({ headers: { cookie: "ops_session=ownersession0000001" } }), (e) => e.status === 503);
});

test("a transient APNs failure retains the notification for retry", async () => {
  const { app, ledger } = setup();
  app.register("a".repeat(64));
  ledger.data.appThread.push = { seq: 0, decisions: {}, alerts: {}, since: 0 };
  const { jobId } = app.post("What mode?");
  app.deliver(`finish:${jobId}:1`, { content: "Live mode." }, ledger.data.jobs[jobId]);
  let calls = 0;
  const push = createAppPush({ ledger, apns: { send: async () => ({ status: ++calls === 1 ? 503 : 200 }) } });
  await push.tick();
  assert.equal(duePushes(ledger.data).filter((p) => p.pref === "replies").length, 1, "failed push must remain due");
  await push.tick();
  assert.equal(calls, 2);
  assert.equal(duePushes(ledger.data).filter((p) => p.pref === "replies").length, 0);
});

test("retrying one phone does not send another copy to a phone that already accepted it", async () => {
  const { app, ledger } = setup();
  app.register("a".repeat(64)); app.register("b".repeat(64));
  ledger.data.appThread.push = { seq: 0, decisions: {}, alerts: {}, since: 0 };
  const { jobId } = app.post("What mode?");
  app.deliver(`finish:${jobId}:1`, { content: "Live mode." }, ledger.data.jobs[jobId]);
  const calls = [];
  let failed = false;
  const push = createAppPush({ ledger, apns: { send: async (token) => { calls.push(token[0]); if (token[0] === "b" && !failed) { failed = true; return { status: 503 }; } return { status: 200 }; } } });
  await push.tick(); await push.tick();
  assert.deepEqual(calls, ["a", "b", "b"]);
});

function sensorAlert(episode, at, lastSuccessAt) {
  return { key: `recovery:watchkeeper:digest-${episode}`, at, content: `Watchkeeper: operator observation unavailable. ${JSON.stringify({ status: "active", incidentKey: `sensor:operator:${episode}`, error: "Watchkeeper request deadline exceeded", lastSuccessAt })}` };
}
test("brief Watchkeeper sensor timeouts do not produce lock-screen notifications", () => {
  const { ledger } = setup();
  ledger.data.appThread = { seq: 0, messages: [], push: { seq: 0, decisions: {}, alerts: {}, since: 0 } };
  ledger.data.alerts = [sensorAlert(1, 1000000, 940000)];
  assert.equal(duePushes(ledger.data, { now: 1000000 }).filter((p) => p.pref === "incidents").length, 0);
});
test("Watchkeeper episode counters are grouped and raw diagnostic JSON stays out of pushes", async () => {
  const { ledger, app } = setup();
  app.register("a".repeat(64));
  ledger.data.appThread.push = { seq: 0, decisions: {}, alerts: {}, since: 0 };
  ledger.data.alerts = [sensorAlert(20, 1000000, 600000), sensorAlert(21, 1001000, 600000)];
  const sent = [];
  const push = createAppPush({ ledger, now: () => 1002000, apns: { send: async (_token, payload, options) => { sent.push({ payload, options }); return { status: 200 }; } } });
  await push.tick(); await push.tick();
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0].payload.aps.alert.body, /incidentKey|lastSuccessAt|\{/);
  assert.match(sent[0].payload.aps.alert.body, /Monitoring/);
  assert.equal(sent[0].options.collapseId, "watchkeeper:sensor:operator");
});
