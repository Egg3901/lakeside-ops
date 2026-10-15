"use strict";
// Keir 3.0 independent review (2026-10-13): ways to make the public status
// say something untrue, from the publisher, the ack, the verification loop
// or the handoff desk.
const test = require("node:test");
const assert = require("node:assert/strict");
const { derivePhase, planPublication, composeAck, PHASE_COPY } = require("../lib/operator/publisher");
const { queuePosition, ackFacts } = require("../lib/operator/admission");
const { planVerification, verificationVerdict } = require("../lib/operator/sla");
const { turnKey } = require("../lib/operator/waits");
const { createHandoffDesk } = require("../lib/operator/handoffs");
const { evaluateBench } = require("../lib/operator/benchgate");

test("a resolved or cancelled record never publishes 'investigating'", () => {
  for (const state of ["resolved", "cancelled", "closed-externally", "terminal"]) {
    const phase = derivePhase({ id: "ticket:1", state, nextAction: "none" });
    assert.notEqual(phase, "investigating", `state ${state}`);
  }
});

test("a blocked record is not hidden behind a prepared fix", () => {
  const phase = derivePhase({ id: "ticket:1", state: "blocked", nextAction: "blocked" }, { prepared: true });
  assert.equal(phase, "blocked");
});

test("a deploy fact without the earlier gates does not tell the player it is released", () => {
  // web serving something, but no CI, no main: inconsistent evidence
  const phase = derivePhase({ id: "ticket:1", state: "waiting", nextAction: "awaiting-event" },
    { prepared: true, webDeployed: true });
  assert.notEqual(phase, "verifying");
});

test("the ack never says work started when every conversation slot is busy", () => {
  const jobs = [
    { id: "busy1", kind: "conversation", state: "running", at: 1 },
    { id: "busy2", kind: "conversation", state: "running", at: 2 },
    { id: "me", kind: "conversation", state: "queued", at: 3 },
  ];
  assert.equal(queuePosition(jobs, jobs[2], { now: 4 }), 0); // nothing queued ahead...
  const facts = ackFacts(jobs, jobs[2], { now: 4 });
  assert.equal(facts.startingNow, false); // ...but no slot is free
  assert.doesNotMatch(composeAck({ ...facts, nextAction: "attempt" }), /picking this up now/i);
  assert.doesNotMatch(composeAck({ queuedAhead: 0, nextAction: "attempt" }), /picking this up now/i);
});

test("repeating a phase later still posts (outbox keys are unique per transition)", () => {
  const record = { id: "ticket:1", state: "waiting", nextAction: "awaiting-ci", attempts: ["a"] };
  const first = planPublication({ record, last: null, now: 0 }); // waiting, seq 1
  const between = { phase: "investigating", at: 10, seq: first.seq + 1 }; // a later transition
  const back = planPublication({ record, last: between, now: 20 });
  assert.equal(back.action, "post");
  assert.notEqual(back.key, first.key, "ledger.notify drops a second post under an already-used key");
  // a retry of the same transition reuses its key, so the outbox stays idempotent
  assert.equal(planPublication({ record, last: between, now: 30 }).key, back.key);
});

test("verification is not satisfied by one fixed turn when two were planned", () => {
  const plan = planVerification({ workId: "ticket:1", world: "1991", deployedTurn: 10, workerDeployed: true });
  assert.equal(plan.waits.length, 2);
  // second turn wait timed out, only one observation arrived
  const verdict = verificationVerdict([{ outcome: "fixed" }], { expected: plan.expected });
  assert.equal(verdict.verified, false);
});

test("turn waits are scoped to a world", () => {
  assert.notEqual(turnKey(12, "1991"), turnKey(12, "1953"));
  assert.throws(() => turnKey(12), /world/);
});

test("a handoff body under the document threshold is kept, not dropped", () => {
  const desk = createHandoffDesk({}, { now: () => 1 });
  const body = "x".repeat(3000);
  const { handoff } = desk.file({ id: "h1", from: "codex", scope: "ticket 1514", asks: ["take over"], body });
  assert.equal(handoff.body, body);
});

test("handoff scope is never silently truncated", () => {
  const desk = createHandoffDesk({}, { now: () => 1 });
  const scope = "s".repeat(900);
  assert.throws(() => desk.file({ id: "h2", from: "codex", scope, asks: ["a"] }), /scope|document/);
});

test("the bench accepts the publisher's own not-live copy", () => {
  const cases = [
    { name: "testing", output: PHASE_COPY.testing, evidence: [] },
    { name: "releasing", output: PHASE_COPY.releasing, evidence: [] },
    { name: "verifying", output: PHASE_COPY.verifying, evidence: ["deployed"] },
  ];
  const r = evaluateBench(cases);
  assert.equal(r.passed, true, JSON.stringify(r.results));
  // and the claims the old regex let through now fail without receipts
  const bypass = evaluateBench([{ name: "went", output: "Good news, the fix went live this morning.", evidence: [] },
    { name: "shipped", output: "That fix has shipped.", evidence: [] },
    { name: "deployed", output: "The change has been deployed.", evidence: [] }]);
  assert.deepEqual(bypass.results.map((x) => x.passed), [false, false, false]);
});
