"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createAppUpdates, COALESCE_MS, MIN_GAP_MS, URGENT_GAP_MS } = require("../lib/operator/appupdates");
const { duePushes } = require("../lib/operator/apppush");
const { createControls } = require("../lib/operator/appcontrols");

const ticketJob = (extra = {}) => ({ id: "t1", kind: "ticket", role: "support", ticket: 1574, state: "waiting", at: 1, updatedAt: 1, wakeAt: Date.now() + 3600000, effects: {}, source: { content: "New ticket intake; read support_get" }, ...extra });
function world(jobs = [ticketJob()]) {
  const data = { jobs: Object.fromEntries(jobs.map(j => [j.id, j])), channels: {}, actions: {}, decisions: {}, statusCards: {}, appThread: { seq: 0, messages: [], status: {}, clients: {} } };
  let saves = 0; const audits = [];
  return { data, ledger: { data, save() { saves++; }, audit(k, v) { audits.push([k, v]); } }, saves: () => saves, audits };
}
const card = (data, ticket, name, stage, extra = {}) => { (data.statusCards[ticket] ||= { items: [] }).items = [...(data.statusCards[ticket]?.items || []).filter(i => i.name !== name), { name, stage, note: "", ...extra }]; };

test("the first scan is a silent baseline, so a restart never replays history", () => {
  const w = world(); card(w.data, 1574, "California steel sales", "tested");
  let now = 1000; const u = createAppUpdates({ ledger: w.ledger, now: () => now });
  assert.equal(u.tick().baseline, true);
  now += COALESCE_MS * 5; u.tick();
  assert.equal(w.data.appThread.messages.length, 0);
});

test("a fix moving a stage and a new PR post one coalesced update with a PR card", () => {
  const w = world(); card(w.data, 1574, "California steel sales", "found");
  let now = 1000; const u = createAppUpdates({ ledger: w.ledger, now: () => now }); u.tick();
  card(w.data, 1574, "California steel sales", "written", { note: "Patch ready" });
  w.data.jobs.t1.pullRequests = ["https://github.com/lakesidegamedev/AHDGame/pull/4299"];
  now += 20000; assert.equal(u.tick().posted, null, "a burst settles before posting");
  now += COALESCE_MS; const m = u.tick().posted;
  assert.equal(m.update, true); assert.equal(m.thread, "main"); assert.equal(m.role, "keir");
  assert.match(m.text, /Ticket 1574, California steel sales: now fix written\. Patch ready\./);
  assert.match(m.text, /opened PR #4299 in lakesidegamedev\/AHDGame/);
  assert.deepEqual(m.cards, [{ type: "pr", repository: "lakesidegamedev/AHDGame", number: 4299, url: "https://github.com/lakesidegamedev/AHDGame/pull/4299" }]);
  assert.equal(m.items.length, 2); assert.doesNotMatch(m.text, /[–—]/);
});

test("routine updates keep a minimum gap, while a needed decision goes out quickly", () => {
  const w = world(); card(w.data, 1574, "Steel", "found");
  let now = 1000; const u = createAppUpdates({ ledger: w.ledger, now: () => now }); u.tick();
  card(w.data, 1574, "Steel", "written"); now += COALESCE_MS; u.tick(); now += COALESCE_MS; assert.ok(u.tick() && w.data.appThread.messages.length === 1);
  card(w.data, 1574, "Steel", "tested"); now += 20000; u.tick(); now += COALESCE_MS; u.tick();
  assert.equal(w.data.appThread.messages.length, 1, "second routine update waits for the gap");
  w.data.decisions.x = { id: "x", jobId: "t1", state: "pending", question: "Refund the player?" };
  now += URGENT_GAP_MS; u.tick();
  assert.equal(w.data.appThread.messages.length, 2);
  const m = w.data.appThread.messages[1];
  assert.match(m.text.split("\n")[0], /needs your decision\. Refund the player\?/, "urgent lines lead");
  assert.match(m.text, /now tested on development/, "pending routine lines ride along");
  now += MIN_GAP_MS; u.tick(); assert.equal(w.data.appThread.messages.length, 2);
});

test("a ticket's own fix line replaces the generic pick-up line, and later stages replace earlier ones", () => {
  const w = world([]);
  let now = 1000; const u = createAppUpdates({ ledger: w.ledger, now: () => now }); u.tick();
  w.data.jobs.t1 = ticketJob({ updatedAt: now }); card(w.data, 1574, "Steel", "found");
  now += 20000; u.tick(); card(w.data, 1574, "Steel", "written"); now += 20000; u.tick();
  now += COALESCE_MS; const m = u.tick().posted;
  assert.doesNotMatch(m.text, /picked up/); assert.equal(m.items.length, 1); assert.match(m.text, /now fix written/);
});

test("app-started work, quick conversations and probes are not repeated as updates", () => {
  const w = world([]);
  let now = 1000; const u = createAppUpdates({ ledger: w.ledger, now: () => now }); u.tick();
  w.data.jobs.a = { id: "a", kind: "command", role: "owner", state: "running", replyChannel: "app", source: { channelId: "app", content: "Do X" }, effects: {} };
  w.data.jobs.c = { id: "c", kind: "conversation", role: "owner", state: "running", source: { content: "hi" }, effects: {} };
  w.data.jobs.p = { id: "p", kind: "command", internalProbe: true, state: "running", source: { content: "probe" }, effects: {} };
  now += 20000; u.tick(); now += MIN_GAP_MS; u.tick();
  assert.equal(w.data.appThread.messages.length, 0); assert.equal(u.board().open, 0);
});

test("finished work reports its summary and the owner can turn updates off", () => {
  const w = world([ticketJob({ state: "running" })]);
  let now = 1000; const u = createAppUpdates({ ledger: w.ledger, now: () => now }); u.tick();
  w.data.appThread.preferences = { main: { updates: false } };
  w.data.jobs.t1.state = "done"; w.data.jobs.t1.summary = "Explained the sales cap to the player.";
  now += MIN_GAP_MS; u.tick(); now += MIN_GAP_MS; u.tick();
  assert.equal(w.data.appThread.messages.length, 0);
  assert.deepEqual(w.data.appThread.updates.pending, []);
  w.data.appThread.preferences.main.updates = true;
  w.data.jobs.t2 = ticketJob({ id: "t2", ticket: 1580, state: "running" }); now += 20000; u.tick();
  w.data.jobs.t2.state = "done"; w.data.jobs.t2.summary = "Bid rejection explained"; now += 20000; u.tick(); now += COALESCE_MS; u.tick();
  assert.match(w.data.appThread.messages.at(-1).text, /Ticket 1580: finished\. Bid rejection explained\./);
});

test("the working-now board ranks what needs the owner first and shows one row per ticket", () => {
  const w = world([ticketJob({ id: "a", state: "running" }), ticketJob({ id: "b", state: "waiting" }), ticketJob({ id: "c", ticket: 1580, state: "running" })]);
  w.data.decisions.x = { id: "x", jobId: "b", state: "pending", question: "Which fix?" };
  const u = createAppUpdates({ ledger: w.ledger, now: () => 5000 }); u.tick();
  const b = u.board();
  assert.equal(b.open, 3); assert.equal(b.needsYou, 1); assert.equal(b.working, 2);
  assert.deepEqual(b.items.map(i => [i.ticket, i.state]), [[1574, "needs-you"], [1580, "working"]]);
});

test("update pushes are quiet and collapse into one notice", () => {
  const d = { appThread: { seq: 2, messages: [{ seq: 1, role: "keir", text: "Reply", thread: "main" }, { seq: 2, role: "keir", text: "- Ticket 1574: finished.", thread: "main", update: true }], push: { seq: 0, decisions: {}, alerts: {}, since: 0 } }, decisions: {}, alerts: [] };
  const [reply, update] = duePushes(d, { now: 10 });
  assert.equal(reply.payload.aps["interruption-level"], "active");
  assert.equal(update.collapseId, "keir-updates");
  assert.equal(update.payload.aps["interruption-level"], "passive");
  assert.equal(update.payload.aps.sound, undefined);
  assert.equal(update.payload.aps.alert.body, "Ticket 1574: finished.");
});

test("progress updates are a main conversation preference", () => {
  const data = { jobs: {}, appThread: { seq: 0, messages: [], status: {}, clients: {}, threads: { side: { id: "side" } } } };
  const controls = createControls({ ledger: { data, save() {}, audit() {} }, config: {} });
  assert.equal(controls.view().updates, true);
  controls.update({ action: "configure", updates: false });
  assert.equal(controls.view().updates, false);
  assert.throws(() => controls.update({ action: "configure", thread: "side", updates: true }), /main conversation/);
  assert.throws(() => controls.update({ action: "configure", updates: "no" }), /main conversation/);
});

test("each board row and update line says where the app can open it", () => {
  const w = world([ticketJob({ state: "running" }), { id: "o", kind: "command", role: "owner", state: "running", source: { channelId: "dm", content: "Audit CI" }, effects: {} }, { id: "f", kind: "finding", role: "support", state: "running", source: { content: "Turn warning" }, effects: {} }]);
  let now = 1000; const u = createAppUpdates({ ledger: w.ledger, now: () => now }); u.tick();
  assert.deepEqual(Object.fromEntries(u.board().items.map(i => [i.id, i.link])), { t1: "ticket", o: "task", f: "activity" });
  w.data.jobs.o.state = "done"; w.data.jobs.o.summary = "CI audited"; now += COALESCE_MS; u.tick(); now += COALESCE_MS; u.tick();
  assert.equal(w.data.appThread.messages[0].items[0].link, "task");
  assert.match(w.data.appThread.messages[0].text, /Audit CI: finished\. CI audited\./);
});
