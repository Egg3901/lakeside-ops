"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCoordinator } = require("../lib/operator/coordinator");
const { createWaitRegistry, ciKey, turnKey } = require("../lib/operator/waits");

function setup() {
  let clock = 1000;
  const store = {};
  return { store, c: createCoordinator(store, { now: () => clock, leaseMs: 5000 }),
    tick: (ms) => { clock += ms; }, now: () => clock };
}

test("duplicate events are accepted once and never double-apply", () => {
  const { c } = setup();
  const e = { id: "m1", workId: "ticket:1", kind: "instruction" };
  assert.equal(c.accept(e).accepted, true);
  assert.equal(c.accept(e).duplicate, true);
  assert.equal(c.get("ticket:1").instructions.length, 1);
});

test("only one mutating attempt holds the lease; read-only can run beside it", () => {
  const { c } = setup();
  assert.equal(c.claim("ticket:1").claimed, true);
  assert.equal(c.claim("ticket:1").claimed, false);
  assert.equal(c.claim("ticket:1", { mutating: false }).claimed, true);
});

test("a newer instruction supersedes the running attempt but keeps its evidence", () => {
  const { c } = setup();
  const { attempt } = c.claim("ticket:1"); // attempt still running
  c.accept({ id: "m2", workId: "ticket:1", kind: "instruction", role: "owner" });
  assert.equal(c.attemptsFor("ticket:1")[0].state, "superseded");
  const late = c.complete(attempt.id, "succeeded", [{ text: "late" }]);
  assert.equal(late.applied, false); // superseded work cannot rewrite the record
  assert.equal(c.claim("ticket:1").claimed, true); // lease was released
});

test("waiting releases the lease so CI never blocks other work", () => {
  const { c } = setup();
  const { attempt } = c.claim("ticket:1");
  c.wait("ticket:1", { attemptId: attempt.id }); // the attempt parks the record itself
  assert.equal(c.claim("ticket:1").claimed, true);
});

test("process death at the lease boundary recovers as interrupted with checkpoint", () => {
  const t = setup();
  const { attempt } = t.c.claim("ticket:1");
  t.c.checkpoint(attempt.id, "verified cause, patch not yet published");
  attempt.uncertainEffect = "publish:pr";
  t.tick(6000);
  const r = t.c.reconcile();
  assert.deepEqual(r.interrupted, [attempt.id]);
  assert.equal(r.uncertain[0].effect, "publish:pr");
  assert.equal(t.c.attemptsFor("ticket:1")[0].checkpoint.note, "verified cause, patch not yet published");
  assert.equal(t.c.get("ticket:1").nextAction, "resume-or-block");
});

test("closing requires a receipt", () => {
  const { c } = setup();
  assert.throws(() => c.close("ticket:1", {}), /receipt/);
  c.close("ticket:1", { kind: "resolved", receiptId: "r1" });
  assert.equal(c.claim("ticket:1").claimed, false);
});

test("waits: a new PR head supersedes the old wait and stale results stay history", () => {
  let clock = 0; const store = {};
  const w = createWaitRegistry(store, { now: () => clock });
  w.arm({ workId: "ticket:1", kind: "ci", correlation: ciKey("R", 7, "sha1"), deadlineMs: 1000 });
  w.arm({ workId: "ticket:1", kind: "ci", correlation: ciKey("R", 7, "sha2"), deadlineMs: 1000 });
  const all = w.all();
  assert.equal(all.find((x) => x.correlation.endsWith("sha1")).state, "superseded");
  assert.equal(w.observe(ciKey("R", 7, "sha1"), { terminal: true, currentHead: "sha2" }).length, 0);
  assert.equal(w.observe(ciKey("R", 7, "sha2"), { terminal: true, result: "green", currentHead: "sha2" }).length, 1);
  assert.equal(w.observe(ciKey("R", 7, "sha2"), { terminal: true, currentHead: "sha2" }).length, 0); // duplicate event
});

test("waits: every deadline fires, independently per work record", () => {
  let clock = 0; const store = {};
  const w = createWaitRegistry(store, { now: () => clock });
  w.arm({ workId: "ticket:1", kind: "turn", correlation: turnKey(200, "1991"), deadlineMs: 100 });
  w.arm({ workId: "ticket:2", kind: "turn", correlation: turnKey(201, "1991"), deadlineMs: 5000 });
  clock = 200;
  const timed = w.sweep();
  assert.deepEqual(timed.map((x) => x.workId), ["ticket:1"]);
  assert.equal(w.pendingFor("ticket:2").length, 1);
});
