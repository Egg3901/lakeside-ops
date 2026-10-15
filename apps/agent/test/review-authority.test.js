"use strict";
// Keir 3.0 independent review (2026-10-13): adversarial cases against the
// coordinator lease and the EffectGate. Each case is a way to run two
// mutating effects at once, run one twice, or lose an attempt's evidence.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCoordinator } = require("../lib/operator/coordinator");
const { createEffectGate } = require("../lib/operator/effectgate");
const { createPrincipals } = require("../lib/operator/principals");
const owner = createPrincipals({ ownerId: "owner-id", staffIds: [] }).fromAuthenticated({ authorId: "owner-id", via: "decision-button" });

function setup() {
  let clock = 1000;
  const store = {};
  return { store, c: createCoordinator(store, { now: () => clock, leaseMs: 5000 }),
    tick: (ms) => { clock += ms; }, now: () => clock };
}

test("reconcile never strips a live mutating lease because a read-only attempt is running", () => {
  const { c, tick } = setup();
  const writer = c.claim("ticket:1").attempt;
  c.claim("ticket:1", { mutating: false });
  tick(1000); // writer lease still has 4s left
  c.reconcile();
  assert.equal(c.attemptsFor("ticket:1").find((a) => a.id === writer.id).state, "running");
  assert.equal(c.claim("ticket:1").claimed, false, "a second mutating attempt must not start while the first is live");
});

test("reconcile does not interrupt a fresh read-only attempt", () => {
  const { c, tick } = setup();
  const reader = c.claim("ticket:1", { mutating: false }).attempt;
  tick(100);
  assert.deepEqual(c.reconcile().interrupted, []);
  assert.equal(c.attemptsFor("ticket:1").find((a) => a.id === reader.id).state, "running");
});

test("superseding a running mutating attempt keeps the lease until it stops", () => {
  const { c } = setup();
  c.claim("ticket:1");
  c.accept({ id: "m2", workId: "ticket:1", kind: "instruction", actor: "owner", role: "owner" });
  // The superseded process is still executing; nothing has told it to stop
  // or confirmed it stopped. A new mutating attempt here runs two writers.
  assert.equal(c.claim("ticket:1").claimed, false);
});

test("a superseded attempt's late evidence is kept on the record", () => {
  const { c } = setup();
  const { attempt } = c.claim("ticket:1");
  c.accept({ id: "m2", workId: "ticket:1", kind: "instruction", role: "owner" });
  c.complete(attempt.id, "succeeded", [{ kind: "receipt", text: "PR 42 opened" }]);
  assert.ok(c.get("ticket:1").evidence.some((e) => e.text === "PR 42 opened"),
    "an external effect receipt from a superseded attempt must not be dropped");
  assert.equal(c.claim("ticket:1").claimed, true, "the lease frees once the superseded attempt reports");
});

test("wait() cannot orphan a running mutating attempt and let a second one start", () => {
  const { c } = setup();
  c.claim("ticket:1");
  assert.throws(() => c.wait("ticket:1"), /running/);
});

test("approving an effect that already executed cannot authorize it again", () => {
  let clock = 1;
  const gate = createEffectGate({}, { now: () => clock });
  const spec = { kind: "heal-prod", target: "ticket:9", environment: "prod", contentDigest: "d1" };
  const { identity } = gate.propose(spec);
  gate.approve(identity, owner);
  gate.beginExecution(identity);
  gate.recordReceipt(identity, { ok: true });
  clock++;
  assert.throws(() => gate.approve(identity, owner), /already|done/);
  assert.equal(gate.authorizeExecution(spec).allowed, false);
});

test("approving an effect mid-execution cannot open a second concurrent run", () => {
  const gate = createEffectGate({}, { now: () => 1 });
  const spec = { kind: "pr-merge", target: "AHDGame#1", environment: "development", contentDigest: "sha1" };
  const { identity } = gate.propose(spec);
  gate.approve(identity, owner);
  gate.beginExecution(identity);
  assert.throws(() => gate.approve(identity, owner), /executing|uncertain/);
  assert.equal(gate.authorizeExecution(spec).allowed, false);
});
