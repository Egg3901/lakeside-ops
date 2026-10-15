"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSentry } = require("../lib/operator/watches");
const { suggestCluster, clusterState } = require("../lib/operator/clusters");
const { evaluateClocks, etaMs, planVerification, verificationVerdict } = require("../lib/operator/sla");

test("sentry opens one read-only finding per flapping signal and recovers cleanly", () => {
  const s = createSentry({}, { now: () => 1 });
  const a = s.evaluate({ watch: "turn-stall", subject: "prod", minutesWithoutTurn: 50 });
  const b = s.evaluate({ watch: "turn-stall", subject: "prod", minutesWithoutTurn: 55 });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.finding.authority, "read-only-investigation");
  assert.equal(s.open().length, 1);
  assert.equal(s.evaluate({ watch: "turn-stall", subject: "prod", minutesWithoutTurn: 2 }), null);
  assert.equal(s.open().length, 0);
  assert.throws(() => s.evaluate({ watch: "vibes", subject: "x" }), /unknown watch/);
});

test("clustering suggests by signature first and never below threshold", () => {
  const known = [
    { id: "t100", text: "healthcare demand shows zero for clinics", signature: "healthcare-demand" },
    { id: "t200", text: "map fails to load on mobile safari" },
  ];
  const hit = suggestCluster({ text: "clinic demand is zero again", signature: "healthcare-demand" }, known);
  assert.equal(hit.best.id, "t100");
  assert.equal(hit.best.signatureMatch, true);
  const miss = suggestCluster({ text: "my party logo looks blurry" }, known);
  assert.equal(miss.best, null);
});

test("a cluster resolves only when every member is individually verified", () => {
  const s = clusterState([{ ticket: 1, state: "live-verified" }, { ticket: 2, state: "deployed-web" }]);
  assert.equal(s.resolved, false);
  assert.deepEqual(s.outstanding, [2]);
});

test("SLA clocks are record-level with breach forecasting", () => {
  const now = 40 * 60000;
  const rec = { id: "ticket:1", createdAt: 0, lastPublicActivityAt: 1000 };
  const r = evaluateClocks(rec, { ackAt: 5000 }, { now, medianRemainingMs: 10 * 60000 });
  assert.equal(r.clocks.find((c) => c.name === "ack").breached, false);
  assert.equal(r.clocks.find((c) => c.name === "firstSubstantive").breached, true);
  assert.equal(etaMs({}), null);
  assert.ok(etaMs({ queuedAhead: 2, medianActivationMs: 60000 }) >= 120000);
});

test("verification waits for later turns and a still-broken turn reopens", () => {
  const blocked = planVerification({ workId: "ticket:1", world: "1991", deployedTurn: 200, needsWorker: true, workerDeployed: false });
  assert.equal(blocked.blockedOn, "turn-worker deployment");
  const plan = planVerification({ workId: "ticket:1", world: "1991", deployedTurn: 200, workerDeployed: true });
  assert.deepEqual(plan.waits.map((w) => w.correlation), ["turn:1991:201", "turn:1991:202"]);
  assert.equal(verificationVerdict([{ outcome: "fixed" }, { outcome: "still-broken" }]).reopen, true);
  assert.equal(verificationVerdict([{ outcome: "fixed" }, { outcome: "fixed" }]).verified, true);
});
