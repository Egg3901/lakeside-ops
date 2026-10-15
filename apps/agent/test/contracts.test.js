"use strict";
// Review 2026-10-13 (#71): coordinator, wait and release contracts the
// runtime wiring depends on.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCoordinator, ledgerStore } = require("../lib/operator/coordinator");
const { createWaitRegistry, ciKey } = require("../lib/operator/waits");
const { evaluateGates } = require("../lib/operator/release");
const { createLedger } = require("../lib/operator/store");
const { sourceDigest, v3Stale } = require("../lib/operator/workrecord");

test("new evidence during closure grace reopens a resolved record", () => {
  const c = createCoordinator({}, { now: () => 1 });
  c.close("ticket:5", { kind: "resolved", receiptId: "r1" });
  const r = c.accept({ id: "p1", workId: "ticket:5", kind: "evidence", actor: "player-1", role: "player" });
  assert.equal(r.reopened, true);
  assert.equal(c.get("ticket:5").state, "open");
  assert.equal(c.get("ticket:5").resolutions[0].receiptId, "r1");
  assert.equal(c.claim("ticket:5").claimed, true);
});

test("a cancelled record reopens only on an authorized instruction", () => {
  const c = createCoordinator({}, { now: () => 1 });
  c.close("ticket:6", { kind: "cancelled", receiptId: "x" });
  c.accept({ id: "p1", workId: "ticket:6", kind: "instruction", role: "player" });
  assert.equal(c.get("ticket:6").state, "cancelled");
  c.accept({ id: "o1", workId: "ticket:6", kind: "instruction", role: "owner" });
  assert.equal(c.get("ticket:6").state, "open");
});

test("a player message never supersedes running work", () => {
  const c = createCoordinator({}, { now: () => 1 });
  c.claim("ticket:7");
  c.accept({ id: "p1", workId: "ticket:7", kind: "instruction", actor: "player-1", role: "player" });
  c.accept({ id: "p2", workId: "ticket:7", kind: "instruction", actor: "player-1" }); // no role at all
  assert.equal(c.attemptsFor("ticket:7")[0].state, "running");
  c.accept({ id: "o1", workId: "ticket:7", kind: "instruction", role: "developer" });
  assert.equal(c.attemptsFor("ticket:7")[0].state, "superseded");
});

test("an old head's CI result cannot advance work after the PR moved, even unarmed", () => {
  const w = createWaitRegistry({}, { now: () => 1 });
  w.arm({ workId: "ticket:1", kind: "ci", correlation: ciKey("R", 7, "old"), deadlineMs: 1000 });
  // a new commit was pushed; nobody armed "new" yet
  assert.equal(w.observe(ciKey("R", 7, "old"), { terminal: true, result: "green", currentHead: "new" }).length, 0);
  assert.equal(w.all()[0].state, "superseded");
  w.arm({ workId: "ticket:1", kind: "ci", correlation: ciKey("R", 7, "new"), deadlineMs: 1000 });
  assert.throws(() => w.observe(ciKey("R", 7, "new"), { terminal: true }), /current head/);
});

test("a late CI result after a timeout advances the record, marked late", () => {
  let clock = 0;
  const w = createWaitRegistry({}, { now: () => clock });
  w.arm({ workId: "ticket:1", kind: "ci", correlation: ciKey("R", 8, "h"), deadlineMs: 10 });
  clock = 20; w.sweep();
  const advanced = w.observe(ciKey("R", 8, "h"), { terminal: true, result: "green", currentHead: "h" });
  assert.equal(advanced.length, 1);
  assert.equal(advanced[0].late, true);
  assert.equal(w.observe(ciKey("R", 8, "h"), { terminal: true, currentHead: "h" }).length, 0);
});

test("deploy gates accept a later SHA that contains the head and fail one that does not", () => {
  const e = { promotionHeadSha: "head", ciHeadSha: "head", ciGreen: true,
    stagingDeployedSha: "merge-staging", prodWebSha: "later-main", turnWorkerSha: "older" };
  const contains = (sha) => ({ "merge-staging": true, "later-main": true, older: false })[sha];
  const r = evaluateGates(e, { contains });
  assert.equal(r.gates.staging.status, "pass");
  assert.equal(r.gates.prodWeb.status, "pass");
  assert.equal(r.gates.worker.status, "fail");
  // no ancestry answer: different SHA is unknown, not pass
  assert.equal(evaluateGates(e).gates.prodWeb.status, "unknown");
});

test("coordinator state persists in the ledger and survives a crash mid-attempt", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-coord-"));
  const file = path.join(dir, "ledger.json");
  let clock = 1000;
  const ledger = createLedger(file);
  const c = createCoordinator(ledgerStore(ledger), { now: () => clock, leaseMs: 5000, onChange: ledger.save });
  c.accept({ id: "e1", workId: "ticket:3", kind: "instruction", role: "owner" });
  const { attempt } = c.claim("ticket:3");
  c.checkpoint(attempt.id, "patch prepared");
  // process dies here; a new process reads the file
  const reborn = createLedger(file);
  clock = 10000;
  const c2 = createCoordinator(ledgerStore(reborn), { now: () => clock, leaseMs: 5000, onChange: reborn.save });
  assert.equal(c2.accept({ id: "e1", workId: "ticket:3", kind: "instruction" }).duplicate, true);
  assert.deepEqual(c2.reconcile().interrupted, [attempt.id]);
  assert.equal(c2.attemptsFor("ticket:3")[0].checkpoint.note, "patch prepared");
  // ids keep increasing across restarts and pruning
  delete ledgerStore(reborn).attempts[attempt.id];
  assert.notEqual(c2.claim("ticket:3").attempt.id, attempt.id);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 1); // still the 2.x envelope
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the event dedupe window is bounded", () => {
  let clock = 0;
  const store = {};
  const c = createCoordinator(store, { now: () => clock, eventTtlMs: 100 });
  c.accept({ id: "old", workId: "ticket:1", kind: "note" });
  clock = 1000;
  c.accept({ id: "new", workId: "ticket:1", kind: "note" });
  assert.deepEqual(Object.keys(store.seenEvents), ["new"]);
});

test("a migrated v3 snapshot reports stale once the 2.x binary writes again", () => {
  const data = { version: 1, jobs: { j1: { id: "j1", state: "queued", at: 1 } }, actions: {}, decisions: {} };
  data.v3 = { records: {}, sourceDigest: sourceDigest(data) };
  assert.equal(v3Stale(data), false);
  data.jobs.j1.state = "running"; data.jobs.j1.updatedAt = 2;
  assert.equal(v3Stale(data), true);
});
